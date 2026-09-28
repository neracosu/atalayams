'use strict';
// Sitios vigilados por su dominio (con visitas simuladas): cada sitio declara que respuesta es la correcta y una
// frase que debe traer; un fallo se prueba dos veces; si tampoco responde la direccion de control no se acusa al
// sitio; se avisa una vez al caer y una al volver; y el plan limita cuantos se vigilan. Uso: node test/websites.test.js
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { EventEmitter } = require('events');
const { WebSites, verdict, ACCOUNT } = require('../server/websites');
const { Alerts } = require('../server/alerts');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-sitios-'));
const bus = new EventEmitter();
const evs = [];
bus.on('ev', e => evs.push(e));
// lo que responde cada direccion; una funcion permite cambiarlo entre visitas
const web = {}, seen = [];
let now = Date.parse('2026-09-28T12:00:00Z');
const visit = async url => { seen.push(url); const r = web[url]; return typeof r === 'function' ? r() : r || { status: 0, ms: 5, error: 'el dominio no resuelve' }; };
const CONTROL = 'https://www.gstatic.com/generate_204';
web[CONTROL] = { status: 204, ms: 3, body: '' };
const W = new WebSites({ stateDir: dir, limits: { sites: 3 } }, bus, { visit, retryMs: 0, now: () => now });
let changed = 0;
W.onChange = () => changed++;

