/* Test di MM.speech (motore di sintesi finto: nessun suono) */
(function () {
  'use strict';
  var M = MM.model;
  var S = MM.speech;

  /** Motore finto: registra le frasi e le "termina" subito (in modo asincrono). */
  function fakeEngine(voices) {
    var spoken = [];
    var eng = {
      spoken: spoken,
      cancelled: 0,
      synth: {
        getVoices: function () { return voices || []; },
        speak: function (u) { spoken.push(u); setTimeout(function () { if (u.onend) u.onend(); }, 0); },
        cancel: function () { eng.cancelled++; }
      },
      Utterance: function (text) { this.text = text; }
    };
    return eng;
  }

  function sample() {
    var map = M.createMap('Il Sole ☀️');
    var r = M.addChild(map, map.rootId, 'Stella'); map = r.map; var a = r.nodeId;
    r = M.addChild(map, map.rootId, 'Luce\ne calore'); map = r.map; var b = r.nodeId;
    map = M.updateNode(map, b, { note: 'Arriva in 8 minuti' });
    r = M.addChild(map, a, 'Nana gialla'); map = r.map;
    map = M.toggleCollapsed(map, a);
    map = M.addLink(map, a, b, 'produce').map;
    return { map: map, a: a, b: b };
  }

  describe('speech', function () {
    it('pulisce il testo: niente emoji e a capo trasformati in pause', function () {
      assert.equal(S.cleanText('⭐ Il  Sole\n☀️ caldo'), 'Il Sole, caldo');
      assert.equal(S.cleanText(''), '');
    });

    it('legge testo e nota di un\'idea', function () {
      var s = sample();
      assert.equal(S.nodeSpeech(s.map, s.b), 'Luce, e calore. Nota: Arriva in 8 minuti');
    });

    it('sequenza della mappa: ordine gerarchico, rami compressi inclusi, poi i collegamenti', function () {
      var s = sample();
      var seq = S.mapSequence(s.map);
      assert.equal(seq.length, 5);
      assert.equal(seq[0].nodeId, s.map.rootId);
      assert.ok(/^Mappa: Il Sole\. 2 idee collegate$/.test(seq[0].text), seq[0].text);
      assert.equal(seq[1].nodeId, s.a);
      assert.equal(seq[2].text, 'Nana gialla');
      assert.equal(seq[3].nodeId, s.b);
      assert.equal(seq[4].nodeId, null);
      assert.equal(seq[4].text, 'Collegamento: Stella, produce, Luce, e calore');
    });

    it('sceglie una voce italiana', function () {
      S.setEngine(fakeEngine([
        { name: 'Samantha', lang: 'en-US' }, { name: 'Alice', lang: 'it-IT' }, { name: 'Altra', lang: 'it_IT' }
      ]));
      assert.equal(S.getItalianVoice().name, 'Alice');
      S.setEngine(fakeEngine([{ name: 'Samantha', lang: 'en-US' }]));
      assert.equal(S.getItalianVoice(), null);
      S.setEngine(null);
    });

    it('speakMap legge tutte le frasi in italiano e segnala ogni idea', function () {
      var s = sample();
      var eng = fakeEngine([{ name: 'Alice', lang: 'it-IT' }]);
      S.setEngine(eng);
      var seen = [];
      return S.speakMap(s.map, function (id) { seen.push(id); }, { rate: 1.1 }).then(function (completed) {
        S.setEngine(null);
        assert.ok(completed);
        assert.equal(eng.spoken.length, 5);
        assert.equal(eng.spoken[0].lang, 'it-IT');
        assert.equal(eng.spoken[0].rate, 1.1);
        assert.equal(eng.spoken[0].voice.name, 'Alice');
        assert.equal(seen[1], s.a);
        assert.ok(!S.isSpeaking());
      });
    });

    it('stop interrompe la lettura', function () {
      var s = sample();
      var eng = fakeEngine([]);
      S.setEngine(eng);
      var p = S.speakMap(s.map, function (id) { if (id === s.a) S.stop(); });
      return p.then(function (completed) {
        S.setEngine(null);
        assert.equal(completed, false);
        assert.ok(eng.spoken.length < 5, 'lette ' + eng.spoken.length + ' frasi');
        assert.ok(eng.cancelled > 0);
      });
    });

    it('errore in italiano se il browser non supporta la sintesi vocale', function () {
      S.setEngine(false);
      assert.equal(S.isSupported(), false);
      assert.equal(S.getItalianVoice(), null);
      return S.speak('ciao').then(function () {
        S.setEngine(null);
        throw new Error('atteso un errore');
      }, function (e) {
        S.setEngine(null);
        assert.ok(/non sa leggere/.test(e.message), e.message);
      });
    });
  });
})();
