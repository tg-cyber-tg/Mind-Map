# Implementation Plan

[Overview]
Creare "Mappe Mentali", una web app statica (HTML/CSS/JavaScript puro, senza dipendenze né build) per creare, modificare, salvare, stampare ed esportare mappe mentali e concettuali in ambito scolastico, con particolare attenzione all'accessibilità (studenti con DSA).

Contesto: sul Mac di sviluppo non sono installati Node.js, npm né Git; è disponibile solo Python 3 (usato esclusivamente come server statico opzionale per i test: `python3 -m http.server`). L'app deve funzionare aprendo direttamente `index.html` con un doppio clic (protocollo `file://`). Per questo **non si usano moduli ES** (`import`/`export` vengono bloccati su `file://` da Chrome): si usano script classici caricati in ordine, che espongono tutto sotto un unico namespace globale `window.MM`.

Ambito della prima versione (MVP):
- Area di lavoro SVG con pan (trascinamento dello sfondo) e zoom (rotella, pulsanti, pinch sul trackpad).
- Nodo centrale + nodi figli/fratelli, modifica del testo in linea (doppio clic, F2 o Spazio), eliminazione, trascinamento libero, compressione/espansione dei rami.
- Stile per nodo: colore (palette ad alto contrasto), forma (rettangolo arrotondato, ellisse, rettangolo), emoji/icona, nota testuale.
- Collegamenti trasversali con etichetta (per le mappe *concettuali*, molto usate a scuola).
- Layout automatico: radiale (mappa mentale) e ad albero orizzontale (mappa concettuale/schema).
- Annulla/Ripristina (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z).
- Salvataggio automatico in `localStorage`, elenco delle mappe salvate, importazione/esportazione di file `.mappa.json`.
- Esportazione PNG e SVG, stampa/PDF tramite `window.print()` con un foglio di stile dedicato.
- Accessibilità DSA: font ad alta leggibilità (Verdana/Tahoma di sistema, spaziatura aumentata), opzione "TUTTO MAIUSCOLO" (stampato maiuscolo), dimensione del testo regolabile, tema ad alto contrasto, **lettura ad alta voce** del nodo o dell'intera mappa con la Web Speech API (voce italiana `it-IT`).
- Modelli pronti (es. "Riassunto capitolo", "Personaggio storico", "Processo scientifico", "Analisi del testo", "Confronto").
- Interfaccia interamente in italiano, utilizzabile da tastiera (Tab = figlio, Invio = fratello, Canc = elimina, frecce = navigazione).

Fuori ambito (possibili sviluppi futuri): collaborazione in tempo reale, account utente, sincronizzazione cloud, immagini caricate dentro i nodi, dettatura vocale.

[Types]
Strutture dati in JavaScript puro, documentate con JSDoc in `js/model.js`.

```js
/** @typedef {'rounded'|'ellipse'|'rect'} NodeShape */
/** @typedef {'radial'|'tree'} LayoutKind */

/**
 * @typedef {Object} MapNode
 * @property {string} id            // es. "n_k3j9x2", generato da MM.model.uid('n')
 * @property {string|null} parentId // null solo per il nodo radice
 * @property {string[]} children    // id dei figli, in ordine di visualizzazione
 * @property {string} text          // max 200 caratteri, può contenere \n
 * @property {number} x             // centro del nodo, coordinate del "mondo"
 * @property {number} y
 * @property {string} color         // "#RRGGBB"
 * @property {NodeShape} shape
 * @property {string} icon          // emoji opzionale, "" se assente
 * @property {string} note          // nota estesa, "" se assente
 * @property {boolean} collapsed    // true = discendenti nascosti
 */

/**
 * @typedef {Object} CrossLink
 * @property {string} id      // "l_..."
 * @property {string} fromId
 * @property {string} toId
 * @property {string} label   // es. "causa", "è formato da"; "" ammesso
 */

/**
 * @typedef {Object} MapSettings
 * @property {LayoutKind} layout                          // default 'radial'
 * @property {'chiaro'|'scuro'|'alto-contrasto'} theme    // default 'chiaro'
 * @property {boolean} uppercase                          // default false
 * @property {number} fontScale                           // 0.8–2.0, default 1
 * @property {'leggibile'|'standard'} fontFamily          // default 'leggibile'
 */

/**
 * @typedef {Object} MindMap
 * @property {number} version      // versione del formato file = 1
 * @property {string} id           // "m_..."
 * @property {string} title
 * @property {string} rootId
 * @property {Object<string, MapNode>} nodes
 * @property {CrossLink[]} links
 * @property {MapSettings} settings
 * @property {string} createdAt    // ISO 8601
 * @property {string} updatedAt    // ISO 8601
 */

/** @typedef {{ id: string, title: string, updatedAt: string }} MapSummary */
/** @typedef {{ past: MindMap[], future: MindMap[], limit: number }} History */
```

