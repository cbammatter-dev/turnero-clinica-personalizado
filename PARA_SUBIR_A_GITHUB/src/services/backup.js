import ExcelJS from 'exceljs';
import { db, loadClinicSettings } from '../db/database.js';
import { config } from '../config.js';
import { normalizeDni, normalizePhone } from '../utils/datetime.js';

/**
 * Exporta una copia completa de toda la base de datos clínica en formato JSON
 * lista para guardar como respaldo y volver a importar en cualquier momento.
 */
export function exportClinicBackupJson() {
  const safeSettings = db
    .prepare(
      `SELECT key, value FROM clinic_settings
       WHERE key IN ('name', 'address', 'phone')`
    )
    .all();

  return {
    app: 'turnero-clinica',
    version: 1,
    exportedAt: new Date().toISOString(),
    clinic: {
      name: config.clinic.name,
      address: config.clinic.address,
      phone: config.clinic.phone,
    },
    data: {
      clinic_settings: safeSettings,
      especialidades: db.prepare('SELECT * FROM especialidades ORDER BY id ASC').all(),
      obras_sociales: db.prepare('SELECT * FROM obras_sociales ORDER BY id ASC').all(),
      profesionales: db.prepare('SELECT * FROM profesionales ORDER BY id ASC').all(),
      horarios_atencion: db.prepare('SELECT * FROM horarios_atencion ORDER BY id ASC').all(),
      horarios_especiales: db.prepare('SELECT * FROM horarios_especiales ORDER BY id ASC').all(),
      bloqueos_agenda: db.prepare('SELECT * FROM bloqueos_agenda ORDER BY id ASC').all(),
      pacientes: db.prepare('SELECT * FROM pacientes ORDER BY id ASC').all(),
      turnos: db.prepare('SELECT * FROM turnos ORDER BY id ASC').all(),
      atenciones_clinicas: db.prepare('SELECT * FROM atenciones_clinicas ORDER BY id ASC').all(),
      recetarios_plataformas: db.prepare('SELECT * FROM recetarios_plataformas ORDER BY id ASC').all(),
    },
  };
}

