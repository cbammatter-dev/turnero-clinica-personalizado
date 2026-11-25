const state = {
  clinic: null,
  specialties: [],
  doctors: [],
  selectedSpecialty: null,
  selectedDoctor: null, // null si eligió "any"
  anyDoctor: false,
  selectedDate: null,
  selectedSlot: null,
  reschedulingAppt: null,
};

const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatBotText(text) {
  return escapeHtml(text).replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Ocurrió un error inesperado.');
  return data;
}

function showAlert(containerId, message, type = 'error') {
  const el = $(containerId);
  if (!message) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<div class="alert alert-${type}">${escapeHtml(message)}</div>`;
}

function setWizardStep(step) {
  ['step1', 'step2', 'step3', 'step4', 'stepSuccess'].forEach((id) => $(id).classList.add('hidden'));
  if (step === 'success') {
    $('stepSuccess').classList.remove('hidden');
  } else {
    $(`step${step}`).classList.remove('hidden');
  }

  document.querySelectorAll('#stepper .step-item').forEach((item) => {
    const s = Number(item.dataset.step);
    item.classList.remove('active', 'done');
    if (step === 'success' || s < step) item.classList.add('done');
    else if (s === step) item.classList.add('active');
  });
}

/* ============================================================
 * INICIALIZACIÓN
 * ============================================================ */
async function init() {
  try {
    const [status, specRes, osRes] = await Promise.all([
      api('/api/status'),
      api('/api/specialties'),
      api('/api/obras-sociales'),
    ]);
    state.clinic = status.clinic;
    $('clinicName').textContent = status.clinic.name;
    document.title = `Turnero Online — ${status.clinic.name}`;
    $('clinicAddress').textContent = `${status.clinic.address} • ${status.clinic.phone}`;

    state.specialties = specRes.specialties;
    renderSpecialties();

    renderObrasSocialesSelect(osRes.obrasSociales || []);
  } catch (err) {
    showAlert('bookingAlert', err.message, 'error');
  }
}

function renderObrasSocialesSelect(list) {
  const select = $('inputObraSocial');
  if (!select) return;
  select.innerHTML =
    list.map((o) => `<option value="${escapeHtml(o.nombre)}">${escapeHtml(o.nombre)}</option>`).join('') +
    `<option value="__otra__">Otra (escribir cuál)</option>`;
}

$('inputObraSocial').addEventListener('change', () => {
  const isOther = $('inputObraSocial').value === '__otra__';
  $('inputObraSocialOtra').classList.toggle('hidden', !isOther);
  if (isOther) $('inputObraSocialOtra').focus();
});

function normalizeSearch(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

$('specialtySearch').addEventListener('input', () => {
  renderSpecialties($('specialtySearch').value);
});

function renderSpecialties(query = '') {
  const grid = $('specialtiesGrid');
  const q = normalizeSearch(query.trim());
  const filtered = q
    ? state.specialties.filter(
        (s) =>
          normalizeSearch(s.nombre).includes(q) ||
          normalizeSearch(s.descripcion || '').includes(q)
      )
    : state.specialties;

  if (filtered.length === 0) {
    grid.innerHTML = '<div class="alert alert-info">No encontramos especialidades con ese nombre.</div>';
    return;
  }

  grid.innerHTML = filtered
    .map(
      (s) => `
      <button type="button" class="option-card" data-specialty-id="${s.id}">
        <span class="option-icon">${window.ClinicalIcons ? window.ClinicalIcons.render(s.nombre, 'card') : escapeHtml(s.icono)}</span>
        <span class="option-title">${escapeHtml(s.nombre)}</span>
        <span class="option-desc">${escapeHtml(s.descripcion || '')}</span>
        <span class="option-desc" style="margin-top:4px; font-weight:600; color:${
          s.total_profesionales > 0 ? '#0f766e' : '#64748b'
        };">${
        s.total_profesionales > 0
          ? `${s.total_profesionales} ${s.total_profesionales === 1 ? 'profesional' : 'profesionales'}`
          : 'Consultar en recepción'
      }</span>
      </button>`
    )
    .join('');

  grid.querySelectorAll('[data-specialty-id]').forEach((btn) => {
    btn.addEventListener('click', () => selectSpecialty(Number(btn.dataset.specialtyId)));
  });
}

async function selectSpecialty(specialtyId) {
  showAlert('bookingAlert', '');
  state.selectedSpecialty = state.specialties.find((s) => s.id === specialtyId);
  const { doctors } = await api(`/api/doctors?specialtyId=${specialtyId}`);
  state.doctors = doctors;

  if (doctors.length === 0) {
    showAlert(
      'bookingAlert',
      `Todavía no hay turnos online cargados para ${state.selectedSpecialty.nombre}. Comunicate con recepción al ${state.clinic?.phone || ''} o elegí otra especialidad.`,
      'info'
    );
    return;
  }

  // Si hay un solo médico, pasar directo al paso 3
  if (doctors.length === 1) {
    state.anyDoctor = false;
    state.selectedDoctor = doctors[0];
    setWizardStep(3);
    await loadAvailableDays();
    return;
  }

  $('step2Sub').textContent = `Especialidad: ${state.selectedSpecialty.nombre}. Elegí un profesional o el primer turno libre.`;
  const grid = $('doctorsGrid');
  grid.innerHTML =
    `
    <button type="button" class="option-card featured" data-doctor-id="any">
      <span class="option-icon">${window.ClinicalIcons ? window.ClinicalIcons.render('fast-slot', 'card') : '⚡'}</span>
      <span class="option-title">Primer turno disponible</span>
      <span class="option-desc">Te mostramos todos los horarios más cercanos de ${escapeHtml(state.selectedSpecialty.nombre)}.</span>
    </button>
  ` +
    doctors
      .map(
        (d) => `
      <button type="button" class="option-card" data-doctor-id="${d.id}">
        <span class="option-title">${escapeHtml(d.nombre)}</span>
        <span class="option-desc">${escapeHtml(d.consultorio)} • Turnos de ${d.duracion_turno_min} min</span>
        <span class="option-desc" style="margin-top:4px;">Coberturas: ${escapeHtml(d.obras_sociales)}</span>
      </button>`
      )
      .join('');

  grid.querySelectorAll('[data-doctor-id]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const val = btn.dataset.doctorId;
      if (val === 'any') {
        state.anyDoctor = true;
        state.selectedDoctor = null;
      } else {
        state.anyDoctor = false;
        state.selectedDoctor = state.doctors.find((d) => d.id === Number(val));
      }
      setWizardStep(3);
      await loadAvailableDays();
    });
  });

  setWizardStep(2);
}

async function loadAvailableDays() {
  showAlert('bookingAlert', '');
  const who = state.anyDoctor
    ? `Cualquier profesional de ${state.selectedSpecialty.nombre}`
    : `${state.selectedDoctor.nombre} (${state.selectedSpecialty.nombre})`;
  $('step3Sub').textContent = `${who} — tocá una fecha para ver los horarios libres.`;
  $('daysStrip').innerHTML = 'Buscando fechas disponibles...';
  $('slotsContainer').innerHTML = '';

  const query = state.anyDoctor
    ? `specialtyId=${state.selectedSpecialty.id}&limit=10`
    : `doctorId=${state.selectedDoctor.id}&limit=10`;

  const { days } = await api(`/api/availability/days?${query}`);
  if (days.length === 0) {
    $('daysStrip').innerHTML =
      '<div class="alert alert-info">No hay turnos libres en los próximos 30 días para esta agenda. Probá otro profesional o consultá en recepción.</div>';
    return;
  }

  $('daysStrip').innerHTML = days
    .map(
      (d, idx) => `
      <button type="button" class="day-pill ${idx === 0 ? 'selected' : ''}" data-date="${d.fecha}" data-label="${escapeHtml(d.label)}">
        <strong>${escapeHtml(d.shortLabel)}</strong>
        <span>${d.total_horarios} libres</span>
      </button>`
    )
    .join('');

  $('daysStrip').querySelectorAll('.day-pill').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('daysStrip').querySelectorAll('.day-pill').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      loadSlotsForDay(btn.dataset.date, btn.dataset.label);
    });
  });

  // Cargar automáticamente el primer día disponible
  await loadSlotsForDay(days[0].fecha, days[0].label);
}

async function loadSlotsForDay(date, dateLabel) {
  state.selectedDate = { fecha: date, label: dateLabel };
  $('slotsContainer').innerHTML = 'Cargando horarios...';

  const query = state.anyDoctor
    ? `specialtyId=${state.selectedSpecialty.id}&date=${date}`
    : `doctorId=${state.selectedDoctor.id}&date=${date}`;

  const { slots } = await api(`/api/availability/slots?${query}`);
  if (slots.length === 0) {
    $('slotsContainer').innerHTML =
      '<div class="alert alert-info">Ya no quedan horarios para este día. Elegí otra fecha.</div>';
    return;
  }

  const morning = slots.filter((s) => s.periodo === 'mañana');
  const afternoon = slots.filter((s) => s.periodo === 'tarde');

  const renderGroup = (title, list) => {
    if (list.length === 0) return '';
    return `
      <div class="slots-group-title">${title}</div>
      <div class="slots-grid">
        ${list
          .map(
            (s) => `
          <button type="button" class="slot-btn" data-prof-id="${s.profesional_id}" data-prof-name="${escapeHtml(s.profesional_nombre)}" data-consultorio="${escapeHtml(s.consultorio)}" data-time="${s.hora_inicio}">
            ${s.hora_inicio} hs
            ${state.anyDoctor ? `<small>${escapeHtml(s.profesional_nombre)}</small>` : ''}
          </button>`
          )
          .join('')}
      </div>`;
  };

  $('slotsContainer').innerHTML =
    renderGroup('☀️ Turnos de la mañana', morning) +
    renderGroup('🌤️ Turnos de la tarde', afternoon);

  $('slotsContainer').querySelectorAll('.slot-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.selectedSlot = {
        profesionalId: Number(btn.dataset.profId),
        profesionalNombre: btn.dataset.profName,
        consultorio: btn.dataset.consultorio,
        horaInicio: btn.dataset.time,
      };
      showSummaryStep();
    });
  });
}

function showSummaryStep() {
  $('bookingSummary').innerHTML = `
    <p><strong>🩺 Especialidad:</strong> ${escapeHtml(state.selectedSpecialty.nombre)}</p>
    <p><strong>👨‍⚕️ Profesional:</strong> ${escapeHtml(state.selectedSlot.profesionalNombre)}</p>
    <p><strong>📅 Día y horario:</strong> ${escapeHtml(state.selectedDate.label)} a las <strong>${state.selectedSlot.horaInicio} hs</strong></p>
    <p><strong>📍 Lugar:</strong> ${escapeHtml(state.selectedSlot.consultorio)} — ${escapeHtml(state.clinic?.address || '')}</p>
  `;
  setWizardStep(4);
}

// Autocompletar datos si el paciente ya existe por DNI
$('inputDni').addEventListener('blur', async () => {
  const dni = $('inputDni').value.replace(/\D/g, '');
  if (dni.length < 6) return;
  try {
    const { patient } = await api(`/api/patients/lookup?dni=${dni}`);
    if (patient) {
      $('inputName').value = patient.nombre_completo;
      $('inputWhatsapp').value = patient.telefono_whatsapp;
      const savedOs = patient.obra_social || 'Particular';
      const hasOpt = [...$('inputObraSocial').options].some((o) => o.value === savedOs);
      if (hasOpt) {
        $('inputObraSocial').value = savedOs;
        $('inputObraSocialOtra').classList.add('hidden');
      } else {
        $('inputObraSocial').value = '__otra__';
        $('inputObraSocialOtra').classList.remove('hidden');
        $('inputObraSocialOtra').value = savedOs;
      }
      $('dniLookupHint').textContent = `✅ ¡Hola de nuevo, ${patient.nombre_completo}! Completamos tus datos.`;
    } else {
      $('dniLookupHint').textContent = 'Solo números, sin puntos.';
    }
  } catch {
    // ignore
  }
});

$('patientForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  showAlert('bookingAlert', '');
  const btn = $('confirmBookingBtn');
  btn.disabled = true;
  btn.textContent = 'Reservando turno...';

  try {
    const selectedOs =
      $('inputObraSocial').value === '__otra__'
        ? $('inputObraSocialOtra').value.trim() || 'Particular'
        : $('inputObraSocial').value;

    const { appointment } = await api('/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        profesionalId: state.selectedSlot.profesionalId,
        fecha: state.selectedDate.fecha,
        horaInicio: state.selectedSlot.horaInicio,
        canalOrigen: 'web',
        paciente: {
          dni: $('inputDni').value,
          nombreCompleto: $('inputName').value,
          telefonoWhatsapp: $('inputWhatsapp').value,
          obraSocial: selectedOs,
        },
      }),
    });

    $('successSummary').innerHTML = `
      <p><strong>🔖 Código de turno:</strong> ${escapeHtml(appointment.codigo)}</p>
      <p><strong>👤 Paciente:</strong> ${escapeHtml(appointment.paciente_nombre)} (DNI ${escapeHtml(appointment.paciente_dni)})</p>
      <p><strong>🩺 Profesional:</strong> ${escapeHtml(appointment.profesional_nombre)} (${escapeHtml(appointment.especialidad_nombre)})</p>
      <p><strong>📅 Día y hora:</strong> ${escapeHtml(state.selectedDate.label)} a las <strong>${appointment.hora_inicio} hs</strong></p>
      <p><strong>📍 Lugar:</strong> ${escapeHtml(appointment.consultorio)}</p>
      <p><strong>⏰ Recordatorio automático:</strong> 24 hs antes te escribimos al WhatsApp <strong>${escapeHtml(appointment.paciente_whatsapp)}</strong> para confirmar, cambiar o cancelar.</p>
    `;

    $('openWaLink').href = `/whatsapp-demo?phone=${encodeURIComponent(appointment.paciente_whatsapp)}`;
    setWizardStep('success');
  } catch (err) {
    showAlert('bookingAlert', err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✅ Confirmar mi turno';
  }
});

$('backToStep1').addEventListener('click', () => setWizardStep(1));
$('backToStep2').addEventListener('click', () => {
  if (state.doctors.length <= 1) setWizardStep(1);
  else setWizardStep(2);
});
$('backToStep3').addEventListener('click', () => setWizardStep(3));
$('bookAnotherBtn').addEventListener('click', () => {
  $('patientForm').reset();
  $('dniLookupHint').textContent = 'Solo números, sin puntos.';
  setWizardStep(1);
});

/* ============================================================
 * TABS: SACAR TURNO vs MIS TURNOS
 * ============================================================ */
$('tabBook').addEventListener('click', () => {
  $('tabBook').classList.add('active');
  $('tabMyAppointments').classList.remove('active');
  $('bookingSection').classList.remove('hidden');
  $('myAppointmentsSection').classList.add('hidden');
});

$('tabMyAppointments').addEventListener('click', () => {
  $('tabMyAppointments').classList.add('active');
  $('tabBook').classList.remove('active');
  $('myAppointmentsSection').classList.remove('hidden');
  $('bookingSection').classList.add('hidden');
});

$('lookupAppointmentsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  await loadMyAppointments($('lookupDni').value);
});

async function loadMyAppointments(dni) {
  showAlert('myAppointmentsAlert', '');
  $('reschedulePanel').classList.add('hidden');
  const cleanDni = String(dni || '').replace(/\D/g, '');
  if (cleanDni.length < 6) {
    showAlert('myAppointmentsAlert', 'Ingresá un DNI válido (solo números).', 'error');
    return;
  }

  const { appointments } = await api(`/api/appointments?dni=${cleanDni}`);
  const active = appointments.filter((a) => a.estado !== 'cancelado');

  if (active.length === 0) {
    $('myAppointmentsList').innerHTML =
      '<div class="card">No encontramos turnos vigentes para ese DNI.</div>';
    return;
  }

  $('myAppointmentsList').innerHTML = active
    .map(
      (a) => `
      <div class="card appt-item">
        <div>
          <span class="badge badge-${a.estado}">
            ${a.estado === 'confirmado' ? '✅ Confirmado' : '⏳ Pendiente de confirmación'}
          </span>
          <strong style="margin-left:8px;">${escapeHtml(a.codigo)}</strong>
          <div style="font-size:17px; font-weight:700; margin-top:6px;">
            📅 ${escapeHtml(a.fecha)} — ⏰ ${escapeHtml(a.hora_inicio)} hs
          </div>
          <div style="color:#475569; font-size:14px;">
            🩺 ${escapeHtml(a.profesional_nombre)} (${escapeHtml(a.especialidad_nombre)}) • ${escapeHtml(a.consultorio)}
          </div>
        </div>
        <div class="appt-actions">
          ${
            a.estado === 'reservado'
              ? `<button class="btn btn-success btn-sm" data-confirm="${a.id}">✅ Confirmar</button>`
              : ''
          }
          <button class="btn btn-warning btn-sm" data-reschedule="${a.id}">🔄 Modificar</button>
          <button class="btn btn-danger btn-sm" data-cancel="${a.id}">❌ Cancelar</button>
        </div>
      </div>`
    )
    .join('');

  $('myAppointmentsList').querySelectorAll('[data-confirm]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/appointments/${btn.dataset.confirm}/confirm`, { method: 'POST' });
      showAlert('myAppointmentsAlert', '✅ ¡Asistencia confirmada! Ya actualizamos Google Calendar.', 'success');
      await loadMyAppointments(cleanDni);
    });
  });

  $('myAppointmentsList').querySelectorAll('[data-cancel]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Seguro que querés cancelar este turno? El horario se liberará al instante.')) return;
      await api(`/api/appointments/${btn.dataset.cancel}/cancel`, { method: 'POST' });
      showAlert('myAppointmentsAlert', '❌ Turno cancelado y horario liberado en Google Calendar.', 'info');
      await loadMyAppointments(cleanDni);
    });
  });

  $('myAppointmentsList').querySelectorAll('[data-reschedule]').forEach((btn) => {
    const appt = active.find((x) => x.id === Number(btn.dataset.reschedule));
    btn.addEventListener('click', () => openReschedulePanel(appt, cleanDni));
  });
}

