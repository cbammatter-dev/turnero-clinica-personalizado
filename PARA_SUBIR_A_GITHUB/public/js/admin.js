const $ = (id) => document.getElementById(id);

let currentUser = null;
let cachedSpecialties = [];

const MEDICAL_ICONS = [
  '🩺', '❤️', '🧠', '💭', '⚡', '🌸', '🤰', '👶',
  '🩹', '🔬', '🧬', '💧', '🫁', '🍽️', '🦠', '🎗️',
  '🦵', '💉', '🏃', '🗣️', '✨', '🦴', '🦷', '🧴',
  '👁️', '👂', '🥗', '💊', '🩻', '🏥', '🩸', '🧘',
];

function renderIconPalette(containerId, inputId) {
  const container = $(containerId);
  if (!container) return;
  container.innerHTML = MEDICAL_ICONS.map(
    (ic) =>
      `<button type="button" class="btn btn-secondary btn-sm" data-pick-icon="${ic}" style="font-size:18px; padding:4px 9px; background:#fff; border:1px solid #cbd5e1;">${ic}</button>`
  ).join('');
  container.querySelectorAll('[data-pick-icon]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $(inputId).value = btn.dataset.pickIcon;
    });
  });
}

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
    credentials: 'same-origin',
    ...options,
  });
  const data = await res.json();
  if (!res.ok) {
    if (res.status === 401 && currentUser) {
      currentUser = null;
      showLoginView();
    }
    throw new Error(data.error || 'Error inesperado.');
  }
  return data;
}

function showAdminAlert(msg, type = 'success') {
  const el = $('adminAlert');
  if (!msg) {
    el.innerHTML = '';
    return;
  }
  el.innerHTML = `<div class="alert alert-${type}">${escapeHtml(msg)}</div>`;
  setTimeout(() => {
    if (el.textContent === msg) el.innerHTML = '';
  }, 5000);
}

/* ============================================================
 * AUTENTICACIÓN Y CAMBIO DE VISTA POR ROL
 * ============================================================ */
function showLoginView() {
  $('loginView').classList.remove('hidden');
  $('portalView').classList.add('hidden');
}

function showPortalView(user) {
  currentUser = user;
  $('loginView').classList.add('hidden');
  $('portalView').classList.remove('hidden');

  const isAdmin = user.rol === 'admin';
  document.querySelectorAll('.admin-only').forEach((el) => {
    el.classList.toggle('hidden', !isAdmin);
  });

  if (isAdmin) {
    $('userRolePill').textContent = `👑 ${user.nombre} (Admin General)`;
    $('portalSubtitle').textContent = 'Administrador General — Toda la Clínica';
    $('dashboardHeading').textContent = 'Gestión General de Agendas';
    $('apptsCardTitle').textContent = '📅 Todos los Turnos de la Clínica';
    $('doctorWelcomeBanner').classList.add('hidden');
  } else {
    $('userRolePill').textContent = `🩺 ${user.nombre}`;
    $('portalSubtitle').textContent = 'Administrador de Mi Agenda';
    $('dashboardHeading').textContent = `Mi Agenda — ${user.profesional_nombre || user.nombre}`;
    $('apptsCardTitle').textContent = '📅 Mis Turnos Agendados';
    $('doctorWelcomeBanner').classList.remove('hidden');
    $('doctorBannerTitle').textContent = `Hola, ${user.profesional_nombre || user.nombre}`;
    $('doctorBannerSub').textContent = `${user.profesional_consultorio || ''} — Solo ves y administrás tus propios turnos y bloqueos.`;
    if ($('doctorRequestScheduleBtn') && user.profesional_id) {
      $('doctorRequestScheduleBtn').href = `/alta-profesional?doctorId=${user.profesional_id}`;
    }

    const calBtn = $('doctorOpenGcalBtn');
    if (user.profesional_calendar_id && user.profesional_calendar_id.includes('@')) {
      calBtn.href = `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(
        user.profesional_calendar_id
      )}`;
      calBtn.classList.remove('hidden');
    } else {
      calBtn.classList.add('hidden');
    }
  }

  setActiveSicapView(isAdmin ? 'otorgar' : 'overview');
}

async function checkSessionAndBoot() {
  try {
    const [status, auth] = await Promise.all([api('/api/status'), api('/api/auth/me')]);
    $('loginClinicName').textContent = `${status.clinic.name} — Acceso`;
    $('clinicName').textContent = status.clinic.name;

    if (auth.authenticated && auth.user) {
      showPortalView(auth.user);
      await refreshAll();
    } else {
      showLoginView();
    }
  } catch {
    showLoginView();
  }
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginAlert').innerHTML = '';
  const btn = $('loginSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Verificando...';

  try {
    const res = await api('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({
        username: $('loginUsername').value.trim(),
        password: $('loginPassword').value,
      }),
    });
    $('loginPassword').value = '';
    showPortalView(res.user);
    await refreshAll();
  } catch (err) {
    $('loginAlert').innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '🔓 Ingresar al panel';
  }
});

$('logoutBtn').addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  currentUser = null;
  showLoginView();
});

$('togglePasswordBoxBtn').addEventListener('click', () => {
  closeAllSicapDropdowns();
  if (activeSicapView === 'clave') {
    setActiveSicapView(getDefaultSicapView());
  } else {
    $('changePasswordCard').classList.remove('hidden');
    setActiveSicapView('clave');
  }
});
$('cancelPassBoxBtn').addEventListener('click', () => {
  $('changePasswordCard').classList.add('hidden');
  setActiveSicapView(getDefaultSicapView());
});

$('changePasswordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({
        currentPassword: $('curPass').value,
        newPassword: $('newPass').value,
      }),
    });
    $('changePasswordForm').reset();
    $('changePasswordCard').classList.add('hidden');
    setActiveSicapView(getDefaultSicapView());
    showAdminAlert('✅ Tu contraseña se actualizó correctamente.');
  } catch (err) {
    showAdminAlert(err.message, 'error');
  }
});

/* ============================================================
 * CARGA DE DATOS (SCOPED POR ROL)
 * ============================================================ */
async function loadStatusAndStats() {
  const [status, stats, googleInfo] = await Promise.all([
    api('/api/status'),
    api('/api/admin/stats'),
    api('/api/admin/google/status'),
  ]);

  $('clinicName').textContent = status.clinic.name;
  document.title = `Panel — ${status.clinic.name}`;

  if (currentUser?.rol === 'admin') {
    $('cfgClinicName').value = status.clinic.name;
    $('cfgClinicAddress').value = status.clinic.address;
    $('cfgClinicPhone').value = status.clinic.phone;

    const waLive = status.integrations.whatsapp === 'live';
    $('waBadge').textContent = waLive
      ? '💬 WhatsApp Cloud API: LIVE'
      : '💬 WhatsApp: Modo Bot Web';
    $('waBadge').className = `badge badge-${status.integrations.whatsapp}`;

    $('googleSetupBadge').textContent = googleInfo.configured
      ? '✅ Conectado (LIVE)'
      : '🧪 Modo Local (falta JSON)';
    $('googleSetupBadge').className = `badge badge-${googleInfo.configured ? 'live' : 'demo'}`;

    if (googleInfo.configured && googleInfo.serviceAccountEmail) {
      $('googleSetupInfo').classList.remove('hidden');
      $('googleSaEmail').textContent = googleInfo.serviceAccountEmail;
    } else {
      $('googleSetupInfo').classList.add('hidden');
    }

    await loadWhatsAppSetupInfo();
  }

  const gcalLive = googleInfo.configured;
  $('gcalBadge').textContent = gcalLive
    ? '📅 Google Calendar: CONECTADO'
    : '📅 Google Calendar: Local';
  $('gcalBadge').className = `badge badge-${gcalLive ? 'live' : 'demo'}`;

  $('statHoy').textContent = stats.totalHoy;
  $('statConfirmados').textContent = stats.confirmados;
  $('statPendientes').textContent = stats.pendientes;
  if ($('statDocs')) $('statDocs').textContent = stats.profesionalesActivos;

  if (!$('blockDate').value) {
    $('blockDate').value = stats.fechaHoy;
  }
}

