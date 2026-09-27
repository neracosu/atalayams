'use strict';
// Bloqueo en Cloudflare (con la API simulada): conectar verifica el token y lee las zonas; cada bloqueo de la defensa
// crea una regla en la zona del sitio (o en todas si no se sabe el sitio) y al salir de la carcel se borra.
// Y la analitica marca el sitio que solo recibe IPs de Cloudflare. Uso: node test/cloudflare.test.js
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { EventEmitter } = require('events');
const { Cloudflare } = require('../server/cloudflare');
const { Analytics } = require('../server/analytics');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-cf-'));
const calls = [];
let next = 1;
const fake = async (url, o = {}) => {
  const u = url.replace('https://api.cloudflare.com/client/v4', ''), auth = (o.headers || {}).Authorization;
  calls.push(`${o.method} ${u}`);
  const ok = r => ({ status: 200, json: async () => ({ success: true, ...r }) });
  if (auth !== 'Bearer ' + 'T'.repeat(40)) return { status: 403, json: async () => ({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }) };
  if (u === '/user/tokens/verify') return ok({ result: { status: 'active' } });
  if (u.startsWith('/zones?')) return ok({ result: [{ id: 'z1', name: 'ana.com', status: 'active' }, { id: 'z2', name: 'tienda.com', status: 'active' }], result_info: { total_pages: 1 } });
  if (o.method === 'POST') return ok({ result: { id: 'r' + next++ } });
  if (o.method === 'DELETE') return ok({ result: { id: 'x' } });
  return { status: 404, json: async () => ({ success: false, errors: [{ message: 'not found' }] }) };
};
const bus = new EventEmitter();
const C = new Cloudflare({ stateDir: dir }, bus, { fetch: fake });
(async () => {
  await assert.rejects(C.connect('corto'), /no parece un token/);
  await assert.rejects(C.connect('X'.repeat(40)), /rechazó el token/);
  const st = await C.connect('T'.repeat(40));
  assert.deepStrictEqual(st.zones, ['ana.com', 'tienda.com']);
  assert.strictEqual((fs.statSync(path.join(dir, 'cloudflare.json')).mode & 0o777), 0o600, 'el token queda en un archivo 600');
  // bloqueo de un sitio: solo su zona; bloqueo sin sitio: todas
  assert.strictEqual(await C.block('203.0.113.9', { domain: 'blog.ana.com', reason: 'escaneo', hours: 24 }), 1);
  assert.ok(calls.some(c => c === 'POST /zones/z1/firewall/access_rules/rules'));
  assert.strictEqual(await C.block('198.51.100.7', {}), 2);
  assert.strictEqual(await C.block('198.51.100.8', { domain: 'otro.com' }), 0, 'un sitio que no esta en Cloudflare no crea reglas');
  assert.strictEqual(C.status().rules, 3);
  assert.strictEqual(await C.unblock('198.51.100.7'), 2);
  assert.strictEqual(C.status().rules, 1);
  // por el bus: la defensa bloquea y libera
  bus.emit('ev', { kind: 'defense', action: 'block', ip: '192.0.2.44', domain: 'tienda.com', hours: 6 });
  await new Promise(r => setTimeout(r, 30));
  assert.strictEqual(C.status().rules, 2);
  bus.emit('ev', { kind: 'defense', action: 'expire', ip: '192.0.2.44' });
  await new Promise(r => setTimeout(r, 30));
  assert.strictEqual(C.status().rules, 1);
  C.setOn(false);
  bus.emit('ev', { kind: 'defense', action: 'block', ip: '192.0.2.45', domain: 'tienda.com' });
  await new Promise(r => setTimeout(r, 30));
  assert.strictEqual(C.status().rules, 1, 'apagado, no bloquea alla');
  // la analitica: un sitio que solo recibe IPs de Cloudflare
  const A = new Analytics({ stateDir: dir }, null); A.startedAt = 0;
  for (let i = 0; i < 80; i++) A.hit({ site: 'cf', domain: 'ana.com', at: Date.now(), path: '/', status: 200, ip: '104.16.0.' + (i % 200), ua: {} });
  for (let i = 0; i < 80; i++) A.hit({ site: 'ok', domain: 'b.com', at: Date.now(), path: '/', status: 200, ip: '190.9.0.' + (i % 200), ua: {} });
  assert.ok(A.cfOnly('site:cf') && !A.cfOnly('site:ok'), 'marca solo al sitio sin la IP real');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ok   cloudflare: conexión con token, reglas por zona al bloquear y liberar, y aviso de sitios sin la IP real');
})().catch(e => { console.error(e); process.exit(1); });
