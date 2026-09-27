'use strict';
// favicons: firma de imagenes, candidatos del HTML, IPs internas y que solo salgan en modo privado
const assert = require('assert');
const { sniff, candidates, privateIp, keyOf } = require('../server/favicons');
const { makePrivacy } = require('../server/privacy');

assert.strictEqual(sniff(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2])), 'image/png');
assert.strictEqual(sniff(Buffer.from([0, 0, 1, 0, 1, 0])), 'image/x-icon');
assert.strictEqual(sniff(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'image/svg+xml');
assert.strictEqual(sniff(Buffer.from('<html><body>404</body></html>')), null, 'una pagina de error no es un icono');
const c = candidates('<link rel="icon" href="/a.png" sizes="16x16"><link rel="apple-touch-icon" href="/big.png"><link rel="mask-icon" href="/m.svg">', 'https://x.com/');
assert.deepStrictEqual(c.map(x => x.url), ['https://x.com/big.png', 'https://x.com/a.png', 'https://x.com/favicon.ico'], 'el mas grande primero, sin mask-icon, y /favicon.ico al final');
for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.0.5', '172.20.1.1', '169.254.169.254', '::1']) assert.ok(privateIp(ip), ip);
assert.ok(!privateIp('8.8.8.8'));
assert.match(keyOf('Ejemplo.com'), /^[0-9a-f]{16}$/);

// proyeccion: el favicon solo viaja en privado; en publico queda el cartel pixel (fijo para cada proyecto)
const cfg = { accounts: { ana: { label: 'Ana', publicLabel: 'Distrito', color: '#fff' } }, public: {}, apps: {} };
const pv = makePrivacy(cfg);
const g = { id: 'ana:/home/ana/public_html', account: 'ana', domain: 'tienda.com', type: 'static', lastSeen: 0 };
const ctx = {
  host: { apps: [{ account: 'ana', name: 'api', status: 'online', cpu: 1, mem: 1 }], system: null, topProcs: [], claudeProcs: {} },
  claude: { list: () => [] }, history: {},
  logs: { sites: [g], groups: new Map([[g.id, g], ['b', { account: 'ana', domain: 'api.tienda.com', app: 'api' }]]), lastMinute: { perSite: {}, perApp: {}, perAccount: {} }, history: { a: [] }, security: {}, mail: {}, mainDomain: new Map(), siteLabel: () => 'Sitio', siteIcon: () => null, slidingMinute: () => ({}) },
  favicons: { ready: d => (d === 'tienda.com' || d === 'api.tienda.com') ? 'abcdef0123456789' : null },
};
let priv, pub;
priv = pv.state(ctx, true); pub = pv.state(ctx, false);
if (priv) {
  assert.strictEqual(priv.sites[0].favicon, 'abcdef0123456789');
  assert.strictEqual(priv.apps[0].favicon, 'abcdef0123456789', 'la app hereda el favicon del sitio que la sirve');
  assert.strictEqual(pub.sites[0].favicon, undefined, 'en publico no sale el favicon');
  assert.strictEqual(pub.apps[0].favicon, undefined);
  assert.ok(pub.sites[0].icon && pub.apps[0].icon, 'sin favicon: cartel pixel asignado');
}
// la ficha de un sitio llega con kind 'site' (antes la etiqueta del sitio lo pisaba y el panel quedaba en «Cargando…»)
{
  const H = { appReq: new Map(), appRecent: new Map(), rolls: new Map(), visitorsNow: () => 0, todayOf: () => ({ visits: 0, visitors: 0 }) };
  const d = pv.detail({ ...ctx, history: H }, 'site', pub.sites[0].id, false);
  assert.ok(d, 'la ficha existe');
  assert.strictEqual(d.kind, 'site', 'la ficha del sitio dice que es un sitio');
}
console.log('ok   favicons: firmas, candidatos, IPs internas' + (priv ? ' y solo en modo privado' : ''));
