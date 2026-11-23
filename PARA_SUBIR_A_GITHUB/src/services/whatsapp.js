import { db } from '../db/database.js';
import { config } from '../config.js';
import { normalizePhone, formatDateFriendly } from '../utils/datetime.js';
import {
  extractReplyActions,
  formatReplyForWhatsAppText,
  getQrWhatsAppStatus,
  isQrWhatsAppConnected,
  sendViaQrWhatsApp,
} from './whatsappQr.js';

export function isWhatsAppLive() {
  return isQrWhatsAppConnected() || config.whatsapp.isConfigured;
}

export function getWhatsAppConnectionInfo() {
  const token = config.whatsapp.accessToken || '';
  const qr = getQrWhatsAppStatus();
  const configured = qr.connected || config.whatsapp.isConfigured;
  return {
    configured,
    mode: configured ? 'live' : 'demo',
    activeProvider: qr.connected ? 'qr' : config.whatsapp.isConfigured ? 'meta' : 'demo',
    qr,
    phoneNumberId: config.whatsapp.phoneNumberId || '',
    hasToken: Boolean(token),
    tokenPreview: token ? `${token.slice(0, 8)}...${token.slice(-6)}` : '',
    verifyToken: config.whatsapp.verifyToken,
    reminderTemplate: config.whatsapp.reminderTemplate,
    reminderLang: config.whatsapp.reminderLang,
    apiVersion: config.whatsapp.apiVersion,
  };
}

function translateMetaError(errText) {
  try {
    const parsed = JSON.parse(errText);
    const code = parsed?.error?.code;
    const msg = parsed?.error?.message || errText;
    if (code === 131030) {
      return 'Tu número todavía no está autorizado en la lista de prueba de Meta. En Meta for Developers → WhatsApp → Configuración de la API → "Para" → Administrar lista de números de teléfono, agregá tu celular y confirmá el código.';
    }
    if (code === 190) {
      return 'El Token de acceso de Meta venció o es incorrecto. Generá uno nuevo en Meta for Developers (los tokens temporales duran 24 hs).';
    }
    if (code === 132001) {
      return `La plantilla "${config.whatsapp.reminderTemplate}" no existe o todavía no fue aprobada en Meta. Podés probar primero con el botón "hello_world" o crear la plantilla en WhatsApp Manager.`;
    }
    if (code === 100) {
      return `Dato inválido en Meta (${msg}). Revisá que el "Identificador de número de teléfono" (Phone Number ID) sea correcto.`;
    }
    return `Error de Meta (código ${code || '?'}): ${msg}`;
  } catch {
    return `Error de Meta: ${errText}`;
  }
}

export function logWhatsAppMessage(phone, direction, messageType, body, payload = {}) {
  const normalized = normalizePhone(phone) || String(phone || 'demo');
  db.prepare(
    `INSERT INTO whatsapp_messages (phone, direction, message_type, body, payload)
     VALUES (?, ?, ?, ?, ?)`
  ).run(normalized, direction, messageType, body, JSON.stringify(payload));
}

export function getWhatsAppHistory(phone, limit = 60) {
  const normalized = normalizePhone(phone) || String(phone || 'demo');
  const rows = db
    .prepare(
      `SELECT id, phone, direction, message_type, body, payload, created_at
       FROM whatsapp_messages
       WHERE phone = ?
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(normalized, limit)
    .reverse();

  return rows.map((r) => ({
    ...r,
    payload: safeJsonParse(r.payload, {}),
  }));
}

export function clearWhatsAppHistory(phone) {
  const normalized = normalizePhone(phone) || String(phone || 'demo');
  db.prepare('DELETE FROM whatsapp_messages WHERE phone = ?').run(normalized);
}

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

async function callMetaCloudApi(body) {
  if (!config.whatsapp.isConfigured) {
    return { sent: true, mode: 'demo' };
  }

  const url = `https://graph.facebook.com/${config.whatsapp.apiVersion}/${config.whatsapp.phoneNumberId}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.whatsapp.accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errText = await response.text();
    console.error('[WhatsApp Cloud API] Error:', response.status, errText);
    return { sent: false, mode: 'live', error: translateMetaError(errText), rawError: errText };
  }

  const data = await response.json();
  return { sent: true, mode: 'live', data };
}

/**
 * Envía un mensaje de prueba real a través de Meta WhatsApp Cloud API.
 * mode = 'hello_world' (plantilla pre-aprobada de Meta) | 'buttons' (botones interactivos)
 */