async function loadSpecialtiesAndDoctors(selectSpecialtyId = null) {
  if (currentUser?.rol !== 'admin') return;

  const [{ specialties }, { doctors }] = await Promise.all([
    api('/api/specialties?includeEmpty=true'),
    api('/api/doctors'),
  ]);
  cachedSpecialties = specialties;
  cachedDoctors = doctors;
  if (typeof renderOtorgarCards === 'function') {
    renderOtorgarCards();
  }

  const prevSpecVal = selectSpecialtyId ? String(selectSpecialtyId) : $('docSpec').value;
  $('docSpec').innerHTML =
    specialties
      .map((s) => `<option value="${s.id}">${escapeHtml(s.icono)} ${escapeHtml(s.nombre)}</option>`)
      .join('') +
    `<option value="__new__">➕ Crear nueva especialidad...</option>`;

  if (prevSpecVal && prevSpecVal !== '__new__' && [...$('docSpec').options].some((o) => o.value === prevSpecVal)) {
    $('docSpec').value = prevSpecVal;
  }

  const doctorOptions = doctors
    .map(
      (d) =>
        `<option value="${d.id}">${escapeHtml(d.nombre)} (${escapeHtml(d.especialidad_nombre)})</option>`
    )
    .join('');

  const currentFilter = $('filterDoctor').value;
  $('filterDoctor').innerHTML = `<option value="">Todos los profesionales</option>${doctorOptions}`;
  $('filterDoctor').value = currentFilter;
  $('blockDoctor').innerHTML = doctorOptions;
  $('uDoctor').innerHTML = doctorOptions;

  const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const summarizeHorarios = (horarios = []) => {
    if (!horarios.length) return '<span style="color:#b91c1c;">Sin horarios cargados</span>';
    return horarios
      .map((h) => `${DAY_SHORT[h.dia_semana]} ${h.hora_inicio}–${h.hora_fin}`)
      .join('<br />');
  };

  $('doctorsTbody').innerHTML = doctors
    .map((d) => {
      const hasRealCal =
        d.google_calendar_id && d.google_calendar_id.includes('@group.calendar.google.com');
      const openCalUrl = hasRealCal
        ? `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(d.google_calendar_id)}`
        : '';

      return `
      <tr>
        <td>
          <strong>${escapeHtml(d.nombre)}</strong><br />
          <small style="color:#64748b;">Turnos de ${d.duracion_turno_min} min</small>
        </td>
        <td>${escapeHtml(d.especialidad_icono)} ${escapeHtml(d.especialidad_nombre)}</td>
        <td style="font-size:12px; line-height:1.45; min-width:140px;">${summarizeHorarios(d.horarios)}</td>
        <td><input type="text" value="${escapeHtml(d.consultorio)}" data-edit-room="${d.id}" style="padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; width:165px;" /></td>
        <td><input type="text" value="${escapeHtml(d.google_calendar_id)}" data-edit-gcal="${d.id}" style="padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px; width:210px;" /></td>
        <td>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="btn btn-warning btn-sm" data-sched-doc="${d.id}" style="background:#0284c7;">🗓️ Horarios</button>
            <button type="button" class="btn btn-primary btn-sm" data-save-doc="${d.id}">Guardar</button>
            <button type="button" class="btn btn-secondary btn-sm" data-test-doc="${d.id}">🧪 Probar</button>
            ${
              hasRealCal
                ? `<a class="btn btn-success btn-sm" href="${openCalUrl}" target="_blank" rel="noopener">📅 Abrir</a>`
                : `<button type="button" class="btn btn-success btn-sm" data-create-cal-doc="${d.id}">✨ Crear</button>`
            }
            <button type="button" class="btn btn-danger btn-sm" data-del-doc="${d.id}" data-del-doc-name="${escapeHtml(d.nombre)}" title="Eliminar o dar de baja este profesional">🗑️ Eliminar</button>
          </div>
        </td>
      </tr>`;
    })
    .join('');

  $('doctorsTbody').querySelectorAll('[data-sched-doc]').forEach((btn) => {
    btn.addEventListener('click', () => openScheduleModal(Number(btn.dataset.schedDoc)));
  });

  $('doctorsTbody').querySelectorAll('[data-del-doc]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.delDoc;
      const name = btn.dataset.delDocName || 'este profesional';
      if (
        !confirm(
          `¿Seguro que querés eliminar / dar de baja a ${name}?\n\nDejará de aparecer en el Turnero Web, en el Bot y en la lista de agendas (si ya tuvo atenciones previas, sus historias clínicas y reportes Excel se conservan intactos).`
        )
      ) {
        return;
      }
      try {
        const res = await api(`/api/admin/doctors/${id}`, { method: 'DELETE' });
        showAdminAlert(`🗑️ ${res.message || 'Profesional eliminado.'}`);
        await Promise.all([loadSpecialtiesAndDoctors(), loadUsers(), loadStatusAndStats()]);
      } catch (err) {
        showAdminAlert(err.message, 'error');
      }
    });
  });

  $('doctorsTbody').querySelectorAll('[data-save-doc]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.saveDoc;
      const googleCalendarId = document.querySelector(`[data-edit-gcal="${id}"]`).value;
      const consultorio = document.querySelector(`[data-edit-room="${id}"]`).value;
      try {
        await api(`/api/admin/doctors/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ googleCalendarId, consultorio }),
        });
        showAdminAlert('✅ Profesional actualizado correctamente.');
      } catch (err) {
        showAdminAlert(err.message, 'error');
      }
    });
  });

  $('doctorsTbody').querySelectorAll('[data-test-doc]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.testDoc;
      const calendarId = document.querySelector(`[data-edit-gcal="${id}"]`).value.trim();
      const box = $('googleTestResult');
      box.innerHTML = '<div class="alert alert-info">Probando conexión con Google Calendar...</div>';
      try {
        const res = await api('/api/admin/google/test', {
          method: 'POST',
          body: JSON.stringify({ calendarId }),
        });
        box.innerHTML = `<div class="alert alert-success">✅ ${escapeHtml(res.message)}</div>`;
        showAdminAlert(`✅ ${res.message}`);
      } catch (err) {
        box.innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
        showAdminAlert(`❌ ${err.message}`, 'error');
      }
    });
  });

  $('doctorsTbody').querySelectorAll('[data-create-cal-doc]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.createCalDoc;
      const ownerEmail =
        $('clinicOwnerGmail').value.trim() ||
        prompt('Escribí tu email de Gmail donde querés ver este calendario:');
      if (!ownerEmail) return;
      $('clinicOwnerGmail').value = ownerEmail;
      localStorage.setItem('clinic_owner_gmail', ownerEmail);

      btn.disabled = true;
      btn.textContent = 'Creando...';
      try {
        const res = await api(`/api/admin/doctors/${id}/create-calendar`, {
          method: 'POST',
          body: JSON.stringify({ ownerEmail }),
        });
        $('googleTestResult').innerHTML = `
          <div class="alert alert-success">
            ✅ Calendario creado para <strong>${escapeHtml(res.doctorName)}</strong> y compartido con <strong>${escapeHtml(ownerEmail)}</strong>.
            <a href="${res.addUrl}" target="_blank" rel="noopener" style="margin-left:8px; font-weight:700;">📅 Agregar a mi Google Calendar</a>
          </div>`;
        await loadSpecialtiesAndDoctors();
      } catch (err) {
        $('googleTestResult').innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
        btn.disabled = false;
        btn.textContent = '✨ Crear';
      }
    });
  });
}

async function loadUsers() {
  if (currentUser?.rol !== 'admin') return;
  const { users } = await api('/api/admin/users');

  $('usersTbody').innerHTML = users
    .map(
      (u) => `
      <tr>
        <td><code><strong>${escapeHtml(u.username)}</strong></code></td>
        <td>${escapeHtml(u.nombre)}</td>
        <td>
          ${
            u.rol === 'admin'
              ? '<span class="badge badge-confirmado">👑 Admin General</span>'
              : '<span class="badge badge-demo">🩺 Admin de su Agenda</span>'
          }
        </td>
        <td>${u.rol === 'admin' ? 'Toda la clínica' : escapeHtml(u.profesional_nombre || 'Sin asignar')}</td>
        <td>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="btn btn-secondary btn-sm" data-reset-pass="${u.id}" data-uname="${escapeHtml(u.username)}">🔑 Cambiar clave</button>
            ${
              u.id !== currentUser.id
                ? `<button type="button" class="btn btn-danger btn-sm" data-del-user="${u.id}" data-uname="${escapeHtml(u.username)}">🗑️</button>`
                : ''
            }
          </div>
        </td>
      </tr>`
    )
    .join('');

  $('usersTbody').querySelectorAll('[data-reset-pass]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const newPass = prompt(`Ingresá la nueva contraseña para el usuario "${btn.dataset.uname}" (mín. 4 caracteres):`);
      if (!newPass) return;
      try {
        await api(`/api/admin/users/${btn.dataset.resetPass}`, {
          method: 'PATCH',
          body: JSON.stringify({ password: newPass }),
        });
        showAdminAlert(`🔑 Contraseña actualizada para "${btn.dataset.uname}".`);
      } catch (err) {
        showAdminAlert(err.message, 'error');
      }
    });
  });

  $('usersTbody').querySelectorAll('[data-del-user]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`¿Eliminar el usuario "${btn.dataset.uname}"?`)) return;
      try {
        await api(`/api/admin/users/${btn.dataset.delUser}`, { method: 'DELETE' });
        showAdminAlert(`Usuario "${btn.dataset.uname}" eliminado.`);
        await loadUsers();
      } catch (err) {
        showAdminAlert(err.message, 'error');
      }
    });
  });
}

async function loadAppointments() {
  const params = new URLSearchParams();
  if ($('filterDate').value) params.set('fecha', $('filterDate').value);
  if (currentUser?.rol === 'admin' && $('filterDoctor').value) {
    params.set('profesionalId', $('filterDoctor').value);
  }
  if ($('filterStatus').value) params.set('estado', $('filterStatus').value);

  const { appointments } = await api(`/api/appointments?${params.toString()}`);
  const tbody = $('appointmentsTbody');
  const mobileList = $('appointmentsMobileList');

  if (appointments.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7" style="text-align:center; padding:24px; color:#64748b;">No hay turnos con los filtros actuales.</td></tr>';
    if (mobileList) {
      mobileList.innerHTML =
        '<div style="text-align:center; padding:20px; color:#64748b; font-size:14px;">No hay turnos con los filtros actuales.</div>';
    }
    return;
  }

  const getStatusMeta = (estado) => {
    if (estado === 'confirmado') return { dotClass: 'gcal-green', label: 'Confirmado' };
    if (estado === 'asistio') return { dotClass: 'gcal-blue', label: 'Atendido' };
    if (estado === 'reservado') return { dotClass: 'gcal-yellow', label: 'Reservado' };
    return { dotClass: 'gcal-red', label: 'Cancelado' };
  };

  tbody.innerHTML = appointments
    .map((a) => {
      const { dotClass, label: statusLabel } = getStatusMeta(a.estado);

      return `
        <tr>
          <td>
            <strong>${escapeHtml(a.fecha)}</strong><br />
            <span>⏰ ${escapeHtml(a.hora_inicio)} - ${escapeHtml(a.hora_fin)}</span><br />
            <small style="color:#64748b;">${escapeHtml(a.codigo)}</small>
            ${a.notas ? `<br /><small style="color:#0284c7; font-weight:600;">${escapeHtml(a.notas)}</small>` : ''}
          </td>
          <td>
            <strong>${escapeHtml(a.paciente_nombre)}</strong><br />
            <small>DNI ${escapeHtml(a.paciente_dni)} • <strong>${escapeHtml(a.obra_social)}</strong></small><br />
            <small>📱 ${escapeHtml(a.paciente_whatsapp)}</small>
          </td>
          <td>
            <strong>${escapeHtml(a.profesional_nombre)}</strong><br />
            <small>${escapeHtml(a.especialidad_nombre)} • ${escapeHtml(a.consultorio)}</small>
          </td>
          <td>${a.canal_origen === 'whatsapp' ? '📱 WhatsApp' : '🌐 Web'}</td>
          <td>
            <span class="badge badge-${a.estado}">
              <span class="gcal-dot ${dotClass}"></span>${statusLabel}
            </span><br />
            <small style="color:#64748b;">GCal: ${a.google_sync_mode === 'live' ? 'Live' : 'Local'}</small>
          </td>
          <td>
            ${
              a.recordatorio_24h_enviado
                ? '<span style="color:#15803d; font-weight:600;">✅ Enviado</span>'
                : '<span style="color:#64748b;">Pendiente</span>'
            }
          </td>
          <td>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="btn btn-primary btn-sm" data-attend="${a.id}" title="Registrar atención / Historia clínica">📝 Atención</button>
              <button type="button" class="btn btn-success btn-sm" data-rx="${a.id}" title="Abrir recetario electrónico para ${escapeHtml(a.obra_social)}">💊 Recetario</button>
              ${
                a.estado !== 'cancelado' && a.estado !== 'asistio'
                  ? `<button type="button" class="btn btn-secondary btn-sm" data-rem="${a.id}" title="Enviar recordatorio 24h al paciente ahora">⏰ 24h</button>`
                  : ''
              }
              ${
                a.estado === 'reservado'
                  ? `<button type="button" class="btn btn-success btn-sm" data-ok="${a.id}" title="Confirmar turno">✅</button>`
                  : ''
              }
              ${
                a.estado !== 'cancelado' && a.estado !== 'asistio'
                  ? `<button type="button" class="btn btn-danger btn-sm" data-del="${a.id}" title="Cancelar turno">❌</button>`
                  : ''
              }
            </div>
          </td>
        </tr>`;
    })
    .join('');

  if (mobileList) {
    mobileList.innerHTML = appointments
      .map((a) => {
        const { dotClass, label: statusLabel } = getStatusMeta(a.estado);
        return `
          <div class="mobile-appt-card">
            <div class="mobile-appt-header">
              <div>
                <strong style="font-size:16px;">${escapeHtml(a.paciente_nombre)}</strong>
                <div style="font-size:13px; color:#475569;">DNI ${escapeHtml(a.paciente_dni)} • <strong>${escapeHtml(a.obra_social)}</strong></div>
              </div>
              <span class="badge badge-${a.estado}">
                <span class="gcal-dot ${dotClass}"></span>${statusLabel}
              </span>
            </div>
            <div style="font-size:13px; color:#334155; display:flex; flex-direction:column; gap:2px;">
              <div>📅 <strong>${escapeHtml(a.fecha)}</strong> — ⏰ <strong>${escapeHtml(a.hora_inicio)} hs</strong> <small style="color:#64748b;">(${escapeHtml(a.codigo)})</small></div>
              ${a.notas ? `<div style="color:#0284c7; font-weight:600; font-size:12px;">${escapeHtml(a.notas)}</div>` : ''}
              <div>🩺 ${escapeHtml(a.profesional_nombre)} (${escapeHtml(a.especialidad_nombre)})</div>
              <div>📱 ${escapeHtml(a.paciente_whatsapp)}</div>
            </div>
            <div class="mobile-appt-actions">
              <button type="button" class="btn btn-primary btn-sm" data-attend="${a.id}">📝 Atención</button>
              <button type="button" class="btn btn-success btn-sm" data-rx="${a.id}">💊 Recetario</button>
            </div>
            <div class="mobile-appt-subactions">
              ${
                a.estado !== 'cancelado' && a.estado !== 'asistio'
                  ? `<button type="button" class="btn btn-secondary btn-sm" data-rem="${a.id}">⏰ Recordar 24h</button>`
                  : ''
              }
              ${
                a.estado === 'reservado'
                  ? `<button type="button" class="btn btn-success btn-sm" data-ok="${a.id}">✅ Confirmar</button>`
                  : ''
              }
              ${
                a.estado !== 'cancelado' && a.estado !== 'asistio'
                  ? `<button type="button" class="btn btn-danger btn-sm" data-del="${a.id}">❌ Cancelar</button>`
                  : ''
              }
            </div>
          </div>`;
      })
      .join('');
  }

  const apptById = new Map(appointments.map((a) => [String(a.id), a]));

  const bindActions = (root) => {
    if (!root) return;

    root.querySelectorAll('[data-attend]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = apptById.get(btn.dataset.attend);
        if (!a) return;
        openClinicalModal({
          pacienteId: a.paciente_id,
          turnoId: a.id,
          profesionalId: a.profesional_id,
          turnoLabel: `${a.fecha} ${a.hora_inicio} hs — ${a.profesional_nombre}`,
        });
      });
    });

    root.querySelectorAll('[data-rx]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const a = apptById.get(btn.dataset.rx);
        if (!a) return;
        openRecetariosModal({
          nombre: a.paciente_nombre,
          dni: a.paciente_dni,
          obraSocial: a.obra_social,
        });
      });
    });

    root.querySelectorAll('[data-rem]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        try {
          const res = await api(`/api/appointments/${btn.dataset.rem}/send-reminder`, { method: 'POST' });
          const a = res.appointment;
          if (res.delivery?.mode === 'live') {
            showAdminAlert(
              `✅ Recordatorio 24 hs enviado al WhatsApp real de ${a.paciente_nombre} (${a.paciente_whatsapp}).`
            );
          } else {
            const botUrl = `${window.location.origin}/bot?phone=${encodeURIComponent(a.paciente_whatsapp)}`;
            const waMsg =
              `¡Hola ${a.paciente_nombre}! 👋 Te recordamos tu turno en ${$('clinicName').textContent} ` +
              `el ${a.fecha} a las ${a.hora_inicio} hs con ${a.profesional_nombre} (${a.consultorio}). ` +
              `Para confirmar, modificar o cancelar tu turno tocá acá: ${botUrl}`;
            const waRealUrl = `https://wa.me/${encodeURIComponent(a.paciente_whatsapp)}?text=${encodeURIComponent(waMsg)}`;
            $('adminAlert').innerHTML = `
              <div class="alert alert-info">
                <strong>⏰ Recordatorio 24 hs generado en el Bot Web</strong> para ${escapeHtml(a.paciente_nombre)} (${escapeHtml(a.paciente_whatsapp)}).
                <div style="margin-top:8px; display:flex; gap:8px; flex-wrap:wrap;">
                  <a href="${waRealUrl}" target="_blank" rel="noopener" class="btn btn-success btn-sm">📲 Enviarlo ahora por WhatsApp real</a>
                  <a href="${botUrl}" target="_blank" rel="noopener" class="btn btn-secondary btn-sm">💬 Verlo en el Bot Web</a>
                </div>
                <div style="font-size:12px; margin-top:6px; color:#334155;">
                  (Para que salga solo al WhatsApp real de forma 100% automática sin tocar nada, falta conectar Meta WhatsApp Cloud API).
                </div>
              </div>`;
          }
          await refreshAll();
        } catch (err) {
          showAdminAlert(err.message, 'error');
        }
      });
    });

    root.querySelectorAll('[data-ok]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        await api(`/api/appointments/${btn.dataset.ok}/confirm`, { method: 'POST' });
        showAdminAlert('✅ Turno confirmado y marcado en Verde en Google Calendar.');
        await refreshAll();
      });
    });

    root.querySelectorAll('[data-del]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Cancelar este turno y liberar el espacio en Google Calendar?')) return;
        await api(`/api/appointments/${btn.dataset.del}/cancel`, { method: 'POST' });
        showAdminAlert('❌ Turno cancelado y hueco liberado.');
        await refreshAll();
      });
    });
  };

  bindActions(tbody);
  bindActions(mobileList);
}

async function loadBlocks() {
  const { blocks } = await api('/api/admin/blocks');
  const box = $('blocksList');
  if (blocks.length === 0) {
    box.innerHTML = '<div style="font-size:13px; color:#64748b;">No hay bloqueos manuales activos.</div>';
    return;
  }

  box.innerHTML = blocks
    .map(
      (b) => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 12px; border:1px solid #fecaca; background:#fef2f2; border-radius:10px; margin-bottom:8px; gap:10px; flex-wrap:wrap;">
        <div>
          <strong>🔴 ${escapeHtml(b.profesional_nombre)}</strong> — ${escapeHtml(b.fecha)} (${escapeHtml(b.hora_inicio)} a ${escapeHtml(b.hora_fin)})
          <span style="color:#7f1d1d;">• ${escapeHtml(b.motivo)}</span>
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-del-block="${b.id}">Quitar bloqueo</button>
      </div>`
    )
    .join('');

  box.querySelectorAll('[data-del-block]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/admin/blocks/${btn.dataset.delBlock}`, { method: 'DELETE' });
      showAdminAlert('Bloqueo eliminado y horarios habilitados nuevamente.');
      await loadBlocks();
    });
  });
}

/* ============================================================
 * FORMULARIOS Y ACCIONES
 * ============================================================ */
$('blockForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/api/admin/blocks', {
      method: 'POST',
      body: JSON.stringify({
        profesionalId:
          currentUser.rol === 'admin' ? Number($('blockDoctor').value) : currentUser.profesional_id,
        fecha: $('blockDate').value,
        horaInicio: $('blockStart').value,
        horaFin: $('blockEnd').value,
        motivo: $('blockReason').value,
      }),
    });
    showAdminAlert('🔴 Bloqueo creado. Esos horarios ya no aparecerán en el Bot ni en la Web.');
    await loadBlocks();
  } catch (err) {
    showAdminAlert(err.message, 'error');
  }
});

$('uRol').addEventListener('change', () => {
  $('uDoctorField').classList.toggle('hidden', $('uRol').value === 'admin');
});

$('newUserForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const rol = $('uRol').value;
    await api('/api/admin/users', {
      method: 'POST',
      body: JSON.stringify({
        username: $('uUsername').value.trim(),
        password: $('uPassword').value,
        nombre: $('uName').value.trim(),
        rol,
        profesionalId: rol === 'profesional' ? Number($('uDoctor').value) : null,
      }),
    });
    $('newUserForm').reset();
    $('uDoctorField').classList.remove('hidden');
    showAdminAlert('✅ Usuario creado correctamente. Ya puede ingresar con su usuario y contraseña.');
    await loadUsers();
  } catch (err) {
    showAdminAlert(err.message, 'error');
  }
});

renderIconPalette('editSpecIconPalette', 'editSpecIconInput');
renderIconPalette('newSpecIconPalette', 'newSpecIcon');

function openEditSpecIconBox() {
  const specId = Number($('docSpec').value);
  const spec = cachedSpecialties.find((s) => s.id === specId);
  if (!spec) {
    showAdminAlert('Elegí primero una especialidad de la lista.', 'error');
    return;
  }
  closeNewSpecBox();
  $('editSpecIconTitle').textContent = `${spec.icono} ${spec.nombre}`;
  $('editSpecIconInput').value = spec.icono || '🩺';
  $('editSpecIconBox').classList.remove('hidden');
}

function closeEditSpecIconBox() {
  $('editSpecIconBox').classList.add('hidden');
}

$('toggleEditSpecIconBtn').addEventListener('click', () => {
  if ($('editSpecIconBox').classList.contains('hidden')) openEditSpecIconBox();
  else closeEditSpecIconBox();
});

$('cancelEditSpecIconBtn').addEventListener('click', closeEditSpecIconBox);

$('saveEditSpecIconBtn').addEventListener('click', async () => {
  const specId = Number($('docSpec').value);
  const icono = $('editSpecIconInput').value.trim();
  if (!specId || !icono) {
    showAdminAlert('Elegí o escribí un ícono válido.', 'error');
    return;
  }
  try {
    const { specialty } = await api(`/api/admin/specialties/${specId}`, {
      method: 'PATCH',
      body: JSON.stringify({ icono }),
    });
    closeEditSpecIconBox();
    await loadSpecialtiesAndDoctors(specialty.id);
    showAdminAlert(`🎨 Ícono actualizado: ${specialty.icono} ${specialty.nombre}`);
  } catch (err) {
    showAdminAlert(err.message, 'error');
  }
});

