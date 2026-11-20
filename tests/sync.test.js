/* Test della logica pura di sincronizzazione (MM.sync) e delle icone SVG (MM.icons). */
(function () {
  'use strict';

  function fakeMap(id, updatedAt, title) {
    var m = MM.model.createMap(title || ('Mappa ' + id));
    m.id = id;
    m.updatedAt = updatedAt;
    return m;
  }

  describe('MM.sync – configurazione Firebase', function () {
    it('riconosce configurazioni valide e non valide', function () {
      assert.equal(MM.sync.isValidConfig(null), false);
      assert.equal(MM.sync.isValidConfig({}), false);
      assert.equal(MM.sync.isValidConfig({ apiKey: 'short', authDomain: 'a.firebaseapp.com', projectId: 'p1' }), false);
      assert.equal(MM.sync.isValidConfig({
        apiKey: 'AIzaSyFakeKey123456',
        authDomain: 'mia-app.firebaseapp.com',
        projectId: 'mia-app'
      }), true);
    });

    it('parseConfig accetta sia JSON puro che snippet JavaScript della console Firebase', function () {
      var json = '{"apiKey": "AIzaSyFakeKey123456", "authDomain": "mia.firebaseapp.com", "projectId": "mia-app", "appId": "1:123:web:abc"}';
      var parsedJson = MM.sync.parseConfig(json);
      assert.ok(parsedJson);
      assert.equal(parsedJson.projectId, 'mia-app');
      assert.equal(parsedJson.appId, '1:123:web:abc');

      var snippet = [
        'const firebaseConfig = {',
        '  // configurazione copiata dalla console',
        "  apiKey: 'AIzaSyFakeKey123456',",
        "  authDomain: 'mia.firebaseapp.com',",
        "  projectId: 'mia-app',",
        '};'
      ].join('\n');
      var parsedJs = MM.sync.parseConfig(snippet);
      assert.ok(parsedJs);
      assert.equal(parsedJs.apiKey, 'AIzaSyFakeKey123456');
      assert.equal(parsedJs.authDomain, 'mia.firebaseapp.com');
      assert.equal(parsedJs.projectId, 'mia-app');

      assert.equal(MM.sync.parseConfig('testo non valido'), null);
    });
  });

  describe('MM.sync – reconcile (merge offline-first)', function () {
    it('carica sul cloud le mappe presenti solo in locale', function () {
      var m1 = fakeMap('m1', '2026-01-01T10:00:00.000Z');
      var plan = MM.sync.reconcile([m1], [], {});
      assert.equal(plan.toUpload.length, 1);
      assert.equal(plan.toUpload[0].id, 'm1');
      assert.equal(plan.toSaveLocal.length, 0);
      assert.equal(plan.toDeleteCloud.length, 0);
      assert.equal(plan.toDeleteLocal.length, 0);
    });

    it('salva in locale le mappe presenti solo sul cloud', function () {
      var m2 = fakeMap('m2', '2026-01-01T10:00:00.000Z');
      var plan = MM.sync.reconcile([], [{ id: 'm2', updatedAt: m2.updatedAt, deletedAt: null, data: m2 }], {});
      assert.equal(plan.toSaveLocal.length, 1);
      assert.equal(plan.toSaveLocal[0].id, 'm2');
      assert.equal(plan.toUpload.length, 0);
    });

    it('in caso di conflitto vince la versione con updatedAt più recente', function () {
      var locNew = fakeMap('a', '2026-01-02T12:00:00.000Z', 'Locale recente');
      var remOld = fakeMap('a', '2026-01-01T12:00:00.000Z', 'Remota vecchia');

      var locOld = fakeMap('b', '2026-01-01T12:00:00.000Z', 'Locale vecchia');
      var remNew = fakeMap('b', '2026-01-03T12:00:00.000Z', 'Remota recente');

      var sameL = fakeMap('c', '2026-01-02T12:00:00.000Z', 'Uguale');
      var sameR = fakeMap('c', '2026-01-02T12:00:00.000Z', 'Uguale');

      var plan = MM.sync.reconcile(
        [locNew, locOld, sameL],
        [
          { id: 'a', updatedAt: remOld.updatedAt, deletedAt: null, data: remOld },
          { id: 'b', updatedAt: remNew.updatedAt, deletedAt: null, data: remNew },
          { id: 'c', updatedAt: sameR.updatedAt, deletedAt: null, data: sameR }
        ],
        {}
      );
      assert.deepEqual(plan.toUpload.map(function (m) { return m.id; }), ['a']);
      assert.deepEqual(plan.toSaveLocal.map(function (m) { return m.id; }), ['b']);
    });

    it('propaga al cloud una eliminazione locale più recente della versione remota', function () {
      var rem = fakeMap('del1', '2026-01-01T10:00:00.000Z');
      var plan = MM.sync.reconcile(
        [],
        [{ id: 'del1', updatedAt: rem.updatedAt, deletedAt: null, data: rem }],
        { del1: '2026-01-02T08:00:00.000Z' }
      );
      assert.equal(plan.toDeleteCloud.length, 1);
      assert.equal(plan.toDeleteCloud[0].id, 'del1');
      assert.equal(plan.toSaveLocal.length, 0);
    });

    it('propaga in locale una eliminazione remota (tombstone)', function () {
      var loc = fakeMap('del2', '2026-01-01T10:00:00.000Z');
      var plan = MM.sync.reconcile(
        [loc],
        [{ id: 'del2', updatedAt: '2026-01-02T09:00:00.000Z', deletedAt: '2026-01-02T09:00:00.000Z', data: null }],
        {}
      );
      assert.deepEqual(plan.toDeleteLocal, ['del2']);
      assert.equal(plan.toUpload.length, 0);
    });

    it('ripristina sul cloud una mappa modificata localmente dopo la sua eliminazione remota', function () {
      var locEdited = fakeMap('rev1', '2026-01-05T15:00:00.000Z', 'Modificata dopo');
      var plan = MM.sync.reconcile(
        [locEdited],
        [{ id: 'rev1', updatedAt: '2026-01-02T09:00:00.000Z', deletedAt: '2026-01-02T09:00:00.000Z', data: null }],
        {}
      );
      assert.equal(plan.toUpload.length, 1);
      assert.equal(plan.toUpload[0].id, 'rev1');
      assert.equal(plan.toDeleteLocal.length, 0);
    });
  });

  describe('MM.icons – simboli vettoriali', function () {
    it('riconosce correttamente il prefisso svg:<id> rispetto alle emoji', function () {
      assert.equal(MM.icons.isVectorIcon('svg:lightbulb'), true);
      assert.equal(MM.icons.vectorId('svg:lightbulb'), 'lightbulb');
      assert.ok(MM.icons.nodePaths('lightbulb'));

      assert.equal(MM.icons.isVectorIcon('svg:inesistente'), false);
      assert.equal(MM.icons.vectorId('svg:inesistente'), null);
      assert.equal(MM.icons.isVectorIcon('💡'), false);
      assert.equal(MM.icons.vectorId('💡'), null);
      assert.equal(MM.icons.isVectorIcon(''), false);
    });

    it('il modello accetta simboli svg:<id> nel campo icon del nodo', function () {
      var m = MM.model.createMap('Test icone');
      var m2 = MM.model.updateNode(m, m.rootId, { icon: 'svg:star' });
      assert.equal(m2.nodes[m.rootId].icon, 'svg:star');
      assert.equal(MM.model.validate(m2).ok, true);
    });
  });
})();
