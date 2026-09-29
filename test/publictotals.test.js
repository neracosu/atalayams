'use strict';
// Totales publicos de anoche (anoche.json para el juego web): redondeo a dos cifras, dia de Venezuela aunque el
// servidor tenga otra zona horaria, nada escrito si falta una fuente o el dia no se conto entero, ningun dato
// identificable, escritura atomica con permisos 644, apagado por defecto y solo en la edicion VPS.
process.env.TZ = 'America/Los_Angeles'; // como el VPS: la analitica guarda los dias en hora del Pacifico
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PublicTotals, round2, dateVE, startVE, yesterdayVE } = require('../server/publictotals');
const { Analytics } = require('../server/analytics');
const { WebDefense } = require('../server/webdefense');
const settings = require('../server/settings');

const MIN = 60000, DAY = 86400000;
const base = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-anoche-'));
let n = 0;
const tmp = () => { const d = path.join(base, 'caso' + (++n)); fs.mkdirSync(d); return d; };

// redondeo a dos cifras significativas
assert.strictEqual(round2(1847), 1800);
assert.strictEqual(round2(1850), 1900);
assert.strictEqual(round2(12345), 12000);
assert.strictEqual(round2(419), 420);
assert.strictEqual(round2(995), 1000);
assert.strictEqual(round2(47), 47, 'con menos de tres cifras queda igual');
assert.strictEqual(round2(0), 0);

// fecha en hora de Venezuela (UTC-4), no en la del servidor
assert.strictEqual(dateVE(Date.parse('2026-09-28T03:59:00Z')), '2026-09-27');
assert.strictEqual(dateVE(Date.parse('2026-09-28T04:00:00Z')), '2026-09-28');
assert.strictEqual(startVE('2026-09-27'), Date.parse('2026-09-27T04:00:00Z'));
assert.strictEqual(yesterdayVE(Date.parse('2026-09-28T10:30:00Z')), '2026-09-27');
assert.strictEqual(yesterdayVE(Date.parse('2026-09-28T02:00:00Z')), '2026-09-26', 'a las 22:00 del 27 en Venezuela, anoche es el 26');

// apagado por defecto: en los valores de fabrica y al cargar un config.json que no lo menciona
assert.deepStrictEqual(settings.DEFAULTS.publicTotals, { on: false });
assert.ok(!settings.EDITABLE.includes('publicTotals'), 'el asistente no lo puede encender');
{
  const dir = tmp(), conf = path.join(dir, 'config.json');
  fs.writeFileSync(conf, JSON.stringify({ stateDir: dir }));
  const prev = process.env.ATALAYA_CONFIG, prevEd = process.env.ATALAYA_EDITION;
  process.env.ATALAYA_CONFIG = conf; delete process.env.ATALAYA_EDITION;
  const cfg = settings.load(dir);
  if (prev === undefined) delete process.env.ATALAYA_CONFIG; else process.env.ATALAYA_CONFIG = prev;
  if (prevEd !== undefined) process.env.ATALAYA_EDITION = prevEd;
  assert.strictEqual(cfg.edition, 'vps');
  assert.strictEqual(cfg.publicTotals.on, false);
  const pt = new PublicTotals(cfg, new EventEmitter());
  assert.strictEqual(pt.available(), false);
  assert.strictEqual(pt.start(), false);
  assert.strictEqual(pt.run(Date.parse('2026-09-28T12:00:00Z')), null);
  assert.ok(!fs.existsSync(path.join(dir, 'publico')), 'apagado no escribe nada');
}
// solo en la edicion VPS: encendido en Hosting, Cloud o Equipo no hace nada
for (const edition of ['hosting', 'cloud', 'equipo']) {
  const dir = tmp();
  const pt = new PublicTotals({ stateDir: dir, edition, publicTotals: { on: true } }, new EventEmitter());
  assert.strictEqual(pt.available(), false, edition);
  assert.strictEqual(pt.start(), false, edition);
  assert.strictEqual(pt.run(Date.parse('2026-09-28T12:00:00Z')), null, edition);
  assert.ok(!fs.existsSync(path.join(dir, 'publico')), edition);
}
assert.strictEqual(new PublicTotals({ stateDir: tmp(), edition: 'vps', publicTotals: { on: 'si' } }, new EventEmitter()).available(), false, 'solo con true');

