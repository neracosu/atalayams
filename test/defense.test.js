'use strict';
// Defensa: bloqueo manual y automatico (solo con la automatica encendida), nunca Cloudflare, privadas, la lista
// blanca ni usuarios de Atalaya; freno ante saturacion; vencimiento; y la vigilancia con sus motivos nuevos
// (expuesto, fuerza bruta, varios sitios). El ayudante es falso: no toca el firewall.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Watch } = require('../server/watch');
const { Defense } = require('../server/defense');

const MIN = 60000;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-def-'));
const bus = new EventEmitter(); const evs = []; bus.on('ev', e => { if (e.kind === 'defense' || e.kind === 'watch') evs.push(e); });
const webdef = { sites: new Map(), exposed: new Map() };
const W = new Watch({}, bus, webdef, { manual: true });
const calls = [];
const auth = { sessions: new Map([['k', { ip: '186.188.1.1', seen: Date.now() }]]) };
let db = { conns: 20, max: 151 };
const ctx = { watch: W, auth, dbActivity: { available: () => true, snapshot: () => db }, host: { system: { cores: 12, load: [1, 1, 1] } } };
const D = new Defense({ stateDir: tmp, edition: 'vps' }, bus, ctx, { manual: true, helper: true,
  request: (action, params) => { calls.push([action, params.ip, params.hours]); return 'r' + calls.length; }, result: () => ({ ok: true }) });
const http = o => bus.emit('ev', { kind: 'http', account: 'ana', status: 200, ...o });

