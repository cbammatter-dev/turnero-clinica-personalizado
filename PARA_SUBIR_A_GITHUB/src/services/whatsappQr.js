import fs from 'node:fs';
import path from 'node:path';
import pino from 'pino';
import QRCode from 'qrcode';
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
} from '@whiskeysockets/baileys';
import { config } from '../config.js';
import { db } from '../db/database.js';
import { normalizePhone } from '../utils/datetime.js';

const AUTH_DIR = path.join(config.dataDir, 'whatsapp-auth');
// Marca invisible (zero-width) agregada a cada mensaje del bot para impedir bucles
// incluso si el mismo WhatsApp llegara a estar vinculado en dos servidores a la vez.
const BOT_WATERMARK = '\u200B\u200C\u200D';
const BOT_OUTPUT_MARKERS = [
  '👇 *Respondé con el número de la opción:*',
  '✅ *¡Prueba exitosa desde',
  'No entendí esa opción 😅',
  'Parece que hubo un inconveniente con ese dato 😅',
  'Ingresá un DNI válido (solo números, sin puntos).',
  'Te recordamos tu turno en *',
  '✅ *¡Turno confirmado en ',
  '🎉 *¡Listo,',
  'No encontré turnos vigentes para el DNI',
];
const selfChatTimestamps = [];

function isBotGeneratedMessage(text, msgKey) {
  if (!text) return false;
  if (text.includes(BOT_WATERMARK)) return true;
  if (BOT_OUTPUT_MARKERS.some((m) => text.includes(m))) return true;
  // Los IDs generados por clientes Baileys empiezan con "3EB0"; los del celular real no.
  if (msgKey?.fromMe && /^3EB0/i.test(String(msgKey.id || ''))) return true;
  return false;
}

function isSelfChatRateLimited() {
  const now = Date.now();
  while (selfChatTimestamps.length > 0 && now - selfChatTimestamps[0] > 60_000) {
    selfChatTimestamps.shift();
  }
  if (selfChatTimestamps.length >= 12) return true;
  selfChatTimestamps.push(now);
  return false;
}

let sock = null;
let status = 'disconnected'; // disconnected | connecting | qr | connected
let currentQrDataUrl = '';
let connectedUser = null;
let lastError = '';
let reconnectTimer = null;
let incomingHandler = null;
const onConnectedListeners = new Set();
let sleepWatchdogStarted = false;

