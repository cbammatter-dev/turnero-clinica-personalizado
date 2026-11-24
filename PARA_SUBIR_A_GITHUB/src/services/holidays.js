import { getDayOfWeek } from '../utils/datetime.js';

/**
 * Calendario oficial de feriados nacionales de la República Argentina
 * (Fuente verificada: argentina.gob.ar / api.argentinadatos.com — Ley 27.399).
 * Además, el servicio intenta actualizar desde api.argentinadatos.com para años futuros
 * sin inventar ninguna fecha.
 */
const VERIFIED_HOLIDAYS_BY_YEAR = {
  2026: [
    { fecha: '2026-01-01', tipo: 'inamovible', nombre: 'Año Nuevo' },
    { fecha: '2026-02-16', tipo: 'inamovible', nombre: 'Carnaval' },
    { fecha: '2026-02-17', tipo: 'inamovible', nombre: 'Carnaval' },
    { fecha: '2026-03-23', tipo: 'puente', nombre: 'Día no laborable con fines turísticos' },
    { fecha: '2026-03-24', tipo: 'inamovible', nombre: 'Día Nacional de la Memoria por la Verdad y la Justicia' },
    { fecha: '2026-04-02', tipo: 'inamovible', nombre: 'Día del Veterano y de los Caídos en la Guerra de Malvinas' },
    { fecha: '2026-04-03', tipo: 'inamovible', nombre: 'Viernes Santo' },
    { fecha: '2026-05-01', tipo: 'inamovible', nombre: 'Día del Trabajador' },
    { fecha: '2026-05-25', tipo: 'inamovible', nombre: 'Día de la Revolución de Mayo' },
    { fecha: '2026-06-15', tipo: 'trasladable', nombre: 'Paso a la Inmortalidad del Gral. Martín Miguel de Güemes' },
    { fecha: '2026-06-20', tipo: 'inamovible', nombre: 'Paso a la Inmortalidad del Gral. Manuel Belgrano' },
    { fecha: '2026-07-09', tipo: 'inamovible', nombre: 'Día de la Independencia' },
    { fecha: '2026-07-10', tipo: 'puente', nombre: 'Día no laborable con fines turísticos' },
    { fecha: '2026-08-17', tipo: 'trasladable', nombre: 'Paso a la Inmortalidad del Gral. José de San Martín' },
    { fecha: '2026-10-12', tipo: 'trasladable', nombre: 'Día del Respeto a la Diversidad Cultural' },
    { fecha: '2026-11-09', tipo: 'inamovible', nombre: 'Feriado nacional excepcional (Visita del Papa León XIV)' },
    { fecha: '2026-11-23', tipo: 'trasladable', nombre: 'Día de la Soberanía Nacional' },
    { fecha: '2026-12-07', tipo: 'puente', nombre: 'Día no laborable con fines turísticos' },
    { fecha: '2026-12-08', tipo: 'inamovible', nombre: 'Día de la Inmaculada Concepción de María' },
    { fecha: '2026-12-25', tipo: 'inamovible', nombre: 'Navidad' },
  ],
  2027: [
    { fecha: '2027-01-01', tipo: 'inamovible', nombre: 'Año Nuevo' },
    { fecha: '2027-02-08', tipo: 'inamovible', nombre: 'Carnaval' },
    { fecha: '2027-02-09', tipo: 'inamovible', nombre: 'Carnaval' },
    { fecha: '2027-03-24', tipo: 'inamovible', nombre: 'Día Nacional de la Memoria por la Verdad y la Justicia' },
    { fecha: '2027-03-26', tipo: 'inamovible', nombre: 'Viernes Santo' },
    { fecha: '2027-04-02', tipo: 'inamovible', nombre: 'Día del Veterano y de los Caídos en la Guerra de Malvinas' },
    { fecha: '2027-05-01', tipo: 'inamovible', nombre: 'Día del Trabajador' },
    { fecha: '2027-05-25', tipo: 'inamovible', nombre: 'Día de la Revolución de Mayo' },
    { fecha: '2027-06-17', tipo: 'trasladable', nombre: 'Paso a la Inmortalidad del Gral. Martín Miguel de Güemes' },
    { fecha: '2027-06-20', tipo: 'inamovible', nombre: 'Paso a la Inmortalidad del Gral. Manuel Belgrano' },
    { fecha: '2027-07-09', tipo: 'inamovible', nombre: 'Día de la Independencia' },
    { fecha: '2027-08-17', tipo: 'trasladable', nombre: 'Paso a la Inmortalidad del Gral. José de San Martín' },
    { fecha: '2027-10-12', tipo: 'trasladable', nombre: 'Día del Respeto a la Diversidad Cultural' },
    { fecha: '2027-11-20', tipo: 'trasladable', nombre: 'Día de la Soberanía Nacional' },
    { fecha: '2027-12-08', tipo: 'inamovible', nombre: 'Día de la Inmaculada Concepción de María' },
    { fecha: '2027-12-25', tipo: 'inamovible', nombre: 'Navidad' },
  ],
};

