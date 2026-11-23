import { db, listObrasSociales } from '../db/database.js';
import { config } from '../config.js';
import {
  findPatientByDni,
  findPatientByPhone,
  listAppointments,
  createAppointment,
  confirmAppointment,
  cancelAppointment,
  rescheduleAppointment,
  getAppointmentById,
} from './appointments.js';
import {
  listSpecialties,
  listDoctorsBySpecialty,
  getDoctorById,
  getAvailableDays,
  getAvailableSlotsForDoctor,
  getAvailableSlotsForSpecialty,
} from './availability.js';
import {
  formatDateFriendly,
  getClinicNow,
  normalizeDni,
  normalizePhone,
} from '../utils/datetime.js';

function getSession(sessionKey) {
  const row = db
    .prepare('SELECT step, data, error_count FROM bot_sessions WHERE session_key = ?')
    .get(sessionKey);
  if (!row) {
    return { step: 'menu', data: {}, errorCount: 0 };
  }
  let parsed = {};
  try {
    parsed = JSON.parse(row.data);
  } catch {
    parsed = {};
  }
  return {
    step: row.step,
    data: parsed,
    errorCount: row.error_count || 0,
  };
}

function saveSession(sessionKey, step, data = {}, errorCount = 0) {
  db.prepare(
    `INSERT INTO bot_sessions (session_key, step, data, error_count, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(session_key) DO UPDATE SET
       step = excluded.step,
       data = excluded.data,
       error_count = excluded.error_count,
       updated_at = CURRENT_TIMESTAMP`
  ).run(sessionKey, step, JSON.stringify(data), errorCount);
}

export function resetSession(sessionKey) {
  saveSession(sessionKey, 'menu', {}, 0);
}

function welcomeMenuReply() {
  return {
    text:
      `¡Hola! 👋 Soy el asistente de turnos de *${config.clinic.name}*.\n` +
      `Te ayudo en segundos, sin esperas.\n\n` +
      `¿Qué necesitás hacer hoy?`,
    list: {
      buttonText: 'Elegir una opción',
      sectionTitle: 'Menú principal',
      rows: [
        { id: 'MENU_BOOK', title: '📅 Sacar un turno nuevo', description: 'Elegí especialidad, día y horario' },
        { id: 'MENU_MANAGE', title: '🔄 Ver o cambiar mi turno', description: 'Confirmá o reprogramá tu turno' },
        { id: 'MENU_CANCEL', title: '❌ Cancelar un turno', description: 'Liberá tu horario si no podés venir' },
        { id: 'MENU_HUMAN', title: '💬 Hablar con recepción', description: 'Te comunicamos con una persona' },
      ],
    },
  };
}

function receptionHandoffReply() {
  return {
    text:
      `💬 *Derivación a Recepción*\n\n` +
      `Nuestro equipo de recepción de *${config.clinic.name}* te puede ayudar directamente:\n` +
      `📞 Teléfono: *${config.clinic.phone}*\n` +
      `📍 Dirección: ${config.clinic.address}\n` +
      `🕐 Horario de atención: Lunes a Viernes de 8:30 a 19:30 hs, Sábados de 9:00 a 13:00 hs.\n\n` +
      `Cuando quieras volver a sacar o gestionar un turno por acá, tocá el botón de abajo:`,
    buttons: [{ id: 'MENU_MAIN', title: '🏠 Menú principal' }],
  };
}

/**
 * Procesa cualquier mensaje entrante (WhatsApp real, Simulador WhatsApp o Chat Web)
 * y devuelve un array de mensajes de respuesta con texto, botones o listas.
 */
export async function handleIncomingBotMessage({
  channel = 'whatsapp',
  userId,
  phone = null,
  text = '',
  actionId = null,
}) {
  const cleanPhone = normalizePhone(phone || userId);
  const sessionKey = `${channel}:${cleanPhone || userId}`;
  const rawInput = String(actionId || text || '').trim();
  const lower = rawInput.toLowerCase();

  // 1) Acciones directas desde el recordatorio 24 hs (funcionan en cualquier momento)
  if (rawInput.startsWith('REM_CONFIRM_')) {
    const apptId = Number(rawInput.replace('REM_CONFIRM_', ''));
    return handleReminderConfirm(sessionKey, apptId);
  }
  if (rawInput.startsWith('REM_MODIFY_')) {
    const apptId = Number(rawInput.replace('REM_MODIFY_', ''));
    return handleStartReschedule(sessionKey, apptId);
  }
  if (rawInput.startsWith('REM_CANCEL_')) {
    const apptId = Number(rawInput.replace('REM_CANCEL_', ''));
    return handleDirectCancel(sessionKey, apptId);
  }

  // 2) Comandos globales de reinicio o ayuda humana
  const greetings = ['hola', 'buenas', 'buen dia', 'buen día', 'buenos dias', 'buenos días', 'buenas tardes', 'buenas noches', 'menu', 'menú', 'inicio', 'empezar', '0'];
  if (rawInput === 'MENU_MAIN' || greetings.includes(lower)) {
    resetSession(sessionKey);
    return [welcomeMenuReply()];
  }
  if (rawInput === 'MENU_HUMAN' || lower === 'recepcion' || lower === 'recepción' || lower === 'humano') {
    resetSession(sessionKey);
    return [receptionHandoffReply()];
  }

  const session = getSession(sessionKey);

  // 3) Router por paso de la conversación
  switch (session.step) {
    case 'menu':
      return handleMenuStep(sessionKey, rawInput, lower, cleanPhone);

    case 'confirm_identity':
      return handleConfirmIdentityStep(sessionKey, session.data, rawInput, lower);

    case 'ask_dni':
      return handleAskDniStep(sessionKey, session.data, rawInput, cleanPhone);

    case 'ask_name':
      return handleAskNameStep(sessionKey, session.data, rawInput);

    case 'ask_phone':
      return handleAskPhoneStep(sessionKey, session.data, rawInput);

    case 'ask_obra_social':
      return handleAskObraSocialStep(sessionKey, session.data, rawInput);

    case 'choose_specialty':
      return handleChooseSpecialtyStep(sessionKey, session.data, rawInput);

    case 'choose_doctor':
      return handleChooseDoctorStep(sessionKey, session.data, rawInput);

    case 'choose_day':
      return handleChooseDayStep(sessionKey, session.data, rawInput);

    case 'choose_time':
      return handleChooseTimeStep(sessionKey, session.data, rawInput);

    case 'confirm_booking':
      return handleConfirmBookingStep(sessionKey, session.data, rawInput, channel);

    case 'manage_ask_dni':
      return handleManageAskDniStep(sessionKey, session.data, rawInput);

    case 'manage_select_appt':
      return handleManageSelectApptStep(sessionKey, session.data, rawInput);

    case 'manage_action':
      return handleManageActionStep(sessionKey, session.data, rawInput);

    case 'confirm_cancel':
      return handleConfirmCancelStep(sessionKey, session.data, rawInput);

    case 'reschedule_day':
      return handleRescheduleDayStep(sessionKey, session.data, rawInput);

    case 'reschedule_time':
      return handleRescheduleTimeStep(sessionKey, session.data, rawInput);

    case 'reschedule_confirm':
      return handleRescheduleConfirmStep(sessionKey, session.data, rawInput);

    default:
      resetSession(sessionKey);
      return [welcomeMenuReply()];
  }
}

