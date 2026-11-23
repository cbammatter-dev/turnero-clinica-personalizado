const $ = (id) => document.getElementById(id);

let lastMessageCount = -1;

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatWaText(text) {
  return escapeHtml(text).replace(/\*([^*]+)\*/g, '<strong>$1</strong>');
}

async function api(url, options = {}) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Error de comunicación.');
  return data;
}

function getOrCreatePatientPhone() {
  const params = new URLSearchParams(window.location.search);
  const fromUrl = params.get('phone');
  if (fromUrl) {
    localStorage.setItem('patient_wa_phone', fromUrl);
    return fromUrl;
  }
  const saved = localStorage.getItem('patient_wa_phone');
  if (saved) return saved;
  const generated = `54911${Math.floor(10000000 + Math.random() * 89999999)}`;
  localStorage.setItem('patient_wa_phone', generated);
  return generated;
}

function getCurrentPhone() {
  return $('simPhone').value.trim() || getOrCreatePatientPhone();
}

function renderMessages(messages, forceScroll = false) {
  const container = $('waMessages');
  if (!messages || messages.length === 0) {
    container.innerHTML = `
      <div style="text-align:center; margin:auto; max-width:340px; background:#fff; padding:20px; border-radius:14px; box-shadow:0 2px 10px rgba(0,0,0,.08);">
        <strong style="font-size:16px;">¡Bienvenido! 👋</strong>
        <p style="font-size:13px; color:#475569; margin:8px 0 14px;">
          Tocá el botón de abajo o escribí <strong>"Hola"</strong> para sacar, confirmar, cambiar o cancelar tu turno médico.
        </p>
        <button type="button" class="btn btn-primary btn-sm" id="emptyStartBtn" style="background:#00a884; width:100%;">👋 Comenzar ahora</button>
      </div>`;
    $('emptyStartBtn').addEventListener('click', () => sendMessage('Hola'));
    return;
  }

  container.innerHTML = '';
  messages.forEach((m) => {
    const bubble = document.createElement('div');
    const isOutbound = m.direction === 'outbound';
    bubble.className = isOutbound
      ? `wa-bubble-in ${m.message_type === 'reminder' ? 'wa-bubble-reminder' : ''}`
      : 'wa-bubble-out';

    let headerTag = '';
    if (m.message_type === 'reminder') {
      headerTag = `<div style="font-size:11px; font-weight:700; color:#00a884; margin-bottom:4px;">⏰ RECORDATORIO DE TU TURNO (24 HS ANTES)</div>`;
    }

    bubble.innerHTML = `${headerTag}${formatWaText(m.body)}`;

    const actions = [];
    if (m.payload?.buttons?.length) {
      m.payload.buttons.forEach((b) => actions.push({ id: b.id, title: b.title }));
    }
    if (m.payload?.list?.rows?.length) {
      m.payload.list.rows.forEach((r) =>
        actions.push({ id: r.id, title: r.title, description: r.description })
      );
    }

    if (isOutbound && actions.length > 0) {
      const btnWrap = document.createElement('div');
      btnWrap.className = 'wa-btn-list';
      actions.forEach((act) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'wa-reply-btn';
        b.innerHTML = `${escapeHtml(act.title)}${
          act.description ? `<small>${escapeHtml(act.description)}</small>` : ''
        }`;
        b.addEventListener('click', () => sendMessage(act.title, act.id, act.title));
        btnWrap.appendChild(b);
      });
      bubble.appendChild(btnWrap);
    }

    const timeEl = document.createElement('span');
    timeEl.className = 'wa-time';
    timeEl.textContent = (m.created_at || '').slice(11, 16) || 'Ahora';
    bubble.appendChild(timeEl);

    container.appendChild(bubble);
  });

  if (forceScroll) {
    container.scrollTop = container.scrollHeight;
  }
}

async function loadHistory(silent = false) {
  const phone = getCurrentPhone();
  try {
    const { messages } = await api(
      `/api/whatsapp/sim/history?phone=${encodeURIComponent(phone)}`
    );
    if (!silent || messages.length !== lastMessageCount) {
      lastMessageCount = messages.length;
      renderMessages(messages, true);
    }
  } catch {
    // ignore background polling error
  }
}

async function sendMessage(text, actionId = null, label = null) {
  const phone = getCurrentPhone();
  localStorage.setItem('patient_wa_phone', phone);
  const { messages } = await api('/api/whatsapp/sim/message', {
    method: 'POST',
    body: JSON.stringify({ phone, text, actionId, label }),
  });
  lastMessageCount = messages.length;
  renderMessages(messages, true);
}

$('waForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const val = $('waInput').value.trim();
  if (!val) return;
  $('waInput').value = '';
  await sendMessage(val);
});

$('loadPhoneBtn').addEventListener('click', async () => {
  const phone = getCurrentPhone();
  localStorage.setItem('patient_wa_phone', phone);
  lastMessageCount = -1;
  await loadHistory(false);
});

$('sayHiBtn').addEventListener('click', () => sendMessage('Hola'));

async function init() {
  $('simPhone').value = getOrCreatePatientPhone();
  try {
    const status = await api('/api/status');
    document.title = `${status.clinic.name} — Bot de Turnos`;
    $('waClinicTitle').textContent = `${status.clinic.name}`;
    $('waClinicSub').textContent = `${status.clinic.address} • Asistente de Turnos`;
  } catch {
    // ignore
  }

  await loadHistory(false);
  // Revisar cada 5 segundos si llegó un recordatorio de 24 hs desde la clínica
  setInterval(() => loadHistory(true), 5000);
}

init();
