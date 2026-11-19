/*
 * Mappe Mentali – interfaccia: barra degli strumenti, pannello delle proprietà,
 * finestre modali (elenco mappe, aiuto) e notifiche.
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
  var SHAPE_ICONS = { rounded: '▢', ellipse: '⬭', rect: '▭' };
  // Etichette tipiche delle mappe concettuali (un clic per inserirle).
  var LINK_LABELS = ['causa', 'provoca', 'è formato da', 'è un tipo di', 'serve a', 'si oppone a', 'influenza', 'esempio'];

  var app = null;
  var panel = null;
  var panelKey = null;          // selezione mostrata nel pannello
  var typing = null;            // { key } campo in cui si sta scrivendo (un solo passo di annulla)

  function $(sel, ctx) { return (ctx || document).querySelector(sel); }
  function $all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }

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

  /** type: 'info' (predefinito) | 'successo' | 'avviso' | 'errore'. */
  function toast(msg, type) {
    var box = document.getElementById('toasts');
    if (!box) return;
    var kind = type || 'info';
    var icon = { info: 'ℹ️', successo: '✅', avviso: '⚠️', errore: '⛔' }[kind] || 'ℹ️';
    var t = h('div', { 'class': 'toast toast-' + kind, role: kind === 'errore' ? 'alert' : null }, [
      h('span', { 'aria-hidden': 'true', text: icon }), h('span', { text: msg })
    ]);
    box.appendChild(t);
    while (box.children.length > 3) box.removeChild(box.firstChild);
    setTimeout(function () {
      t.classList.add('toast-out');
      setTimeout(function () { if (t.parentNode) t.parentNode.removeChild(t); }, 300);
    }, kind === 'errore' ? 6000 : 3500);
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
      case 'adatta': app.fit(); break;
      case 'aiuto': openHelp(); break;
      default: return;
    }
    // Dopo un'azione sulla mappa il focus torna all'area di lavoro (tastiera pronta).
    if (['apri', 'modelli', 'importa', 'aiuto'].indexOf(action) < 0 && !MM.interactions.isEditing() &&
        !document.querySelector('dialog[open]') && map) {
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
    // Le funzioni delle tappe successive restano nascoste finché il modulo non esiste.
    $all('[data-needs]').forEach(function (b) { b.hidden = !MM[b.getAttribute('data-needs')]; });
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

    parts.push(section(isRoot ? '⭐ Nodo centrale' : '✏️ Nodo', [
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

    var colors = MM.model.PALETTE.concat(isRoot ? [MM.model.ROOT_COLOR] : []);
    if (colors.indexOf(node.color) < 0) colors.push(node.color);
    parts.push(section('🎨 Colore', [
      h('div', { 'class': 'swatches', role: 'radiogroup', 'aria-label': 'Colore del nodo' }, colors.map(function (c, i) {
        var selected = c.toLowerCase() === node.color.toLowerCase();
        return h('button', {
          type: 'button', 'class': 'swatch' + (selected ? ' selected' : ''), role: 'radio',
          'aria-checked': String(selected), 'aria-label': 'Colore ' + (i + 1), title: c,
          style: 'background:' + c + ';color:' + MM.model.textColorFor(c),
          on: { click: function () { app.updateNode(id, { color: c }); } }
        }, [selected ? '✓' : '']);
      })),
      !isRoot && node.children.length ? h('button', {
        type: 'button', 'class': 'link-button',
        on: { click: function () { applyColorToBranch(id); } }
      }, ['Usa questo colore per tutto il ramo']) : null
    ]));

    parts.push(section('🔷 Forma', [
      h('div', { 'class': 'segmented', role: 'radiogroup', 'aria-label': 'Forma del nodo' }, MM.model.SHAPES.map(function (s) {
        var selected = node.shape === s;
        return h('button', {
          type: 'button', role: 'radio', 'aria-checked': String(selected), 'class': selected ? 'selected' : '',
          on: { click: function () { app.updateNode(id, { shape: s }, { relayout: true }); } }
        }, [h('span', { 'aria-hidden': 'true', text: SHAPE_ICONS[s] + ' ' }), SHAPE_LABELS[s]]);
      }))
    ]));

    parts.push(emojiSection(node));
    parts.push(linksSection(map, node));
    parts.push(actionsSection(node));
    return parts;
  }

  function emojiSection(node) {
    var id = node.id;
    var buttons = [h('button', {
      type: 'button', 'class': 'emoji' + (!node.icon ? ' selected' : ''), title: 'Nessuna icona',
      'aria-label': 'Nessuna icona', 'aria-pressed': String(!node.icon),
      on: { click: function () { app.updateNode(id, { icon: '' }, { relayout: true }); } }
    }, ['∅'])].concat(EMOJI.map(function (em) {
      return h('button', {
        type: 'button', 'class': 'emoji' + (node.icon === em ? ' selected' : ''),
        'aria-pressed': String(node.icon === em), 'aria-label': 'Icona ' + em,
        on: { click: function () { app.updateNode(id, { icon: em }, { relayout: true }); } }
      }, [em]);
    }));
    return section('😀 Icona', [h('div', { 'class': 'emoji-grid' }, buttons)]);
  }

  function actionsSection(node) {
    var id = node.id;
    var actions = [];
    if (node.children.length) {
      actions.push(h('button', { type: 'button', on: { click: function () { app.toggleCollapsed(id); } } },
        [node.collapsed ? '📂 Espandi il ramo' : '📁 Comprimi il ramo']));
    }
    if (node.parentId !== null) {
      actions.push(h('button', { type: 'button', 'class': 'danger', on: { click: function () { app.deleteSelection(); } } },
        ['🗑️ Elimina' + (node.children.length ? ' (con il ramo)' : '')]));
    }
    return actions.length ? section('⚙️ Azioni', [h('div', { 'class': 'prop-actions' }, actions)]) : null;
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
    return [section('🔗 Collegamento', [
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
        } } }, ['🔄 Inverti la freccia']),
        h('button', { type: 'button', on: { click: function () { app.select(link.fromId); } } },
          ['⬅️ Vai al primo nodo']),
        h('button', { type: 'button', 'class': 'danger', on: { click: function () { app.deleteSelection(); } } },
          ['🗑️ Elimina collegamento'])
      ])
    ])];
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
    return section('🔗 Collegamenti', [
      links.length ? h('ul', { 'class': 'link-list' }, items)
        : h('p', { 'class': 'prop-hint', text: 'Collega questa idea a un\'altra di un ramo diverso (es. «causa», «è formato da»).' }),
      h('button', { type: 'button', on: { click: function () { MM.interactions.startLinkMode(); } } },
        ['🔗 Collega a un altro nodo (L)'])
    ]);
  }

  /**
   * Aggiorna il pannello. Se l'utente sta scrivendo in un campo del pannello,
   * il pannello non viene ricostruito (per non perdere cursore e focus).
   */
  function renderProperties(map, selection) {
    if (!panel || !map) return;
    var sel = selection || {};
    var link = sel.linkId ? app.findLink(sel.linkId) : null;
    var node = !link && sel.nodeId ? map.nodes[sel.nodeId] : null;
    var key = link ? 'l:' + link.id : node ? 'n:' + node.id : '';
    var active = document.activeElement;
    if (key === panelKey && active && panel.contains(active) &&
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
    var input = document.getElementById('prop-etichetta');
    if (input) { input.focus(); input.select(); }
  }

  /* ---------- Finestre modali ---------- */

  function openDialog(dlg) {
    closeMenus();
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
              MM.storage.duplicateMap(s.id);
              toast('Copia creata', 'successo');
              fillMapList();
            } catch (e) { toast(e.message, 'errore'); }
          }
        }
      }, ['📑']);
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
      }, ['🗑️']);
      list.appendChild(h('li', { 'class': isCurrent ? 'current' : '' }, [open, dup, del]));
    });
  }

  function openMapList() {
    app.saveNow();
    fillMapList();
    openDialog(document.getElementById('dlg-mappe'));
  }

  function openHelp() {
    openDialog(document.getElementById('dlg-aiuto'));
  }

  /** Finestra dei modelli: un pulsante per modello, con icona e descrizione. */
  function openTemplates() {
    if (!MM.templates) return;
    var list = document.getElementById('lista-modelli');
    list.textContent = '';
    MM.templates.list().forEach(function (t) {
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
        h('span', { 'class': 'template-icon', 'aria-hidden': 'true', text: t.icon }),
        h('span', { 'class': 'template-name', text: t.name }),
        h('span', { 'class': 'template-desc', text: t.description })
      ])]));
    });
    app.saveNow();
    openDialog(document.getElementById('dlg-modelli'));
  }

  /* ---------- Avvio ---------- */

  function init(appApi) {
    app = appApi;
    panel = document.getElementById('properties');

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
  }

  MM.ui = {
    EMOJI: EMOJI,
    init: init,
    toast: toast,
    renderProperties: renderProperties,
    updateToolbarState: updateToolbarState,
    setTitle: setTitle,
    openMapList: openMapList,
    openHelp: openHelp,
    openTemplates: openTemplates,
    focusLinkLabel: focusLinkLabel,
    closeMenus: closeMenus
  };
})(typeof globalThis !== 'undefined' ? globalThis : window);
