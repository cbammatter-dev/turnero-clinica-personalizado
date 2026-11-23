const $ = (id) => document.getElementById(id);

const DAYS_ORDER = [
  { dow: 1, name: 'Lunes' },
  { dow: 2, name: 'Martes' },
  { dow: 3, name: 'Miércoles' },
  { dow: 4, name: 'Jueves' },
  { dow: 5, name: 'Viernes' },
  { dow: 6, name: 'Sábado' },
  { dow: 0, name: 'Domingo' },
];

const stateByDay = {};
DAYS_ORDER.forEach((d) => {
  stateByDay[d.dow] = [];
});

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error inesperado.');
  return data;
}

function renderDays() {
  const box = $('reqDaysContainer');
  box.innerHTML = DAYS_ORDER.map(({ dow, name }) => {
    const blocks = stateByDay[dow] || [];
    const active = blocks.length > 0;
    const blocksHtml = blocks
      .map(
        (b, idx) => `
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:6px;">
          <span style="font-size:12px; color:#475569; min-width:56px;">Franja ${idx + 1}:</span>
          <input type="time" value="${escapeHtml(b.hora_inicio)}" data-start="${dow}-${idx}" style="padding:6px 8px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px;" required />
          <span>a</span>
          <input type="time" value="${escapeHtml(b.hora_fin)}" data-end="${dow}-${idx}" style="padding:6px 8px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px;" required />
          <button type="button" class="btn btn-secondary btn-sm" data-del="${dow}-${idx}" style="padding:4px 8px;">✕</button>
        </div>`
      )
      .join('');

    return `
      <div style="border:1px solid ${active ? '#99f6e4' : '#e2e8f0'}; background:${active ? '#f0fdfa' : '#f8fafc'}; border-radius:12px; padding:12px 14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
          <label style="display:flex; align-items:center; gap:8px; font-weight:700; font-size:15px; cursor:pointer;">
            <input type="checkbox" data-toggle="${dow}" ${active ? 'checked' : ''} style="width:18px; height:18px;" />
            ${name}
          </label>
          ${
            active
              ? `<button type="button" class="btn btn-secondary btn-sm" data-add="${dow}" style="font-size:12px; padding:4px 10px;">➕ Agregar 2da franja</button>`
              : `<span style="font-size:12px; color:#64748b;">No seleccionado</span>`
          }
        </div>
        ${active ? `<div style="margin-top:6px;">${blocksHtml}</div>` : ''}
      </div>`;
  }).join('');

  box.querySelectorAll('[data-toggle]').forEach((chk) => {
    chk.addEventListener('change', () => {
      const dow = Number(chk.dataset.toggle);
      stateByDay[dow] = chk.checked ? [{ hora_inicio: '09:00', hora_fin: '13:00' }] : [];
      renderDays();
    });
  });

  box.querySelectorAll('[data-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dow = Number(btn.dataset.add);
      const list = stateByDay[dow] || [];
      list.push({ hora_inicio: '15:00', hora_fin: '19:00' });
      stateByDay[dow] = list;
      renderDays();
    });
  });

  box.querySelectorAll('[data-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [d, i] = btn.dataset.del.split('-');
      stateByDay[Number(d)].splice(Number(i), 1);
      renderDays();
    });
  });

  box.querySelectorAll('[data-start]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const [d, i] = inp.dataset.start.split('-');
      stateByDay[Number(d)][Number(i)].hora_inicio = inp.value;
    });
  });

  box.querySelectorAll('[data-end]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const [d, i] = inp.dataset.end.split('-');
      stateByDay[Number(d)][Number(i)].hora_fin = inp.value;
    });
  });
}

function updateModeVisibility() {
  const isChange = $('reqTipo').value === 'cambio_horario';
  $('existingDoctorField').classList.toggle('hidden', !isChange);
  $('newDoctorFields').classList.toggle('hidden', isChange);
}

$('reqTipo').addEventListener('change', updateModeVisibility);

$('reqSpec').addEventListener('change', () => {
  $('reqNewSpecField').classList.toggle('hidden', $('reqSpec').value !== '__new__');
});

$('scheduleRequestForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('formAlert').innerHTML = '';

  const horarios = [];
  for (const { dow } of DAYS_ORDER) {
    for (const b of stateByDay[dow] || []) {
      horarios.push({
        dia_semana: dow,
        hora_inicio: b.hora_inicio,
        hora_fin: b.hora_fin,
      });
    }
  }

  if (horarios.length === 0) {
    $('formAlert').innerHTML =
      '<div class="alert alert-error">Marcá al menos un día y horario disponible antes de enviar.</div>';
    return;
  }

  const btn = $('submitRequestBtn');
  btn.disabled = true;
  btn.textContent = 'Enviando...';

  try {
    const tipo = $('reqTipo').value;
    const payload = {
      tipo,
      profesionalId: tipo === 'cambio_horario' ? Number($('reqExistingDoctor').value) : null,
      nombre: $('reqName').value.trim(),
      matricula: $('reqMatricula').value.trim(),
      especialidadId: $('reqSpec').value === '__new__' ? null : Number($('reqSpec').value),
      nuevaEspecialidad: $('reqSpec').value === '__new__' ? $('reqNewSpec').value.trim() : '',
      telefono: $('reqPhone').value.trim(),
      gmail: $('reqGmail').value.trim(),
      obrasSociales: $('reqObras').value.trim(),
      duracionTurnoMin: Number($('reqDuration').value),
      horarios,
      notas: $('reqNotas').value.trim(),
    };

    await api('/api/schedule-requests', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

    $('requestCard').classList.add('hidden');
    $('successCard').classList.remove('hidden');
  } catch (err) {
    $('formAlert').innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '📨 Enviar mis días y horarios a Administración';
  }
});

$('sendAnotherBtn').addEventListener('click', () => {
  $('scheduleRequestForm').reset();
  DAYS_ORDER.forEach((d) => {
    stateByDay[d.dow] = [];
  });
  updateModeVisibility();
  renderDays();
  $('successCard').classList.add('hidden');
  $('requestCard').classList.remove('hidden');
});

async function init() {
  const [status, specRes, docRes] = await Promise.all([
    api('/api/status'),
    api('/api/specialties?includeEmpty=true'),
    api('/api/doctors'),
  ]);

  $('clinicName').textContent = status.clinic.name;
  $('successClinicName').textContent = status.clinic.name;
  document.title = `Horarios de Profesionales — ${status.clinic.name}`;

  $('reqSpec').innerHTML =
    specRes.specialties
      .map((s) => `<option value="${s.id}">${escapeHtml(s.icono)} ${escapeHtml(s.nombre)}</option>`)
      .join('') + `<option value="__new__">➕ Otra especialidad (escribir)</option>`;

  $('reqExistingDoctor').innerHTML = docRes.doctors
    .map(
      (d) =>
        `<option value="${d.id}">${escapeHtml(d.nombre)} (${escapeHtml(d.especialidad_nombre)})</option>`
    )
    .join('');

  const params = new URLSearchParams(window.location.search);
  if (params.get('doctorId')) {
    $('reqTipo').value = 'cambio_horario';
    $('reqExistingDoctor').value = params.get('doctorId');
    updateModeVisibility();
  }

  renderDays();
}

init();
