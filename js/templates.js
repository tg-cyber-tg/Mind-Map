/*
 * Mappe Mentali – modelli scolastici pronti (logica pura, nessun accesso al DOM).
 * Ogni modello è descritto in modo dichiarativo (albero di idee + collegamenti)
 * e viene costruito con le funzioni di MM.model, così è sempre una mappa valida.
 * Le posizioni vengono calcolate dal layout automatico all'apertura.
 */
(function (root) {
  'use strict';
  var MM = root.MM;

  /**
   * @typedef {Object} TemplateIdea
   * @property {string} text
   * @property {string} [key]     // nome interno, usato dai collegamenti
   * @property {string} [icon]
   * @property {string} [note]
   * @property {TemplateIdea[]} [children]
   */
  /**
   * @typedef {Object} TemplateSpec
   * @property {string} id
   * @property {string} name
   * @property {string} icon
   * @property {string} description
   * @property {'radial'|'tree'} layout
   * @property {string} title                              // testo dell'idea centrale
   * @property {TemplateIdea[]} [children]
   * @property {Array<Array<string>>} [links]              // [chiaveDa, chiaveA, etichetta]
   */

  /** @type {TemplateSpec[]} */
  var TEMPLATES = [
    {
      id: 'vuota', name: 'Mappa vuota', icon: '📄', layout: 'radial',
      description: 'Solo l\'idea centrale: costruisci la mappa da zero.',
      title: 'Nuova mappa'
    },
    {
      id: 'riassunto-capitolo', name: 'Riassunto di un capitolo', icon: '📖', layout: 'radial',
      description: 'Argomento, concetti chiave, parole nuove, esempi e domande per ripassare.',
      title: 'Titolo del capitolo',
      children: [
        { key: 'arg', text: 'Di cosa parla', icon: '🎯', note: 'Scrivi in una frase l\'argomento principale.' },
        { key: 'conc', text: 'Concetti chiave', icon: '🔑', children: [
          { text: 'Concetto 1' }, { text: 'Concetto 2' }, { text: 'Concetto 3' }] },
        { text: 'Parole nuove', icon: '📚', children: [{ text: 'Parola: significato' }] },
        { key: 'es', text: 'Esempi', icon: '💡', children: [{ text: 'Esempio 1' }] },
        { text: 'Domande per ripassare', icon: '❓', children: [{ text: 'Che cosa…?' }, { text: 'Perché…?' }] }
      ],
      links: [['es', 'conc', 'spiegano']]
    },
    {
      id: 'personaggio-storico', name: 'Personaggio storico', icon: '👤', layout: 'radial',
      description: 'Chi era, quando e dove è vissuto, cosa ha fatto e perché è importante.',
      title: 'Nome del personaggio',
      children: [
        { text: 'Chi era', icon: '👤', children: [{ text: 'Ruolo / mestiere' }, { text: 'Famiglia' }] },
        { text: 'Quando', icon: '📅', children: [{ text: 'Nascita' }, { text: 'Morte' }, { text: 'Epoca' }] },
        { text: 'Dove', icon: '🗺️', children: [{ text: 'Luoghi della sua vita' }] },
        { key: 'fatto', text: 'Cosa ha fatto', icon: '⚔️', children: [{ text: 'Impresa 1' }, { text: 'Impresa 2' }] },
        { key: 'imp', text: 'Perché è importante', icon: '⭐', note: 'Quali conseguenze ha avuto il suo operato?' }
      ],
      links: [['fatto', 'imp', 'quindi']]
    },
    {
      id: 'processo-scientifico', name: 'Processo scientifico', icon: '🔬', layout: 'tree',
      description: 'Le fasi di un fenomeno in ordine, con cause ed effetti (schema ad albero).',
      title: 'Nome del processo',
      children: [
        { key: 'f1', text: '1. Fase iniziale', icon: '🌱', note: 'Da dove si parte? Quali condizioni servono?' },
        { key: 'f2', text: '2. Cosa succede', icon: '⚡', children: [{ text: 'Passaggio A' }, { text: 'Passaggio B' }] },
        { key: 'f3', text: '3. Risultato', icon: '✅' },
        { text: 'Ingredienti / condizioni', icon: '🧪', children: [{ text: 'Elemento 1' }, { text: 'Elemento 2' }] },
        { text: 'Esempi nella vita reale', icon: '🌍' }
      ],
      links: [['f1', 'f2', 'poi'], ['f2', 'f3', 'produce']]
    },
    {
      id: 'analisi-testo', name: 'Analisi del testo', icon: '📝', layout: 'radial',
      description: 'Autore, genere, personaggi, luoghi, tempo, trama, temi e messaggio.',
      title: 'Titolo del testo',
      children: [
        { text: 'Autore', icon: '✏️', children: [{ text: 'Nome' }, { text: 'Epoca' }] },
        { text: 'Genere', icon: '📚', note: 'Romanzo, racconto, poesia, favola…' },
        { key: 'pers', text: 'Personaggi', icon: '👥', children: [
          { text: 'Protagonista' }, { text: 'Antagonista' }, { text: 'Aiutanti' }] },
        { text: 'Luoghi', icon: '🗺️' },
        { text: 'Tempo', icon: '⏳' },
        { text: 'Trama', icon: '🎭', children: [{ text: 'Inizio' }, { text: 'Sviluppo' }, { text: 'Conclusione' }] },
        { key: 'temi', text: 'Temi e messaggio', icon: '💬' }
      ],
      links: [['pers', 'temi', 'esprimono']]
    },
    {
      id: 'confronto', name: 'Confronto', icon: '⚖️', layout: 'tree',
      description: 'Due argomenti a confronto: caratteristiche, somiglianze e differenze.',
      title: 'A e B a confronto',
      children: [
        { key: 'a', text: 'Argomento A', icon: '📌', children: [{ text: 'Caratteristica 1' }, { text: 'Caratteristica 2' }] },
        { key: 'b', text: 'Argomento B', icon: '🎯', children: [{ text: 'Caratteristica 1' }, { text: 'Caratteristica 2' }] },
        { text: 'Somiglianze', icon: '✅', children: [{ text: 'In entrambi…' }] },
        { text: 'Differenze', icon: '❌', children: [{ text: 'A invece…' }, { text: 'B invece…' }] },
        { text: 'Conclusione', icon: '💡' }
      ],
      links: [['a', 'b', 'si confronta con']]
    }
  ];

  function find(templateId) {
    for (var i = 0; i < TEMPLATES.length; i++) if (TEMPLATES[i].id === templateId) return TEMPLATES[i];
    return null;
  }

  /** @returns {{id: string, name: string, icon: string, description: string}[]} */
  function list() {
    return TEMPLATES.map(function (t) {
      return { id: t.id, name: t.name, icon: t.icon, description: t.description };
    });
  }

  /** Crea una nuova mappa dal modello (id sempre nuovi). Errore se il modello non esiste. */
  function create(templateId) {
    var spec = find(templateId);
    if (!spec) throw new Error('Modello non trovato: ' + templateId);
    var map = MM.model.createMap(spec.title);
    if (spec.id !== 'vuota') map = MM.model.updateNode(map, map.rootId, { icon: spec.icon });
    map.settings.layout = spec.layout;
    var keys = {};

    (function addAll(parentId, ideas) {
      (ideas || []).forEach(function (idea) {
        var r = MM.model.addChild(map, parentId, idea.text);
        map = r.map;
        var patch = {};
        if (idea.icon) patch.icon = idea.icon;
        if (idea.note) patch.note = idea.note;
        if (Object.keys(patch).length) map = MM.model.updateNode(map, r.nodeId, patch);
        if (idea.key) keys[idea.key] = r.nodeId;
        addAll(r.nodeId, idea.children);
      });
    })(map.rootId, spec.children);

    (spec.links || []).forEach(function (l) {
      if (!keys[l[0]] || !keys[l[1]]) throw new Error('Modello "' + spec.id + '": collegamento non valido');
      map = MM.model.addLink(map, keys[l[0]], keys[l[1]], l[2]).map;
    });
    return map;
  }

  MM.templates = { list: list, create: create };
})(typeof globalThis !== 'undefined' ? globalThis : window);

