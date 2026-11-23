import fs from 'node:fs';
import { google } from 'googleapis';
import { config } from '../config.js';
import { toClinicIso, timeToMinutes } from '../utils/datetime.js';

/**
 * Colores oficiales de Google Calendar:
 *  '5'  = Banana (Amarillo) -> Reservado (sin confirmar aún)
 *  '10' = Basil (Verde)     -> Confirmado por el paciente
 *  '11' = Tomato (Rojo)     -> Bloqueo / Ausencia del profesional
 */
const GCAL_COLORS = {
  reservado: '5',
  confirmado: '10',
  bloqueado: '11',
};

let cachedCalendarClient = null;

function getCalendarClient() {
  if (!config.google.isConfigured) return null;
  if (cachedCalendarClient) return cachedCalendarClient;

  const scopes = ['https://www.googleapis.com/auth/calendar'];
  const keyFile = config.google.resolvedKeyFile;

  const auth = keyFile
    ? new google.auth.GoogleAuth({
        keyFile,
        scopes,
      })
    : new google.auth.JWT({
        email: config.google.serviceAccountEmail,
        key: config.google.privateKey,
        scopes,
      });

  cachedCalendarClient = google.calendar({ version: 'v3', auth });
  return cachedCalendarClient;
}

export function isGoogleCalendarLive() {
  return config.google.isConfigured;
}

export function getGoogleConnectionInfo() {
  const keyFile = config.google.resolvedKeyFile;
  let serviceAccountEmail = config.google.serviceAccountEmail || '';

  if (keyFile) {
    try {
      const parsed = JSON.parse(fs.readFileSync(keyFile, 'utf8'));
      serviceAccountEmail = parsed.client_email || serviceAccountEmail;
    } catch {
      // ignore parse error
    }
  }

  return {
    configured: config.google.isConfigured,
    mode: config.google.isConfigured ? 'live' : 'demo',
    serviceAccountEmail,
    keyFileLoaded: Boolean(keyFile),
  };
}

export function saveServiceAccountJson(rawJson) {
  let parsed = rawJson;
  if (typeof rawJson === 'string') {
    try {
      parsed = JSON.parse(rawJson);
    } catch {
      throw new Error('El archivo no es un JSON válido.');
    }
  }

  if (
    !parsed ||
    parsed.type !== 'service_account' ||
    !parsed.client_email ||
    !parsed.private_key
  ) {
    throw new Error(
      'Este JSON no parece una clave de Cuenta de Servicio de Google (debe incluir type: "service_account", client_email y private_key).'
    );
  }

  fs.writeFileSync(
    config.google.defaultKeyFilePath,
    JSON.stringify(parsed, null, 2),
    'utf8'
  );
  cachedCalendarClient = null; // Recargar cliente en caliente
  return getGoogleConnectionInfo();
}

export async function testCalendarAccess(calendarId) {
  const info = getGoogleConnectionInfo();
  if (!info.configured) {
    return {
      ok: false,
      error: 'Primero cargá el archivo JSON de la Cuenta de Servicio de Google.',
    };
  }
  if (!calendarId || !calendarId.trim()) {
    return {
      ok: false,
      error: 'Ingresá un Google Calendar ID para probar.',
    };
  }

  const client = getCalendarClient();
  try {
    const cal = await client.calendars.get({ calendarId: calendarId.trim() });
    // Verificamos también permiso de lectura de eventos
    await client.events.list({
      calendarId: calendarId.trim(),
      maxResults: 1,
      singleEvents: true,
    });
    return {
      ok: true,
      calendarSummary: cal.data.summary || calendarId.trim(),
      timeZone: cal.data.timeZone || '',
      message: `Conectado correctamente al calendario "${cal.data.summary || calendarId.trim()}".`,
    };
  } catch (err) {
    const status = err.code || err.response?.status;
    if (status === 404 || status === 403) {
      return {
        ok: false,
        error: `Google rechazó el acceso a "${calendarId}". Verificá haber compartido ese calendario con "${info.serviceAccountEmail}" con permiso "Hacer cambios en eventos".`,
      };
    }
    return {
      ok: false,
      error: `Error de Google Calendar: ${err.message}`,
    };
  }
}

/**
 * Consulta intervalos ocupados en Google Calendar para un profesional en una fecha YYYY-MM-DD.
 * Si no hay credenciales configuradas, retorna [] (se usan las tablas locales de SQLite).
 */
