'use strict';
// Usuarios desde la pantalla y pase al panel maestro: reglas (no borrarse, siempre un dueno, cambiar PIN cierra
// sesiones), la firma del pase (vence, un solo uso, no se altera) y las rutas del servidor (solo dueno en privado).
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-users-'));
const { Auth } = require('../server/auth');
const users = require('../server/users');
const pass = require('../server/maestropass');
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  // ---- reglas
  const auth = new Auth({ stateDir: path.join(tmp, 'u'), sessionDays: 30 });
  auth.setUser('neri', '482915', 'owner');
  const me = (await auth.login('neri', '482915', '1.1.1.1')).session; me.key = [...auth.sessions.keys()][0];
  let r = users.apply(auth, me, 'add', { name: 'TV-Oficina', role: 'viewer', pin: '739154' });
  assert.deepStrictEqual(r.users.map(u => [u.name, u.role, u.me]), [['neri', 'owner', true], ['tv-oficina', 'viewer', false]]);
  assert.throws(() => users.apply(auth, me, 'add', { name: 'tv-oficina', pin: '739154' }), /Ya existe/);
  assert.throws(() => users.apply(auth, me, 'add', { name: 'x2', pin: '123456' }), /obvio/);
  assert.throws(() => users.apply(auth, me, 'del', { name: 'neri' }), /usted mismo/);
  assert.throws(() => users.apply(auth, me, 'role', { name: 'neri', role: 'viewer' }), /dueño/);
  assert.throws(() => users.apply(auth, me, 'role', { name: 'tv-oficina', role: 'admin' }), /Rol/);
  const tv = (await auth.login('tv-oficina', '739154', '2.2.2.2')).token;
  users.apply(auth, me, 'pin', { name: 'tv-oficina', pin: '615243' });
  assert.strictEqual(auth.get(tv), null, 'cambiar el PIN de otro cierra sus sesiones');
  const tv2 = (await auth.login('tv-oficina', '615243', '2.2.2.2')).token;
  users.apply(auth, me, 'pin', { name: 'neri', pin: '908172' });
  assert.ok(auth.sessions.has(me.key) && auth.sessions.get(me.key).cred === auth.userOf('neri').cred, 'cambiar el propio PIN deja abierta la sesion desde la que se cambio');
  users.apply(auth, me, 'role', { name: 'tv-oficina', role: 'owner' });
  users.apply(auth, me, 'del', { name: 'tv-oficina' });
  assert.strictEqual(auth.get(tv2), null, 'borrar cierra sus sesiones');
  assert.deepStrictEqual(auth.owners(), ['neri']);
  console.log('ok   usuarios: no borrarse, siempre un dueño, PIN y bajas cierran sesiones');

  // ---- pase al panel maestro
  const cloudDir = path.join(tmp, 'nube');
  fs.mkdirSync(path.join(cloudDir, 'maestro'), { recursive: true });
  const cfg = { edition: 'vps', cloudDir };
  assert.ok(!pass.available(cfg), 'sin nube en el servidor no hay boton');
  const key = require('crypto').randomBytes(32).toString('hex');
  fs.writeFileSync(path.join(cloudDir, 'maestro', 'puente.key'), key + '\n');
  fs.writeFileSync(path.join(cloudDir, 'cloud.json'), JSON.stringify({ publicUrl: 'https://nube.ejemplo.com/' }));
  assert.ok(pass.available(cfg) && !pass.available({ ...cfg, edition: 'cloud' }));
  const link = pass.link(cfg, 'neri');
  assert.ok(link.startsWith('https://nube.ejemplo.com/maestro/entrar?t='));
  const t = new URL(link).searchParams.get('t');
  assert.strictEqual(pass.verify('0'.repeat(64), t), null, 'otra clave no sirve');
  const [pl, sig] = t.split('.');
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(pl, 'base64url')), u: 'otro' })).toString('base64url') + '.' + sig;
  assert.strictEqual(pass.verify(key, forged), null, 'alterar el pase rompe la firma');
  assert.strictEqual(pass.verify(key, t).u, 'neri');
  assert.strictEqual(pass.verify(key, t), null, 'un solo uso');
  console.log('ok   pase al panel maestro: firmado, de un solo uso y solo con nube en el servidor');

  // ---- rutas del servidor: solo un dueno con el modo privado activo
  const PORT = require('./puerto')();
  const state = path.join(tmp, 'srv');
  fs.mkdirSync(state);
  const cfgFile = path.join(tmp, 'config.json');
  fs.writeFileSync(cfgFile, JSON.stringify({ stateDir: state, port: PORT, host: '127.0.0.1', cloudDir }));
  const sa = new Auth({ stateDir: state, sessionDays: 30 });
  sa.setUser('neri', '482915', 'owner'); sa.setUser('tv', '739154', 'viewer');
  fs.writeFileSync(path.join(state, 'settings.json'), JSON.stringify({ setupDone: true }));
  const srv = spawn(process.execPath, [path.join(__dirname, '../server/index.js')], { env: { ...process.env, ATALAYA_CONFIG: cfgFile }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; srv.stdout.on('data', d => { log += d; }); srv.stderr.on('data', d => { log += d; });
  const call = (p, body, cookie) => new Promise((res, rej) => {
    const data = JSON.stringify(body || {});
    const q = http.request({ host: '127.0.0.1', port: PORT, path: p, method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1', 'Content-Length': Buffer.byteLength(data), ...(cookie ? { Cookie: cookie } : {}) } }, s => {
      let b = ''; s.on('data', c => { b += c; }); s.on('end', () => { let j = {}; try { j = JSON.parse(b); } catch { } res({ status: s.statusCode, json: j, cookie: (s.headers['set-cookie'] || [''])[0].split(';')[0] }); });
    });
    q.on('error', rej); q.end(data);
  });
  try {
    for (let i = 0; i < 100; i++) { try { await call('/api/me'); break; } catch { await wait(150); } }
    const owner = (await call('/api/login', { user: 'neri', pin: '482915' })).cookie;
    const viewer = (await call('/api/login', { user: 'tv', pin: '739154' })).cookie;
    assert.ok(owner && viewer, log.slice(-2000));
    assert.strictEqual((await call('/api/users/list', {}, viewer)).status, 403, 'solo ver no gestiona usuarios');
    assert.strictEqual((await call('/api/users/list', {}, owner)).status, 403, 'sin modo privado tampoco');
    assert.strictEqual((await call('/api/maestro', {}, owner)).status, 403);
    assert.strictEqual((await call('/api/private', { pin: '482915', minutes: 15 }, owner)).status, 200);
    r = await call('/api/users/add', { name: 'ana', role: 'viewer', pin: '615243' }, owner);
    assert.strictEqual(r.status, 200, JSON.stringify(r.json));
    assert.deepStrictEqual(r.json.users.map(u => u.name), ['neri', 'ana', 'tv']);
    assert.strictEqual((await call('/api/users/del', { name: 'neri' }, owner)).status, 400);
    r = await call('/api/maestro', {}, owner);
    assert.ok(r.status === 200 && pass.verify(key, new URL(r.json.url).searchParams.get('t')).u === 'neri', JSON.stringify(r.json));
    // ejecutables de Atalaya Equipo: solo el dueno, solo archivos de dist/ con nombre valido
    const get = (p, cookie) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port: PORT, path: p, headers: cookie ? { Cookie: cookie } : {} }, s => { let n = 0, b = ''; s.on('data', c => { n += c.length; if (b.length < 4000) b += c; }); s.on('end', () => res({ status: s.statusCode, n, body: b, headers: s.headers })); }).on('error', rej));
    assert.strictEqual((await get('/api/downloads')).status, 401);
    assert.strictEqual((await get('/api/downloads', viewer)).status, 403, 'solo ver no descarga');
    r = await get('/api/downloads', owner);
    assert.strictEqual(r.status, 200); const dl = JSON.parse(r.body); assert.ok(Array.isArray(dl.files));
    assert.strictEqual((await get('/download/..%2F..%2Fconfig.json', owner)).status, 404, 'no sale de dist/');
    assert.strictEqual((await get('/download/atalaya-9.9.9-win-x64.zip', owner)).status, 404);
    if (dl.files.length) { const f = dl.files[0]; r = await get('/download/' + f.file, owner); assert.ok(r.status === 200 && r.n === f.size && /attachment/.test(r.headers['content-disposition']), 'descarga completa'); }
    assert.strictEqual((await get('/download/' + (dl.files[0] ? dl.files[0].file : 'x'), viewer)).status, 403);
    console.log('ok   rutas: usuarios y panel maestro solo para un dueño con el modo privado activo; descargas solo para el dueño');
    // pantalla de acceso: el enlace «¿Qué es esto?» viene encendido y se consulta sin sesión
    r = await get('/api/acceso');
    assert.ok(r.status === 200 && JSON.parse(r.body).promo === true && /^\d+\.\d+\.\d+$/.test(JSON.parse(r.body).version), r.body);
    assert.ok((await get('/login')).body.includes('id="promo" hidden'), 'el enlace empieza oculto y el script lo muestra');
    console.log('ok   acceso: enlace «Conozca Atalaya» encendido por defecto, sin datos del servidor');
  } catch (e) { console.error(log.slice(-3000)); throw e; } finally {
    srv.kill('SIGTERM'); await wait(300);
    fs.rmSync(tmp, { recursive: true, force: true });
  }
})().catch(e => { console.error(e); process.exit(1); });
