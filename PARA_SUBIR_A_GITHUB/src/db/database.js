import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from '../config.js';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

export function initDatabase() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS especialidades (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      icono TEXT DEFAULT '🩺',
      descripcion TEXT DEFAULT '',
      activa INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS profesionales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL,
      especialidad_id INTEGER NOT NULL,
      matricula TEXT DEFAULT '',
      duracion_turno_min INTEGER NOT NULL DEFAULT 30,
      consultorio TEXT DEFAULT 'Consultorio 1',
      google_calendar_id TEXT DEFAULT '',
      obras_sociales TEXT DEFAULT 'Particular, OSDE, Swiss Medical, Galeno, IOMA',
      activo INTEGER NOT NULL DEFAULT 1,
      FOREIGN KEY (especialidad_id) REFERENCES especialidades(id)
    );

    CREATE TABLE IF NOT EXISTS horarios_atencion (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profesional_id INTEGER NOT NULL,
      dia_semana INTEGER NOT NULL, -- 0=Domingo, 1=Lunes ... 6=Sábado
      hora_inicio TEXT NOT NULL,   -- HH:mm
      hora_fin TEXT NOT NULL,      -- HH:mm
      FOREIGN KEY (profesional_id) REFERENCES profesionales(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS bloqueos_agenda (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profesional_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,         -- YYYY-MM-DD
      hora_inicio TEXT NOT NULL,   -- HH:mm (ej. 00:00 para día completo)
      hora_fin TEXT NOT NULL,      -- HH:mm (ej. 23:59 para día completo)
      motivo TEXT DEFAULT 'No atiende',
      google_event_id TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (profesional_id) REFERENCES profesionales(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS pacientes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      dni TEXT NOT NULL UNIQUE,
      nombre_completo TEXT NOT NULL,
      telefono_whatsapp TEXT NOT NULL,
      obra_social TEXT DEFAULT 'Particular',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS turnos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      codigo TEXT NOT NULL UNIQUE,
      paciente_id INTEGER NOT NULL,
      profesional_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,         -- YYYY-MM-DD
      hora_inicio TEXT NOT NULL,   -- HH:mm
      hora_fin TEXT NOT NULL,      -- HH:mm
      estado TEXT NOT NULL DEFAULT 'reservado', -- reservado | confirmado | cancelado | asistio | ausente
      canal_origen TEXT NOT NULL DEFAULT 'web', -- web | whatsapp
      google_event_id TEXT DEFAULT '',
      google_sync_mode TEXT DEFAULT 'demo',     -- demo | live
      recordatorio_24h_enviado INTEGER NOT NULL DEFAULT 0,
      recordatorio_enviado_at TEXT,
      notas TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (paciente_id) REFERENCES pacientes(id),
      FOREIGN KEY (profesional_id) REFERENCES profesionales(id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_turnos_slot_activo
      ON turnos(profesional_id, fecha, hora_inicio)
      WHERE estado NOT IN ('cancelado');

    CREATE TABLE IF NOT EXISTS bot_sessions (
      session_key TEXT PRIMARY KEY,
      step TEXT NOT NULL DEFAULT 'menu',
      data TEXT NOT NULL DEFAULT '{}',
      error_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS whatsapp_messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      phone TEXT NOT NULL,
      direction TEXT NOT NULL, -- inbound | outbound
      message_type TEXT NOT NULL DEFAULT 'text', -- text | buttons | list | reminder
      body TEXT NOT NULL,
      payload TEXT DEFAULT '{}',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS clinic_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      nombre TEXT NOT NULL,
      rol TEXT NOT NULL DEFAULT 'profesional', -- admin | profesional
      profesional_id INTEGER,
      activo INTEGER NOT NULL DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (profesional_id) REFERENCES profesionales(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS obras_sociales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      activa INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS atenciones_clinicas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      paciente_id INTEGER NOT NULL,
      profesional_id INTEGER,
      turno_id INTEGER,
      usuario_id INTEGER,
      fecha_atencion TEXT NOT NULL,
      motivo_consulta TEXT DEFAULT '',
      signos_vitales TEXT DEFAULT '',
      diagnostico TEXT DEFAULT '',
      evolucion TEXT NOT NULL,
      indicaciones TEXT DEFAULT '',
      receta_plataforma TEXT DEFAULT '',
      receta_codigo TEXT DEFAULT '',
      proximo_control TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (paciente_id) REFERENCES pacientes(id) ON DELETE CASCADE,
      FOREIGN KEY (profesional_id) REFERENCES profesionales(id) ON DELETE SET NULL,
      FOREIGN KEY (turno_id) REFERENCES turnos(id) ON DELETE SET NULL,
      FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS recetarios_plataformas (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      nombre TEXT NOT NULL UNIQUE,
      categoria TEXT NOT NULL DEFAULT 'ReNaPDiS', -- ReNaPDiS | Obra Social | Prepaga | Oficial
      coberturas TEXT NOT NULL DEFAULT 'Todas',
      url TEXT NOT NULL,
      homologada_renapdis INTEGER NOT NULL DEFAULT 1,
      descripcion TEXT DEFAULT '',
      orden INTEGER NOT NULL DEFAULT 50,
      activa INTEGER NOT NULL DEFAULT 1
    );

    CREATE TABLE IF NOT EXISTS horarios_especiales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profesional_id INTEGER NOT NULL,
      fecha TEXT NOT NULL,         -- YYYY-MM-DD (reemplaza el horario semanal solo para esta fecha)
      hora_inicio TEXT NOT NULL,   -- HH:mm
      hora_fin TEXT NOT NULL,      -- HH:mm
      nota TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (profesional_id) REFERENCES profesionales(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS solicitudes_horarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tipo TEXT NOT NULL DEFAULT 'nuevo', -- nuevo | cambio_horario
      profesional_id INTEGER,
      nombre TEXT NOT NULL,
      matricula TEXT DEFAULT '',
      especialidad_id INTEGER NOT NULL,
      telefono TEXT DEFAULT '',
      gmail TEXT DEFAULT '',
      duracion_turno_min INTEGER NOT NULL DEFAULT 30,
      obras_sociales TEXT DEFAULT 'Particular',
      horarios_json TEXT NOT NULL DEFAULT '[]',
      notas TEXT DEFAULT '',
      estado TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | aprobada | rechazada
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (especialidad_id) REFERENCES especialidades(id),
      FOREIGN KEY (profesional_id) REFERENCES profesionales(id) ON DELETE SET NULL
    );
  `);

  ensureExtendedClinicColumns();
  loadClinicSettings();
  seedInitialData();
  ensureStandardSpecialties();
  ensureDefaultObrasSociales();
  ensureDefaultRecetarios();
  seedDefaultUsers();
}

function addColumnIfMissing(table, column, definition) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!cols.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

function ensureExtendedClinicColumns() {
  // Base de datos completa de Pacientes
  addColumnIfMissing('pacientes', 'fecha_nacimiento', "TEXT DEFAULT ''");
  addColumnIfMissing('pacientes', 'domicilio', "TEXT DEFAULT ''");
  addColumnIfMissing('pacientes', 'localidad', "TEXT DEFAULT ''");
  addColumnIfMissing('pacientes', 'email', "TEXT DEFAULT ''");
  addColumnIfMissing('pacientes', 'nro_afiliado', "TEXT DEFAULT ''");

  // Base de datos completa de Profesionales
  addColumnIfMissing('profesionales', 'dni', "TEXT DEFAULT ''");
  addColumnIfMissing('profesionales', 'fecha_nacimiento', "TEXT DEFAULT ''");
  addColumnIfMissing('profesionales', 'domicilio', "TEXT DEFAULT ''");
  addColumnIfMissing('profesionales', 'localidad', "TEXT DEFAULT ''");
  addColumnIfMissing('profesionales', 'telefono', "TEXT DEFAULT ''");
  addColumnIfMissing('profesionales', 'email', "TEXT DEFAULT ''");

  // Copago en Atenciones Clínicas
  addColumnIfMissing('atenciones_clinicas', 'abono_copago', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('atenciones_clinicas', 'monto_copago', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('atenciones_clinicas', 'medio_pago', "TEXT DEFAULT ''");
}

function ensureDefaultRecetarios() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM recetarios_plataformas').get().c;
  if (count > 0) return;

  const platforms = [
    [
      'RCTA — Recetario Electrónico',
      'ReNaPDiS',
      'Todas, Particular, OSDE, Swiss Medical, Galeno, Medifé, Omint, Sancor Salud, Accord Salud, OSECAC',
      'https://rcta.me',
      1,
      'Plataforma y app multi-cobertura homologada en ReNaPDiS para emitir recetas digitales y órdenes médicas.',
      10,
    ],
    [
      'MisRx — Receta Electrónica',
      'ReNaPDiS',
      'Todas, Particular, OSDE, Swiss Medical, Galeno, Medifé, Omint, Sancor Salud, Accord Salud',
      'https://misrx.ar',
      1,
      'Recetario digital conectado con farmacias, prepagas y obras sociales (homologado ReNaPDiS).',
      20,
    ],
    [
      'PAMI — Receta Electrónica (OME)',
      'Obra Social',
      'PAMI',
      'https://www.pami.org.ar',
      1,
      'Sistema oficial de Orden Médica Electrónica y receta digital para afiliados PAMI.',
      30,
    ],
    [
      'IOMA — Recetario Digital',
      'Obra Social',
      'IOMA',
      'https://www.ioma.gba.gob.ar',
      1,
      'Portal oficial de prestadores y recetario electrónico de IOMA (Provincia de Buenos Aires).',
      40,
    ],
    [
      'OSDE — Portal Prestadores',
      'Prepaga',
      'OSDE',
      'https://www.osde.com.ar',
      1,
      'Acceso para profesionales y circuito de receta electrónica OSDE.',
      50,
    ],
    [
      'Swiss Medical — Prestadores',
      'Prepaga',
      'Swiss Medical',
      'https://www.swissmedical.com.ar',
      1,
      'Gestor de recetas digitales y portal para profesionales de Swiss Medical.',
      60,
    ],
    [
      'Galeno — Portal Prestadores',
      'Prepaga',
      'Galeno',
      'https://www.e-galeno.com.ar',
      1,
      'Portal de prestadores y validación de recetas digitales para afiliados Galeno.',
      70,
    ],
    [
      'Padrón Oficial ReNaPDiS (Ministerio de Salud)',
      'Oficial',
      'Todas',
      'https://www.argentina.gob.ar/salud/receta-electronica/plataformas',
      1,
      'Listado oficial actualizado de todas las plataformas aprobadas por el Ministerio de Salud de la Nación.',
      90,
    ],
  ];

  const stmt = db.prepare(`
    INSERT OR IGNORE INTO recetarios_plataformas
      (nombre, categoria, coberturas, url, homologada_renapdis, descripcion, orden, activa)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)
  `);

  for (const row of platforms) {
    stmt.run(...row);
  }
}

export function listRecetarios() {
  return db
    .prepare(
      `SELECT * FROM recetarios_plataformas
       WHERE activa = 1
       ORDER BY orden ASC, nombre ASC`
    )
    .all();
}

export function addRecetario({
  nombre,
  categoria = 'ReNaPDiS',
  coberturas = 'Todas',
  url,
  homologadaRenapdis = true,
  descripcion = '',
}) {
  const cleanName = String(nombre || '').trim();
  const cleanUrl = String(url || '').trim();
  if (cleanName.length < 2) throw new Error('Ingresá el nombre de la plataforma o recetario.');
  if (!/^https?:\/\//i.test(cleanUrl)) {
    throw new Error('La URL debe empezar con https:// o http://');
  }

  const res = db
    .prepare(
      `INSERT INTO recetarios_plataformas
        (nombre, categoria, coberturas, url, homologada_renapdis, descripcion, orden, activa)
       VALUES (?, ?, ?, ?, ?, ?, 45, 1)`
    )
    .run(
      cleanName,
      String(categoria || 'ReNaPDiS').trim(),
      String(coberturas || 'Todas').trim() || 'Todas',
      cleanUrl,
      homologadaRenapdis ? 1 : 0,
      String(descripcion || '').trim()
    );

  return db
    .prepare('SELECT * FROM recetarios_plataformas WHERE id = ?')
    .get(Number(res.lastInsertRowid));
}

export function removeRecetario(id) {
  const row = db.prepare('SELECT id FROM recetarios_plataformas WHERE id = ?').get(Number(id));
  if (!row) throw new Error('Plataforma no encontrada.');
  db.prepare('DELETE FROM recetarios_plataformas WHERE id = ?').run(row.id);
}

function ensureDefaultObrasSociales() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM obras_sociales').get().c;
  if (count > 0) return;
  const defaults = [
    'Particular',
    'OSDE',
    'Swiss Medical',
    'Galeno',
    'IOMA',
    'PAMI',
    'Medifé',
    'Omint',
    'Sancor Salud',
    'Accord Salud',
    'OSECAC',
  ];
  const stmt = db.prepare('INSERT OR IGNORE INTO obras_sociales (nombre, activa) VALUES (?, 1)');
  for (const nombre of defaults) {
    stmt.run(nombre);
  }
}

export function listObrasSociales() {
  return db
    .prepare(
      `SELECT id, nombre FROM obras_sociales
       WHERE activa = 1
       ORDER BY CASE WHEN LOWER(nombre) = 'particular' THEN 0 ELSE 1 END, nombre ASC`
    )
    .all();
}

export function addObraSocial(nombre) {
  const clean = String(nombre || '').trim();
  if (clean.length < 2) {
    throw new Error('Escribí el nombre de la obra social o prepaga.');
  }
  const existing = db
    .prepare('SELECT id, nombre, activa FROM obras_sociales WHERE LOWER(nombre) = LOWER(?)')
    .get(clean);
  if (existing) {
    if (!existing.activa) {
      db.prepare('UPDATE obras_sociales SET activa = 1 WHERE id = ?').run(existing.id);
    }
    return db.prepare('SELECT id, nombre FROM obras_sociales WHERE id = ?').get(existing.id);
  }
  const res = db
    .prepare('INSERT INTO obras_sociales (nombre, activa) VALUES (?, 1)')
    .run(clean);
  return db
    .prepare('SELECT id, nombre FROM obras_sociales WHERE id = ?')
    .get(Number(res.lastInsertRowid));
}

export function removeObraSocial(id) {
  const row = db.prepare('SELECT * FROM obras_sociales WHERE id = ?').get(Number(id));
  if (!row) throw new Error('Obra social no encontrada.');
  if (row.nombre.toLowerCase() === 'particular') {
    throw new Error('No se puede eliminar la opción "Particular".');
  }
  db.prepare('DELETE FROM obras_sociales WHERE id = ?').run(row.id);
}

function ensureStandardSpecialties() {
  // Unificar "Traumatología" -> "Traumatología y Ortopedia" sin perder médicos ya cargados
  const oldTrauma = db
    .prepare("SELECT id FROM especialidades WHERE nombre = 'Traumatología'")
    .get();
  const newTrauma = db
    .prepare("SELECT id FROM especialidades WHERE nombre = 'Traumatología y Ortopedia'")
    .get();
  if (oldTrauma && !newTrauma) {
    db.prepare(
      "UPDATE especialidades SET nombre = 'Traumatología y Ortopedia' WHERE id = ?"
    ).run(oldTrauma.id);
  }

  const catalog = [
    ['Anestesiología', '💉', 'Evaluación prequirúrgica y manejo del dolor'],
    ['Cardiología', '❤️', 'Control cardiovascular y electrocardiogramas'],
    ['Cirugía General', '🩹', 'Consultas quirúrgicas y controles postoperatorios'],
    ['Cirugía Plástica', '✨', 'Cirugía reconstructiva y estética'],
    ['Clínica Médica', '🩺', 'Consultas generales, chequeos y certificados'],
    ['Dermatología', '🧴', 'Cuidado de la piel, lunares y alergias'],
    ['Endocrinología', '🧬', 'Tiroides, diabetes y metabolismo'],
    ['Fonoaudiología', '🗣️', 'Habla, lenguaje, voz y audición'],
    ['Gastroenterología', '🍽️', 'Aparato digestivo y hepatología'],
    ['Ginecología / Tocoginecología', '🌸', 'Control ginecológico y salud integral de la mujer'],
    ['Infectología', '🦠', 'Prevención, diagnóstico y tratamiento de infecciones'],
    ['Kinesiología y Fisiatría', '🏃', 'Rehabilitación física y terapia motora'],
    ['Nefrología', '💧', 'Salud renal y control de hipertensión renal'],
    ['Neumonología', '🫁', 'Sistema respiratorio, asma y alergias pulmonares'],
    ['Neurología', '⚡', 'Sistema nervioso, cefaleas y estudios neurológicos'],
    ['Obstetricia', '🤰', 'Control de embarazo y seguimiento prenatal'],
    ['Odontología', '🦷', 'Control general, limpieza y urgencias'],
    ['Oncología', '🎗️', 'Diagnóstico, seguimiento y tratamiento oncológico'],
    ['Pediatría', '👶', 'Control de niño sano y consultas pediátricas'],
    ['Psicología', '🧠', 'Psicoterapia, acompañamiento y salud emocional'],
    ['Psiquiatría', '💭', 'Evaluación y tratamiento médico en salud mental'],
    ['Reumatología', '🦵', 'Articulaciones, enfermedades autoinmunes y dolor crónico'],
    ['Traumatología y Ortopedia', '🦴', 'Lesiones deportivas, columna y articulaciones'],
    ['Urología', '🔬', 'Sistema urinario y salud urológica'],
  ];

  const insertIfMissing = db.prepare(`
    INSERT OR IGNORE INTO especialidades (nombre, icono, descripcion, activa)
    VALUES (?, ?, ?, 1)
  `);

  for (const [nombre, icono, desc] of catalog) {
    insertIfMissing.run(nombre, icono, desc);
  }
}

function makeScryptHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

function slugifyDoctorUsername(nombre) {
  const parts = String(nombre || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .trim()
    .split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0]}.${parts[parts.length - 1]}`;
  }
  return parts[0] || `medico${Date.now()}`;
}

function seedDefaultUsers() {
  const userCount = db.prepare('SELECT COUNT(*) AS c FROM usuarios').get().c;
  if (userCount > 0) return;

  const insertUser = db.prepare(`
    INSERT INTO usuarios (username, password_hash, nombre, rol, profesional_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  const adminPass = process.env.ADMIN_PASSWORD || 'admin123';
  insertUser.run('admin', makeScryptHash(adminPass), 'Administrador General', 'admin', null);

  // Crear automáticamente un usuario administrador de agenda para cada médico existente
  const doctors = db.prepare('SELECT id, nombre FROM profesionales ORDER BY id ASC').all();
  const used = new Set(['admin']);
  for (const doc of doctors) {
    let uname = slugifyDoctorUsername(doc.nombre);
    if (used.has(uname)) uname = `${uname}${doc.id}`;
    used.add(uname);
    insertUser.run(uname, makeScryptHash('medico123'), doc.nombre, 'profesional', doc.id);
  }
}

export function loadClinicSettings() {
  const rows = db.prepare('SELECT key, value FROM clinic_settings').all();
  for (const r of rows) {
    if (r.key === 'name' && r.value) config.clinic.name = r.value;
    if (r.key === 'address' && r.value) config.clinic.address = r.value;
    if (r.key === 'phone' && r.value) config.clinic.phone = r.value;
    if (r.key === 'wa_access_token' && r.value) config.whatsapp.accessToken = r.value;
    if (r.key === 'wa_phone_number_id' && r.value) config.whatsapp.phoneNumberId = r.value;
    if (r.key === 'wa_verify_token' && r.value) config.whatsapp.verifyToken = r.value;
    if (r.key === 'wa_reminder_template' && r.value) config.whatsapp.reminderTemplate = r.value;
    if (r.key === 'wa_reminder_lang' && r.value) config.whatsapp.reminderLang = r.value;
  }
}

export function saveWhatsAppSettings({
  accessToken,
  phoneNumberId,
  verifyToken,
  reminderTemplate,
  reminderLang,
}) {
  const stmt = db.prepare(
    `INSERT INTO clinic_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  if (accessToken !== undefined && String(accessToken).trim()) {
    const v = String(accessToken).trim();
    stmt.run('wa_access_token', v);
    config.whatsapp.accessToken = v;
  }
  if (phoneNumberId !== undefined && String(phoneNumberId).trim()) {
    const v = String(phoneNumberId).trim();
    stmt.run('wa_phone_number_id', v);
    config.whatsapp.phoneNumberId = v;
  }
  if (verifyToken !== undefined && String(verifyToken).trim()) {
    const v = String(verifyToken).trim();
    stmt.run('wa_verify_token', v);
    config.whatsapp.verifyToken = v;
  }
  if (reminderTemplate !== undefined && String(reminderTemplate).trim()) {
    const v = String(reminderTemplate).trim();
    stmt.run('wa_reminder_template', v);
    config.whatsapp.reminderTemplate = v;
  }
  if (reminderLang !== undefined && String(reminderLang).trim()) {
    const v = String(reminderLang).trim();
    stmt.run('wa_reminder_lang', v);
    config.whatsapp.reminderLang = v;
  }
}

export function clearWhatsAppSettings() {
  db.prepare(
    "DELETE FROM clinic_settings WHERE key IN ('wa_access_token', 'wa_phone_number_id')"
  ).run();
  config.whatsapp.accessToken = process.env.WHATSAPP_ACCESS_TOKEN || '';
  config.whatsapp.phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID || '';
}

export function saveClinicSettings({ name, address, phone }) {
  const stmt = db.prepare(
    `INSERT INTO clinic_settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  );
  if (name !== undefined && String(name).trim()) {
    const v = String(name).trim();
    stmt.run('name', v);
    config.clinic.name = v;
  }
  if (address !== undefined && String(address).trim()) {
    const v = String(address).trim();
    stmt.run('address', v);
    config.clinic.address = v;
  }
  if (phone !== undefined && String(phone).trim()) {
    const v = String(phone).trim();
    stmt.run('phone', v);
    config.clinic.phone = v;
  }
  return config.clinic;
}

function seedInitialData() {
  const count = db.prepare('SELECT COUNT(*) AS c FROM especialidades').get().c;
  if (count > 0) return;

  const insertEsp = db.prepare(
    'INSERT INTO especialidades (nombre, icono, descripcion) VALUES (?, ?, ?)'
  );

  const especialidades = [
    ['Clínica Médica', '🩺', 'Consultas generales, chequeos y certificados'],
    ['Cardiología', '❤️', 'Control cardiovascular y electrocardiogramas'],
    ['Pediatría', '👶', 'Control de niño sano y consultas pediátricas'],
    ['Traumatología', '🦴', 'Lesiones deportivas, columna y articulaciones'],
    ['Dermatología', '🧴', 'Cuidado de la piel, lunares y alergias'],
    ['Odontología', '🦷', 'Control general, limpieza y urgencias'],
  ];

  const espIds = {};
  for (const [nombre, icono, desc] of especialidades) {
    const res = insertEsp.run(nombre, icono, desc);
    espIds[nombre] = Number(res.lastInsertRowid);
  }

  const insertProf = db.prepare(`
    INSERT INTO profesionales
      (nombre, especialidad_id, matricula, duracion_turno_min, consultorio, google_calendar_id, obras_sociales)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const profesionales = [
    [
      'Dra. Laura Gómez',
      espIds['Clínica Médica'],
      'MN 124.510',
      30,
      'Consultorio 1 - Planta Baja',
      'dra.gomez@tuclinica.com',
      'Particular, OSDE, Swiss Medical, Galeno, Medifé, IOMA',
    ],
    [
      'Dr. Martín Silva',
      espIds['Clínica Médica'],
      'MN 131.820',
      30,
      'Consultorio 2 - Planta Baja',
      'dr.silva@tuclinica.com',
      'Particular, OSDE, Swiss Medical, Omint, PAMI',
    ],
    [
      'Dr. Carlos Pérez',
      espIds['Cardiología'],
      'MN 98.412',
      30,
      'Consultorio 4 - Piso 1',
      'dr.perez@tuclinica.com',
      'Particular, OSDE, Swiss Medical, Galeno',
    ],
    [
      'Dra. Sofía Morales',
      espIds['Pediatría'],
      'MN 145.300',
      30,
      'Consultorio 5 - Piso 1',
      'dra.morales@tuclinica.com',
      'Particular, OSDE, Swiss Medical, Medifé, IOMA',
    ],
    [
      'Dr. Diego Fernández',
      espIds['Pediatría'],
      'MN 140.115',
      20,
      'Consultorio 6 - Piso 1',
      'dr.fernandez@tuclinica.com',
      'Particular, OSDE, Galeno, Omint',
    ],
    [
      'Dr. Nicolás Castro',
      espIds['Traumatología'],
      'MN 119.774',
      30,
      'Consultorio 8 - Piso 2',
      'dr.castro@tuclinica.com',
      'Particular, OSDE, Swiss Medical, Galeno, IOMA',
    ],
    [
      'Dra. Valentina Ruiz',
      espIds['Dermatología'],
      'MN 152.900',
      20,
      'Consultorio 9 - Piso 2',
      'dra.ruiz@tuclinica.com',
      'Particular, OSDE, Swiss Medical, Omint',
    ],
    [
      'Od. Lucas Herrera',
      espIds['Odontología'],
      'MN 41.220',
      30,
      'Consultorio 10 - Piso 2',
      'od.herrera@tuclinica.com',
      'Particular, OSDE, Swiss Medical, Galeno',
    ],
  ];

  const insertHorario = db.prepare(`
    INSERT INTO horarios_atencion (profesional_id, dia_semana, hora_inicio, hora_fin)
    VALUES (?, ?, ?, ?)
  `);

  const schedulesByIndex = [
    // Dra. Laura Gómez: Lun-Vie mañana y tarde
    [
      [1, '09:00', '13:00'], [1, '15:00', '18:30'],
      [2, '09:00', '13:00'], [3, '09:00', '13:00'],
      [4, '14:00', '18:30'], [5, '09:00', '13:00'],
    ],
    // Dr. Martín Silva: Lun-Sáb
    [
      [1, '14:00', '19:00'], [2, '14:00', '19:00'],
      [3, '14:00', '19:00'], [4, '09:00', '13:00'],
      [5, '14:00', '18:00'], [6, '09:00', '12:30'],
    ],
    // Dr. Carlos Pérez: Lun, Mié, Vie
    [
      [1, '09:00', '13:00'], [3, '10:00', '16:00'], [5, '09:00', '13:00'],
    ],
    // Dra. Sofía Morales: Lun-Vie
    [
      [1, '09:00', '13:00'], [2, '09:00', '13:00'],
      [3, '14:00', '18:00'], [4, '09:00', '13:00'],
      [5, '09:00', '13:00'],
    ],
    // Dr. Diego Fernández: Mar, Jue, Sáb
    [
      [2, '14:00', '18:00'], [4, '14:00', '18:00'], [6, '09:00', '13:00'],
    ],
    // Dr. Nicolás Castro: Lun, Mar, Jue, Vie
    [
      [1, '15:00', '19:00'], [2, '09:00', '13:00'],
      [4, '15:00', '19:00'], [5, '09:00', '13:00'],
    ],
    // Dra. Valentina Ruiz: Mar, Mié, Jue
    [
      [2, '10:00', '14:00'], [3, '14:00', '18:00'], [4, '10:00', '14:00'],
    ],
    // Od. Lucas Herrera: Lun-Vie
    [
      [1, '09:00', '13:00'], [2, '14:00', '18:30'],
      [3, '09:00', '13:00'], [4, '14:00', '18:30'],
      [5, '09:00', '13:00'],
    ],
  ];

  profesionales.forEach((p, idx) => {
    const res = insertProf.run(...p);
    const profId = Number(res.lastInsertRowid);
    for (const [dia, ini, fin] of schedulesByIndex[idx]) {
      insertHorario.run(profId, dia, ini, fin);
    }
  });
}