export async function getBusyIntervalsFromGoogle(calendarId, dateStr) {
  const client = getCalendarClient();
  if (!client || !calendarId) return [];

  try {
    const timeMin = toClinicIso(dateStr, '00:00');
    const timeMax = toClinicIso(dateStr, '23:59');

    const response = await client.events.list({
      calendarId,
      timeMin,
      timeMax,
      singleEvents: true,
      orderBy: 'startTime',
    });

    const items = response.data.items || [];
    const busy = [];

    for (const ev of items) {
      if (ev.status === 'cancelled') continue;
      if (ev.transparency === 'transparent') continue; // Evento marcado como "Disponible"

      // Evento de día completo (ej. Vacaciones / Congreso)
      if (ev.start?.date) {
        busy.push({
          startMinutes: 0,
          endMinutes: 24 * 60,
          summary: ev.summary || 'Ocupado',
          eventId: ev.id,
        });
        continue;
      }

      if (ev.start?.dateTime && ev.end?.dateTime) {
        const startLocal = extractLocalMinutes(ev.start.dateTime, dateStr, true);
        const endLocal = extractLocalMinutes(ev.end.dateTime, dateStr, false);
        if (endLocal > startLocal) {
          busy.push({
            startMinutes: startLocal,
            endMinutes: endLocal,
            summary: ev.summary || 'Ocupado',
            eventId: ev.id,
          });
        }
      }
    }

    return busy;
  } catch (err) {
    console.error(`[GoogleCalendar] Error consultando ${calendarId} (${dateStr}):`, err.message);
    return [];
  }
}

function extractLocalMinutes(isoString, targetDateStr, isStart) {
  const dt = new Date(isoString);
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.clinic.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(dt).map((p) => [p.type, p.value]));
  const evDate = `${parts.year}-${parts.month}-${parts.day}`;
  if (evDate < targetDateStr) return 0;
  if (evDate > targetDateStr) return 24 * 60;
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const mins = timeToMinutes(`${hour}:${parts.minute}`);
  return isStart ? mins : mins;
}

function buildEventPayload(appointment, status = 'reservado') {
  const prefix =
    status === 'confirmado'
      ? '✅ [CONFIRMADO]'
      : '⏳ [RESERVADO]';

  const summary = `${prefix} ${appointment.paciente_nombre} - DNI ${appointment.paciente_dni}`;
  const description = [
    `Código de turno: ${appointment.codigo}`,
    `Paciente: ${appointment.paciente_nombre}`,
    `DNI: ${appointment.paciente_dni}`,
    `WhatsApp: ${appointment.paciente_whatsapp}`,
    `Obra Social: ${appointment.obra_social || 'Particular'}`,
    `Especialidad: ${appointment.especialidad_nombre}`,
    `Profesional: ${appointment.profesional_nombre}`,
    `Consultorio: ${appointment.consultorio}`,
    `Canal: ${appointment.canal_origen === 'whatsapp' ? 'WhatsApp Bot' : 'Turnero Web'}`,
    `Estado: ${status.toUpperCase()}`,
  ].join('\n');

  return {
    summary,
    location: `${config.clinic.name} - ${appointment.consultorio} (${config.clinic.address})`,
    description,
    colorId: GCAL_COLORS[status] || GCAL_COLORS.reservado,
    start: {
      dateTime: toClinicIso(appointment.fecha, appointment.hora_inicio),
      timeZone: config.clinic.timezone,
    },
    end: {
      dateTime: toClinicIso(appointment.fecha, appointment.hora_fin),
      timeZone: config.clinic.timezone,
    },
  };
}

export async function createAppointmentEvent(calendarId, appointment) {
  const client = getCalendarClient();
  if (!client || !calendarId) {
    return {
      eventId: `demo-gcal-${appointment.codigo}`,
      mode: 'demo',
    };
  }

  try {
    const res = await client.events.insert({
      calendarId,
      requestBody: buildEventPayload(appointment, 'reservado'),
    });
    return {
      eventId: res.data.id,
      mode: 'live',
    };
  } catch (err) {
    console.error(`[GoogleCalendar] Error creando evento en ${calendarId}:`, err.message);
    return {
      eventId: `local-fallback-${appointment.codigo}`,
      mode: 'demo',
    };
  }
}