function openNewSpecBox() {
  closeEditSpecIconBox();
  $('newSpecBox').classList.remove('hidden');
  $('newSpecName').focus();
}

function closeNewSpecBox() {
  $('newSpecBox').classList.add('hidden');
  $('newSpecName').value = '';
  $('newSpecDesc').value = '';
  if ($('docSpec').value === '__new__' && $('docSpec').options.length > 1) {
    $('docSpec').selectedIndex = 0;
  }
}

$('toggleNewSpecBtn').addEventListener('click', () => {
  if ($('newSpecBox').classList.contains('hidden')) openNewSpecBox();
  else closeNewSpecBox();
});

$('cancelNewSpecBtn').addEventListener('click', closeNewSpecBox);

$('docSpec').addEventListener('change', () => {
  if ($('docSpec').value === '__new__') {
    openNewSpecBox();
  } else if (!$('editSpecIconBox').classList.contains('hidden')) {
    openEditSpecIconBox();
  }
});

$('saveNewSpecBtn').addEventListener('click', async () => {
  const nombre = $('newSpecName').value.trim();
  if (!nombre) {
    showAdminAlert('Escribí el nombre de la nueva especialidad.', 'error');
    $('newSpecName').focus();
    return;
  }
  try {
    const { specialty } = await api('/api/admin/specialties', {
      method: 'POST',
      body: JSON.stringify({
        nombre,
        icono: $('newSpecIcon').value,
        descripcion: $('newSpecDesc').value.trim(),
      }),
    });
    closeNewSpecBox();
    await loadSpecialtiesAndDoctors(specialty.id);
    showAdminAlert(`✅ Especialidad "${specialty.icono} ${specialty.nombre}" creada y seleccionada.`);
  } catch (err) {
    showAdminAlert(err.message, 'error');
  }
});

$('newDoctorForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const specVal = $('docSpec').value;
    const isCreatingNewSpec = specVal === '__new__' || (!$('newSpecBox').classList.contains('hidden') && $('newSpecName').value.trim());

    const payload = {
      nombre: $('docName').value,
      consultorio: $('docRoom').value,
      duracionTurnoMin: Number($('docDuration').value),
      googleCalendarId: $('docGcal').value,
    };

    if (isCreatingNewSpec) {
      const newName = $('newSpecName').value.trim();
      if (!newName) {
        showAdminAlert('Escribí el nombre de la nueva especialidad o elegí una existente.', 'error');
        $('newSpecName').focus();
        return;
      }
      payload.nuevaEspecialidad = {
        nombre: newName,
        icono: $('newSpecIcon').value,
        descripcion: $('newSpecDesc').value.trim(),
      };
    } else {
      payload.especialidadId = Number(specVal);
    }

    await api('/api/admin/doctors', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    $('newDoctorForm').reset();
    closeNewSpecBox();
    showAdminAlert('✅ Nuevo profesional agregado correctamente.');
    await refreshAll();
  } catch (err) {
    showAdminAlert(err.message, 'error');
  }
});

$('clinicSettingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const res = await api('/api/admin/clinic', {
      method: 'PATCH',
      body: JSON.stringify({
        name: $('cfgClinicName').value,
        address: $('cfgClinicAddress').value,
        phone: $('cfgClinicPhone').value,
      }),
    });
    $('clinicName').textContent = res.clinic.name;
    document.title = `Panel — ${res.clinic.name}`;
    showAdminAlert(`✅ Nombre actualizado a "${res.clinic.name}".`);
  } catch (err) {
    showAdminAlert(err.message, 'error');
  }
});

$('copyBotLinkBtn').addEventListener('click', async () => {
  const url = `${window.location.origin}/bot`;
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(window.location.origin);
  try {
    await navigator.clipboard.writeText(url);
    showAdminAlert(
      isLocal
        ? `⚠️ Copiado (${url}), pero es local y NO abre en celulares. Para compartir, abrí el panel desde tu enlace público (Render o link de celular).`
        : `📋 Link del Bot para pacientes copiado: ${url}`,
      isLocal ? 'info' : 'success'
    );
  } catch {
    showAdminAlert(`Compartí este link: ${url}`, 'info');
  }
});

$('uploadGoogleKeyBtn').addEventListener('click', async () => {
  const fileInput = $('googleKeyFileInput');
  const box = $('googleTestResult');
  const file = fileInput.files?.[0];
  if (!file) {
    box.innerHTML =
      '<div class="alert alert-error">Seleccioná primero el archivo JSON descargado de Google Cloud.</div>';
    return;
  }

  try {
    const text = await file.text();
    const res = await api('/api/admin/google/credentials', {
      method: 'POST',
      body: JSON.stringify({ serviceAccountJson: text }),
    });
    box.innerHTML = `<div class="alert alert-success">✅ ¡Google Calendar activado! (${escapeHtml(res.serviceAccountEmail)})</div>`;
    fileInput.value = '';
    await loadStatusAndStats();
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  }
});

$('copySaEmailBtn').addEventListener('click', async () => {
  const email = $('googleSaEmail').textContent;
  if (!email) return;
  try {
    await navigator.clipboard.writeText(email);
    showAdminAlert('📋 Email de la cuenta de servicio copiado.');
  } catch {
    showAdminAlert(`Copiá este email: ${email}`, 'info');
  }
});

const savedGmail = localStorage.getItem('clinic_owner_gmail');
if (savedGmail && $('clinicOwnerGmail')) {
  $('clinicOwnerGmail').value = savedGmail;
}

$('autoCreateAllCalsBtn').addEventListener('click', async () => {
  const ownerEmail = $('clinicOwnerGmail').value.trim();
  const box = $('googleTestResult');
  if (!ownerEmail || !ownerEmail.includes('@')) {
    box.innerHTML =
      '<div class="alert alert-error">Escribí tu email de Gmail arriba para compartirte los calendarios.</div>';
    $('clinicOwnerGmail').focus();
    return;
  }
  localStorage.setItem('clinic_owner_gmail', ownerEmail);

  const btn = $('autoCreateAllCalsBtn');
  btn.disabled = true;
  btn.textContent = '⏳ Creando calendarios en Google...';
  box.innerHTML =
    '<div class="alert alert-info">Creando un Google Calendar individual para cada médico...</div>';

  try {
    const res = await api('/api/admin/google/create-all-calendars', {
      method: 'POST',
      body: JSON.stringify({ ownerEmail }),
    });

    const linksHtml = res.results
      .map(
        (r) => `
        <li style="margin:6px 0;">
          <strong>${escapeHtml(r.doctorName)}</strong> —
          <a href="${r.addUrl}" target="_blank" rel="noopener" style="font-weight:700; color:#0f766e;">
            📅 Agregar / Abrir en mi Google Calendar
          </a>
        </li>`
      )
      .join('');

    box.innerHTML = `
      <div class="alert alert-success">
        <strong>🎉 ¡Listo! Se asignó un Google Calendar a los ${res.total} médicos y se compartieron con ${escapeHtml(ownerEmail)}.</strong>
        <ul style="margin:6px 0 0 18px; padding:0;">${linksHtml}</ul>
      </div>`;

    await loadSpecialtiesAndDoctors();
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '✨ Crear calendarios para todos los médicos';
  }
});

async function loadObrasSociales() {
  if (currentUser?.rol !== 'admin') return;
  const { obrasSociales } = await api('/api/obras-sociales');
  if ($('otObraSocial')) {
    const prev = $('otObraSocial').value;
    $('otObraSocial').innerHTML = obrasSociales
      .map((o) => `<option value="${escapeHtml(o.nombre)}">${escapeHtml(o.nombre)}</option>`)
      .join('');
    if (prev && [...$('otObraSocial').options].some((o) => o.value === prev)) {
      $('otObraSocial').value = prev;
    }
  }
  const box = $('obrasSocialesChips');
  if (!box) return;

  box.innerHTML = obrasSociales
    .map(
      (o) => `
      <span style="display:inline-flex; align-items:center; gap:6px; background:#f0fdfa; border:1px solid #99f6e4; color:#115e59; padding:6px 12px; border-radius:999px; font-size:13px; font-weight:600;">
        ${escapeHtml(o.nombre)}
        ${
          o.nombre.toLowerCase() !== 'particular'
            ? `<button type="button" data-del-os="${o.id}" data-os-name="${escapeHtml(o.nombre)}" style="border:none; background:none; color:#b91c1c; cursor:pointer; font-weight:700; padding:0 2px; font-size:15px;" title="Quitar">&times;</button>`
            : ''
        }
      </span>`
    )
    .join('');

  box.querySelectorAll('[data-del-os]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`¿Quitar "${btn.dataset.osName}" de la lista?`)) return;
      try {
        await api(`/api/admin/obras-sociales/${btn.dataset.delOs}`, { method: 'DELETE' });
        showAdminAlert(`Obra social "${btn.dataset.osName}" eliminada.`);
        await loadObrasSociales();
      } catch (err) {
        showAdminAlert(err.message, 'error');
      }
    });
  });
}

$('newObraSocialForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const nombre = $('newObraSocialName').value.trim();
  if (!nombre) return;
  try {
    const res = await api('/api/admin/obras-sociales', {
      method: 'POST',
      body: JSON.stringify({ nombre }),
    });
    $('newObraSocialName').value = '';
    showAdminAlert(`✅ "${res.obraSocial.nombre}" agregada. Ya está disponible en el Turnero Web y el Bot de WhatsApp.`);
    await loadObrasSociales();
  } catch (err) {
    showAdminAlert(err.message, 'error');
  }
});

/* ============================================================
 * HISTORIA CLÍNICA / REGISTRO DE ATENCIONES POR PACIENTE
 * ============================================================ */
let activeClinicalCtx = null;
let activeClinicalData = null;

