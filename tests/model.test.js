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

    describe('cloneSubtree', function () {
      it('duplica sottoalbero con id nuovi, proprietà, figli e collegamenti interni senza mutare l\'originale', function () {
        var s = sample();
        var map = M.updateNode(s.map, s.a, { note: 'Nota A', shape: 'rect', boxSize: 'L', bold: true, fontName: 'Georgia' });
        map = M.addLink(map, s.a1, s.a2, 'interno').map;
        map = M.addLink(map, s.a1, s.b, 'esterno').map;
        var before = JSON.stringify(map);

        var res = M.cloneSubtree(map, s.a, s.b);
        assert.equal(JSON.stringify(map), before);
        assert.ok(M.validate(res.map).ok, M.validate(res.map).errors.join('; '));
        assert.notEqual(res.nodeId, s.a);

        var clonedA = res.map.nodes[res.nodeId];
        assert.equal(clonedA.parentId, s.b);
        assert.equal(clonedA.text, 'A');
        assert.equal(clonedA.note, 'Nota A');
        assert.equal(clonedA.shape, 'rect');
        assert.equal(clonedA.boxSize, 'L');
        assert.equal(clonedA.bold, true);
        assert.equal(clonedA.fontName, 'Georgia');
        assert.equal(clonedA.children.length, 2);
        assert.notEqual(clonedA.children[0], s.a1);
        assert.notEqual(clonedA.children[1], s.a2);
        assert.equal(res.map.nodes[clonedA.children[0]].text, 'A1');
        assert.equal(res.map.nodes[clonedA.children[1]].text, 'A2');
        // Collegamento interno clonato, esterno no (totale: 2 originali + 1 clonato = 3).
        assert.equal(res.map.links.length, 3);
        var clonedLink = res.map.links[2];
        assert.equal(clonedLink.fromId, clonedA.children[0]);
        assert.equal(clonedLink.toId, clonedA.children[1]);
        assert.equal(clonedLink.label, 'interno');

        // Clonare dentro un discendente del sottoalbero sorgente resta valido (nessun ciclo).
        var selfClone = M.cloneSubtree(map, s.a, s.a1);
        assert.ok(M.validate(selfClone.map).ok, M.validate(selfClone.map).errors.join('; '));
        assert.equal(selfClone.map.nodes[selfClone.nodeId].parentId, s.a1);
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
      it('inverte la direzione senza toccare l\'originale', function () {
        var s = sample();
        var r = M.addLink(s.map, s.a1, s.b, 'causa');
        var map = M.reverseLink(r.map, r.linkId);
        assert.equal(map.links[0].fromId, s.b);
        assert.equal(map.links[0].toId, s.a1);
        assert.equal(map.links[0].label, 'causa');
        assert.equal(r.map.links[0].fromId, s.a1);
        assert.ok(M.validate(map).ok);
      });
      it('elenca i collegamenti di un nodo (in entrata e in uscita)', function () {
        var s = sample();
        var map = M.addLink(s.map, s.a1, s.b, 'x').map;
        map = M.addLink(map, s.a2, s.a1, 'y').map;
        assert.equal(M.getLinksOf(map, s.a1).length, 2);
        assert.equal(M.getLinksOf(map, s.b).length, 1);
        assert.equal(M.getLinksOf(map, s.a).length, 0);
      });
      it('etichetta limitata a MAX_TEXT caratteri', function () {
        var s = sample();
        var r = M.addLink(s.map, s.a, s.b, new Array(300).join('x'));
        assert.equal(r.map.links[0].label.length, M.MAX_TEXT);
      });
      it('errore per un collegamento inesistente', function () {
        var s = sample();
        assert.throws(function () { M.reverseLink(s.map, 'l_nessuno'); }, /non trovato/);
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
      it('rifiuta URL esterni, SVG data URL e colori opzionali non validi in nodi e riepiloghi', function () {
        var s = sample();
        var badUrl = M.clone(s.map);
        badUrl.nodes[s.a].images = [{ src: 'https://evil.example/pixel.png', w: 100, h: 100 }];
        assert.ok(!M.validate(badUrl).ok, 'URL esterno non bloccato');

        var badSvg = M.clone(s.map);
        badSvg.nodes[s.a].image = 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=';
        assert.ok(!M.validate(badSvg).ok, 'SVG data URL non bloccato');

        var badFill = M.clone(s.map);
        badFill.nodes[s.a].fillColor = 'red;background:url(x)';
        assert.ok(!M.validate(badFill).ok, 'fillColor non valido non bloccato');

        var good = M.clone(s.map);
        good.nodes[s.a].images = [{ src: 'data:image/png;base64,iVBORw0KGgo=', w: 100, h: 100 }];
        good.nodes[s.a].fillColor = '#EFF6FF';
        good.nodes[s.a].textColor = '#0F172A';
        assert.ok(M.validate(good).ok, 'mappa sicura rifiutata');
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

    describe('grandezza casella e immagini', function () {
      it('boxScaleFor: più grande vicino al centro (-5% per livello), disattivabile', function () {
        var s = sample();
        var root = s.map.nodes[s.map.rootId], a = s.map.nodes[s.a], a1 = s.map.nodes[s.a1];
        var st = s.map.settings;
        var s0 = M.boxScaleFor(root, st, 0);
        var s1 = M.boxScaleFor(a, st, 1);
        var s2 = M.boxScaleFor(a1, st, 2);
        assert.ok(s0 > s1);
        assert.ok(s1 > s2);
        assert.equal(s0, 1.20);
        assert.ok(Math.abs(s1 - s0 * 0.95) < 1e-9);
        assert.ok(Math.abs(s2 - s0 * 0.90) < 1e-9);
        var off = { sizeByLevel: false };
        assert.equal(M.boxScaleFor(root, off, 0), 1.20);
        assert.equal(M.boxScaleFor(a, off, 1), M.boxScaleFor(a1, off, 2));
        assert.equal(M.boxScaleFor(a, off, 1), 1);
      });
      it('updateNode boxSize: valida, Normale rimuove il campo', function () {
        var s = sample();
        var m = M.updateNode(s.map, s.a, { boxSize: 'XL' });
        assert.equal(m.nodes[s.a].boxSize, 'XL');
        assert.ok(M.boxScaleFor(m.nodes[s.a], m.settings, 1) > M.boxScaleFor(s.map.nodes[s.a], m.settings, 1));
        m = M.updateNode(m, s.a, { boxSize: 'M' });
        assert.equal(m.nodes[s.a].boxSize, undefined);
      });
      it('updateNode image: accetta data URL, rifiuta altro, rimuove', function () {
        var s = sample();
        var url = 'data:image/png;base64,iVBORw0KGgo=';
        var m = M.updateNode(s.map, s.a, { image: url, imageW: 300, imageH: 150 });
        assert.equal(m.nodes[s.a].image, url);
        var box = M.imageBoxFor(m.nodes[s.a], 1);
        assert.ok(box.width > box.height);
        assert.throws(function () { M.updateNode(s.map, s.a, { image: 'javascript:alert(1)', imageW: 1, imageH: 1 }); });
        m = M.updateNode(m, s.a, { image: null });
        assert.equal(m.nodes[s.a].image, undefined);
        assert.equal(M.imageBoxFor(m.nodes[s.a], 1), null);
      });
      it('updateNode images: più immagini nella stessa casella, griglia e rimozione', function () {
        var s = sample();
        var url = 'data:image/webp;base64,UklGRh4AAABXRUJQVlA4TBEAAAAvAAAAAAfQ//73v/+BiOh/AAA=';
        var m = M.updateNode(s.map, s.a, {
          images: [
            { src: url, w: 300, h: 200 },
            { src: url, w: 200, h: 200 },
            { src: url, w: 250, h: 180 }
          ]
        });
        assert.equal(M.nodeImagesOf(m.nodes[s.a]).length, 3);
        var box = M.imageBoxFor(m.nodes[s.a], 1);
        assert.equal(box.items.length, 3);
        assert.ok(box.width > 200);
        m = M.updateNode(m, s.a, { images: null });
        assert.equal(M.nodeImagesOf(m.nodes[s.a]).length, 0);
        assert.equal(M.imageBoxFor(m.nodes[s.a], 1), null);
      });
    });

    describe('forma cerchio, commenti, confronto e stile collegamenti', function () {
      it('accetta shape circle e comment (imposta e rimuove)', function () {
        var s = sample();
        var m = M.updateNode(s.map, s.a, { shape: 'circle', comment: 'Da ripassare!' });
        assert.equal(m.nodes[s.a].shape, 'circle');
        assert.equal(m.nodes[s.a].comment, 'Da ripassare!');
        assert.ok(M.validate(m).ok, M.validate(m).errors.join('; '));
        m = M.updateNode(m, s.a, { comment: '   ' });
        assert.equal(m.nodes[s.a].comment, undefined);
      });
      it('gestisce subLayout valido, ignora non valido e rimuove se vuoto', function () {
        var s = sample();
        var m = M.updateNode(s.map, s.a, { subLayout: 'org' });
        assert.equal(m.nodes[s.a].subLayout, 'org');
        m = M.updateNode(m, s.a, { subLayout: 'compare' });
        assert.equal(m.nodes[s.a].subLayout, 'org');
        m = M.updateNode(m, s.a, { subLayout: '' });
        assert.equal(m.nodes[s.a].subLayout, undefined);
      });
      it('layout compare: valido e boxScaleFor dà 1.20 a depth 1 e -5% a depth 2', function () {
        var s = sample();
        var m = M.clone(s.map);
        m.settings.layout = 'compare';
        assert.ok(M.validate(m).ok, M.validate(m).errors.join('; '));
        var a = m.nodes[s.a];
        var a1 = m.nodes[s.a1];
        assert.equal(M.boxScaleFor(a, m.settings, 1), 1.20);
        assert.ok(Math.abs(M.boxScaleFor(a1, m.settings, 2) - 1.20 * 0.95) < 1e-9);
      });
      it('updateLink gestisce style e curve (clamping, azzeramento e cloneSubtree)', function () {
        var s = sample();
        var r = M.addLink(s.map, s.a1, s.a2, 'rel');
        var m = M.updateLink(r.map, r.linkId, { style: 'elbow', curve: 450 });
        assert.equal(m.links[0].style, 'elbow');
        assert.equal(m.links[0].curve, 300);
        var cloned = M.cloneSubtree(m, s.a, s.b);
        assert.equal(cloned.map.links.length, 2);
        assert.equal(cloned.map.links[1].style, 'elbow');
        assert.equal(cloned.map.links[1].curve, 300);
        m = M.updateLink(m, r.linkId, { style: 'curved', curve: 0 });
        assert.equal(m.links[0].style, undefined);
        assert.equal(m.links[0].curve, 0);
        m = M.updateLink(m, r.linkId, { curve: '' });
        assert.equal(m.links[0].curve, undefined);
        m = M.updateLink(m, r.linkId, { style: 'straight', curve: -500 });
        assert.equal(m.links[0].style, 'straight');
        assert.equal(m.links[0].curve, -300);
        m = M.updateLink(m, r.linkId, { curve: null });
        assert.equal(m.links[0].curve, undefined);
      });
    });

    describe('elenchi puntati, allineamento, riempimento pastello e numerazione argomenti', function () {
      it('updateNode gestisce bullets, textAlign e fillColor', function () {
        var s = sample();
        var m = M.updateNode(s.map, s.a, { bullets: true, textAlign: 'left', fillColor: '#EFF6FF' });
        assert.equal(m.nodes[s.a].bullets, true);
        assert.equal(m.nodes[s.a].textAlign, 'left');
        assert.equal(m.nodes[s.a].fillColor, '#EFF6FF');

        m = M.updateNode(m, s.a, { textAlign: 'right' });
        assert.equal(m.nodes[s.a].textAlign, 'right');
        m = M.updateNode(m, s.a, { textAlign: 'justify' });
        assert.equal(m.nodes[s.a].textAlign, 'justify');
        m = M.updateNode(m, s.a, { textAlign: 'center' });
        assert.equal(m.nodes[s.a].textAlign, undefined);

        // Valore non valido ignorato per fillColor
        m = M.updateNode(m, s.a, { fillColor: 'non-valido' });
        assert.equal(m.nodes[s.a].fillColor, '#EFF6FF');
        m = M.updateNode(m, s.a, { bullets: false, fillColor: '' });
        assert.equal(m.nodes[s.a].bullets, undefined);
        assert.equal(m.nodes[s.a].fillColor, undefined);
      });
      it('getTopicNumber e getTopicLabel restituiscono la numerazione gerarchica', function () {
        var s = sample();
        assert.equal(M.getTopicNumber(s.map, s.map.rootId), '');
        assert.equal(M.getTopicLabel(s.map, s.map.rootId), 'Argomento centrale');
        assert.equal(M.getTopicNumber(s.map, s.a), '1');
        assert.equal(M.getTopicLabel(s.map, s.a), 'Argomento 1');
        assert.equal(M.getTopicNumber(s.map, s.b), '2');
        assert.equal(M.getTopicLabel(s.map, s.b), 'Argomento 2');
        assert.equal(M.getTopicNumber(s.map, s.a1), '1.1');
        assert.equal(M.getTopicLabel(s.map, s.a1), 'Argomento 1.1');
        assert.equal(M.getTopicNumber(s.map, s.a2), '1.2');
        assert.equal(M.getTopicLabel(s.map, s.a2), 'Argomento 1.2');
      });
    });

    describe('scheda persona (organigramma) e parentesi graffe di riepilogo', function () {
      it('updateNode gestisce personMode, role e avatarColor (imposta, valida e rimuove)', function () {
        var s = sample();
        var longRole = new Array(200).join('R');
        var m = M.updateNode(s.map, s.a, { personMode: true, role: 'Direttore Tecnico', avatarColor: '#059669' });
        assert.equal(m.nodes[s.a].personMode, true);
        assert.equal(m.nodes[s.a].role, 'Direttore Tecnico');
        assert.equal(m.nodes[s.a].avatarColor, '#059669');

        // Tronca role a 120 caratteri e ignora avatarColor non valido
        m = M.updateNode(m, s.a, { role: longRole, avatarColor: 'verde' });
        assert.equal(m.nodes[s.a].role.length, 120);
        assert.equal(m.nodes[s.a].avatarColor, '#059669');

        // Rimozione dei campi
        m = M.updateNode(m, s.a, { personMode: false, role: '   ', avatarColor: '' });
        assert.equal(m.nodes[s.a].personMode, undefined);
        assert.equal(m.nodes[s.a].role, undefined);
        assert.equal(m.nodes[s.a].avatarColor, undefined);
      });

      it('addSummary, getSummaryNodes, updateSummary, removeSummary e pulizia su removeNode', function () {
        var s = sample();
        var r3 = M.addChild(s.map, s.a, 'A3');
        var map = r3.map;
        var a3 = r3.nodeId;
        assert.deepEqual(map.summaries, []);

        // Aggiunge riepilogo passando gli estremi in ordine inverso: viene normalizzato
        var before = JSON.stringify(map);
        var res = M.addSummary(map, s.a, a3, s.a1, 'Gruppo A');
        assert.equal(JSON.stringify(map), before);
        map = res.map;
        assert.equal(map.summaries.length, 1);
        var sum = map.summaries[0];
        assert.equal(sum.id, res.summaryId);
        assert.equal(sum.parentId, s.a);
        assert.equal(sum.startId, s.a1);
        assert.equal(sum.endId, a3);
        assert.equal(sum.text, 'Gruppo A');
        assert.equal(sum.color, map.nodes[s.a1].color);
        assert.deepEqual(M.getSummaryNodes(map, sum), [s.a1, s.a2, a3]);
        assert.deepEqual(M.getSummaryNodes(map, { parentId: 'inesistente', startId: s.a1, endId: a3 }), []);

        // Rifiuta nodi non fratelli dello stesso genitore
        assert.throws(function () { M.addSummary(map, s.a, s.a1, s.b, 'Err'); }, /fratelli/);

        // updateSummary: testo, colore e nuovi estremi (anche invertiti)
        map = M.updateSummary(map, res.summaryId, { text: 'Sintesi', color: '#DC2626', startId: s.a2, endId: s.a1 });
        assert.equal(map.summaries[0].text, 'Sintesi');
        assert.equal(map.summaries[0].color, '#DC2626');
        assert.equal(map.summaries[0].startId, s.a1);
        assert.equal(map.summaries[0].endId, s.a2);
        assert.deepEqual(M.getSummaryNodes(map, map.summaries[0]), [s.a1, s.a2]);
        assert.throws(function () { M.updateSummary(map, 's_nessuno', { text: 'X' }); }, /Parentesi graffa non trovata/);

        // removeNode elimina automaticamente le parentesi che referenziano un nodo eliminato
        var afterDelChild = M.removeNode(map, s.a2);
        assert.equal(afterDelChild.summaries.length, 0);
        var afterDelParent = M.removeNode(map, s.a);
        assert.equal(afterDelParent.summaries.length, 0);

        // removeSummary rimuove la singola parentesi
        var afterRem = M.removeSummary(map, res.summaryId);
        assert.equal(afterRem.summaries.length, 0);
        assert.equal(map.summaries.length, 1);
      });

      it('addSummaryForNodes supporta nodi di rami diversi, immutabilità, errori e pulizia su removeNode', function () {
        var s = sample();
        var before = JSON.stringify(s.map);

        // Deduplica e ignora id inesistenti; crea parentesi tra nodi di rami diversi (A1 e B)
        var res = M.addSummaryForNodes(s.map, [s.a1, s.b, s.a1, 'inesistente'], 'Collegati');
        assert.equal(JSON.stringify(s.map), before);
        var map = res.map;
        assert.equal(map.summaries.length, 1);
        var sum = map.summaries[0];
        assert.equal(sum.id, res.summaryId);
        assert.deepEqual(sum.nodeIds, [s.a1, s.b]);
        assert.equal(sum.text, 'Collegati');
        assert.equal(sum.color, map.nodes[s.a1].color);
        assert.deepEqual(M.getSummaryNodes(map, sum), [s.a1, s.b]);

        // Errore con meno di 2 nodi validi (anche con duplicati o inesistenti)
        assert.throws(function () { M.addSummaryForNodes(s.map, [s.a1], 'Solo uno'); }, /almeno 2 nodi/);
        assert.throws(function () { M.addSummaryForNodes(s.map, [s.a1, s.a1, 'fantasma'], 'Duplicati'); }, /almeno 2 nodi/);
        assert.throws(function () { M.addSummaryForNodes(s.map, [], 'Vuoto'); }, /almeno 2 nodi/);

        // Rimozione di un nodo (o del suo antenato) filtra nodeIds e mantiene la parentesi se resta almeno 1 nodo
        var afterDelA = M.removeNode(map, s.a);
        assert.equal(afterDelA.summaries.length, 1);
        assert.deepEqual(afterDelA.summaries[0].nodeIds, [s.b]);
        assert.deepEqual(M.getSummaryNodes(afterDelA, afterDelA.summaries[0]), [s.b]);

        // Rimozione dell'ultimo nodo rimasto elimina la parentesi
        var afterDelAll = M.removeNode(afterDelA, s.b);
        assert.equal(afterDelAll.summaries.length, 0);
      });

      it('addChildToSummary, addSibling, getVisibleNodeIds, validate, removeNode e removeSummary sui figli della parentesi', function () {
        var s = sample();
        var sumRes = M.addSummaryForNodes(s.map, [s.a1, s.a2], 'Sintesi A');
        var map = sumRes.map;
        var sumId = sumRes.summaryId;

        assert.throws(function () { M.addChildToSummary(map, 's_inesistente', 'X'); }, /Parentesi graffa non trovata/);

        // Aggiunge un figlio alla parentesi graffa
        var c1Res = M.addChildToSummary(map, sumId, 'Conclusione 1');
        map = c1Res.map;
        var c1 = c1Res.nodeId;
        assert.equal(map.nodes[c1].parentId, sumId);
        assert.deepEqual(map.summaries[0].children, [c1]);
        assert.ok(M.validate(map).ok, M.validate(map).errors.join('; '));

        // Aggiunge un fratello del figlio della parentesi e un sotto-figlio
        var c2Res = M.addSibling(map, c1, 'Conclusione 2');
        map = c2Res.map;
        var c2 = c2Res.nodeId;
        assert.equal(map.nodes[c2].parentId, sumId);
        assert.deepEqual(map.summaries[0].children, [c1, c2]);

        var c1SubRes = M.addChild(map, c1, 'Dettaglio 1.1');
        map = c1SubRes.map;
        var c1Sub = c1SubRes.nodeId;
        assert.equal(M.getTopicNumber(map, c1), 'R.1');
        assert.equal(M.getTopicNumber(map, c1Sub), 'R.1.1');
        assert.equal(M.getTopicNumber(map, c2), 'R.2');
        assert.ok(M.validate(map).ok, M.validate(map).errors.join('; '));

        // getVisibleNodeIds include figli e discendenti della parentesi (e rispetta collapsed)
        var vis = M.getVisibleNodeIds(map);
        assert.ok(vis.indexOf(c1) >= 0 && vis.indexOf(c1Sub) >= 0 && vis.indexOf(c2) >= 0);
        var visCollapsed = M.getVisibleNodeIds(M.toggleCollapsed(map, c1));
        assert.ok(visCollapsed.indexOf(c1) >= 0 && visCollapsed.indexOf(c1Sub) < 0 && visCollapsed.indexOf(c2) >= 0);

        // removeNode su un figlio della parentesi lo scollega da s.children
        var afterDelC2 = M.removeNode(map, c2);
        assert.ok(!afterDelC2.nodes[c2]);
        assert.deepEqual(afterDelC2.summaries[0].children, [c1]);
        assert.ok(M.validate(afterDelC2).ok, M.validate(afterDelC2).errors.join('; '));

        // removeSummary rimuove la parentesi, tutti i suoi figli/discendenti e i collegamenti che li coinvolgono
        var withLink = M.addLink(afterDelC2, c1Sub, s.b, 'collegato').map;
        var afterRemSum = M.removeSummary(withLink, sumId);
        assert.equal(afterRemSum.summaries.length, 0);
        assert.ok(!afterRemSum.nodes[c1] && !afterRemSum.nodes[c1Sub]);
        assert.equal(afterRemSum.links.length, 0);
        assert.ok(M.validate(afterRemSum).ok, M.validate(afterRemSum).errors.join('; '));
      });

      it('updateSummary applica tutte le impostazioni di stile dei nodi', function () {
        var s = sample();
        var sumRes = M.addSummary(s.map, s.a, s.a1, s.a2, 'Sintesi');
        var map = M.updateSummary(sumRes.map, sumRes.summaryId, {
          fontName: 'Georgia',
          fontSize: 20,
          bold: false,
          italic: true,
          bullets: true,
          textAlign: 'left',
          shape: 'circle',
          comment: 'Nota di revisione',
          fillColor: '#EFF6FF',
          icon: '⭐',
          boxSize: 'L'
        });
        var sum = map.summaries[0];
        assert.equal(sum.fontName, 'Georgia');
        assert.equal(sum.fontSize, 20);
        assert.equal(sum.bold, false);
        assert.equal(sum.italic, true);
        assert.equal(sum.bullets, true);
        assert.equal(sum.textAlign, 'left');
        assert.equal(sum.shape, 'circle');
        assert.equal(sum.comment, 'Nota di revisione');
        assert.equal(sum.fillColor, '#EFF6FF');
        assert.equal(sum.icon, '⭐');
        assert.equal(sum.boxSize, 'L');
      });

      it('getVisibleNodeIds nasconde i figli della parentesi se i nodi coperti sono compressi, e getDepth restituisce 2', function () {
        var s = sample();
        var sumRes = M.addSummary(s.map, s.a, s.a1, s.a2, 'Gruppo A');
        var map = sumRes.map;
        var sumId = sumRes.summaryId;
        var c1Res = M.addChildToSummary(map, sumId, 'Figlio sintesi');
        map = c1Res.map;
        var c1 = c1Res.nodeId;
        var c1SubRes = M.addChild(map, c1, 'Nipote sintesi');
        map = c1SubRes.map;
        var c1Sub = c1SubRes.nodeId;

        // Bug #10: getDepth su figli diretti della parentesi è 2, sui loro figli è 3
        assert.equal(M.getDepth(map, c1), 2);
        assert.equal(M.getDepth(map, c1Sub), 3);

        // Bug #8: comprimere A nasconde a1, a2 e quindi anche i figli della parentesi
        var visOpen = M.getVisibleNodeIds(map);
        assert.ok(visOpen.indexOf(c1) >= 0 && visOpen.indexOf(c1Sub) >= 0);
        var collapsedMap = M.toggleCollapsed(map, s.a);
        var visCollapsed = M.getVisibleNodeIds(collapsedMap);
        assert.ok(visCollapsed.indexOf(s.a1) < 0 && visCollapsed.indexOf(s.a2) < 0);
        assert.ok(visCollapsed.indexOf(c1) < 0 && visCollapsed.indexOf(c1Sub) < 0);
      });

      it('reparent aggiorna/rimuove parentesi a intervallo sugli estremi e removeSummary pulisce a cascata', function () {
        var s = sample();
        var r3 = M.addChild(s.map, s.a, 'A3');
        var map = r3.map;
        var a3 = r3.nodeId;
        var sumRes = M.addSummary(map, s.a, s.a1, a3, 'Intervallo A');
        map = sumRes.map;
        var sumId = sumRes.summaryId;
        var c1Res = M.addChildToSummary(map, sumId, 'Conclusione');
        map = c1Res.map;
        var c1 = c1Res.nodeId;

        // Spostare startId (a1) restringe l'intervallo a [a2..a3]
        var m1 = M.reparent(map, s.a1, s.b);
        assert.equal(m1.summaries.length, 1);
        assert.equal(m1.summaries[0].startId, s.a2);
        assert.equal(m1.summaries[0].endId, a3);
        assert.deepEqual(M.getSummaryNodes(m1, m1.summaries[0]), [s.a2, a3]);
        assert.ok(M.validate(m1).ok, M.validate(m1).errors.join('; '));

        // Spostare endId (a3) restringe l'intervallo a [a2..a2]
        var m2 = M.reparent(m1, a3, s.b);
        assert.equal(m2.summaries.length, 1);
        assert.equal(m2.summaries[0].startId, s.a2);
        assert.equal(m2.summaries[0].endId, s.a2);

        // Spostare l'ultimo nodo rimasto (a2) elimina la parentesi e il suo figlio c1
        var m3 = M.reparent(m2, s.a2, s.b);
        assert.equal(m3.summaries.length, 0);
        assert.ok(!m3.nodes[c1]);
        assert.ok(M.validate(m3).ok, M.validate(m3).errors.join('; '));

        // Cascata su removeSummary: s1 -> c1, c2; s2 copre [c1, c2] e ha figlio c3 + link
        var c2Res = M.addChildToSummary(map, sumId, 'Conclusione 2');
        var casc = c2Res.map;
        var c2 = c2Res.nodeId;
        var sum2Res = M.addSummaryForNodes(casc, [c1, c2], 'Sintesi di sintesi');
        casc = sum2Res.map;
        var c3Res = M.addChildToSummary(casc, sum2Res.summaryId, 'Livello 2');
        casc = c3Res.map;
        var c3 = c3Res.nodeId;
        casc = M.addLink(casc, c3, s.b, 'rif').map;
        var afterCasc = M.removeSummary(casc, sumId);
        assert.equal(afterCasc.summaries.length, 0);
        assert.ok(!afterCasc.nodes[c1] && !afterCasc.nodes[c2] && !afterCasc.nodes[c3]);
        assert.equal(afterCasc.links.length, 0);
        assert.ok(M.validate(afterCasc).ok, M.validate(afterCasc).errors.join('; '));
      });
    });
  });
})();
