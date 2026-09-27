#!/usr/bin/env node
'use strict';
// Simulador de Atalaya para diseñar temas sin un servidor real.
//  - sirve la interfaz de Atalaya (web/) tal cual
//  - reproduce en bucle una grabacion real en MODO PUBLICO (sim/recording.jsonl): estados y eventos
//    con sus tiempos originales, corridos al presente
//  - responde los paneles de detalle con respuestas grabadas (sim/details.json)
//  - /sim: botones para provocar lo que casi nunca pasa (caida, ataque, permiso, despliegue, pico)
// Uso: node sim/server.js [--port=4000] [--speed=1]
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WEB = path.join(ROOT, 'web');
const arg = k => (process.argv.find(a => a.startsWith(`--${k}=`)) || '').split('=')[1];
const PORT = Number(arg('port') || process.env.PORT || 4000);
const SPEED = Number(arg('speed') || 1);

const REC = fs.readFileSync(path.join(__dirname, 'recording.jsonl'), 'utf8').trim().split('\n').map(l => JSON.parse(l));
const DET = JSON.parse(fs.readFileSync(path.join(__dirname, 'details.json'), 'utf8'));
const HELLO = REC.find(r => r.e === 'hello').d;
const LOOP = REC[REC.length - 1].t + 2000;
const T0 = Math.min(...REC.filter(r => r.e === 'state').map(r => r.d.system && r.d.system.ts).filter(Boolean));
const VERSION = (JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).atalaya || HELLO.version);

// corre al presente todas las marcas de tiempo de la grabacion
const TIME_KEYS = /^(t|ts|since|lastActivity|waitSince|lastSeen|privateUntil|created|ready|at|audited|lastPush|fullAt|activity)$/;
function shift(o, d) {
  if (Array.isArray(o)) return o.map(x => shift(x, d));
  if (!o || typeof o !== 'object') return o;
  const out = {};
  for (const [k, v] of Object.entries(o)) out[k] = typeof v === 'number' && v > 1.6e12 && TIME_KEYS.test(k) ? v + d : shift(v, d);
  return out;
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2' };
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'";
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', 'Content-Security-Policy': CSP }); res.end(body); };
const json = (res, code, o) => send(res, code, JSON.stringify(o));

function listThemes() {
  const dir = path.join(WEB, 'themes');
  return fs.readdirSync(dir).filter(id => fs.existsSync(path.join(dir, id, 'theme.json'))).map(id => {
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, id, 'theme.json'), 'utf8'));
      if (m.id !== id) { console.log(`[tema] ${id}: el "id" de theme.json debe ser "${id}"`); return null; }
      return { id, name: m.name, description: m.description || '', author: m.author || '', version: m.version || '', license: m.license || '', palette: m.palette || {}, preview: m.preview ? `/themes/${id}/${m.preview}` : null };
    } catch (e) { console.log(`[tema] ${id}: theme.json no es JSON valido (${e.message})`); return null; }
  }).filter(Boolean);
}