/* ============================================================
 * MENÚ Y CAPTURA DE DATOS DEL PACIENTE
 * ============================================================ */

async function handleMenuStep(sessionKey, rawInput, lower, cleanPhone) {
  if (rawInput === 'MENU_BOOK' || rawInput === '1' || lower.includes('sacar') || lower.includes('nuevo')) {
    // Si reconocemos al paciente por su WhatsApp, le ahorramos escribir sus datos
    const known = cleanPhone ? findPatientByPhone(cleanPhone) : null;
    if (known) {
      saveSession(sessionKey, 'confirm_identity', {
        knownPatient: known,
        phone: cleanPhone,
      });
      return [
        {
          text:
            `¡Qué bueno verte de nuevo! 😊\n` +
            `¿El turno es para *${known.nombre_completo}* (DNI ${known.dni} — ${known.obra_social})?`,
          buttons: [
            { id: 'ID_YES', title: '✅ Sí, soy yo' },
            { id: 'ID_CHANGE_OS', title: '🏥 Cambiar cobertura' },
            { id: 'ID_OTHER', title: '👤 Es otra persona' },
          ],
        },
      ];
    }

    saveSession(sessionKey, 'ask_dni', { phone: cleanPhone });
    return [
      {
        text: `¡Perfecto! Para empezar, escribime el *DNI del paciente* (solo números, sin puntos).`,
      },
    ];
  }

  if (rawInput === 'MENU_MANAGE' || rawInput === '2' || lower.includes('ver') || lower.includes('cambiar') || lower.includes('modificar')) {
    return startManageFlow(sessionKey, cleanPhone, 'manage');
  }

  if (rawInput === 'MENU_CANCEL' || rawInput === '3' || lower.includes('cancelar')) {
    return startManageFlow(sessionKey, cleanPhone, 'cancel');
  }

  if (rawInput === '4') {
    resetSession(sessionKey);
    return [receptionHandoffReply()];
  }

  return [
    {
      text: `No entendí esa opción 😅. Elegí una de las opciones del menú para que te pueda ayudar:`,
      list: welcomeMenuReply().list,
    },
  ];
}

async function handleConfirmIdentityStep(sessionKey, data, rawInput, lower) {
  if (rawInput === 'ID_YES' || lower === 'si' || lower === 'sí' || rawInput === '1') {
    const p = data.knownPatient;
    const nextData = {
      dni: p.dni,
      nombreCompleto: p.nombre_completo,
      telefonoWhatsapp: p.telefono_whatsapp,
      obraSocial: p.obra_social,
    };
    return showSpecialtiesStep(sessionKey, nextData, 0);
  }

  if (rawInput === 'ID_CHANGE_OS' || lower.includes('cobertura') || lower.includes('obra')) {
    const p = data.knownPatient;
    const nextData = {
      dni: p.dni,
      nombreCompleto: p.nombre_completo,
      telefonoWhatsapp: p.telefono_whatsapp,
      phone: p.telefono_whatsapp,
    };
    return showObraSocialStep(sessionKey, nextData, 0);
  }

  if (rawInput === 'ID_OTHER' || lower.includes('otra') || rawInput === '2') {
    saveSession(sessionKey, 'ask_dni', { phone: data.phone });
    return [
      {
        text: `¡Dale! Escribime el *DNI del paciente* (solo números, sin puntos).`,
      },
    ];
  }

  return [
    {
      text: `Elegí una de las opciones por favor:`,
      buttons: [
        { id: 'ID_YES', title: '✅ Sí, soy yo' },
        { id: 'ID_CHANGE_OS', title: '🏥 Cambiar cobertura' },
        { id: 'ID_OTHER', title: '👤 Es otra persona' },
      ],
    },
  ];
}

async function handleAskDniStep(sessionKey, data, rawInput, cleanPhone) {
  const dni = normalizeDni(rawInput);
  if (dni.length < 6 || dni.length > 10) {
    return incrementErrorOrReply(
      sessionKey,
      'ask_dni',
      data,
      `Ese DNI no parece válido. Escribilo usando *solo números* (ej: 32456789).`
    );
  }

  const existing = findPatientByDni(dni);
  if (existing) {
    const nextData = {
      dni: existing.dni,
      nombreCompleto: existing.nombre_completo,
      telefonoWhatsapp: cleanPhone || existing.telefono_whatsapp,
      obraSocial: existing.obra_social,
    };
    const [specReply] = await showSpecialtiesStep(sessionKey, nextData);
    return [
      {
        text: `¡Hola, *${existing.nombre_completo}*! Ya te encontré en nuestro sistema (${existing.obra_social}).`,
      },
      specReply,
    ];
  }

  saveSession(sessionKey, 'ask_name', { ...data, dni });
  return [
    {
      text: `¡Gracias! Como es tu primera vez, escribime tu *Nombre y Apellido* completo:`,
    },
  ];
}

