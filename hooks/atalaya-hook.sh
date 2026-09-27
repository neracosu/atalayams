#!/bin/sh
# Hook de Claude Code -> Atalaya: reenvia el evento (JSON por stdin) al servicio local.
# Nunca cambia el comportamiento de Claude: sale 0 y sin stdout. Corre async salvo SessionEnd (sincrono para que
# el aviso de cierre alcance a salir; como mucho 2 s si Atalaya no responde).
# El token de la cuenta va en un archivo (curl -H @archivo) para que no aparezca en `ps`.
H="${HOME:-$(getent passwd "$(id -u)" | cut -d: -f6)}/.claude/atalaya-hook.header"
[ -r "$H" ] || exit 0
curl -s -m 2 -o /dev/null -X POST -H 'Content-Type: application/json' -H @"$H" \
  --data-binary @- http://127.0.0.1:3952/hook >/dev/null 2>&1
exit 0
