/*
 * Mappe Mentali – esportazione SVG/PNG e stampa (PDF).
 * L'immagine si ottiene dal disegno reale del renderer (stesse misure e stessi
 * a capo): si clonano i livelli, si tolgono selezione ed elementi tecnici e si
 * incorpora uno <style> con i colori del tema e il carattere in uso.
 */
(function (root) {
  'use strict';
  var MM = root.MM;
  var NS = 'http://www.w3.org/2000/svg';

  var MARGIN = 40;
  var MAX_PIXELS = 16000000;   // limite prudente per Safari/iPad (circa 4000×4000)
  var MAX_SIDE = 8192;
  var ARROW_ID = 'mmx-arrow';   // diverso dal marcatore della pagina (evita conflitti)
  var SHADOW_ID = 'mmx-shadow'; // diverso dal filtro della pagina (evita conflitti)
  var TRANSIENT_CLASSES = ['selected', 'highlight', 'link-source', 'drop-target', 'dragging', 'editing'];
  var TECH_ATTRS = ['role', 'aria-selected', 'aria-pressed', 'aria-expanded', 'aria-level', 'aria-label',
    'data-id', 'data-link-id', 'tabindex'];

  /** Scala effettiva per il PNG, ridotta se l'immagine supererebbe i limiti del browser. */
  function fitScale(width, height, scale) {
    var s = scale || 2;
    var w = Math.max(1, width);
    var h = Math.max(1, height);
    s = Math.min(s, MAX_SIDE / w, MAX_SIDE / h, Math.sqrt(MAX_PIXELS / (w * h)));
    return Math.max(0.1, s);
  }

  /** Riquadro (coordinate del mondo) che contiene nodi, rami, collegamenti ed etichette. */
  function exportBounds(map, renderer) {
    var b = MM.layout.getBounds(map);
    if (renderer && renderer.world) {
      var layers = renderer.world.children;
      for (var i = 0; i < layers.length; i++) {
        if (layers[i].tagName !== 'g') continue;
        var bb = null;
        try { bb = layers[i].getBBox(); } catch (e) { bb = null; }
        if (!bb || (!bb.width && !bb.height)) continue;
        b.minX = Math.min(b.minX, bb.x);
        b.minY = Math.min(b.minY, bb.y);
        b.maxX = Math.max(b.maxX, bb.x + bb.width);
        b.maxY = Math.max(b.maxY, bb.y + bb.height);
      }
    }
    if (!isFinite(b.minX)) b = { minX: -100, minY: -50, maxX: 100, maxY: 50 };
    return {
      x: Math.floor(b.minX - MARGIN), y: Math.floor(b.minY - MARGIN),
      width: Math.ceil(b.maxX - b.minX + 2 * MARGIN), height: Math.ceil(b.maxY - b.minY + 2 * MARGIN)
    };
  }

  /** Colori e carattere attualmente in uso (tema e impostazioni di accessibilità). */
  function currentLook(map, svgEl) {
    var body = root.getComputedStyle(document.body);
    function v(name, fallback) { return body.getPropertyValue(name).trim() || fallback; }
    var ts = root.getComputedStyle(svgEl);
    var theme = (map.settings && map.settings.theme) || 'chiaro';
    var defaultBg = theme === 'scuro' ? '#0f172a' : (theme === 'alto-contrasto' ? '#000000' : '#ffffff');
    var defaultSurface = theme === 'scuro' ? '#1e293b' : (theme === 'alto-contrasto' ? '#000000' : '#ffffff');
    var defaultText = theme === 'chiaro' ? '#0f172a' : (theme === 'scuro' ? '#f8fafc' : '#ffffff');
    var defaultBorder = theme === 'scuro' ? '#334155' : (theme === 'alto-contrasto' ? '#ffffff' : '#e2e8f0');
    return {
      theme: theme,
      // Tema chiaro: sfondo bianco puro (adatto a stampa e documenti).
      bg: theme === 'chiaro' ? '#ffffff' : (theme === 'alto-contrasto' ? '#000000' : v('--mm-bg', defaultBg)),
      surface: theme === 'alto-contrasto' ? '#000000' : v('--mm-surface', defaultSurface),
      text: theme === 'alto-contrasto' ? '#ffffff' : v('--mm-text', defaultText),
      border: theme === 'alto-contrasto' ? '#ffffff' : v('--mm-border', defaultBorder),
      fontFamily: ts.fontFamily || '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      letterSpacing: ts.letterSpacing && ts.letterSpacing !== 'normal' ? ts.letterSpacing : '0',
      wordSpacing: ts.wordSpacing && ts.wordSpacing !== 'normal' ? ts.wordSpacing : '0'
    };
  }

  function styleSheet(look) {
    var hc = look.theme === 'alto-contrasto';
    return [
      'text{font-family:' + look.fontFamily + ';letter-spacing:' + look.letterSpacing +
        ';word-spacing:' + look.wordSpacing + '}',
      '.branch{fill:none;stroke-linecap:round;opacity:.88}',
      '.node-shape{stroke-width:' + (hc ? '2.5' : '1.75') + '}',
      '.node.root .node-shape{stroke-width:' + (hc ? '3' : '1.5') + '}',
      '.node-icon{pointer-events:none}',
      '.link{fill:none;stroke:' + look.text + ';stroke-width:1.75;stroke-dasharray:6 5;opacity:.65}',
      '.link-arrow{fill:' + look.text + '}',
      '.link-label rect{fill:' + look.surface + ';stroke:' + look.border + '}',
      '.link-label text{fill:' + look.text + ';font-style:italic}',
      '.badge-collapsed circle{fill:' + look.surface + ';stroke-width:1.75}',
      '.badge-collapsed text{fill:' + look.text + ';font-weight:bold;letter-spacing:0}',
      '.badge-note circle{fill:' + look.surface + ';stroke-width:1.5}'
    ].join('\n');
  }

  function svgEl(name, attrs, parent) {
    var e = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (parent) parent.appendChild(e);
    return e;
  }

  /** Toglie selezione, evidenziazioni ed elementi che servono solo all'editor. */
  function cleanClone(content) {
    var drop = content.querySelectorAll('.measure, .link-hit');
    for (var i = 0; i < drop.length; i++) drop[i].parentNode.removeChild(drop[i]);
    var all = content.querySelectorAll('*');
    for (var j = 0; j < all.length; j++) {
      var e = all[j];
      TRANSIENT_CLASSES.forEach(function (c) { e.classList.remove(c); });
      TECH_ATTRS.forEach(function (a) { e.removeAttribute(a); });
      if (e.getAttribute('marker-end')) e.setAttribute('marker-end', 'url(#' + ARROW_ID + ')');
      var flt = e.getAttribute('filter');
      if (flt && flt.indexOf('mm-node-shadow') >= 0) e.setAttribute('filter', 'url(#' + SHADOW_ID + ')');
      // Le etichette vuote sono nascoste con display:none: si eliminano del tutto.
      if (e.style && e.style.display === 'none' && e.parentNode) e.parentNode.removeChild(e);
    }
    content.removeAttribute('transform');
    content.removeAttribute('id');
    return content;
  }

  /** Costruisce un <svg> autonomo (non inserito nella pagina) con la mappa intera. */
  function buildSVG(map, renderer) {
    if (!renderer || !renderer.world) throw new Error('La mappa non è ancora disegnata: riprova tra un attimo');
    var box = exportBounds(map, renderer);
    var look = currentLook(map, renderer.svg);
    var svg = svgEl('svg', {
      xmlns: NS, viewBox: box.x + ' ' + box.y + ' ' + box.width + ' ' + box.height,
      width: box.width, height: box.height, role: 'img', 'aria-label': 'Mappa: ' + map.title
    });
    svgEl('title', null, svg).textContent = map.title;
    svgEl('style', null, svg).textContent = styleSheet(look);
    var defs = svgEl('defs', null, svg);
    var marker = renderer.svg.querySelector('#mm-arrow');
    if (marker) {
      var m = marker.cloneNode(true);
      m.setAttribute('id', ARROW_ID);
      defs.appendChild(m);
    }
    var shadow = renderer.svg.querySelector('#mm-node-shadow');
    if (shadow) {
      var s = shadow.cloneNode(true);
      s.setAttribute('id', SHADOW_ID);
      defs.appendChild(s);
    }
    svgEl('rect', { x: box.x, y: box.y, width: box.width, height: box.height, fill: look.bg }, svg);
    svg.appendChild(cleanClone(renderer.world.cloneNode(true)));
    return { svg: svg, box: box };
  }

  /** Testo SVG completo, pronto da salvare come file .svg. */
  function toSVGString(map, renderer) {
    var built = buildSVG(map, renderer);
    return '<?xml version="1.0" encoding="UTF-8"?>\n' + new XMLSerializer().serializeToString(built.svg);
  }

  /**
   * Immagine PNG (sfondo pieno) con fattore di nitidezza scale (2 = adatta a schermi Retina).
   * @returns {Promise<Blob>}
   */
  function toPNG(map, renderer, scale) {
    return new Promise(function (resolve, reject) {
      var built = buildSVG(map, renderer);
      var k = fitScale(built.box.width, built.box.height, scale);
      var w = Math.round(built.box.width * k);
      var h = Math.round(built.box.height * k);
      // Dimensioni in pixel già scalate: il browser rasterizza l'SVG in modo nitido.
      built.svg.setAttribute('width', w);
      built.svg.setAttribute('height', h);
      var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(built.svg));
      var img = new Image();
      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, w, h);
          canvas.toBlob(function (blob) {
            if (blob) resolve(blob);
            else reject(new Error('Immagine troppo grande: prova a comprimere qualche ramo'));
          }, 'image/png');
        } catch (e) {
          reject(new Error('Impossibile creare l\'immagine PNG: ' + e.message));
        }
      };
      img.onerror = function () { reject(new Error('Impossibile creare l\'immagine PNG')); };
      img.src = url;
    });
  }

  /**
   * Stampa (o salva in PDF dalla finestra di stampa): la mappa intera viene messa in
   * #print-area, che css/print.css adatta a un foglio A4 orizzontale.
   */
  function preparePrint(app) {
    var map = app && app.getMap();
    if (!map || !app.state.renderer) return false;
    var area = document.getElementById('print-area');
    if (!area) {
      area = document.createElement('div');
      area.id = 'print-area';
      area.setAttribute('aria-hidden', 'true');
      document.body.appendChild(area);
    }
    area.textContent = '';
    var built = buildSVG(map, app.state.renderer);
    built.svg.removeAttribute('width');
    built.svg.removeAttribute('height');
    built.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    // Le mappe piccole non vengono ingrandite oltre le dimensioni reali (1:1).
    built.svg.style.maxWidth = built.box.width + 'px';
    built.svg.style.maxHeight = built.box.height + 'px';
    var heading = document.createElement('h1');
    heading.className = 'print-title';
    heading.textContent = map.title;
    area.appendChild(heading);
    area.appendChild(built.svg);
    document.body.classList.add('mm-printing');
    return true;
  }

  function cleanupPrint() {
    document.body.classList.remove('mm-printing');
    var area = document.getElementById('print-area');
    if (area) area.textContent = '';
  }

  function print(app) {
    preparePrint(app);
    root.print();
    // Senza l'evento afterprint (browser molto vecchi) si pulisce dopo la finestra di stampa.
    if (!('onafterprint' in root)) setTimeout(cleanupPrint, 1000);
  }

  // Anche Cmd/Ctrl+P o il menu File → Stampa del browser stampano la mappa intera.
  if (typeof document !== 'undefined' && root.addEventListener) {
    root.addEventListener('beforeprint', function () {
      if (!document.body.classList.contains('mm-printing') && MM.app) {
        try { preparePrint(MM.app); } catch (e) { /* si stampa la vista corrente */ }
      }
    });
    root.addEventListener('afterprint', cleanupPrint);
  }

  MM.exporter = {
    fitScale: fitScale,
    exportBounds: exportBounds,
    buildSVG: buildSVG,
    toSVGString: toSVGString,
    toPNG: toPNG,
    preparePrint: preparePrint,
    cleanupPrint: cleanupPrint,
    print: print
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

