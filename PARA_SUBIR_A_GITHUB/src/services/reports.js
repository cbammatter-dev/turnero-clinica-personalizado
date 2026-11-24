import ExcelJS from 'exceljs';
import { db } from '../db/database.js';
import { config } from '../config.js';

/**
 * Base de datos completa de Pacientes (con conteo de atenciones y copagos).
 */
export function queryPatientsDatabase({ q = '', obraSocial = '' } = {}) {
  const conditions = [];
  const params = [];

  if (q && String(q).trim()) {
    const like = `%${String(q).trim()}%`;
    conditions.push(
      '(pa.dni LIKE ? OR LOWER(pa.nombre_completo) LIKE LOWER(?) OR LOWER(COALESCE(pa.localidad, \'\')) LIKE LOWER(?) OR LOWER(COALESCE(pa.domicilio, \'\')) LIKE LOWER(?))'
    );
    params.push(like, like, like, like);
  }
  if (obraSocial && String(obraSocial).trim()) {
    conditions.push('LOWER(pa.obra_social) = LOWER(?)');
    params.push(String(obraSocial).trim());
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT
         pa.*,
         (SELECT COUNT(*) FROM atenciones_clinicas ac WHERE ac.paciente_id = pa.id) AS total_atenciones,
         (SELECT MAX(ac.fecha_atencion) FROM atenciones_clinicas ac WHERE ac.paciente_id = pa.id) AS ultima_atencion,
         (SELECT COALESCE(SUM(ac.monto_copago), 0) FROM atenciones_clinicas ac WHERE ac.paciente_id = pa.id AND ac.abono_copago = 1) AS total_copagos
       FROM pacientes pa
       ${where}
       ORDER BY pa.nombre_completo ASC`
    )
    .all(...params);
}

/**
 * Base de datos completa de Profesionales (datos personales + atenciones realizadas + copagos).
 */
export function queryProfessionalsDatabase({ q = '' } = {}) {
  const conditions = ['pr.activo = 1'];
  const params = [];

  if (q && String(q).trim()) {
    const like = `%${String(q).trim()}%`;
    conditions.push(
      '(LOWER(pr.nombre) LIKE LOWER(?) OR COALESCE(pr.dni, \'\') LIKE ? OR LOWER(COALESCE(pr.matricula, \'\')) LIKE LOWER(?) OR LOWER(e.nombre) LIKE LOWER(?))'
    );
    params.push(like, like, like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  return db
    .prepare(
      `SELECT
         pr.*,
         e.nombre AS especialidad_nombre,
         e.icono AS especialidad_icono,
         (SELECT COUNT(*) FROM atenciones_clinicas ac WHERE ac.profesional_id = pr.id) AS total_atenciones,
         (SELECT COALESCE(SUM(ac.monto_copago), 0) FROM atenciones_clinicas ac WHERE ac.profesional_id = pr.id AND ac.abono_copago = 1) AS total_copagos
       FROM profesionales pr
       JOIN especialidades e ON e.id = pr.especialidad_id
       ${where}
       ORDER BY pr.nombre ASC`
    )
    .all(...params);
}

/**
 * Reporte de Atenciones Clínicas con Diagnósticos, Médico, Fecha y Copagos.
 */
export function queryAttentionsReport({
  desde = '',
  hasta = '',
  profesionalId = null,
  obraSocial = '',
  soloCopago = false,
  q = '',
} = {}) {
  const conditions = [];
  const params = [];

  if (desde) {
    conditions.push('substr(ac.fecha_atencion, 1, 10) >= ?');
    params.push(desde);
  }
  if (hasta) {
    conditions.push('substr(ac.fecha_atencion, 1, 10) <= ?');
    params.push(hasta);
  }
  if (profesionalId) {
    conditions.push('ac.profesional_id = ?');
    params.push(Number(profesionalId));
  }
  if (obraSocial) {
    conditions.push('LOWER(pa.obra_social) = LOWER(?)');
    params.push(String(obraSocial).trim());
  }
  if (soloCopago) {
    conditions.push('ac.abono_copago = 1');
  }
  if (q && String(q).trim()) {
    const like = `%${String(q).trim()}%`;
    conditions.push(
      '(LOWER(pa.nombre_completo) LIKE LOWER(?) OR pa.dni LIKE ? OR LOWER(COALESCE(ac.diagnostico, \'\')) LIKE LOWER(?) OR LOWER(COALESCE(ac.evolucion, \'\')) LIKE LOWER(?))'
    );
    params.push(like, like, like, like);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = db
    .prepare(
      `SELECT
         ac.*,
         pa.nombre_completo AS paciente_nombre,
         pa.dni AS paciente_dni,
         pa.fecha_nacimiento AS paciente_fecha_nac,
         pa.obra_social AS paciente_obra_social,
         pa.domicilio AS paciente_domicilio,
         pa.localidad AS paciente_localidad,
         pa.telefono_whatsapp AS paciente_whatsapp,
         COALESCE(pr.nombre, u.nombre, 'Profesional') AS profesional_nombre,
         COALESCE(pr.matricula, '') AS profesional_matricula,
         COALESCE(e.nombre, '') AS especialidad_nombre
       FROM atenciones_clinicas ac
       JOIN pacientes pa ON pa.id = ac.paciente_id
       LEFT JOIN profesionales pr ON pr.id = ac.profesional_id
       LEFT JOIN especialidades e ON e.id = pr.especialidad_id
       LEFT JOIN usuarios u ON u.id = ac.usuario_id
       ${where}
       ORDER BY ac.fecha_atencion DESC, ac.id DESC`
    )
    .all(...params);

  const summary = {
    totalAtenciones: rows.length,
    conCopago: rows.filter((r) => Number(r.abono_copago) === 1).length,
    montoTotalCopagos: rows.reduce(
      (acc, r) => acc + (Number(r.abono_copago) === 1 ? Number(r.monto_copago || 0) : 0),
      0
    ),
  };

  return { rows, summary };
}

function styleHeaderRow(sheet) {
  const row = sheet.getRow(1);
  row.height = 24;
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F766E' } };
    cell.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
  });
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
  sheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: sheet.columnCount },
  };
}

function addPatientsSheet(workbook, patients) {
  const sheet = workbook.addWorksheet('Pacientes');
  sheet.columns = [
    { header: 'Nombre y Apellido', key: 'nombre_completo', width: 26 },
    { header: 'DNI', key: 'dni', width: 14 },
    { header: 'Fecha de Nacimiento', key: 'fecha_nacimiento', width: 18 },
    { header: 'Obra Social', key: 'obra_social', width: 20 },
    { header: 'N° Afiliado', key: 'nro_afiliado', width: 16 },
    { header: 'Domicilio', key: 'domicilio', width: 28 },
    { header: 'Localidad', key: 'localidad', width: 20 },
    { header: 'WhatsApp', key: 'telefono_whatsapp', width: 18 },
    { header: 'Total Atenciones', key: 'total_atenciones', width: 16 },
    { header: 'Última Atención', key: 'ultima_atencion', width: 18 },
    { header: 'Total Copagos ($)', key: 'total_copagos', width: 18 },
  ];

  for (const p of patients) {
    sheet.addRow({
      nombre_completo: p.nombre_completo || '',
      dni: p.dni || '',
      fecha_nacimiento: p.fecha_nacimiento || '',
      obra_social: p.obra_social || 'Particular',
      nro_afiliado: p.nro_afiliado || '',
      domicilio: p.domicilio || '',
      localidad: p.localidad || '',
      telefono_whatsapp: p.telefono_whatsapp || '',
      total_atenciones: Number(p.total_atenciones || 0),
      ultima_atencion: p.ultima_atencion || '',
      total_copagos: Number(p.total_copagos || 0),
    });
  }

  sheet.getColumn('total_copagos').numFmt = '"$"#,##0.00';
  styleHeaderRow(sheet);
}

function addAttentionsSheet(workbook, rows) {
  const sheet = workbook.addWorksheet('Atenciones y Copagos');
  sheet.columns = [
    { header: 'Fecha de Atención', key: 'fecha_atencion', width: 18 },
    { header: 'Paciente', key: 'paciente_nombre', width: 24 },
    { header: 'DNI Paciente', key: 'paciente_dni', width: 14 },
    { header: 'Fecha Nac.', key: 'paciente_fecha_nac', width: 14 },
    { header: 'Obra Social', key: 'paciente_obra_social', width: 18 },
    { header: 'Domicilio', key: 'paciente_domicilio', width: 24 },
    { header: 'Localidad', key: 'paciente_localidad', width: 18 },
    { header: 'Médico que Atendió', key: 'profesional_nombre', width: 24 },
    { header: 'Especialidad', key: 'especialidad_nombre', width: 22 },
    { header: 'Motivo de Consulta', key: 'motivo_consulta', width: 22 },
    { header: 'Diagnóstico', key: 'diagnostico', width: 28 },
    { header: 'Evolución / Descripción', key: 'evolucion', width: 38 },
    { header: 'Indicaciones', key: 'indicaciones', width: 28 },
    { header: 'Abonó Copago', key: 'abono_copago_txt', width: 15 },
    { header: 'Monto Copago ($)', key: 'monto_copago', width: 18 },
    { header: 'Medio de Pago', key: 'medio_pago', width: 16 },
    { header: 'Receta Electrónica', key: 'receta', width: 24 },
  ];

  let totalCopagos = 0;
  for (const r of rows) {
    const pago = Number(r.abono_copago) === 1;
    const monto = pago ? Number(r.monto_copago || 0) : 0;
    totalCopagos += monto;
    sheet.addRow({
      fecha_atencion: r.fecha_atencion || '',
      paciente_nombre: r.paciente_nombre || '',
      paciente_dni: r.paciente_dni || '',
      paciente_fecha_nac: r.paciente_fecha_nac || '',
      paciente_obra_social: r.paciente_obra_social || 'Particular',
      paciente_domicilio: r.paciente_domicilio || '',
      paciente_localidad: r.paciente_localidad || '',
      profesional_nombre: r.profesional_nombre || '',
      especialidad_nombre: r.especialidad_nombre || '',
      motivo_consulta: r.motivo_consulta || '',
      diagnostico: r.diagnostico || '',
      evolucion: r.evolucion || '',
      indicaciones: r.indicaciones || '',
      abono_copago_txt: pago ? 'Sí' : 'No',
      monto_copago: monto,
      medio_pago: pago ? r.medio_pago || '' : '',
      receta: [r.receta_plataforma, r.receta_codigo].filter(Boolean).join(' - '),
    });
  }

  // Fila de total al final
  if (rows.length > 0) {
    const totalRow = sheet.addRow({
      fecha_atencion: 'TOTAL',
      paciente_nombre: `${rows.length} atenciones`,
      abono_copago_txt: `${rows.filter((x) => Number(x.abono_copago) === 1).length} con copago`,
      monto_copago: totalCopagos,
    });
    totalRow.font = { bold: true };
  }

  sheet.getColumn('monto_copago').numFmt = '"$"#,##0.00';
  styleHeaderRow(sheet);
}

function addProfessionalsSheet(workbook, professionals) {
  const sheet = workbook.addWorksheet('Profesionales');
  sheet.columns = [
    { header: 'Nombre y Apellido', key: 'nombre', width: 26 },
    { header: 'DNI', key: 'dni', width: 14 },
    { header: 'Fecha de Nacimiento', key: 'fecha_nacimiento', width: 18 },
    { header: 'Matrícula', key: 'matricula', width: 16 },
    { header: 'Especialidad', key: 'especialidad_nombre', width: 24 },
    { header: 'Domicilio', key: 'domicilio', width: 28 },
    { header: 'Localidad', key: 'localidad', width: 20 },
    { header: 'Teléfono', key: 'telefono', width: 16 },
    { header: 'Email', key: 'email', width: 24 },
    { header: 'Consultorio', key: 'consultorio', width: 22 },
    { header: 'Obras Sociales que Trabaja', key: 'obras_sociales', width: 36 },
    { header: 'Atenciones Realizadas', key: 'total_atenciones', width: 20 },
    { header: 'Copagos Recaudados ($)', key: 'total_copagos', width: 22 },
  ];

  for (const p of professionals) {
    sheet.addRow({
      nombre: p.nombre || '',
      dni: p.dni || '',
      fecha_nacimiento: p.fecha_nacimiento || '',
      matricula: p.matricula || '',
      especialidad_nombre: p.especialidad_nombre || '',
      domicilio: p.domicilio || '',
      localidad: p.localidad || '',
      telefono: p.telefono || '',
      email: p.email || '',
      consultorio: p.consultorio || '',
      obras_sociales: p.obras_sociales || '',
      total_atenciones: Number(p.total_atenciones || 0),
      total_copagos: Number(p.total_copagos || 0),
    });
  }

  sheet.getColumn('total_copagos').numFmt = '"$"#,##0.00';
  styleHeaderRow(sheet);
}

/**
 * Genera el buffer binario de un archivo Excel (.xlsx) real.
 * type = 'completo' | 'pacientes' | 'atenciones' | 'profesionales'
 */
export async function buildExcelReportBuffer(type = 'completo', filters = {}) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = config.clinic.name;
  workbook.created = new Date();

  if (type === 'pacientes') {
    addPatientsSheet(workbook, queryPatientsDatabase(filters));
  } else if (type === 'atenciones') {
    const { rows } = queryAttentionsReport(filters);
    addAttentionsSheet(workbook, rows);
  } else if (type === 'profesionales') {
    addProfessionalsSheet(workbook, queryProfessionalsDatabase(filters));
  } else {
    // Reporte completo con las 3 hojas listas para filtrar y auditar
    addPatientsSheet(workbook, queryPatientsDatabase({}));
    const { rows } = queryAttentionsReport(filters);
    addAttentionsSheet(workbook, rows);
    addProfessionalsSheet(workbook, queryProfessionalsDatabase({}));
  }

  return workbook.xlsx.writeBuffer();
}
