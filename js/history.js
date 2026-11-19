/*
 * Mappe Mentali – annulla/ripristina basato su snapshot (logica pura).
 * Le mappe sono immutabili, quindi conservare il riferimento è sufficiente.
 */
(function (root) {
  'use strict';
  var MM = root.MM;

  /** @returns {{past: Array, future: Array, limit: number}} */
  function createHistory(limit) {
    return { past: [], future: [], limit: typeof limit === 'number' && limit > 0 ? limit : 100 };
  }

  /** Registra lo stato PRIMA di una modifica. Svuota la pila dei "ripristina". */
  function push(history, snapshot) {
    var past = history.past.concat([snapshot]);
    if (past.length > history.limit) past = past.slice(past.length - history.limit);
    return { past: past, future: [], limit: history.limit };
  }

  /** @returns {{history: Object, map: Object|null}} map è null se non c'è nulla da annullare. */
  function undo(history, current) {
    if (!history.past.length) return { history: history, map: null };
    var previous = history.past[history.past.length - 1];
    return {
      history: {
        past: history.past.slice(0, -1),
        future: [current].concat(history.future),
        limit: history.limit
      },
      map: previous
    };
  }

  /** @returns {{history: Object, map: Object|null}} map è null se non c'è nulla da ripristinare. */
  function redo(history, current) {
    if (!history.future.length) return { history: history, map: null };
    var next = history.future[0];
    return {
      history: {
        past: history.past.concat([current]),
        future: history.future.slice(1),
        limit: history.limit
      },
      map: next
    };
  }

  function canUndo(history) { return history.past.length > 0; }
  function canRedo(history) { return history.future.length > 0; }

  MM.history = {
    createHistory: createHistory,
    push: push,
    undo: undo,
    redo: redo,
    canUndo: canUndo,
    canRedo: canRedo
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