Regole di validazione (`MM.model.validate(map)` → `{ ok: boolean, errors: string[] }`):
- `version === 1`; `rootId` esiste in `nodes` e ha `parentId === null`; esiste esattamente un nodo radice.
- Ogni `children[i]` esiste e ha un `parentId` coerente; nessun ciclo; ogni nodo è raggiungibile dalla radice.
- Ogni `CrossLink` punta a nodi esistenti e `fromId !== toId`.
- `color` rispetta `/^#[0-9a-fA-F]{6}$/`; `shape` è tra i valori ammessi; `text.length <= 200`.

Costanti (`js/model.js`): `PALETTE` (10 colori accessibili; il colore del testo nero/bianco è calcolato con il contrasto WCAG), `DEFAULT_SETTINGS`, `FILE_VERSION = 1`, `MAX_TEXT = 200`.

Chiavi di `localStorage`: `mm:index` (array di `MapSummary`), `mm:map:<id>` (JSON di `MindMap`), `mm:last` (id dell'ultima mappa aperta).

[Files]
Tutti i file sono nuovi, nella cartella `/Users/tommy/.cline/data/workspaces/chat/mappe-mentali/` (abbreviata qui sotto in `mappe-mentali/`).

Nuovi file:
- `mappe-mentali/index.html` – struttura dell'app: barra degli strumenti, pannello laterale delle proprietà, area SVG (`<svg id="canvas"><defs/><g id="world"/></svg>`), finestre modali `<dialog>` (elenco mappe, modelli, aiuto, impostazioni), contenitore delle notifiche.
- `mappe-mentali/css/style.css` – layout a griglia, temi tramite variabili CSS (`[data-theme="chiaro|scuro|alto-contrasto"]`), stile dei nodi/rami/collegamenti, classi di accessibilità (`.mm-uppercase`, `.mm-font-leggibile`, `--mm-font-scale`).
- `mappe-mentali/css/print.css` – `@media print`: nasconde l'interfaccia e adatta la mappa a una pagina A4 orizzontale.
- `mappe-mentali/js/namespace.js` – `window.MM = window.MM || {};`.
- `mappe-mentali/js/model.js` – logica pura della mappa (nessun accesso al DOM).
- `mappe-mentali/js/history.js` – annulla/ripristina basato su snapshot.
- `mappe-mentali/js/storage.js` – persistenza su localStorage e importazione/esportazione di file.
- `mappe-mentali/js/layout.js` – algoritmi di layout radiale e ad albero (puri).
- `mappe-mentali/js/viewport.js` – pan/zoom e conversione delle coordinate schermo ↔ mondo.
- `mappe-mentali/js/renderer.js` – disegno SVG di nodi, rami (curve di Bézier) e collegamenti con etichetta.
- `mappe-mentali/js/speech.js` – sintesi vocale in italiano.
- `mappe-mentali/js/templates.js` – modelli scolastici predefiniti.
- `mappe-mentali/js/exporter.js` – esportazione SVG/PNG e stampa.
- `mappe-mentali/js/interactions.js` – mouse/touch/penna, scorciatoie da tastiera, modifica del testo in linea.
- `mappe-mentali/js/ui.js` – barra degli strumenti, pannello delle proprietà, finestre modali, notifiche.
- `mappe-mentali/js/app.js` – controller `MM.app`: stato corrente, collegamento dei moduli, avvio.
- `mappe-mentali/tests/index.html` – carica i moduli puri + i test e li esegue nel browser.
- `mappe-mentali/tests/runner.js` – mini framework di test (`describe`, `it`, `assert.*`) con report HTML.
- `mappe-mentali/tests/model.test.js`, `history.test.js`, `layout.test.js`, `storage.test.js`, `templates.test.js`.
- `mappe-mentali/README.md` – istruzioni in italiano (apertura, scorciatoie, salvataggio/backup, pubblicazione opzionale su GitHub Pages, checklist di verifica manuale).

Ordine di caricamento degli script in `index.html` (tutti `<script src>` classici, con `defer`): `namespace.js`, `model.js`, `history.js`, `storage.js`, `layout.js`, `viewport.js`, `renderer.js`, `speech.js`, `templates.js`, `exporter.js`, `interactions.js`, `ui.js`, `app.js`.

File esistenti da modificare/eliminare/spostare: nessuno (progetto nuovo). Nessuna configurazione di build.

[Functions]
Tutte le funzioni sono nuove ed esposte nei sotto-namespace di `MM`. I moduli puri (`model`, `history`, `layout`, `templates`, serializzazione in `storage`) non toccano il DOM e restituiscono **nuovi oggetti** (approccio immutabile, indispensabile per annulla/ripristina). Funzioni esistenti da modificare/rimuovere: nessuna.

`js/model.js` (`MM.model`):
- `uid(prefix: string): string` – id breve univoco (timestamp base36 + parte casuale).
- `createMap(title = 'Nuova mappa'): MindMap` – mappa con il solo nodo radice in (0,0).
- `createNode(partial: Partial<MapNode>): MapNode` – applica i valori predefiniti.
- `addChild(map, parentId, text = 'Nuova idea'): { map, nodeId }` – colore ereditato dal ramo di primo livello (nuovo colore della palette se il padre è la radice); posizione iniziale accanto al padre.
- `addSibling(map, nodeId, text = 'Nuova idea'): { map, nodeId }` – sulla radice equivale ad `addChild`.
- `updateNode(map, nodeId, patch): MindMap` – ignora `id`, `parentId`, `children`; tronca il testo a `MAX_TEXT`.
- `removeNode(map, nodeId): MindMap` – rimuove il sottoalbero e i collegamenti coinvolti; sulla radice lancia `Error('Il nodo centrale non può essere eliminato')`.
- `moveNode(map, nodeId, x, y, withSubtree = true): MindMap`.
- `reparent(map, nodeId, newParentId): MindMap` – vieta lo spostamento dentro un proprio discendente.
- `toggleCollapsed(map, nodeId): MindMap`.
- `addLink(map, fromId, toId, label = ''): { map, linkId }` – rifiuta duplicati e auto-collegamenti.
- `updateLink(map, linkId, patch)`, `removeLink(map, linkId)`.
- `getDescendants(map, nodeId)`, `getVisibleNodeIds(map)`, `getDepth(map, nodeId)`.
- `toOutline(map): string` – testo indentato (lettura vocale, copia negli appunti).
- `validate(map): { ok, errors }`.
- `textColorFor(bgHex): '#000000'|'#FFFFFF'` – contrasto WCAG maggiore.

`js/history.js` (`MM.history`):
- `createHistory(limit = 100)`, `push(history, snapshot)` (svuota `future`, rispetta `limit`), `undo(history, current): { history, map|null }`, `redo(history, current): { history, map|null }`, `canUndo(h)`, `canRedo(h)`.
- Le azioni continue (trascinamento, digitazione) registrano un solo snapshot all'inizio del gesto.

`js/storage.js` (`MM.storage`):
- `setBackend(obj)` – default `window.localStorage`; nei test un oggetto in memoria.
- `listMaps(): MapSummary[]` (per `updatedAt` decrescente); `saveMap(map)` – aggiorna `updatedAt` e indice; su `QuotaExceededError` lancia `Error('Spazio di archiviazione esaurito: esporta ed elimina alcune mappe')`.
- `loadMap(id)`, `deleteMap(id)`, `duplicateMap(id)`, `getLastMapId()`, `setLastMapId(id)`.
- `serialize(map): string`; `deserialize(text): MindMap` – parse + `validate`, nuovo `id` se già presente, errore leggibile in italiano se il file non è valido.
- `downloadFile(filename, content, mime)`, `readFile(file): Promise<string>`, `sanitizeFilename(title)`.

`js/layout.js` (`MM.layout`):
- `setMeasurer(fn)` / `measureNode(node, settings): { width, height }` – stima predefinita (larghezza media carattere × `fontScale`, a capo dopo ~22 caratteri); il renderer registra una misura reale con `getBBox`.
- `radial(map)` – figli della radice sul cerchio con angolo proporzionale alle foglie del sottoalbero; livelli successivi su anelli (`ringGap = 180`) dentro il settore del padre.
- `tree(map)` – albero orizzontale sinistra→destra (Reingold–Tilford semplificato), `levelGap = 220`, `siblingGap = 24`.
- `apply(map)` – sceglie da `map.settings.layout`, ignora i nodi compressi; `getBounds(map): { minX, minY, maxX, maxY }`.

`js/viewport.js` (`MM.viewport`):
- `create(svgEl, worldGroupEl): Viewport` – `panBy(dx, dy)`, `zoomAt(factor, sx, sy)` (limiti 0,2–4), `fitTo(bounds, padding = 40)`, `screenToWorld(x, y)`, `getState()`, `setState(s)`, `onChange(cb)`.

`js/renderer.js` (`MM.renderer`):
- `create(svgEl): Renderer`; `render(map, { selectedId, selectedLinkId, pendingLinkFrom })` – sincronizzazione mirata dei gruppi `<g data-id>` (crea/aggiorna/rimuove senza ridisegnare tutto); rami come curve di Bézier con spessore decrescente per profondità; collegamenti tratteggiati con freccia (`<marker>`) ed etichetta; indicatore "+N" sui nodi compressi; attributi `role="treeitem"`, `aria-label`, `aria-selected`.
- `wrapText(text, maxChars): string[]`, `measure(node, settings)`, `highlight(nodeId)`, `getNodeElement(id)`.

`js/interactions.js` (`MM.interactions`):
- `attach(app)` – Pointer Events: clic = seleziona; doppio clic su nodo = modifica; doppio clic sullo sfondo = nuovo figlio della radice; trascina nodo = sposta (con Alt, rilascio su altro nodo = cambia genitore); trascina sfondo = pan; rotella/pinch = zoom.
- Modalità collegamento: pulsante "Collega" o tasto L, poi clic sul nodo di destinazione.
- Tastiera: Tab = figlio, Invio = fratello, F2/Spazio = modifica, Canc/Backspace = elimina, frecce = navigazione per vicinanza, Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z / Ctrl+Y, Ctrl/Cmd+S = esporta, Ctrl/Cmd+0 = adatta, +/− = zoom, Esc = annulla.
- `startInlineEdit(nodeId)` – `<textarea>` HTML sopra il nodo (non `foreignObject`, per Safari); Invio conferma, Shift+Invio a capo, Esc annulla.

`js/exporter.js` (`MM.exporter`):
- `toSVGString(map, renderer)` – clona l'SVG con stili in linea, viewBox = `getBounds` + margine.
- `toPNG(map, renderer, scale = 2): Promise<Blob>` – SVG → `Image` → `<canvas>` → `toBlob`, sfondo bianco.
- `print(app)` – adatta la vista e chiama `window.print()`.

`js/speech.js` (`MM.speech`):
- `isSupported()`, `getItalianVoice()` (gestisce `voiceschanged`), `speak(text, { rate = 0.95 })`, `speakNode(map, nodeId)`, `speakMap(map, onNode)` (lettura gerarchica con evidenziazione), `stop()`. Se non supportata, pulsante disattivato con suggerimento.

`js/templates.js` (`MM.templates`):
- `list(): { id, name, description }[]`; `create(templateId): MindMap`.
- Modelli: `vuota`, `riassunto-capitolo`, `personaggio-storico` (Chi/Quando/Dove/Cosa ha fatto/Perché è importante), `processo-scientifico` (albero), `analisi-testo`, `confronto`.

`js/ui.js` (`MM.ui`):
- `init(app)` – barra: Nuova, Apri, Modelli, Importa, Esporta ▾ (JSON, PNG, SVG, Stampa/PDF), Annulla, Ripristina, Figlio, Fratello, Collega, Elimina, Layout ▾, Zoom −/+/Adatta, Leggi, Accessibilità, Aiuto.
- `renderProperties(map, selection)` – testo, nota, palette, forma, emoji (~40 scolastiche), etichetta collegamento.
- `openMapList()`, `openTemplates()`, `openHelp()`, `openSettings()`, `toast(msg, type)`, `updateToolbarState(app)`, `setTitle(title)`.

`js/app.js` (`MM.app`):
- Stato: `{ map, history, selectedId, selectedLinkId, mode: 'normale'|'collegamento'|'modifica', renderer, viewport }`.
- `init()` – apre l'ultima mappa o crea il modello `vuota`; collega i moduli; primo render + `fitTo`.
- `commit(newMap, { recordHistory = true, relayout = false })` – punto unico di modifica: snapshot, layout, render, pannello, salvataggio automatico con debounce 500 ms.
- `select`, `selectLink`, `undo`, `redo`, `openMap(id)`, `newMap(templateId)`, `importFile(file)`, `exportAs(kind)`, `applySettings(patch)`; `beforeunload` forza il salvataggio.

[Classes]
Nessuna classe ES6: per coerenza con l'approccio a funzioni pure si usano **funzioni factory** che restituiscono oggetti. Nessuna classe da modificare o rimuovere.
- `Renderer` (da `MM.renderer.create`, `js/renderer.js`): `render`, `measure`, `highlight`, `getNodeElement`, `destroy`.
- `Viewport` (da `MM.viewport.create`, `js/viewport.js`): stato `{ x, y, scale }` applicato come `transform` su `<g id="world">`.

[Dependencies]
Nessuna dipendenza esterna: niente npm, CDN o font scaricati; l'app funziona offline.
API del browser: SVG, Pointer Events, `localStorage`, `Blob`/`URL.createObjectURL`, `FileReader`, `canvas.toBlob`, `<dialog>`, `speechSynthesis`. Browser: versioni recenti di Chrome, Edge, Firefox, Safari (anche iPad). Font "leggibile": `Verdana, Tahoma, "Trebuchet MS", Arial, sans-serif` con `letter-spacing: 0.05em` e `word-spacing: 0.15em` (OpenDyslexic locale come sviluppo futuro).
Strumenti: solo Python 3 per un server statico opzionale (`python3 -m http.server 8000`).

[Testing]
Test automatici nel browser, senza dipendenze: si apre `tests/index.html` (oppure `http://localhost:8000/tests/` con il server Python).
- `tests/runner.js`: `describe`, `it` (anche async), `assert.equal`, `assert.deepEqual`, `assert.ok`, `assert.throws`; riepilogo verde/rosso nella pagina e `document.title` = `PASS n/n` o `FAIL k/n`.
- `tests/model.test.js`: creazione mappa; addChild/addSibling (colore ereditato, sibling sulla radice); removeNode (sottoalbero e collegamenti rimossi, radice protetta); reparent (cicli vietati); addLink (duplicati e auto-collegamenti rifiutati); getVisibleNodeIds con nodi compressi; validate su mappe valide e corrotte; textColorFor; immutabilità della mappa originale.
- `tests/history.test.js`: push/undo/redo, `future` svuotato dopo un nuovo push, rispetto del limite.
- `tests/layout.test.js`: radial/tree senza sovrapposizioni tra fratelli; radice in (0,0); nodi compressi ignorati; getBounds.
- `tests/storage.test.js` (backend in memoria): salva/elenca/ordina/carica/elimina/duplica; serialize→deserialize senza perdite; JSON non valido o versione errata → errore in italiano; QuotaExceeded simulato.
- `tests/templates.test.js`: ogni modello supera `validate`.

Verifica manuale (checklist nel README): doppio clic su `index.html` in Chrome e Safari; creazione nodi da tastiera e mouse; trascinamento e zoom da trackpad; collegamento con etichetta; annulla/ripristina; ricarica pagina → mappa ripristinata; esporta e reimporta JSON; PNG nitido; anteprima di stampa su un A4; lettura vocale in italiano; tema alto contrasto e maiuscolo; uso su iPad (touch).

[Implementation Order]
1. Creare la struttura delle cartelle, `js/namespace.js`, lo scheletro di `index.html` e `css/style.css` di base.
2. Implementare `js/model.js`; scrivere `tests/runner.js`, `tests/index.html`, `tests/model.test.js` e farli passare.
3. Implementare `js/history.js` con i relativi test.
4. Implementare `js/layout.js` (misure stimate, radiale, albero, getBounds) con i relativi test.
5. Implementare `js/viewport.js` e `js/renderer.js`; visualizzare una mappa di esempio.
6. Implementare `js/app.js` (stato, `commit`, selezione) e `js/interactions.js` (selezione, trascinamento, pan/zoom, tastiera, modifica in linea).
7. Implementare `js/storage.js` (localStorage, salvataggio automatico, import/export JSON) con i test; collegare l'elenco delle mappe.
8. Implementare `js/ui.js`: barra, pannello proprietà (colori, forme, emoji, note), finestre modali, notifiche.
9. Aggiungere i collegamenti trasversali (modalità collega, etichette, frecce) in modello, renderer e UI.
10. Implementare `js/templates.js` con i test e la finestra dei modelli.
11. Implementare `js/exporter.js` (SVG, PNG) e `css/print.css` (stampa/PDF).
12. Implementare `js/speech.js` e le impostazioni di accessibilità (temi, maiuscolo, dimensione e tipo di carattere).
13. Scrivere `README.md` in italiano; eseguire tutti i test e la checklist manuale; correggere i problemi.





