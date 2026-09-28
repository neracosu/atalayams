'use strict';
// Latidos (con reloj simulado): la tarea del dueno toca una direccion secreta al terminar bien y Atalaya avisa cuando
// deja de hacerlo. El token se guarda solo como sha256; un latido nuevo no avisa hasta que llega el primero; se avisa
// una vez al atrasarse o fallar y una al volver; el plan limita cuantos hay. Uso: node test/heartbeats.test.js
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), crypto = require('crypto');
const { EventEmitter } = require('events');
const { Heartbeats, snippets, slug, defaultGrace, ACCOUNT } = require('../server/heartbeats');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-latidos-'));
const file = path.join(dir, 'heartbeats.json');
const bus = new EventEmitter();
const evs = [];
bus.on('ev', e => evs.push(e));
const MIN = 60000, HOUR = 3600000;
let now = Date.parse('2026-09-28T12:00:00Z');
const H = new Heartbeats({ stateDir: dir, limits: { beats: 5 } }, bus, { now: () => now });
const texts = []; // todo texto que ve el usuario, para la revision de emojis
const fails = (fn, re) => assert.throws(fn, e => { texts.push(e.message); return re.test(e.message); });
const acts = () => evs.map(e => e.app + ':' + e.action);

try {
  // sin latidos no hay distrito
  assert.deepStrictEqual(H.virtual(), []);
  assert.deepStrictEqual(H.apps(), []);
  assert.strictEqual(H.beat('x'.repeat(43), {}), null, 'sin latidos, cualquier token es desconocido');

  // altas: nombre, plazo y tolerancia
  assert.strictEqual(slug('  Respaldo de la Tienda (diario) ñandú '), 'respaldo-de-la-tienda-diario-na');
  assert.strictEqual(defaultGrace(1), 5); assert.strictEqual(defaultGrace(60), 12); assert.strictEqual(defaultGrace(1440), 288); assert.strictEqual(defaultGrace(44640), 1440);
  const a = H.create({ name: 'Respaldo de la tienda', every: 60 });
  assert.deepStrictEqual(Object.keys(a), ['id', 'name', 'every', 'grace', 'token']);
  assert.strictEqual(a.id, 'respaldo-de-la-tienda'); assert.strictEqual(a.every, 60); assert.strictEqual(a.grace, 12);
  assert.match(a.token, /^[A-Za-z0-9_-]{43}$/, '32 bytes en base64url');
  for (const every of [0, -5, 1.5, 44641, 'mucho', null, undefined, '']) fails(() => H.create({ name: 'Malo', every }), /entre 1 minuto y 31 días/);
  for (const grace of [0, -1, 2.5, 1441, 'poca']) fails(() => H.create({ name: 'Malo', every: 10, grace }), /tolerancia/);
  for (const name of ['', '   ', null, 'x'.repeat(61)]) fails(() => H.create({ name, every: 10 }), /nombre/);
  assert.strictEqual(H.list(true).length, 1, 'un alta rechazada no deja nada');

  // nombres repetidos: ids distintos
  const b = H.create({ name: 'Respaldo de la tienda', every: 1, grace: 2 });
  assert.strictEqual(b.id, 'respaldo-de-la-tienda-2'); assert.strictEqual(b.grace, 2);
  assert.notStrictEqual(a.token, b.token);
  const c = H.create({ name: 'Caja del local: Panadería «La Espiga» sucursal norte', every: 1440 });
  assert.match(c.id, /^[a-z0-9][a-z0-9-]{0,30}$/); assert.strictEqual(c.grace, 288);
  const raro = H.create({ name: '¡¡¡!!!', every: 5 });
  assert.strictEqual(raro.id, 'latido', 'un nombre sin letras igual recibe un id');
  H.remove(raro.id);
  fails(() => H.remove(raro.id), /No existe ese latido/);
  fails(() => H.update('noexiste', { name: 'x' }), /No existe ese latido/);
  fails(() => H.retoken('__proto__'), /No existe ese latido/);

  // en disco: solo el sha256 del token, archivo 0600
  const disk = fs.readFileSync(file, 'utf8');
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  for (const t of [a.token, b.token, c.token]) assert.ok(!disk.includes(t), 'el token no se guarda');
  assert.strictEqual(JSON.parse(disk).beats[a.id].sha, crypto.createHash('sha256').update(a.token).digest('hex'));
  assert.ok(!JSON.stringify([H.list(true), H.list(false), H.info(a.id, true), H.apps()]).includes(JSON.parse(disk).beats[a.id].sha), 'ni el token ni su sha salen a la interfaz');
  assert.strictEqual(H.list(true)[0].token, undefined); assert.strictEqual(H.list(true)[0].sha, undefined);

  // token desconocido
  for (const bad of ['', null, undefined, 'corto', a.token + 'x', a.token.slice(0, -1), 'A'.repeat(43), 'x'.repeat(5000), {}, 42]) assert.strictEqual(H.beat(bad, {}), null);
  assert.strictEqual(evs.length, 0);

  // un latido nuevo no avisa atraso antes del primero, aunque pasen dias
  assert.deepStrictEqual(H.virtual(), [{ id: ACCOUNT, label: 'Latidos', publicLabel: 'Latidos' }]);
  assert.strictEqual(H.info(a.id, true).state, 'new');
  assert.strictEqual(H.info(a.id, true).note, null);
  assert.strictEqual(H.info(a.id, true).next, null);
  now += 23 * HOUR; assert.deepStrictEqual(H.check(), []);
  assert.strictEqual(H.info(a.id, true).note, null);
  now += 1 * HOUR; assert.deepStrictEqual(H.check(), []);
  assert.match(H.info(a.id, true).note, /Todavía no llegó ningún latido: revise que la dirección esté bien pegada/);
  assert.match(H.info('_l1', false).note, /Todavía no llegó/);
  now += 72 * HOUR; assert.deepStrictEqual(H.check(), []);
  assert.strictEqual(evs.length, 0);

  // el primero
  assert.deepStrictEqual(H.beat(a.token, { status: 'ok', ms: 1234, note: 'copiados 3 archivos\nsin novedad' }), { ok: true, id: a.id });
  assert.deepStrictEqual(acts(), [a.id + ':first']);
  assert.deepStrictEqual({ ...evs[0] }, { kind: 'beat', action: 'first', account: ACCOUNT, app: a.id, name: 'Respaldo de la tienda', since: now, every: 60, status: 'ok' });
  let i = H.info(a.id, true);
  assert.strictEqual(i.state, 'ok'); assert.strictEqual(i.note, null); assert.strictEqual(i.last, now); assert.strictEqual(i.lastMs, 1234);
  assert.strictEqual(i.lastNote, 'copiados 3 archivos sin novedad', 'la nota, sin saltos de linea');
  assert.strictEqual(i.next, now + 60 * MIN); assert.strictEqual(i.deadline, now + 72 * MIN);
  H.beat(a.token, { note: 'n'.repeat(500) });
  assert.strictEqual(H.info(a.id, true).lastNote.length, 200);

  // a tiempo: nada que avisar
  evs.length = 0;
  const t0 = now;
  now += 60 * MIN; assert.deepStrictEqual(H.check(), []);
  now += 12 * MIN; assert.deepStrictEqual(H.check(), [], 'justo en el limite todavia no es atraso');
  // se atrasa: un solo aviso aunque se revise muchas veces
  now += 1;
  const ch = H.check();
  assert.deepStrictEqual(ch, [{ id: a.id, from: 'ok', to: 'late', since: t0 }]);
  for (let k = 0; k < 50; k++) { now += MIN; assert.deepStrictEqual(H.check(), []); }
  assert.deepStrictEqual(acts(), [a.id + ':late']);
  assert.deepStrictEqual({ ...evs[0] }, { kind: 'beat', action: 'late', account: ACCOUNT, app: a.id, name: 'Respaldo de la tienda', since: t0, every: 60 });
  assert.strictEqual(H.info(a.id, true).state, 'late');
  assert.strictEqual(H.info(a.id, true).since, t0 + 72 * MIN, 'atrasado desde que vencio el plazo');
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).beats[a.id].state, 'late', 'un cambio de estado se guarda de inmediato');

  // vuelve: un aviso, con cuanto duro
  evs.length = 0;
  now = t0 + 72 * MIN + 3 * HOUR;
  H.beat(a.token, {});
  assert.deepStrictEqual(acts(), [a.id + ':back']);
  assert.strictEqual(evs[0].downFor, 3 * HOUR);
  assert.strictEqual(H.info(a.id, true).state, 'ok');

  // avisa que fallo: una vez por racha; y vuelve
  evs.length = 0;
  now += 60 * MIN; H.beat(a.token, { status: 'fail', note: 'disco lleno' });
  const tFail = now;
  now += 60 * MIN; H.beat(a.token, { status: 'fail', note: 'disco lleno' });
  now += 200 * MIN; assert.deepStrictEqual(H.check(), [], 'el que ya fallo no se marca ademas como atrasado');
  assert.deepStrictEqual(acts(), [a.id + ':failed']);
  assert.strictEqual(evs[0].note, 'disco lleno');
  assert.strictEqual(H.info(a.id, true).state, 'failed'); assert.strictEqual(H.info(a.id, true).lastStatus, 'fail');
  H.beat(a.token, { status: 'ok' });
  assert.deepStrictEqual(acts(), [a.id + ':failed', a.id + ':back']);
  assert.strictEqual(evs[1].downFor, now - tFail);

  // atrasado y despues fallo: la racha conserva su inicio
  evs.length = 0;
  const t1 = now;
  now += 100 * MIN; H.check();
  now += 20 * MIN; H.beat(a.token, { status: 'fail' });
  now += 10 * MIN; H.beat(a.token, {});
  assert.deepStrictEqual(acts(), [a.id + ':late', a.id + ':failed', a.id + ':back']);
  assert.strictEqual(evs[2].downFor, now - (t1 + 72 * MIN));

  // el primer latido puede llegar avisando que fallo
  evs.length = 0;
  H.beat(c.token, { status: 'fail', note: 'no abre la caja' });
  assert.deepStrictEqual(acts(), [c.id + ':first', c.id + ':failed']);
  H.beat(c.token, {});
  assert.strictEqual(evs[2].action, 'back');

  // token nuevo: el anterior deja de valer
  const r = H.retoken(a.id);
  assert.strictEqual(r.id, a.id); assert.notStrictEqual(r.token, a.token);
  assert.strictEqual(H.beat(a.token, {}), null);
  assert.deepStrictEqual(H.beat(r.token, {}), { ok: true, id: a.id });
  assert.ok(!fs.readFileSync(file, 'utf8').includes(r.token));

  // pausa: ni se revisa ni avisa; al quitarla el plazo se cuenta desde ese momento
  evs.length = 0;
  H.beat(b.token, {}); // el de cada minuto
  assert.deepStrictEqual(acts(), [b.id + ':first']);
  evs.length = 0;
  assert.strictEqual(H.update(b.id, { paused: true }).paused, true);
  now += 5 * HOUR;
  assert.ok(!H.check().some(x => x.id === b.id));
  assert.strictEqual(H.info(b.id, true).substate, 'en pausa'); assert.strictEqual(H.info(b.id, true).next, null);
  H.update(b.id, { paused: false });
  assert.ok(!H.check().some(x => x.id === b.id), 'lo que no llego durante la pausa no es un atraso');
  now += 3 * MIN;
  assert.ok(!H.check().some(x => x.id === b.id));
  now += 1;
  assert.deepStrictEqual(H.check().filter(x => x.id === b.id).map(x => x.to), ['late']);
  assert.ok(acts().includes(b.id + ':late'));
  H.beat(b.token, {});
  H.beat(a.token || '', {}); H.beat(r.token, {});

  // cambios: nombre y plazo, con las mismas reglas que el alta; el id no cambia
  const u = H.update(a.id, { name: 'Respaldo nocturno', every: 120, grace: 30 });
  assert.strictEqual(u.id, a.id); assert.strictEqual(u.name, 'Respaldo nocturno'); assert.strictEqual(u.every, 120); assert.strictEqual(u.grace, 30);
  fails(() => H.update(a.id, { every: 0 }), /entre 1 minuto/);
  fails(() => H.update(a.id, { grace: 5000 }), /tolerancia/);
  fails(() => H.update(a.id, { name: ' ' }), /nombre/);
  assert.strictEqual(H.info(a.id, true).every, 120);

  // limite del plan
  H.create({ name: 'Cuarto', every: 10 }); H.create({ name: 'Quinto', every: 10 });
  fails(() => H.create({ name: 'Sexto', every: 10 }), /^Su plan permite hasta 5 latidos\. Quite uno o pida un plan mayor\.$/);
  H.remove('quinto');
  H.create({ name: '2026', every: 10 }); // un id que parece numero no altera el orden
  assert.deepStrictEqual(H.list(true).map(x => x.id), [a.id, b.id, c.id, 'cuarto', '2026']);
  const free = new Heartbeats({ stateDir: fs.mkdtempSync(path.join(dir, 'libre-')) }, bus, { now: () => now });
  for (let k = 0; k < 12; k++) free.create({ name: 'Latido', every: 5 });
  assert.strictEqual(new Set(free.list(true).map(x => x.id)).size, 12, 'sin limite y con ids unicos');

  // historial con tope de 100 y sin escribir el disco en cada latido
  evs.length = 0;
  H.save();
  const before = fs.statSync(file).mtimeMs, saved = fs.readFileSync(file, 'utf8');
  for (let k = 0; k < 40; k++) { now += 1000; H.beat(b.token, { ms: 50 }); }
  assert.strictEqual(fs.readFileSync(file, 'utf8'), saved, 'dentro del mismo minuto no se escribe');
  assert.strictEqual(fs.statSync(file).mtimeMs, before);
  now += 30000; H.beat(b.token, { ms: 50 });
  assert.notStrictEqual(fs.readFileSync(file, 'utf8'), saved, 'pasado un minuto, si');
  for (let k = 0; k < 150; k++) { now += MIN; H.beat(b.token, { ms: 50, status: k === 149 ? 'fail' : 'ok' }); }
  assert.strictEqual(H.beats[b.id].log.length, 100);
  assert.deepStrictEqual(H.beats[b.id].log[99], [now, 0, 50]);
  i = H.info(b.id, true);
  assert.strictEqual(i.beats, 100); assert.strictEqual(i.series.length, 100); assert.strictEqual(i.fails, 1); assert.strictEqual(i.pct, 99); assert.strictEqual(i.avgMs, 50);
  assert.deepStrictEqual(i.series[99], { t: now, ok: false, ms: 50, onTime: false });
  H.beat(b.token, {});
  // lo pendiente se escribe en la revision del minuto
  now += 1000; H.beat(b.token, {});
  const pend = fs.readFileSync(file, 'utf8');
  H.check();
  assert.notStrictEqual(fs.readFileSync(file, 'utf8'), pend);

  // un latido que llega tarde cuenta como fuera de tiempo en el porcentaje
  now += 10 * MIN; H.check(); H.beat(b.token, {});
  i = H.info(b.id, true);
  assert.strictEqual(i.series[99].onTime, false); assert.strictEqual(i.series[99].ok, true);
  assert.ok(i.pct < 100);

  // modo publico: sin nombres ni notas, y solo se entra por el alias
  H.beat(r.token, { note: 'cliente Panaderia La Espiga' });
  const pub = H.list(false), prv = H.list(true);
  assert.deepStrictEqual(pub.map(x => x.name), ['Latido 1', 'Latido 2', 'Latido 3', 'Latido 4', 'Latido 5']);
  assert.deepStrictEqual(pub.map(x => x.id), ['_l1', '_l2', '_l3', '_l4', '_l5']);
  assert.strictEqual(prv[0].name, 'Respaldo nocturno'); assert.strictEqual(prv[0].lastNote, 'cliente Panaderia La Espiga');
  const pi = H.info('_l1', false);
  assert.strictEqual(pi.name, 'Latido 1'); assert.strictEqual(pi.lastNote, undefined); assert.strictEqual(pi.state, 'ok');
  assert.strictEqual(H.info(a.id, false), null, 'en publico el nombre real no se puede confirmar probando');
  assert.strictEqual(H.info('_l1', true).id, a.id);
  assert.strictEqual(H.info('_l9', false), null); assert.strictEqual(H.info('noexiste', true), null); assert.strictEqual(H.info('constructor', true), null);
  const pubText = JSON.stringify([pub, pi, H.info('_l3', false), H.apps(false).map(x => x.beat)]);
  for (const secret of ['Respaldo', 'nocturno', 'Panader', 'Espiga', 'respaldo-de', 'caja-del', 'Cuarto', 'cuarto']) assert.ok(!pubText.includes(secret), 'en publico no sale ' + secret);

  // el mapa: un edificio por latido
  H.beat(c.token, { status: 'fail' });
  H.update('cuarto', { paused: true });
  now += 20 * MIN; H.check(); // el de cada minuto se atrasa
  const apps = H.apps();
  assert.deepStrictEqual(apps.map(x => [x.name, x.status, x.substate, x.online]), [
    [a.id, 'online', 'al día', 1], [b.id, 'down', 'atrasado', 0], [c.id, 'down', 'avisó que falló', 0], ['cuarto', 'degraded', 'en pausa', 1], ['2026', 'degraded', 'esperando el primer latido', 1]]);
  assert.deepStrictEqual(Object.keys(apps[0]), ['account', 'name', 'source', 'status', 'substate', 'instances', 'online', 'cpu', 'mem', 'uptime', 'restartsTotal', 'beat']);
  assert.deepStrictEqual(Object.keys(apps[0].beat), ['label', 'every', 'grace', 'last', 'state', 'paused']);
  assert.strictEqual(apps[0].account, ACCOUNT); assert.strictEqual(apps[0].source, 'beat'); assert.strictEqual(apps[0].instances, 1);
  assert.strictEqual(apps[0].beat.label, 'Respaldo nocturno'); assert.strictEqual(H.apps(false)[0].beat.label, 'Latido 1');
  assert.strictEqual(apps[0].uptime, (now - H.beats[a.id].since) / 1000); assert.strictEqual(apps[1].uptime, 0);
  assert.strictEqual(apps[3].beat.paused, true); assert.strictEqual(apps[4].beat.state, 'new'); assert.strictEqual(apps[4].beat.last, 0);
  assert.strictEqual(H.account, ACCOUNT);

  // sobrevive a un reinicio: mismo estado y el mismo token sigue valiendo
  H.save();
  evs.length = 0;
  const H2 = new Heartbeats({ stateDir: dir, limits: { beats: 5 } }, bus, { now: () => now });
  assert.deepStrictEqual(H2.list(true), H.list(true));
  assert.strictEqual(H2.info(b.id, true).state, 'late'); assert.strictEqual(H2.beats[b.id].log.length, 100);
  assert.strictEqual(H2.beat(a.token, {}), null, 'el token viejo sigue sin valer');
  assert.deepStrictEqual(H2.beat(r.token, {}), { ok: true, id: a.id });
  assert.deepStrictEqual(H2.beat(b.token, {}), { ok: true, id: b.id });
  assert.deepStrictEqual(acts(), [b.id + ':back']);
  fails(() => H2.create({ name: 'Otro', every: 10 }), /Su plan permite hasta 5/);

  // al arrancar: lo que vencio con Atalaya apagada recibe un plazo nuevo; el reloj de revision no retiene el proceso
  evs.length = 0;
  H2.save();
  now += 6 * HOUR;
  const H3 = new Heartbeats({ stateDir: dir }, bus, { now: () => now });
  H3.start();
  assert.strictEqual(H3.timer.hasRef(), false);
  assert.deepStrictEqual(H3.check(), [], 'no se acusa a quien no pudo llegar');
  now += 150 * MIN + 1;
  assert.deepStrictEqual(H3.check().map(x => x.id), [a.id, b.id]);
  H3.stop();

  // la ayuda: ejemplos con la direccion puesta
  const url = 'https://atalaya.ejemplo.com/latido/' + r.token;
  const sn = snippets(url);
  assert.deepStrictEqual(sn.map(x => x.id), ['cron', 'fallo', 'node', 'worker', 'powershell']);
  for (const s of sn) { assert.ok(s.code.includes(url), s.id + ' trae la direccion'); assert.ok(s.title.length > 5); assert.deepStrictEqual(Object.keys(s), ['id', 'title', 'code']); }
  assert.match(sn[0].code, /&& curl -fsS -m 10 /);
  assert.ok(sn[1].code.includes(`|| curl -fsS -m 10 "${url}?estado=fallo"`));
  assert.match(sn[2].code, /fetch\(/);
  assert.match(sn[3].code, /scheduled\(/); assert.ok(sn[3].code.includes(`ctx.waitUntil(fetch('${url}'))`));
  assert.match(sn[4].code, /Invoke-RestMethod/);

  // ningun texto con emojis
  texts.push(JSON.stringify([sn, H.list(true), H.list(false), H.info(b.id, true), H.apps(), H.virtual(), free.info('latido', true)]), H.info.call(free, 'latido', true).substate);
  now += 48 * HOUR; texts.push(String(free.info('latido', true).note));
  assert.match(texts[texts.length - 1], /Todavía no llegó/);
  assert.ok(texts.length > 20);
  for (const t of texts) assert.ok(!/\p{Extended_Pictographic}/u.test(t), 'sin emojis: ' + t.slice(0, 80));
  assert.ok(!/\p{Extended_Pictographic}/u.test(fs.readFileSync(path.join(__dirname, '../server/heartbeats.js'), 'utf8')), 'ni en el codigo');

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('heartbeats.test.js OK');
} catch (e) { console.error(e); try { fs.rmSync(dir, { recursive: true, force: true }); } catch { } process.exit(1); }
