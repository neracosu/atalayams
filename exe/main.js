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

const { Updater } = /*UPDATER*/ require('./updater.js'); // scripts/build-exe.js lo incrusta aqui (un ejecutable SEA no lee modulos del disco)

const sea = (() => { try { return require('node:sea'); } catch { return null; } })();
const SEA = !!(sea && sea.isSea());
const EMBEDDED = SEA ? Buffer.from(sea.getRawAsset('app.tgz')) : fs.readFileSync(process.env.ATALAYA_APP_TGZ || path.join(__dirname, 'app.tgz'));
const EMBEDDED_VERSION = SEA ? sea.getAsset('version.txt', 'utf8').trim() : process.env.ATALAYA_APP_VERSION || 'dev';
// la clave publica que verifica las actualizaciones va DENTRO del ejecutable: nunca se baja
const UPDATE_PUB = (() => { try { return SEA ? sea.getAsset('update.pub', 'utf8') : fs.readFileSync(process.env.ATALAYA_UPDATE_PUB || path.join(__dirname, '..', 'defs', 'definiciones.pub'), 'utf8'); } catch { return null; } })();
const UPDATE_URL = process.env.ATALAYA_UPDATE_URL || 'https://nube.neracosu.com/actualizaciones';
let APP = EMBEDDED, VERSION = EMBEDDED_VERSION;
const HOME = os.homedir();
const CACHE = process.platform === 'win32' ? path.join(process.env.LOCALAPPDATA || path.join(HOME, 'AppData', 'Local'), 'Atalaya', 'app')
  : process.platform === 'darwin' ? path.join(HOME, 'Library', 'Caches', 'Atalaya') : path.join(process.env.XDG_CACHE_HOME || path.join(HOME, '.cache'), 'atalaya');
// las actualizaciones bajadas viven aparte de la aplicacion extraida (esa carpeta se limpia en cada version)
const UPDATES = CACHE + '-actualizaciones';
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

  --puerto N            puerto a usar (por defecto el primero libre desde 3950)
  --sin-navegador       no abrir el navegador
  --sin-actualizar      usar la versión que trae este ejecutable y no buscar otras
  --version             versión

Atalaya se actualiza sola: baja la versión nueva, verifica su firma y la usa la próxima vez que lo abra.
Se apaga en el menú › Actualizaciones, o con --sin-actualizar.`);
  }
  const pi = args.indexOf('--puerto');
  if (pi >= 0) process.env.PORT = args[pi + 1];
  if (args.includes('--sin-navegador')) process.env.ATALAYA_NO_BROWSER = '1';

  // actualizaciones: si hay una version bajada y verificada mas nueva que la del ejecutable, se arranca esa
  const relay = args.includes('--relevo');
  let up = null;
  if (!args.includes('--sin-actualizar') && !process.env.ATALAYA_NO_UPDATE && /^\d+\.\d+\.\d+$/.test(EMBEDDED_VERSION)) {
    try {
      up = new Updater({ dir: UPDATES, pub: UPDATE_PUB, embedded: EMBEDDED_VERSION, base: UPDATE_URL, log: m => say('  ' + m) });
      const got = up.pick();
      if (got) { APP = got.buf; VERSION = got.version; up.trying(VERSION); }
      up.status({ ready: null });
    } catch (e) { say('  Actualizaciones: ' + e.message); up = null; }
  }
  say(`\n  ATALAYA · Monitor Server ${VERSION} · edición Equipo${VERSION !== EMBEDDED_VERSION ? ` (actualizado; el ejecutable trae la ${EMBEDDED_VERSION})` : ''}\n`);
  const want = Number(process.env.PORT) || 3950;
  // relevo: este proceso reemplaza a uno que se esta cerrando para actualizarse; espera a que suelte el puerto
  if (relay) { for (let i = 0; i < 60 && !(await free(want)); i++) await new Promise(r => setTimeout(r, 250)); }
  else if (await alreadyRunning(want)) {
    say(`  Atalaya ya está abierto en este equipo: http://127.0.0.1:${want}\n`);
    openBrowser(`http://127.0.0.1:${want}/`);
    return;
  }
  let dir;
  try { dir = extract(); }
  catch (e) {
    // una actualizacion que no se puede abrir no deja a la persona sin Atalaya: se vuelve a la del ejecutable
    if (up && VERSION !== EMBEDDED_VERSION) { up.markBad(VERSION, e.message); try { fs.unlinkSync(path.join(UPDATES, 'trying.json')); } catch { } APP = EMBEDDED; VERSION = EMBEDDED_VERSION; up.running = VERSION; try { dir = extract(); } catch (e2) { say('  No se pudo preparar Atalaya: ' + e2.message); process.exitCode = 1; return; } }
    else { say('  No se pudo preparar Atalaya: ' + e.message); process.exitCode = 1; return; }
  }
  if (up) {
    process.env.ATALAYA_UPDATE_DIR = UPDATES;
    // la aplicacion pide buscar ahora o reiniciar con estos avisos (corre en este mismo proceso)
    process.on('atalaya-update-check', () => { up.check().catch(() => { }); });
    process.on('atalaya-restart', () => {
      const self = SEA ? [] : [process.argv[1]];
      try { spawn(process.execPath, [...self, '--puerto', String(process.env.PORT), '--relevo', '--sin-navegador'], { stdio: 'ignore', detached: true, windowsHide: false, env: { ...process.env, ATALAYA_EDITION: '', PORT: '' } }).unref(); } catch (e) { say('  No se pudo reiniciar: ' + e.message); return; }
      setTimeout(() => process.exit(0), 400);
    });
  }
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
      if (!relay) openBrowser(url);
      if (up) {
        up.started();
        // busca una version nueva al rato de abrir y despues cada 6 horas
        setTimeout(() => up.check().catch(() => { }), Number(process.env.ATALAYA_UPDATE_DELAY) || 20000).unref();
        setInterval(() => up.check().catch(() => { }), 6 * 3600000).unref();
      }
    }
  };
  appRequire(path.join(dir, 'server', 'index.js'));
})().catch(e => { console.error(e); process.exitCode = 1; });
