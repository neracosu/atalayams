'use strict';
// Atalaya Equipo: arranque del ejecutable unico (Node SEA). El ejecutable trae Node y la aplicacion
// empaquetada (app.tgz); la primera vez la extrae en la cache del usuario, luego arranca el servidor en
// 127.0.0.1, busca un puerto libre y abre el navegador (en el asistente, con su codigo, si es la primera vez).
// Solo usa modulos propios de Node: en un ejecutable SEA, require() no llega al disco.
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const zlib = require('zlib');
const crypto = require('crypto');
const { spawn } = require('child_process');

const sea = (() => { try { return require('node:sea'); } catch { return null; } })();
const APP = sea && sea.isSea() ? Buffer.from(sea.getRawAsset('app.tgz')) : fs.readFileSync(process.env.ATALAYA_APP_TGZ || path.join(__dirname, 'app.tgz'));
const VERSION = sea && sea.isSea() ? sea.getAsset('version.txt', 'utf8').trim() : 'dev';
const HOME = os.homedir();
const CACHE = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'Atalaya', 'app')
  : process.platform === 'darwin' ? path.join(HOME, 'Library', 'Caches', 'Atalaya') : path.join(process.env.XDG_CACHE_HOME || path.join(HOME, '.cache'), 'atalaya');
const say = s => console.log(s);

// tar (ustar) sin dependencias: archivos y carpetas, con nombres largos por prefijo
function untar(buf, dest) {
  for (let o = 0; o + 512 <= buf.length;) {
    const h = buf.subarray(o, o + 512);
    if (h.every(b => b === 0)) break;
    const str = (a, b) => h.subarray(a, b).toString('utf8').replace(/\0.*$/s, '');
    const name = (str(345, 500) ? str(345, 500) + '/' : '') + str(0, 100);
    const size = parseInt(str(124, 136).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const out = path.join(dest, name);
    if (!out.startsWith(dest + path.sep) && out !== dest) throw new Error('ruta invalida en el paquete: ' + name);
    if (type === '5') fs.mkdirSync(out, { recursive: true });
    else if (type === '0' || type === '\0') { fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, buf.subarray(o + 512, o + 512 + size)); }
    o += 512 + Math.ceil(size / 512) * 512;
  }
}

// la aplicacion se extrae una vez por version (la huella evita mezclar una extraccion a medias)
function extract() {
  const id = VERSION + '-' + crypto.createHash('sha256').update(APP).digest('hex').slice(0, 12);
  const dir = path.join(CACHE, id);
  if (fs.existsSync(path.join(dir, '.listo'))) return dir;
  const tmp = dir + '.tmp-' + process.pid;
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  untar(zlib.gunzipSync(APP), tmp);
  fs.writeFileSync(path.join(tmp, '.listo'), id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.renameSync(tmp, dir);
  // versiones viejas: se borran
  for (const d of fs.readdirSync(CACHE)) if (d !== id && !d.includes('.tmp-')) fs.rmSync(path.join(CACHE, d), { recursive: true, force: true });
  return dir;
}

const free = port => new Promise(r => { const s = net.createServer().once('error', () => r(false)).listen(port, '127.0.0.1', () => s.close(() => r(true))); });
async function pickPort() {
  const from = Number(process.env.PORT) || 3950;
  for (let p = from; p < from + 40 && p < 65536; p++) if (await free(p)) return p;
  throw new Error(`No hay un puerto libre entre ${from} y ${from + 39}`);
}
// si Atalaya ya esta corriendo en este equipo, se abre esa en vez de arrancar otra
function alreadyRunning(port) {
  return new Promise(r => {
    const req = require('http').get({ host: '127.0.0.1', port, path: '/api/setup/mode', timeout: 1500 }, res => {
      let b = ''; res.on('data', c => { b += c; }); res.on('end', () => { try { r(JSON.parse(b).edition === 'equipo'); } catch { r(false); } });
    });
    req.on('error', () => r(false)); req.on('timeout', () => { req.destroy(); r(false); });
  });
}
function openBrowser(url) {
  if (process.env.ATALAYA_NO_BROWSER) return;
  const [cmd, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '""', url.replace(/&/g, '^&')]]
    : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
  try { spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true }).on('error', () => { }).unref(); } catch { }
}

(async () => {
  const args = process.argv.slice(2);
  if (args.includes('--version') || args.includes('-v')) return say(`Atalaya Monitor Server ${VERSION} (edición Equipo)`);
  if (args.includes('--help') || args.includes('-h')) {
    return say(`Atalaya Monitor Server ${VERSION} · edición Equipo

Abre Atalaya en su navegador, solo en este equipo (http://127.0.0.1). Muestra esta computadora,
sus sesiones de Claude Code y los conectores de nube que agregue.

  --puerto N       puerto a usar (por defecto el primero libre desde 3950)
  --sin-navegador  no abrir el navegador
  --version        versión`);
  }
  const pi = args.indexOf('--puerto');
  if (pi >= 0) process.env.PORT = args[pi + 1];
  if (args.includes('--sin-navegador')) process.env.ATALAYA_NO_BROWSER = '1';

  say(`\n  ATALAYA · Monitor Server ${VERSION} · edición Equipo\n`);
  const want = Number(process.env.PORT) || 3950;
  if (await alreadyRunning(want)) {
    say(`  Atalaya ya está abierto en este equipo: http://127.0.0.1:${want}\n`);
    openBrowser(`http://127.0.0.1:${want}/`);
    return;
  }
  let dir;
  try { dir = extract(); } catch (e) { say('  No se pudo preparar Atalaya: ' + e.message); process.exitCode = 1; return; }
  const port = await pickPort();
  process.env.ATALAYA_EDITION = 'equipo';
  process.env.PORT = String(port);
  process.env.NODE_ENV = 'production';

  // en un ejecutable SEA el require del arranque solo ve modulos propios de Node: la app se carga con este
  const appRequire = require('module').createRequire(path.join(dir, 'server', 'index.js'));
  // el servidor avisa cuando escucha; ahi se abre el navegador
  const log = console.log;
  let opened = false;
  console.log = (...a) => {
    log(...a);
    const line = a.join(' ');
    if (!opened && line.includes('escuchando en')) {
      opened = true;
      const state = appRequire(path.join(dir, 'server', 'settings.js')).load(dir).stateDir;
      let code = null; try { code = fs.readFileSync(path.join(state, 'setup-token'), 'utf8').trim(); } catch { }
      const url = `http://127.0.0.1:${port}/${code ? 'setup#codigo=' + code : ''}`;
      log(`\n  Atalaya está abierto en http://127.0.0.1:${port}`);
      log(code ? `  Primera vez: se abre el asistente (código ${code}).` : '  Entre con su usuario y su PIN.');
      log('  Deje esta ventana abierta mientras lo use. Para cerrarlo: Ctrl+C.\n');
      openBrowser(url);
    }
  };
  appRequire(path.join(dir, 'server', 'index.js'));
})().catch(e => { console.error(e); process.exitCode = 1; });