(async () => {
  // ---- vigilancia: fuerza bruta, varios sitios y expuesto
  const t0 = Date.now();
  for (let i = 0; i < 25; i++) http({ site: 'wp', domain: 'wp.com', ip: '45.1.1.1', method: 'POST', path: '/wp-login.php', at: t0 - i * 5000 });
  for (const site of ['a', 'b', 'c']) webdef.sites.set('site:' + site, { account: 'ana', site, domain: site + '.com', hits: [], ips: new Map([['77.7.7.7', { n: 8, t: t0 }]]) });
  webdef.exposed.set('x', { account: 'ana', site: 'tienda', domain: 'tienda.com', path: '/.env', verdict: 'exposed', last: t0, ip: '66.6.6.6', n: 1 });
  webdef.sites.set('site:tienda', { account: 'ana', site: 'tienda', domain: 'tienda.com', hits: [], ips: new Map() });
  W.evaluate(t0);
  assert.strictEqual(W.of('site:wp').reason, 'bruteforce'); assert.strictEqual(W.of('site:wp').topIp, '45.1.1.1');
  assert.deepStrictEqual(['a', 'b', 'c'].map(x => W.of('site:' + x).reason), ['multi', 'multi', 'multi']);
  assert.ok(W.of('site:tienda').reason === 'exposed' && W.of('site:tienda').topIp === '66.6.6.6' && W.of('site:tienda').path === '/.env');
  console.log('ok   vigilancia: expuesto, fuerza bruta y la misma IP en varios sitios');

  // ---- la automatica apagada no bloquea nada
  assert.strictEqual(calls.length, 0, 'apagada de fabrica');

  // ---- manual: nunca Cloudflare, privadas, usuarios de Atalaya ni lista blanca
  await assert.rejects(D.block('104.23.5.5'), /Cloudflare/);
  await assert.rejects(D.block('10.0.0.3'), /privada/);
  await assert.rejects(D.block('186.188.1.1'), /usuario/);
  D.setConf({ allow: ['8.8.4.4', 'no-es-ip'] });
  await assert.rejects(D.block('8.8.4.4'), /lista/);
  assert.deepStrictEqual(D.conf.allow, ['8.8.4.4']);
  const rec = await D.block('45.1.1.1', { by: 'neri' });
  assert.deepStrictEqual(calls[0], ['block-ip', '45.1.1.1', 24]);
  assert.ok(rec.reason === 'bruteforce' && rec.site === 'wp' && rec.by === 'neri');
  assert.ok(!W.of('site:wp'), 'bloquear resuelve la vigilancia del sitio');
  assert.ok(evs.some(e => e.kind === 'defense' && e.action === 'block' && e.site === 'wp'));
  assert.ok(evs.some(e => e.kind === 'watch' && e.action === 'end' && e.resolved && e.site === 'wp'));
  for (let i = 0; i < 25; i++) http({ site: 'wp', domain: 'wp.com', ip: '45.1.1.1', method: 'POST', path: '/wp-login.php', at: Date.now() });
  W.evaluate(); assert.ok(!W.of('site:wp'), 'el trafico de una IP bloqueada ya no dispara');
  // un escaneo de una sola IP: bloquearla no deja la vigilancia prendida con sus sondeos viejos
  webdef.sites.set('site:esc', { account: 'ana', site: 'esc', domain: 'esc.com', hits: Array.from({ length: 40 }, () => ({ t: Date.now(), ip: '51.1.2.3' })), ips: new Map([['51.1.2.3', { n: 40, t: Date.now() }]]) });
  http({ site: 'esc', domain: 'esc.com', ip: '51.1.2.3', at: Date.now() });
  W.evaluate();
  assert.strictEqual(W.of('site:esc').topIp, '51.1.2.3');
  await D.block('51.1.2.3', { by: 'neri' });
  W.evaluate();
  assert.ok(!W.of('site:esc'), 'tras bloquear, sus sondeos viejos no vuelven a disparar el escaneo');
  console.log('ok   defensa: bloqueo manual con su sitio; nunca Cloudflare, privadas, usuarios ni lista blanca');

  // ---- automatica: expuesto, fuerza bruta, scraping y varios sitios; no escaneos sueltos
  D.setConf({ auto: true, hours: 6 });
  bus.emit('ev', { kind: 'watch', action: 'start', reason: 'scan', ip: '9.9.9.9', site: 'z' });
  bus.emit('ev', { kind: 'watch', action: 'start', reason: 'exposed', ip: '66.6.6.6', site: 'tienda' });
  await new Promise(r => setTimeout(r, 50));
  assert.ok(!calls.some(c => c[1] === '9.9.9.9'), 'un escaneo solo no se bloquea automatico');
  assert.deepStrictEqual(calls.find(c => c[1] === '66.6.6.6'), ['block-ip', '66.6.6.6', 6]);
  bus.emit('ev', { kind: 'phpfile', action: 'hit', ip: '203.0.113.77', site: 's1', account: 'ana', domain: 'ana.com' });
  await new Promise(r => setTimeout(r, 50));
  assert.strictEqual(D.records.find(r => r.ip === '203.0.113.77').reason, 'phpfile', 'quien pide una puerta trasera va a la cárcel con la automática');
  console.log('ok   defensa automática: bloquea expuesto y ataques; no escaneos sueltos');

  // ---- saturacion: con MySQL al 90 % frena a quien ataca ahora (aunque sea un escaneo)
  webdef.sites.set('site:s', { account: 'ana', site: 's', domain: 's.com', hits: Array.from({ length: 30 }, () => ({ t: Date.now() })), ips: new Map() });
  http({ site: 's', domain: 's.com', ip: '5.5.5.5', at: Date.now() });
  W.evaluate();
  W.active.get('site:s').top = { ip: '5.5.5.5', n: 30 };
  db = { conns: 140, max: 151 };
  D.tick(); await new Promise(r => setTimeout(r, 50));
  assert.ok(calls.some(c => c[1] === '5.5.5.5'), 'freno antes de la caída');
  assert.strictEqual(D.records.find(r => r.ip === '5.5.5.5').reason, 'saturation');
  console.log('ok   defensa: con el servidor al límite frena a quienes atacan en ese momento');

  // ---- carcel: bloqueos manuales del firewall (con su motivo de las notas) y los de Atalaya
  const { manualBlocks } = require('../server/defense');
  fs.writeFileSync(path.join(tmp, 'rules.v4'), '*filter\n:INPUT ACCEPT [0:0]\n-A INPUT -p tcp -j f2b-sshd\n-A INPUT -s 198.51.100.8/32 -j DROP\n-A INPUT -s 203.0.113.99/32 -j DROP\nCOMMIT\n');
  fs.writeFileSync(path.join(tmp, 'notas.txt'), '# IPs bloqueadas en el firewall. Solo root.\n# 2026-09-26 · bloqueo de prueba: las que mas descargaron\n198.51.100.8\n');
  const man = manualBlocks(path.join(tmp, 'rules.v4'), path.join(tmp, 'notas.txt'));
  assert.deepStrictEqual(man.map(m => [m.ip, m.why, m.permanent]), [['198.51.100.8', 'bloqueo de prueba: las que mas descargaron', true], ['203.0.113.99', 'Bloqueo manual en el firewall', true]]);
  D.rulesFile = path.join(tmp, 'rules.v4'); D.notesFile = path.join(tmp, 'notas.txt'); D.jailCache = null;
  const jail = D.jail();
  assert.ok(jail.some(r => r.ip === '198.51.100.8' && r.permanent) && jail.some(r => r.ip === '5.5.5.5' && !r.permanent), 'la cárcel une firewall y Atalaya');
  calls.length = 0;
  await D.release('203.0.113.99', 'neri');
  assert.deepStrictEqual(calls[0].slice(0, 2), ['unblock-manual', '203.0.113.99'], 'liberar un bloqueo manual pasa por el ayudante');
  await D.release('5.5.5.5', 'neri');
  assert.deepStrictEqual(calls[1].slice(0, 2), ['unblock-ip', '5.5.5.5']);
  console.log('ok   cárcel: bloqueos manuales del firewall con su motivo y los de Atalaya; liberar cada uno');

  // ---- expediente de un preso: bloqueos, sitios, registro de seguridad y sus ultimas peticiones
  const { SecLog } = require('../server/seclog');
  const SL = new SecLog({ stateDir: tmp }, bus);
  bus.emit('ev', { kind: 'defense', action: 'block', ip: '7.7.7.7', reason: 'scraping', by: 'neri', site: 's1', domain: 'ana.com' });
  bus.emit('ev', { kind: 'phpfile', action: 'hit', ip: '7.7.7.7', site: 's1', domain: 'ana.com', path: '/home/ana/x.php', status: 404 });
  bus.emit('ev', { kind: 'http', ip: '7.7.7.7', path: '/' }); // lo que no es de seguridad no se anota
  assert.deepStrictEqual(SL.ofIp('7.7.7.7').map(e => [e.kind, e.action]), [['phpfile', 'hit'], ['defense', 'block']]);
  assert.strictEqual(SL.ofSite('s1').length, 2);
  const lf = path.join(tmp, 'ana.com-ssl_log');
  fs.writeFileSync(lf, ['7.7.7.7 - - [26/Sep/2026:10:00:00 -0700] "GET /.env HTTP/1.1" 404 - "-" "curl/8"', '8.8.8.8 - - [26/Sep/2026:10:00:01 -0700] "GET / HTTP/1.1" 200 1 "-" "x"',
    '7.7.7.7 - - [26/Sep/2026:10:05:00 -0700] "GET /.env HTTP/1.1" 404 - "-" "curl/8"', '7.7.7.7 - - [26/Sep/2026:10:06:00 -0700] "POST /wp-login.php HTTP/1.1" 200 5 "-" "curl/8"', ''].join('\n'));
  ctx.logs = { tailers: new Map([[lf, {}]]), geo: { country: () => ({ cc: 'US', name: 'Estados Unidos' }) } };
  ctx.seclog = SL;
  const dos = D.dossier('7.7.7.7');
  assert.ok(dos.geo.cc === 'US' && dos.reqs.total === 3 && dos.reqs.topPaths[0].path === '/.env' && dos.reqs.topPaths[0].n === 2 && dos.reqs.recent[0].path === '/wp-login.php' && dos.reqs.ua === 'curl/8');
  assert.strictEqual(dos.events.length, 2);
  console.log('ok   expediente: registro de seguridad por IP y por sitio, y las peticiones de la IP en los registros');

  // ---- vencimiento y privacidad
  D.tick(Date.now() + 25 * 3600000);
  assert.ok(D.records.every(r => r.status === 'expired' || r.status === 'lifted') && D.records.some(r => r.status === 'expired'));
  const { makePrivacy } = require('../server/privacy');
  const P = makePrivacy({ accounts: { ana: { label: 'ana', publicLabel: 'Distrito Norte' } }, public: {}, apps: {}, sites: {}, stateDir: tmp });
  const pub = P.event({ kind: 'defense', action: 'block', ip: '45.1.1.1', reason: 'bruteforce', by: 'neri', hours: 24, account: 'ana', site: 'wp', domain: 'wp.com' }, false);
  assert.ok(pub.site && !pub.ip && !pub.name && pub.by === 'manual' && !JSON.stringify(pub).includes('neri'), JSON.stringify(pub));
  console.log('ok   defensa: los bloqueos vencen solos; en modo público sin IP, dominio ni usuario');
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
