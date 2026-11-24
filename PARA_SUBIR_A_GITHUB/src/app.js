import path from 'node:path';
import express from 'express';
import QRCode from 'qrcode';
import { config } from './config.js';
import { db, initDatabase } from './db/database.js';
import { apiRouter } from './routes/api.js';
import { webhookRouter } from './routes/webhook.js';
import { startReminderScheduler } from './services/reminderJob.js';
import { isGoogleCalendarLive } from './services/googleCalendar.js';
import { isWhatsAppLive, logWhatsAppMessage, sendBotMessage } from './services/whatsapp.js';
import { handleIncomingBotMessage } from './services/botEngine.js';
import {
  autoResumeQrWhatsAppIfSaved,
  getQrWhatsAppStatus,
  setQrIncomingMessageHandler,
} from './services/whatsappQr.js';
import {
  attachDatabaseForCloudSync,
  cloudSyncWriteMiddleware,
  isCloudDbConfigured,
  scheduleCloudSync,
} from './services/cloudSync.js';

// 1. Inicializar SQLite y datos iniciales (si CLOUD_DB_URL estaba configurada, ya se restauró antes)
initDatabase();
attachDatabaseForCloudSync(db);

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// 2. Archivos estáticos (Turnero Web, Simulador WhatsApp y Panel Admin)
const publicDir = path.join(config.rootDir, 'public');
app.use(express.static(publicDir));

// Rutas amigables
app.get(['/whatsapp-demo', '/bot'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'whatsapp-demo.html'));
});

app.get(['/admin', '/login'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'admin.html'));
});

app.get(['/alta-profesional', '/proponer-horarios'], (_req, res) => {
  res.sendFile(path.join(publicDir, 'alta-profesional.html'));
});

app.get('/qr-clinica', (_req, res) => {
  res.sendFile(path.join(publicDir, 'qr-clinica.html'));
});

// Manifest dinámico PWA (toma automáticamente el nombre real de la clínica)
function buildManifest(startUrl) {
  const fullName = `${config.clinic.name} — Turnos`;
  const shortName = config.clinic.name.length > 14 ? config.clinic.name.slice(0, 14).trim() : config.clinic.name;
  return {
    name: fullName,
    short_name: shortName,
    description: `Sacá, confirmá o modificá tus turnos médicos en ${config.clinic.name}.`,
    start_url: startUrl,
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0f766e',
    theme_color: '#0f766e',
    lang: 'es-AR',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any maskable' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
    ],
  };
}

app.get('/manifest.webmanifest', (_req, res) => {
  res.type('application/manifest+json').json(buildManifest('/bot'));
});

app.get('/manifest-web.webmanifest', (_req, res) => {
  res.type('application/manifest+json').json(buildManifest('/'));
});