(async () => {
  // el veredicto: respuesta esperada y frase
  assert.strictEqual(verdict({ expect: 0 }, { status: 200, body: 'hola' }), null);
  assert.match(verdict({ expect: 0 }, { status: 500 }), /respondió 500/);
  assert.strictEqual(verdict({ expect: 401 }, { status: 401 }), null, 'una puerta que exige llave esta sana');
  assert.match(verdict({ expect: 401 }, { status: 200 }), /respondió 200 y se esperaba 401/, 'una puerta que abre sin llave esta rota');
  assert.strictEqual(verdict({ expect: 0, phrase: 'Date un gusto' }, { status: 200, body: '<h1>date   un <b>gusto</b></h1>' }), null, 'la frase se busca en el texto, sin etiquetas ni mayusculas');
  assert.match(verdict({ expect: 0, phrase: 'Date un gusto' }, { status: 200, body: '<div id="root"></div><script>var x = "Date un gusto"</script>' }), /frase esperada/, 'una pagina en blanco responde 200 pero no trae la frase');

  // altas: se limpia lo que la persona pega y se rechaza lo que no es un dominio
  web['https://tienda.com/'] = { status: 200, ms: 120, body: '<h1>La tienda</h1>' };
  const a = W.add({ domain: 'https://www.Tienda.com/', phrase: 'la tienda' });
  assert.strictEqual(a.domain, 'tienda.com'); assert.strictEqual(a.path, '/'); assert.strictEqual(a.id, 'tienda-com');
  web['https://tienda.com/api/puente'] = { status: 401, ms: 80, body: '' };
  assert.throws(() => W.add({ domain: 'tienda.com/api/puente', expect: 401 }), /Ya vigila ese/);
  web['https://api.tienda.com/puente'] = { status: 401, ms: 80, body: '' };
  const b = W.add({ domain: 'api.tienda.com/puente', expect: 401 });
  assert.strictEqual(b.path, '/puente');
  for (const bad of ['localhost', '10.0.0.1', 'sin espacios.com', 'a', 'http://']) assert.throws(() => W.add({ domain: bad }), /dominio/, bad);
  assert.throws(() => W.add({ domain: 'otro.com', expect: 418 }), /inválida/);
  W.add({ domain: 'blog.com' });
  assert.throws(() => W.add({ domain: 'cuarto.com' }), /Su plan permite hasta 3/);
  assert.strictEqual(changed, 3);
  assert.strictEqual((fs.statSync(path.join(dir, 'websites.json')).mode & 0o777), 0o600);
  await new Promise(f => setTimeout(f, 30)); // las primeras medidas que dispara cada alta

  // el mapa: un distrito y un sitio por dominio, con el mismo formato que un hosting remoto
  assert.deepStrictEqual(W.virtual().map(v => v.id), [ACCOUNT]);
  assert.deepStrictEqual(W.vhosts().map(v => v.servername), ['tienda.com', 'api.tienda.com', 'blog.com']);
  assert.strictEqual(W.groupId('tienda-com'), ACCOUNT + ':tienda.com');
  assert.strictEqual(W.idOfDomain('www.tienda.com'), 'tienda-com');

  // la primera medida buena no es noticia; la de un sitio que nunca respondio, si
  assert.strictEqual(W.state['tienda-com'].ok, true);
  assert.strictEqual(W.state['api-tienda-com'].ok, true);
  assert.strictEqual(W.state['blog-com'].ok, false);
  assert.deepStrictEqual(evs.filter(e => e.kind === 'uptime').map(e => e.domain + ':' + e.action), ['blog.com:down']);
  assert.strictEqual(W.isDown(ACCOUNT + ':blog.com'), true);
  assert.strictEqual(W.isDown(ACCOUNT + ':tienda.com'), false);

  // se cae: dos visitas antes de darlo por caido, y un solo aviso aunque siga caido
  evs.length = 0; seen.length = 0;
  web['https://tienda.com/'] = { status: 502, ms: 40, body: 'Bad gateway' };
  now += 5 * 60000; await W.check('tienda-com');
  assert.strictEqual(seen.filter(u => u === 'https://tienda.com/').length, 2, 'se prueba dos veces');
  now += 5 * 60000; await W.check('tienda-com');
  assert.deepStrictEqual(evs.map(e => e.action), ['down']);
  assert.match(evs[0].why, /respondió 502/);

  // un tropiezo que se arregla en el segundo intento no es una caida
  evs.length = 0;
  let n = 0;
  web['https://api.tienda.com/puente'] = () => (++n === 1 ? { status: 0, ms: 9, error: 'cortó la conexión' } : { status: 401, ms: 70, body: '' });
  await W.check('api-tienda-com');
  assert.strictEqual(evs.length, 0);
  assert.strictEqual(W.state['api-tienda-com'].ok, true);

  // vuelve: un aviso, con cuanto estuvo caido
  web['https://tienda.com/'] = { status: 200, ms: 110, body: '<h1>La tienda</h1>' };
  now += 5 * 60000; await W.check('tienda-com');
  assert.deepStrictEqual(evs.map(e => e.action), ['up']);
  assert.strictEqual(evs[0].downFor, 10 * 60000);

  // publicado en blanco: responde 200 pero sin la frase
  evs.length = 0;
  web['https://tienda.com/'] = { status: 200, ms: 90, body: '<div id="root"></div>' };
  now += 5 * 60000; await W.check('tienda-com');
  assert.match(evs[0].why, /no trae la frase/);
  web['https://tienda.com/'] = { status: 200, ms: 90, body: '<h1>La tienda</h1>' };
  now += 5 * 60000; await W.check('tienda-com');

  // Atalaya sin salida a Internet: ni el sitio ni la direccion de control responden -> sin medir, nadie acusado
  evs.length = 0;
  const before = W.state['tienda-com'].log.length;
  web['https://tienda.com/'] = { status: 0, ms: 12000, error: 'no respondió en 12 s' };
  web[CONTROL] = { status: 0, ms: 12000, error: 'no respondió en 12 s' };
  now += 5 * 60000; await W.check('tienda-com');
  assert.strictEqual(evs.length, 0, 'no pude medir no es esta caido');
  assert.strictEqual(W.state['tienda-com'].ok, true);
  assert.strictEqual(W.state['tienda-com'].log.length, before, 'lo que no se midio no cuenta en el historial');
  assert.match(W.info(ACCOUNT + ':tienda.com', true).note, /no pudo salir a Internet/);
  // con salida a Internet, el mismo silencio del sitio si es una caida
  web[CONTROL] = { status: 204, ms: 3, body: '' };
  now += 5 * 60000; await W.check('tienda-com');
  assert.deepStrictEqual(evs.map(e => e.action), ['down']);
  assert.strictEqual(W.info(ACCOUNT + ':tienda.com', true).note, null);

  // la ficha: en publico sin direccion ni frase
  const pub = W.info(ACCOUNT + ':tienda.com', false), prv = W.info(ACCOUNT + ':tienda.com', true);
  assert.strictEqual(pub.url, undefined); assert.strictEqual(pub.phrase, undefined); assert.strictEqual(pub.hasPhrase, true);
  assert.strictEqual(prv.url, 'https://tienda.com/'); assert.strictEqual(prv.phrase, 'la tienda');
  assert.ok(prv.pct > 0 && prv.pct < 100); assert.ok(prv.series.length >= 5);
  assert.strictEqual(W.info(ACCOUNT + ':noexiste.com', true), null);

  // el historial tiene tope: 24 horas de medidas
  web['https://tienda.com/'] = { status: 200, ms: 100, body: '<h1>La tienda</h1>' };
  for (let i = 0; i < 300; i++) { now += 5 * 60000; await W.check('tienda-com'); }
  assert.strictEqual(W.state['tienda-com'].log.length, 288);

  // sobrevive a un reinicio
  W.save();
  const W2 = new WebSites({ stateDir: dir }, bus, { visit, retryMs: 0 });
  assert.deepStrictEqual(W2.ids(), W.ids());
  assert.strictEqual(W2.state['blog-com'].ok, false);

  // cambiar un sitio: conserva su dominio y su historial; uno que no existe no se crea por error
  const hist = W.state['tienda-com'].log.length;
  const ch = W.add({ edit: true, id: 'tienda-com', domain: 'otro.com/salud', path: '/salud', expect: 401, phrase: '' });
  assert.strictEqual(ch.domain, 'tienda.com'); assert.strictEqual(ch.path, '/salud'); assert.strictEqual(ch.expect, 401);
  assert.strictEqual(W.state['tienda-com'].log.length, hist);
  assert.throws(() => W.add({ edit: true, id: 'no-existe', domain: 'x.com' }), /No vigila ese sitio/);
  W.add({ edit: true, id: 'tienda-com', domain: 'tienda.com', path: '/', expect: 0, phrase: 'la tienda' });

  // baja
  W.remove('blog-com');
  assert.throws(() => W.remove('blog-com'), /No vigila/);
  assert.strictEqual(W.ids().length, 2);

  // los avisos: uno al caer y uno al volver, sin emojis
  const A = new Alerts({ stateDir: dir }, new EventEmitter(), null, {}, { manual: true });
  const down = A.alertOf({ kind: 'uptime', action: 'down', domain: 'tienda.com', why: 'respondió 502' });
  const up = A.alertOf({ kind: 'uptime', action: 'up', domain: 'tienda.com', downFor: 10 * 60000 });
  assert.strictEqual(down.cat, 'down'); assert.match(down.text, /\[CAÍDA\].*tienda\.com.*respondió 502/);
  assert.match(up.text, /\[BIEN\].*volvió a responder \(estuvo caído 10 min\)/);
  assert.notStrictEqual(down.key, up.key);
  for (const t of [down.text, up.text]) assert.ok(!/\p{Extended_Pictographic}/u.test(t), 'sin emojis');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('websites.test.js OK');
})().catch(e => { console.error(e); process.exit(1); });
