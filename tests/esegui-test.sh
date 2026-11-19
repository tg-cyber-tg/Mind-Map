#!/bin/sh
# Esegue i test automatici con Google Chrome senza finestra (headless).
# Uso:  sh tests/esegui-test.sh
# In alternativa, apri tests/index.html con un doppio clic.

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="$(cd "$(dirname "$0")" && pwd)"
OUT="$(mktemp)"

if [ ! -x "$CHROME" ]; then
  echo "Google Chrome non trovato: apri $DIR/index.html nel browser."
  exit 2
fi

"$CHROME" --headless=new --disable-gpu --no-first-run --allow-file-access-from-files \
  --virtual-time-budget=10000 --dump-dom "file://$DIR/index.html" 2>/dev/null > "$OUT"

RESULT="$(grep -o '<title>[^<]*</title>' "$OUT" | sed 's/<[^>]*>//g')"
echo "Risultato: $RESULT"
grep -o '<li class="fail">[^/]*' "$OUT" | sed 's/<[^>]*>/ /g'
rm -f "$OUT"

case "$RESULT" in
  PASS*) exit 0 ;;
  *) exit 1 ;;
esac
