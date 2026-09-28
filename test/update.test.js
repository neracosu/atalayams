'use strict';
// Actualizacion automatica de Atalaya Equipo: el aviso va firmado, el paquete debe coincidir con el aviso, nunca se
// baja de version, una version que no arranca se descarta, y se puede apagar. Con claves de prueba y un servidor
// de actualizaciones simulado; al final, el arranque real (exe/main.js) levanta la version bajada.
// Uso: node test/update.test.js
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path'), http = require('http'), crypto = require('crypto');
const { spawn, execFileSync } = require('child_process');
const { Updater, verifyManifest, newer, KIND } = require('../exe/updater');

const ROOT = path.resolve(__dirname, '..');
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-upd-'));
const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
const other = crypto.generateKeyPairSync('ed25519');
const PUB = publicKey.export({ type: 'spki', format: 'pem' });
const sign = (m, key = privateKey) => { const payload = JSON.stringify(m); return { payload, sig: crypto.sign(null, Buffer.from(payload, 'utf8'), key).toString('base64') }; };
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const man = (version, buf, extra = {}) => ({ kind: KIND, version, file: `app-${version}.tgz`, size: buf.length, sha256: sha(buf), launcher: 1, date: '2026-09-28', notes: 'Notas de prueba', ...extra });
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  assert.ok(newer('0.82.0', '0.81.9') && newer('1.0.0', '0.99.99') && newer('0.81.10', '0.81.9'));
  assert.ok(!newer('0.81.4', '0.81.4') && !newer('0.81.3', '0.81.4') && !newer('dev', '0.1.0') && !newer('0.1.0', 'dev'));

  // el aviso
  const pkg = Buffer.from('paquete de prueba');
  assert.strictEqual(verifyManifest(sign(man('0.90.0', pkg)), PUB).version, '0.90.0');
  assert.throws(() => verifyManifest(sign(man('0.90.0', pkg), other.privateKey), PUB), /firma/, 'firmado con otra clave');
  const tam = sign(man('0.90.0', pkg)); tam.payload = tam.payload.replace('0.90.0', '0.99.0');
  assert.throws(() => verifyManifest(tam, PUB), /firma/, 'aviso alterado despues de firmar');
  assert.throws(() => verifyManifest(sign({ ...man('0.90.0', pkg), kind: 'definiciones' }), PUB), /otro tipo/, 'la misma clave firma otras cosas: el tipo las separa');
  assert.throws(() => verifyManifest(sign({ ...man('0.90.0', pkg), file: '../../evil.tgz' }), PUB), /nombre de paquete/);
  assert.throws(() => verifyManifest(sign({ ...man('0.90.0', pkg), size: 900 << 20 }), PUB), /incompleto/);

  // servidor de actualizaciones simulado
  let served = { env: sign(man('0.90.0', pkg)), pkg }, hits = [];
  const srv = await new Promise(r => { const s = http.createServer((req, res) => { hits.push(req.url);
    if (req.url === '/equipo.json') return res.end(JSON.stringify(served.env));
    if (/^\/app-[\d.]+\.tgz$/.test(req.url)) return res.end(served.pkg);
    res.statusCode = 404; res.end(); }).listen(0, '127.0.0.1', () => r(s)); });
  const base = `http://127.0.0.1:${srv.address().port}`;
  const mk = (dir, embedded = '0.81.4', extra = {}) => new Updater({ dir: path.join(T, dir), pub: PUB, embedded, base, ...extra });

  // baja, verifica y deja lista; al proximo arranque se elige
  let U = mk('a');
  assert.strictEqual(U.pick(), null, 'sin nada bajado se usa la del ejecutable');
  let st = await U.check();
  assert.strictEqual(st.ready, '0.90.0'); assert.strictEqual(st.error, null); assert.strictEqual(st.notes, 'Notas de prueba');
  hits = []; st = await U.check();
  assert.deepStrictEqual(hits, ['/equipo.json'], 'lo ya bajado no se baja otra vez');
  U = mk('a');
  let got = U.pick();
  assert.strictEqual(got.version, '0.90.0'); assert.ok(got.buf.equals(pkg));

  // paquete alterado en el servidor: no se guarda
  served = { env: sign(man('0.91.0', pkg)), pkg: Buffer.from('paquete de pruebA') };
  st = await mk('b').check();
  assert.match(st.error, /huella/); assert.ok(!st.ready);
  assert.ok(!fs.existsSync(path.join(T, 'b', 'app-0.91.0.tgz')));
  served = { env: sign(man('0.91.0', pkg)), pkg: Buffer.from('corto') };
  assert.match((await mk('b').check()).error, /incompleto/);
  // aviso firmado por otro: nada
  served = { env: sign(man('0.92.0', pkg), other.privateKey), pkg };
  assert.match((await mk('b').check()).error, /firma/);
  // nunca hacia atras ni igual
  served = { env: sign(man('0.81.4', pkg)), pkg };
  st = await mk('c').check(); assert.ok(!st.ready && !st.error); assert.strictEqual(st.latest, '0.81.4');
  served = { env: sign(man('0.80.0', pkg)), pkg };
  st = await mk('c').check(); assert.ok(!st.ready);
  // pide un ejecutable mas nuevo: se avisa, no se aplica
  served = { env: sign(man('0.95.0', pkg, { launcher: 2 })), pkg };
  st = await mk('c').check(); assert.strictEqual(st.needsExe, '0.95.0'); assert.ok(!st.ready);
  // solo https (o el servidor local de pruebas)
  assert.match((await new Updater({ dir: path.join(T, 'd'), pub: PUB, embedded: '0.81.4', base: 'http://ejemplo.com/x' }).check()).error, /https/);

  // el paquete guardado se altera en el disco despues de bajarlo: se descarta al arrancar
  fs.writeFileSync(path.join(T, 'a', 'app-0.90.0.tgz'), 'otro contenido!!!');
  assert.strictEqual(mk('a').pick(), null);
  assert.ok(!fs.existsSync(path.join(T, 'a', 'app-0.90.0.json')));

  // una version que no llega a abrir se marca mala y no se reintenta
  served = { env: sign(man('0.90.0', pkg)), pkg };
  U = mk('e'); await U.check(); U = mk('e'); got = U.pick(); U.trying(got.version);
  U = mk('e'); // el arranque siguiente encuentra la marca: el anterior no llego a escuchar
  assert.strictEqual(U.pick(), null);
  assert.deepStrictEqual([...U.bad()], ['0.90.0']);
  assert.ok(!(await U.check()).ready, 'la version mala no se vuelve a ofrecer');
  // si arranca bien, la marca se quita
  U = mk('f'); await U.check(); U = mk('f'); got = U.pick(); U.trying(got.version); U.started();
  assert.strictEqual(mk('f').pick().version, '0.90.0');

  // apagado
  U = mk('f'); assert.strictEqual(U.setMode('off'), 'off');
  assert.strictEqual(mk('f').pick(), null); hits = []; await mk('f').check(); assert.deepStrictEqual(hits, []);
  console.log('ok   actualizador: firma, huella, sin retroceder, version mala descartada y apagado');

  // de punta a punta: el arranque real con una version 0.81.4 «instalada» baja la 9.9.9 y el siguiente arranque la usa
  const HOME = path.join(T, 'home'); fs.mkdirSync(HOME);
  const build = (file, version) => { const d = path.join(T, 'src-' + version); fs.mkdirSync(d); for (const f of ['server', 'web', 'defs', 'agent', 'hooks', 'wordpress', 'licenses', 'CHANGELOG.md', 'cli.js']) fs.cpSync(path.join(ROOT, f), path.join(d, f), { recursive: true });
    fs.writeFileSync(path.join(d, 'package.json'), JSON.stringify({ ...JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')), version }));
    execFileSync('tar', ['--format=ustar', '-czf', file, '-C', d, 'server', 'web', 'defs', 'agent', 'hooks', 'wordpress', 'licenses', 'CHANGELOG.md', 'package.json', 'cli.js']); return fs.readFileSync(file); };
  const oldTgz = path.join(T, 'viejo.tgz'); build(oldTgz, '0.81.4');
  const fresh = build(path.join(T, 'nuevo.tgz'), '9.9.9');
  served = { env: sign(man('9.9.9', fresh)), pkg: fresh };
  const pubFile = path.join(T, 'prueba.pub'); fs.writeFileSync(pubFile, PUB);
  const PORT = require('./puerto')();
  const env = { ...process.env, HOME, USERPROFILE: HOME, XDG_CACHE_HOME: path.join(HOME, '.cache'), XDG_DATA_HOME: path.join(HOME, '.local/share'), ATALAYA_APP_TGZ: oldTgz, ATALAYA_APP_VERSION: '0.81.4',
    ATALAYA_UPDATE_URL: base, ATALAYA_UPDATE_PUB: pubFile, ATALAYA_UPDATE_DELAY: '300', ATALAYA_NO_BROWSER: '1', ATALAYA_FORCE_LITE: '1', ATALAYA_EDITION: '', ATALAYA_STATE: '', ATALAYA_NO_UPDATE: '' };
  const run = async () => { const p = spawn(process.execPath, [path.join(ROOT, 'exe/main.js'), '--puerto', String(PORT)], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let log = ''; p.stdout.on('data', d => { log += d; }); p.stderr.on('data', d => { log += d; });
    for (let i = 0; i < 100 && !log.includes('Deje esta ventana'); i++) await wait(100); return { p, log: () => log }; };
  const mode = () => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: '/api/setup/mode' }, r => { let b = ''; r.on('data', c => { b += c; }); r.on('end', () => res(JSON.parse(b))); }).on('error', rej));
  let a = await run();
  try {
    assert.strictEqual((await mode()).version, '0.81.4', a.log().slice(-500));
    for (let i = 0; i < 60 && !a.log().includes('versión nueva lista'); i++) await wait(100);
    assert.match(a.log(), /Hay una versión nueva lista: 9\.9\.9/, a.log().slice(-600));
  } finally { a.p.kill('SIGTERM'); await wait(600); }
  a = await run();
  try {
    assert.match(a.log(), /Monitor Server 9\.9\.9 · edición Equipo \(actualizado; el ejecutable trae la 0\.81\.4\)/, a.log().slice(-600));
    assert.strictEqual((await mode()).version, '9.9.9');
    assert.ok(!fs.existsSync(path.join(HOME, '.cache/atalaya-actualizaciones/trying.json')), 'arranco bien: se quita la marca');
  } finally { a.p.kill('SIGTERM'); await wait(600); }
  // con --sin-actualizar se usa la del ejecutable
  const p3 = spawn(process.execPath, [path.join(ROOT, 'exe/main.js'), '--puerto', String(PORT), '--sin-actualizar'], { env, stdio: ['ignore', 'pipe', 'pipe'] }); let l3 = ''; p3.stdout.on('data', d => { l3 += d; });
  try { for (let i = 0; i < 100 && !l3.includes('Deje esta ventana'); i++) await wait(100); assert.strictEqual((await mode()).version, '0.81.4'); } finally { p3.kill('SIGTERM'); await wait(400); }
  console.log('ok   equipo: baja la versión nueva mientras corre y la usa en el arranque siguiente');

  srv.close(); fs.rmSync(T, { recursive: true, force: true });
  console.log('update.test.js OK');
})().catch(e => { console.error(e); process.exit(1); });
