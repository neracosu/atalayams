#!/usr/bin/env node
'use strict';
// Atalaya · hooks de Claude Code para un equipo remoto, en cualquier sistema (Windows, macOS o Linux).
// Solo necesita Node.js, el mismo que usa Claude Code: no usa curl, sh ni PowerShell para enviar.
// Instalar (Windows, PowerShell):
//   irm https://SU-ATALAYA/install/remote-hook.js -OutFile $env:TEMP\atalaya-hook.js; node $env:TEMP\atalaya-hook.js https://SU-ATALAYA equipo:token
// Quitar:  node atalaya-hook.js --uninstall
// Solo agrega hooks que envian eventos (herramienta, permisos, inicio y cierre) a su Atalaya. Nunca bloquean ni
// cambian lo que hace Claude: si Atalaya no responde en 3 segundos, el hook termina en silencio.
//
// QUE SALE DE ESTA COMPUTADORA. El filtro corre AQUI, antes de enviar: lo que no esta en esta lista no viaja.
//   Siempre:      que paso (inicio, cierre, uso de una herramienta, pedido de permiso), el NOMBRE de la herramienta
//                 (Read, Edit, Bash...), el nombre de la carpeta del proyecto (solo el ultimo tramo) y el id de la sesion.
//   Nunca:        el contenido de sus archivos, lo que Claude responde, el resultado de los comandos, sus instrucciones
//                 completas, rutas completas, variables de entorno ni llaves.
//   Con --detalle (opcional, apagado si no lo pide): ademas, el archivo (su ruta dentro del proyecto) o el comando
//                 de cada paso, recortados y con las llaves tapadas. NO incluye lo que usted escribe.
//   Con --instrucciones (opcional, aparte y apagado): el comienzo de cada instruccion que le escribe a Claude
//                 (200 caracteres). Es texto libre: puede llevar datos de su trabajo. Enciendalo solo si lo quiere ver.
// Puede leer el reenviador instalado en ~/.claude/atalaya-remote.js: son unas 40 lineas.
const fs = require('fs'), path = require('path'), os = require('os');

const DIR = path.join(os.homedir(), '.claude');
const FWD = path.join(DIR, 'atalaya-remote.js'), CONF = path.join(DIR, 'atalaya-remote.json'), SETTINGS = path.join(DIR, 'settings.json');
const args = process.argv.slice(2), detail = args.includes('--detalle'), prompts = args.includes('--instrucciones');
const [a, b] = args.filter(x => x !== '--detalle' && x !== '--instrucciones');
const uninstall = a === '--uninstall';
const fail = m => { console.error(m); process.exit(1); };
if (!uninstall) {
  if (!/^https:\/\/[^\s'"]+$/.test(a || '')) fail('Uso: node atalaya-hook.js https://SU-ATALAYA equipo:token');
  if (!/^[a-z0-9][a-z0-9-]{0,30}:[A-Za-z0-9_-]{32,}$/.test(b || '')) fail('Falta el token (equipo:token). Copie el comando completo desde su Atalaya.');
}

// el reenviador: lee el evento que Claude Code le pasa y lo envia; nunca falla ni imprime nada
const FORWARDER = `'use strict';
// Atalaya: reenvia a su pantalla QUE esta haciendo Claude Code, no el contenido. El filtro es la funcion slim().
const fs = require('fs'), path = require('path'), https = require('https');
let c; try { c = JSON.parse(fs.readFileSync(path.join(__dirname, 'atalaya-remote.json'), 'utf8')); } catch { process.exit(0); }
const done = () => process.exit(0);
setTimeout(done, 3000).unref();
// lo que parezca una llave se tapa aunque venga dentro de un comando o de una instruccion
const cut = (v, n) => String(v == null ? '' : v).replace(/\\s+/g, ' ').replace(/(eyJ[\\w-]{10,}\\.[\\w-]+\\.[\\w-]+|sb_(secret|publishable)_[\\w-]+|gh[pousr]_\\w{20,}|github_pat_\\w+|sk-[\\w-]{20,}|[A-Za-z0-9_\\-]{36,})/g, '***').slice(0, n);
// lo unico que sale: una lista cerrada de campos. Todo lo demas del evento se descarta aqui
function slim(e) {
  const o = {};
  for (const k of ['hook_event_name', 'session_id', 'permission_mode', 'tool_name', 'tool_use_id', 'source', 'reason', 'notification_type', 'agent_id', 'agent_type']) if (typeof e[k] === 'string') o[k] = String(e[k]).replace(/[^\\w:.-]/g, '').slice(0, 120); // identificadores: sin texto libre
  if (e.cwd) o.cwd = String(e.cwd).split(/[\\\\/]/).filter(Boolean).pop() || '';
  if (c.detail) {
    const i = e.tool_input || {}, t = {};
    for (const [k, n] of [['file_path', 200], ['notebook_path', 200], ['command', 140], ['description', 140], ['pattern', 80], ['url', 200], ['query', 100], ['skill', 60]]) if (typeof i[k] === 'string') t[k] = cut(k.endsWith('_path') ? inside(i[k], e.cwd) : i[k], n);
    if (Object.keys(t).length) o.tool_input = t;
  }
  // lo que usted escribe es texto libre: viaja solo si lo pidio aparte
  if (c.prompts) {
    if (typeof e.prompt === 'string') o.prompt = cut(e.prompt, 200);
    if (typeof e.message === 'string') o.message = cut(e.message, 200);
  }
  return o;
}
// de un archivo, su ruta dentro del proyecto; si esta fuera, solo su nombre. Nunca la ruta de su computadora
function inside(file, cwd) {
  const f = String(file).replace(/\\\\/g, '/'), d = String(cwd || '').replace(/\\\\/g, '/').replace(/\\/+$/, '');
  if (d && f.toLowerCase().startsWith(d.toLowerCase() + '/')) return d.split('/').pop() + f.slice(d.length);
  return f.split('/').pop();
}
let body = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', d => { if (body.length < 4194304) body += d; });
process.stdin.on('end', () => {
  try {
    const out = JSON.stringify(slim(JSON.parse(body)));
    const req = https.request(c.url + '/api/hook/remote', { method: 'POST', timeout: 2500, headers: { 'Content-Type': 'application/json', 'X-Atalaya-Hook': c.cred, 'Content-Length': Buffer.byteLength(out) } }, res => { res.resume(); res.on('end', done); });
    req.on('error', done); req.on('timeout', () => { req.destroy(); done(); });
    req.end(out);
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
  fs.writeFileSync(CONF, JSON.stringify({ url: a.replace(/\/+$/, ''), cred: b, detail, prompts }) + '\n', { mode: 0o600 });
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
console.log(uninstall ? 'Hooks de Atalaya quitados.' : `Hooks de Atalaya instalados. Abra una sesión nueva de Claude Code y aparecerá en su pantalla.\nSe envía: qué está haciendo Claude (herramienta y proyecto)${detail ? ', el archivo o comando de cada paso' : ''}${prompts ? ', el comienzo de cada instrucción que usted escribe' : ''}. Nunca el contenido de sus archivos ni las respuestas.\nEl filtro está en ${FWD.replace(/\\/g, '/')} por si quiere leerlo.`);
