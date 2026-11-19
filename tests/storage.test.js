/* Test di MM.storage (backend in memoria: non tocca il localStorage reale) */
(function () {
  'use strict';
  var M = MM.model;
  var S = MM.storage;

  function fresh() {
    var b = S.createMemoryBackend();
    S.setBackend(b);
    return b;
  }

  function sampleMap(title) {
    var map = M.createMap(title || 'Il Medioevo');
    var r = M.addChild(map, map.rootId, 'Feudalesimo');
    map = r.map;
    var r2 = M.addChild(map, map.rootId, 'Chiesa');
    map = M.updateNode(r2.map, r2.nodeId, { icon: '⛪', note: 'Ruolo centrale', shape: 'rect' });
    map = M.addLink(map, r.nodeId, r2.nodeId, 'influenza').map;
    return map;
  }

  describe('storage', function () {
    describe('salvataggio nel browser', function () {
      it('salva, elenca e carica una mappa', function () {
        fresh();
        var map = sampleMap();
        var saved = S.saveMap(map);
        var list = S.listMaps();
        assert.equal(list.length, 1);
        assert.equal(list[0].id, map.id);
        assert.equal(list[0].title, 'Il Medioevo');
        var loaded = S.loadMap(map.id);
        assert.deepEqual(loaded.nodes, map.nodes);
        assert.equal(loaded.updatedAt, saved.updatedAt);
      });

      it('aggiorna updatedAt senza modificare la mappa originale', function () {
        fresh();
        var map = sampleMap();
        map.updatedAt = '2000-01-01T00:00:00.000Z';
        var saved = S.saveMap(map);
        assert.equal(map.updatedAt, '2000-01-01T00:00:00.000Z');
        assert.ok(saved.updatedAt > map.updatedAt);
      });

      it('risalvare la stessa mappa non crea doppioni nell\'elenco', function () {
        fresh();
        var map = sampleMap();
        S.saveMap(map);
        S.saveMap(M.updateNode(map, map.rootId, { text: 'Il Basso Medioevo' }));
        var list = S.listMaps();
        assert.equal(list.length, 1);
        assert.equal(list[0].title, 'Il Basso Medioevo');
      });

      it('elenca dalla mappa modificata più di recente', function () {
        fresh();
        ['A', 'B', 'C'].forEach(function (t, i) {
          var m = M.createMap(t);
          m.updatedAt = '2026-01-0' + (i === 1 ? 9 : i + 1) + 'T10:00:00.000Z';
          S.saveMap(m, { touch: false });
        });
        assert.deepEqual(S.listMaps().map(function (s) { return s.title; }), ['B', 'C', 'A']);
      });

      it('carica null per una mappa inesistente', function () {
        fresh();
        assert.equal(S.loadMap('m_inesistente'), null);
      });

      it('elimina una mappa e dimentica l\'ultima aperta', function () {
        fresh();
        var a = sampleMap('A');
        var b = sampleMap('B');
        S.saveMap(a);
        S.saveMap(b);
        S.setLastMapId(a.id);
        S.deleteMap(a.id);
        assert.equal(S.loadMap(a.id), null);
        assert.deepEqual(S.listMaps().map(function (s) { return s.id; }), [b.id]);
        assert.equal(S.getLastMapId(), null);
      });

      it('duplica una mappa con nuovo id e titolo "(copia)"', function () {
        fresh();
        var map = sampleMap();
        S.saveMap(map);
        var copy = S.duplicateMap(map.id);
        assert.notEqual(copy.id, map.id);
        assert.equal(copy.title, 'Il Medioevo (copia)');
        assert.deepEqual(copy.nodes, map.nodes);
        assert.equal(S.listMaps().length, 2);
      });

      it('ricorda l\'ultima mappa aperta', function () {
        fresh();
        S.setLastMapId('m_123');
        assert.equal(S.getLastMapId(), 'm_123');
      });

      it('ricostruisce l\'indice se è danneggiato', function () {
        var b = fresh();
        var map = sampleMap();
        S.saveMap(map);
        b.setItem(S.INDEX_KEY, '{non è json');
        assert.deepEqual(S.listMaps().map(function (s) { return s.id; }), [map.id]);
      });

      it('segnala una mappa salvata danneggiata', function () {
        var b = fresh();
        b.setItem(S.MAP_PREFIX + 'm_rotta', '{oops');
        assert.throws(function () { S.loadMap('m_rotta'); }, /danneggiata/);
      });

      it('spazio esaurito: errore comprensibile in italiano', function () {
        var b = fresh();
        b.setItem = function () {
          var e = new Error('quota');
          e.name = 'QuotaExceededError';
          throw e;
        };
        assert.throws(function () { S.saveMap(sampleMap()); }, /Spazio di archiviazione esaurito/);
      });

      it('il backend in memoria non è persistente', function () {
        fresh();
        assert.ok(!S.isPersistent());
      });
    });

    describe('file .mappa.json', function () {
      it('serialize → deserialize non perde dati', function () {
        fresh();
        var map = sampleMap();
        assert.deepEqual(S.deserialize(S.serialize(map)), map);
      });

      it('assegna un nuovo id se la mappa è già presente', function () {
        fresh();
        var map = sampleMap();
        S.saveMap(map);
        var back = S.deserialize(S.serialize(map));
        assert.notEqual(back.id, map.id);
        assert.deepEqual(back.nodes, map.nodes);
      });

      it('completa impostazioni e collegamenti mancanti', function () {
        fresh();
        var map = sampleMap();
        delete map.settings;
        delete map.links;
        var back = S.deserialize(JSON.stringify(map));
        assert.deepEqual(back.settings, M.DEFAULT_SETTINGS);
        assert.deepEqual(back.links, []);
      });

      it('JSON non valido → errore in italiano', function () {
        fresh();
        assert.throws(function () { S.deserialize('ciao, non sono json'); }, /non è leggibile/);
      });

      it('JSON che non è una mappa → errore in italiano', function () {
        fresh();
        assert.throws(function () { S.deserialize('{"a": 1}'); }, /non contiene una mappa/);
        assert.throws(function () { S.deserialize('[1, 2]'); }, /non contiene una mappa/);
      });

      it('versione errata → errore in italiano', function () {
        fresh();
        var map = sampleMap();
        map.version = 99;
        assert.throws(function () { S.deserialize(JSON.stringify(map)); }, /Versione del file non supportata/);
      });

      it('mappa incoerente → errore con il motivo', function () {
        fresh();
        var map = sampleMap();
        map.nodes[map.rootId].children.push('n_fantasma');
        assert.throws(function () { S.deserialize(JSON.stringify(map)); }, /mappa non valida.*inesistente/);
      });

      it('sanitizeFilename produce nomi di file sicuri', function () {
        assert.equal(S.sanitizeFilename('Storia: 1° capitolo / parte "A"?'), 'Storia 1° capitolo parte A');
        assert.equal(S.sanitizeFilename('   '), 'mappa');
        assert.equal(S.sanitizeFilename('...nascosto'), 'nascosto');
        assert.ok(S.sanitizeFilename(new Array(100).join('x')).length <= 60);
      });

      it('readFile legge un file di testo (asincrono)', function () {
        var file = new File(['{"ciao": "è"}'], 'prova.mappa.json', { type: 'application/json' });
        return S.readFile(file).then(function (text) {
          assert.equal(text, '{"ciao": "è"}');
        });
      });
    });

    describe('preferenze di accessibilità', function () {
      it('salva e rilegge tema, carattere, maiuscolo e grandezza (non il layout)', function () {
        fresh();
        assert.deepEqual(S.getPreferences(), {});
        S.setPreferences({ layout: 'tree', theme: 'alto-contrasto', uppercase: true, fontScale: 1.4, fontFamily: 'standard' });
        assert.deepEqual(S.getPreferences(), { theme: 'alto-contrasto', uppercase: true, fontScale: 1.4, fontFamily: 'standard' });
      });
      it('ignora valori non validi o dati danneggiati', function () {
        var b = fresh();
        b.setItem(S.PREFS_KEY, JSON.stringify({ theme: 'viola', uppercase: 'sì', fontScale: 9, fontFamily: 'x' }));
        assert.deepEqual(S.getPreferences(), { fontScale: 2 });
        b.setItem(S.PREFS_KEY, '{rotto');
        assert.deepEqual(S.getPreferences(), {});
      });
      it('le preferenze non compaiono tra le mappe salvate', function () {
        var b = fresh();
        S.setPreferences({ theme: 'scuro' });
        b.removeItem(S.INDEX_KEY);
        assert.equal(S.listMaps().length, 0);
      });
    });

    // Ripristina il backend predefinito per non influenzare altri test.
    it('ripristina il backend predefinito', function () {
      S.setBackend(null);
      assert.ok(true);
    });
  });
})();