async function openClinicalModal({ pacienteId, turnoId = null, profesionalId = null, turnoLabel = '' }) {
  activeClinicalCtx = { pacienteId, turnoId, profesionalId, turnoLabel };
  $('clinicalAlert').innerHTML = '';
  $('clinicalRecordForm').reset();
  if ($('recMontoCopagoWrap')) $('recMontoCopagoWrap').classList.add('hidden');
  if ($('recMedioPagoWrap')) $('recMedioPagoWrap').classList.add('hidden');
  $('recMarcarAsistioWrap').classList.toggle('hidden', !turnoId);
  $('recMarcarAsistio').checked = Boolean(turnoId);
  $('clinicalModal').classList.remove('hidden');
  $('clinicalHistoryList').innerHTML = 'Cargando historial clínico...';

  try {
    const [data, rxData] = await Promise.all([
      api(`/api/panel/patients/${pacienteId}/records`),
      api('/api/panel/recetarios'),
    ]);
    activeClinicalData = data;
    const p = data.patient;

    $('clinicalModalTitle').textContent = `📝 Historia Clínica — ${p.nombre_completo}`;
    $('clinicalModalSub').textContent = turnoLabel ? `Turno: ${turnoLabel}` : `DNI ${p.dni} • ${p.obra_social}`;

    const locParts = [p.domicilio, p.localidad].filter(Boolean).join(', ');
    $('clinicalPatientBanner').innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap;">
        <div>
          <p><strong>👤 Paciente:</strong> ${escapeHtml(p.nombre_completo)} &nbsp;|&nbsp; <strong>DNI:</strong> ${escapeHtml(p.dni)}${
            p.fecha_nacimiento ? ` &nbsp;|&nbsp; <strong>F. Nac.:</strong> ${escapeHtml(p.fecha_nacimiento)}` : ''
          }</p>
          <p><strong>🪪 Cobertura:</strong> ${escapeHtml(p.obra_social || 'Particular')}${
            p.nro_afiliado ? ` (Afil. ${escapeHtml(p.nro_afiliado)})` : ''
          } &nbsp;|&nbsp; <strong>📱 WhatsApp:</strong> ${escapeHtml(p.telefono_whatsapp)}</p>
          ${locParts ? `<p><strong>🏠 Domicilio:</strong> ${escapeHtml(locParts)}</p>` : ''}
        </div>
        <button type="button" class="btn btn-secondary btn-sm" id="clinicalEditPatientBtn">✏️ Completar / Editar ficha</button>
      </div>
    `;
    $('clinicalEditPatientBtn')?.addEventListener('click', () => {
      $('clinicalModal').classList.add('hidden');
      openDatabaseModal('patients', p);
    });

    $('recPlataforma').innerHTML =
      `<option value="">Sin receta / No especificado</option>` +
      rxData.recetarios
        .map((r) => `<option value="${escapeHtml(r.nombre)}">${escapeHtml(r.nombre)}</option>`)
        .join('');

    renderClinicalHistory(data.records || []);
  } catch (err) {
    $('clinicalAlert').innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  }
}

function renderClinicalHistory(records) {
  const box = $('clinicalHistoryList');
  if (!records.length) {
    box.innerHTML =
      '<div style="color:#64748b; font-size:14px; padding:10px 0;">Todavía no hay atenciones registradas para este paciente. Cargá la primera evolución arriba.</div>';
    return;
  }

  box.innerHTML = records
    .map(
      (r) => `
      <div class="record-card">
        <div class="record-meta">
          <div>
            <strong>📅 ${escapeHtml(r.fecha_atencion)}</strong> —
            <strong>🩺 ${escapeHtml(r.profesional_nombre)}</strong>
            ${r.especialidad_nombre ? `(${escapeHtml(r.especialidad_nombre)})` : ''}
          </div>
          ${
            currentUser?.rol === 'admin' || currentUser?.id === r.usuario_id
              ? `<button type="button" class="btn btn-secondary btn-sm" data-del-record="${r.id}" style="padding:3px 8px; font-size:12px;">🗑️</button>`
              : ''
          }
        </div>
        ${r.motivo_consulta ? `<div class="record-field"><strong>Motivo de consulta:</strong> ${escapeHtml(r.motivo_consulta)}</div>` : ''}
        ${r.signos_vitales ? `<div class="record-field"><strong>Signos vitales / Examen:</strong> ${escapeHtml(r.signos_vitales)}</div>` : ''}
        ${r.diagnostico ? `<div class="record-field"><strong>Diagnóstico:</strong> ${escapeHtml(r.diagnostico)}</div>` : ''}
        <div class="record-field"><strong>Evolución:</strong>\n${escapeHtml(r.evolucion)}</div>
        ${r.indicaciones ? `<div class="record-field"><strong>Indicaciones / Estudios:</strong>\n${escapeHtml(r.indicaciones)}</div>` : ''}
        ${
          r.receta_plataforma || r.receta_codigo
            ? `<div class="record-field"><strong>💊 Receta electrónica:</strong> ${escapeHtml(r.receta_plataforma || 'Emitida')}${
                r.receta_codigo ? ` — N°/CUIR: <code>${escapeHtml(r.receta_codigo)}</code>` : ''
              }</div>`
            : ''
        }
        <div class="record-field">
          <strong>💵 Copago:</strong>
          ${
            Number(r.abono_copago) === 1
              ? `<span class="badge badge-reservado">Sí — $${Number(r.monto_copago || 0).toLocaleString('es-AR')}${
                  r.medio_pago ? ` (${escapeHtml(r.medio_pago)})` : ''
                }</span>`
              : '<span style="color:#64748b;">No abonó copago</span>'
          }
        </div>
        ${r.proximo_control ? `<div class="record-field"><strong>🗓️ Próximo control:</strong> ${escapeHtml(r.proximo_control)}</div>` : ''}
      </div>`
    )
    .join('');

  box.querySelectorAll('[data-del-record]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este registro de atención?')) return;
      try {
        await api(`/api/panel/records/${btn.dataset.delRecord}`, { method: 'DELETE' });
        await openClinicalModal(activeClinicalCtx);
      } catch (err) {
        $('clinicalAlert').innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
      }
    });
  });
}

$('recAbonoCopago')?.addEventListener('change', () => {
  const paid = $('recAbonoCopago').value === '1';
  $('recMontoCopagoWrap').classList.toggle('hidden', !paid);
  $('recMedioPagoWrap').classList.toggle('hidden', !paid);
  if (paid) $('recMontoCopago').focus();
});

$('clinicalRecordForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeClinicalCtx) return;
  const btn = $('saveClinicalRecordBtn');
  btn.disabled = true;
  btn.textContent = 'Guardando...';
  $('clinicalAlert').innerHTML = '';

  try {
    const abonoCopago = $('recAbonoCopago')?.value === '1';
    await api('/api/panel/records', {
      method: 'POST',
      body: JSON.stringify({
        pacienteId: activeClinicalCtx.pacienteId,
        turnoId: activeClinicalCtx.turnoId,
        profesionalId: activeClinicalCtx.profesionalId,
        motivoConsulta: $('recMotivo').value,
        signosVitales: $('recSignos').value,
        diagnostico: $('recDiagnostico').value,
        evolucion: $('recEvolucion').value,
        indicaciones: $('recIndicaciones').value,
        recetaPlataforma: $('recPlataforma').value,
        recetaCodigo: $('recCodigo').value,
        proximoControl: $('recProximo').value,
        abonoCopago,
        montoCopago: abonoCopago ? Number($('recMontoCopago').value || 0) : 0,
        medioPago: abonoCopago ? $('recMedioPago').value : '',
        marcarAsistio: Boolean(activeClinicalCtx.turnoId && $('recMarcarAsistio').checked),
      }),
    });

    await openClinicalModal(activeClinicalCtx);
    $('clinicalAlert').innerHTML =
      '<div class="alert alert-success">✅ Atención registrada correctamente en la Historia Clínica del paciente.</div>';
    await loadAppointments();
  } catch (err) {
    $('clinicalAlert').innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Guardar atención en Historia Clínica';
  }
});

$('closeClinicalModalBtn').addEventListener('click', () => {
  $('clinicalModal').classList.add('hidden');
});

$('clinicalOpenRecetarioBtn').addEventListener('click', () => {
  if (!activeClinicalData?.patient) return;
  const p = activeClinicalData.patient;
  openRecetariosModal({
    nombre: p.nombre_completo,
    dni: p.dni,
    obraSocial: p.obra_social,
  });
});

$('clinicalPrintBtn').addEventListener('click', () => {
  if (!activeClinicalData?.patient) return;
  const p = activeClinicalData.patient;
  const recs = activeClinicalData.records || [];
  const win = window.open('', 'imprimir_hc', 'width=850,height=700');
  if (!win) return;
  win.document.write(`
    <!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Historia Clínica - ${escapeHtml(p.nombre_completo)}</title>
    <style>body{font-family:Segoe UI,sans-serif;padding:24px;color:#111} .box{border:1px solid #ccc;padding:12px;border-radius:8px;margin-bottom:12px} h1{margin:0 0 6px;font-size:20px}</style>
    </head><body>
    <h1>${escapeHtml($('clinicName').textContent)} — Resumen de Historia Clínica</h1>
    <div class="box"><strong>Paciente:</strong> ${escapeHtml(p.nombre_completo)} | <strong>DNI:</strong> ${escapeHtml(p.dni)} | <strong>Cobertura:</strong> ${escapeHtml(p.obra_social)} | <strong>Tel:</strong> ${escapeHtml(p.telefono_whatsapp)}</div>
    ${recs
      .map(
        (r) => `<div class="box">
          <div><strong>${escapeHtml(r.fecha_atencion)}</strong> — ${escapeHtml(r.profesional_nombre)} ${r.especialidad_nombre ? `(${escapeHtml(r.especialidad_nombre)})` : ''}</div>
          ${r.motivo_consulta ? `<p><strong>Motivo:</strong> ${escapeHtml(r.motivo_consulta)}</p>` : ''}
          ${r.signos_vitales ? `<p><strong>Examen / Signos:</strong> ${escapeHtml(r.signos_vitales)}</p>` : ''}
          ${r.diagnostico ? `<p><strong>Diagnóstico:</strong> ${escapeHtml(r.diagnostico)}</p>` : ''}
          <p><strong>Evolución:</strong> ${escapeHtml(r.evolucion)}</p>
          ${r.indicaciones ? `<p><strong>Indicaciones:</strong> ${escapeHtml(r.indicaciones)}</p>` : ''}
          ${r.receta_plataforma || r.receta_codigo ? `<p><strong>Receta:</strong> ${escapeHtml(r.receta_plataforma)} ${escapeHtml(r.receta_codigo)}</p>` : ''}
        </div>`
      )
      .join('') || '<p>Sin atenciones registradas.</p>'}
    <script>window.print();</script>
    </body></html>
  `);
  win.document.close();
});

/* ============================================================
 * BUSCADOR DE PACIENTES (HISTORIAS CLÍNICAS)
 * ============================================================ */
async function loadPatientSearchResults(q = '') {
  const box = $('patientSearchResults');
  box.innerHTML = 'Buscando pacientes...';
  try {
    const { patients } = await api(`/api/panel/patients/search?q=${encodeURIComponent(q)}`);
    if (!patients.length) {
      box.innerHTML =
        '<div style="color:#64748b; font-size:14px;">No se encontraron pacientes con ese DNI o nombre.</div>';
      return;
    }

    box.innerHTML = patients
      .map(
        (p) => `
        <div class="appt-item" style="margin-bottom:10px; padding:12px;">
          <div>
            <strong>${escapeHtml(p.nombre_completo)}</strong>
            <div style="font-size:13px; color:#475569;">DNI ${escapeHtml(p.dni)} • ${escapeHtml(p.obra_social || 'Particular')} • 📱 ${escapeHtml(p.telefono_whatsapp)}</div>
            <div style="font-size:12px; color:#0f766e; font-weight:600; margin-top:2px;">📚 ${p.total_atenciones} ${p.total_atenciones === 1 ? 'atención registrada' : 'atenciones registradas'}</div>
          </div>
          <div style="display:flex; gap:6px; flex-wrap:wrap;">
            <button type="button" class="btn btn-primary btn-sm" data-open-hc="${p.id}">📝 Ver / Registrar</button>
            <button type="button" class="btn btn-success btn-sm" data-open-rx-p="${p.id}">💊 Recetario</button>
          </div>
        </div>`
      )
      .join('');

    const byId = new Map(patients.map((p) => [String(p.id), p]));
    box.querySelectorAll('[data-open-hc]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('patientSearchModal').classList.add('hidden');
        openClinicalModal({ pacienteId: Number(btn.dataset.openHc) });
      });
    });
    box.querySelectorAll('[data-open-rx-p]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const p = byId.get(btn.dataset.openRxP);
        if (!p) return;
        $('patientSearchModal').classList.add('hidden');
        openRecetariosModal({ nombre: p.nombre_completo, dni: p.dni, obraSocial: p.obra_social });
      });
    });
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  }
}

$('openPatientsSearchBtn').addEventListener('click', () => {
  $('patientSearchInput').value = '';
  $('patientSearchModal').classList.remove('hidden');
  loadPatientSearchResults('');
  setTimeout(() => $('patientSearchInput').focus(), 100);
});

$('closePatientSearchBtn').addEventListener('click', () => {
  $('patientSearchModal').classList.add('hidden');
});

let searchDebounce = null;
$('patientSearchInput').addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => loadPatientSearchResults($('patientSearchInput').value.trim()), 250);
});

/* ============================================================
 * CENTRAL DE RECETARIOS ELECTRÓNICOS (ReNaPDiS / OBRAS SOCIALES)
 * ============================================================ */
let activeRxPatient = null;
let lastIframeUrl = '';

function openSingleRecetarioWindow(url) {
  // Siempre usa el MISMO nombre de ventana ('recetario_clinica_unico') para NO abrir múltiples pestañas
  const win = window.open(url, 'recetario_clinica_unico', 'width=1200,height=840,noopener=no');
  if (win && win.focus) {
    try {
      win.focus();
    } catch {
      // ignore cross-origin focus error
    }
  }
}

async function openRecetariosModal(patient = null) {
  activeRxPatient = patient;
  $('recetariosAlert').innerHTML = '';
  $('recetarioIframeBox').classList.add('hidden');
  $('recetarioIframe').src = 'about:blank';
  $('recetariosModal').classList.remove('hidden');

  if (patient) {
    $('recetarioPatientBar').classList.remove('hidden');
    $('recetarioPatientInfo').innerHTML = `
      <strong>👤 ${escapeHtml(patient.nombre)}</strong> — DNI <strong>${escapeHtml(patient.dni)}</strong> — Cobertura: <span class="badge badge-confirmado">${escapeHtml(patient.obraSocial || 'Particular')}</span>
    `;
  } else {
    $('recetarioPatientBar').classList.add('hidden');
  }

  // Cargar filtro de obras sociales
  const { obrasSociales } = await api('/api/obras-sociales');
  const sel = $('recetarioFilterOs');
  sel.innerHTML =
    `<option value="">Todas las plataformas</option>` +
    obrasSociales
      .map((o) => `<option value="${escapeHtml(o.nombre)}">${escapeHtml(o.nombre)}</option>`)
      .join('');

  if (patient?.obraSocial) {
    const matchOpt = [...sel.options].find(
      (o) => o.value.toLowerCase() === String(patient.obraSocial).toLowerCase()
    );
    sel.value = matchOpt ? matchOpt.value : '';
  }

  await renderRecetariosGrid(patient?.obraSocial || sel.value);
}

async function renderRecetariosGrid(cobertura = '') {
  const grid = $('recetariosGrid');
  grid.innerHTML = 'Cargando plataformas...';

  const { recetarios } = await api(
    `/api/panel/recetarios${cobertura ? `?cobertura=${encodeURIComponent(cobertura)}` : ''}`
  );

  if (!recetarios.length) {
    grid.innerHTML = '<div style="color:#64748b;">No hay recetarios configurados todavía.</div>';
    return;
  }

  grid.innerHTML = recetarios
    .map(
      (r) => `
      <div class="recetario-card ${r.recommended ? 'recommended' : ''}">
        <div>
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:6px; flex-wrap:wrap; margin-bottom:6px;">
            <strong style="font-size:15px;">${escapeHtml(r.nombre)}</strong>
            ${
              r.exactMatch && cobertura
                ? `<span class="badge badge-confirmado">⭐ Para ${escapeHtml(cobertura)}</span>`
                : r.homologada_renapdis
                ? `<span class="badge badge-demo">✅ ReNaPDiS</span>`
                : `<span class="badge badge-reservado">${escapeHtml(r.categoria)}</span>`
            }
          </div>
          <div style="font-size:12px; color:#475569; margin-bottom:6px;">${escapeHtml(r.descripcion || '')}</div>
          <div style="font-size:11px; color:#0f766e;"><strong>Coberturas:</strong> ${escapeHtml(r.coberturas)}</div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap; align-items:center;">
          <button type="button" class="btn btn-success btn-sm" style="flex:1;" data-launch-rx="${escapeHtml(r.url)}" data-launch-name="${escapeHtml(r.nombre)}">
            🚀 Abrir en Ventana Única
          </button>
          ${
            currentUser?.rol === 'admin'
              ? `<button type="button" class="btn btn-danger btn-sm" data-del-rx="${r.id}" data-rx-name="${escapeHtml(r.nombre)}" title="Quitar">🗑️</button>`
              : ''
          }
        </div>
      </div>`
    )
    .join('');

  grid.querySelectorAll('[data-launch-rx]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const url = btn.dataset.launchRx;
      const name = btn.dataset.launchName;
      if ($('recetarioTryIframe').checked) {
        lastIframeUrl = url;
        $('recetarioIframeTitle').textContent = `💊 ${name} (${url})`;
        $('recetarioIframe').src = url;
        $('recetarioIframeBox').classList.remove('hidden');
        $('recetarioIframeBox').scrollIntoView({ behavior: 'smooth', block: 'start' });
      } else {
        openSingleRecetarioWindow(url);
      }
    });
  });

  grid.querySelectorAll('[data-del-rx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      if (!confirm(`¿Quitar "${btn.dataset.rxName}" de la lista de recetarios?`)) return;
      try {
        await api(`/api/admin/recetarios/${btn.dataset.delRx}`, { method: 'DELETE' });
        await renderRecetariosGrid($('recetarioFilterOs').value);
      } catch (err) {
        $('recetariosAlert').innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
      }
    });
  });
}

$('openRecetariosTopBtn').addEventListener('click', () => openRecetariosModal(null));
$('closeRecetariosModalBtn').addEventListener('click', () => {
  $('recetarioIframe').src = 'about:blank';
  $('recetariosModal').classList.add('hidden');
});

$('recetarioFilterOs').addEventListener('change', () => {
  renderRecetariosGrid($('recetarioFilterOs').value);
});

$('recetarioIframePopoutBtn').addEventListener('click', () => {
  if (lastIframeUrl) openSingleRecetarioWindow(lastIframeUrl);
});

$('closeRecetarioIframeBtn').addEventListener('click', () => {
  $('recetarioIframe').src = 'about:blank';
  $('recetarioIframeBox').classList.add('hidden');
});

$('copyPatientForRxBtn').addEventListener('click', async () => {
  if (!activeRxPatient) return;
  const text = `${activeRxPatient.nombre} | DNI: ${activeRxPatient.dni} | Cobertura: ${activeRxPatient.obraSocial || 'Particular'}`;
  try {
    await navigator.clipboard.writeText(text);
    $('recetariosAlert').innerHTML = `<div class="alert alert-success">📋 Copiado: ${escapeHtml(text)}</div>`;
  } catch {
    $('recetariosAlert').innerHTML = `<div class="alert alert-info">${escapeHtml(text)}</div>`;
  }
});

$('newRecetarioForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('recetariosAlert').innerHTML = '';
  try {
    const res = await api('/api/admin/recetarios', {
      method: 'POST',
      body: JSON.stringify({
        nombre: $('rxName').value.trim(),
        url: $('rxUrl').value.trim(),
        coberturas: $('rxCoberturas').value.trim() || 'Todas',
        categoria: $('rxCategoria').value,
        homologadaRenapdis: $('rxCategoria').value === 'ReNaPDiS',
      }),
    });
    $('newRecetarioForm').reset();
    $('rxCoberturas').value = 'Todas';
    $('recetariosAlert').innerHTML = `<div class="alert alert-success">✅ "${escapeHtml(res.recetario.nombre)}" agregada a la Central de Recetarios.</div>`;
    await renderRecetariosGrid($('recetarioFilterOs').value);
  } catch (err) {
    $('recetariosAlert').innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  }
});

/* ============================================================
 * CONEXIÓN FÁCIL DE WHATSAPP REAL (CÓDIGO QR + META OPCIONAL)
 * ============================================================ */
let waQrPollTimer = null;

function stopWaQrPolling() {
  if (waQrPollTimer) {
    clearInterval(waQrPollTimer);
    waQrPollTimer = null;
  }
}

function renderQrState(qr) {
  if (!qr) return;

  if (qr.connected) {
    stopWaQrPolling();
    $('waQrConnectedInfo').classList.remove('hidden');
    $('waQrConnectedPhone').textContent = `Número vinculado: +${qr.phone} (${qr.name || 'WhatsApp Clínica'})`;
    $('waQrImageWrap').classList.add('hidden');
    $('waQrConnectBtn').classList.add('hidden');
    $('waQrDisconnectBtn').classList.remove('hidden');
    $('waQrStatusMsg').textContent = '';
    $('waSetupBadge').textContent = '✅ WhatsApp Conectado (QR)';
    $('waSetupBadge').className = 'badge badge-live';
    $('waBadge').textContent = '💬 WhatsApp: CONECTADO (LIVE)';
    $('waBadge').className = 'badge badge-live';
  } else if (qr.status === 'qr' && qr.qrDataUrl) {
    $('waQrConnectedInfo').classList.add('hidden');
    $('waQrImageWrap').classList.remove('hidden');
    $('waQrImg').src = qr.qrDataUrl;
    $('waQrConnectBtn').classList.add('hidden');
    $('waQrDisconnectBtn').classList.remove('hidden');
    $('waQrStatusMsg').textContent = '';
    $('waSetupBadge').textContent = '📷 Escaneá el QR';
    $('waSetupBadge').className = 'badge badge-reservado';
  } else if (qr.status === 'connecting') {
    $('waQrConnectedInfo').classList.add('hidden');
    $('waQrImageWrap').classList.add('hidden');
    $('waQrStatusMsg').textContent = '⏳ Generando código QR de WhatsApp... (aguardá unos segundos)';
    $('waQrConnectBtn').disabled = true;
  } else {
    $('waQrConnectedInfo').classList.add('hidden');
    $('waQrImageWrap').classList.add('hidden');
    $('waQrConnectBtn').classList.remove('hidden');
    $('waQrConnectBtn').disabled = false;
    $('waQrDisconnectBtn').classList.add('hidden');
    $('waQrStatusMsg').textContent = qr.lastError || '';
  }
}

async function pollQrStatus() {
  try {
    const qr = await api('/api/admin/whatsapp/qr/status');
    renderQrState(qr);
    if (qr.connected) {
      $('waTestResult').innerHTML =
        '<div class="alert alert-success">🎉 ¡WhatsApp vinculado con éxito! Ya podés tocarte "📲 Enviarme mensaje de prueba ahora" abajo.</div>';
    }
  } catch {
    // ignore transient poll error
  }
}

async function loadWhatsAppSetupInfo() {
  if (currentUser?.rol !== 'admin') return;
  try {
    const wa = await api('/api/admin/whatsapp/status');
    const webhookUrl = `${window.location.origin}/webhook/whatsapp`;
    if ($('waWebhookUrl')) $('waWebhookUrl').textContent = webhookUrl;
    if ($('waVerifyTokenPreview')) $('waVerifyTokenPreview').textContent = wa.verifyToken;

    if ($('waSetupBadge')) {
      $('waSetupBadge').textContent = wa.configured ? '✅ Conectado (LIVE)' : '🧪 Modo Bot Web';
      $('waSetupBadge').className = `badge badge-${wa.configured ? 'live' : 'demo'}`;
    }
    if (wa.qr) {
      renderQrState(wa.qr);
      if (wa.qr.status === 'qr' || wa.qr.status === 'connecting') {
        stopWaQrPolling();
        waQrPollTimer = setInterval(pollQrStatus, 2000);
      }
    }
    if ($('waPhoneNumberIdInput') && wa.phoneNumberId) {
      $('waPhoneNumberIdInput').value = wa.phoneNumberId;
    }
    if ($('waTokenHint')) {
      $('waTokenHint').textContent = wa.hasToken
        ? `✅ Token guardado (${wa.tokenPreview}).`
        : 'Opcional si ya usás Código QR.';
    }
    if ($('waTemplateInput') && wa.reminderTemplate) {
      $('waTemplateInput').value = wa.reminderTemplate;
    }
    if ($('waLangInput') && wa.reminderLang) {
      $('waLangInput').value = wa.reminderLang;
    }
    if ($('waDisconnectBtn')) {
      $('waDisconnectBtn').classList.toggle('hidden', !wa.hasToken);
    }
  } catch {
    // ignore
  }
}

$('waQrConnectBtn')?.addEventListener('click', async () => {
  $('waTestResult').innerHTML = '';
  $('waQrConnectBtn').disabled = true;
  $('waQrStatusMsg').textContent = '⏳ Iniciando conexión con WhatsApp y generando QR...';
  try {
    const qr = await api('/api/admin/whatsapp/qr/connect', {
      method: 'POST',
      body: JSON.stringify({ forceNew: false }),
    });
    renderQrState(qr);
    stopWaQrPolling();
    waQrPollTimer = setInterval(pollQrStatus, 2000);
    setTimeout(pollQrStatus, 1200);
  } catch (err) {
    $('waQrConnectBtn').disabled = false;
    $('waQrStatusMsg').textContent = '';
    $('waTestResult').innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  }
});

$('waQrDisconnectBtn')?.addEventListener('click', async () => {
  if (!confirm('¿Desvincular este WhatsApp?')) return;
  stopWaQrPolling();
  const qr = await api('/api/admin/whatsapp/qr/disconnect', { method: 'POST' });
  renderQrState(qr);
  $('waTestResult').innerHTML = '<div class="alert alert-info">WhatsApp desvinculado.</div>';
  await loadStatusAndStats();
});

$('copyWaWebhookBtn')?.addEventListener('click', async () => {
  const url = $('waWebhookUrl').textContent;
  try {
    await navigator.clipboard.writeText(url);
    showAdminAlert(`📋 URL del Webhook copiada: ${url}`);
  } catch {
    showAdminAlert(`Copiá esta URL: ${url}`, 'info');
  }
});

$('copyWaVerifyBtn')?.addEventListener('click', async () => {
  const token = $('waVerifyTokenPreview').textContent;
  try {
    await navigator.clipboard.writeText(token);
    showAdminAlert(`📋 Token de verificación copiado: ${token}`);
  } catch {
    showAdminAlert(`Copiá este token: ${token}`, 'info');
  }
});

$('waConfigForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const box = $('waTestResult');
  box.innerHTML = '';
  try {
    const res = await api('/api/admin/whatsapp/config', {
      method: 'POST',
      body: JSON.stringify({
        phoneNumberId: $('waPhoneNumberIdInput').value.trim(),
        accessToken: $('waAccessTokenInput').value.trim(),
        reminderTemplate: $('waTemplateInput').value.trim(),
        reminderLang: $('waLangInput').value,
      }),
    });
    $('waAccessTokenInput').value = '';
    box.innerHTML =
      '<div class="alert alert-success">✅ ¡WhatsApp Real activado! Ahora probá enviarte un mensaje de prueba abajo.</div>';
    await loadStatusAndStats();
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  }
});

$('waDisconnectBtn')?.addEventListener('click', async () => {
  if (!confirm('¿Desconectar WhatsApp Real y volver al modo Bot Web?')) return;
  await api('/api/admin/whatsapp/disconnect', { method: 'POST' });
  $('waTestResult').innerHTML =
    '<div class="alert alert-info">WhatsApp desconectado. Volvió al modo Bot Web.</div>';
  await loadStatusAndStats();
});

async function runWhatsAppTest(mode) {
  const toPhone = $('waTestPhoneInput').value.trim();
  const box = $('waTestResult');
  box.innerHTML = '<div class="alert alert-info">⏳ Enviando mensaje real por WhatsApp Cloud API...</div>';
  try {
    const res = await api('/api/admin/whatsapp/test', {
      method: 'POST',
      body: JSON.stringify({ toPhone, mode }),
    });
    box.innerHTML = `<div class="alert alert-success">🎉 ${escapeHtml(res.message)}</div>`;
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  }
}

$('waTestHelloBtn')?.addEventListener('click', () => runWhatsAppTest('hello_world'));
$('waTestButtonsBtn')?.addEventListener('click', () => runWhatsAppTest('buttons'));

['filterDate', 'filterDoctor', 'filterStatus'].forEach((id) =>
  $(id).addEventListener('change', loadAppointments)
);
$('refreshBtn').addEventListener('click', refreshAll);

async function refreshAll() {
  if (!currentUser) return;
  await Promise.all([
    loadStatusAndStats(),
    loadSpecialtiesAndDoctors(),
    loadScheduleRequests(),
    loadObrasSociales(),
    loadUsers(),
    loadAppointments(),
    loadBlocks(),
  ]);
}

/* ============================================================
 * EDITOR DE HORARIOS DE ATENCIÓN POR PROFESIONAL
 * ============================================================ */
const DAYS_ORDER = [
  { dow: 1, name: 'Lunes' },
  { dow: 2, name: 'Martes' },
  { dow: 3, name: 'Miércoles' },
  { dow: 4, name: 'Jueves' },
  { dow: 5, name: 'Viernes' },
  { dow: 6, name: 'Sábado' },
  { dow: 0, name: 'Domingo' },
];

let activeScheduleDoctorId = null;
let scheduleStateByDay = {}; // dow -> [{ hora_inicio, hora_fin }]

async function openScheduleModal(doctorId) {
  activeScheduleDoctorId = doctorId;
  $('scheduleAlert').innerHTML = '';
  $('scheduleModal').classList.remove('hidden');
  $('scheduleDaysContainer').innerHTML = 'Cargando horarios...';

  try {
    const { doctor, horarios, especiales } = await api(`/api/admin/doctors/${doctorId}/schedule`);
    $('scheduleModalTitle').textContent = `🗓️ Horarios — ${doctor.nombre}`;
    $('scheduleModalSub').textContent = `${doctor.especialidad_icono} ${doctor.especialidad_nombre} • ${doctor.consultorio}`;
    $('schedDuration').value = String(doctor.duracion_turno_min || 30);

    scheduleStateByDay = {};
    for (const d of DAYS_ORDER) scheduleStateByDay[d.dow] = [];
    for (const h of horarios || []) {
      if (!scheduleStateByDay[h.dia_semana]) scheduleStateByDay[h.dia_semana] = [];
      scheduleStateByDay[h.dia_semana].push({
        hora_inicio: h.hora_inicio,
        hora_fin: h.hora_fin,
      });
    }

    renderScheduleDays();
    renderSpecialHours(especiales || []);
  } catch (err) {
    $('scheduleAlert').innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  }
}

function renderSpecialHours(especiales) {
  const box = $('specialHoursList');
  if (!box) return;
  if (!especiales.length) {
    box.innerHTML =
      '<div style="font-size:13px; color:#64748b;">No hay cambios puntuales cargados para fechas específicas.</div>';
    return;
  }

  box.innerHTML = especiales
    .map(
      (s) => `
      <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; flex-wrap:wrap; padding:8px 12px; border:1px solid #bae6fd; background:#f0f9ff; border-radius:10px; margin-bottom:6px; font-size:13px;">
        <div>
          <strong>📅 ${escapeHtml(s.fecha)}</strong> — ⏰ ${escapeHtml(s.hora_inicio)} a ${escapeHtml(s.hora_fin)}
          ${s.nota ? `<span style="color:#0369a1;"> • ${escapeHtml(s.nota)}</span>` : ''}
        </div>
        <button type="button" class="btn btn-secondary btn-sm" data-del-special="${s.id}" style="padding:3px 8px;">Quitar</button>
      </div>`
    )
    .join('');

  box.querySelectorAll('[data-del-special]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await api(`/api/admin/special-hours/${btn.dataset.delSpecial}`, { method: 'DELETE' });
      const { especiales: refreshed } = await api(`/api/admin/doctors/${activeScheduleDoctorId}/schedule`);
      renderSpecialHours(refreshed || []);
    });
  });
}

$('presetAllDaysBtn')?.addEventListener('click', () => {
  for (const d of DAYS_ORDER) {
    scheduleStateByDay[d.dow] = [{ hora_inicio: '08:00', hora_fin: '20:00' }];
  }
  renderScheduleDays();
});

$('presetMonSatBtn')?.addEventListener('click', () => {
  for (const d of DAYS_ORDER) {
    scheduleStateByDay[d.dow] = d.dow === 0 ? [] : [{ hora_inicio: '09:00', hora_fin: '19:00' }];
  }
  renderScheduleDays();
});

$('presetMonFriBtn')?.addEventListener('click', () => {
  for (const d of DAYS_ORDER) {
    scheduleStateByDay[d.dow] =
      d.dow >= 1 && d.dow <= 5
        ? [
            { hora_inicio: '09:00', hora_fin: '13:00' },
            { hora_inicio: '15:00', hora_fin: '19:00' },
          ]
        : [];
  }
  renderScheduleDays();
});

$('presetClearDaysBtn')?.addEventListener('click', () => {
  for (const d of DAYS_ORDER) scheduleStateByDay[d.dow] = [];
  renderScheduleDays();
});

$('specialHourForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeScheduleDoctorId) return;
  $('scheduleAlert').innerHTML = '';
  try {
    await api(`/api/admin/doctors/${activeScheduleDoctorId}/special-hours`, {
      method: 'POST',
      body: JSON.stringify({
        fecha: $('spDate').value,
        horaInicio: $('spStart').value,
        horaFin: $('spEnd').value,
        nota: $('spNote').value.trim(),
      }),
    });
    $('spNote').value = '';
    const { especiales } = await api(`/api/admin/doctors/${activeScheduleDoctorId}/schedule`);
    renderSpecialHours(especiales || []);
    $('scheduleAlert').innerHTML =
      '<div class="alert alert-success">✅ Fecha puntual habilitada. Ya está disponible en el Bot y la Web.</div>';
  } catch (err) {
    $('scheduleAlert').innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  }
});

$('copyProfFormLinkBtn')?.addEventListener('click', async () => {
  const url = `${window.location.origin}/alta-profesional`;
  const isLocal = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(window.location.origin);
  try {
    await navigator.clipboard.writeText(url);
    showAdminAlert(
      isLocal
        ? `⚠️ Copiado (${url}), pero es local y NO abre en celulares. Para compartir, abrí el panel desde tu enlace público (Render o link de celular).`
        : `📋 Link para Profesionales copiado: ${url}`,
      isLocal ? 'info' : 'success'
    );
  } catch {
    showAdminAlert(`Compartí este link con los profesionales: ${url}`, 'info');
  }
});

/* ============================================================
 * SOLICITUDES DE HORARIOS ENVIADAS POR PROFESIONALES
 * ============================================================ */
async function loadScheduleRequests() {
  if (currentUser?.rol !== 'admin') return;
  const box = $('scheduleRequestsList');
  if (!box) return;

  try {
    const { requests } = await api('/api/admin/schedule-requests');
    const pendingCount = requests.filter((r) => r.estado === 'pendiente').length;
    if ($('pendingReqBadge')) {
      $('pendingReqBadge').textContent =
        pendingCount === 1 ? '1 pendiente' : `${pendingCount} pendientes`;
      $('pendingReqBadge').className = `badge ${pendingCount > 0 ? 'badge-reservado' : 'badge-demo'}`;
    }
    if ($('menuPendingReqDot')) {
      $('menuPendingReqDot').textContent = String(pendingCount);
      $('menuPendingReqDot').classList.toggle('hidden', pendingCount === 0);
    }
    if ($('menuPendingReqCount')) {
      $('menuPendingReqCount').textContent = String(pendingCount);
      $('menuPendingReqCount').classList.toggle('hidden', pendingCount === 0);
    }

    if (requests.length === 0) {
      box.innerHTML =
        '<div style="font-size:13px; color:#64748b;">Todavía no recibiste propuestas de horarios. Copiá el link de <strong>Formulario Profesionales</strong> arriba y envíaselo por WhatsApp a tus médicos.</div>';
      return;
    }

    const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
    box.innerHTML = requests
      .map((r) => {
        const horariosStr = (r.horarios || [])
          .map((h) => `${DAY_SHORT[h.dia_semana]} ${h.hora_inicio}–${h.hora_fin}`)
          .join(' • ');
        const isPending = r.estado === 'pendiente';
        const badgeHtml =
          r.estado === 'aprobada'
            ? '<span class="badge badge-confirmado">✅ Aprobada</span>'
            : r.estado === 'rechazada'
            ? '<span class="badge badge-cancelado">❌ Rechazada</span>'
            : '<span class="badge badge-reservado">⏳ Pendiente de aprobación</span>';

        return `
          <div style="border:1px solid ${isPending ? '#fcd34d' : '#e2e8f0'}; background:${isPending ? '#fffbeb' : '#f8fafc'}; border-radius:12px; padding:14px; margin-bottom:10px;">
            <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; flex-wrap:wrap; margin-bottom:6px;">
              <div>
                <strong style="font-size:16px;">${escapeHtml(r.nombre)}</strong>
                <span style="font-size:13px; color:#475569;"> — ${escapeHtml(r.especialidad_icono)} ${escapeHtml(r.especialidad_nombre)}</span>
                <div style="font-size:12px; color:#0f766e; font-weight:700; margin-top:2px;">
                  ${r.tipo === 'cambio_horario' ? '🔄 Solicita cambio de horarios' : '🆕 Profesional nuevo'} • Turnos de ${r.duracion_turno_min} min
                </div>
              </div>
              ${badgeHtml}
            </div>
            <div style="font-size:13px; color:#334155; margin:6px 0;">
              <strong>🗓️ Días y horarios propuestos:</strong> ${escapeHtml(horariosStr || 'Sin detalle')}
            </div>
            <div style="font-size:12px; color:#475569;">
              ${r.telefono ? `📱 ${escapeHtml(r.telefono)} &nbsp;` : ''}
              ${r.gmail ? `📧 ${escapeHtml(r.gmail)} &nbsp;` : ''}
              ${r.matricula ? `🪪 ${escapeHtml(r.matricula)} &nbsp;` : ''}
              ${r.obras_sociales ? `<br /><strong>Coberturas:</strong> ${escapeHtml(r.obras_sociales)}` : ''}
              ${r.notas ? `<br /><strong>Nota:</strong> ${escapeHtml(r.notas)}` : ''}
            </div>
            ${
              isPending
                ? `<div style="display:flex; gap:8px; flex-wrap:wrap; margin-top:10px;">
                     <button type="button" class="btn btn-success btn-sm" data-approve-req="${r.id}">✅ Aprobar y armar agenda</button>
                     <button type="button" class="btn btn-danger btn-sm" data-reject-req="${r.id}">❌ Rechazar</button>
                   </div>`
                : ''
            }
          </div>`;
      })
      .join('');

    box.querySelectorAll('[data-approve-req]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const consultorio = prompt('¿En qué consultorio atenderá este profesional?', 'Consultorio 1 - Planta Baja');
        if (consultorio === null) return;
        btn.disabled = true;
        btn.textContent = 'Armando agenda...';
        try {
          const ownerEmail = $('clinicOwnerGmail')?.value?.trim() || localStorage.getItem('clinic_owner_gmail') || '';
          const res = await api(`/api/admin/schedule-requests/${btn.dataset.approveReq}/approve`, {
            method: 'POST',
            body: JSON.stringify({ consultorio, ownerEmail }),
          });
          let msg = `✅ ¡Agenda armada para ${res.doctor.nombre}!`;
          if (res.createdUsername) {
            msg += ` Usuario creado: "${res.createdUsername}" / clave inicial: "${res.defaultPassword}".`;
          }
          if (res.calendarAddUrl) {
            msg += ` También se creó automáticamente su Google Calendar.`;
          }
          showAdminAlert(msg);
          await refreshAll();
        } catch (err) {
          showAdminAlert(err.message, 'error');
          btn.disabled = false;
          btn.textContent = '✅ Aprobar y armar agenda';
        }
      });
    });

    box.querySelectorAll('[data-reject-req]').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('¿Rechazar esta solicitud?')) return;
        await api(`/api/admin/schedule-requests/${btn.dataset.rejectReq}/reject`, { method: 'POST' });
        showAdminAlert('Solicitud rechazada.', 'info');
        await loadScheduleRequests();
      });
    });
  } catch {
    // ignore
  }
}

function renderScheduleDays() {
  const container = $('scheduleDaysContainer');
  container.innerHTML = DAYS_ORDER.map(({ dow, name }) => {
    const blocks = scheduleStateByDay[dow] || [];
    const active = blocks.length > 0;

    const blocksHtml = blocks
      .map(
        (b, idx) => `
        <div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-top:6px;">
          <span style="font-size:12px; color:#475569; min-width:58px;">Franja ${idx + 1}:</span>
          <input type="time" value="${escapeHtml(b.hora_inicio)}" data-sched-start="${dow}-${idx}" style="padding:6px 8px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px;" required />
          <span>a</span>
          <input type="time" value="${escapeHtml(b.hora_fin)}" data-sched-end="${dow}-${idx}" style="padding:6px 8px; border:1px solid #cbd5e1; border-radius:8px; font-size:14px;" required />
          <button type="button" class="btn btn-secondary btn-sm" data-sched-del="${dow}-${idx}" style="padding:4px 8px;" title="Quitar franja">✕</button>
        </div>`
      )
      .join('');

    return `
      <div style="border:1px solid ${active ? '#99f6e4' : '#e2e8f0'}; background:${active ? '#f0fdfa' : '#f8fafc'}; border-radius:12px; padding:12px 14px;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:10px; flex-wrap:wrap;">
          <label style="display:flex; align-items:center; gap:8px; font-weight:700; font-size:15px; cursor:pointer;">
            <input type="checkbox" data-sched-toggle="${dow}" ${active ? 'checked' : ''} style="width:18px; height:18px;" />
            ${name}
          </label>
          <div style="display:flex; gap:6px; align-items:center;">
            ${
              active
                ? `<button type="button" class="btn btn-secondary btn-sm" data-sched-add="${dow}" style="font-size:12px; padding:4px 10px;">➕ Agregar 2da franja (ej. tarde)</button>`
                : `<span style="font-size:12px; color:#64748b;">No atiende</span>`
            }
          </div>
        </div>
        ${active ? `<div style="margin-top:6px;">${blocksHtml}</div>` : ''}
      </div>`;
  }).join('');

  container.querySelectorAll('[data-sched-toggle]').forEach((chk) => {
    chk.addEventListener('change', () => {
      const dow = Number(chk.dataset.schedToggle);
      scheduleStateByDay[dow] = chk.checked
        ? [{ hora_inicio: '09:00', hora_fin: '13:00' }]
        : [];
      renderScheduleDays();
    });
  });

  container.querySelectorAll('[data-sched-add]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dow = Number(btn.dataset.schedAdd);
      const list = scheduleStateByDay[dow] || [];
      const defaultBlock =
        list.length === 1 && list[0].hora_fin <= '14:00'
          ? { hora_inicio: '15:00', hora_fin: '19:00' }
          : { hora_inicio: '14:00', hora_fin: '18:00' };
      list.push(defaultBlock);
      scheduleStateByDay[dow] = list;
      renderScheduleDays();
    });
  });

  container.querySelectorAll('[data-sched-del]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const [dowStr, idxStr] = btn.dataset.schedDel.split('-');
      const dow = Number(dowStr);
      scheduleStateByDay[dow].splice(Number(idxStr), 1);
      renderScheduleDays();
    });
  });

  container.querySelectorAll('[data-sched-start]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const [dowStr, idxStr] = inp.dataset.schedStart.split('-');
      scheduleStateByDay[Number(dowStr)][Number(idxStr)].hora_inicio = inp.value;
    });
  });

  container.querySelectorAll('[data-sched-end]').forEach((inp) => {
    inp.addEventListener('change', () => {
      const [dowStr, idxStr] = inp.dataset.schedEnd.split('-');
      scheduleStateByDay[Number(dowStr)][Number(idxStr)].hora_fin = inp.value;
    });
  });
}

$('scheduleForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!activeScheduleDoctorId) return;
  $('scheduleAlert').innerHTML = '';
  const btn = $('saveScheduleBtn');
  btn.disabled = true;
  btn.textContent = 'Guardando...';

  try {
    const horarios = [];
    for (const { dow } of DAYS_ORDER) {
      for (const b of scheduleStateByDay[dow] || []) {
        horarios.push({
          dia_semana: dow,
          hora_inicio: b.hora_inicio,
          hora_fin: b.hora_fin,
        });
      }
    }

    await api(`/api/admin/doctors/${activeScheduleDoctorId}/schedule`, {
      method: 'PUT',
      body: JSON.stringify({
        duracionTurnoMin: Number($('schedDuration').value),
        horarios,
      }),
    });

    $('scheduleModal').classList.add('hidden');
    showAdminAlert('✅ Horarios de atención guardados. El Bot y el Turnero Web ya muestran estos turnos.');
    await loadSpecialtiesAndDoctors();
  } catch (err) {
    $('scheduleAlert').innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Guardar horarios de atención';
  }
});

$('closeScheduleModalBtn')?.addEventListener('click', () => {
  $('scheduleModal').classList.add('hidden');
});
$('cancelScheduleBtn')?.addEventListener('click', () => {
  $('scheduleModal').classList.add('hidden');
});

/* ============================================================
 * BASE DE DATOS COMPLETA (PACIENTES, PROFESIONALES, COPAGOS) + EXCEL
 * ============================================================ */
function formatMoney(n) {
  return '$' + Number(n || 0).toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

function switchDbTab(tab) {
  ['dbTabPatients', 'dbTabDoctors', 'dbTabAttentions'].forEach((id) => $(id).classList.add('hidden'));
  ['dbTabPatientsBtn', 'dbTabDoctorsBtn', 'dbTabAttentionsBtn'].forEach((id) =>
    $(id)?.classList.remove('active')
  );

  if (tab === 'doctors' && currentUser?.rol === 'admin') {
    $('dbTabDoctors').classList.remove('hidden');
    $('dbTabDoctorsBtn').classList.add('active');
    loadDbDoctors();
  } else if (tab === 'attentions') {
    $('dbTabAttentions').classList.remove('hidden');
    $('dbTabAttentionsBtn').classList.add('active');
    loadDbAttentions();
  } else {
    $('dbTabPatients').classList.remove('hidden');
    $('dbTabPatientsBtn').classList.add('active');
    loadDbPatients();
  }
}

async function openDatabaseModal(initialTab = 'patients', editPatient = null) {
  $('dbModalAlert').innerHTML = '';
  $('dbPatientFormBox').classList.add('hidden');
  $('dbDoctorFormBox').classList.add('hidden');
  $('databaseModal').classList.remove('hidden');

  // Cargar combos de Obras Sociales, Especialidades y Médicos
  const [osRes, specRes, docRes] = await Promise.all([
    api('/api/obras-sociales'),
    api('/api/specialties?includeEmpty=true'),
    api('/api/doctors'),
  ]);

  const osOpts = (osRes.obrasSociales || [])
    .map((o) => `<option value="${escapeHtml(o.nombre)}">${escapeHtml(o.nombre)}</option>`)
    .join('');

  $('dbPatientFilterOs').innerHTML = `<option value="">Todas las Obras Sociales</option>${osOpts}`;
  $('dbPatOs').innerHTML = osOpts;
  $('repOs').innerHTML = `<option value="">Todas las Obras Sociales</option>${osOpts}`;

  $('dbDocSpec').innerHTML = (specRes.specialties || [])
    .map((s) => `<option value="${s.id}">${escapeHtml(s.icono)} ${escapeHtml(s.nombre)}</option>`)
    .join('');

  $('repDoctor').innerHTML =
    `<option value="">Todos los médicos</option>` +
    (docRes.doctors || [])
      .map((d) => `<option value="${d.id}">${escapeHtml(d.nombre)} (${escapeHtml(d.especialidad_nombre)})</option>`)
      .join('');

  switchDbTab(initialTab);

  if (editPatient) {
    openEditPatientForm(editPatient);
  }
}

function openEditPatientForm(p = null) {
  $('dbPatientFormBox').classList.remove('hidden');
  if (p) {
    $('dbPatientFormTitle').textContent = `✏️ Editar ficha de ${p.nombre_completo}`;
    $('dbPatId').value = p.id;
    $('dbPatName').value = p.nombre_completo || '';
    $('dbPatDni').value = p.dni || '';
    $('dbPatDob').value = p.fecha_nacimiento || '';
    $('dbPatOs').value = p.obra_social || 'Particular';
    $('dbPatAfiliado').value = p.nro_afiliado || '';
    $('dbPatPhone').value = p.telefono_whatsapp || '';
    $('dbPatAddress').value = p.domicilio || '';
    $('dbPatCity').value = p.localidad || '';
  } else {
    $('dbPatientFormTitle').textContent = '➕ Registrar Nuevo Paciente';
    $('dbPatientForm').reset();
    $('dbPatId').value = '';
  }
  $('dbPatientFormBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function loadDbPatients() {
  const box = $('dbPatientsList');
  box.innerHTML = 'Cargando pacientes...';
  const params = new URLSearchParams();
  if ($('dbPatientSearch').value.trim()) params.set('q', $('dbPatientSearch').value.trim());
  if ($('dbPatientFilterOs').value) params.set('obraSocial', $('dbPatientFilterOs').value);

  const { patients } = await api(`/api/panel/db/patients?${params.toString()}`);
  if (!patients.length) {
    box.innerHTML = '<div style="color:#64748b; font-size:14px;">No hay pacientes con esos filtros.</div>';
    return;
  }

  const byId = new Map(patients.map((p) => [String(p.id), p]));
  box.innerHTML = patients
    .map(
      (p) => `
      <div class="appt-item" style="margin-bottom:10px; padding:12px;">
        <div style="flex:1; min-width:220px;">
          <strong style="font-size:16px;">${escapeHtml(p.nombre_completo)}</strong>
          <span class="badge badge-demo" style="margin-left:6px;">${escapeHtml(p.obra_social || 'Particular')}</span>
          <div style="font-size:13px; color:#334155; margin-top:4px;">
            🪪 DNI: <strong>${escapeHtml(p.dni)}</strong>
            ${p.fecha_nacimiento ? ` • 🎂 F. Nac.: <strong>${escapeHtml(p.fecha_nacimiento)}</strong>` : ' • <span style="color:#94a3b8;">F. Nac. sin cargar</span>'}
            ${p.nro_afiliado ? ` • Afil: ${escapeHtml(p.nro_afiliado)}` : ''}
          </div>
          <div style="font-size:13px; color:#475569;">
            🏠 ${escapeHtml(p.domicilio || 'Sin domicilio')} ${p.localidad ? `— <strong>${escapeHtml(p.localidad)}</strong>` : ''}
            • 📱 ${escapeHtml(p.telefono_whatsapp || '-')}
          </div>
          <div style="font-size:12px; color:#0f766e; font-weight:600; margin-top:4px;">
            📚 ${p.total_atenciones || 0} atenciones • 💵 Copagos acumulados: ${formatMoney(p.total_copagos)}
            ${p.ultima_atencion ? ` • Última: ${escapeHtml(p.ultima_atencion)}` : ''}
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button type="button" class="btn btn-secondary btn-sm" data-db-edit-pat="${p.id}">✏️ Ficha</button>
          <button type="button" class="btn btn-primary btn-sm" data-db-hc-pat="${p.id}">📝 Atenciones</button>
        </div>
      </div>`
    )
    .join('');

  box.querySelectorAll('[data-db-edit-pat]').forEach((btn) => {
    btn.addEventListener('click', () => openEditPatientForm(byId.get(btn.dataset.dbEditPat)));
  });
  box.querySelectorAll('[data-db-hc-pat]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('databaseModal').classList.add('hidden');
      openClinicalModal({ pacienteId: Number(btn.dataset.dbHcPat) });
    });
  });
}

$('dbPatientForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('dbModalAlert').innerHTML = '';
  const id = $('dbPatId').value;
  const payload = {
    nombreCompleto: $('dbPatName').value.trim(),
    dni: $('dbPatDni').value.trim(),
    fechaNacimiento: $('dbPatDob').value,
    obraSocial: $('dbPatOs').value,
    nroAfiliado: $('dbPatAfiliado').value.trim(),
    telefonoWhatsapp: $('dbPatPhone').value.trim(),
    domicilio: $('dbPatAddress').value.trim(),
    localidad: $('dbPatCity').value.trim(),
  };

  try {
    if (id) {
      await api(`/api/panel/db/patients/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
      $('dbModalAlert').innerHTML = '<div class="alert alert-success">✅ Ficha del paciente actualizada.</div>';
    } else {
      await api('/api/panel/db/patients', { method: 'POST', body: JSON.stringify(payload) });
      $('dbModalAlert').innerHTML = '<div class="alert alert-success">✅ Paciente registrado en la base de datos.</div>';
    }
    $('dbPatientFormBox').classList.add('hidden');
    await loadDbPatients();
  } catch (err) {
    $('dbModalAlert').innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  }
});

