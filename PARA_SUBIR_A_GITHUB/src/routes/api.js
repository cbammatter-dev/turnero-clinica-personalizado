import express from 'express';
import { config } from '../config.js';
import {
  db,
  saveClinicSettings,
  saveWhatsAppSettings,
  clearWhatsAppSettings,
  listObrasSociales,
  addObraSocial,
  removeObraSocial,
  listRecetarios,
  addRecetario,
  removeRecetario,
} from '../db/database.js';
import {
  listSpecialties,
  listDoctorsBySpecialty,
  getAvailableDays,
  getAvailableSlotsForDoctor,
  getAvailableSlotsForSpecialty,
  findFirstAvailableSlot,
  getDoctorById,
} from '../services/availability.js';
import {
  listAppointments,
  createAppointment,
  confirmAppointment,
  cancelAppointment,
  rescheduleAppointment,
  findPatientByDni,
  getAppointmentById,
} from '../services/appointments.js';
import {
  isGoogleCalendarLive,
  getGoogleConnectionInfo,
  saveServiceAccountJson,
  testCalendarAccess,
  createDoctorCalendar,
  createBlockEvent,
  deleteAppointmentEvent,
} from '../services/googleCalendar.js';
import {
  isWhatsAppLive,
  getWhatsAppConnectionInfo,
  sendTestWhatsAppMessage,
  getWhatsAppHistory,
  clearWhatsAppHistory,
  logWhatsAppMessage,
  sendBotMessage,
} from '../services/whatsapp.js';
import {
  disconnectQrWhatsApp,
  getQrWhatsAppStatus,
  startQrWhatsApp,
} from '../services/whatsappQr.js';
import { handleIncomingBotMessage, resetSession } from '../services/botEngine.js';
import { sendReminderNow, processDueReminders } from '../services/reminderJob.js';
import {
  authenticateUser,
  clearSessionCookie,
  createSessionToken,
  getRequestUser,
  getUserById,
  hashPassword,
  requireAdmin,
  requireAuth,
  setSessionCookie,
  verifyPassword,
} from '../services/auth.js';
import { getClinicNow, normalizeDni, normalizePhone } from '../utils/datetime.js';
import {
  buildExcelReportBuffer,
  queryAttentionsReport,
  queryPatientsDatabase,
  queryProfessionalsDatabase,
} from '../services/reports.js';

export const apiRouter = express.Router();

// ============================================================
// AUTENTICACIÓN (ADMINISTRADOR GENERAL Y MÉDICOS)
// ============================================================
apiRouter.get('/auth/me', (req, res) => {
  const user = getRequestUser(req);
  res.json({ authenticated: Boolean(user), user: user || null });
});

apiRouter.post('/auth/login', (req, res) => {
  const { username, password } = req.body;
  const user = authenticateUser(username, password);
  if (!user) {
    return res.status(401).json({ error: 'Usuario o contraseña incorrectos.' });
  }
  const token = createSessionToken(user);
  setSessionCookie(res, token);
  res.json({ ok: true, user });
});

apiRouter.post('/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ ok: true });
});

apiRouter.post('/auth/change-password', requireAuth, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!newPassword || String(newPassword).length < 4) {
    return res.status(400).json({ error: 'La nueva contraseña debe tener al menos 4 caracteres.' });
  }
  const row = db.prepare('SELECT password_hash FROM usuarios WHERE id = ?').get(req.user.id);
  if (!verifyPassword(currentPassword, row?.password_hash)) {
    return res.status(400).json({ error: 'La contraseña actual no es correcta.' });
  }
  db.prepare('UPDATE usuarios SET password_hash = ? WHERE id = ?').run(
    hashPassword(newPassword),
    req.user.id
  );
  res.json({ ok: true, message: 'Contraseña actualizada correctamente.' });
});

// ============================================================
// CONFIGURACIÓN Y ESTADO DEL SISTEMA
// ============================================================
apiRouter.get('/status', (_req, res) => {
  const now = getClinicNow();
  res.json({
    clinic: config.clinic,
    now,
    integrations: {
      googleCalendar: isGoogleCalendarLive() ? 'live' : 'demo',
      whatsapp: isWhatsAppLive() ? 'live' : 'demo',
    },
  });
});

// ============================================================
// ESPECIALIDADES, PROFESIONALES Y DISPONIBILIDAD EN TIEMPO REAL
// ============================================================
apiRouter.get('/specialties', (req, res) => {
  const includeEmpty = req.query.includeEmpty !== 'false';
  res.json({ specialties: listSpecialties({ includeEmpty }) });
});

apiRouter.get('/obras-sociales', (_req, res) => {
  res.json({ obrasSociales: listObrasSociales() });
});

apiRouter.get('/doctors', (req, res) => {
  const { specialtyId } = req.query;
  if (specialtyId) {
    return res.json({ doctors: listDoctorsBySpecialty(specialtyId) });
  }

  const doctors = db
    .prepare(
      `SELECT p.*, e.nombre AS especialidad_nombre, e.icono AS especialidad_icono
       FROM profesionales p
       JOIN especialidades e ON e.id = p.especialidad_id
       ORDER BY e.nombre ASC, p.nombre ASC`
    )
    .all();

  const stmtHorarios = db.prepare(
    'SELECT id, dia_semana, hora_inicio, hora_fin FROM horarios_atencion WHERE profesional_id = ? ORDER BY dia_semana, hora_inicio'
  );

  res.json({
    doctors: doctors.map((d) => ({
      ...d,
      horarios: stmtHorarios.all(d.id),
    })),
  });
});

