import { restoreDatabaseFromCloudIfNeeded } from './services/cloudSync.js';

// Si CLOUD_DB_URL está configurada (ej. Neon en Render), restaura turnero.db ANTES de abrir SQLite
await restoreDatabaseFromCloudIfNeeded();

// Arrancar la aplicación principal con la base ya restaurada
await import('./app.js');
