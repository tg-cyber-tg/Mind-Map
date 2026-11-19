#!/bin/sh
# Controllo di coerenza dell'app installabile (PWA), senza browser.
# Uso:  sh tests/controlla-pwa.sh
# Verifica che:
#  - ogni file elencato in PRECACHE (sw.js) esista;
#  - ogni script e foglio di stile di index.html sia in PRECACHE (altrimenti offline mancherebbe);
#  - il manifest sia JSON valido, con i campi necessari e icone esistenti;
#  - CACHE_VERSION sia presente.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT" || exit 2
ERR=0

fail() { echo "✘ $1"; ERR=1; }
ok() { echo "✔ $1"; }

[ -f sw.js ] || { echo "✘ sw.js mancante"; exit 1; }

# Elenco PRECACHE: le stringhe tra apici nel blocco "var PRECACHE = [ ... ];"
PRECACHE="$(sed -n '/var PRECACHE = \[/,/\];/p' sw.js | grep -o "'[^']*'" | tr -d "'")"
[ -n "$PRECACHE" ] || fail "PRECACHE vuoto o non trovato in sw.js"

grep -q "var CACHE_VERSION = 'mm-v[0-9][0-9]*';" sw.js && ok "CACHE_VERSION presente: $(grep -o "mm-v[0-9]*" sw.js | head -1)" \
  || fail "CACHE_VERSION mancante o nel formato sbagliato (atteso 'mm-vN')"

# 1. Ogni file in PRECACHE esiste.
for f in $PRECACHE; do
  case "$f" in ./) continue ;; esac
  [ -f "$f" ] || fail "in PRECACHE ma non esiste: $f"
done
ok "file di PRECACHE controllati ($(echo "$PRECACHE" | wc -l | tr -d ' '))"

# 2. Ogni script/foglio di stile/icona di index.html è in PRECACHE.
REFS="$(grep -oE '(src|href)="[^"#:]+"' index.html | sed -E 's/^(src|href)="//; s/"$//' | sort -u)"
for r in $REFS; do
  echo "$PRECACHE" | grep -qx "$r" || fail "usato da index.html ma non in PRECACHE: $r"
done
ok "riferimenti di index.html controllati ($(echo "$REFS" | wc -l | tr -d ' '))"

# 3. Ogni file js/ e css/ del progetto è in PRECACHE (evita dimenticanze al prossimo modulo).
for f in js/*.js css/*.css; do
  echo "$PRECACHE" | grep -qx "$f" || fail "file del progetto non in PRECACHE: $f"
done

# 4. Manifest valido con icone esistenti.
python3 - <<'EOF' || ERR=1
import json, os, sys
try:
    m = json.load(open('manifest.webmanifest', encoding='utf-8'))
except Exception as e:
    print('✘ manifest.webmanifest non è JSON valido:', e); sys.exit(1)
bad = False
for k in ('name', 'short_name', 'start_url', 'scope', 'display', 'icons', 'theme_color', 'background_color', 'lang'):
    if k not in m:
        print('✘ manifest: manca il campo', k); bad = True
if m.get('display') not in ('standalone', 'fullscreen', 'minimal-ui'):
    print('✘ manifest: display deve essere standalone'); bad = True
for p in (m.get('start_url', ''), m.get('scope', '')):
    if p.startswith('/'):
        print('✘ manifest: usa percorsi relativi (./) per funzionare anche su GitHub Pages:', p); bad = True
sizes = set()
for icon in m.get('icons', []):
    if not os.path.isfile(icon['src']):
        print('✘ manifest: icona mancante', icon['src']); bad = True
    sizes.add((icon.get('sizes'), icon.get('purpose', 'any')))
for need in (('192x192', 'any'), ('512x512', 'any'), ('512x512', 'maskable')):
    if need not in sizes:
        print('✘ manifest: manca l\'icona', need); bad = True
if bad: sys.exit(1)
print('✔ manifest valido con', len(m['icons']), 'icone')
EOF

# 5. Il manifest non deve essere scritto in index.html (darebbe errore aprendo il file con doppio clic).
grep -q 'rel="manifest"' index.html && fail "index.html non deve contenere <link rel=\"manifest\"> (lo aggiunge js/pwa.js)"

if [ $ERR -eq 0 ]; then echo "Risultato: PWA OK"; else echo "Risultato: PWA CON ERRORI"; fi
exit $ERR
