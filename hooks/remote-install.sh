#!/bin/sh
# Atalaya · hooks de Claude Code para un equipo remoto (macOS, Linux o WSL; requiere Node.js).
# Uso:   curl -fsSL https://SU-ATALAYA/install/remote-hook.sh | sh -s -- https://SU-ATALAYA equipo:token
# Quitar: curl -fsSL https://SU-ATALAYA/install/remote-hook.sh | sh -s -- --uninstall
# Solo agrega hooks asincronos que envian eventos (herramienta, permisos, inicio y cierre) a su Atalaya.
# Nunca bloquean ni cambian lo que hace Claude.
set -e
DIR="$HOME/.claude"
mkdir -p "$DIR"
command -v node >/dev/null 2>&1 || { echo "Se necesita Node.js (el mismo que usa Claude Code)."; exit 1; }

if [ "$1" = "--uninstall" ]; then
  MODE=uninstall
else
  URL="$1"; CRED="$2"
  case "$URL" in https://*) ;; *) echo "Uso: sh -s -- https://SU-ATALAYA equipo:token"; exit 1;; esac
  case "$CRED" in *:*) ;; *) echo "Falta el token (equipo:token)."; exit 1;; esac
  MODE=install
  umask 077
  printf 'X-Atalaya-Hook: %s\n' "$CRED" > "$DIR/atalaya-remote.header"
  chmod 600 "$DIR/atalaya-remote.header"
  cat > "$DIR/atalaya-remote.sh" <<SH
#!/bin/sh
# reenvia el evento del hook a Atalaya; nunca falla ni imprime nada
curl -s -m 3 -o /dev/null -X POST -H 'Content-Type: application/json' -H @"\$HOME/.claude/atalaya-remote.header" --data-binary @- '$URL/api/hook/remote' >/dev/null 2>&1
exit 0
SH
  chmod 700 "$DIR/atalaya-remote.sh"
fi

MODE="$MODE" node - <<'JS'
const fs = require('fs'), path = require('path'), os = require('os');
const file = path.join(os.homedir(), '.claude', 'settings.json');
const cmd = path.join(os.homedir(), '.claude', 'atalaya-remote.sh');
let s = {};
if (fs.existsSync(file)) {
  const raw = fs.readFileSync(file, 'utf8');
  try { s = JSON.parse(raw); } catch { console.error('settings.json no es JSON valido: no se toca.'); process.exit(1); }
  fs.copyFileSync(file, file + '.atalaya-bak-' + Date.now());
}
s.hooks = s.hooks || {};
const ours = h => typeof h.command === 'string' && h.command.includes('atalaya-remote.sh');
for (const ev of Object.keys(s.hooks)) {
  s.hooks[ev] = (s.hooks[ev] || []).map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !ours(h)) })).filter(g => g.hooks.length);
  if (!s.hooks[ev].length) delete s.hooks[ev];
}
if (process.env.MODE === 'install') {
  for (const ev of ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'PermissionRequest', 'PermissionDenied', 'Notification',
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop']) {
    (s.hooks[ev] = s.hooks[ev] || []).push({ hooks: [{ type: 'command', command: cmd, ...(ev === 'SessionEnd' ? {} : { async: true }), timeout: 5 }] });
  }
}
if (!Object.keys(s.hooks).length) delete s.hooks;
fs.writeFileSync(file, JSON.stringify(s, null, 2) + '\n');
console.log(process.env.MODE === 'install' ? 'Hooks de Atalaya instalados. Las sesiones nuevas de Claude Code aparecerán en su pantalla.' : 'Hooks de Atalaya quitados.');
JS
[ "$MODE" = "uninstall" ] && rm -f "$DIR/atalaya-remote.header" "$DIR/atalaya-remote.sh"
exit 0
