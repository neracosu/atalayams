'use strict';
// Analitica desde los registros: paginas contra recursos, robots aparte, visitantes unicos del dia, rebote,
// origen (buscador, red social, IA, referido, directo e interno), campanas utm, 404, informe con comparacion,
// guardado por mes y sin recontar lo ya contado al releer los logs tras un reinicio.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Analytics, sourceOf, isPage, dayOf } = require('../server/analytics');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-ana-'));
const cfg = { stateDir: base };
const doms = () => ['tienda.com'];

assert.strictEqual(sourceOf('www.google.com.ve').name, 'Google');
assert.strictEqual(sourceOf('l.facebook.com').kind, 'social');
assert.strictEqual(sourceOf('chatgpt.com').name, 'ChatGPT');
assert.strictEqual(sourceOf('blog.tienda.com', ['tienda.com']).kind, 'internal');
assert.strictEqual(sourceOf('').kind, 'direct');
assert.ok(isPage({ method: 'GET', status: 200, path: '/producto/zapato?color=rojo' }));
assert.ok(!isPage({ method: 'GET', status: 200, path: '/wp-content/themes/x/style.css' }));
assert.ok(!isPage({ method: 'POST', status: 200, path: '/contacto' }));
assert.ok(!isPage({ method: 'GET', status: 404, path: '/nada' }));
assert.ok(!isPage({ method: 'GET', status: 200, path: '/wp-admin/index.php' }));
assert.ok(!isPage({ method: 'GET', status: 200, path: '/panel/mapa?_rsc=1x2y' }), 'precarga de Next.js');
assert.ok(!isPage({ method: 'GET', status: 200, path: '/socket.io/?EIO=4&transport=polling' }));

const bus = new EventEmitter();
const a = new Analytics(cfg, bus, { domainsOf: doms });
const now = Date.now(), yesterday = now - 86400000;
const ev = (o) => bus.emit('ev', { kind: 'http', site: 'tienda', account: 'ana', domain: 'tienda.com', method: 'GET', status: 200, cc: 'VE', ua: { name: 'Chrome', os: 'Android', mobile: true }, uaRaw: 'Mozilla Chrome', at: now - 60000, ...o });

// visitante 1: llega de Google, ve 3 paginas (no rebota) y descarga recursos
ev({ ip: '1.1.1.1', path: '/', refHost: 'google.com' });
ev({ ip: '1.1.1.1', path: '/style.css' });
ev({ ip: '1.1.1.1', path: '/tienda', refHost: 'tienda.com' });
ev({ ip: '1.1.1.1', path: '/carrito', refHost: 'tienda.com' });
// visitante 2: desde Instagram con campana, una sola pagina (rebota)
ev({ ip: '2.2.2.2', path: '/oferta?utm_source=instagram&utm_campaign=verano', refHost: 'instagram.com', cc: 'CO', ua: { name: 'Safari', os: 'iOS', mobile: true }, uaRaw: 'Safari' });
// visitante 3: directo, escritorio, pide una pagina que no existe y luego la portada
ev({ ip: '3.3.3.3', path: '/vieja-pagina', status: 404, ua: { name: 'Firefox', os: 'Windows', mobile: false }, uaRaw: 'Firefox' });
ev({ ip: '3.3.3.3', path: '/', ua: { name: 'Firefox', os: 'Windows', mobile: false }, uaRaw: 'Firefox' });
// un robot y un evento en vivo (sin detalle: no cuenta en la analitica)
ev({ ip: '9.9.9.9', path: '/', ua: { bot: true, name: 'Googlebot', kind: 'search' } });
bus.emit('ev', { kind: 'http', live: true, site: 'tienda', account: 'ana', ip: '4.4.4.4', ua: {} });
// ayer: 1 visitante
ev({ ip: '5.5.5.5', path: '/', at: yesterday });

let r = a.report('site:tienda', 1);
assert.strictEqual(r.totals.pv, 5, 'paginas vistas de hoy (sin recursos, 404 ni robots)');
assert.strictEqual(r.totals.visitors, 3);
assert.strictEqual(r.totals.bots, 1);
assert.strictEqual(Math.round(r.totals.bounce * 100), 67, 'rebotan 2 de 3 (el de Instagram y el que solo vio la portada tras el 404)');
assert.deepStrictEqual(r.sources.map(x => x.name).sort(), ['direct', 'search', 'social']);
assert.strictEqual(r.search[0].name, 'Google');
assert.strictEqual(r.social[0].name, 'Instagram');
assert.ok(/instagram · verano/.test(r.campaigns[0].name), 'campaña utm');
assert.strictEqual(r.notFound[0].name, '/vieja-pagina');
assert.strictEqual(r.entries.find(x => x.name === '/').n, 2, 'páginas de entrada');
assert.strictEqual(r.dev.find(x => x.name === 'movil').n, 2);
assert.strictEqual(r.botNames[0].name, 'Googlebot');
assert.strictEqual(r.prev.visitors, 1, 'ayer, para comparar');
r = a.report('site:tienda', 7);
assert.strictEqual(r.series.length, 7); assert.strictEqual(r.series[6].visitors, 3); assert.strictEqual(r.series[5].visitors, 1);

// se guarda por mes y se relee
a.flush();
const folder = fs.readdirSync(path.join(base, 'analytics')).find(f => f !== 'state.json');
assert.ok(fs.existsSync(path.join(base, 'analytics', folder, dayOf(now).slice(0, 7) + '.json')));
assert.ok(!JSON.stringify(fs.readFileSync(path.join(base, 'analytics', folder, dayOf(now).slice(0, 7) + '.json'), 'utf8')).includes('1.1.1.1'), 'sin IPs');

// reinicio: al releer los logs, lo ya contado no suma; lo nuevo si, y el visitante 1 no se cuenta de nuevo
const bus2 = new EventEmitter();
const b = new Analytics(cfg, bus2, { domainsOf: doms });
bus2.emit('ev', { kind: 'http', site: 'tienda', account: 'ana', domain: 'tienda.com', method: 'GET', status: 200, ua: { name: 'Chrome' }, uaRaw: 'Mozilla Chrome', ip: '1.1.1.1', path: '/', at: now - 60000 });
assert.strictEqual(b.report('site:tienda', 1).totals.pv, 5, 'la relectura no recuenta');
bus2.emit('ev', { kind: 'http', site: 'tienda', account: 'ana', domain: 'tienda.com', method: 'GET', status: 200, cc: 'VE', ua: { name: 'Chrome', os: 'Android', mobile: true }, uaRaw: 'Mozilla Chrome', ip: '1.1.1.1', path: '/gracias', at: Date.now() + 1000 });
const r2 = b.report('site:tienda', 1);
assert.strictEqual(r2.totals.pv, 6); assert.strictEqual(r2.totals.visitors, 3, 'el mismo visitante del día');
assert.strictEqual(b.summary('site:tienda').visitors, 4);

fs.rmSync(base, { recursive: true, force: true });
console.log('analytics: ok');
