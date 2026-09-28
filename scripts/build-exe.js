#!/usr/bin/env node
'use strict';
// Arma el ejecutable unico de Atalaya Equipo para Windows, macOS y Linux (Node SEA: el Node oficial de la
// misma version + la aplicacion empaquetada adentro).
//   node scripts/build-exe.js [linux-x64 linux-arm64 darwin-x64 darwin-arm64 win-x64]
// Descarga (y verifica por SHA-256) los binarios oficiales de nodejs.org en ~/.cache/atalaya-build; usa
// postject para inyectar la aplicacion y rcodesign para la firma ad hoc de macOS (sin ella, macOS en Apple
// Silicon no lo deja correr). El resultado queda en dist/ (fuera de git).
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const NODE = process.versions.node; // el ejecutable lleva el mismo Node con el que se prueba Atalaya
const CACHE = path.join(os.homedir(), '.cache', 'atalaya-build');
const DIST = path.join(ROOT, 'dist');
const WORK = path.join(CACHE, 'work');
const FUSE = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const RCODESIGN = { version: '0.29.0', file: 'apple-codesign-0.29.0-x86_64-unknown-linux-musl.tar.gz' };
const TARGETS = {
  'linux-x64': { archive: `node-v${NODE}-linux-x64.tar.gz`, bin: `node-v${NODE}-linux-x64/bin/node` },
  'linux-arm64': { archive: `node-v${NODE}-linux-arm64.tar.gz`, bin: `node-v${NODE}-linux-arm64/bin/node` },
  'darwin-x64': { archive: `node-v${NODE}-darwin-x64.tar.gz`, bin: `node-v${NODE}-darwin-x64/bin/node`, mac: true },
  'darwin-arm64': { archive: `node-v${NODE}-darwin-arm64.tar.gz`, bin: `node-v${NODE}-darwin-arm64/bin/node`, mac: true },
  'win-x64': { file: 'win-x64/node.exe', win: true },
};
// lo que va adentro: el servidor y la interfaz, sin docs, pruebas, nube ni sitio
const APP_FILES = ['server', 'web', 'defs', 'agent', 'hooks', 'wordpress', 'licenses', 'CHANGELOG.md', 'package.json', 'cli.js'];

// Windows: el node.exe oficial viene firmado; al inyectar la aplicacion esa firma queda rota, y Windows
// desconfia mas de una firma invalida que de ninguna. Se quita (entrada 4 del directorio de datos del PE
// y el bloque de certificados al final del archivo).
function stripPeSignature(file) {
  const b = fs.readFileSync(file);
  const pe = b.readUInt32LE(0x3c);
  if (b.toString('latin1', pe, pe + 4) !== 'PE\0\0') throw new Error('no es un ejecutable PE');
  const opt = pe + 24, magic = b.readUInt16LE(opt);
  const dir = opt + (magic === 0x20b ? 112 : 96) + 4 * 8;
  const at = b.readUInt32LE(dir), size = b.readUInt32LE(dir + 4);
  if (!at || !size) return false;
  b.writeUInt32LE(0, dir); b.writeUInt32LE(0, dir + 4);
  fs.writeFileSync(file, at + size === b.length ? b.subarray(0, at) : b);
  return true;
}

const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { stdio: ['ignore', 'pipe', 'inherit'], ...opts });
const sha256 = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'atalaya-build' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode)) { res.resume(); return resolve(download(new URL(res.headers.location, url).href, dest)); }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode} ${url}`)); }
      const tmp = dest + '.part';
      res.pipe(fs.createWriteStream(tmp)).on('finish', () => { fs.renameSync(tmp, dest); resolve(dest); }).on('error', reject);
    }).on('error', reject);
  });
}

async function nodeFor(t, sums) {
  const T = TARGETS[t];
  const name = T.file || T.archive;
  const local = path.join(CACHE, NODE, name.replace('/', '-'));
  fs.mkdirSync(path.dirname(local), { recursive: true });
  if (!fs.existsSync(local)) { console.log(`  descargando ${name}`); await download(`https://nodejs.org/dist/v${NODE}/${name}`, local); }
  if (sha256(local) !== sums[name]) { fs.rmSync(local); throw new Error(`${name}: el SHA-256 no coincide con SHASUMS256.txt`); }
  if (T.file) return local;
  const dir = path.join(CACHE, NODE, t);
  const bin = path.join(dir, T.bin);
  if (!fs.existsSync(bin)) { fs.mkdirSync(dir, { recursive: true }); run('tar', ['-xzf', local, '-C', dir, T.bin]); }
  return bin;
}