// Feriados inamovibles fijados por Ley 27.399 (respaldo offline para años 2028+ si no hay internet)
const FIXED_STATUTORY_MMDD = [
  ['01-01', 'Año Nuevo'],
  ['03-24', 'Día Nacional de la Memoria por la Verdad y la Justicia'],
  ['04-02', 'Día del Veterano y de los Caídos en la Guerra de Malvinas'],
  ['05-01', 'Día del Trabajador'],
  ['05-25', 'Día de la Revolución de Mayo'],
  ['06-20', 'Paso a la Inmortalidad del Gral. Manuel Belgrano'],
  ['07-09', 'Día de la Independencia'],
  ['12-08', 'Día de la Inmaculada Concepción de María'],
  ['12-25', 'Navidad'],
];

const dynamicCacheByYear = new Map();
const fetchAttemptedYears = new Set();

function buildMapForYear(year) {
  if (dynamicCacheByYear.has(year)) {
    return dynamicCacheByYear.get(year);
  }
  const map = new Map();
  const list = VERIFIED_HOLIDAYS_BY_YEAR[year];
  if (list) {
    for (const h of list) map.set(h.fecha, h);
  } else {
    for (const [mmdd, nombre] of FIXED_STATUTORY_MMDD) {
      const fecha = `${year}-${mmdd}`;
      map.set(fecha, { fecha, tipo: 'inamovible', nombre });
    }
  }
  return map;
}

export async function refreshHolidaysForYear(year) {
  const y = Number(year);
  if (!y || fetchAttemptedYears.has(y)) return;
  fetchAttemptedYears.add(y);
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`https://api.argentinadatos.com/v1/feriados/${y}`, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return;
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return;

    const map = new Map();
    for (const r of rows) {
      if (r?.fecha && /^\d{4}-\d{2}-\d{2}$/.test(r.fecha)) {
        map.set(r.fecha, {
          fecha: r.fecha,
          tipo: r.tipo || 'feriado',
          nombre: r.nombre || 'Feriado nacional',
        });
      }
    }
    if (map.size > 0) {
      dynamicCacheByYear.set(y, map);
    }
  } catch {
    // Si no hay conexión, se mantiene el calendario oficial verificado local
  }
}

export function isSunday(dateStr) {
  return getDayOfWeek(dateStr) === 0;
}

export function getArgentinaHoliday(dateStr) {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const year = Number(dateStr.slice(0, 4));
  if (!fetchAttemptedYears.has(year)) {
    // Dispara actualización en segundo plano sin frenar la consulta
    refreshHolidaysForYear(year).catch(() => {});
  }
  const map = buildMapForYear(year);
  return map.get(dateStr) || null;
}

/**
 * Devuelve el motivo si la fecha está bloqueada automáticamente por Domingo o Feriado de Argentina,
 * o null si es un día hábil normal.
 */
export function getBlockedDayReason(dateStr) {
  if (isSunday(dateStr)) {
    return 'Domingo (no se otorgan turnos los domingos)';
  }
  const holiday = getArgentinaHoliday(dateStr);
  if (holiday) {
    return `Feriado en Argentina: ${holiday.nombre}`;
  }
  return null;
}

export function listHolidaysForYear(year) {
  const y = Number(year);
  return [...buildMapForYear(y).values()].sort((a, b) => a.fecha.localeCompare(b.fecha));
}
