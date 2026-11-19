/*
 * Mappe Mentali – disposizione automatica dei nodi (logica pura).
 * radial(): mappa mentale a raggiera; tree(): schema ad albero orizzontale.
 * Entrambi garantiscono che i riquadri dei nodi visibili non si sovrappongano.
 */
(function (root) {
  'use strict';
  var MM = root.MM;

  var RING_GAP = 180;     // distanza minima tra anelli (radiale)
  var NODE_GAP = 24;      // spazio minimo tra due nodi
  var LEVEL_GAP = 220;    // distanza minima tra colonne (albero)
  var SIBLING_GAP = 24;   // spazio verticale tra sotto-rami (albero)
  var WRAP_CHARS = 22;    // caratteri per riga prima di andare a capo

  var customMeasurer = null;

  /** Divide il testo in righe di al massimo maxChars caratteri (rispetta gli a capo). */
  function wrapText(text, maxChars) {
    var max = maxChars || WRAP_CHARS;
    var lines = [];
    String(text || '').split('\n').forEach(function (paragraph) {
      var line = '';
      paragraph.split(/\s+/).forEach(function (word) {
        if (!word) return;
        while (word.length > max) { // parola troppo lunga: la spezza
          if (line) { lines.push(line); line = ''; }
          lines.push(word.slice(0, max));
          word = word.slice(max);
        }
        if (!line) line = word;
        else if ((line + ' ' + word).length <= max) line += ' ' + word;
        else { lines.push(line); line = word; }
      });
      lines.push(line);
    });
    return lines.length ? lines : [''];
  }

  /** Stima della dimensione del nodo, usata finché il renderer non fornisce misure reali. */
  function estimateNode(node, settings) {
    var s = settings || {};
    var scale = (s.fontScale || 1) * (node.parentId === null ? 1.25 : 1);
    var charW = 9.5 * scale * (s.uppercase ? 1.15 : 1);
    var lineH = 22 * scale;
    var lines = wrapText(node.text, WRAP_CHARS);
    var longest = lines.reduce(function (m, l) { return Math.max(m, l.length); }, 0);
    if (node.icon) longest += 2;
    var w = Math.max(60, longest * charW + 32);
    var h = Math.max(40, lines.length * lineH + 20);
    if (node.shape === 'ellipse') { w *= 1.2; h *= 1.25; }
    return { width: Math.round(w), height: Math.round(h) };
  }

  /** Imposta (o rimuove con null) una funzione di misura reale: fn(node, settings) -> {width, height}. */
  function setMeasurer(fn) {
    customMeasurer = typeof fn === 'function' ? fn : null;
  }

  function measureNode(node, settings) {
    return customMeasurer ? customMeasurer(node, settings) : estimateNode(node, settings);
  }

  /** Figli visibili (nessuno se il nodo è compresso). */
  function visibleChildren(map, id) {
    var n = map.nodes[id];
    return n.collapsed ? [] : n.children.filter(function (c) { return !!map.nodes[c]; });
  }

  /** Visita dei nodi visibili: restituisce {ids, depth, sizes}. */
  function collectVisible(map) {
    var ids = [];
    var depth = {};
    var sizes = {};
    var queue = [map.rootId];
    depth[map.rootId] = 0;
    while (queue.length) {
      var id = queue.shift();
      ids.push(id);
      sizes[id] = measureNode(map.nodes[id], map.settings);
      visibleChildren(map, id).forEach(function (c) {
        depth[c] = depth[id] + 1;
        queue.push(c);
      });
    }
    return { ids: ids, depth: depth, sizes: sizes };
  }

  /** true se i riquadri dei due nodi (più un margine gap) si sovrappongono. */
  function overlaps(pa, sa, pb, sb, gap) {
    return Math.abs(pa.x - pb.x) < (sa.width + sb.width) / 2 + gap &&
      Math.abs(pa.y - pb.y) < (sa.height + sb.height) / 2 + gap;
  }

  /* ---------- Albero orizzontale ---------- */

  function tree(map) {
    var m = MM.model.clone(map);
    var info = collectVisible(m);
    var maxW = [];
    info.ids.forEach(function (id) {
      var d = info.depth[id];
      maxW[d] = Math.max(maxW[d] || 0, info.sizes[id].width);
    });
    var colX = [0];
    for (var d = 1; d < maxW.length; d++) {
      colX[d] = colX[d - 1] + Math.max(LEVEL_GAP, maxW[d - 1] / 2 + maxW[d] / 2 + 60);
    }

    var bandH = {};
    function subtreeHeight(id) {
      if (bandH[id] !== undefined) return bandH[id];
      var kids = visibleChildren(m, id);
      var sum = 0;
      kids.forEach(function (c, i) { sum += subtreeHeight(c) + (i > 0 ? SIBLING_GAP : 0); });
      bandH[id] = Math.max(info.sizes[id].height, sum);
      return bandH[id];
    }

    (function place(id, centerY) {
      var n = m.nodes[id];
      n.x = colX[info.depth[id]];
      n.y = Math.round(centerY);
      var kids = visibleChildren(m, id);
      var total = 0;
      kids.forEach(function (c, i) { total += subtreeHeight(c) + (i > 0 ? SIBLING_GAP : 0); });
      var cursor = centerY - total / 2;
      kids.forEach(function (c) {
        var h = subtreeHeight(c);
        place(c, cursor + h / 2);
        cursor += h + SIBLING_GAP;
      });
    })(m.rootId, 0);
    return m;
  }

  /* ---------- Raggiera (mappa mentale) ---------- */

  function placeRadial(m, info, radii) {
    var leaves = {};
    function countLeaves(id) {
      var kids = visibleChildren(m, id);
      var sum = 0;
      kids.forEach(function (c) { sum += countLeaves(c); });
      leaves[id] = Math.max(1, sum);
      return leaves[id];
    }
    countLeaves(m.rootId);

    m.nodes[m.rootId].x = 0;
    m.nodes[m.rootId].y = 0;
    (function place(id, start, end) {
      var kids = visibleChildren(m, id);
      var total = 0;
      kids.forEach(function (c) { total += leaves[c]; });
      var cursor = start;
      kids.forEach(function (c) {
        var span = (end - start) * leaves[c] / total;
        var angle = cursor + span / 2;
        var r = radii[info.depth[c]];
        m.nodes[c].x = Math.round(r * Math.cos(angle));
        m.nodes[c].y = Math.round(r * Math.sin(angle));
        place(c, cursor, cursor + span);
        cursor += span;
      });
    })(m.rootId, -Math.PI / 2, 3 * Math.PI / 2); // si parte dall'alto, in senso orario
  }

  /** Profondità minima (>= 1) coinvolta in una sovrapposizione, oppure 0 se non ce ne sono. */
  function findOverlap(m, info) {
    var minDepth = 0;
    for (var i = 0; i < info.ids.length; i++) {
      for (var j = i + 1; j < info.ids.length; j++) {
        var a = info.ids[i];
        var b = info.ids[j];
        if (overlaps(m.nodes[a], info.sizes[a], m.nodes[b], info.sizes[b], NODE_GAP / 2)) {
          var d = Math.max(1, Math.min(info.depth[a], info.depth[b]));
          if (!minDepth || d < minDepth) minDepth = d;
        }
      }
    }
    return minDepth;
  }

  function radial(map) {
    var m = MM.model.clone(map);
    var info = collectVisible(m);
    var maxDepth = 0;
    var maxDiag = [];
    info.ids.forEach(function (id) {
      var d = info.depth[id];
      var s = info.sizes[id];
      maxDepth = Math.max(maxDepth, d);
      maxDiag[d] = Math.max(maxDiag[d] || 0, Math.sqrt(s.width * s.width + s.height * s.height));
    });
    if (maxDepth === 0) {
      m.nodes[m.rootId].x = 0;
      m.nodes[m.rootId].y = 0;
      return m;
    }
    // Raggi iniziali: distanza tra anelli sufficiente per le dimensioni dei nodi.
    var gaps = [0];
    for (var d = 1; d <= maxDepth; d++) {
      gaps[d] = Math.max(RING_GAP, (maxDiag[d - 1] + maxDiag[d]) / 2 + NODE_GAP);
    }
    function radiiFromGaps() {
      var r = [0];
      for (var k = 1; k <= maxDepth; k++) r[k] = r[k - 1] + gaps[k];
      return r;
    }
    placeRadial(m, info, radiiFromGaps());
    // Correzione: allarga solo l'anello dove c'è una sovrapposizione (gli anelli
    // esterni si spostano di conseguenza), così la mappa resta compatta.
    for (var iter = 0; iter < 60; iter++) {
      var depth = findOverlap(m, info);
      if (!depth) break;
      gaps[depth] *= 1.12;
      placeRadial(m, info, radiiFromGaps());
    }
    // Riserva per casi estremi: ingrandisce tutto in modo uniforme.
    for (var extra = 0; extra < 30 && findOverlap(m, info); extra++) {
      for (var g = 1; g <= maxDepth; g++) gaps[g] *= 1.15;
      placeRadial(m, info, radiiFromGaps());
    }
    return m;
  }

  /** Applica la disposizione scelta nelle impostazioni della mappa. */
  function apply(map) {
    return map.settings && map.settings.layout === 'tree' ? tree(map) : radial(map);
  }

  /** Riquadro che contiene tutti i nodi visibili. */
  function getBounds(map) {
    var info = collectVisible(map);
    var b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
    info.ids.forEach(function (id) {
      var n = map.nodes[id];
      var s = info.sizes[id];
      b.minX = Math.min(b.minX, n.x - s.width / 2);
      b.maxX = Math.max(b.maxX, n.x + s.width / 2);
      b.minY = Math.min(b.minY, n.y - s.height / 2);
      b.maxY = Math.max(b.maxY, n.y + s.height / 2);
    });
    return b;
  }

  MM.layout = {
    RING_GAP: RING_GAP,
    LEVEL_GAP: LEVEL_GAP,
    SIBLING_GAP: SIBLING_GAP,
    WRAP_CHARS: WRAP_CHARS,
    wrapText: wrapText,
    estimateNode: estimateNode,
    setMeasurer: setMeasurer,
    measureNode: measureNode,
    radial: radial,
    tree: tree,
    apply: apply,
    getBounds: getBounds,
    overlaps: overlaps
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
