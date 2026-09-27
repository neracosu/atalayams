'use strict';
// Vigilancia: escaneo (muchos sondeos), scraping (una IP con cientos de pedidos) y pico de visitas (muchas IPs,
// varias veces lo normal); se ignora la propia pantalla y los buscadores conocidos; sale tras 10 min de calma.
const assert = require('assert');
const { EventEmitter } = require('events');
const { Watch } = require('../server/watch');

const MIN = 60000;
const bus = new EventEmitter(); const evs = []; bus.on('ev', e => { if (e.kind === 'watch') evs.push(e); });
const webdef = { sites: new Map() };
const W = new Watch({ publicUrl: 'https://atalaya.midominio.com' }, bus, webdef, { manual: true });
const http = (o) => bus.emit('ev', { kind: 'http', account: 'ana', status: 200, ...o });
const t0 = Date.parse('2026-09-26T10:00:00Z');

// una hora normal: 5 visitas por minuto de varias IPs en tienda
for (let m = 0; m < 60; m++) for (let i = 0; i < 5; i++) http({ site: 'tienda', domain: 'tienda.com', ip: '10.0.' + m + '.' + i, at: t0 + m * MIN + i * 1000 });
W.evaluate(t0 + 60 * MIN);
assert.strictEqual(W.list().length, 0, 'lo normal no dispara nada');

// la propia pantalla de Atalaya y Googlebot no cuentan, aunque pidan mucho
for (let i = 0; i < 400; i++) http({ site: 'atalaya', domain: 'atalaya.midominio.com', ip: '1.1.1.1', at: t0 + 60 * MIN + i * 100 });
for (let i = 0; i < 400; i++) http({ site: 'blog', domain: 'blog.com', ip: '66.249.1.1', bot: true, ua: { name: 'Googlebot' }, at: t0 + 60 * MIN + i * 100 });
W.evaluate(t0 + 61 * MIN);
assert.strictEqual(W.list().length, 0, 'ni la pantalla ni los buscadores');
console.log('ok   vigilancia: lo normal, la propia pantalla y los buscadores conocidos no disparan nada');

// scraping: una IP con 300 pedidos en 2 min (disfrazada de Chrome)
for (let i = 0; i < 300; i++) http({ site: 'agenda', domain: 'agenda.ejemplo.com', ip: '198.51.100.23', ua: { name: 'Chrome' }, status: 404, at: t0 + 61 * MIN + i * 400 });
W.evaluate(t0 + 63 * MIN);
let a = W.of('site:agenda');
assert.ok(a && a.reason === 'scraping' && a.n >= 150 && a.topIp === '198.51.100.23', JSON.stringify(a));
assert.deepStrictEqual(evs.map(e => [e.action, e.reason, e.site]), [['start', 'scraping', 'agenda']]);

// escaneo: la defensa web anoto 40 sondeos en 15 min
webdef.sites.set('site:wp', { hits: Array.from({ length: 40 }, (_, i) => ({ t: t0 + 60 * MIN + i * 1000 })) });
http({ site: 'wp', domain: 'wp.com', ip: '9.9.9.9', at: t0 + 62 * MIN });
W.evaluate(t0 + 63 * MIN);
assert.strictEqual(W.of('site:wp').reason, 'scan');
console.log('ok   vigilancia: escaneo (sondeos de la defensa web) y scraping (una IP) con su aviso');

// pico: 90 visitas por minuto desde 40 IPs (lo normal era 5)
for (let m = 63; m < 65; m++) for (let i = 0; i < 90; i++) http({ site: 'tienda', domain: 'tienda.com', ip: '20.0.0.' + (i % 40), at: t0 + m * MIN + i * 600 });
W.evaluate(t0 + 64 * MIN + 59000);
a = W.of('site:tienda');
assert.ok(a && a.reason === 'surge' && a.base === 5 && a.ips >= 15, JSON.stringify(a));
console.log('ok   vigilancia: pico de visitas contra lo normal del sitio, desde muchas IPs');

// sale 10 min despues de volver a la calma
W.evaluate(t0 + 90 * MIN);
assert.ok(!W.of('site:agenda') && !W.of('site:tienda'));
assert.ok(evs.some(e => e.action === 'end' && e.site === 'agenda'));
console.log('ok   vigilancia: sale sola tras 10 min de calma, con aviso');

// trafico interno (el propio servidor, las revisiones de Atalaya): nunca es sospechoso
for (let i = 0; i < 400; i++) http({ site: 'hotel', domain: 'hotel.com', ip: '127.0.0.1', at: t0 + 91 * MIN + i * 300 });
for (let i = 0; i < 400; i++) http({ site: 'hotel', domain: 'hotel.com', ip: '94.72.1.1', uaRaw: 'Mozilla/5.0 (compatible; Atalaya-monitor; favicon)', at: t0 + 91 * MIN + i * 300 });
W.evaluate(t0 + 93 * MIN);
assert.ok(!W.of('site:hotel'), '127.0.0.1 y Atalaya no disparan scraping: ' + JSON.stringify(W.of('site:hotel')));
// escaneo: la IP senalada es la que sondeo, no la de mas trafico
webdef.sites.set('site:hotel', { hits: Array.from({ length: 36 }, (_, i) => ({ t: t0 + 93 * MIN + i * 1000 })), ips: new Map([['127.0.0.1', { n: 30, t: t0 + 93 * MIN }], ['45.9.9.9', { n: 6, t: t0 + 93 * MIN }]]) });
for (let i = 0; i < 50; i++) http({ site: 'hotel', domain: 'hotel.com', ip: '8.8.8.8', at: t0 + 93 * MIN + i * 100 });
W.evaluate(t0 + 94 * MIN);
assert.deepStrictEqual([W.of('site:hotel').reason, W.of('site:hotel').topIp], ['scan', '45.9.9.9']);
console.log('ok   vigilancia: el tráfico del propio servidor no es sospechoso; en un escaneo se señala a quien sondeó');

// privacidad: en publico sin IP ni dominio
const { makePrivacy } = require('../server/privacy');
const P = makePrivacy({ accounts: { ana: { label: 'ana', publicLabel: 'Distrito Norte' } }, public: {}, apps: {}, sites: {}, stateDir: require('os').tmpdir() });
const start = evs.find(e => e.reason === 'scraping');
const pub = P.event({ ...start, ip: '198.51.100.23' }, false);
assert.ok(pub.site && !pub.ip && !pub.domain && !JSON.stringify(pub).includes('agenda'), JSON.stringify(pub));
console.log('ok   vigilancia: en modo público sin IP ni dominio');
