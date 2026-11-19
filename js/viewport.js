/*
 * Mappe Mentali – vista (pan e zoom) dell'area di lavoro.
 * Lo stato { x, y, scale } viene applicato come transform su <g id="world">:
 *   schermo = mondo * scale + (x, y)
 * Le coordinate "schermo" accettate dalle funzioni sono relative all'angolo
 * in alto a sinistra dell'elemento SVG (non della finestra), salvo
 * screenToWorld/clientToLocal che accettano clientX/clientY.
 */
(function (root) {
  'use strict';
  var MM = root.MM;

  var MIN_SCALE = 0.2;
  var MAX_SCALE = 4;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  /** @returns {Viewport} */
  function create(svgEl, worldEl) {
    var state = { x: 0, y: 0, scale: 1 };
    var listeners = [];

    function size() {
      var r = svgEl.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }

    function apply() {
      worldEl.setAttribute('transform',
        'translate(' + round(state.x) + ' ' + round(state.y) + ') scale(' + round(state.scale, 4) + ')');
      listeners.forEach(function (cb) { cb(getState()); });
    }

    function round(v, digits) {
      var f = Math.pow(10, digits || 2);
      return Math.round(v * f) / f;
    }

    function getState() { return { x: state.x, y: state.y, scale: state.scale }; }

    function setState(s) {
      if (typeof s.x === 'number') state.x = s.x;
      if (typeof s.y === 'number') state.y = s.y;
      if (typeof s.scale === 'number') state.scale = clamp(s.scale, MIN_SCALE, MAX_SCALE);
      apply();
    }

    function panBy(dx, dy) {
      state.x += dx;
      state.y += dy;
      apply();
    }

    /** Zoom di un fattore mantenendo fermo il punto (sx, sy) relativo all'SVG. */
    function zoomAt(factor, sx, sy) {
      var s = size();
      if (sx === undefined) { sx = s.width / 2; sy = s.height / 2; }
      var newScale = clamp(state.scale * factor, MIN_SCALE, MAX_SCALE);
      var k = newScale / state.scale;
      state.x = sx - (sx - state.x) * k;
      state.y = sy - (sy - state.y) * k;
      state.scale = newScale;
      apply();
    }

    /** Adatta la vista per mostrare tutto il riquadro (coordinate del mondo). */
    function fitTo(bounds, padding, maxScale) {
      var pad = typeof padding === 'number' ? padding : 40;
      var s = size();
      if (!s.width || !s.height || !isFinite(bounds.minX)) return;
      var bw = Math.max(1, bounds.maxX - bounds.minX);
      var bh = Math.max(1, bounds.maxY - bounds.minY);
      var scale = Math.min((s.width - 2 * pad) / bw, (s.height - 2 * pad) / bh, maxScale || 1.5);
      state.scale = clamp(scale, MIN_SCALE, MAX_SCALE);
      state.x = s.width / 2 - (bounds.minX + bw / 2) * state.scale;
      state.y = s.height / 2 - (bounds.minY + bh / 2) * state.scale;
      apply();
    }

    /** Sposta la vista il minimo indispensabile perché il riquadro (mondo) sia visibile. */
    function ensureVisible(box, margin) {
      var m = typeof margin === 'number' ? margin : 30;
      var s = size();
      var left = box.minX * state.scale + state.x;
      var right = box.maxX * state.scale + state.x;
      var top = box.minY * state.scale + state.y;
      var bottom = box.maxY * state.scale + state.y;
      var dx = 0;
      var dy = 0;
      if (left < m) dx = m - left;
      else if (right > s.width - m) dx = s.width - m - right;
      if (top < m) dy = m - top;
      else if (bottom > s.height - m) dy = s.height - m - bottom;
      if (dx || dy) panBy(dx, dy);
    }

    /** clientX/clientY (finestra) → coordinate relative all'SVG. */
    function clientToLocal(cx, cy) {
      var s = size();
      return { x: cx - s.left, y: cy - s.top };
    }

    /** clientX/clientY (finestra) → coordinate del mondo. */
    function screenToWorld(cx, cy) {
      var p = clientToLocal(cx, cy);
      return { x: (p.x - state.x) / state.scale, y: (p.y - state.y) / state.scale };
    }

    /** Coordinate del mondo → clientX/clientY (finestra). */
    function worldToScreen(wx, wy) {
      var s = size();
      return { x: wx * state.scale + state.x + s.left, y: wy * state.scale + state.y + s.top };
    }

    function onChange(cb) {
      listeners.push(cb);
      return function () { listeners = listeners.filter(function (l) { return l !== cb; }); };
    }

    apply();
    return {
      getState: getState, setState: setState, panBy: panBy, zoomAt: zoomAt, fitTo: fitTo,
      ensureVisible: ensureVisible, clientToLocal: clientToLocal,
      screenToWorld: screenToWorld, worldToScreen: worldToScreen, onChange: onChange
    };
  }

  MM.viewport = { MIN_SCALE: MIN_SCALE, MAX_SCALE: MAX_SCALE, create: create };
})(typeof globalThis !== 'undefined' ? globalThis : window);