export async function sendTestWhatsAppMessage(rawPhone, mode = 'hello_world') {
  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (digits.length < 10) {
    return {
      sent: false,
      mode: 'live',
      error: 'Ingresá un número de WhatsApp válido con código de país (ej: 5493476582815).',
    };
  }

  // Si está conectado WhatsApp por Código QR, enviar mensaje real directo por ahí
  if (isQrWhatsAppConnected()) {
    const sampleText =
      `✅ *¡Prueba exitosa desde ${config.clinic.name}!*\n\n` +
      `Tu WhatsApp ya está vinculado por Código QR y listo para enviar *recordatorios automáticos 24 hs antes* de cada turno.\n\n` +
      `Ejemplo de recordatorio:\n` +
      `*1* — ✅ Confirmar\n` +
      `*2* — 🔄 Modificar\n` +
      `*3* — ❌ Cancelar`;
    const r = await sendViaQrWhatsApp(digits, sampleText);
    return { ...r, mode: 'live' };
  }

  if (!config.whatsapp.isConfigured) {
    return {
      sent: false,
      mode: 'demo',
      error: 'Primero escaneá el Código QR de WhatsApp (o cargá tus datos de Meta).',
    };
  }

  if (mode === 'hello_world') {
    return callMetaCloudApi({
      messaging_product: 'whatsapp',
      to: digits,
      type: 'template',
      template: {
        name: 'hello_world',
        language: { code: 'en_US' },
      },
    });
  }

  return callMetaCloudApi({
    messaging_product: 'whatsapp',
    to: digits,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: {
        text:
          `✅ *¡Prueba exitosa desde ${config.clinic.name}!*\n\n` +
          `Tu WhatsApp Real ya está conectado al Turnero y a los recordatorios de 24 hs.\n` +
          `Tocá un botón para probar la respuesta:`,
      },
      action: {
        buttons: [
          { type: 'reply', reply: { id: 'MENU_MAIN', title: '🏠 Abrir Menú' } },
          { type: 'reply', reply: { id: 'MENU_BOOK', title: '📅 Sacar turno' } },
        ],
      },
    },
  });
}

/**
 * Envía un mensaje de texto simple, o con botones interactivos (máx. 3), o lista desplegable (máx. 10).
 * Siempre guarda el mensaje en whatsapp_messages para que se vea en el Simulador (/whatsapp-demo).
 */
export async function sendBotMessage(phone, reply) {
  const to = normalizePhone(phone);
  const { text, buttons = [], list = null, type = null } = reply;

  if (buttons.length > 0 && buttons.length <= 3) {
    logWhatsAppMessage(to, 'outbound', type || 'buttons', text, { buttons });
    if (isQrWhatsAppConnected()) {
      const r = await sendViaQrWhatsApp(to, formatReplyForWhatsAppText(reply), extractReplyActions(reply));
      return { ...r, mode: 'live' };
    }
    return callMetaCloudApi({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text },
        action: {
          buttons: buttons.map((b) => ({
            type: 'reply',
            reply: {
              id: String(b.id),
              title: String(b.title).slice(0, 20),
            },
          })),
        },
      },
    });
  }

  if (list && Array.isArray(list.rows) && list.rows.length > 0) {
    logWhatsAppMessage(to, 'outbound', type || 'list', text, { list });
    if (isQrWhatsAppConnected()) {
      const r = await sendViaQrWhatsApp(to, formatReplyForWhatsAppText(reply), extractReplyActions(reply));
      return { ...r, mode: 'live' };
    }
    return callMetaCloudApi({
      messaging_product: 'whatsapp',
      to,
      type: 'interactive',
      interactive: {
        type: 'list',
        body: { text },
        action: {
          button: String(list.buttonText || 'Ver opciones').slice(0, 20),
          sections: [
            {
              title: String(list.sectionTitle || 'Opciones').slice(0, 24),
              rows: list.rows.slice(0, 10).map((r) => ({
                id: String(r.id),
                title: String(r.title).slice(0, 24),
                description: r.description ? String(r.description).slice(0, 72) : undefined,
              })),
            },
          ],
        },
      },
    });
  }

  logWhatsAppMessage(to, 'outbound', type || 'text', text, {});
  if (isQrWhatsAppConnected()) {
    const r = await sendViaQrWhatsApp(to, text);
    return { ...r, mode: 'live' };
  }
  return callMetaCloudApi({
    messaging_product: 'whatsapp',
    to,
    type: 'text',
    text: { body: text },
  });
}

/**
 * Envía el recordatorio automático de 24 hs antes con botones Confirmar / Modificar / Cancelar.
 * En modo LIVE usa una Plantilla (Template) oficial de WhatsApp Business API.
 * En modo DEMO envía los botones interactivos al Simulador de WhatsApp.
 */
