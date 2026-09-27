#!/usr/bin/env node
'use strict';
// Recursos visuales del README (docs/):
//   node scripts/readme-assets.js banner     -> docs/banner.svg (ciudad pixel animada, sin navegador)
//   node scripts/readme-assets.js icons      -> docs/icons/*.svg (los iconos pixel de la interfaz, para el README)
//   node scripts/readme-assets.js capture    -> capturas y GIF de la pantalla real, SIEMPRE en modo publico
// Para capture: Playwright (playwright-core) y ImageMagick. Credenciales por variables de entorno:
//   ATALAYA_URL (http://127.0.0.1:3950), ATALAYA_USER, ATALAYA_PIN, PLAYWRIGHT_CORE (ruta al modulo),
//   SHARP (opcional, ruta a sharp: el video del README sale como WebP animado en vez de GIF)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const DOCS = path.join(__dirname, '..', 'docs');

// ------------------------------------------------------------------ banner.svg
// letras pixel 5x7 (solo las que usa el titulo)
const GLYPH = {
  A: ['01110', '10001', '10001', '11111', '10001', '10001', '10001'],
  T: ['11111', '00100', '00100', '00100', '00100', '00100', '00100'],
  L: ['10000', '10000', '10000', '10000', '10000', '10000', '11111'],
  Y: ['10001', '10001', '01010', '00100', '00100', '00100', '00100'],
};
function pixelText(text, x, y, px, fill) {
  let out = '', cx = x;
  for (const ch of text) {
    const g = GLYPH[ch];
    if (!g) { cx += px * 4; continue; }
    g.forEach((row, r) => [...row].forEach((b, c) => { if (b === '1') out += `<rect x="${cx + c * px}" y="${y + r * px}" width="${px}" height="${px}"/>`; }));
    cx += px * 6.2;
  }
  return `<g fill="${fill}">${out}</g>`;
}

// caja isometrica: base (x,y) = esquina frontal inferior; w,d = ancho y fondo en celdas; h = alto
function isoBox(x, y, w, d, h, color, i, windows = true) {
  const W = 14, H = 7; // medio ancho y medio alto de una celda
  const L = [x - d * W, y - d * H], R = [x + w * W, y - w * H], B = [x + (w - d) * W, y - (w + d) * H];
  const top = [[x, y - h], [R[0], R[1] - h], [B[0], B[1] - h], [L[0], L[1] - h]];
  const left = [[L[0], L[1]], [x, y], [x, y - h], [L[0], L[1] - h]];
  const right = [[x, y], [R[0], R[1]], [R[0], R[1] - h], [x, y - h]];
  const pts = a => a.map(p => p.map(n => n.toFixed(1)).join(',')).join(' ');
  let win = '';
  if (windows) {
    const rows = Math.max(1, Math.floor((h - 10) / 12));
    for (let r = 0; r < rows; r++) for (let c = 0; c < w * 2; c++) {
      const fx = x + (c + 0.5) * (W / 2) + 2, fy = y - (c + 0.5) * (H / 2) - 8 - r * 12;
      const dur = (2 + ((i * 7 + r * 3 + c * 5) % 9) * 0.7).toFixed(1), delay = (((i * 13 + r * 5 + c * 3) % 17) * 0.3).toFixed(1);
      win += `<rect class="win" x="${fx.toFixed(1)}" y="${fy.toFixed(1)}" width="3" height="4" style="animation-duration:${dur}s;animation-delay:${delay}s"/>`;
    }
    for (let r = 0; r < rows; r++) for (let c = 0; c < d * 2; c++) {
      const fx = x - (c + 0.5) * (W / 2) - 5, fy = y - (c + 0.5) * (H / 2) - 8 - r * 12;
      const dur = (2.5 + ((i * 11 + r * 7 + c * 3) % 7) * 0.8).toFixed(1), delay = (((i * 7 + r * 3 + c * 11) % 13) * 0.4).toFixed(1);
      win += `<rect class="win dim" x="${fx.toFixed(1)}" y="${fy.toFixed(1)}" width="3" height="4" style="animation-duration:${dur}s;animation-delay:${delay}s"/>`;
    }
  }
  return `<g><polygon points="${pts(left)}" fill="${color}" opacity=".55"/><polygon points="${pts(right)}" fill="${color}" opacity=".78"/>` +
    `<polygon points="${pts(top)}" fill="${color}"/>${win}</g>`;
}

