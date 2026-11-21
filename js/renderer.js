/*
 * Mappe Mentali – disegno SVG di nodi, rami e collegamenti.
 * render() sincronizza in modo mirato gli elementi esistenti (crea/aggiorna/rimuove
 * solo ciò che è cambiato). Le misure reali dei nodi (getComputedTextLength) vengono
 * registrate in MM.layout, così layout e disegno usano le stesse dimensioni.
 * Il testo va a capo con MM.layout.wrapText (unica implementazione).
 */
(function (root) {
  'use strict';
  var MM = root.MM;
  var NS = 'http://www.w3.org/2000/svg';

  var BASE_FONT = 16;
  var PAD_X = 18;
  var PAD_Y = 11;
  var LINE_H = 1.35;

  function el(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    if (attrs) setAttrs(e, attrs);
    if (parent) parent.appendChild(e);
    return e;
  }

  function setAttrs(e, attrs) {
    Object.keys(attrs).forEach(function (k) {
      if (attrs[k] === null || attrs[k] === undefined) e.removeAttribute(k);
      else e.setAttribute(k, attrs[k]);
    });
  }

  function fontSizeFor(node, settings) {
    var scale = (settings && settings.fontScale) || 1;
    var base = node.fontSize ? Number(node.fontSize) : (BASE_FONT * (node.parentId === null ? 1.25 : 1));
    return Math.round(base * scale * 10) / 10;
  }

  function fontFamilyFor(node, settings) {
    if (node.fontName && MM.model.fontCssFor) return MM.model.fontCssFor(node.fontName);
    if (settings && settings.fontFamily === 'leggibile') return null;
    if (settings && settings.fontName && MM.model.fontCssFor) return MM.model.fontCssFor(settings.fontName);
    return null;
  }

  function isBoldFor(node) {
    return node.bold !== undefined && node.bold !== null ? !!node.bold : node.parentId === null;
  }

  function hasVectorIcon(node) {
    return !!(MM.icons && MM.icons.isVectorIcon(node.icon));
  }

  /** Righe da disegnare: emoji in testa alla prima riga, maiuscolo se richiesto. */
  function linesFor(node, settings) {
    var upper = (settings && settings.uppercase) || !!node.uppercase;
    var text = upper ? node.text.toLocaleUpperCase('it-IT') : node.text;
    var lines = MM.layout.wrapText(text, MM.layout.WRAP_CHARS);
    if (node.icon && !hasVectorIcon(node)) lines[0] = node.icon + (lines[0] ? ' ' + lines[0] : '');
    return lines;
  }

  /** Scurisce un colore #RRGGBB (per i bordi). */
  function darken(hex, amount) {
    var k = 1 - (amount || 0.25);
    var out = '#';
    for (var i = 1; i < 7; i += 2) {
      var c = Math.round(parseInt(hex.substr(i, 2), 16) * k);
      out += (c < 16 ? '0' : '') + c.toString(16);
    }
    return out;
  }

  /** Mescola due colori #RRGGBB: ratio = peso di baseHex (0..1). */
  function mixHex(hex, baseHex, ratio) {
    var t = Math.max(0, Math.min(1, ratio));
    var out = '#';
    for (var i = 1; i < 7; i += 2) {
      var a = parseInt(hex.substr(i, 2), 16);
      var b = parseInt(baseHex.substr(i, 2), 16);
      var c = Math.round(a * (1 - t) + b * t);
      out += (c < 16 ? '0' : '') + c.toString(16);
    }
    return out;
  }

  /** Punto sul bordo del riquadro (centro c, dimensioni s) in direzione di p. */
  function edgePoint(c, s, p) {
    var dx = p.x - c.x;
    var dy = p.y - c.y;
    if (!dx && !dy) return { x: c.x, y: c.y };
    var tx = dx ? (s.width / 2) / Math.abs(dx) : Infinity;
    var ty = dy ? (s.height / 2) / Math.abs(dy) : Infinity;
    var t = Math.min(tx, ty, 1);
    return { x: c.x + dx * t, y: c.y + dy * t };
  }

  /** Curva di Bézier tra padre e figlio, orientata lungo l'asse dominante. */
  function branchPath(p, c) {
    var dx = c.x - p.x;
    var dy = c.y - p.y;
    if (Math.abs(dx) >= Math.abs(dy)) {
      var mx = p.x + dx / 2;
      return 'M' + p.x + ' ' + p.y + ' C' + mx + ' ' + p.y + ' ' + mx + ' ' + c.y + ' ' + c.x + ' ' + c.y;
    }
    var my = p.y + dy / 2;
    return 'M' + p.x + ' ' + p.y + ' C' + p.x + ' ' + my + ' ' + c.x + ' ' + my + ' ' + c.x + ' ' + c.y;
  }

  /** @returns {Renderer} */
  function create(svgEl) {
    var world = svgEl.querySelector('#world');
    var defs = svgEl.querySelector('defs') || el('defs', null, svgEl);
    world.textContent = '';
    var layers = {
      branches: el('g', { 'class': 'layer-branches' }, world),
      links: el('g', { 'class': 'layer-links' }, world),
      nodes: el('g', { 'class': 'layer-nodes' }, world),
      labels: el('g', { 'class': 'layer-labels' }, world)
    };
    // Testo invisibile usato solo per misurare la larghezza reale delle righe.
    var measureText = el('text', { 'class': 'node-text measure', 'aria-hidden': 'true', x: -99999, y: -99999 }, world);
    var measureCache = {};
    var nodeEls = {};
    var branchEls = {};
    var linkEls = {};
    var highlighted = null;

    if (!svgEl.querySelector('#mm-node-shadow')) {
      var flt = el('filter', {
        id: 'mm-node-shadow', x: '-15%', y: '-20%', width: '130%', height: '150%'
      }, defs);
      el('feDropShadow', {
        dx: 0, dy: 2, stdDeviation: 3.5, 'flood-color': '#0f172a', 'flood-opacity': '0.08'
      }, flt);
    }

    if (!svgEl.querySelector('#mm-arrow')) {
      var marker = el('marker', {
        id: 'mm-arrow', viewBox: '0 0 10 10', refX: 8.5, refY: 5,
        markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse'
      }, defs);
      el('path', { d: 'M1 2 L9 5 L1 8 L3 5 z', 'class': 'link-arrow' }, marker);
    }

    function lineWidth(line, fontSize, bold, fontFamily, italic) {
      measureText.setAttribute('font-size', fontSize);
      measureText.setAttribute('font-weight', bold ? 'bold' : 'normal');
      measureText.setAttribute('font-style', italic ? 'italic' : 'normal');
      if (fontFamily) measureText.setAttribute('font-family', fontFamily);
      else measureText.removeAttribute('font-family');
      measureText.textContent = line || ' ';
      var w = 0;
      try { w = measureText.getComputedTextLength(); } catch (e) { w = 0; }
      return w;
    }

    /** Dimensioni reali del nodo (con cache); stima se il browser non sa misurare. */
    function measure(node, settings) {
      var s = settings || MM.model.DEFAULT_SETTINGS;
      var fontSize = fontSizeFor(node, s);
      var fontFamily = fontFamilyFor(node, s);
      var bold = isBoldFor(node);
      var italic = !!node.italic;
      var lines = linesFor(node, s);
      var isRoot = node.parentId === null;
      var isVec = hasVectorIcon(node);
      var key = [lines.join('\n'), fontSize, bold, italic, fontFamily || '', node.shape, isRoot, isVec, s.fontFamily].join('|');
      if (measureCache[key]) return measureCache[key];
      var maxW = 0;
      var rawAny = false;
      var iconSize = Math.round(fontSize * 1.1);
      for (var i = 0; i < lines.length; i++) {
        var lw = lineWidth(lines[i], fontSize, bold, fontFamily, italic);
        if (lw > 0) rawAny = true;
        if (i === 0 && isVec) lw += iconSize + (lines[0] ? 8 : 0);
        maxW = Math.max(maxW, lw);
      }
      if ((!rawAny && lines.join('').trim()) || !maxW) return MM.layout.estimateNode(node, s); // SVG non ancora visibile: non salvare in cache
      var w = Math.max(60, maxW + 2 * PAD_X);
      var h = Math.max(40, lines.length * fontSize * LINE_H + 2 * PAD_Y);
      if (node.shape === 'ellipse') { w *= 1.3; h *= 1.4; }
      measureCache[key] = { width: Math.ceil(w), height: Math.ceil(h) };
      return measureCache[key];
    }

    MM.layout.setMeasurer(measure);

    function clearCache() { measureCache = {}; }

    /** Crea o aggiorna la forma di sfondo del nodo. */
    function drawShape(g, node, size, settings) {
      var shapeEl = g.firstChild;
      var tag = node.shape === 'ellipse' ? 'ellipse' : 'rect';
      if (!shapeEl || shapeEl.tagName !== tag) {
        var fresh = el(tag, { 'class': 'node-shape' });
        if (shapeEl) g.replaceChild(fresh, shapeEl); else g.insertBefore(fresh, g.firstChild);
        shapeEl = fresh;
      }
      var isRoot = node.parentId === null;
      var theme = MM.model.resolveTheme ? MM.model.resolveTheme(settings && settings.theme) : ((settings && settings.theme) || 'chiaro');
      if (tag === 'ellipse') {
        setAttrs(shapeEl, { cx: 0, cy: 0, rx: size.width / 2, ry: size.height / 2 });
      } else {
        setAttrs(shapeEl, {
          x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height,
          rx: node.shape === 'rounded' ? (isRoot ? 14 : 11) : 4
        });
      }
      var fillColor, strokeColor, strokeW;
      if (isRoot) {
        fillColor = node.color;
        strokeColor = darken(node.color, 0.15);
        strokeW = 1.5;
      } else {
        fillColor = theme === 'alto-contrasto'
          ? '#000000'
          : (theme === 'scuro' ? mixHex(node.color, '#1E293B', 0.80) : mixHex(node.color, '#FFFFFF', 0.91));
        strokeColor = node.color;
        strokeW = 1.75;
      }
      setAttrs(shapeEl, {
        fill: fillColor,
        stroke: strokeColor,
        'stroke-width': strokeW
      });
    }

    function drawText(g, node, settings) {
      var oldIcon = g.querySelector('.node-icon');
      if (oldIcon) g.removeChild(oldIcon);
      var textEl = g.querySelector('.node-text');
      if (!textEl) textEl = el('text', { 'class': 'node-text', 'text-anchor': 'middle' }, g);
      var fontSize = fontSizeFor(node, settings);
      var fontFamily = fontFamilyFor(node, settings);
      var bold = isBoldFor(node);
      var italic = !!node.italic;
      var lines = linesFor(node, settings);
      var lineH = fontSize * LINE_H;
      var isRoot = node.parentId === null;
      var theme = MM.model.resolveTheme ? MM.model.resolveTheme(settings && settings.theme) : ((settings && settings.theme) || 'chiaro');
      var autoFill = isRoot
        ? MM.model.textColorFor(node.color)
        : (theme === 'scuro' ? '#F8FAFC' : (theme === 'alto-contrasto' ? '#FFFFFF' : '#0F172A'));
      var textFill = (node.textColor && theme !== 'alto-contrasto') ? node.textColor : autoFill;
      var deco = [];
      if (node.underline) deco.push('underline');
      if (node.strike) deco.push('line-through');
      setAttrs(textEl, {
        'font-size': fontSize,
        'font-weight': bold ? 'bold' : 'normal',
        'font-style': italic ? 'italic' : 'normal',
        'font-family': fontFamily || null,
        'text-decoration': deco.length ? deco.join(' ') : null,
        fill: textFill
      });
      textEl.textContent = '';
      var firstY = -((lines.length - 1) * lineH) / 2;
      var isVec = hasVectorIcon(node);
      var iconShiftX = 0;
      if (isVec) {
        var iconSize = Math.round(fontSize * 1.1);
        var iconGap = 8;
        var hasText0 = !!lines[0];
        var t0w = hasText0 ? (lineWidth(lines[0], fontSize, bold, fontFamily, italic) || lines[0].length * fontSize * 0.55) : 0;
        var totalW = iconSize + (hasText0 ? iconGap + t0w : 0);
        var iconX = -totalW / 2;
        var iconY = firstY - iconSize / 2;
        var scale = iconSize / 24;
        var iconColor = isRoot ? MM.model.textColorFor(node.color) : node.color;
        var iconG = el('g', {
          'class': 'node-icon',
          transform: 'translate(' + iconX.toFixed(1) + ' ' + iconY.toFixed(1) + ') scale(' + scale.toFixed(4) + ')',
          fill: 'none',
          stroke: iconColor,
          'stroke-width': '2',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        }, g);
        iconG.innerHTML = MM.icons.nodePaths(MM.icons.vectorId(node.icon));
        iconShiftX = hasText0 ? (iconSize + iconGap) / 2 : 0;
      }
      lines.forEach(function (line, i) {
        var t = el('tspan', {
          x: i === 0 ? iconShiftX : 0,
          y: firstY + i * lineH,
          'dominant-baseline': 'central'
        }, textEl);
        t.textContent = line || '\u00a0';
      });
    }

    /** Indicatori: "+N" sui nodi compressi, icona nota se c'è una nota. */
    function drawBadges(g, map, node, size) {
      var old = g.querySelectorAll('.node-badge');
      for (var i = 0; i < old.length; i++) g.removeChild(old[i]);
      if (node.collapsed && node.children.length) {
        var n = MM.model.getDescendants(map, node.id).length;
        var b = el('g', { 'class': 'node-badge badge-collapsed', transform: 'translate(' + (size.width / 2) + ' 0)' }, g);
        el('circle', { r: 12, stroke: node.color }, b);
        el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 11 }, b).textContent = '+' + n;
      }
      if (node.note) {
        var nb = el('g', {
          'class': 'node-badge badge-note',
          transform: 'translate(' + (size.width / 2 - 4) + ' ' + (-size.height / 2 + 4) + ')'
        }, g);
        el('circle', { r: 10, stroke: node.color }, nb);
        var notePaths = MM.icons && MM.icons.uiPaths('note');
        if (notePaths) {
          var ni = el('g', {
            'class': 'badge-note-icon',
            transform: 'translate(-6 -6) scale(0.5)',
            fill: 'none',
            stroke: node.color,
            'stroke-width': '2.2',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
          }, nb);
          ni.innerHTML = notePaths;
        }
      }
    }

    function nodeLabel(map, node) {
      var iconPrefix = node.icon && !hasVectorIcon(node) ? node.icon + ' ' : '';
      var label = iconPrefix + node.text.replace(/\s*\n\s*/g, ' ');
      if (node.parentId === null) label = 'Nodo centrale: ' + label;
      if (node.children.length) {
        label += node.collapsed ? ', ramo compresso con ' + node.children.length + ' sotto-idee'
          : ', ' + node.children.length + ' sotto-idee';
      }
      if (node.note) label += '. Nota: ' + node.note;
      return label;
    }

    function renderNode(map, node, opts, visibleSet) {
      var g = nodeEls[node.id];
      if (!g) {
        g = el('g', { 'class': 'node', 'data-id': node.id, role: 'treeitem' }, layers.nodes);
        nodeEls[node.id] = g;
      }
      var size = measure(node, map.settings);
      var resolvedTheme = MM.model.resolveTheme ? MM.model.resolveTheme(map.settings.theme) : map.settings.theme;
      var sig = JSON.stringify([node.text, node.icon, node.note, node.color, node.shape, node.collapsed,
        node.fontName || '', node.fontSize || 0, node.bold, !!node.italic, !!node.underline,
        !!node.strike, !!node.uppercase, node.textColor || '',
        node.children.length, map.settings.fontScale, map.settings.uppercase, map.settings.fontFamily,
        map.settings.fontName || '', resolvedTheme, size.width, size.height]);
      if (g.__sig !== sig) {
        drawShape(g, node, size, map.settings);
        drawText(g, node, map.settings);
        drawBadges(g, map, node, size);
        g.__sig = sig;
      }
      setAttrs(g, {
        transform: 'translate(' + node.x + ' ' + node.y + ')',
        'aria-label': nodeLabel(map, node),
        'aria-selected': opts.selectedId === node.id ? 'true' : 'false',
        'aria-level': MM.model.getDepth(map, node.id) + 1,
        'aria-expanded': node.children.length ? String(!node.collapsed) : null
      });
      g.classList.toggle('root', node.parentId === null);
      g.classList.toggle('selected', opts.selectedId === node.id);
      g.classList.toggle('link-source', opts.pendingLinkFrom === node.id);
      g.classList.toggle('drop-target', opts.dropTargetId === node.id);
      g.classList.toggle('dragging', opts.draggingId === node.id);
      return size;
    }

    function renderBranch(map, node, sizes) {
      var parent = map.nodes[node.parentId];
      var path = branchEls[node.id];
      if (!path) {
        path = el('path', { 'class': 'branch', 'data-id': node.id }, layers.branches);
        branchEls[node.id] = path;
      }
      var depth = MM.model.getDepth(map, node.id);
      var start = edgePoint(parent, sizes[parent.id], node);
      var end = edgePoint(node, sizes[node.id], parent);
      setAttrs(path, {
        d: branchPath(start, end),
        stroke: node.color,
        'stroke-width': Math.max(1.5, 3.5 - (depth - 1) * 0.75)
      });
    }

    function renderLink(map, link, sizes, opts) {
      var a = map.nodes[link.fromId];
      var b = map.nodes[link.toId];
      var item = linkEls[link.id];
      if (!item) {
        item = {
          path: el('path', { 'class': 'link', 'data-link-id': link.id, 'marker-end': 'url(#mm-arrow)' }, layers.links),
          hit: el('path', { 'class': 'link-hit', 'data-link-id': link.id }, layers.links),
          label: el('g', { 'class': 'link-label', 'data-link-id': link.id }, layers.labels)
        };
        el('rect', { rx: 6 }, item.label);
        el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, item.label);
        linkEls[link.id] = item;
      }
      var p1 = edgePoint(a, sizes[a.id], b);
      var p2 = edgePoint(b, sizes[b.id], a);
      // Curva leggermente arcuata, per distinguerla dai rami.
      var mx = (p1.x + p2.x) / 2;
      var my = (p1.y + p2.y) / 2;
      var dx = p2.x - p1.x;
      var dy = p2.y - p1.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var bend = Math.min(60, len * 0.15);
      var cx = mx - dy / len * bend;
      var cy = my + dx / len * bend;
      var d = 'M' + p1.x + ' ' + p1.y + ' Q' + cx + ' ' + cy + ' ' + p2.x + ' ' + p2.y;
      setAttrs(item.path, { d: d });
      setAttrs(item.hit, { d: d });
      var selected = opts.selectedLinkId === link.id;
      setAttrs(item.label, {
        role: 'button',
        'aria-label': 'Collegamento da «' + a.text.replace(/\s+/g, ' ') + '» a «' + b.text.replace(/\s+/g, ' ') + '»' +
          (link.label ? ': ' + link.label : ''),
        'aria-pressed': selected ? 'true' : 'false'
      });
      item.path.classList.toggle('selected', selected);
      item.label.classList.toggle('selected', selected);
      // Etichetta al centro della curva (punto a t = 0.5 della Bézier quadratica).
      var lx = 0.25 * p1.x + 0.5 * cx + 0.25 * p2.x;
      var ly = 0.25 * p1.y + 0.5 * cy + 0.25 * p2.y;
      var text = item.label.querySelector('text');
      var rect = item.label.querySelector('rect');
      var fontSize = Math.round(13 * ((map.settings && map.settings.fontScale) || 1));
      text.setAttribute('font-size', fontSize);
      text.textContent = link.label;
      item.label.setAttribute('transform', 'translate(' + lx + ' ' + ly + ')');
      item.label.style.display = link.label ? '' : 'none';
      if (link.label) {
        var w = lineWidth(link.label, fontSize, false) || link.label.length * fontSize * 0.6;
        setAttrs(rect, { x: -w / 2 - 6, y: -fontSize * 0.8, width: w + 12, height: fontSize * 1.6 });
      }
    }

    function removeStale(store, keep, remove) {
      Object.keys(store).forEach(function (id) {
        if (!keep[id]) { remove(store[id]); delete store[id]; }
      });
    }

    function detach(e) { if (e && e.parentNode) e.parentNode.removeChild(e); }

    /**
     * Disegna la mappa. opts: { selectedId, selectedLinkId, pendingLinkFrom, dropTargetId, draggingId }.
     * @returns {Object<string, {width:number, height:number}>} dimensioni dei nodi visibili.
     */
    function render(map, options) {
      var opts = options || {};
      var visible = MM.model.getVisibleNodeIds(map);
      var visibleSet = {};
      var sizes = {};
      visible.forEach(function (id) { visibleSet[id] = true; });
      visible.forEach(function (id) { sizes[id] = renderNode(map, map.nodes[id], opts, visibleSet); });

      var branchKeep = {};
      visible.forEach(function (id) {
        var n = map.nodes[id];
        if (n.parentId !== null) { branchKeep[id] = true; renderBranch(map, n, sizes); }
      });

      var linkKeep = {};
      (map.links || []).forEach(function (l) {
        if (visibleSet[l.fromId] && visibleSet[l.toId]) { linkKeep[l.id] = true; renderLink(map, l, sizes, opts); }
      });

      removeStale(nodeEls, visibleSet, detach);
      removeStale(branchEls, branchKeep, detach);
      removeStale(linkEls, linkKeep, function (item) { detach(item.path); detach(item.hit); detach(item.label); });

      // Il nodo selezionato va in primo piano (ultimo nel livello dei nodi).
      if (opts.selectedId && nodeEls[opts.selectedId]) layers.nodes.appendChild(nodeEls[opts.selectedId]);
      if (highlighted && nodeEls[highlighted]) nodeEls[highlighted].classList.add('highlight');
      lastSizes = sizes;
      return sizes;
    }

    var lastSizes = {};

    /** Percorso ultra-veloce durante il trascinamento: aggiorna solo transform e rami/link toccati. */
    function moveNodesFast(map, movedIds, opts) {
      var movedSet = {};
      for (var i = 0; i < movedIds.length; i++) {
        var id = movedIds[i];
        movedSet[id] = true;
        var n = map.nodes[id];
        var g = nodeEls[id];
        if (n && g) g.setAttribute('transform', 'translate(' + n.x + ' ' + n.y + ')');
      }
      for (var j = 0; j < movedIds.length; j++) {
        var bid = movedIds[j];
        var bn = map.nodes[bid];
        if (bn && bn.parentId !== null && lastSizes[bid] && lastSizes[bn.parentId]) {
          renderBranch(map, bn, lastSizes);
        }
      }
      var links = map.links || [];
      for (var k = 0; k < links.length; k++) {
        var l = links[k];
        if ((movedSet[l.fromId] || movedSet[l.toId]) && lastSizes[l.fromId] && lastSizes[l.toId]) {
          renderLink(map, l, lastSizes, opts || {});
        }
      }
    }

    /** Evidenzia un nodo (es. lettura vocale); null per togliere l'evidenziazione. */
    function highlight(nodeId) {
      if (highlighted && nodeEls[highlighted]) nodeEls[highlighted].classList.remove('highlight');
      highlighted = nodeId || null;
      if (highlighted && nodeEls[highlighted]) nodeEls[highlighted].classList.add('highlight');
    }

    function getNodeElement(id) { return nodeEls[id] || null; }

    function destroy() {
      MM.layout.setMeasurer(null);
      world.textContent = '';
      nodeEls = {}; branchEls = {}; linkEls = {};
    }

    /** Forza il ridisegno completo (es. dopo un cambio di carattere). */
    function invalidate() {
      clearCache();
      Object.keys(nodeEls).forEach(function (id) { nodeEls[id].__sig = null; });
    }

    return {
      render: render, moveNodesFast: moveNodesFast, measure: measure, highlight: highlight,
      getNodeElement: getNodeElement, invalidate: invalidate, destroy: destroy, svg: svgEl, world: world
    };
  }

  MM.renderer = {
    create: create,
    fontSizeFor: fontSizeFor,
    linesFor: linesFor,
    branchPath: branchPath,
    edgePoint: edgePoint,
    darken: darken,
    mixHex: mixHex
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
