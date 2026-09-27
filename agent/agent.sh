#!/bin/sh
# atalaya-agent
# Atalaya · agente para hosting compartido (cPanel, hPanel y similares). Lo ejecuta cron cada minuto.
# Solo LEE datos de esta cuenta y los envia a su Atalaya; no cambia nada ni abre puertos.
#  - cada minuto: lineas nuevas de los logs de visitas y de los error_log de PHP
#  - cada 10 minutos: dominios, cuota, bases de datos, certificados SSL, correo, uso de recursos y cron
#    (con uapi de cPanel si existe)
#  - a pedido de Atalaya (lista cerrada): "full" (lo de 10 min ya) y "du" (que carpetas ocupan espacio)
# Archivos en ~/.atalaya (permisos 600/700). El token vive en curl.conf, nunca en la linea de comandos.
AGENT_VERSION=1
D="${ATALAYA_AGENT_DIR:-$HOME/.atalaya}"
[ -f "$D/curl.conf" ] || exit 0
umask 077
PATH="/usr/local/bin:/usr/bin:/bin:$PATH"

# una ejecucion a la vez (un candado de mas de 10 minutos se considera abandonado)
LOCK="$D/lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  [ -n "$(find "$LOCK" -maxdepth 0 -mmin +10 2>/dev/null)" ] && rmdir "$LOCK" 2>/dev/null
  exit 0
fi
trap 'rmdir "$LOCK" 2>/dev/null' EXIT INT TERM
mkdir -p "$D/off"

OUT="$D/out"; NEWOFF="$D/off.new"
: > "$OUT"; : > "$NEWOFF"
sec() { printf '\n@@%s\n' "$1" >> "$OUT"; }
now=$(date +%s)
last=$(cat "$D/full.at" 2>/dev/null || echo 0)
full=0
[ $((now - last)) -ge 600 ] && full=1
[ -f "$D/want.full" ] && full=1

sec meta
{
  echo "v=$AGENT_VERSION"; echo "user=$(id -un)"; echo "home=$HOME"; echo "host=$(hostname 2>/dev/null)"
  echo "now=$now"; echo "full=$full"; echo "load=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)"
  echo "uapi=$(command -v uapi >/dev/null 2>&1 && echo 1 || echo 0)"
} >> "$OUT"

# lineas nuevas de un archivo desde el ultimo envio. $1 archivo, $2 seccion, $3 tope en bytes,
# $4 cuanto enviar la primera vez que se ve (0 = empezar desde el final)
tailnew() {
  f=$1; size=$(wc -c < "$f" 2>/dev/null) || return 0; size=$((size + 0))
  key=$(printf '%s' "$f" | tr -c 'A-Za-z0-9._-' '_')
  off=$(cat "$D/off/$key" 2>/dev/null)
  if [ -z "$off" ]; then off=$((size - $4)); [ "$off" -lt 0 ] && off=0
  elif [ "$size" -lt "$off" ]; then off=0; fi   # el archivo se roto o se vacio
  if [ "$size" -gt "$off" ]; then
    [ $((size - off)) -gt "$3" ] && off=$((size - $3))
    sec "$2"
    tail -c +$((off + 1)) "$f" 2>/dev/null | head -c "$3" >> "$OUT"
  fi
  echo "$key $size" >> "$NEWOFF"
}

