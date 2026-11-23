import cron from 'node-cron';
import { db } from '../db/database.js';
import { config } from '../config.js';
import { getAppointmentById } from './appointments.js';
import { isWhatsAppLive, send24hReminder } from './whatsapp.js';
import { getQrWhatsAppStatus, onQrWhatsAppConnected } from './whatsappQr.js';
import { appointmentStartMs } from '../utils/datetime.js';

let isProcessing = false;

function expectsLiveWhatsApp() {
  const qr = getQrWhatsAppStatus();
  return Boolean(qr.hasSavedSession || config.whatsapp.isConfigured);
}

/**
 * Busca turnos activos a los que les falte 24 hs o menos (hasta 1 hora antes)
 * y todavía no hayan recibido el recordatorio.
 * Si WhatsApp real está configurado/vinculado pero todavía reconectando tras reinicio
 * o suspensión, espera a que reconecte en vez de marcar falsamente como enviado.
 */
export async function processDueReminders() {
  if (isProcessing) return [];
  isProcessing = true;

  try {
    const requireLive = expectsLiveWhatsApp();
    if (requireLive && !isWhatsAppLive()) {
      console.log(
        '[Recordatorios 24h] WhatsApp todavía reconectando; se reintentará apenas quede conectado.'
      );
      return [];
    }

    const candidates = db
      .prepare(
        `SELECT id, fecha, hora_inicio
         FROM turnos
         WHERE estado = 'reservado'
           AND recordatorio_24h_enviado = 0`
      )
      .all();

    const nowMs = Date.now();
    const minLeadMs = 1 * 60 * 60 * 1000; // al menos 1 hora antes del turno
    const maxWindowMs = (config.reminders.hoursBefore + 0.5) * 60 * 60 * 1000; // hasta 24.5 hs antes

    const sentList = [];

    for (const row of candidates) {
      const startMs = appointmentStartMs(row.fecha, row.hora_inicio);
      const diffMs = startMs - nowMs;

      if (diffMs >= minLeadMs && diffMs <= maxWindowMs) {
        try {
          const result = await sendReminderNow(row.id, { requireLive });
          sentList.push(result);
        } catch (err) {
          console.error(
            `[Recordatorios 24h] No se pudo enviar turno #${row.id} (se reintentará):`,
            err.message
          );
        }
      }
    }

    return sentList;
  } finally {
    isProcessing = false;
  }
}

/**
 * Envía el recordatorio de 24 hs inmediatamente para un turno puntual
 * (usado por el cron automático y por el botón ⏰ 24h en /admin).
 * Solo marca recordatorio_24h_enviado = 1 si la entrega fue realmente confirmada.
 */
export async function sendReminderNow(appointmentId, { requireLive = false } = {}) {
  const appointment = getAppointmentById(appointmentId);
  if (!appointment) {
    throw new Error('Turno no encontrado.');
  }
  if (appointment.estado === 'cancelado') {
    throw new Error('No se puede enviar recordatorio de un turno cancelado.');
  }

  const mustBeLive = requireLive || expectsLiveWhatsApp();
  if (mustBeLive && !isWhatsAppLive()) {
    throw new Error(
      'WhatsApp está reconectando o desconectado en este momento. Reintentá en unos segundos.'
    );
  }

  const delivery = await send24hReminder(appointment);

  if (!delivery || !delivery.sent) {
    throw new Error(
      delivery?.error || 'No se pudo entregar el recordatorio por WhatsApp.'
    );
  }

  if (mustBeLive && delivery.mode !== 'live') {
    throw new Error('WhatsApp no está en modo en vivo; el recordatorio quedó pendiente para reintento.');
  }

  db.prepare(
    `UPDATE turnos
     SET recordatorio_24h_enviado = 1,
         recordatorio_enviado_at = CURRENT_TIMESTAMP,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).run(appointment.id);

  return {
    appointment: getAppointmentById(appointment.id),
    delivery,
  };
}

let scheduledTask = null;

export function startReminderScheduler() {
  if (scheduledTask) return scheduledTask;

  const runCheck = async (origin) => {
    try {
      const sent = await processDueReminders();
      if (sent.length > 0) {
        console.log(`[Recordatorios 24h - ${origin}] ✅ Enviados ${sent.length} recordatorios reales.`);
      }
    } catch (err) {
      console.error(`[Recordatorios 24h - ${origin}] Error ejecutando tarea:`, err.message);
    }
  };

  // Apenas WhatsApp QR conecta o reconecta (ej. al prender o volver de suspensión),
  // dispara automáticamente cualquier recordatorio pendiente.
  onQrWhatsAppConnected(() => {
    setTimeout(() => runCheck('whatsapp-conectado'), 3000);
  });

  // Revisión inicial (para modo demo o Meta Cloud API ya configurado)
  setTimeout(() => runCheck('inicio'), 6000);

  // Revisión cada 1 minuto para precisión exacta en la ventana de 24 hs
  const cronExpr = process.env.REMINDER_CRON || '* * * * *';
  scheduledTask = cron.schedule(cronExpr, () => runCheck('cron'));

  console.log(
    `[Recordatorios 24h] Programado (${cronExpr}) — ventana hasta ${config.reminders.hoursBefore}h antes.`
  );
  return scheduledTask;
}