// ---- un dia completo con datos falsos: 27 de septiembre en Venezuela ----
const FECHA = '2026-09-27', A = startVE(FECHA), B = A + DAY; // 04:00 UTC del 27 al 04:00 UTC del 28
const p = x => String(x).padStart(2, '0');
const stamp = t => { const x = new Date(t); return `[${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())} ${p(x.getUTCHours())}:${p(x.getUTCMinutes())}:${p(x.getUTCSeconds())} +0000]`; };
const fail = (t, ip) => `${stamp(t)} info [whostmgrd] ${ip} - root "POST /login/?login_only=1 HTTP/1.1" FAILED LOGIN whostmgrd: user password incorrect`;
const scan = (t, ip) => `${stamp(t)} info [cpaneld] ${ip} - - "GET /wp-login.php HTTP/1.1" FAILED LOGIN cpaneld: login attempt without username`;

// el registro del panel: empieza dos dias antes (cubre el dia); 66 contrasenas en el dia, 10 antes, 10 despues y
// 5 escaneres sin usuario (no son intentos)
function panelLog(dir, first = A - 2 * DAY) {
  const lines = [fail(first, '203.0.113.200')];
  for (let i = 0; i < 10; i++) lines.push(fail(A - 30 * MIN + i * 1000, '203.0.113.201'));
  for (let i = 0; i < 66; i++) lines.push(fail(A + 2 * 3600000 + i * 60000, '203.0.113.' + (i % 50)));
  for (let i = 0; i < 5; i++) lines.push(scan(A + 5 * 3600000 + i * 1000, '198.51.100.7'));
  for (let i = 0; i < 10; i++) lines.push(fail(B + 10 * MIN + i * 1000, '203.0.113.202'));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'login_log'), lines.join('\n') + '\n');
}
// visitas de personas: 300 a la 01:00 de Venezuela (22:00 del 26 en el Pacifico: otro dia local) y 1547 al
// mediodia; fuera del dia, 50 a las 22:00 del 26 y 50 a la 01:00 del 28 (hora de Venezuela). Mas robots y
// recursos, que no son paginas vistas
function visits(bus) {
  const hit = (at, extra = {}) => bus.emit('ev', { kind: 'http', at, account: 'cuenta1', app: 'tienda', domain: 'tienda.com', status: 200, method: 'GET',
    path: '/producto', ip: '192.0.2.' + (at % 200), ua: { name: 'Chrome' }, ...extra });
  for (let i = 0; i < 300; i++) hit(A + 1 * 3600000 + i * 1000);
  for (let i = 0; i < 1547; i++) hit(A + 12 * 3600000 + i * 1000);
  for (let i = 0; i < 50; i++) hit(A - 2 * 3600000 + i * 1000);
  for (let i = 0; i < 50; i++) hit(B + 1 * 3600000 + i * 1000);
  for (let i = 0; i < 200; i++) hit(A + 13 * 3600000 + i * 1000, { ua: { name: 'Googlebot', bot: true } });
  for (let i = 0; i < 200; i++) hit(A + 14 * 3600000 + i * 1000, { path: '/estilos.css' });
}
// Atalaya contando todo el dia: un pulso cada 5 minutos desde el primer minuto
function wholeDay(pt, from = A + MIN, to = B + 6 * 3600000 + 5 * MIN) { for (let t = from; t <= to; t += 5 * MIN) pt.tick(t); }

