'use strict';
// Atalaya Equipo (el ejecutable unico): el arranque extrae la aplicacion, elige puerto, pone el servidor en
// la edicion equipo y deja el codigo del asistente. Corre exe/main.js fuera de SEA con un app.tgz armado
// igual que en scripts/build-exe.js, en una carpeta de usuario temporal.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

// WSL (Windows): lista de distribuciones encendidas en UTF-16 o UTF-8 y un distrito por distribucion y usuario
{
  const { Accounts, parseWslList } = require('../server/accounts');
  assert.deepStrictEqual(parseWslList(Buffer.from('\uFEFFUbuntu\r\ndocker-desktop\r\nDebian\r\n', 'utf16le')), ['Ubuntu', 'Debian']);
  assert.deepStrictEqual(parseWslList(Buffer.from('Ubuntu-22.04\n')), ['Ubuntu-22.04']);
  assert.deepStrictEqual(parseWslList(Buffer.alloc(0)), []);
  const st = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-wsl-'));
  const acc = new Accounts({ stateDir: st, edition: 'equipo', accounts: {} }, { emit() { } });
  acc.wsl = [{ distro: 'Ubuntu', user: 'neri', home: '\\\\wsl.localhost\\Ubuntu\\home\\neri' }];
  acc.sync();
  const h = acc.homes().find(x => x.user === 'wsl-ubuntu-neri');
  assert.ok(h && /wsl\.localhost/.test(h.home), 'distrito de WSL con su carpeta');
  assert.ok(acc.homes().length === 2, 'este equipo + WSL');
  fs.rmSync(st, { recursive: true, force: true });
  console.log('ok   equipo: Claude Code en WSL (cada distribución y usuario, su distrito)');
}
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-equipo-'));
const HOME = path.join(T, 'home');
fs.mkdirSync(HOME);
const TGZ = path.join(T, 'app.tgz');
execFileSync('tar', ['--format=ustar', '-czf', TGZ, '-C', ROOT, 'server', 'web', 'defs', 'agent', 'hooks', 'wordpress', 'licenses', 'CHANGELOG.md', 'package.json', 'cli.js']);
const PORT = 4300 + Math.floor(Math.random() * 300);
const get = (p, headers = {}) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: PORT, path: p, headers }, res => { let b = ''; res.on('data', c => { b += c; }); res.on('end', () => resolve({ status: res.statusCode, body: b, headers: res.headers })); }).on('error', reject);
});
const wait = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  const env = { ...process.env, HOME, XDG_CACHE_HOME: path.join(HOME, '.cache'), XDG_DATA_HOME: path.join(HOME, '.local/share'), ATALAYA_APP_TGZ: TGZ,
    ATALAYA_NO_BROWSER: '1', ATALAYA_FORCE_LITE: '1', ATALAYA_EDITION: '', ATALAYA_STATE: '' };
  const p = spawn(process.execPath, [path.join(ROOT, 'exe/main.js'), '--puerto', String(PORT)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = '';
  p.stdout.on('data', d => { log += d; }); p.stderr.on('data', d => { log += d; });
  try {
    for (let i = 0; i < 80 && !log.includes('Deje esta ventana'); i++) await wait(100);
    assert.ok(log.includes(`http://127.0.0.1:${PORT}`), 'arranca en el puerto pedido: ' + log.slice(-400));
    const code = (log.match(/código ([0-9A-F]{5}-[0-9A-F]{5})/) || [])[1];
    assert.ok(code, 'la primera vez muestra el codigo del asistente');
    const state = path.join(HOME, '.local/share/atalaya');
    assert.strictEqual(fs.readFileSync(path.join(state, 'setup-token'), 'utf8').trim(), code, 'datos en la carpeta del usuario');
    assert.ok(fs.readdirSync(path.join(HOME, '.cache/atalaya')).some(d => fs.existsSync(path.join(HOME, '.cache/atalaya', d, '.listo'))), 'aplicacion extraida en la cache');
    console.log('ok   equipo: extrae la aplicacion, datos en la carpeta del usuario y codigo del asistente');

    const mode = JSON.parse((await get('/api/setup/mode')).body);
    assert.strictEqual(mode.edition, 'equipo');
    assert.strictEqual(mode.setupMode, true);
    for (const u of ['/get', '/api/setup/install-command', '/api/disk/analyze', '/api/setup/action']) assert.strictEqual((await get(u)).status, 404, u);
    assert.strictEqual((await get('/')).headers.location, 'setup');
    assert.strictEqual((await get('/setup')).status, 200, 'la página del asistente se sirve');
    // en Windows las rutas usan \: las carpetas se arman con path.join, nunca con '/' pegado (daba «No encontrado»)
    const idx = fs.readFileSync(path.join(ROOT, 'server/index.js'), 'utf8');
    assert.ok(/const WEB = path\.join\(ROOT, 'web'\)/.test(idx) && !/ROOT \+ '\/web'/.test(idx), 'WEB con path.join');
    assert.ok(/mkdirSync\(cfg\.stateDir/.test(idx), 'la carpeta de datos se crea al arrancar');
    console.log('ok   equipo: edicion equipo, sin instalar en otros ni revisiones de servidor');

    // un segundo arranque encuentra el primero y no levanta otro servidor
    const out = execFileSync(process.execPath, [path.join(ROOT, 'exe/main.js'), '--puerto', String(PORT)], { env }).toString();
    assert.ok(/ya está abierto/.test(out), out);
    console.log('ok   equipo: abrirlo dos veces no levanta dos servidores');

    // metricas por el modulo os (macOS y Windows): cpu, memoria y disco del equipo
    const { HostCollector } = require('../server/collectors/host');
    const { EventEmitter } = require('events');
    process.env.ATALAYA_FORCE_LITE = '1';
    const h = new HostCollector({ edition: 'equipo' }, new EventEmitter());
    h.tick(); await wait(300); h.tick();
    assert.ok(h.lite && h.system.lite && h.system.cores > 0 && h.system.mem.total > 0 && h.system.disk && h.system.disk.total > 0, JSON.stringify(h.system));
    assert.strictEqual(h.claudeProcsKnown, false, 'sin /proc no se da por cerrada una sesion por falta de proceso');
    console.log('ok   equipo: CPU, memoria y disco sin /proc');
  } catch (e) { console.error(log.slice(-1500)); throw e; }
  finally { p.kill('SIGTERM'); await wait(300); fs.rmSync(T, { recursive: true, force: true }); }
})().catch(e => { console.error(e); process.exit(1); });