async function loadDbDoctors() {
  if (currentUser?.rol !== 'admin') return;
  const box = $('dbDoctorsList');
  box.innerHTML = 'Cargando profesionales...';
  const q = $('dbDoctorSearch').value.trim();
  const { professionals } = await api(`/api/admin/db/professionals${q ? `?q=${encodeURIComponent(q)}` : ''}`);

  if (!professionals.length) {
    box.innerHTML = '<div style="color:#64748b; font-size:14px;">No se encontraron profesionales.</div>';
    return;
  }

  const byId = new Map(professionals.map((d) => [String(d.id), d]));
  box.innerHTML = professionals
    .map(
      (d) => `
      <div class="appt-item" style="margin-bottom:10px; padding:12px;">
        <div style="flex:1; min-width:240px;">
          <strong style="font-size:16px;">${escapeHtml(d.nombre)}</strong>
          <span class="badge badge-demo" style="margin-left:6px;">${escapeHtml(d.especialidad_icono)} ${escapeHtml(d.especialidad_nombre)}</span>
          <div style="font-size:13px; color:#334155; margin-top:4px;">
            🪪 DNI: <strong>${escapeHtml(d.dni || 'Sin cargar')}</strong>
            • 🎂 F. Nac.: <strong>${escapeHtml(d.fecha_nacimiento || 'Sin cargar')}</strong>
            • 🩺 Matrícula: <strong>${escapeHtml(d.matricula || 'Sin cargar')}</strong>
          </div>
          <div style="font-size:13px; color:#475569;">
            🏠 ${escapeHtml(d.domicilio || 'Sin domicilio')} ${d.localidad ? `— <strong>${escapeHtml(d.localidad)}</strong>` : ''}
            ${d.telefono ? ` • 📱 ${escapeHtml(d.telefono)}` : ''}
            ${d.email ? ` • 📧 ${escapeHtml(d.email)}` : ''}
          </div>
          <div style="font-size:12px; color:#334155; margin-top:4px;">
            <strong>Obras Sociales:</strong> ${escapeHtml(d.obras_sociales || '-')}
          </div>
          <div style="font-size:12px; color:#0f766e; font-weight:700; margin-top:4px;">
            📊 ${d.total_atenciones || 0} atenciones realizadas • 💵 Copagos: ${formatMoney(d.total_copagos)}
          </div>
        </div>
        <div style="display:flex; gap:6px; flex-wrap:wrap;">
          <button type="button" class="btn btn-primary btn-sm" data-db-edit-doc="${d.id}">✏️ Editar ficha</button>
          <button type="button" class="btn btn-secondary btn-sm" data-db-rep-doc="${d.id}">📋 Ver sus atenciones</button>
        </div>
      </div>`
    )
    .join('');

  box.querySelectorAll('[data-db-edit-doc]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const d = byId.get(btn.dataset.dbEditDoc);
      if (!d) return;
      $('dbDoctorFormBox').classList.remove('hidden');
      $('dbDoctorFormTitle').textContent = `✏️ Ficha personal — ${d.nombre}`;
      $('dbDocId').value = d.id;
      $('dbDocName').value = d.nombre || '';
      $('dbDocDni').value = d.dni || '';
      $('dbDocDob').value = d.fecha_nacimiento || '';
      $('dbDocMatricula').value = d.matricula || '';
      $('dbDocSpec').value = String(d.especialidad_id);
      $('dbDocPhone').value = d.telefono || '';
      $('dbDocAddress').value = d.domicilio || '';
      $('dbDocCity').value = d.localidad || '';
      $('dbDocEmail').value = d.email || '';
      $('dbDocObras').value = d.obras_sociales || '';
      $('dbDoctorFormBox').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });

  box.querySelectorAll('[data-db-rep-doc]').forEach((btn) => {
    btn.addEventListener('click', () => {
      $('repDoctor').value = btn.dataset.dbRepDoc;
      switchDbTab('attentions');
    });
  });
}