function setup(opts = {}) {
  const dir = tmp(), bus = new EventEmitter();
  const cfg = { stateDir: dir, edition: 'vps', publicTotals: { on: true } };
  const analytics = new Analytics(cfg, bus);
  const webdef = new WebDefense(cfg, bus, { sites: [] });
  const logDir = path.join(dir, 'cpanel-logs');
  if (opts.panel !== false) panelLog(logDir, opts.panelFirst);
  const sshLog = path.join(dir, 'secure');
  if (opts.ssh !== false) fs.writeFileSync(sshLog, '');
  const pt = new PublicTotals(cfg, bus, { analytics, logins: { dir: logDir }, webdef, sshLog });
  pt.listen();
  return { dir, bus, cfg, analytics, webdef, pt, out: path.join(dir, 'publico', 'anoche.json') };
}
function fill(s, o = {}) {
  if (o.whole !== false) wholeDay(s.pt, o.from);
  if (o.visits !== false) visits(s.bus);
  for (let i = 0; i < 1781; i++) s.pt.attempt(A + 3 * 3600000 + i * 1000); // SSH
  // 419 IPs distintas, cada una dos veces (cuenta una)
  for (let i = 0; i < 419; i++) { const ip = `203.0.${113 + Math.floor(i / 250)}.${i % 250}`; s.pt.robot(ip, A + 4 * 3600000 + i * 1000); s.pt.robot(ip, A + 5 * 3600000); }
  s.pt.robot('203.0.113.77', B + 3600000); // del dia siguiente: no suma a este
  // un sondeo rechazado por la defensa web (/.env con 404) suma una IP mas; el mismo con 200 no
  s.bus.emit('ev', { kind: 'http', at: A + 6 * 3600000, account: 'cuenta1', app: 'tienda', domain: 'tienda.com', status: 404, method: 'GET', path: '/.env', ip: '198.51.100.99', ua: { name: 'curl', bot: true } });
  s.bus.emit('ev', { kind: 'http', at: A + 6 * 3600000, account: 'cuenta1', app: 'tienda', domain: 'tienda.com', status: 200, method: 'GET', path: '/.env', ip: '198.51.100.98', bytes: 0, ua: { name: 'curl', bot: true } });
}

{
  const s = setup();
  fill(s);
  const due = B + 6 * 3600000 + 10 * MIN; // 06:10 del 28 en Venezuela
  assert.strictEqual(s.pt.run(B + 5 * 3600000 + 59 * MIN), null, 'antes de las 06:00 no se escribe');
  assert.ok(!fs.existsSync(s.out));
  assert.strictEqual(s.pt.panelFails(FECHA), 66, 'solo las contrasenas del dia, sin escaneres');
  assert.strictEqual(s.pt.visits(FECHA), 1847, 'paginas vistas del dia de Venezuela, aunque cruce dos dias locales');
  const r = s.pt.run(due);
  assert.deepStrictEqual(r, { fecha: FECHA, intentos: 1800, robots: 420, visitas: 1800 });
  // la forma exacta, sin nada mas
  const txt = fs.readFileSync(s.out, 'utf8');
  assert.strictEqual(txt, '{"fecha":"2026-09-27","intentos":1800,"robots":420,"visitas":1800}\n');
  assert.deepStrictEqual(Object.keys(JSON.parse(txt)), ['fecha', 'intentos', 'robots', 'visitas']);
  // permisos para que Apache lo sirva
  assert.strictEqual(fs.statSync(s.out).mode & 0o777, 0o644);
  assert.strictEqual(fs.statSync(path.dirname(s.out)).mode & 0o777, 0o755);
  assert.deepStrictEqual(fs.readdirSync(path.dirname(s.out)), ['anoche.json'], 'sin temporales');
  // nada identificable: ni IPs, ni sitios, ni cuentas, ni el nombre de la maquina
  for (const bad of ['203.0.113', '203.0.114', '198.51.100', '192.0.2', 'tienda', 'cuenta1', os.hostname(), 'whostmgrd', 'root']) assert.ok(!txt.includes(bad), bad);
  // lo contado (privado, 600) tampoco guarda IPs: solo huellas cortas
  const priv = fs.readFileSync(s.pt.file, 'utf8');
  assert.strictEqual(fs.statSync(s.pt.file).mode & 0o777, 0o600);
  assert.ok(!/203\.0\.11[34]|198\.51\.100/.test(priv), 'sin IPs en lo contado');
  // una vez al dia: el mismo dia no se vuelve a escribir, ni tras reiniciar
  const ino = fs.statSync(s.out).ino;
  assert.strictEqual(s.pt.run(due + 3600000), null);
  const again = new PublicTotals(s.cfg, new EventEmitter(), { analytics: s.analytics, logins: { dir: path.join(s.dir, 'cpanel-logs') }, sshLog: path.join(s.dir, 'secure') });
  assert.strictEqual(again.run(due + 2 * 3600000), null, 'lo recuerda tras reiniciar');
  assert.strictEqual(again.days[FECHA].ips.size, 420, 'las IPs del dia sobreviven al reinicio');
  // escritura atomica: un archivo nuevo que reemplaza al anterior con rename (otro inodo), nunca a medias
  again.done = null;
  const r2 = again.run(due + 3 * 3600000);
  assert.deepStrictEqual(r2, r);
  assert.notStrictEqual(fs.statSync(s.out).ino, ino, 'se reemplaza con rename');
  assert.deepStrictEqual(fs.readdirSync(path.dirname(s.out)), ['anoche.json']);
  // del bus: intentos por SSH y bloqueos del cortafuegos y de la carcel se anotan en el dia de hoy
  const now = Date.now(), today = dateVE(now);
  s.pt.tick(now);
  const ssh0 = s.pt.days[today].ssh, ips0 = s.pt.days[today].ips.size;
  s.bus.emit('ev', { kind: 'attack', service: 'ssh', ip: '203.0.113.5', user: 'admin' });
  s.bus.emit('ev', { kind: 'block', reason: 'csf', service: 'sshd', ip: '203.0.113.6' });
  s.bus.emit('ev', { kind: 'defense', action: 'block', ip: '203.0.113.6' });
  s.bus.emit('ev', { kind: 'defense', action: 'unblock', ip: '203.0.113.9' });
  assert.strictEqual(s.pt.days[today].ssh, ssh0 + 1);
  assert.strictEqual(s.pt.days[today].ips.size, ips0 + 1, 'la misma IP cuenta una vez');
}