async function handleAskNameStep(sessionKey, data, rawInput) {
  const name = rawInput.trim();
  if (name.length < 3 || !/[a-zA-ZáéíóúñÁÉÍÓÚÑ]/.test(name)) {
    return incrementErrorOrReply(
      sessionKey,
      'ask_name',
      data,
      `Por favor escribime tu *Nombre y Apellido* (por ejemplo: Juan Pérez).`
    );
  }

  const nextData = { ...data, nombreCompleto: name };

  // Si viene del chat web y todavía no tenemos su WhatsApp, se lo pedimos para el recordatorio 24h
  if (!nextData.phone || nextData.phone.length < 8) {
    saveSession(sessionKey, 'ask_phone', nextData);
    return [
      {
        text: `¿Cuál es tu número de *WhatsApp* (con código de área)?\nTe vamos a mandar el recordatorio 24 hs antes ahí 📱.`,
      },
    ];
  }

  nextData.telefonoWhatsapp = nextData.phone;
  return showObraSocialStep(sessionKey, nextData);
}

async function handleAskPhoneStep(sessionKey, data, rawInput) {
  const phone = normalizePhone(rawInput);
  if (phone.length < 8) {
    return incrementErrorOrReply(
      sessionKey,
      'ask_phone',
      data,
      `Ingresá un número de WhatsApp válido (por ejemplo: 1155667788).`
    );
  }
  const nextData = { ...data, phone, telefonoWhatsapp: phone };
  return showObraSocialStep(sessionKey, nextData);
}

