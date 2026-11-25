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
  var TABS_KEY = 'mm:open-tabs';

  var state = {
    map: null,
    history: null,
    selectedId: null,
    selectedIds: [],
    selectedLinkId: null,
    selectedSummaryId: null,
    unlockedId: null,
    clipboard: null,          // { mode: 'copy'|'cut', nodeId }
    mode: 'normale',          // 'normale' | 'collegamento' | 'modifica'
    pendingLinkFrom: null,
    renderer: null,
    viewport: null,
    openTabs: []
  };
  var transient = {};          // opzioni di disegno temporanee (trascinamento)
  var saveTimer = null;
  var dirty = false;
  var warnedNotPersistent = false;
  var pendingRemoteMap = null;
  var propertiesOpen = true;

  function ui() { return MM.ui || null; }
  function toast(msg, type) { if (ui()) ui().toast(msg, type); }

  function isReadOnly() {
    if (!MM.sync || !MM.sync.isReadOnly || !MM.sync.isReadOnly()) return false;
    var sh = MM.sync.getState && MM.sync.getState().shared;
    return !!(state.map && sh && sh.mapId === state.map.id);
  }

  function guardWritable() {
    if (!isReadOnly()) return true;
    toast('Sei in modalità Lettore: solo gli Editor possono modificare questa mappa', 'avviso');
    return false;
  }

  /* ---------- Disegno ---------- */

  function render(extra) {
    if (!state.map || !state.renderer) return;
    var opts = {
      selectedId: state.selectedId,
      selectedIds: state.selectedIds,
      selectedLinkId: state.selectedLinkId,
      selectedSummaryId: state.selectedSummaryId,
      pendingLinkFrom: state.pendingLinkFrom,
      unlockedId: state.unlockedId
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
    u.renderProperties(state.map, { nodeId: state.selectedId, selectedIds: state.selectedIds, linkId: state.selectedLinkId, summaryId: state.selectedSummaryId });
    u.setTitle(state.map.title);
  }

  /* ---------- Impostazioni visive (tema, carattere) ---------- */

  function applyBodySettings(settings) {
    var body = document.body;
    var resolvedTheme = MM.model.resolveTheme ? MM.model.resolveTheme(settings.theme) : (settings.theme || 'chiaro');
    body.setAttribute('data-theme', resolvedTheme);
    body.classList.toggle('mm-uppercase', !!settings.uppercase);
    var isLeggibile = settings.fontFamily === 'leggibile';
    body.classList.toggle('mm-font-leggibile', isLeggibile);
    if (!isLeggibile && settings.fontName && MM.model.fontCssFor) {
      body.style.setProperty('--mm-font-family', MM.model.fontCssFor(settings.fontName));
    } else {
      body.style.removeProperty('--mm-font-family');
    }
    // Anche l'interfaccia cresce con il testo della mappa, ma in modo attenuato
    // (a 2× la barra degli strumenti non starebbe più sullo schermo).
    var scale = settings.fontScale || 1;
    body.style.setProperty('--mm-font-scale', String(Math.round((1 + (scale - 1) * 0.4) * 100) / 100));
  }

  /* ---------- Salvataggio automatico ---------- */

  function saveNow() {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    if (!state.map || !dirty || isReadOnly()) return;
    try {
      var saved = MM.storage.saveMap(state.map);
      state.map.updatedAt = saved.updatedAt;
      dirty = false;
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
    if (isReadOnly()) return;
    dirty = true;
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
    if (isReadOnly() && !(options && options.fromRemote)) {
      toast('Sei in modalità Lettore: solo gli Editor possono modificare questa mappa', 'avviso');
      render();
      refreshUi();
      return false;
    }
    if (!newMap || newMap === state.map) { refreshUi(); return false; }
    if (o.recordHistory !== false && state.map) {
      state.history = MM.history.push(state.history, state.map);
    }
    state.map = o.relayout ? MM.layout.apply(newMap) : newMap;
    if (state.selectedId && !state.map.nodes[state.selectedId]) state.selectedId = state.map.rootId;
    if (state.selectedIds && state.selectedIds.length) {
      state.selectedIds = state.selectedIds.filter(function (id) { return !!state.map.nodes[id]; });
      if (state.selectedIds.length === 1) {
        state.selectedId = state.selectedIds[0];
        state.selectedIds = [];
      }
    }
    if (state.unlockedId && !state.map.nodes[state.unlockedId]) state.unlockedId = null;
    if (state.selectedLinkId && !findLink(state.selectedLinkId)) state.selectedLinkId = null;
    if (state.selectedSummaryId && !findSummary(state.selectedSummaryId)) state.selectedSummaryId = null;
    render();
    refreshUi();
    notifyTabs();
    if (o.save !== false) scheduleSave();
    return true;
  }

  /** Esegue fn(map) → nuova mappa, mostrando gli errori come notifica. */
  function tryCommit(fn, options) {
    if (!(options && options.fromRemote) && !guardWritable()) return false;
    try {
      var result = fn(state.map);
      if (result) return commit(result, options);
      return false;
    } catch (e) {
      toast(e.message, 'errore');
      return false;
    }
  }

  function findLink(id) {
    for (var i = 0; i < state.map.links.length; i++) if (state.map.links[i].id === id) return state.map.links[i];
    return null;
  }

  function findSummary(id) {
    var list = (state.map && state.map.summaries) || [];
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  /* ---------- Selezione ---------- */

  function select(nodeId, options) {
    if (nodeId && !state.map.nodes[nodeId]) return;
    if (state.unlockedId && state.unlockedId !== nodeId) state.unlockedId = null;
    state.selectedId = nodeId || null;
    state.selectedIds = [];
    state.selectedSummaryId = null;
    if (nodeId) state.selectedLinkId = null;
    render();
    refreshUi();
    if (nodeId && !(options && options.noScroll)) revealNode(nodeId);
  }

  function setMultiSelection(ids) {
    var map = state.map;
    if (!map) return;
    var list = Array.isArray(ids) ? ids : [];
    var seen = {};
    var valid = [];
    for (var i = 0; i < list.length; i++) {
      var id = list[i];
      if (id && map.nodes[id] && !seen[id]) {
        seen[id] = true;
        valid.push(id);
      }
    }
    if (valid.length === 0) {
      state.selectedIds = [];
      state.selectedId = null;
      state.selectedLinkId = null;
      state.selectedSummaryId = null;
      state.unlockedId = null;
      render();
      refreshUi();
      return;
    }
    if (valid.length === 1) {
      select(valid[0], { noScroll: true });
      return;
    }
    state.selectedIds = valid;
    state.selectedId = null;
    state.selectedLinkId = null;
    state.selectedSummaryId = null;
    state.unlockedId = null;
    render();
    refreshUi();
  }

  function toggleNodeInSelection(nodeId) {
    if (!nodeId || !state.map || !state.map.nodes[nodeId]) return;
    var list = state.selectedIds.length ? state.selectedIds.slice() : (state.selectedId ? [state.selectedId] : []);
    var idx = list.indexOf(nodeId);
    if (idx >= 0) list.splice(idx, 1);
    else list.push(nodeId);
    setMultiSelection(list);
  }

  function selectLink(linkId) {
    state.selectedIds = [];
    state.selectedLinkId = linkId && findLink(linkId) ? linkId : null;
    state.selectedSummaryId = null;
    if (state.selectedLinkId) {
      state.selectedId = null;
      state.unlockedId = null;
    }
    render();
    refreshUi();
  }

  function selectSummary(id) {
    state.selectedIds = [];
    state.selectedSummaryId = id && findSummary(id) ? id : null;
    if (state.selectedSummaryId) {
      state.selectedId = null;
      state.selectedLinkId = null;
      state.unlockedId = null;
    }
    render();
    refreshUi();
  }

  function addSummaryForNode(nodeId) {
    if (!guardWritable()) return null;
    var id = nodeId || state.selectedId;
    var node = id && state.map && state.map.nodes[id];
    var parent = node && node.parentId !== null ? state.map.nodes[node.parentId] : null;
    if (!parent || parent.children.length < 2) {
      toast('Servono almeno due nodi fratelli per creare una parentesi graffa', 'avviso');
      return null;
    }
    var idx = parent.children.indexOf(id);
    var otherIdx = idx < parent.children.length - 1 ? idx + 1 : idx - 1;
    var res;
    try {
      res = MM.model.addSummary(state.map, parent.id, id, parent.children[otherIdx], 'Riepilogo');
    } catch (e) {
      toast(e.message, 'errore');
      return null;
    }
    state.selectedSummaryId = res.summaryId;
    state.selectedIds = [];
    state.selectedId = null;
    state.selectedLinkId = null;
    state.unlockedId = null;
    commit(res.map);
    return res.summaryId;
  }

  function addSummaryForSelection() {
    if (!guardWritable()) return null;
    if (state.selectedIds && state.selectedIds.length >= 2) {
      var count = state.selectedIds.length;
      var res;
      try {
        res = MM.model.addSummaryForNodes(state.map, state.selectedIds, 'Riepilogo');
      } catch (e) {
        toast(e.message, 'errore');
        return null;
      }
      state.selectedSummaryId = res.summaryId;
      state.selectedIds = [];
      state.selectedId = null;
      state.selectedLinkId = null;
      state.unlockedId = null;
      commit(res.map);
      toast('Parentesi graffa creata per ' + count + ' nodi', 'successo');
      return res.summaryId;
    }
    return addSummaryForNode(state.selectedId);
  }

  function updateSummary(id, patch, options) {
    return tryCommit(function (m) { return MM.model.updateSummary(m, id, patch); }, options || {});
  }

  function deleteSummary(id) {
    if (!guardWritable()) return false;
    var sid = id || state.selectedSummaryId;
    if (!sid) return false;
    if (state.selectedSummaryId === sid) state.selectedSummaryId = null;
    return tryCommit(function (m) { return MM.model.removeSummary(m, sid); });
  }

  /** Porta il nodo nell'area visibile (senza cambiare lo zoom). */
  function revealNode(nodeId) {
    var n = state.map.nodes[nodeId];
    if (!n || !state.viewport) return;
    var s = MM.layout.measureNode(n, state.map.settings, MM.model.getDepth(state.map, nodeId));
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
    if (!guardWritable()) return null;
    var res;
    if (state.selectedSummaryId) {
      var s = findSummary(state.selectedSummaryId);
      if (!s) return null;
      try {
        if (kind === 'fratello') {
          if (s.endId && state.map.nodes[s.endId]) {
            res = MM.model.addSibling(state.map, s.endId, 'Nuova idea');
          } else if (Array.isArray(s.nodeIds) && s.nodeIds.length) {
            var lastId = null;
            for (var i = s.nodeIds.length - 1; i >= 0; i--) {
              var nid = s.nodeIds[i];
              if (nid && state.map.nodes[nid] && state.map.nodes[nid].parentId !== null) {
                lastId = nid;
                break;
              }
            }
            res = lastId
              ? MM.model.addSibling(state.map, lastId, 'Nuova idea')
              : MM.model.addChild(state.map, state.map.rootId, 'Nuova idea');
          } else {
            res = MM.model.addChild(state.map, state.map.rootId, 'Nuova idea');
          }
        } else {
          res = MM.model.addChildToSummary(state.map, s.id, 'Nuova idea');
        }
      } catch (e) { toast(e.message, 'errore'); return null; }
      state.selectedId = res.nodeId;
      state.selectedIds = [];
      state.selectedLinkId = null;
      state.selectedSummaryId = null;
      commit(res.map, { relayout: true });
      revealNode(res.nodeId);
      if (!(options && options.edit === false) && MM.interactions) MM.interactions.startInlineEdit(res.nodeId, { selectAll: true });
      return res.nodeId;
    }
    try {
      res = kind === 'fratello' ? MM.model.addSibling(state.map, targetId())
        : MM.model.addChild(state.map, targetId());
    } catch (e) { toast(e.message, 'errore'); return null; }
    state.selectedId = res.nodeId;
    state.selectedIds = [];
    state.selectedLinkId = null;
    state.selectedSummaryId = null;
    commit(res.map, { relayout: true });
    revealNode(res.nodeId);
    if (!(options && options.edit === false) && MM.interactions) MM.interactions.startInlineEdit(res.nodeId, { selectAll: true });
    return res.nodeId;
  }

  /** Aggiunge un nuovo nodo centrale (figlio diretto della radice) in modalità confronto. */
  function addCompareCenter() {
    if (!guardWritable()) return null;
    var m = state.map;
    if (!m) return null;
    var res;
    try {
      res = MM.model.addChild(m, m.rootId, 'Nuovo tema');
    } catch (e) { toast(e.message, 'errore'); return null; }
    state.selectedId = res.nodeId;
    state.selectedIds = [];
    state.selectedLinkId = null;
    state.selectedSummaryId = null;
    commit(res.map, { relayout: true });
    revealNode(res.nodeId);
    if (MM.interactions) MM.interactions.startInlineEdit(res.nodeId, { selectAll: true });
    return res.nodeId;
  }

  function deleteSelection() {
    if (!guardWritable()) return;
    if (state.selectedIds && state.selectedIds.length >= 2) {
      var ids = state.selectedIds.slice();
      var removable = ids.filter(function (nid) {
        var n = state.map.nodes[nid];
        return n && n.parentId !== null;
      });
      if (!removable.length) {
        toast('Il nodo centrale non può essere eliminato', 'avviso');
        return;
      }
      var removedCount = 0;
      var ok = tryCommit(function (m) {
        var next = m;
        for (var i = 0; i < removable.length; i++) {
          var rid = removable[i];
          if (!next.nodes[rid] || next.nodes[rid].parentId === null) continue;
          removedCount += MM.model.getDescendants(next, rid).length + 1;
          next = MM.model.removeNode(next, rid);
        }
        return next;
      }, { relayout: true });
      if (ok) {
        state.selectedIds = [];
        select(state.map.rootId, { noScroll: true });
        toast(removedCount > 1 ? 'Eliminati ' + removedCount + ' nodi (Ctrl/Cmd+Z per annullare)' : 'Nodo eliminato (Ctrl/Cmd+Z per annullare)');
      }
      return;
    }
    if (state.selectedSummaryId) {
      deleteSummary(state.selectedSummaryId);
      return;
    }
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

  function updateMultiNodes(patch, options) {
    if (!state.selectedIds || !state.selectedIds.length) return false;
    var ids = state.selectedIds.slice();
    var o = options || {};
    return tryCommit(function (m) {
      var next = m;
      for (var i = 0; i < ids.length; i++) {
        if (next.nodes[ids[i]]) next = MM.model.updateNode(next, ids[i], patch);
      }
      return next;
    }, o);
  }

  function toggleCollapsed(nodeId) {
    var id = nodeId || state.selectedId;
    if (!id || !state.map.nodes[id].children.length) return;
    tryCommit(function (m) { return MM.model.toggleCollapsed(m, id); }, { relayout: true });
  }

  function reparent(nodeId, newParentId) {
    tryCommit(function (m) { return MM.model.reparent(m, nodeId, newParentId); }, { relayout: true });
  }

  function toggleUnlock(nodeId) {
    if (!guardWritable()) return;
    var id = nodeId || state.selectedId;
    if (!id || !state.map || !state.map.nodes[id] || state.map.nodes[id].parentId === null) return;
    state.unlockedId = state.unlockedId === id ? null : id;
    render();
    refreshUi();
    if (state.unlockedId) {
      toast('Lucchetto aperto: trascina il nodo su un altro per spostarlo lì');
    }
  }

  function setUnlocked(nodeId) {
    var next = nodeId || null;
    if (state.unlockedId === next) return;
    state.unlockedId = next;
    render();
    refreshUi();
  }

  function copyNode(nodeId) {
    var id = nodeId || state.selectedId;
    if (!id || !state.map || !state.map.nodes[id]) return;
    state.clipboard = { mode: 'copy', nodeId: id };
    refreshUi();
    toast('Ramo copiato: seleziona un altro nodo e incolla (⌘V)');
  }

  function cutNode(nodeId) {
    if (!guardWritable()) return;
    var id = nodeId || state.selectedId;
    if (!id || !state.map || !state.map.nodes[id]) return;
    if (state.map.nodes[id].parentId === null) {
      toast('Il nodo centrale non può essere staccato', 'avviso');
      return;
    }
    state.clipboard = { mode: 'cut', nodeId: id };
    refreshUi();
    toast('Ramo pronto da spostare: seleziona il nuovo nodo padre e incolla (⌘V)');
  }

  function pasteNode(targetNodeId) {
    if (!guardWritable()) return false;
    var target = targetNodeId || state.selectedId;
    var clip = state.clipboard;
    if (!target || !clip || !state.map) return false;
    if (!state.map.nodes[clip.nodeId] || !state.map.nodes[target]) {
      state.clipboard = null;
      refreshUi();
      return false;
    }
    var targetText = state.map.nodes[target].text.replace(/\s+/g, ' ');
    if (clip.mode === 'cut') {
      try {
        var reparented = MM.model.reparent(state.map, clip.nodeId, target);
        state.clipboard = null;
        state.selectedId = clip.nodeId;
        state.selectedLinkId = null;
        commit(reparented, { relayout: true });
        toast('Ramo spostato sotto "' + targetText + '"', 'successo');
        return true;
      } catch (e) {
        toast(e.message, 'errore');
        return false;
      }
    }
    if (clip.mode === 'copy') {
      try {
        var res = MM.model.cloneSubtree(state.map, clip.nodeId, target);
        state.selectedId = res.nodeId;
        state.selectedLinkId = null;
        commit(res.map, { relayout: true });
        toast('Ramo incollato sotto "' + targetText + '"', 'successo');
        return true;
      } catch (e) {
        toast(e.message, 'errore');
        return false;
      }
    }
    return false;
  }

  function getClipboard() {
    return state.clipboard;
  }

  /** Riapplica la disposizione automatica (annullabile). */
  function relayout() {
    if (!guardWritable()) return false;
    var ok = commit(MM.layout.apply(state.map));
    if (ok) fit({ animate: true });
    return ok;
  }

  /* ---------- Annulla / Ripristina ---------- */

  function undo() {
    if (!guardWritable()) return;
    if (state.mode === 'modifica' && MM.interactions) MM.interactions.commitInlineEdit();
    var r = MM.history.undo(state.history, state.map);
    if (!r.map) { toast('Niente da annullare'); return; }
    state.history = r.history;
    commit(r.map, { recordHistory: false });
    applyBodySettings(state.map.settings);
  }

  function redo() {
    if (!guardWritable()) return;
    var r = MM.history.redo(state.history, state.map);
    if (!r.map) { toast('Niente da ripristinare'); return; }
    state.history = r.history;
    commit(r.map, { recordHistory: false });
    applyBodySettings(state.map.settings);
  }

  /* ---------- Vista ---------- */

  function fit(opts) {
    if (!state.viewport) return;
    state.viewport.fitTo(MM.layout.getBounds(state.map), 60, 1.5, opts);
  }

  function zoom(factor) { if (state.viewport) state.viewport.zoomAt(factor, undefined, undefined, { animate: true }); }

  /* ---------- Schede mappe aperte (stile fogli) ---------- */

  function readSavedTabs() {
    try {
      var raw = root.localStorage && root.localStorage.getItem(TABS_KEY);
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed.filter(function (id) { return typeof id === 'string' && id.length > 0; });
    } catch (e) {
      return [];
    }
  }

  function saveTabs() {
    try {
      if (root.localStorage) root.localStorage.setItem(TABS_KEY, JSON.stringify(state.openTabs));
    } catch (e) { /* ignora in modalità privata */ }
  }

  function syncTabsWithStorage() {
    var valid = {};
    var list = MM.storage.listMaps();
    for (var i = 0; i < list.length; i++) valid[list[i].id] = true;
    if (state.map && state.map.id) valid[state.map.id] = true;
    var seen = {};
    var next = [];
    for (var j = 0; j < state.openTabs.length; j++) {
      var id = state.openTabs[j];
      if (typeof id === 'string' && valid[id] && !seen[id]) {
        seen[id] = true;
        next.push(id);
      }
    }
    if (state.map && state.map.id && !seen[state.map.id]) {
      next.push(state.map.id);
    }
    state.openTabs = next;
    saveTabs();
  }

  function ensureTab(id) {
    if (!id) return;
    if (state.openTabs.indexOf(id) === -1) {
      state.openTabs.push(id);
      saveTabs();
    }
  }

  function removeTabId(id) {
    var idx = state.openTabs.indexOf(id);
    if (idx !== -1) {
      state.openTabs.splice(idx, 1);
      saveTabs();
    }
  }

  function notifyTabs() {
    if (MM.ui && MM.ui.renderTabs) MM.ui.renderTabs();
  }

  function getOpenTabs() {
    var list = MM.storage.listMaps();
    var titles = {};
    for (var i = 0; i < list.length; i++) titles[list[i].id] = list[i].title;
    var activeId = state.map ? state.map.id : null;
    var result = [];
    for (var j = 0; j < state.openTabs.length; j++) {
      var id = state.openTabs[j];
      if (id === activeId) {
        result.push({ id: id, title: state.map.title || 'Senza titolo', active: true });
      } else if (Object.prototype.hasOwnProperty.call(titles, id)) {
        result.push({ id: id, title: titles[id] || 'Senza titolo', active: false });
      }
    }
    return result;
  }

  function switchTab(id) {
    if (!id || (state.map && state.map.id === id)) return;
    saveNow();
    openMap(id);
  }

  function closeTab(id) {
    var idx = state.openTabs.indexOf(id);
    if (idx === -1) return;
    if (state.openTabs.length <= 1) return;
    state.openTabs.splice(idx, 1);
    saveTabs();
    if (state.map && state.map.id === id) {
      var nextId = state.openTabs[Math.max(0, idx - 1)];
      if (!nextId || !openMap(nextId)) notifyTabs();
    } else {
      notifyTabs();
    }
  }

  function openNewTab() {
    newMap('vuota');
  }

  /* ---------- Gestione delle mappe ---------- */

  /** Sostituisce la mappa corrente (nuova cronologia, layout se mancante, adatta la vista). */
  function loadIntoEditor(map, options) {
    if (state.mode === 'modifica' && MM.interactions) MM.interactions.cancelInlineEdit();
    if (MM.speech && MM.speech.isSpeaking()) stopReading();
    if (state.map && !(options && options.skipSavePrevious) && state.map.id !== map.id) saveNow();
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    dirty = false;
    applyBodySettings(map.settings);
    if (state.renderer) state.renderer.invalidate();
    state.history = MM.history.createHistory(100);
    state.map = options && options.relayout ? MM.layout.apply(map) : map;
    state.selectedId = state.map.rootId;
    state.selectedIds = [];
    state.selectedLinkId = null;
    state.selectedSummaryId = null;
    state.unlockedId = null;
    state.clipboard = null;
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
    dirty = true;
    saveNow();
    ensureTab(map.id);
    notifyTabs();
    if (MM.interactions && (!templateId || templateId === 'vuota')) {
      MM.interactions.startInlineEdit(map.rootId, { selectAll: true });
    }
  }

  function openMap(id, options) {
    try {
      var map = MM.storage.loadMap(id);
      if (!map) { toast('Mappa non trovata', 'errore'); return false; }
      loadIntoEditor(map, options);
      ensureTab(map.id);
      notifyTabs();
      return true;
    } catch (e) {
      toast(e.message, 'errore');
      return false;
    }
  }

  /** Elimina una mappa salvata; se è quella aperta, apre la più recente (o una nuova). */
  function deleteMap(id) {
    var sh = MM.sync && MM.sync.getState && MM.sync.getState().shared;
    if (sh && sh.mapId === id) {
      if (!sh.isOwner) {
        if (MM.sync.leaveSharedMap) MM.sync.leaveSharedMap();
        MM.storage.deleteMap(id);
        if (MM.sync.deleteMap) MM.sync.deleteMap(id);
        removeTabId(id);
        if (state.map && state.map.id === id) {
          state.map = null; // evita che saveNow la ricrei
          var rem = MM.storage.listMaps();
          if (rem.length) openMap(rem[0].id); else newMap('vuota');
        }
        notifyTabs();
        toast('Hai lasciato la mappa condivisa (solo il creatore può eliminarla)');
        return;
      }
      if (MM.sync.deleteSharedMap) {
        MM.sync.deleteSharedMap().catch(function () {});
      }
    }
    MM.storage.deleteMap(id);
    if (MM.sync) MM.sync.deleteMap(id);
    removeTabId(id);
    if (state.map && state.map.id === id) {
      state.map = null; // evita che saveNow la ricrei
      var others = MM.storage.listMaps();
      if (others.length) openMap(others[0].id); else newMap('vuota');
    }
    notifyTabs();
  }

  /* ---------- Aggiornamenti remoti (sincronizzazione) ---------- */

  function applyRemoteMap(remoteMap, opts) {
    if (!remoteMap) return;
    if (opts && opts.forceOpen) {
      try {
        MM.storage.saveMap(remoteMap, { touch: false });
      } catch (e) { /* ignora */ }
      openMap(remoteMap.id, { skipSavePrevious: true });
      return;
    }
    if (state.mode === 'modifica') {
      pendingRemoteMap = remoteMap;
      return;
    }
    var prevSel = state.selectedId;
    var prevLink = state.selectedLinkId;
    var prevSummary = state.selectedSummaryId;
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    dirty = false;
    state.map = remoteMap;
    applyBodySettings(state.map.settings);
    state.selectedId = prevSel && state.map.nodes[prevSel] ? prevSel : state.map.rootId;
    state.selectedLinkId = prevLink && findLink(prevLink) ? prevLink : null;
    state.selectedSummaryId = prevSummary && findSummary(prevSummary) ? prevSummary : null;
    if (state.selectedLinkId || state.selectedSummaryId) state.selectedId = null;
    if (state.renderer) state.renderer.invalidate();
    render();
    refreshUi();
    notifyTabs();
  }

  function onRemoteMapDeleted(id) {
    removeTabId(id);
    if (state.map && state.map.id === id) {
      state.map = null;
      var others = MM.storage.listMaps();
      if (others.length) openMap(others[0].id);
      else newMap('vuota');
      toast('La mappa aperta è stata eliminata da un altro dispositivo');
    }
    notifyTabs();
  }

  function onRemoteListChanged() {
    if (ui() && ui().refreshMapList) ui().refreshMapList();
    notifyTabs();
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
      dirty = true;
      saveNow();
      ensureTab(map.id);
      notifyTabs();
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
    if (!guardWritable()) return false;
    var m = MM.model.clone(state.map);
    Object.keys(patch).forEach(function (k) { m.settings[k] = patch[k]; });
    if (m.settings.fontScale) m.settings.fontScale = Math.max(0.8, Math.min(2, m.settings.fontScale));
    applyBodySettings(m.settings);
    if (['theme', 'uppercase', 'fontScale', 'fontFamily', 'fontName'].some(function (k) { return k in patch; })) {
      MM.storage.setPreferences(m.settings);
    }
    var needsLayout = ['layout', 'fontScale', 'uppercase', 'fontFamily', 'fontName', 'sizeByLevel'].some(function (k) { return k in patch; });
    if (state.renderer && ('fontFamily' in patch || 'fontName' in patch || 'fontScale' in patch || 'uppercase' in patch)) state.renderer.invalidate();
    var ok = commit(m, { relayout: needsLayout });
    if (ok && 'layout' in patch) fit({ animate: true });
    return ok;
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
    if (start.fresh) { dirty = true; saveNow(); }
    state.openTabs = readSavedTabs();
    syncTabsWithStorage();
    notifyTabs();
    if (MM.sync) MM.sync.init(api);
    svg.focus({ preventScroll: true }); // pronta per le scorciatoie da tastiera

    // Salvataggio immediato quando si chiude o si nasconde la pagina.
    root.addEventListener('beforeunload', saveNow);
    root.addEventListener('pagehide', saveNow);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden') saveNow();
    });
    // Aggiorna subito il tema se il Mac/iPad passa da chiaro a scuro (modalità "Automatico").
    if (typeof root.matchMedia === 'function') {
      var mq = root.matchMedia('(prefers-color-scheme: dark)');
      var onSchemeChange = function () {
        if (state.map && state.map.settings && state.map.settings.theme === 'auto') {
          applyBodySettings(state.map.settings);
          if (state.renderer) state.renderer.invalidate();
          render();
        }
      };
      if (mq.addEventListener) mq.addEventListener('change', onSchemeChange);
      else if (mq.addListener) mq.addListener(onSchemeChange);
    }
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
    setMultiSelection: setMultiSelection,
    toggleNodeInSelection: toggleNodeInSelection,
    selectLink: selectLink,
    selectSummary: selectSummary,
    addSummaryForNode: addSummaryForNode,
    addSummaryForSelection: addSummaryForSelection,
    updateSummary: updateSummary,
    deleteSummary: deleteSummary,
    setMode: setMode,
    revealNode: revealNode,
    addNode: addNode,
    addCompareCenter: addCompareCenter,
    deleteSelection: deleteSelection,
    updateNode: updateNode,
    updateMultiNodes: updateMultiNodes,
    toggleCollapsed: toggleCollapsed,
    reparent: reparent,
    toggleUnlock: toggleUnlock,
    setUnlocked: setUnlocked,
    copyNode: copyNode,
    cutNode: cutNode,
    pasteNode: pasteNode,
    getClipboard: getClipboard,
    relayout: relayout,
    undo: undo,
    redo: redo,
    fit: fit,
    zoom: zoom,
    newMap: newMap,
    openMap: openMap,
    deleteMap: deleteMap,
    getOpenTabs: getOpenTabs,
    switchTab: switchTab,
    closeTab: closeTab,
    openNewTab: openNewTab,
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
    isReadOnly: isReadOnly,
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
