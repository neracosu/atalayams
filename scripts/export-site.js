#!/usr/bin/env node
'use strict';
// Publica el sitio del proyecto (site/) en neracosu.com/atalaya: copia las paginas, suma las piezas que
// comparte con la pantalla (fuentes, estilos base, iconos pixel, capturas en modo publico) y sella cada
// archivo con ?v=<hash> porque neracosu.com cachea CSS, JS e imagenes por un anio.
//   node scripts/export-site.js [/home/neracosu/public_html/atalaya]
// Arma todo en una carpeta aparte y la cambia de una vez (sin ventana a medio copiar).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DEST = path.resolve(process.argv[2] || '/home/neracosu/public_html/atalaya');
const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
const TMP = path.join(path.dirname(DEST), '.' + path.basename(DEST) + '-nuevo');

// lo que se agrega a site/ (origen -> destino dentro del sitio)
const SHARED = [
  ['web/css/base.css', 'assets/css/base.css'],
  ['web/fonts/silkscreen.woff2', 'assets/fonts/silkscreen.woff2'],
  ['web/fonts/space-grotesk.woff2', 'assets/fonts/space-grotesk.woff2'],
  ['licenses/Silkscreen-OFL.txt', 'assets/fonts/Silkscreen-OFL.txt'],
  ['licenses/SpaceGrotesk-OFL.txt', 'assets/fonts/SpaceGrotesk-OFL.txt'],
  ['web/js/pixeldata.js', 'assets/js/pixeldata.js'],
  ['web/js/pixicons.js', 'assets/js/pixicons.js'],
  ['web/favicon.svg', 'assets/favicon.svg'],
  ...['overview', 'projects', 'mobile', ...['ciudad', 'villa', 'oficina', 'castillo', 'raid', 'ciudad3d', 'acuario', 'ops', 'planta', 'terminal'].map(t => 'theme-' + t)]
    .map(n => [`docs/${n}.webp`, `assets/img/${n}.webp`]),
];

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const hash = f => crypto.createHash('sha1').update(fs.readFileSync(f)).digest('hex').slice(0, 10);

fs.rmSync(TMP, { recursive: true, force: true });
for (const f of walk(path.join(ROOT, 'site'))) {
  const to = path.join(TMP, path.relative(path.join(ROOT, 'site'), f));
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(f, to);
}
for (const [from, to] of SHARED) {
  fs.mkdirSync(path.dirname(path.join(TMP, to)), { recursive: true });
  fs.copyFileSync(path.join(ROOT, from), path.join(TMP, to));
}

// sellos: primero lo que no referencia a nada, despues cada texto en orden de dependencias
const stamp = new Map(); // ruta absoluta -> hash
const files = walk(TMP);
for (const f of files) if (!/\.(html|css|js)$/.test(f)) stamp.set(f, hash(f));
const ORDER = ['base.css', 'site.css', 'pixeldata.js', 'pixicons.js', 'hero.js', 'site.js'];
const texts = files.filter(f => /\.(css|js)$/.test(f)).sort((a, b) => ORDER.indexOf(path.basename(a)) - ORDER.indexOf(path.basename(b)))
  .concat(files.filter(f => f.endsWith('.html')));
const REF = /(["'(])((?:\.{1,2}\/|assets\/)[\w./-]+\.(?:css|js|webp|svg|woff2|webm|jpg))(?=["')#])/g;
for (const f of texts) {
  let s = fs.readFileSync(f, 'utf8').replace(/__VERSION__/g, VERSION);
  s = s.replace(REF, (m, q, ref) => {
    const target = path.resolve(path.dirname(f), ref);
    if (!stamp.has(target)) throw new Error(`${path.relative(TMP, f)}: no existe ${ref}`);
    return `${q}${ref}?v=${stamp.get(target)}`;
  });
  fs.writeFileSync(f, s);
  stamp.set(f, hash(f));
}

// permisos del docroot: carpetas 755, archivos 644, del dueno de la carpeta que lo contiene
const owner = fs.statSync(path.dirname(DEST));
const uid = owner.uid, gid = owner.uid === 0 ? 0 : (() => { try { return Number(require('child_process').execFileSync('id', ['-g', String(uid)]).toString()); } catch { return owner.gid; } })();
for (const f of [TMP, ...walk(TMP), ...[...new Set(walk(TMP).map(path.dirname))]]) {
  const dir = fs.statSync(f).isDirectory();
  fs.chmodSync(f, dir ? 0o755 : 0o644);
  if (process.getuid && process.getuid() === 0) fs.chownSync(f, uid, gid);
}
const OLD = TMP.replace(/-nuevo$/, '-viejo');
fs.rmSync(OLD, { recursive: true, force: true });
if (fs.existsSync(DEST)) fs.renameSync(DEST, OLD);
fs.renameSync(TMP, DEST);
fs.rmSync(OLD, { recursive: true, force: true });
console.log(`sitio de Atalaya ${VERSION} publicado en ${DEST} (${walk(DEST).length} archivos)`);
