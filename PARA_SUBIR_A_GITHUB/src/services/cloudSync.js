import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import pg from 'pg';
import { config } from '../config.js';

const { Client } = pg;

const CREATE_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS turnero_cloud_snapshots (
    slot TEXT PRIMARY KEY,
    db_gzip BYTEA NOT NULL,
    raw_sha256 TEXT NOT NULL,
    gzip_sha256 TEXT NOT NULL,
    raw_bytes INTEGER NOT NULL,
    gzip_bytes INTEGER NOT NULL,
    reason TEXT NOT NULL DEFAULT '',
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );
`;

const state = {
  configured: false,
  status: 'disabled', // disabled | pending | syncing | synced | error
  restoredOnBoot: false,
  needsInitialSync: false,
  lastSyncedAt: null,
  lastSyncedRawSha: null,
  lastSyncedBytes: 0,
  lastError: null,
  syncCount: 0,
};

let dbRef = null;
let dirty = false;
let debounceTimer = null;
let syncInFlight = null;
let syncRequestedAgain = false;
let shutdownHookInstalled = false;
let periodicTimer = null;

function getConnectionString() {
  const raw = String(process.env.CLOUD_DB_URL || process.env.DATABASE_URL || '').trim();
  if (!raw) return '';
  try {
    const parsed = new URL(raw);
    // Evitar problemas de compatibilidad con channel_binding=require en algunos clientes Node
    if (parsed.searchParams.get('channel_binding') === 'require') {
      parsed.searchParams.delete('channel_binding');
    }
    return parsed.toString();
  } catch {
    return raw;
  }
}

export function isCloudDbConfigured() {
  return Boolean(getConnectionString());
}

export function getCloudSyncStatus() {
  const configured = isCloudDbConfigured();
  return {
    configured,
    status: configured ? state.status : 'disabled',
    restoredOnBoot: state.restoredOnBoot,
    lastSyncedAt: state.lastSyncedAt,
    lastSyncedBytes: state.lastSyncedBytes,
    lastError: state.lastError,
    syncCount: state.syncCount,
    dirty,
  };
}

function sha256Hex(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function withPgClient(fn) {
  const connectionString = getConnectionString();
  if (!connectionString) {
    throw new Error('CLOUD_DB_URL no configurada.');
  }

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 20000,
    query_timeout: 30000,
  });

  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

function removeWalFiles(dbPath) {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const p = `${dbPath}${suffix}`;
    try {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    } catch {
      // ignore
    }
  }
}

/**
 * Debe ejecutarse ANTES de importar src/db/database.js (antes de abrir SQLite).
 * Si existe un respaldo en Neon, lo descarga y restaura atómicamente en config.dbPath.
 */
export async function restoreDatabaseFromCloudIfNeeded() {
  state.configured = isCloudDbConfigured();
  if (!state.configured) {
    state.status = 'disabled';
    return { configured: false, restored: false };
  }

  fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

  try {
    const result = await withPgClient(async (client) => {
      await client.query(CREATE_TABLE_SQL);
      const { rows } = await client.query(
        `SELECT db_gzip, raw_sha256, gzip_sha256, raw_bytes, gzip_bytes, updated_at
         FROM turnero_cloud_snapshots
         WHERE slot = 'latest'
         LIMIT 1`
      );
      return rows[0] || null;
    });

    if (!result || !result.db_gzip) {
      state.status = 'pending';
      state.needsInitialSync = true;
      state.restoredOnBoot = false;
      console.log('☁️ Base en la Nube (Neon): conectada (sin snapshot previo todavía; se guardará al iniciar).');
      return { configured: true, restored: false, empty: true };
    }

    const gzipBuf = Buffer.isBuffer(result.db_gzip)
      ? result.db_gzip
      : Buffer.from(result.db_gzip);

    const actualGzipSha = sha256Hex(gzipBuf);
    if (result.gzip_sha256 && actualGzipSha !== result.gzip_sha256) {
      throw new Error('Checksum gzip inválido al restaurar desde Neon.');
    }

    const rawBuf = zlib.gunzipSync(gzipBuf);
    const actualRawSha = sha256Hex(rawBuf);
    if (result.raw_sha256 && actualRawSha !== result.raw_sha256) {
      throw new Error('Checksum SQLite inválido al restaurar desde Neon.');
    }

    const magic = rawBuf.subarray(0, 16).toString('utf8');
    if (magic !== 'SQLite format 3\u0000') {
      throw new Error('El snapshot descargado no tiene encabezado válido de SQLite.');
    }

    const tmpPath = `${config.dbPath}.restore.tmp`;
    fs.writeFileSync(tmpPath, rawBuf);
    removeWalFiles(config.dbPath);
    fs.renameSync(tmpPath, config.dbPath);

    state.status = 'synced';
    state.restoredOnBoot = true;
    state.needsInitialSync = false;
    state.lastSyncedRawSha = actualRawSha;
    state.lastSyncedBytes = gzipBuf.length;
    state.lastSyncedAt = result.updated_at
      ? new Date(result.updated_at).toISOString()
      : new Date().toISOString();
    state.lastError = null;

    const kb = (gzipBuf.length / 1024).toFixed(1);
    console.log(
      `☁️ Base de datos restaurada desde Neon (${kb} KB comprimidos, última copia: ${state.lastSyncedAt}).`
    );
    return { configured: true, restored: true, updatedAt: state.lastSyncedAt };
  } catch (err) {
    state.status = 'error';
    state.lastError = err.message;
    console.error(`⚠️ Error restaurando base desde Neon (se continúa con disco local): ${err.message}`);
    return { configured: true, restored: false, error: err.message };
  }
}

function createAtomicSqliteSnapshotBuffer(dbInstance) {
  fs.mkdirSync(config.dataDir, { recursive: true });
  const tmpName = `.cloud-sync-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.db`;
  const tmpPath = path.join(config.dataDir, tmpName);
  const sqlEscaped = tmpPath.replace(/'/g, "''");

  try {
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    dbInstance.exec(`VACUUM INTO '${sqlEscaped}'`);
    return fs.readFileSync(tmpPath);
  } finally {
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch {
      // ignore
    }
  }
}

async function performSyncOnce(reason = 'auto', { force = false } = {}) {
  if (!isCloudDbConfigured() || !dbRef) {
    return { skipped: true };
  }

  state.status = 'syncing';
  try {
    const rawBuf = createAtomicSqliteSnapshotBuffer(dbRef);
    const rawSha = sha256Hex(rawBuf);

    if (!force && state.lastSyncedRawSha && rawSha === state.lastSyncedRawSha) {
      dirty = false;
      state.status = 'synced';
      state.lastError = null;
      return { skipped: true, unchanged: true };
    }

    const gzipBuf = zlib.gzipSync(rawBuf, { level: 6 });
    const gzipSha = sha256Hex(gzipBuf);

    const updatedAt = await withPgClient(async (client) => {
      await client.query(CREATE_TABLE_SQL);
      await client.query('BEGIN');
      try {
        await client.query(`
          INSERT INTO turnero_cloud_snapshots (slot, db_gzip, raw_sha256, gzip_sha256, raw_bytes, gzip_bytes, reason, updated_at)
          SELECT 'previous', db_gzip, raw_sha256, gzip_sha256, raw_bytes, gzip_bytes, reason, updated_at
          FROM turnero_cloud_snapshots
          WHERE slot = 'latest'
          ON CONFLICT (slot) DO UPDATE SET
            db_gzip = EXCLUDED.db_gzip,
            raw_sha256 = EXCLUDED.raw_sha256,
            gzip_sha256 = EXCLUDED.gzip_sha256,
            raw_bytes = EXCLUDED.raw_bytes,
            gzip_bytes = EXCLUDED.gzip_bytes,
            reason = EXCLUDED.reason,
            updated_at = EXCLUDED.updated_at
        `);

        const { rows } = await client.query(
          `INSERT INTO turnero_cloud_snapshots (slot, db_gzip, raw_sha256, gzip_sha256, raw_bytes, gzip_bytes, reason, updated_at)
           VALUES ('latest', $1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (slot) DO UPDATE SET
             db_gzip = EXCLUDED.db_gzip,
             raw_sha256 = EXCLUDED.raw_sha256,
             gzip_sha256 = EXCLUDED.gzip_sha256,
             raw_bytes = EXCLUDED.raw_bytes,
             gzip_bytes = EXCLUDED.gzip_bytes,
             reason = EXCLUDED.reason,
             updated_at = NOW()
           RETURNING updated_at`,
          [gzipBuf, rawSha, gzipSha, rawBuf.length, gzipBuf.length, String(reason || 'auto').slice(0, 120)]
        );
        await client.query('COMMIT');
        return rows[0]?.updated_at || new Date();
      } catch (txErr) {
        await client.query('ROLLBACK').catch(() => {});
        throw txErr;
      }
    });

    dirty = false;
    state.status = 'synced';
    state.needsInitialSync = false;
    state.lastSyncedRawSha = rawSha;
    state.lastSyncedBytes = gzipBuf.length;
    state.lastSyncedAt = new Date(updatedAt).toISOString();
    state.lastError = null;
    state.syncCount += 1;

    const kb = (gzipBuf.length / 1024).toFixed(1);
    console.log(`☁️ Base respaldada en Neon (${kb} KB, motivo: ${reason}).`);
    return {
      synced: true,
      bytes: gzipBuf.length,
      updatedAt: state.lastSyncedAt,
    };
  } catch (err) {
    state.status = 'error';
    state.lastError = err.message;
    console.error(`⚠️ Error respaldando base en Neon (${reason}): ${err.message}`);
    return { synced: false, error: err.message };
  }
}

export async function syncDatabaseToCloudNow(reason = 'manual', options = {}) {
  if (!isCloudDbConfigured() || !dbRef) {
    return { skipped: true };
  }

  if (debounceTimer) {
    clearTimeout(debounceTimer);
    debounceTimer = null;
  }

  if (syncInFlight) {
    syncRequestedAgain = true;
    await syncInFlight;
    if (syncRequestedAgain) {
      syncRequestedAgain = false;
      return syncDatabaseToCloudNow(reason, options);
    }
    return { synced: true, coalesced: true };
  }

  syncInFlight = performSyncOnce(reason, options);
  try {
    const res = await syncInFlight;
    return res;
  } finally {
    syncInFlight = null;
    if (syncRequestedAgain) {
      syncRequestedAgain = false;
      scheduleCloudSync('queued-change', 800);
    }
  }
}

export function scheduleCloudSync(reason = 'write', delayMs = 2500) {
  if (!isCloudDbConfigured() || !dbRef) return;
  dirty = true;
  if (state.status !== 'syncing') {
    state.status = 'pending';
  }
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    syncDatabaseToCloudNow(reason).catch(() => {});
  }, delayMs);
  if (typeof debounceTimer.unref === 'function') {
    debounceTimer.unref();
  }
}

export function attachDatabaseForCloudSync(dbInstance) {
  dbRef = dbInstance;
  state.configured = isCloudDbConfigured();
  if (!state.configured) return;

  if (state.needsInitialSync) {
    scheduleCloudSync('initial-seed', 2000);
  }

  if (!periodicTimer) {
    periodicTimer = setInterval(() => {
      if (dirty && !syncInFlight) {
        syncDatabaseToCloudNow('periodic-flush').catch(() => {});
      }
    }, 60 * 1000);
    if (typeof periodicTimer.unref === 'function') {
      periodicTimer.unref();
    }
  }

  if (!shutdownHookInstalled) {
    shutdownHookInstalled = true;
    const handleSignal = async (sig) => {
      console.log(`☁️ Señal ${sig} recibida — asegurando copia final en Neon...`);
      try {
        if (dirty || syncInFlight || state.needsInitialSync) {
          await syncDatabaseToCloudNow(`shutdown-${sig}`);
        }
      } catch {
        // ignore
      }
      process.exit(0);
    };
    process.on('SIGTERM', () => handleSignal('SIGTERM'));
    process.on('SIGINT', () => handleSignal('SIGINT'));
  }
}

/**
 * Middleware Express: tras cualquier escritura exitosa (POST/PUT/PATCH/DELETE < 400),
 * programa la sincronización automática hacia Neon.
 */
export function cloudSyncWriteMiddleware(req, res, next) {
  const method = String(req.method || '').toUpperCase();
  const isWrite = method === 'POST' || method === 'PUT' || method === 'PATCH' || method === 'DELETE';
  if (!isWrite || !isCloudDbConfigured()) {
    return next();
  }

  // Rutas que no modifican la base de datos
  const skipPaths = new Set(['/auth/login', '/auth/logout', '/admin/cloud-sync']);
  if (skipPaths.has(req.path)) {
    return next();
  }

  res.on('finish', () => {
    if (res.statusCode >= 200 && res.statusCode < 400) {
      scheduleCloudSync(`${method} ${req.path}`);
    }
  });

  next();
}
