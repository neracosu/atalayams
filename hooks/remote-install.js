#!/usr/bin/env node
'use strict';
// Atalaya · hooks de Claude Code para un equipo remoto, en cualquier sistema (Windows, macOS o Linux).
// Solo necesita Node.js, el mismo que usa Claude Code: no usa curl, sh ni PowerShell para enviar.
// Instalar (Windows, PowerShell):
//   irm https://SU-ATALAYA/install/remote-hook.js -OutFile $env:TEMP\atalaya-hook.js; node $env:TEMP\atalaya-hook.js https://SU-ATALAYA equipo:token
// Quitar:  node atalaya-hook.js --uninstall
// Solo agrega hooks que envian eventos (herramienta, permisos, inicio y cierre) a su Atalaya. Nunca bloquean ni
// cambian lo que hace Claude: si Atalaya no responde en 3 segundos, el hook termina en silencio.
const fs = require('fs'), path = require('path'), os = require('os');

const DIR = path.join(os.homedir(), '.claude');
const FWD = path.join(DIR, 'atalaya-remote.js'), CONF = path.join(DIR, 'atalaya-remote.json'), SETTINGS = path.join(DIR, 'settings.json');
const [a, b] = process.argv.slice(2);
const uninstall = a === '--uninstall';
const fail = m => { console.error(m); process.exit(1); };
if (!uninstall) {
  if (!/^https:\/\/[^\s'"]+$/.test(a || '')) fail('Uso: node atalaya-hook.js https://SU-ATALAYA equipo:token');
  if (!/^[a-z0-9][a-z0-9-]{0,30}:[A-Za-z0-9_-]{32,}$/.test(b || '')) fail('Falta el token (equipo:token). Copie el comando completo desde su Atalaya.');
}

// el reenviador: lee el evento que Claude Code le pasa y lo envia; nunca falla ni imprime nada
const FORWARDER = `'use strict';
const fs = require('fs'), path = require('path'), https = require('https');
let c; try { c = JSON.parse(fs.readFileSync(path.join(__dirname, 'atalaya-remote.json'), 'utf8')); } catch { process.exit(0); }
const done = () => process.exit(0);
setTimeout(done, 3000).unref();
let body = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { if (body.length < 262144) body += d; });
process.stdin.on('end', () => {
  try {
    const req = https.request(c.url + '/api/hook/remote', { method: 'POST', timeout: 2500, headers: { 'Content-Type': 'application/json', 'X-Atalaya-Hook': c.cred, 'Content-Length': Buffer.byteLength(body) } }, res => { res.resume(); res.on('end', done); });
    req.on('error', done); req.on('timeout', () => { req.destroy(); done(); });
    req.end(body);
  } catch { done(); }
});
process.stdin.on('error', done);
`;

let s = {};
if (fs.existsSync(SETTINGS)) {
  try { s = JSON.parse(fs.readFileSync(SETTINGS, 'utf8').replace(/^﻿/, '')); } catch { fail('settings.json de Claude Code no es JSON válido: no se toca. Corríjalo y vuelva a intentar.'); }
  fs.copyFileSync(SETTINGS, SETTINGS + '.atalaya-bak-' + Date.now());
}
s.hooks = s.hooks || {};
// se quitan los hooks de Atalaya que hubiera (tambien los del instalador de macOS y Linux) para no enviar doble
const ours = h => typeof h.command === 'string' && /atalaya-remote\.(sh|js)/.test(h.command);
for (const ev of Object.keys(s.hooks)) {
  s.hooks[ev] = (s.hooks[ev] || []).map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !ours(h)) })).filter(g => g.hooks.length);
  if (!s.hooks[ev].length) delete s.hooks[ev];
}
if (!uninstall) {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(CONF, JSON.stringify({ url: a.replace(/\/+$/, ''), cred: b }) + '\n', { mode: 0o600 });
  try { fs.chmodSync(CONF, 0o600); } catch { }
  fs.writeFileSync(FWD, FORWARDER, { mode: 0o700 });
  // barras normales y comillas: el mismo comando sirve en cmd, PowerShell y bash
  const cmd = `node "${FWD.replace(/\\/g, '/')}"`;
  for (const ev of ['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'Stop', 'PermissionRequest', 'PermissionDenied', 'Notification',
    'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop']) {
    (s.hooks[ev] = s.hooks[ev] || []).push({ hooks: [{ type: 'command', command: cmd, ...(ev === 'SessionEnd' ? {} : { async: true }), timeout: 5 }] });
  }
} else {
  for (const f of [CONF, FWD, path.join(DIR, 'atalaya-remote.sh'), path.join(DIR, 'atalaya-remote.header')]) { try { fs.unlinkSync(f); } catch { } }
}
if (!Object.keys(s.hooks).length) delete s.hooks;
fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(SETTINGS, JSON.stringify(s, null, 2) + '\n');
console.log(uninstall ? 'Hooks de Atalaya quitados.' : 'Hooks de Atalaya instalados. Abra una sesión nueva de Claude Code y aparecerá en su pantalla.');
