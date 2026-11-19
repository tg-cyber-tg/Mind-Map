/* Test di MM.model */
(function () {
  'use strict';
  var M = MM.model;

  /** Mappa di prova: radice → A (→ A1, A2), B */
  function sample() {
    var map = M.createMap('Il Sole');
    var r = M.addChild(map, map.rootId, 'A'); map = r.map; var a = r.nodeId;
    r = M.addChild(map, map.rootId, 'B'); map = r.map; var b = r.nodeId;
    r = M.addChild(map, a, 'A1'); map = r.map; var a1 = r.nodeId;
    r = M.addChild(map, a, 'A2'); map = r.map; var a2 = r.nodeId;
    return { map: map, a: a, b: b, a1: a1, a2: a2 };
  }
  window.MMTestSample = sample;

  describe('model', function () {
    describe('createMap', function () {
      it('crea una mappa valida con il solo nodo centrale', function () {
        var map = M.createMap('Storia');
        assert.equal(map.title, 'Storia');
        assert.equal(Object.keys(map.nodes).length, 1);
        assert.equal(map.nodes[map.rootId].parentId, null);
        assert.equal(map.nodes[map.rootId].text, 'Storia');
        assert.deepEqual(map.links, []);
        assert.ok(M.validate(map).ok, M.validate(map).errors.join('; '));
      });
      it('usa titolo e impostazioni predefiniti', function () {
        var map = M.createMap();
        assert.equal(map.title, 'Nuova mappa');
        assert.deepEqual(map.settings, M.DEFAULT_SETTINGS);
      });
      it('genera id univoci', function () {
        var seen = {};
        for (var i = 0; i < 2000; i++) {
          var id = M.uid('n');
          assert.ok(!seen[id], 'id duplicato ' + id);
          seen[id] = true;
        }
      });
    });

    describe('addChild / addSibling', function () {
      it('aggiunge figli con colori diversi ai rami di primo livello', function () {
        var s = sample();
        assert.deepEqual(s.map.nodes[s.map.rootId].children, [s.a, s.b]);
        assert.notEqual(s.map.nodes[s.a].color, s.map.nodes[s.b].color);
      });
      it('i sotto-nodi ereditano il colore del ramo', function () {
        var s = sample();
        assert.equal(s.map.nodes[s.a1].color, s.map.nodes[s.a].color);
        assert.equal(s.map.nodes[s.a1].parentId, s.a);
      });
      it('il fratello viene inserito subito dopo il nodo', function () {
        var s = sample();
        var r = M.addSibling(s.map, s.a1, 'A1bis');
        assert.deepEqual(r.map.nodes[s.a].children, [s.a1, r.nodeId, s.a2]);
        assert.equal(r.map.nodes[r.nodeId].parentId, s.a);
      });
      it('un fratello della radice diventa un figlio della radice', function () {
        var map = M.createMap('X');
        var r = M.addSibling(map, map.rootId, 'Y');
        assert.equal(r.map.nodes[r.nodeId].parentId, map.rootId);
      });
      it('aggiungere un figlio espande un nodo compresso', function () {
        var s = sample();
        var map = M.toggleCollapsed(s.map, s.a);
        assert.equal(map.nodes[s.a].collapsed, true);
        map = M.addChild(map, s.a, 'A3').map;
        assert.equal(map.nodes[s.a].collapsed, false);
      });
      it('lancia un errore se il genitore non esiste', function () {
        assert.throws(function () { M.addChild(M.createMap(), 'inesistente'); }, /Nodo non trovato/);
      });
    });

    describe('updateNode', function () {
      it('aggiorna testo, colore, forma, icona e nota', function () {
        var s = sample();
        var map = M.updateNode(s.map, s.a, { text: 'Fotosfera', color: '#123456', shape: 'rect', icon: '☀️', note: 'Superficie' });
        var n = map.nodes[s.a];
        assert.deepEqual([n.text, n.color, n.shape, n.icon, n.note], ['Fotosfera', '#123456', 'rect', '☀️', 'Superficie']);
      });
      it('ignora id, parentId e children', function () {
        var s = sample();
        var map = M.updateNode(s.map, s.a, { id: 'x', parentId: 'y', children: [] });
        assert.equal(map.nodes[s.a].id, s.a);
        assert.equal(map.nodes[s.a].children.length, 2);
      });
      it('tronca il testo a MAX_TEXT caratteri', function () {
        var s = sample();
        var map = M.updateNode(s.map, s.a, { text: new Array(300).join('x') });
        assert.equal(map.nodes[s.a].text.length, M.MAX_TEXT);
      });
      it('rifiuta colori e forme non validi', function () {
        var s = sample();
        assert.throws(function () { M.updateNode(s.map, s.a, { color: 'rosso' }); }, /Colore non valido/);
        assert.throws(function () { M.updateNode(s.map, s.a, { shape: 'stella' }); }, /Forma non valida/);
      });
      it('il testo del nodo centrale aggiorna il titolo', function () {
        var s = sample();
        assert.equal(M.updateNode(s.map, s.map.rootId, { text: 'La Luna' }).title, 'La Luna');
      });
    });

    describe('removeNode', function () {
      it('rimuove il nodo e tutto il suo sottoalbero', function () {
        var s = sample();
        var map = M.removeNode(s.map, s.a);
        assert.ok(!map.nodes[s.a] && !map.nodes[s.a1] && !map.nodes[s.a2]);
        assert.deepEqual(map.nodes[map.rootId].children, [s.b]);
        assert.ok(M.validate(map).ok);
      });
      it('rimuove i collegamenti che coinvolgono nodi eliminati', function () {
        var s = sample();
        var map = M.addLink(s.map, s.a1, s.b, 'causa').map;
        assert.equal(M.removeNode(map, s.a).links.length, 0);
      });
      it('non permette di eliminare il nodo centrale', function () {
        var s = sample();
        assert.throws(function () { M.removeNode(s.map, s.map.rootId); }, /nodo centrale/);
      });
    });

    describe('moveNode / reparent', function () {
      it('sposta il nodo insieme ai discendenti', function () {
        var s = sample();
        var a = s.map.nodes[s.a];
        var a1 = s.map.nodes[s.a1];
        var map = M.moveNode(s.map, s.a, a.x + 100, a.y - 50);
        assert.equal(map.nodes[s.a1].x, a1.x + 100);
        assert.equal(map.nodes[s.a1].y, a1.y - 50);
      });
      it('con withSubtree=false sposta solo il nodo', function () {
        var s = sample();
        var a1 = s.map.nodes[s.a1];
        assert.equal(M.moveNode(s.map, s.a, 999, 999, false).nodes[s.a1].x, a1.x);
      });
      it('cambia genitore e adotta il colore del nuovo ramo', function () {
        var s = sample();
        var map = M.reparent(s.map, s.a2, s.b);
        assert.deepEqual(map.nodes[s.a].children, [s.a1]);
        assert.deepEqual(map.nodes[s.b].children, [s.a2]);
        assert.equal(map.nodes[s.a2].color, map.nodes[s.b].color);
        assert.ok(M.validate(map).ok);
      });
      it('vieta di spostare un nodo dentro sé stesso o un suo discendente', function () {
        var s = sample();
        assert.throws(function () { M.reparent(s.map, s.a, s.a1); }, /sotto-ramo/);
        assert.throws(function () { M.reparent(s.map, s.a, s.a); }, /sotto-ramo/);
      });
    });

    describe('collegamenti', function () {
      it('aggiunge, modifica ed elimina un collegamento', function () {
        var s = sample();
        var r = M.addLink(s.map, s.a1, s.b, 'causa');
        assert.equal(r.map.links.length, 1);
        var map = M.updateLink(r.map, r.linkId, { label: 'provoca' });
        assert.equal(map.links[0].label, 'provoca');
        assert.equal(M.removeLink(map, r.linkId).links.length, 0);
      });
      it('rifiuta auto-collegamenti e duplicati (anche invertiti)', function () {
        var s = sample();
        assert.throws(function () { M.addLink(s.map, s.a, s.a); }, /sé stesso/);
        var map = M.addLink(s.map, s.a, s.b).map;
        assert.throws(function () { M.addLink(map, s.a, s.b); }, /già collegati/);
        assert.throws(function () { M.addLink(map, s.b, s.a); }, /già collegati/);
      });
    });

    describe('consultazione', function () {
      it('getVisibleNodeIds esclude i discendenti dei nodi compressi', function () {
        var s = sample();
        assert.equal(M.getVisibleNodeIds(s.map).length, 5);
        var ids = M.getVisibleNodeIds(M.toggleCollapsed(s.map, s.a));
        assert.equal(ids.length, 3);
        assert.ok(ids.indexOf(s.a) >= 0 && ids.indexOf(s.a1) < 0);
      });
      it('getDescendants e getDepth', function () {
        var s = sample();
        assert.deepEqual(M.getDescendants(s.map, s.a), [s.a1, s.a2]);
        assert.equal(M.getDepth(s.map, s.map.rootId), 0);
        assert.equal(M.getDepth(s.map, s.a2), 2);
      });
      it('toOutline produce uno schema indentato', function () {
        var s = sample();
        var map = M.updateNode(s.map, s.a, { icon: '☀️' });
        assert.equal(M.toOutline(map), 'Il Sole\n  - ☀️ A\n    - A1\n    - A2\n  - B');
      });
    });

    describe('textColorFor', function () {
      it('testo nero su sfondi chiari, bianco su sfondi scuri', function () {
        assert.equal(M.textColorFor('#FFFFFF'), '#000000');
        assert.equal(M.textColorFor('#FFD54F'), '#000000');
        assert.equal(M.textColorFor('#000000'), '#FFFFFF');
        assert.equal(M.textColorFor('#1A237E'), '#FFFFFF');
      });
    });

    describe('validate', function () {
      it('accetta una mappa corretta', function () {
        var r = M.validate(sample().map);
        assert.ok(r.ok, r.errors.join('; '));
      });
      it('rileva figli inesistenti e genitori incoerenti', function () {
        var s = sample();
        var bad = M.clone(s.map);
        bad.nodes[s.a].children.push('fantasma');
        assert.ok(!M.validate(bad).ok);
        bad = M.clone(s.map);
        bad.nodes[s.a1].parentId = s.b;
        assert.ok(!M.validate(bad).ok);
      });
      it('rileva cicli, versioni errate e dati non validi', function () {
        var s = sample();
        var bad = M.clone(s.map);
        bad.nodes[s.a1].children.push(s.a);
        bad.nodes[s.a].parentId = s.a1;
        assert.ok(!M.validate(bad).ok, 'ciclo non rilevato');
        bad = M.clone(s.map); bad.version = 99;
        assert.ok(!M.validate(bad).ok, 'versione non rilevata');
        bad = M.clone(s.map); bad.nodes[s.b].color = 'blu';
        assert.ok(!M.validate(bad).ok, 'colore non rilevato');
        assert.ok(!M.validate(null).ok);
        assert.ok(!M.validate({ version: 1 }).ok);
      });
      it('rileva collegamenti verso nodi inesistenti', function () {
        var bad = M.clone(sample().map);
        bad.links.push({ id: 'l1', fromId: bad.rootId, toId: 'nessuno', label: '' });
        assert.ok(!M.validate(bad).ok);
      });
    });

    describe('immutabilità', function () {
      it('nessuna operazione modifica la mappa originale', function () {
        var s = sample();
        var before = JSON.stringify(s.map);
        M.addChild(s.map, s.a, 'Z');
        M.addSibling(s.map, s.a1, 'Z');
        M.updateNode(s.map, s.a, { text: 'Z', color: '#000000' });
        M.removeNode(s.map, s.a);
        M.moveNode(s.map, s.a, 5, 5);
        M.reparent(s.map, s.a2, s.b);
        M.toggleCollapsed(s.map, s.a);
        M.addLink(s.map, s.a, s.b, 'x');
        assert.equal(JSON.stringify(s.map), before);
      });
    });
  });
})();
