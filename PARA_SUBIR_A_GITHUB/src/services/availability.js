import { db } from '../db/database.js';
import { config } from '../config.js';
import { getBusyIntervalsFromGoogle } from './googleCalendar.js';
import {
  addDaysToDate,
  formatDateFriendly,
  formatDateShort,
  getClinicNow,
  getDayOfWeek,
  minutesToTime,
  timeToMinutes,
} from '../utils/datetime.js';

function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

export function getDoctorById(doctorId) {
  return db
    .prepare(
      `SELECT p.*, e.nombre AS especialidad_nombre, e.icono AS especialidad_icono
       FROM profesionales p
       JOIN especialidades e ON e.id = p.especialidad_id
       WHERE p.id = ? AND p.activo = 1`
    )
    .get(Number(doctorId));
}

export function listSpecialties({ includeEmpty = true } = {}) {
  const havingClause = includeEmpty ? '' : 'HAVING total_profesionales > 0';
  return db
    .prepare(
      `SELECT e.*, COUNT(p.id) AS total_profesionales
       FROM especialidades e
       LEFT JOIN profesionales p ON p.especialidad_id = e.id AND p.activo = 1
       WHERE e.activa = 1
       GROUP BY e.id
       ${havingClause}
       ORDER BY e.nombre ASC`
    )
    .all();
}

export function listDoctorsBySpecialty(specialtyId) {
  const doctors = db
    .prepare(
      `SELECT p.*, e.nombre AS especialidad_nombre, e.icono AS especialidad_icono
       FROM profesionales p
       JOIN especialidades e ON e.id = p.especialidad_id
       WHERE p.especialidad_id = ? AND p.activo = 1
       ORDER BY p.nombre ASC`
    )
    .all(Number(specialtyId));

  const stmtHorarios = db.prepare(
    'SELECT dia_semana, hora_inicio, hora_fin FROM horarios_atencion WHERE profesional_id = ? ORDER BY dia_semana, hora_inicio'
  );

  return doctors.map((d) => ({
    ...d,
    horarios: stmtHorarios.all(d.id),
  }));
}

/**
 * Devuelve los horarios disponibles (array de { hora_inicio, hora_fin, periodo })
 * para un profesional en una fecha YYYY-MM-DD, cruzando:
 *  1) Reglas semanales del médico (horarios_atencion)
 *  2) Turnos ya reservados en SQLite
 *  3) Bloqueos locales (bloqueos_agenda)
 *  4) Eventos ocupados reales en Google Calendar (si está conectado)
 */
export async function getAvailableSlotsForDoctor(doctorId, dateStr, { excludeAppointmentId = null } = {}) {
  const doctor = getDoctorById(doctorId);
  if (!doctor) return [];

  const now = getClinicNow();
  if (dateStr < now.date) return [];

  // Si existe un horario especial cargado para esta fecha puntual, tiene prioridad sobre el horario semanal
  const specialBlocks = db
    .prepare(
      'SELECT hora_inicio, hora_fin FROM horarios_especiales WHERE profesional_id = ? AND fecha = ? ORDER BY hora_inicio ASC'
    )
    .all(doctor.id, dateStr);

  const dow = getDayOfWeek(dateStr);
  const blocks =
    specialBlocks.length > 0
      ? specialBlocks
      : db
          .prepare(
            'SELECT hora_inicio, hora_fin FROM horarios_atencion WHERE profesional_id = ? AND dia_semana = ? ORDER BY hora_inicio ASC'
          )
          .all(doctor.id, dow);

  if (blocks.length === 0) return [];

  // Intervalos ocupados por turnos locales
  const bookedRows = db
    .prepare(
      `SELECT id, hora_inicio, hora_fin FROM turnos
       WHERE profesional_id = ? AND fecha = ? AND estado NOT IN ('cancelado')`
    )
    .all(doctor.id, dateStr);

  const busyIntervals = [];
  for (const row of bookedRows) {
    if (excludeAppointmentId && Number(row.id) === Number(excludeAppointmentId)) continue;
    busyIntervals.push({
      startMinutes: timeToMinutes(row.hora_inicio),
      endMinutes: timeToMinutes(row.hora_fin),
    });
  }

  // Bloqueos manuales locales
  const manualBlocks = db
    .prepare('SELECT hora_inicio, hora_fin FROM bloqueos_agenda WHERE profesional_id = ? AND fecha = ?')
    .all(doctor.id, dateStr);

  for (const b of manualBlocks) {
    busyIntervals.push({
      startMinutes: timeToMinutes(b.hora_inicio),
      endMinutes: timeToMinutes(b.hora_fin),
    });
  }

  // Eventos reales en Google Calendar (vacaciones, congresos, sobreturnos manuales)
  const gcalBusy = await getBusyIntervalsFromGoogle(doctor.google_calendar_id, dateStr);
  for (const g of gcalBusy) {
    busyIntervals.push({
      startMinutes: g.startMinutes,
      endMinutes: g.endMinutes,
    });
  }

  const duration = Number(doctor.duracion_turno_min) || 30;
  const minMinutesToday = now.minutes + config.clinic.minLeadHours * 60;
  const slots = [];

  for (const block of blocks) {
    let cursor = timeToMinutes(block.hora_inicio);
    const blockEnd = timeToMinutes(block.hora_fin);

    while (cursor + duration <= blockEnd) {
      const slotStart = cursor;
      const slotEnd = cursor + duration;

      const isTooSoonToday = dateStr === now.date && slotStart < minMinutesToday;
      const overlapsBusy = busyIntervals.some((b) =>
        intervalsOverlap(slotStart, slotEnd, b.startMinutes, b.endMinutes)
      );

      if (!isTooSoonToday && !overlapsBusy) {
        const horaInicio = minutesToTime(slotStart);
        slots.push({
          hora_inicio: horaInicio,
          hora_fin: minutesToTime(slotEnd),
          periodo: slotStart < 13 * 60 ? 'mañana' : 'tarde',
          profesional_id: doctor.id,
          profesional_nombre: doctor.nombre,
          consultorio: doctor.consultorio,
        });
      }

      cursor += duration;
    }
  }

  return slots;
}

