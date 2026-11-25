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

  describe('MM.sync – coworking (codici e mergeSharedMap)', function () {
    it('normalizeShareCode normalizza codici nudi, minuscoli, senza trattino e URL completi', function () {
      assert.equal(MM.sync.normalizeShareCode('abcd2345'), 'ABCD-2345');
      assert.equal(MM.sync.normalizeShareCode('  abCd-2345  '), 'ABCD-2345');
      assert.equal(MM.sync.normalizeShareCode('https://esempio.it/mappa/?condivisa=xy78-km92'), 'XY78-KM92');
      assert.equal(MM.sync.normalizeShareCode('https://esempio.it/?foo=1&condivisa=xy78km92#top'), 'XY78-KM92');
      assert.equal(MM.sync.normalizeShareCode(''), '');
      assert.equal(MM.sync.normalizeShareCode('ab'), '');
    });

    it('mergeSharedMap sceglie la versione con updatedAt più recente per campi di mappa e nodi', function () {
      var loc = fakeMap('sh1', '2026-05-01T10:00:00.000Z', 'Titolo locale');
      var rem = fakeMap('sh1', '2026-05-01T10:05:00.000Z', 'Titolo remoto');
      rem.settings.layout = 'tree';

      var merged = MM.sync.mergeSharedMap(loc, rem);
      assert.equal(MM.model.validate(merged).ok, true);
      assert.equal(merged.title, 'Titolo remoto');
      assert.equal(merged.settings.layout, 'tree');

      var locNewer = fakeMap('sh1', '2026-05-01T11:00:00.000Z', 'Locale più recente');
      var merged2 = MM.sync.mergeSharedMap(locNewer, rem);
      assert.equal(MM.model.validate(merged2).ok, true);
      assert.equal(merged2.title, 'Locale più recente');
    });

    it('mergeSharedMap preserva le modifiche sul nodo locale attivo se il remoto non lo ha eliminato', function () {
      var base = fakeMap('sh2', '2026-05-01T10:00:00.000Z', 'Base');
      var r1 = MM.model.addChild(base, base.rootId, 'Nodo A');
      var r2 = MM.model.addChild(r1.map, r1.map.rootId, 'Nodo B');

      var loc = MM.model.updateNode(r2.map, r1.nodeId, { text: 'Nodo A modificato da me', note: 'Appunto locale' });
      loc.updatedAt = '2026-05-01T10:00:10.000Z';

      var rem = MM.model.updateNode(r2.map, r2.nodeId, { text: 'Nodo B modificato dal collega' });
      rem.updatedAt = '2026-05-01T10:00:20.000Z';

      var merged = MM.sync.mergeSharedMap(loc, rem, { localDirtyNodeId: r1.nodeId });
      assert.equal(MM.model.validate(merged).ok, true);
      assert.equal(merged.nodes[r1.nodeId].text, 'Nodo A modificato da me');
      assert.equal(merged.nodes[r1.nodeId].note, 'Appunto locale');
      assert.equal(merged.nodes[r2.nodeId].text, 'Nodo B modificato dal collega');

      // Se il remoto elimina esplicitamente il nodo, non viene resuscitato.
      var remDel = MM.model.removeNode(rem, r1.nodeId);
      remDel.updatedAt = '2026-05-01T10:01:00.000Z';
      var mergedDel = MM.sync.mergeSharedMap(loc, remDel, { localDirtyNodeId: r1.nodeId });
      assert.equal(MM.model.validate(mergedDel).ok, true);
      assert.equal(mergedDel.nodes[r1.nodeId], undefined);
    });

    it('mergeSharedMap rimuove campi opzionali azzerati sul nodo dirty e rispetta preferRemote', function () {
      var base = fakeMap('sh2b', '2026-05-01T10:00:00.000Z', 'Base');
      var r1 = MM.model.addChild(base, base.rootId, 'Nodo A');
      var withComment = MM.model.updateNode(r1.map, r1.nodeId, { comment: 'Vecchio commento', fillColor: '#ffe0e0' });

      var locCleared = MM.model.clone(withComment);
      delete locCleared.nodes[r1.nodeId].comment;
      delete locCleared.nodes[r1.nodeId].fillColor;
      locCleared.updatedAt = '2026-05-01T10:05:00.000Z';

      var remOlder = MM.model.updateNode(withComment, withComment.rootId, { text: 'Titolo remoto' });
      remOlder.updatedAt = '2026-05-01T10:01:00.000Z';

      var merged = MM.sync.mergeSharedMap(locCleared, remOlder, { localDirtyNodeId: r1.nodeId, preferRemote: true });
      assert.equal(MM.model.validate(merged).ok, true);
      assert.equal(merged.title, 'Titolo remoto');
      assert.equal(merged.nodes[r1.nodeId].comment, undefined);
      assert.equal(merged.nodes[r1.nodeId].fillColor, undefined);
    });

    it('mergeSharedMap preserva nodi aggiunti contemporaneamente da entrambi entro pochi secondi', function () {
      var base = fakeMap('sh3', '2026-05-01T10:00:00.000Z', 'Mappa condivisa');
      var locRes = MM.model.addChild(base, base.rootId, 'Idea di Alice');
      locRes.map.updatedAt = '2026-05-01T10:00:01.000Z';
      var remRes = MM.model.addChild(base, base.rootId, 'Idea di Bob');
      remRes.map.updatedAt = '2026-05-01T10:00:02.000Z';

      var merged = MM.sync.mergeSharedMap(locRes.map, remRes.map);
      assert.equal(MM.model.validate(merged).ok, true);
      assert.ok(merged.nodes[locRes.nodeId]);
      assert.ok(merged.nodes[remRes.nodeId]);
      assert.equal(merged.nodes[locRes.nodeId].text, 'Idea di Alice');
      assert.equal(merged.nodes[remRes.nodeId].text, 'Idea di Bob');
    });

    it('mergeSharedMap fa fallback pulito sulla mappa valida se una delle due non è valida', function () {
      var valid = fakeMap('sh4', '2026-05-01T10:00:00.000Z', 'Valida');
      var invalid = { id: 'sh4', rootId: 'inesistente', nodes: {} };

      var m1 = MM.sync.mergeSharedMap(valid, invalid);
      assert.equal(MM.model.validate(m1).ok, true);
      assert.equal(m1.title, 'Valida');

      var m2 = MM.sync.mergeSharedMap(invalid, valid);
      assert.equal(MM.model.validate(m2).ok, true);
      assert.equal(m2.title, 'Valida');

      assert.equal(MM.sync.mergeSharedMap(invalid, null), null);
    });

    it('resolveRoleForUser determina correttamente owner, roles[uid], inviti email (case-insensitive) e defaultRole', function () {
      assert.equal(MM.sync.resolveRoleForUser(null, 'u1', 'a@b.it'), 'viewer');
      assert.equal(MM.sync.resolveRoleForUser({ ownerId: 'u1' }, '', 'a@b.it'), 'viewer');

      var doc = {
        ownerId: 'owner-1',
        defaultRole: 'viewer',
        roles: {
          'u-ed': 'editor',
          'u-vw': 'viewer'
        },
        invites: [
          { email: 'alice@esempio.it', role: 'viewer' },
          { email: 'bob@esempio.it', role: 'editor' }
        ]
      };

      assert.equal(MM.sync.resolveRoleForUser(doc, 'owner-1', 'owner@esempio.it'), 'owner');
      assert.equal(MM.sync.resolveRoleForUser(doc, 'u-ed', 'alice@esempio.it'), 'editor');
      assert.equal(MM.sync.resolveRoleForUser(doc, 'u-vw', 'bob@esempio.it'), 'viewer');
      assert.equal(MM.sync.resolveRoleForUser(doc, 'u-new-1', '  ALICE@Esempio.IT '), 'viewer');
      assert.equal(MM.sync.resolveRoleForUser(doc, 'u-new-2', 'Bob@Esempio.it'), 'editor');
      assert.equal(MM.sync.resolveRoleForUser(doc, 'u-other', 'altro@esempio.it'), 'viewer');
      assert.equal(MM.sync.resolveRoleForUser({ ownerId: 'owner-1', defaultRole: 'editor' }, 'u-other', ''), 'editor');
      assert.equal(MM.sync.resolveRoleForUser({ ownerId: 'owner-1' }, 'u-other', ''), 'editor');
    });

    it('isReadOnly restituisce false quando nessuna sessione condivisa è attiva', function () {
      assert.equal(MM.sync.isReadOnly(), false);
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
