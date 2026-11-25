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
  var IMG_GAP = 8;

  function imageBox(node, settings, depth) {
    return MM.model.imageBoxFor ? MM.model.imageBoxFor(node, boxScale(node, settings, depth)) : null;
  }

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

  function boxScale(node, settings, depth) {
    return MM.model.boxScaleFor ? MM.model.boxScaleFor(node, settings, depth) : (node.parentId === null ? 1.25 : 1);
  }

  function fontSizeFor(node, settings, depth) {
    var scale = (settings && settings.fontScale) || 1;
    var base = node.fontSize ? Number(node.fontSize) : (BASE_FONT * boxScale(node, settings, depth));
    return Math.round(base * scale * 10) / 10;
  }

  function fontFamilyFor(node, settings) {
    if (node.fontName && MM.model.fontCssFor) return MM.model.fontCssFor(node.fontName);
    if (settings && settings.fontFamily === 'leggibile') return null;
    if (settings && settings.fontName && MM.model.fontCssFor) return MM.model.fontCssFor(settings.fontName);
    return null;
  }

  function isCentralNode(node, settings, depth) {
    return node.parentId === null || (settings && settings.layout === 'compare' && depth === 1);
  }

  function isBoldFor(node, settings, depth) {
    return node.bold !== undefined && node.bold !== null ? !!node.bold : isCentralNode(node, settings, depth);
  }

  function hasVectorIcon(node) {
    return !!(MM.icons && MM.icons.isVectorIcon(node.icon));
  }

  /** Righe e marcatori di fine paragrafo: elenco puntato, emoji in testa e maiuscolo. */
  function richLinesFor(node, settings) {
    var upper = (settings && settings.uppercase) || !!node.uppercase;
    var text = upper ? node.text.toLocaleUpperCase('it-IT') : node.text;
    var paras = String(text || '').split('\n');
    var lines = [];
    var paraEnds = [];
    if (node.bullets) {
      var maxChars = Math.max(12, MM.layout.WRAP_CHARS - 2);
      for (var p = 0; p < paras.length; p++) {
        var wrappedB = MM.layout.wrapText(paras[p], maxChars);
        for (var wb = 0; wb < wrappedB.length; wb++) {
          var wl = wrappedB[wb];
          if (wb === 0) lines.push((wl || paras.length === 1) ? ('• ' + wl) : '');
          else lines.push('  ' + wl);
          paraEnds.push(wb === wrappedB.length - 1);
        }
      }
    } else {
      for (var q = 0; q < paras.length; q++) {
        var wrapped = MM.layout.wrapText(paras[q], MM.layout.WRAP_CHARS);
        for (var w = 0; w < wrapped.length; w++) {
          lines.push(wrapped[w]);
          paraEnds.push(w === wrapped.length - 1);
        }
      }
    }
    if (!lines.length) { lines.push(''); paraEnds.push(true); }
    if (node.icon && !hasVectorIcon(node)) lines[0] = node.icon + (lines[0] ? ' ' + lines[0] : '');
    return { lines: lines, paraEnds: paraEnds };
  }

  /** Righe da disegnare: emoji in testa alla prima riga, maiuscolo se richiesto. */
  function linesFor(node, settings) {
    return richLinesFor(node, settings).lines;
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

  /** Rende qualsiasi colore #RRGGBB un riempimento pastello morbido e leggibile. */
  function pastelFill(hex, theme) {
    if (theme === 'scuro') return mixHex(hex, '#1E293B', 0.72);
    var r = parseInt(hex.substr(1, 2), 16);
    var g = parseInt(hex.substr(3, 2), 16);
    var b = parseInt(hex.substr(5, 2), 16);
    var lum = 0.299 * r + 0.587 * g + 0.114 * b;
    return lum >= 220 ? hex : mixHex(hex, '#FFFFFF', 0.86);
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

  /** Curva di Bézier (o segmento/gomito in base al layout) tra padre e figlio. */
  function branchPath(p, c, layout, depth) {
    if (layout === 'fishbone') {
      return 'M' + p.x + ' ' + p.y + ' L' + c.x + ' ' + c.y;
    }
    if (layout === 'org') {
      var midY = (p.y + c.y) / 2;
      return 'M' + p.x + ' ' + p.y + ' C' + p.x + ' ' + midY + ' ' + c.x + ' ' + midY + ' ' + c.x + ' ' + c.y;
    }
    if (layout === 'outline') {
      var dyO = c.y - p.y;
      var dxO = c.x - p.x;
      var r = Math.min(10, Math.abs(dyO) / 2, Math.abs(dxO) / 2);
      if (r > 1) {
        var sy = dyO >= 0 ? 1 : -1;
        var sx = dxO >= 0 ? 1 : -1;
        return 'M' + p.x + ' ' + p.y +
          ' L' + p.x + ' ' + (c.y - sy * r) +
          ' Q' + p.x + ' ' + c.y + ' ' + (p.x + sx * r) + ' ' + c.y +
          ' L' + c.x + ' ' + c.y;
      }
      return 'M' + p.x + ' ' + p.y + ' L' + p.x + ' ' + c.y + ' L' + c.x + ' ' + c.y;
    }
    if (layout === 'timeline') {
      if (depth === 1) {
        var tmx = p.x + (c.x - p.x) / 2;
        return 'M' + p.x + ' ' + p.y + ' C' + tmx + ' ' + p.y + ' ' + tmx + ' ' + c.y + ' ' + c.x + ' ' + c.y;
      }
      var tmy = p.y + (c.y - p.y) / 2;
      return 'M' + p.x + ' ' + p.y + ' C' + p.x + ' ' + tmy + ' ' + c.x + ' ' + tmy + ' ' + c.x + ' ' + c.y;
    }
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
      timeline: el('g', { 'class': 'layer-timeline' }, world),
      branches: el('g', { 'class': 'layer-branches' }, world),
      links: el('g', { 'class': 'layer-links' }, world),
      summaries: el('g', { 'class': 'layer-summaries' }, world),
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
    function measure(node, settings, depth) {
      var s = settings || MM.model.DEFAULT_SETTINGS;
      var bs = boxScale(node, s, depth);
      var fontSize = fontSizeFor(node, s, depth);
      var fontFamily = fontFamilyFor(node, s);
      var bold = isBoldFor(node, s, depth);
      var italic = !!node.italic;
      var lines = linesFor(node, s);
      var isCentral = isCentralNode(node, s, depth);
      var isVec = hasVectorIcon(node);
      var imgs = MM.model.nodeImagesOf ? MM.model.nodeImagesOf(node) : [];
      var imgKey = imgs.map(function (im) { return im.w + 'x' + im.h; }).join(',');
      var key = [lines.join('\n'), fontSize, bold, italic, fontFamily || '', node.shape, isCentral, isVec, !!node.bullets, node.textAlign || 'center', node.fillColor || '', s.fontFamily, bs, imgKey, !!node.personMode, node.role || '', node.avatarColor || ''].join('|');
      if (measureCache[key]) return measureCache[key];
      if (node.personMode) {
        var avD = Math.round(64 * bs);
        var maxNameW = 0;
        var pRawAny = false;
        for (var pi = 0; pi < lines.length; pi++) {
          var plw = lineWidth(lines[pi], fontSize, true, fontFamily, italic);
          if (plw > 0) pRawAny = true;
          maxNameW = Math.max(maxNameW, plw);
        }
        var roleFontSize = Math.round(fontSize * 0.84 * 10) / 10;
        var roleLines = node.role ? MM.layout.wrapText(node.role, 24) : [];
        var maxRoleW = 0;
        for (var ri = 0; ri < roleLines.length; ri++) {
          var rlw = lineWidth(roleLines[ri], roleFontSize, false, fontFamily, false);
          if (rlw > 0) pRawAny = true;
          maxRoleW = Math.max(maxRoleW, rlw);
        }
        if (!pRawAny && (lines.join('').trim() || roleLines.join('').trim())) {
          return MM.layout.estimateNode(node, s, depth);
        }
        var pw = Math.max(avD + 24, maxNameW + 20, maxRoleW + 20);
        var ph = avD + 12 + lines.length * fontSize * LINE_H + (roleLines.length ? 4 + roleLines.length * roleFontSize * LINE_H : 0) + 12;
        measureCache[key] = { width: Math.ceil(pw), height: Math.ceil(ph) };
        return measureCache[key];
      }
      var maxW = 0;
      var rawAny = false;
      var iconSize = Math.round(fontSize * 1.1);
      for (var i = 0; i < lines.length; i++) {
        var lw = lineWidth(lines[i], fontSize, bold, fontFamily, italic);
        if (lw > 0) rawAny = true;
        if (i === 0 && isVec) lw += iconSize + (lines[0] ? 8 : 0);
        maxW = Math.max(maxW, lw);
      }
      if ((!rawAny && lines.join('').trim()) || !maxW) return MM.layout.estimateNode(node, s, depth); // SVG non ancora visibile: non salvare in cache
      var w = Math.max(60 * bs, maxW + 2 * PAD_X * bs);
      var h = Math.max(40 * bs, lines.length * fontSize * LINE_H + 2 * PAD_Y * bs);
      var ib = imageBox(node, s, depth);
      if (ib) {
        w = Math.max(w, ib.width + 2 * PAD_Y * bs);
        h += ib.height + IMG_GAP * bs;
      }
      if (node.shape === 'ellipse') { w *= 1.3; h *= 1.4; }
      if (node.shape === 'circle') { var diam = Math.ceil(Math.max(w, h) * 1.25); w = diam; h = diam; }
      measureCache[key] = { width: Math.ceil(w), height: Math.ceil(h) };
      return measureCache[key];
    }

    MM.layout.setMeasurer(measure);

    function clearCache() { measureCache = {}; }

    /** Crea o aggiorna la forma di sfondo del nodo. */
    function drawShape(g, node, size, settings, depth) {
      var shapeEl = g.firstChild;
      var theme = MM.model.resolveTheme ? MM.model.resolveTheme(settings && settings.theme) : ((settings && settings.theme) || 'chiaro');
      var hasComment = !!(node.comment && theme !== 'alto-contrasto');
      if (node.personMode) {
        if (!shapeEl || shapeEl.tagName !== 'rect') {
          var freshP = el('rect', { 'class': 'node-shape node-shape-person' });
          if (shapeEl) g.replaceChild(freshP, shapeEl); else g.insertBefore(freshP, g.firstChild);
          shapeEl = freshP;
        } else {
          shapeEl.setAttribute('class', 'node-shape node-shape-person');
        }
        setAttrs(shapeEl, {
          x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height, rx: 14,
          fill: hasComment ? '#FFF04B' : 'transparent',
          stroke: hasComment ? '#A16207' : 'none',
          'stroke-width': hasComment ? 3 : 0
        });
        return;
      }
      var tag = (node.shape === 'ellipse' || node.shape === 'circle') ? 'ellipse' : 'rect';
      if (!shapeEl || shapeEl.tagName !== tag) {
        var fresh = el(tag, { 'class': 'node-shape' });
        if (shapeEl) g.replaceChild(fresh, shapeEl); else g.insertBefore(fresh, g.firstChild);
        shapeEl = fresh;
      } else {
        shapeEl.setAttribute('class', 'node-shape');
      }
      var isCentral = isCentralNode(node, settings, depth);
      if (tag === 'ellipse') {
        setAttrs(shapeEl, { cx: 0, cy: 0, rx: size.width / 2, ry: size.height / 2 });
      } else {
        setAttrs(shapeEl, {
          x: -size.width / 2, y: -size.height / 2, width: size.width, height: size.height,
          rx: node.shape === 'rounded' ? (isCentral ? 14 : 11) : 4
        });
      }
      var fillColor, strokeColor;
      var effDepth = (settings && settings.layout === 'compare' && depth > 0) ? depth - 1 : (depth || 0);
      var strokeW = isCentral ? 3 : Math.max(1.6, Math.round((3 - effDepth * 0.5) * 10) / 10);
      if (hasComment) {
        fillColor = '#FFF04B';
        strokeColor = isCentral ? '#A16207' : node.color;
      } else if (isCentral) {
        fillColor = node.color;
        strokeColor = theme === 'alto-contrasto'
          ? '#FFFFFF'
          : (theme === 'scuro' ? '#CBD5E1' : darken(node.color, 0.38));
      } else {
        fillColor = theme === 'alto-contrasto'
          ? '#000000'
          : (theme === 'scuro' ? mixHex(node.color, '#1E293B', 0.80) : mixHex(node.color, '#FFFFFF', 0.91));
        strokeColor = node.color;
      }
      if (!hasComment && theme !== 'alto-contrasto' && node.fillColor) {
        fillColor = pastelFill(node.fillColor, theme);
      }
      setAttrs(shapeEl, {
        fill: fillColor,
        stroke: strokeColor,
        'stroke-width': strokeW
      });
    }

    function drawText(g, node, settings, depth, size) {
      var oldIcon = g.querySelector('.node-icon');
      if (oldIcon) g.removeChild(oldIcon);
      var oldImg = g.querySelector('.node-image-wrap');
      if (oldImg) g.removeChild(oldImg);
      var oldAvatar = g.querySelector('.node-avatar-wrap');
      if (oldAvatar) g.removeChild(oldAvatar);
      var oldRole = g.querySelector('.node-role');
      if (oldRole) g.removeChild(oldRole);
      var textEl = g.querySelector('.node-text');
      if (!textEl) textEl = el('text', { 'class': 'node-text', 'text-anchor': 'middle' }, g);
      var fontSize = fontSizeFor(node, settings, depth);
      var fontFamily = fontFamilyFor(node, settings);
      var bold = isBoldFor(node, settings, depth);
      var italic = !!node.italic;
      var rich = richLinesFor(node, settings);
      var lines = rich.lines;
      var paraEnds = rich.paraEnds;
      var lineH = fontSize * LINE_H;
      var isCentral = isCentralNode(node, settings, depth);
      var theme = MM.model.resolveTheme ? MM.model.resolveTheme(settings && settings.theme) : ((settings && settings.theme) || 'chiaro');
      var hasComment = !!(node.comment && theme !== 'alto-contrasto');
      var bs = boxScale(node, settings, depth);
      var deco = [];
      if (node.underline) deco.push('underline');
      if (node.strike) deco.push('line-through');

      if (node.personMode) {
        var avR = Math.round(32 * bs);
        var avY = -(size ? size.height : 100) / 2 + avR + 6;
        var avColor = node.avatarColor || node.color;
        var avWrap = el('g', { 'class': 'node-avatar-wrap' });
        g.insertBefore(avWrap, textEl);
        var pImgs = MM.model.nodeImagesOf ? MM.model.nodeImagesOf(node) : [];
        if (pImgs.length > 0) {
          var avClipId = 'mm-av-clip-' + node.id;
          var avCp = el('clipPath', { id: avClipId }, avWrap);
          el('circle', { cx: 0, cy: avY, r: avR }, avCp);
          var avImg = el('image', {
            x: -avR, y: avY - avR, width: avR * 2, height: avR * 2,
            preserveAspectRatio: 'xMidYMid slice', 'clip-path': 'url(#' + avClipId + ')'
          }, avWrap);
          avImg.setAttribute('href', pImgs[0].src);
          avImg.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', pImgs[0].src);
          el('circle', { cx: 0, cy: avY, r: avR, fill: 'none', stroke: avColor, 'stroke-width': 4 }, avWrap);
        } else {
          el('circle', { cx: 0, cy: avY, r: avR, fill: avColor, stroke: darken(avColor, 0.25), 'stroke-width': 3 }, avWrap);
          el('circle', { cx: 0, cy: avY - avR * 0.2, r: avR * 0.28, fill: '#FFFFFF' }, avWrap);
          var sx = (avR * 0.52).toFixed(1);
          var sy = (avY + avR * 0.56).toFixed(1);
          var syTop = (avY + avR * 0.14).toFixed(1);
          var syBot = (avY + avR * 0.78).toFixed(1);
          el('path', {
            d: 'M-' + sx + ' ' + sy + ' C-' + sx + ' ' + syTop + ' ' + sx + ' ' + syTop + ' ' + sx + ' ' + sy + ' Q0 ' + syBot + ' -' + sx + ' ' + sy + ' Z',
            fill: '#FFFFFF'
          }, avWrap);
        }
        var pAutoFill = hasComment
          ? '#0F172A'
          : (theme === 'scuro' ? '#F8FAFC' : (theme === 'alto-contrasto' ? '#FFFFFF' : '#0F172A'));
        var pTextFill = (node.textColor && theme !== 'alto-contrasto') ? node.textColor : pAutoFill;
        setAttrs(textEl, {
          'text-anchor': 'middle',
          'font-size': fontSize,
          'font-weight': 'bold',
          'font-style': italic ? 'italic' : 'normal',
          'font-family': fontFamily || null,
          'text-decoration': deco.length ? deco.join(' ') : null,
          fill: pTextFill
        });
        textEl.textContent = '';
        var nameFirstY = avY + avR + 10 + fontSize * 0.5;
        lines.forEach(function (line, li) {
          var t = el('tspan', { x: 0, y: nameFirstY + li * lineH, 'dominant-baseline': 'central' }, textEl);
          t.textContent = line || '\u00a0';
        });
        if (node.role) {
          var roleFontSize = Math.round(fontSize * 0.84 * 10) / 10;
          var roleLineH = roleFontSize * LINE_H;
          var roleLines = MM.layout.wrapText(node.role, 24);
          var roleEl = el('text', {
            'class': 'node-role',
            'text-anchor': 'middle',
            'font-size': roleFontSize,
            'font-family': fontFamily || null,
            fill: theme === 'scuro' ? '#94A3B8' : '#64748B'
          }, g);
          var roleFirstY = nameFirstY + (lines.length - 1) * lineH + lineH * 0.5 + 4 + roleFontSize * 0.5;
          roleLines.forEach(function (rLine, ri) {
            var rt = el('tspan', { x: 0, y: roleFirstY + ri * roleLineH, 'dominant-baseline': 'central' }, roleEl);
            rt.textContent = rLine || '\u00a0';
          });
        }
        return;
      }

      var hasCustomFill = !hasComment && theme !== 'alto-contrasto' && !!node.fillColor;
      var autoFill = hasComment
        ? '#0F172A'
        : (hasCustomFill
          ? (theme === 'scuro' ? '#F8FAFC' : '#0F172A')
          : (isCentral
            ? MM.model.textColorFor(node.color)
            : (theme === 'scuro' ? '#F8FAFC' : (theme === 'alto-contrasto' ? '#FFFFFF' : '#0F172A'))));
      var textFill = (node.textColor && theme !== 'alto-contrasto') ? node.textColor : autoFill;
      var align = node.textAlign || 'center';
      var anchor = (align === 'left' || align === 'justify') ? 'start' : (align === 'right' ? 'end' : 'middle');
      var padX = PAD_X * bs;
      var innerW = Math.max(24, (size ? size.width : 120) - 2 * padX);
      setAttrs(textEl, {
        'text-anchor': anchor,
        'font-size': fontSize,
        'font-weight': bold ? 'bold' : 'normal',
        'font-style': italic ? 'italic' : 'normal',
        'font-family': fontFamily || null,
        'text-decoration': deco.length ? deco.join(' ') : null,
        fill: textFill
      });
      textEl.textContent = '';
      var firstY = -((lines.length - 1) * lineH) / 2;
      var ib = imageBox(node, settings, depth);
      if (ib && ib.items && ib.items.length) {
        var gap = IMG_GAP * bs;
        var contentH = ib.height + gap + lines.length * lineH;
        var top = -contentH / 2;
        firstY += (ib.height + gap) / 2;
        var wrap = el('g', { 'class': 'node-image-wrap' });
        g.insertBefore(wrap, textEl);
        ib.items.forEach(function (item, idx) {
          var clipId = 'mm-img-clip-' + node.id + '-' + idx;
          var cp = el('clipPath', { id: clipId }, wrap);
          el('rect', { x: item.x, y: top + item.y, width: item.width, height: item.height, rx: 7 }, cp);
          var imgEl = el('image', {
            'class': 'node-image', x: item.x, y: top + item.y, width: item.width, height: item.height,
            preserveAspectRatio: 'xMidYMid slice', 'clip-path': 'url(#' + clipId + ')'
          }, wrap);
          imgEl.setAttribute('href', item.src);
          imgEl.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', item.src);
        });
      }
      var isVec = hasVectorIcon(node);
      var iconSize = Math.round(fontSize * 1.1);
      var iconGap = 8;
      var hasText0 = !!lines[0];
      var leftX = -innerW / 2;
      var rightX = innerW / 2;
      var line0X = 0;
      var otherX = 0;
      if (align === 'left' || align === 'justify') {
        line0X = isVec ? (leftX + iconSize + iconGap) : leftX;
        otherX = leftX;
      } else if (align === 'right') {
        line0X = rightX;
        otherX = rightX;
      } else {
        line0X = (isVec && hasText0) ? (iconSize + iconGap) / 2 : 0;
        otherX = 0;
      }
      if (isVec) {
        var t0w = hasText0 ? (lineWidth(lines[0], fontSize, bold, fontFamily, italic) || lines[0].length * fontSize * 0.55) : 0;
        var iconX;
        if (align === 'left' || align === 'justify') {
          iconX = leftX;
        } else if (align === 'right') {
          iconX = rightX - t0w - (hasText0 ? iconGap : 0) - iconSize;
        } else {
          var totalW = iconSize + (hasText0 ? iconGap + t0w : 0);
          iconX = -totalW / 2;
        }
        var iconY = firstY - iconSize / 2;
        var scale = iconSize / 24;
        var iconColor = hasComment ? '#0F172A' : (hasCustomFill ? (theme === 'scuro' ? '#F8FAFC' : node.color) : (isCentral ? MM.model.textColorFor(node.color) : node.color));
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
      }
      lines.forEach(function (line, i) {
        var attrs = {
          x: i === 0 ? line0X : otherX,
          y: firstY + i * lineH,
          'dominant-baseline': 'central'
        };
        if (align === 'justify' && !paraEnds[i] && line.trim().indexOf(' ') > 0) {
          var targetW = (i === 0 && isVec) ? Math.max(20, innerW - iconSize - iconGap) : innerW;
          attrs.textLength = targetW.toFixed(1);
          attrs.lengthAdjust = 'spacing';
        }
        var t = el('tspan', attrs, textEl);
        t.textContent = line || '\u00a0';
      });
    }

    /** Indicatori: "+N" sui nodi compressi, icona nota se c'è una nota, lucchetto sul nodo selezionato. */
    function drawBadges(g, map, node, size, opts) {
      var old = g.querySelectorAll('.node-badge');
      for (var i = 0; i < old.length; i++) g.removeChild(old[i]);
      if (node.collapsed && node.children.length) {
        var n = MM.model.getDescendants(map, node.id).length;
        var b = el('g', { 'class': 'node-badge badge-collapsed', transform: 'translate(' + (size.width / 2) + ' 0)' }, g);
        el('circle', { r: 12, stroke: node.color }, b);
        el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 11 }, b).textContent = '+' + n;
      }
      if (node.comment) {
        var cb = el('g', {
          'class': 'node-badge badge-comment',
          transform: 'translate(' + (size.width / 2 - 4) + ' ' + (-size.height / 2 + 4) + ')'
        }, g);
        el('title', null, cb).textContent = 'Commento: ' + node.comment;
        el('circle', { r: 11, fill: '#FACC15', stroke: '#854D0E', 'stroke-width': 1.8 }, cb);
        var msgPaths = MM.icons && MM.icons.uiPaths('message');
        if (msgPaths) {
          var ci = el('g', {
            'class': 'badge-comment-icon',
            transform: 'translate(-6 -6) scale(0.5)',
            fill: 'none',
            stroke: '#1E293B',
            'stroke-width': '2.2',
            'stroke-linecap': 'round',
            'stroke-linejoin': 'round'
          }, cb);
          ci.innerHTML = msgPaths;
        }
      }
      if (node.note) {
        var noteX = node.comment ? (size.width / 2 - 28) : (size.width / 2 - 4);
        var nb = el('g', {
          'class': 'node-badge badge-note',
          transform: 'translate(' + noteX + ' ' + (-size.height / 2 + 4) + ')'
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
      if (opts && opts.selectedId === node.id && node.parentId !== null) {
        var isUnlocked = opts.unlockedId === node.id;
        var theme = MM.model.resolveTheme ? MM.model.resolveTheme(map.settings && map.settings.theme) : ((map.settings && map.settings.theme) || 'chiaro');
        var lb = el('g', {
          'class': 'node-badge badge-lock' + (isUnlocked ? ' unlocked' : ''),
          transform: 'translate(' + (-size.width / 2 + 4) + ' ' + (-size.height / 2 + 4) + ')'
        }, g);
        el('title', null, lb).textContent = isUnlocked
          ? 'Lucchetto aperto: trascina su un altro nodo per spostare questo ramo (clicca per bloccare)'
          : 'Lucchetto chiuso: trascina per spostare liberamente. Clicca per aprire e spostare su un altro nodo';
        var lockStroke = isUnlocked ? '#D97706' : (theme === 'alto-contrasto' ? '#FFFFFF' : '#64748B');
        var lockFill = isUnlocked
          ? '#FEF3C7'
          : (theme === 'alto-contrasto' ? '#000000' : (theme === 'scuro' ? '#1E293B' : '#FFFFFF'));
        el('circle', { r: 11, fill: lockFill, stroke: lockStroke, 'stroke-width': 1.75 }, lb);
        var lockPaths = (MM.icons && MM.icons.uiPaths(isUnlocked ? 'unlock' : 'lock'))
          || (isUnlocked
            ? '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 9.9-1"/>'
            : '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>');
        var li = el('g', {
          'class': 'badge-lock-icon',
          transform: 'translate(-6 -6) scale(0.5)',
          fill: 'none',
          stroke: lockStroke,
          'stroke-width': '2.2',
          'stroke-linecap': 'round',
          'stroke-linejoin': 'round'
        }, lb);
        li.innerHTML = lockPaths;
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
      if (node.comment) label += '. Commento: ' + node.comment;
      return label;
    }

    function computeDepthMap(map) {
      var depthMap = {};
      if (!map || !map.rootId || !map.nodes[map.rootId]) return depthMap;
      var queue = [map.rootId];
      depthMap[map.rootId] = 0;
      for (var qi = 0; qi < queue.length; qi++) {
        var id = queue[qi];
        var n = map.nodes[id];
        if (!n || !n.children) continue;
        var nextD = depthMap[id] + 1;
        for (var i = 0; i < n.children.length; i++) {
          var cid = n.children[i];
          if (depthMap[cid] === undefined && map.nodes[cid]) {
            depthMap[cid] = nextD;
            queue.push(cid);
          }
        }
      }
      var summaries = map.summaries || [];
      var sQueue = [];
      for (var si = 0; si < summaries.length; si++) {
        var s = summaries[si];
        var sChildren = (s && s.children) || [];
        for (var sc = 0; sc < sChildren.length; sc++) {
          var scid = sChildren[sc];
          if (depthMap[scid] === undefined && map.nodes[scid]) {
            depthMap[scid] = 2;
            sQueue.push(scid);
          }
        }
      }
      for (var sqi = 0; sqi < sQueue.length; sqi++) {
        var sid = sQueue[sqi];
        var sn = map.nodes[sid];
        if (!sn || !sn.children) continue;
        var nextSD = depthMap[sid] + 1;
        for (var j = 0; j < sn.children.length; j++) {
          var dcid = sn.children[j];
          if (depthMap[dcid] === undefined && map.nodes[dcid]) {
            depthMap[dcid] = nextSD;
            sQueue.push(dcid);
          }
        }
      }
      return depthMap;
    }

    function renderNode(map, node, opts, visibleSet, depthMap) {
      var g = nodeEls[node.id];
      if (!g) {
        g = el('g', { 'class': 'node', 'data-id': node.id, role: 'treeitem' }, layers.nodes);
        nodeEls[node.id] = g;
      }
      var depth = (depthMap && depthMap[node.id] !== undefined) ? depthMap[node.id] : MM.model.getDepth(map, node.id);
      var size = measure(node, map.settings, depth);
      var resolvedTheme = MM.model.resolveTheme ? MM.model.resolveTheme(map.settings.theme) : map.settings.theme;
      var imgsSig = (MM.model.nodeImagesOf ? MM.model.nodeImagesOf(node) : []).map(function (im) {
        return im.src.length + ':' + im.src.slice(-24);
      }).join(',');
      var isSelected = opts.selectedId === node.id;
      var showLock = isSelected && node.parentId !== null;
      var isUnlocked = showLock && opts.unlockedId === node.id;
      var sig = [node.text, node.icon, node.note, node.comment || '', node.subLayout || '', node.color, node.shape, node.collapsed,
        node.fontName || '', node.fontSize || 0, node.bold, !!node.italic, !!node.underline,
        !!node.strike, !!node.uppercase, !!node.bullets, node.textAlign || 'center', node.fillColor || '', node.textColor || '', node.boxSize || '',
        !!node.personMode, node.role || '', node.avatarColor || '',
        depth, map.settings.sizeByLevel,
        map.settings.layout === 'compare',
        imgsSig, showLock, isUnlocked,
        node.children.length, map.settings.fontScale, map.settings.uppercase, map.settings.fontFamily,
        map.settings.fontName || '', resolvedTheme, size.width, size.height].join('\x1f');
      if (g.__sig !== sig) {
        drawShape(g, node, size, map.settings, depth);
        drawText(g, node, map.settings, depth, size);
        drawBadges(g, map, node, size, opts);
        g.__sig = sig;
      }
      var isMulti = Array.isArray(opts.selectedIds) && opts.selectedIds.indexOf(node.id) >= 0;
      var pos = node.x + ',' + node.y;
      if (g.__pos !== pos) {
        g.setAttribute('transform', 'translate(' + node.x + ' ' + node.y + ')');
        g.__pos = pos;
      }
      var ariaLabel = nodeLabel(map, node);
      if (g.__ariaLabel !== ariaLabel) {
        g.setAttribute('aria-label', ariaLabel);
        g.__ariaLabel = ariaLabel;
      }
      var isSel = isSelected || isMulti;
      var sel = isSel ? 'true' : 'false';
      if (g.__sel !== sel) {
        g.setAttribute('aria-selected', sel);
        g.__sel = sel;
      }
      var ariaLevel = depth + 1;
      if (g.__ariaLevel !== ariaLevel) {
        g.setAttribute('aria-level', ariaLevel);
        g.__ariaLevel = ariaLevel;
      }
      var ariaExp = node.children.length ? String(!node.collapsed) : null;
      if (g.__ariaExp !== ariaExp) {
        if (ariaExp === null) g.removeAttribute('aria-expanded');
        else g.setAttribute('aria-expanded', ariaExp);
        g.__ariaExp = ariaExp;
      }
      var isRoot = node.parentId === null;
      var isLinkSrc = opts.pendingLinkFrom === node.id;
      var isDrop = opts.dropTargetId === node.id;
      var isDrag = opts.draggingId === node.id;
      var cls = (isRoot ? 1 : 0) | (isSel ? 2 : 0) | (isMulti ? 4 : 0) |
        (isLinkSrc ? 8 : 0) | (isDrop ? 16 : 0) | (isDrag ? 32 : 0);
      if (g.__cls !== cls) {
        g.classList.toggle('root', isRoot);
        g.classList.toggle('selected', isSel);
        g.classList.toggle('multi-selected', isMulti);
        g.classList.toggle('link-source', isLinkSrc);
        g.classList.toggle('drop-target', isDrop);
        g.classList.toggle('dragging', isDrag);
        g.__cls = cls;
      }
      return size;
    }

    function renderBranch(map, node, sizes, depthMap) {
      var isSummaryParent = !map.nodes[node.parentId];
      var parent = map.nodes[node.parentId] || lastSummaryBoxes[node.parentId];
      var ps = sizes[node.parentId] || lastSummaryBoxes[node.parentId];
      var ns = sizes[node.id];
      if (!parent || !ps || !ns) return;
      var path = branchEls[node.id];
      if (!path) {
        path = el('path', { 'class': 'branch', 'data-id': node.id }, layers.branches);
        branchEls[node.id] = path;
      }
      var layout = map.settings && map.settings.layout;
      var depth = (depthMap && depthMap[node.id] !== undefined) ? depthMap[node.id] : MM.model.getDepth(map, node.id);
      var effDepth = depth;
      if (layout === 'compare' && !isSummaryParent) {
        var branchRoot = MM.model.getBranchRoot(map, node.id);
        layout = (branchRoot && branchRoot.subLayout) || 'radial';
        effDepth = Math.max(1, depth - 1);
      }
      var start, end, curveLayout;
      if (isSummaryParent) {
        if (layout === 'org') {
          start = { x: parent.x, y: parent.y + ps.height / 2 };
          end = { x: node.x, y: node.y - ns.height / 2 };
          curveLayout = 'org';
        } else {
          var sDir = node.x >= parent.x ? 1 : -1;
          start = { x: parent.x + sDir * ps.width / 2, y: parent.y };
          end = { x: node.x - sDir * ns.width / 2, y: node.y };
          curveLayout = 'tree';
        }
      } else {
        curveLayout = layout;
        if (layout === 'org') {
          start = { x: parent.x, y: parent.y + ps.height / 2 };
          end = { x: node.x, y: node.y - ns.height / 2 };
        } else if (layout === 'outline') {
          start = { x: parent.x - ps.width / 2 + 16, y: parent.y + ps.height / 2 };
          end = { x: node.x - ns.width / 2, y: node.y };
        } else {
          start = edgePoint(parent, ps, node);
          end = edgePoint(node, ns, parent);
        }
      }
      var stroke = node.color;
      var strokeW = Math.max(1.5, 3.5 - (effDepth - 1) * 0.75);
      var bSig = start.x + ',' + start.y + ',' + end.x + ',' + end.y + ',' + stroke + ',' + strokeW + ',' + curveLayout + ',' + (curveLayout === 'timeline' ? effDepth : '');
      if (path.__sig !== bSig) {
        setAttrs(path, {
          d: branchPath(start, end, curveLayout, effDepth),
          stroke: stroke,
          'stroke-width': strokeW
        });
        path.__sig = bSig;
      }
    }

    function renderLink(map, link, sizes, opts) {
      var a = map.nodes[link.fromId];
      var b = map.nodes[link.toId];
      var item = linkEls[link.id];
      if (!item) {
        item = {
          path: el('path', { 'class': 'link', 'data-link-id': link.id, 'marker-end': 'url(#mm-arrow)' }, layers.links),
          hit: el('path', { 'class': 'link-hit', 'data-link-id': link.id }, layers.links),
          label: el('g', { 'class': 'link-label', 'data-link-id': link.id }, layers.labels),
          handle: el('circle', { 'class': 'link-handle', 'data-link-id': link.id, r: 7 }, layers.labels)
        };
        el('rect', { rx: 6 }, item.label);
        el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central' }, item.label);
        el('title', null, item.handle).textContent = 'Trascina per modificare la curva della freccia';
        linkEls[link.id] = item;
      }
      var p1 = edgePoint(a, sizes[a.id], b);
      var p2 = edgePoint(b, sizes[b.id], a);
      var mx = (p1.x + p2.x) / 2;
      var my = (p1.y + p2.y) / 2;
      var dx = p2.x - p1.x;
      var dy = p2.y - p1.y;
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      var style = link.style || 'curved';
      var defaultBend = Math.min(60, len * 0.15);
      var bend = (typeof link.curve === 'number' && isFinite(link.curve)) ? link.curve : defaultBend;
      var d, lx, ly;
      if (style === 'straight') {
        d = 'M' + p1.x + ' ' + p1.y + ' L' + p2.x + ' ' + p2.y;
        lx = mx;
        ly = my;
      } else if (style === 'elbow') {
        var ex = Math.round(mx + ((typeof link.curve === 'number' && isFinite(link.curve)) ? link.curve * 0.6 : 0));
        d = 'M' + p1.x + ' ' + p1.y + ' L' + ex + ' ' + p1.y + ' L' + ex + ' ' + p2.y + ' L' + p2.x + ' ' + p2.y;
        lx = ex;
        ly = my;
      } else {
        var cx = mx - dy / len * bend;
        var cy = my + dx / len * bend;
        d = 'M' + p1.x + ' ' + p1.y + ' Q' + cx + ' ' + cy + ' ' + p2.x + ' ' + p2.y;
        lx = 0.25 * p1.x + 0.5 * cx + 0.25 * p2.x;
        ly = 0.25 * p1.y + 0.5 * cy + 0.25 * p2.y;
      }
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
      setAttrs(item.handle, { cx: lx, cy: ly + (link.label ? -20 : 0) });
      item.handle.style.display = selected ? '' : 'none';
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

    function renderTimeline(map, sizes, visibleSet) {
      layers.timeline.textContent = '';
      var layout = map.settings && map.settings.layout;
      if (layout !== 'timeline' && layout !== 'compare') return;
      var centers = [];
      if (layout === 'timeline') {
        if (map.nodes[map.rootId]) centers.push(map.nodes[map.rootId]);
      } else {
        var rootNode = map.nodes[map.rootId];
        var rootKids = (rootNode && rootNode.children) || [];
        for (var ci = 0; ci < rootKids.length; ci++) {
          var cid = rootKids[ci];
          var cn = map.nodes[cid];
          if (cn && visibleSet[cid] && cn.subLayout === 'timeline') centers.push(cn);
        }
      }
      for (var c = 0; c < centers.length; c++) {
        var r = centers[c];
        var rs = r && sizes[r.id];
        if (!r || !rs) continue;
        var milestones = (r.children || []).filter(function (cid) {
          return visibleSet[cid] && map.nodes[cid] && sizes[cid];
        });
        if (!milestones.length) continue;
        var startX = r.x + rs.width / 2;
        var maxMX = startX;
        for (var i = 0; i < milestones.length; i++) {
          var m = map.nodes[milestones[i]];
          if (m.x > maxMX) maxMX = m.x;
        }
        var endX = maxMX + 48;
        el('line', {
          'class': 'timeline-spine',
          x1: startX, y1: r.y, x2: endX, y2: r.y,
          'marker-end': 'url(#mm-arrow)'
        }, layers.timeline);
        for (var j = 0; j < milestones.length; j++) {
          var mid = milestones[j];
          var mn = map.nodes[mid];
          var ms = sizes[mid];
          var stemY2 = mn.y < r.y ? (mn.y + ms.height / 2) : (mn.y - ms.height / 2);
          el('line', {
            'class': 'timeline-stem',
            x1: mn.x, y1: r.y, x2: mn.x, y2: stemY2,
            stroke: mn.color
          }, layers.timeline);
          el('circle', {
            'class': 'timeline-dot',
            cx: mn.x, cy: r.y, r: 6.5,
            fill: mn.color
          }, layers.timeline);
        }
      }
    }

    function renderSummaries(map, sizes, visibleSet, opts) {
      layers.summaries.textContent = '';
      var boxes = {};
      var list = map.summaries || [];
      if (!list.length || !MM.model.getSummaryNodes) {
        lastSummaryBoxes = boxes;
        return boxes;
      }
      var layout = map.settings && map.settings.layout;

      for (var i = 0; i < list.length; i++) {
        var s = list[i];
        var rawSibs = MM.model.getSummaryNodes(map, s) || [];
        var sibs = [];
        for (var si = 0; si < rawSibs.length; si++) {
          var sid = rawSibs[si];
          if (visibleSet[sid] && map.nodes[sid] && sizes[sid]) sibs.push(sid);
        }
        if (!sibs.length) continue;

        var covered = [];
        var seenCov = {};
        for (var c = 0; c < sibs.length; c++) {
          var baseId = sibs[c];
          if (!seenCov[baseId]) { seenCov[baseId] = true; covered.push(baseId); }
          var desc = MM.model.getDescendants(map, baseId);
          for (var di = 0; di < desc.length; di++) {
            var did = desc[di];
            if (visibleSet[did] && !seenCov[did] && map.nodes[did] && sizes[did]) {
              seenCov[did] = true;
              covered.push(did);
            }
          }
        }

        var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (var k = 0; k < covered.length; k++) {
          var cn = map.nodes[covered[k]];
          var cs = sizes[covered[k]];
          minX = Math.min(minX, cn.x - cs.width / 2);
          maxX = Math.max(maxX, cn.x + cs.width / 2);
          minY = Math.min(minY, cn.y - cs.height / 2);
          maxY = Math.max(maxY, cn.y + cs.height / 2);
        }
        if (!isFinite(minX)) continue;

        var parent = (s.parentId && map.nodes[s.parentId]) ? map.nodes[s.parentId] : null;
        var rootNode = map.nodes[map.rootId];
        var refX = parent ? parent.x : (rootNode ? rootNode.x : 0);
        var color = s.color || '#475569';
        var selected = !!(opts && opts.selectedSummaryId === s.id);
        var g = el('g', {
          'class': 'summary-group' + (selected ? ' selected' : ''),
          'data-summary-id': s.id
        }, layers.summaries);

        var sumNode = {
          id: s.id,
          parentId: '__summary__',
          text: s.text || 'Riepilogo',
          color: color,
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
        var sumSize = measure(sumNode, map.settings, 1);
        var boxW = sumSize.width;
        var boxH = sumSize.height;

        var braceD, boxX, boxY;
        if (layout === 'org') {
          var midX = (minX + maxX) / 2;
          var spanX = Math.max(24, maxX - minX);
          var xL = midX - spanX / 2;
          var xR = midX + spanX / 2;
          var y0 = maxY + 12;
          var yMid = y0 + 8;
          var yTip = y0 + 16;
          var rX = Math.min(14, spanX / 4);
          braceD = 'M' + xL.toFixed(1) + ' ' + y0.toFixed(1) +
            ' C' + xL.toFixed(1) + ' ' + yMid.toFixed(1) + ' ' + (xL + rX * 0.4).toFixed(1) + ' ' + yMid.toFixed(1) + ' ' + (xL + rX).toFixed(1) + ' ' + yMid.toFixed(1) +
            ' L' + (midX - rX).toFixed(1) + ' ' + yMid.toFixed(1) +
            ' C' + (midX - rX * 0.3).toFixed(1) + ' ' + yMid.toFixed(1) + ' ' + midX.toFixed(1) + ' ' + (yMid + 1).toFixed(1) + ' ' + midX.toFixed(1) + ' ' + yTip.toFixed(1) +
            ' C' + midX.toFixed(1) + ' ' + (yMid + 1).toFixed(1) + ' ' + (midX + rX * 0.3).toFixed(1) + ' ' + yMid.toFixed(1) + ' ' + (midX + rX).toFixed(1) + ' ' + yMid.toFixed(1) +
            ' L' + (xR - rX).toFixed(1) + ' ' + yMid.toFixed(1) +
            ' C' + (xR - rX * 0.4).toFixed(1) + ' ' + yMid.toFixed(1) + ' ' + xR.toFixed(1) + ' ' + yMid.toFixed(1) + ' ' + xR.toFixed(1) + ' ' + y0.toFixed(1);
          boxX = midX - boxW / 2;
          boxY = maxY + 34;
        } else {
          var leftSide = (minX + maxX) / 2 < refX;
          var dir = leftSide ? -1 : 1;
          var x0 = leftSide ? (minX - 12) : (maxX + 12);
          var xMid = x0 + dir * 8;
          var xTip = x0 + dir * 16;
          var midY = (minY + maxY) / 2;
          var spanY = Math.max(24, maxY - minY);
          var yT = midY - spanY / 2;
          var yB = midY + spanY / 2;
          var rY = Math.min(14, spanY / 4);
          braceD = 'M' + x0.toFixed(1) + ' ' + yT.toFixed(1) +
            ' C' + xMid.toFixed(1) + ' ' + yT.toFixed(1) + ' ' + xMid.toFixed(1) + ' ' + (yT + rY * 0.4).toFixed(1) + ' ' + xMid.toFixed(1) + ' ' + (yT + rY).toFixed(1) +
            ' L' + xMid.toFixed(1) + ' ' + (midY - rY).toFixed(1) +
            ' C' + xMid.toFixed(1) + ' ' + (midY - rY * 0.3).toFixed(1) + ' ' + (xMid + dir).toFixed(1) + ' ' + midY.toFixed(1) + ' ' + xTip.toFixed(1) + ' ' + midY.toFixed(1) +
            ' C' + (xMid + dir).toFixed(1) + ' ' + midY.toFixed(1) + ' ' + xMid.toFixed(1) + ' ' + (midY + rY * 0.3).toFixed(1) + ' ' + xMid.toFixed(1) + ' ' + (midY + rY).toFixed(1) +
            ' L' + xMid.toFixed(1) + ' ' + (yB - rY).toFixed(1) +
            ' C' + xMid.toFixed(1) + ' ' + (yB - rY * 0.4).toFixed(1) + ' ' + xMid.toFixed(1) + ' ' + yB.toFixed(1) + ' ' + x0.toFixed(1) + ' ' + yB.toFixed(1);
          boxX = leftSide ? (xTip - 8 - boxW) : (xTip + 8);
          boxY = midY - boxH / 2;
        }

        el('path', {
          'class': 'summary-brace-hit', d: braceD, fill: 'none', stroke: 'transparent', 'stroke-width': 14,
          'data-summary-id': s.id
        }, g);
        el('path', {
          'class': 'summary-brace', d: braceD, fill: 'none', stroke: color, 'stroke-width': 3,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          'data-summary-id': s.id
        }, g);
        var boxG = el('g', {
          'class': 'node summary-node-wrap' + (selected ? ' selected' : ''),
          transform: 'translate(' + (boxX + boxW / 2).toFixed(1) + ' ' + (boxY + boxH / 2).toFixed(1) + ')',
          'data-summary-id': s.id
        }, g);
        drawShape(boxG, sumNode, sumSize, map.settings, 1);
        drawText(boxG, sumNode, map.settings, 1, sumSize);
        drawBadges(boxG, map, sumNode, sumSize, {});
        boxes[s.id] = { x: boxX + boxW / 2, y: boxY + boxH / 2, width: boxW, height: boxH };
      }
      lastSummaryBoxes = boxes;
      return boxes;
    }

    /**
     * Disegna la mappa. opts: { selectedId, selectedLinkId, selectedSummaryId, pendingLinkFrom, dropTargetId, draggingId }.
     * @returns {Object<string, {width:number, height:number}>} dimensioni dei nodi visibili.
     */
    function render(map, options) {
      var opts = options || {};
      var visible = MM.model.getVisibleNodeIds(map);
      svgEl.classList.toggle('heavy-map', visible.length > 150);
      var visibleSet = {};
      var sizes = {};
      var depthMap = computeDepthMap(map);
      visible.forEach(function (id) { visibleSet[id] = true; });
      visible.forEach(function (id) { sizes[id] = renderNode(map, map.nodes[id], opts, visibleSet, depthMap); });

      renderTimeline(map, sizes, visibleSet);
      renderSummaries(map, sizes, visibleSet, opts);

      var branchKeep = {};
      var isCompare = map.settings && map.settings.layout === 'compare';
      var isTimeline = map.settings && map.settings.layout === 'timeline';
      visible.forEach(function (id) {
        var n = map.nodes[id];
        var d = depthMap[id] !== undefined ? depthMap[id] : MM.model.getDepth(map, id);
        var isCompareTimelineStem = isCompare && d === 2 && map.nodes[n.parentId] && map.nodes[n.parentId].subLayout === 'timeline';
        if (n.parentId !== null && !(isCompare && n.parentId === map.rootId) && !(isTimeline && d === 1) && !isCompareTimelineStem) {
          branchKeep[id] = true;
          renderBranch(map, n, sizes, depthMap);
        }
      });

      var linkKeep = {};
      (map.links || []).forEach(function (l) {
        if (visibleSet[l.fromId] && visibleSet[l.toId]) { linkKeep[l.id] = true; renderLink(map, l, sizes, opts); }
      });

      removeStale(nodeEls, visibleSet, detach);
      removeStale(branchEls, branchKeep, detach);
      removeStale(linkEls, linkKeep, function (item) { detach(item.path); detach(item.hit); detach(item.label); detach(item.handle); });

      // Il nodo selezionato va in primo piano (ultimo nel livello dei nodi).
      if (opts.selectedId && nodeEls[opts.selectedId]) layers.nodes.appendChild(nodeEls[opts.selectedId]);
      if (highlighted && nodeEls[highlighted]) nodeEls[highlighted].classList.add('highlight');
      lastSizes = sizes;
      lastDepthMap = depthMap;
      lastVisibleSet = visibleSet;
      return sizes;
    }

    var lastSizes = {};
    var lastDepthMap = {};
    var lastVisibleSet = {};
    var lastSummaryBoxes = {};

    /** Percorso ultra-veloce durante il trascinamento: aggiorna solo transform e rami/link toccati. */
    function moveNodesFast(map, movedIds, opts) {
      var movedSet = {};
      for (var i = 0; i < movedIds.length; i++) {
        var id = movedIds[i];
        movedSet[id] = true;
        var n = map.nodes[id];
        var g = nodeEls[id];
        if (n && g) {
          g.setAttribute('transform', 'translate(' + n.x + ' ' + n.y + ')');
          g.__pos = n.x + ',' + n.y;
        }
      }
      var isCompare = map.settings && map.settings.layout === 'compare';
      var isTimeline = map.settings && map.settings.layout === 'timeline';
      if (isTimeline || isCompare) renderTimeline(map, lastSizes, lastVisibleSet);
      if (map.summaries && map.summaries.length) {
        renderSummaries(map, lastSizes, lastVisibleSet, opts || {});
      }
      var redrawnBranches = {};
      for (var j = 0; j < movedIds.length; j++) {
        var bid = movedIds[j];
        var bn = map.nodes[bid];
        if (!bn) continue;
        var bd = lastDepthMap[bid] !== undefined ? lastDepthMap[bid] : MM.model.getDepth(map, bid);
        var isBCompareTimelineStem = isCompare && bd === 2 && map.nodes[bn.parentId] && map.nodes[bn.parentId].subLayout === 'timeline';
        if (!redrawnBranches[bid] && bn.parentId !== null && !(isCompare && bn.parentId === map.rootId) && !(isTimeline && bd === 1) && !isBCompareTimelineStem && lastSizes[bid] && (lastSizes[bn.parentId] || lastSummaryBoxes[bn.parentId])) {
          renderBranch(map, bn, lastSizes, lastDepthMap);
          redrawnBranches[bid] = true;
        }
        if (bn.children && bn.children.length) {
          for (var ci = 0; ci < bn.children.length; ci++) {
            var cid = bn.children[ci];
            if (redrawnBranches[cid] || !lastVisibleSet[cid]) continue;
            var cn = map.nodes[cid];
            if (!cn) continue;
            var cd = lastDepthMap[cid] !== undefined ? lastDepthMap[cid] : MM.model.getDepth(map, cid);
            var isCCompareTimelineStem = isCompare && cd === 2 && map.nodes[cn.parentId] && map.nodes[cn.parentId].subLayout === 'timeline';
            if (!(isCompare && cn.parentId === map.rootId) && !(isTimeline && cd === 1) && !isCCompareTimelineStem && lastSizes[cid] && lastSizes[bid]) {
              renderBranch(map, cn, lastSizes, lastDepthMap);
              redrawnBranches[cid] = true;
            }
          }
        }
      }
      if (map.summaries && map.summaries.length) {
        for (var sIdx = 0; sIdx < map.summaries.length; sIdx++) {
          var sKids = map.summaries[sIdx].children || [];
          for (var sk = 0; sk < sKids.length; sk++) {
            var skid = sKids[sk];
            if (!redrawnBranches[skid] && lastVisibleSet[skid] && map.nodes[skid] && lastSizes[skid] && lastSummaryBoxes[map.summaries[sIdx].id]) {
              renderBranch(map, map.nodes[skid], lastSizes, lastDepthMap);
              redrawnBranches[skid] = true;
            }
          }
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
      Object.keys(branchEls).forEach(function (id) { branchEls[id].__sig = null; });
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
    richLinesFor: richLinesFor,
    branchPath: branchPath,
    edgePoint: edgePoint,
    darken: darken,
    mixHex: mixHex,
    pastelFill: pastelFill
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
