'use strict';
// Seguimiento de uso (solo Atalaya Cloud): anota acciones y errores, tapa lo que parezca una llave, no llena el
// registro con lo repetido y avisa de los tropiezos y los primeros pasos. Uso: node test/track.test.js
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { EventEmitter } = require('events');
const { Track, tail, clean } = require('../server/track');
const { Alerts } = require('../server/alerts');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-seg-'));
const dir = path.join(base, 'tenants', 'gg'); fs.mkdirSync(dir, { recursive: true });
let now = Date.parse('2026-09-28T12:00:00Z');
const file = path.join(dir, 'seguimiento.jsonl');
const rows = () => tail(file);
// una peticion simulada que termina con ese codigo
const hit = (T, method, p, status, session, extra = {}) => { const res = new EventEmitter(); res.statusCode = status; Object.assign(res, extra); T.request({ method }, res, p.split('?')[0], new URL(p, 'http://x'), session); res.emit('finish'); };

// fuera de la nube no se anota nada
const off = new Track({ stateDir: dir, edition: 'vps' });
assert.strictEqual(off.on, false);
hit(off, 'POST', '/api/websites/add', 200, { user: 'neri' });
assert.strictEqual(off.client({ msg: 'x' }, { user: 'neri' }), false);
assert.ok(!fs.existsSync(file));

const T = new Track({ stateDir: dir, edition: 'cloud' }, { now: () => now });
const me = { user: 'ana' };
hit(T, 'POST', '/api/login', 200, null);
hit(T, 'POST', '/api/login', 401, null, { atalayaError: 'Usuario o PIN incorrecto' });
hit(T, 'POST', '/api/websites/add', 200, me, { atalayaNote: 'tienda.com · espera 401' });
now += 5000;
hit(T, 'POST', '/api/setup/connector', 400, me, { atalayaError: 'Cloudflare rechazó el token. Revise que esté activo.', atalayaNote: 'cloudflare empresa' });
hit(T, 'GET', '/api/detail?kind=site&id=abc', 200, me);
hit(T, 'GET', '/api/detail?kind=site&id=otro', 200, me); // la misma clase de ficha en 10 minutos: una sola anotacion
hit(T, 'GET', '/api/detail?kind=app&id=abc', 200, me);
// ruido que no es uso de la persona
hit(T, 'POST', '/api/beacon', 204, null); hit(T, 'POST', '/api/agent/push', 200, null); hit(T, 'GET', '/api/stream', 200, me); hit(T, 'GET', '/api/me', 401, null);
hit(T, 'POST', '/api/websites/add', 401, null, { atalayaError: 'Sesion expirada' }); // sin sesion: robots
let r = rows();
assert.deepStrictEqual(r.map(x => `${x.kind}:${x.what}`), ['accion:login', 'error:login', 'accion:websites/add', 'error:setup/connector', 'ficha:site', 'ficha:app']);
assert.strictEqual(r[2].detail, 'tienda.com · espera 401'); assert.strictEqual(r[2].user, 'ana');
assert.strictEqual(r[3].status, 400); assert.match(r[3].error, /rechazó el token/);
assert.strictEqual((fs.statSync(file).mode & 0o777), 0o600);

// lo que parezca una llave se tapa aunque llegue dentro de un mensaje de error
assert.strictEqual(clean('token sb_secret_abcDEF123456 invalido'), 'token ••• invalido');
assert.ok(!clean('Bearer eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.abcdefghijk').includes('eyJ'));
assert.ok(!clean('clave ' + 'A1b2'.repeat(10)).includes('A1b2A1b2'));
assert.strictEqual(clean('El dominio no resuelve'), 'El dominio no resuelve');

// errores de la pantalla: el mismo no se repite en 5 minutos y hay tope por hora
assert.strictEqual(T.client({ msg: "Cannot read properties of undefined (reading 'map')", where: 'ficha app', theme: 'villa', view: 'celular' }, me), true);
assert.strictEqual(T.client({ msg: "Cannot read properties of undefined (reading 'map')", where: 'ficha app' }, me), false);
for (let i = 0; i < 40; i++) T.client({ msg: 'error ' + i }, me);
assert.strictEqual(rows().filter(x => x.kind === 'pantalla').length, 29, 'tope de 30 reportes por hora (uno era repetido)');

// conectores: una anotacion por cambio
T.connectors([{ id: 'empresa', type: 'cloudflare', error: null, warn: [], projects: 6 }]);
T.connectors([{ id: 'empresa', type: 'cloudflare', error: null, warn: [], projects: 6 }]);
T.connectors([{ id: 'empresa', type: 'cloudflare', error: null, warn: ['Al token le falta el permiso «Workers Scripts: Read»'] }]);
T.connectors([{ id: 'empresa', type: 'cloudflare', error: null, warn: [] }]);
assert.deepStrictEqual(rows().filter(x => x.kind === 'conector').map(x => x.error || x.detail), ['conectado: 6 proyecto(s)', 'Al token le falta el permiso «Workers Scripts: Read»', 'volvió a leer bien']);

// los avisos: lo escrito antes de arrancar no avisa; despues, los tropiezos y los primeros pasos
const sent = [];
const A = new Alerts({ stateDir: base }, new EventEmitter(), null, {}, { manual: true, now: () => now });
A.anyChannel = () => true; A.send = async m => { sent.push(m); };
const check = A.watchTracking(path.join(base, 'tenants'));
check();
assert.strictEqual(sent.length, 0);
now += 2 * 3600000;
hit(T, 'POST', '/api/websites/add', 200, me, { atalayaNote: 'pedir.tienda.com' });
hit(T, 'POST', '/api/websites/add', 400, me, { atalayaError: 'Su plan permite hasta 3 sitios vigilados. Quite uno o pida un plan mayor.' });
hit(T, 'POST', '/api/private', 403, me, { atalayaError: 'PIN incorrecto' }); // equivocarse con el PIN no es un tropiezo de la plataforma
T.client({ msg: 'x is not defined', where: 'main.js:10' }, me);
check();
assert.strictEqual(sent.length, 3, sent.join('\n'));
assert.match(sent[2], /falló la pantalla \(main\.js:10\): x is not defined/);
assert.match(sent[0], /\[NUBE\] <b>gg<\/b> empezó a vigilar pedir\.tienda\.com/);
assert.match(sent[1], /tropezó al websites\/add: Su plan permite hasta 3/);
now += 6 * 60000;
T.client({ msg: 'x is not defined', where: 'main.js:10' }, me);
check();
assert.strictEqual(sent.length, 3, 'el mismo tropiezo no vuelve a avisar en 30 minutos');
for (const m of sent) assert.ok(!/\p{Extended_Pictographic}/u.test(m), 'sin emojis');

fs.rmSync(base, { recursive: true, force: true });
console.log('track.test.js OK');