function banner() {
  const Wd = 1280, Ht = 360;
  const colors = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa'];
  // estrellas
  let stars = '';
  for (let i = 0; i < 70; i++) {
    const x = (i * 211) % Wd, y = (i * 97) % 200, r = i % 5 === 0 ? 1.6 : 1;
    stars += `<circle class="star" cx="${x}" cy="${y}" r="${r}" style="animation-delay:${(i % 11) * 0.37}s;animation-duration:${3 + (i % 5)}s"/>`;
  }
  // distritos: grupos de edificios sobre una losa, a la derecha del titulo
  const districts = [
    { x: 760, y: 300, c: 0, b: [[0, 0, 2, 2, 60], [44, -18, 2, 2, 90], [88, -2, 2, 2, 46]] },
    { x: 960, y: 250, c: 1, b: [[0, 0, 2, 2, 110], [42, -20, 2, 2, 70], [84, 0, 2, 2, 130], [126, -18, 2, 2, 80]] },
    { x: 1130, y: 320, c: 2, b: [[0, 0, 2, 2, 50], [42, -18, 2, 2, 75]] },
    { x: 640, y: 215, c: 3, b: [[0, 0, 2, 2, 55], [40, -18, 2, 2, 40]] },
    { x: 1180, y: 185, c: 4, b: [[0, 0, 2, 2, 45], [40, -18, 2, 2, 65]] },
  ];
  let city = '', k = 0;
  const slab = (x, y, c) => `<polygon points="${x - 60},${y + 8} ${x + 70},${y - 57} ${x + 200},${y + 8} ${x + 70},${y + 73}" fill="${colors[c]}" opacity=".07" stroke="${colors[c]}" stroke-opacity=".35"/>`;
  for (const d of districts) {
    city += slab(d.x, d.y, d.c);
    for (const [dx, dy, w, dd, h] of d.b) city += isoBox(d.x + dx, d.y + dy, w, dd, h, colors[d.c], k++);
  }
  // torre de control con faro
  const tx = 900, ty = 350;
  city += isoBox(tx, ty, 1, 1, 150, '#94a3b8', 99, true);
  city += `<circle cx="${tx}" cy="${ty - 162}" r="4" fill="#22d3ee"/><circle class="beacon" cx="${tx}" cy="${ty - 162}" r="4" fill="none" stroke="#22d3ee" stroke-width="2"/>`;
  // visitas que viajan de la torre a los distritos (y ataques que chocan con el escudo)
  const routes = [[tx, ty - 150, 780, 250, '#22d3ee'], [tx, ty - 150, 1000, 170, '#a78bfa'], [tx, ty - 150, 1150, 280, '#34d399'], [tx, ty - 150, 660, 180, '#fbbf24'], [tx, ty - 150, 1200, 140, '#f472b6']];
  let dots = '';
  routes.forEach(([x1, y1, x2, y2, c], i) => {
    const p = `M${x1},${y1} Q${(x1 + x2) / 2},${Math.min(y1, y2) - 60} ${x2},${y2}`;
    dots += `<path d="${p}" stroke="${c}" stroke-opacity=".18" fill="none" stroke-dasharray="3 5"/>`;
    for (let j = 0; j < 2; j++) dots += `<circle r="3" fill="${c}"><animateMotion dur="${2.4 + i * 0.35}s" begin="${j * 1.3 + i * 0.4}s" repeatCount="indefinite" path="${p}"/></circle>`;
  });
  dots += `<circle cx="${tx}" cy="${ty - 150}" r="42" fill="none" stroke="#22d3ee" stroke-opacity=".25" stroke-dasharray="2 6"/>`;
  dots += `<circle r="4" fill="#ef4444"><animateMotion dur="3.2s" repeatCount="indefinite" path="M1280,60 L${tx + 36},${ty - 170}"/><animate attributeName="opacity" values="1;1;0" keyTimes="0;.92;1" dur="3.2s" repeatCount="indefinite"/></circle>`;

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Wd} ${Ht}" width="${Wd}" height="${Ht}" role="img" aria-label="Atalaya Monitor Server: el monitor de servidores que se ve como un videojuego">
<style>
.star{fill:#9fb4d9;animation:tw ease-in-out infinite}
@keyframes tw{0%,100%{opacity:.15}50%{opacity:.8}}
.win{fill:#fff7c2;animation:blink steps(1) infinite}
.win.dim{fill:#fde68a}
@keyframes blink{0%{opacity:.95}40%{opacity:.25}75%{opacity:.9}}
.beacon{animation:pulse 2s ease-out infinite;transform-origin:${tx}px ${ty - 162}px}
@keyframes pulse{0%{transform:scale(1);opacity:.9}100%{transform:scale(6);opacity:0}}
.sub{font:500 22px 'Space Grotesk','Segoe UI',Helvetica,Arial,sans-serif;fill:#cbd5e1}
.tag{font:600 13px ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.18em;fill:#22d3ee}
.cur{animation:blink2 1s steps(1) infinite}@keyframes blink2{50%{opacity:0}}
</style>
<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#050912"/><stop offset="1" stop-color="#0b1530"/></linearGradient>
<radialGradient id="glow" cx=".72" cy=".75" r=".55"><stop offset="0" stop-color="#22d3ee" stop-opacity=".16"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></radialGradient></defs>
<rect width="${Wd}" height="${Ht}" rx="18" fill="url(#bg)"/><rect width="${Wd}" height="${Ht}" rx="18" fill="url(#glow)"/>
${stars}
${city}
${dots}
<text class="tag" x="64" y="98">MONITOR SERVER · VPS · HOSTING · NUBE</text>
${pixelText('ATALAYA', 64, 122, 9, '#e2f3ff')}
<rect class="cur" x="${64 + 7 * 9 * 6.2}" y="${122 + 6 * 9}" width="18" height="9" fill="#22d3ee"/>
<text class="sub" x="64" y="236">El monitor de servidores</text>
<text class="sub" x="64" y="266">que se ve como un videojuego.</text>
<rect x="0.5" y="0.5" width="${Wd - 1}" height="${Ht - 1}" rx="18" fill="none" stroke="#1e293b"/>
</svg>`;
  fs.writeFileSync(path.join(DOCS, 'banner.svg'), svg);
  console.log('docs/banner.svg', (svg.length / 1024).toFixed(1), 'KB');
}

// ------------------------------------------------------------------ capturas de la pantalla real (modo publico)
async function capture() {
  const URL0 = process.env.ATALAYA_URL || 'http://127.0.0.1:3950';
  const user = process.env.ATALAYA_USER, pin = process.env.ATALAYA_PIN;
  if (!user || !pin) throw new Error('Defina ATALAYA_USER y ATALAYA_PIN');
  const { chromium } = require(process.env.PLAYWRIGHT_CORE || 'playwright-core');
  const tmp = fs.mkdtempSync(path.join(require('os').tmpdir(), 'atalaya-shots-'));
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const r = await page.request.post(URL0 + '/api/login', { headers: { 'X-Atalaya': '1', 'Content-Type': 'application/json' }, data: { user, pin } });
  if (!r.ok()) throw new Error('No se pudo entrar: ' + r.status());
  // por si la sesion quedo en privado: siempre publico
  await page.request.post(URL0 + '/api/public', { headers: { 'X-Atalaya': '1', 'Content-Type': 'application/json' }, data: {} });
  await page.goto(URL0 + '/');
  await page.waitForTimeout(9000);
  const shot = async (name, opts = {}) => { await page.screenshot({ path: path.join(tmp, name), ...opts }); };
  // capturas en WebP (pesan ~8 veces menos que PNG); GraphicsMagick e ImageMagick lo escriben
  const webp = f => f.replace(/\.(png|gif)$/, '.webp');
  const toDocs = (src, dst, w) => execFileSync('convert', [path.join(tmp, src), '-resize', `${w}x`, '-strip', '-quality', '86', '-define', 'webp:method=6', path.join(DOCS, webp(dst))]);
  const escape = () => page.keyboard.press('Escape');

  await shot('overview.png'); toDocs('overview.png', 'overview.png', 1600);

  // GIF: modo director, 70 cuadros
  await page.keyboard.press('d');
  await page.waitForTimeout(1500);
  const frames = [];
  for (let i = 0; i < 44; i++) { const f = path.join(tmp, `f${String(i).padStart(3, '0')}.png`); await page.screenshot({ path: f }); frames.push(f); await page.waitForTimeout(160); }
  await page.keyboard.press('d');
  // compatible con ImageMagick y GraphicsMagick (sin optimizacion por capas: se achica con menos cuadros y colores)
  // el GIF se arma primero y se pasa a WebP animado con sharp (si esta instalado; si no, queda el GIF)
  const gif = path.join(tmp, 'demo.gif');
  execFileSync('convert', ['-delay', '18', '-loop', '0', ...frames, '-resize', '960x', '-colors', '128', gif], { maxBuffer: 1 << 28 });
  let sharp = null; try { sharp = require(process.env.SHARP || 'sharp'); } catch { }
  if (sharp) { await sharp(gif, { animated: true }).webp({ quality: 80, effort: 6 }).toFile(path.join(DOCS, 'demo.webp')); fs.rmSync(path.join(DOCS, 'demo.gif'), { force: true }); }
  else fs.copyFileSync(gif, path.join(DOCS, 'demo.gif'));
  frames.forEach(f => fs.unlinkSync(f));

  const drawer = async (go, file, w = 1600, wait = 2500) => {
    await page.evaluate(g => { const el = document.createElement('a'); el.dataset.go = g; el.hidden = true; document.querySelector('#right').appendChild(el); el.click(); el.remove(); }, go);
    await page.waitForTimeout(wait);
    await shot(file); toDocs(file, file, w);
    await escape(); await page.waitForTimeout(600);
  };
  await drawer('projects:all', 'projects.png');
  const first = await page.evaluate(async () => { const r = await fetch('/api/detail?kind=projects&id=all').then(x => x.json()); return r.projects.find(p => p.bad || p.warn) || r.projects[0]; });
  if (first) await drawer('project:' + first.id, 'project.png');
  await drawer('metric:disk', 'disk.png');
  await drawer('metric:cpu', 'detail.png');
  await drawer('system:root', 'tower.png');

  // leyenda
  await page.keyboard.press('?'); await page.waitForTimeout(1200); await shot('legend.png'); toDocs('legend.png', 'legend.png', 1600); await escape();
  // instalar: pestaña de hosting (no se genera ningun codigo: solo se muestra el formulario)
  await page.evaluate(() => document.querySelector('[data-act="hosting"]').click()); await page.waitForTimeout(1500);
  await shot('install.png'); toDocs('install.png', 'install.png', 1600); await escape();
  // cada tema: vista previa para el selector (web/themes/<id>/preview.png) y captura grande para el README
  const themesDir = path.join(__dirname, '..', 'web', 'themes');
  for (const id of fs.readdirSync(themesDir).filter(d => fs.existsSync(path.join(themesDir, d, 'theme.json')))) {
    await page.goto(URL0 + '/?theme=' + id); await page.waitForTimeout(6000);
    await page.evaluate(() => { const w = window.atalaya.world; w.setDirector(false); w.resetView(); }); await page.waitForTimeout(3500);
    await shot('t-' + id + '.png');
    execFileSync('convert', [path.join(tmp, 't-' + id + '.png'), '-resize', '640x', '-strip', path.join(themesDir, id, 'preview.png')]);
    toDocs('t-' + id + '.png', 'theme-' + id + '.png', 1600);
  }
  // telefono: el mundo, la hoja de agentes y la de metricas, lado a lado (mismo inicio de sesion, en publico)
  const ctxM = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, storageState: await ctx.storageState() });
  const pm = await ctxM.newPage();
  await pm.goto(URL0 + '/?theme=oficina'); await pm.waitForTimeout(9000);
  await pm.evaluate(() => { const w = window.atalaya.world; w.setDirector(false); w.resetView(); }); await pm.waitForTimeout(3000);
  await pm.screenshot({ path: path.join(tmp, 'm-world.png') });
  for (const s of ['left', 'right']) { await pm.click(`#tabs [data-sheet="${s}"]`); await pm.waitForTimeout(1500); await pm.screenshot({ path: path.join(tmp, `m-${s}.png`) }); }
  execFileSync('convert', [...['m-world.png', 'm-left.png', 'm-right.png'].map(f => path.join(tmp, f)), '+append', '-resize', '1200x', '-strip', '-quality', '86', '-define', 'webp:method=6', path.join(DOCS, 'mobile.webp')]);
  await ctxM.close();
  // acceso
  const ctx2 = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  const p2 = await ctx2.newPage();
  await p2.goto(URL0 + '/login'); await p2.waitForTimeout(2500); await p2.screenshot({ path: path.join(tmp, 'login.png') }); toDocs('login.png', 'login.png', 1600);
  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  for (const f of fs.readdirSync(DOCS)) console.log('docs/' + f, (fs.statSync(path.join(DOCS, f)).size / 1024).toFixed(0), 'KB');
}

// ------------------------------------------------------------------ iconos pixel sueltos (los mismos de la interfaz)
async function icons() {
  const os = require('os');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-icons-'));
  const web = path.join(__dirname, '..', 'web', 'js');
  // solo los datos de los sprites: sin Pixi (sus funciones de textura no se usan aqui)
  fs.writeFileSync(path.join(tmp, 'sprites.mjs'), fs.readFileSync(path.join(web, 'sprites.js'), 'utf8').replace(/^import .*$/mg, ''));
  fs.copyFileSync(path.join(web, 'pixeldata.js'), path.join(tmp, 'pixeldata.js'));
  fs.writeFileSync(path.join(tmp, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(tmp, 'pixicons.mjs'), fs.readFileSync(path.join(web, 'pixicons.js'), 'utf8').replace("'./sprites.js'", "'./sprites.mjs'"));
  const { pxSrc } = await import('file://' + path.join(tmp, 'pixicons.mjs'));
  const out = path.join(DOCS, 'icons');
  fs.mkdirSync(out, { recursive: true });
  const names = ['terminal', 'web', 'house', 'wp', 'folder', 'db', 'shield', 'invader', 'bot', 'lock', 'chart', 'rocket', 'branch', 'cloud', 'search', 'star', 'key', 'antenna', 'portal', 'bolt', 'warn', 'ok', 'gear', 'plug', 'city', 'phone', 'siren', 'camera', 'fire', 'ask', 'move'];
  for (const n of names) {
    const svg = decodeURIComponent(pxSrc(n).replace('data:image/svg+xml;utf8,', '')).replace('<svg ', '<svg width="48" height="48" ');
    fs.writeFileSync(path.join(out, n + '.svg'), svg);
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('docs/icons/', names.length, 'iconos');
}

const cmd = process.argv[2];
if (cmd === 'icons') icons();
else if (cmd === 'banner') banner();
else if (cmd === 'capture') capture().catch(e => { console.error(e.message); process.exit(1); });
else console.log('Uso: node scripts/readme-assets.js banner | icons | capture');
