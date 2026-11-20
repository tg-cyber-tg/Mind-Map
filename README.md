# 🧠 Mappe Mentali

Web app per creare, modificare, salvare, stampare ed esportare **mappe mentali e concettuali** per la scuola, pensata per essere accessibile anche a studenti con DSA.

- Nessuna installazione, nessuna dipendenza, nessun account: è HTML, CSS e JavaScript puro.
- Funziona **senza internet**.
- Interfaccia interamente in italiano, utilizzabile con mouse, tastiera, trackpad e touch (iPad).
- Può essere **installata come app** (Mac, iPad, Chrome/Edge) quando è pubblicata su un indirizzo web.

---

## 1. Come aprirla

### Il modo più semplice: doppio clic
Fai doppio clic su `index.html`: si apre nel browser (Chrome, Safari, Edge o Firefox recenti) ed è già pronta all'uso.

In questa modalità l'app **non** si può installare (vedi paragrafo 5): per installarla serve un indirizzo `http://` o `https://`.

### Con un piccolo server locale (facoltativo)
Serve solo per provare l'installazione come app o il funzionamento offline sul tuo Mac:

```sh
cd mappe-mentali
python3 -m http.server 8000
```

Poi apri http://localhost:8000 nel browser. Per fermare il server premi `Ctrl+C` nel Terminale.

---

## 2. Cosa puoi fare

- **Nodo centrale e idee collegate**: aggiungi idee "figlie" o allo stesso livello, modificale, spostale, eliminale, comprimi ed espandi i rami.
- **Stile di ogni idea**: colore (palette ad alto contrasto, il testo diventa nero o bianco da solo), forma (rettangolo arrotondato, ellisse, rettangolo), emoji, nota.
- **Collegamenti trasversali** con etichetta (es. "causa", "è formato da") per le mappe concettuali.
- **Disposizione automatica**: radiale (mappa mentale) o ad albero (schema/mappa concettuale).
- **Annulla / Ripristina** illimitati (fino a 100 passaggi).
- **Modelli pronti**: Riassunto capitolo, Personaggio storico, Processo scientifico, Analisi del testo, Confronto, Mappa vuota.
- **Esportazione**: file mappa (`.mappa.json`), immagine PNG, disegno SVG, stampa o PDF su un foglio A4.
- **Accessibilità** (pulsante 👓): tema chiaro, scuro o ad alto contrasto; carattere ad alta leggibilità più spaziato; TUTTO MAIUSCOLO (stampato); grandezza del testo dall'80% al 200%.
- **Lettura ad alta voce** con voce italiana: dell'idea selezionata (tasto `R`) o di tutta la mappa (pulsante Leggi), con velocità regolabile.

---

## 3. Scorciatoie

### Con il mouse o le dita

| Gesto | Effetto |
|---|---|
| Clic su un nodo | lo selezioni |
| Doppio clic su un nodo | modifichi il testo |
| Doppio clic sullo sfondo | nuova idea |
| Trascina un nodo | lo sposti (con il suo ramo) |
| ⌥ Alt + trascina su un altro nodo | cambi il "genitore" |
| Trascina lo sfondo | sposti la mappa |
| Rotella o pizzico sul trackpad | zoom |
| Clic sul pallino **+N** | apri un ramo compresso |

### Con la tastiera

| Tasto | Effetto |
|---|---|
| `Tab` | nuova idea "figlia" |
| `Invio` | nuova idea allo stesso livello |
| `F2` / `Spazio` | modifica il testo |
| `Maiusc` + `Invio` | a capo mentre scrivi |
| `Canc` / `Backspace` | elimina |
| `← ↑ → ↓` | spostati tra i nodi |
| `.` | comprimi / espandi il ramo |
| `L` | collega due nodi (poi clic sul nodo di arrivo) |
| `R` | leggi ad alta voce l'idea selezionata |
| `Ctrl/Cmd` + `Z` | annulla |
| `Ctrl/Cmd` + `Maiusc` + `Z` (o `Ctrl` + `Y`) | ripristina |
| `Ctrl/Cmd` + `S` | scarica il file della mappa |
| `+` / `−` | zoom |
| `Ctrl/Cmd` + `0` | adatta la mappa allo schermo |
| `Esc` | annulla l'operazione / ferma la lettura |

La stessa tabella si trova nell'app, nel pulsante ❓ **Aiuto**.

---

## 4. Salvataggio e backup

- Il lavoro viene **salvato da solo** mentre scrivi, nella memoria del browser (`localStorage`). Il pulsante 📂 **Apri** mostra tutte le mappe salvate, che puoi aprire, duplicare o eliminare.
- **Fai un backup ogni tanto**: Esporta → File mappa scarica un file `.mappa.json`. Con **Importa** lo riapri su qualsiasi computer o browser.