# visitas: ~/access-logs (cPanel) o ~/logs; un archivo por dominio ("dominio" y "dominio-ssl_log")
for L in "$HOME/access-logs" "$HOME/logs"; do
  [ -d "$L" ] || continue
  for f in "$L"/*; do
    [ -f "$f" ] || continue
    case "$f" in *bytes_log|*.gz|*.zip|*.bkup|*ftp*|*error*) continue;; esac
    n=$(basename "$f"); n=${n%-ssl_log}
    tailnew "$f" "access $n" 1048576 0
  done
  break
done

# errores de PHP: los error_log de los sitios (lo nuevo; la primera vez, los ultimos 4 KB)
find "$HOME/public_html" "$HOME/domains" -maxdepth 5 -name error_log -type f 2>/dev/null | head -40 | while IFS= read -r f; do
  tailnew "$f" "errlog $(stat -c '%s %Y' "$f" 2>/dev/null) $f" 16384 4096
done

# tipo de un sitio mirando su carpeta: wordpress, proxy (app Node/Python), php, static o empty
cls() {
  d=$1; t=empty; v=
  if [ -f "$d/wp-config.php" ] || [ -f "$d/wp-includes/version.php" ]; then
    t=wordpress; v=$(sed -n "s/^\$wp_version *= *'\([^']*\)'.*/\1/p" "$d/wp-includes/version.php" 2>/dev/null | head -1)
  elif grep -qsE '127\.0\.0\.1:[0-9]|^[^#]*Passenger(AppRoot|AppType|StartupFile)' "$d/.htaccess"; then t=proxy
  elif [ -f "$d/index.php" ]; then t=php
  elif [ -f "$d/index.html" ] || [ -f "$d/index.htm" ]; then t=static
  fi
  printf '%s\t%s\t%s\n' "$d" "$t" "$v"
}

if [ "$full" = 1 ]; then
  if command -v uapi >/dev/null 2>&1; then
    for c in "DomainInfo domains_data" "Quota get_quota_info" "Mysql list_databases" "SSL installed_hosts" "Email list_pops_with_disk" "ResourceUsage get_usages"; do
      sec "uapi $c"
      # shellcheck disable=SC2086
      nice -n 19 uapi --output=json $c 2>/dev/null >> "$OUT"
    done
  fi
  sec crontab
  crontab -l 2>/dev/null | grep -v '/.atalaya/agent.sh' >> "$OUT"
  sec docroots
  {
    grep -o '"documentroot":"[^"]*"' "$OUT" 2>/dev/null | cut -d'"' -f4 | sed 's#\\/#/#g'
    echo "$HOME/public_html"
    for x in "$HOME"/domains/*/public_html; do [ -d "$x" ] && echo "$x"; done
  } | sort -u | head -200 | while IFS= read -r d; do [ -d "$d" ] && cls "$d"; done >> "$OUT"
  # sin uapi (hPanel y otros): los dominios se deducen de ~/domains/<dominio>
  if ! command -v uapi >/dev/null 2>&1; then
    sec domains
    for x in "$HOME"/domains/*; do [ -d "$x/public_html" ] && printf '%s\t%s\n' "$(basename "$x")" "$x/public_html"; done >> "$OUT"
  fi
  sec disk
  df -Pk "$HOME" 2>/dev/null | tail -1 >> "$OUT"
fi

# que ocupa el espacio del home: solo cuando lo pide un dueno desde Atalaya ("Analizar ahora")
if [ -f "$D/want.du" ]; then
  rm -f "$D/want.du"
  sec du
  nice -n 19 du -k -x --max-depth=4 "$HOME" 2>/dev/null | sort -rn | head -400 >> "$OUT"
fi

gzip -c "$OUT" > "$OUT.gz" || exit 0
resp=$(curl -sS -m 40 -K "$D/curl.conf" -H 'Content-Type: application/octet-stream' -H 'Content-Encoding: gzip' \
  --data-binary @"$OUT.gz" 2>/dev/null) || exit 0
case "$resp" in ok*) ;; *) exit 0;; esac

# envio aceptado: se guardan las posiciones de lectura
while read -r k s; do [ -n "$k" ] && echo "$s" > "$D/off/$k"; done < "$NEWOFF"
[ "$full" = 1 ] && { echo "$now" > "$D/full.at"; rm -f "$D/want.full"; }
rm -f "$OUT" "$OUT.gz" "$NEWOFF"

# pedidos de Atalaya: solo palabras de esta lista cerrada
for w in $resp; do
  case "$w" in
    full) : > "$D/want.full" ;;
    du) : > "$D/want.du" ;;
  esac
done
exit 0