$('dbDoctorForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  $('dbModalAlert').innerHTML = '';
  const id = $('dbDocId').value;
  if (!id) return;
  try {
    await api(`/api/admin/doctors/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        nombre: $('dbDocName').value.trim(),
        dni: $('dbDocDni').value.trim(),
        fechaNacimiento: $('dbDocDob').value,
        matricula: $('dbDocMatricula').value.trim(),
        especialidadId: Number($('dbDocSpec').value),
        telefono: $('dbDocPhone').value.trim(),
        domicilio: $('dbDocAddress').value.trim(),
        localidad: $('dbDocCity').value.trim(),
        email: $('dbDocEmail').value.trim(),
        obrasSociales: $('dbDocObras').value.trim(),
      }),
    });
    $('dbDoctorFormBox').classList.add('hidden');
    $('dbModalAlert').innerHTML = '<div class="alert alert-success">✅ Datos personales del profesional guardados.</div>';
    await Promise.all([loadDbDoctors(), loadSpecialtiesAndDoctors()]);
  } catch (err) {
    $('dbModalAlert').innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  }
});

function buildAttentionsQuery() {
  const params = new URLSearchParams();
  if ($('repDesde').value) params.set('desde', $('repDesde').value);
  if ($('repHasta').value) params.set('hasta', $('repHasta').value);
  if (currentUser?.rol === 'admin' && $('repDoctor').value) {
    params.set('profesionalId', $('repDoctor').value);
  }
  if ($('repOs').value) params.set('obraSocial', $('repOs').value);
  if ($('repSoloCopago').checked) params.set('soloCopago', 'true');
  return params;
}

async function loadDbAttentions() {
  const box = $('dbAttentionsList');
  box.innerHTML = 'Cargando reporte de atenciones...';
  const params = buildAttentionsQuery();
  const { rows, summary } = await api(`/api/panel/db/attentions?${params.toString()}`);

  $('repStatTotal').textContent = summary.totalAtenciones;
  $('repStatConCopago').textContent = summary.conCopago;
  $('repStatMonto').textContent = formatMoney(summary.montoTotalCopagos);

  if (!rows.length) {
    box.innerHTML =
      '<div style="color:#64748b; font-size:14px;">Todavía no hay atenciones registradas con esos filtros. Usá el botón <strong>📝 Atención</strong> en cualquier turno para cargar la primera.</div>';
    return;
  }

  box.innerHTML = rows
    .map(
      (r) => `
      <div class="record-card">
        <div class="record-meta">
          <div>
            <strong>📅 ${escapeHtml(r.fecha_atencion)}</strong> —
            <strong>👤 ${escapeHtml(r.paciente_nombre)}</strong> (DNI ${escapeHtml(r.paciente_dni)} • ${escapeHtml(r.paciente_obra_social)})
          </div>
          <div>
            ${
              Number(r.abono_copago) === 1
                ? `<span class="badge badge-reservado">💵 Copago: ${formatMoney(r.monto_copago)}${r.medio_pago ? ` (${escapeHtml(r.medio_pago)})` : ''}</span>`
                : '<span class="badge badge-demo">Sin copago</span>'
            }
          </div>
        </div>
        <div class="record-field"><strong>🩺 Médico:</strong> ${escapeHtml(r.profesional_nombre)}${r.especialidad_nombre ? ` (${escapeHtml(r.especialidad_nombre)})` : ''}</div>
        ${r.diagnostico ? `<div class="record-field"><strong>Diagnóstico:</strong> ${escapeHtml(r.diagnostico)}</div>` : ''}
        <div class="record-field"><strong>Evolución:</strong> ${escapeHtml(r.evolucion)}</div>
      </div>`
    )
    .join('');
}

$('openDatabaseModalBtn')?.addEventListener('click', () => openDatabaseModal('patients'));
$('closeDatabaseModalBtn')?.addEventListener('click', () => $('databaseModal').classList.add('hidden'));
$('dbTabPatientsBtn')?.addEventListener('click', () => switchDbTab('patients'));
$('dbTabDoctorsBtn')?.addEventListener('click', () => switchDbTab('doctors'));
$('dbTabAttentionsBtn')?.addEventListener('click', () => switchDbTab('attentions'));

$('dbNewPatientBtn')?.addEventListener('click', () => openEditPatientForm(null));
$('dbCancelPatientFormBtn')?.addEventListener('click', () => $('dbPatientFormBox').classList.add('hidden'));
$('dbCancelDoctorFormBtn')?.addEventListener('click', () => $('dbDoctorFormBox').classList.add('hidden'));

let dbPatDebounce = null;
$('dbPatientSearch')?.addEventListener('input', () => {
  clearTimeout(dbPatDebounce);
  dbPatDebounce = setTimeout(loadDbPatients, 250);
});
$('dbPatientFilterOs')?.addEventListener('change', loadDbPatients);

let dbDocDebounce = null;
$('dbDoctorSearch')?.addEventListener('input', () => {
  clearTimeout(dbDocDebounce);
  dbDocDebounce = setTimeout(loadDbDoctors, 250);
});

$('repFilterBtn')?.addEventListener('click', loadDbAttentions);
$('exportAttentionsExcelBtn')?.addEventListener('click', () => {
  const params = buildAttentionsQuery();
  params.set('type', 'atenciones');
  window.location.href = `/api/panel/export/excel?${params.toString()}`;
});

/* ============================================================
 * NAVEGACIÓN HORIZONTAL DESPLEGABLE ESTILO SICAP
 * ============================================================ */
const SICAP_VIEW_TITLES = {
  otorgar: 'Otorgar Turnos',
  overview: 'Gestión General de Agendas',
  links: 'Links para compartir y Cartel QR',
  turnos: 'Todos los Turnos',
  bloqueos: 'Bloquear horarios o días (Ausencias / Vacaciones)',
  profesionales: 'Profesionales, Horarios de Atención y Google Calendar',
  solicitudes: 'Solicitudes de Horarios de Profesionales',
  usuarios: 'Usuarios y Administradores de Agendas',
  clinica: 'Nombre y datos de tu clínica',
  obras: 'Obras Sociales y Prepagas',
  google: 'Conexión con Google Calendar',
  whatsapp: 'Conectar WhatsApp Real (Recordatorios 24 hs automáticos)',
  clave: 'Mi Clave (Cambiar contraseña)',
};

let activeSicapView = 'otorgar';

function getDefaultSicapView() {
  return currentUser?.rol === 'admin' ? 'otorgar' : 'overview';
}

function closeAllSicapDropdowns() {
  document.querySelectorAll('.sicap-menu.open').forEach((m) => m.classList.remove('open'));
}

function setActiveSicapView(viewName) {
  activeSicapView = viewName || getDefaultSicapView();
  closeAllSicapDropdowns();

  // Mostrar únicamente los paneles que corresponden a la sección elegida
  document.querySelectorAll('[data-view-panel]').forEach((el) => {
    const allowed = String(el.dataset.viewPanel || '').split(/\s+/);
    const shouldShow = allowed.includes(activeSicapView);
    el.classList.toggle('sicap-view-hidden', !shouldShow);
  });

  // Si es 'clave', asegurar que changePasswordCard no tenga .hidden
  if ($('changePasswordCard')) {
    $('changePasswordCard').classList.toggle('hidden', activeSicapView !== 'clave');
  }

  // Marcar ítem y grupo activo en el menú superior
  document.querySelectorAll('.sicap-menu').forEach((m) => m.classList.remove('active-group'));
  document.querySelectorAll('[data-go-view]').forEach((btn) => {
    const isAct = btn.dataset.goView === activeSicapView;
    btn.classList.toggle('active', isAct);
    if (isAct) {
      btn.closest('.sicap-menu')?.classList.add('active-group');
    }
  });

  const homeView = getDefaultSicapView();
  if ($('sicapCurrentTitle')) {
    $('sicapCurrentTitle').textContent =
      SICAP_VIEW_TITLES[activeSicapView] || 'Otorgar Turnos';
  }
  if ($('sicapBackHomeBtn')) {
    $('sicapBackHomeBtn').textContent =
      homeView === 'otorgar' ? '← Volver a Otorgar Turnos' : '← Volver a Mi Agenda';
    $('sicapBackHomeBtn').classList.toggle('hidden', activeSicapView === homeView);
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

// Abrir/cerrar menús desplegables al hacer clic
document.querySelectorAll('.sicap-menu-trigger').forEach((trigger) => {
  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    const menu = trigger.closest('.sicap-menu');
    const wasOpen = menu.classList.contains('open');
    closeAllSicapDropdowns();
    if (!wasOpen) menu.classList.add('open');
  });
});

// Clic en cualquier opción interna del menú
document.querySelectorAll('[data-go-view]').forEach((btn) => {
  btn.addEventListener('click', () => {
    setActiveSicapView(btn.dataset.goView);
  });
});

// Cerrar dropdown al hacer clic en botones de modal dentro de un dropdown o afuera
document.querySelectorAll('.sicap-dropdown .sicap-dropdown-item').forEach((item) => {
  item.addEventListener('click', () => closeAllSicapDropdowns());
});
document.addEventListener('click', () => closeAllSicapDropdowns());
$('sicapBackHomeBtn')?.addEventListener('click', () => setActiveSicapView(getDefaultSicapView()));

/* ============================================================
 * PANTALLA PRINCIPAL: OTORGAR TURNOS (RECUADROS DE PROFESIONALES)
 * ============================================================ */
let cachedDoctors = [];
const otState = {
  mode: 'doctors', // 'doctors' | 'specs'
  selectedSpecialty: null,
  selectedDoctor: null,
  selectedDate: null,
  selectedSlot: null,
};

function otNormalize(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function setOtAlert(msg = '', type = 'error') {
  const box = $('otAlert');
  if (!box) return;
  box.innerHTML = msg ? `<div class="alert alert-${type}">${escapeHtml(msg)}</div>` : '';
}

function setOtStep(step) {
  [1, 2, 3, 4].forEach((n) => {
    $(`otStep${n}`)?.classList.toggle('hidden', n !== step);
  });
  document.querySelectorAll('#otStepper .step-item').forEach((item) => {
    const s = Number(item.dataset.otStep);
    item.classList.remove('active', 'done');
    if (s < step) item.classList.add('done');
    else if (s === step) item.classList.add('active');
  });
}

function renderOtorgarCards() {
  const grid = $('otCardsGrid');
  if (!grid) return;

  const q = otNormalize($('otSearchInput')?.value.trim() || '');
  const DAY_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

  // Si estamos en modo "Por Especialidad" y todavía no eligió especialidad
  if (otState.mode === 'specs' && !otState.selectedSpecialty) {
    $('otStep1Title').textContent = '1. Elegí una especialidad';
    $('otStep1Sub').textContent = 'Tocá el recuadro de la especialidad para ver sus profesionales disponibles.';
    $('otBackToSpecsBtn')?.classList.add('hidden');

    const specs = cachedSpecialties.filter((s) => {
      if (!q) return true;
      return otNormalize(s.nombre).includes(q) || otNormalize(s.descripcion || '').includes(q);
    });

    if (!specs.length) {
      grid.innerHTML = '<div class="alert alert-info">No se encontraron especialidades con esa búsqueda.</div>';
      return;
    }

    grid.innerHTML = specs
      .map((s) => {
        const count = cachedDoctors.filter((d) => d.especialidad_id === s.id).length;
        return `
          <button type="button" class="option-card" data-ot-spec="${s.id}">
            <div class="option-icon">${escapeHtml(s.icono || '🩺')}</div>
            <div class="option-title">${escapeHtml(s.nombre)}</div>
            <div class="option-desc">${escapeHtml(s.descripcion || '')}</div>
            <div style="font-size:12px; color:#5eead4; font-weight:700; margin-top:4px;">
              ${count} ${count === 1 ? 'profesional' : 'profesionales'}
            </div>
          </button>`;
      })
      .join('');

    grid.querySelectorAll('[data-ot-spec]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const specId = Number(btn.dataset.otSpec);
        otState.selectedSpecialty = cachedSpecialties.find((s) => s.id === specId) || null;
        if ($('otSearchInput')) $('otSearchInput').value = '';
        renderOtorgarCards();
      });
    });
    return;
  }

  // Modo "Todos los Profesionales" o médicos de la especialidad elegida
  let docs = otState.selectedSpecialty
    ? cachedDoctors.filter((d) => d.especialidad_id === otState.selectedSpecialty.id)
    : cachedDoctors;

  if (otState.selectedSpecialty) {
    $('otStep1Title').textContent = `1. Profesionales de ${otState.selectedSpecialty.icono || ''} ${otState.selectedSpecialty.nombre}`;
    $('otStep1Sub').textContent = 'Tocá el recuadro del profesional para ver sus días y horarios disponibles.';
    $('otBackToSpecsBtn')?.classList.remove('hidden');
  } else {
    $('otStep1Title').textContent = '1. Elegí el profesional para otorgar un turno';
    $('otStep1Sub').textContent = 'Se muestran todos los profesionales activos. Tocá cualquier recuadro para gestionar sus turnos.';
    $('otBackToSpecsBtn')?.classList.add('hidden');
  }

  if (q) {
    docs = docs.filter(
      (d) =>
        otNormalize(d.nombre).includes(q) ||
        otNormalize(d.especialidad_nombre).includes(q) ||
        otNormalize(d.consultorio || '').includes(q)
    );
  }

  if (!docs.length) {
    grid.innerHTML =
      '<div class="alert alert-info">No hay profesionales cargados para esa selección. Podés agregarlos desde <strong>📅 Agendas y Turnos → Profesionales</strong>.</div>';
    return;
  }

  grid.innerHTML = docs
    .map((d) => {
      const daysTxt = (d.horarios || []).length
        ? [...new Set(d.horarios.map((h) => DAY_SHORT[h.dia_semana]))].join(', ')
        : 'Sin horarios cargados';
      return `
        <button type="button" class="option-card" data-ot-doc="${d.id}">
          <div class="option-icon">${escapeHtml(d.especialidad_icono || '🩺')}</div>
          <div class="option-title">${escapeHtml(d.nombre)}</div>
          <div class="option-desc"><strong>${escapeHtml(d.especialidad_nombre)}</strong> • ${escapeHtml(d.consultorio || '')}</div>
          <div style="font-size:12px; color:#5eead4; font-weight:600; margin-top:4px;">
            🗓️ ${escapeHtml(daysTxt)} • ⏱️ ${d.duracion_turno_min} min
          </div>
        </button>`;
    })
    .join('');

  grid.querySelectorAll('[data-ot-doc]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const docId = Number(btn.dataset.otDoc);
      const doc = cachedDoctors.find((d) => d.id === docId);
      if (doc) openOtStep2ForDoctor(doc);
    });
  });
}

async function openOtStep2ForDoctor(doc) {
  otState.selectedDoctor = doc;
  otState.selectedDate = null;
  otState.selectedSlot = null;
  setOtAlert('');
  setOtStep(2);

  $('otStep2Title').textContent = `2. Elegí día y horario — ${doc.nombre}`;
  $('otStep2Sub').textContent = `${doc.especialidad_icono || ''} ${doc.especialidad_nombre} • ${doc.consultorio || ''} • Turnos de ${doc.duracion_turno_min} min`;
  $('otDaysStrip').innerHTML = '<div style="color:#94a3b8;">Buscando días disponibles...</div>';
  $('otSlotsContainer').innerHTML = '';

  try {
    const { days } = await api(`/api/availability/days?doctorId=${doc.id}`);
    if (!days || !days.length) {
      $('otDaysStrip').innerHTML =
        '<div class="alert alert-info">Este profesional no tiene días disponibles en los próximos 30 días. Revisá sus horarios en <strong>📅 Agendas y Turnos → Profesionales → 🗓️ Horarios</strong>.</div>';
      return;
    }

    $('otDaysStrip').innerHTML = days
      .map(
        (d, idx) => `
        <button type="button" class="day-pill ${idx === 0 ? 'selected' : ''}" data-ot-day="${escapeHtml(d.fecha)}" data-ot-day-label="${escapeHtml(d.label)}">
          <strong>${escapeHtml(d.shortLabel || d.label)}</strong>
          <span>${d.total_horarios} ${d.total_horarios === 1 ? 'turno' : 'turnos'}</span>
        </button>`
      )
      .join('');

    $('otDaysStrip').querySelectorAll('[data-ot-day]').forEach((btn) => {
      btn.addEventListener('click', () => {
        $('otDaysStrip').querySelectorAll('.day-pill').forEach((p) => p.classList.remove('selected'));
        btn.classList.add('selected');
        loadOtSlots(doc.id, btn.dataset.otDay, btn.dataset.otDayLabel);
      });
    });

    await loadOtSlots(doc.id, days[0].fecha, days[0].label);
  } catch (err) {
    setOtAlert(err.message, 'error');
  }
}

async function loadOtSlots(doctorId, fecha, dayLabel) {
  otState.selectedDate = { fecha, label: dayLabel };
  $('otSlotsContainer').innerHTML = '<div style="color:#94a3b8;">Cargando horarios disponibles...</div>';

  try {
    const { slots } = await api(`/api/availability/slots?doctorId=${doctorId}&date=${encodeURIComponent(fecha)}`);
    if (!slots || !slots.length) {
      $('otSlotsContainer').innerHTML = '<div class="alert alert-info">No quedan horarios libres para esta fecha.</div>';
      return;
    }

    const manana = slots.filter((s) => s.periodo === 'mañana' || s.hora_inicio < '13:00');
    const tarde = slots.filter((s) => s.periodo !== 'mañana' && s.hora_inicio >= '13:00');

    const renderGroup = (title, list) => {
      if (!list.length) return '';
      return `
        <div class="slots-group-title">${title}</div>
        <div class="slots-grid">
          ${list
            .map(
              (s) =>
                `<button type="button" class="slot-btn" data-ot-slot="${escapeHtml(s.hora_inicio)}">⏰ ${escapeHtml(s.hora_inicio)} hs</button>`
            )
            .join('')}
        </div>`;
    };

    $('otSlotsContainer').innerHTML =
      renderGroup('🌅 Mañana', manana) + renderGroup('🌇 Tarde', tarde);

    $('otSlotsContainer').querySelectorAll('[data-ot-slot]').forEach((btn) => {
      btn.addEventListener('click', () => {
        otState.selectedSlot = btn.dataset.otSlot;
        openOtStep3();
      });
    });
  } catch (err) {
    setOtAlert(err.message, 'error');
  }
}

function openOtStep3() {
  setOtAlert('');
  setOtStep(3);
  const d = otState.selectedDoctor;
  $('otSelectionSummary').innerHTML = `
    <p><strong>🩺 Profesional:</strong> ${escapeHtml(d.nombre)} (${escapeHtml(d.especialidad_nombre)})</p>
    <p><strong>📅 Día y Hora:</strong> ${escapeHtml(otState.selectedDate?.label || otState.selectedDate?.fecha)} — <strong>${escapeHtml(otState.selectedSlot)} hs</strong></p>
    <p><strong>📍 Consultorio:</strong> ${escapeHtml(d.consultorio || '')}</p>
  `;
  $('otDni')?.focus();
}

function resetOtorgarFlow() {
  otState.selectedSpecialty = null;
  otState.selectedDoctor = null;
  otState.selectedDate = null;
  otState.selectedSlot = null;
  setOtAlert('');
  $('otBookingForm')?.reset();
  if ($('otDniHint')) $('otDniHint').textContent = 'Si ya vino antes, sus datos se completan solos.';
  if ($('otSearchInput')) $('otSearchInput').value = '';
  setOtStep(1);
  renderOtorgarCards();
}

$('otModeDoctorsBtn')?.addEventListener('click', () => {
  otState.mode = 'doctors';
  otState.selectedSpecialty = null;
  $('otModeDoctorsBtn').classList.add('active');
  $('otModeSpecsBtn').classList.remove('active');
  setOtStep(1);
  renderOtorgarCards();
});

$('otModeSpecsBtn')?.addEventListener('click', () => {
  otState.mode = 'specs';
  otState.selectedSpecialty = null;
  $('otModeSpecsBtn').classList.add('active');
  $('otModeDoctorsBtn').classList.remove('active');
  setOtStep(1);
  renderOtorgarCards();
});

$('otGoAllTurnsBtn')?.addEventListener('click', () => setActiveSicapView('turnos'));
$('otBackToSpecsBtn')?.addEventListener('click', () => {
  otState.selectedSpecialty = null;
  renderOtorgarCards();
});
$('otBackToStep1Btn')?.addEventListener('click', () => setOtStep(1));
$('otBackToStep2Btn')?.addEventListener('click', () => setOtStep(2));
$('otCancelFlowBtn')?.addEventListener('click', resetOtorgarFlow);
$('otNewBookingBtn')?.addEventListener('click', resetOtorgarFlow);
$('otSuccessGoListBtn')?.addEventListener('click', () => {
  resetOtorgarFlow();
  setActiveSicapView('turnos');
});

$('otSearchInput')?.addEventListener('input', renderOtorgarCards);

// Autocompletar datos del paciente por DNI si ya existe en la base de datos
let otDniTimer = null;
$('otDni')?.addEventListener('input', () => {
  clearTimeout(otDniTimer);
  const digits = $('otDni').value.replace(/\D/g, '');
  if (digits.length < 7) return;
  otDniTimer = setTimeout(async () => {
    try {
      const { patient } = await api(`/api/patients/lookup?dni=${encodeURIComponent(digits)}`);
      if (patient) {
        if (!$('otName').value.trim()) $('otName').value = patient.nombre_completo || '';
        if (!$('otPhone').value.trim()) $('otPhone').value = patient.telefono_whatsapp || '';
        if (patient.obra_social && $('otObraSocial')) {
          const optExists = [...$('otObraSocial').options].some((o) => o.value === patient.obra_social);
          if (optExists) $('otObraSocial').value = patient.obra_social;
        }
        if ($('otDniHint')) {
          $('otDniHint').textContent = `✅ Paciente registrado encontrado: ${patient.nombre_completo}`;
        }
      } else if ($('otDniHint')) {
        $('otDniHint').textContent = 'Paciente nuevo: se guardará automáticamente en la Base de Datos.';
      }
    } catch {
      // ignore
    }
  }, 350);
});

$('otBookingForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  setOtAlert('');
  const btn = $('otSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Guardando turno...';
  try {
    const { appointment } = await api('/api/appointments', {
      method: 'POST',
      body: JSON.stringify({
        profesionalId: otState.selectedDoctor.id,
        fecha: otState.selectedDate.fecha,
        horaInicio: otState.selectedSlot,
        canalOrigen: 'web',
        notas: $('otNotes').value.trim(),
        paciente: {
          dni: $('otDni').value.trim(),
          nombreCompleto: $('otName').value.trim(),
          telefonoWhatsapp: $('otPhone').value.trim(),
          obraSocial: $('otObraSocial').value || 'Particular',
        },
      }),
    });

    $('otSuccessSummary').innerHTML = `
      <p><strong>🔖 Código:</strong> ${escapeHtml(appointment.codigo)}</p>
      <p><strong>👤 Paciente:</strong> ${escapeHtml(appointment.paciente_nombre)} (DNI ${escapeHtml(appointment.paciente_dni)}) — ${escapeHtml(appointment.obra_social)}</p>
      <p><strong>🩺 Profesional:</strong> ${escapeHtml(appointment.profesional_nombre)} (${escapeHtml(appointment.especialidad_nombre)})</p>
      <p><strong>📅 Fecha y Hora:</strong> ${escapeHtml(appointment.fecha)} a las <strong>${escapeHtml(appointment.hora_inicio)} hs</strong></p>
      <p><strong>📍 Consultorio:</strong> ${escapeHtml(appointment.consultorio)}</p>
    `;
    setOtStep(4);
    await Promise.all([loadAppointments(), loadStatusAndStats()]);
  } catch (err) {
    setOtAlert(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = '✅ Otorgar y Confirmar Turno';
  }
});

/* ============================================================
 * MODAL IMPORTAR DATOS Y RESPALDO (.json / .xlsx)
 * ============================================================ */
$('openImportModalBtn')?.addEventListener('click', () => {
  closeAllSicapDropdowns();
  $('importDataResult').innerHTML = '';
  if ($('importDataFileInput')) $('importDataFileInput').value = '';
  $('importDataModal').classList.remove('hidden');
});

$('closeImportModalBtn')?.addEventListener('click', () => {
  $('importDataModal').classList.add('hidden');
});

$('importDataSubmitBtn')?.addEventListener('click', async () => {
  const input = $('importDataFileInput');
  const box = $('importDataResult');
  const file = input?.files?.[0];
  if (!file) {
    box.innerHTML =
      '<div class="alert alert-error">Primero seleccioná un archivo de respaldo (.json) o Excel (.xlsx).</div>';
    return;
  }

  const btn = $('importDataSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Importando datos...';
  box.innerHTML = '<div class="alert alert-info">⏳ Procesando archivo e importando datos...</div>';

  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('No se pudo leer el archivo seleccionado.'));
      reader.readAsDataURL(file);
    });

    const res = await api('/api/admin/backup/import', {
      method: 'POST',
      body: JSON.stringify({ filename: file.name, base64 }),
    });

    const imp = res.imported || {};
    const parts = [
      `👥 Pacientes: <strong>${imp.pacientes || 0}</strong>`,
      `🩺 Profesionales: <strong>${imp.profesionales || 0}</strong>`,
      `🗓️ Horarios: <strong>${imp.horarios || 0}</strong>`,
      `📅 Turnos: <strong>${imp.turnos || 0}</strong>`,
      `📋 Atenciones/Copagos: <strong>${imp.atenciones || 0}</strong>`,
    ];
    if (imp.obrasSociales) parts.push(`🪪 Obras Sociales: <strong>${imp.obrasSociales}</strong>`);
    if (imp.especialidades) parts.push(`✨ Especialidades: <strong>${imp.especialidades}</strong>`);

    box.innerHTML = `
      <div class="alert alert-success">
        <strong>✅ ¡Datos importados correctamente (${res.format === 'xlsx' ? 'Excel .xlsx' : 'Respaldo .json'})!</strong><br />
        ${parts.join(' &nbsp;•&nbsp; ')}
      </div>`;
    input.value = '';
    await refreshAll();
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">❌ ${escapeHtml(err.message)}</div>`;
  } finally {
    btn.disabled = false;
    btn.textContent = '📥 Importar Datos Ahora';
  }
});

// Actualización silenciosa de la agenda cada 15 segundos para ver cambios de WhatsApp en tiempo real
setInterval(() => {
  if (!currentUser) return;
  const anyModalOpen =
    !$('clinicalModal').classList.contains('hidden') ||
    !$('patientSearchModal').classList.contains('hidden') ||
    !$('recetariosModal').classList.contains('hidden') ||
    !$('scheduleModal').classList.contains('hidden') ||
    !$('databaseModal').classList.contains('hidden') ||
    !$('importDataModal').classList.contains('hidden');
  if (anyModalOpen) return;
  loadAppointments().catch(() => {});
}, 15000);

checkSessionAndBoot();
