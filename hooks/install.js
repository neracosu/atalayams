#!/usr/bin/env node
'use strict';
// Instala (o quita con --uninstall) los hooks de Atalaya en ~/.claude/settings.json de cada cuenta.
// Fusiona sin tocar el resto de la configuracion, respalda el archivo y conserva dueno y permisos.
const fs = require('fs');
const path = require('path');

const CMD = '/opt/atalaya/hooks/atalaya-hook.sh';
const uninstall = process.argv.includes('--uninstall');
const dry = process.argv.includes('--dry-run');
const only = process.argv.find(a => a.startsWith('--user='))?.slice(7);
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'config.json'), 'utf8'));
// las cuentas se detectan igual que en el servicio (cPanel o usuarios con PM2/Claude)
const { Accounts } = require('../server/accounts');
new Accounts(cfg, { emit() {} });

// evento -> matcher (null = sin matcher)
const EVENTS = {
  SessionStart: null, SessionEnd: null, UserPromptSubmit: null, Stop: null,
  PermissionRequest: null, Notification: null,
  PreToolUse: 'AskUserQuestion|ExitPlanMode',
  PostToolUse: null, PostToolUseFailure: null, PermissionDenied: null,
  SubagentStart: null, SubagentStop: null,
};
const ours = h => typeof h.command === 'string' && h.command.includes('/opt/atalaya/hooks/');
const crypto = require('crypto');
// tokens por cuenta: el servidor guarda solo su sha256
const tokensFile = cfg.stateDir + '/hook-tokens.json';
let tokens = {};
try { tokens = JSON.parse(fs.readFileSync(tokensFile, 'utf8')); } catch { }
function writeHeader(user, dir, uid, gid) {
  const file = dir + '/atalaya-hook.header';
  if (uninstall) { try { fs.unlinkSync(file); } catch { } delete tokens[user]; return; }
  const token = crypto.randomBytes(32).toString('base64url');
  const tmp = file + '.atalaya-tmp';
  fs.writeFileSync(tmp, `X-Atalaya-Hook: ${user}:${token}\n`, { mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.chownSync(tmp, uid, gid);
  fs.renameSync(tmp, file);
  tokens[user] = crypto.createHash('sha256').update(token).digest('hex');
}

for (const user of Object.keys(cfg.accounts)) {
  if (only && user !== only) continue;
  const home = user === 'root' ? '/root' : '/home/' + user;
  const dir = home + '/.claude', file = dir + '/settings.json';
  if (!fs.existsSync(dir)) { console.log(`- ${user}: sin ~/.claude, se omite`); continue; }
  const exists = fs.existsSync(file);
  let raw = exists ? fs.readFileSync(file, 'utf8') : '{}';
  let s;
  try { s = JSON.parse(raw); } catch { console.log(`! ${user}: settings.json no es JSON valido, NO se toca`); continue; }
  const st = exists ? fs.statSync(file) : fs.statSync(dir);
  s.hooks = s.hooks || {};
  // quitar entradas previas de Atalaya (idempotente)
  for (const ev of Object.keys(s.hooks)) {
    s.hooks[ev] = (s.hooks[ev] || []).map(g => ({ ...g, hooks: (g.hooks || []).filter(h => !ours(h)) })).filter(g => g.hooks.length);
    if (!s.hooks[ev].length) delete s.hooks[ev];
  }
  if (!uninstall) {
    for (const [ev, matcher] of Object.entries(EVENTS)) {
      // SessionEnd va sincrono: Claude se cierra al instante y un hook async no alcanza a avisar (el bot quedaba
      // «En pausa»). Solo agrega hasta 2 s al salir si Atalaya no responde.
      const group = { hooks: [{ type: 'command', command: CMD, ...(ev === 'SessionEnd' ? {} : { async: true }), timeout: 5 }] };
      if (matcher) group.matcher = matcher;
      (s.hooks[ev] = s.hooks[ev] || []).push(group);
    }
  }
  if (!Object.keys(s.hooks).length) delete s.hooks;
  if (!dry) { const ds = fs.statSync(dir); writeHeader(user, dir, ds.uid, ds.gid); }
  const out = JSON.stringify(s, null, 2) + '\n';
  if (out === raw) { console.log(`= ${user}: sin cambios`); continue; }
  if (dry) { console.log(`~ ${user}: cambiaria ${file}`); continue; }
  if (exists) {
    const bak = `${file}.atalaya-bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
    fs.copyFileSync(file, bak);
    fs.chownSync(bak, st.uid, st.gid); fs.chmodSync(bak, 0o600);
  }
  const tmp = file + '.atalaya-tmp';
  fs.writeFileSync(tmp, out, { mode: exists ? st.mode & 0o777 : 0o600 });
  fs.chmodSync(tmp, exists ? st.mode & 0o777 : 0o600); // explicito: la umask no debe cambiar permisos
  fs.chownSync(tmp, st.uid, st.gid);
  fs.renameSync(tmp, file);
  console.log(`${uninstall ? '-' : '+'} ${user}: hooks ${uninstall ? 'quitados' : 'instalados'} en ${file}`);
}

if (!dry) {
  fs.mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(tokensFile + '.tmp', JSON.stringify(tokens, null, 2), { mode: 0o600 });
  fs.renameSync(tokensFile + '.tmp', tokensFile);
  console.log(`tokens de hooks: ${Object.keys(tokens).length} cuentas (${tokensFile})`);
}
