'use strict';
// Saturacion: una causa cuenta si se sostiene (dos muestras), avisa al entrar y salir de «al limite», y lee los
// avisos «max_children» de PHP-FPM por sitio (el pool es el dominio con _).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Saturation } = require('../server/saturation');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-sat-'));
const log = path.join(tmp, 'error.log');
const d = new Date(), pad = n => String(n).padStart(2, '0'), M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const stamp = t => { const x = new Date(t); return `${pad(x.getDate())}-${M[x.getMonth()]}-${x.getFullYear()} ${pad(x.getHours())}:${pad(x.getMinutes())}:${pad(x.getSeconds())}`; };
fs.writeFileSync(log, [
  `[${stamp(Date.now() - 20 * 86400000)}] WARNING: [pool viejo_com] server reached max_children setting (5), consider raising it`,
  `[${stamp(Date.now() - 3 * 86400000)}] WARNING: [pool tienda_ejemplo_com] server reached max_children setting (5), consider raising it`,
  `[${stamp(Date.now() - 60000)}] WARNING: [pool tienda_ejemplo_com] server reached max_children setting (5), consider raising it`,
  `[${stamp(Date.now())}] NOTICE: ready to handle connections`, ''].join('\n'));

const bus = new EventEmitter(); const evs = []; bus.on('ev', e => evs.push(e));
const sys = { cores: 4, cpu: 20, load: [1, 1, 1], mem: { pct: 40 }, swap: { total: 100, used: 5 } };
const ctx = { host: { system: sys }, logs: { sites: [{ id: 'g1', domain: 'tienda.ejemplo.com', account: 'neracosu' }], lastMinute: { req: 100, err: 1 } },
  dbActivity: { available: () => true, snapshot: () => ({ conns: 50, max: 400 }) } };
const S = new Saturation({ edition: 'vps' }, bus, ctx, { manual: true, phpLogs: [{ ver: '82', file: log }] });

const php = S.phpSites();
assert.deepStrictEqual(php.map(p => [p.domain, p.week, p.recent, p.site]), [['tienda.ejemplo.com', 2, 1, 'g1']], 'solo la semana; el pool es el sitio');
assert.deepStrictEqual(S.siteState('g1'), { php: true, max: 5, n: 1 });
fs.appendFileSync(log, `[${stamp(Date.now())}] WARNING: [pool tienda_ejemplo_com] server reached max_children setting (5), consider raising it\n`);
S.sample();
assert.strictEqual(S.phpSites()[0].recent, 2, 'lee lo nuevo del registro');
console.log('ok   saturación: sitios sin procesos PHP por pool, de la semana y recientes');

sys.cpu = 97; S.sample();
assert.strictEqual(S.level, 'ok', 'un pico de una muestra no es saturación');
S.sample();
assert.strictEqual(S.level, 'bad');
assert.deepStrictEqual(evs.filter(e => e.kind === 'saturation').map(e => [e.action, e.causes[0]]), [['start', 'CPU 97 %']]);
const sec = S.section();
assert.ok(sec.status === 'bad' && sec.findings.some(f => /al límite/.test(f.title)) && sec.findings.some(f => /sin procesos PHP/.test(f.title)));
sys.cpu = 30; S.sample();
assert.strictEqual(S.level, 'ok');
assert.strictEqual(evs.filter(e => e.kind === 'saturation').pop().action, 'end');
console.log('ok   saturación: al límite solo si se sostiene; avisa al entrar y al salir; la Salud lo explica');
fs.rmSync(tmp, { recursive: true, force: true });
