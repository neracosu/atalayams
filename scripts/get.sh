#!/bin/sh
# Atalaya · instalacion de una linea.
#  Atalaya VPS (como root, por ejemplo en WHM > Terminal):
#   curl -fsSL __ORIGIN__/get | sudo sh -s -- --token=XXXX [--domain=su-dominio.com] [--dir=/opt/atalaya]
#  Atalaya Hosting (cuenta de hosting compartido, sin root; en cPanel > Terminal):
#   curl -fsSL __ORIGIN__/get | sh -s -- --hosting --token=XXXX [--domain=atalaya.su-dominio.com]
# Descarga Atalaya desde __ORIGIN__ (el paquete exige un token vigente), verifica su huella y lo instala:
# en VPS como servicio de solo lectura; en Hosting como app Node de la cuenta. Al final muestra la
# direccion y el codigo del asistente web.
set -e
ORIGIN="__ORIGIN__"
TOKEN=""; DIR=""; EXTRA=""; DLONLY=0; HOSTING=0; DOMAIN=""
for a in "$@"; do
  case "$a" in
    --token=*) TOKEN="${a#*=}" ;;
    --dir=*) DIR="${a#*=}" ;;
    --download-only) DLONLY=1 ;;
    --hosting) HOSTING=1 ;;
    --domain=*) DOMAIN="${a#*=}"; EXTRA="$EXTRA $a" ;;
    *) EXTRA="$EXTRA $a" ;;
  esac
done
[ -n "$DIR" ] || { [ "$HOSTING" = 1 ] && DIR="$HOME/atalaya" || DIR=/opt/atalaya; }
say() { printf '\033[1m%s\033[0m\n' "$*"; }
[ -n "$TOKEN" ] || { echo "Falta --token. Genere el comando en Atalaya > menu > Instalar."; exit 1; }
command -v curl >/dev/null 2>&1 || { echo "Se necesita curl."; exit 1; }

download() {
  TMP="$(mktemp -d 2>/dev/null || mktemp -d -t atalaya)"; trap 'rm -rf "$TMP"' EXIT
  say "Descargando Atalaya desde $ORIGIN ..."
  curl -fsSL "$ORIGIN/get/atalaya.sha256?t=$TOKEN" -o "$TMP/sha" || { echo "Token vencido o invalido: genere un comando nuevo."; exit 1; }
  curl -fsSL "$ORIGIN/get/atalaya.tar.gz?t=$TOKEN" -o "$TMP/atalaya.tar.gz"
  if command -v sha256sum >/dev/null 2>&1; then GOT="$(sha256sum "$TMP/atalaya.tar.gz" | cut -d' ' -f1)"; else GOT="$(shasum -a 256 "$TMP/atalaya.tar.gz" | cut -d' ' -f1)"; fi
  [ "$GOT" = "$(tr -d ' \n' < "$TMP/sha")" ] || { echo "El paquete descargado no coincide con su huella: se cancela."; exit 1; }
  if [ -d "$DIR/.git" ]; then echo "$DIR es un repositorio git: actualicelo con git pull."; exit 1; fi
  mkdir -p "$DIR"
  tar -xzf "$TMP/atalaya.tar.gz" -C "$DIR"
}

# ---------------------------------------------------------------- Atalaya Hosting (sin root)
if [ "$HOSTING" = 1 ]; then
  say "Atalaya Hosting · instalacion en la cuenta $(id -un)"
  command -v crontab >/dev/null 2>&1 || { echo "Este hosting no permite tareas cron: use Atalaya en un VPS y conecte esta cuenta como hosting."; exit 1; }
  download
  chmod 700 "$DIR"
  DATA="$HOME/.atalaya-data"; mkdir -p "$DATA"; chmod 700 "$DATA"
  if [ ! -s "$DATA/users.json" ] && [ ! -s "$DATA/setup-token" ]; then
    od -An -N5 -tx1 /dev/urandom | tr -d ' \n' | tr 'a-f' 'A-F' | sed 's/^\(.....\)\(.....\)$/\1-\2/' > "$DATA/setup-token"; echo >> "$DATA/setup-token"
    chmod 600 "$DATA/setup-token"
  fi
  CODE="$(cat "$DATA/setup-token" 2>/dev/null)"
  APPROOT="${DIR#$HOME/}"
  # CloudLinux (Namecheap, muchos cPanel compartidos): se crea la app Node sola si se indico el dominio
  CREATED=0
  if [ -n "$DOMAIN" ] && command -v cloudlinux-selector >/dev/null 2>&1; then
    V="$(cloudlinux-selector get --json --interpreter nodejs 2>/dev/null | grep -o '"version": *"2[0-9][^"]*"' | head -1 | cut -d'"' -f4 | cut -d. -f1)"
    if [ -n "$V" ] && cloudlinux-selector create --json --interpreter nodejs --version "$V" --app-root "$APPROOT" --domain "$DOMAIN" \
        --app-uri / --app-mode production --startup-file app.js >/dev/null 2>&1; then CREATED=1; fi
  fi
  echo
  if [ "$CREATED" = 1 ]; then
    say "Listo. Abra https://$DOMAIN/setup"
  else
    say "Descargado en ~/$APPROOT. Falta crear la app Node en su panel:"
    echo "  cPanel > Software > Setup Node.js App > Create Application"
    echo "    Node.js version: 20 o superior   ·  Application mode: Production"
    echo "    Application root: $APPROOT       ·  Application URL: ${DOMAIN:-un subdominio, ej. atalaya.su-dominio.com}"
    echo "    Application startup file: app.js"
    echo "  Pulse Create y abra esa direccion terminada en /setup."
  fi
  echo "  Código del asistente: $CODE"
  exit 0
fi

# ---------------------------------------------------------------- Atalaya VPS (root)
[ "$(id -u)" = "0" ] || { echo "Ejecute como root (sudo), por ejemplo desde WHM > Terminal. Si es un hosting compartido, agregue --hosting."; exit 1; }
command -v systemctl >/dev/null 2>&1 || { echo "Se necesita un Linux con systemd."; exit 1; }

say "Atalaya · instalacion"
# Node.js 20 o superior
NODE_OK=0
if command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]; then NODE_OK=1; fi
if [ "$NODE_OK" = "0" ]; then
  say "Instalando Node.js 22 (NodeSource)..."
  if command -v apt-get >/dev/null 2>&1; then curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null && apt-get install -y nodejs >/dev/null
  elif command -v dnf >/dev/null 2>&1; then curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - >/dev/null && dnf install -y nodejs >/dev/null
  elif command -v yum >/dev/null 2>&1; then curl -fsSL https://rpm.nodesource.com/setup_22.x | bash - >/dev/null && yum install -y nodejs >/dev/null
  else echo "No se pudo instalar Node.js automaticamente: instale Node 20+ y repita."; exit 1; fi
fi

download
if [ "$DLONLY" = "1" ]; then say "Descargado y verificado en $DIR (sin instalar)."; exit 0; fi
cd "$DIR"
exec sh ./install.sh --web $EXTRA
