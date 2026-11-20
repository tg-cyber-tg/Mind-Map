/*
 * Mappe Mentali – sincronizzazione cloud in tempo reale (Mac ↔ iPad) con Firebase.
 * Architettura offline-first:
 *   - localStorage resta sempre la memoria immediata (funziona offline e su file://).
 *   - Su http(s): con configurazione Firebase valida, carica dinamicamente Firebase
 *     Compat (Auth + Firestore) senza bundler né moduli ES.
 *   - Ogni utente sincronizza le proprie mappe su users/{uid}/maps/{mapId}.
 *   - Le eliminazioni usano un tombstone (deletedAt) così una mappa eliminata su un
 *     dispositivo non "risorge" quando un altro dispositivo torna online.
 */
(function (root) {
  'use strict';
  var MM = root.MM;

  var CONFIG_KEY = 'mm:firebase-config';
  var QUEUE_KEY = 'mm:sync-queue';
  var DELETED_KEY = 'mm:sync-deleted';
  var SDK_VERSION = '10.14.1';
  var SDK_BASE = 'https://www.gstatic.com/firebasejs/' + SDK_VERSION + '/';
  var PUSH_DEBOUNCE = 800;

  var appApi = null;
  var listeners = [];
  var sdkPromise = null;
  var fbApp = null;
  var auth = null;
  var db = null;
  var unsubSnapshot = null;
  var pushTimers = {};
  var state = {
    status: 'unconfigured', // unconfigured | signed-out | connecting | synced | syncing | offline | error
    user: null,             // { uid, email, displayName }
    lastSyncAt: null,
    error: null,
    configSource: null      // 'file' | 'local' | null
  };

  /* ---------- Helper pure (testabili senza rete) ---------- */

  function isValidConfig(cfg) {
    return !!cfg && typeof cfg === 'object' &&
      typeof cfg.apiKey === 'string' && cfg.apiKey.trim().length > 5 &&
      typeof cfg.authDomain === 'string' && cfg.authDomain.trim().length > 3 &&
      typeof cfg.projectId === 'string' && cfg.projectId.trim().length > 1;
  }

  /**
   * Accetta sia JSON puro che uno snippet JS copiato dalla console Firebase
   * (es. `const firebaseConfig = { apiKey: "...", ... };`).
   */
  function parseConfig(input) {
    if (isValidConfig(input)) return normalizeConfig(input);
    var text = String(input || '').trim();
    if (!text) return null;
    // Estrae il primo blocco { ... } se l'utente ha incollato l'intero snippet JS.
    var start = text.indexOf('{');
    var end = text.lastIndexOf('}');
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
    var parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      // Converte chiavi JS non quotate e apici singoli in JSON valido.
      try {
        var jsonish = text
          .replace(/\/\/[^\n]*/g, '')
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/([{,]\s*)([a-zA-Z0-9_]+)\s*:/g, '$1"$2":')
          .replace(/'([^']*)'/g, '"$1"')
          .replace(/,\s*}/g, '}');
        parsed = JSON.parse(jsonish);
      } catch (e2) {
        return null;
      }
    }
    return isValidConfig(parsed) ? normalizeConfig(parsed) : null;
  }

  function normalizeConfig(c) {
    var out = {
      apiKey: String(c.apiKey).trim(),
      authDomain: String(c.authDomain).trim(),
      projectId: String(c.projectId).trim()
    };
    if (c.appId) out.appId = String(c.appId).trim();
    if (c.storageBucket) out.storageBucket = String(c.storageBucket).trim();
    if (c.messagingSenderId) out.messagingSenderId = String(c.messagingSenderId).trim();
    return out;
  }

  /**
   * Logica pura di riconciliazione tra mappe locali, documenti remoti Firestore e
   * eliminazioni locali in sospeso (tombstones: { [mapId]: deletedAtIso }).
   *
   * Restituisce un piano d'azioni deterministico:
   * - toUpload:      MindMap[]     (da scrivere su Firestore)
   * - toDeleteCloud: {id, deletedAt}[] (tombstone da scrivere su Firestore)
   * - toSaveLocal:   MindMap[]     (da salvare in localStorage)
   * - toDeleteLocal: string[]      (id da rimuovere da localStorage)
   */
  function reconcile(localMaps, remoteDocs, localDeleted) {
    var localById = {};
    (localMaps || []).forEach(function (m) { if (m && m.id) localById[m.id] = m; });
    var remoteById = {};
    (remoteDocs || []).forEach(function (r) { if (r && r.id) remoteById[r.id] = r; });
    var deleted = localDeleted || {};

    var allIds = {};
    Object.keys(localById).forEach(function (id) { allIds[id] = true; });
    Object.keys(remoteById).forEach(function (id) { allIds[id] = true; });
    Object.keys(deleted).forEach(function (id) { allIds[id] = true; });

    var toUpload = [];
    var toDeleteCloud = [];
    var toSaveLocal = [];
    var toDeleteLocal = [];

    Object.keys(allIds).forEach(function (id) {
      var loc = localById[id] || null;
      var rem = remoteById[id] || null;
      var locDelAt = deleted[id] || null;
      var remDelAt = rem && rem.deletedAt ? rem.deletedAt : null;
      var remData = rem && !remDelAt && rem.data ? rem.data : null;
      var remTime = rem ? (rem.updatedAt || (remData && remData.updatedAt) || remDelAt || '') : '';
      var locTime = loc ? (loc.updatedAt || '') : '';

      // 1. Esiste un'eliminazione locale in sospeso (più recente di eventuale mappa locale).
      if (locDelAt && (!loc || locDelAt >= locTime)) {
        if (!rem || (!remDelAt && locDelAt >= remTime)) {
          toDeleteCloud.push({ id: id, deletedAt: locDelAt });
        } else if (remData && remTime > locDelAt) {
          toSaveLocal.push(remData);
        }
        return;
      }

      // 2. Il cloud segnala la mappa come eliminata.
      if (remDelAt) {
        if (loc && locTime > remDelAt) {
          // Modificata localmente dopo l'eliminazione: ripristina sul cloud.
          toUpload.push(loc);
        } else if (loc) {
          toDeleteLocal.push(id);
        }
        return;
      }

      // 3. Mappa presente solo in locale -> carica su cloud.
      if (loc && !remData) {
        toUpload.push(loc);
        return;
      }

      // 4. Mappa presente solo sul cloud -> salva in locale.
      if (!loc && remData) {
        toSaveLocal.push(remData);
        return;
      }

      // 5. Presente su entrambi: vince updatedAt più recente.
      if (loc && remData) {
        if (locTime > remTime) toUpload.push(loc);
        else if (remTime > locTime) toSaveLocal.push(remData);
      }
    });

    return {
      toUpload: toUpload,
      toDeleteCloud: toDeleteCloud,
      toSaveLocal: toSaveLocal,
      toDeleteLocal: toDeleteLocal
    };
  }

  /* ---------- Persistenza configurazione e coda offline ---------- */

  function readJson(key, fallback) {
    try {
      var raw = root.localStorage && root.localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }

  function writeJson(key, val) {
    try {
      if (!root.localStorage) return;
      if (val === null || val === undefined) root.localStorage.removeItem(key);
      else root.localStorage.setItem(key, JSON.stringify(val));
    } catch (e) { /* ignora in modalità privata */ }
  }

  function getConfig() {
    if (isValidConfig(MM.firebaseConfig)) {
      state.configSource = 'file';
      return normalizeConfig(MM.firebaseConfig);
    }
    var saved = readJson(CONFIG_KEY, null);
    if (isValidConfig(saved)) {
      state.configSource = 'local';
      return normalizeConfig(saved);
    }
    state.configSource = null;
    return null;
  }

  function saveConfig(rawInput) {
    var cfg = parseConfig(rawInput);
    if (!cfg) throw new Error('Configurazione Firebase non valida: servono almeno apiKey, authDomain e projectId');
    writeJson(CONFIG_KEY, cfg);
    state.configSource = 'local';
    return setupFirebase(cfg);
  }

  function clearConfig() {
    writeJson(CONFIG_KEY, null);
    if (auth && state.user) { try { auth.signOut(); } catch (e) {} }
    stopSnapshot();
    setState({ status: getConfig() ? 'signed-out' : 'unconfigured', user: null, error: null });
  }

  function getQueue() { return readJson(QUEUE_KEY, {}); }
  function setQueue(q) { writeJson(QUEUE_KEY, q); }
  function getDeletedMap() { return readJson(DELETED_KEY, {}); }
  function setDeletedMap(d) { writeJson(DELETED_KEY, d); }

  function enqueue(mapId, kind) {
    var q = getQueue();
    q[mapId] = { kind: kind, at: MM.model.nowIso() };
    setQueue(q);
  }

  function dequeue(mapId) {
    var q = getQueue();
    if (q[mapId]) { delete q[mapId]; setQueue(q); }
  }

  /* ---------- Stato e notifiche ---------- */

  function setState(patch) {
    Object.keys(patch).forEach(function (k) { state[k] = patch[k]; });
    var snap = getState();
    listeners.forEach(function (cb) { try { cb(snap); } catch (e) {} });
  }

  function getState() {
    return {
      status: state.status,
      user: state.user ? { uid: state.user.uid, email: state.user.email, displayName: state.user.displayName } : null,
      lastSyncAt: state.lastSyncAt,
      error: state.error,
      configSource: state.configSource,
      supported: isSupported()
    };
  }

  function onStatusChange(cb) {
    listeners.push(cb);
    cb(getState());
  }

  function isSupported() {
    return typeof location !== 'undefined' && (location.protocol === 'http:' || location.protocol === 'https:');
  }

  /* ---------- Caricamento dinamico SDK Firebase Compat ---------- */

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = false;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('Impossibile caricare Firebase (controlla la connessione)')); };
      document.head.appendChild(s);
    });
  }

  function loadFirebaseSDK() {
    if (root.firebase && root.firebase.auth && root.firebase.firestore) return Promise.resolve(root.firebase);
    if (sdkPromise) return sdkPromise;
    sdkPromise = loadScript(SDK_BASE + 'firebase-app-compat.js')
      .then(function () { return loadScript(SDK_BASE + 'firebase-auth-compat.js'); })
      .then(function () { return loadScript(SDK_BASE + 'firebase-firestore-compat.js'); })
      .then(function () {
        if (!root.firebase || !root.firebase.auth || !root.firebase.firestore) {
          throw new Error('SDK Firebase incompleto');
        }
        return root.firebase;
      })
      .catch(function (err) {
        sdkPromise = null;
        throw err;
      });
    return sdkPromise;
  }

  function setupFirebase(cfg) {
    if (!isSupported()) {
      setState({ status: 'unconfigured', error: null });
      return Promise.resolve(false);
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      setState({ status: 'offline', error: null });
      return Promise.resolve(false);
    }
    setState({ status: 'connecting', error: null });
    return loadFirebaseSDK().then(function (firebase) {
      if (!firebase.apps.length) fbApp = firebase.initializeApp(cfg);
      else fbApp = firebase.apps[0];
      auth = firebase.auth();
      db = firebase.firestore();
      try {
        auth.setPersistence(firebase.auth.Auth.Persistence.LOCAL);
      } catch (e) { /* ok */ }

      auth.onAuthStateChanged(function (user) {
        if (user) {
          setState({
            user: { uid: user.uid, email: user.email || '', displayName: user.displayName || '' },
            status: 'syncing',
            error: null
          });
          startSync(user.uid);
        } else {
          stopSnapshot();
          setState({ user: null, status: 'signed-out', error: null });
        }
      });
      return true;
    }).catch(function (err) {
      setState({ status: navigator.onLine === false ? 'offline' : 'error', error: err.message });
      return false;
    });
  }

  /* ---------- Operazioni Firestore ---------- */

  function userMapsCollection(uid) {
    return db.collection('users').doc(uid).collection('maps');
  }

  function stopSnapshot() {
    if (unsubSnapshot) { try { unsubSnapshot(); } catch (e) {} unsubSnapshot = null; }
  }

  function allLocalMaps() {
    var list = MM.storage.listMaps();
    var out = [];
    list.forEach(function (s) {
      try {
        var m = MM.storage.loadMap(s.id);
        if (m) out.push(m);
      } catch (e) { /* salta mappe corrotte */ }
    });
    return out;
  }

  function uploadMapDoc(uid, map) {
    var payload = {
      id: map.id,
      title: map.title || '',
      updatedAt: map.updatedAt || MM.model.nowIso(),
      deletedAt: null,
      data: map
    };
    return userMapsCollection(uid).doc(map.id).set(payload).then(function () {
      dequeue(map.id);
      var del = getDeletedMap();
      if (del[map.id]) { delete del[map.id]; setDeletedMap(del); }
    });
  }

  function uploadDeleteDoc(uid, mapId, deletedAt) {
    var ts = deletedAt || MM.model.nowIso();
    return userMapsCollection(uid).doc(mapId).set({
      id: mapId,
      title: '',
      updatedAt: ts,
      deletedAt: ts,
      data: null
    }).then(function () {
      dequeue(mapId);
    });
  }

  function startSync(uid) {
    stopSnapshot();
    var col = userMapsCollection(uid);
    var firstSnapshot = true;

    unsubSnapshot = col.onSnapshot(function (snapshot) {
      var remoteDocs = [];
      snapshot.forEach(function (doc) {
        var d = doc.data();
        if (!d) return;
        remoteDocs.push({
          id: doc.id,
          updatedAt: d.updatedAt || '',
          deletedAt: d.deletedAt || null,
          data: d.data || null
        });
      });

      if (firstSnapshot) {
        firstSnapshot = false;
        var plan = reconcile(allLocalMaps(), remoteDocs, getDeletedMap());
        applyPlan(uid, plan);
        return;
      }

      // Aggiornamenti incrementali in tempo reale dall'altro dispositivo.
      var listChanged = false;
      var currentMap = appApi && appApi.getMap();
      snapshot.docChanges().forEach(function (change) {
        if (change.doc.metadata && change.doc.metadata.hasPendingWrites) return;
        var docId = change.doc.id;
        var d = change.doc.data();
        if (change.type === 'removed' || (d && d.deletedAt)) {
          var existing = null;
          try { existing = MM.storage.loadMap(docId); } catch (e) {}
          var delAt = (d && d.deletedAt) || MM.model.nowIso();
          if (existing && (!existing.updatedAt || existing.updatedAt <= delAt)) {
            MM.storage.deleteMap(docId);
            listChanged = true;
            if (currentMap && currentMap.id === docId && appApi && appApi.onRemoteMapDeleted) {
              appApi.onRemoteMapDeleted(docId);
            }
          }
          return;
        }
        if (d && d.data) {
          var local = null;
          try { local = MM.storage.loadMap(docId); } catch (e) {}
          var remUpdated = d.updatedAt || d.data.updatedAt || '';
          if (!local || !local.updatedAt || remUpdated > local.updatedAt) {
            try {
              var v = MM.model.validate(d.data);
              if (!v.ok) return;
              MM.storage.saveMap(d.data, { touch: false });
              listChanged = true;
              if (currentMap && currentMap.id === docId && appApi && appApi.applyRemoteMap) {
                appApi.applyRemoteMap(d.data);
              }
            } catch (e) { /* ignora dati remoti malformati */ }
          }
        }
      });

      if (listChanged && appApi && appApi.onRemoteListChanged) appApi.onRemoteListChanged();
      setState({ status: 'synced', lastSyncAt: MM.model.nowIso(), error: null });
    }, function (err) {
      var code = err && err.code ? err.code : '';
      var msg = code === 'permission-denied'
        ? 'Permesso negato su Firestore: controlla le regole di sicurezza nel progetto Firebase'
        : (err && err.message ? err.message : 'Errore di sincronizzazione');
      setState({ status: navigator.onLine === false ? 'offline' : 'error', error: msg });
    });
  }

  function applyPlan(uid, plan) {
    var listChanged = false;
    var currentMap = appApi && appApi.getMap();

    plan.toSaveLocal.forEach(function (map) {
      try {
        if (!MM.model.validate(map).ok) return;
        MM.storage.saveMap(map, { touch: false });
        listChanged = true;
        if (currentMap && currentMap.id === map.id && appApi && appApi.applyRemoteMap) {
          appApi.applyRemoteMap(map);
        }
      } catch (e) {}
    });

    plan.toDeleteLocal.forEach(function (id) {
      MM.storage.deleteMap(id);
      listChanged = true;
      if (currentMap && currentMap.id === id && appApi && appApi.onRemoteMapDeleted) {
        appApi.onRemoteMapDeleted(id);
      }
    });

    if (listChanged && appApi && appApi.onRemoteListChanged) appApi.onRemoteListChanged();

    var tasks = [];
    plan.toUpload.forEach(function (m) { tasks.push(uploadMapDoc(uid, m)); });
    plan.toDeleteCloud.forEach(function (d) { tasks.push(uploadDeleteDoc(uid, d.id, d.deletedAt)); });

    if (!tasks.length) {
      setState({ status: 'synced', lastSyncAt: MM.model.nowIso(), error: null });
      return;
    }
    setState({ status: 'syncing' });
    Promise.all(tasks).then(function () {
      setState({ status: 'synced', lastSyncAt: MM.model.nowIso(), error: null });
    }).catch(function (err) {
      setState({ status: navigator.onLine === false ? 'offline' : 'error', error: err.message });
    });
  }

  /* ---------- Azioni chiamate da MM.app ---------- */

  function pushMap(map) {
    if (!map || !map.id) return;
    if (!state.user || !db) {
      if (getConfig()) enqueue(map.id, 'save');
      return;
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      enqueue(map.id, 'save');
      setState({ status: 'offline' });
      return;
    }
    if (pushTimers[map.id]) clearTimeout(pushTimers[map.id]);
    pushTimers[map.id] = setTimeout(function () {
      delete pushTimers[map.id];
      if (!state.user || !db) { enqueue(map.id, 'save'); return; }
      setState({ status: 'syncing' });
      uploadMapDoc(state.user.uid, map).then(function () {
        setState({ status: 'synced', lastSyncAt: MM.model.nowIso(), error: null });
      }).catch(function (err) {
        enqueue(map.id, 'save');
        setState({ status: navigator.onLine === false ? 'offline' : 'error', error: err.message });
      });
    }, PUSH_DEBOUNCE);
  }

  function deleteMap(mapId) {
    if (!mapId) return;
    if (pushTimers[mapId]) { clearTimeout(pushTimers[mapId]); delete pushTimers[mapId]; }
    var ts = MM.model.nowIso();
    var del = getDeletedMap();
    del[mapId] = ts;
    setDeletedMap(del);

    if (!state.user || !db || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
      if (getConfig()) enqueue(mapId, 'delete');
      return;
    }
    setState({ status: 'syncing' });
    uploadDeleteDoc(state.user.uid, mapId, ts).then(function () {
      setState({ status: 'synced', lastSyncAt: MM.model.nowIso(), error: null });
    }).catch(function (err) {
      enqueue(mapId, 'delete');
      setState({ status: navigator.onLine === false ? 'offline' : 'error', error: err.message });
    });
  }

  function flushQueue() {
    if (!state.user || !db) return Promise.resolve();
    var q = getQueue();
    var ids = Object.keys(q);
    if (!ids.length) return Promise.resolve();
    setState({ status: 'syncing' });
    var tasks = ids.map(function (id) {
      if (q[id].kind === 'delete') return uploadDeleteDoc(state.user.uid, id, q[id].at);
      var m = null;
      try { m = MM.storage.loadMap(id); } catch (e) {}
      if (m) return uploadMapDoc(state.user.uid, m);
      dequeue(id);
      return Promise.resolve();
    });
    return Promise.all(tasks).then(function () {
      setState({ status: 'synced', lastSyncAt: MM.model.nowIso(), error: null });
    }).catch(function (err) {
      setState({ status: navigator.onLine === false ? 'offline' : 'error', error: err.message });
    });
  }

  function syncNow() {
    if (!state.user || !db) return Promise.resolve();
    setState({ status: 'syncing', error: null });
    return flushQueue().then(function () {
      return userMapsCollection(state.user.uid).get();
    }).then(function (snap) {
      var remoteDocs = [];
      snap.forEach(function (doc) {
        var d = doc.data();
        if (d) remoteDocs.push({ id: doc.id, updatedAt: d.updatedAt || '', deletedAt: d.deletedAt || null, data: d.data || null });
      });
      var plan = reconcile(allLocalMaps(), remoteDocs, getDeletedMap());
      applyPlan(state.user.uid, plan);
    }).catch(function (err) {
      setState({ status: navigator.onLine === false ? 'offline' : 'error', error: err.message });
    });
  }

  /* ---------- Autenticazione ---------- */

  function friendlyAuthError(err) {
    var code = err && err.code ? err.code : '';
    var map = {
      'auth/invalid-email': 'Indirizzo email non valido.',
      'auth/user-not-found': 'Nessun account trovato con questa email.',
      'auth/wrong-password': 'Password errata.',
      'auth/invalid-credential': 'Email o password non corretti.',
      'auth/email-already-in-use': 'Questa email è già registrata: prova ad accedere.',
      'auth/weak-password': 'La password deve avere almeno 6 caratteri.',
      'auth/popup-closed-by-user': 'Accesso con Google annullato.',
      'auth/popup-blocked': 'Il browser ha bloccato la finestra Google: usa Email e Password (consigliato su iPad).',
      'auth/network-request-failed': 'Nessuna connessione a internet.'
    };
    return map[code] || (err && err.message ? err.message : 'Errore di accesso');
  }

  function signInWithEmail(email, password) {
    if (!auth) return Promise.reject(new Error('Firebase non configurato'));
    return auth.signInWithEmailAndPassword(String(email).trim(), String(password)).catch(function (e) {
      throw new Error(friendlyAuthError(e));
    });
  }

  function signUpWithEmail(email, password) {
    if (!auth) return Promise.reject(new Error('Firebase non configurato'));
    return auth.createUserWithEmailAndPassword(String(email).trim(), String(password)).catch(function (e) {
      throw new Error(friendlyAuthError(e));
    });
  }

  function signInWithGoogle() {
    if (!auth || !root.firebase) return Promise.reject(new Error('Firebase non configurato'));
    var provider = new root.firebase.auth.GoogleAuthProvider();
    return auth.signInWithPopup(provider).catch(function (e) {
      throw new Error(friendlyAuthError(e));
    });
  }

  function signOut() {
    if (!auth) return Promise.resolve();
    stopSnapshot();
    return auth.signOut();
  }

  /* ---------- Avvio ---------- */

  function init(api) {
    appApi = api;
    var cfg = getConfig();
    if (!cfg) {
      setState({ status: 'unconfigured', error: null });
      return;
    }
    if (!isSupported()) {
      setState({ status: 'unconfigured', error: null });
      return;
    }
    setupFirebase(cfg);

    if (typeof root.addEventListener === 'function') {
      root.addEventListener('online', function () {
        if (state.user && db) syncNow();
        else if (getConfig() && !auth) setupFirebase(getConfig());
      });
      root.addEventListener('offline', function () {
        if (state.user) setState({ status: 'offline' });
      });
    }
  }

  MM.sync = {
    init: init,
    getState: getState,
    onStatusChange: onStatusChange,
    isSupported: isSupported,
    isValidConfig: isValidConfig,
    parseConfig: parseConfig,
    getConfig: getConfig,
    saveConfig: saveConfig,
    clearConfig: clearConfig,
    reconcile: reconcile,
    pushMap: pushMap,
    deleteMap: deleteMap,
    syncNow: syncNow,
    signInWithEmail: signInWithEmail,
    signUpWithEmail: signUpWithEmail,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
