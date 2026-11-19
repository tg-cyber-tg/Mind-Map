/* Test di MM.templates */
(function () {
  'use strict';
  var M = MM.model;
  var T = MM.templates;

  describe('templates', function () {
    it('elenca i modelli previsti, con nome e descrizione', function () {
      var ids = T.list().map(function (t) { return t.id; });
      ['vuota', 'riassunto-capitolo', 'personaggio-storico', 'processo-scientifico', 'analisi-testo', 'confronto']
        .forEach(function (id) { assert.ok(ids.indexOf(id) >= 0, 'manca il modello ' + id); });
      T.list().forEach(function (t) {
        assert.ok(t.name && t.description && t.icon, 'dati mancanti in ' + t.id);
      });
    });

    T.list().forEach(function (t) {
      it('il modello "' + t.id + '" supera validate (anche dopo il layout)', function () {
        var map = T.create(t.id);
        var v = M.validate(map);
        assert.ok(v.ok, v.errors.join('; '));
        var laid = MM.layout.apply(map);
        assert.ok(M.validate(laid).ok);
      });
    });

    it('la mappa vuota ha solo il nodo centrale', function () {
      var map = T.create('vuota');
      assert.equal(Object.keys(map.nodes).length, 1);
      assert.equal(map.links.length, 0);
    });

    it('i modelli contengono idee e collegamenti con etichetta', function () {
      var map = T.create('personaggio-storico');
      assert.ok(Object.keys(map.nodes).length > 5);
      assert.ok(map.links.length >= 1);
      assert.ok(map.links[0].label.length > 0);
      assert.equal(map.title, map.nodes[map.rootId].text);
    });

    it('rispetta la disposizione indicata dal modello', function () {
      assert.equal(T.create('processo-scientifico').settings.layout, 'tree');
      assert.equal(T.create('analisi-testo').settings.layout, 'radial');
    });

    it('ogni creazione produce id nuovi', function () {
      var a = T.create('confronto');
      var b = T.create('confronto');
      assert.notEqual(a.id, b.id);
      assert.notEqual(a.rootId, b.rootId);
    });

    it('errore in italiano per un modello inesistente', function () {
      assert.throws(function () { T.create('inesistente'); }, /Modello non trovato/);
    });
  });
})();
