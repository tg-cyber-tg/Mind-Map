/*
 * Mappe Mentali – modello dati (logica pura, nessun accesso al DOM).
 * Tutte le funzioni che modificano la mappa restituiscono una NUOVA mappa:
 * l'originale non viene mai alterato (necessario per annulla/ripristina).
 */
(function (root) {
  'use strict';
  var MM = root.MM;

  /** @typedef {'rounded'|'ellipse'|'rect'} NodeShape */
  /** @typedef {'radial'|'tree'} LayoutKind */
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
  var SHAPES = ['rounded', 'ellipse', 'rect'];
  var LAYOUTS = ['radial', 'tree'];
  var THEMES = ['chiaro', 'scuro', 'alto-contrasto'];
  var ROOT_COLOR = '#FFD54F';
  // Colori dei rami: saturi ma chiari/scuri a sufficienza per un buon contrasto col testo.
  var PALETTE = [
    '#4FC3F7', '#81C784', '#FF8A65', '#BA68C8', '#F06292',
    '#4DB6AC', '#FFB74D', '#7986CB', '#AED581', '#E57373'
  ];
  var DEFAULT_SETTINGS = {
    layout: 'radial',
    theme: 'chiaro',
    uppercase: false,
    fontScale: 1,
    fontFamily: 'leggibile'
  };
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
    var stack = [map.rootId];
    while (stack.length) {
      var id = stack.pop();
      var n = map.nodes[id];
      if (!n) continue;
      result.push(id);
      if (n.collapsed) continue;
      for (var i = n.children.length - 1; i >= 0; i--) stack.push(n.children[i]);
    }
    return result;
  }

  /** Profondità: 0 per la radice. */
  function getDepth(map, nodeId) {
    var depth = 0;
    var n = assertNode(map, nodeId);
    var guard = 0;
    while (n.parentId !== null && guard++ < 10000) {
      n = map.nodes[n.parentId];
      if (!n) break;
      depth++;
    }
    return depth;
  }

  /** Antenato di primo livello (figlio diretto della radice), o null per la radice. */
  function getBranchRoot(map, nodeId) {
    var n = assertNode(map, nodeId);
    if (n.parentId === null) return null;
    while (n.parentId !== map.rootId) n = map.nodes[n.parentId];
    return n;
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
    var res = addChild(map, node.parentId, text);
    var parent = res.map.nodes[node.parentId];
    parent.children.pop();
    parent.children.splice(parent.children.indexOf(nodeId) + 1, 0, res.nodeId);
    res.map.nodes[res.nodeId].x = node.x;
    res.map.nodes[res.nodeId].y = node.y + 60;
    return res;
  }

  /** Aggiorna i campi modificabili del nodo (non id, parentId, children). */
  function updateNode(map, nodeId, patch) {
    var m = clone(map);
    var n = assertNode(m, nodeId);
    var p = patch || {};
    if (p.text !== undefined) n.text = String(p.text).slice(0, MAX_TEXT);
    if (typeof p.x === 'number') n.x = p.x;
    if (typeof p.y === 'number') n.y = p.y;
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
    if (p.collapsed !== undefined) n.collapsed = !!p.collapsed;
    // Il testo del nodo centrale è anche il titolo della mappa.
    if (nodeId === m.rootId && p.text !== undefined) m.title = n.text;
    return m;
  }

  /** Elimina il nodo, il suo sottoalbero e i collegamenti che li coinvolgono. */
  function removeNode(map, nodeId) {
    var node = assertNode(map, nodeId);
    if (node.parentId === null) throw new Error('Il nodo centrale non può essere eliminato');
    var m = clone(map);
    var removed = [nodeId].concat(getDescendants(m, nodeId));
    var parent = m.nodes[node.parentId];
    parent.children = parent.children.filter(function (id) { return id !== nodeId; });
    removed.forEach(function (id) { delete m.nodes[id]; });
    m.links = m.links.filter(function (l) {
      return removed.indexOf(l.fromId) < 0 && removed.indexOf(l.toId) < 0;
    });
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
    oldParent.children = oldParent.children.filter(function (id) { return id !== nodeId; });
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
    var link = m.links[findLinkIndex(m, linkId)];
    if (patch && patch.label !== undefined) link.label = String(patch.label).slice(0, MAX_TEXT);
    return m;
  }

  function removeLink(map, linkId) {
    var m = clone(map);
    m.links.splice(findLinkIndex(m, linkId), 1);
    return m;
  }

  /* ---------- Utilità ---------- */

  /** Schema testuale indentato (per lettura vocale e copia negli appunti). */
  function toOutline(map) {
    var lines = [];
    (function visit(id, depth) {
      var n = map.nodes[id];
      if (!n) return;
      var text = (n.icon ? n.icon + ' ' : '') + n.text.replace(/\s*\n\s*/g, ' ');
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

    ids.forEach(function (id) {
      var n = map.nodes[id];
      if (!n || n.id !== id) { errors.push('Nodo con id incoerente: ' + id); return; }
      if (typeof n.text !== 'string' || n.text.length > MAX_TEXT) errors.push('Testo non valido nel nodo ' + id);
      if (typeof n.x !== 'number' || typeof n.y !== 'number' || !isFinite(n.x) || !isFinite(n.y)) {
        errors.push('Posizione non valida nel nodo ' + id);
      }
      if (!COLOR_RE.test(n.color)) errors.push('Colore non valido nel nodo ' + id);
      if (SHAPES.indexOf(n.shape) < 0) errors.push('Forma non valida nel nodo ' + id);
      if (!Array.isArray(n.children)) { errors.push('Figli non validi nel nodo ' + id); return; }
      n.children.forEach(function (c) {
        if (!map.nodes[c]) errors.push('Il nodo ' + id + ' ha un figlio inesistente: ' + c);
        else if (map.nodes[c].parentId !== id) errors.push('Genitore incoerente per il nodo ' + c);
      });
      if (n.parentId !== null) {
        var p = map.nodes[n.parentId];
        if (!p || !Array.isArray(p.children) || p.children.indexOf(id) < 0) {
          errors.push('Il nodo ' + id + ' non compare tra i figli del suo genitore');
        }
      }
    });

    // Raggiungibilità dalla radice (rileva anche cicli e nodi isolati).
    if (errors.length === 0) {
      var seen = {};
      var stack = [map.rootId];
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
    THEMES: THEMES, PALETTE: PALETTE, ROOT_COLOR: ROOT_COLOR, DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    uid: uid, clone: clone, nowIso: nowIso,
    createNode: createNode, createMap: createMap,
    getDescendants: getDescendants, getVisibleNodeIds: getVisibleNodeIds,
    getDepth: getDepth, getBranchRoot: getBranchRoot,
    addChild: addChild, addSibling: addSibling, updateNode: updateNode,
    removeNode: removeNode, moveNode: moveNode, reparent: reparent,
    toggleCollapsed: toggleCollapsed,
    addLink: addLink, updateLink: updateLink, removeLink: removeLink,
    toOutline: toOutline, textColorFor: textColorFor, validate: validate
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