function stripAccents(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function showObraSocialStep(sessionKey, data, page = 0) {
  const all = listObrasSociales();
  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(all.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const slice = all.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const rows = slice.map((o) => ({
    id: `OS_${o.nombre}`,
    title: o.nombre,
  }));

  if (safePage + 1 < totalPages) {
    rows.push({
      id: 'OS_MORE',
      title: '➡️ Ver más obras sociales',
      description: `Página ${safePage + 2} de ${totalPages}`,
    });
  }
  if (safePage > 0) {
    rows.push({
      id: 'OS_PREV',
      title: '⬅️ Anteriores',
      description: `Volver a página ${safePage}`,
    });
  }

  saveSession(sessionKey, 'ask_obra_social', {
    ...data,
    osPage: safePage,
    offeredOs: slice.map((o) => o.nombre),
  });

  return [
    {
      text:
        `¿Con qué *Obra Social o Prepaga* te atendés?` +
        (totalPages > 1 ? ` _(página ${safePage + 1} de ${totalPages})_` : '') +
        `\nElegí una opción de la lista o escribí el nombre de tu cobertura:`,
      list: {
        buttonText: 'Elegir cobertura',
        sectionTitle: 'Obras Sociales y Prepagas',
        rows,
      },
    },
  ];
}

async function handleAskObraSocialStep(sessionKey, data, rawInput) {
  if (rawInput === 'OS_MORE') {
    return showObraSocialStep(sessionKey, data, (data.osPage || 0) + 1);
  }
  if (rawInput === 'OS_PREV') {
    return showObraSocialStep(sessionKey, data, (data.osPage || 0) - 1);
  }

  let obraSocial = '';
  if (rawInput.startsWith('OS_')) {
    obraSocial = rawInput.replace('OS_', '');
  } else if (/^\d+$/.test(rawInput) && Array.isArray(data.offeredOs)) {
    obraSocial = data.offeredOs[Number(rawInput) - 1] || '';
  } else {
    // Si escribió el nombre, buscar coincidencia en la lista o usar el texto que escribió
    const all = listObrasSociales();
    const norm = stripAccents(rawInput.trim());
    const found = all.find((o) => stripAccents(o.nombre) === norm || stripAccents(o.nombre).includes(norm));
    obraSocial = found ? found.nombre : rawInput.trim();
  }

  if (obraSocial.length < 2) {
    return showObraSocialStep(sessionKey, data, data.osPage || 0);
  }

  return showSpecialtiesStep(sessionKey, { ...data, obraSocial }, 0);
}

/* ============================================================
 * SELECCIÓN DE ESPECIALIDAD, PROFESIONAL, DÍA Y HORARIO
 * ============================================================ */

async function showSpecialtiesStep(sessionKey, data, page = 0) {
  const specialties = listSpecialties({ includeEmpty: true });
  const pageSize = 8;
  const totalPages = Math.max(1, Math.ceil(specialties.length / pageSize));
  const safePage = Math.max(0, Math.min(page, totalPages - 1));
  const slice = specialties.slice(safePage * pageSize, (safePage + 1) * pageSize);

  const rows = slice.map((s) => ({
    id: `SPEC_${s.id}`,
    title: `${s.icono} ${s.nombre}`,
    description:
      s.total_profesionales > 0
        ? `${s.total_profesionales} ${s.total_profesionales === 1 ? 'profesional disponible' : 'profesionales disponibles'}`
        : s.descripcion || 'Consultar disponibilidad',
  }));

  if (safePage + 1 < totalPages) {
    rows.push({
      id: 'SPEC_MORE',
      title: '➡️ Ver más especialidades',
      description: `Página ${safePage + 2} de ${totalPages} (${specialties.length} en total)`,
    });
  }
  if (safePage > 0) {
    rows.push({
      id: 'SPEC_PREV',
      title: '⬅️ Especialidades anteriores',
      description: `Volver a página ${safePage}`,
    });
  }

  saveSession(sessionKey, 'choose_specialty', {
    ...data,
    specPage: safePage,
    offeredSpecIds: slice.map((s) => s.id),
  });

  return [
    {
      text:
        `Elegí la *especialidad* para tu turno` +
        (totalPages > 1 ? ` _(página ${safePage + 1} de ${totalPages})_` : '') +
        `:\n_(También podés escribir el nombre, ej: Psicología o Ginecología)_`,
      list: {
        buttonText: 'Ver especialidades',
        sectionTitle: `Especialidades (${safePage + 1}/${totalPages})`,
        rows,
      },
    },
  ];
}

async function handleChooseSpecialtyStep(sessionKey, data, rawInput) {
  if (rawInput === 'SPEC_MORE') {
    return showSpecialtiesStep(sessionKey, data, (data.specPage || 0) + 1);
  }
  if (rawInput === 'SPEC_PREV') {
    return showSpecialtiesStep(sessionKey, data, (data.specPage || 0) - 1);
  }
  if (rawInput === 'SPEC_RETRY') {
    return showSpecialtiesStep(sessionKey, data, 0);
  }

  const specialties = listSpecialties({ includeEmpty: true });
  let selected = null;

  if (rawInput.startsWith('SPEC_')) {
    const id = Number(rawInput.replace('SPEC_', ''));
    selected = specialties.find((s) => s.id === id);
  } else if (/^\d+$/.test(rawInput) && Array.isArray(data.offeredSpecIds)) {
    const id = data.offeredSpecIds[Number(rawInput) - 1];
    selected = specialties.find((s) => s.id === id);
  } else {
    const normInput = stripAccents(rawInput);
    selected = specialties.find((s) => stripAccents(s.nombre).includes(normInput));
  }

  if (!selected) {
    return incrementErrorOrReply(
      sessionKey,
      'choose_specialty',
      data,
      `No encontré esa especialidad. Elegí una de la lista o escribí su nombre:`,
      (await showSpecialtiesStep(sessionKey, data, data.specPage || 0))[0].list
    );
  }

  const doctors = listDoctorsBySpecialty(selected.id);
  const nextData = {
    ...data,
    especialidadId: selected.id,
    especialidadNombre: selected.nombre,
  };

  // Si la especialidad existe pero todavía no tiene un médico cargado con agenda
  if (doctors.length === 0) {
    saveSession(sessionKey, 'choose_specialty', data);
    return [
      {
        text:
          `Todavía no hay turnos online cargados para *${selected.icono} ${selected.nombre}*.\n` +
          `Podés elegir otra especialidad o hablar con recepción para coordinar tu turno:`,
        buttons: [
          { id: 'SPEC_RETRY', title: '📅 Otra especialidad' },
          { id: 'MENU_HUMAN', title: '💬 Hablar con recepción' },
          { id: 'MENU_MAIN', title: '🏠 Menú principal' },
        ],
      },
    ];
  }

  // Si solo hay un médico en esa especialidad, ir directo a elegir día
  if (doctors.length === 1) {
    nextData.profesionalId = doctors[0].id;
    nextData.profesionalNombre = doctors[0].nombre;
    nextData.anyDoctor = false;
    nextData.dayOffset = 0;
    return showDaysStep(sessionKey, nextData);
  }

  saveSession(sessionKey, 'choose_doctor', nextData);
  return [
    {
      text: `Excelente, *${selected.nombre}*. ¿Con qué profesional preferís atenderte?`,
      list: {
        buttonText: 'Elegir profesional',
        sectionTitle: selected.nombre,
        rows: [
          {
            id: 'DOC_ANY',
            title: '⚡ Primer turno libre',
            description: 'Cualquier profesional disponible más pronto',
          },
          ...doctors.map((d) => ({
            id: `DOC_${d.id}`,
            title: d.nombre,
            description: `${d.consultorio} • Turnos de ${d.duracion_turno_min} min`,
          })),
        ],
      },
    },
  ];
}

async function handleChooseDoctorStep(sessionKey, data, rawInput) {
  const doctors = listDoctorsBySpecialty(data.especialidadId);

  if (rawInput === 'DOC_ANY' || rawInput === '1' || rawInput.toLowerCase().includes('primer') || rawInput.toLowerCase().includes('cualquier')) {
    return showDaysStep(sessionKey, {
      ...data,
      anyDoctor: true,
      profesionalId: null,
      profesionalNombre: 'Cualquier profesional disponible',
      dayOffset: 0,
    });
  }

  let selected = null;
  if (rawInput.startsWith('DOC_')) {
    const id = Number(rawInput.replace('DOC_', ''));
    selected = doctors.find((d) => d.id === id);
  } else if (/^\d+$/.test(rawInput)) {
    selected = doctors[Number(rawInput) - 2];
  } else {
    selected = doctors.find((d) =>
      d.nombre.toLowerCase().includes(rawInput.toLowerCase())
    );
  }

  if (!selected) {
    return incrementErrorOrReply(
      sessionKey,
      'choose_doctor',
      data,
      `No reconocí ese profesional. Elegí uno de la lista o tocá "Primer turno libre".`
    );
  }

  return showDaysStep(sessionKey, {
    ...data,
    anyDoctor: false,
    profesionalId: selected.id,
    profesionalNombre: selected.nombre,
    dayOffset: 0,
  });
}

async function showDaysStep(sessionKey, data, isReschedule = false) {
  const offset = data.dayOffset || 0;
  const days = await getAvailableDays({
    doctorId: data.anyDoctor ? null : data.profesionalId,
    specialtyId: data.anyDoctor ? data.especialidadId : null,
    limitDays: 5,
    offsetDays: offset,
    excludeAppointmentId: isReschedule ? data.rescheduleApptId : null,
  });

  if (days.length === 0) {
    if (offset > 0) {
      return showDaysStep(sessionKey, { ...data, dayOffset: 0 }, isReschedule);
    }
    resetSession(sessionKey);
    return [
      {
        text: `Por el momento no quedan turnos disponibles para esa agenda en los próximos ${config.clinic.bookingWindowDays} días 😔.\nPodés probar con otra especialidad o hablar con recepción.`,
        buttons: [
          { id: 'MENU_BOOK', title: '📅 Otra especialidad' },
          { id: 'MENU_HUMAN', title: '💬 Recepción' },
        ],
      },
    ];
  }

  const nextStep = isReschedule ? 'reschedule_day' : 'choose_day';
  saveSession(sessionKey, nextStep, { ...data, offeredDays: days });

  const rows = days.map((d) => ({
    id: `DAY_${d.fecha}`,
    title: `📅 ${d.label}`,
    description: `${d.total_horarios} horarios disponibles`,
  }));

  rows.push({
    id: 'DAYS_MORE',
    title: '➡️ Ver más fechas',
    description: 'Mostrar próximos días disponibles',
  });

  const heading = isReschedule
    ? `Elegí el *nuevo día* para tu turno con *${data.profesionalNombre}*:`
    : `Elegí el *día* que te quede más cómodo (${data.profesionalNombre}):`;

  return [
    {
      text: heading,
      list: {
        buttonText: 'Elegir día',
        sectionTitle: 'Días con turno libre',
        rows,
      },
    },
  ];
}

async function handleChooseDayStep(sessionKey, data, rawInput) {
  if (rawInput === 'DAYS_MORE') {
    return showDaysStep(sessionKey, { ...data, dayOffset: (data.dayOffset || 0) + 5 });
  }

  const fecha = resolveSelectedDay(data.offeredDays || [], rawInput);
  if (!fecha) {
    return incrementErrorOrReply(
      sessionKey,
      'choose_day',
      data,
      `Elegí uno de los días de la lista por favor.`
    );
  }

  return showTimesStep(sessionKey, { ...data, fecha, timeOffset: 0 });
}

function resolveSelectedDay(offeredDays, rawInput) {
  if (rawInput.startsWith('DAY_')) {
    return rawInput.replace('DAY_', '');
  }
  if (/^\d+$/.test(rawInput)) {
    const idx = Number(rawInput) - 1;
    if (offeredDays[idx]) return offeredDays[idx].fecha;
  }
  const match = offeredDays.find(
    (d) => d.fecha === rawInput || d.label.toLowerCase().includes(rawInput.toLowerCase())
  );
  return match ? match.fecha : null;
}

async function showTimesStep(sessionKey, data, isReschedule = false) {
  const allSlots = data.anyDoctor
    ? await getAvailableSlotsForSpecialty(data.especialidadId, data.fecha)
    : await getAvailableSlotsForDoctor(data.profesionalId, data.fecha, {
        excludeAppointmentId: isReschedule ? data.rescheduleApptId : null,
      });

  if (allSlots.length === 0) {
    return showDaysStep(sessionKey, { ...data, dayOffset: 0 }, isReschedule);
  }

  const offset = data.timeOffset || 0;
  const pageSize = 7;
  const pageSlots = allSlots.slice(offset, offset + pageSize);
  const hasMore = offset + pageSize < allSlots.length;

  const nextStep = isReschedule ? 'reschedule_time' : 'choose_time';
  saveSession(sessionKey, nextStep, { ...data, offeredSlots: pageSlots });

  const rows = pageSlots.map((s) => ({
    id: `SLOT_${s.profesional_id}_${s.hora_inicio}`,
    title: `⏰ ${s.hora_inicio} hs`,
    description: data.anyDoctor ? `${s.profesional_nombre} (${s.periodo})` : `Turno de ${s.periodo} • ${s.consultorio}`,
  }));

  if (hasMore) {
    rows.push({
      id: 'TIMES_MORE',
      title: '➡️ Ver más horarios',
      description: 'Horarios más tarde ese mismo día',
    });
  }

  rows.push({
    id: 'BACK_DAYS',
    title: '⬅️ Elegir otro día',
    description: 'Volver a la lista de fechas',
  });

  return [
    {
      text: `Horarios disponibles para el *${formatDateFriendly(data.fecha)}*:`,
      list: {
        buttonText: 'Elegir horario',
        sectionTitle: formatDateFriendly(data.fecha),
        rows,
      },
    },
  ];
}

function resolveSelectedSlot(offeredSlots, rawInput) {
  if (rawInput.startsWith('SLOT_')) {
    const [, profId, hora] = rawInput.split('_');
    return offeredSlots.find(
      (s) => String(s.profesional_id) === profId && s.hora_inicio === hora
    );
  }
  if (/^\d+$/.test(rawInput)) {
    return offeredSlots[Number(rawInput) - 1] || null;
  }
  return offeredSlots.find((s) => s.hora_inicio === rawInput) || null;
}

async function handleChooseTimeStep(sessionKey, data, rawInput) {
  if (rawInput === 'TIMES_MORE') {
    return showTimesStep(sessionKey, { ...data, timeOffset: (data.timeOffset || 0) + 7 });
  }
  if (rawInput === 'BACK_DAYS') {
    return showDaysStep(sessionKey, { ...data, dayOffset: 0 });
  }

  const slot = resolveSelectedSlot(data.offeredSlots || [], rawInput);
  if (!slot) {
    return incrementErrorOrReply(
      sessionKey,
      'choose_time',
      data,
      `Elegí uno de los horarios disponibles de la lista por favor.`
    );
  }

  const doctor = getDoctorById(slot.profesional_id);
  const nextData = {
    ...data,
    profesionalId: doctor.id,
    profesionalNombre: doctor.nombre,
    consultorio: doctor.consultorio,
    horaInicio: slot.hora_inicio,
  };

  saveSession(sessionKey, 'confirm_booking', nextData);

  return [
    {
      text:
        `Revisá que esté todo bien antes de confirmar:\n\n` +
        `👤 *Paciente:* ${nextData.nombreCompleto} (DNI ${nextData.dni})\n` +
        `🏥 *Cobertura:* ${nextData.obraSocial}\n` +
        `🩺 *Profesional:* ${nextData.profesionalNombre} (${nextData.especialidadNombre})\n` +
        `📅 *Día:* ${formatDateFriendly(nextData.fecha)}\n` +
        `⏰ *Hora:* ${nextData.horaInicio} hs\n` +
        `📍 *Lugar:* ${nextData.consultorio} — ${config.clinic.address}\n\n` +
        `¿Confirmamos este turno?`,
      buttons: [
        { id: 'BOOK_YES', title: '✅ Confirmar turno' },
        { id: 'BOOK_CHANGE', title: '🔄 Cambiar horario' },
        { id: 'MENU_MAIN', title: '❌ Cancelar' },
      ],
    },
  ];
}

async function handleConfirmBookingStep(sessionKey, data, rawInput, channel) {
  if (rawInput === 'BOOK_CHANGE') {
    return showDaysStep(sessionKey, { ...data, dayOffset: 0 });
  }

  if (rawInput === 'BOOK_YES' || rawInput.toLowerCase() === 'si' || rawInput.toLowerCase() === 'sí') {
    try {
      const appt = await createAppointment({
        profesionalId: data.profesionalId,
        fecha: data.fecha,
        horaInicio: data.horaInicio,
        paciente: {
          dni: data.dni,
          nombreCompleto: data.nombreCompleto,
          telefonoWhatsapp: data.telefonoWhatsapp,
          obraSocial: data.obraSocial,
        },
        canalOrigen: channel === 'web' ? 'web' : 'whatsapp',
        notifyWhatsApp: channel === 'web',
      });

      resetSession(sessionKey);
      return [
        {
          text:
            `🎉 *¡Listo, ${appt.paciente_nombre}! Tu turno quedó reservado.*\n\n` +
            `🔖 *Código:* ${appt.codigo}\n` +
            `📅 *${formatDateFriendly(appt.fecha)} a las ${appt.hora_inicio} hs*\n` +
            `🩺 *${appt.profesional_nombre}* (${appt.especialidad_nombre})\n` +
            `📍 ${appt.consultorio} — ${config.clinic.address}\n\n` +
            `⏰ *24 horas antes* te vamos a escribir por WhatsApp para que puedas *confirmar, modificar o cancelar* con un solo toque.`,
          buttons: [{ id: 'MENU_MAIN', title: '🏠 Menú principal' }],
        },
      ];
    } catch (err) {
      return [
        {
          text: `⚠️ ${err.message}`,
          buttons: [
            { id: 'BOOK_CHANGE', title: '🔄 Elegir otro horario' },
            { id: 'MENU_MAIN', title: '🏠 Menú principal' },
          ],
        },
      ];
    }
  }

  return [
    {
      text: `Tocá *Confirmar turno* para guardarlo, o *Cambiar horario* si preferís otra fecha:`,
      buttons: [
        { id: 'BOOK_YES', title: '✅ Confirmar turno' },
        { id: 'BOOK_CHANGE', title: '🔄 Cambiar horario' },
        { id: 'MENU_MAIN', title: '❌ Cancelar' },
      ],
    },
  ];
}

/* ============================================================
 * VER / MODIFICAR / CANCELAR TURNOS EXISTENTES + RECORDATORIO 24H
 * ============================================================ */

async function startManageFlow(sessionKey, cleanPhone, intent) {
  const now = getClinicNow();
  if (cleanPhone) {
    const active = listAppointments({ phone: cleanPhone, onlyActive: true }).filter(
      (a) => a.fecha >= now.date
    );
    if (active.length > 0) {
      return showPatientAppointments(sessionKey, active, intent);
    }
  }

  saveSession(sessionKey, 'manage_ask_dni', { intent });
  return [
    {
      text: `Escribime tu *DNI* (solo números) para buscar tus turnos vigentes:`,
    },
  ];
}

async function handleManageAskDniStep(sessionKey, data, rawInput) {
  const dni = normalizeDni(rawInput);
  if (dni.length < 6) {
    return incrementErrorOrReply(
      sessionKey,
      'manage_ask_dni',
      data,
      `Ingresá un DNI válido (solo números, sin puntos).`
    );
  }

  const now = getClinicNow();
  const active = listAppointments({ dni, onlyActive: true }).filter(
    (a) => a.fecha >= now.date
  );

  if (active.length === 0) {
    resetSession(sessionKey);
    return [
      {
        text: `No encontré turnos vigentes para el DNI *${dni}*. ¿Querés sacar uno nuevo?`,
        buttons: [
          { id: 'MENU_BOOK', title: '📅 Sacar un turno' },
          { id: 'MENU_MAIN', title: '🏠 Menú principal' },
        ],
      },
    ];
  }

  return showPatientAppointments(sessionKey, active, data.intent);
}

function showPatientAppointments(sessionKey, appointments, intent) {
  if (appointments.length === 1) {
    const appt = appointments[0];
    if (intent === 'cancel') {
      return handleAskCancelConfirm(sessionKey, appt.id);
    }
    return showManageActionsForAppt(sessionKey, appt);
  }

  saveSession(sessionKey, 'manage_select_appt', { intent, apptIds: appointments.map((a) => a.id) });
  return [
    {
      text: `Estos son tus turnos vigentes. Elegí sobre cuál querés operar:`,
      list: {
        buttonText: 'Elegir turno',
        sectionTitle: 'Tus turnos',
        rows: appointments.map((a) => ({
          id: `APPT_${a.id}`,
          title: `${formatDateFriendly(a.fecha)} ${a.hora_inicio}`,
          description: `${a.profesional_nombre} (${a.estado === 'confirmado' ? '✅ Confirmado' : '⏳ Reservado'})`,
        })),
      },
    },
  ];
}

async function handleManageSelectApptStep(sessionKey, data, rawInput) {
  let apptId = null;
  if (rawInput.startsWith('APPT_')) {
    apptId = Number(rawInput.replace('APPT_', ''));
  } else if (/^\d+$/.test(rawInput)) {
    apptId = (data.apptIds || [])[Number(rawInput) - 1];
  }

  const appt = apptId ? getAppointmentById(apptId) : null;
  if (!appt || appt.estado === 'cancelado') {
    return incrementErrorOrReply(
      sessionKey,
      'manage_select_appt',
      data,
      `Elegí un turno de la lista por favor.`
    );
  }

  if (data.intent === 'cancel') {
    return handleAskCancelConfirm(sessionKey, appt.id);
  }
  return showManageActionsForAppt(sessionKey, appt);
}

function showManageActionsForAppt(sessionKey, appt) {
  saveSession(sessionKey, 'manage_action', { apptId: appt.id });
  const estadoLabel = appt.estado === 'confirmado' ? '✅ Confirmado' : '⏳ Pendiente de confirmación';
  return [
    {
      text:
        `📋 *Detalle de tu turno (${appt.codigo})*\n\n` +
        `📅 *${formatDateFriendly(appt.fecha)} a las ${appt.hora_inicio} hs*\n` +
        `🩺 *${appt.profesional_nombre}* (${appt.especialidad_nombre})\n` +
        `📍 ${appt.consultorio}\n` +
        `📌 Estado: ${estadoLabel}\n\n` +
        `¿Qué querés hacer con este turno?`,
      buttons: [
        { id: `REM_CONFIRM_${appt.id}`, title: '✅ Confirmar' },
        { id: `REM_MODIFY_${appt.id}`, title: '🔄 Modificar' },
        { id: `REM_CANCEL_${appt.id}`, title: '❌ Cancelar' },
      ],
    },
  ];
}

async function handleManageActionStep(sessionKey, data, rawInput) {
  const lower = rawInput.toLowerCase();
  if (lower.includes('confirm')) return handleReminderConfirm(sessionKey, data.apptId);
  if (lower.includes('modif') || lower.includes('cambi')) return handleStartReschedule(sessionKey, data.apptId);
  if (lower.includes('cancel')) return handleAskCancelConfirm(sessionKey, data.apptId);
  const appt = getAppointmentById(data.apptId);
  if (!appt) {
    resetSession(sessionKey);
    return [welcomeMenuReply()];
  }
  return showManageActionsForAppt(sessionKey, appt);
}

async function handleReminderConfirm(sessionKey, apptId) {
  try {
    const appt = await confirmAppointment(apptId);
    resetSession(sessionKey);
    return [
      {
        text:
          `✅ *¡Perfecto, ${appt.paciente_nombre}! Tu asistencia quedó confirmada.*\n\n` +
          `Te esperamos el *${formatDateFriendly(appt.fecha)} a las ${appt.hora_inicio} hs* con *${appt.profesional_nombre}*.\n` +
          `📍 ${appt.consultorio} — ${config.clinic.address}\n\n` +
          `¡Nos vemos pronto! 😊`,
        buttons: [{ id: 'MENU_MAIN', title: '🏠 Menú principal' }],
      },
    ];
  } catch (err) {
    resetSession(sessionKey);
    return [
      {
        text: `⚠️ ${err.message}`,
        buttons: [{ id: 'MENU_MAIN', title: '🏠 Menú principal' }],
      },
    ];
  }
}

async function handleDirectCancel(sessionKey, apptId) {
  const appt = getAppointmentById(apptId);
  if (!appt || appt.estado === 'cancelado') {
    resetSession(sessionKey);
    return [
      {
        text: `Ese turno ya se encuentra cancelado.`,
        buttons: [{ id: 'MENU_MAIN', title: '🏠 Menú principal' }],
      },
    ];
  }

  try {
    const cancelled = await cancelAppointment(appt.id);
    resetSession(sessionKey);
    return [
      {
        text:
          `❌ *Turno cancelado.*\n\n` +
          `Tu turno con *${cancelled.profesional_nombre}* (${formatDateFriendly(cancelled.fecha)} ${cancelled.hora_inicio} hs) fue *anulado* en la agenda y el horario ya quedó libre para otro paciente.\n\n` +
          `Si querés sacar un nuevo turno, elegí una opción:`,
        buttons: [
          { id: 'MENU_BOOK', title: '📅 Sacar nuevo turno' },
          { id: 'MENU_MAIN', title: '🏠 Menú principal' },
        ],
      },
    ];
  } catch (err) {
    resetSession(sessionKey);
    return [{ text: `⚠️ ${err.message}`, buttons: [{ id: 'MENU_MAIN', title: '🏠 Menú principal' }] }];
  }
}

async function handleAskCancelConfirm(sessionKey, apptId) {
  const appt = getAppointmentById(apptId);
  if (!appt || appt.estado === 'cancelado') {
    resetSession(sessionKey);
    return [
      {
        text: `Ese turno ya se encuentra cancelado.`,
        buttons: [{ id: 'MENU_MAIN', title: '🏠 Menú principal' }],
      },
    ];
  }

  saveSession(sessionKey, 'confirm_cancel', { apptId: appt.id });
  return [
    {
      text:
        `¿Seguro que querés cancelar tu turno del *${formatDateFriendly(appt.fecha)} a las ${appt.hora_inicio} hs* con *${appt.profesional_nombre}*?\n` +
        `Al cancelar, el horario se libera automáticamente para otro paciente.`,
      buttons: [
        { id: 'CANCEL_YES', title: '❌ Sí, cancelar' },
        { id: 'CANCEL_NO', title: '✅ No, mantenerlo' },
      ],
    },
  ];
}

async function handleConfirmCancelStep(sessionKey, data, rawInput) {
  if (rawInput === 'CANCEL_YES' || rawInput.toLowerCase() === 'si' || rawInput.toLowerCase() === 'sí') {
    try {
      const appt = await cancelAppointment(data.apptId);
      resetSession(sessionKey);
      return [
        {
          text:
            `❌ Tu turno con *${appt.profesional_nombre}* (${formatDateFriendly(appt.fecha)} ${appt.hora_inicio} hs) fue *cancelado* y el horario ya se liberó.\n\n` +
            `Si querés sacar otro turno para más adelante, tocá abajo:`,
          buttons: [
            { id: 'MENU_BOOK', title: '📅 Sacar nuevo turno' },
            { id: 'MENU_MAIN', title: '🏠 Menú principal' },
          ],
        },
      ];
    } catch (err) {
      resetSession(sessionKey);
      return [{ text: `⚠️ ${err.message}`, buttons: [{ id: 'MENU_MAIN', title: '🏠 Menú principal' }] }];
    }
  }

  resetSession(sessionKey);
  return [
    {
      text: `¡Genial! Tu turno sigue vigente sin cambios 👍.`,
      buttons: [{ id: 'MENU_MAIN', title: '🏠 Menú principal' }],
    },
  ];
}

async function handleStartReschedule(sessionKey, apptId) {
  const appt = getAppointmentById(apptId);
  if (!appt || appt.estado === 'cancelado') {
    resetSession(sessionKey);
    return [
      {
        text: `No se encontró un turno activo para modificar. ¿Querés sacar uno nuevo?`,
        buttons: [
          { id: 'MENU_BOOK', title: '📅 Sacar turno nuevo' },
          { id: 'MENU_MAIN', title: '🏠 Menú principal' },
        ],
      },
    ];
  }

  return showDaysStep(
    sessionKey,
    {
      rescheduleApptId: appt.id,
      profesionalId: appt.profesional_id,
      profesionalNombre: appt.profesional_nombre,
      especialidadNombre: appt.especialidad_nombre,
      consultorio: appt.consultorio,
      anyDoctor: false,
      dayOffset: 0,
    },
    true
  );
}

async function handleRescheduleDayStep(sessionKey, data, rawInput) {
  if (rawInput === 'DAYS_MORE') {
    return showDaysStep(sessionKey, { ...data, dayOffset: (data.dayOffset || 0) + 5 }, true);
  }

  const fecha = resolveSelectedDay(data.offeredDays || [], rawInput);
  if (!fecha) {
    return incrementErrorOrReply(
      sessionKey,
      'reschedule_day',
      data,
      `Elegí uno de los días de la lista para reprogramar tu turno.`
    );
  }

  return showTimesStep(sessionKey, { ...data, fecha, timeOffset: 0 }, true);
}

async function handleRescheduleTimeStep(sessionKey, data, rawInput) {
  if (rawInput === 'TIMES_MORE') {
    return showTimesStep(sessionKey, { ...data, timeOffset: (data.timeOffset || 0) + 7 }, true);
  }
  if (rawInput === 'BACK_DAYS') {
    return showDaysStep(sessionKey, { ...data, dayOffset: 0 }, true);
  }

  const slot = resolveSelectedSlot(data.offeredSlots || [], rawInput);
  if (!slot) {
    return incrementErrorOrReply(
      sessionKey,
      'reschedule_time',
      data,
      `Elegí uno de los horarios de la lista.`
    );
  }

  // Aplicar el cambio inmediatamente al elegir el nuevo horario (actualiza SQLite, Agenda Web y Google Calendar)
  try {
    const updated = await rescheduleAppointment(data.rescheduleApptId, {
      fecha: data.fecha,
      horaInicio: slot.hora_inicio,
    });

    resetSession(sessionKey);
    return [
      {
        text:
          `🔄 *¡Turno modificado con éxito!*\n\n` +
          `🔖 *Código:* ${updated.codigo}\n` +
          `📅 *Nuevo día:* ${formatDateFriendly(updated.fecha)}\n` +
          `⏰ *Nueva hora:* ${updated.hora_inicio} hs\n` +
          `🩺 *${updated.profesional_nombre}*\n` +
          `📍 ${updated.consultorio} — ${config.clinic.address}\n\n` +
          `✅ Ya actualizamos la agenda de la clínica y Google Calendar, y liberamos tu horario anterior.`,
        buttons: [{ id: 'MENU_MAIN', title: '🏠 Menú principal' }],
      },
    ];
  } catch (err) {
    return [
      {
        text: `⚠️ ${err.message}`,
        buttons: [
          { id: 'BACK_DAYS', title: '🔄 Elegir otro día' },
          { id: 'MENU_MAIN', title: '🏠 Menú principal' },
        ],
      },
    ];
  }
}

async function handleRescheduleConfirmStep(sessionKey, data, rawInput) {
  if (rawInput === 'RESCHED_BACK') {
    return showDaysStep(sessionKey, { ...data, dayOffset: 0 }, true);
  }

  if (rawInput === 'RESCHED_YES' || rawInput.toLowerCase() === 'si' || rawInput.toLowerCase() === 'sí') {
    try {
      const updated = await rescheduleAppointment(data.rescheduleApptId, {
        fecha: data.fecha,
        horaInicio: data.horaInicio,
      });

      resetSession(sessionKey);
      return [
        {
          text:
            `🔄 *¡Turno modificado con éxito!*\n\n` +
            `🔖 *Código:* ${updated.codigo}\n` +
            `📅 *${formatDateFriendly(updated.fecha)} a las ${updated.hora_inicio} hs*\n` +
            `🩺 *${updated.profesional_nombre}*\n` +
            `📍 ${updated.consultorio} — ${config.clinic.address}\n\n` +
            `Ya actualizamos la agenda en Google Calendar y te volveremos a recordar 24 hs antes.`,
          buttons: [{ id: 'MENU_MAIN', title: '🏠 Menú principal' }],
        },
      ];
    } catch (err) {
      return [
        {
          text: `⚠️ ${err.message}`,
          buttons: [
            { id: 'RESCHED_BACK', title: '🔄 Elegir otro horario' },
            { id: 'MENU_MAIN', title: '🏠 Menú principal' },
          ],
        },
      ];
    }
  }

  return [
    {
      text: `Tocá *Sí, cambiar turno* para guardar la nueva fecha:`,
      buttons: [
        { id: 'RESCHED_YES', title: '✅ Sí, cambiar turno' },
        { id: 'RESCHED_BACK', title: '🔄 Otra fecha' },
      ],
    },
  ];
}

/* ============================================================
 * ESCAPE HATCH (DERIVACIÓN SUAVE TRAS 2 ERRORES)
 * ============================================================ */

function incrementErrorOrReply(sessionKey, step, data, fallbackText, list = null) {
  const current = getSession(sessionKey);
  const nextErr = current.errorCount + 1;

  if (nextErr >= 2) {
    saveSession(sessionKey, step, data, 0);
    return [
      {
        text:
          `Parece que hubo un inconveniente con ese dato 😅.\n` +
          `Podés volver al inicio o hablar directamente con recepción:`,
        buttons: [
          { id: 'MENU_MAIN', title: '🏠 Menú principal' },
          { id: 'MENU_HUMAN', title: '💬 Hablar con recepción' },
        ],
      },
    ];
  }

  saveSession(sessionKey, step, data, nextErr);
  return [list ? { text: fallbackText, list } : { text: fallbackText }];
}
