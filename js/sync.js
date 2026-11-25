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
  var SHARED_PUSH_DEBOUNCE = 350;
  var PRESENCE_INTERVAL = 25000;
  var PRESENCE_TTL = 70000;
  var SHARE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  var appApi = null;
  var listeners = [];
  var sdkPromise = null;
  var fbApp = null;
  var auth = null;
  var db = null;
  var unsubAuth = null;
  var unsubSnapshot = null;
  var pushTimers = {};
  var sharedUnsub = null;
  var presenceUnsub = null;
  var presenceTimer = null;
  var sharedPushTimer = null;
  var pendingShareCode = null;
  var state = {
    status: 'unconfigured', // unconfigured | signed-out | connecting | synced | syncing | offline | error
    user: null,             // { uid, email, displayName }
    lastSyncAt: null,
    error: null,
    configSource: null,     // 'file' | 'local' | null
    shared: null            // { shareId, mapId, ownerId, ownerEmail, isOwner, myRole, defaultRole, members: [], roles: {}, memberEmails: {}, invites: [], peers: [{ uid, name, email }] }
  };

  function copyMapObj(obj) {
    var out = {};
    if (obj && typeof obj === 'object') {
      Object.keys(obj).forEach(function (k) { out[k] = obj[k]; });
    }
    return out;
  }

  function cloneInvites(list) {
    if (!Array.isArray(list)) return [];
    return list.map(function (inv) {
      return {
        email: inv && inv.email ? String(inv.email).trim().toLowerCase() : '',
        role: inv && inv.role === 'viewer' ? 'viewer' : 'editor'
      };
    }).filter(function (inv) { return !!inv.email; });
  }

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

  /**
   * Normalizza un codice di condivisione o un URL contenente ?condivisa=...
   * Restituisce una stringa maiuscola (es. "ABCD-2345") oppure "" se non valido.
   */
  function normalizeShareCode(input) {
    var raw = String(input || '').trim();
    if (!raw) return '';
    var match = /[?&]condivisa=([^&#]+)/i.exec(raw);
    if (match && match[1]) {
      try { raw = decodeURIComponent(match[1]); } catch (e) { raw = match[1]; }
    }
    var cleaned = raw.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
    var alnum = cleaned.replace(/-/g, '');
    if (alnum.length < 4) return '';
    if (alnum.length === 8) return alnum.slice(0, 4) + '-' + alnum.slice(4, 8);
    return cleaned;
  }

  function generateShareCode() {
    var out = '';
    var bytes = null;
    if (root.crypto && typeof root.crypto.getRandomValues === 'function') {
      bytes = new Uint8Array(8);
      root.crypto.getRandomValues(bytes);
    }
    for (var i = 0; i < 8; i++) {
      if (i === 4) out += '-';
      var idx = bytes ? (bytes[i] % SHARE_ALPHABET.length) : Math.floor(Math.random() * SHARE_ALPHABET.length);
      out += SHARE_ALPHABET.charAt(idx);
    }
    return out;
  }

  var NODE_EDITABLE_FIELDS = [
    'text', 'note', 'comment', 'color', 'fillColor', 'shape', 'icon', 'images',
    'fontName', 'fontSize', 'textColor', 'bold', 'italic', 'underline',
    'strike', 'uppercase', 'textAlign', 'bullets', 'boxSize', 'personMode', 'role',
    'avatarColor', 'subLayout', 'collapsed', 'x', 'y'
  ];

  /**
   * Unisce in modo puro due versioni della stessa mappa condivisa (coworking).
   * - Usa la versione con updatedAt più recente come base per i campi di mappa
   *   (title, settings, links, summaries).
   * - Se opts.localDirtyNodeId (o stringa) è specificato e quel nodo non è stato
   *   eliminato nella versione remota, preserva le modifiche locali su quel nodo.
   * - Se i due timestamp sono ravvicinati (≤ 5s), preserva anche eventuali nuovi
   *   nodi aggiunti localmente il cui genitore esiste nella mappa risultante.
   * - Garantisce sempre una mappa valida (MM.model.validate(merged).ok), con
   *   fallback pulito alla mappa valida più recente.
   */
  function mergeSharedMap(localMap, remoteMap, opts) {
    var localOk = !!localMap && MM.model.validate(localMap).ok;
    var remoteOk = !!remoteMap && MM.model.validate(remoteMap).ok;
    if (!localOk && !remoteOk) return null;
    if (!localOk) return MM.model.clone(remoteMap);
    if (!remoteOk) return MM.model.clone(localMap);

    var locTime = localMap.updatedAt || '';
    var remTime = remoteMap.updatedAt || '';
    var remoteNewer = (opts && opts.preferRemote) ? true : (remTime >= locTime);
    var base = MM.model.clone(remoteNewer ? remoteMap : localMap);
    var dirtyId = typeof opts === 'string' ? opts : (opts && opts.localDirtyNodeId ? opts.localDirtyNodeId : null);

    // 1. Preserva le modifiche sul nodo locale attivo se il remoto non lo ha eliminato.
    if (remoteNewer && dirtyId && base.nodes[dirtyId] && localMap.nodes[dirtyId]) {
      var locNode = localMap.nodes[dirtyId];
      var target = base.nodes[dirtyId];
      NODE_EDITABLE_FIELDS.forEach(function (k) {
        if (Object.prototype.hasOwnProperty.call(locNode, k)) {
          target[k] = MM.model.clone(locNode[k]);
        } else {
          delete target[k];
        }
      });
      if (dirtyId === base.rootId && typeof target.text === 'string') {
        base.title = target.text;
      }
    }

    // 2. Aggiunte concorrenti ravvicinate: preserva nuovi nodi locali con genitore presente.
    var locMs = Date.parse(locTime);
    var remMs = Date.parse(remTime);
    var closeTimestamps = !isNaN(locMs) && !isNaN(remMs) && Math.abs(remMs - locMs) <= 5000;
    if (remoteNewer && closeTimestamps) {
      var added = true;
      var guard = 0;
      while (added && guard < 10) {
        added = false;
        guard++;
        Object.keys(localMap.nodes).forEach(function (id) {
          if (base.nodes[id]) return;
          var ln = localMap.nodes[id];
          if (!ln || !ln.parentId || !base.nodes[ln.parentId]) return;
          var copy = MM.model.clone(ln);
          copy.children = [];
          base.nodes[id] = copy;
          if (base.nodes[ln.parentId].children.indexOf(id) === -1) {
            base.nodes[ln.parentId].children.push(id);
          }
          added = true;
        });
      }
    }

    if (MM.model.validate(base).ok) return base;
    return MM.model.clone(remoteNewer ? remoteMap : localMap);
  }

  /**
   * Determina il ruolo di un utente ('owner' | 'editor' | 'viewer') su una mappa condivisa.
   */
  function resolveRoleForUser(docData, uid, email) {
    if (!docData || !uid) return 'viewer';
    if (docData.ownerId === uid) return 'owner';
    if (docData.roles && (docData.roles[uid] === 'editor' || docData.roles[uid] === 'viewer')) {
      return docData.roles[uid];
    }
    var em = String(email || '').trim().toLowerCase();
    if (em && Array.isArray(docData.invites)) {
      for (var i = 0; i < docData.invites.length; i++) {
        var inv = docData.invites[i];
        if (inv && String(inv.email || '').trim().toLowerCase() === em) {
          return inv.role === 'viewer' ? 'viewer' : 'editor';
        }
      }
    }
    return docData.defaultRole === 'viewer' ? 'viewer' : 'editor';
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
    leaveSharedMap();
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

  function cloneSharedState(sh) {
    if (!sh) return null;
    return {
      shareId: sh.shareId,
      mapId: sh.mapId,
      ownerId: sh.ownerId,
      ownerEmail: sh.ownerEmail || '',
      isOwner: !!sh.isOwner,
      myRole: sh.myRole || (sh.isOwner ? 'owner' : 'editor'),
      defaultRole: sh.defaultRole === 'viewer' ? 'viewer' : 'editor',
      members: Array.isArray(sh.members) ? sh.members.slice() : [],
      roles: copyMapObj(sh.roles),
      memberEmails: copyMapObj(sh.memberEmails),
      invites: cloneInvites(sh.invites),
      peers: Array.isArray(sh.peers) ? sh.peers.map(function (p) {
        return { uid: p.uid, name: p.name, email: p.email };
      }) : []
    };
  }

  function getState() {
    return {
      status: state.status,
      user: state.user ? { uid: state.user.uid, email: state.user.email, displayName: state.user.displayName } : null,
      lastSyncAt: state.lastSyncAt,
      error: state.error,
      configSource: state.configSource,
      supported: isSupported(),
      shared: cloneSharedState(state.shared)
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

      if (unsubAuth) { try { unsubAuth(); } catch (e) {} unsubAuth = null; }
      unsubAuth = auth.onAuthStateChanged(function (user) {
        if (user) {
          setState({
            user: { uid: user.uid, email: user.email || '', displayName: user.displayName || '' },
            status: 'syncing',
            error: null
          });
          startSync(user.uid);
          if (pendingShareCode) {
            var codeToJoin = pendingShareCode;
            pendingShareCode = null;
            clearUrlShareParam();
            joinSharedMap(codeToJoin).then(function (res) {
              if (MM.ui && MM.ui.toast) MM.ui.toast('Unito alla mappa condivisa (' + res.shareId + ')', 'successo');
            }).catch(function (err) {
              if (MM.ui && MM.ui.toast) MM.ui.toast(err && err.message ? err.message : 'Impossibile unirsi alla mappa condivisa', 'errore');
            });
          }
        } else {
          stopSnapshot();
          leaveSharedMap();
          setState({ user: null, status: 'signed-out', error: null });
          if (pendingShareCode) {
            if (MM.ui && MM.ui.openSync) MM.ui.openSync();
            if (MM.ui && MM.ui.toast) MM.ui.toast('Accedi per unirti alla mappa condivisa');
          }
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
          if (state.shared && state.shared.mapId === docId) return;
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
      if (state.shared && state.shared.mapId === id) return;
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

  /* ---------- Coworking in tempo reale (sharedMaps/{shareId}) ---------- */

  function buildShareUrl(shareId) {
    var base = (typeof location !== 'undefined' && location.origin && location.pathname)
      ? (location.origin + location.pathname)
      : '';
    return base + '?condivisa=' + encodeURIComponent(shareId);
  }

  function clearUrlShareParam() {
    try {
      if (typeof location === 'undefined' || typeof history === 'undefined' || !history.replaceState) return;
      var params = new URLSearchParams(location.search);
      if (!params.has('condivisa')) return;
      params.delete('condivisa');
      var qs = params.toString();
      var nextUrl = location.pathname + (qs ? '?' + qs : '') + (location.hash || '');
      history.replaceState(null, '', nextUrl);
    } catch (e) { /* ignora */ }
  }

  function stopSharedListeners() {
    if (sharedPushTimer) { clearTimeout(sharedPushTimer); sharedPushTimer = null; }
    if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
    if (sharedUnsub) { try { sharedUnsub(); } catch (e) {} sharedUnsub = null; }
    if (presenceUnsub) { try { presenceUnsub(); } catch (e) {} presenceUnsub = null; }
  }

  function startPresence(shareId) {
    if (presenceTimer) { clearInterval(presenceTimer); presenceTimer = null; }
    if (presenceUnsub) { try { presenceUnsub(); } catch (e) {} presenceUnsub = null; }
    if (!db || !state.user) return;
    var presCol = db.collection('sharedMaps').doc(shareId).collection('presence');

    function writeHeartbeat() {
      if (!state.user || !db || !state.shared || state.shared.shareId !== shareId) return;
      presCol.doc(state.user.uid).set({
        name: state.user.displayName || state.user.email || 'Utente',
        email: state.user.email || '',
        lastSeen: Date.now()
      }).catch(function () { /* best-effort */ });
    }

    writeHeartbeat();
    presenceTimer = setInterval(writeHeartbeat, PRESENCE_INTERVAL);

    presenceUnsub = presCol.onSnapshot(function (snap) {
      if (!state.shared || state.shared.shareId !== shareId) return;
      var now = Date.now();
      var peers = [];
      snap.forEach(function (doc) {
        var p = doc.data();
        if (!p || typeof p.lastSeen !== 'number') return;
        if (now - p.lastSeen < PRESENCE_TTL) {
          peers.push({
            uid: doc.id,
            name: p.name || p.email || 'Collaboratore',
            email: p.email || ''
          });
        }
      });
      state.shared.peers = peers;
      setState({ shared: state.shared });
    }, function () { /* ignora errori transitori presenza */ });
  }

  function subscribeShared(shareId) {
    if (sharedUnsub) { try { sharedUnsub(); } catch (e) {} sharedUnsub = null; }
    if (!db) return;
    sharedUnsub = db.collection('sharedMaps').doc(shareId).onSnapshot(function (doc) {
      if (!state.shared || state.shared.shareId !== shareId) return;
      if (!doc.exists) {
        leaveSharedMap();
        if (MM.ui && MM.ui.toast) MM.ui.toast('La mappa condivisa è stata eliminata dal creatore', 'avviso');
        return;
      }
      var d = doc.data();
      if (!d) return;
      if (Array.isArray(d.members)) state.shared.members = d.members.slice();
      if (d.ownerId) {
        state.shared.ownerId = d.ownerId;
        state.shared.isOwner = !!(state.user && d.ownerId === state.user.uid);
      }
      if (typeof d.ownerEmail === 'string') state.shared.ownerEmail = d.ownerEmail;
      state.shared.roles = copyMapObj(d.roles);
      state.shared.invites = cloneInvites(d.invites);
      state.shared.defaultRole = d.defaultRole === 'viewer' ? 'viewer' : 'editor';
      state.shared.memberEmails = copyMapObj(d.memberEmails);
      state.shared.myRole = resolveRoleForUser(
        d,
        state.user ? state.user.uid : '',
        state.user ? state.user.email : ''
      );

      // Se l'amministratore vede membri senza ruolo esplicito in roles, esegue il backfill.
      if (state.shared.isOwner && Array.isArray(d.members)) {
        var backfill = {};
        var hasBackfill = false;
        d.members.forEach(function (mUid) {
          if (!mUid || mUid === d.ownerId) return;
          if (!d.roles || (d.roles[mUid] !== 'editor' && d.roles[mUid] !== 'viewer')) {
            var mEmail = (d.memberEmails && d.memberEmails[mUid]) || '';
            backfill['roles.' + mUid] = resolveRoleForUser(d, mUid, mEmail);
            hasBackfill = true;
          }
        });
        if (hasBackfill) {
          db.collection('sharedMaps').doc(shareId).update(backfill).catch(function () {});
        }
      }

      if (doc.metadata && doc.metadata.hasPendingWrites) {
        setState({ shared: state.shared });
        return;
      }
      if (d.updatedBy && state.user && d.updatedBy === state.user.uid) {
        setState({ shared: state.shared });
        return;
      }

      if (d.data && MM.model.validate(d.data).ok) {
        var currentMap = appApi && appApi.getMap ? appApi.getMap() : null;
        var merged;
        if (state.shared.myRole === 'viewer') {
          merged = d.data;
        } else {
          var localMap = (currentMap && currentMap.id === d.data.id) ? currentMap : null;
          if (!localMap) {
            try { localMap = MM.storage.loadMap(d.data.id); } catch (e) {}
          }
          var dirtyNodeId = (appApi && appApi.state && appApi.state.mode === 'modifica') ? appApi.state.selectedId : null;
          merged = localMap ? mergeSharedMap(localMap, d.data, { localDirtyNodeId: dirtyNodeId, preferRemote: !sharedPushTimer }) : d.data;
        }
        if (merged && MM.model.validate(merged).ok) {
          try { MM.storage.saveMap(merged, { touch: false }); } catch (e) {}
          if (currentMap && currentMap.id === merged.id && appApi && appApi.applyRemoteMap) {
            appApi.applyRemoteMap(merged);
          }
          if (appApi && appApi.onRemoteListChanged) appApi.onRemoteListChanged();
        }
      }
      setState({ shared: state.shared, lastSyncAt: MM.model.nowIso(), error: null });
    }, function (err) {
      var msg = err && err.code === 'permission-denied'
        ? 'Permesso negato sulla mappa condivisa: controlla le regole Firestore'
        : (err && err.message ? err.message : 'Errore nella sessione condivisa');
      setState({ status: navigator.onLine === false ? 'offline' : 'error', error: msg });
    });
  }

  function shareMap(map) {
    if (!state.user || !db) return Promise.reject(new Error('Accedi prima per condividere la mappa'));
    if (!map || !map.id || !MM.model.validate(map).ok) {
      return Promise.reject(new Error('Mappa non valida per la condivisione'));
    }
    if (state.shared && state.shared.mapId === map.id) {
      return Promise.resolve({ shareId: state.shared.shareId, url: buildShareUrl(state.shared.shareId) });
    }
    if (state.shared) leaveSharedMap();

    var shareId = generateShareCode();
    var uid = state.user.uid;
    var email = state.user.email || '';
    var memberEmails = {};
    memberEmails[uid] = email;
    var payload = {
      ownerId: uid,
      ownerEmail: email,
      members: [uid],
      roles: {},
      memberEmails: memberEmails,
      invites: [],
      defaultRole: 'editor',
      title: map.title || '',
      updatedAt: MM.model.nowIso(),
      updatedBy: uid,
      data: map
    };
    return db.collection('sharedMaps').doc(shareId).set(payload).then(function () {
      var sharedMemberEmails = {};
      sharedMemberEmails[uid] = email;
      state.shared = {
        shareId: shareId,
        mapId: map.id,
        ownerId: uid,
        ownerEmail: email,
        isOwner: true,
        myRole: 'owner',
        defaultRole: 'editor',
        members: [uid],
        roles: {},
        memberEmails: sharedMemberEmails,
        invites: [],
        peers: [{ uid: uid, name: state.user.displayName || email || 'Tu', email: email }]
      };
      setState({ shared: state.shared, lastSyncAt: MM.model.nowIso(), error: null });
      subscribeShared(shareId);
      startPresence(shareId);
      return { shareId: shareId, url: buildShareUrl(shareId) };
    });
  }

  function joinSharedMap(code) {
    if (!state.user || !db) return Promise.reject(new Error('Accedi prima per unirti a una mappa condivisa'));
    var shareId = normalizeShareCode(code);
    if (!shareId) return Promise.reject(new Error('Codice mappa condivisa non valido'));
    if (state.shared && state.shared.shareId !== shareId) leaveSharedMap();

    var docRef = db.collection('sharedMaps').doc(shareId);
    return docRef.get().then(function (doc) {
      if (!doc.exists) throw new Error('Codice mappa condivisa non trovato');
      var d = doc.data();
      if (!d || !d.data || !MM.model.validate(d.data).ok) {
        throw new Error('Dati della mappa condivisa non validi');
      }
      var uid = state.user.uid;
      var email = state.user.email || '';
      var isOwner = d.ownerId === uid;
      var role = resolveRoleForUser(d, uid, email);
      var members = Array.isArray(d.members) ? d.members.slice() : [];
      var roles = copyMapObj(d.roles);
      var memberEmails = copyMapObj(d.memberEmails);
      var invites = cloneInvites(d.invites);
      var defaultRole = d.defaultRole === 'viewer' ? 'viewer' : 'editor';

      var updatePatch = {};
      var needsUpdate = false;
      var alreadyMember = members.indexOf(uid) !== -1;
      var canUpdateMembership = isOwner || !alreadyMember;
      if (!alreadyMember) {
        members.push(uid);
        var fv = root.firebase && root.firebase.firestore && root.firebase.firestore.FieldValue;
        updatePatch.members = fv && fv.arrayUnion ? fv.arrayUnion(uid) : members;
        needsUpdate = true;
      }
      if (canUpdateMembership && !isOwner && !(d.roles && (d.roles[uid] === 'editor' || d.roles[uid] === 'viewer'))) {
        roles[uid] = role;
        updatePatch['roles.' + uid] = role;
        needsUpdate = true;
      }
      if (canUpdateMembership && memberEmails[uid] !== email) {
        memberEmails[uid] = email;
        updatePatch['memberEmails.' + uid] = email;
        needsUpdate = true;
      }

      var ensureMember = Promise.resolve();
      if (canUpdateMembership && needsUpdate) {
        ensureMember = docRef.update(updatePatch).catch(function (err) {
          throw new Error('Impossibile unirsi alla mappa condivisa: ' + (err && err.message ? err.message : err));
        });
      }
      return ensureMember.then(function () {
        var del = getDeletedMap();
        if (del[d.data.id]) { delete del[d.data.id]; setDeletedMap(del); }
        dequeue(d.data.id);
        state.shared = {
          shareId: shareId,
          mapId: d.data.id,
          ownerId: d.ownerId || '',
          ownerEmail: d.ownerEmail || '',
          isOwner: isOwner,
          myRole: role,
          defaultRole: defaultRole,
          members: members,
          roles: roles,
          memberEmails: memberEmails,
          invites: invites,
          peers: [{ uid: uid, name: state.user.displayName || email || 'Tu', email: email }]
        };
        if (appApi && appApi.applyRemoteMap) {
          appApi.applyRemoteMap(d.data, { forceOpen: true });
        } else {
          try { MM.storage.saveMap(d.data, { touch: false }); } catch (e) {}
        }
        setState({ shared: state.shared, lastSyncAt: MM.model.nowIso(), error: null });
        subscribeShared(shareId);
        startPresence(shareId);
        return { shareId: shareId, url: buildShareUrl(shareId), map: d.data };
      });
    });
  }

  function pushSharedMap(map) {
    if (!state.shared || state.shared.myRole === 'viewer' || !state.user || !db || !map || map.id !== state.shared.mapId) return;
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return;
    var shareId = state.shared.shareId;
    if (sharedPushTimer) clearTimeout(sharedPushTimer);
    sharedPushTimer = setTimeout(function () {
      sharedPushTimer = null;
      if (!state.shared || state.shared.shareId !== shareId || state.shared.myRole === 'viewer' || !state.user || !db) return;
      db.collection('sharedMaps').doc(shareId).update({
        title: map.title || '',
        updatedAt: MM.model.nowIso(),
        updatedBy: state.user.uid,
        data: map
      }).then(function () {
        setState({ lastSyncAt: MM.model.nowIso(), error: null });
      }).catch(function (err) {
        setState({ status: navigator.onLine === false ? 'offline' : 'error', error: err && err.message ? err.message : 'Errore invio mappa condivisa' });
      });
    }, SHARED_PUSH_DEBOUNCE);
  }

  function isReadOnly() {
    return !!(state.shared && state.shared.myRole === 'viewer');
  }

  function inviteByEmail(email, role) {
    if (!state.shared || !db) return Promise.reject(new Error('Nessuna mappa condivisa attiva'));
    if (!state.shared.isOwner) return Promise.reject(new Error('Solo il creatore (amministratore) può invitare collaboratori'));
    var em = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      return Promise.reject(new Error('Indirizzo email non valido'));
    }
    var r = role === 'viewer' ? 'viewer' : 'editor';
    var nextInvites = cloneInvites(state.shared.invites);
    var updated = false;
    for (var i = 0; i < nextInvites.length; i++) {
      if (nextInvites[i].email === em) {
        nextInvites[i].role = r;
        updated = true;
        break;
      }
    }
    if (!updated) nextInvites.push({ email: em, role: r });

    var nextRoles = copyMapObj(state.shared.roles);
    var memberEmails = state.shared.memberEmails || {};
    Object.keys(memberEmails).forEach(function (memberUid) {
      if (memberUid === state.shared.ownerId) return;
      if (String(memberEmails[memberUid] || '').trim().toLowerCase() === em) {
        nextRoles[memberUid] = r;
      }
    });

    var shareId = state.shared.shareId;
    return db.collection('sharedMaps').doc(shareId).update({
      invites: nextInvites,
      roles: nextRoles
    }).then(function () {
      if (state.shared && state.shared.shareId === shareId) {
        state.shared.invites = nextInvites;
        state.shared.roles = nextRoles;
        setState({ shared: state.shared });
      }
      var url = buildShareUrl(shareId);
      var mailtoUrl = 'mailto:' + encodeURIComponent(em)
        + '?subject=' + encodeURIComponent('Invito mappa mentale condivisa')
        + '&body=' + encodeURIComponent(
          'Ciao!\n\nTi ho invitato come '
          + (r === 'viewer' ? 'Lettore (solo visualizzazione)' : 'Editor (puoi modificare)')
          + ' sulla mappa condivisa.\n\nApri questo link per partecipare:\n' + url
          + '\n\nCodice sessione: ' + shareId
        );
      return { email: em, role: r, url: url, mailtoUrl: mailtoUrl };
    });
  }

  function setMemberRole(uidOrEmail, role) {
    if (!state.shared || !db) return Promise.reject(new Error('Nessuna mappa condivisa attiva'));
    if (!state.shared.isOwner) return Promise.reject(new Error('Solo il creatore (amministratore) può modificare i ruoli'));
    var target = String(uidOrEmail || '').trim();
    if (!target) return Promise.reject(new Error('Collaboratore non valido'));
    var r = role === 'viewer' ? 'viewer' : 'editor';
    var nextRoles = copyMapObj(state.shared.roles);
    var nextInvites = cloneInvites(state.shared.invites);
    var memberEmails = state.shared.memberEmails || {};

    if (target.indexOf('@') >= 0) {
      var em = target.toLowerCase();
      for (var i = 0; i < nextInvites.length; i++) {
        if (nextInvites[i].email === em) nextInvites[i].role = r;
      }
      Object.keys(memberEmails).forEach(function (memberUid) {
        if (memberUid === state.shared.ownerId) return;
        if (String(memberEmails[memberUid] || '').trim().toLowerCase() === em) {
          nextRoles[memberUid] = r;
        }
      });
    } else {
      if (target === state.shared.ownerId) {
        return Promise.reject(new Error('Non è possibile modificare il ruolo del creatore'));
      }
      nextRoles[target] = r;
      var memberEmail = String(memberEmails[target] || '').trim().toLowerCase();
      if (memberEmail) {
        for (var j = 0; j < nextInvites.length; j++) {
          if (nextInvites[j].email === memberEmail) nextInvites[j].role = r;
        }
      }
    }

    var shareId = state.shared.shareId;
    return db.collection('sharedMaps').doc(shareId).update({
      roles: nextRoles,
      invites: nextInvites
    }).then(function () {
      if (state.shared && state.shared.shareId === shareId) {
        state.shared.roles = nextRoles;
        state.shared.invites = nextInvites;
        setState({ shared: state.shared });
      }
    });
  }

  function removeInvite(email) {
    if (!state.shared || !db) return Promise.reject(new Error('Nessuna mappa condivisa attiva'));
    if (!state.shared.isOwner) return Promise.reject(new Error('Solo il creatore (amministratore) può rimuovere gli inviti'));
    var em = String(email || '').trim().toLowerCase();
    var nextInvites = cloneInvites(state.shared.invites).filter(function (inv) {
      return inv.email !== em;
    });
    var shareId = state.shared.shareId;
    return db.collection('sharedMaps').doc(shareId).update({
      invites: nextInvites
    }).then(function () {
      if (state.shared && state.shared.shareId === shareId) {
        state.shared.invites = nextInvites;
        setState({ shared: state.shared });
      }
    });
  }

  function setDefaultRole(role) {
    if (!state.shared || !db) return Promise.reject(new Error('Nessuna mappa condivisa attiva'));
    if (!state.shared.isOwner) return Promise.reject(new Error('Solo il creatore (amministratore) può cambiare il ruolo predefinito'));
    var r = role === 'viewer' ? 'viewer' : 'editor';
    var shareId = state.shared.shareId;
    return db.collection('sharedMaps').doc(shareId).update({
      defaultRole: r
    }).then(function () {
      if (state.shared && state.shared.shareId === shareId) {
        state.shared.defaultRole = r;
        setState({ shared: state.shared });
      }
    });
  }

  function deleteSharedMap() {
    if (!state.shared || !db) return Promise.reject(new Error('Nessuna mappa condivisa attiva'));
    if (!state.shared.isOwner) {
      return Promise.reject(new Error('Solo il creatore (amministratore) può eliminare la mappa condivisa'));
    }
    var shareId = state.shared.shareId;
    return db.collection('sharedMaps').doc(shareId).delete().then(function () {
      leaveSharedMap();
    });
  }

  function leaveSharedMap() {
    var prev = state.shared;
    var uid = state.user && state.user.uid;
    stopSharedListeners();
    if (prev && uid && db) {
      try {
        db.collection('sharedMaps').doc(prev.shareId).collection('presence').doc(uid).delete().catch(function () {});
      } catch (e) { /* best-effort */ }
    }
    if (state.shared !== null) {
      setState({ shared: null });
    }
  }

  /* ---------- Azioni chiamate da MM.app ---------- */

  function pushMap(map) {
    if (!map || !map.id) return;
    if (state.shared && map.id === state.shared.mapId) {
      pushSharedMap(map);
    }
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
    if (state.shared && state.shared.mapId === mapId) {
      leaveSharedMap();
    }
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
    leaveSharedMap();
    stopSnapshot();
    return auth.signOut();
  }

  /* ---------- Avvio ---------- */

  function init(api) {
    appApi = api;
    if (isSupported() && typeof location !== 'undefined' && location.search) {
      try {
        var rawShare = new URLSearchParams(location.search).get('condivisa');
        var norm = normalizeShareCode(rawShare);
        if (norm) pendingShareCode = norm;
      } catch (e) { /* ignora */ }
    }
    var cfg = getConfig();
    if (!cfg) {
      setState({ status: 'unconfigured', error: null });
      if (pendingShareCode && isSupported()) {
        if (MM.ui && MM.ui.openSync) MM.ui.openSync();
        if (MM.ui && MM.ui.toast) MM.ui.toast('Accedi per unirti alla mappa condivisa');
      }
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
    normalizeShareCode: normalizeShareCode,
    mergeSharedMap: mergeSharedMap,
    resolveRoleForUser: resolveRoleForUser,
    isReadOnly: isReadOnly,
    shareMap: shareMap,
    joinSharedMap: joinSharedMap,
    pushSharedMap: pushSharedMap,
    leaveSharedMap: leaveSharedMap,
    inviteByEmail: inviteByEmail,
    setMemberRole: setMemberRole,
    removeInvite: removeInvite,
    setDefaultRole: setDefaultRole,
    deleteSharedMap: deleteSharedMap,
    pushMap: pushMap,
    deleteMap: deleteMap,
    syncNow: syncNow,
    signInWithEmail: signInWithEmail,
    signUpWithEmail: signUpWithEmail,
    signInWithGoogle: signInWithGoogle,
    signOut: signOut
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