async function openReschedulePanel(appt, dni) {
  state.reschedulingAppt = { appt, dni };
  $('rescheduleInfo').textContent = `Elegí el nuevo día y horario con ${appt.profesional_nombre} (turno actual: ${appt.fecha} ${appt.hora_inicio} hs).`;
  $('reschedulePanel').classList.remove('hidden');
  $('rescheduleDays').innerHTML = 'Cargando fechas...';
  $('rescheduleSlots').innerHTML = '';

  const { days } = await api(
    `/api/availability/days?doctorId=${appt.profesional_id}&limit=8&excludeAppointmentId=${appt.id}`
  );
  if (days.length === 0) {
    $('rescheduleDays').innerHTML = '<div class="alert alert-info">No hay otras fechas disponibles.</div>';
    return;
  }

  $('rescheduleDays').innerHTML = days
    .map(
      (d, idx) => `
      <button type="button" class="day-pill ${idx === 0 ? 'selected' : ''}" data-rdate="${d.fecha}">
        <strong>${escapeHtml(d.shortLabel)}</strong>
        <span>${d.total_horarios} libres</span>
      </button>`
    )
    .join('');

  $('rescheduleDays').querySelectorAll('[data-rdate]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('rescheduleDays').querySelectorAll('[data-rdate]').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      loadRescheduleSlots(appt, btn.dataset.rdate, dni);
    });
  });

  await loadRescheduleSlots(appt, days[0].fecha, dni);
}