/**
 * Devuelve los próximos días disponibles para un profesional (o para cualquier profesional de una especialidad).
 */
export async function getAvailableDays({
  doctorId = null,
  specialtyId = null,
  limitDays = 14,
  offsetDays = 0,
  excludeAppointmentId = null,
}) {
  const now = getClinicNow();
  const windowDays = config.clinic.bookingWindowDays;

  const doctors = doctorId
    ? [getDoctorById(doctorId)].filter(Boolean)
    : listDoctorsBySpecialty(specialtyId);

  if (doctors.length === 0) return [];

  const availableDays = [];

  for (let d = 0; d < windowDays; d++) {
    const dateStr = addDaysToDate(now.date, d);
    let totalSlots = 0;

    for (const doc of doctors) {
      const slots = await getAvailableSlotsForDoctor(doc.id, dateStr, { excludeAppointmentId });
      totalSlots += slots.length;
    }

    if (totalSlots > 0) {
      availableDays.push({
        fecha: dateStr,
        label: formatDateFriendly(dateStr),
        shortLabel: formatDateShort(dateStr),
        total_horarios: totalSlots,
      });
    }

    if (availableDays.length >= offsetDays + limitDays) break;
  }

  return availableDays.slice(offsetDays, offsetDays + limitDays);
}

/**
 * Horarios disponibles en una fecha para TODOS los médicos de una especialidad ("Primer turno disponible").
 */
export async function getAvailableSlotsForSpecialty(specialtyId, dateStr) {
  const doctors = listDoctorsBySpecialty(specialtyId);
  const allSlots = [];

  for (const doc of doctors) {
    const slots = await getAvailableSlotsForDoctor(doc.id, dateStr);
    allSlots.push(...slots);
  }

  // Ordenar por hora y luego por nombre del médico
  allSlots.sort((a, b) => {
    if (a.hora_inicio !== b.hora_inicio) return a.hora_inicio.localeCompare(b.hora_inicio);
    return a.profesional_nombre.localeCompare(b.profesional_nombre);
  });

  return allSlots;
}

/**
 * Busca el primer turno más próximo entre todos los médicos de una especialidad.
 */
export async function findFirstAvailableSlot(specialtyId) {
  const days = await getAvailableDays({ specialtyId, limitDays: 1 });
  if (days.length === 0) return null;
  const firstDay = days[0];
  const slots = await getAvailableSlotsForSpecialty(specialtyId, firstDay.fecha);
  if (slots.length === 0) return null;
  return {
    fecha: firstDay.fecha,
    fecha_label: firstDay.label,
    ...slots[0],
  };
}
