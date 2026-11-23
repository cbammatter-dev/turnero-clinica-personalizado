import crypto from 'node:crypto';
import { db } from '../db/database.js';
import { getAvailableSlotsForDoctor, getDoctorById } from './availability.js';
import {
  createAppointmentEvent,
  deleteAppointmentEvent,
  markEventConfirmed,
  rescheduleAppointmentEvent,
} from './googleCalendar.js';
import { sendBookingConfirmationWhatsApp } from './whatsapp.js';
import { addMinutesToTime, normalizeDni, normalizePhone } from '../utils/datetime.js';

function generateBookingCode() {
  const rand = crypto.randomBytes(3).toString('hex').toUpperCase();
  return `TRN-${rand}`;
}

export function upsertPatient({ dni, nombreCompleto, telefonoWhatsapp, obraSocial = 'Particular' }) {
  const cleanDni = normalizeDni(dni);
  const cleanPhone = normalizePhone(telefonoWhatsapp);
  const cleanName = String(nombreCompleto || '').trim();
  const cleanObra = String(obraSocial || 'Particular').trim() || 'Particular';

  if (cleanDni.length < 6) {
    throw new Error('Ingresá un DNI válido (solo números, mínimo 6 dígitos).');
  }
  if (cleanName.length < 3) {
    throw new Error('Ingresá tu nombre y apellido completo.');
  }
  if (cleanPhone.length < 8) {
    throw new Error('Ingresá un número de WhatsApp válido (con código de área).');
  }

  const existing = db.prepare('SELECT * FROM pacientes WHERE dni = ?').get(cleanDni);
  if (existing) {
    db.prepare(
      `UPDATE pacientes
       SET nombre_completo = ?, telefono_whatsapp = ?, obra_social = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(cleanName, cleanPhone, cleanObra, existing.id);
    return db.prepare('SELECT * FROM pacientes WHERE id = ?').get(existing.id);
  }

  const res = db
    .prepare(
      `INSERT INTO pacientes (dni, nombre_completo, telefono_whatsapp, obra_social)
       VALUES (?, ?, ?, ?)`
    )
    .run(cleanDni, cleanName, cleanPhone, cleanObra);

  return db.prepare('SELECT * FROM pacientes WHERE id = ?').get(Number(res.lastInsertRowid));
}

export function findPatientByDni(dni) {
  const cleanDni = normalizeDni(dni);
  if (!cleanDni) return null;
  return db.prepare('SELECT * FROM pacientes WHERE dni = ?').get(cleanDni);
}

export function findPatientByPhone(phone) {
  const cleanPhone = normalizePhone(phone);
  if (!cleanPhone) return null;
  return db.prepare('SELECT * FROM pacientes WHERE telefono_whatsapp = ?').get(cleanPhone);
}

const APPOINTMENT_SELECT = `
  SELECT
    t.*,
    pa.dni AS paciente_dni,
    pa.nombre_completo AS paciente_nombre,
    pa.telefono_whatsapp AS paciente_whatsapp,
    pa.obra_social AS obra_social,
    pr.nombre AS profesional_nombre,
    pr.consultorio AS consultorio,
    pr.duracion_turno_min AS duracion_turno_min,
    pr.google_calendar_id AS google_calendar_id,
    e.id AS especialidad_id,
    e.nombre AS especialidad_nombre,
    e.icono AS especialidad_icono
  FROM turnos t
  JOIN pacientes pa ON pa.id = t.paciente_id
  JOIN profesionales pr ON pr.id = t.profesional_id
  JOIN especialidades e ON e.id = pr.especialidad_id
`;

export function getAppointmentById(id) {
  return db.prepare(`${APPOINTMENT_SELECT} WHERE t.id = ?`).get(Number(id));
}

export function getAppointmentByCode(codigo) {
  return db
    .prepare(`${APPOINTMENT_SELECT} WHERE UPPER(t.codigo) = UPPER(?)`)
    .get(String(codigo || '').trim());
}

export function listAppointments({
  fecha = null,
  profesionalId = null,
  especialidadId = null,
  estado = null,
  dni = null,
  phone = null,
  onlyActive = false,
} = {}) {
  const conditions = [];
  const params = [];

  if (fecha) {
    conditions.push('t.fecha = ?');
    params.push(fecha);
  }
  if (profesionalId) {
    conditions.push('t.profesional_id = ?');
    params.push(Number(profesionalId));
  }
  if (especialidadId) {
    conditions.push('pr.especialidad_id = ?');
    params.push(Number(especialidadId));
  }
  if (estado) {
    conditions.push('t.estado = ?');
    params.push(estado);
  }
  if (dni) {
    conditions.push('pa.dni = ?');
    params.push(normalizeDni(dni));
  }
  if (phone) {
    conditions.push('pa.telefono_whatsapp = ?');
    params.push(normalizePhone(phone));
  }
  if (onlyActive) {
    conditions.push("t.estado IN ('reservado', 'confirmado')");
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  return db
    .prepare(`${APPOINTMENT_SELECT} ${where} ORDER BY t.fecha ASC, t.hora_inicio ASC`)
    .all(...params);
}

/**
 * Crea un turno verificando disponibilidad real (SQLite + Google Calendar),
 * sincroniza el evento en Google Calendar y opcionalmente envía comprobante por WhatsApp.
 */
export async function createAppointment({
  profesionalId,
  fecha,
  horaInicio,
  paciente,
  canalOrigen = 'web',
  notas = '',
  notifyWhatsApp = true,
}) {
  const doctor = getDoctorById(profesionalId);
  if (!doctor) {
    throw new Error('El profesional seleccionado no existe o no está activo.');
  }

  // Verificar disponibilidad en tiempo real
  const slots = await getAvailableSlotsForDoctor(doctor.id, fecha);
  const matchingSlot = slots.find((s) => s.hora_inicio === horaInicio);
  if (!matchingSlot) {
    throw new Error(
      'Ese horario acaba de ocuparse o no está disponible. Por favor elegí otro horario.'
    );
  }

  const savedPatient = upsertPatient(paciente);
  const horaFin = addMinutesToTime(horaInicio, doctor.duracion_turno_min);
  const codigo = generateBookingCode();

  let newId;
  try {
    const res = db
      .prepare(
        `INSERT INTO turnos
          (codigo, paciente_id, profesional_id, fecha, hora_inicio, hora_fin, estado, canal_origen, notas)
         VALUES (?, ?, ?, ?, ?, ?, 'reservado', ?, ?)`
      )
      .run(codigo, savedPatient.id, doctor.id, fecha, horaInicio, horaFin, canalOrigen, notas);
    newId = Number(res.lastInsertRowid);
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      throw new Error('Ese horario acaba de ser reservado por otro paciente. Elegí otro por favor.');
    }
    throw err;
  }

  const appointment = getAppointmentById(newId);

  // Sincronizar con Google Calendar del profesional
  const gcal = await createAppointmentEvent(doctor.google_calendar_id, appointment);
  db.prepare(
    `UPDATE turnos SET google_event_id = ?, google_sync_mode = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(gcal.eventId, gcal.mode, newId);

  const finalAppointment = getAppointmentById(newId);

  // Si reservó desde la Web, enviarle el comprobante por WhatsApp automáticamente
  if (notifyWhatsApp && canalOrigen === 'web') {
    await sendBookingConfirmationWhatsApp(finalAppointment);
  }

  return finalAppointment;
}

export async function confirmAppointment(appointmentId) {
  const appt = getAppointmentById(appointmentId);
  if (!appt) throw new Error('Turno no encontrado.');
  if (appt.estado === 'cancelado') throw new Error('Este turno ya fue cancelado.');

  db.prepare(
    `UPDATE turnos SET estado = 'confirmado', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(appt.id);

  const updated = getAppointmentById(appt.id);
  await markEventConfirmed(updated.google_calendar_id, updated.google_event_id, updated);
  return updated;
}

export async function cancelAppointment(appointmentId) {
  const appt = getAppointmentById(appointmentId);
  if (!appt) throw new Error('Turno no encontrado.');
  if (appt.estado === 'cancelado') return appt;

  db.prepare(
    `UPDATE turnos SET estado = 'cancelado', updated_at = CURRENT_TIMESTAMP WHERE id = ?`
  ).run(appt.id);

  // Eliminar evento de Google Calendar para liberar el hueco inmediatamente
  await deleteAppointmentEvent(appt.google_calendar_id, appt.google_event_id);

  return getAppointmentById(appt.id);
}

export async function rescheduleAppointment(appointmentId, { fecha, horaInicio }) {
  const appt = getAppointmentById(appointmentId);
  if (!appt) throw new Error('Turno no encontrado.');
  if (appt.estado === 'cancelado') {
    throw new Error('No se puede modificar un turno cancelado. Sacá uno nuevo.');
  }

  const slots = await getAvailableSlotsForDoctor(appt.profesional_id, fecha, {
    excludeAppointmentId: appt.id,
  });
  const matchingSlot = slots.find((s) => s.hora_inicio === horaInicio);
  if (!matchingSlot) {
    throw new Error('El nuevo horario elegido no está disponible. Probá con otro.');
  }

  const horaFin = addMinutesToTime(horaInicio, appt.duracion_turno_min);
  const notaCambio = `🔄 Reprogramado desde ${appt.fecha} ${appt.hora_inicio} hs`;

  db.prepare(
    `UPDATE turnos
     SET fecha = ?, hora_inicio = ?, hora_fin = ?,
         estado = 'reservado',
         notas = ?,
         recordatorio_24h_enviado = 0,
         recordatorio_enviado_at = NULL,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(fecha, horaInicio, horaFin, notaCambio, appt.id);

  const updated = getAppointmentById(appt.id);
  await rescheduleAppointmentEvent(updated.google_calendar_id, updated.google_event_id, updated);
  return updated;
}
