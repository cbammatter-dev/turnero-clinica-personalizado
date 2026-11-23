import crypto from 'node:crypto';
import { db } from '../db/database.js';

const COOKIE_NAME = 'turnero_session';
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 días

let cachedSecret = null;

function getSessionSecret() {
  if (cachedSecret) return cachedSecret;
  if (process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16) {
    cachedSecret = process.env.SESSION_SECRET;
    return cachedSecret;
  }

  const row = db
    .prepare("SELECT value FROM clinic_settings WHERE key = 'session_secret'")
    .get();
  if (row?.value) {
    cachedSecret = row.value;
    return cachedSecret;
  }

  const generated = crypto.randomBytes(32).toString('hex');
  db.prepare(
    `INSERT INTO clinic_settings (key, value) VALUES ('session_secret', ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(generated);
  cachedSecret = generated;
  return cachedSecret;
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, originalHex] = storedHash.split(':');
  const derived = crypto.scryptSync(String(password), salt, 64);
  const original = Buffer.from(originalHex, 'hex');
  if (derived.length !== original.length) return false;
  return crypto.timingSafeEqual(derived, original);
}

function base64UrlEncode(str) {
  return Buffer.from(str, 'utf8').toString('base64url');
}

function base64UrlDecode(str) {
  return Buffer.from(str, 'base64url').toString('utf8');
}

export function createSessionToken(user) {
  const payload = {
    uid: user.id,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const encoded = base64UrlEncode(JSON.stringify(payload));
  const sig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || !token.includes('.')) return null;
  const [encoded, sig] = token.split('.');
  const expectedSig = crypto
    .createHmac('sha256', getSessionSecret())
    .update(encoded)
    .digest('base64url');

  const sigBuf = Buffer.from(sig);
  const expBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encoded));
    if (!payload.uid || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(req) {
  const header = req.headers.cookie || '';
  const cookies = {};
  header.split(';').forEach((part) => {
    const idx = part.indexOf('=');
    if (idx === -1) return;
    const key = part.slice(0, idx).trim();
    const val = part.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(val);
  });
  return cookies;
}

export function setSessionCookie(res, token) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`
  );
}

export function clearSessionCookie(res) {
  res.setHeader(
    'Set-Cookie',
    `${COOKIE_NAME}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`
  );
}

export function getUserById(id) {
  return db
    .prepare(
      `SELECT u.id, u.username, u.nombre, u.rol, u.profesional_id, u.activo, u.created_at,
              p.nombre AS profesional_nombre, p.google_calendar_id AS profesional_calendar_id,
              p.consultorio AS profesional_consultorio
       FROM usuarios u
       LEFT JOIN profesionales p ON p.id = u.profesional_id
       WHERE u.id = ?`
    )
    .get(Number(id));
}

export function authenticateUser(username, password) {
  const cleanUser = String(username || '').trim().toLowerCase();
  if (!cleanUser || !password) return null;

  const row = db
    .prepare('SELECT * FROM usuarios WHERE LOWER(username) = ? AND activo = 1')
    .get(cleanUser);
  if (!row) return null;
  if (!verifyPassword(password, row.password_hash)) return null;
  return getUserById(row.id);
}

export function getRequestUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[COOKIE_NAME];
  const payload = verifySessionToken(token);
  if (!payload) return null;
  const user = getUserById(payload.uid);
  if (!user || !user.activo) return null;
  return user;
}

export function requireAuth(req, res, next) {
  const user = getRequestUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Necesitás iniciar sesión para acceder.' });
  }
  req.user = user;
  next();
}

export function requireAdmin(req, res, next) {
  if (!req.user || req.user.rol !== 'admin') {
    return res.status(403).json({
      error: 'Solo el Administrador General puede realizar esta acción.',
    });
  }
  next();
}