async function loadRescheduleSlots(appt, fecha, dni) {
  const { slots } = await api(
    `/api/availability/slots?doctorId=${appt.profesional_id}&date=${fecha}&excludeAppointmentId=${appt.id}`
  );
  $('rescheduleSlots').innerHTML = `
    <div class="slots-grid">
      ${slots
        .map(
          (s) =>
            `<button type="button" class="slot-btn" data-rtime="${s.hora_inicio}">${s.hora_inicio} hs</button>`
        )
        .join('')}
    </div>`;

  $('rescheduleSlots').querySelectorAll('[data-rtime]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await api(`/api/appointments/${appt.id}/reschedule`, {
          method: 'POST',
          body: JSON.stringify({ fecha, horaInicio: btn.dataset.rtime }),
        });
        $('reschedulePanel').classList.add('hidden');
        showAlert(
          'myAppointmentsAlert',
          `🔄 ¡Turno reprogramado para el ${fecha} a las ${btn.dataset.rtime} hs!`,
          'success'
        );
        await loadMyAppointments(dni);
      } catch (err) {
        showAlert('myAppointmentsAlert', err.message, 'error');
      }
    });
  });
}

$('cancelRescheduleBtn').addEventListener('click', () => {
  $('reschedulePanel').classList.add('hidden');
});

