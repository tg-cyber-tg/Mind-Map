/* Test di MM.history */
(function () {
  'use strict';
  var H = MM.history;

  describe('history', function () {
    it('una cronologia nuova non permette annulla né ripristina', function () {
      var h = H.createHistory();
      assert.ok(!H.canUndo(h) && !H.canRedo(h));
      assert.equal(H.undo(h, 'X').map, null);
      assert.equal(H.redo(h, 'X').map, null);
    });

    it('annulla e ripristina nell\'ordine corretto', function () {
      // Stati successivi: A -> B -> C (corrente)
      var h = H.createHistory();
      h = H.push(h, 'A');
      h = H.push(h, 'B');
      var r = H.undo(h, 'C');
      assert.equal(r.map, 'B');
      r = H.undo(r.history, 'B');
      assert.equal(r.map, 'A');
      assert.ok(!H.canUndo(r.history));
      r = H.redo(r.history, 'A');
      assert.equal(r.map, 'B');
      r = H.redo(r.history, 'B');
      assert.equal(r.map, 'C');
      assert.ok(!H.canRedo(r.history));
    });

    it('una nuova modifica dopo un annulla svuota i ripristina', function () {
      var h = H.push(H.createHistory(), 'A');
      var r = H.undo(h, 'B');
      assert.ok(H.canRedo(r.history));
      h = H.push(r.history, 'A');
      assert.ok(!H.canRedo(h));
    });

    it('rispetta il limite massimo di passaggi', function () {
      var h = H.createHistory(3);
      ['A', 'B', 'C', 'D', 'E'].forEach(function (s) { h = H.push(h, s); });
      assert.deepEqual(h.past, ['C', 'D', 'E']);
    });

    it('non modifica la cronologia originale', function () {
      var h = H.push(H.createHistory(), 'A');
      H.undo(h, 'B');
      H.push(h, 'Z');
      assert.deepEqual(h.past, ['A']);
      assert.deepEqual(h.future, []);
    });

    it('funziona con mappe reali', function () {
      var map0 = MM.model.createMap('Prova');
      var h = H.push(H.createHistory(), map0);
      var map1 = MM.model.addChild(map0, map0.rootId, 'Figlio').map;
      var r = H.undo(h, map1);
      assert.equal(Object.keys(r.map.nodes).length, 1);
      r = H.redo(r.history, r.map);
      assert.equal(Object.keys(r.map.nodes).length, 2);
    });
  });
})();
