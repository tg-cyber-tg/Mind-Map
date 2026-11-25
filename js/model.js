/*
 * Mappe Mentali – modello dati (logica pura, nessun accesso al DOM).
 * Tutte le funzioni che modificano la mappa restituiscono una NUOVA mappa:
 * l'originale non viene mai alterato (necessario per annulla/ripristina).
 */
(function (root) {
  'use strict';
  var MM = root.MM;

  /** @typedef {'rounded'|'rect'|'ellipse'|'circle'} NodeShape */
  /** @typedef {'radial'|'tree'|'balanced'|'org'|'timeline'|'fishbone'|'outline'|'compare'} LayoutKind */
  /**
   * @typedef {Object} MapNode
   * @property {string} id
   * @property {string|null} parentId
   * @property {string[]} children
   * @property {string} text
   * @property {number} x
   * @property {number} y
   * @property {string} color
   * @property {NodeShape} shape
   * @property {string} icon
   * @property {string} note
   * @property {boolean} collapsed
   */
  /**
   * @typedef {Object} CrossLink
   * @property {string} id
   * @property {string} fromId
   * @property {string} toId
   * @property {string} label
   */
  /**
   * @typedef {Object} MapSettings
   * @property {LayoutKind} layout
   * @property {'chiaro'|'scuro'|'alto-contrasto'} theme
   * @property {boolean} uppercase
   * @property {number} fontScale
   * @property {'leggibile'|'standard'} fontFamily
   */
  /**
   * @typedef {Object} MindMap
   * @property {number} version
   * @property {string} id
   * @property {string} title
   * @property {string} rootId
   * @property {Object<string, MapNode>} nodes
   * @property {CrossLink[]} links
   * @property {MapSettings} settings
   * @property {string} createdAt
   * @property {string} updatedAt
   */

  var FILE_VERSION = 1;
  var MAX_TEXT = 200;
  var SHAPES = ['rounded', 'rect', 'ellipse', 'circle'];
  var LAYOUTS = ['radial', 'tree', 'balanced', 'org', 'timeline', 'fishbone', 'outline', 'compare'];
  var SUB_LAYOUTS = ['radial', 'balanced', 'tree', 'org', 'timeline', 'fishbone', 'outline'];
  var LINK_STYLES = ['curved', 'straight', 'elbow'];
  var THEMES = ['auto', 'chiaro', 'scuro', 'alto-contrasto'];

  /** Risolve 'auto' in 'chiaro' o 'scuro' seguendo le preferenze del sistema (Mac/iPad). */
  function resolveTheme(theme) {
    if (theme === 'auto') {
      try {
        if (typeof root.matchMedia === 'function' && root.matchMedia('(prefers-color-scheme: dark)').matches) {
          return 'scuro';
        }
      } catch (e) { /* fallback chiaro */ }
      return 'chiaro';
    }
    return theme || 'chiaro';
  }
  var ROOT_COLOR = '#1E293B';
  // Colori dei rami: palette adulta e armoniosa ad alto contrasto (24 tonalità).
  var PALETTE = [
    '#2563EB', '#059669', '#D97706', '#7C3AED', '#DB2777',
    '#0891B2', '#EA580C', '#4F46E5', '#65A30D', '#DC2626',
    '#E11D48', '#F97316', '#CA8A04', '#16A34A', '#0D9488',
    '#0284C7', '#1D4ED8', '#9333EA', '#C026D3', '#F43F5E',
    '#B45309', '#78350F', '#475569', '#334155'
  ];
  // I 25 caratteri più usati in Microsoft Word (con fallback di sistema offline).
  var WORD_FONTS = [
    { name: 'Arial', css: 'Arial, Helvetica, sans-serif' },
    { name: 'Times New Roman', css: '"Times New Roman", Times, Georgia, serif' },
    { name: 'Calibri', css: 'Calibri, "Carlito", "Helvetica Neue", Arial, sans-serif' },
    { name: 'Aptos', css: 'Aptos, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
    { name: 'Cambria', css: 'Cambria, Georgia, serif' },
    { name: 'Georgia', css: 'Georgia, "Times New Roman", serif' },
    { name: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
    { name: 'Tahoma', css: 'Tahoma, Geneva, sans-serif' },
    { name: 'Trebuchet MS', css: '"Trebuchet MS", Helvetica, sans-serif' },
    { name: 'Garamond', css: 'Garamond, "EB Garamond", Georgia, serif' },
    { name: 'Palatino', css: '"Palatino Linotype", Palatino, "Book Antiqua", serif' },
    { name: 'Book Antiqua', css: '"Book Antiqua", Palatino, serif' },
    { name: 'Century Gothic', css: '"Century Gothic", Futura, "Apple Gothic", sans-serif' },
    { name: 'Helvetica', css: '"Helvetica Neue", Helvetica, Arial, sans-serif' },
    { name: 'Segoe UI', css: '"Segoe UI", -apple-system, BlinkMacSystemFont, sans-serif' },
    { name: 'Candara', css: 'Candara, Optima, sans-serif' },
    { name: 'Corbel', css: 'Corbel, "Lucida Grande", sans-serif' },
    { name: 'Constantia', css: 'Constantia, Georgia, serif' },
    { name: 'Franklin Gothic', css: '"Franklin Gothic Medium", "Arial Narrow", Arial, sans-serif' },
    { name: 'Gill Sans', css: '"Gill Sans", "Gill Sans MT", Calibri, sans-serif' },
    { name: 'Optima', css: 'Optima, Candara, sans-serif' },
    { name: 'Baskerville', css: 'Baskerville, "Baskerville Old Face", Georgia, serif' },
    { name: 'Didot', css: 'Didot, "Bodoni MT", Georgia, serif' },
    { name: 'Courier New', css: '"Courier New", Courier, monospace' },
    { name: 'Comic Sans MS', css: '"Comic Sans MS", "Chalkboard SE", cursive' }
  ];
  var FONT_SIZES = [10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36];
  var TEXT_COLORS = ['', '#0F172A', '#475569', '#14532D', '#1D4ED8', '#B91C1C', '#6D28D9', '#C2410C', '#FFFFFF'];
  var TEXT_ALIGNS = ['left', 'center', 'right', 'justify'];
  var PASTEL_FILLS = ['', '#FFFFFF', '#F8FAFC', '#EFF6FF', '#ECFEFF', '#ECFDF5', '#F0FDF4', '#FEFCE8', '#FFF7ED', '#FEF2F2', '#FDF2F8', '#FAF5FF', '#EEF2FF', '#F5F3FF', '#F1F5F9', '#FEF9C3'];

  function fontCssFor(name) {
    if (!name) return WORD_FONTS[0].css;
    for (var i = 0; i < WORD_FONTS.length; i++) {
      if (WORD_FONTS[i].name === name) return WORD_FONTS[i].css;
    }
    return WORD_FONTS[0].css;
  }

  var DEFAULT_SETTINGS = {
    layout: 'radial',
    theme: 'chiaro',
    uppercase: false,
    fontScale: 1,
    fontFamily: 'standard',
    sizeByLevel: true
  };

  /** Immagini nei nodi: data URL compressa (vedi ui.js), limite di sicurezza in caratteri. */
  var IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+\/=]+$/;
  var MAX_IMAGE_CHARS = 1500000;
  var MAX_IMAGES_PER_NODE = 12;
  var IMAGE_MAX_W = 150;
  var IMAGE_MAX_H = 115;
  var IMAGE_TILE_W = 92;
  var IMAGE_TILE_H = 72;
  var IMAGE_TILE_GAP = 6;

  /** Restituisce l'elenco normalizzato delle immagini del nodo (compatibile con il vecchio campo node.image). */
  function nodeImagesOf(node) {
    if (!node) return [];
    if (Array.isArray(node.images) && node.images.length) return node.images;
    if (node.image && node.imageW && node.imageH) {
      return [{ src: node.image, w: node.imageW, h: node.imageH }];
    }
    return [];
  }

  /**
   * Dimensioni e posizioni delle immagini del nodo (o null), già scalate con la casella.
   * Restituisce { width, height, items: [{ src, x, y, width, height }] } con x centrato intorno a 0 e y da 0.
   */
  function imageBoxFor(node, scale) {
    var imgs = nodeImagesOf(node);
    if (!imgs.length) return null;
    var s = scale || 1;
    if (imgs.length === 1) {
      var im = imgs[0];
      var k = Math.min((IMAGE_MAX_W * s) / im.w, (IMAGE_MAX_H * s) / im.h);
      var w1 = Math.max(24, Math.round(im.w * k));
      var h1 = Math.max(24, Math.round(im.h * k));
      return {
        width: w1,
        height: h1,
        items: [{ src: im.src, x: -w1 / 2, y: 0, width: w1, height: h1 }]
      };
    }
    var cols = (imgs.length === 2 || imgs.length === 4) ? 2 : 3;
    var tileW = Math.round(IMAGE_TILE_W * s);
    var tileH = Math.round(IMAGE_TILE_H * s);
    var gap = Math.max(4, Math.round(IMAGE_TILE_GAP * s));
    var rows = Math.ceil(imgs.length / cols);
    var totalW = cols * tileW + (cols - 1) * gap;
    var totalH = rows * tileH + (rows - 1) * gap;
    var items = [];
    for (var i = 0; i < imgs.length; i++) {
      var r = Math.floor(i / cols);
      var c = i % cols;
      var inRow = Math.min(cols, imgs.length - r * cols);
      var rowW = inRow * tileW + (inRow - 1) * gap;
      var x = -rowW / 2 + c * (tileW + gap);
      var y = r * (tileH + gap);
      items.push({ src: imgs[i].src, x: x, y: y, width: tileW, height: tileH });
    }
    return { width: totalW, height: totalH, items: items };
  }

  /** Grandezza della singola casella (M = normale, non salvata). */
  var BOX_SIZES = [
    { id: 'S', label: 'Piccola', scale: 0.85 },
    { id: 'M', label: 'Normale', scale: 1 },
    { id: 'L', label: 'Grande', scale: 1.25 },
    { id: 'XL', label: 'Molto grande', scale: 1.55 }
  ];
  /** Fattore per livello: centro (1.20), poi -5% per ogni livello successivo. */
  var LEVEL_SCALES = [1.20, 1.14, 1.08, 1.02];

  /**
   * Fattore di grandezza della casella: livello (se attivo "più grandi vicino al centro",
   * -5% per ogni livello di profondità a partire da 1.20 al centro)
   * moltiplicato per la grandezza scelta per il singolo nodo.
   * depth facoltativo: se manca, 0 per la radice e 2 (normale) per gli altri.
   */
  function boxScaleFor(node, settings, depth) {
    var d = typeof depth === 'number' ? depth : (node.parentId === null ? 0 : 2);
    if (settings && settings.layout === 'compare' && typeof depth === 'number' && depth > 0) {
      d = depth - 1;
    }
    var level;
    if (settings && settings.sizeByLevel === false) level = d === 0 ? 1.20 : 1;
    else level = Math.max(0.72, 1.20 * (1 - 0.05 * d));
    var own = 1;
    for (var i = 0; i < BOX_SIZES.length; i++) {
      if (BOX_SIZES[i].id === node.boxSize) { own = BOX_SIZES[i].scale; break; }
    }
    return level * own;
  }
  var COLOR_RE = /^#[0-9a-fA-F]{6}$/;

  var counter = 0;

  /** Id breve e univoco, es. "n_lq3k9x2a1b". */
  function uid(prefix) {
    counter = (counter + 1) % 1296;
    return (prefix || 'x') + '_' + Date.now().toString(36) +
      Math.floor(Math.random() * 1679616).toString(36) + counter.toString(36);
  }

  function nowIso() {
    return new Date().toISOString();
  }

  /** Copia profonda di dati JSON (mappe, nodi, collegamenti). */
  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function assertNode(map, nodeId) {
    var node = map.nodes[nodeId];
    if (!node) throw new Error('Nodo non trovato: ' + nodeId);
    return node;
  }

  /** @returns {MapNode} */
  function createNode(partial) {
    var p = partial || {};
    return {
      id: p.id || uid('n'),
      parentId: p.parentId === undefined ? null : p.parentId,
      children: p.children ? p.children.slice() : [],
      text: String(p.text === undefined ? 'Nuova idea' : p.text).slice(0, MAX_TEXT),
      x: typeof p.x === 'number' ? p.x : 0,
      y: typeof p.y === 'number' ? p.y : 0,
      color: p.color && COLOR_RE.test(p.color) ? p.color : PALETTE[0],
      shape: SHAPES.indexOf(p.shape) >= 0 ? p.shape : 'rounded',
      icon: p.icon || '',
      note: p.note || '',
      collapsed: !!p.collapsed
    };
  }

  /** @returns {MindMap} */
  function createMap(title) {
    var t = title === undefined ? 'Nuova mappa' : String(title);
    var rootNode = createNode({ text: t, color: ROOT_COLOR, shape: 'ellipse' });
    var now = nowIso();
    var nodes = {};
    nodes[rootNode.id] = rootNode;
    return {
      version: FILE_VERSION,
      id: uid('m'),
      title: t,
      rootId: rootNode.id,
      nodes: nodes,
      links: [],
      summaries: [],
      settings: clone(DEFAULT_SETTINGS),
      createdAt: now,
      updatedAt: now
    };
  }

  /* ---------- Consultazione dell'albero ---------- */

  /** Tutti i discendenti di un nodo (escluso il nodo stesso), in ordine di visita. */
  function getDescendants(map, nodeId) {
    var result = [];
    var stack = assertNode(map, nodeId).children.slice().reverse();
    while (stack.length) {
      var id = stack.pop();
      var n = map.nodes[id];
      if (!n) continue;
      result.push(id);
      for (var i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
    return result;
  }

  /** Nodi visibili: esclude i discendenti dei nodi compressi. */
  function getVisibleNodeIds(map) {
    var result = [];
    var seen = {};
    function walk(startIds) {
      var stack = startIds.slice().reverse();
      while (stack.length) {
        var id = stack.pop();
        if (seen[id]) continue;
        var n = map.nodes[id];
        if (!n) continue;
        seen[id] = true;
        result.push(id);
        if (n.collapsed) continue;
        for (var i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
      }
    }
    walk([map.rootId]);
    var sums = Array.isArray(map.summaries) ? map.summaries : [];
    var walkedSum = {};
    var progress = true;
    while (progress) {
      progress = false;
      for (var s = 0; s < sums.length; s++) {
        if (walkedSum[s] || !sums[s] || !Array.isArray(sums[s].children) || !sums[s].children.length) continue;
        var covered = getSummaryNodes(map, sums[s]);
        var anyVisible = false;
        for (var ci = 0; ci < covered.length; ci++) {
          if (seen[covered[ci]]) { anyVisible = true; break; }
        }
        if (anyVisible) {
          walkedSum[s] = true;
          progress = true;
          walk(sums[s].children);
        }
      }
    }
    return result;
  }

  /** Profondità: 0 per la radice. */
  function getDepth(map, nodeId) {
    var depth = 0;
    var n = assertNode(map, nodeId);
    var guard = 0;
    while (n.parentId !== null && guard++ < 10000) {
      var parent = map.nodes[n.parentId];
      if (!parent) {
        if (findSummary(map, n.parentId)) return depth + 2;
        break;
      }
      n = parent;
      depth++;
    }
    return depth;
  }

  /** Antenato di primo livello (figlio diretto della radice), o null per la radice. */
  function getBranchRoot(map, nodeId) {
    var n = assertNode(map, nodeId);
    if (n.parentId === null) return null;
    var guard = 0;
    while (n.parentId !== map.rootId && guard++ < 10000) {
      var next = map.nodes[n.parentId];
      if (!next) return n;
      n = next;
    }
    return n;
  }

  /** Numero gerarchico dell'argomento ('' per la radice, '1', '2', '1.1', 'R.1', ...). */
  function getTopicNumber(map, nodeId) {
    var cur = assertNode(map, nodeId);
    if (cur.parentId === null) return '';
    var parts = [];
    var curId = nodeId;
    var guard = 0;
    while (cur && cur.parentId !== null && guard++ < 10000) {
      var parent = map.nodes[cur.parentId];
      if (!parent) {
        var sum = findSummary(map, cur.parentId);
        if (sum && Array.isArray(sum.children)) {
          var sIdx = sum.children.indexOf(curId);
          parts.push(sIdx >= 0 ? sIdx + 1 : 1);
          parts.push('R');
        }
        break;
      }
      var idx = parent.children.indexOf(curId);
      parts.push(idx >= 0 ? idx + 1 : 1);
      curId = cur.parentId;
      cur = parent;
    }
    parts.reverse();
    return parts.join('.');
  }

  /** Etichetta leggibile dell'argomento ('Argomento centrale', 'Argomento 1', 'Argomento 1.1', ...). */
  function getTopicLabel(map, nodeId) {
    var num = getTopicNumber(map, nodeId);
    return num ? 'Argomento ' + num : 'Argomento centrale';
  }

  /* ---------- Operazioni sui nodi ---------- */

  function nextPaletteColor(map) {
    var used = map.nodes[map.rootId].children.map(function (id) { return map.nodes[id].color; });
    for (var i = 0; i < PALETTE.length; i++) {
      if (used.indexOf(PALETTE[i]) < 0) return PALETTE[i];
    }
    return PALETTE[used.length % PALETTE.length];
  }

  /** Aggiunge un figlio. @returns {{map: MindMap, nodeId: string}} */
  function addChild(map, parentId, text) {
    var m = clone(map);
    var parent = assertNode(m, parentId);
    var color = parentId === m.rootId ? nextPaletteColor(m) : getBranchRoot(m, parentId).color;
    // Posizione provvisoria: a destra del padre, sotto i fratelli esistenti.
    var node = createNode({
      parentId: parentId,
      text: text === undefined ? 'Nuova idea' : text,
      x: parent.x + 200,
      y: parent.y + parent.children.length * 60,
      color: color
    });
    m.nodes[node.id] = node;
    parent.children.push(node.id);
    parent.collapsed = false;
    return { map: m, nodeId: node.id };
  }

  /** Aggiunge un fratello subito dopo il nodo; sulla radice equivale ad addChild. */
  function addSibling(map, nodeId, text) {
    var node = assertNode(map, nodeId);
    if (node.parentId === null) return addChild(map, nodeId, text);
    if (!map.nodes[node.parentId] && findSummary(map, node.parentId)) {
      var sRes = addChildToSummary(map, node.parentId, text);
      var s = findSummary(sRes.map, node.parentId);
      s.children.pop();
      s.children.splice(s.children.indexOf(nodeId) + 1, 0, sRes.nodeId);
      sRes.map.nodes[sRes.nodeId].x = node.x;
      sRes.map.nodes[sRes.nodeId].y = node.y + 60;
      return { map: sRes.map, nodeId: sRes.nodeId };
    }
    var res = addChild(map, node.parentId, text);
    var parent = res.map.nodes[node.parentId];
    parent.children.pop();
    parent.children.splice(parent.children.indexOf(nodeId) + 1, 0, res.nodeId);
    res.map.nodes[res.nodeId].x = node.x;
    res.map.nodes[res.nodeId].y = node.y + 60;
    return res;
  }

  /** Applica i campi di contenuto e formattazione condivisi tra nodi e caselle di riepilogo. */
  function applyStylePatch(n, p) {
    if (p.text !== undefined) n.text = String(p.text).slice(0, MAX_TEXT);
    if (p.color !== undefined) {
      if (!COLOR_RE.test(p.color)) throw new Error('Colore non valido: ' + p.color);
      n.color = p.color;
    }
    if (p.shape !== undefined) {
      if (SHAPES.indexOf(p.shape) < 0) throw new Error('Forma non valida: ' + p.shape);
      n.shape = p.shape;
    }
    if (p.icon !== undefined) n.icon = String(p.icon);
    if (p.note !== undefined) n.note = String(p.note);
    if (p.comment !== undefined) {
      if (!p.comment || !String(p.comment).trim()) delete n.comment;
      else n.comment = String(p.comment);
    }
    // Formattazione carattere stile Word (opzionale per singolo nodo).
    if (p.fontName !== undefined) {
      if (!p.fontName) delete n.fontName;
      else n.fontName = String(p.fontName);
    }
    if (p.fontSize !== undefined) {
      var fs = Number(p.fontSize);
      if (!p.fontSize || !isFinite(fs)) delete n.fontSize;
      else n.fontSize = Math.max(10, Math.min(48, Math.round(fs)));
    }
    if (p.bold !== undefined) {
      if (p.bold === null) delete n.bold;
      else n.bold = !!p.bold;
    }
    if (p.italic !== undefined) {
      if (!p.italic) delete n.italic;
      else n.italic = true;
    }
    if (p.underline !== undefined) {
      if (!p.underline) delete n.underline;
      else n.underline = true;
    }
    if (p.strike !== undefined) {
      if (!p.strike) delete n.strike;
      else n.strike = true;
    }
    if (p.uppercase !== undefined) {
      if (!p.uppercase) delete n.uppercase;
      else n.uppercase = true;
    }
    if (p.images !== undefined) {
      delete n.image; delete n.imageW; delete n.imageH;
      if (!p.images || !p.images.length) {
        delete n.images;
      } else {
        if (!Array.isArray(p.images)) throw new Error('Elenco immagini non valido');
        if (p.images.length > MAX_IMAGES_PER_NODE) throw new Error('Troppe immagini nella stessa casella (massimo ' + MAX_IMAGES_PER_NODE + ')');
        n.images = p.images.map(function (item) {
          var src = String((item && item.src) || '');
          if (!IMAGE_RE.test(src)) throw new Error('Immagine non valida');
          if (src.length > MAX_IMAGE_CHARS) throw new Error('Immagine troppo grande');
          var w = Number(item && item.w), hh = Number(item && item.h);
          if (!isFinite(w) || !isFinite(hh) || w <= 0 || hh <= 0) throw new Error('Dimensioni immagine non valide');
          return { src: src, w: Math.round(Math.min(4096, w)), h: Math.round(Math.min(4096, hh)) };
        });
      }
    }
    if (p.image !== undefined) {
      delete n.images;
      if (!p.image) { delete n.image; delete n.imageW; delete n.imageH; }
      else {
        var img = String(p.image);
        if (!IMAGE_RE.test(img)) throw new Error('Immagine non valida');
        if (img.length > MAX_IMAGE_CHARS) throw new Error('Immagine troppo grande');
        var iw = Number(p.imageW), ih = Number(p.imageH);
        if (!isFinite(iw) || !isFinite(ih) || iw <= 0 || ih <= 0) throw new Error('Dimensioni immagine non valide');
        n.image = img;
        n.imageW = Math.round(Math.min(4096, iw));
        n.imageH = Math.round(Math.min(4096, ih));
      }
    }
    if (p.boxSize !== undefined) {
      var okBox = BOX_SIZES.some(function (b) { return b.id === p.boxSize; });
      if (!p.boxSize || p.boxSize === 'M' || !okBox) delete n.boxSize;
      else n.boxSize = p.boxSize;
    }
    if (p.textColor !== undefined) {
      if (!p.textColor) delete n.textColor;
      else if (COLOR_RE.test(p.textColor)) n.textColor = p.textColor;
    }
    if (p.bullets !== undefined) {
      if (!p.bullets) delete n.bullets;
      else n.bullets = true;
    }
    if (p.textAlign !== undefined) {
      if (!p.textAlign || p.textAlign === 'center') delete n.textAlign;
      else if (TEXT_ALIGNS.indexOf(p.textAlign) >= 0) n.textAlign = p.textAlign;
    }
    if (p.fillColor !== undefined) {
      if (!p.fillColor) delete n.fillColor;
      else if (COLOR_RE.test(p.fillColor)) n.fillColor = p.fillColor;
    }
    if (p.personMode !== undefined) {
      if (!p.personMode) delete n.personMode;
      else n.personMode = true;
    }
    if (p.role !== undefined) {
      if (!p.role || !String(p.role).trim()) delete n.role;
      else n.role = String(p.role).slice(0, 120);
    }
    if (p.avatarColor !== undefined) {
      if (!p.avatarColor) delete n.avatarColor;
      else if (COLOR_RE.test(p.avatarColor)) n.avatarColor = p.avatarColor;
    }
  }

  /** Aggiorna i campi modificabili del nodo (non id, parentId, children). */
  function updateNode(map, nodeId, patch) {
    var m = clone(map);
    var n = assertNode(m, nodeId);
    var p = patch || {};
    applyStylePatch(n, p);
    if (typeof p.x === 'number') n.x = p.x;
    if (typeof p.y === 'number') n.y = p.y;
    if (p.subLayout !== undefined) {
      if (!p.subLayout) delete n.subLayout;
      else if (SUB_LAYOUTS.indexOf(p.subLayout) >= 0) n.subLayout = p.subLayout;
    }
    if (p.collapsed !== undefined) n.collapsed = !!p.collapsed;
    // Il testo del nodo centrale è anche il titolo della mappa.
    if (nodeId === m.rootId && p.text !== undefined) m.title = n.text;
    return m;
  }

  /** Rimuove o aggiorna le parentesi graffe che referenziano nodi eliminati, eliminando a cascata i figli delle parentesi rimosse. */
  function pruneSummariesForRemoved(m, removedIds) {
    if (!Array.isArray(m.summaries) || !m.summaries.length) return;
    var pending = Array.isArray(removedIds) ? removedIds.slice() : [];
    var removedSet = {};
    for (var i = 0; i < pending.length; i++) removedSet[pending[i]] = true;

    while (pending.length) {
      pending = [];
      var droppedSummaries = [];
      m.summaries = m.summaries.filter(function (s) {
        var keep;
        if (Array.isArray(s.nodeIds)) {
          s.nodeIds = s.nodeIds.filter(function (id) { return !removedSet[id]; });
          keep = s.nodeIds.length >= 1;
        } else {
          keep = !removedSet[s.parentId] && !removedSet[s.startId] && !removedSet[s.endId];
        }
        if (!keep) droppedSummaries.push(s);
        return keep;
      });
      if (droppedSummaries.length) {
        var extraRemoved = [];
        droppedSummaries.forEach(function (s) {
          if (!Array.isArray(s.children)) return;
          s.children.forEach(function (cid) {
            if (m.nodes[cid]) {
              extraRemoved.push(cid);
              extraRemoved = extraRemoved.concat(getDescendants(m, cid));
            }
          });
        });
        if (extraRemoved.length) {
          extraRemoved.forEach(function (id) {
            delete m.nodes[id];
            if (!removedSet[id]) {
              removedSet[id] = true;
              pending.push(id);
            }
          });
          if (Array.isArray(m.links)) {
            m.links = m.links.filter(function (l) {
              return !removedSet[l.fromId] && !removedSet[l.toId];
            });
          }
        }
      }
    }
  }

  /** Elimina il nodo, il suo sottoalbero e i collegamenti che li coinvolgono. */
  function removeNode(map, nodeId) {
    var node = assertNode(map, nodeId);
    if (node.parentId === null) throw new Error('Il nodo centrale non può essere eliminato');
    var m = clone(map);
    var removed = [nodeId].concat(getDescendants(m, nodeId));
    var parent = m.nodes[node.parentId];
    if (parent) {
      parent.children = parent.children.filter(function (id) { return id !== nodeId; });
    } else {
      var parentSummary = findSummary(m, node.parentId);
      if (parentSummary && Array.isArray(parentSummary.children)) {
        parentSummary.children = parentSummary.children.filter(function (id) { return id !== nodeId; });
      }
    }
    removed.forEach(function (id) { delete m.nodes[id]; });
    m.links = m.links.filter(function (l) {
      return removed.indexOf(l.fromId) < 0 && removed.indexOf(l.toId) < 0;
    });
    pruneSummariesForRemoved(m, removed);
    return m;
  }

  /** Sposta il nodo in (x, y); con withSubtree (default) sposta anche i discendenti. */
  function moveNode(map, nodeId, x, y, withSubtree) {
    var m = clone(map);
    var n = assertNode(m, nodeId);
    var dx = x - n.x;
    var dy = y - n.y;
    n.x = x;
    n.y = y;
    if (withSubtree !== false) {
      getDescendants(m, nodeId).forEach(function (id) {
        m.nodes[id].x += dx;
        m.nodes[id].y += dy;
      });
    }
    return m;
  }

  /** Cambia il genitore di un nodo (vieta i cicli). */
  function reparent(map, nodeId, newParentId) {
    var node = assertNode(map, nodeId);
    assertNode(map, newParentId);
    if (node.parentId === null) throw new Error('Il nodo centrale non può essere spostato');
    if (nodeId === newParentId || getDescendants(map, nodeId).indexOf(newParentId) >= 0) {
      throw new Error('Non puoi spostare un nodo dentro sé stesso o un suo sotto-ramo');
    }
    var m = clone(map);
    if (node.parentId === newParentId) return m;
    var oldParent = m.nodes[node.parentId];
    if (oldParent) {
      if (Array.isArray(m.summaries) && m.summaries.length) {
        var droppedFromReparent = [];
        m.summaries = m.summaries.filter(function (s) {
          if (!s || Array.isArray(s.nodeIds) || s.parentId !== oldParent.id) return true;
          if (s.startId !== nodeId && s.endId !== nodeId) return true;
          var i1 = oldParent.children.indexOf(s.startId);
          var i2 = oldParent.children.indexOf(s.endId);
          if (i1 < 0 || i2 < 0) return true;
          var range = oldParent.children.slice(Math.min(i1, i2), Math.max(i1, i2) + 1).filter(function (id) {
            return id !== nodeId;
          });
          if (range.length >= 1) {
            s.startId = range[0];
            s.endId = range[range.length - 1];
            return true;
          }
          droppedFromReparent.push(s);
          return false;
        });
        if (droppedFromReparent.length) {
          var droppedNodes = [];
          droppedFromReparent.forEach(function (s) {
            if (!Array.isArray(s.children)) return;
            s.children.forEach(function (cid) {
              if (m.nodes[cid]) {
                droppedNodes.push(cid);
                droppedNodes = droppedNodes.concat(getDescendants(m, cid));
              }
            });
          });
          if (droppedNodes.length) {
            droppedNodes.forEach(function (id) { delete m.nodes[id]; });
            if (Array.isArray(m.links)) {
              m.links = m.links.filter(function (l) {
                return droppedNodes.indexOf(l.fromId) < 0 && droppedNodes.indexOf(l.toId) < 0;
              });
            }
            pruneSummariesForRemoved(m, droppedNodes);
          }
        }
      }
      if (!m.nodes[newParentId]) {
        throw new Error('Non puoi spostare un nodo dentro un ramo collegato alla sua stessa parentesi graffa');
      }
      oldParent.children = oldParent.children.filter(function (id) { return id !== nodeId; });
    } else {
      var oldSummary = findSummary(m, node.parentId);
      if (oldSummary && Array.isArray(oldSummary.children)) {
        oldSummary.children = oldSummary.children.filter(function (id) { return id !== nodeId; });
      }
    }
    // Il ramo spostato prende il colore del nuovo ramo di primo livello
    // (calcolato prima dell'inserimento, così non conta il colore attuale del nodo).
    var color = newParentId === m.rootId ? nextPaletteColor(m) : getBranchRoot(m, newParentId).color;
    m.nodes[newParentId].children.push(nodeId);
    m.nodes[newParentId].collapsed = false;
    m.nodes[nodeId].parentId = newParentId;
    [nodeId].concat(getDescendants(m, nodeId)).forEach(function (id) { m.nodes[id].color = color; });
    return m;
  }

  function toggleCollapsed(map, nodeId) {
    return updateNode(map, nodeId, { collapsed: !assertNode(map, nodeId).collapsed });
  }

  /**
   * Duplica un nodo e tutto il suo sottoalbero con nuovi id, agganciandolo sotto targetParentId.
   * Clona anche eventuali collegamenti trasversali interni al sottoalbero.
   * @returns {{map: MindMap, nodeId: string}}
   */
  function cloneSubtree(map, sourceId, targetParentId) {
    assertNode(map, sourceId);
    assertNode(map, targetParentId);
    var m = clone(map);
    // Istantanea degli id e dei collegamenti prima dell'inserimento (sicuro anche se targetParentId è nel sottoalbero).
    var subIds = [sourceId].concat(getDescendants(m, sourceId));
    var origLinks = (m.links || []).slice();
    var idMap = {};
    subIds.forEach(function (oldId) { idMap[oldId] = uid('n'); });

    var srcRoot = m.nodes[sourceId];
    var targetParent = m.nodes[targetParentId];
    var dx = (targetParent.x + 200) - srcRoot.x;
    var dy = (targetParent.y + targetParent.children.length * 60) - srcRoot.y;

    var snapshots = {};
    subIds.forEach(function (oldId) { snapshots[oldId] = clone(m.nodes[oldId]); });

    subIds.forEach(function (oldId) {
      var copy = snapshots[oldId];
      copy.id = idMap[oldId];
      copy.parentId = oldId === sourceId ? targetParentId : idMap[copy.parentId];
      copy.children = copy.children.map(function (cid) { return idMap[cid]; });
      copy.x = copy.x + dx;
      copy.y = copy.y + dy;
      m.nodes[copy.id] = copy;
    });

    var newRootId = idMap[sourceId];
    targetParent.children.push(newRootId);
    targetParent.collapsed = false;

    origLinks.forEach(function (l) {
      if (idMap[l.fromId] && idMap[l.toId]) {
        var copyLink = {
          id: uid('l'),
          fromId: idMap[l.fromId],
          toId: idMap[l.toId],
          label: l.label || ''
        };
        if (l.style) copyLink.style = l.style;
        if (typeof l.curve === 'number' && isFinite(l.curve)) copyLink.curve = l.curve;
        m.links.push(copyLink);
      }
    });

    return { map: m, nodeId: newRootId };
  }

  /* ---------- Collegamenti trasversali ---------- */

  /** @returns {{map: MindMap, linkId: string}} */
  function addLink(map, fromId, toId, label) {
    assertNode(map, fromId);
    assertNode(map, toId);
    if (fromId === toId) throw new Error('Un nodo non può essere collegato a sé stesso');
    var exists = map.links.some(function (l) {
      return (l.fromId === fromId && l.toId === toId) || (l.fromId === toId && l.toId === fromId);
    });
    if (exists) throw new Error('Questi due nodi sono già collegati');
    var m = clone(map);
    var link = { id: uid('l'), fromId: fromId, toId: toId, label: String(label || '').slice(0, MAX_TEXT) };
    m.links.push(link);
    return { map: m, linkId: link.id };
  }

  function findLinkIndex(map, linkId) {
    for (var i = 0; i < map.links.length; i++) if (map.links[i].id === linkId) return i;
    throw new Error('Collegamento non trovato: ' + linkId);
  }

  function updateLink(map, linkId, patch) {
    var m = clone(map);
    var l = m.links[findLinkIndex(m, linkId)];
    var p = patch || {};
    if (p.label !== undefined) l.label = String(p.label).slice(0, MAX_TEXT);
    if (p.style !== undefined) {
      if (!p.style || p.style === 'curved') delete l.style;
      else if (LINK_STYLES.indexOf(p.style) >= 0) l.style = p.style;
    }
    if (p.curve !== undefined) {
      if (p.curve === null || p.curve === '') delete l.curve;
      else if (isFinite(Number(p.curve))) l.curve = Math.max(-300, Math.min(300, Math.round(Number(p.curve))));
    }
    return m;
  }

  function removeLink(map, linkId) {
    var m = clone(map);
    m.links.splice(findLinkIndex(m, linkId), 1);
    return m;
  }

  /** Inverte la direzione della freccia di un collegamento. */
  function reverseLink(map, linkId) {
    var m = clone(map);
    var link = m.links[findLinkIndex(m, linkId)];
    var from = link.fromId;
    link.fromId = link.toId;
    link.toId = from;
    return m;
  }

  /** Collegamenti trasversali che partono da o arrivano a un nodo. */
  function getLinksOf(map, nodeId) {
    return (map.links || []).filter(function (l) { return l.fromId === nodeId || l.toId === nodeId; });
  }

  /* ---------- Parentesi graffe di riepilogo (stile XMind) ---------- */

  /** Restituisce la parentesi graffa con l'id dato, oppure null. */
  function findSummary(map, summaryId) {
    var list = (map && Array.isArray(map.summaries)) ? map.summaries : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].id === summaryId) return list[i];
    }
    return null;
  }

  /** Aggiunge un nodo figlio collegato a una parentesi graffa. @returns {{map: MindMap, nodeId: string}} */
  function addChildToSummary(map, summaryId, text) {
    var orig = findSummary(map, summaryId);
    if (!orig) throw new Error('Parentesi graffa non trovata');
    var m = clone(map);
    var s = findSummary(m, summaryId);
    if (!Array.isArray(s.children)) s.children = [];
    var node = createNode({
      parentId: s.id,
      text: text === undefined ? 'Nuova idea' : text,
      color: s.color || PALETTE[0],
      shape: 'rounded',
      x: 0,
      y: 0
    });
    m.nodes[node.id] = node;
    s.children.push(node.id);
    return { map: m, nodeId: node.id };
  }

  /** Restituisce gli id dei nodi inclusi in una parentesi graffa (elenco arbitrario nodeIds o intervallo [startId..endId]). */
  function getSummaryNodes(map, summary) {
    if (!summary) return [];
    if (Array.isArray(summary.nodeIds) && summary.nodeIds.length) {
      return summary.nodeIds.filter(function (id) { return !!map.nodes[id]; });
    }
    var parent = map.nodes[summary.parentId];
    if (!parent || !Array.isArray(parent.children)) return [];
    var i1 = parent.children.indexOf(summary.startId);
    var i2 = parent.children.indexOf(summary.endId);
    if (i1 < 0 || i2 < 0) return [];
    return parent.children.slice(Math.min(i1, i2), Math.max(i1, i2) + 1);
  }

  /** @returns {{map: MindMap, summaryId: string}} */
  function addSummaryForNodes(map, nodeIds, text) {
    var list = Array.isArray(nodeIds) ? nodeIds : [];
    var uniqueIds = [];
    var seen = {};
    for (var i = 0; i < list.length; i++) {
      var id = list[i];
      if (id && !seen[id] && map.nodes[id]) {
        seen[id] = true;
        uniqueIds.push(id);
      }
    }
    if (uniqueIds.length < 2) {
      throw new Error('Seleziona almeno 2 nodi per creare una parentesi graffa');
    }
    var m = clone(map);
    if (!Array.isArray(m.summaries)) m.summaries = [];
    var s = {
      id: uid('s'),
      nodeIds: uniqueIds,
      text: String(text || 'Riepilogo').slice(0, MAX_TEXT),
      color: m.nodes[uniqueIds[0]].color
    };
    m.summaries.push(s);
    return { map: m, summaryId: s.id };
  }

  /** @returns {{map: MindMap, summaryId: string}} */
  function addSummary(map, parentId, startId, endId, text) {
    assertNode(map, parentId);
    assertNode(map, startId);
    assertNode(map, endId);
    var origParent = map.nodes[parentId];
    var i1 = origParent.children.indexOf(startId);
    var i2 = origParent.children.indexOf(endId);
    if (i1 < 0 || i2 < 0) throw new Error('I nodi devono essere fratelli dello stesso genitore');
    var m = clone(map);
    if (!Array.isArray(m.summaries)) m.summaries = [];
    var orderedStart = i1 <= i2 ? startId : endId;
    var orderedEnd = i1 <= i2 ? endId : startId;
    var s = {
      id: uid('s'),
      parentId: parentId,
      startId: orderedStart,
      endId: orderedEnd,
      text: String(text || 'Riepilogo').slice(0, MAX_TEXT),
      color: m.nodes[orderedStart].color
    };
    m.summaries.push(s);
    return { map: m, summaryId: s.id };
  }

  function updateSummary(map, summaryId, patch) {
    var m = clone(map);
    var list = Array.isArray(m.summaries) ? m.summaries : [];
    var s = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i].id === summaryId) { s = list[i]; break; }
    }
    if (!s) throw new Error('Parentesi graffa non trovata');
    var p = patch || {};
    applyStylePatch(s, p);
    if (p.startId !== undefined || p.endId !== undefined) {
      var parent = m.nodes[s.parentId];
      var nextStart = p.startId !== undefined ? p.startId : s.startId;
      var nextEnd = p.endId !== undefined ? p.endId : s.endId;
      var i1 = parent ? parent.children.indexOf(nextStart) : -1;
      var i2 = parent ? parent.children.indexOf(nextEnd) : -1;
      if (i1 < 0 || i2 < 0) throw new Error('I nodi devono essere fratelli dello stesso genitore');
      s.startId = i1 <= i2 ? nextStart : nextEnd;
      s.endId = i1 <= i2 ? nextEnd : nextStart;
    }
    return m;
  }

  function removeSummary(map, summaryId) {
    var m = clone(map);
    var s = findSummary(m, summaryId);
    var removed = [];
    if (s && Array.isArray(s.children) && s.children.length) {
      for (var i = 0; i < s.children.length; i++) {
        var cid = s.children[i];
        if (m.nodes[cid]) {
          removed.push(cid);
          removed = removed.concat(getDescendants(m, cid));
        }
      }
      removed.forEach(function (id) { delete m.nodes[id]; });
      if (Array.isArray(m.links)) {
        m.links = m.links.filter(function (l) {
          return removed.indexOf(l.fromId) < 0 && removed.indexOf(l.toId) < 0;
        });
      }
    }
    if (Array.isArray(m.summaries)) {
      m.summaries = m.summaries.filter(function (item) { return item.id !== summaryId; });
    }
    if (removed.length) pruneSummariesForRemoved(m, removed);
    return m;
  }

  /* ---------- Utilità ---------- */

  /** Schema testuale indentato (per lettura vocale e copia negli appunti). */
  function toOutline(map) {
    var lines = [];
    (function visit(id, depth) {
      var n = map.nodes[id];
      if (!n) return;
      var icon = n.icon && n.icon.indexOf('svg:') !== 0 ? n.icon + ' ' : '';
      var text = icon + n.text.replace(/\s*\n\s*/g, ' ');
      lines.push(new Array(depth + 1).join('  ') + (depth === 0 ? '' : '- ') + text);
      n.children.forEach(function (c) { visit(c, depth + 1); });
    })(map.rootId, 0);
    return lines.join('\n');
  }

  function relativeLuminance(hex) {
    var rgb = [1, 3, 5].map(function (i) {
      var c = parseInt(hex.substr(i, 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }

  /** Colore del testo (nero o bianco) con il contrasto WCAG maggiore sullo sfondo dato. */
  function textColorFor(bgHex) {
    var L = relativeLuminance(bgHex);
    var withBlack = (L + 0.05) / 0.05;
    var withWhite = 1.05 / (L + 0.05);
    return withBlack >= withWhite ? '#000000' : '#FFFFFF';
  }

  /** Verifica la coerenza di una mappa (es. dopo l'importazione di un file). */
  function validate(map) {
    var errors = [];
    if (!map || typeof map !== 'object') return { ok: false, errors: ['Il contenuto non è una mappa'] };
    if (map.version !== FILE_VERSION) errors.push('Versione del file non supportata: ' + map.version);
    if (typeof map.title !== 'string') errors.push('Titolo mancante');
    if (!map.nodes || typeof map.nodes !== 'object') {
      errors.push('Elenco dei nodi mancante');
      return { ok: false, errors: errors };
    }
    if (!Array.isArray(map.links)) errors.push('Elenco dei collegamenti mancante');
    var ids = Object.keys(map.nodes);
    var roots = ids.filter(function (id) { return map.nodes[id] && map.nodes[id].parentId === null; });
    if (roots.length !== 1) errors.push('Ci deve essere esattamente un nodo centrale (trovati ' + roots.length + ')');
    if (!map.nodes[map.rootId] || map.nodes[map.rootId].parentId !== null) errors.push('Nodo centrale non valido');

    var summaryMap = {};
    if (Array.isArray(map.summaries)) {
      map.summaries.forEach(function (s) {
        if (!s || !s.id) return;
        summaryMap[s.id] = s;
        if (s.color && !COLOR_RE.test(s.color)) errors.push('Colore non valido nel riepilogo ' + s.id);
        if (s.fillColor && !COLOR_RE.test(s.fillColor)) errors.push('Colore sfondo non valido nel riepilogo ' + s.id);
        if (s.textColor && !COLOR_RE.test(s.textColor)) errors.push('Colore testo non valido nel riepilogo ' + s.id);
        if (s.images !== undefined && s.images !== null) {
          if (!Array.isArray(s.images) || s.images.length > MAX_IMAGES_PER_NODE) {
            errors.push('Elenco immagini non valido nel riepilogo ' + s.id);
          } else {
            s.images.forEach(function (img) {
              if (!img || typeof img.src !== 'string' || img.src.length > MAX_IMAGE_CHARS || !IMAGE_RE.test(img.src)) {
                errors.push('Immagine non valida nel riepilogo ' + s.id);
              }
            });
          }
        }
      });
    }

    ids.forEach(function (id) {
      var n = map.nodes[id];
      if (!n || n.id !== id) { errors.push('Nodo con id incoerente: ' + id); return; }
      if (typeof n.text !== 'string' || n.text.length > MAX_TEXT) errors.push('Testo non valido nel nodo ' + id);
      if (typeof n.x !== 'number' || typeof n.y !== 'number' || !isFinite(n.x) || !isFinite(n.y)) {
        errors.push('Posizione non valida nel nodo ' + id);
      }
      if (!COLOR_RE.test(n.color)) errors.push('Colore non valido nel nodo ' + id);
      if (n.fillColor && !COLOR_RE.test(n.fillColor)) errors.push('Colore sfondo non valido nel nodo ' + id);
      if (n.textColor && !COLOR_RE.test(n.textColor)) errors.push('Colore testo non valido nel nodo ' + id);
      if (n.avatarColor && !COLOR_RE.test(n.avatarColor)) errors.push('Colore profilo non valido nel nodo ' + id);
      if (n.image !== undefined && n.image !== null && n.image !== '') {
        if (typeof n.image !== 'string' || n.image.length > MAX_IMAGE_CHARS || !IMAGE_RE.test(n.image)) {
          errors.push('Immagine non valida nel nodo ' + id);
        }
      }
      if (n.images !== undefined && n.images !== null) {
        if (!Array.isArray(n.images) || n.images.length > MAX_IMAGES_PER_NODE) {
          errors.push('Elenco immagini non valido nel nodo ' + id);
        } else {
          n.images.forEach(function (img) {
            if (!img || typeof img.src !== 'string' || img.src.length > MAX_IMAGE_CHARS || !IMAGE_RE.test(img.src)) {
              errors.push('Immagine non valida nel nodo ' + id);
            }
          });
        }
      }
      if (SHAPES.indexOf(n.shape) < 0) errors.push('Forma non valida nel nodo ' + id);
      if (!Array.isArray(n.children)) { errors.push('Figli non validi nel nodo ' + id); return; }
      n.children.forEach(function (c) {
        if (!map.nodes[c]) errors.push('Il nodo ' + id + ' ha un figlio inesistente: ' + c);
        else if (map.nodes[c].parentId !== id) errors.push('Genitore incoerente per il nodo ' + c);
      });
      if (n.parentId !== null) {
        var p = map.nodes[n.parentId];
        var sp = !p ? summaryMap[n.parentId] : null;
        var inParent = p && Array.isArray(p.children) && p.children.indexOf(id) >= 0;
        var inSummary = sp && Array.isArray(sp.children) && sp.children.indexOf(id) >= 0;
        if (!inParent && !inSummary) {
          errors.push('Il nodo ' + id + ' non compare tra i figli del suo genitore');
        }
      }
    });

    // Raggiungibilità dalla radice (rileva anche cicli e nodi isolati).
    if (errors.length === 0) {
      var seen = {};
      var stack = [map.rootId];
      if (Array.isArray(map.summaries)) {
        map.summaries.forEach(function (s) {
          if (s && Array.isArray(s.children)) {
            s.children.forEach(function (c) {
              if (map.nodes[c]) stack.push(c);
            });
          }
        });
      }
      while (stack.length) {
        var cur = stack.pop();
        if (seen[cur]) { errors.push('Ciclo rilevato nel nodo ' + cur); break; }
        seen[cur] = true;
        map.nodes[cur].children.forEach(function (c) { stack.push(c); });
      }
      if (Object.keys(seen).length !== ids.length) errors.push('Alcuni nodi non sono collegati al nodo centrale');
    }

    if (Array.isArray(map.links)) {
      map.links.forEach(function (l) {
        if (!l || !map.nodes[l.fromId] || !map.nodes[l.toId]) errors.push('Collegamento verso un nodo inesistente');
        else if (l.fromId === l.toId) errors.push('Collegamento di un nodo con sé stesso');
      });
    }
    if (!map.settings || typeof map.settings !== 'object') {
      errors.push('Impostazioni mancanti');
    } else {
      if (LAYOUTS.indexOf(map.settings.layout) < 0) errors.push('Disposizione non valida');
      if (THEMES.indexOf(map.settings.theme) < 0) errors.push('Tema non valido');
    }
    return { ok: errors.length === 0, errors: errors };
  }

  MM.model = {
    FILE_VERSION: FILE_VERSION, MAX_TEXT: MAX_TEXT, SHAPES: SHAPES, LAYOUTS: LAYOUTS,
    SUB_LAYOUTS: SUB_LAYOUTS, LINK_STYLES: LINK_STYLES,
    THEMES: THEMES, resolveTheme: resolveTheme, PALETTE: PALETTE, ROOT_COLOR: ROOT_COLOR, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    WORD_FONTS: WORD_FONTS, FONT_SIZES: FONT_SIZES, TEXT_COLORS: TEXT_COLORS, TEXT_ALIGNS: TEXT_ALIGNS, PASTEL_FILLS: PASTEL_FILLS, fontCssFor: fontCssFor,
    BOX_SIZES: BOX_SIZES, LEVEL_SCALES: LEVEL_SCALES, boxScaleFor: boxScaleFor,
    imageBoxFor: imageBoxFor, nodeImagesOf: nodeImagesOf, MAX_IMAGE_CHARS: MAX_IMAGE_CHARS, MAX_IMAGES_PER_NODE: MAX_IMAGES_PER_NODE,
    uid: uid, clone: clone, nowIso: nowIso,
    createNode: createNode, createMap: createMap,
    getDescendants: getDescendants, getVisibleNodeIds: getVisibleNodeIds,
    getDepth: getDepth, getBranchRoot: getBranchRoot, getTopicNumber: getTopicNumber, getTopicLabel: getTopicLabel,
    addChild: addChild, addSibling: addSibling, updateNode: updateNode,
    removeNode: removeNode, moveNode: moveNode, reparent: reparent,
    toggleCollapsed: toggleCollapsed, cloneSubtree: cloneSubtree,
    addLink: addLink, updateLink: updateLink, removeLink: removeLink,
    reverseLink: reverseLink, getLinksOf: getLinksOf,
    addSummary: addSummary, addSummaryForNodes: addSummaryForNodes, addChildToSummary: addChildToSummary, findSummary: findSummary, updateSummary: updateSummary, removeSummary: removeSummary, getSummaryNodes: getSummaryNodes,
    toOutline: toOutline, textColorFor: textColorFor, validate: validate
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