// ------------------------------------------------------------------ reproduccion
const clients = new Set();
let current = arg('theme') || 'ciudad';
let lastState = null;
const overrides = { down: new Set(), waiting: null, jail: 3, quarantine: 1, saturated: 0, quota: null, watch: new Map() }; // watch: id -> { reason, n, until }
// la grabacion es anterior a la carcel y a los silos de datos: si no los trae, se inventan para que el tema
// tenga algo que dibujar (un silo por cuenta con sitios, tuberias a sus dos primeros sitios, consultas que van y vienen)
function fakeSilos(o) {
  const list = [];
  for (const a of o.accounts.filter(x => x.id !== 'root')) {
    const sites = (o.sites || []).filter(x => x.account === a.id).slice(0, 2);
    if (!sites.length) continue;
    const k = [...a.id].reduce((n, c) => n + c.charCodeAt(0), 0), wave = Math.max(0, Math.sin(Date.now() / 9000 + k));
    const active = Math.round(wave * 3), sleep = k % 3 === 0 ? 14 : 2;
    list.push({ account: a.id, size: (k % 9 + 1) * 90 * 1048576, n: k % 4 + 1, conns: active + sleep, active, sleep, busy: Math.round(wave * 40), slow: false,
      links: sites.map((x, i) => ({ kind: 'site', id: x.id, active: i === 0 ? active : 0, busy: Math.round(wave * 40) })) });
  }
  return { list, hot: 0.4, sb: [] };
}
function write(c, e, d) { try { c.write(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`); } catch { } }
function broadcast(e, d) { for (const c of clients) write(c, e, d); }
function patchState(s) {
  const o = JSON.parse(JSON.stringify(s));
  for (const a of o.apps) if (overrides.down.has(a.id)) { a.status = 'down'; a.online = 0; }
  if (!o.silos) o.silos = fakeSilos(o);
  for (const x of [...o.apps, ...(o.sites || [])]) { const w = overrides.watch.get(x.id); if (w && w.until > Date.now()) x.watch = { reason: w.reason, n: w.n, since: w.since }; }
  if (overrides.saturated > Date.now()) o.saturation = { level: 'bad', causes: [{ id: 'cpu', level: 'bad', label: 'CPU al 97 %' }], since: overrides.saturated - 40000 };
  if (overrides.quota && overrides.quota.until > Date.now()) for (const a of o.accounts) if (a.id === overrides.quota.account) a.quota = overrides.quota.q;
  if (!o.jail) o.jail = { n: overrides.jail, atalaya: Math.max(0, overrides.jail - 2), quarantine: overrides.quarantine };
  if (overrides.waiting && overrides.waiting.until > Date.now()) for (const x of o.sessions) if (x.id === overrides.waiting.sid) { x.waitKind = 'permission'; x.waitSince = overrides.waiting.since; }
  return o;
}
let cycleStart = Date.now(), idx = 0;
setInterval(() => {
  const now = Date.now(), el = (now - cycleStart) * SPEED;
  if (el > LOOP) { cycleStart = now; idx = 0; return; }
  while (idx < REC.length && REC[idx].t <= el) {
    const r = REC[idx++];
    if (r.e === 'hello' || r.e === 'mode') continue;
    // la grabacion empezo en T0; este ciclo empezo en cycleStart: todo se corre esa diferencia
    const d = shift(r.d, cycleStart - T0);
    if (r.e === 'state') { lastState = patchState(d); broadcast('state', lastState); }
    else broadcast(r.e, d);
  }
}, 100);

// ------------------------------------------------------------------ escenarios (/sim)
function scenario(name, target) {
  const s = lastState;
  if (!s) return 'Todavía no llegó el primer estado';
  const pick = a => (target && a.find(x => x && x.id === target)) || a[Math.random() * a.length | 0]; // ?objetivo=<id> elige el edificio
  const now = Date.now();
  if (name === 'caida') {
    const a = pick(s.apps.filter(x => !overrides.down.has(x.id)));
    if (!a) return 'No hay servicios';
    overrides.down.add(a.id);
    broadcast('ev', { kind: 'pm2', t: now, action: 'down', account: a.account, app: a.id, appName: a.name, label: '' });
    setTimeout(() => { overrides.down.delete(a.id); broadcast('ev', { kind: 'pm2', t: Date.now(), action: 'restart', account: a.account, app: a.id, appName: a.name }); }, 45000);
    return `Se cayó «${a.name}» por 45 s`;
  }
  if (name === 'ataque') { for (let i = 0; i < 25; i++) setTimeout(() => broadcast('ev', { kind: i % 6 === 5 ? 'block' : 'attack', t: Date.now(), cc: 'CN' }), i * 180); return '25 intentos de acceso en 5 s'; }
  if (name === 'permiso') {
    const x = pick(s.sessions);
    if (!x) return 'No hay sesiones en la grabación';
    overrides.waiting = { sid: x.id, since: now, until: now + 30000 };
    broadcast('ev', { kind: 'claude', t: now, action: 'permission', waitKind: 'permission', account: x.account, sid: x.id, label: '' });
    return 'Un agente pide permiso durante 30 s';
  }
  if (name === 'despliegue') {
    const a = pick(s.apps);
    broadcast('ev', { kind: 'deploy', t: now, action: 'building', account: a.account, app: a.id });
    setTimeout(() => broadcast('ev', { kind: 'deploy', t: Date.now(), action: Math.random() < 0.7 ? 'ready' : 'error', account: a.account, app: a.id }), 6000);
    return `Despliegue de «${a.name}»`;
  }
  if (name === 'pico') {
    const targets = [...s.apps, ...(s.sites || [])];
    const hot = pick(targets);
    overrides.watch.set(hot.id, { reason: 'surge', n: 240, since: now, until: now + 30000 });
    for (let i = 0; i < 120; i++) setTimeout(() => { const a = i % 2 ? hot : targets[Math.random() * targets.length | 0]; broadcast('ev', { kind: 'http', t: Date.now(), account: a.account, app: s.apps.includes(a) ? a.id : null, site: s.apps.includes(a) ? null : a.id, status: Math.random() < 0.06 ? 502 : 200, bot: Math.random() < 0.3, cc: pick(['VE', 'US', 'CO', 'ES', 'MX']) }); }, i * 60);
    return '120 visitas en 7 s';
  }
  if (name === 'dominio') { const a = pick(s.accounts.filter(x => x.id !== 'root')); broadcast('ev', { kind: 'domain', t: now, action: pick(['added', 'removed', 'changed']), account: a.id }); return `Cambio de dominio en ${a.label}`; }
  if (name === 'escaneo') {
    const x = pick(s.sites && s.sites.length ? s.sites : s.apps), k = s.apps.includes(x) ? 'app' : 'site';
    overrides.watch.set(x.id, { reason: 'scan', n: 291, since: now, until: now + 45000 });
    broadcast('ev', { kind: 'watch', t: now, action: 'start', reason: 'scan', n: 291, account: x.account, [k]: x.id });
    const fams = ['env', 'git', 'wp', 'phpinfo', 'admin', 'backup'];
    for (let i = 0; i < 36; i++) setTimeout(() => broadcast('ev', { kind: 'probe', t: Date.now(), account: x.account, [k]: x.id, fam: fams[i % fams.length], status: 404, exposed: false }), i * 700);
    setTimeout(() => broadcast('ev', { kind: 'watch', t: Date.now(), action: 'end', reason: 'scan', account: x.account, [k]: x.id }), 45000);
    return `Escaneo en «${x.name}»: patrullas y 36 sondeos durante 45 s`;
  }
  if (name === 'carcel') {
    const x = pick(s.sites && s.sites.length ? s.sites : s.apps);
    overrides.jail++;
    broadcast('ev', { kind: 'defense', t: now, action: 'block', by: 'auto', reason: 'scan', account: x.account, [s.apps.includes(x) ? 'app' : 'site']: x.id });
    return `Una IP va a la cárcel desde «${x.name}» (${overrides.jail} presos)`;
  }
  if (name === 'cuarentena') {
    const x = pick(s.sites || []);
    if (!x) return 'No hay sitios en la grabación';
    overrides.quarantine++;
    broadcast('ev', { kind: 'phpfile', t: now, action: 'quarantine', account: x.account, site: x.id, why: 'webshell' });
    return `Un archivo de «${x.name}» va a cuarentena (${overrides.quarantine} en total)`;
  }
  if (name === 'correo') {
    const accs = s.accounts.filter(x => x.id !== 'root');
    for (let i = 0; i < 8; i++) setTimeout(() => broadcast('ev', { kind: 'mail', t: Date.now(), dir: pick(['in', 'out', 'bounce']), account: pick(accs).id, cat: pick(['auth', 'nouser', 'full', 'spam']) }), i * 300);
    return '8 correos';
  }
  if (name === 'limite') {
    overrides.saturated = now + 40000;
    broadcast('ev', { kind: 'saturation', t: now, action: 'start', causes: ['CPU al 97 %'] });
    setTimeout(() => broadcast('ev', { kind: 'saturation', t: Date.now(), action: 'end', causes: [] }), 40000);
    return 'El servidor llega al límite por 40 s (use también «Pico de visitas» para ver el atasco)';
  }
  if (name === 'cuota') {
    const a = pick(s.accounts.filter(x => x.id !== 'root')), bad = Math.random() < 0.5;
    overrides.quota = { account: a.id, until: now + 60000, q: { what: pick(['disco', 'inodos']), pct: bad ? 98 : 88, level: bad ? 'bad' : 'warn' } };
    return `${a.label} llega al ${overrides.quota.q.pct} % de su cuota por 60 s`;
  }
  return 'Escenario desconocido';
}
const SIM_PAGE = `<!doctype html><meta charset="utf-8"><title>Simulador de Atalaya</title>
<style>body{font:15px system-ui,sans-serif;background:#0b0d09;color:#e6e6e6;max-width:640px;margin:40px auto;padding:0 16px}button{display:block;width:100%;margin:8px 0;padding:12px;font:inherit;background:#1d2419;color:#e6e6e6;border:1px solid #4b5a3a;cursor:pointer;text-align:left}button:hover{border-color:#9fd356}#out{margin-top:16px;color:#9fd356;min-height:1.4em}a{color:#9fd356}</style>
<h1>Simulador de Atalaya</h1><p>Provoca eventos que en la grabación casi no aparecen, para ver cómo los muestra su tema. Abra la pantalla en otra pestaña: <a href="/" target="_blank">/</a></p>
<button data-s="caida">Un servicio se cae (45 s)</button><button data-s="ataque">Ataque: 25 intentos de acceso</button><button data-s="permiso">Un agente pide permiso (30 s)</button>
<button data-s="despliegue">Un despliegue (a veces falla)</button><button data-s="pico">Pico de visitas</button><button data-s="dominio">Cambio de dominio</button><button data-s="correo">Correo</button>
<button data-s="limite">El servidor llega al límite (40 s)</button><button data-s="cuota">Una cuenta al límite de su cuota (60 s)</button>
<button data-s="escaneo">Escaneo: patrullas y sondeos (45 s)</button><button data-s="carcel">Una IP va a la cárcel</button><button data-s="cuarentena">Un archivo PHP va a cuarentena</button>
<p id="out"></p><script src="/sim/sim.js"></script>`;
const SIM_JS = `document.querySelectorAll('[data-s]').forEach(b => b.onclick = async () => { const r = await fetch('/sim/' + b.dataset.s, { method: 'POST' }); document.getElementById('out').textContent = await r.text(); });`;

// ------------------------------------------------------------------ http
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'), p = u.pathname;
  if (p === '/api/stream') {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write('retry: 2000\n\n');
    clients.add(res);
    write(res, 'hello', { ...shift(HELLO, Date.now() - T0), version: VERSION, theme: current, priv: false, user: 'diseñador', role: 'owner' });
    if (lastState) write(res, 'state', lastState);
    req.on('close', () => clients.delete(res));
    return;
  }
  if (p === '/api/me') return json(res, 200, { user: 'diseñador', role: 'owner' });
  if (p === '/api/themes') return json(res, 200, { current, themes: listThemes() });
  if (p === '/api/changelog') return json(res, 200, DET.changelog || { version: VERSION, releases: [] });
  if (p === '/api/detail') {
    const k = u.searchParams.get('kind') + ':' + u.searchParams.get('id');
    const d = DET[k] || Object.entries(DET).find(([kk]) => kk.startsWith(u.searchParams.get('kind') + ':'))?.[1];
    return d ? json(res, 200, shift(d, Date.now() - T0)) : json(res, 404, { error: 'No grabado en el simulador' });
  }
  if (p === '/api/theme' && req.method === 'POST') {
    let b = ''; req.on('data', c => { b += c; }); req.on('end', () => { try { current = JSON.parse(b).id; broadcast('theme', { id: current }); json(res, 200, { ok: true }); } catch { json(res, 400, { error: 'JSON inválido' }); } });
    return;
  }
  if (p === '/sim') return send(res, 200, SIM_PAGE, 'text/html; charset=utf-8');
  if (p === '/sim/sim.js') return send(res, 200, SIM_JS, 'text/javascript; charset=utf-8');
  if (p.startsWith('/sim/') && req.method === 'POST') return send(res, 200, scenario(p.slice(5), u.searchParams.get('objetivo')), 'text/plain; charset=utf-8');
  if (p.startsWith('/api/')) return json(res, 403, { error: 'No disponible en el simulador' });
  if (p === '/login' || p === '/setup') return send(res, 302, '', 'text/plain');
  const rel = p === '/' ? '/index.html' : p;
  const file = path.normalize(path.join(WEB, rel));
  if (!file.startsWith(WEB + path.sep)) return send(res, 404, 'No encontrado', 'text/plain');
  fs.readFile(file, (err, data) => err ? send(res, 404, 'No encontrado', 'text/plain') : send(res, 200, data, MIME[path.extname(file)] || 'application/octet-stream'));
}).listen(PORT, '127.0.0.1', () => {
  console.log(`Simulador de Atalaya en http://localhost:${PORT}`);
  console.log(`  pantalla:    http://localhost:${PORT}/?theme=<su-tema>`);
  console.log(`  escenarios:  http://localhost:${PORT}/sim`);
  console.log(`  temas:       ${listThemes().map(t => t.id).join(', ')}`);
});
