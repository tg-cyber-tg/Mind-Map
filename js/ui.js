/*
 * Mappe Mentali – interfaccia: barra degli strumenti, pannello delle proprietà,
 * finestre modali (elenco mappe, modelli, accessibilità, sincronizzazione, aiuto) e notifiche.
 * Tutte le azioni passano da MM.app: qui c'è solo la parte visiva.
 */
(function (root) {
  'use strict';
  var MM = root.MM;

  var EMOJI = [
    '⭐', '❗', '❓', '💡', '✅', '❌', '⚠️', '📌', '🎯', '🔑',
    '📚', '📖', '✏️', '📝', '🧮', '🔢', '📐', '🔬', '🧪', '🧬',
    '🌍', '🗺️', '🏛️', '⚔️', '👑', '⏳', '📅', '🎨', '🎵', '🎭',
    '💬', '🗣️', '👤', '👥', '❤️', '🌱', '🐾', '☀️', '💧', '⚡'
  ];
  var SHAPE_LABELS = { rounded: 'Arrotondato', rect: 'Rettangolo', ellipse: 'Ovale', circle: 'Cerchio' };
  var SUB_LAYOUT_LABELS = {
    radial: 'Mappa mentale (a raggiera)',
    balanced: 'Mappa bilanciata',
    tree: 'Schema ad albero',
    org: 'Organigramma',
    timeline: 'Linea del tempo',
    fishbone: 'Lisca di pesce',
    outline: 'Elenco verticale'
  };
  var LINK_STYLE_LABELS = { curved: 'Curva', straight: 'Dritta', elbow: 'A gomito' };
  // Etichette tipiche delle mappe concettuali (un clic per inserirle).
  var LINK_LABELS = ['causa', 'provoca', 'è formato da', 'è un tipo di', 'serve a', 'si oppone a', 'influenza', 'esempio'];

  var app = null;
  var panel = null;
  var panelKey = null;          // selezione mostrata nel pannello
  var typing = null;            // { key } campo in cui si sta scrivendo (un solo passo di annulla)
  var iconTab = 'simboli';      // 'simboli' | 'emoji'
  var emojiCat = 'faccine';     // categoria emoji attiva

  function hslToHex(h, s, l) {
    s /= 100; l /= 100;
    var k = function (n) { return (n + h / 30) % 12; };
    var a = s * Math.min(l, 1 - l);
    var f = function (n) {
      var v = l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
      return Math.round(255 * v).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  function hexToHue(hex) {
    var m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return 210;
    var r = parseInt(m[1].slice(0, 2), 16) / 255;
    var g = parseInt(m[1].slice(2, 4), 16) / 255;
    var b = parseInt(m[1].slice(4, 6), 16) / 255;
    var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    if (!d) return 210;
    var h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : (max === g ? (b - r) / d + 2 : (r - g) / d + 4);
    return Math.round(h * 60) % 360;
  }

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

  function ico(name, opts) {
    return MM.icons ? MM.icons.createSvg(name, opts) : null;
  }

  function h(tag, attrs, children) {
    var e = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'on') Object.keys(attrs.on).forEach(function (ev) { e.addEventListener(ev, attrs.on[ev]); });
      else if (attrs[k] === true) e.setAttribute(k, '');
      else if (attrs[k] !== false && attrs[k] !== null && attrs[k] !== undefined) e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { if (c) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }

  /* ---------- Notifiche ---------- */

  /**
   * type: 'info' (predefinito) | 'successo' | 'avviso' | 'errore'.
   * action (facoltativa): { label, onClick, persistent } aggiunge un pulsante;
   * con persistent la notifica resta finché non si preme il pulsante o la chiusura.
   */
  function toast(msg, type, action) {
    var box = document.getElementById('toasts');
    if (!box) return;
    var kind = type || 'info';
    var iconName = { info: 'info', successo: 'check-circle', avviso: 'alert-triangle', errore: 'alert-circle' }[kind] || 'info';
    var t = h('div', { 'class': 'toast toast-' + kind, role: kind === 'errore' ? 'alert' : null }, [
      ico(iconName, { size: 18 }),
      h('span', { text: msg })
    ]);
    function remove() {
      t.classList.add('toast-out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }
    if (action) {
      t.classList.add('toast-action');
      t.appendChild(h('button', { type: 'button', on: { click: function () { remove(); action.onClick(); } } }, [action.label]));
      if (action.persistent) {
        t.appendChild(h('button', { type: 'button', 'class': 'toast-close', 'aria-label': 'Chiudi', on: { click: remove } }, [
          ico('close', { size: 16 }) || '✕'
        ]));
      }
    }
    box.appendChild(t);
    // Si tengono al massimo 3 notifiche, senza togliere quelle persistenti.
    var transient = $all('.toast:not(.toast-persistent)', box);
    while (transient.length > 3) { var old = transient.shift(); if (old.parentNode) old.parentNode.removeChild(old); }
    if (action && action.persistent) { t.classList.add('toast-persistent'); return; }
    setTimeout(remove, kind === 'errore' ? 6000 : action ? 8000 : 3500);
  }

  /* ---------- Menu a tendina ---------- */

  function closeMenus(except) {
    $all('[data-menu]').forEach(function (b) {
      var list = document.getElementById(b.getAttribute('data-menu'));
      if (list === except) return;
      list.hidden = true;
      b.setAttribute('aria-expanded', 'false');
    });
  }

  function toggleMenu(button) {
    var list = document.getElementById(button.getAttribute('data-menu'));
    var open = list.hidden;
    closeMenus(list);
    list.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    if (open) {
      var first = $('button:not([hidden]):not(:disabled)', list);
      if (first) first.focus();
    }
  }

  function onMenuKeys(e) {
    var list = e.target.closest('.menu-list');
    if (!list) return;
    var items = $all('button:not([hidden]):not(:disabled)', list);
    var i = items.indexOf(e.target);
    if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
    else if (e.key === 'Escape') {
      e.preventDefault();
      closeMenus();
      var opener = $('[data-menu="' + list.id + '"]');
      if (opener) opener.focus();
    }
  }

  /* ---------- Azioni della barra ---------- */

  function runAction(action) {
    closeMenus();
    var map = app.getMap();
    switch (action) {
      case 'nuova': closeDialogs(); app.newMap('vuota'); break;
      case 'apri': openMapList(); break;
      case 'modelli': openTemplates(); break;
      case 'importa': document.getElementById('file-input').click(); break;
      case 'esporta-json': app.saveNow(); app.exportAs('json'); break;
      case 'esporta-png': app.exportAs('png'); break;
      case 'esporta-svg': app.exportAs('svg'); break;
      case 'stampa': app.exportAs('print'); break;
      case 'annulla': app.undo(); break;
      case 'ripristina': app.redo(); break;
      case 'figlio': app.addNode('figlio'); break;
      case 'fratello': app.addNode('fratello'); break;
      case 'collega': MM.interactions.startLinkMode(); break;
      case 'elimina': app.deleteSelection(); break;
      case 'layout-radial': app.applySettings({ layout: 'radial' }); break;
      case 'layout-balanced': app.applySettings({ layout: 'balanced' }); break;
      case 'layout-tree': app.applySettings({ layout: 'tree' }); break;
      case 'layout-org': app.applySettings({ layout: 'org' }); break;
      case 'layout-timeline': app.applySettings({ layout: 'timeline' }); break;
      case 'layout-fishbone': app.applySettings({ layout: 'fishbone' }); break;
      case 'layout-outline': app.applySettings({ layout: 'outline' }); break;
      case 'layout-compare': app.applySettings({ layout: 'compare' }); break;
      case 'aggiungi-centro': if (app.addCompareCenter) app.addCompareCenter(); break;
      case 'riordina': if (app.relayout()) toast('Nodi riordinati (Ctrl/Cmd+Z per annullare)'); break;
      case 'zoom-meno': app.zoom(1 / 1.2); break;
      case 'zoom-piu': app.zoom(1.2); break;
      case 'adatta': app.fit({ animate: true }); break;
      case 'aiuto': openHelp(); break;
      case 'accessibilita': openSettings(); break;
      case 'sync': openSync(); break;
      case 'toggle-properties': app.toggleProperties(); break;
      case 'leggi-idea': app.readSelection(); break;
      case 'leggi-mappa': app.readMap(); break;
      case 'leggi-stop': app.stopReading(); break;
      default: return;
    }
    // Dopo un'azione sulla mappa il focus torna all'area di lavoro (tastiera pronta).
    if (['apri', 'modelli', 'importa', 'aiuto', 'accessibilita', 'sync', 'toggle-properties'].indexOf(action) < 0 &&
        !MM.interactions.isEditing() && !document.querySelector('dialog[open]') && map) {
      document.getElementById('canvas').focus({ preventScroll: true });
    }
  }

  /** Abilita/disabilita i pulsanti in base allo stato corrente. */
  function updateToolbarState(appApi) {
    var a = appApi || app;
    var st = a.state;
    var map = st.map;
    if (!map) return;
    var sel = st.selectedId ? map.nodes[st.selectedId] : null;
    var ro = !!(a.isReadOnly && a.isReadOnly());
    function set(action, enabled) {
      $all('[data-action="' + action + '"]').forEach(function (b) { b.disabled = !enabled; });
    }
    set('annulla', !ro && a.canUndo());
    set('ripristina', !ro && a.canRedo());
    var hasMultiDeletable = Array.isArray(st.selectedIds) && st.selectedIds.some(function (id) {
      return map.nodes[id] && map.nodes[id].parentId !== null;
    });
    set('elimina', !ro && (!!st.selectedLinkId || !!st.selectedSummaryId || hasMultiDeletable || (!!sel && sel.parentId !== null)));
    set('figlio', !ro);
    set('fratello', !ro);
    set('collega', !ro);
    set('riordina', !ro);
    set('aggiungi-centro', !ro);
    var linkBtn = $('[data-action="collega"]');
    if (linkBtn) {
      linkBtn.setAttribute('aria-pressed', String(!ro && st.mode === 'collegamento'));
      linkBtn.classList.toggle('active', !ro && st.mode === 'collegamento');
    }
    var allLayouts = MM.model.LAYOUTS || ['radial', 'tree', 'balanced', 'org', 'timeline', 'fishbone', 'outline'];
    allLayouts.forEach(function (k) {
      var b = $('[data-action="layout-' + k + '"]');
      if (b) {
        b.setAttribute('aria-checked', String(map.settings.layout === k));
        b.disabled = ro;
      }
    });
    // Aggiorna l'icona del pulsante Layout nella pillola flottante.
    var layoutBtnIco = $('[data-menu="menu-layout"] .ico');
    if (layoutBtnIco && MM.icons) {
      var iconMap = {
        radial: 'layout-radial',
        balanced: 'layout-balanced',
        tree: 'layout-tree',
        org: 'layout-org',
        timeline: 'layout-timeline',
        fishbone: 'layout-fishbone',
        outline: 'layout-outline',
        compare: 'layout-compare'
      };
      var lSvg = ico(iconMap[map.settings.layout] || 'layout-radial', { size: 18 });
      if (lSvg) { layoutBtnIco.textContent = ''; layoutBtnIco.appendChild(lSvg); }
    }
    var addCenterBtn = document.getElementById('btn-add-center');
    if (addCenterBtn) addCenterBtn.hidden = map.settings.layout !== 'compare';
    // Contatore totale dei nodi nella barra inferiore.
    var countEl = document.getElementById('node-count');
    if (countEl) {
      var totalNodes = Object.keys(map.nodes || {}).length;
      countEl.textContent = totalNodes === 1 ? '1 nodo' : totalNodes + ' nodi';
    }
    renderTabs();
    if (typeof a.isPropertiesOpen === 'function') {
      setPropertiesOpen(a.isPropertiesOpen());
    }
    // Le funzioni opzionali restano nascoste finché il modulo non esiste.
    $all('[data-needs]').forEach(function (b) { b.hidden = !MM[b.getAttribute('data-needs')]; });
    // Lettura vocale: visibile ma disattivata (con spiegazione) se il browser non la supporta.
    var speechBtn = $('[data-menu="menu-leggi"]');
    if (speechBtn && MM.speech && !MM.speech.isSupported()) {
      speechBtn.disabled = true;
      speechBtn.title = 'Questo browser non sa leggere ad alta voce: prova con Chrome, Edge o Safari';
    }
    set('leggi-stop', !!MM.speech && MM.speech.isSpeaking());
  }

  function setPropertiesOpen(open) {
    if (panel) panel.classList.toggle('collapsed', !open);
    var btn = document.getElementById('btn-toggle-props');
    if (btn) btn.setAttribute('aria-pressed', String(!!open));
  }

  function setTitle(title) {
    var t = (title || 'Mappa senza titolo').replace(/\s+/g, ' ');
    var el = document.getElementById('map-title');
    if (el) el.textContent = t;
    document.title = t + ' – Mappe Mentali';
  }

  function updateZoom(s) {
    var el = document.getElementById('zoom-level');
    var pct = Math.round(s.scale * 100) + '%';
    if (el && el.textContent !== pct) el.textContent = pct;
  }

  /* ---------- Pannello delle proprietà ---------- */

  /**
   * Modifica "continua" da un campo di testo: il primo carattere crea un passo di
   * annulla, i successivi aggiornano la mappa senza aggiungerne altri.
   */
  function liveUpdate(key, fn, relayout) {
    var first = !typing || typing.key !== key;
    typing = { key: key };
    app.tryCommit(fn, { recordHistory: first, relayout: !!relayout });
  }

  function endTyping() { typing = null; }

  function panelHeader(title, iconName) {
    return h('div', { 'class': 'prop-header' }, [
      h('h2', { 'class': 'prop-header-title' }, [ico(iconName, { size: 17 }), title]),
      h('button', {
        type: 'button',
        'class': 'prop-close',
        'data-action': 'toggle-properties',
        title: 'Chiudi pannello Proprietà',
        'aria-label': 'Chiudi pannello Proprietà'
      }, [ico('close', { size: 16 })])
    ]);
  }

  function section(title, children) {
    return h('section', { 'class': 'prop-section' }, [h('h3', { text: title })].concat(children));
  }

  function textField(id, label, value, opts) {
    var input = h(opts.multiline ? 'textarea' : 'input', {
      id: id, maxlength: opts.max || null, rows: opts.multiline ? (opts.rows || 3) : null,
      type: opts.multiline ? null : 'text', placeholder: opts.placeholder || '', spellcheck: 'true'
    });
    input.value = value;
    input.addEventListener('input', function () { opts.onInput(input.value); });
    input.addEventListener('change', endTyping);
    input.addEventListener('blur', endTyping);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') { e.preventDefault(); document.getElementById('canvas').focus(); }
    });
    return h('div', { 'class': 'field' }, [h('label', { 'for': id, text: label }), input]);
  }

  function nodePanel(map, node) {
    var id = node.id;
    var isRoot = node.parentId === null;
    var parts = [];

    var topicTitle = MM.model.getTopicLabel ? MM.model.getTopicLabel(map, id) : (isRoot ? 'Argomento centrale' : 'Argomento');
    parts.push(panelHeader(topicTitle, isRoot ? 'logo' : 'file'));

    parts.push(section('Contenuto', [
      textField('prop-testo', 'Testo', node.text, {
        multiline: true, rows: 2, max: MM.model.MAX_TEXT,
        onInput: function (v) {
          liveUpdate('testo:' + id, function (m) { return MM.model.updateNode(m, id, { text: v || ' ' }); }, true);
        }
      }),
      textField('prop-nota', 'Nota (spiegazione, appunti)', node.note, {
        multiline: true, rows: 3, placeholder: 'Scrivi qui i dettagli…',
        onInput: function (v) {
          liveUpdate('nota:' + id, function (m) { return MM.model.updateNode(m, id, { note: v }); });
        }
      })
    ]));

    // Commento (evidenzia il nodo in giallo fluo con icona commento in alto a destra).
    var commentChildren = [
      textField('prop-commento', 'Commento (evidenzia in giallo)', node.comment || '', {
        multiline: true, rows: 3, placeholder: 'Aggiungi un commento…',
        onInput: function (v) {
          liveUpdate('commento:' + id, function (m) { return MM.model.updateNode(m, id, { comment: v }); });
        }
      })
    ];
    if (node.comment) {
      commentChildren.push(h('button', {
        type: 'button', 'class': 'link-button',
        on: { click: function () { app.updateNode(id, { comment: '' }); } }
      }, ['Rimuovi commento']));
    }
    parts.push(section('Commento', commentChildren));

    // In modalità Organigramma (o se già attivo): scheda persona con foto profilo circolare, nome e ruolo.
    if ((map.settings && map.settings.layout === 'org') || node.personMode) {
      var personCheck = h('input', { type: 'checkbox', id: 'prop-person-mode' });
      personCheck.checked = !!node.personMode;
      personCheck.addEventListener('change', function () {
        app.updateNode(id, { personMode: personCheck.checked }, { relayout: true });
      });
      var personChildren = [
        h('label', { 'class': 'check box-level-check', 'for': 'prop-person-mode', style: 'margin-top:0' }, [
          personCheck, ' Mostra come profilo persona (icona/foto circolare)'
        ])
      ];
      if (node.personMode) {
        personChildren.push(textField('prop-ruolo', 'Ruolo (sotto il nome)', node.role || '', {
          max: 120, placeholder: 'Es. Direttore, Responsabile…',
          onInput: function (v) {
            liveUpdate('ruolo:' + id, function (m) { return MM.model.updateNode(m, id, { role: v }); }, true);
          }
        }));
        var avColors = MM.model.PALETTE.slice(0, 16);
        var activeAv = (node.avatarColor || node.color || '').toLowerCase();
        personChildren.push(h('div', { 'class': 'fill-color-label', style: 'margin-top:0.5rem' }, ['Colore icona profilo']));
        personChildren.push(h('div', { 'class': 'swatches', role: 'radiogroup', 'aria-label': 'Colore icona profilo' }, avColors.map(function (c, i) {
          var sel = c.toLowerCase() === activeAv;
          return h('button', {
            type: 'button', 'class': 'swatch' + (sel ? ' selected' : ''), role: 'radio',
            'aria-checked': String(sel), 'aria-label': 'Colore profilo ' + (i + 1), title: c,
            style: 'background:' + c + ';color:' + MM.model.textColorFor(c),
            on: { click: function () { app.updateNode(id, { avatarColor: c }); } }
          }, [sel ? ico('check', { size: 12, strokeWidth: 2.5 }) : null]);
        })));
        var avatarPicker = h('input', { type: 'file', accept: 'image/*', hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
        avatarPicker.addEventListener('change', function () {
          var f = avatarPicker.files && avatarPicker.files[0];
          avatarPicker.value = '';
          if (f) {
            loadImageFile(f).then(function (loaded) {
              if (app.updateNode(id, { images: [loaded] }, { relayout: true })) {
                toast('Foto profilo aggiornata', 'successo');
              }
            }, function (err) { toast(err.message, 'errore'); });
          }
        });
        var hasPhoto = MM.model.nodeImagesOf && MM.model.nodeImagesOf(node).length > 0;
        personChildren.push(avatarPicker);
        personChildren.push(h('div', { 'class': 'prop-actions', style: 'margin-top:0.5rem' }, [
          h('button', { type: 'button', on: { click: function () { avatarPicker.click(); } } }, [
            ico('image', { size: 16 }), hasPhoto ? ' Cambia foto profilo' : ' Carica foto profilo'
          ]),
          hasPhoto ? h('button', {
            type: 'button', 'class': 'danger',
            on: { click: function () { app.updateNode(id, { images: null }, { relayout: true }); } }
          }, [ico('trash', { size: 16 }), ' Rimuovi foto']) : null
        ]));
      }
      parts.push(section('Scheda persona (Organigramma)', personChildren));
    }

    // In modalità Confronto: scegli il layout di ogni singolo nodo centrale o aggiungine altri.
    if (map.settings && map.settings.layout === 'compare') {
      if (node.parentId === map.rootId) {
        var subLayouts = MM.model.SUB_LAYOUTS || ['radial', 'balanced', 'tree', 'org', 'timeline', 'fishbone', 'outline'];
        var curSub = node.subLayout || 'radial';
        var subSelect = h('select', { id: 'prop-sublayout', 'class': 'font-select', 'aria-label': 'Layout di questo nodo centrale' },
          subLayouts.map(function (sl) {
            var opt = h('option', { value: sl }, [SUB_LAYOUT_LABELS[sl] || sl]);
            if (sl === curSub) opt.selected = true;
            return opt;
          }));
        subSelect.addEventListener('change', function () {
          app.updateNode(id, { subLayout: subSelect.value }, { relayout: true });
        });
        parts.push(section('Confronto — Layout nodo centrale', [
          subSelect,
          h('div', { 'class': 'prop-actions', style: 'margin-top:0.5rem' }, [
            h('button', { type: 'button', on: { click: function () { if (app.addCompareCenter) app.addCompareCenter(); } } }, [
              ico('plus', { size: 16 }), 'Aggiungi altro nodo centrale'
            ])
          ])
        ]));
      } else if (isRoot) {
        parts.push(section('Confronto', [
          h('p', { 'class': 'prop-hint', text: 'Ogni figlio di questo titolo è un nodo centrale indipendente con il proprio layout.' }),
          h('div', { 'class': 'prop-actions' }, [
            h('button', { type: 'button', on: { click: function () { if (app.addCompareCenter) app.addCompareCenter(); } } }, [
              ico('plus', { size: 16 }), 'Aggiungi nodo centrale'
            ])
          ])
        ]));
      }
    }

    parts.push(typographySection(map, node));
    parts.push(colorSection(map, node));
    parts.push(shapeSection(node));
    parts.push(boxSizeSection(map, node));
    parts.push(imageSection(node));
    parts.push(iconSection(node));
    parts.push(linksSection(map, node));
    parts.push(actionsSection(map, node));
    return parts;
  }

  function colorSection(map, item, opts) {
    var o = opts || {};
    var id = item.id;
    var isSummary = !!o.isSummary;
    var isRoot = !isSummary && item.parentId === null;
    var curColor = item.color || '#475569';
    var commitPatch = function (patch) {
      if (isSummary) app.updateSummary(id, patch);
      else app.updateNode(id, patch);
    };
    var livePatch = function (key, patch) {
      liveUpdate(key + ':' + id, function (m) {
        return isSummary ? MM.model.updateSummary(m, id, patch) : MM.model.updateNode(m, id, patch);
      });
    };

    var colors = MM.model.PALETTE.concat(isRoot ? [MM.model.ROOT_COLOR] : []);
    if (colors.indexOf(curColor) < 0) colors.push(curColor);
    var nativePicker = h('input', {
      type: 'color', 'class': 'color-native-input', value: curColor,
      'aria-label': 'Scegli un colore personalizzato', title: 'Scegli qualsiasi colore'
    });
    var hueSlider = h('input', {
      type: 'range', 'class': 'hue-slider', min: '0', max: '360', value: String(hexToHue(curColor)),
      'aria-label': 'Cursore tonalità colore', title: 'Trascina per creare il tuo colore'
    });
    var hexTag = h('span', { 'class': 'color-hex-tag' }, [curColor.toUpperCase()]);
    nativePicker.addEventListener('input', function () {
      var hex = nativePicker.value;
      hexTag.textContent = hex.toUpperCase();
      hueSlider.value = String(hexToHue(hex));
      livePatch('colore', { color: hex });
    });
    nativePicker.addEventListener('change', endTyping);
    hueSlider.addEventListener('input', function () {
      var hex = hslToHex(Number(hueSlider.value), 72, isRoot ? 34 : 46);
      nativePicker.value = hex;
      hexTag.textContent = hex.toUpperCase();
      livePatch('colore', { color: hex });
    });
    hueSlider.addEventListener('change', endTyping);
    var customColorRow = h('div', { 'class': 'color-custom-row' }, [nativePicker, hueSlider, hexTag]);

    var pastelFills = MM.model.PASTEL_FILLS || ['', '#FFFFFF', '#F8FAFC', '#EFF6FF', '#ECFEFF', '#ECFDF5', '#F0FDF4', '#FEFCE8', '#FFF7ED', '#FEF2F2', '#FDF2F8', '#FAF5FF', '#EEF2FF', '#F5F3FF', '#F1F5F9', '#FEF9C3'];
    var fillHueSlider = h('input', {
      type: 'range', 'class': 'hue-slider pastel-hue-slider', min: '0', max: '360',
      value: String(hexToHue(item.fillColor || curColor)),
      'aria-label': 'Cursore colore pastello di riempimento', title: 'Trascina per scegliere un riempimento pastello personalizzato'
    });
    fillHueSlider.addEventListener('input', function () {
      var hex = hslToHex(Number(fillHueSlider.value), 78, 93);
      livePatch('riempimento', { fillColor: hex });
    });
    fillHueSlider.addEventListener('change', endTyping);
    var fillSectionBlock = h('div', { 'class': 'fill-color-block' }, [
      h('div', { 'class': 'fill-color-label' }, ['Riempimento pastello (opzionale)']),
      h('div', { 'class': 'swatches fill-swatches', role: 'radiogroup', 'aria-label': 'Colore riempimento pastello' }, pastelFills.map(function (fc) {
        var sel = (item.fillColor || '').toLowerCase() === fc.toLowerCase();
        var lbl = fc ? 'Riempimento ' + fc : 'Riempimento automatico (predefinito)';
        return h('button', {
          type: 'button',
          'class': 'swatch fill-swatch' + (sel ? ' selected' : '') + (!fc ? ' fill-swatch-auto' : ''),
          role: 'radio', 'aria-checked': String(sel), 'aria-label': lbl, title: lbl,
          style: fc ? 'background:' + fc + ';color:#0F172A' : null,
          on: { click: function () { commitPatch({ fillColor: fc }); } }
        }, [!fc ? 'A' : (sel ? ico('check', { size: 12, strokeWidth: 2.5 }) : null)]);
      })),
      h('div', { 'class': 'color-custom-row' }, [
        fillHueSlider,
        item.fillColor ? h('button', {
          type: 'button', 'class': 'link-button', style: 'margin:0',
          on: { click: function () { commitPatch({ fillColor: '' }); } }
        }, ['Auto']) : null
      ])
    ]);

    return section('Colore (bordo e riempimento)', [
      h('div', { 'class': 'swatches', role: 'radiogroup', 'aria-label': 'Colore del nodo' }, colors.map(function (c, i) {
        var selected = c.toLowerCase() === curColor.toLowerCase();
        return h('button', {
          type: 'button', 'class': 'swatch' + (selected ? ' selected' : ''), role: 'radio',
          'aria-checked': String(selected), 'aria-label': 'Colore ' + (i + 1), title: c,
          style: 'background:' + c + ';color:' + MM.model.textColorFor(c),
          on: { click: function () { commitPatch({ color: c }); } }
        }, [selected ? ico('check', { size: 13, strokeWidth: 2.5 }) : null]);
      })),
      customColorRow,
      fillSectionBlock,
      !isSummary && !isRoot && item.children && item.children.length ? h('button', {
        type: 'button', 'class': 'link-button',
        on: { click: function () { applyColorToBranch(id); } }
      }, ['Usa questo colore per tutto il ramo']) : null
    ]);
  }

  function shapeSection(item, opts) {
    var o = opts || {};
    var id = item.id;
    var isSummary = !!o.isSummary;
    var curShape = item.shape || 'rounded';
    return section('Forma', [
      h('div', { 'class': 'segmented', role: 'radiogroup', 'aria-label': 'Forma del nodo' }, MM.model.SHAPES.map(function (s) {
        var selected = curShape === s;
        return h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(selected), 'class': selected ? 'selected' : '',
          on: { click: function () {
            if (isSummary) app.updateSummary(id, { shape: s }, { relayout: true });
            else app.updateNode(id, { shape: s }, { relayout: true });
          } }
        }, [SHAPE_LABELS[s]]);
      }))
    ]);
  }

  /* ---------- Immagini nei nodi ---------- */

  var IMG_MAX_SIDE = 420;

  /** Legge un file immagine, lo ridimensiona (lato max 420px) e lo comprime in WebP/JPEG leggero (~15-25 KB). */
  function loadImageFile(file) {
    return new Promise(function (resolve, reject) {
      if (!file || !/^image\//.test(file.type)) { reject(new Error('Il file scelto non è un\'immagine')); return; }
      var reader = new FileReader();
      reader.onerror = function () { reject(new Error('Impossibile leggere l\'immagine')); };
      reader.onload = function () {
        var img = new Image();
        img.onerror = function () { reject(new Error('Formato immagine non supportato')); };
        img.onload = function () {
          var w = img.naturalWidth || img.width;
          var hh = img.naturalHeight || img.height;
          if (!w || !hh) { reject(new Error('Immagine vuota')); return; }
          var k = Math.min(1, IMG_MAX_SIDE / Math.max(w, hh));
          var cw = Math.max(1, Math.round(w * k));
          var ch = Math.max(1, Math.round(hh * k));
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, cw, ch);
          // Preferisce WebP (supporta trasparenza ed è molto leggero); fallback a JPEG.
          var url = '';
          try { url = canvas.toDataURL('image/webp', 0.78); } catch (e) { url = ''; }
          if (url.indexOf('data:image/webp') !== 0) {
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, cw, ch);
            url = canvas.toDataURL('image/jpeg', 0.78);
          }
          resolve({ src: url, w: cw, h: ch });
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /** Aggiunge una o più immagini in coda a quelle già presenti nella casella. */
  function addNodeImages(nodeId, files) {
    if (app.isReadOnly && app.isReadOnly()) {
      toast('Sei in modalità Lettore: solo gli Editor possono modificare questa mappa', 'avviso');
      return;
    }
    if (!nodeId) { toast('Seleziona prima una casella', 'avviso'); return; }
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return f && /^image\//.test(f.type); });
    if (!list.length) return;
    var map = app.getMap();
    var node = map && map.nodes[nodeId];
    if (!node) return;
    var existing = MM.model.nodeImagesOf(node).slice();
    var max = MM.model.MAX_IMAGES_PER_NODE || 12;
    var space = max - existing.length;
    if (space <= 0) {
      toast('Hai già raggiunto il massimo di ' + max + ' immagini in questa casella', 'avviso');
      return;
    }
    var toLoad = list.slice(0, space);
    Promise.all(toLoad.map(loadImageFile)).then(function (loaded) {
      var freshMap = app.getMap();
      var freshNode = freshMap && freshMap.nodes[nodeId];
      if (!freshNode) return;
      var next = MM.model.nodeImagesOf(freshNode).concat(loaded).slice(0, max);
      if (app.updateNode(nodeId, { images: next }, { relayout: true })) {
        toast(loaded.length === 1 ? 'Immagine aggiunta' : loaded.length + ' immagini aggiunte', 'successo');
      }
    }, function (err) { toast(err.message, 'errore'); });
  }

  function removeNodeImageAt(nodeId, index) {
    var map = app.getMap();
    var node = map && map.nodes[nodeId];
    if (!node) return;
    var next = MM.model.nodeImagesOf(node).filter(function (_, i) { return i !== index; });
    app.updateNode(nodeId, { images: next.length ? next : null }, { relayout: true });
  }

  function addImagesToSummary(summaryId, files) {
    if (app.isReadOnly && app.isReadOnly()) {
      toast('Sei in modalità Lettore: solo gli Editor possono modificare questa mappa', 'avviso');
      return;
    }
    var list = Array.prototype.slice.call(files || []).filter(function (f) { return f && /^image\//.test(f.type); });
    if (!list.length) return;
    var map = app.getMap();
    var sum = (map && map.summaries || []).filter(function (s) { return s.id === summaryId; })[0];
    if (!sum) return;
    var existing = MM.model.nodeImagesOf(sum).slice();
    var max = MM.model.MAX_IMAGES_PER_NODE || 12;
    var space = max - existing.length;
    if (space <= 0) {
      toast('Hai già raggiunto il massimo di ' + max + ' immagini in questa casella', 'avviso');
      return;
    }
    Promise.all(list.slice(0, space).map(loadImageFile)).then(function (loaded) {
      var freshMap = app.getMap();
      var freshSum = (freshMap && freshMap.summaries || []).filter(function (s) { return s.id === summaryId; })[0];
      if (!freshSum) return;
      var next = MM.model.nodeImagesOf(freshSum).concat(loaded).slice(0, max);
      if (app.updateSummary(summaryId, { images: next }, { relayout: true })) {
        toast(loaded.length === 1 ? 'Immagine aggiunta' : loaded.length + ' immagini aggiunte', 'successo');
      }
    }, function (err) { toast(err.message, 'errore'); });
  }

  function removeSummaryImageAt(summaryId, index) {
    var map = app.getMap();
    var sum = (map && map.summaries || []).filter(function (s) { return s.id === summaryId; })[0];
    if (!sum) return;
    var next = MM.model.nodeImagesOf(sum).filter(function (_, i) { return i !== index; });
    app.updateSummary(summaryId, { images: next.length ? next : null }, { relayout: true });
  }

  function imageSection(node, opts) {
    var o = opts || {};
    var isSummary = !!o.isSummary;
    var id = node.id;
    var imgs = MM.model.nodeImagesOf ? MM.model.nodeImagesOf(node) : [];
    var max = MM.model.MAX_IMAGES_PER_NODE || 12;
    var picker = h('input', { type: 'file', accept: 'image/*', multiple: true, hidden: true, 'aria-hidden': 'true', tabindex: '-1' });
    picker.addEventListener('change', function () {
      var files = picker.files ? Array.prototype.slice.call(picker.files) : [];
      picker.value = '';
      if (files.length) {
        if (isSummary) addImagesToSummary(id, files);
        else addNodeImages(id, files);
      }
    });
    var children = [picker];
    if (imgs.length) {
      children.push(h('div', { 'class': 'image-grid' + (imgs.length === 1 ? ' single' : '') },
        imgs.map(function (im, idx) {
          return h('div', { 'class': 'image-thumb' }, [
            h('img', { src: im.src, alt: 'Immagine ' + (idx + 1) + ' della casella' }),
            h('button', {
              type: 'button', 'class': 'image-thumb-remove',
              title: 'Rimuovi immagine', 'aria-label': 'Rimuovi immagine ' + (idx + 1),
              on: { click: function () { if (isSummary) removeSummaryImageAt(id, idx); else removeNodeImageAt(id, idx); } }
            }, ['×'])
          ]);
        })
      ));
    }
    var btns = [];
    if (imgs.length < max) {
      btns.push(h('button', { type: 'button', 'class': 'image-add', on: { click: function () { picker.click(); } } }, [
        ico('image', { size: 16 }), imgs.length ? ' Aggiungi altre' : ' Aggiungi immagine'
      ]));
    }
    if (imgs.length > 1) {
      btns.push(h('button', {
        type: 'button', 'class': 'danger',
        on: { click: function () {
          if (isSummary) app.updateSummary(id, { images: null }, { relayout: true });
          else app.updateNode(id, { images: null }, { relayout: true });
        } }
      }, [ico('trash', { size: 16 }), ' Rimuovi tutte']));
    }
    if (btns.length) children.push(h('div', { 'class': 'prop-actions image-actions' }, btns));
    if (!imgs.length) {
      children.push(h('p', { 'class': 'dialog-hint image-hint' }, ['Puoi selezionarne più di una, trascinarle sulla casella o incollarle con ⌘V / Ctrl+V.']));
    }
    return section(imgs.length > 1 ? 'Immagini (' + imgs.length + ')' : 'Immagini', children);
  }

  /** Grandezza della casella: singolo nodo + "più grandi vicino al centro" per tutta la mappa. */
  function boxSizeSection(map, node, opts) {
    var o = opts || {};
    var isSummary = !!o.isSummary;
    var id = node.id;
    var current = node.boxSize || 'M';
    var sizes = MM.model.BOX_SIZES || [];
    var seg = h('div', { 'class': 'segmented box-size-seg', role: 'radiogroup', 'aria-label': 'Grandezza della casella' },
      sizes.map(function (b) {
        var selected = current === b.id;
        return h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(selected), 'class': selected ? 'selected' : '',
          title: b.label,
          on: { click: function () {
            if (isSummary) app.updateSummary(id, { boxSize: b.id }, { relayout: true });
            else app.updateNode(id, { boxSize: b.id }, { relayout: true });
          } }
        }, [b.label]);
      }));
    var byLevel = !(map.settings && map.settings.sizeByLevel === false);
    var check = h('input', { type: 'checkbox', id: 'prop-size-by-level' });
    check.checked = byLevel;
    check.addEventListener('change', function () { app.applySettings({ sizeByLevel: check.checked }); });
    var label = h('label', { 'class': 'check box-level-check', 'for': 'prop-size-by-level' },
      [check, ' Caselle più grandi vicino al centro (tutta la mappa)']);
    return section('Grandezza casella', [seg, label]);
  }

  function typographySection(map, node, opts) {
    var o = opts || {};
    var isSummary = !!o.isSummary;
    var id = node.id;
    var isRoot = !isSummary && node.parentId === null;
    var fonts = MM.model.WORD_FONTS || [];
    var sizes = MM.model.FONT_SIZES || [12, 14, 16, 18, 20, 24, 28, 32, 36];
    var textColors = MM.model.TEXT_COLORS || [];
    var activeFont = node.fontName || (map.settings && map.settings.fontName) || 'Arial';
    var activeSize = node.fontSize || '';
    var isBold = node.bold !== undefined && node.bold !== null ? !!node.bold : (isRoot || isSummary);
    var applyPatch = function (patch, options) {
      if (isSummary) app.updateSummary(id, patch, options);
      else app.updateNode(id, patch, options);
    };

    // 1. Menu a tendina dei 25 caratteri di Word
    var fontSelect = h('select', { id: 'prop-font', 'class': 'font-select', 'aria-label': 'Tipo di carattere' },
      fonts.map(function (f) {
        var opt = h('option', { value: f.name, style: 'font-family:' + f.css }, [f.name]);
        if (f.name === activeFont) opt.selected = true;
        return opt;
      }));
    fontSelect.style.fontFamily = MM.model.fontCssFor(activeFont);
    fontSelect.addEventListener('change', function () {
      var val = fontSelect.value;
      applyPatch({ fontName: val }, { relayout: true });
    });

    // 2. Menu a tendina grandezza carattere + A- / A+
    var sizeSelect = h('select', { id: 'prop-size', 'class': 'size-select', 'aria-label': 'Grandezza carattere' },
      [h('option', { value: '' }, ['Auto'])].concat(sizes.map(function (sz) {
        var opt = h('option', { value: String(sz) }, [String(sz)]);
        if (Number(activeSize) === sz) opt.selected = true;
        return opt;
      })));
    if (!activeSize) sizeSelect.value = '';
    sizeSelect.addEventListener('change', function () {
      var val = sizeSelect.value ? parseInt(sizeSelect.value, 10) : null;
      applyPatch({ fontSize: val }, { relayout: true });
    });

    function stepSize(delta) {
      var cur = node.fontSize || (isRoot ? 20 : 16);
      var next = Math.max(10, Math.min(48, cur + delta));
      applyPatch({ fontSize: next }, { relayout: true });
    }

    var fontRow = h('div', { 'class': 'font-row' }, [fontSelect, sizeSelect]);

    // 3. Barra stile Microsoft Word: G, C, S, Barrato, AA, A-, A+
    var wordBar = h('div', { 'class': 'word-toolbar', role: 'group', 'aria-label': 'Stile del carattere' }, [
      h('button', {
        type: 'button', 'class': 'word-btn word-bold' + (isBold ? ' selected' : ''),
        'aria-pressed': String(isBold), title: 'Grassetto',
        on: { click: function () { applyPatch({ bold: !isBold }, { relayout: true }); } }
      }, ['G']),
      h('button', {
        type: 'button', 'class': 'word-btn word-italic' + (node.italic ? ' selected' : ''),
        'aria-pressed': String(!!node.italic), title: 'Corsivo',
        on: { click: function () { applyPatch({ italic: !node.italic }, { relayout: true }); } }
      }, ['C']),
      h('button', {
        type: 'button', 'class': 'word-btn word-underline' + (node.underline ? ' selected' : ''),
        'aria-pressed': String(!!node.underline), title: 'Sottolineato',
        on: { click: function () { applyPatch({ underline: !node.underline }); } }
      }, ['S']),
      h('button', {
        type: 'button', 'class': 'word-btn word-strike' + (node.strike ? ' selected' : ''),
        'aria-pressed': String(!!node.strike), title: 'Barrato',
        on: { click: function () { applyPatch({ strike: !node.strike }); } }
      }, ['S']),
      h('button', {
        type: 'button', 'class': 'word-btn' + (node.uppercase ? ' selected' : ''),
        'aria-pressed': String(!!node.uppercase), title: 'Tutto maiuscolo',
        on: { click: function () { applyPatch({ uppercase: !node.uppercase }, { relayout: true }); } }
      }, ['AA']),
      h('button', {
        type: 'button', 'class': 'word-btn', title: 'Riduci dimensione testo',
        on: { click: function () { stepSize(-2); } }
      }, ['A−']),
      h('button', {
        type: 'button', 'class': 'word-btn', title: 'Aumenta dimensione testo',
        on: { click: function () { stepSize(2); } }
      }, ['A+'])
    ]);

    // 3b. Barra paragrafo: punti elenco + 4 allineamenti (sinistra, centro, destra, giustificato)
    var curAlign = node.textAlign || 'center';
    var paraBar = h('div', { 'class': 'word-toolbar para-toolbar', role: 'group', 'aria-label': 'Elenco e allineamento testo' }, [
      h('button', {
        type: 'button', 'class': 'word-btn' + (node.bullets ? ' selected' : ''),
        'aria-pressed': String(!!node.bullets), title: 'Punti elenco', 'aria-label': 'Punti elenco',
        on: { click: function () { applyPatch({ bullets: !node.bullets }, { relayout: true }); } }
      }, [ico('list-bullet', { size: 15 }) || '•']),
      h('button', {
        type: 'button', 'class': 'word-btn' + (curAlign === 'left' ? ' selected' : ''),
        'aria-pressed': String(curAlign === 'left'), title: 'Allinea a sinistra', 'aria-label': 'Allinea a sinistra',
        on: { click: function () { applyPatch({ textAlign: 'left' }); } }
      }, [ico('align-left', { size: 15 }) || 'L']),
      h('button', {
        type: 'button', 'class': 'word-btn' + (curAlign === 'center' ? ' selected' : ''),
        'aria-pressed': String(curAlign === 'center'), title: 'Centra testo', 'aria-label': 'Centra testo',
        on: { click: function () { applyPatch({ textAlign: 'center' }); } }
      }, [ico('align-center', { size: 15 }) || 'C']),
      h('button', {
        type: 'button', 'class': 'word-btn' + (curAlign === 'right' ? ' selected' : ''),
        'aria-pressed': String(curAlign === 'right'), title: 'Allinea a destra', 'aria-label': 'Allinea a destra',
        on: { click: function () { applyPatch({ textAlign: 'right' }); } }
      }, [ico('align-right', { size: 15 }) || 'R']),
      h('button', {
        type: 'button', 'class': 'word-btn' + (curAlign === 'justify' ? ' selected' : ''),
        'aria-pressed': String(curAlign === 'justify'), title: 'Giustificato', 'aria-label': 'Giustificato',
        on: { click: function () { applyPatch({ textAlign: 'justify' }); } }
      }, [ico('align-justify', { size: 15 }) || 'J'])
    ]);

    // 4. Colore del testo (Automatico + colori rapidi)
    var colorRow = h('div', { 'class': 'text-color-row', role: 'radiogroup', 'aria-label': 'Colore del testo' },
      textColors.map(function (tc) {
        var sel = (node.textColor || '').toLowerCase() === tc.toLowerCase();
        var label = tc ? 'Colore testo ' + tc : 'Colore testo automatico';
        return h('button', {
          type: 'button',
          'class': 'text-swatch' + (sel ? ' selected' : '') + (!tc ? ' text-swatch-auto' : ''),
          role: 'radio', 'aria-checked': String(sel), 'aria-label': label, title: label,
          style: tc ? 'background:' + tc : null,
          on: { click: function () { applyPatch({ textColor: tc }); } }
        }, [!tc ? 'A' : '']);
      }));

    // 5. Applica questo carattere a tutta la mappa
    var applyAll = h('button', {
      type: 'button', 'class': 'link-button',
      on: {
        click: function () {
          if (app.applySettings({ fontFamily: 'standard', fontName: activeFont })) {
            toast('Carattere "' + activeFont + '" applicato a tutta la mappa', 'successo');
          }
        }
      }
    }, ['Applica «' + activeFont + '» a tutta la mappa']);

    return section('Carattere', [fontRow, wordBar, paraBar, colorRow, applyAll]);
  }

  function iconSection(node, opts) {
    var o = opts || {};
    var isSummary = !!o.isSummary;
    var id = node.id;
    var rebuild = function () {
      renderProperties(app.getMap(), isSummary ? { summaryId: id } : { nodeId: id }, true);
    };
    var setIcon = function (val) {
      if (isSummary) app.updateSummary(id, { icon: val }, { relayout: true });
      else app.updateNode(id, { icon: val }, { relayout: true });
    };
    var tabs = h('div', { 'class': 'segmented icon-tabs', role: 'tablist', 'aria-label': 'Tipo di icona' }, [
      h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(iconTab === 'simboli'),
        'class': iconTab === 'simboli' ? 'selected' : '',
        on: { click: function () { iconTab = 'simboli'; rebuild(); } }
      }, ['Simboli']),
      h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(iconTab === 'emoji'),
        'class': iconTab === 'emoji' ? 'selected' : '',
        on: { click: function () { iconTab = 'emoji'; rebuild(); } }
      }, ['Emoji'])
    ]);

    var noneBtn = h('button', {
      type: 'button', 'class': 'icon-choice' + (!node.icon ? ' selected' : ''), title: 'Nessuna icona',
      'aria-label': 'Nessuna icona', 'aria-pressed': String(!node.icon),
      on: { click: function () { setIcon(''); } }
    }, [ico('close', { size: 15 }) || '∅']);

    var buttons = [noneBtn];
    var content = [tabs];
    if (iconTab === 'simboli' && MM.icons && MM.icons.NODE_ICONS) {
      MM.icons.NODE_ICONS.forEach(function (item) {
        var val = 'svg:' + item.id;
        var selected = node.icon === val;
        buttons.push(h('button', {
          type: 'button', 'class': 'icon-choice' + (selected ? ' selected' : ''),
          title: item.label, 'aria-label': item.label, 'aria-pressed': String(selected),
          on: { click: function () { setIcon(val); } }
        }, [MM.icons.createSvg(item.id, { node: true, size: 17 })]));
      });
      content.push(h('div', { 'class': 'icon-grid icon-grid-scroll' }, buttons));
    } else {
      var cats = (MM.icons && MM.icons.EMOJI_CATEGORIES) || null;
      var activeList = EMOJI;
      if (cats && cats.length) {
        var activeObj = cats.filter(function (c) { return c.id === emojiCat; })[0] || cats[0];
        emojiCat = activeObj.id;
        activeList = activeObj.emojis;
        content.push(h('div', { 'class': 'emoji-cats', role: 'tablist', 'aria-label': 'Categorie emoji' },
          cats.map(function (c) {
            var isSel = c.id === emojiCat;
            return h('button', {
              type: 'button', role: 'tab', 'aria-selected': String(isSel),
              'class': 'emoji-cat-btn' + (isSel ? ' selected' : ''),
              title: c.label, 'aria-label': c.label,
              on: { click: function () { emojiCat = c.id; rebuild(); } }
            }, [c.icon]);
          })
        ));
      }
      activeList.forEach(function (em) {
        var selected = node.icon === em;
        buttons.push(h('button', {
          type: 'button', 'class': 'icon-choice' + (selected ? ' selected' : ''),
          'aria-pressed': String(selected), 'aria-label': 'Emoji ' + em,
          on: { click: function () { setIcon(em); } }
        }, [em]));
      });
      content.push(h('div', { 'class': 'icon-grid icon-grid-scroll emoji-grid' }, buttons));
    }

    return section('Icona', content);
  }

  function actionsSection(map, node) {
    var id = node.id;
    var actions = [];
    var isRoot = node.parentId === null;
    var parent = !isRoot && map ? map.nodes[node.parentId] : null;
    if (parent && parent.children.length >= 2 && app.addSummaryForNode) {
      actions.push(h('button', { type: 'button', on: { click: function () { app.addSummaryForNode(id); } } }, [
        ico('brace', { size: 16 }), 'Unisci con parentesi graffa'
      ]));
    }
    if (!isRoot && app.toggleUnlock) {
      var unlocked = app.state && app.state.unlockedId === id;
      actions.push(h('button', {
        type: 'button', 'class': unlocked ? 'lock-btn-open' : '',
        on: { click: function () { app.toggleUnlock(id); } }
      }, [
        ico(unlocked ? 'unlock' : 'lock', { size: 16 }),
        unlocked ? 'Lucchetto aperto (trascina su un altro nodo)' : 'Sblocca per spostare su un altro nodo'
      ]));
    }
    if (app.copyNode) {
      actions.push(h('button', { type: 'button', on: { click: function () { app.copyNode(id); } } }, [
        ico('copy', { size: 16 }), 'Copia ramo (⌘C)'
      ]));
    }
    if (!isRoot && app.cutNode) {
      actions.push(h('button', { type: 'button', on: { click: function () { app.cutNode(id); } } }, [
        ico('scissors', { size: 16 }), 'Stacca / Taglia ramo (⌘X)'
      ]));
    }
    var clip = app.getClipboard ? app.getClipboard() : null;
    if (clip && app.pasteNode) {
      actions.push(h('button', { type: 'button', 'class': 'primary-soft', on: { click: function () { app.pasteNode(id); } } }, [
        ico('clipboard', { size: 16 }),
        clip.mode === 'cut' ? 'Attacca qui il ramo (⌘V)' : 'Incolla ramo qui (⌘V)'
      ]));
    }
    if (node.children.length) {
      actions.push(h('button', { type: 'button', on: { click: function () { app.toggleCollapsed(id); } } }, [
        ico(node.collapsed ? 'folder-open' : 'folder', { size: 16 }),
        node.collapsed ? 'Espandi il ramo' : 'Comprimi il ramo'
      ]));
    }
    if (!isRoot) {
      actions.push(h('button', { type: 'button', 'class': 'danger', on: { click: function () { app.deleteSelection(); } } }, [
        ico('trash', { size: 16 }),
        'Elimina' + (node.children.length ? ' (con il ramo)' : '')
      ]));
    }
    return actions.length ? section('Azioni', [h('div', { 'class': 'prop-actions' }, actions)]) : null;
  }

  function applyColorToBranch(nodeId) {
    app.tryCommit(function (m) {
      var color = m.nodes[nodeId].color;
      var out = m;
      MM.model.getDescendants(m, nodeId).forEach(function (d) { out = MM.model.updateNode(out, d, { color: color }); });
      return out;
    });
  }

  function linkPanel(map, link) {
    var from = map.nodes[link.fromId];
    var to = map.nodes[link.toId];
    var curStyle = link.style || 'curved';
    var curCurve = typeof link.curve === 'number' ? link.curve : 0;
    var styles = MM.model.LINK_STYLES || ['curved', 'straight', 'elbow'];
    var curveValOut = h('span', { 'class': 'color-hex-tag' }, [curCurve === 0 ? 'Auto' : String(curCurve)]);
    var curveSlider = h('input', {
      type: 'range', 'class': 'curve-slider', min: '-260', max: '260', step: '5',
      value: String(curCurve), 'aria-label': 'Curvatura della freccia'
    });
    curveSlider.addEventListener('input', function () {
      var val = parseInt(curveSlider.value, 10) || 0;
      curveValOut.textContent = val === 0 ? 'Auto' : String(val);
      liveUpdate('link-curve:' + link.id, function (m) {
        return MM.model.updateLink(m, link.id, { style: curStyle === 'elbow' ? 'elbow' : 'curved', curve: val });
      });
    });
    curveSlider.addEventListener('change', endTyping);

    return [
      panelHeader('Collegamento', 'link'),
      section('Dettagli', [
        h('p', { 'class': 'prop-hint', text: '«' + from.text + '» → «' + to.text + '»' }),
        textField('prop-etichetta', 'Etichetta (es. “causa”, “è formato da”)', link.label, {
          max: MM.model.MAX_TEXT, placeholder: 'Scrivi il legame…',
          onInput: function (v) {
            liveUpdate('link:' + link.id, function (m) { return MM.model.updateLink(m, link.id, { label: v }); });
          }
        }),
        h('div', { 'class': 'label-suggestions', role: 'group', 'aria-label': 'Etichette frequenti' },
          LINK_LABELS.map(function (lbl) {
            return h('button', {
              type: 'button', 'class': 'chip',
              on: { click: function () { app.tryCommit(function (m) { return MM.model.updateLink(m, link.id, { label: lbl }); }); } }
            }, [lbl]);
          }))
      ]),
      section('Forma della freccia', [
        h('div', { 'class': 'segmented', role: 'radiogroup', 'aria-label': 'Stile della freccia' }, styles.map(function (st) {
          var selected = curStyle === st;
          return h('button', {
            type: 'button', role: 'radio', 'aria-checked': String(selected), 'class': selected ? 'selected' : '',
            on: { click: function () { app.tryCommit(function (m) { return MM.model.updateLink(m, link.id, { style: st }); }); } }
          }, [LINK_STYLE_LABELS[st] || st]);
        })),
        curStyle !== 'straight' ? h('div', { 'class': 'curve-row' }, [
          h('span', { 'class': 'curve-label' }, ['Curva']),
          curveSlider,
          curveValOut
        ]) : null,
        curStyle !== 'straight' && curCurve !== 0 ? h('button', {
          type: 'button', 'class': 'link-button',
          on: { click: function () { app.tryCommit(function (m) { return MM.model.updateLink(m, link.id, { curve: 0 }); }); } }
        }, ['Ripristina curva automatica']) : null,
        h('p', { 'class': 'dialog-hint image-hint' }, ['Puoi anche trascinare il pallino blu sulla freccia per curvarla a mano.'])
      ]),
      section('Azioni', [
        h('div', { 'class': 'prop-actions' }, [
          h('button', { type: 'button', on: { click: function () {
            app.tryCommit(function (m) { return MM.model.reverseLink(m, link.id); });
          } } }, [ico('switch', { size: 16 }), 'Inverti la freccia']),
          h('button', { type: 'button', on: { click: function () { app.select(link.fromId); } } }, [
            ico('arrow-left', { size: 16 }), 'Vai al primo nodo'
          ]),
          h('button', { type: 'button', 'class': 'danger', on: { click: function () { app.deleteSelection(); } } }, [
            ico('trash', { size: 16 }), 'Elimina collegamento'
          ])
        ])
      ])
    ];
  }

  /** Collegamenti trasversali del nodo, con pulsante per crearne uno nuovo. */
  function linksSection(map, node) {
    var links = MM.model.getLinksOf(map, node.id);
    var items = links.map(function (l) {
      var outgoing = l.fromId === node.id;
      var other = map.nodes[outgoing ? l.toId : l.fromId];
      var text = (outgoing ? '→ ' : '← ') + other.text.replace(/\s+/g, ' ') + (l.label ? ' (' + l.label + ')' : '');
      return h('li', null, [h('button', {
        type: 'button', 'class': 'link-item',
        on: { click: function () { app.selectLink(l.id); } }
      }, [text])]);
    });
    return section('Collegamenti', [
      links.length ? h('ul', { 'class': 'link-list' }, items)
        : h('p', { 'class': 'prop-hint', text: 'Collega questa idea a un\'altra di un ramo diverso (es. «causa», «è formato da»).' }),
      h('button', { type: 'button', on: { click: function () { MM.interactions.startLinkMode(); } } }, [
        ico('link', { size: 16 }), 'Collega a un altro nodo (L)'
      ])
    ]);
  }

  function multiSelectionPanel(map, ids) {
    var count = ids.length;
    var colors = MM.model.PALETTE.slice(0, 16);
    var deletable = ids.filter(function (id) { return map.nodes[id] && map.nodes[id].parentId !== null; });
    return [
      panelHeader(count + ' nodi selezionati', 'layers'),
      section('Azioni sulla selezione', [
        h('p', { 'class': 'prop-hint', text: 'Puoi unire tutti i nodi selezionati con una parentesi graffa o cambiare il loro colore.' }),
        h('div', { 'class': 'prop-actions' }, [
          h('button', {
            type: 'button', 'class': 'primary-soft',
            on: { click: function () { if (app.addSummaryForSelection) app.addSummaryForSelection(); } }
          }, [ico('brace', { size: 16 }), 'Unisci ' + count + ' nodi con parentesi graffa']),
          deletable.length ? h('button', {
            type: 'button', 'class': 'danger',
            on: { click: function () { app.deleteSelection(); } }
          }, [ico('trash', { size: 16 }), 'Elimina selezionati (' + deletable.length + ')']) : null,
          h('button', {
            type: 'button',
            on: { click: function () { if (app.setMultiSelection) app.setMultiSelection([]); } }
          }, [ico('close', { size: 16 }), 'Deseleziona'])
        ])
      ]),
      section('Colore per tutti i nodi selezionati', [
        h('div', { 'class': 'swatches', role: 'radiogroup', 'aria-label': 'Colore per la selezione' }, colors.map(function (c, i) {
          return h('button', {
            type: 'button', 'class': 'swatch', role: 'radio',
            'aria-checked': 'false', 'aria-label': 'Colore ' + (i + 1), title: c,
            style: 'background:' + c + ';color:' + MM.model.textColorFor(c),
            on: { click: function () { if (app.updateMultiNodes) app.updateMultiNodes({ color: c }); } }
          });
        }))
      ])
    ];
  }

  function summaryPanel(map, summary) {
    var isMultiNodes = Array.isArray(summary.nodeIds) && summary.nodeIds.length > 0;
    var parent = summary.parentId ? map.nodes[summary.parentId] : null;
    var siblings = !isMultiNodes && parent ? parent.children.filter(function (cid) { return !!map.nodes[cid]; }) : [];
    var rangeSection = null;
    if (isMultiNodes) {
      var names = summary.nodeIds
        .filter(function (cid) { return !!map.nodes[cid]; })
        .map(function (cid) { return '• ' + map.nodes[cid].text.replace(/\s+/g, ' ').slice(0, 34); });
      rangeSection = section('Nodi uniti (' + names.length + ')', [
        h('p', { 'class': 'prop-hint', style: 'white-space:pre-line', text: names.join('\n') })
      ]);
    } else if (siblings.length) {
      var startSel = h('select', { id: 'prop-sum-start', 'class': 'font-select', 'aria-label': 'Primo nodo della graffa' },
        siblings.map(function (cid) {
          var opt = h('option', { value: cid }, [map.nodes[cid].text.replace(/\s+/g, ' ').slice(0, 36)]);
          if (cid === summary.startId) opt.selected = true;
          return opt;
        }));
      var endSel = h('select', { id: 'prop-sum-end', 'class': 'font-select', 'aria-label': 'Ultimo nodo della graffa' },
        siblings.map(function (cid) {
          var opt = h('option', { value: cid }, [map.nodes[cid].text.replace(/\s+/g, ' ').slice(0, 36)]);
          if (cid === summary.endId) opt.selected = true;
          return opt;
        }));
      startSel.addEventListener('change', function () {
        app.updateSummary(summary.id, { startId: startSel.value });
      });
      endSel.addEventListener('change', function () {
        app.updateSummary(summary.id, { endId: endSel.value });
      });
      rangeSection = section('Nodi uniti dalla graffa', [
        h('div', { 'class': 'field' }, [h('label', { 'for': 'prop-sum-start', text: 'Da nodo' }), startSel]),
        h('div', { 'class': 'field' }, [h('label', { 'for': 'prop-sum-end', text: 'A nodo' }), endSel])
      ]);
    }
    var sumOpts = { isSummary: true };
    var commentChildren = [
      textField('prop-commento', 'Commento (evidenzia in giallo)', summary.comment || '', {
        multiline: true, rows: 3, placeholder: 'Aggiungi un commento…',
        onInput: function (v) {
          liveUpdate('sum-commento:' + summary.id, function (m) { return MM.model.updateSummary(m, summary.id, { comment: v }); });
        }
      })
    ];
    if (summary.comment) {
      commentChildren.push(h('button', {
        type: 'button', 'class': 'link-button',
        on: { click: function () { app.updateSummary(summary.id, { comment: '' }); } }
      }, ['Rimuovi commento']));
    }
    return [
      panelHeader('Riepilogo (graffa)', 'brace'),
      section('Contenuto', [
        textField('prop-sum-text', 'Testo', summary.text || '', {
          multiline: true, rows: 2, max: MM.model.MAX_TEXT, placeholder: 'Scrivi il riepilogo…',
          onInput: function (v) {
            liveUpdate('summary:' + summary.id, function (m) { return MM.model.updateSummary(m, summary.id, { text: v || ' ' }); }, true);
          }
        }),
        textField('prop-nota', 'Nota (spiegazione, appunti)', summary.note || '', {
          multiline: true, rows: 3, placeholder: 'Scrivi qui i dettagli…',
          onInput: function (v) {
            liveUpdate('sum-nota:' + summary.id, function (m) { return MM.model.updateSummary(m, summary.id, { note: v }); });
          }
        })
      ]),
      section('Commento', commentChildren),
      rangeSection,
      typographySection(map, summary, sumOpts),
      colorSection(map, summary, sumOpts),
      shapeSection(summary, sumOpts),
      boxSizeSection(map, summary, sumOpts),
      imageSection(summary, sumOpts),
      iconSection(summary, sumOpts),
      section('Azioni', [
        h('div', { 'class': 'prop-actions' }, [
          h('button', { type: 'button', on: { click: function () { app.addNode('figlio'); } } }, [
            ico('plus', { size: 16 }), 'Aggiungi figlio al riepilogo (Tab)'
          ]),
          h('button', { type: 'button', on: { click: function () { app.addNode('fratello'); } } }, [
            ico('sibling', { size: 16 }), 'Aggiungi nodo fratello (Invio)'
          ]),
          h('button', { type: 'button', 'class': 'danger', on: { click: function () { app.deleteSummary(summary.id); } } }, [
            ico('trash', { size: 16 }), 'Elimina parentesi graffa'
          ])
        ])
      ])
    ];
  }

  /**
   * Aggiorna il pannello. Se l'utente sta scrivendo in un campo del pannello,
   * il pannello non viene ricostruito (per non perdere cursore e focus).
   */
  function renderProperties(map, selection, forceRebuild) {
    if (!panel || !map) return;
    var sel = selection || {};
    var multi = Array.isArray(sel.selectedIds) && sel.selectedIds.length >= 2 ? sel.selectedIds : null;
    var summary = !multi && sel.summaryId ? (map.summaries || []).filter(function (s) { return s.id === sel.summaryId; })[0] : null;
    var link = !multi && !summary && sel.linkId ? app.findLink(sel.linkId) : null;
    var node = !multi && !summary && !link && sel.nodeId ? map.nodes[sel.nodeId] : null;
    var key = multi ? 'm:' + multi.join(',') : summary ? 's:' + summary.id : link ? 'l:' + link.id : node ? 'n:' + node.id : '';
    var active = document.activeElement;
    if (!forceRebuild && key === panelKey && active && panel.contains(active) &&
        (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
      return;
    }
    // Stesso elemento selezionato: si conserva la posizione di scorrimento.
    var scroll = key === panelKey ? panel.scrollTop : 0;
    panel.textContent = '';
    panelKey = key;
    var parts = multi ? multiSelectionPanel(map, multi)
      : summary ? summaryPanel(map, summary)
      : link ? linkPanel(map, link)
      : node ? nodePanel(map, node) : [];
    parts.forEach(function (p) { if (p) panel.appendChild(p); });
    panel.hidden = !parts.length;
    panel.scrollTop = scroll;
  }

  function focusLinkLabel() {
    if (app && typeof app.toggleProperties === 'function' && !app.isPropertiesOpen()) {
      app.toggleProperties(true);
    }
    var input = document.getElementById('prop-etichetta');
    if (input) { input.focus(); input.select(); }
  }

  /* ---------- Finestre modali ---------- */

  function openDialog(dlg) {
    closeMenus();
    if (!dlg) return;
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }

  function closeDialogs() {
    $all('dialog[open]').forEach(function (d) {
      if (typeof d.close === 'function') d.close(); else d.removeAttribute('open');
    });
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    try {
      return d.toLocaleString('it-IT', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) {
      return d.toISOString().slice(0, 16).replace('T', ' ');
    }
  }

  function fillMapList() {
    var list = document.getElementById('lista-mappe');
    if (!list) return;
    list.textContent = '';
    var current = app.getMap();
    var maps = MM.storage.listMaps();
    if (!maps.length) {
      list.appendChild(h('li', { 'class': 'empty', text: 'Nessuna mappa salvata.' }));
      return;
    }
    maps.forEach(function (s) {
      var isCurrent = current && current.id === s.id;
      var open = h('button', {
        type: 'button', 'class': 'map-open',
        on: { click: function () { closeDialogs(); if (!isCurrent) app.openMap(s.id); } }
      }, [
        h('span', { 'class': 'map-name', text: s.title || 'Mappa senza titolo' }),
        h('span', { 'class': 'map-date', text: (isCurrent ? 'aperta ora · ' : '') + 'modificata il ' + formatDate(s.updatedAt) })
      ]);
      var dup = h('button', {
        type: 'button', title: 'Duplica', 'aria-label': 'Duplica ' + s.title,
        on: {
          click: function () {
            try {
              if (isCurrent) app.saveNow();
              var copy = MM.storage.duplicateMap(s.id);
              if (MM.sync && copy) MM.sync.pushMap(copy);
              toast('Copia creata', 'successo');
              fillMapList();
            } catch (e) { toast(e.message, 'errore'); }
          }
        }
      }, [ico('copy', { size: 16 })]);
      var del = h('button', {
        type: 'button', 'class': 'danger', title: 'Elimina', 'aria-label': 'Elimina ' + s.title,
        on: {
          click: function () {
            if (!root.confirm('Eliminare la mappa "' + s.title + '"? L\'operazione non si può annullare.')) return;
            app.deleteMap(s.id);
            toast('Mappa eliminata');
            fillMapList();
          }
        }
      }, [ico('trash', { size: 16 })]);
      list.appendChild(h('li', { 'class': isCurrent ? 'current' : '' }, [open, dup, del]));
    });
  }

  function refreshMapList() {
    var dlg = document.getElementById('dlg-mappe');
    if (dlg && dlg.open) fillMapList();
  }

  function openMapList() {
    app.saveNow();
    fillMapList();
    openDialog(document.getElementById('dlg-mappe'));
  }

  function openHelp() {
    if (MM.pwa) MM.pwa.refreshHelp();
    openDialog(document.getElementById('dlg-aiuto'));
  }

  /* ---------- Sincronizzazione ---------- */

  function syncDotClass(status) {
    if (status === 'synced') return 'sync-dot sync-dot-synced';
    if (status === 'syncing' || status === 'connecting') return 'sync-dot sync-dot-syncing';
    if (status === 'offline') return 'sync-dot sync-dot-offline';
    if (status === 'error') return 'sync-dot sync-dot-error';
    return 'sync-dot sync-dot-local';
  }

  function syncIconName(status) {
    if (status === 'synced') return 'cloud-check';
    if (status === 'offline') return 'cloud-off';
    return 'cloud';
  }

  function syncShortLabel(s) {
    switch (s.status) {
      case 'synced': return 'Sincronizzato';
      case 'syncing': return 'Sincronizzo…';
      case 'connecting': return 'Connessione…';
      case 'offline': return 'Offline';
      case 'error': return 'Errore sync';
      case 'signed-out': return 'Accedi';
      default: return 'Locale';
    }
  }

  function updateSyncUi(s) {
    if (!s) return;
    // 1. Pulsante nella barra superiore
    var badge = document.getElementById('sync-badge');
    var icoHost = document.getElementById('sync-ico');
    var label = document.getElementById('sync-label');
    var btn = document.getElementById('btn-sync');
    if (badge) badge.className = syncDotClass(s.status);
    if (icoHost && MM.icons) {
      var svg = ico(syncIconName(s.status), { size: 18 });
      if (svg) { icoHost.textContent = ''; icoHost.appendChild(svg); }
    }
    if (label) label.textContent = syncShortLabel(s);
    if (btn) {
      btn.title = s.user
        ? 'Sincronizzazione attiva (' + (s.user.email || 'account connesso') + ')'
        : 'Sincronizzazione Mac ↔ iPad: ' + syncShortLabel(s);
    }

    // 2. Contenuto della finestra #dlg-sync
    var dot = document.getElementById('sync-modal-dot');
    var titleEl = document.getElementById('sync-status-title');
    var descEl = document.getElementById('sync-status-desc');
    var authSec = document.getElementById('sync-auth-section');
    var accSec = document.getElementById('sync-account-section');
    var cfgDetails = document.getElementById('sync-config-details');
    var clearBtn = document.getElementById('btn-sync-clear-cfg');
    var userEmailEl = document.getElementById('sync-user-email');
    var lastTimeEl = document.getElementById('sync-last-time');
    if (!dot || !titleEl || !descEl) return;

    dot.className = syncDotClass(s.status);

    var title = 'Modalità locale';
    var desc = 'Le mappe sono salvate solo in questo browser.';
    if (!s.supported) {
      title = 'Sincronizzazione non disponibile da file locale';
      desc = 'Apri l\'app dal sito web (GitHub Pages o localhost) per sincronizzare tra Mac e iPad.';
    } else if (s.status === 'unconfigured') {
      title = 'Firebase non configurato';
      desc = 'Incolla la tua configurazione Firebase qui sotto per sincronizzare le mappe tra Mac e iPad.';
    } else if (s.status === 'connecting') {
      title = 'Connessione a Firebase…';
      desc = 'Preparo il servizio di sincronizzazione.';
    } else if (s.status === 'signed-out') {
      title = 'Pronto per accedere';
      desc = 'Accedi con lo stesso account su Mac e iPad per tenere le mappe sincronizzate in tempo reale.';
    } else if (s.status === 'synced') {
      title = 'Sincronizzato in tempo reale';
      desc = 'Ogni modifica viene salvata sul cloud e appare subito sugli altri dispositivi.';
    } else if (s.status === 'syncing') {
      title = 'Sincronizzazione in corso…';
      desc = 'Invio o ricezione delle mappe aggiornate.';
    } else if (s.status === 'offline') {
      title = 'Offline (modifiche in coda)';
      desc = 'Continua pure a lavorare: le modifiche verranno sincronizzate appena torna la connessione.';
    } else if (s.status === 'error') {
      title = 'Errore di sincronizzazione';
      desc = s.error || 'Impossibile completare la sincronizzazione.';
    }

    titleEl.textContent = title;
    descEl.textContent = desc;

    var hasUser = !!s.user;
    var canAuth = s.supported && !hasUser && s.status !== 'unconfigured' && s.status !== 'connecting';
    if (authSec) authSec.hidden = !canAuth;
    if (accSec) accSec.hidden = !hasUser;
    if (hasUser) {
      if (userEmailEl) userEmailEl.textContent = s.user.email || s.user.displayName || s.user.uid;
      if (lastTimeEl) {
        lastTimeEl.textContent = s.lastSyncAt
          ? 'Ultimo aggiornamento: ' + formatDate(s.lastSyncAt)
          : 'In attesa del primo aggiornamento…';
      }
    }
    if (cfgDetails && s.supported && s.status === 'unconfigured') {
      cfgDetails.open = true;
    }
    if (clearBtn) {
      clearBtn.disabled = s.configSource !== 'local';
    }

    // 3. Coworking (pillola nella barra superiore + sezione dentro #dlg-sync)
    var coworkBadge = document.getElementById('cowork-badge');
    var coworkInactive = document.getElementById('cowork-inactive');
    var coworkActive = document.getElementById('cowork-active');
    var codeEl = document.getElementById('cowork-code-display');
    var peersEl = document.getElementById('cowork-peers-list');
    var sh = s.shared;
    if (coworkBadge) {
      if (sh) {
        var onlineCount = (sh.peers && sh.peers.length) ? sh.peers.length : 1;
        var isViewer = sh.myRole === 'viewer';
        coworkBadge.hidden = false;
        coworkBadge.classList.toggle('readonly', isViewer);
        coworkBadge.textContent = isViewer ? 'Solo lettura · ' + onlineCount + ' online' : '● ' + onlineCount + ' online';
        coworkBadge.title = 'Mappa condivisa (' + sh.shareId + ') — ' + (isViewer ? 'Lettore (solo lettura)' : (sh.isOwner ? 'Amministratore' : 'Editor'));
      } else {
        coworkBadge.hidden = true;
        coworkBadge.classList.remove('readonly');
      }
    }
    if (coworkInactive && coworkActive) {
      coworkInactive.hidden = !!sh;
      coworkActive.hidden = !sh;
      if (sh) {
        if (codeEl) codeEl.textContent = sh.shareId;
        var rolePill = document.getElementById('cowork-my-role');
        if (rolePill) {
          rolePill.textContent = sh.isOwner ? 'Amministratore' : (sh.myRole === 'viewer' ? 'Lettore' : 'Editor');
        }
        var adminPanel = document.getElementById('cowork-admin-panel');
        if (adminPanel) adminPanel.hidden = !sh.isOwner;
        var delSharedBtn = document.getElementById('btn-cowork-delete');
        if (delSharedBtn) delSharedBtn.hidden = !sh.isOwner;
        var defRoleSel = document.getElementById('cowork-default-role');
        if (defRoleSel) defRoleSel.value = sh.defaultRole === 'viewer' ? 'viewer' : 'editor';

        // Elenco permessi partecipanti + invitati (modificabile solo dall'amministratore)
        var membersBlock = document.getElementById('cowork-invites-block');
        var membersList = document.getElementById('cowork-members-list');
        if (membersBlock && membersList && sh.isOwner) {
          membersList.textContent = '';
          var entries = [];
          var seenEmails = {};
          var mEmails = sh.memberEmails || {};
          var mRoles = sh.roles || {};
          (sh.members || []).forEach(function (uid) {
            if (uid === sh.ownerId) return;
            var em = mEmails[uid] || uid;
            seenEmails[String(em).toLowerCase()] = true;
            entries.push({ key: uid, label: em, role: mRoles[uid] || sh.defaultRole || 'editor', joined: true });
          });
          (sh.invites || []).forEach(function (inv) {
            var em = String(inv.email || '').toLowerCase();
            if (!em || seenEmails[em]) return;
            entries.push({ key: em, label: em + ' (invitato)', role: inv.role || 'editor', joined: false, email: em });
          });
          membersBlock.hidden = entries.length === 0;
          entries.forEach(function (ent) {
            var sel = h('select', { 'class': 'cowork-role-select', 'aria-label': 'Ruolo di ' + ent.label }, [
              h('option', { value: 'editor' }, ['Editor']),
              h('option', { value: 'viewer' }, ['Lettore'])
            ]);
            sel.value = ent.role === 'viewer' ? 'viewer' : 'editor';
            sel.addEventListener('change', function () {
              if (MM.sync && MM.sync.setMemberRole) {
                MM.sync.setMemberRole(ent.key, sel.value).then(function () {
                  toast('Ruolo aggiornato a ' + (sel.value === 'viewer' ? 'Lettore' : 'Editor'), 'successo');
                }).catch(function (err) { toast(err.message, 'errore'); });
              }
            });
            var rowKids = [h('span', { 'class': 'cowork-member-name', text: ent.label }), sel];
            if (!ent.joined && ent.email) {
              rowKids.push(h('button', {
                type: 'button', 'class': 'cowork-remove-inv', title: 'Rimuovi invito', 'aria-label': 'Rimuovi invito',
                on: { click: function () {
                  if (MM.sync && MM.sync.removeInvite) MM.sync.removeInvite(ent.email);
                } }
              }, ['×']));
            }
            membersList.appendChild(h('li', { 'class': 'cowork-member-row' }, rowKids));
          });
        }

        if (peersEl) {
          peersEl.textContent = '';
          var peers = (sh.peers && sh.peers.length)
            ? sh.peers
            : (s.user ? [{ uid: s.user.uid, name: s.user.displayName || s.user.email || 'Tu', email: s.user.email || '' }] : []);
          peers.forEach(function (p) {
            var isMe = !!(s.user && p.uid === s.user.uid);
            var peerRoleVal = (sh.roles && sh.roles[p.uid]) || sh.defaultRole || 'editor';
            var pRole = p.uid === sh.ownerId ? 'Admin' : (peerRoleVal === 'viewer' ? 'Lettore' : 'Editor');
            var lbl = (p.name || p.email || 'Collaboratore') + (isMe ? ' (tu)' : '') + ' · ' + pRole;
            peersEl.appendChild(h('li', { 'class': 'cowork-peer-pill' }, [
              h('span', { 'class': 'cowork-peer-dot', 'aria-hidden': 'true' }),
              h('span', { text: lbl })
            ]));
          });
        }
      }
    }

    // 4. Transizione live verso/da modalità solo lettura (es. cambio ruolo in tempo reale)
    var nowRO = !!(app && app.isReadOnly && app.isReadOnly());
    if (updateSyncUi._lastReadOnly !== nowRO) {
      updateSyncUi._lastReadOnly = nowRO;
      if (nowRO && MM.interactions && MM.interactions.isEditing && MM.interactions.isEditing()) {
        MM.interactions.cancelInlineEdit();
      }
      if (app && app.getMap && app.getMap()) {
        updateToolbarState(app);
        renderProperties(app.getMap(), {
          nodeId: app.state.selectedId,
          selectedIds: app.state.selectedIds,
          linkId: app.state.selectedLinkId,
          summaryId: app.state.selectedSummaryId
        }, true);
      }
    }
  }

  function openSync() {
    if (MM.sync) {
      var st = MM.sync.getState();
      updateSyncUi(st);
      var cfgInput = document.getElementById('sync-config-input');
      if (cfgInput && !cfgInput.value) {
        var cfg = MM.sync.getConfig();
        if (cfg && st.configSource === 'local') cfgInput.value = JSON.stringify(cfg, null, 2);
      }
    }
    openDialog(document.getElementById('dlg-sync'));
  }

  function bindSync() {
    var dlg = document.getElementById('dlg-sync');
    if (!dlg || !MM.sync) return;

    var form = document.getElementById('form-sync-auth');
    var emailInput = document.getElementById('sync-email');
    var passInput = document.getElementById('sync-password');
    var loginBtn = document.getElementById('btn-sync-login');
    var signupBtn = document.getElementById('btn-sync-signup');
    var googleBtn = document.getElementById('btn-sync-google');
    var syncNowBtn = document.getElementById('btn-sync-now');
    var logoutBtn = document.getElementById('btn-sync-logout');
    var cfgInput = document.getElementById('sync-config-input');
    var saveCfgBtn = document.getElementById('btn-sync-save-cfg');
    var clearCfgBtn = document.getElementById('btn-sync-clear-cfg');
    var cfgDetails = document.getElementById('sync-config-details');

    function setAuthBusy(busy) {
      [loginBtn, signupBtn, googleBtn].forEach(function (b) { if (b) b.disabled = busy; });
    }

    function credentials() {
      var email = emailInput ? emailInput.value.trim() : '';
      var pass = passInput ? passInput.value : '';
      if (!email) { toast('Inserisci la tua email', 'avviso'); if (emailInput) emailInput.focus(); return null; }
      if (pass.length < 6) { toast('La password deve avere almeno 6 caratteri', 'avviso'); if (passInput) passInput.focus(); return null; }
      return { email: email, pass: pass };
    }

    if (form) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        var c = credentials();
        if (!c) return;
        setAuthBusy(true);
        MM.sync.signInWithEmail(c.email, c.pass).then(function () {
          if (passInput) passInput.value = '';
          toast('Accesso effettuato: sincronizzazione attiva', 'successo');
        }).catch(function (err) {
          toast(err.message, 'errore');
        }).then(function () { setAuthBusy(false); });
      });
    }

    if (signupBtn) {
      signupBtn.addEventListener('click', function () {
        var c = credentials();
        if (!c) return;
        setAuthBusy(true);
        MM.sync.signUpWithEmail(c.email, c.pass).then(function () {
          if (passInput) passInput.value = '';
          toast('Account creato: sincronizzazione attiva', 'successo');
        }).catch(function (err) {
          toast(err.message, 'errore');
        }).then(function () { setAuthBusy(false); });
      });
    }

    if (googleBtn) {
      googleBtn.addEventListener('click', function () {
        setAuthBusy(true);
        MM.sync.signInWithGoogle().then(function () {
          toast('Accesso con Google riuscito', 'successo');
        }).catch(function (err) {
          toast(err.message, 'errore');
        }).then(function () { setAuthBusy(false); });
      });
    }

    if (syncNowBtn) {
      syncNowBtn.addEventListener('click', function () {
        app.saveNow();
        MM.sync.syncNow().then(function () {
          toast('Sincronizzazione completata', 'successo');
        });
      });
    }

    if (logoutBtn) {
      logoutBtn.addEventListener('click', function () {
        MM.sync.signOut().then(function () {
          toast('Disconnesso. Le mappe restano salvate su questo dispositivo.');
        }).catch(function (err) {
          toast(err.message, 'errore');
        });
      });
    }

    if (saveCfgBtn) {
      saveCfgBtn.addEventListener('click', function () {
        var raw = cfgInput ? cfgInput.value : '';
        try {
          MM.sync.saveConfig(raw).then(function (ok) {
            if (ok) {
              toast('Configurazione Firebase salvata', 'successo');
              if (cfgDetails) cfgDetails.open = false;
            }
          });
        } catch (err) {
          toast(err.message, 'errore');
        }
      });
    }

    if (clearCfgBtn) {
      clearCfgBtn.addEventListener('click', function () {
        if (!root.confirm('Rimuovere la configurazione Firebase salvata in questo browser?')) return;
        MM.sync.clearConfig();
        if (cfgInput) cfgInput.value = '';
        toast('Configurazione rimossa');
      });
    }

    // Coworking in tempo reale
    var shareBtn = document.getElementById('btn-cowork-share');
    var joinInput = document.getElementById('cowork-join-input');
    var joinBtn = document.getElementById('btn-cowork-join');
    var copyLinkBtn = document.getElementById('btn-cowork-copy');
    var leaveBtn = document.getElementById('btn-cowork-leave');
    var delSharedBtn = document.getElementById('btn-cowork-delete');
    var inviteEmailInput = document.getElementById('cowork-invite-email');
    var inviteRoleSel = document.getElementById('cowork-invite-role');
    var inviteBtn = document.getElementById('btn-cowork-invite');
    var defaultRoleSel = document.getElementById('cowork-default-role');
    var coworkBadge = document.getElementById('cowork-badge');

    if (inviteBtn) {
      inviteBtn.addEventListener('click', function () {
        var em = inviteEmailInput ? inviteEmailInput.value.trim() : '';
        var role = inviteRoleSel ? inviteRoleSel.value : 'editor';
        if (!em) { toast('Inserisci un indirizzo email', 'avviso'); if (inviteEmailInput) inviteEmailInput.focus(); return; }
        inviteBtn.disabled = true;
        MM.sync.inviteByEmail(em, role).then(function (res) {
          if (inviteEmailInput) inviteEmailInput.value = '';
          copyTextToClipboard(res.url);
          toast('Invito salvato per ' + res.email + ' (' + (res.role === 'viewer' ? 'Lettore' : 'Editor') + ')', 'successo', {
            label: 'Invia email',
            onClick: function () { root.location.href = res.mailtoUrl; }
          });
        }).catch(function (err) {
          toast(err && err.message ? err.message : 'Impossibile inviare invito', 'errore');
        }).then(function () { inviteBtn.disabled = false; });
      });
    }
    if (defaultRoleSel) {
      defaultRoleSel.addEventListener('change', function () {
        if (MM.sync && MM.sync.setDefaultRole) {
          MM.sync.setDefaultRole(defaultRoleSel.value).then(function () {
            toast('Ruolo predefinito aggiornato', 'successo');
          }).catch(function (err) { toast(err.message, 'errore'); });
        }
      });
    }
    if (delSharedBtn) {
      delSharedBtn.addEventListener('click', function () {
        if (!root.confirm('Eliminare definitivamente questa mappa condivisa per tutti i partecipanti?')) return;
        delSharedBtn.disabled = true;
        MM.sync.deleteSharedMap().then(function () {
          toast('Mappa condivisa eliminata', 'successo');
        }).catch(function (err) {
          toast(err && err.message ? err.message : 'Impossibile eliminare', 'errore');
        }).then(function () { delSharedBtn.disabled = false; });
      });
    }

    function copyTextToClipboard(text) {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).then(function () { return true; }).catch(function () { return false; });
      }
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        return Promise.resolve(!!ok);
      } catch (e) {
        return Promise.resolve(false);
      }
    }

    if (shareBtn) {
      shareBtn.addEventListener('click', function () {
        app.saveNow();
        shareBtn.disabled = true;
        MM.sync.shareMap(app.getMap()).then(function (res) {
          return copyTextToClipboard(res.url).then(function (copied) {
            toast(copied
              ? 'Link di invito copiato! Codice: ' + res.shareId
              : 'Mappa condivisa! Codice: ' + res.shareId, 'successo');
          });
        }).catch(function (err) {
          toast(err && err.message ? err.message : 'Impossibile condividere la mappa', 'errore');
        }).then(function () { shareBtn.disabled = false; });
      });
    }

    function doJoinShared() {
      var code = joinInput ? joinInput.value.trim() : '';
      if (!code) {
        toast('Inserisci un codice o un link di invito', 'avviso');
        if (joinInput) joinInput.focus();
        return;
      }
      if (joinBtn) joinBtn.disabled = true;
      MM.sync.joinSharedMap(code).then(function (res) {
        if (joinInput) joinInput.value = '';
        closeDialogs();
        toast('Unito alla mappa condivisa (' + res.shareId + ')', 'successo');
      }).catch(function (err) {
        toast(err && err.message ? err.message : 'Impossibile unirsi alla mappa condivisa', 'errore');
      }).then(function () { if (joinBtn) joinBtn.disabled = false; });
    }

    if (joinBtn) joinBtn.addEventListener('click', doJoinShared);
    if (joinInput) {
      joinInput.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); doJoinShared(); }
      });
    }

    if (copyLinkBtn) {
      copyLinkBtn.addEventListener('click', function () {
        var st = MM.sync.getState();
        if (!st.shared) return;
        var url = (typeof location !== 'undefined' ? (location.origin + location.pathname) : '') + '?condivisa=' + encodeURIComponent(st.shared.shareId);
        copyTextToClipboard(url).then(function (copied) {
          toast(copied ? 'Link di invito copiato negli appunti' : 'Codice: ' + st.shared.shareId, copied ? 'successo' : 'info');
        });
      });
    }

    if (leaveBtn) {
      leaveBtn.addEventListener('click', function () {
        MM.sync.leaveSharedMap();
        toast('Sei uscito dalla sessione condivisa');
      });
    }

    if (coworkBadge) {
      coworkBadge.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openSync(); }
      });
    }

    MM.sync.onStatusChange(updateSyncUi);
  }

  /* ---------- Accessibilità ---------- */

  function formatNumber(v, digits) {
    try { return Number(v).toLocaleString('it-IT', { maximumFractionDigits: digits }); }
    catch (e) { return String(v); }
  }

  function voiceInfo() {
    if (!MM.speech || !MM.speech.isSupported()) return 'Questo browser non sa leggere ad alta voce.';
    var v = MM.speech.getItalianVoice();
    return v ? 'Voce italiana: ' + v.name
      : 'Nessuna voce italiana trovata: su Mac aggiungila in Impostazioni di Sistema → Accessibilità → Contenuti letti.';
  }

  /** Riporta nei campi della finestra i valori attuali. */
  function fillSettings() {
    var form = document.getElementById('form-accessibilita');
    var s = app.getMap().settings;
    $all('input[type="radio"]', form).forEach(function (r) { r.checked = s[r.name] === r.value; });
    form.elements.uppercase.checked = !!s.uppercase;
    form.elements.fontScale.value = s.fontScale || 1;
    document.getElementById('acc-font-scale-val').textContent = Math.round((s.fontScale || 1) * 100) + '%';
    if (MM.speech) {
      var rate = MM.speech.getRate();
      form.elements.rate.value = rate;
      document.getElementById('acc-rate-val').textContent = formatNumber(rate, 2) + '×';
    }
    document.getElementById('acc-voice-info').textContent = voiceInfo();
  }

  function openSettings() {
    fillSettings();
    openDialog(document.getElementById('dlg-accessibilita'));
    // La voce può arrivare in ritardo (Chrome): si aggiorna l'informazione.
    setTimeout(function () { document.getElementById('acc-voice-info').textContent = voiceInfo(); }, 500);
  }

  function bindSettings() {
    var form = document.getElementById('form-accessibilita');
    if (!form) return;
    form.addEventListener('change', function (e) {
      var t = e.target;
      if (t.name === 'theme' || t.name === 'fontFamily') app.applySettings(patchOf(t.name, t.value));
      else if (t.name === 'uppercase') app.applySettings({ uppercase: t.checked });
      else if (t.name === 'fontScale') app.applySettings({ fontScale: parseFloat(t.value) });
      else if (t.name === 'rate' && MM.speech) MM.speech.setRate(parseFloat(t.value));
      fillSettings();
    });
    // Durante il trascinamento del cursore si aggiorna solo il valore mostrato.
    form.addEventListener('input', function (e) {
      if (e.target.name === 'fontScale') {
        document.getElementById('acc-font-scale-val').textContent = Math.round(parseFloat(e.target.value) * 100) + '%';
      } else if (e.target.name === 'rate') {
        document.getElementById('acc-rate-val').textContent = formatNumber(parseFloat(e.target.value), 2) + '×';
      }
    });
    document.getElementById('acc-prova-voce').addEventListener('click', function () {
      if (!MM.speech) return;
      MM.speech.speak('Ciao! Questa è la voce che leggerà le tue mappe.').catch(function (err) { toast(err.message, 'avviso'); });
    });
    document.getElementById('acc-ripristina').addEventListener('click', function () {
      var d = MM.model.DEFAULT_SETTINGS;
      app.applySettings({ theme: d.theme, uppercase: d.uppercase, fontScale: d.fontScale, fontFamily: d.fontFamily });
      if (MM.speech) MM.speech.setRate(MM.speech.DEFAULT_RATE);
      fillSettings();
      toast('Impostazioni iniziali ripristinate');
    });
  }

  function patchOf(key, value) {
    var p = {};
    p[key] = value;
    return p;
  }

  /** Finestra dei modelli: un pulsante per modello, con icona e descrizione. */
  function openTemplates() {
    if (!MM.templates) return;
    var list = document.getElementById('lista-modelli');
    list.textContent = '';
    MM.templates.list().forEach(function (t) {
      var iconEl = MM.icons && MM.icons.isVectorIcon(t.icon)
        ? h('span', { 'class': 'template-icon', 'aria-hidden': 'true' }, [MM.icons.createSvg(MM.icons.vectorId(t.icon), { node: true, size: 24 })])
        : h('span', { 'class': 'template-icon', 'aria-hidden': 'true', text: t.icon });
      list.appendChild(h('li', null, [h('button', {
        type: 'button', 'class': 'template-card',
        on: {
          click: function () {
            closeDialogs();
            app.newMap(t.id);
            if (t.id !== 'vuota') toast('Nuova mappa dal modello “' + t.name + '”', 'successo');
          }
        }
      }, [
        iconEl,
        h('span', { 'class': 'template-name', text: t.name }),
        h('span', { 'class': 'template-desc', text: t.description })
      ])]));
    });
    app.saveNow();
    openDialog(document.getElementById('dlg-modelli'));
  }

  /* ---------- Avvio ---------- */

  function initTooltips() {
    $all('.toolbar button[title], .floating-controls button[title]').forEach(function (btn) {
      var tip = btn.getAttribute('title');
      if (!tip) return;
      btn.setAttribute('data-tooltip', tip);
      if (!btn.getAttribute('aria-label')) btn.setAttribute('aria-label', tip);
      btn.removeAttribute('title');
      if (btn.closest('.tool-group-right')) btn.setAttribute('data-tooltip-align', 'right');
      else if (btn.closest('.floating-controls')) btn.setAttribute('data-tooltip-pos', 'top');
    });
  }

  function init(appApi) {
    app = appApi;
    panel = document.getElementById('properties');
    if (MM.icons) MM.icons.hydrate(document);
    initTooltips();

    document.addEventListener('click', function (e) {
      if (ctxMenuEl && !e.target.closest('.context-menu')) closeContextMenu();
      var menuBtn = e.target.closest('[data-menu]');
      if (menuBtn) { toggleMenu(menuBtn); return; }
      var btn = e.target.closest('[data-action]');
      if (btn && !btn.disabled) { runAction(btn.getAttribute('data-action')); return; }
      if (e.target.closest('[data-close]')) { closeDialogs(); return; }
      if (!e.target.closest('.menu')) closeMenus();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && ctxMenuEl) closeContextMenu();
      onMenuKeys(e);
    });
    // Clic sullo sfondo scuro di una finestra modale: la chiude.
    $all('dialog').forEach(function (d) {
      d.addEventListener('click', function (e) { if (e.target === d) closeDialogs(); });
      d.addEventListener('close', function () { document.getElementById('canvas').focus({ preventScroll: true }); });
    });

    var fileInput = document.getElementById('file-input');
    fileInput.addEventListener('change', function () {
      var file = fileInput.files && fileInput.files[0];
      fileInput.value = '';
      if (file) app.importFile(file);
    });
    // Trascinare un file .mappa.json sulla finestra lo importa.
    document.addEventListener('dragover', function (e) { e.preventDefault(); });
    document.addEventListener('drop', function (e) {
      e.preventDefault();
      var files = e.dataTransfer && e.dataTransfer.files ? Array.prototype.slice.call(e.dataTransfer.files) : [];
      if (!files.length) return;
      var imgFiles = files.filter(function (f) { return /^image\//.test(f.type); });
      if (imgFiles.length) {
        // Una o più immagini: aggiunte alla casella (o riepilogo) su cui sono state lasciate.
        var target = document.elementFromPoint(e.clientX, e.clientY);
        var sumEl = target && target.closest && target.closest('[data-summary-id]');
        if (sumEl) {
          var sumId = sumEl.getAttribute('data-summary-id');
          app.selectSummary(sumId);
          addImagesToSummary(sumId, imgFiles);
          return;
        }
        var nodeEl = target && target.closest && target.closest('.node[data-id]');
        if (nodeEl) {
          var nid = nodeEl.getAttribute('data-id');
          app.select(nid);
          addNodeImages(nid, imgFiles);
          return;
        }
        if (app.state.selectedSummaryId) {
          addImagesToSummary(app.state.selectedSummaryId, imgFiles);
        } else {
          addNodeImages(app.state.selectedId, imgFiles);
        }
        return;
      }
      app.importFile(files[0]);
    });
    // Incolla una o più immagini (⌘V / Ctrl+V) nella casella selezionata.
    document.addEventListener('paste', function (e) {
      var t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      var items = (e.clipboardData && e.clipboardData.items) || [];
      var pasted = [];
      for (var i = 0; i < items.length; i++) {
        if (items[i].kind === 'file' && /^image\//.test(items[i].type)) {
          var f = items[i].getAsFile();
          if (f) pasted.push(f);
        }
      }
      if (pasted.length) {
        e.preventDefault();
        if (app.state.selectedSummaryId) addImagesToSummary(app.state.selectedSummaryId, pasted);
        else addNodeImages(app.state.selectedId, pasted);
        return;
      }
      if (app.getClipboard && app.getClipboard() && app.pasteNode) {
        e.preventDefault();
        app.pasteNode(app.state.selectedId);
      }
    });

    app.state.viewport.onChange(updateZoom);
    updateZoom(app.state.viewport.getState());
    bindSettings();
    bindSync();
    if (MM.speech) {
      MM.speech.onChange(function (speaking) {
        var b = $('[data-menu="menu-leggi"]');
        if (b) b.classList.toggle('active', speaking);
        $all('[data-action="leggi-stop"]').forEach(function (x) { x.disabled = !speaking; });
      });
    }
  }

  /** Barra schede in basso a sinistra (stile Excel) per lavorare su più mappe aperte. */
  function renderTabs() {
    var host = document.getElementById('map-tabs');
    if (!host || !app || !app.getOpenTabs) return;
    var tabs = app.getOpenTabs();
    host.textContent = '';
    tabs.forEach(function (t) {
      var label = (t.title || 'Mappa senza titolo').replace(/\s+/g, ' ');
      var item = h('div', {
        'class': 'map-tab' + (t.active ? ' active' : ''),
        role: 'tab', 'aria-selected': String(t.active), title: label
      }, [
        h('button', {
          type: 'button', 'class': 'map-tab-btn',
          on: { click: function () { if (app.switchTab) app.switchTab(t.id); } }
        }, [label]),
        tabs.length > 1 ? h('button', {
          type: 'button', 'class': 'map-tab-close',
          title: 'Chiudi scheda', 'aria-label': 'Chiudi scheda ' + label,
          on: { click: function (e) { e.stopPropagation(); if (app.closeTab) app.closeTab(t.id); } }
        }, ['×']) : null
      ]);
      host.appendChild(item);
    });
    host.appendChild(h('button', {
      type: 'button', 'class': 'map-tab-add',
      title: 'Apri una nuova mappa in una scheda', 'aria-label': 'Nuova scheda mappa',
      on: { click: function () { if (app.openNewTab) app.openNewTab(); } }
    }, [ico('plus', { size: 14 }) || '+']));
  }

  /* ---------- Menu contestuale (tasto destro su un nodo) ---------- */

  var ctxMenuEl = null;

  function closeContextMenu() {
    if (ctxMenuEl && ctxMenuEl.parentNode) ctxMenuEl.parentNode.removeChild(ctxMenuEl);
    ctxMenuEl = null;
  }

  function openContextMenu(clientX, clientY, nodeId) {
    closeContextMenu();
    closeMenus();
    var map = app && app.getMap();
    var node = map && map.nodes[nodeId];
    if (!node) return;
    var isRoot = node.parentId === null;
    var parent = !isRoot ? map.nodes[node.parentId] : null;
    var clip = app.getClipboard ? app.getClipboard() : null;
    var unlocked = app.state && app.state.unlockedId === nodeId;

    function item(iconName, label, shortcut, onClick, opts) {
      var o = opts || {};
      var btn = h('button', {
        type: 'button', role: 'menuitem',
        'class': 'ctx-item' + (o.danger ? ' danger' : '') + (o.accent ? ' accent' : ''),
        disabled: !!o.disabled,
        on: {
          click: function () {
            closeContextMenu();
            onClick();
          }
        }
      }, [
        ico(iconName, { size: 15 }),
        h('span', { 'class': 'ctx-label' }, [label]),
        shortcut ? h('span', { 'class': 'ctx-kbd' }, [shortcut]) : null
      ]);
      return btn;
    }

    var rows = [];
    var ro = !!(app.isReadOnly && app.isReadOnly());
    var multi = app.state && Array.isArray(app.state.selectedIds) && app.state.selectedIds.length >= 2 ? app.state.selectedIds : null;
    if (multi && multi.indexOf(nodeId) >= 0 && app.addSummaryForSelection) {
      rows.push(item('brace', 'Unisci ' + multi.length + ' nodi con parentesi graffa', '', function () { app.addSummaryForSelection(); }, { accent: true, disabled: ro }));
      rows.push(h('hr', { 'class': 'ctx-sep' }));
    }
    if (!isRoot && app.cutNode) {
      rows.push(item('scissors', 'Taglia', '⌘X', function () { app.cutNode(nodeId); }, { disabled: ro }));
    }
    if (app.copyNode) {
      rows.push(item('copy', 'Copia', '⌘C', function () { app.copyNode(nodeId); }));
    }
    if (app.pasteNode) {
      var pasteLbl = clip && clip.mode === 'cut' ? 'Attacca qui il ramo' : 'Incolla qui';
      rows.push(item('clipboard', pasteLbl, '⌘V', function () { app.pasteNode(nodeId); }, { disabled: ro || !clip, accent: !ro && !!clip }));
    }
    rows.push(h('hr', { 'class': 'ctx-sep' }));
    rows.push(item('plus', 'Aggiungi figlio', 'Tab', function () { app.addNode('figlio'); }, { disabled: ro }));
    if (!isRoot) {
      rows.push(item('sibling', 'Aggiungi fratello', 'Invio', function () { app.addNode('fratello'); }, { disabled: ro }));
    }
    if (!isRoot && app.toggleUnlock) {
      rows.push(item(unlocked ? 'lock' : 'unlock', unlocked ? 'Chiudi lucchetto' : 'Apri lucchetto (sposta ramo)', '', function () { app.toggleUnlock(nodeId); }, { disabled: ro }));
    }
    if (parent && parent.children.length >= 2 && app.addSummaryForNode) {
      rows.push(item('brace', 'Unisci con parentesi graffa', '', function () { app.addSummaryForNode(nodeId); }, { disabled: ro }));
    }
    rows.push(item('message', node.comment ? 'Modifica commento' : 'Aggiungi commento', '', function () { focusComment(); }, { disabled: ro && !node.comment }));
    if (!isRoot) {
      rows.push(h('hr', { 'class': 'ctx-sep' }));
      rows.push(item('trash', 'Elimina', '⌫', function () { app.deleteSelection(); }, { danger: true, disabled: ro }));
    }

    var menu = h('div', { 'class': 'context-menu', role: 'menu', 'aria-label': 'Azioni nodo' }, rows);
    menu.style.left = clientX + 'px';
    menu.style.top = clientY + 'px';
    document.body.appendChild(menu);
    ctxMenuEl = menu;

    // Mantieni il menu completamente dentro la finestra.
    var rect = menu.getBoundingClientRect();
    var x = Math.min(clientX, Math.max(8, root.innerWidth - rect.width - 8));
    var y = Math.min(clientY, Math.max(8, root.innerHeight - rect.height - 8));
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  }

  function focusComment() {
    if (app && app.toggleProperties) app.toggleProperties(true);
    setTimeout(function () {
      var input = document.getElementById('prop-commento');
      if (input) { input.focus(); input.select(); }
    }, 30);
  }

  MM.ui = {
    EMOJI: EMOJI,
    init: init,
    toast: toast,
    renderProperties: renderProperties,
    renderTabs: renderTabs,
    openContextMenu: openContextMenu,
    closeContextMenu: closeContextMenu,
    focusComment: focusComment,
    updateToolbarState: updateToolbarState,
    setPropertiesOpen: setPropertiesOpen,
    setTitle: setTitle,
    openMapList: openMapList,
    refreshMapList: refreshMapList,
    openHelp: openHelp,
    openTemplates: openTemplates,
    openSettings: openSettings,
    openSync: openSync,
    focusLinkLabel: focusLinkLabel,
    closeMenus: closeMenus
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
