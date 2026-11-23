import { config } from '../config.js';

const DIAS_CORTO = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
const DIAS_LARGO = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const MESES_LARGO = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

export function timeToMinutes(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  return h * 60 + m;
}

export function minutesToTime(totalMinutes) {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function addMinutesToTime(hhmm, deltaMinutes) {
  return minutesToTime(timeToMinutes(hhmm) + deltaMinutes);
}

/**
 * Devuelve { date: 'YYYY-MM-DD', time: 'HH:mm', minutes: number } en la zona horaria de la clínica.
 */
export function getClinicNow() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: config.clinic.timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const hour = parts.hour === '24' ? '00' : parts.hour;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const time = `${hour}:${parts.minute}`;
  return {
    date,
    time,
    minutes: timeToMinutes(time),
    timestampMs: now.getTime(),
  };
}

export function addDaysToDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function getDayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function formatDateFriendly(dateStr, { includeYear = false } = {}) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = getDayOfWeek(dateStr);
  const dd = String(d).padStart(2, '0');
  const mm = String(m).padStart(2, '0');
  return includeYear
    ? `${DIAS_LARGO[dow]} ${dd}/${mm}/${y}`
    : `${DIAS_LARGO[dow]} ${dd}/${mm}`;
}

export function formatDateShort(dateStr) {
  const [, m, d] = dateStr.split('-').map(Number);
  const dow = getDayOfWeek(dateStr);
  return `${DIAS_CORTO[dow]} ${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}`;
}

export function formatDateLongSpanish(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dow = getDayOfWeek(dateStr);
  return `${DIAS_LARGO[dow]} ${d} de ${MESES_LARGO[m - 1]} de ${y}`;
}

export function toClinicIso(dateStr, timeStr) {
  return `${dateStr}T${timeStr}:00${config.clinic.utcOffset}`;
}

export function appointmentStartMs(dateStr, timeStr) {
  return Date.parse(toClinicIso(dateStr, timeStr));
}

export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  // Si el usuario en Argentina ingresa 11xxxxxxxx o 011xxxxxxxx, normalizar a 549...
  if (digits.startsWith('0')) {
    return `549${digits.slice(1)}`;
  }
  if (digits.length === 10) {
    return `549${digits}`;
  }
  return digits;
}

export function normalizeDni(raw) {
  return String(raw || '').replace(/\D/g, '');
}
