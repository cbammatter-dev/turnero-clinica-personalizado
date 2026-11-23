import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(ROOT_DIR, 'data');
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(ROOT_DIR, 'service-account.json');

export const config = {
  rootDir: ROOT_DIR,
  dataDir: DATA_DIR,
  port: Number(process.env.PORT || 3000),
  dbPath: path.join(DATA_DIR, 'turnero.db'),

  clinic: {
    name: process.env.CLINIC_NAME || 'Clínica Salud Integral',
    address: process.env.CLINIC_ADDRESS || 'Av. Corrientes 1450, CABA',
    phone: process.env.CLINIC_PHONE || '+54 11 4555-0190',
    timezone: process.env.CLINIC_TIMEZONE || 'America/Argentina/Buenos_Aires',
    utcOffset: process.env.CLINIC_UTC_OFFSET || '-03:00',
    minLeadHours: Number(process.env.MIN_BOOKING_LEAD_HOURS || 1),
    bookingWindowDays: Number(process.env.BOOKING_WINDOW_DAYS || 30),
  },

  google: {
    defaultKeyFilePath: DEFAULT_SERVICE_ACCOUNT_PATH,
    serviceAccountEmail: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || '',
    privateKey: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_FILE || '',
    get resolvedKeyFile() {
      if (this.keyFile) {
        const p = path.isAbsolute(this.keyFile)
          ? this.keyFile
          : path.resolve(ROOT_DIR, this.keyFile);
        if (fs.existsSync(p)) return p;
      }
      if (fs.existsSync(DEFAULT_SERVICE_ACCOUNT_PATH)) {
        return DEFAULT_SERVICE_ACCOUNT_PATH;
      }
      return '';
    },
    get isConfigured() {
      return Boolean(
        this.resolvedKeyFile || (this.serviceAccountEmail && this.privateKey)
      );
    },
  },

  whatsapp: {
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN || '',
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID || '',
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN || 'mi_token_secreto_clinica_2026',
    apiVersion: process.env.WHATSAPP_API_VERSION || 'v21.0',
    reminderTemplate: process.env.WHATSAPP_REMINDER_TEMPLATE || 'recordatorio_turno_24h',
    reminderLang: process.env.WHATSAPP_REMINDER_LANG || 'es_AR',
    get isConfigured() {
      return Boolean(this.accessToken && this.phoneNumberId);
    },
  },

  reminders: {
    cronExpression: process.env.REMINDER_CRON || '* * * * *',
    hoursBefore: Number(process.env.REMINDER_HOURS_BEFORE || 24),
  },
};
