/*
 * Mappe Mentali – vista (pan e zoom) dell'area di lavoro.
 * Lo stato { x, y, scale } viene applicato come transform su <g id="world">:
 *   schermo = mondo * scale + (x, y)
 * Include animazioni fluide (ease-out cubico via requestAnimationFrame) per
 * Adatta, pulsanti zoom e centratura nodi, sincronizzazione della griglia a
 * puntini sullo sfondo e caching delle dimensioni SVG per 60–120fps fluidi.
 */
(function (root) {
  'use strict';
  var MM = root.MM;

  var MIN_SCALE = 0.2;
  var MAX_SCALE = 4;
  var BASE_DOT_STEP = 22;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function reducedMotion() {
    try { return typeof root.matchMedia === 'function' && root.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  /** @returns {Viewport} */
  function create(svgEl, worldEl) {
    var state = { x: 0, y: 0, scale: 1 };
    var listeners = [];
    var animId = null;
    var applyRaf = null;
    var lastNotifiedX = NaN;
    var lastNotifiedY = NaN;
    var lastNotifiedScale = NaN;
    var cachedRect = null;

    function refreshRect() {
      cachedRect = svgEl.getBoundingClientRect();
      return cachedRect;
    }

    function size() {
      var r = cachedRect || refreshRect();
      if (!r.width || !r.height) r = refreshRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    }

    if (typeof root.addEventListener === 'function') {
      root.addEventListener('resize', function () { cachedRect = null; });
    }
    if (typeof root.ResizeObserver === 'function') {
      try {
        new root.ResizeObserver(function () { cachedRect = null; }).observe(svgEl);
      } catch (e) { /* ok */ }
    }

    function cancelAnim() {
      if (animId !== null) {
        if (typeof root.cancelAnimationFrame === 'function') root.cancelAnimationFrame(animId);
        animId = null;
      }
    }

    function round(v, digits) {
      var f = Math.pow(10, digits || 2);
      return Math.round(v * f) / f;
    }

    function syncGrid() {
      // Mantiene la griglia a puntini leggibile anche a zoom estremi.
      var step = BASE_DOT_STEP * state.scale;
      while (step < 14) step *= 2;
      while (step > 44) step /= 2;
      svgEl.style.backgroundSize = round(step, 2) + 'px ' + round(step, 2) + 'px';
      svgEl.style.backgroundPosition = round(state.x, 1) + 'px ' + round(state.y, 1) + 'px';
    }

    function applyNow() {
      applyRaf = null;
      var rx = round(state.x, 1);
      var ry = round(state.y, 1);
      var rs = round(state.scale, 4);
      worldEl.style.transform =
        'translate3d(' + rx + 'px, ' + ry + 'px, 0) scale(' + rs + ')';
      syncGrid();
      if (rx !== lastNotifiedX || ry !== lastNotifiedY || rs !== lastNotifiedScale) {
        lastNotifiedX = rx;
        lastNotifiedY = ry;
        lastNotifiedScale = rs;
        var snap = getState();
        listeners.forEach(function (cb) { cb(snap); });
      }
    }

    function apply(immediate) {
      if (immediate || typeof root.requestAnimationFrame !== 'function') {
        if (applyRaf !== null && typeof root.cancelAnimationFrame === 'function') {
          root.cancelAnimationFrame(applyRaf);
          applyRaf = null;
        }
        applyNow();
        return;
      }
      if (applyRaf === null) applyRaf = root.requestAnimationFrame(applyNow);
    }

    function animateTo(target, duration) {
      cancelAnim();
      var dur = duration || 240;
      if (reducedMotion() || typeof root.requestAnimationFrame !== 'function' || dur <= 0) {
        state.x = target.x;
        state.y = target.y;
        state.scale = clamp(target.scale, MIN_SCALE, MAX_SCALE);
        apply();
        return;
      }
      var from = { x: state.x, y: state.y, scale: state.scale };
      var to = { x: target.x, y: target.y, scale: clamp(target.scale, MIN_SCALE, MAX_SCALE) };
      var startTime = null;
      function step(now) {
        if (startTime === null) startTime = now;
        var t = Math.min(1, (now - startTime) / dur);
        var e = easeOutCubic(t);
        state.x = from.x + (to.x - from.x) * e;
        state.y = from.y + (to.y - from.y) * e;
        state.scale = from.scale + (to.scale - from.scale) * e;
        apply(true);
        if (t < 1) animId = root.requestAnimationFrame(step);
        else animId = null;
      }
      animId = root.requestAnimationFrame(step);
    }

    function getState() { return { x: state.x, y: state.y, scale: state.scale }; }

    function setState(s) {
      cancelAnim();
      if (typeof s.x === 'number') state.x = s.x;
      if (typeof s.y === 'number') state.y = s.y;
      if (typeof s.scale === 'number') state.scale = clamp(s.scale, MIN_SCALE, MAX_SCALE);
      apply();
    }

    function panBy(dx, dy) {
      cancelAnim();
      state.x += dx;
      state.y += dy;
      apply();
    }

    /** Zoom di un fattore mantenendo fermo il punto (sx, sy) relativo all'SVG. */
    function zoomAt(factor, sx, sy, opts) {
      var s = size();
      if (sx === undefined) { sx = s.width / 2; sy = s.height / 2; }
      var newScale = clamp(state.scale * factor, MIN_SCALE, MAX_SCALE);
      var k = newScale / state.scale;
      var nx = sx - (sx - state.x) * k;
      var ny = sy - (sy - state.y) * k;
      if (opts && opts.animate) {
        animateTo({ x: nx, y: ny, scale: newScale }, 190);
      } else {
        cancelAnim();
        state.x = nx;
        state.y = ny;
        state.scale = newScale;
        apply();
      }
    }

    /** Adatta la vista per mostrare tutto il riquadro (coordinate del mondo). */
    function fitTo(bounds, padding, maxScale, opts) {
      var pad = typeof padding === 'number' ? padding : 40;
      var s = refreshRect();
      if (!s.width || !s.height || !isFinite(bounds.minX)) return;
      var bw = Math.max(1, bounds.maxX - bounds.minX);
      var bh = Math.max(1, bounds.maxY - bounds.minY);
      var scale = clamp(Math.min((s.width - 2 * pad) / bw, (s.height - 2 * pad) / bh, maxScale || 1.5), MIN_SCALE, MAX_SCALE);
      var target = {
        scale: scale,
        x: s.width / 2 - (bounds.minX + bw / 2) * scale,
        y: s.height / 2 - (bounds.minY + bh / 2) * scale
      };
      if (opts && opts.animate) animateTo(target, 260);
      else { cancelAnim(); state.scale = target.scale; state.x = target.x; state.y = target.y; apply(); }
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
      if (dx || dy) animateTo({ x: state.x + dx, y: state.y + dy, scale: state.scale }, 210);
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
