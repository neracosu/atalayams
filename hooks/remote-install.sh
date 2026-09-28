#!/bin/sh
# Atalaya · hooks de Claude Code para un equipo remoto (macOS, Linux o WSL; requiere Node.js).
# Uso:    curl -fsSL https://SU-ATALAYA/install/remote-hook.sh | sh -s -- https://SU-ATALAYA equipo:token [--detalle]
# Quitar: curl -fsSL https://SU-ATALAYA/install/remote-hook.sh | sh -s -- --uninstall https://SU-ATALAYA
# Descarga el instalador de Node (el mismo de Windows) y lo ejecuta: asi hay un solo filtro de lo que se envia.
# Que sale de su computadora y que no: lea la cabecera de ese instalador, /install/remote-hook.js
set -e
command -v node >/dev/null 2>&1 || { echo "Se necesita Node.js (el mismo que usa Claude Code)."; exit 1; }
BASE=""
for a in "$@"; do case "$a" in https://*) BASE="$a";; esac; done
[ -n "$BASE" ] || { echo "Uso: sh -s -- https://SU-ATALAYA equipo:token"; exit 1; }
TMP="${TMPDIR:-/tmp}/atalaya-hook-$$.js"
trap 'rm -f "$TMP"' EXIT
curl -fsSL "${BASE%/}/install/remote-hook.js" -o "$TMP"
if [ "$1" = "--uninstall" ]; then node "$TMP" --uninstall; else node "$TMP" "$@"; fi