// si una fuente no tiene datos, no se escribe nada
const due = B + 6 * 3600000 + 10 * MIN;
function nothing(s, why) {
  const r = s.pt.run(due);
  assert.ok(r && r.skip, why);
  assert.ok(!fs.existsSync(s.out), why);
  assert.strictEqual(s.pt.done, FECHA, why + ': no se reintenta cada minuto');
}
{ const s = setup(); fill(s, { visits: false }); nothing(s, 'sin visitas en la analitica'); }
{ const s = setup({ panelFirst: A + 3600000 }); fill(s); nothing(s, 'el registro del panel empieza a mitad del dia (rotado)'); }
{ const s = setup({ panel: false, ssh: false }); fill(s); nothing(s, 'sin registro de SSH ni del panel'); }
{ const s = setup(); fill(s, { from: A + 3 * 3600000 }); nothing(s, 'Atalaya se encendio a las 03:00'); }
{
  const s = setup(); fill(s, { whole: false });
  wholeDay(s.pt, A + MIN, A + 10 * 3600000); wholeDay(s.pt, A + 12 * 3600000); // dos horas detenida
  nothing(s, 'corte de dos horas');
}
{ const s = setup(); wholeDay(s.pt); visits(s.bus); for (let i = 0; i < 10; i++) s.pt.attempt(A + 3600000); nothing(s, 'ningun robot frenado: la defensa no se esta leyendo'); }
// una sola fuente de intentos alcanza (un servidor sin cPanel): el SSH solo
{
  const s = setup({ panel: false }); fill(s);
  assert.strictEqual(s.pt.panelFails(FECHA), undefined);
  assert.deepStrictEqual(s.pt.run(due), { fecha: FECHA, intentos: 1800, robots: 420, visitas: 1800 });
}
// otra carpeta de salida (publicTotals.dir), por si el estado de Atalaya no es transitable para Apache
{
  const s = setup(); const other = path.join(s.dir, 'fuera', 'publico');
  s.cfg.publicTotals.dir = other;
  const pt = new PublicTotals(s.cfg, s.bus, { analytics: s.analytics, logins: { dir: path.join(s.dir, 'cpanel-logs') }, webdef: s.webdef, sshLog: path.join(s.dir, 'secure') });
  pt.listen(); s.pt = pt; fill(s);
  assert.ok(pt.run(due).fecha);
  assert.ok(fs.existsSync(path.join(other, 'anoche.json')));
}

fs.rmSync(base, { recursive: true, force: true });
console.log('publictotals: ok');