> ⚠️ **Gli archivi sono separati.** Ogni "indirizzo" ha la sua memoria: le mappe create aprendo il file con doppio clic, quelle su `localhost`, quelle sul sito pubblicato e quelle dell'app installata **non si vedono tra loro**. Per spostarle: Esporta → File mappa da una parte, Importa dall'altra.

> ⚠️ **Safari e iPad** possono cancellare i dati di un sito non visitato per molte settimane. L'app aggiunta alla schermata Home ne è esente, ma il backup con Esporta resta consigliato. Anche cancellare "cronologia e dati dei siti" dal browser elimina le mappe.

Se la memoria si riempie, l'app lo segnala: esporta ed elimina le mappe che non ti servono più.

---

## 4.1 Sincronizzazione tra Computer e iPad (Firebase)

Puoi avere le stesse mappe aggiornate **in tempo reale** su Mac, Windows e iPad usando un progetto gratuito **Firebase** (piano Spark, €0). L'app resta **offline-first**: funziona sempre senza internet e sincronizza automaticamente appena sei online.

### Configurazione una tantum (5 minuti)

1. Vai su [console.firebase.google.com](https://console.firebase.google.com) e crea un nuovo progetto (puoi disattivare Google Analytics).
2. Nel menu a sinistra apri **Build → Authentication** → *Get started*:
   - In **Sign-in method** abilita **Email/Password** (consigliato anche per l'app installata su iPad).
   - Facoltativo: abilita anche **Google** e aggiungi il tuo dominio GitHub Pages (es. `tuo-nome.github.io`) in *Settings → Authorized domains*.
3. Nel menu a sinistra apri **Build → Firestore Database** → *Create database* → scegli la regione europea (`eur3` o `europe-west8`) e avvia in **Production mode**.
4. Nella scheda **Rules** di Firestore incolla queste regole di sicurezza e premi **Publish** (così ogni utente può leggere e scrivere solo le proprie mappe):

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/maps/{mapId} {
      allow read, write: if request.auth != null && request.auth.uid == userId;
    }
  }
}
```

5. Apri **Impostazioni progetto** (ingranaggio in alto a sinistra) → *Le tue app* → aggiungi una **Web app** (`</>`) → copia l'oggetto `firebaseConfig`.
6. Inserisci la configurazione in uno di questi due modi:
   - **Per tutti i dispositivi (consigliato)**: sostituisci `null` con il tuo oggetto `firebaseConfig` in `js/firebase-config.js`, incrementa `CACHE_VERSION` in `sw.js` e fai `git push`.
   - **Solo da interfaccia**: apri il pulsante **Locale / Sync** nella barra in alto dell'app → *Configurazione Firebase* → incolla `firebaseConfig` → **Salva configurazione**.
7. Accedi con la stessa Email e Password su Mac e iPad: le mappe si uniscono automaticamente e da quel momento ogni modifica si sincronizza in tempo reale.

> Le chiavi client in `firebaseConfig` sono pubbliche per design: la sicurezza dei tuoi dati è garantita da Firebase Authentication e dalle Firestore Security Rules qui sopra.

---

## 5. Installarla come app

Quando l'app è aperta da un indirizzo web (GitHub Pages, paragrafo 6) o da `localhost`, si può installare: avrà la sua icona nel Dock o nella schermata Home, una finestra propria e funzionerà **senza internet**.

| Dove | Come |
|---|---|
| **Chrome / Edge** (Mac, Windows) | icona "Installa" nella barra degli indirizzi, oppure menu ⋮ → *Trasmetti, salva e condividi* → *Installa pagina come app*. Nell'app trovi anche il pulsante 📲 **Installa l'app** nella finestra ❓ Aiuto. |
| **Safari su Mac** (macOS Sonoma o successivo) | menu *File* → *Aggiungi al Dock*. |
| **iPad / iPhone** (Safari) | pulsante *Condividi* (quadrato con freccia) → *Aggiungi alla schermata Home*. |

**Aggiornamenti**: quando pubblichi una nuova versione, l'app installata mostra "È disponibile una nuova versione" con il pulsante **Aggiorna**: la mappa viene salvata e l'app si ricarica.

> Aperta con doppio clic (`file://`) l'app funziona normalmente, ma le parti "installabili" si disattivano da sole: è un limite dei browser, non un errore.

---

## 6. Pubblicarla su GitHub Pages (gratis)

