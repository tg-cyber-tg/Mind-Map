#!/bin/sh
# Genera le icone PNG dell'app da icons/icon.svg usando Google Chrome senza finestra.
# Uso:  sh icons/genera-icone.sh
# Da rieseguire solo se si modifica icon.svg (i PNG sono già nel progetto).

CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
DIR="$(cd "$(dirname "$0")" && pwd)"
BG="#1E293B"   # stesso colore del fondo dell'icona

if [ ! -x "$CHROME" ]; then
  echo "Google Chrome non trovato: impossibile generare le icone."
  exit 2
fi

# genera <file png> <lato in px> <modo>
#   trasparente: icona con angoli arrotondati su fondo trasparente (purpose "any")
#   pieno:       fondo pieno, icona a tutta pagina (Apple: iPad/iPhone arrotondano da soli)
#   maskable:    fondo pieno, icona all'80% (margine di sicurezza per le maschere di Android/Chrome)
genera() {
  OUT="$1"; SIZE="$2"; MODE="$3"
  PAGE="$(mktemp -t mmicona).html"
  PROFILE="$(mktemp -d)"
  case "$MODE" in
    trasparente) BODY_BG="transparent"; IMG="100%" ;;
    pieno)       BODY_BG="$BG"; IMG="100%" ;;
    maskable)    BODY_BG="$BG"; IMG="80%" ;;
  esac
  cat > "$PAGE" <<EOF
<!DOCTYPE html><html><head><meta charset="utf-8"><style>
html,body{margin:0;width:${SIZE}px;height:${SIZE}px;overflow:hidden;background:${BODY_BG};
display:flex;align-items:center;justify-content:center}
img{width:${IMG};height:${IMG};display:block}
</style></head><body><img src="file://${DIR}/icon.svg"></body></html>
EOF
  "$CHROME" --headless=new --disable-gpu --no-first-run --user-data-dir="$PROFILE" \
    --hide-scrollbars --allow-file-access-from-files --default-background-color=00000000 \
    --force-device-scale-factor=1 --window-size="${SIZE},${SIZE}" \
    --screenshot="$DIR/$OUT" "file://$PAGE" >/dev/null 2>&1
  rm -f "$PAGE"; rm -rf "$PROFILE"
  if [ -f "$DIR/$OUT" ]; then echo "Creata $OUT (${SIZE}×${SIZE})"; else echo "ERRORE: $OUT non creata"; exit 1; fi
}

genera icon-192.png 192 trasparente
genera icon-512.png 512 trasparente
genera icon-maskable-512.png 512 maskable
genera apple-touch-icon.png 180 pieno
