const CACHE_NAME = 'turnero-clinica-v2';
const STATIC_ASSETS = [
  '/css/styles.css',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Estrategia Network-First: las APIs y turnos siempre van directo al servidor
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && (url.pathname.startsWith('/icons/') || url.pathname.startsWith('/css/'))) {
          const clone = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, clone)).catch(() => {});
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        return new Response(
          '<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sin conexión</title></head><body style="font-family:sans-serif;text-align:center;padding:40px;background:#f8fafc;color:#0f172a;"><h2>📡 No se pudo conectar con el servidor</h2><p>Verificá tu conexión a internet o que el servidor del turnero esté encendido y volvé a intentar.</p><button onclick="location.reload()" style="padding:12px 22px;border:none;border-radius:10px;background:#0f766e;color:#fff;font-size:16px;font-weight:600;cursor:pointer;">Reintentar</button></body></html>',
          { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
        );
      })
  );
});