Serve un account GitHub gratuito (https://github.com). Il progetto è già un repository Git.

1. Su GitHub crea un nuovo repository, per esempio `mappe-mentali` (pubblico, **senza** README, .gitignore o licenza).
2. Nel Terminale, dalla cartella del progetto (sostituisci `TUO-NOME`):

   ```sh
   git remote add origin https://github.com/TUO-NOME/mappe-mentali.git
   git branch -M main
   git push -u origin main
   ```

   Al primo `push` GitHub chiede di accedere (dal browser o con un token personale al posto della password).
3. Nel repository su GitHub: *Settings* → *Pages* → *Build and deployment* → *Source: Deploy from a branch* → branch `main`, cartella `/ (root)` → *Save*.
4. Dopo uno o due minuti l'app è online su `https://TUO-NOME.github.io/mappe-mentali/`.

### Pubblicare una nuova versione
1. In `sw.js` aumenta di uno `CACHE_VERSION` (es. da `'mm-v1'` a `'mm-v2'`): così le app installate scaricano i file nuovi.
2. Se hai aggiunto file (script, CSS, icone), aggiungili all'elenco `PRECACHE` in `sw.js`.
3. Controlla con `sh tests/controlla-pwa.sh`, poi:

   ```sh
   git add -A
   git commit -m "Descrizione della modifica"
   git push
   ```

---

## 7. Test

### Test automatici
- **Doppio clic** su `tests/index.html`: la pagina mostra i risultati in verde/rosso e il titolo diventa `PASS n/n` oppure `FAIL k/n`.
- **Da Terminale** (serve Google Chrome installato):

  ```sh
  sh tests/esegui-test.sh      # tutti i test, con Chrome senza finestra
  sh tests/controlla-pwa.sh    # coerenza di sw.js, index.html, manifest e icone
  ```

I test coprono: modello dati, annulla/ripristina, layout, salvataggio e importazione, sincronizzazione e icone, modelli, esportazione, lettura vocale.

### Checklist di verifica manuale

- [ ] Doppio clic su `index.html` in **Chrome** e in **Safari**: l'app si apre senza errori.
- [ ] Creazione di idee da tastiera (`Tab`, `Invio`, `F2`) e con il mouse (doppio clic).
- [ ] Trascinamento dei nodi e dello sfondo; zoom con rotella e pizzico sul trackpad.
- [ ] Collegamento tra due nodi (`L`) con un'etichetta; inversione della freccia.
- [ ] Annulla e ripristina (`Cmd+Z`, `Cmd+Maiusc+Z`).
- [ ] Ricarica della pagina: la mappa viene ripristinata.
- [ ] Esporta → File mappa, poi Importa: la mappa è identica.
- [ ] Esporta → PNG: immagine nitida; Esporta → SVG si apre nel browser.
- [ ] Stampa / PDF: l'anteprima mostra la mappa intera su un foglio A4, senza pulsanti.
- [ ] Lettura ad alta voce (`R` e pulsante Leggi) con voce italiana; `Esc` la ferma.
- [ ] Accessibilità: tema alto contrasto, TUTTO MAIUSCOLO, testo al 200%.
- [ ] iPad: selezione, trascinamento e zoom con le dita.
- [ ] App installata (Chrome "Installa app", Safari "Aggiungi al Dock", iPad "Aggiungi alla schermata Home"): si apre in una finestra propria e funziona **con il Wi-Fi spento**.

---

## 8. Struttura del progetto

```
mappe-mentali/
├── index.html             interfaccia
├── manifest.webmanifest   descrizione dell'app installabile
├── sw.js                  service worker (funzionamento offline)
├── css/                   style.css (temi, accessibilità), print.css (stampa A4)
├── js/                    script classici sotto il namespace globale MM
│   ├── model.js history.js storage.js layout.js templates.js   logica pura (testata)
│   ├── viewport.js renderer.js interactions.js ui.js            disegno e interfaccia
│   ├── icons.js firebase-config.js sync.js                      icone SVG e sincronizzazione cloud
│   ├── speech.js exporter.js pwa.js                             voce, esportazione, app
│   └── app.js                                                   avvio e coordinamento
├── icons/                 icone dell'app (genera-icone.sh le ricrea da icon.svg)
└── tests/                 test automatici e controlli
```

Non si usano moduli ES (`import`/`export`) perché Chrome li blocca quando la pagina è aperta con doppio clic: gli script sono caricati in ordine da `index.html`.

### Possibili sviluppi futuri
Collaborazione in tempo reale, sincronizzazione cloud, immagini dentro i nodi, dettatura vocale, carattere OpenDyslexic, app nativa per Mac o App Store.