apiRouter.get('/availability/days', async (req, res) => {
  try {
    const { doctorId, specialtyId, limit = 14, offset = 0, excludeAppointmentId } = req.query;
    const days = await getAvailableDays({
      doctorId: doctorId && doctorId !== 'any' ? Number(doctorId) : null,
      specialtyId: specialtyId ? Number(specialtyId) : null,
      limitDays: Number(limit),
      offsetDays: Number(offset),
      excludeAppointmentId: excludeAppointmentId ? Number(excludeAppointmentId) : null,
    });
    res.json({ days });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/availability/slots', async (req, res) => {
  try {
    const { doctorId, specialtyId, date, excludeAppointmentId } = req.query;
    if (!date) return res.status(400).json({ error: 'Falta el parámetro date (YYYY-MM-DD).' });

    const slots =
      doctorId && doctorId !== 'any'
        ? await getAvailableSlotsForDoctor(Number(doctorId), date, {
            excludeAppointmentId: excludeAppointmentId ? Number(excludeAppointmentId) : null,
          })
        : await getAvailableSlotsForSpecialty(Number(specialtyId), date);

    res.json({ date, slots });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/availability/first', async (req, res) => {
  try {
    const { specialtyId } = req.query;
    if (!specialtyId) return res.status(400).json({ error: 'Falta specialtyId.' });
    const first = await findFirstAvailableSlot(Number(specialtyId));
    res.json({ first });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/patients/lookup', (req, res) => {
  const { dni } = req.query;
  const patient = findPatientByDni(dni);
  res.json({ patient: patient || null });
});

// ============================================================
// TURNOS (RESERVAR, BUSCAR, CONFIRMAR, REPROGRAMAR, CANCELAR)
// ============================================================
apiRouter.get('/appointments', (req, res) => {
  const { fecha, profesionalId, especialidadId, estado, dni, phone, onlyActive } = req.query;
  const user = getRequestUser(req);

  // Si NO inició sesión, solo puede consultar sus propios turnos por DNI o teléfono
  if (!user && !dni && !phone) {
    return res.status(401).json({ error: 'Iniciá sesión para ver la agenda completa.' });
  }

  // Si inició sesión como médico (administrador de su agenda), forzar su propio profesionalId
  const scopedProfesionalId =
    user && user.rol === 'profesional'
      ? user.profesional_id
      : profesionalId || null;

  const appointments = listAppointments({
    fecha: fecha || null,
    profesionalId: scopedProfesionalId,
    especialidadId: user && user.rol === 'profesional' ? null : especialidadId || null,
    estado: estado || null,
    dni: dni || null,
    phone: phone || null,
    onlyActive: onlyActive === 'true',
  });
  res.json({ appointments });
});

apiRouter.post('/appointments', async (req, res) => {
  try {
    const { profesionalId, fecha, horaInicio, paciente, canalOrigen = 'web', notas = '' } = req.body;
    const appointment = await createAppointment({
      profesionalId,
      fecha,
      horaInicio,
      paciente,
      canalOrigen,
      notas,
      notifyWhatsApp: true,
    });
    res.status(201).json({ appointment });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/appointments/:id/confirm', async (req, res) => {
  try {
    const appointment = await confirmAppointment(req.params.id);
    res.json({ appointment });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/appointments/:id/reschedule', async (req, res) => {
  try {
    const { fecha, horaInicio } = req.body;
    const appointment = await rescheduleAppointment(req.params.id, { fecha, horaInicio });
    res.json({ appointment });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/appointments/:id/cancel', async (req, res) => {
  try {
    const appointment = await cancelAppointment(req.params.id);
    res.json({ appointment });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Disparo manual de recordatorio 24 hs (requiere sesión de Admin o del médico dueño del turno)
apiRouter.post('/appointments/:id/send-reminder', requireAuth, async (req, res) => {
  try {
    const appt = getAppointmentById(req.params.id);
    if (!appt) return res.status(404).json({ error: 'Turno no encontrado.' });
    if (req.user.rol === 'profesional' && appt.profesional_id !== req.user.profesional_id) {
      return res.status(403).json({ error: 'Solo podés operar sobre los turnos de tu propia agenda.' });
    }
    const result = await sendReminderNow(req.params.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/reminders/run', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const sent = await processDueReminders();
    res.json({ count: sent.length, sent });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// BOT CONVERSACIONAL (WEB CHAT Y SIMULADOR WHATSAPP)
// ============================================================
apiRouter.post('/bot/web/message', async (req, res) => {
  try {
    const { sessionId, text = '', actionId = null, reset = false } = req.body;
    const sid = String(sessionId || 'web-guest');
    if (reset) {
      resetSession(`web:${sid}`);
    }
    const replies = await handleIncomingBotMessage({
      channel: 'web',
      userId: sid,
      text,
      actionId,
    });
    res.json({ replies });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/whatsapp/sim/history', (req, res) => {
  const phone = normalizePhone(req.query.phone || '5491155550001');
  res.json({
    phone,
    messages: getWhatsAppHistory(phone),
  });
});

apiRouter.post('/whatsapp/sim/reset', (req, res) => {
  const phone = normalizePhone(req.body.phone || '5491155550001');
  clearWhatsAppHistory(phone);
  resetSession(`whatsapp:${phone}`);
  res.json({ ok: true, phone });
});

apiRouter.post('/whatsapp/sim/message', async (req, res) => {
  try {
    const phone = normalizePhone(req.body.phone || '5491155550001');
    const { text = '', actionId = null, label = null } = req.body;

    // Registrar mensaje entrante del paciente
    logWhatsAppMessage(phone, 'inbound', 'text', label || text || actionId, { actionId });

    // Ejecutar el mismo motor real que usa Meta WhatsApp Cloud API
    const replies = await handleIncomingBotMessage({
      channel: 'whatsapp',
      userId: phone,
      phone,
      text,
      actionId,
    });

    for (const reply of replies) {
      await sendBotMessage(phone, reply);
    }

    res.json({
      phone,
      messages: getWhatsAppHistory(phone),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================
// PANEL ADMIN DE RECEPCIÓN (ESPECIALIDADES, PROFESIONALES Y BLOQUEOS)
// ============================================================
function findOrCreateSpecialty({ nombre, icono = '🩺', descripcion = '' }) {
  const cleanName = String(nombre || '').trim();
  if (cleanName.length < 2) {
    throw new Error('Escribí el nombre de la especialidad (mínimo 2 letras).');
  }
  const existing = db
    .prepare('SELECT * FROM especialidades WHERE LOWER(nombre) = LOWER(?)')
    .get(cleanName);
  if (existing) {
    if (!existing.activa) {
      db.prepare('UPDATE especialidades SET activa = 1 WHERE id = ?').run(existing.id);
    }
    return db.prepare('SELECT * FROM especialidades WHERE id = ?').get(existing.id);
  }

  const cleanIcon = String(icono || '🩺').trim() || '🩺';
  const cleanDesc = String(descripcion || '').trim();
  const resInsert = db
    .prepare('INSERT INTO especialidades (nombre, icono, descripcion) VALUES (?, ?, ?)')
    .run(cleanName, cleanIcon, cleanDesc);
  return db
    .prepare('SELECT * FROM especialidades WHERE id = ?')
    .get(Number(resInsert.lastInsertRowid));
}

apiRouter.post('/admin/specialties', requireAuth, requireAdmin, (req, res) => {
  try {
    const specialty = findOrCreateSpecialty(req.body || {});
    res.status(201).json({ specialty });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.patch('/admin/specialties/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = db.prepare('SELECT * FROM especialidades WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ error: 'Especialidad no encontrada.' });

    const { nombre, icono, descripcion } = req.body || {};
    const nextName = nombre !== undefined && String(nombre).trim() ? String(nombre).trim() : current.nombre;
    const nextIcon = icono !== undefined && String(icono).trim() ? String(icono).trim() : current.icono;
    const nextDesc = descripcion !== undefined ? String(descripcion).trim() : current.descripcion;

    db.prepare(
      'UPDATE especialidades SET nombre = ?, icono = ?, descripcion = ? WHERE id = ?'
    ).run(nextName, nextIcon, nextDesc, id);

    res.json({ specialty: db.prepare('SELECT * FROM especialidades WHERE id = ?').get(id) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'Ya existe otra especialidad con ese nombre.' });
    }
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/admin/obras-sociales', requireAuth, requireAdmin, (req, res) => {
  try {
    const obraSocial = addObraSocial(req.body?.nombre);
    res.status(201).json({ obraSocial, obrasSociales: listObrasSociales() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/admin/obras-sociales/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    removeObraSocial(req.params.id);
    res.json({ ok: true, obrasSociales: listObrasSociales() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/admin/doctors', requireAuth, requireAdmin, (req, res) => {
  try {
    const {
      nombre,
      especialidadId,
      nuevaEspecialidad = null,
      matricula = '',
      duracionTurnoMin = 30,
      consultorio = 'Consultorio 1',
      googleCalendarId = '',
      obrasSociales = 'Particular, OSDE, Swiss Medical',
      horarios = [],
    } = req.body;

    let resolvedSpecialtyId = especialidadId ? Number(especialidadId) : null;
    if ((!resolvedSpecialtyId || Number.isNaN(resolvedSpecialtyId)) && nuevaEspecialidad?.nombre) {
      const createdSpec = findOrCreateSpecialty(nuevaEspecialidad);
      resolvedSpecialtyId = createdSpec.id;
    }

    if (!nombre || !resolvedSpecialtyId) {
      return res.status(400).json({ error: 'Nombre y especialidad son obligatorios.' });
    }

    const result = db
      .prepare(
        `INSERT INTO profesionales
          (nombre, especialidad_id, matricula, duracion_turno_min, consultorio, google_calendar_id, obras_sociales)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        nombre.trim(),
        resolvedSpecialtyId,
        matricula.trim(),
        Number(duracionTurnoMin) || 30,
        consultorio.trim(),
        googleCalendarId.trim(),
        obrasSociales.trim()
      );

    const profId = Number(result.lastInsertRowid);
    const defaultHorarios =
      horarios.length > 0
        ? horarios
        : [
            { dia_semana: 1, hora_inicio: '08:00', hora_fin: '20:00' },
            { dia_semana: 2, hora_inicio: '08:00', hora_fin: '20:00' },
            { dia_semana: 3, hora_inicio: '08:00', hora_fin: '20:00' },
            { dia_semana: 4, hora_inicio: '08:00', hora_fin: '20:00' },
            { dia_semana: 5, hora_inicio: '08:00', hora_fin: '20:00' },
            { dia_semana: 6, hora_inicio: '08:00', hora_fin: '20:00' },
            { dia_semana: 0, hora_inicio: '08:00', hora_fin: '20:00' },
          ];

    const stmt = db.prepare(
      'INSERT INTO horarios_atencion (profesional_id, dia_semana, hora_inicio, hora_fin) VALUES (?, ?, ?, ?)'
    );
    for (const h of defaultHorarios) {
      stmt.run(profId, Number(h.dia_semana), h.hora_inicio, h.hora_fin);
    }

    res.status(201).json({ doctor: getDoctorById(profId) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.patch('/admin/doctors/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const {
      nombre,
      especialidadId,
      dni,
      fechaNacimiento,
      matricula,
      domicilio,
      localidad,
      telefono,
      email,
      obrasSociales,
      googleCalendarId,
      consultorio,
      duracionTurnoMin,
      activo,
    } = req.body || {};
    const current = db.prepare('SELECT * FROM profesionales WHERE id = ?').get(Number(req.params.id));
    if (!current) return res.status(404).json({ error: 'Profesional no encontrado.' });

    db.prepare(
      `UPDATE profesionales
       SET nombre = ?, especialidad_id = ?, dni = ?, fecha_nacimiento = ?, matricula = ?,
           domicilio = ?, localidad = ?, telefono = ?, email = ?, obras_sociales = ?,
           google_calendar_id = ?, consultorio = ?, duracion_turno_min = ?, activo = ?
       WHERE id = ?`
    ).run(
      nombre !== undefined && String(nombre).trim() ? String(nombre).trim() : current.nombre,
      especialidadId !== undefined && Number(especialidadId) ? Number(especialidadId) : current.especialidad_id,
      dni !== undefined ? String(dni).trim() : current.dni || '',
      fechaNacimiento !== undefined ? String(fechaNacimiento).trim() : current.fecha_nacimiento || '',
      matricula !== undefined ? String(matricula).trim() : current.matricula || '',
      domicilio !== undefined ? String(domicilio).trim() : current.domicilio || '',
      localidad !== undefined ? String(localidad).trim() : current.localidad || '',
      telefono !== undefined ? String(telefono).trim() : current.telefono || '',
      email !== undefined ? String(email).trim() : current.email || '',
      obrasSociales !== undefined ? String(obrasSociales).trim() : current.obras_sociales || '',
      googleCalendarId !== undefined ? String(googleCalendarId).trim() : current.google_calendar_id,
      consultorio !== undefined ? String(consultorio).trim() : current.consultorio,
      duracionTurnoMin !== undefined ? Number(duracionTurnoMin) : current.duracion_turno_min,
      activo !== undefined ? (activo ? 1 : 0) : current.activo,
      current.id
    );

    res.json({ doctor: getDoctorById(current.id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/admin/doctors/:id/schedule', requireAuth, (req, res) => {
  const doctorId = Number(req.params.id);
  if (req.user.rol === 'profesional' && req.user.profesional_id !== doctorId) {
    return res.status(403).json({ error: 'No tenés permiso para ver los horarios de otro profesional.' });
  }
  const doctor = db
    .prepare(
      `SELECT p.*, e.nombre AS especialidad_nombre, e.icono AS especialidad_icono
       FROM profesionales p
       JOIN especialidades e ON e.id = p.especialidad_id
       WHERE p.id = ?`
    )
    .get(doctorId);
  if (!doctor) return res.status(404).json({ error: 'Profesional no encontrado.' });

  const horarios = db
    .prepare(
      'SELECT id, dia_semana, hora_inicio, hora_fin FROM horarios_atencion WHERE profesional_id = ? ORDER BY dia_semana ASC, hora_inicio ASC'
    )
    .all(doctorId);

  const now = getClinicNow();
  const especiales = db
    .prepare(
      'SELECT id, fecha, hora_inicio, hora_fin, nota FROM horarios_especiales WHERE profesional_id = ? AND fecha >= ? ORDER BY fecha ASC, hora_inicio ASC'
    )
    .all(doctorId, now.date);

  res.json({ doctor, horarios, especiales });
});

apiRouter.put('/admin/doctors/:id/schedule', requireAuth, requireAdmin, (req, res) => {
  try {
    const doctorId = Number(req.params.id);
    const doctor = db.prepare('SELECT * FROM profesionales WHERE id = ?').get(doctorId);
    if (!doctor) return res.status(404).json({ error: 'Profesional no encontrado.' });

    const { horarios = [], duracionTurnoMin } = req.body || {};
    if (!Array.isArray(horarios)) {
      return res.status(400).json({ error: 'Formato de horarios inválido.' });
    }

    const cleanHorarios = [];
    for (const h of horarios) {
      const dia = Number(h.dia_semana);
      const ini = String(h.hora_inicio || '').trim();
      const fin = String(h.hora_fin || '').trim();
      if (Number.isNaN(dia) || dia < 0 || dia > 6) {
        return res.status(400).json({ error: 'Día de la semana inválido.' });
      }
      if (!/^\d{2}:\d{2}$/.test(ini) || !/^\d{2}:\d{2}$/.test(fin)) {
        return res.status(400).json({ error: 'Formato de horario inválido (usá HH:MM).' });
      }
      if (ini >= fin) {
        return res.status(400).json({
          error: `La hora de inicio (${ini}) debe ser anterior a la hora de fin (${fin}).`,
        });
      }
      cleanHorarios.push({ dia_semana: dia, hora_inicio: ini, hora_fin: fin });
    }

    if (duracionTurnoMin !== undefined) {
      const dur = Number(duracionTurnoMin);
      if (dur >= 5 && dur <= 180) {
        db.prepare('UPDATE profesionales SET duracion_turno_min = ? WHERE id = ?').run(dur, doctorId);
      }
    }

    db.prepare('DELETE FROM horarios_atencion WHERE profesional_id = ?').run(doctorId);
    const insertStmt = db.prepare(
      'INSERT INTO horarios_atencion (profesional_id, dia_semana, hora_inicio, hora_fin) VALUES (?, ?, ?, ?)'
    );
    for (const h of cleanHorarios) {
      insertStmt.run(doctorId, h.dia_semana, h.hora_inicio, h.hora_fin);
    }

    const updatedHorarios = db
      .prepare(
        'SELECT id, dia_semana, hora_inicio, hora_fin FROM horarios_atencion WHERE profesional_id = ? ORDER BY dia_semana ASC, hora_inicio ASC'
      )
      .all(doctorId);

    res.json({
      ok: true,
      doctor: getDoctorById(doctorId),
      horarios: updatedHorarios,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Cambios puntuales por fecha específica (ej. este sábado atiende de 09:00 a 13:00)
apiRouter.post('/admin/doctors/:id/special-hours', requireAuth, requireAdmin, (req, res) => {
  try {
    const doctorId = Number(req.params.id);
    const doctor = db.prepare('SELECT id FROM profesionales WHERE id = ?').get(doctorId);
    if (!doctor) return res.status(404).json({ error: 'Profesional no encontrado.' });

    const { fecha, horaInicio, horaFin, nota = '' } = req.body || {};
    if (!fecha || !/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
      return res.status(400).json({ error: 'Seleccioná una fecha válida.' });
    }
    if (!/^\d{2}:\d{2}$/.test(String(horaInicio || '')) || !/^\d{2}:\d{2}$/.test(String(horaFin || ''))) {
      return res.status(400).json({ error: 'Indicá hora de inicio y fin válidas.' });
    }
    if (horaInicio >= horaFin) {
      return res.status(400).json({ error: 'La hora de inicio debe ser menor a la de fin.' });
    }

    const r = db
      .prepare(
        `INSERT INTO horarios_especiales (profesional_id, fecha, hora_inicio, hora_fin, nota)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(doctorId, fecha, horaInicio, horaFin, String(nota || '').trim());

    res.status(201).json({
      ok: true,
      special: db.prepare('SELECT * FROM horarios_especiales WHERE id = ?').get(Number(r.lastInsertRowid)),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/admin/special-hours/:id', requireAuth, requireAdmin, (req, res) => {
  db.prepare('DELETE FROM horarios_especiales WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ============================================================
// SOLICITUDES DE HORARIOS DE PROFESIONALES (NUEVOS O CAMBIOS)
// ============================================================
apiRouter.post('/schedule-requests', (req, res) => {
  try {
    const {
      tipo = 'nuevo',
      profesionalId = null,
      nombre = '',
      matricula = '',
      especialidadId,
      nuevaEspecialidad = '',
      telefono = '',
      gmail = '',
      duracionTurnoMin = 30,
      obrasSociales = 'Particular',
      horarios = [],
      notas = '',
    } = req.body || {};

    let cleanName = String(nombre || '').trim();
    let resolvedSpecId = especialidadId ? Number(especialidadId) : null;

    if (tipo === 'cambio_horario' && profesionalId) {
      const existingDoc = getDoctorById(profesionalId);
      if (!existingDoc) return res.status(404).json({ error: 'Profesional no encontrado.' });
      cleanName = existingDoc.nombre;
      resolvedSpecId = existingDoc.especialidad_id;
    }

    if (!cleanName || cleanName.length < 3) {
      return res.status(400).json({ error: 'Ingresá tu nombre y apellido completo.' });
    }

    if ((!resolvedSpecId || Number.isNaN(resolvedSpecId)) && String(nuevaEspecialidad).trim()) {
      const spec = findOrCreateSpecialty({ nombre: nuevaEspecialidad, icono: '🩺' });
      resolvedSpecId = spec.id;
    }
    if (!resolvedSpecId) {
      return res.status(400).json({ error: 'Elegí tu especialidad médica.' });
    }

    if (!Array.isArray(horarios) || horarios.length === 0) {
      return res.status(400).json({
        error: 'Seleccioná al menos un día y horario disponible para poder armar tu agenda.',
      });
    }

    const cleanHorarios = [];
    for (const h of horarios) {
      const dia = Number(h.dia_semana);
      const ini = String(h.hora_inicio || '').trim();
      const fin = String(h.hora_fin || '').trim();
      if (Number.isNaN(dia) || dia < 0 || dia > 6 || !/^\d{2}:\d{2}$/.test(ini) || !/^\d{2}:\d{2}$/.test(fin) || ini >= fin) {
        return res.status(400).json({ error: `Horario inválido: ${ini} a ${fin}. Revisá las franjas.` });
      }
      cleanHorarios.push({ dia_semana: dia, hora_inicio: ini, hora_fin: fin });
    }

    const r = db
      .prepare(
        `INSERT INTO solicitudes_horarios
          (tipo, profesional_id, nombre, matricula, especialidad_id, telefono, gmail,
           duracion_turno_min, obras_sociales, horarios_json, notas, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pendiente')`
      )
      .run(
        tipo === 'cambio_horario' ? 'cambio_horario' : 'nuevo',
        profesionalId ? Number(profesionalId) : null,
        cleanName,
        String(matricula || '').trim(),
        resolvedSpecId,
        String(telefono || '').trim(),
        String(gmail || '').trim(),
        Number(duracionTurnoMin) || 30,
        String(obrasSociales || 'Particular').trim(),
        JSON.stringify(cleanHorarios),
        String(notas || '').trim()
      );

    res.status(201).json({
      ok: true,
      id: Number(r.lastInsertRowid),
      message: '¡Gracias! Tus días y horarios fueron enviados a la Administración de la clínica.',
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/admin/schedule-requests', requireAuth, requireAdmin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT s.*, e.nombre AS especialidad_nombre, e.icono AS especialidad_icono
       FROM solicitudes_horarios s
       JOIN especialidades e ON e.id = s.especialidad_id
       ORDER BY CASE WHEN s.estado = 'pendiente' THEN 0 ELSE 1 END, s.id DESC
       LIMIT 50`
    )
    .all()
    .map((r) => ({
      ...r,
      horarios: (() => {
        try {
          return JSON.parse(r.horarios_json);
        } catch {
          return [];
        }
      })(),
    }));
  res.json({ requests: rows });
});

apiRouter.post('/admin/schedule-requests/:id/approve', requireAuth, requireAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const reqRow = db
      .prepare(
        `SELECT s.*, e.nombre AS especialidad_nombre
         FROM solicitudes_horarios s
         JOIN especialidades e ON e.id = s.especialidad_id
         WHERE s.id = ?`
      )
      .get(id);
    if (!reqRow) return res.status(404).json({ error: 'Solicitud no encontrada.' });

    let horarios = [];
    try {
      horarios = JSON.parse(reqRow.horarios_json);
    } catch {
      horarios = [];
    }

    const consultorio = String(req.body?.consultorio || 'Consultorio a asignar').trim();
    let profId = reqRow.profesional_id;
    let createdUsername = '';
    let calendarAddUrl = '';

    if (reqRow.tipo === 'cambio_horario' && profId) {
      db.prepare('UPDATE profesionales SET duracion_turno_min = ? WHERE id = ?').run(
        reqRow.duracion_turno_min || 30,
        profId
      );
      db.prepare('DELETE FROM horarios_atencion WHERE profesional_id = ?').run(profId);
      const stmt = db.prepare(
        'INSERT INTO horarios_atencion (profesional_id, dia_semana, hora_inicio, hora_fin) VALUES (?, ?, ?, ?)'
      );
      for (const h of horarios) {
        stmt.run(profId, Number(h.dia_semana), h.hora_inicio, h.hora_fin);
      }
    } else {
      // Crear profesional nuevo con sus horarios exactos
      const ins = db
        .prepare(
          `INSERT INTO profesionales
            (nombre, especialidad_id, matricula, duracion_turno_min, consultorio, google_calendar_id, obras_sociales)
           VALUES (?, ?, ?, ?, ?, '', ?)`
        )
        .run(
          reqRow.nombre,
          reqRow.especialidad_id,
          reqRow.matricula || '',
          reqRow.duracion_turno_min || 30,
          consultorio,
          reqRow.obras_sociales || 'Particular'
        );
      profId = Number(ins.lastInsertRowid);

      const stmt = db.prepare(
        'INSERT INTO horarios_atencion (profesional_id, dia_semana, hora_inicio, hora_fin) VALUES (?, ?, ?, ?)'
      );
      for (const h of horarios) {
        stmt.run(profId, Number(h.dia_semana), h.hora_inicio, h.hora_fin);
      }

      // Crear usuario automáticamente para que el médico administre su propia agenda
      const slugBase = reqRow.nombre
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .trim()
        .split(/\s+/);
      let uname = slugBase.length >= 2 ? `${slugBase[0]}.${slugBase[slugBase.length - 1]}` : slugBase[0] || `medico${profId}`;
      if (db.prepare('SELECT id FROM usuarios WHERE LOWER(username) = ?').get(uname)) {
        uname = `${uname}${profId}`;
      }
      db.prepare(
        `INSERT INTO usuarios (username, password_hash, nombre, rol, profesional_id)
         VALUES (?, ?, ?, 'profesional', ?)`
      ).run(uname, hashPassword('medico123'), reqRow.nombre, profId);
      createdUsername = uname;

      // Si Google Calendar está activo y el médico informó su Gmail (o la clínica pasó ownerEmail), crearle su calendario automáticamente
      const emailsToShare = [reqRow.gmail, req.body?.ownerEmail].filter((e) => e && String(e).includes('@'));
      if (isGoogleCalendarLive() && emailsToShare.length > 0) {
        try {
          const gcal = await createDoctorCalendar({
            summary: `Turnos - ${reqRow.nombre} (${reqRow.especialidad_nombre})`,
            description: `Agenda de ${reqRow.nombre} - ${config.clinic.name}`,
            shareWithEmails: [...new Set(emailsToShare)],
          });
          db.prepare('UPDATE profesionales SET google_calendar_id = ? WHERE id = ?').run(
            gcal.calendarId,
            profId
          );
          calendarAddUrl = gcal.addUrl;
        } catch (err) {
          console.error('[Approve Schedule Request] GCal warning:', err.message);
        }
      }
    }

    db.prepare("UPDATE solicitudes_horarios SET estado = 'aprobada', profesional_id = ? WHERE id = ?").run(
      profId,
      id
    );

    res.json({
      ok: true,
      doctor: getDoctorById(profId),
      createdUsername,
      defaultPassword: createdUsername ? 'medico123' : '',
      calendarAddUrl,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/admin/schedule-requests/:id/reject', requireAuth, requireAdmin, (req, res) => {
  db.prepare("UPDATE solicitudes_horarios SET estado = 'rechazada' WHERE id = ?").run(
    Number(req.params.id)
  );
  res.json({ ok: true });
});

apiRouter.get('/admin/blocks', requireAuth, (req, res) => {
  const blocks =
    req.user.rol === 'profesional'
      ? db
          .prepare(
            `SELECT b.*, p.nombre AS profesional_nombre
             FROM bloqueos_agenda b
             JOIN profesionales p ON p.id = b.profesional_id
             WHERE b.profesional_id = ?
             ORDER BY b.fecha ASC, b.hora_inicio ASC`
          )
          .all(req.user.profesional_id)
      : db
          .prepare(
            `SELECT b.*, p.nombre AS profesional_nombre
             FROM bloqueos_agenda b
             JOIN profesionales p ON p.id = b.profesional_id
             ORDER BY b.fecha ASC, b.hora_inicio ASC`
          )
          .all();
  res.json({ blocks });
});

apiRouter.post('/admin/blocks', requireAuth, async (req, res) => {
  try {
    const { profesionalId, fecha, horaInicio = '00:00', horaFin = '23:59', motivo = 'No atiende' } = req.body;
    const targetDoctorId =
      req.user.rol === 'profesional' ? req.user.profesional_id : profesionalId;
    const doctor = getDoctorById(targetDoctorId);
    if (!doctor) return res.status(404).json({ error: 'Profesional no encontrado.' });
    if (!fecha) return res.status(400).json({ error: 'Indicá la fecha a bloquear.' });

    const gcal = await createBlockEvent(doctor.google_calendar_id, {
      fecha,
      hora_inicio: horaInicio,
      hora_fin: horaFin,
      motivo,
    });

    const resInsert = db
      .prepare(
        `INSERT INTO bloqueos_agenda (profesional_id, fecha, hora_inicio, hora_fin, motivo, google_event_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(doctor.id, fecha, horaInicio, horaFin, motivo, gcal.eventId);

    const block = db
      .prepare('SELECT * FROM bloqueos_agenda WHERE id = ?')
      .get(Number(resInsert.lastInsertRowid));

    res.status(201).json({ block, googleMode: gcal.mode });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/admin/blocks/:id', requireAuth, async (req, res) => {
  try {
    const block = db
      .prepare(
        `SELECT b.*, p.google_calendar_id
         FROM bloqueos_agenda b
         JOIN profesionales p ON p.id = b.profesional_id
         WHERE b.id = ?`
      )
      .get(Number(req.params.id));

    if (!block) return res.status(404).json({ error: 'Bloqueo no encontrado.' });
    if (req.user.rol === 'profesional' && block.profesional_id !== req.user.profesional_id) {
      return res.status(403).json({ error: 'Solo podés eliminar bloqueos de tu propia agenda.' });
    }

    await deleteAppointmentEvent(block.google_calendar_id, block.google_event_id);
    db.prepare('DELETE FROM bloqueos_agenda WHERE id = ?').run(block.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Resumen rápido de métricas para el dashboard (scoped por rol)
apiRouter.get('/admin/stats', requireAuth, (req, res) => {
  const now = getClinicNow();
  const isProf = req.user.rol === 'profesional';
  const pid = req.user.profesional_id;

  const totalHoy = isProf
    ? db
        .prepare("SELECT COUNT(*) AS c FROM turnos WHERE fecha = ? AND estado != 'cancelado' AND profesional_id = ?")
        .get(now.date, pid).c
    : db
        .prepare("SELECT COUNT(*) AS c FROM turnos WHERE fecha = ? AND estado != 'cancelado'")
        .get(now.date).c;

  const confirmados = isProf
    ? db
        .prepare("SELECT COUNT(*) AS c FROM turnos WHERE fecha >= ? AND estado = 'confirmado' AND profesional_id = ?")
        .get(now.date, pid).c
    : db
        .prepare("SELECT COUNT(*) AS c FROM turnos WHERE fecha >= ? AND estado = 'confirmado'")
        .get(now.date).c;

  const pendientes = isProf
    ? db
        .prepare("SELECT COUNT(*) AS c FROM turnos WHERE fecha >= ? AND estado = 'reservado' AND profesional_id = ?")
        .get(now.date, pid).c
    : db
        .prepare("SELECT COUNT(*) AS c FROM turnos WHERE fecha >= ? AND estado = 'reservado'")
        .get(now.date).c;

  const cancelados = isProf
    ? db
        .prepare("SELECT COUNT(*) AS c FROM turnos WHERE estado = 'cancelado' AND profesional_id = ?")
        .get(pid).c
    : db
        .prepare("SELECT COUNT(*) AS c FROM turnos WHERE estado = 'cancelado'")
        .get().c;

  const profesionalesActivos = isProf
    ? 1
    : db.prepare('SELECT COUNT(*) AS c FROM profesionales WHERE activo = 1').get().c;

  res.json({
    totalHoy,
    confirmados,
    pendientes,
    cancelados,
    profesionalesActivos,
    fechaHoy: now.date,
  });
});

// ============================================================
// CONFIGURACIÓN Y PRUEBA DE GOOGLE CALENDAR EN VIVO (SOLO ADMIN)
// ============================================================
apiRouter.get('/admin/google/status', requireAuth, (_req, res) => {
  res.json(getGoogleConnectionInfo());
});

apiRouter.post('/admin/google/credentials', requireAuth, requireAdmin, (req, res) => {
  try {
    const { serviceAccountJson } = req.body;
    if (!serviceAccountJson) {
      return res.status(400).json({ error: 'Falta el contenido del archivo JSON de Google.' });
    }
    const info = saveServiceAccountJson(serviceAccountJson);
    res.json({ ok: true, ...info });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/admin/google/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { calendarId } = req.body;
    const result = await testCalendarAccess(calendarId);
    if (!result.ok) {
      return res.status(400).json(result);
    }
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// Crea automáticamente un Google Calendar para un profesional y lo comparte con el Gmail indicado
apiRouter.post('/admin/doctors/:id/create-calendar', requireAuth, requireAdmin, async (req, res) => {
  try {
    const doctor = getDoctorById(req.params.id);
    if (!doctor) return res.status(404).json({ error: 'Profesional no encontrado.' });

    const { ownerEmail = '' } = req.body;
    const cleanEmail = String(ownerEmail || '').trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({
        error: 'Escribí tu email de Gmail (donde querés ver los calendarios de la clínica).',
      });
    }

    const created = await createDoctorCalendar({
      summary: `Turnos - ${doctor.nombre} (${doctor.especialidad_nombre})`,
      description: `Agenda automática de ${doctor.nombre} - ${config.clinic.name} (${doctor.consultorio})`,
      shareWithEmails: [cleanEmail],
    });

    db.prepare('UPDATE profesionales SET google_calendar_id = ? WHERE id = ?').run(
      created.calendarId,
      doctor.id
    );

    res.json({
      ok: true,
      doctorId: doctor.id,
      doctorName: doctor.nombre,
      ...created,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Crea automáticamente un Google Calendar para TODOS los profesionales que aún no tienen uno real
apiRouter.post('/admin/google/create-all-calendars', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { ownerEmail = '', forceAll = false } = req.body;
    const cleanEmail = String(ownerEmail || '').trim();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return res.status(400).json({
        error: 'Escribí tu email de Gmail (ej: tuclinica@gmail.com) para compartirte los calendarios.',
      });
    }

    const doctors = db
      .prepare(
        `SELECT p.*, e.nombre AS especialidad_nombre
         FROM profesionales p
         JOIN especialidades e ON e.id = p.especialidad_id
         WHERE p.activo = 1
         ORDER BY p.id ASC`
      )
      .all();

    const results = [];
    for (const doc of doctors) {
      const alreadyHasRealGcal =
        doc.google_calendar_id &&
        doc.google_calendar_id.includes('@group.calendar.google.com');

      if (!forceAll && alreadyHasRealGcal) {
        results.push({
          doctorId: doc.id,
          doctorName: doc.nombre,
          skipped: true,
          calendarId: doc.google_calendar_id,
          addUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(doc.google_calendar_id)}`,
        });
        continue;
      }

      const created = await createDoctorCalendar({
        summary: `Turnos - ${doc.nombre} (${doc.especialidad_nombre})`,
        description: `Agenda automática de ${doc.nombre} - ${config.clinic.name} (${doc.consultorio})`,
        shareWithEmails: [cleanEmail],
      });

      db.prepare('UPDATE profesionales SET google_calendar_id = ? WHERE id = ?').run(
        created.calendarId,
        doc.id
      );

      results.push({
        doctorId: doc.id,
        doctorName: doc.nombre,
        skipped: false,
        ...created,
      });
    }

    res.json({
      ok: true,
      ownerEmail: cleanEmail,
      total: results.length,
      createdCount: results.filter((r) => !r.skipped).length,
      results,
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// Actualizar nombre, dirección y teléfono de la clínica desde /admin
apiRouter.patch('/admin/clinic', requireAuth, requireAdmin, (req, res) => {
  try {
    const { name, address, phone } = req.body;
    const clinic = saveClinicSettings({ name, address, phone });
    res.json({ ok: true, clinic });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
// GESTIÓN DE USUARIOS (ADMIN GENERAL + ADMINISTRADORES DE AGENDA)
// ============================================================
apiRouter.get('/admin/users', requireAuth, requireAdmin, (_req, res) => {
  const users = db
    .prepare(
      `SELECT u.id, u.username, u.nombre, u.rol, u.profesional_id, u.activo, u.created_at,
              p.nombre AS profesional_nombre
       FROM usuarios u
       LEFT JOIN profesionales p ON p.id = u.profesional_id
       ORDER BY u.rol ASC, u.nombre ASC`
    )
    .all();
  res.json({ users });
});

apiRouter.post('/admin/users', requireAuth, requireAdmin, (req, res) => {
  try {
    const { username, password, nombre, rol = 'profesional', profesionalId = null } = req.body;
    const cleanUser = String(username || '').trim().toLowerCase();
    const cleanName = String(nombre || '').trim();
    if (!cleanUser || cleanUser.length < 3) {
      return res.status(400).json({ error: 'El usuario debe tener al menos 3 caracteres.' });
    }
    if (!password || String(password).length < 4) {
      return res.status(400).json({ error: 'La contraseña debe tener al menos 4 caracteres.' });
    }
    if (!['admin', 'profesional'].includes(rol)) {
      return res.status(400).json({ error: 'Rol inválido.' });
    }
    if (rol === 'profesional' && !profesionalId) {
      return res.status(400).json({ error: 'Elegí a qué profesional corresponde esta agenda.' });
    }

    const resInsert = db
      .prepare(
        `INSERT INTO usuarios (username, password_hash, nombre, rol, profesional_id)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        cleanUser,
        hashPassword(password),
        cleanName || cleanUser,
        rol,
        rol === 'profesional' ? Number(profesionalId) : null
      );

    res.status(201).json({ user: getUserById(Number(resInsert.lastInsertRowid)) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'Ese nombre de usuario ya existe. Elegí otro.' });
    }
    res.status(400).json({ error: err.message });
  }
});

apiRouter.patch('/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = db.prepare('SELECT * FROM usuarios WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ error: 'Usuario no encontrado.' });

    const { nombre, password, rol, profesionalId, activo } = req.body;
    const nextRol = rol && ['admin', 'profesional'].includes(rol) ? rol : current.rol;
    const nextProfId =
      nextRol === 'admin'
        ? null
        : profesionalId !== undefined
        ? Number(profesionalId)
        : current.profesional_id;
    const nextHash =
      password && String(password).length >= 4
        ? hashPassword(password)
        : current.password_hash;
    const nextActivo = activo !== undefined ? (activo ? 1 : 0) : current.activo;

    if (id === req.user.id && (!nextActivo || nextRol !== 'admin')) {
      return res
        .status(400)
        .json({ error: 'No podés desactivar tu propia cuenta de Administrador General.' });
    }

    db.prepare(
      `UPDATE usuarios
       SET nombre = ?, password_hash = ?, rol = ?, profesional_id = ?, activo = ?
       WHERE id = ?`
    ).run(
      nombre ? String(nombre).trim() : current.nombre,
      nextHash,
      nextRol,
      nextProfId,
      nextActivo,
      id
    );

    res.json({ user: getUserById(id) });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/admin/users/:id', requireAuth, requireAdmin, (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) {
    return res.status(400).json({ error: 'No podés eliminar tu propio usuario.' });
  }
  db.prepare('DELETE FROM usuarios WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ============================================================
// HISTORIA CLÍNICA / REGISTRO DE ATENCIONES POR PACIENTE
// ============================================================
apiRouter.get('/panel/patients/search', requireAuth, (req, res) => {
  const q = String(req.query.q || '').trim();
  const isProf = req.user.rol === 'profesional';

  let rows;
  if (q) {
    const like = `%${q}%`;
    rows = isProf
      ? db
          .prepare(
            `SELECT DISTINCT pa.*,
              (SELECT COUNT(*) FROM atenciones_clinicas ac WHERE ac.paciente_id = pa.id) AS total_atenciones
             FROM pacientes pa
             LEFT JOIN turnos t ON t.paciente_id = pa.id
             LEFT JOIN atenciones_clinicas ac2 ON ac2.paciente_id = pa.id
             WHERE (t.profesional_id = ? OR ac2.profesional_id = ?)
               AND (pa.dni LIKE ? OR LOWER(pa.nombre_completo) LIKE LOWER(?))
             ORDER BY pa.nombre_completo ASC
             LIMIT 40`
          )
          .all(req.user.profesional_id, req.user.profesional_id, like, like)
      : db
          .prepare(
            `SELECT pa.*,
              (SELECT COUNT(*) FROM atenciones_clinicas ac WHERE ac.paciente_id = pa.id) AS total_atenciones
             FROM pacientes pa
             WHERE pa.dni LIKE ? OR LOWER(pa.nombre_completo) LIKE LOWER(?)
             ORDER BY pa.nombre_completo ASC
             LIMIT 40`
          )
          .all(like, like);
  } else {
    rows = isProf
      ? db
          .prepare(
            `SELECT DISTINCT pa.*,
              (SELECT COUNT(*) FROM atenciones_clinicas ac WHERE ac.paciente_id = pa.id) AS total_atenciones
             FROM pacientes pa
             LEFT JOIN turnos t ON t.paciente_id = pa.id
             LEFT JOIN atenciones_clinicas ac2 ON ac2.paciente_id = pa.id
             WHERE t.profesional_id = ? OR ac2.profesional_id = ?
             ORDER BY pa.updated_at DESC
             LIMIT 30`
          )
          .all(req.user.profesional_id, req.user.profesional_id)
      : db
          .prepare(
            `SELECT pa.*,
              (SELECT COUNT(*) FROM atenciones_clinicas ac WHERE ac.paciente_id = pa.id) AS total_atenciones
             FROM pacientes pa
             ORDER BY pa.updated_at DESC
             LIMIT 30`
          )
          .all();
  }

  res.json({ patients: rows });
});

apiRouter.get('/panel/patients/:pacienteId/records', requireAuth, (req, res) => {
  const pacienteId = Number(req.params.pacienteId);
  const patient = db.prepare('SELECT * FROM pacientes WHERE id = ?').get(pacienteId);
  if (!patient) return res.status(404).json({ error: 'Paciente no encontrado.' });

  const records = db
    .prepare(
      `SELECT ac.*,
              COALESCE(pr.nombre, u.nombre, 'Profesional') AS profesional_nombre,
              COALESCE(e.nombre, '') AS especialidad_nombre
       FROM atenciones_clinicas ac
       LEFT JOIN profesionales pr ON pr.id = ac.profesional_id
       LEFT JOIN especialidades e ON e.id = pr.especialidad_id
       LEFT JOIN usuarios u ON u.id = ac.usuario_id
       WHERE ac.paciente_id = ?
       ORDER BY ac.fecha_atencion DESC, ac.id DESC`
    )
    .all(pacienteId);

  res.json({ patient, records });
});

apiRouter.post('/panel/records', requireAuth, (req, res) => {
  try {
    const {
      pacienteId,
      turnoId = null,
      profesionalId = null,
      motivoConsulta = '',
      signosVitales = '',
      diagnostico = '',
      evolucion = '',
      indicaciones = '',
      recetaPlataforma = '',
      recetaCodigo = '',
      proximoControl = '',
      abonoCopago = false,
      montoCopago = 0,
      medioPago = '',
      marcarAsistio = false,
    } = req.body || {};

    const cleanPacienteId = Number(pacienteId);
    if (!cleanPacienteId) {
      return res.status(400).json({ error: 'Falta identificar el paciente.' });
    }
    const patient = db.prepare('SELECT * FROM pacientes WHERE id = ?').get(cleanPacienteId);
    if (!patient) return res.status(404).json({ error: 'Paciente no encontrado.' });

    const cleanEvolucion = String(evolucion || '').trim();
    if (cleanEvolucion.length < 3) {
      return res.status(400).json({
        error: 'Escribí la descripción o evolución clínica de la atención.',
      });
    }

    const resolvedProfId =
      req.user.rol === 'profesional'
        ? req.user.profesional_id
        : profesionalId
        ? Number(profesionalId)
        : null;

    const now = getClinicNow();
    const fechaAtencion = `${now.date} ${now.time}`;
    const paidCopago = Boolean(abonoCopago) ? 1 : 0;
    const cleanMonto = paidCopago ? Math.max(0, Number(montoCopago) || 0) : 0;

    const resInsert = db
      .prepare(
        `INSERT INTO atenciones_clinicas
          (paciente_id, profesional_id, turno_id, usuario_id, fecha_atencion,
           motivo_consulta, signos_vitales, diagnostico, evolucion,
           indicaciones, receta_plataforma, receta_codigo, proximo_control,
           abono_copago, monto_copago, medio_pago)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        cleanPacienteId,
        resolvedProfId,
        turnoId ? Number(turnoId) : null,
        req.user.id,
        fechaAtencion,
        String(motivoConsulta || '').trim(),
        String(signosVitales || '').trim(),
        String(diagnostico || '').trim(),
        cleanEvolucion,
        String(indicaciones || '').trim(),
        String(recetaPlataforma || '').trim(),
        String(recetaCodigo || '').trim(),
        String(proximoControl || '').trim(),
        paidCopago,
        cleanMonto,
        paidCopago ? String(medioPago || '').trim() : ''
      );

    if (marcarAsistio && turnoId) {
      db.prepare(
        "UPDATE turnos SET estado = 'asistio', updated_at = CURRENT_TIMESTAMP WHERE id = ?"
      ).run(Number(turnoId));
    }

    const record = db
      .prepare(
        `SELECT ac.*,
                COALESCE(pr.nombre, u.nombre, 'Profesional') AS profesional_nombre,
                COALESCE(e.nombre, '') AS especialidad_nombre
         FROM atenciones_clinicas ac
         LEFT JOIN profesionales pr ON pr.id = ac.profesional_id
         LEFT JOIN especialidades e ON e.id = pr.especialidad_id
         LEFT JOIN usuarios u ON u.id = ac.usuario_id
         WHERE ac.id = ?`
      )
      .get(Number(resInsert.lastInsertRowid));

    res.status(201).json({ ok: true, record });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/panel/records/:id', requireAuth, (req, res) => {
  const id = Number(req.params.id);
  const rec = db.prepare('SELECT * FROM atenciones_clinicas WHERE id = ?').get(id);
  if (!rec) return res.status(404).json({ error: 'Registro clínico no encontrado.' });
  if (req.user.rol !== 'admin' && rec.usuario_id !== req.user.id) {
    return res.status(403).json({ error: 'Solo el autor o el Administrador pueden eliminar este registro.' });
  }
  db.prepare('DELETE FROM atenciones_clinicas WHERE id = ?').run(id);
  res.json({ ok: true });
});

// ============================================================
// CENTRAL DE RECETARIOS ELECTRÓNICOS (ReNaPDiS / OBRAS SOCIALES)
// ============================================================
apiRouter.get('/panel/recetarios', requireAuth, (req, res) => {
  const cobertura = String(req.query.cobertura || '').trim().toLowerCase();
  const platforms = listRecetarios().map((p) => {
    const covList = String(p.coberturas || '')
      .toLowerCase()
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    const exactMatch =
      cobertura &&
      covList.some((c) => c !== 'todas' && (c.includes(cobertura) || cobertura.includes(c)));
    const genericMatch = cobertura && covList.includes('todas') && p.categoria === 'ReNaPDiS';

    return {
      ...p,
      recommended: Boolean(exactMatch || genericMatch),
      exactMatch: Boolean(exactMatch),
    };
  });

  if (cobertura) {
    platforms.sort((a, b) => {
      if (a.exactMatch !== b.exactMatch) return a.exactMatch ? -1 : 1;
      if (a.recommended !== b.recommended) return a.recommended ? -1 : 1;
      return a.orden - b.orden;
    });
  }

  res.json({ recetarios: platforms });
});

apiRouter.post('/admin/recetarios', requireAuth, requireAdmin, (req, res) => {
  try {
    const recetario = addRecetario(req.body || {});
    res.status(201).json({ recetario, recetarios: listRecetarios() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/admin/recetarios/:id', requireAuth, requireAdmin, (req, res) => {
  try {
    removeRecetario(req.params.id);
    res.json({ ok: true, recetarios: listRecetarios() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================
// CONFIGURACIÓN Y PRUEBA DE WHATSAPP REAL (QR SÚPER FÁCIL + META)
// ============================================================
apiRouter.get('/admin/whatsapp/qr/status', requireAuth, requireAdmin, (_req, res) => {
  res.json(getQrWhatsAppStatus());
});

apiRouter.post('/admin/whatsapp/qr/connect', requireAuth, requireAdmin, async (req, res) => {
  try {
    const forceNew = Boolean(req.body?.forceNew);
    const st = await startQrWhatsApp({ forceNew });
    res.json({ ok: true, ...st });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

apiRouter.post('/admin/whatsapp/qr/disconnect', requireAuth, requireAdmin, async (_req, res) => {
  try {
    const st = await disconnectQrWhatsApp({ clearSession: true });
    res.json({ ok: true, ...st });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

apiRouter.get('/admin/whatsapp/status', requireAuth, requireAdmin, (_req, res) => {
  res.json(getWhatsAppConnectionInfo());
});

apiRouter.post('/admin/whatsapp/config', requireAuth, requireAdmin, (req, res) => {
  try {
    const { accessToken, phoneNumberId, verifyToken, reminderTemplate, reminderLang } = req.body || {};
    if (!phoneNumberId && !config.whatsapp.phoneNumberId) {
      return res.status(400).json({ error: 'Ingresá el Identificador de número de teléfono (Phone Number ID).' });
    }
    if (!accessToken && !config.whatsapp.accessToken) {
      return res.status(400).json({ error: 'Ingresá el Token de acceso de Meta.' });
    }
    saveWhatsAppSettings({
      accessToken,
      phoneNumberId,
      verifyToken,
      reminderTemplate,
      reminderLang,
    });
    res.json({ ok: true, ...getWhatsAppConnectionInfo() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/admin/whatsapp/disconnect', requireAuth, requireAdmin, (_req, res) => {
  clearWhatsAppSettings();
  res.json({ ok: true, ...getWhatsAppConnectionInfo() });
});

apiRouter.post('/admin/whatsapp/test', requireAuth, requireAdmin, async (req, res) => {
  try {
    const { toPhone, mode = 'hello_world' } = req.body || {};
    const result = await sendTestWhatsAppMessage(toPhone, mode);
    if (!result.sent) {
      return res.status(400).json({ ok: false, error: result.error });
    }
    res.json({
      ok: true,
      message: `¡Mensaje real enviado a ${toPhone}! Revisá el WhatsApp de tu celular.`,
    });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ============================================================
// BASE DE DATOS COMPLETA (PACIENTES, PROFESIONALES, COPAGOS) + EXCEL
// ============================================================
apiRouter.get('/panel/db/patients', requireAuth, (req, res) => {
  const { q = '', obraSocial = '' } = req.query;
  const patients = queryPatientsDatabase({ q, obraSocial });
  res.json({ patients });
});

apiRouter.post('/panel/db/patients', requireAuth, (req, res) => {
  try {
    const {
      nombreCompleto = '',
      dni = '',
      fechaNacimiento = '',
      obraSocial = 'Particular',
      nroAfiliado = '',
      domicilio = '',
      localidad = '',
      telefonoWhatsapp = '',
      email = '',
    } = req.body || {};

    const cleanDni = normalizeDni(dni);
    const cleanName = String(nombreCompleto || '').trim();
    const cleanPhone = normalizePhone(telefonoWhatsapp) || String(telefonoWhatsapp || '').trim();
    if (cleanDni.length < 6) return res.status(400).json({ error: 'Ingresá un DNI válido.' });
    if (cleanName.length < 3) return res.status(400).json({ error: 'Ingresá Nombre y Apellido.' });

    const existing = db.prepare('SELECT id FROM pacientes WHERE dni = ?').get(cleanDni);
    if (existing) {
      db.prepare(
        `UPDATE pacientes
         SET nombre_completo = ?, fecha_nacimiento = ?, obra_social = ?, nro_afiliado = ?,
             domicilio = ?, localidad = ?, telefono_whatsapp = ?, email = ?, updated_at = CURRENT_TIMESTAMP
         WHERE id = ?`
      ).run(
        cleanName,
        String(fechaNacimiento || '').trim(),
        String(obraSocial || 'Particular').trim() || 'Particular',
        String(nroAfiliado || '').trim(),
        String(domicilio || '').trim(),
        String(localidad || '').trim(),
        cleanPhone,
        String(email || '').trim(),
        existing.id
      );
      return res.json({ patient: db.prepare('SELECT * FROM pacientes WHERE id = ?').get(existing.id) });
    }

    const r = db
      .prepare(
        `INSERT INTO pacientes
          (dni, nombre_completo, fecha_nacimiento, obra_social, nro_afiliado, domicilio, localidad, telefono_whatsapp, email)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        cleanDni,
        cleanName,
        String(fechaNacimiento || '').trim(),
        String(obraSocial || 'Particular').trim() || 'Particular',
        String(nroAfiliado || '').trim(),
        String(domicilio || '').trim(),
        String(localidad || '').trim(),
        cleanPhone,
        String(email || '').trim()
      );

    res.status(201).json({
      patient: db.prepare('SELECT * FROM pacientes WHERE id = ?').get(Number(r.lastInsertRowid)),
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.patch('/panel/db/patients/:id', requireAuth, (req, res) => {
  try {
    const id = Number(req.params.id);
    const current = db.prepare('SELECT * FROM pacientes WHERE id = ?').get(id);
    if (!current) return res.status(404).json({ error: 'Paciente no encontrado.' });

    const {
      nombreCompleto,
      dni,
      fechaNacimiento,
      obraSocial,
      nroAfiliado,
      domicilio,
      localidad,
      telefonoWhatsapp,
      email,
    } = req.body || {};

    const nextDni = dni !== undefined ? normalizeDni(dni) : current.dni;
    if (nextDni.length < 6) return res.status(400).json({ error: 'DNI inválido.' });

    db.prepare(
      `UPDATE pacientes
       SET dni = ?, nombre_completo = ?, fecha_nacimiento = ?, obra_social = ?, nro_afiliado = ?,
           domicilio = ?, localidad = ?, telefono_whatsapp = ?, email = ?, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    ).run(
      nextDni,
      nombreCompleto !== undefined && String(nombreCompleto).trim()
        ? String(nombreCompleto).trim()
        : current.nombre_completo,
      fechaNacimiento !== undefined ? String(fechaNacimiento).trim() : current.fecha_nacimiento || '',
      obraSocial !== undefined && String(obraSocial).trim()
        ? String(obraSocial).trim()
        : current.obra_social,
      nroAfiliado !== undefined ? String(nroAfiliado).trim() : current.nro_afiliado || '',
      domicilio !== undefined ? String(domicilio).trim() : current.domicilio || '',
      localidad !== undefined ? String(localidad).trim() : current.localidad || '',
      telefonoWhatsapp !== undefined
        ? normalizePhone(telefonoWhatsapp) || String(telefonoWhatsapp).trim()
        : current.telefono_whatsapp,
      email !== undefined ? String(email).trim() : current.email || '',
      id
    );

    res.json({ patient: db.prepare('SELECT * FROM pacientes WHERE id = ?').get(id) });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(400).json({ error: 'Ya existe otro paciente con ese DNI.' });
    }
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/admin/db/professionals', requireAuth, requireAdmin, (req, res) => {
  const { q = '' } = req.query;
  const professionals = queryProfessionalsDatabase({ q });
  res.json({ professionals });
});

apiRouter.get('/panel/db/attentions', requireAuth, (req, res) => {
  const { desde = '', hasta = '', profesionalId = '', obraSocial = '', soloCopago = '', q = '' } = req.query;
  const scopedProfId =
    req.user.rol === 'profesional' ? req.user.profesional_id : profesionalId || null;

  const report = queryAttentionsReport({
    desde,
    hasta,
    profesionalId: scopedProfId,
    obraSocial,
    soloCopago: soloCopago === 'true',
    q,
  });
  res.json(report);
});

apiRouter.get('/panel/export/excel', requireAuth, async (req, res) => {
  try {
    const {
      type = 'completo',
      desde = '',
      hasta = '',
      profesionalId = '',
      obraSocial = '',
      soloCopago = '',
      q = '',
    } = req.query;

    const isProf = req.user.rol === 'profesional';
    // Un médico solo puede exportar sus propias atenciones; el Admin puede exportar todo
    const effectiveType = isProf ? 'atenciones' : type;
    const filters = {
      desde,
      hasta,
      profesionalId: isProf ? req.user.profesional_id : profesionalId || null,
      obraSocial,
      soloCopago: soloCopago === 'true',
      q,
    };

    const buffer = await buildExcelReportBuffer(effectiveType, filters);
    const today = getClinicNow().date;
    const fileLabel =
      effectiveType === 'pacientes'
        ? 'Base_Pacientes'
        : effectiveType === 'profesionales'
        ? 'Base_Profesionales'
        : effectiveType === 'atenciones'
        ? 'Reporte_Atenciones_Copagos'
        : 'Reporte_Completo_Clinica';

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileLabel}_${today}.xlsx"`
    );
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Detalle de turno puntual (requiere sesión)
apiRouter.get('/appointments/:id', requireAuth, (req, res) => {
  const appt = getAppointmentById(req.params.id);
  if (!appt) return res.status(404).json({ error: 'Turno no encontrado.' });
  if (req.user.rol === 'profesional' && appt.profesional_id !== req.user.profesional_id) {
    return res.status(403).json({ error: 'No tenés permiso para ver este turno.' });
  }
  res.json({ appointment: appt });
});