/* ============================================================
 * BOT WEB FLOTANTE (CONVERSACIONAL)
 * ============================================================ */
const webSessionId =
  localStorage.getItem('turnero_web_sid') ||
  (() => {
    const id = `web_${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('turnero_web_sid', id);
    return id;
  })();

let webChatInitialized = false;

function appendWebChatBubble(direction, replyOrText) {
  const container = $('webChatMessages');
  const div = document.createElement('div');
  div.className = `msg-bubble ${direction === 'user' ? 'msg-user' : 'msg-bot'}`;

  if (direction === 'user') {
    div.textContent = replyOrText;
  } else {
    div.innerHTML = formatBotText(replyOrText.text || '');

    const actions = [];
    if (replyOrText.buttons?.length) {
      replyOrText.buttons.forEach((b) => actions.push({ id: b.id, title: b.title }));
    }
    if (replyOrText.list?.rows?.length) {
      replyOrText.list.rows.forEach((r) =>
        actions.push({ id: r.id, title: r.title, description: r.description })
      );
    }

    if (actions.length > 0) {
      const wrap = document.createElement('div');
      wrap.className = 'msg-buttons';
      actions.forEach((act) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'msg-action-btn';
        b.innerHTML = `${escapeHtml(act.title)}${
          act.description ? `<small>${escapeHtml(act.description)}</small>` : ''
        }`;
        b.addEventListener('click', () => sendWebChatMessage(act.title, act.id));
        wrap.appendChild(b);
      });
      div.appendChild(wrap);
    }
  }

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function sendWebChatMessage(text, actionId = null, reset = false) {
  if (!reset && text) appendWebChatBubble('user', text);
  const { replies } = await api('/api/bot/web/message', {
    method: 'POST',
    body: JSON.stringify({ sessionId: webSessionId, text, actionId, reset }),
  });
  replies.forEach((r) => appendWebChatBubble('bot', r));
}

$('chatFab').addEventListener('click', async () => {
  $('webChatWidget').classList.toggle('hidden');
  if (!webChatInitialized) {
    webChatInitialized = true;
    await sendWebChatMessage('hola', null, true);
  }
});

$('webChatClose').addEventListener('click', () => $('webChatWidget').classList.add('hidden'));
$('webChatReset').addEventListener('click', async () => {
  $('webChatMessages').innerHTML = '';
  await sendWebChatMessage('hola', null, true);
});

$('webChatForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const val = $('webChatInput').value.trim();
  if (!val) return;
  $('webChatInput').value = '';
  await sendWebChatMessage(val);
});

init();