async function rcodesign() {
  const dir = path.join(CACHE, 'rcodesign-' + RCODESIGN.version);
  const bin = path.join(dir, RCODESIGN.file.replace('.tar.gz', ''), 'rcodesign');
  if (fs.existsSync(bin)) return bin;
  fs.mkdirSync(dir, { recursive: true });
  const tgz = path.join(dir, RCODESIGN.file);
  console.log('  descargando rcodesign (firma ad hoc para macOS)');
  await download(`https://github.com/indygreg/apple-platform-rs/releases/download/apple-codesign%2F${RCODESIGN.version}/${RCODESIGN.file}`, tgz);
  run('tar', ['-xzf', tgz, '-C', dir]);
  return bin;
}

(async () => {
  const want = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(TARGETS);
  for (const t of want) if (!TARGETS[t]) throw new Error(`Destino desconocido: ${t}. Opciones: ${Object.keys(TARGETS).join(', ')}`);
  fs.mkdirSync(CACHE, { recursive: true });
  fs.rmSync(WORK, { recursive: true, force: true });
  fs.mkdirSync(WORK, { recursive: true });
  fs.mkdirSync(DIST, { recursive: true });
  console.log(`Atalaya Monitor Server ${VERSION} · edición Equipo · Node ${NODE}`);

  const sumsFile = path.join(CACHE, NODE, 'SHASUMS256.txt');
  fs.mkdirSync(path.dirname(sumsFile), { recursive: true });
  if (!fs.existsSync(sumsFile)) await download(`https://nodejs.org/dist/v${NODE}/SHASUMS256.txt`, sumsFile);
  const sums = Object.fromEntries(fs.readFileSync(sumsFile, 'utf8').trim().split('\n').map(l => l.split(/\s+/).reverse()));

  // 1. la aplicacion en un tar ustar (el arranque lo abre sin dependencias)
  const tgz = path.join(WORK, 'app.tgz');
  run('tar', ['--format=ustar', '--owner=0', '--group=0', '--exclude=*.png.bak', '-czf', tgz, '-C', ROOT, ...APP_FILES]);
  fs.writeFileSync(path.join(WORK, 'version.txt'), VERSION);
  console.log(`  aplicación: ${(fs.statSync(tgz).size / 1048576).toFixed(1)} MB`);

  // 2. el blob SEA, generado con el Node oficial (no con el del sistema, que puede ser una variante)
  const genNode = await nodeFor(process.arch === 'arm64' ? 'linux-arm64' : 'linux-x64', sums);
  const seaCfg = path.join(WORK, 'sea-config.json');
  // el arranque y el actualizador en un solo archivo (un ejecutable SEA no lee modulos del disco)
  const mainSrc = fs.readFileSync(path.join(ROOT, 'exe', 'main.js'), 'utf8'), MARK = "/*UPDATER*/ require('./updater.js')";
  if (!mainSrc.includes(MARK)) throw new Error('exe/main.js: falta la marca del actualizador');
  const mainOut = path.join(WORK, 'main.js');
  fs.writeFileSync(mainOut, mainSrc.replace(MARK, () => `(() => { const module = { exports: {} }; (function (module, exports) {\n${fs.readFileSync(path.join(ROOT, 'exe', 'updater.js'), 'utf8')}\n})(module, module.exports); return module.exports; })()`));
  run(genNode, ['--check', mainOut]);
  fs.writeFileSync(seaCfg, JSON.stringify({ main: mainOut, output: path.join(WORK, 'app.blob'), disableExperimentalSEAWarning: true,
    useSnapshot: false, useCodeCache: false, assets: { 'app.tgz': tgz, 'version.txt': path.join(WORK, 'version.txt'), 'update.pub': path.join(ROOT, 'defs', 'definiciones.pub') } }));
  // la misma aplicacion, suelta: es lo que bajan los ejecutables ya instalados para actualizarse (scripts/publish-update.js)
  fs.copyFileSync(tgz, path.join(DIST, `app-${VERSION}.tgz`));
  run(genNode, ['--experimental-sea-config', seaCfg]);

  // 3. un ejecutable por destino
  const signer = want.some(t => TARGETS[t].mac) ? await rcodesign() : null;
  const out = [];
  for (const t of want) {
    const T = TARGETS[t];
    const src = await nodeFor(t, sums);
    const exe = path.join(WORK, t, T.win ? 'atalaya.exe' : 'atalaya');
    fs.mkdirSync(path.dirname(exe), { recursive: true });
    fs.copyFileSync(src, exe);
    fs.chmodSync(exe, 0o755);
    if (T.win) stripPeSignature(exe);
    run('npx', ['--yes', 'postject@1.0.0-alpha.6', exe, 'NODE_SEA_BLOB', path.join(WORK, 'app.blob'), '--sentinel-fuse', FUSE, ...(T.mac ? ['--macho-segment-name', 'NODE_SEA'] : [])]);
    // la firma original queda invalida al inyectar: se reemplaza por una ad hoc
    if (T.mac) run(signer, ['sign', exe]);
    fs.writeFileSync(path.join(path.dirname(exe), 'LEEME.txt'), leeme(t));
    // se entrega comprimido: conserva el permiso de ejecucion (macOS y Linux) y pesa la mitad
    const pkg = path.join(DIST, `atalaya-${VERSION}-${t}.${T.win || T.mac ? 'zip' : 'tar.gz'}`);
    fs.rmSync(pkg, { force: true });
    if (T.win || T.mac) run('zip', ['-q', '-9', '-j', pkg, exe, path.join(path.dirname(exe), 'LEEME.txt')]);
    else run('tar', ['-czf', pkg, '-C', path.dirname(exe), 'atalaya', 'LEEME.txt']);
    out.push([pkg, fs.statSync(pkg).size]);
    console.log(`  ${t.padEnd(13)} ${path.relative(ROOT, pkg)}  ${(fs.statSync(pkg).size / 1048576).toFixed(1)} MB`);
  }
  // sumas de todos los paquetes de esta version (tambien los de corridas anteriores)
  const all = fs.readdirSync(DIST).filter(f => f.startsWith(`atalaya-${VERSION}-`)).sort();
  fs.writeFileSync(path.join(DIST, `SHA256SUMS-${VERSION}.txt`), all.map(f => `${sha256(path.join(DIST, f))}  ${f}`).join('\n') + '\n');
  console.log(`Listo: ${out.length} paquete(s) en dist/ (con SHA256SUMS-${VERSION}.txt)`);
})().catch(e => { console.error('Error: ' + e.message); process.exit(1); });