function normalizeHeader(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function cellToString(val) {
  if (val === null || val === undefined) return '';
  if (val instanceof Date) {
    return val.toISOString().slice(0, 10);
  }
  if (typeof val === 'object') {
    if (val.text !== undefined) return String(val.text).trim();
    if (val.result !== undefined) return String(val.result).trim();
    if (Array.isArray(val.richText)) {
      return val.richText.map((r) => r.text || '').join('').trim();
    }
  }
  return String(val).trim();
}

function findOrCreateSpecialtyId(name) {
  const clean = String(name || '').trim() || 'Clínica Médica';
  const existing = db
    .prepare('SELECT id FROM especialidades WHERE LOWER(nombre) = LOWER(?)')
    .get(clean);
  if (existing) return existing.id;
  const res = db
    .prepare("INSERT INTO especialidades (nombre, icono, descripcion, activa) VALUES (?, '🩺', '', 1)")
    .run(clean);
  return Number(res.lastInsertRowid);
}

function importFromJsonObject(parsed) {
  const d = parsed?.data;
  if (!d || typeof d !== 'object') {
    throw new Error('El archivo JSON no tiene el formato de respaldo del Turnero.');
  }

  const stats = {
    especialidades: 0,
    obrasSociales: 0,
    profesionales: 0,
    horarios: 0,
    turnos: 0,
    pacientes: 0,
    atenciones: 0,
    recetarios: 0,
  };

  db.exec('BEGIN');
  try {
    // 1. Datos de la clínica
    if (Array.isArray(d.clinic_settings)) {
      const stmt = db.prepare(
        `INSERT INTO clinic_settings (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      );
      for (const s of d.clinic_settings) {
        if (['name', 'address', 'phone'].includes(s.key) && s.value) {
          stmt.run(s.key, String(s.value));
        }
      }
      loadClinicSettings();
    }

    // 2. Especialidades (mapa oldId -> newId)
    const specIdMap = new Map();
    if (Array.isArray(d.especialidades)) {
      for (const e of d.especialidades) {
        if (!e?.nombre) continue;
        let row = db.prepare('SELECT id FROM especialidades WHERE LOWER(nombre) = LOWER(?)').get(e.nombre);
        if (!row) {
          const ins = db
            .prepare('INSERT INTO especialidades (nombre, icono, descripcion, activa) VALUES (?, ?, ?, ?)')
            .run(e.nombre, e.icono || '🩺', e.descripcion || '', e.activa ?? 1);
          row = { id: Number(ins.lastInsertRowid) };
          stats.especialidades++;
        }
        if (e.id) specIdMap.set(Number(e.id), row.id);
      }
    }

    // 3. Obras sociales
    if (Array.isArray(d.obras_sociales)) {
      const stmt = db.prepare('INSERT OR IGNORE INTO obras_sociales (nombre, activa) VALUES (?, ?)');
      for (const o of d.obras_sociales) {
        if (!o?.nombre) continue;
        const r = stmt.run(String(o.nombre).trim(), o.activa ?? 1);
        if (r.changes > 0) stats.obrasSociales++;
      }
    }

    // 4. Profesionales (mapa oldId -> newId)
    const docIdMap = new Map();
    if (Array.isArray(d.profesionales)) {
      for (const p of d.profesionales) {
        if (!p?.nombre) continue;
        const targetSpecId =
          (p.especialidad_id && specIdMap.get(Number(p.especialidad_id))) ||
          findOrCreateSpecialtyId(p.especialidad_nombre || 'Clínica Médica');

        let existing = db
          .prepare('SELECT id FROM profesionales WHERE LOWER(nombre) = LOWER(?)')
          .get(p.nombre);

        if (existing) {
          db.prepare(
            `UPDATE profesionales
             SET especialidad_id = ?, matricula = ?, duracion_turno_min = ?, consultorio = ?,
                 google_calendar_id = ?, obras_sociales = ?, activo = ?,
                 dni = ?, fecha_nacimiento = ?, domicilio = ?, localidad = ?, telefono = ?, email = ?
             WHERE id = ?`
          ).run(
            targetSpecId,
            p.matricula || '',
            Number(p.duracion_turno_min || 30),
            p.consultorio || 'Consultorio 1',
            p.google_calendar_id || '',
            p.obras_sociales || 'Particular',
            p.activo ?? 1,
            p.dni || '',
            p.fecha_nacimiento || '',
            p.domicilio || '',
            p.localidad || '',
            p.telefono || '',
            p.email || '',
            existing.id
          );
          if (p.id) docIdMap.set(Number(p.id), existing.id);
          stats.profesionales++;
        } else {
          const ins = db
            .prepare(
              `INSERT INTO profesionales
                (nombre, especialidad_id, matricula, duracion_turno_min, consultorio, google_calendar_id,
                 obras_sociales, activo, dni, fecha_nacimiento, domicilio, localidad, telefono, email)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              p.nombre,
              targetSpecId,
              p.matricula || '',
              Number(p.duracion_turno_min || 30),
              p.consultorio || 'Consultorio 1',
              p.google_calendar_id || '',
              p.obras_sociales || 'Particular',
              p.activo ?? 1,
              p.dni || '',
              p.fecha_nacimiento || '',
              p.domicilio || '',
              p.localidad || '',
              p.telefono || '',
              p.email || ''
            );
          const newId = Number(ins.lastInsertRowid);
          if (p.id) docIdMap.set(Number(p.id), newId);
          stats.profesionales++;
        }
      }
    }

    // 5. Horarios de atención (reemplaza por profesional importado sin duplicar)
    if (Array.isArray(d.horarios_atencion)) {
      const grouped = new Map();
      for (const h of d.horarios_atencion) {
        const mappedDocId = docIdMap.get(Number(h.profesional_id));
        if (!mappedDocId) continue;
        if (!grouped.has(mappedDocId)) grouped.set(mappedDocId, []);
        grouped.get(mappedDocId).push(h);
      }
      const delStmt = db.prepare('DELETE FROM horarios_atencion WHERE profesional_id = ?');
      const insStmt = db.prepare(
        'INSERT INTO horarios_atencion (profesional_id, dia_semana, hora_inicio, hora_fin) VALUES (?, ?, ?, ?)'
      );
      for (const [docId, list] of grouped.entries()) {
        delStmt.run(docId);
        for (const h of list) {
          insStmt.run(docId, Number(h.dia_semana), h.hora_inicio, h.hora_fin);
          stats.horarios++;
        }
      }
    }

    // 6. Horarios especiales y bloqueos
    if (Array.isArray(d.horarios_especiales)) {
      for (const s of d.horarios_especiales) {
        const docId = docIdMap.get(Number(s.profesional_id));
        if (!docId || !s.fecha) continue;
        const dup = db
          .prepare(
            'SELECT id FROM horarios_especiales WHERE profesional_id = ? AND fecha = ? AND hora_inicio = ?'
          )
          .get(docId, s.fecha, s.hora_inicio);
        if (!dup) {
          db.prepare(
            'INSERT INTO horarios_especiales (profesional_id, fecha, hora_inicio, hora_fin, nota) VALUES (?, ?, ?, ?, ?)'
          ).run(docId, s.fecha, s.hora_inicio, s.hora_fin, s.nota || '');
        }
      }
    }

    if (Array.isArray(d.bloqueos_agenda)) {
      for (const b of d.bloqueos_agenda) {
        const docId = docIdMap.get(Number(b.profesional_id));
        if (!docId || !b.fecha) continue;
        const dup = db
          .prepare(
            'SELECT id FROM bloqueos_agenda WHERE profesional_id = ? AND fecha = ? AND hora_inicio = ? AND hora_fin = ?'
          )
          .get(docId, b.fecha, b.hora_inicio, b.hora_fin);
        if (!dup) {
          db.prepare(
            'INSERT INTO bloqueos_agenda (profesional_id, fecha, hora_inicio, hora_fin, motivo) VALUES (?, ?, ?, ?, ?)'
          ).run(docId, b.fecha, b.hora_inicio, b.hora_fin, b.motivo || 'No atiende');
        }
      }
    }

    // 7. Pacientes (mapa oldId -> newId, upsert por DNI)
    const patIdMap = new Map();
    if (Array.isArray(d.pacientes)) {
      for (const p of d.pacientes) {
        const dni = normalizeDni(p.dni);
        if (!dni || !p.nombre_completo) continue;
        const existing = db.prepare('SELECT id FROM pacientes WHERE dni = ?').get(dni);
        if (existing) {
          db.prepare(
            `UPDATE pacientes
             SET nombre_completo = ?, telefono_whatsapp = ?, obra_social = ?,
                 fecha_nacimiento = ?, domicilio = ?, localidad = ?, email = ?, nro_afiliado = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).run(
            p.nombre_completo,
            normalizePhone(p.telefono_whatsapp || ''),
            p.obra_social || 'Particular',
            p.fecha_nacimiento || '',
            p.domicilio || '',
            p.localidad || '',
            p.email || '',
            p.nro_afiliado || '',
            existing.id
          );
          if (p.id) patIdMap.set(Number(p.id), existing.id);
          stats.pacientes++;
        } else {
          const ins = db
            .prepare(
              `INSERT INTO pacientes
                (dni, nombre_completo, telefono_whatsapp, obra_social, fecha_nacimiento, domicilio, localidad, email, nro_afiliado)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              dni,
              p.nombre_completo,
              normalizePhone(p.telefono_whatsapp || ''),
              p.obra_social || 'Particular',
              p.fecha_nacimiento || '',
              p.domicilio || '',
              p.localidad || '',
              p.email || '',
              p.nro_afiliado || ''
            );
          const newId = Number(ins.lastInsertRowid);
          if (p.id) patIdMap.set(Number(p.id), newId);
          stats.pacientes++;
        }
      }
    }

    // 8. Turnos (por código único)
    const turnoIdMap = new Map();
    if (Array.isArray(d.turnos)) {
      for (const t of d.turnos) {
        const patId = patIdMap.get(Number(t.paciente_id));
        const docId = docIdMap.get(Number(t.profesional_id));
        if (!patId || !docId || !t.codigo) continue;
        const existing = db.prepare('SELECT id FROM turnos WHERE codigo = ?').get(t.codigo);
        if (existing) {
          if (t.id) turnoIdMap.set(Number(t.id), existing.id);
          continue;
        }
        try {
          const ins = db
            .prepare(
              `INSERT INTO turnos
                (codigo, paciente_id, profesional_id, fecha, hora_inicio, hora_fin, estado, canal_origen,
                 recordatorio_24h_enviado, notas)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
            )
            .run(
              t.codigo,
              patId,
              docId,
              t.fecha,
              t.hora_inicio,
              t.hora_fin || t.hora_inicio,
              t.estado || 'reservado',
              t.canal_origen || 'web',
              t.recordatorio_24h_enviado ? 1 : 0,
              t.notas || ''
            );
          const newId = Number(ins.lastInsertRowid);
          if (t.id) turnoIdMap.set(Number(t.id), newId);
          stats.turnos++;
        } catch {
          // evitar choque de índice único de slot si ya existía
        }
      }
    }

    // 9. Atenciones clínicas y copagos
    if (Array.isArray(d.atenciones_clinicas)) {
      for (const a of d.atenciones_clinicas) {
        const patId = patIdMap.get(Number(a.paciente_id));
        const docId = docIdMap.get(Number(a.profesional_id));
        if (!patId || !docId) continue;
        const dup = db
          .prepare(
            `SELECT id FROM atenciones_clinicas
             WHERE paciente_id = ? AND profesional_id = ? AND COALESCE(fecha_atencion, '') = ? AND COALESCE(diagnostico, '') = ?`
          )
          .get(patId, docId, a.fecha_atencion || '', a.diagnostico || '');
        if (dup) continue;

        const mappedTurnoId = a.turno_id ? turnoIdMap.get(Number(a.turno_id)) || null : null;
        db.prepare(
          `INSERT INTO atenciones_clinicas
            (paciente_id, profesional_id, turno_id, fecha_atencion, motivo_consulta, signos_vitales,
             diagnostico, evolucion, indicaciones, receta_plataforma, receta_codigo, proximo_control,
             abono_copago, monto_copago, medio_pago)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          patId,
          docId,
          mappedTurnoId,
          a.fecha_atencion || new Date().toISOString().slice(0, 10),
          a.motivo_consulta || '',
          a.signos_vitales || '',
          a.diagnostico || '',
          a.evolucion || '',
          a.indicaciones || '',
          a.receta_plataforma || '',
          a.receta_codigo || '',
          a.proximo_control || '',
          a.abono_copago ? 1 : 0,
          Number(a.monto_copago || 0),
          a.medio_pago || ''
        );
        stats.atenciones++;
      }
    }

    // 10. Recetarios
    if (Array.isArray(d.recetarios_plataformas)) {
      for (const r of d.recetarios_plataformas) {
        if (!r?.nombre || !r?.url) continue;
        const dup = db
          .prepare('SELECT id FROM recetarios_plataformas WHERE LOWER(nombre) = LOWER(?)')
          .get(r.nombre);
        if (!dup) {
          db.prepare(
            `INSERT INTO recetarios_plataformas (nombre, categoria, url, coberturas, descripcion, permite_iframe, orden)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          ).run(
            r.nombre,
            r.categoria || 'ReNaPDiS',
            r.url,
            r.coberturas || 'Todas',
            r.descripcion || '',
            r.permite_iframe ? 1 : 0,
            Number(r.orden || 50)
          );
          stats.recetarios++;
        }
      }
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { format: 'json', imported: stats };
}

async function importFromExcelBuffer(buffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const stats = {
    especialidades: 0,
    obrasSociales: 0,
    profesionales: 0,
    horarios: 0,
    turnos: 0,
    pacientes: 0,
    atenciones: 0,
    recetarios: 0,
  };

  function sheetToObjects(sheet) {
    const headerRow = sheet.getRow(1);
    const colMap = [];
    headerRow.eachCell((cell, colNumber) => {
      colMap[colNumber] = normalizeHeader(cellToString(cell.value));
    });
    const rows = [];
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const obj = {};
      let hasData = false;
      row.eachCell((cell, colNumber) => {
        const key = colMap[colNumber];
        if (!key) return;
        const val = cellToString(cell.value);
        if (val !== '') hasData = true;
        obj[key] = val;
      });
      if (hasData) rows.push(obj);
    });
    return rows;
  }

  const pick = (obj, keys) => {
    for (const k of keys) {
      if (obj[k] !== undefined && obj[k] !== '') return obj[k];
    }
    return '';
  };

  db.exec('BEGIN');
  try {
    // 1. Primero Profesionales (para que Atenciones pueda vincularlos)
    for (const sheet of workbook.worksheets) {
      const sName = normalizeHeader(sheet.name);
      if (!sName.includes('profesional')) continue;
      const rows = sheetToObjects(sheet);
      for (const r of rows) {
        const nombre = pick(r, ['nombre y apellido', 'nombre', 'profesional', 'medico']);
        if (!nombre || nombre.toUpperCase() === 'TOTAL') continue;
        const especialidad = pick(r, ['especialidad']);
        const specId = findOrCreateSpecialtyId(especialidad || 'Clínica Médica');
        const dni = normalizeDni(pick(r, ['dni']));
        const dob = pick(r, ['fecha de nacimiento', 'fecha nacimiento']);
        const matricula = pick(r, ['matricula']);
        const domicilio = pick(r, ['domicilio', 'direccion']);
        const localidad = pick(r, ['localidad', 'ciudad']);
        const telefono = pick(r, ['telefono', 'whatsapp', 'telefono whatsapp']);
        const email = pick(r, ['email', 'correo']);
        const consultorio = pick(r, ['consultorio']) || 'Consultorio 1';
        const obras = pick(r, ['obras sociales que trabaja', 'obras sociales']) || 'Particular';

        const existing = db
          .prepare('SELECT id FROM profesionales WHERE LOWER(nombre) = LOWER(?)')
          .get(nombre);

        if (existing) {
          db.prepare(
            `UPDATE profesionales
             SET especialidad_id = ?, dni = ?, fecha_nacimiento = ?, matricula = ?,
                 domicilio = ?, localidad = ?, telefono = ?, email = ?, consultorio = ?,
                 obras_sociales = ?, activo = 1
             WHERE id = ?`
          ).run(specId, dni, dob, matricula, domicilio, localidad, telefono, email, consultorio, obras, existing.id);
        } else {
          db.prepare(
            `INSERT INTO profesionales
              (nombre, especialidad_id, dni, fecha_nacimiento, matricula, domicilio, localidad,
               telefono, email, consultorio, obras_sociales, activo)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
          ).run(nombre, specId, dni, dob, matricula, domicilio, localidad, telefono, email, consultorio, obras);
        }
        stats.profesionales++;
      }
    }

    // 2. Pacientes
    for (const sheet of workbook.worksheets) {
      const sName = normalizeHeader(sheet.name);
      if (!sName.includes('paciente')) continue;
      const rows = sheetToObjects(sheet);
      for (const r of rows) {
        const nombre = pick(r, ['nombre y apellido', 'nombre', 'paciente']);
        const dni = normalizeDni(pick(r, ['dni']));
        if (!nombre || !dni || nombre.toUpperCase() === 'TOTAL') continue;
        const dob = pick(r, ['fecha de nacimiento', 'fecha nacimiento']);
        const obra = pick(r, ['obra social', 'obra social prepaga']) || 'Particular';
        const afiliado = pick(r, ['n afiliado', 'nro afiliado', 'numero afiliado']);
        const tel = normalizePhone(pick(r, ['telefono whatsapp', 'whatsapp', 'telefono']));
        const email = pick(r, ['email', 'correo']);
        const domicilio = pick(r, ['domicilio', 'direccion']);
        const localidad = pick(r, ['localidad', 'ciudad']);

        const existing = db.prepare('SELECT id FROM pacientes WHERE dni = ?').get(dni);
        if (existing) {
          db.prepare(
            `UPDATE pacientes
             SET nombre_completo = ?, fecha_nacimiento = ?, obra_social = ?, nro_afiliado = ?,
                 telefono_whatsapp = ?, email = ?, domicilio = ?, localidad = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
          ).run(nombre, dob, obra, afiliado, tel, email, domicilio, localidad, existing.id);
        } else {
          db.prepare(
            `INSERT INTO pacientes
              (dni, nombre_completo, fecha_nacimiento, obra_social, nro_afiliado,
               telefono_whatsapp, email, domicilio, localidad)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(dni, nombre, dob, obra, afiliado, tel, email, domicilio, localidad);
        }
        stats.pacientes++;
      }
    }

    // 3. Atenciones y Copagos
    for (const sheet of workbook.worksheets) {
      const sName = normalizeHeader(sheet.name);
      if (!sName.includes('atencion') && !sName.includes('copago')) continue;
      const rows = sheetToObjects(sheet);
      for (const r of rows) {
        const fecha = pick(r, ['fecha de atencion', 'fecha atencion', 'fecha']);
        if (!fecha || fecha.toUpperCase() === 'TOTAL') continue;

        const patName = pick(r, ['paciente', 'nombre y apellido']);
        const patDni = normalizeDni(pick(r, ['dni paciente', 'dni']));
        const docName = pick(r, ['medico que atendio', 'medico', 'profesional']);
        if (!patDni || !docName) continue;

        let pat = db.prepare('SELECT id FROM pacientes WHERE dni = ?').get(patDni);
        if (!pat && patName) {
          const obra = pick(r, ['obra social']) || 'Particular';
          const ins = db
            .prepare('INSERT INTO pacientes (dni, nombre_completo, telefono_whatsapp, obra_social) VALUES (?, ?, ?, ?)')
            .run(patDni, patName, '', obra);
          pat = { id: Number(ins.lastInsertRowid) };
        }
        if (!pat) continue;

        let doc = db.prepare('SELECT id FROM profesionales WHERE LOWER(nombre) = LOWER(?)').get(docName);
        if (!doc) {
          const specId = findOrCreateSpecialtyId(pick(r, ['especialidad']) || 'Clínica Médica');
          const ins = db
            .prepare('INSERT INTO profesionales (nombre, especialidad_id, activo) VALUES (?, ?, 1)')
            .run(docName, specId);
          doc = { id: Number(ins.lastInsertRowid) };
        }

        const diagnostico = pick(r, ['diagnostico']);
        const motivo = pick(r, ['motivo de consulta', 'motivo']);
        const evolucion =
          pick(r, ['evolucion descripcion', 'evolucion']) ||
          diagnostico ||
          motivo ||
          'Atención importada desde Excel';
        const indicaciones = pick(r, ['indicaciones']);
        const abonoTxt = normalizeHeader(pick(r, ['abono copago', 'copago']));
        const montoRaw = pick(r, ['monto copago', 'monto']).replace(/[^\d.,-]/g, '').replace(',', '.');
        const monto = Number(montoRaw) || 0;
        const abono = abonoTxt === 'si' || monto > 0 ? 1 : 0;
        const medio = pick(r, ['medio de pago']);

        const dup = db
          .prepare(
            `SELECT id FROM atenciones_clinicas
             WHERE paciente_id = ? AND profesional_id = ? AND COALESCE(fecha_atencion, '') = ? AND COALESCE(diagnostico, '') = ?`
          )
          .get(pat.id, doc.id, fecha, diagnostico);
        if (dup) continue;

        db.prepare(
          `INSERT INTO atenciones_clinicas
            (paciente_id, profesional_id, fecha_atencion, motivo_consulta, diagnostico, evolucion,
             indicaciones, abono_copago, monto_copago, medio_pago)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(pat.id, doc.id, fecha, motivo, diagnostico, evolucion, indicaciones, abono, monto, medio);
        stats.atenciones++;
      }
    }

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return { format: 'xlsx', imported: stats };
}

export async function importClinicBackupFromBuffer(buffer, filename = '') {
  if (!buffer || buffer.length === 0) {
    throw new Error('El archivo seleccionado está vacío.');
  }

  const isZip =
    buffer.length >= 4 &&
    buffer[0] === 0x50 &&
    buffer[1] === 0x4b &&
    buffer[2] === 0x03 &&
    buffer[3] === 0x04;

  if (isZip || /\.xlsx$/i.test(filename)) {
    return importFromExcelBuffer(buffer);
  }

  let parsed;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error(
      'Formato no reconocido. Subí un archivo de respaldo (.json) o un archivo de Excel (.xlsx) exportado desde este sistema.'
    );
  }
  return importFromJsonObject(parsed);
}
