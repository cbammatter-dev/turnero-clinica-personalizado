(function initPwaInstall() {
  // Registrar Service Worker para habilitar instalación nativa en Android / Chrome / Edge
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => {});
  }

  // Si ya está abierta como App instalada, no mostrar cartel de instalación
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (isStandalone) return;

  const ua = navigator.userAgent || '';
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  let deferredPrompt = null;

  function createInstallBanner({ text, buttonLabel, onAction }) {
    if (document.getElementById('pwaInstallBanner')) return;
    if (sessionStorage.getItem('pwa_banner_dismissed') === '1') return;

    const bar = document.createElement('div');
    bar.id = 'pwaInstallBanner';
    bar.style.cssText = [
      'position:sticky',
      'top:0',
      'z-index:80',
      'background:linear-gradient(90deg,#0f766e,#0d9488)',
      'color:#ffffff',
      'padding:10px 14px',
      'display:flex',
      'align-items:center',
      'justify-content:space-between',
      'gap:10px',
      'flex-wrap:wrap',
      'font-size:13px',
      'box-shadow:0 3px 12px rgba(0,0,0,0.14)',
    ].join(';');

    bar.innerHTML = `
      <div style="display:flex; align-items:center; gap:8px; flex:1; min-width:200px;">
        <img src="/icons/icon-192.png" alt="App" style="width:30px; height:30px; border-radius:8px; border:1px solid rgba(255,255,255,0.4);" />
        <span>${text}</span>
      </div>
      <div style="display:flex; align-items:center; gap:6px;">
        ${
          buttonLabel
            ? `<button type="button" id="pwaInstallActionBtn" style="background:#ffffff; color:#0f766e; border:none; border-radius:8px; padding:7px 12px; font-weight:700; font-size:13px; cursor:pointer;">${buttonLabel}</button>`
            : ''
        }
        <button type="button" id="pwaDismissBtn" style="background:rgba(255,255,255,0.2); color:#fff; border:none; border-radius:8px; padding:6px 9px; font-size:13px; cursor:pointer;" title="Cerrar">✕</button>
      </div>
    `;

    document.body.prepend(bar);

    document.getElementById('pwaDismissBtn')?.addEventListener('click', () => {
      sessionStorage.setItem('pwa_banner_dismissed', '1');
      bar.remove();
    });

    if (onAction) {
      document.getElementById('pwaInstallActionBtn')?.addEventListener('click', onAction);
    }
  }

  // Android / Chrome / Edge: evento nativo de instalación
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;

    createInstallBanner({
      text: '<strong>📲 Instalá nuestra App de Turnos</strong> en tu celular (Gratis, sin ocupar espacio)',
      buttonLabel: '📲 Instalar App',
      onAction: async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        const choice = await deferredPrompt.userChoice;
        if (choice?.outcome === 'accepted') {
          document.getElementById('pwaInstallBanner')?.remove();
        }
        deferredPrompt = null;
      },
    });
  });

  // iPhone / iPad Safari: mostrar guía simple de 1 línea
  if (isIOS) {
    window.addEventListener('load', () => {
      createInstallBanner({
        text: '<strong>📲 Instalá la App en tu iPhone:</strong> tocá el ícono <strong>Compartir (⬆️)</strong> abajo y elegí <strong>"Agregar a inicio"</strong>.',
        buttonLabel: '',
        onAction: null,
      });
    });
  }
})();
