/*
 * Mappe Mentali – disposizione automatica dei nodi (logica pura).
 * Disposizioni supportate: radial, tree, balanced, org, timeline, fishbone, outline, compare.
 * Tutte garantiscono che i riquadri dei nodi visibili non si sovrappongano.
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
  function estimateNode(node, settings, depth) {
    var s = settings || {};
    var bs = MM.model && MM.model.boxScaleFor ? MM.model.boxScaleFor(node, s, depth) : (node.parentId === null ? 1.25 : 1);
    var baseScale = node.fontSize ? (Number(node.fontSize) / 16) : bs;
    var scale = (s.fontScale || 1) * baseScale;
    var charW = 9.5 * scale * ((s.uppercase || node.uppercase) ? 1.15 : 1);
    var lineH = 22 * scale;
    var lines = wrapText(node.text, WRAP_CHARS);
    var longest = lines.reduce(function (m, l) { return Math.max(m, l.length); }, 0);
    if (node.personMode) {
      var avD = Math.round(64 * bs);
      var roleLines = node.role ? wrapText(node.role, 24) : [];
      var longestRole = roleLines.reduce(function (m, l) { return Math.max(m, l.length); }, 0);
      var roleCharW = charW * 0.84;
      var roleLineH = lineH * 0.84;
      var pw = Math.max(avD + 24, longest * charW + 20, longestRole * roleCharW + 20);
      var ph = avD + 12 + lines.length * lineH + (roleLines.length ? 4 + roleLines.length * roleLineH : 0) + 12;
      return { width: Math.round(pw), height: Math.round(ph) };
    }
    if (node.icon) longest += 2;
    var w = Math.max(60, longest * charW + 32);
    var h = Math.max(40, lines.length * lineH + 20);
    var ib = MM.model && MM.model.imageBoxFor ? MM.model.imageBoxFor(node, bs) : null;
    if (ib) { w = Math.max(w, ib.width + 22); h += ib.height + 8; }
    if (node.shape === 'ellipse') { w *= 1.2; h *= 1.25; }
    if (node.shape === 'circle') { var diam = Math.ceil(Math.max(w, h) * 1.25); w = diam; h = diam; }
    return { width: Math.round(w), height: Math.round(h) };
  }

  /** Imposta (o rimuove con null) una funzione di misura reale: fn(node, settings) -> {width, height}. */
  function setMeasurer(fn) {
    customMeasurer = typeof fn === 'function' ? fn : null;
  }

  function measureNode(node, settings, depth) {
    return customMeasurer ? customMeasurer(node, settings, depth) : estimateNode(node, settings, depth);
  }

  /** Figli visibili (nessuno se il nodo è compresso). */
  function visibleChildren(map, id) {
    var n = map.nodes[id];
    return n.collapsed ? [] : n.children.filter(function (c) { return !!map.nodes[c]; });
  }

  /** Visita dei nodi visibili: restituisce {ids, depth, sizes}. */
  function collectVisible(map, includeSummaries) {
    var ids = [];
    var depth = {};
    var sizes = {};
    var queue = [map.rootId];
    depth[map.rootId] = 0;
    while (queue.length) {
      var id = queue.shift();
      ids.push(id);
      sizes[id] = measureNode(map.nodes[id], map.settings, depth[id]);
      visibleChildren(map, id).forEach(function (c) {
        depth[c] = depth[id] + 1;
        queue.push(c);
      });
    }
    if (includeSummaries !== false && Array.isArray(map.summaries)) {
      for (var si = 0; si < map.summaries.length; si++) {
        var s = map.summaries[si];
        if (!s || !Array.isArray(s.children)) continue;
        for (var ci = 0; ci < s.children.length; ci++) {
          var cid = s.children[ci];
          if (!map.nodes[cid] || depth[cid] !== undefined) continue;
          depth[cid] = 2;
          queue.push(cid);
        }
      }
      while (queue.length) {
        var sid = queue.shift();
        ids.push(sid);
        sizes[sid] = measureNode(map.nodes[sid], map.settings, depth[sid]);
        visibleChildren(map, sid).forEach(function (c) {
          if (depth[c] !== undefined) return;
          depth[c] = depth[sid] + 1;
          queue.push(c);
        });
      }
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
    var ids = info.ids;
    var n = ids.length;
    if (n < 2) return 0;
    var halfGap = NODE_GAP / 4;
    var items = new Array(n);
    for (var k = 0; k < n; k++) {
      var id = ids[k];
      var p = m.nodes[id];
      var s = info.sizes[id];
      var hw = s.width / 2 + halfGap;
      var hh = s.height / 2 + halfGap;
      items[k] = {
        id: id,
        minX: p.x - hw,
        maxX: p.x + hw,
        minY: p.y - hh,
        maxY: p.y + hh,
        d: info.depth[id]
      };
    }
    items.sort(function (a, b) { return a.minX - b.minX; });
    var minDepth = 0;
    for (var i = 0; i < n; i++) {
      var a = items[i];
      for (var j = i + 1; j < n; j++) {
        var b = items[j];
        if (b.minX >= a.maxX) break;
        if (a.minY < b.maxY && b.minY < a.maxY) {
          var d = Math.max(1, a.d < b.d ? a.d : b.d);
          if (!minDepth || d < minDepth) {
            minDepth = d;
            if (minDepth === 1) return 1;
          }
        }
      }
    }
    return minDepth;
  }

  function radial(map) {
    var m = MM.model.clone(map);
    var info = collectVisible(m, false);
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

  /* ---------- Mappa bilanciata (destra e sinistra) ---------- */

  function balanced(map) {
    var m = MM.model.clone(map);
    var info = collectVisible(m);
    var bandH = {};
    function subtreeHeight(id) {
      if (bandH[id] !== undefined) return bandH[id];
      var kids = visibleChildren(m, id);
      var sum = 0;
      kids.forEach(function (c, i) { sum += subtreeHeight(c) + (i > 0 ? SIBLING_GAP : 0); });
      bandH[id] = Math.max(info.sizes[id].height, sum);
      return bandH[id];
    }

    m.nodes[m.rootId].x = 0;
    m.nodes[m.rootId].y = 0;

    var rootKids = visibleChildren(m, m.rootId);
    var rightKids = [];
    var leftKids = [];
    var rightH = 0;
    var leftH = 0;
    rootKids.forEach(function (c) {
      var h = subtreeHeight(c);
      if (rightH <= leftH) {
        rightKids.push(c);
        rightH += h + (rightKids.length > 1 ? SIBLING_GAP : 0);
      } else {
        leftKids.push(c);
        leftH += h + (leftKids.length > 1 ? SIBLING_GAP : 0);
      }
    });

    function layoutSide(kids, dir) {
      if (!kids.length) return;
      var maxW = [info.sizes[m.rootId].width];
      (function collectW(list) {
        list.forEach(function (id) {
          var d = info.depth[id];
          maxW[d] = Math.max(maxW[d] || 0, info.sizes[id].width);
          collectW(visibleChildren(m, id));
        });
      })(kids);

      var colX = [0];
      for (var d = 1; d < maxW.length; d++) {
        colX[d] = colX[d - 1] + dir * Math.max(LEVEL_GAP, maxW[d - 1] / 2 + maxW[d] / 2 + 60);
      }

      var total = 0;
      kids.forEach(function (c, i) { total += subtreeHeight(c) + (i > 0 ? SIBLING_GAP : 0); });
      var cursor = -total / 2;

      function place(id, centerY) {
        var n = m.nodes[id];
        n.x = Math.round(colX[info.depth[id]]);
        n.y = Math.round(centerY);
        var sub = visibleChildren(m, id);
        var subTotal = 0;
        sub.forEach(function (c, i) { subTotal += subtreeHeight(c) + (i > 0 ? SIBLING_GAP : 0); });
        var subCursor = centerY - subTotal / 2;
        sub.forEach(function (c) {
          var h = subtreeHeight(c);
          place(c, subCursor + h / 2);
          subCursor += h + SIBLING_GAP;
        });
      }

      kids.forEach(function (c) {
        var h = subtreeHeight(c);
        place(c, cursor + h / 2);
        cursor += h + SIBLING_GAP;
      });
    }

    layoutSide(rightKids, 1);
    layoutSide(leftKids, -1);
    return m;
  }

  /* ---------- Organigramma (albero verticale dall'alto verso il basso) ---------- */

  function org(map) {
    var m = MM.model.clone(map);
    var info = collectVisible(m);
    var ORG_GAP = 28;
    var maxH = [];
    info.ids.forEach(function (id) {
      var d = info.depth[id];
      maxH[d] = Math.max(maxH[d] || 0, info.sizes[id].height);
    });
    var rowY = [0];
    for (var d = 1; d < maxH.length; d++) {
      rowY[d] = rowY[d - 1] + Math.round(maxH[d - 1] / 2 + maxH[d] / 2 + 56);
    }

    var bandW = {};
    function subtreeWidth(id) {
      if (bandW[id] !== undefined) return bandW[id];
      var kids = visibleChildren(m, id);
      var sum = 0;
      kids.forEach(function (c, i) { sum += subtreeWidth(c) + (i > 0 ? ORG_GAP : 0); });
      bandW[id] = Math.max(info.sizes[id].width, sum);
      return bandW[id];
    }

    (function place(id, centerX) {
      var n = m.nodes[id];
      n.x = Math.round(centerX);
      n.y = Math.round(rowY[info.depth[id]]);
      var kids = visibleChildren(m, id);
      var total = 0;
      kids.forEach(function (c, i) { total += subtreeWidth(c) + (i > 0 ? ORG_GAP : 0); });
      var cursor = centerX - total / 2;
      kids.forEach(function (c) {
        var w = subtreeWidth(c);
        place(c, cursor + w / 2);
        cursor += w + ORG_GAP;
      });
    })(m.rootId, 0);
    return m;
  }

  /* ---------- Linea del tempo (asse orizzontale con tappe alternate) ---------- */

  function timeline(map) {
    var m = MM.model.clone(map);
    var info = collectVisible(m);
    var SUB_GAP_X = 28;
    var MILESTONE_GAP_X = 36;
    var SPINE_OFFSET = 48;
    var LEVEL_GAP_Y = 44;

    m.nodes[m.rootId].x = 0;
    m.nodes[m.rootId].y = 0;

    var bandW = {};
    function subtreeWidth(id) {
      if (bandW[id] !== undefined) return bandW[id];
      var kids = visibleChildren(m, id);
      var sum = 0;
      kids.forEach(function (c, i) { sum += subtreeWidth(c) + (i > 0 ? SUB_GAP_X : 0); });
      bandW[id] = Math.max(info.sizes[id].width, sum);
      return bandW[id];
    }

    var milestones = visibleChildren(m, m.rootId);
    var cursorX = info.sizes[m.rootId].width / 2 + 72;

    milestones.forEach(function (cid, index) {
      var dir = index % 2 === 0 ? -1 : 1; // alterna sopra (-1) e sotto (+1)
      var maxH = [];
      (function collectH(id) {
        var relD = info.depth[id] - 1;
        maxH[relD] = Math.max(maxH[relD] || 0, info.sizes[id].height);
        visibleChildren(m, id).forEach(collectH);
      })(cid);

      var relY = [dir * Math.round(SPINE_OFFSET + maxH[0] / 2)];
      for (var d = 1; d < maxH.length; d++) {
        relY[d] = relY[d - 1] + dir * Math.round(maxH[d - 1] / 2 + maxH[d] / 2 + LEVEL_GAP_Y);
      }

      var w = subtreeWidth(cid);
      (function place(id, centerX) {
        var n = m.nodes[id];
        n.x = Math.round(centerX);
        n.y = Math.round(relY[info.depth[id] - 1]);
        var kids = visibleChildren(m, id);
        var total = 0;
        kids.forEach(function (c, i) { total += subtreeWidth(c) + (i > 0 ? SUB_GAP_X : 0); });
        var subCursor = centerX - total / 2;
        kids.forEach(function (c) {
          var cw = subtreeWidth(c);
          place(c, subCursor + cw / 2);
          subCursor += cw + SUB_GAP_X;
        });
      })(cid, cursorX + w / 2);

      cursorX += w + MILESTONE_GAP_X;
    });

    return m;
  }

  /* ---------- Lisca di pesce / Ishikawa (causa-effetto) ---------- */

  function fishbone(map) {
    var m = MM.model.clone(map);
    var info = collectVisible(m);
    var SPINE_GAP = 44;
    var RIB_GAP = 40;
    var SUB_GAP_Y = 20;
    var SUB_GAP_X = 48;
    var SLOPE = 0.45;

    m.nodes[m.rootId].x = 0;
    m.nodes[m.rootId].y = 0;

    var bandH = {};
    function subtreeHeight(id) {
      if (bandH[id] !== undefined) return bandH[id];
      var kids = visibleChildren(m, id);
      var sum = 0;
      kids.forEach(function (c, i) { sum += subtreeHeight(c) + (i > 0 ? SUB_GAP_Y : 0); });
      bandH[id] = Math.max(info.sizes[id].height, sum);
      return bandH[id];
    }

    var ribs = visibleChildren(m, m.rootId);
    var startX = info.sizes[m.rootId].width / 2 + 72;
    var upperCursorX = startX;
    var lowerCursorX = startX + 70;

    ribs.forEach(function (cid, index) {
      var dir = index % 2 === 0 ? -1 : 1; // lische alternate sopra (-1) e sotto (+1)
      var placed = [];
      var rootSize = info.sizes[cid];
      var y1 = SPINE_GAP + rootSize.height / 2;

      m.nodes[cid].x = 0;
      m.nodes[cid].y = Math.round(dir * y1);
      placed.push(cid);

      // Posiziona ricorsivamente i discendenti di profondità >= 3 in colonne a destra del nodo padre
      function placeHorizontal(parentId, parentX, parentCenterY) {
        var sub = visibleChildren(m, parentId);
        if (!sub.length) return;
        var parentW = info.sizes[parentId].width;
        var maxChildW = 0;
        sub.forEach(function (c) { maxChildW = Math.max(maxChildW, info.sizes[c].width); });
        var childX = Math.round(parentX + parentW / 2 + SUB_GAP_X + maxChildW / 2);

        var total = 0;
        sub.forEach(function (c, i) { total += subtreeHeight(c) + (i > 0 ? SUB_GAP_Y : 0); });
        var cursorY = parentCenterY - total / 2;
        sub.forEach(function (c) {
          var h = subtreeHeight(c);
          var cy = cursorY + h / 2;
          m.nodes[c].x = childX;
          m.nodes[c].y = Math.round(cy);
          placed.push(c);
          placeHorizontal(c, childX, cy);
          cursorY += h + SUB_GAP_Y;
        });
      }

      // Figli diretti della lisca (profondità 2) disposti lungo la diagonale verso l'esterno
      var ribKids = visibleChildren(m, cid);
      var distY = SPINE_GAP + rootSize.height + SUB_GAP_Y;
      ribKids.forEach(function (kid) {
        var h = subtreeHeight(kid);
        var absY = distY + h / 2;
        var kx = Math.round(SLOPE * (absY - y1));
        var ky = Math.round(dir * absY);
        m.nodes[kid].x = kx;
        m.nodes[kid].y = ky;
        placed.push(kid);
        placeHorizontal(kid, kx, ky);
        distY += h + SUB_GAP_Y;
      });

      // Calcola l'ingombro orizzontale della lisca e trasla per evitare ogni sovrapposizione
      var localMinX = Infinity;
      var localMaxX = -Infinity;
      placed.forEach(function (id) {
        var halfW = info.sizes[id].width / 2;
        localMinX = Math.min(localMinX, m.nodes[id].x - halfW);
        localMaxX = Math.max(localMaxX, m.nodes[id].x + halfW);
      });

      var cursor = dir < 0 ? upperCursorX : lowerCursorX;
      var shiftX = Math.round(cursor - localMinX);
      placed.forEach(function (id) {
        m.nodes[id].x += shiftX;
      });
      if (dir < 0) upperCursorX = shiftX + localMaxX + RIB_GAP;
      else lowerCursorX = shiftX + localMaxX + RIB_GAP;
    });

    return m;
  }

  /* ---------- Elenco verticale (outline indentato) ---------- */

  function outline(map) {
    var m = MM.model.clone(map);
    var info = collectVisible(m);
    var INDENT_STEP = 64;
    var OUTLINE_GAP = 18;
    var baseLeft = -info.sizes[m.rootId].width / 2;
    var cursorY = -info.sizes[m.rootId].height / 2;

    (function place(id) {
      var n = m.nodes[id];
      var s = info.sizes[id];
      n.x = Math.round(baseLeft + info.depth[id] * INDENT_STEP + s.width / 2);
      n.y = Math.round(cursorY + s.height / 2);
      cursorY += s.height + OUTLINE_GAP;
      visibleChildren(m, id).forEach(place);
    })(m.rootId);

    return m;
  }

  /* ---------- Confronto (più nodi centrali affiancati) ---------- */

  function compare(map) {
    var m = MM.model.clone(map);
    var COMPARE_GAP = 90;
    var centers = visibleChildren(m, m.rootId);
    if (centers.length === 0) {
      m.nodes[m.rootId].x = 0;
      m.nodes[m.rootId].y = 0;
      return m;
    }

    var rootSize = measureNode(m.nodes[m.rootId], m.settings, 0);
    var blocks = [];

    centers.forEach(function (cid) {
      var subIds = [];
      var depths = {};
      var queue = [cid];
      depths[cid] = 1;
      while (queue.length) {
        var id = queue.shift();
        subIds.push(id);
        visibleChildren(m, id).forEach(function (c) {
          depths[c] = depths[id] + 1;
          queue.push(c);
        });
      }

      var subLayout = (m.nodes[cid] && m.nodes[cid].subLayout) || 'radial';
      if (subLayout === 'compare') subLayout = 'radial';

      var subNodes = {};
      subIds.forEach(function (id) {
        subNodes[id] = MM.model.clone(m.nodes[id]);
      });
      subNodes[cid].parentId = null;

      var subSettings = MM.model.clone(m.settings);
      subSettings.layout = subLayout;

      var subMap = {
        rootId: cid,
        nodes: subNodes,
        links: [],
        settings: subSettings
      };

      var laid = apply(subMap);

      var minX = Infinity;
      var maxX = -Infinity;
      var minY = Infinity;
      var maxY = -Infinity;
      subIds.forEach(function (id) {
        var ln = laid.nodes[id];
        var s = measureNode(m.nodes[id], m.settings, depths[id]);
        minX = Math.min(minX, ln.x - s.width / 2);
        maxX = Math.max(maxX, ln.x + s.width / 2);
        minY = Math.min(minY, ln.y - s.height / 2);
        maxY = Math.max(maxY, ln.y + s.height / 2);
      });

      blocks.push({
        ids: subIds,
        laid: laid,
        minX: minX,
        maxX: maxX,
        minY: minY,
        maxY: maxY,
        width: maxX - minX,
        height: maxY - minY
      });
    });

    var totalW = 0;
    blocks.forEach(function (b, i) {
      totalW += b.width + (i > 0 ? COMPARE_GAP : 0);
    });

    m.nodes[m.rootId].x = 0;
    m.nodes[m.rootId].y = 0;

    var topY = rootSize.height / 2 + 76;
    var cursorX = -totalW / 2;
    blocks.forEach(function (block) {
      var shiftX = cursorX - block.minX;
      var shiftY = topY - block.minY;
      block.ids.forEach(function (id) {
        m.nodes[id].x = Math.round(block.laid.nodes[id].x + shiftX);
        m.nodes[id].y = Math.round(block.laid.nodes[id].y + shiftY);
      });
      cursorX += block.width + COMPARE_GAP;
    });

    return m;
  }

  /* ---------- Figli collegati alle parentesi graffe di riepilogo ---------- */

  function layoutSummaryChildren(m) {
    if (!Array.isArray(m.summaries) || !m.summaries.length || !MM.model.getSummaryNodes) return m;
    var baseInfo = collectVisible(m, false);
    var visibleSet = {};
    baseInfo.ids.forEach(function (id) { visibleSet[id] = true; });
    var layout = m.settings && m.settings.layout;

    for (var i = 0; i < m.summaries.length; i++) {
      var s = m.summaries[i];
      if (!s || !Array.isArray(s.children) || !s.children.length) continue;
      var kids = s.children.filter(function (id) { return !!m.nodes[id]; });
      if (!kids.length) continue;

      var rawSibs = MM.model.getSummaryNodes(m, s) || [];
      var covered = [];
      var seenCov = {};
      for (var si = 0; si < rawSibs.length; si++) {
        var sid = rawSibs[si];
        if (!visibleSet[sid] || !m.nodes[sid]) continue;
        if (!seenCov[sid]) { seenCov[sid] = true; covered.push(sid); }
        var desc = MM.model.getDescendants(m, sid);
        for (var di = 0; di < desc.length; di++) {
          var did = desc[di];
          if (visibleSet[did] && !seenCov[did] && m.nodes[did]) {
            seenCov[did] = true;
            covered.push(did);
          }
        }
      }

      var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (var k = 0; k < covered.length; k++) {
        var cn = m.nodes[covered[k]];
        var cs = baseInfo.sizes[covered[k]] || measureNode(cn, m.settings, baseInfo.depth[covered[k]]);
        minX = Math.min(minX, cn.x - cs.width / 2);
        maxX = Math.max(maxX, cn.x + cs.width / 2);
        minY = Math.min(minY, cn.y - cs.height / 2);
        maxY = Math.max(maxY, cn.y + cs.height / 2);
      }
      if (!isFinite(minX)) continue;

      // Misura i nodi visibili nei sottoalberi figli della parentesi (profondità relativa da 0, assoluta da 2).
      var subDepth = {};
      var subSizes = {};
      var subIds = [];
      var q = [];
      kids.forEach(function (cid) {
        subDepth[cid] = 0;
        q.push(cid);
      });
      while (q.length) {
        var id = q.shift();
        subIds.push(id);
        subSizes[id] = measureNode(m.nodes[id], m.settings, subDepth[id] + 2);
        visibleChildren(m, id).forEach(function (c) {
          if (subDepth[c] !== undefined) return;
          subDepth[c] = subDepth[id] + 1;
          q.push(c);
        });
      }

      // Misura reale del riquadro "Riepilogo" (allineata a renderer.js) per non sovrapporre i figli alla casella.
      var sumNode = {
        id: s.id,
        parentId: '__summary__',
        text: s.text || 'Riepilogo',
        color: s.color || '#475569',
        shape: s.shape || 'rounded',
        note: s.note || '',
        comment: s.comment || '',
        icon: s.icon || '',
        images: s.images,
        image: s.image,
        imageW: s.imageW,
        imageH: s.imageH,
        fontName: s.fontName,
        fontSize: s.fontSize,
        bold: s.bold !== undefined ? s.bold : true,
        italic: s.italic,
        underline: s.underline,
        strike: s.strike,
        uppercase: s.uppercase,
        bullets: s.bullets,
        textAlign: s.textAlign,
        textColor: s.textColor,
        fillColor: s.fillColor,
        boxSize: s.boxSize,
        personMode: s.personMode,
        role: s.role,
        avatarColor: s.avatarColor,
        children: []
      };
      var sumSize = measureNode(sumNode, m.settings, 1);
      var sumBoxW = sumSize.width;
      var sumBoxH = sumSize.height;

      if (layout === 'org') {
        var ORG_GAP = 28;
        var maxH = [];
        subIds.forEach(function (id) {
          var d = subDepth[id];
          maxH[d] = Math.max(maxH[d] || 0, subSizes[id].height);
        });
        var anchorX = (minX + maxX) / 2;
        var rowY = [Math.round(maxY + 34 + sumBoxH + 52 + (maxH[0] || 40) / 2)];
        for (var rd = 1; rd < maxH.length; rd++) {
          rowY[rd] = rowY[rd - 1] + Math.round(maxH[rd - 1] / 2 + maxH[rd] / 2 + 56);
        }
        var bandW = {};
        var subtreeWidth = function (nid) {
          if (bandW[nid] !== undefined) return bandW[nid];
          var ch = visibleChildren(m, nid);
          var sum = 0;
          ch.forEach(function (c, idx) { sum += subtreeWidth(c) + (idx > 0 ? ORG_GAP : 0); });
          bandW[nid] = Math.max(subSizes[nid].width, sum);
          return bandW[nid];
        };
        var placeOrg = function (nid, centerX) {
          m.nodes[nid].x = Math.round(centerX);
          m.nodes[nid].y = Math.round(rowY[subDepth[nid]]);
          var ch = visibleChildren(m, nid);
          var tot = 0;
          ch.forEach(function (c, idx) { tot += subtreeWidth(c) + (idx > 0 ? ORG_GAP : 0); });
          var cur = centerX - tot / 2;
          ch.forEach(function (c) {
            var w = subtreeWidth(c);
            placeOrg(c, cur + w / 2);
            cur += w + ORG_GAP;
          });
        };
        var totalW = 0;
        kids.forEach(function (c, idx) { totalW += subtreeWidth(c) + (idx > 0 ? ORG_GAP : 0); });
        var cursorX = anchorX - totalW / 2;
        kids.forEach(function (c) {
          var w = subtreeWidth(c);
          placeOrg(c, cursorX + w / 2);
          cursorX += w + ORG_GAP;
        });
      } else {
        var refX = (s.parentId && m.nodes[s.parentId]) ? m.nodes[s.parentId].x : (m.nodes[m.rootId] ? m.nodes[m.rootId].x : 0);
        var leftSide = (minX + maxX) / 2 < refX;
        var dir = leftSide ? -1 : 1;
        var startX = leftSide ? (minX - 36 - sumBoxW - 60) : (maxX + 36 + sumBoxW + 60);
        var midY = (minY + maxY) / 2;

        var maxW = [];
        subIds.forEach(function (id) {
          var d = subDepth[id];
          maxW[d] = Math.max(maxW[d] || 0, subSizes[id].width);
        });
        var colX = [Math.round(startX + dir * ((maxW[0] || 80) / 2))];
        for (var cd = 1; cd < maxW.length; cd++) {
          colX[cd] = Math.round(colX[cd - 1] + dir * Math.max(LEVEL_GAP, maxW[cd - 1] / 2 + maxW[cd] / 2 + 60));
        }

        var bandH = {};
        var subtreeHeight = function (nid) {
          if (bandH[nid] !== undefined) return bandH[nid];
          var ch = visibleChildren(m, nid);
          var sum = 0;
          ch.forEach(function (c, idx) { sum += subtreeHeight(c) + (idx > 0 ? SIBLING_GAP : 0); });
          bandH[nid] = Math.max(subSizes[nid].height, sum);
          return bandH[nid];
        };
        var placeHoriz = function (nid, centerY) {
          m.nodes[nid].x = colX[subDepth[nid]];
          m.nodes[nid].y = Math.round(centerY);
          var ch = visibleChildren(m, nid);
          var tot = 0;
          ch.forEach(function (c, idx) { tot += subtreeHeight(c) + (idx > 0 ? SIBLING_GAP : 0); });
          var cur = centerY - tot / 2;
          ch.forEach(function (c) {
            var h = subtreeHeight(c);
            placeHoriz(c, cur + h / 2);
            cur += h + SIBLING_GAP;
          });
        };
        var totalH = 0;
        kids.forEach(function (c, idx) { totalH += subtreeHeight(c) + (idx > 0 ? SIBLING_GAP : 0); });
        var cursorY = midY - totalH / 2;
        kids.forEach(function (c) {
          var h = subtreeHeight(c);
          placeHoriz(c, cursorY + h / 2);
          cursorY += h + SIBLING_GAP;
        });
      }
    }
    return m;
  }

  /** Applica la disposizione scelta nelle impostazioni della mappa. */
  function apply(map) {
    var mode = map.settings && map.settings.layout;
    var laid;
    if (mode === 'tree') laid = tree(map);
    else if (mode === 'balanced') laid = balanced(map);
    else if (mode === 'org') laid = org(map);
    else if (mode === 'timeline') laid = timeline(map);
    else if (mode === 'fishbone') laid = fishbone(map);
    else if (mode === 'outline') laid = outline(map);
    else if (mode === 'compare') laid = compare(map);
    else laid = radial(map);
    return layoutSummaryChildren(laid);
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
    balanced: balanced,
    org: org,
    timeline: timeline,
    fishbone: fishbone,
    outline: outline,
    compare: compare,
    apply: apply,
    getBounds: getBounds,
    overlaps: overlaps
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
