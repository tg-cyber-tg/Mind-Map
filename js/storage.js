/*
 * Mappe Mentali – salvataggio nel browser (localStorage) e file .mappa.json.
 * Chiavi: "mm:index" (elenco MapSummary), "mm:map:<id>" (mappa), "mm:last" (ultima aperta).
 * Il backend è sostituibile (setBackend) per i test o se localStorage non è disponibile.
 */
(function (root) {
  'use strict';
  var MM = root.MM;

  var INDEX_KEY = 'mm:index';
  var MAP_PREFIX = 'mm:map:';
  var LAST_KEY = 'mm:last';
  var QUOTA_MSG = 'Spazio di archiviazione esaurito: esporta ed elimina alcune mappe';
  var MAX_FILE_BYTES = 5 * 1024 * 1024;

  /** Backend in memoria con la stessa interfaccia di localStorage (non persistente). */
  function createMemoryBackend() {
    var data = {};
    return {
      isMemory: true,
      getItem: function (k) { return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null; },
      setItem: function (k, v) { data[k] = String(v); },
      removeItem: function (k) { delete data[k]; },
      key: function (i) { var keys = Object.keys(data); return i < keys.length ? keys[i] : null; },
      clear: function () { data = {}; },
      get length() { return Object.keys(data).length; }
    };
  }

  var backend = null;

  function detectDefault() {
    try {
      var ls = root.localStorage;
      ls.setItem('mm:test', '1');
      ls.removeItem('mm:test');
      return ls;
    } catch (e) {
      // Navigazione privata o archiviazione disattivata: si lavora in memoria.
      return createMemoryBackend();
    }
  }

  function getBackend() {
    if (!backend) backend = detectDefault();
    return backend;
  }

  /** Imposta il backend (oggetto tipo localStorage); null = torna a quello predefinito. */
  function setBackend(obj) {
    backend = obj || null;
  }

  /** false se le mappe non sopravvivono alla chiusura della pagina. */
  function isPersistent() {
    return !getBackend().isMemory;
  }

  function isQuotaError(e) {
    return !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
      e.code === 22 || e.code === 1014);
  }

  function write(key, value) {
    try {
      getBackend().setItem(key, value);
    } catch (e) {
      if (isQuotaError(e)) throw new Error(QUOTA_MSG);
      throw new Error('Impossibile salvare: ' + (e && e.message ? e.message : e));
    }
  }

  function summaryOf(map) {
    return { id: map.id, title: map.title, updatedAt: map.updatedAt };
  }

  /** Completa i campi facoltativi mancanti (file creati a mano o versioni precedenti). */
  function normalize(data) {
    var map = MM.model.clone(data);
    var settings = MM.model.clone(MM.model.DEFAULT_SETTINGS);
    if (map.settings && typeof map.settings === 'object') {
      Object.keys(map.settings).forEach(function (k) { settings[k] = map.settings[k]; });
    }
    map.settings = settings;
    if (!Array.isArray(map.links)) map.links = [];
    if (typeof map.title !== 'string') {
      var rootNode = map.nodes && map.nodes[map.rootId];
      map.title = rootNode && typeof rootNode.text === 'string' ? rootNode.text : 'Mappa senza titolo';
    }
    var now = MM.model.nowIso();
    if (typeof map.createdAt !== 'string') map.createdAt = now;
    if (typeof map.updatedAt !== 'string') map.updatedAt = map.createdAt;
    return map;
  }

  /** Ricostruisce l'indice leggendo tutte le mappe salvate (indice mancante o danneggiato). */
  function rebuildIndex() {
    var b = getBackend();
    var keys = [];
    for (var i = 0; i < b.length; i++) {
      var k = b.key(i);
      if (k && k.indexOf(MAP_PREFIX) === 0) keys.push(k);
    }
    var index = [];
    keys.forEach(function (k) {
      try {
        var m = JSON.parse(b.getItem(k));
        if (m && m.id) index.push(summaryOf(normalize(m)));
      } catch (e) { /* mappa illeggibile: esclusa dall'elenco */ }
    });
    return index;
  }

  function readIndex() {
    var raw = getBackend().getItem(INDEX_KEY);
    if (raw === null) return rebuildIndex();
    try {
      var index = JSON.parse(raw);
      if (!Array.isArray(index)) return rebuildIndex();
      return index.filter(function (s) { return s && typeof s.id === 'string'; });
    } catch (e) {
      return rebuildIndex();
    }
  }

  /** @returns {Array<{id: string, title: string, updatedAt: string}>} dalla più recente. */
  function listMaps() {
    return readIndex().slice().sort(function (a, b) {
      if (a.updatedAt === b.updatedAt) return 0;
      return a.updatedAt < b.updatedAt ? 1 : -1;
    });
  }

  /**
   * Salva la mappa e aggiorna l'indice. Con { touch: false } mantiene updatedAt.
   * @returns {Object} la mappa salvata (con updatedAt aggiornato).
   */
  function saveMap(map, options) {
    if (!map || !map.id) throw new Error('Mappa non valida: impossibile salvarla');
    var saved = map;
    if (!(options && options.touch === false)) {
      saved = {};
      Object.keys(map).forEach(function (k) { saved[k] = map[k]; });
      saved.updatedAt = MM.model.nowIso();
    }
    write(MAP_PREFIX + saved.id, JSON.stringify(saved));
    var index = readIndex().filter(function (s) { return s.id !== saved.id; });
    index.push(summaryOf(saved));
    write(INDEX_KEY, JSON.stringify(index));
    return saved;
  }

  /** @returns {Object|null} null se la mappa non esiste; errore se è danneggiata. */
  function loadMap(id) {
    var raw = getBackend().getItem(MAP_PREFIX + id);
    if (raw === null) return null;
    var map;
    try {
      map = normalize(JSON.parse(raw));
    } catch (e) {
      throw new Error('La mappa salvata è danneggiata e non può essere aperta');
    }
    var v = MM.model.validate(map);
    if (!v.ok) throw new Error('La mappa salvata è danneggiata: ' + v.errors.slice(0, 2).join('; '));
    return map;
  }

  function deleteMap(id) {
    getBackend().removeItem(MAP_PREFIX + id);
    var index = readIndex().filter(function (s) { return s.id !== id; });
    write(INDEX_KEY, JSON.stringify(index));
    if (getLastMapId() === id) getBackend().removeItem(LAST_KEY);
  }

  /** Crea una copia con un nuovo id e il titolo "… (copia)". */
  function duplicateMap(id) {
    var map = loadMap(id);
    if (!map) throw new Error('Mappa non trovata');
    var copy = MM.model.clone(map);
    copy.id = MM.model.uid('m');
    copy.title = map.title + ' (copia)';
    copy.createdAt = MM.model.nowIso();
    return saveMap(copy);
  }

  function getLastMapId() {
    return getBackend().getItem(LAST_KEY);
  }

  function setLastMapId(id) {
    try { getBackend().setItem(LAST_KEY, id); } catch (e) { /* non essenziale */ }
  }

  /* ---------- File .mappa.json ---------- */

  function serialize(map) {
    return JSON.stringify(map, null, 2);
  }

  /** Legge il testo di un file .mappa.json; errori leggibili in italiano. */
  function deserialize(text) {
    var data;
    try {
      data = JSON.parse(String(text));
    } catch (e) {
      throw new Error('Il file non è leggibile: non sembra un file di mappa (.mappa.json)');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data) || !data.nodes || data.version === undefined) {
      throw new Error('Il file non contiene una mappa mentale');
    }
    if (data.version !== MM.model.FILE_VERSION) {
      throw new Error('Versione del file non supportata (' + data.version + '): serve una versione più recente dell\'app');
    }
    var map = normalize(data);
    var v = MM.model.validate(map);
    if (!v.ok) throw new Error('Il file contiene una mappa non valida: ' + v.errors.slice(0, 3).join('; '));
    // Non sovrascrive mai una mappa già presente: in quel caso diventa una copia.
    if (typeof map.id !== 'string' || !map.id || getBackend().getItem(MAP_PREFIX + map.id) !== null) {
      map.id = MM.model.uid('m');
    }
    return map;
  }

  /** Nome di file sicuro su Windows/macOS a partire dal titolo. */
  function sanitizeFilename(title) {
    var s = String(title || '')
      .replace(/[\u0000-\u001f\\\/:*?"<>|]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .slice(0, 60)
      .trim();
    return s || 'mappa';
  }

  function downloadFile(filename, content, mime) {
    var blob = content instanceof Blob ? content : new Blob([content], { type: mime || 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  /** @returns {Promise<string>} */
  function readFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file) { reject(new Error('Nessun file selezionato')); return; }
      if (file.size > MAX_FILE_BYTES) { reject(new Error('Il file è troppo grande (massimo 5 MB)')); return; }
      var reader = new FileReader();
      reader.onload = function () { resolve(String(reader.result)); };
      reader.onerror = function () { reject(new Error('Impossibile leggere il file')); };
      reader.readAsText(file, 'utf-8');
    });
  }

  MM.storage = {
    INDEX_KEY: INDEX_KEY, MAP_PREFIX: MAP_PREFIX, LAST_KEY: LAST_KEY, QUOTA_MSG: QUOTA_MSG,
    createMemoryBackend: createMemoryBackend, setBackend: setBackend, isPersistent: isPersistent,
    listMaps: listMaps, saveMap: saveMap, loadMap: loadMap, deleteMap: deleteMap,
    duplicateMap: duplicateMap, getLastMapId: getLastMapId, setLastMapId: setLastMapId,
    serialize: serialize, deserialize: deserialize, sanitizeFilename: sanitizeFilename,
    downloadFile: downloadFile, readFile: readFile
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
