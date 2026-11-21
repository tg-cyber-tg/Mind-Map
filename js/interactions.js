/*
 * Mappe Mentali – interazioni: mouse, touch e penna (Pointer Events),
 * scorciatoie da tastiera e modifica del testo in linea.
 * Il testo si modifica in una <textarea> HTML sovrapposta al nodo
 * (niente foreignObject: su Safari è poco affidabile).
 */
(function (root) {
  'use strict';
  var MM = root.MM;

  var DRAG_THRESHOLD = 3;      // px prima che un clic diventi trascinamento
  var DOUBLE_TAP_MS = 350;

  var app = null;
  var svg = null;
  var pointers = {};           // pointerId -> { x, y }
  var gesture = null;          // gesto in corso
  var dragRaf = null;          // coalescing rAF per trascinamento nodi a 60–120fps
  var pendingDrag = null;      // ultimo punto pointermove in attesa del frame
  var lastTap = { id: null, time: 0, x: 0, y: 0 };
  var editor = null;           // modifica in linea in corso

  /* ---------- Utilità ---------- */

  function nodeIdFrom(target) {
    var g = target && target.closest ? target.closest('.node') : null;
    return g ? g.getAttribute('data-id') : null;
  }

  function linkIdFrom(target) {
    var e = target && target.closest ? target.closest('[data-link-id]') : null;
    return e ? e.getAttribute('data-link-id') : null;
  }

  function distance(a, b) {
    var dx = a.x - b.x;
    var dy = a.y - b.y;
    return Math.sqrt(dx * dx + dy * dy);
  }

  function pointerList() {
    return Object.keys(pointers).map(function (k) { return pointers[k]; });
  }

  /** Nodo visibile sotto il punto (mondo), escludendo gli id indicati. */
  function nodeAtWorld(map, p, exclude) {
    var ids = MM.model.getVisibleNodeIds(map);
    for (var i = ids.length - 1; i >= 0; i--) {
      var id = ids[i];
      if (exclude[id]) continue;
      var n = map.nodes[id];
      var s = MM.layout.measureNode(n, map.settings);
      if (Math.abs(p.x - n.x) <= s.width / 2 && Math.abs(p.y - n.y) <= s.height / 2) return id;
    }
    return null;
  }

  /* ---------- Puntatore: mouse, dita, penna ---------- */

  function onPointerDown(e) {
    if (e.button !== undefined && e.button > 0 && e.pointerType === 'mouse') return; // solo tasto sinistro
    if (editor) commitInlineEdit();
    svg.focus({ preventScroll: true });
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* non essenziale */ }

    var list = pointerList();
    if (list.length === 2) {           // due dita: pinch-zoom + pan
      cancelNodeDrag();
      gesture = { type: 'pinch', dist: distance(list[0], list[1]), center: midpoint(list[0], list[1]) };
      return;
    }
    if (list.length > 2) return;

    var map = app.getMap();
    var nodeId = nodeIdFrom(e.target);
    var start = { x: e.clientX, y: e.clientY };
    if (nodeId) {
      var descendants = MM.model.getDescendants(map, nodeId);
      var exclude = {};
      exclude[nodeId] = true;
      descendants.forEach(function (id) { exclude[id] = true; });
      gesture = {
        type: 'node', id: nodeId, start: start, moved: false,
        startWorld: app.state.viewport.screenToWorld(e.clientX, e.clientY),
        origMap: map, origPos: { x: map.nodes[nodeId].x, y: map.nodes[nodeId].y },
        movedIds: [nodeId].concat(descendants),
        exclude: exclude,
        onBadge: !!(e.target.closest && e.target.closest('.badge-collapsed'))
      };
    } else {
      gesture = { type: 'pan', start: start, last: start, moved: false, linkId: linkIdFrom(e.target) };
    }
  }

  function midpoint(a, b) { return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; }

  /** Copia leggera della mappa con i soli nodi spostati (evita deep-clone JSON a 120fps). */
  function fastMoveMap(orig, movedIds, dx, dy) {
    var nodes = {};
    var origNodes = orig.nodes;
    var keys = Object.keys(origNodes);
    for (var i = 0; i < keys.length; i++) nodes[keys[i]] = origNodes[keys[i]];
    for (var j = 0; j < movedIds.length; j++) {
      var id = movedIds[j];
      var src = origNodes[id];
      if (!src) continue;
      var copy = {};
      var nk = Object.keys(src);
      for (var k = 0; k < nk.length; k++) copy[nk[k]] = src[nk[k]];
      copy.x = src.x + dx;
      copy.y = src.y + dy;
      nodes[id] = copy;
    }
    return {
      version: orig.version, id: orig.id, title: orig.title, rootId: orig.rootId,
      nodes: nodes, links: orig.links, settings: orig.settings,
      createdAt: orig.createdAt, updatedAt: orig.updatedAt
    };
  }

  function flushNodeDrag() {
    dragRaf = null;
    if (!pendingDrag || !gesture || gesture.type !== 'node') return;
    var pd = pendingDrag;
    pendingDrag = null;
    var vp = app.state.viewport;
    var w = vp.screenToWorld(pd.x, pd.y);
    var orig = gesture.origMap;
    var isRoot = orig.nodes[gesture.id].parentId === null;
    var dx = w.x - gesture.startWorld.x;
    var dy = w.y - gesture.startWorld.y;
    var moved = fastMoveMap(orig, gesture.movedIds, dx, dy);
    app.state.map = moved;
    gesture.lastMap = moved;
    var nextDrop = pd.altKey && !isRoot ? nodeAtWorld(moved, w, gesture.exclude) : null;
    var dropChanged = nextDrop !== gesture.dropTarget;
    gesture.dropTarget = nextDrop;
    if (!dropChanged && app.state.renderer && app.state.renderer.moveNodesFast) {
      app.state.renderer.moveNodesFast(moved, gesture.movedIds, {
        selectedId: app.state.selectedId,
        selectedLinkId: app.state.selectedLinkId
      });
    } else {
      app.render({ draggingId: gesture.id, dropTargetId: gesture.dropTarget });
    }
  }

  function onPointerMove(e) {
    if (!pointers[e.pointerId]) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (!gesture) return;
    var vp = app.state.viewport;

    if (gesture.type === 'pinch') {
      var list = pointerList();
      if (list.length < 2) return;
      var d = distance(list[0], list[1]);
      var c = midpoint(list[0], list[1]);
      var local = vp.clientToLocal(c.x, c.y);
      vp.panBy(c.x - gesture.center.x, c.y - gesture.center.y);
      if (gesture.dist > 0) vp.zoomAt(d / gesture.dist, local.x, local.y);
      gesture.dist = d;
      gesture.center = c;
      return;
    }

    var p = { x: e.clientX, y: e.clientY };
    if (!gesture.moved && distance(p, gesture.start) < DRAG_THRESHOLD) return;
    gesture.moved = true;

    if (gesture.type === 'pan') {
      vp.panBy(p.x - gesture.last.x, p.y - gesture.last.y);
      gesture.last = p;
      svg.classList.add('panning');
      return;
    }

    if (gesture.type === 'node') {
      if (app.state.mode === 'collegamento') return;
      svg.classList.add('is-dragging');
      pendingDrag = { x: p.x, y: p.y, altKey: e.altKey };
      if (!dragRaf) {
        if (typeof root.requestAnimationFrame === 'function') dragRaf = root.requestAnimationFrame(flushNodeDrag);
        else flushNodeDrag();
      }
    }
  }

  function onPointerUp(e) {
    if (!pointers[e.pointerId]) return;
    delete pointers[e.pointerId];
    try { svg.releasePointerCapture(e.pointerId); } catch (err) { /* già rilasciato */ }
    svg.classList.remove('panning');
    svg.classList.remove('is-dragging');
    if (dragRaf && typeof root.cancelAnimationFrame === 'function') {
      root.cancelAnimationFrame(dragRaf);
      dragRaf = null;
    }
    if (pendingDrag) flushNodeDrag();
    var g = gesture;
    if (!g) return;
    if (g.type === 'pinch') {
      if (pointerList().length === 0) gesture = null;
      return;
    }
    gesture = null;

    if (g.type === 'node') {
      if (g.moved && app.state.mode !== 'collegamento') {
        finishNodeDrag(g);
        return;
      }
      if (g.onBadge) { app.select(g.id, { noScroll: true }); app.toggleCollapsed(g.id); return; }
      handleNodeTap(g.id, e);
      return;
    }

    if (g.type === 'pan' && !g.moved) {
      if (g.linkId) { app.selectLink(g.linkId); return; }
      if (isDoubleTap(null, e)) {
        // Doppio clic sullo sfondo: nuova idea collegata al nodo centrale.
        app.select(app.getMap().rootId, { noScroll: true });
        app.addNode('figlio');
        return;
      }
      if (app.state.mode === 'collegamento') { app.setMode('normale'); return; }
      app.selectLink(null);
    }
  }

  function finishNodeDrag(g) {
    var orig = g.origMap;
    var target = g.dropTarget;
    app.state.map = orig; // la cronologia riparte dallo stato di inizio gesto
    if (target) {
      try {
        var reparented = MM.model.reparent(orig, g.id, target);
        app.state.selectedId = g.id;
        app.commit(reparented, { relayout: true });
        if (MM.ui) MM.ui.toast('Nodo spostato sotto "' + orig.nodes[target].text + '"', 'successo');
      } catch (err) {
        app.render({});
        if (MM.ui) MM.ui.toast(err.message, 'errore');
      }
    } else {
      // Un solo passo di annulla per tutto il trascinamento (commit registra orig).
      app.state.selectedId = g.id;
      app.commit(g.lastMap || orig);
    }
    app.setTransient({});
  }

  /** Interrompe un trascinamento in corso riportando il nodo alla posizione iniziale. */
  function cancelNodeDrag() {
    if (dragRaf && typeof root.cancelAnimationFrame === 'function') {
      root.cancelAnimationFrame(dragRaf);
      dragRaf = null;
    }
    pendingDrag = null;
    svg.classList.remove('is-dragging');
    if (gesture && gesture.type === 'node' && gesture.moved) {
      app.state.map = gesture.origMap;
      app.setTransient({});
    }
    gesture = null;
  }

  /** Doppio clic/tocco riconosciuto a mano (funziona uguale con mouse, dita e penna). */
  function isDoubleTap(id, e) {
    var now = Date.now();
    var p = { x: e.clientX, y: e.clientY };
    var hit = lastTap.id === id && now - lastTap.time < DOUBLE_TAP_MS && distance(p, lastTap) < 12;
    lastTap = hit ? { id: null, time: 0, x: 0, y: 0 } : { id: id, time: now, x: p.x, y: p.y };
    return hit;
  }

  function handleNodeTap(id, e) {
    var st = app.state;
    if (st.mode === 'collegamento') {
      if (!st.pendingLinkFrom) {
        st.pendingLinkFrom = id;
        app.select(id, { noScroll: true });
        if (MM.ui) MM.ui.toast('Ora scegli il nodo da collegare');
        return;
      }
      createLink(st.pendingLinkFrom, id);
      return;
    }
    if (isDoubleTap(id, e)) {
      app.select(id, { noScroll: true });
      startInlineEdit(id);
      return;
    }
    app.select(id, { noScroll: true });
  }

  /** Crea un collegamento trasversale e torna alla modalità normale. */
  function createLink(fromId, toId) {
    var linkId = null;
    var ok = app.tryCommit(function (m) {
      var r = MM.model.addLink(m, fromId, toId, '');
      linkId = r.linkId;
      return r.map;
    });
    app.setMode('normale');
    if (ok && linkId) {
      app.selectLink(linkId);
      if (MM.ui) MM.ui.toast('Collegamento creato: scrivi un\'etichetta nel pannello a destra', 'successo');
    }
  }

  /** Avvia la modalità collegamento a partire dal nodo selezionato (tasto L o pulsante). */
  function startLinkMode() {
    var st = app.state;
    if (st.mode === 'collegamento') { app.setMode('normale'); return; }
    app.setMode('collegamento');
    st.pendingLinkFrom = st.selectedId || null;
    app.render();
    if (MM.ui) {
      MM.ui.toast(st.pendingLinkFrom ? 'Clicca il nodo da collegare (Esc per annullare)'
        : 'Clicca il primo nodo, poi il secondo (Esc per annullare)');
    }
  }

  /* ---------- Rotella e trackpad ---------- */

  function onWheel(e) {
    e.preventDefault();
    var vp = app.state.viewport;
    var local = vp.clientToLocal(e.clientX, e.clientY);
    var dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    var dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
    // Pinch sul trackpad (il browser imposta ctrlKey) o rotella del mouse: zoom.
    // Scorrimento a due dita sul trackpad: spostamento. La rotella si riconosce
    // (euristica) da deltaMode a righe o da wheelDelta multiplo di 120 senza deltaX.
    var mouseWheel = e.deltaMode === 1 ||
      (!e.deltaX && e.wheelDeltaY && Math.abs(e.wheelDeltaY) % 120 === 0);
    if (e.ctrlKey || e.metaKey || (mouseWheel && !e.shiftKey)) {
      vp.zoomAt(Math.exp(-dy * (e.ctrlKey ? 0.01 : 0.002)), local.x, local.y);
    } else {
      vp.panBy(-dx, -dy);
    }
  }

  /* ---------- Navigazione con le frecce (per vicinanza) ---------- */

  /** Nodo visibile più vicino nella direzione indicata ('left'|'right'|'up'|'down'). */
  function findNeighbor(map, fromId, dir) {
    var from = map.nodes[fromId];
    var best = null;
    var bestScore = Infinity;
    MM.model.getVisibleNodeIds(map).forEach(function (id) {
      if (id === fromId) return;
      var n = map.nodes[id];
      var dx = n.x - from.x;
      var dy = n.y - from.y;
      var main = dir === 'left' ? -dx : dir === 'right' ? dx : dir === 'up' ? -dy : dy;
      var side = dir === 'left' || dir === 'right' ? Math.abs(dy) : Math.abs(dx);
      if (main <= 0) return;
      var score = main + side * 2; // privilegia i nodi allineati
      if (score < bestScore) { bestScore = score; best = id; }
    });
    return best;
  }

  /* ---------- Tastiera ---------- */

  /** true se il focus è in un campo di testo (pannello, finestre): niente scorciatoie. */
  function typingInField(e) {
    var t = e.target;
    if (!t || t === svg) return false;
    var tag = t.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || t.isContentEditable;
  }

  function onKeyDown(e) {
    if (editor) return;                       // la textarea gestisce i propri tasti
    var mod = e.ctrlKey || e.metaKey;
    var key = e.key;
    var openDialog = document.querySelector('dialog[open]');

    // Scorciatoie globali (valgono anche fuori dall'area della mappa).
    if (mod && !e.altKey && (key === 'z' || key === 'Z') && !typingInField(e) && !openDialog) {
      e.preventDefault();
      if (e.shiftKey) app.redo(); else app.undo();
      return;
    }
    if (mod && (key === 'y' || key === 'Y') && !typingInField(e) && !openDialog) {
      e.preventDefault(); app.redo(); return;
    }
    if (mod && (key === 's' || key === 'S')) {
      e.preventDefault(); app.saveNow(); app.exportAs('json'); return;
    }
    if (typingInField(e) || openDialog) return;
    if (mod && key === '0') { e.preventDefault(); app.fit(); return; }
    if (mod) return;
    // Tab, Invio, Spazio… agiscono sulla mappa solo se il focus è sull'area di lavoro:
    // altrove (barra, pannello) mantengono il comportamento normale della pagina.
    if (e.target !== svg) return;

    // Le altre scorciatoie valgono quando non si sta scrivendo altrove.
    var st = app.state;
    var map = app.getMap();
    var handled = true;
    switch (key) {
      case 'Tab':
        app.addNode('figlio');
        break;
      case 'Enter':
        if (st.selectedLinkId && MM.ui) MM.ui.focusLinkLabel();
        else app.addNode('fratello');
        break;
      case 'F2':
      case ' ':
        if (st.selectedId) startInlineEdit(st.selectedId);
        else if (st.selectedLinkId && MM.ui) MM.ui.focusLinkLabel();
        break;
      case 'Delete':
      case 'Backspace':
        app.deleteSelection();
        break;
      case 'r':
      case 'R':
        if (e.altKey) { handled = false; break; }
        app.readSelection();
        break;
      case 'Escape':
        if (MM.speech && MM.speech.isSpeaking()) { app.stopReading(); break; }
        if (st.mode === 'collegamento') { app.setMode('normale'); if (MM.ui) MM.ui.toast('Collegamento annullato'); }
        else if (st.selectedLinkId) app.selectLink(null);
        else app.select(map.rootId);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
      case 'ArrowUp':
      case 'ArrowDown':
        var from = st.selectedId || map.rootId;
        var next = st.selectedId ? findNeighbor(map, from, key.slice(5).toLowerCase()) : from;
        if (next) app.select(next);
        break;
      case '+':
      case '=':
        app.zoom(1.2);
        break;
      case '-':
      case '_':
        app.zoom(1 / 1.2);
        break;
      case 'l':
      case 'L':
        if (mod || e.altKey) { handled = false; break; }
        startLinkMode();
        break;
      case '.':
        app.toggleCollapsed();
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  }

  /* ---------- Modifica del testo in linea ---------- */

  /** Posiziona la textarea sopra il nodo, con le stesse dimensioni sullo schermo. */
  function positionEditor() {
    if (!editor) return;
    var map = app.getMap();
    var node = map.nodes[editor.nodeId];
    if (!node) { cancelInlineEdit(); return; }
    var vp = app.state.viewport;
    var scale = vp.getState().scale;
    var size = MM.layout.measureNode(node, map.settings);
    var c = vp.worldToScreen(node.x, node.y);
    var w = Math.max(size.width * scale, 180);
    var h = Math.max(size.height * scale, 48);
    var ta = editor.textarea;
    ta.style.left = (c.x - w / 2 + root.scrollX) + 'px';
    ta.style.top = (c.y - h / 2 + root.scrollY) + 'px';
    ta.style.width = w + 'px';
    ta.style.minHeight = h + 'px';
    ta.style.fontSize = Math.max(14, MM.renderer.fontSizeFor(node, map.settings) * scale) + 'px';
  }

  function autoGrow() {
    var ta = editor && editor.textarea;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = ta.scrollHeight + 'px';
  }

  /** Apre la modifica del testo del nodo. options.selectAll seleziona tutto il testo. */
  function startInlineEdit(nodeId, options) {
    if (editor) commitInlineEdit();
    var map = app.getMap();
    var node = map.nodes[nodeId];
    if (!node) return;
    app.revealNode(nodeId);
    var ta = document.createElement('textarea');
    ta.className = 'inline-editor';
    ta.value = node.text;
    ta.maxLength = MM.model.MAX_TEXT;
    ta.setAttribute('aria-label', 'Testo del nodo (Invio per confermare, Maiusc+Invio per andare a capo, Esc per annullare)');
    ta.style.background = node.color;
    ta.style.color = MM.model.textColorFor(node.color);
    editor = { nodeId: nodeId, textarea: ta, original: node.text };
    document.body.appendChild(ta);
    var gEl = app.state.renderer.getNodeElement(nodeId);
    if (gEl) gEl.classList.add('editing');
    app.setMode('modifica');
    positionEditor();
    autoGrow();
    ta.focus();
    if (options && options.selectAll) ta.select();
    else ta.setSelectionRange(ta.value.length, ta.value.length);

    ta.addEventListener('keydown', function (e) {
      e.stopPropagation();
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        commitInlineEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelInlineEdit();
      } else if (e.key === 'Tab') {
        // Tab mentre si scrive: conferma e crea subito un figlio (flusso veloce).
        e.preventDefault();
        commitInlineEdit();
        app.addNode(e.shiftKey ? 'fratello' : 'figlio');
      }
    });
    ta.addEventListener('input', autoGrow);
    ta.addEventListener('blur', function () {
      // Rinviato: un clic su un pulsante deve poter leggere lo stato prima della chiusura.
      setTimeout(function () { if (editor && editor.textarea === ta) commitInlineEdit(); }, 0);
    });
  }

  function closeEditor() {
    if (!editor) return null;
    var e = editor;
    editor = null;
    if (e.textarea.parentNode) e.textarea.parentNode.removeChild(e.textarea);
    var gEl = app.state.renderer.getNodeElement(e.nodeId);
    if (gEl) gEl.classList.remove('editing');
    if (app.state.mode === 'modifica') app.setMode('normale');
    svg.focus({ preventScroll: true });
    return e;
  }

  /** Conferma il testo scritto (un solo passo di annulla). */
  function commitInlineEdit() {
    var e = closeEditor();
    if (!e) return;
    var text = e.textarea.value.replace(/\s+$/g, '');
    if (!text.trim()) text = e.original || 'Nuova idea';
    if (text !== e.original) app.updateNode(e.nodeId, { text: text }, { relayout: true });
  }

  function cancelInlineEdit() {
    closeEditor();
  }

  /* ---------- Collegamento degli eventi ---------- */

  function attach(appApi) {
    app = appApi;
    svg = document.getElementById('canvas');
    svg.addEventListener('pointerdown', onPointerDown);
    svg.addEventListener('pointermove', onPointerMove);
    svg.addEventListener('pointerup', onPointerUp);
    svg.addEventListener('pointercancel', function (e) {
      cancelNodeDrag();
      delete pointers[e.pointerId];
      svg.classList.remove('panning');
    });
    svg.addEventListener('wheel', onWheel, { passive: false });
    svg.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    // Safari (iPad/Mac): evita lo zoom della pagina durante il pinch.
    ['gesturestart', 'gesturechange'].forEach(function (t) {
      svg.addEventListener(t, function (e) { e.preventDefault(); });
    });
    document.addEventListener('keydown', onKeyDown);
    // La textarea segue il nodo quando la vista cambia o la finestra si ridimensiona.
    app.state.viewport.onChange(positionEditor);
    root.addEventListener('resize', positionEditor);
  }

  MM.interactions = {
    attach: attach,
    startInlineEdit: startInlineEdit,
    commitInlineEdit: commitInlineEdit,
    cancelInlineEdit: cancelInlineEdit,
    isEditing: function () { return !!editor; },
    startLinkMode: startLinkMode,
    findNeighbor: findNeighbor
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
