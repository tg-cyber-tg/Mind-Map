/*
 * Mappe Mentali – app installabile (PWA): manifest, service worker, aggiornamenti
 * e installazione. Funziona solo da un indirizzo web (https:// o http://localhost):
 * aprendo index.html con un doppio clic (file://) non fa nulla, così in console
 * non compaiono errori e l'app funziona come sempre.
 */
(function (root) {
  'use strict';
  var MM = root.MM;

  var app = null;
  var deferredPrompt = null;     // evento beforeinstallprompt (Chrome/Edge)
  var registration = null;
  var updateShown = false;
  var reloading = false;

  function nav() { return root.navigator || {}; }

  /** true solo da http(s) in un contesto sicuro, con service worker disponibili. */
  function isSupported() {
    var p = root.location && root.location.protocol;
    return (p === 'https:' || p === 'http:') && !!root.isSecureContext && 'serviceWorker' in nav();
  }

  /** true se l'app è aperta come app installata (finestra propria). */
  function isInstalled() {
    var standalone = false;
    try {
      standalone = root.matchMedia('(display-mode: standalone)').matches ||
        root.matchMedia('(display-mode: window-controls-overlay)').matches;
    } catch (e) { standalone = false; }
    return standalone || nav().standalone === true;
  }

  /** 'ipad' | 'safari-mac' | 'chromium' | 'altro' (serve solo per le istruzioni). */
  function platform() {
    var ua = nav().userAgent || '';
    var touchMac = /Macintosh/.test(ua) && nav().maxTouchPoints > 1;
    if (/iPad|iPhone|iPod/.test(ua) || touchMac) return 'ipad';
    var otherEngine = /Chrome|Chromium|CriOS|Edg|FxiOS|Firefox|OPR/.test(ua);
    if (/Safari/.test(ua) && !otherEngine) return 'safari-mac';
    if (/Chrome|Chromium|Edg/.test(ua)) return 'chromium';
    return 'altro';
  }

  /** Testo che spiega come installare l'app nel browser in uso. */
  function installHelp() {
    if (!isSupported()) {
      return 'Per installarla come app, aprila dal suo indirizzo web (ad esempio la pagina GitHub Pages): ' +
        'aperta con un doppio clic sul file funziona, ma non si può installare.';
    }
    if (isInstalled()) return 'Stai usando l\'app installata: funziona anche senza internet. ✅';
    if (deferredPrompt) return 'Puoi installarla: avrà la sua icona e funzionerà anche senza internet.';
    switch (platform()) {
      case 'ipad': return 'Su iPad: tocca Condividi (il quadrato con la freccia) → “Aggiungi alla schermata Home”.';
      case 'safari-mac': return 'In Safari sul Mac: menu File → “Aggiungi al Dock”.';
      case 'chromium': return 'In Chrome/Edge: clicca l\'icona di installazione nella barra degli indirizzi ' +
        '(oppure menu ⋮ → Trasmetti, salva e condividi → Installa pagina come app).';
      default: return 'Questo browser potrebbe non permettere l\'installazione: prova con Chrome, Edge o Safari.';
    }
  }

  /** Aggiorna il riquadro "Usala come app" nella finestra Aiuto. */
  function refreshHelp() {
    var info = document.getElementById('pwa-stato');
    if (info) info.textContent = installHelp();
    var btn = document.getElementById('btn-installa');
    if (btn) btn.hidden = !deferredPrompt || isInstalled();
  }

  /** Avvia l'installazione (Chrome/Edge) o mostra le istruzioni (Safari, iPad). */
  function promptInstall() {
    if (!deferredPrompt) {
      if (MM.ui) MM.ui.toast(installHelp());
      return Promise.resolve(false);
    }
    var ev = deferredPrompt;
    deferredPrompt = null;
    ev.prompt();
    return ev.userChoice.then(function (choice) {
      refreshHelp();
      return !!choice && choice.outcome === 'accepted';
    });
  }

  function addManifestLink() {
    if (document.querySelector('link[rel="manifest"]')) return;
    var link = document.createElement('link');
    link.rel = 'manifest';
    link.href = 'manifest.webmanifest';
    document.head.appendChild(link);
  }

  /** Avviso "nuova versione" con il pulsante Aggiorna (una volta sola). */
  function showUpdate(worker) {
    if (updateShown || !worker || !MM.ui) return;
    updateShown = true;
    MM.ui.toast('È disponibile una nuova versione dell\'app', 'info', {
      label: 'Aggiorna',
      persistent: true,
      onClick: function () {
        if (app) app.saveNow();
        reloading = true;
        worker.postMessage({ type: 'SKIP_WAITING' });
      }
    });
  }

  function watchUpdates(reg) {
    var sw = nav().serviceWorker;
    // Una nuova versione era già pronta (es. scaricata durante la visita precedente).
    if (reg.waiting && sw.controller) showUpdate(reg.waiting);
    reg.addEventListener('updatefound', function () {
      var w = reg.installing;
      if (!w) return;
      w.addEventListener('statechange', function () {
        // Con un controller attivo è un aggiornamento; senza, è la prima installazione.
        if (w.state === 'installed' && sw.controller) showUpdate(w);
      });
    });
    // Quando la nuova versione prende il controllo si ricarica (solo dopo "Aggiorna").
    sw.addEventListener('controllerchange', function () {
      if (!reloading) return;
      reloading = false;
      root.location.reload();
    });
  }

  function init(appApi) {
    app = appApi || null;
    root.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();          // niente banner automatico: si installa dal pulsante
      deferredPrompt = e;
      refreshHelp();
    });
    root.addEventListener('appinstalled', function () {
      deferredPrompt = null;
      refreshHelp();
      if (MM.ui) MM.ui.toast('App installata! La trovi tra le tue applicazioni', 'successo');
    });
    var btn = document.getElementById('btn-installa');
    if (btn) btn.addEventListener('click', function () { promptInstall(); });
    refreshHelp();
    if (!isSupported()) return Promise.resolve(null);

    addManifestLink();
    return nav().serviceWorker.register('sw.js').then(function (reg) {
      registration = reg;
      watchUpdates(reg);
      // Controllo periodico degli aggiornamenti per chi tiene l'app aperta a lungo.
      setInterval(function () { reg.update().catch(function () { /* offline */ }); }, 60 * 60 * 1000);
      return reg;
    }).catch(function (e) {
      if (root.console) root.console.warn('Service worker non registrato:', e);
      return null;
    });
  }

  MM.pwa = {
    isSupported: isSupported,
    isInstalled: isInstalled,
    installHelp: installHelp,
    promptInstall: promptInstall,
    refreshHelp: refreshHelp,
    init: init,
    getRegistration: function () { return registration; }
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

