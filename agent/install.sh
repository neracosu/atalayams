#!/bin/sh
# Atalaya · instalador del agente para hosting compartido.
# Uso (Terminal de cPanel o SSH):
#   curl -fsSL https://SU-ATALAYA/install/agent.sh | sh -s -- https://SU-ATALAYA CODIGO
# Sin terminal: agregue esa misma linea como tarea cron "cada minuto"; en la primera ejecucion el
# agente se instala y la tarea de instalacion se borra sola.
# Quitar:
#   curl -fsSL https://SU-ATALAYA/install/agent.sh | sh -s -- --uninstall
# El CODIGO es de un solo uso: se canjea por un token que queda en ~/.atalaya/curl.conf (600).
set -e
D="${ATALAYA_AGENT_DIR:-$HOME/.atalaya}"
PATH="/usr/local/bin:/usr/bin:/bin:$PATH"
CRONTAB="${ATALAYA_CRONTAB:-crontab}"   # (pruebas: un crontab simulado)
umask 077

cron_without_us() { $CRONTAB -l 2>/dev/null | grep -v "/.atalaya/agent.sh" | grep -v "/install/agent.sh" || true; }

if [ "$1" = "--uninstall" ]; then
  cron_without_us | $CRONTAB - 2>/dev/null || true
  rm -rf "$D"
  echo "Agente de Atalaya quitado."
  exit 0
fi

URL="$1"; CODE="$2"
case "$URL" in https://*|http://127.0.0.1:*|http://localhost:*) ;; *) echo "Uso: sh -s -- https://SU-ATALAYA CODIGO"; exit 1;; esac
URL=${URL%/}
case "$CODE" in ''|*[!A-Za-z0-9-]*) echo "Falta el código de vinculación (lo muestra Atalaya)."; exit 1;; esac
for c in curl gzip crontab; do command -v "$c" >/dev/null 2>&1 || { echo "Este hosting no tiene '$c': el agente no puede funcionar aquí."; exit 1; }; done

mkdir -p "$D"; chmod 700 "$D"
# canje del codigo por el token (el codigo deja de servir)
CRED=$(curl -fsS -m 20 -X POST -H 'Content-Type: application/json' \
  --data "{\"code\":\"$CODE\",\"user\":\"$(id -un)\",\"host\":\"$(hostname 2>/dev/null)\"}" "$URL/api/agent/pair") \
  || { echo "No se pudo vincular: el código venció o ya se usó. Genere uno nuevo en Atalaya."; exit 1; }
case "$CRED" in *:*) ;; *) echo "Respuesta inesperada de Atalaya."; exit 1;; esac

{ printf 'url = "%s/api/agent/push"\n' "$URL"; printf 'header = "X-Atalaya-Agent: %s"\n' "$CRED"; } > "$D/curl.conf"
chmod 600 "$D/curl.conf"
curl -fsS -m 30 "$URL/install/agent-run.sh" -o "$D/agent.sh.new"
head -3 "$D/agent.sh.new" | grep -q '^# atalaya-agent' || { rm -f "$D/agent.sh.new"; echo "El agente descargado no es valido."; exit 1; }
mv "$D/agent.sh.new" "$D/agent.sh"; chmod 700 "$D/agent.sh"

{ cron_without_us; echo "* * * * * /bin/sh $D/agent.sh >/dev/null 2>&1"; } | $CRONTAB -
: > "$D/want.full"
/bin/sh "$D/agent.sh" || true
echo "Listo: esta cuenta ya envía sus datos a Atalaya cada minuto."
echo "Para quitarlo: curl -fsSL $URL/install/agent.sh | sh -s -- --uninstall"