function withTimeout(promise, ms, label = 'operación') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Tiempo agotado (${label})`)), ms);
    Promise.resolve(promise).then(
      (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function onQrWhatsAppConnected(fn) {
  if (typeof fn === 'function') {
    onConnectedListeners.add(fn);
  }
}

function forceScheduleReconnect(reason = 'Reconectando con WhatsApp...') {
  const prevSock = sock;
  sock = null;
  connectedUser = null;
  status = 'connecting';
  lastError = reason;
  if (prevSock) {
    try {
      prevSock.end(undefined);
    } catch {
      // ignore
    }
  }
  if (reconnectTimer) clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    startQrWhatsApp().catch((err) => {
      status = 'disconnected';
      lastError = err.message;
    });
  }, 2500);
}

function startSleepWakeWatchdog() {
  if (sleepWatchdogStarted) return;
  sleepWatchdogStarted = true;
  let lastTick = Date.now();
  const interval = setInterval(() => {
    const now = Date.now();
    const gapMs = now - lastTick;
    lastTick = now;
    // Si pasaron más de 60 segundos entre ticks de 15s, la PC volvió de suspensión/hibernación
    if (gapMs > 60_000 && fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
      console.log(
        `[WhatsApp QR] ⏰ Se detectó regreso de suspensión (${Math.round(gapMs / 1000)}s). Reconectando WhatsApp...`
      );
      forceScheduleReconnect('Reconectando tras suspensión del equipo...');
    }
  }, 15_000);
  if (typeof interval.unref === 'function') interval.unref();
}

// Guardamos los IDs enviados por el propio bot para evitar bucles
// pero permitir probar desde el mismo celular ("Mensajes contigo mismo").
const sentByBotIds = new Set();
// Mapeo mensajeEnviadoId -> lista de acciones [{id, title}] (para responder citando un recordatorio puntual)
const sentActionsByMsgId = new Map();
// Recordar el último JID real usado para cada teléfono
const lastJidByPhone = new Map();

function rememberBotSentMessage(msgId, actions = []) {
  if (!msgId) return;
  sentByBotIds.add(msgId);
  if (sentByBotIds.size > 1000) {
    const first = sentByBotIds.values().next().value;
    sentByBotIds.delete(first);
  }
  if (Array.isArray(actions) && actions.length > 0) {
    sentActionsByMsgId.set(msgId, actions);
    if (sentActionsByMsgId.size > 500) {
      const firstKey = sentActionsByMsgId.keys().next().value;
      sentActionsByMsgId.delete(firstKey);
    }
  }
}

export function setQrIncomingMessageHandler(fn) {
  incomingHandler = fn;
}

export function isQrWhatsAppConnected() {
  return Boolean(sock && status === 'connected');
}

export function getQrWhatsAppStatus() {
  return {
    status,
    connected: status === 'connected',
    qrDataUrl: status === 'qr' ? currentQrDataUrl : '',
    phone: connectedUser?.phone || '',
    name: connectedUser?.name || '',
    hasSavedSession: fs.existsSync(path.join(AUTH_DIR, 'creds.json')),
    lastError,
  };
}

export function extractReplyActions(reply) {
  const actions = [];
  if (Array.isArray(reply.buttons) && reply.buttons.length > 0) {
    reply.buttons.forEach((b) => actions.push({ id: b.id, title: b.title }));
  } else if (reply.list?.rows?.length) {
    reply.list.rows.forEach((r) =>
      actions.push({ id: r.id, title: r.title, description: r.description })
    );
  }
  return actions;
}

/**
 * Formatea una respuesta del bot (texto + botones o lista) en un mensaje súper claro
 * con opciones numeradas (*1*, *2*, *3*...) ideal para cualquier WhatsApp real.
 */
export function formatReplyForWhatsAppText(reply) {
  const lines = [reply.text || ''];
  const actions = extractReplyActions(reply);

  if (actions.length > 0) {
    lines.push('');
    lines.push('👇 *Respondé con el número de la opción:*');
    actions.forEach((act, i) => {
      lines.push(`*${i + 1}* — ${act.title}`);
    });
  }

  return lines.join('\n');
}

/**
 * Si el paciente responde "1", "2", "3" (o "1.", "1)", "confirmar", "modificar", "cancelar"),
 * busca primero si citó un mensaje específico (stanzaId) y si no, usa el último mensaje saliente
 * guardado en SQLite para ese teléfono.
 */
function resolveNumberedAction(phone, rawText, quotedStanzaId = null) {
  const trimmed = String(rawText || '').trim();
  const numMatch = trimmed.match(/^(\d{1,2})[.)\-:\s]*$/);
  const lower = trimmed.toLowerCase();

  let actions = [];
  if (quotedStanzaId && sentActionsByMsgId.has(quotedStanzaId)) {
    actions = sentActionsByMsgId.get(quotedStanzaId);
  }

  if (actions.length === 0) {
    const cleanPhone = normalizePhone(phone);
    const row = db
      .prepare(
        `SELECT payload FROM whatsapp_messages
         WHERE phone = ? AND direction = 'outbound'
         ORDER BY id DESC LIMIT 1`
      )
      .get(cleanPhone);

    if (row?.payload) {
      try {
        const payload = JSON.parse(row.payload);
        actions = payload.buttons?.length
          ? payload.buttons
          : payload.list?.rows?.length
          ? payload.list.rows
          : [];
      } catch {
        actions = [];
      }
    }
  }

  if (actions.length === 0) return null;

  if (numMatch) {
    const idx = Number(numMatch[1]) - 1;
    if (idx >= 0 && actions[idx]?.id) {
      return {
        actionId: actions[idx].id,
        label: actions[idx].title || trimmed,
      };
    }
  }

  // También aceptar palabras clave directas sobre recordatorios (Confirmar / Modificar / Cancelar)
  const keywordMatch = actions.find((a) => {
    const t = String(a.title || '').toLowerCase();
    if (lower.includes('confirm') && t.includes('confirm')) return true;
    if ((lower.includes('modif') || lower.includes('cambi')) && (t.includes('modif') || t.includes('cambi'))) return true;
    if ((lower.includes('cancel') || lower.includes('anul')) && t.includes('cancel')) return true;
    return false;
  });

  if (keywordMatch?.id) {
    return {
      actionId: keywordMatch.id,
      label: keywordMatch.title || trimmed,
    };
  }

  return null;
}

/**
 * Resuelve el JID real de WhatsApp (maneja números argentinos con o sin el 9).
 */
async function resolveWhatsAppJid(rawPhone) {
  const cleanPhone = normalizePhone(rawPhone);
  if (cleanPhone && lastJidByPhone.has(cleanPhone)) {
    return lastJidByPhone.get(cleanPhone);
  }

  // Si estamos enviando al propio número conectado (ej. pruebas o recordatorio a nuestro propio celular)
  if (cleanPhone && connectedUser?.phone) {
    const ownClean = normalizePhone(connectedUser.phone);
    if (ownClean && cleanPhone === ownClean) {
      return `${connectedUser.phone}@s.whatsapp.net`;
    }
  }

  const digits = String(rawPhone || '').replace(/\D/g, '');
  if (!digits) throw new Error('Número de teléfono inválido.');

  const candidates = [digits];
  if (digits.startsWith('549') && digits.length >= 12) {
    candidates.push(`54${digits.slice(3)}`);
  } else if (digits.startsWith('54') && !digits.startsWith('549') && digits.length >= 11) {
    candidates.push(`549${digits.slice(2)}`);
  } else if (digits.length === 10) {
    candidates.unshift(`549${digits}`, `54${digits}`);
  }

  for (const cand of candidates) {
    try {
      const res = await withTimeout(
        sock.onWhatsApp(`${cand}@s.whatsapp.net`),
        8000,
        'onWhatsApp'
      );
      if (Array.isArray(res) && res[0]?.exists && res[0]?.jid) {
        return res[0].jid;
      }
    } catch {
      // probar siguiente candidato
    }
  }

  return `${candidates[0]}@s.whatsapp.net`;
}

export async function sendViaQrWhatsApp(phone, text, actions = []) {
  if (!isQrWhatsAppConnected()) {
    return { sent: false, mode: 'qr', error: 'WhatsApp QR no está conectado.' };
  }
  try {
    const jid = await resolveWhatsAppJid(phone);
    const rawText = String(text || '');
    const taggedText = rawText.endsWith(BOT_WATERMARK) ? rawText : `${rawText}${BOT_WATERMARK}`;
    const sentMsg = await withTimeout(
      sock.sendMessage(jid, { text: taggedText }),
      15_000,
      'sendMessage'
    );
    if (!sentMsg?.key?.id) {
      throw new Error('WhatsApp no devolvió confirmación del mensaje.');
    }
    rememberBotSentMessage(sentMsg.key.id, actions);
    console.log(`[WhatsApp QR] 📤 Enviado a ${jid} (id=${sentMsg.key.id})`);
    return { sent: true, mode: 'qr', jid, messageId: sentMsg.key.id };
  } catch (err) {
    console.error('[WhatsApp QR] Error enviando mensaje:', err.message);
    if (
      /closed|timeout|agotado|connection|socket/i.test(err.message || '') &&
      fs.existsSync(path.join(AUTH_DIR, 'creds.json'))
    ) {
      forceScheduleReconnect(`Reconectando tras error de envío (${err.message})`);
    }
    return { sent: false, mode: 'qr', error: err.message };
  }
}

function extractPhoneFromMessageKey(key) {
  // Baileys v7 puede enviar @lid en remoteJid y el número real en remoteJidAlt o senderPn
  const candidates = [key?.remoteJidAlt, key?.senderPn, key?.remoteJid];
  for (const jid of candidates) {
    if (!jid) continue;
    if (jid.endsWith('@s.whatsapp.net')) {
      const raw = jid.split('@')[0].split(':')[0];
      if (/^\d{8,15}$/.test(raw)) return normalizePhone(raw);
    }
  }
  return '';
}

function isSelfChatMessage(key, senderPhone) {
  if (!connectedUser) return false;
  const ownPhone = normalizePhone(connectedUser.phone);
  if (senderPhone && ownPhone && senderPhone === ownPhone) return true;
  if (connectedUser.lid && key?.remoteJid) {
    const remoteLid = key.remoteJid.split('@')[0].split(':')[0];
    if (remoteLid && remoteLid === connectedUser.lid) return true;
  }
  return false;
}

export async function startQrWhatsApp({ forceNew = false } = {}) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  if (forceNew) {
    await disconnectQrWhatsApp({ clearSession: true });
  }

  if (sock && (status === 'connecting' || status === 'qr' || status === 'connected')) {
    return getQrWhatsAppStatus();
  }

  fs.mkdirSync(AUTH_DIR, { recursive: true });
  status = 'connecting';
  lastError = '';
  currentQrDataUrl = '';

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let version;
  try {
    const latest = await fetchLatestBaileysVersion();
    version = latest.version;
  } catch {
    version = undefined;
  }

  const logger = pino({ level: 'silent' });
  const client = makeWASocket({
    version,
    auth: state,
    logger,
    browser: ['Turnero Clinica', 'Chrome', '1.0.0'],
    printQRInTerminal: false,
    syncFullHistory: false,
    markOnlineOnConnect: false,
    keepAliveIntervalMs: 20_000,
    connectTimeoutMs: 25_000,
  });

  sock = client;
  startSleepWakeWatchdog();

  client.ev.on('creds.update', saveCreds);

  client.ev.on('connection.update', async (update) => {
    // Ignorar eventos de sockets viejos que ya fueron reemplazados
    if (sock && sock !== client) return;
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      status = 'qr';
      try {
        currentQrDataUrl = await QRCode.toDataURL(qr, { width: 280, margin: 2 });
      } catch (e) {
        lastError = e.message;
      }
    }

    if (connection === 'open') {
      status = 'connected';
      currentQrDataUrl = '';
      lastError = '';
      const rawId = client.user?.id || '';
      const rawLid = client.user?.lid || '';
      connectedUser = {
        phone: rawId.split(':')[0].split('@')[0],
        lid: rawLid ? rawLid.split(':')[0].split('@')[0] : '',
        name: client.user?.name || 'WhatsApp Clínica',
      };
      console.log(`[WhatsApp QR] ✅ Conectado como +${connectedUser.phone} (${connectedUser.name})`);
      for (const fn of onConnectedListeners) {
        try {
          fn(connectedUser);
        } catch {
          // ignore
        }
      }
    }

    if (connection === 'close') {
      const code = lastDisconnect?.error?.output?.statusCode;
      const loggedOut = code === DisconnectReason.loggedOut;
      sock = null;
      connectedUser = null;
      currentQrDataUrl = '';

      if (loggedOut) {
        status = 'disconnected';
        lastError = 'Sesión cerrada desde el celular. Generá un nuevo QR para volver a vincular.';
        try {
          fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        } catch {
          // ignore
        }
        console.log('[WhatsApp QR] Sesión cerrada.');
      } else {
        status = 'connecting';
        lastError = 'Reconectando con WhatsApp...';
        reconnectTimer = setTimeout(() => {
          startQrWhatsApp().catch((err) => {
            status = 'disconnected';
            lastError = err.message;
          });
        }, 4000);
      }
    }
  });

  client.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' || !incomingHandler) return;

    for (const msg of messages) {
      try {
        if (!msg.message) continue;
        const msgId = msg.key?.id;
        // 1) Nunca procesar el eco de un mensaje enviado por nuestro propio bot
        if (msgId && sentByBotIds.has(msgId)) continue;

        const remoteJid = msg.key?.remoteJid || '';
        if (!remoteJid || remoteJid.endsWith('@g.us') || remoteJid === 'status@broadcast') {
          continue;
        }

        let senderPhone = extractPhoneFromMessageKey(msg.key);
        const selfChat = isSelfChatMessage(msg.key, senderPhone);

        // Si es un chat propio (@lid o @s.whatsapp.net), usar el número propio conectado
        if (selfChat && !senderPhone && connectedUser?.phone) {
          senderPhone = normalizePhone(connectedUser.phone);
        }

        // 2) Si lo escribió el dueño de la cuenta a OTRA persona manualmente, ignorar (no interrumpir chat humano).
        //    Pero si es el chat consigo mismo (selfChat), SÍ procesarlo para poder probar y responder 1/2/3!
        if (msg.key?.fromMe && !selfChat) continue;

        if (!senderPhone) continue;

        // Guardar JID real para responder al mismo chat
        lastJidByPhone.set(senderPhone, remoteJid);

        const text =
          msg.message.conversation ||
          msg.message.extendedTextMessage?.text ||
          msg.message.buttonsResponseMessage?.selectedDisplayText ||
          msg.message.listResponseMessage?.title ||
          '';

        if (!text.trim()) continue;

        // 3) Protección antibucle definitiva: nunca responder a mensajes generados por otro bot/servidor
        if (isBotGeneratedMessage(text, msg.key)) continue;

        // 4) Cortocircuito de seguridad en auto-chat (máx. 12 respuestas por minuto)
        if (selfChat && isSelfChatRateLimited()) {
          console.log('[WhatsApp QR] 🛡️ Protección antibucle activada en auto-chat (pausa 60s).');
          continue;
        }

        const quotedStanzaId =
          msg.message.extendedTextMessage?.contextInfo?.stanzaId || null;

        console.log(`[WhatsApp QR] 📩 Entrante de ${senderPhone}${selfChat ? ' (auto-chat)' : ''}: "${text.trim()}"`);

        const resolved = resolveNumberedAction(senderPhone, text, quotedStanzaId);
        await incomingHandler({
          phone: senderPhone,
          text: resolved ? resolved.label : text.trim(),
          actionId: resolved ? resolved.actionId : null,
          selfChat,
        });
      } catch (err) {
        console.error('[WhatsApp QR] Error procesando mensaje entrante:', err.message);
      }
    }
  });

  return getQrWhatsAppStatus();
}

export async function disconnectQrWhatsApp({ clearSession = true } = {}) {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (sock) {
    try {
      if (clearSession) await sock.logout();
    } catch {
      // ignore
    }
    try {
      sock.end(undefined);
    } catch {
      // ignore
    }
    sock = null;
  }
  status = 'disconnected';
  currentQrDataUrl = '';
  connectedUser = null;
  lastError = '';

  if (clearSession) {
    try {
      fs.rmSync(AUTH_DIR, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
  return getQrWhatsAppStatus();
}

export async function autoResumeQrWhatsAppIfSaved() {
  if (fs.existsSync(path.join(AUTH_DIR, 'creds.json'))) {
    console.log('[WhatsApp QR] Restaurando sesión guardada automáticamente...');
    try {
      await startQrWhatsApp();
    } catch (err) {
      console.error('[WhatsApp QR] No se pudo restaurar sesión:', err.message);
    }
  }
}