function leeme(t) {
  const how = t.startsWith('win') ? `Doble clic en atalaya.exe. Windows puede mostrar «Windows protegió su PC»: pulse «Más información» y
«Ejecutar de todas formas» (el ejecutable todavía no tiene firma de un certificado comercial).`
    : t.startsWith('darwin') ? `Descomprima y abra una Terminal en esa carpeta:  ./atalaya
La primera vez, si macOS dice que no puede verificar al desarrollador: Ajustes del Sistema › Privacidad y
seguridad › «Abrir de todas formas». O en la Terminal:  xattr -d com.apple.quarantine atalaya`
      : 'Descomprima y ejecute:  ./atalaya';
  return `Atalaya Monitor Server ${VERSION} · edición Equipo (${t})

Atalaya en su computadora: esta máquina, sus sesiones de Claude Code en vivo y sus conectores de nube
(Vercel, Supabase, GitHub), en una pantalla que se abre en su navegador. Solo escucha en 127.0.0.1:
nadie más puede abrirla.

Cómo abrirlo
${how}

Se abre el navegador con el asistente la primera vez. Deje la ventana abierta mientras lo use.
Sus datos quedan en su carpeta de usuario; nada se envía a otro lado salvo lo que usted conecte.

Opciones:  --puerto 3960   --sin-navegador   --version
Guías:     https://neracosu.com/atalaya/guias/
`;
}
