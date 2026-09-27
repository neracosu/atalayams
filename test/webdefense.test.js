'use strict';
// Defensa web: que rutas cuentan como sondeo, el login de WordPress en un sitio WordPress, los paneles que
// existen, la verificacion de archivos expuestos (sin guardar su contenido) y la privacidad del evento.
const assert = require('assert');
const { EventEmitter } = require('events');
const { WebDefense, classify, looksExposed } = require('../server/webdefense');
const { makePrivacy } = require('../server/privacy');

const cases = { '/.env': 'secrets', '/.git/config': 'secrets', '/backup.sql': 'secrets', '/wp-config.php.bak': 'secrets', '/shell.php': 'shells',
  '/wp-content/uploads/2024/05/x.php': 'shells', '/phpmyadmin/': 'panels', '/xmlrpc.php': 'wordpress', '/cgi-bin/luci': 'exploits',
  '/?page=../../etc/passwd': 'exploits', '/about.php': null, '/index.php': null, '/login': null, '/assets/app.js': null, '/.well-known/acme-challenge/x': null };
for (const [p, want] of Object.entries(cases)) assert.strictEqual(classify(p, false), want, p);
assert.strictEqual(classify('/wp-login.php', true), null, 'en un WordPress su login no es un sondeo');
assert.strictEqual(classify('/wp-login.php', false), 'wordpress');
console.log('ok   defensa web: familias de sondeo sin falsos positivos comunes');

(async () => {
  const bus = new EventEmitter(), evs = [];
  bus.on('ev', e => { if (e.kind === 'probe') evs.push(e); });
  const logs = { sites: [{ id: 'ana:/home/ana/public_html', type: 'wordpress', domain: 'ana.dev' }, { id: 'ana:/home/ana/tienda', type: 'php', domain: 'tienda.dev' }] };
  const W = new WebDefense({}, bus, logs);
  const files = { '/.env': { status: 200, type: 'text/plain', head: 'APP_KEY=base64:xxxx\nDB_PASSWORD=secret\n' }, '/.git/config': { status: 200, type: 'text/html', head: '<!doctype html><html>app</html>' } };
  W.fetch = async (domain, p) => files[p] || (domain === 'tienda.dev' ? { status: 200, type: 'text/html', head: '<!doctype html><html>app</html>' } : { status: 404, type: 'text/html', head: 'no' });
  const hit = (site, path, status, extra = {}) => bus.emit('ev', { kind: 'http', account: 'ana', site, domain: site.includes('tienda') ? 'tienda.dev' : 'ana.dev', path, status, bytes: status === 200 ? 900 : 0, ip: '203.0.113.5', cc: 'NL', at: Date.now(), ...extra });
  const wp = 'ana:/home/ana/public_html', shop = 'ana:/home/ana/tienda';
  hit(wp, '/wp-login.php', 200); // su propio login
  hit(wp, '/wp-login.php', 200, { method: 'POST' }); // fuerza bruta
  hit(wp, '/.env', 200); // expuesto de verdad
  hit(shop, '/.git/config', 200); // SPA que responde lo mismo a todo
  hit(shop, '/phpmyadmin/', 404); // sondeo
  hit(shop, '/admin.php', 200); // su propio admin: no cuenta
  hit(shop, '/phpmyadmin/index.php', 200); // phpMyAdmin abierto
  await new Promise(r => setTimeout(r, 50));
  const s1 = W.sites.get('site:' + wp), s2 = W.sites.get('site:' + shop);
  assert.deepStrictEqual(s1.fam, { wordpress: 1, secrets: 1 }, 'solo el POST al login cuenta en un WordPress');
  assert.deepStrictEqual(s2.fam, { secrets: 1, panels: 1 });
  const ex = [...W.exposed.values()];
  assert.strictEqual(ex.find(x => x.path === '/.env').verdict, 'exposed', 'el .env tenia variables');
  assert.strictEqual(ex.find(x => x.path === '/.git/config').verdict, 'catchall', 'la SPA responde lo mismo a cualquier ruta');
  assert.strictEqual(ex.find(x => x.path === '/phpmyadmin/index.php').verdict, 'panel');
  assert.ok(!JSON.stringify([...W.exposed.values()]).includes('DB_PASSWORD'), 'el contenido nunca se guarda');
  assert.ok(evs.some(e => e.exposed && e.confirmed && e.path === '/.env'), 'la confirmacion llega a la pantalla');
  assert.deepStrictEqual(W.summary().exposed, 1);
  console.log('ok   defensa web: fuerza bruta en WordPress, paneles propios, SPA que responde a todo y .env expuesto confirmado');

  // tapado para el dominio pero servido por mail.: la verificacion prueba los otros nombres
  const W2 = new WebDefense({}, bus, logs);
  W2.fetch = async (host, p) => host === 'mail.otro.dev' && p === '/.git/HEAD' ? { status: 200, type: 'text/plain', head: 'ref: refs/heads/main\n' } : { status: 403, type: 'text/html', head: 'no' };
  const v = await W2.verify({ domain: 'otro.dev', path: '/.git/HEAD', fam: 'secrets' });
  assert.deepStrictEqual([v.verdict, v.via], ['exposed', 'mail.otro.dev']);
  console.log('ok   defensa web: la verificacion encuentra lo que se sirve por mail. aunque el dominio lo tape');

  assert.ok(looksExposed('/backup.sql', { head: '-- MySQL dump 10.13\nCREATE TABLE users', type: 'application/octet-stream' }));
  assert.ok(!looksExposed('/.env', { head: '<html><body>Not found</body></html>', type: 'text/html' }));
  assert.ok(looksExposed('/.git/HEAD', { head: 'ref: refs/heads/main\n', type: 'text/plain' }));

  const P = makePrivacy({ accounts: { ana: { label: 'ana', publicLabel: 'Distrito Norte' } }, public: {}, apps: {}, sites: {}, stateDir: require('os').tmpdir() });
  const e = evs.find(x => x.path === '/.env');
  const pub = P.event(e, false), priv = P.event(e, true);
  assert.ok(!pub.path && !pub.ip && pub.fam === 'secrets' && /^[0-9a-f]{10}$/.test(pub.site), JSON.stringify(pub));
  assert.strictEqual(priv.path, '/.env');
  console.log('ok   defensa web: en modo publico el sondeo viaja sin ruta ni IP');
})().catch(e => { console.error(e); process.exit(1); });
