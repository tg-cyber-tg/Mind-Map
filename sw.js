/*
 * Mappe Mentali – service worker (app installabile e funzionamento offline).
 * Strategia "prima la cache, poi la rete" per i file dell'app.
 * AD OGNI RILASCIO: incrementare CACHE_VERSION, altrimenti chi ha l'app
 * installata continua a vedere la versione vecchia.
 * Le mappe NON stanno qui: sono nel localStorage del browser.
 */
'use strict';

var CACHE_VERSION = 'mm-v1';

// Tutti i file necessari per funzionare senza internet (percorsi relativi a sw.js).
var PRECACHE = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'css/print.css',
  'js/namespace.js',
  'js/model.js',
  'js/history.js',
  'js/storage.js',
  'js/layout.js',
  'js/viewport.js',
  'js/renderer.js',
  'js/speech.js',
  'js/templates.js',
  'js/exporter.js',
  'js/interactions.js',
  'js/ui.js',
  'js/pwa.js',
  'js/app.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png'
];

self.addEventListener('install', function (event) {
  // cache: 'reload' evita di precaricare copie vecchie dalla cache HTTP del browser.
  event.waitUntil(caches.open(CACHE_VERSION).then(function (cache) {
    return cache.addAll(PRECACHE.map(function (url) { return new Request(url, { cache: 'reload' }); }));
  }));
  // Nessun skipWaiting automatico: la nuova versione si attiva quando l'utente sceglie "Aggiorna".
});

self.addEventListener('activate', function (event) {
  event.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) {
      return k.indexOf('mm-') === 0 && k !== CACHE_VERSION;
    }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('message', function (event) {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (event) {
  var req = event.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;   // solo file della stessa origine

  var isPage = req.mode === 'navigate';
  event.respondWith(caches.open(CACHE_VERSION).then(function (cache) {
    return cache.match(req, { ignoreSearch: isPage }).then(function (hit) {
      if (hit) return hit;
      return fetch(req).then(function (res) {
        // Si conservano solo i file dell'app (non le pagine extra, es. i test).
        if (!isPage && res && res.ok && res.type === 'basic') cache.put(req, res.clone());
        return res;
      }).catch(function (err) {
        // Senza internet una pagina sconosciuta (es. "./?qualcosa") apre comunque l'app.
        if (isPage) return cache.match('index.html');
        throw err;
      });
    });
  }));
});