export async function markEventConfirmed(calendarId, eventId, appointment) {
  const client = getCalendarClient();
  if (!client || !calendarId || !eventId || eventId.startsWith('demo-') || eventId.startsWith('local-')) {
    return { updated: true, mode: 'demo' };
  }

  try {
    await client.events.patch({
      calendarId,
      eventId,
      requestBody: buildEventPayload(appointment, 'confirmado'),
    });
    return { updated: true, mode: 'live' };
  } catch (err) {
    console.error(`[GoogleCalendar] Error confirmando evento ${eventId}:`, err.message);
    return { updated: false, mode: 'live' };
  }
}

export async function rescheduleAppointmentEvent(calendarId, eventId, appointment) {
  const client = getCalendarClient();
  if (!client || !calendarId || !eventId || eventId.startsWith('demo-') || eventId.startsWith('local-')) {
    return { updated: true, mode: 'demo' };
  }

  try {
    await client.events.patch({
      calendarId,
      eventId,
      requestBody: buildEventPayload(appointment, appointment.estado || 'reservado'),
    });
    return { updated: true, mode: 'live' };
  } catch (err) {
    console.error(`[GoogleCalendar] Error reprogramando evento ${eventId}:`, err.message);
    return { updated: false, mode: 'live' };
  }
}

export async function deleteAppointmentEvent(calendarId, eventId) {
  const client = getCalendarClient();
  if (!client || !calendarId || !eventId || eventId.startsWith('demo-') || eventId.startsWith('local-')) {
    return { deleted: true, mode: 'demo' };
  }

  try {
    await client.events.delete({
      calendarId,
      eventId,
    });
    return { deleted: true, mode: 'live' };
  } catch (err) {
    console.error(`[GoogleCalendar] Error eliminando evento ${eventId}:`, err.message);
    return { deleted: false, mode: 'live' };
  }
}

export async function createBlockEvent(calendarId, block) {
  const client = getCalendarClient();
  if (!client || !calendarId) {
    return { eventId: `demo-block-${Date.now()}`, mode: 'demo' };
  }

  try {
    const res = await client.events.insert({
      calendarId,
      requestBody: {
        summary: `🔴 NO ATIENDE - ${block.motivo || 'Bloqueo de agenda'}`,
        colorId: GCAL_COLORS.bloqueado,
        start: {
          dateTime: toClinicIso(block.fecha, block.hora_inicio),
          timeZone: config.clinic.timezone,
        },
        end: {
          dateTime: toClinicIso(block.fecha, block.hora_fin),
          timeZone: config.clinic.timezone,
        },
      },
    });
    return { eventId: res.data.id, mode: 'live' };
  } catch (err) {
    console.error(`[GoogleCalendar] Error creando bloqueo en ${calendarId}:`, err.message);
    return { eventId: `local-block-${Date.now()}`, mode: 'demo' };
  }
}

/**
 * Crea automáticamente un Google Calendar dedicado para un profesional,
 * lo comparte con el email de la clínica (y/o el médico) para que lo vean en su Google Calendar,
 * y devuelve el Calendar ID real + el enlace directo para agregarlo en 1 clic.
 */
export async function createDoctorCalendar({
  summary,
  description = '',
  shareWithEmails = [],
}) {
  const client = getCalendarClient();
  if (!client) {
    throw new Error('Google Calendar no está conectado todavía. Subí primero el archivo JSON.');
  }

  const created = await client.calendars.insert({
    requestBody: {
      summary,
      description,
      timeZone: config.clinic.timezone,
    },
  });

  const calendarId = created.data.id;
  const sharedWith = [];
  const shareErrors = [];

  for (const rawEmail of shareWithEmails) {
    const email = String(rawEmail || '').trim();
    if (!email || !email.includes('@')) continue;
    try {
      await client.acl.insert({
        calendarId,
        sendNotifications: true,
        requestBody: {
          role: 'owner',
          scope: {
            type: 'user',
            value: email,
          },
        },
      });
      sharedWith.push(email);
    } catch (err) {
      shareErrors.push({ email, error: err.message });
    }
  }

  return {
    calendarId,
    summary: created.data.summary,
    addUrl: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(calendarId)}`,
    sharedWith,
    shareErrors,
  };
}