export async function send24hReminder(appointment) {
  const to = normalizePhone(appointment.paciente_whatsapp);
  const fechaTexto = formatDateFriendly(appointment.fecha);

  const text =
    `¡Hola, ${appointment.paciente_nombre}! 👋\n\n` +
    `Te recordamos tu turno en *${config.clinic.name}*:\n` +
    `📅 *${fechaTexto} a las ${appointment.hora_inicio} hs*\n` +
    `🩺 *${appointment.profesional_nombre}* (${appointment.especialidad_nombre})\n` +
    `📍 ${appointment.consultorio} — ${config.clinic.address}\n` +
    `🔖 Código: *${appointment.codigo}*\n\n` +
    `Por favor, confirmanos si vas a poder asistir:`;

  const buttons = [
    { id: `REM_CONFIRM_${appointment.id}`, title: '✅ Confirmar' },
    { id: `REM_MODIFY_${appointment.id}`, title: '🔄 Modificar' },
    { id: `REM_CANCEL_${appointment.id}`, title: '❌ Cancelar' },
  ];

  logWhatsAppMessage(to, 'outbound', 'reminder', text, {
    buttons,
    appointmentId: appointment.id,
    codigo: appointment.codigo,
  });

  // Si está conectado WhatsApp por Código QR, enviar el recordatorio real directo al celular del paciente
  if (isQrWhatsAppConnected()) {
    const r = await sendViaQrWhatsApp(to, formatReplyForWhatsAppText({ text, buttons }), buttons);
    return { ...r, mode: 'live' };
  }

  if (!config.whatsapp.isConfigured) {
    return { sent: true, mode: 'demo' };
  }

  // En producción, fuera de la ventana de 24h de WhatsApp, se usa Template oficial con Quick Reply buttons
  const templateResult = await callMetaCloudApi({
    messaging_product: 'whatsapp',
    to,
    type: 'template',
    template: {
      name: config.whatsapp.reminderTemplate,
      language: { code: config.whatsapp.reminderLang },
      components: [
        {
          type: 'body',
          parameters: [
            { type: 'text', text: appointment.paciente_nombre },
            { type: 'text', text: fechaTexto },
            { type: 'text', text: `${appointment.hora_inicio} hs` },
            { type: 'text', text: appointment.profesional_nombre },
            { type: 'text', text: `${appointment.consultorio} - ${config.clinic.address}` },
          ],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '0',
          parameters: [{ type: 'payload', payload: `REM_CONFIRM_${appointment.id}` }],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '1',
          parameters: [{ type: 'payload', payload: `REM_MODIFY_${appointment.id}` }],
        },
        {
          type: 'button',
          sub_type: 'quick_reply',
          index: '2',
          parameters: [{ type: 'payload', payload: `REM_CANCEL_${appointment.id}` }],
        },
      ],
    },
  });

  if (templateResult.sent) return templateResult;

  // Fallback útil durante pruebas: si la plantilla aún no está aprobada en Meta,
  // intentar enviar los botones interactivos directamente (funciona si el paciente escribió en las últimas 24 hs).
  const interactiveFallback = await callMetaCloudApi({
    messaging_product: 'whatsapp',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text },
      action: {
        buttons: buttons.map((b) => ({
          type: 'reply',
          reply: { id: b.id, title: b.title.slice(0, 20) },
        })),
      },
    },
  });

  return interactiveFallback.sent ? interactiveFallback : templateResult;
}

/**
 * Envía comprobante instantáneo por WhatsApp cuando un paciente reserva desde la Web.
 */
export async function sendBookingConfirmationWhatsApp(appointment) {
  const fechaTexto = formatDateFriendly(appointment.fecha);
  const text =
    `✅ *¡Turno confirmado en ${config.clinic.name}!*\n\n` +
    `👤 *Paciente:* ${appointment.paciente_nombre}\n` +
    `🩺 *Profesional:* ${appointment.profesional_nombre} (${appointment.especialidad_nombre})\n` +
    `📅 *Día:* ${fechaTexto}\n` +
    `⏰ *Horario:* ${appointment.hora_inicio} hs\n` +
    `📍 *Lugar:* ${appointment.consultorio} — ${config.clinic.address}\n` +
    `🔖 *Código:* ${appointment.codigo}\n\n` +
    `⏰ *24 horas antes* te vamos a escribir por acá para que puedas confirmar, cambiar o cancelar tu turno con un toque.`;

  return sendBotMessage(appointment.paciente_whatsapp, { text });
}
