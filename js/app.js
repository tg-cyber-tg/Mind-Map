/*
 * Mappe Mentali – controller principale (MM.app).
 * Tiene lo stato corrente e collega i moduli. Ogni modifica alla mappa passa da
 * commit(): cronologia (annulla/ripristina), layout, disegno, pannello e
 * salvataggio automatico.
 */
(function (root) {
  'use strict';
  var MM = root.MM;
  var SAVE_DELAY = 500;
  var PROPS_KEY = 'mm:ui-props-open';

  var state = {
    map: null,
    history: null,
    selectedId: null,
    selectedLinkId: null,
    mode: 'normale',          // 'normale' | 'collegamento' | 'modifica'
    pendingLinkFrom: null,
    renderer: null,
    viewport: null
  };
  var transient = {};          // opzioni di disegno temporanee (trascinamento)
  var saveTimer = null;
  var warnedNotPersistent = false;
  var pendingRemoteMap = null;
  var propertiesOpen = true;

  function ui() { return MM.ui || null; }
  function toast(msg, type) { if (ui()) ui().toast(msg, type); }

  /* ---------- Disegno ---------- */

  function render(extra) {
    if (!state.map || !state.renderer) return;
    var opts = {
      selectedId: state.selectedId,
      selectedLinkId: state.selectedLinkId,
      pendingLinkFrom: state.pendingLinkFrom
    };
    var t = extra || transient;
    Object.keys(t).forEach(function (k) { opts[k] = t[k]; });
    state.renderer.render(state.map, opts);
  }

  /** Opzioni temporanee di disegno (es. { dropTargetId, draggingId }); {} per azzerarle. */
  function setTransient(opts) {
    transient = opts || {};
    render();
  }

  function refreshUi() {
    var u = ui();
    if (!u) return;
    u.updateToolbarState(api);
    u.renderProperties(state.map, { nodeId: state.selectedId, linkId: state.selectedLinkId });
    u.setTitle(state.map.title);
  }

  /* ---------- Impostazioni visive (tema, carattere) ---------- */

  function applyBodySettings(settings) {
    var body = document.body;
    body.setAttribute('data-theme', settings.theme || 'chiaro');
    body.classList.toggle('mm-uppercase', !!settings.uppercase);
    body.classList.toggle('mm-font-leggibile', settings.fontFamily !== 'standard');
    // Anche l'interfaccia cresce con il testo della mappa, ma in modo attenuato
    // (a 2× la barra degli strumenti non starebbe più sullo schermo).
    var scale = settings.fontScale || 1;
    body.style.setProperty('--mm-font-scale', String(Math.round((1 + (scale - 1) * 0.4) * 100) / 100));
  }

  /* ---------- Salvataggio automatico ---------- */

  function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!state.map) return;
    try {
      var saved = MM.storage.saveMap(state.map);
      state.map.updatedAt = saved.updatedAt;
      MM.storage.setLastMapId(state.map.id);
      if (MM.sync) MM.sync.pushMap(saved);
      if (!MM.storage.isPersistent() && !warnedNotPersistent) {
        warnedNotPersistent = true;
        toast('Il browser non permette di salvare: esporta la mappa per non perderla', 'avviso');
      }
    } catch (e) {
      toast(e.message, 'errore');
    }
  }

  function scheduleSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, SAVE_DELAY);
  }

  /* ---------- Punto unico di modifica ---------- */

  /**
   * Applica una nuova versione della mappa.
   * options: { recordHistory = true, relayout = false, save = true }
   * Per i gesti continui (trascinamento) chi chiama ripristina prima lo stato di
   * inizio gesto, così si registra un solo passo di annulla.
   */
  function commit(newMap, options) {
    var o = options || {};
    if (!newMap || newMap === state.map) { refreshUi(); return; }
    if (o.recordHistory !== false && state.map) {
      state.history = MM.history.push(state.history, state.map);
    }
    state.map = o.relayout ? MM.layout.apply(newMap) : newMap;
    if (state.selectedId && !state.map.nodes[state.selectedId]) state.selectedId = state.map.rootId;
    if (state.selectedLinkId && !findLink(state.selectedLinkId)) state.selectedLinkId = null;
    render();
    refreshUi();
    if (o.save !== false) scheduleSave();
  }

  /** Esegue fn(map) → nuova mappa, mostrando gli errori come notifica. */
  function tryCommit(fn, options) {
    try {
      var result = fn(state.map);
      if (result) commit(result, options);
      return true;
    } catch (e) {
      toast(e.message, 'errore');
      return false;
    }
  }

  function findLink(id) {
    for (var i = 0; i < state.map.links.length; i++) if (state.map.links[i].id === id) return state.map.links[i];
    return null;
  }

  /* ---------- Selezione ---------- */

  function select(nodeId, options) {
    if (nodeId && !state.map.nodes[nodeId]) return;
    state.selectedId = nodeId || null;
    if (nodeId) state.selectedLinkId = null;
    render();
    refreshUi();
    if (nodeId && !(options && options.noScroll)) revealNode(nodeId);
  }

  function selectLink(linkId) {
    state.selectedLinkId = linkId && findLink(linkId) ? linkId : null;
    if (state.selectedLinkId) state.selectedId = null;
    render();
    refreshUi();
  }

  /** Porta il nodo nell'area visibile (senza cambiare lo zoom). */
  function revealNode(nodeId) {
    var n = state.map.nodes[nodeId];
    if (!n || !state.viewport) return;
    var s = MM.layout.measureNode(n, state.map.settings);
    state.viewport.ensureVisible({
      minX: n.x - s.width / 2, maxX: n.x + s.width / 2,
      minY: n.y - s.height / 2, maxY: n.y + s.height / 2
    }, 40);
  }

  function setMode(mode) {
    var prev = state.mode;
    state.mode = mode;
    if (mode !== 'collegamento') state.pendingLinkFrom = null;
    document.body.setAttribute('data-mode', mode);
    render();
    if (ui()) ui().updateToolbarState(api);
    if (prev === 'modifica' && mode !== 'modifica' && pendingRemoteMap) {
      var remote = pendingRemoteMap;
      pendingRemoteMap = null;
      applyRemoteMap(remote);
    }
  }

  /* ---------- Azioni sui nodi (usate da tastiera, mouse e barra) ---------- */

  function targetId() { return state.selectedId || state.map.rootId; }

  /** Aggiunge un figlio (o un fratello) e, se richiesto, avvia la modifica del testo. */
  function addNode(kind, options) {
    var res;
    try {
      res = kind === 'fratello' ? MM.model.addSibling(state.map, targetId())
        : MM.model.addChild(state.map, targetId());
    } catch (e) { toast(e.message, 'errore'); return null; }
    state.selectedId = res.nodeId;
    state.selectedLinkId = null;
    commit(res.map, { relayout: true });
    revealNode(res.nodeId);
    if (!(options && options.edit === false) && MM.interactions) MM.interactions.startInlineEdit(res.nodeId, { selectAll: true });
    return res.nodeId;
  }

  function deleteSelection() {
    if (state.selectedLinkId) {
      var linkId = state.selectedLinkId;
      state.selectedLinkId = null;
      tryCommit(function (m) { return MM.model.removeLink(m, linkId); });
      return;
    }
    var id = state.selectedId;
    if (!id) return;
    var node = state.map.nodes[id];
    if (node.parentId === null) { toast('Il nodo centrale non può essere eliminato', 'avviso'); return; }
    // Dopo l'eliminazione si seleziona il fratello vicino o il genitore.
    var siblings = state.map.nodes[node.parentId].children;
    var i = siblings.indexOf(id);
    var next = siblings[i + 1] || siblings[i - 1] || node.parentId;
    var removed = MM.model.getDescendants(state.map, id).length + 1;
    if (tryCommit(function (m) { return MM.model.removeNode(m, id); }, { relayout: true })) {
      select(next);
      toast(removed > 1 ? 'Eliminati ' + removed + ' nodi (Ctrl/Cmd+Z per annullare)' : 'Nodo eliminato (Ctrl/Cmd+Z per annullare)');
    }
  }

  function updateNode(nodeId, patch, options) {
    var o = options || {};
    return tryCommit(function (m) { return MM.model.updateNode(m, nodeId, patch); }, o);
  }

  function toggleCollapsed(nodeId) {
    var id = nodeId || state.selectedId;
    if (!id || !state.map.nodes[id].children.length) return;
    tryCommit(function (m) { return MM.model.toggleCollapsed(m, id); }, { relayout: true });
  }

  function reparent(nodeId, newParentId) {
    tryCommit(function (m) { return MM.model.reparent(m, nodeId, newParentId); }, { relayout: true });
  }

  /** Riapplica la disposizione automatica (annullabile). */
  function relayout() {
    commit(MM.layout.apply(state.map));
    fit();
  }

  /* ---------- Annulla / Ripristina ---------- */

  function undo() {
    if (state.mode === 'modifica' && MM.interactions) MM.interactions.commitInlineEdit();
    var r = MM.history.undo(state.history, state.map);
    if (!r.map) { toast('Niente da annullare'); return; }
    state.history = r.history;
    commit(r.map, { recordHistory: false });
    applyBodySettings(state.map.settings);
  }

  function redo() {
    var r = MM.history.redo(state.history, state.map);
    if (!r.map) { toast('Niente da ripristinare'); return; }
    state.history = r.history;
    commit(r.map, { recordHistory: false });
    applyBodySettings(state.map.settings);
  }

  /* ---------- Vista ---------- */

  function fit() {
    if (!state.viewport) return;
    state.viewport.fitTo(MM.layout.getBounds(state.map), 60);
  }

  function zoom(factor) { if (state.viewport) state.viewport.zoomAt(factor); }

  /* ---------- Gestione delle mappe ---------- */

  /** Sostituisce la mappa corrente (nuova cronologia, layout se mancante, adatta la vista). */
  function loadIntoEditor(map, options) {
    if (state.mode === 'modifica' && MM.interactions) MM.interactions.cancelInlineEdit();
    if (MM.speech && MM.speech.isSpeaking()) stopReading();
    if (state.map) saveNow();
    applyBodySettings(map.settings);
    if (state.renderer) state.renderer.invalidate();
    state.history = MM.history.createHistory(100);
    state.map = options && options.relayout ? MM.layout.apply(map) : map;
    state.selectedId = state.map.rootId;
    state.selectedLinkId = null;
    setMode('normale');
    render();
    refreshUi();
    fit();
    MM.storage.setLastMapId(state.map.id);
  }

  /** Mappa vuota oppure da modello (se MM.templates è disponibile). */
  function createFromTemplate(templateId) {
    var map = templateId && templateId !== 'vuota' && MM.templates
      ? MM.templates.create(templateId) : MM.model.createMap('Nuova mappa');
    // Le nuove mappe usano le ultime scelte di accessibilità (tema, carattere…).
    var prefs = MM.storage.getPreferences();
    Object.keys(prefs).forEach(function (k) { map.settings[k] = prefs[k]; });
    return map;
  }

  function newMap(templateId) {
    var map = createFromTemplate(templateId);
    loadIntoEditor(map, { relayout: true });
    saveNow();
    if (MM.interactions && (!templateId || templateId === 'vuota')) {
      MM.interactions.startInlineEdit(map.rootId, { selectAll: true });
    }
  }

  function openMap(id) {
    try {
      var map = MM.storage.loadMap(id);
      if (!map) { toast('Mappa non trovata', 'errore'); return false; }
      loadIntoEditor(map);
      return true;
    } catch (e) {
      toast(e.message, 'errore');
      return false;
    }
  }

  /** Elimina una mappa salvata; se è quella aperta, apre la più recente (o una nuova). */
  function deleteMap(id) {
    MM.storage.deleteMap(id);
    if (MM.sync) MM.sync.deleteMap(id);
    if (state.map && state.map.id === id) {
      state.map = null; // evita che saveNow la ricrei
      var others = MM.storage.listMaps();
      if (others.length) openMap(others[0].id); else newMap('vuota');
    }
  }

  /* ---------- Aggiornamenti remoti (sincronizzazione) ---------- */

  function applyRemoteMap(remoteMap) {
    if (!remoteMap) return;
    if (state.mode === 'modifica') {
      pendingRemoteMap = remoteMap;
      return;
    }
    var prevSel = state.selectedId;
    var prevLink = state.selectedLinkId;
    state.map = remoteMap;
    applyBodySettings(state.map.settings);
    state.selectedId = prevSel && state.map.nodes[prevSel] ? prevSel : state.map.rootId;
    state.selectedLinkId = prevLink && findLink(prevLink) ? prevLink : null;
    if (state.selectedLinkId) state.selectedId = null;
    if (state.renderer) state.renderer.invalidate();
    render();
    refreshUi();
  }

  function onRemoteMapDeleted(id) {
    if (state.map && state.map.id === id) {
      state.map = null;
      var others = MM.storage.listMaps();
      if (others.length) openMap(others[0].id);
      else newMap('vuota');
      toast('La mappa aperta è stata eliminata da un altro dispositivo');
    }
  }

  function onRemoteListChanged() {
    if (ui() && ui().refreshMapList) ui().refreshMapList();
  }

  /* ---------- Pannello Proprietà (apri / chiudi) ---------- */

  function readInitialPropertiesOpen() {
    try {
      var saved = root.localStorage && root.localStorage.getItem(PROPS_KEY);
      if (saved === '1') return true;
      if (saved === '0') return false;
    } catch (e) { /* ignora in modalità privata */ }
    return typeof root.innerWidth === 'number' ? root.innerWidth >= 900 : true;
  }

  function toggleProperties(force) {
    propertiesOpen = typeof force === 'boolean' ? force : !propertiesOpen;
    try {
      if (root.localStorage) root.localStorage.setItem(PROPS_KEY, propertiesOpen ? '1' : '0');
    } catch (e) { /* ignora */ }
    if (ui() && ui().setPropertiesOpen) ui().setPropertiesOpen(propertiesOpen);
  }

  function isPropertiesOpen() {
    return propertiesOpen;
  }

  function importFile(file) {
    return MM.storage.readFile(file).then(function (text) {
      var map = MM.storage.deserialize(text);
      loadIntoEditor(map);
      saveNow();
      toast('Mappa "' + map.title + '" importata', 'successo');
    }).catch(function (e) {
      toast(e.message, 'errore');
    });
  }

  /** Esportazione: 'json' ora; 'png', 'svg', 'print' quando MM.exporter è disponibile. */
  function exportAs(kind) {
    var name = MM.storage.sanitizeFilename(state.map.title);
    if (kind === 'json') {
      MM.storage.downloadFile(name + '.mappa.json', MM.storage.serialize(state.map), 'application/json');
      toast('File "' + name + '.mappa.json" scaricato', 'successo');
      return;
    }
    if (!MM.exporter) { toast('Esportazione non ancora disponibile', 'avviso'); return; }
    if (state.mode === 'modifica' && MM.interactions) MM.interactions.commitInlineEdit();
    try {
      if (kind === 'print') { MM.exporter.print(api); return; }
      if (kind === 'svg') {
        MM.storage.downloadFile(name + '.svg', MM.exporter.toSVGString(state.map, state.renderer), 'image/svg+xml');
        toast('Immagine "' + name + '.svg" scaricata', 'successo');
        return;
      }
    } catch (e) {
      toast(e.message, 'errore');
      return;
    }
    if (kind === 'png') {
      toast('Preparo l\'immagine…');
      MM.exporter.toPNG(state.map, state.renderer, 2).then(function (blob) {
        MM.storage.downloadFile(name + '.png', blob, 'image/png');
        toast('Immagine "' + name + '.png" scaricata', 'successo');
      }).catch(function (e) { toast(e.message, 'errore'); });
    }
  }

  /** Modifica le impostazioni della mappa (tema, disposizione, carattere…). */
  function applySettings(patch) {
    var m = MM.model.clone(state.map);
    Object.keys(patch).forEach(function (k) { m.settings[k] = patch[k]; });
    if (m.settings.fontScale) m.settings.fontScale = Math.max(0.8, Math.min(2, m.settings.fontScale));
    applyBodySettings(m.settings);
    if (['theme', 'uppercase', 'fontScale', 'fontFamily'].some(function (k) { return k in patch; })) {
      MM.storage.setPreferences(m.settings);
    }
    var needsLayout = ['layout', 'fontScale', 'uppercase', 'fontFamily'].some(function (k) { return k in patch; });
    if (state.renderer && ('fontFamily' in patch || 'fontScale' in patch || 'uppercase' in patch)) state.renderer.invalidate();
    commit(m, { relayout: needsLayout });
    if ('layout' in patch) fit();
  }

  /* ---------- Lettura ad alta voce ---------- */

  function speechError(e) { toast(e.message, 'avviso'); }

  function endReading() {
    if (state.renderer) state.renderer.highlight(null);
  }

  /** Legge l'idea selezionata (o il collegamento selezionato). */
  function readSelection() {
    if (!MM.speech) return;
    var link = state.selectedLinkId ? findLink(state.selectedLinkId) : null;
    if (link) {
      var single = MM.model.clone(state.map);
      single.links = [link];
      var seq = MM.speech.mapSequence(single);
      MM.speech.speakSequence([seq[seq.length - 1]]).catch(speechError);
      return;
    }
    var id = state.selectedId || state.map.rootId;
    if (state.renderer) state.renderer.highlight(id);
    MM.speech.speakNode(state.map, id).then(endReading, function (e) { endReading(); speechError(e); });
  }

  /** Legge tutta la mappa evidenziando un'idea alla volta. */
  function readMap() {
    if (!MM.speech) return;
    var map = state.map;
    MM.speech.speakMap(map, function (nodeId) {
      if (!state.renderer) return;
      // Le idee nei rami compressi non sono visibili: si evidenzia solo ciò che si vede.
      state.renderer.highlight(nodeId && state.map === map ? nodeId : null);
      if (nodeId && state.map === map && state.renderer.getNodeElement(nodeId)) revealNode(nodeId);
    }).then(endReading, function (e) { endReading(); speechError(e); });
  }

  function stopReading() {
    if (MM.speech) MM.speech.stop();
    endReading();
  }

  /* ---------- Avvio ---------- */

  /** Apre l'ultima mappa usata, altrimenti la più recente, altrimenti una mappa nuova. */
  function initialMap() {
    var candidates = [MM.storage.getLastMapId()].concat(MM.storage.listMaps().map(function (s) { return s.id; }));
    for (var i = 0; i < candidates.length; i++) {
      if (!candidates[i]) continue;
      try {
        var map = MM.storage.loadMap(candidates[i]);
        if (map) return { map: map, fresh: false };
      } catch (e) {
        toast(e.message, 'errore');
      }
    }
    return { map: createFromTemplate('vuota'), fresh: true };
  }

  function init() {
    var svg = document.getElementById('canvas');
    var world = document.getElementById('world');
    propertiesOpen = readInitialPropertiesOpen();
    state.renderer = MM.renderer.create(svg);
    state.viewport = MM.viewport.create(svg, world);
    if (MM.ui) MM.ui.init(api);
    if (MM.ui && MM.ui.setPropertiesOpen) MM.ui.setPropertiesOpen(propertiesOpen);
    if (MM.interactions) MM.interactions.attach(api);
    if (MM.pwa) MM.pwa.init(api);

    var start = initialMap();
    loadIntoEditor(start.map, { relayout: start.fresh });
    if (start.fresh) saveNow();
    if (MM.sync) MM.sync.init(api);
    svg.focus({ preventScroll: true }); // pronta per le scorciatoie da tastiera

    // Salvataggio immediato quando si chiude o si nasconde la pagina.
    root.addEventListener('beforeunload', saveNow);
    root.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveNow();
    });
    // Le misure reali dipendono dai font: quando sono pronti si ricalcola il disegno.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(function () {
        state.renderer.invalidate();
        render();
      });
    }
  }

  var api = {
    state: state,
    init: init,
    commit: commit,
    tryCommit: tryCommit,
    render: render,
    setTransient: setTransient,
    select: select,
    selectLink: selectLink,
    setMode: setMode,
    revealNode: revealNode,
    addNode: addNode,
    deleteSelection: deleteSelection,
    updateNode: updateNode,
    toggleCollapsed: toggleCollapsed,
    reparent: reparent,
    relayout: relayout,
    undo: undo,
    redo: redo,
    fit: fit,
    zoom: zoom,
    newMap: newMap,
    openMap: openMap,
    deleteMap: deleteMap,
    applyRemoteMap: applyRemoteMap,
    onRemoteMapDeleted: onRemoteMapDeleted,
    onRemoteListChanged: onRemoteListChanged,
    toggleProperties: toggleProperties,
    isPropertiesOpen: isPropertiesOpen,
    importFile: importFile,
    exportAs: exportAs,
    applySettings: applySettings,
    readSelection: readSelection,
    readMap: readMap,
    stopReading: stopReading,
    saveNow: saveNow,
    findLink: findLink,
    getMap: function () { return state.map; },
    canUndo: function () { return !!state.history && MM.history.canUndo(state.history); },
    canRedo: function () { return !!state.history && MM.history.canRedo(state.history); }
  };

  MM.app = api;

  // Avvio automatico solo nella pagina dell'app (non nei test).
  if (typeof document !== 'undefined' && document.getElementById('canvas')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window);
