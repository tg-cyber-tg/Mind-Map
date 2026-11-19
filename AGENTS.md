# Istruzioni per gli agenti

## Aggiornamento dell'app installata (PWA) — OBBLIGATORIO

Dopo **ogni** modifica ai file dell'app (`index.html`, `manifest.webmanifest`, `css/*`, `js/*`, `icons/*`):

1. Incrementa di uno `CACHE_VERSION` in `sw.js` (es. `'mm-v1'` → `'mm-v2'`), una sola volta per rilascio/commit.
   Senza questo passaggio chi ha l'app installata continua a usare la versione vecchia dalla cache.
2. Se hai aggiunto, rinominato o eliminato file dell'app, aggiorna l'elenco `PRECACHE` in `sw.js`.
3. Esegui `sh tests/controlla-pwa.sh` e `sh tests/esegui-test.sh` (deve risultare `PASS n/n`).
4. Fai il commit includendo `sw.js`. Il `git push` su GitHub (`origin` = https://github.com/tg-cyber-tg/Mind-Map) pubblica il sito su GitHub Pages.

Non serve incrementare `CACHE_VERSION` per modifiche che riguardano solo documentazione o test (`README.md`, `AGENTS.md`, `implementation_plan.md`, `tests/*`).

## Contesto del progetto
- Web app statica in HTML/CSS/JavaScript puro, senza dipendenze né build; interfaccia e documentazione in italiano.
- Niente moduli ES: script classici sotto il namespace globale `window.MM`, così funziona anche aperta con doppio clic (`file://`).
- Il piano completo è in `implementation_plan.md`.
