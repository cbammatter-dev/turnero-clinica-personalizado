import express from 'express';
import { config } from '../config.js';
import { handleIncomingBotMessage } from '../services/botEngine.js';
import { logWhatsAppMessage, sendBotMessage } from '../services/whatsapp.js';

export const webhookRouter = express.Router();

/**
 * Verificación del Webhook de Meta WhatsApp Cloud API (GET /webhook/whatsapp)
 */
webhookRouter.get('/whatsapp', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === config.whatsapp.verifyToken) {
    console.log('[WhatsApp Webhook] Verificado correctamente.');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

/**
 * Recepción de mensajes y botones interactivos de WhatsApp Cloud API (POST /webhook/whatsapp)
 */
webhookRouter.post('/whatsapp', async (req, res) => {
  // Responder 200 rápido a Meta para evitar reintentos
  res.sendStatus(200);

  try {
    const entries = req.body?.entry || [];
    for (const entry of entries) {
      for (const change of entry.changes || []) {
        const messages = change.value?.messages || [];
        for (const msg of messages) {
          const from = msg.from;
          let text = '';
          let actionId = null;

          if (msg.type === 'text') {
            text = msg.text?.body || '';
          } else if (msg.type === 'interactive') {
            if (msg.interactive?.type === 'button_reply') {
              actionId = msg.interactive.button_reply.id;
              text = msg.interactive.button_reply.title;
            } else if (msg.interactive?.type === 'list_reply') {
              actionId = msg.interactive.list_reply.id;
              text = msg.interactive.list_reply.title;
            }
          } else if (msg.type === 'button') {
            // Respuesta a botón Quick Reply de una Plantilla (ej. Recordatorio 24 hs)
            actionId = msg.button?.payload;
            text = msg.button?.text || '';
          }

          if (!from || (!text && !actionId)) continue;

          logWhatsAppMessage(from, 'inbound', msg.type, text || actionId, { actionId });

          const replies = await handleIncomingBotMessage({
            channel: 'whatsapp',
            userId: from,
            phone: from,
            text,
            actionId,
          });

          for (const reply of replies) {
            await sendBotMessage(from, reply);
          }
        }
      }
    }
  } catch (err) {
    console.error('[WhatsApp Webhook] Error procesando mensaje:', err);
  }
});
