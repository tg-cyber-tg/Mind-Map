/*
 * Mappe Mentali – lettura ad alta voce in italiano (Web Speech API).
 * Si legge un'idea per volta (frasi brevi: Chrome interrompe quelle lunghe) e
 * a ogni idea si avvisa chi chiama (per evidenziarla sulla mappa).
 * Il motore è sostituibile (setEngine) per i test.
 */
(function (root) {
  'use strict';
  var MM = root.MM;

  var RATE_KEY = 'mm:voce-velocita';
  var DEFAULT_RATE = 0.95;
  var PREFERRED = /(alice|federica|paola|luca|elsa|google italiano|isabella|diego)/i;

  var engine = null;           // motore impostato a mano (test): { synth, Utterance }
  var italianVoice = null;
  var voicesListened = false;
  var session = 0;             // aumenta a ogni stop: le letture vecchie si fermano
  var speaking = false;
  var keepAlive = [];          // riferimenti alle frasi (Chrome perde gli eventi se raccolte dal GC)
  var listeners = [];

  var EMOJI_RE = (function () {
    try { return new RegExp('[\\p{Extended_Pictographic}\\u{FE0F}\\u{200D}\\u{20E3}]', 'gu'); }
    catch (e) { return /[\u2190-\u2BFF\uFE0F\u200D]|[\uD83C-\uDBFF][\uDC00-\uDFFF]/g; }
  })();

  function getEngine() {
    if (engine === false) return null;   // simulazione di un browser senza sintesi vocale
    if (engine) return engine;
    if (root.speechSynthesis && typeof root.SpeechSynthesisUtterance === 'function') {
      return { synth: root.speechSynthesis, Utterance: root.SpeechSynthesisUtterance };
    }
    return null;
  }

  /** Sostituisce il motore di sintesi (test): null = quello del browser, false = nessuno. */
  function setEngine(e) {
    engine = e === false ? false : (e || null);
    italianVoice = null;
    voicesListened = false;
  }

  function isSupported() { return !!getEngine(); }

  /** Voce italiana migliore disponibile (null se il sistema non ne ha). */
  function getItalianVoice() {
    var eng = getEngine();
    if (!eng) return null;
    if (italianVoice) return italianVoice;
    var voices = (eng.synth.getVoices && eng.synth.getVoices()) || [];
    if (!voices.length && !voicesListened && eng.synth.addEventListener) {
      // In Chrome l'elenco arriva in ritardo: si riprova quando è pronto.
      voicesListened = true;
      eng.synth.addEventListener('voiceschanged', function () { italianVoice = null; getItalianVoice(); });
    }
    var it = voices.filter(function (v) { return /^it([-_]|$)/i.test(v.lang || ''); });
    italianVoice = it.filter(function (v) { return PREFERRED.test(v.name); })[0] ||
      it.filter(function (v) { return v.localService; })[0] || it[0] || null;
    return italianVoice;
  }

  /* ---------- Velocità (preferenza del dispositivo, non della mappa) ---------- */

  function getRate() {
    var v = NaN;
    try { v = parseFloat(root.localStorage.getItem(RATE_KEY)); } catch (e) { /* non disponibile */ }
    return isFinite(v) ? Math.max(0.5, Math.min(1.5, v)) : DEFAULT_RATE;
  }

  function setRate(rate) {
    var r = Math.max(0.5, Math.min(1.5, Number(rate) || DEFAULT_RATE));
    try { root.localStorage.setItem(RATE_KEY, String(r)); } catch (e) { /* non essenziale */ }
    return r;
  }

  /* ---------- Testi da leggere (logica pura) ---------- */

  /** Testo pulito per la voce: niente emoji, a capo trasformati in pause. */
  function cleanText(text) {
    return String(text || '')
      .replace(EMOJI_RE, ' ')
      .replace(/\s*\n\s*/g, ', ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  /** Frase per un'idea (con la nota, se c'è). */
  function nodeSpeech(map, nodeId) {
    var n = map.nodes[nodeId];
    if (!n) return '';
    var text = cleanText(n.text) || 'idea senza testo';
    var note = cleanText(n.note);
    if (note) text += '. Nota: ' + note;
    return text;
  }

  /**
   * Sequenza di lettura dell'intera mappa: idea centrale, poi ogni ramo in
   * profondità (anche i rami compressi), infine i collegamenti trasversali.
   * @returns {{nodeId: string|null, text: string}[]}
   */
  function mapSequence(map) {
    var seq = [];
    (function visit(id) {
      var n = map.nodes[id];
      var text = nodeSpeech(map, id);
      if (n.parentId === null) text = 'Mappa: ' + text;
      if (n.children.length) {
        text += '. ' + (n.children.length === 1 ? 'Un\'idea collegata' : n.children.length + ' idee collegate');
      }
      seq.push({ nodeId: id, text: text });
      n.children.forEach(visit);
    })(map.rootId);
    (map.links || []).forEach(function (l) {
      var a = map.nodes[l.fromId];
      var b = map.nodes[l.toId];
      if (!a || !b) return;
      var label = cleanText(l.label);
      seq.push({
        nodeId: null,
        text: 'Collegamento: ' + (cleanText(a.text) || 'idea') + (label ? ', ' + label + ', ' : ', collegato a, ') +
          (cleanText(b.text) || 'idea')
      });
    });
    return seq;
  }

  /* ---------- Riproduzione ---------- */

  function notify() { listeners.forEach(function (cb) { cb(speaking); }); }

  /** cb(isSpeaking) quando la lettura inizia o finisce. */
  function onChange(cb) { listeners.push(cb); }

  function isSpeaking() { return speaking; }

  function stop() {
    session++;
    keepAlive = [];
    var eng = getEngine();
    if (eng) { try { eng.synth.cancel(); } catch (e) { /* già fermo */ } }
    if (speaking) { speaking = false; notify(); }
  }

  /** Legge una frase. @returns {Promise<void>} risolta alla fine (anche se interrotta). */
  function sayOne(text, rate, mySession) {
    return new Promise(function (resolve) {
      var eng = getEngine();
      if (!eng || mySession !== session) { resolve(); return; }
      var u = new eng.Utterance(text);
      u.lang = 'it-IT';
      u.rate = rate;
      var voice = getItalianVoice();
      if (voice) u.voice = voice;
      var finished = false;
      function end() { if (!finished) { finished = true; resolve(); } }
      u.onend = end;
      u.onerror = end;
      keepAlive.push(u);
      eng.synth.speak(u);
    });
  }

  /**
   * Legge in ordine le frasi; options.onItem(item, index) prima di ciascuna.
   * @returns {Promise<boolean>} true se arrivata alla fine, false se interrotta.
   */
  function speakSequence(items, options) {
    var o = options || {};
    if (!isSupported()) {
      return Promise.reject(new Error('Questo browser non sa leggere ad alta voce: prova con Chrome, Edge o Safari'));
    }
    stop();
    var mySession = session;
    var rate = typeof o.rate === 'number' ? o.rate : getRate();
    speaking = true;
    notify();
    return items.reduce(function (chain, item, i) {
      return chain.then(function () {
        if (mySession !== session) return null;
        if (o.onItem) o.onItem(item, i);
        return sayOne(item.text, rate, mySession);
      });
    }, Promise.resolve()).then(function () {
      var completed = mySession === session;
      if (completed) { speaking = false; keepAlive = []; notify(); }
      return completed;
    });
  }

  function speak(text, options) {
    return speakSequence([{ nodeId: null, text: cleanText(text) }], options);
  }

  function speakNode(map, nodeId, options) {
    return speakSequence([{ nodeId: nodeId, text: nodeSpeech(map, nodeId) }], options);
  }

  /** Legge tutta la mappa; onNode(nodeId) prima di ogni idea (null per i collegamenti). */
  function speakMap(map, onNode, options) {
    var o = options || {};
    return speakSequence(mapSequence(map), {
      rate: o.rate,
      onItem: function (item) { if (onNode) onNode(item.nodeId); }
    });
  }

  // Chiudendo la pagina la voce si ferma (altrimenti Chrome continua a parlare).
  if (root.addEventListener) root.addEventListener('pagehide', stop);

  MM.speech = {
    DEFAULT_RATE: DEFAULT_RATE,
    setEngine: setEngine, isSupported: isSupported, getItalianVoice: getItalianVoice,
    getRate: getRate, setRate: setRate,
    cleanText: cleanText, nodeSpeech: nodeSpeech, mapSequence: mapSequence,
    speak: speak, speakNode: speakNode, speakMap: speakMap, speakSequence: speakSequence,
    stop: stop, isSpeaking: isSpeaking, onChange: onChange
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);