// Datos y códigos QR imprimibles para el cartel de recepción (/qr-clinica)
app.get('/api/qr-poster', async (req, res) => {
  try {
    const rawOrigin = String(req.query.origin || `${req.protocol}://${req.get('host')}`).trim();
    const origin = rawOrigin.replace(/\/+$/, '');
    const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:|\/|$)/i.test(origin);

    const appUrl = `${origin}/bot`;
    const webUrl = `${origin}/`;
    const profUrl = `${origin}/alta-profesional`;

    const [appQrDataUrl, webQrDataUrl, profQrDataUrl] = await Promise.all([
      QRCode.toDataURL(appUrl, { width: 360, margin: 2 }),
      QRCode.toDataURL(webUrl, { width: 360, margin: 2 }),
      QRCode.toDataURL(profUrl, { width: 360, margin: 2 }),
    ]);

    const qrState = getQrWhatsAppStatus();
    const rawWa = qrState.phone || String(config.clinic.phone || '').replace(/\D/g, '');
    let waUrl = '';
    let waQrDataUrl = '';
    if (rawWa && rawWa.length >= 10) {
      let waDigits = rawWa;
      if (waDigits.startsWith('54') && !waDigits.startsWith('549') && waDigits.length === 12) {
        waDigits = `549${waDigits.slice(2)}`;
      }
      waUrl = `https://wa.me/${waDigits}?text=${encodeURIComponent('Quiero sacar un turno')}`;
      waQrDataUrl = await QRCode.toDataURL(waUrl, { width: 360, margin: 2 });
    }

    res.json({
      clinic: config.clinic,
      origin,
      isLocalhost,
      whatsappLive: Boolean(qrState.connected),
      appUrl,
      appQrDataUrl,
      webUrl,
      webQrDataUrl,
      profUrl,
      profQrDataUrl,
      waUrl,
      waQrDataUrl,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 3. APIs y Webhook real de Meta WhatsApp Cloud API (con respaldo automático en la nube tras escrituras)
app.use('/api', cloudSyncWriteMiddleware, apiRouter);
app.use('/webhook', cloudSyncWriteMiddleware, webhookRouter);

// 4. Conectar respuestas entrantes del WhatsApp QR con el motor del Bot + restaurar sesión guardada
setQrIncomingMessageHandler(async ({ phone, text, actionId, selfChat }) => {
  // Verificar si este teléfono está en medio de un flujo activo del bot
  const sess = db
    .prepare('SELECT step FROM bot_sessions WHERE session_key = ?')
    .get(`whatsapp:${phone}`);
  const hasActiveFlow = Boolean(sess && sess.step && sess.step !== 'menu');

  // Si NO está en un flujo activo y NO respondió a un recordatorio/menú del bot,
  // solo activar el bot si menciona explícitamente el turnero (evita interrumpir chats personales!).
  if (!actionId && !hasActiveFlow) {
    const lower = String(text || '').trim().toLowerCase();
    const triggerRegex = /\b(turno|turnos|cita|citas|agenda|sacar turno|menu|menú|bot|confirmar|modificar|cancelar)\b/i;
    const isSelfGreeting = selfChat && /^(hola|menu|menú|inicio|0)$/i.test(lower);
    if (!triggerRegex.test(lower) && !isSelfGreeting) {
      return;
    }
  }

  logWhatsAppMessage(phone, 'inbound', 'text', text || actionId, { actionId, via: 'qr' });
  const replies = await handleIncomingBotMessage({
    channel: 'whatsapp',
    userId: phone,
    phone,
    text,
    actionId,
  });
  for (const reply of replies) {
    await sendBotMessage(phone, reply);
  }
  scheduleCloudSync('whatsapp-qr-bot');
});
autoResumeQrWhatsAppIfSaved();

// 5. Iniciar tarea programada de recordatorios 24 hs antes
startReminderScheduler();

// 6. Levantar servidor
app.listen(config.port, '0.0.0.0', () => {
  console.log('\n============================================================');
  console.log(`🏥 ${config.clinic.name} — Turnero Online & Bot`);
  console.log('============================================================');
  console.log(`🌐 Turnero Web (Pacientes):  http://localhost:${config.port}/`);
  console.log(`📱 Simulador Bot WhatsApp:   http://localhost:${config.port}/whatsapp-demo`);
  console.log(`📋 Panel de Recepción:       http://localhost:${config.port}/admin`);
  console.log(`🔗 Webhook Meta WhatsApp:    http://localhost:${config.port}/webhook/whatsapp`);
  console.log('------------------------------------------------------------');
  console.log(
    `☁️  Base en la Nube: ${isCloudDbConfigured() ? '✅ PERMANENTE (NEON)' : '💾 SOLO LOCAL (configurá CLOUD_DB_URL para nube)'}`
  );
  console.log(
    `📅 Google Calendar: ${isGoogleCalendarLive() ? '✅ CONECTADO (LIVE)' : '🧪 MODO LOCAL/DEMO (configurá .env para modo live)'}`
  );
  console.log(
    `💬 WhatsApp Cloud:  ${isWhatsAppLive() ? '✅ CONECTADO (LIVE)' : '🧪 MODO SIMULADOR (configurá .env para modo live)'}`
  );
  console.log('============================================================\n');
});
