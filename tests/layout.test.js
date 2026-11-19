/* Test di MM.layout */
(function () {
  'use strict';
  var M = MM.model;
  var L = MM.layout;

  /** Mappa "grande": radice con 6 rami, ognuno con 4 figli, alcuni con nipoti. */
  function bigMap(layout) {
    var map = M.createMap('Rivoluzione francese');
    map.settings.layout = layout || 'radial';
    for (var i = 0; i < 6; i++) {
      var r = M.addChild(map, map.rootId, 'Ramo principale numero ' + (i + 1));
      map = r.map;
      for (var j = 0; j < 4; j++) {
        var c = M.addChild(map, r.nodeId, 'Concetto ' + (i + 1) + '.' + (j + 1));
        map = c.map;
        if (j % 2 === 0) map = M.addChild(map, c.nodeId, 'Dettaglio con un testo un po\' più lungo').map;
      }
    }
    return map;
  }

  /** Restituisce la prima coppia di nodi visibili sovrapposti, o null. */
  function firstOverlap(map) {
    var ids = M.getVisibleNodeIds(map);
    for (var i = 0; i < ids.length; i++) {
      for (var j = i + 1; j < ids.length; j++) {
        var a = map.nodes[ids[i]];
        var b = map.nodes[ids[j]];
        if (L.overlaps(a, L.measureNode(a, map.settings), b, L.measureNode(b, map.settings), 0)) {
          return a.text + ' / ' + b.text;
        }
      }
    }
    return null;
  }

  describe('layout', function () {
    describe('wrapText', function () {
      it('va a capo rispettando la lunghezza massima', function () {
        var lines = L.wrapText('La fotosintesi clorofilliana avviene nelle foglie', 22);
        lines.forEach(function (l) { assert.ok(l.length <= 22, 'riga troppo lunga: ' + l); });
        assert.equal(lines.join(' '), 'La fotosintesi clorofilliana avviene nelle foglie');
      });
      it('rispetta gli a capo manuali e spezza le parole lunghissime', function () {
        assert.deepEqual(L.wrapText('Uno\nDue', 22), ['Uno', 'Due']);
        assert.deepEqual(L.wrapText('abcdefghij', 4), ['abcd', 'efgh', 'ij']);
        assert.deepEqual(L.wrapText('', 22), ['']);
      });
    });

    describe('measureNode', function () {
      it('nodi con più testo o carattere più grande sono più grandi', function () {
        var s = M.DEFAULT_SETTINGS;
        var small = L.measureNode(M.createNode({ parentId: 'x', text: 'Ciao' }), s);
        var big = L.measureNode(M.createNode({ parentId: 'x', text: 'Un testo molto più lungo che va a capo' }), s);
        assert.ok(big.width > small.width && big.height > small.height);
        var scaled = L.measureNode(M.createNode({ parentId: 'x', text: 'Ciao' }), { fontScale: 2 });
        assert.ok(scaled.width > small.width);
      });
      it('usa la funzione di misura personalizzata se impostata', function () {
        L.setMeasurer(function () { return { width: 7, height: 3 }; });
        try {
          assert.deepEqual(L.measureNode(M.createNode({}), {}), { width: 7, height: 3 });
        } finally {
          L.setMeasurer(null);
        }
      });
    });

    describe('radial', function () {
      it('mette la radice al centro (0,0)', function () {
        var map = L.radial(bigMap());
        assert.equal(map.nodes[map.rootId].x, 0);
        assert.equal(map.nodes[map.rootId].y, 0);
      });
      it('nessun nodo si sovrappone a un altro', function () {
        assert.equal(firstOverlap(L.radial(bigMap())), null, 'nodi sovrapposti');
      });
      it('i figli sono più lontani dal centro dei genitori', function () {
        var map = L.radial(bigMap());
        Object.keys(map.nodes).forEach(function (id) {
          var n = map.nodes[id];
          if (n.parentId === null || n.parentId === map.rootId) return;
          var p = map.nodes[n.parentId];
          assert.ok(Math.hypot(n.x, n.y) > Math.hypot(p.x, p.y));
        });
      });
      it('funziona con la sola radice e con un solo figlio', function () {
        var solo = L.radial(M.createMap('Solo'));
        assert.equal(solo.nodes[solo.rootId].x, 0);
        var one = M.createMap('Uno');
        one = M.addChild(one, one.rootId, 'Figlio').map;
        assert.equal(firstOverlap(L.radial(one)), null);
      });
    });

    describe('tree', function () {
      it('dispone i livelli in colonne da sinistra a destra', function () {
        var map = L.tree(bigMap('tree'));
        Object.keys(map.nodes).forEach(function (id) {
          var n = map.nodes[id];
          if (n.parentId !== null) assert.ok(n.x > map.nodes[n.parentId].x);
        });
      });
      it('nessun nodo si sovrappone a un altro', function () {
        assert.equal(firstOverlap(L.tree(bigMap('tree'))), null, 'nodi sovrapposti');
      });
      it('mantiene l\'ordine dei fratelli dall\'alto verso il basso', function () {
        var map = L.tree(bigMap('tree'));
        var kids = map.nodes[map.rootId].children;
        for (var i = 1; i < kids.length; i++) assert.ok(map.nodes[kids[i]].y > map.nodes[kids[i - 1]].y);
      });
    });

    describe('apply / nodi compressi / getBounds', function () {
      it('apply sceglie l\'algoritmo dalle impostazioni', function () {
        var map = bigMap('tree');
        assert.equal(JSON.stringify(L.apply(map)), JSON.stringify(L.tree(map)));
        map.settings.layout = 'radial';
        assert.equal(JSON.stringify(L.apply(map)), JSON.stringify(L.radial(map)));
      });
      it('i nodi compressi non occupano spazio', function () {
        var map = bigMap('tree');
        var first = map.nodes[map.rootId].children[0];
        var full = L.getBounds(L.tree(map));
        var collapsed = L.getBounds(L.tree(M.toggleCollapsed(map, first)));
        assert.ok(collapsed.maxY - collapsed.minY < full.maxY - full.minY);
      });
      it('getBounds contiene tutti i nodi visibili', function () {
        var map = L.radial(bigMap());
        var b = L.getBounds(map);
        M.getVisibleNodeIds(map).forEach(function (id) {
          var n = map.nodes[id];
          assert.ok(n.x >= b.minX && n.x <= b.maxX && n.y >= b.minY && n.y <= b.maxY);
        });
      });
      it('il layout non modifica la mappa originale', function () {
        var map = bigMap();
        var before = JSON.stringify(map);
        L.radial(map);
        L.tree(map);
        assert.equal(JSON.stringify(map), before);
      });
    });
  });
})();
