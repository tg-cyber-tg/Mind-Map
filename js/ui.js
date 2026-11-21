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
  var SHAPE_LABELS = { rounded: 'Arrotondato', ellipse: 'Ovale', rect: 'Rettangolo' };
  // Etichette tipiche delle mappe concettuali (un clic per inserirle).
  var LINK_LABELS = ['causa', 'provoca', 'è formato da', 'è un tipo di', 'serve a', 'si oppone a', 'influenza', 'esempio'];

  var app = null;
  var panel = null;
  var panelKey = null;          // selezione mostrata nel pannello
  var typing = null;            // { key } campo in cui si sta scrivendo (un solo passo di annulla)
  var iconTab = 'simboli';      // 'simboli' | 'emoji'

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
      case 'layout-tree': app.applySettings({ layout: 'tree' }); break;
      case 'riordina': app.relayout(); toast('Nodi riordinati (Ctrl/Cmd+Z per annullare)'); break;
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
    function set(action, enabled) {
      $all('[data-action="' + action + '"]').forEach(function (b) { b.disabled = !enabled; });
    }
    set('annulla', a.canUndo());
    set('ripristina', a.canRedo());
    set('elimina', !!st.selectedLinkId || (!!sel && sel.parentId !== null));
    set('fratello', true);
    var linkBtn = $('[data-action="collega"]');
    if (linkBtn) {
      linkBtn.setAttribute('aria-pressed', String(st.mode === 'collegamento'));
      linkBtn.classList.toggle('active', st.mode === 'collegamento');
    }
    ['radial', 'tree'].forEach(function (k) {
      var b = $('[data-action="layout-' + k + '"]');
      if (b) b.setAttribute('aria-checked', String(map.settings.layout === k));
    });
    // Aggiorna l'icona del pulsante Layout nella pillola flottante.
    var layoutBtnIco = $('[data-menu="menu-layout"] .ico');
    if (layoutBtnIco && MM.icons) {
      var lSvg = ico(map.settings.layout === 'tree' ? 'layout-tree' : 'layout-radial', { size: 18 });
      if (lSvg) { layoutBtnIco.textContent = ''; layoutBtnIco.appendChild(lSvg); }
    }
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
    var z = document.getElementById('zoom-level');
    if (z) z.textContent = Math.round(s.scale * 100) + '%';
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

    parts.push(panelHeader(isRoot ? 'Nodo centrale' : 'Nodo', isRoot ? 'logo' : 'file'));

    parts.push(section('Contenuto', [
      textField('prop-testo', 'Testo', node.text, {
        multiline: true, rows: 2, max: MM.model.MAX_TEXT,
        onInput: function (v) {
          liveUpdate('testo:' + id, function (m) { return MM.model.updateNode(m, id, { text: v || ' ' }); }, true);
        }
      }),
      textField('prop-nota', 'Nota (spiegazione, appunti)', node.note, {
        multiline: true, rows: 4, placeholder: 'Scrivi qui i dettagli…',
        onInput: function (v) {
          liveUpdate('nota:' + id, function (m) { return MM.model.updateNode(m, id, { note: v }); });
        }
      })
    ]));

    parts.push(typographySection(map, node));

    var colors = MM.model.PALETTE.concat(isRoot ? [MM.model.ROOT_COLOR] : []);
    if (colors.indexOf(node.color) < 0) colors.push(node.color);
    parts.push(section('Colore', [
      h('div', { 'class': 'swatches', role: 'radiogroup', 'aria-label': 'Colore del nodo' }, colors.map(function (c, i) {
        var selected = c.toLowerCase() === node.color.toLowerCase();
        return h('button', {
          type: 'button', 'class': 'swatch' + (selected ? ' selected' : ''), role: 'radio',
          'aria-checked': String(selected), 'aria-label': 'Colore ' + (i + 1), title: c,
          style: 'background:' + c + ';color:' + MM.model.textColorFor(c),
          on: { click: function () { app.updateNode(id, { color: c }); } }
        }, [selected ? ico('check', { size: 14, strokeWidth: 2.5 }) : null]);
      })),
      !isRoot && node.children.length ? h('button', {
        type: 'button', 'class': 'link-button',
        on: { click: function () { applyColorToBranch(id); } }
      }, ['Usa questo colore per tutto il ramo']) : null
    ]));

    parts.push(section('Forma', [
      h('div', { 'class': 'segmented', role: 'radiogroup', 'aria-label': 'Forma del nodo' }, MM.model.SHAPES.map(function (s) {
        var selected = node.shape === s;
        return h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(selected), 'class': selected ? 'selected' : '',
          on: { click: function () { app.updateNode(id, { shape: s }, { relayout: true }); } }
        }, [SHAPE_LABELS[s]]);
      }))
    ]));

    parts.push(iconSection(node));
    parts.push(linksSection(map, node));
    parts.push(actionsSection(node));
    return parts;
  }

  function typographySection(map, node) {
    var id = node.id;
    var isRoot = node.parentId === null;
    var fonts = MM.model.WORD_FONTS || [];
    var sizes = MM.model.FONT_SIZES || [12, 14, 16, 18, 20, 24, 28, 32, 36];
    var textColors = MM.model.TEXT_COLORS || [];
    var activeFont = node.fontName || (map.settings && map.settings.fontName) || 'Arial';
    var activeSize = node.fontSize || '';
    var isBold = node.bold !== undefined && node.bold !== null ? !!node.bold : isRoot;

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
      app.updateNode(id, { fontName: val }, { relayout: true });
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
      app.updateNode(id, { fontSize: val }, { relayout: true });
    });

    function stepSize(delta) {
      var cur = node.fontSize || (isRoot ? 20 : 16);
      var next = Math.max(10, Math.min(48, cur + delta));
      app.updateNode(id, { fontSize: next }, { relayout: true });
    }

    var fontRow = h('div', { 'class': 'font-row' }, [fontSelect, sizeSelect]);

    // 3. Barra stile Microsoft Word: G, C, S, Barrato, AA, A-, A+
    var wordBar = h('div', { 'class': 'word-toolbar', role: 'group', 'aria-label': 'Stile del carattere' }, [
      h('button', {
        type: 'button', 'class': 'word-btn word-bold' + (isBold ? ' selected' : ''),
        'aria-pressed': String(isBold), title: 'Grassetto',
        on: { click: function () { app.updateNode(id, { bold: !isBold }, { relayout: true }); } }
      }, ['G']),
      h('button', {
        type: 'button', 'class': 'word-btn word-italic' + (node.italic ? ' selected' : ''),
        'aria-pressed': String(!!node.italic), title: 'Corsivo',
        on: { click: function () { app.updateNode(id, { italic: !node.italic }, { relayout: true }); } }
      }, ['C']),
      h('button', {
        type: 'button', 'class': 'word-btn word-underline' + (node.underline ? ' selected' : ''),
        'aria-pressed': String(!!node.underline), title: 'Sottolineato',
        on: { click: function () { app.updateNode(id, { underline: !node.underline }); } }
      }, ['S']),
      h('button', {
        type: 'button', 'class': 'word-btn word-strike' + (node.strike ? ' selected' : ''),
        'aria-pressed': String(!!node.strike), title: 'Barrato',
        on: { click: function () { app.updateNode(id, { strike: !node.strike }); } }
      }, ['S']),
      h('button', {
        type: 'button', 'class': 'word-btn' + (node.uppercase ? ' selected' : ''),
        'aria-pressed': String(!!node.uppercase), title: 'Tutto maiuscolo',
        on: { click: function () { app.updateNode(id, { uppercase: !node.uppercase }, { relayout: true }); } }
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
          on: { click: function () { app.updateNode(id, { textColor: tc }); } }
        }, [!tc ? 'A' : '']);
      }));

    // 5. Applica questo carattere a tutta la mappa
    var applyAll = h('button', {
      type: 'button', 'class': 'link-button',
      on: {
        click: function () {
          app.applySettings({ fontFamily: 'standard', fontName: activeFont });
          toast('Carattere "' + activeFont + '" applicato a tutta la mappa', 'successo');
        }
      }
    }, ['Applica «' + activeFont + '» a tutta la mappa']);

    return section('Carattere', [fontRow, wordBar, colorRow, applyAll]);
  }

  function iconSection(node) {
    var id = node.id;
    var tabs = h('div', { 'class': 'segmented icon-tabs', role: 'tablist', 'aria-label': 'Tipo di icona' }, [
      h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(iconTab === 'simboli'),
        'class': iconTab === 'simboli' ? 'selected' : '',
        on: { click: function () { iconTab = 'simboli'; renderProperties(app.getMap(), { nodeId: id }, true); } }
      }, ['Simboli']),
      h('button', {
        type: 'button', role: 'tab', 'aria-selected': String(iconTab === 'emoji'),
        'class': iconTab === 'emoji' ? 'selected' : '',
        on: { click: function () { iconTab = 'emoji'; renderProperties(app.getMap(), { nodeId: id }, true); } }
      }, ['Emoji'])
    ]);

    var noneBtn = h('button', {
      type: 'button', 'class': 'icon-choice' + (!node.icon ? ' selected' : ''), title: 'Nessuna icona',
      'aria-label': 'Nessuna icona', 'aria-pressed': String(!node.icon),
      on: { click: function () { app.updateNode(id, { icon: '' }, { relayout: true }); } }
    }, [ico('close', { size: 15 }) || '∅']);

    var buttons = [noneBtn];
    if (iconTab === 'simboli' && MM.icons && MM.icons.NODE_ICONS) {
      MM.icons.NODE_ICONS.forEach(function (item) {
        var val = 'svg:' + item.id;
        var selected = node.icon === val;
        buttons.push(h('button', {
          type: 'button', 'class': 'icon-choice' + (selected ? ' selected' : ''),
          title: item.label, 'aria-label': item.label, 'aria-pressed': String(selected),
          on: { click: function () { app.updateNode(id, { icon: val }, { relayout: true }); } }
        }, [MM.icons.createSvg(item.id, { node: true, size: 17 })]));
      });
    } else {
      EMOJI.forEach(function (em) {
        var selected = node.icon === em;
        buttons.push(h('button', {
          type: 'button', 'class': 'icon-choice' + (selected ? ' selected' : ''),
          'aria-pressed': String(selected), 'aria-label': 'Emoji ' + em,
          on: { click: function () { app.updateNode(id, { icon: em }, { relayout: true }); } }
        }, [em]));
      });
    }

    return section('Icona', [tabs, h('div', { 'class': 'icon-grid' }, buttons)]);
  }

  function actionsSection(node) {
    var id = node.id;
    var actions = [];
    if (node.children.length) {
      actions.push(h('button', { type: 'button', on: { click: function () { app.toggleCollapsed(id); } } }, [
        ico(node.collapsed ? 'folder-open' : 'folder', { size: 16 }),
        node.collapsed ? 'Espandi il ramo' : 'Comprimi il ramo'
      ]));
    }
    if (node.parentId !== null) {
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
          })),
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

  /**
   * Aggiorna il pannello. Se l'utente sta scrivendo in un campo del pannello,
   * il pannello non viene ricostruito (per non perdere cursore e focus).
   */
  function renderProperties(map, selection, forceRebuild) {
    if (!panel || !map) return;
    var sel = selection || {};
    var link = sel.linkId ? app.findLink(sel.linkId) : null;
    var node = !link && sel.nodeId ? map.nodes[sel.nodeId] : null;
    var key = link ? 'l:' + link.id : node ? 'n:' + node.id : '';
    var active = document.activeElement;
    if (!forceRebuild && key === panelKey && active && panel.contains(active) &&
        (active.tagName === 'TEXTAREA' || active.tagName === 'INPUT')) {
      return;
    }
    // Stesso elemento selezionato: si conserva la posizione di scorrimento.
    var scroll = key === panelKey ? panel.scrollTop : 0;
    panel.textContent = '';
    panelKey = key;
    var parts = link ? linkPanel(map, link) : node ? nodePanel(map, node) : [];
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
      var menuBtn = e.target.closest('[data-menu]');
      if (menuBtn) { toggleMenu(menuBtn); return; }
      var btn = e.target.closest('[data-action]');
      if (btn && !btn.disabled) { runAction(btn.getAttribute('data-action')); return; }
      if (e.target.closest('[data-close]')) { closeDialogs(); return; }
      if (!e.target.closest('.menu')) closeMenus();
    });
    document.addEventListener('keydown', onMenuKeys);
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
      var file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (file) app.importFile(file);
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

  MM.ui = {
    EMOJI: EMOJI,
    init: init,
    toast: toast,
    renderProperties: renderProperties,
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
