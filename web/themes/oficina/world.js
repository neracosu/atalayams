// Tema "Oficina": un piso de oficina en pixel art isometrico, al estilo de los hoteles virtuales de los 2000
// (salas flotando en el vacio, muebles pixel y personajitos con globos de dialogo). Todo dibujado en codigo.
//  - la SALA DE SERVIDORES es el servidor: racks con luces que titilan mas rapido con la CPU
//  - la RECEPCION tiene el ascensor (por donde entra todo), los torniquetes y la papelera
//  - cada cuenta es una SALA con su color; debajo, su DIRECTORIO nombra todos sus puestos (se ubica
//    cualquier proyecto sin hacer clic); al acercarse, cada puesto lleva su nombre
//  - cada servicio es un ESCRITORIO con su empleado: teclea mas rapido con mas CPU; a medias, pantalla ambar;
//    caido, el empleado se va y la pantalla queda en rojo
//  - cada sitio es un puesto con laptop
//  - cada visita es un AVION DE PAPEL que sale del ascensor y aterriza en su escritorio; un error 5xx es un
//    papel rojo arrugado que vuela a la papelera
//  - cada intento de acceso es un INTRUSO que llega a los torniquetes y lo rebotan
//  - cada sesion de Claude Code es un COMPANERO que camina por su sala; si espera su permiso levanta la mano
//  - los avisos salen en GLOBOS de dialogo
// Regla de oro: pixel art nitido para los muebles y la gente; los textos, siempre nitidos.
import { Application, Container, Graphics, Sprite, Text, Texture, Rectangle } from '../../vendor/pixi.csp.mjs';
import { forEdition } from '../../js/accounts.js';
import { signCanvas } from '../../js/sprites.js';
import { groupsOf, layoutKeyOf, packRows, iconURL, plaqueList, healthLine } from '../../js/layout.js';
import { esc, fmtBytes } from '../../js/hud.js';
import { accountCaption } from '../../js/accounts.js';
import { pixiScreen } from '../../js/commfx.js';

const TW = 64, TH = 32, WALL = 104, PX = 2; // tile isometrico, alto de pared, escala del pixel art
const iso = (gx, gy) => ({ x: (gx - gy) * TW / 2, y: (gx + gy) * TH / 2 });
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hexn = h => parseInt(String(h).slice(1), 16);
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function shade(hex, f) {
  const n = hexn(hex), r = n >> 16, g = n >> 8 & 255, b = n & 255;
  const t = f < 0 ? 0 : 255, k = Math.abs(f);
  const c = v => Math.round(v + (t - v) * k).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
const FONT = "'Space Grotesk', system-ui, sans-serif";
const HAIR = ['#2a1a10', '#6b3a1a', '#c8902a', '#1a1a1a', '#8a4a2a', '#d0c8b8', '#5a2a4a'];
const SKIN = ['#f1c9a5', '#d9a47c', '#b07a52', '#8a5a3a', '#e8b890'];
const SHIRT = ['#4f7cc8', '#c86a4f', '#5aa06a', '#8a6fc8', '#d0a040', '#4fa8b8', '#c85a8a', '#6a7a8a'];

// ------------------------------------------------------------------ pixel art isometrico en canvas
// poligono convexo relleno pixel a pixel (sin suavizado) y lineas de 1 pixel para el contorno
function fillPoly(cx, pts, color) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const x0 = Math.floor(Math.min(...xs)), x1 = Math.ceil(Math.max(...xs)), y0 = Math.floor(Math.min(...ys)), y1 = Math.ceil(Math.max(...ys));
  cx.fillStyle = color;
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const px = x + 0.5, py = y + 0.5;
    let pos = false, neg = false;
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i], [bx, by] = pts[(i + 1) % pts.length];
      const c = (bx - ax) * (py - ay) - (by - ay) * (px - ax);
      if (c > 0) pos = true; else if (c < 0) neg = true;
    }
    if (!(pos && neg)) cx.fillRect(x, y, 1, 1);
  }
}
function line(cx, [ax, ay], [bx, by], color) {
  cx.fillStyle = color;
  ax = Math.round(ax); ay = Math.round(ay); bx = Math.round(bx); by = Math.round(by);
  const dx = Math.abs(bx - ax), dy = -Math.abs(by - ay), sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
  let err = dx + dy;
  for (;;) { cx.fillRect(ax, ay, 1, 1); if (ax === bx && ay === by) break; const e2 = 2 * err; if (e2 >= dy) { err += dy; ax += sx; } if (e2 <= dx) { err += dx; ay += sy; } }
}
// lienzo para un mueble de una casilla: o = donde cae la esquina de atras de la casilla
function furni(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  draw(cx);
  const t = Texture.from(cv); t.source.scaleMode = 'nearest';
  return t;
}
// caja isometrica: x0,y0 = desde la esquina de atras (en casillas), a x b casillas de base, z0 y h en pixeles
function box(cx, o, x0, y0, a, b, z0, h, top, left, right, edge = '#1a1a22') {
  const P = (gx, gy, z) => [o[0] + (gx - gy) * 16, o[1] + (gx + gy) * 8 - z];
  const T = [P(x0, y0, z0 + h), P(x0 + a, y0, z0 + h), P(x0 + a, y0 + b, z0 + h), P(x0, y0 + b, z0 + h)];
  const L = [P(x0, y0 + b, z0), P(x0 + a, y0 + b, z0), P(x0 + a, y0 + b, z0 + h), P(x0, y0 + b, z0 + h)];
  const R = [P(x0 + a, y0, z0), P(x0 + a, y0 + b, z0), P(x0 + a, y0 + b, z0 + h), P(x0 + a, y0, z0 + h)];
  fillPoly(cx, L, left); fillPoly(cx, R, right); fillPoly(cx, T, top);
  for (const F of [T, L, R]) for (let i = 0; i < 4; i++) line(cx, F[i], F[(i + 1) % 4], edge);
  return { P, T, L, R };
}
function rows(cx, ox, oy, R, pal) {
  R.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) { cx.fillStyle = pal[ch]; cx.fillRect(ox + x, oy + y, 1, 1); } }));
}

// personajito de frente (13 x 24): sentado corta en la cintura; frames: 0 quieto, 1 manos arriba (teclea o camina)
const BODY = [
  '....kkkkk....', '...khhhhhk...', '..khhhhhhhk..', '..khsssssh k.', '..ksessseskk.', '..ksssssssk..', '...kssrssk...', '....kssk.....',
  '..kkttttkk...', '.kttttttttk..', 'kstTttttTtsk.', 'kstTttttTtsk.', 'ks.tttttt.sk.', '.k.TTTTTT.k..', '..kppppppk...', '..kppppppk...',
  '..kppk.kppk..', '..kppk.kppk..', '..kppk.kppk..', '..kkkk.kkkk..'];
function avatarTex(hair, skin, shirt, { seated = false, frame = 0, hand = false } = {}) {
  const key = [hair, skin, shirt, seated, frame, hand].join();
  if (avatarTex.cache.has(key)) return avatarTex.cache.get(key);
  const pal = { k: '#1a1a22', h: hair, s: skin, e: '#1a1a22', r: shade(skin, -0.3), t: shirt, T: shade(shirt, -0.3), p: '#2e3440' };
  let R = BODY.map(r => r.replace(' ', 'h'));
  if (seated) R = R.slice(0, 15);
  if (frame === 1 && seated) { R = R.slice(); R[10] = '.kttttttttk..'; R[11] = 'ks.TttttT.sk.'; R[9] = 'ksttttttttsk.'; }
  if (frame === 1 && !seated) { R = R.slice(); R[16] = '..kppk..kppk.'; R[17] = '..kppk..kkkk.'; R[18] = '..kkkk.......'; R[19] = '.............'; }
  const t = furni(15, 26, cx => {
    rows(cx, 1, 2, R, pal);
    if (hand) { cx.fillStyle = shirt; cx.fillRect(12, 6, 2, 6); cx.fillStyle = skin; cx.fillRect(12, 3, 2, 3); }
  });
  avatarTex.cache.set(key, t);
  return t;
}
avatarTex.cache = new Map();

const TEX = new Map();
const tex = (k, make) => { if (!TEX.has(k)) TEX.set(k, make()); return TEX.get(k); };
// escritorio con monitor; la pantalla cambia de color segun el estado
function deskTex(screen) {
  return tex('desk' + screen, () => furni(40, 44, cx => {
    const o = [20, 24];
    box(cx, o, 0.1, 0.15, 0.85, 0.6, 0, 11, '#e9e2d0', '#b8a888', '#cfc2a2');
    box(cx, o, 0.2, 0.2, 0.1, 0.45, 11, 1, '#4a505a', '#3a414c', '#3a414c');
    const m = box(cx, o, 0.22, 0.3, 0.12, 0.3, 12, 10, '#2e3440', '#1e232c', '#1e232c');
    // pantalla en la cara derecha del monitor
    const f = m.R;
    const inset = (p, q, k) => [lerp(p[0], q[0], k), lerp(p[1], q[1], k)];
    const S = [inset(f[0], f[2], 0.18), inset(f[1], f[3], 0.18), inset(f[2], f[0], 0.18), inset(f[3], f[1], 0.18)];
    fillPoly(cx, S, screen);
    box(cx, o, 0.5, 0.3, 0.3, 0.12, 11, 1, '#5a616c', '#3a414c', '#4a505a');
  }));
}
function laptopTex(screen) {
  return tex('lap' + screen, () => furni(40, 36, cx => {
    const o = [20, 16];
    box(cx, o, 0.15, 0.2, 0.7, 0.55, 0, 10, '#d8d0c0', '#a89878', '#bfb294');
    box(cx, o, 0.35, 0.3, 0.3, 0.3, 10, 1, '#b8bec8', '#8a909a', '#9aa0aa');
    const s = box(cx, o, 0.33, 0.3, 0.04, 0.3, 11, 7, '#8a909a', '#6a707a', '#6a707a');
    fillPoly(cx, s.R.map((p, i) => i < 2 ? [p[0], p[1] - 1] : [p[0], p[1] + 1]), screen);
  }));
}
function chairTex() {
  return tex('chair', () => furni(28, 30, cx => {
    const o = [14, 12];
    box(cx, o, 0.25, 0.25, 0.5, 0.5, 5, 3, '#3a414c', '#2a2f38', '#30353f');
    box(cx, o, 0.25, 0.25, 0.08, 0.5, 8, 10, '#3a414c', '#2a2f38', '#30353f');
    box(cx, o, 0.46, 0.46, 0.08, 0.08, 0, 5, '#5a616c', '#4a505a', '#4a505a');
  }));
}
function plantTex() {
  return tex('plant', () => furni(32, 44, cx => {
    const o = [16, 30];
    box(cx, o, 0.3, 0.3, 0.4, 0.4, 0, 9, '#e8e2d6', '#b8b0a0', '#cfc8b8');
    rows(cx, 7, 2, ['....gg.G....', '..gGGg.gG...', '.gGgggGggG..', 'GggGgggGggg.', '.gGggGggGgG.', '..GgggggGg..', '...gGggGg...', '....g..g....'], { g: '#4f8a4a', G: '#3a6a36' });
    rows(cx, 7, 10, ['.gGggGggGg..', '..GgGggGg...', '....ggg.....'], { g: '#4f8a4a', G: '#3a6a36' });
  }));
}
function coolerTex() {
  return tex('cooler', () => furni(32, 52, cx => {
    const o = [16, 36];
    box(cx, o, 0.3, 0.3, 0.4, 0.4, 0, 20, '#eef0f4', '#c8ccd4', '#dadee6');
    rows(cx, 11, 2, ['..bbbbbb..', '.bBbbbbbb.', '.bBbbbbbb.', '.bBbbbbbb.', '.bbbbbbbb.', '..bbbbbb..', '...bbbb...'], { b: '#7fc4f0', B: '#bfe4fa' });
  }));
}
function rackTex() {
  return tex('rack', () => furni(36, 80, cx => {
    const o = [18, 58];
    box(cx, o, 0.15, 0.15, 0.7, 0.7, 0, 50, '#2e3440', '#1a1e26', '#22262e');
    for (let k = 0; k < 6; k++) { const p = [o[0] + (0.85 - 0.15) * 16 * 0 + 2, 0]; void p; }
  }));
}
function counterTex() {
  return tex('counter', () => furni(72, 50, cx => {
    const o = [36, 22];
    box(cx, o, 0.05, 0.3, 1.9, 0.5, 0, 16, '#f2efe8', '#b8b0a0', '#d8d2c6');
    box(cx, o, 0, 0.25, 2, 0.6, 16, 2, '#8a6a4a', '#6a4a30', '#7a5a3a');
  }));
}
function gateTex() {
  return tex('gate', () => furni(28, 34, cx => {
    const o = [14, 18];
    box(cx, o, 0.3, 0.2, 0.3, 0.6, 0, 14, '#5a616c', '#3a414c', '#4a505a');
  }));
}
function binTex() {
  return tex('bin', () => furni(24, 26, cx => { const o = [12, 12]; box(cx, o, 0.3, 0.3, 0.4, 0.4, 0, 9, '#1a1e26', '#6a707a', '#8a909a'); }));
}
const PLANE = furni(8, 5, cx => rows(cx, 0, 0, ['x.......', 'xxxx....', 'xxxxxxxx', '.xxxx...', '..x.....'], { x: '#ffffff' }));
const PLANE_BOT = furni(8, 5, cx => rows(cx, 0, 0, ['x.......', 'xxxx....', 'xxxxxxxx', '.xxxx...', '..x.....'], { x: '#9aa3ad' }));
const BALL = furni(4, 4, cx => rows(cx, 0, 0, ['.rr.', 'rRrr', 'rrRr', '.rr.'], { r: '#d9412b', R: '#ff7a5a' }));
const ENV = furni(9, 6, cx => rows(cx, 0, 0, ['kkkkkkkkk', 'kxxxxxxxk', 'kkxxxxxkk', 'kxkkxkkxk', 'kxxxxxxxk', 'kkkkkkkkk'], { k: '#6a707a', x: '#f4efe0' }));
const ENV_BAD = furni(9, 6, cx => rows(cx, 0, 0, ['kkkkkkkkk', 'kxxxxxxxk', 'kkxxxxxkk', 'kxkkxkkxk', 'kxxxxxxxk', 'kkkkkkkkk'], { k: '#8a4a10', x: '#f0a040' }));
const SCREEN = { online: '#7fc4f0', degraded: '#f0a040', down: '#ff4d3d', lit: '#dff4ff' };

function sprite(t, x, y, ox, oy) { const s = new Sprite(t); s.scale.set(PX); s.x = x - ox * PX; s.y = y - oy * PX; return s; }
function text(str, size, color = 0xffffff, weight = '600') {
  const t = new Text({ text: str, style: { fontFamily: FONT, fontSize: size, fill: color, fontWeight: weight } });
  t.resolution = 2;
  return t;
}

export default class OficinaWorld {
  constructor(el) {
    this.el = el;
    this.rooms = new Map(); this.desks = new Map(); this.mates = new Map();
    this.fx = []; this.t = 0; this.layoutKey = '';
    this.directorOn = true; this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.measured = new Map(); this.refits = 0;
  }

  async init() {
    this.ac = new AbortController();
    const sig = { signal: this.ac.signal };
    this.sig = sig;
    await document.fonts.load(`12px ${FONT}`).catch(() => { });
    this.app = new Application();
    await this.app.init({ resizeTo: this.el, backgroundAlpha: 0, antialias: false, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2), preference: 'webgl' });
    this.el.appendChild(this.app.canvas);
    this.cam = new Container();
    this.world = new Container();
    this.fxLayer = new Container();
    this.tags = new Container();
    this.cam.addChild(this.world, this.tags, this.fxLayer);
    this.app.stage.addChild(this.cam);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    // directorios (HTML nitido) sobre el lienzo
    this.plaques = Object.assign(document.createElement('div'), { className: 'w3-labels' });
    this.el.appendChild(this.plaques);
    this.plaques.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) { const [k, ...r] = g.dataset.go.split(':'); this.pick(k, r.join(':')); } }, sig);
    this.setupNav();
    this.app.ticker.add(tk => this.tick(tk.deltaMS / 1000));
    window.addEventListener('resize', () => this.fit(), sig);
  }
  // donde esta cada cosa en la pantalla (comunicacion entre agentes); los subagentes van junto a su sesion
  screenOf(kind, id) {
    if (kind === 'session' || kind === 'agent') return pixiScreen(this.app, this.mates.get(String(id).split('/')[0]));
    return pixiScreen(this.app, this.desks.get(id));
  }

  destroy() { this.ac.abort(); this.plaques.remove(); this.app.destroy({ removeView: true }, { children: true }); }
  setInsets(ins) { this.insets = ins; this.fit(); }

  // ------------------------------------------------------------------ salas
  roomBox(C, R) { return { x0: -R * TW / 2 - 4, x1: C * TW / 2 + 4, y0: -WALL - 34, y1: (C + R) * TH / 2 + 12, w: (C + R) * TW / 2 + 8, h: (C + R) * TH / 2 + WALL + 46 }; }

  layout(state) {
    const key = layoutKeyOf(state);
    if (key === this.layoutKey) return;
    if (key !== this.realKey) { this.realKey = key; this.refits = 0; }
    this.layoutKey = key;
    this.world.removeChildren().forEach(c => c.destroy({ children: true }));
    this.tags.removeChildren().forEach(c => c.destroy());
    this.selG = null; this.racks = null; this.gateLamp = null; // se rearman con la sala
    for (const r of this.rooms.values()) if (r.plaque) r.plaque.remove();
    for (const m of this.mates.values()) m.dead = true;
    this.rooms.clear(); this.desks.clear(); this.mates.clear();
    const list = groupsOf(state);
    for (const G of list) {
      G.cols = Math.min(G.items.length, clamp(Math.ceil(Math.sqrt(G.items.length * 1.3)), 2, 6));
      G.rows = Math.ceil(G.items.length / G.cols);
      G.C = Math.max(4, G.cols * 2 + 1); G.R = Math.max(4, G.rows * 2 + 2);
      G.box = this.roomBox(G.C, G.R);
    }
    const K = 22; // la letra del directorio mide 22 unidades del mundo (se ve de 11 a 17 px)
    const est = G => K * 1.3 * (2.8 + (this.compact ? 0 : Math.ceil(G.items.length / Math.max(1, Math.floor(G.box.w / (K * 10.5)))))) + 12;
    const plaqueH = G => (G.plaqueU = Math.max(est(G), this.measured.get(G.a.id) || 0));
    const core = [{ id: 'srv', C: 4, R: 4 }, { id: 'rec', C: 5, R: 4 }].map(c => ({ ...c, box: this.roomBox(c.C, c.R) }));
    const lead = core.reduce((n, c) => n + c.box.w + 56, 0);
    const W = this.app.screen.width - this.insets.left - this.insets.right, H = this.app.screen.height - this.insets.top - this.insets.bottom;
    const best = packRows(list, { w: G => G.box.w, h: G => G.box.h + plaqueH(G) + 40, gap: 56, lead, aspect: Math.max(0.5, W / Math.max(1, H)) });
    let y = 0;
    best.rows.forEach((row, ri) => {
      let x = -best.widths[ri] / 2;
      const rowH = best.heights[ri];
      if (ri === 0) for (const c of core) { this.buildCore(c, x - c.box.x0, y - c.box.y0); x += c.box.w + 56; }
      for (const G of row) { this.buildRoom(G, x - G.box.x0, y - G.box.y0); x += G.box.w + 56; }
      y += rowH;
    });
    this.bounds = { x0: -best.W / 2 - 20, x1: best.W / 2 + 20, y0: -20, y1: y };
    this.fit();
    this.camBase = { ...this.overview };
  }

  // piso y paredes de una sala (el color de la cuenta en el piso y en el remate de las paredes)
  drawRoom(g, C, R, color, floorA, floorB) {
    const P = (gx, gy) => iso(gx, gy);
    // espesor del piso
    const f = [P(0, R), P(C, R), P(C, 0)];
    g.poly([f[0].x, f[0].y, f[1].x, f[1].y, f[1].x, f[1].y + 10, f[0].x, f[0].y + 10]).fill(hexn(shade(floorA, -0.45)));
    g.poly([f[1].x, f[1].y, f[2].x, f[2].y, f[2].x, f[2].y + 10, f[1].x, f[1].y + 10]).fill(hexn(shade(floorA, -0.3)));
    for (let i = 0; i < C; i++) for (let j = 0; j < R; j++) {
      const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
      g.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y]).fill(hexn((i + j) % 2 ? floorA : floorB));
    }
    // paredes: izquierda (a lo largo de gy) mas oscura, derecha (a lo largo de gx) mas clara
    const o = P(0, 0), l = P(0, R), r = P(C, 0);
    g.poly([o.x, o.y, l.x, l.y, l.x, l.y - WALL, o.x, o.y - WALL]).fill(0xc9cdd6);
    g.poly([o.x, o.y, r.x, r.y, r.x, r.y - WALL, o.x, o.y - WALL]).fill(0xe2e5ec);
    // zocalo y remate de color
    g.poly([o.x, o.y, l.x, l.y, l.x, l.y - 6, o.x, o.y - 6]).fill(0x8a909a);
    g.poly([o.x, o.y, r.x, r.y, r.x, r.y - 6, o.x, o.y - 6]).fill(0x9aa0aa);
    g.poly([o.x, o.y - WALL, l.x, l.y - WALL, l.x, l.y - WALL - 8, o.x, o.y - WALL - 8]).fill(hexn(shade(color, -0.2)));
    g.poly([o.x, o.y - WALL, r.x, r.y - WALL, r.x, r.y - WALL - 8, o.x, o.y - WALL - 8]).fill(hexn(color));
    // paneles verticales en las paredes
    for (let j = 1; j < R; j++) { const p = P(0, j); g.moveTo(p.x, p.y - 6).lineTo(p.x, p.y - WALL).stroke({ width: 1, color: 0xb4b9c4 }); }
    for (let i = 1; i < C; i++) { const p = P(i, 0); g.moveTo(p.x, p.y - 6).lineTo(p.x, p.y - WALL).stroke({ width: 1, color: 0xd0d4dc }); }
    g.moveTo(o.x, o.y).lineTo(o.x, o.y - WALL - 8).stroke({ width: 2, color: 0x8a909a });
  }
  // ventana sobre la pared derecha, entre las casillas i0 e i1
  windowOn(g, i0, i1) {
    const a = iso(i0, 0), b = iso(i1, 0);
    g.poly([a.x, a.y - 30, b.x, b.y - 30, b.x, b.y - 80, a.x, a.y - 80]).fill(0x9fd4f0);
    g.poly([a.x, a.y - 30, b.x, b.y - 30, b.x, b.y - 80, a.x, a.y - 80]).stroke({ width: 3, color: 0xf4f6fa });
    const m = iso((i0 + i1) / 2, 0);
    g.moveTo(m.x, m.y - 30).lineTo(m.x, m.y - 80).stroke({ width: 2, color: 0xf4f6fa });
  }
  // un mueble en la casilla (gx, gy) de una sala, ordenado por profundidad
  place(room, t, gx, gy, ox, oy, z = 0) {
    const p = iso(gx, gy);
    const s = sprite(t, p.x, p.y, ox, oy);
    s.zIndex = (gx + gy) * 10 + z;
    room.items.addChild(s);
    return s;
  }
  roomLabel(room, title, sub, color) {
    const L = new Container();
    // el subtitulo abajo y el titulo encima: al agrandarse de lejos, crece hacia arriba, lejos de la pared
    const s = text(sub, 13, 0xb6c2d4, '500'); s.anchor.set(0.5, 1);
    const t = text(title.toUpperCase(), 20, 0xffffff, '700'); t.anchor.set(0.5, 1); t.y = -16;
    const bar = new Graphics().rect(-t.width / 2 - 8, t.y - t.height + 2, 5, t.height - 2).fill(hexn(color));
    L.addChild(bar, t, s);
    const b = room.box;
    L.x = (b.x0 + b.x1) / 2; L.y = b.y0 + 22;
    L.maxScale = (b.w - 16) / Math.max(t.width + 14, s.width);
    room.g.addChild(L);
    return L;
  }

  buildCore(c, ox, oy) {
    const room = { id: c.id, C: c.C, R: c.R, box: c.box, x: ox, y: oy };
    room.g = new Container(); room.g.x = ox; room.g.y = oy;
    const base = new Graphics();
    room.items = new Container(); room.items.sortableChildren = true;
    room.g.addChild(base, room.items);
    this.world.addChild(room.g);
    if (c.id === 'srv') {
      this.drawRoom(base, c.C, c.R, '#4f9dff', '#8a929e', '#7a828e');
      this.racks = [];
      for (let i = 0; i < 3; i++) {
        const s = this.place(room, rackTex(), 0.5 + i * 1.2, 0.5, 18, 58);
        const led = new Graphics(); led.zIndex = s.zIndex + 1; room.items.addChild(led);
        this.racks.push({ s, led, gx: 0.5 + i * 1.2, gy: 0.5, ph: Math.random() * 6 });
      }
      this.place(room, coolerTex(), 3, 2.6, 16, 36);
      room.label = this.roomLabel(room, forEdition('Sala de servidores'), '', '#4f9dff'); // edicion Equipo: «este equipo»
      // salud del servidor, bajo el titulo de la sala
      this.srvHealth = text('', 13, 0x4ade80, '700'); this.srvHealth.anchor.set(0.5, 1); this.srvHealth.y = -16 - 28; room.label.addChild(this.srvHealth);
      this.tappable(base, () => this.pick('system', 'root'), () => this.tipFor({ kind: 'system' }));
      this.srv = room;
    } else {
      this.drawRoom(base, c.C, c.R, '#d97a3a', '#d8c8a8', '#c8b898');
      // ascensor en la pared derecha
      const a = iso(3, 0), b = iso(4.4, 0);
      base.poly([a.x, a.y, b.x, b.y, b.x, b.y - 78, a.x, a.y - 78]).fill(0xaab2bc).stroke({ width: 3, color: 0x6a707a });
      const m = iso(3.7, 0); base.moveTo(m.x, m.y).lineTo(m.x, m.y - 78).stroke({ width: 2, color: 0x6a707a });
      this.windowOn(base, 0.5, 2.3);
      this.place(room, counterTex(), 0.4, 1.6, 36, 22);
      const who = this.place(room, avatarTex('#2a1a10', '#d9a47c', '#4f7cc8', { seated: true }), 1.3, 1.5, 7, 20, -1);
      void who;
      this.gates = [this.place(room, gateTex(), 3.2, 2.2, 14, 18), this.place(room, gateTex(), 4.2, 2.2, 14, 18)];
      this.gateLamp = new Graphics(); this.gateLamp.zIndex = 99; room.items.addChild(this.gateLamp);
      this.place(room, binTex(), 0.3, 3.4, 12, 12);
      this.place(room, plantTex(), 4.2, 3.3, 16, 30);
      room.label = this.roomLabel(room, 'Recepción', 'por aquí entra todo', '#d97a3a');
      const W = (gx, gy, dy) => { const p = iso(gx, gy); return { x: ox + p.x, y: oy + p.y + dy }; };
      this.lift = W(3.8, 0.4, -40); this.gatePt = W(3.7, 2.9, -10); this.binPt = W(0.8, 3.9, -14); this.recPt = W(1.3, 1.5, -60);
      this.tappable(base, () => this.pick('security', 'all'), () => this.tipFor({ kind: 'security' }));
      this.rec = room;
    }
    this.rooms.set(c.id, room);
  }

  buildRoom(G, ox, oy) {
    const { a, items } = G;
    const room = { id: a.id, a, G, C: G.C, R: G.R, box: G.box, x: ox, y: oy, items: new Container() };
    room.items.sortableChildren = true;
    room.g = new Container(); room.g.x = ox; room.g.y = oy;
    const base = new Graphics();
    room.g.addChild(base, room.items);
    this.world.addChild(room.g);
    const fa = shade(a.color, 0.55), fb = shade(a.color, 0.42);
    this.drawRoom(base, G.C, G.R, a.color, fa, fb);
    this.windowOn(base, 1, Math.min(G.C - 1, 3));
    if (G.C > 6) this.windowOn(base, G.C - 3, G.C - 1);
    this.place(room, plantTex(), 0.2, G.R - 1, 16, 30);
    this.place(room, coolerTex(), G.C - 0.9, G.R - 1.1, 16, 36);
    const nA = items.filter(x => x._k === 'app').length;
    room.caption = accountCaption(a, nA, items.length - nA);
    room.label = this.roomLabel(room, a.label, room.caption, a.color);
    this.tappable(base, () => this.pick('district', a.id), () => this.tipFor({ kind: 'district', id: a.id }));
    items.forEach((it, i) => this.addDesk(it, room, 1 + (i % G.cols) * 2, 1 + Math.floor(i / G.cols) * 2));
    // directorio: placa HTML nitida debajo de la sala
    room.plaque = document.createElement('div');
    room.plaque.className = 'w3-label w3-plaque';
    room.plaque.dataset.go = 'district:' + a.id;
    room.plaque.innerHTML = `<b style="border-color:${a.color}">${esc(a.label)}</b><small>${esc(room.caption)}</small><div class="fishlist"></div>`;
    this.plaques.appendChild(room.plaque);
    room.aisle = G.R - 1;
    this.rooms.set(a.id, room);
    this.fillPlaque(room);
  }
  fillPlaque(room) {
    room.plaque.querySelector('.fishlist').innerHTML = plaqueList(room.G.items.map(it => ({ ...it, ...(this.desks.get(it.id)?.data || {}) })), it => iconURL('sign:' + (it.icon || 'web'), () => signCanvas(it.icon || 'web', 2)));
  }

  addDesk(it, room, gx, gy) {
    const site = it._k === 'site';
    const h = hash(it.id + it.name);
    const d = { data: it, site, room, gx, gy, screen: '', typing: 0, lit: 0, hair: HAIR[h % HAIR.length], skin: SKIN[(h >>> 3) % SKIN.length], shirt: SHIRT[(h >>> 6) % SHIRT.length] };
    d.chair = this.place(room, chairTex(), gx - 0.05, gy - 0.35, 14, 12, -2);
    if (!site) d.worker = this.place(room, avatarTex(d.hair, d.skin, d.shirt, { seated: true }), gx + 0.1, gy - 0.25, 7, 19, -1);
    d.sprite = this.place(room, site ? laptopTex(SCREEN.online) : deskTex(SCREEN.online), gx, gy, 20, site ? 16 : 24);
    // cartel pixel sobre el puesto
    const p = iso(gx + 0.5, gy + 0.5);
    const sign = new Sprite(tex('sign' + (it.icon || 'web'), () => { const t = Texture.from(signCanvas(it.icon || 'web', 2)); t.source.scaleMode = 'nearest'; return t; }));
    sign.anchor.set(0.5, 1); sign.scale.set(PX / 2); sign.x = p.x; sign.y = p.y - 64; sign.zIndex = (gx + gy) * 10 + 5;
    room.items.addChild(sign); d.sign = sign;
    this.tappable(d.sprite, () => this.pick(site ? 'site' : 'app', it.id), () => this.tipFor({ kind: site ? 'site' : 'app', id: it.id }));
    if (d.worker) this.tappable(d.worker, () => this.pick('app', it.id), () => this.tipFor({ kind: 'app', id: it.id }));
    // etiqueta con el nombre (como las de los personajes): se ve al acercarse
    const tag = new Container();
    const tt = text(it.name.length > 22 ? it.name.slice(0, 21) + '…' : it.name, 12, 0xffffff, '600'); tt.anchor.set(0.5, 1);
    const bg = new Graphics().roundRect(-tt.width / 2 - 6, -tt.height - 3, tt.width + 12, tt.height + 5, 4).fill({ color: 0x0e1016, alpha: 0.78 });
    tag.addChild(bg, tt); tag.x = room.x + p.x; tag.y = room.y + p.y - 74; tag.visible = false;
    this.tags.addChild(tag); d.tag = tag; d.tagBg = bg;
    d.world = { x: room.x + p.x, y: room.y + p.y };
    this.desks.set(it.id, d);
  }

  // ------------------------------------------------------------------ estado
  update(state) {
    this.state = state;
    this.layout(state);
    const replate = new Set();
    for (const x of [...state.apps, ...(state.sites || [])]) {
      const d = this.desks.get(x.id);
      if (!d) continue;
      const prev = d.data.status;
      d.data = { ...x, _k: d.data._k };
      if (prev && prev !== x.status) {
        replate.add(d.room);
        if (x.status === 'down') this.bubble(d.world.x, d.world.y - 70, d.data.name, 'Me fui: fuera de servicio', 'crit');
        else if (prev === 'down') this.bubble(d.world.x, d.world.y - 70, d.data.name, 'Volví a mi puesto', 'ok');
      }
    }
    replate.forEach(r => this.fillPlaque(r));
    const s = state.system;
    if (s && this.srv) this.srv.label.children[2].text = `CPU ${s.cpu.toFixed(0)}% · memoria ${s.mem.pct.toFixed(0)}% · disco ${Math.round(s.disk?.pct ?? 0)}%`;
    const hl = healthLine(state);
    if (hl && this.srvHealth && this.srvHealth.text !== hl.text) { this.srvHealth.text = hl.text; this.srvHealth.style.fill = hl.color; }
    this.failed = (state.keys || []).some(k => k.state === 'failed');
    this.syncMates(state.sessions || []);
  }

  syncMates(sessions) {
    const seen = new Set(), per = {};
    for (const s of sessions) {
      const room = this.rooms.get(s.account) || [...this.rooms.values()].find(r => r.G);
      if (!room || !room.G) continue;
      seen.add(s.id);
      let m = this.mates.get(s.id);
      if (!m || m.room !== room) {
        if (m) m.spr.destroy();
        const h = hash(s.id);
        m = { room, gx: 0.5, gy: room.aisle, tx: 0.5, ty: room.aisle, wait: 0, hair: HAIR[h % HAIR.length], skin: SKIN[(h >>> 3) % SKIN.length] };
        m.spr = new Sprite(avatarTex(m.hair, m.skin, '#d97a3a'));
        m.spr.scale.set(PX); m.spr.anchor.set(0.5, 1);
        room.items.addChild(m.spr);
        this.tappable(m.spr, () => this.pick('session', s.id), () => this.tipFor({ kind: 'session', id: s.id }));
        this.mates.set(s.id, m);
      }
      m.s = s;
      per[room.id] = (per[room.id] || 0) + 1; m.slot = per[room.id] - 1;
    }
    for (const [id, m] of this.mates) if (!seen.has(id)) { m.spr.destroy(); this.mates.delete(id); }
  }

  // ------------------------------------------------------------------ eventos
  onEvent(e, priv) {
    switch (e.kind) {
      case 'http': {
        const d = this.desks.get(e.app || e.site);
        if (!d || !this.lift || this.fx.length > 200) return;
        return this.plane(d, e.bot, e.status >= 500);
      }
      case 'attack': return this.intruder(false);
      case 'block': return this.intruder(true, priv ? e.ip : null);
      case 'login': return this.recPt && this.bubble(this.recPt.x, this.recPt.y, 'Recepción', priv && e.user ? `¡Bienvenido, ${e.user}!` : '¡Bienvenido, administrador!', 'ok');
      case 'mail': return this.envelope(e.dir);
      case 'deploy': {
        const d = this.desks.get(e.app);
        const T = { building: ['Estoy instalando mi equipo nuevo…', 'warn'], ready: ['¡Listo, equipo nuevo funcionando!', 'ok'], error: ['Falló la instalación', 'crit'], canceled: ['Cancelé la instalación', 'dim'] }[e.action];
        if (d && T) this.bubble(d.world.x, d.world.y - 70, d.data.name, T[0], T[1]);
        return;
      }
      case 'pm2': { const d = this.desks.get(e.app); if (d && e.action !== 'down') this.bubble(d.world.x, d.world.y - 70, d.data.name, 'Reinicié mi equipo', 'warn'); return; }
      case 'domain': { const r = this.rooms.get(e.account); if (r) this.bubble(r.x + (r.box.x0 + r.box.x1) / 2, r.y + r.box.y0 + 60, r.a.label, ({ added: 'Tenemos un puesto nuevo', removed: 'Se liberó un puesto', changed: 'Cambió un sitio' }[e.action] || '') + (priv && e.domain ? ` · ${e.domain}` : ''), e.action === 'removed' ? 'warn' : 'ok'); return; }
      case 'claude': {
        const m = this.mates.get(e.sid) || [...this.mates.entries()].find(([k]) => e.sid && k.startsWith(e.sid))?.[1];
        if (!m) return;
        const x = m.room.x + m.spr.x, y = m.room.y + m.spr.y - 56;
        if (e.action === 'permission') { this.urgent = { id: m.room.id, until: this.t + 12 }; this.bubble(x, y, 'Compañero', '¿Me da permiso?', 'warn'); }
        else if (e.action === 'done') this.bubble(x, y, 'Compañero', '¡Tarea entregada!', 'ok');
        else if (e.action === 'prompt') this.bubble(x, y, 'Compañero', priv && e.text ? e.text.slice(0, 60) : 'Recibí un encargo nuevo', 'accent');
        else if (e.action === 'error') this.bubble(x, y, 'Compañero', 'Algo salió mal', 'crit');
        return;
      }
    }
  }

  addFx(obj, tick) { this.fxLayer.addChild(obj); this.fx.push({ obj, tick, age: 0 }); }
  // globo de dialogo: blanco con borde negro, el nombre en negrita y el mensaje
  bubble(x, y, who, msg, tone = 'ok') {
    if (this.fx.filter(f => f.bubble).length > 8) return;
    const TONE = { ok: 0x2f9a5a, warn: 0xc07a10, crit: 0xd0342a, dim: 0x6a707a, accent: 0x2f6fd0 };
    const c = new Container();
    const a = text(who + ': ', 13, 0x111111, '700'), b = text(msg, 13, TONE[tone] || 0x111111, '600');
    b.x = a.width;
    const w = a.width + b.width + 16, h = Math.max(a.height, b.height) + 10;
    const g = new Graphics().roundRect(-w / 2, -h, w, h, 6).fill(0xffffff).stroke({ width: 2, color: 0x111111 })
      .poly([-6, 0, 6, 0, 0, 8]).fill(0xffffff);
    g.moveTo(-6, 0).lineTo(0, 8).lineTo(6, 0).stroke({ width: 2, color: 0x111111 });
    const inner = new Container(); inner.addChild(a, b); inner.x = -w / 2 + 8; inner.y = -h + 5;
    c.addChild(g, inner); c.x = x; c.y = y;
    this.addFx(c, f => { c.y = y - f.age * 6; c.alpha = f.age < 3.6 ? 1 : Math.max(0, (4.4 - f.age) / 0.8); return f.age < 4.4; });
    this.fx[this.fx.length - 1].bubble = true;
  }
  // avion de papel: del ascensor al escritorio, en arco
  plane(d, bot, bad) {
    const s = new Sprite(bot ? PLANE_BOT : PLANE); s.scale.set(PX); s.anchor.set(0.5);
    const a = this.lift, b = { x: d.world.x, y: d.world.y - 30 };
    const mid = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 120 };
    const dur = 1.4 + Math.hypot(b.x - a.x, b.y - a.y) / 900;
    const at = k => ({ x: (1 - k) * (1 - k) * a.x + 2 * (1 - k) * k * mid.x + k * k * b.x, y: (1 - k) * (1 - k) * a.y + 2 * (1 - k) * k * mid.y + k * k * b.y });
    this.addFx(s, f => {
      const k = f.age / dur;
      if (k >= 1) { d.lit = 1; if (bad) this.crumple(d); return false; }
      const p = at(k), q = at(Math.min(1, k + 0.02));
      s.x = p.x; s.y = p.y; s.scale.x = q.x < p.x ? -PX : PX;
      return true;
    });
  }
  crumple(d) {
    const s = new Sprite(BALL); s.scale.set(PX); s.anchor.set(0.5);
    const a = { x: d.world.x, y: d.world.y - 30 }, b = this.binPt;
    this.addFx(s, f => { const k = Math.min(1, f.age / 1.3); s.x = lerp(a.x, b.x, k); s.y = lerp(a.y, b.y, k) - Math.sin(k * Math.PI) * 140; s.rotation = k * 8; return k < 1; });
  }
  envelope(dir) {
    if (!this.lift || !this.srv) return;
    const s = new Sprite(dir === 'bounce' ? ENV_BAD : ENV); s.scale.set(PX); s.anchor.set(0.5);
    const srv = { x: this.srv.x + iso(1.8, 0.8).x, y: this.srv.y + iso(1.8, 0.8).y - 40 };
    const [a, b] = dir === 'in' ? [this.lift, srv] : [srv, this.lift];
    this.addFx(s, f => { const k = Math.min(1, f.age / 1.6); s.x = lerp(a.x, b.x, k); s.y = lerp(a.y, b.y, k) - Math.sin(k * Math.PI) * 90; return k < 1; });
  }
  // intruso: sale del ascensor, choca con los torniquetes y vuelve
  intruder(blocked, ip) {
    if (!this.rec) return;
    const s = new Sprite(avatarTex('#111111', '#8a5a3a', '#2a2a33')); s.scale.set(PX); s.anchor.set(0.5, 1);
    const R = this.rec, from = iso(3.8, 0.6), to = iso(3.7, 1.7);
    s.zIndex = 30; R.items.addChild(s);
    const f0 = { obj: s, age: 0, own: true, tick: f => {
      const k = f.age < 1.6 ? f.age / 1.6 : Math.max(0, 1 - (f.age - 1.8) / 1.6);
      s.x = lerp(from.x, to.x, k); s.y = lerp(from.y, to.y, k) + (Math.floor(f.age * 6) % 2);
      s.texture = avatarTex('#111111', '#8a5a3a', '#2a2a33', { frame: Math.floor(f.age * 6) % 2 });
      if (f.age >= 1.6 && !f.hit) { f.hit = true; this.gateFlash = 1; if (blocked) this.bubble(this.gatePt.x, this.gatePt.y - 60, 'Seguridad', ip ? `Acceso denegado · ${ip}` : 'Acceso denegado', 'crit'); }
      return f.age < 3.4;
    } };
    this.fx.push(f0);
  }

  // ------------------------------------------------------------------ camara y navegacion
  fit() {
    if (!this.app || !this.bounds) return;
    const { x0, x1, y0, y1 } = this.bounds;
    const W = this.app.screen.width - this.insets.left - this.insets.right;
    const H = this.app.screen.height - this.insets.top - this.insets.bottom;
    const s = Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.97;
    this.overview = { s, x: this.insets.left + W / 2 - (x0 + x1) / 2 * s, y: this.insets.top + H / 2 - (y0 + y1) / 2 * s };
    if (!this.camBase) this.camBase = { ...this.overview };
    // pantalla chica: directorios compactos (la lista se ve al acercarse)
    const compact = s * 22 < (this.compact ? 10 : 7.5);
    if (compact !== !!this.compact) { this.compact = compact; this.measured.clear(); this.layoutKey = ''; if (this.state) this.layout(this.state); }
  }
  frame(x0, x1, y0, y1, maxS = 1.6) {
    const W = this.app.screen.width - this.insets.left - this.insets.right;
    const H = this.app.screen.height - this.insets.top - this.insets.bottom;
    const s = Math.min(maxS, Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.92);
    return { s, x: this.insets.left + W / 2 - (x0 + x1) / 2 * s, y: this.insets.top + H / 2 - (y0 + y1) / 2 * s };
  }
  roomFrame(id) {
    const r = this.rooms.get(id);
    if (!r) return null;
    const ph = r.G ? (r.G.plaqueU || 0) : 0;
    return this.frame(r.x + r.box.x0 - 20, r.x + r.box.x1 + 20, r.y + r.box.y0 - 10, r.y + r.box.y1 + Math.min(ph, 160) + 10);
  }
  directorTick(dt) {
    if (!this.overview) return;
    if (this.manualUntil > this.t) return;
    this.shotT = (this.shotT || 0) - dt;
    const resolve = id => id === 'overview' ? this.overview : (this.roomFrame(id) || this.overview);
    if (this.urgent && this.urgent.until > this.t) { this.camTarget = resolve(this.urgent.id); return; }
    if (!this.directorOn || !this.rooms.size) { this.camTarget = this.overview; return; }
    if (this.shotT <= 0 || !this.shot) {
      const order = ['overview', ...[...this.rooms.keys()].filter(k => this.rooms.get(k).G), 'srv'];
      this.shotIdx = ((this.shotIdx ?? -1) + 1) % order.length;
      this.shot = order[this.shotIdx];
      this.shotT = this.shot === 'overview' ? 18 : 9;
    }
    this.camTarget = resolve(this.shot);
  }
  setDirector(on) { this.directorOn = on; this.shot = null; this.shotT = 0; }
  tappable(obj, onTap, tip) {
    obj.eventMode = 'static'; obj.cursor = 'pointer';
    obj.on('pointertap', ev => { if (this.dragMoved) return; ev.stopPropagation(); onTap(); });
    obj.on('pointerover', e => { if (this.onTip && !this.dragMoved) this.onTip(tip(), e.client.x, e.client.y); });
    obj.on('pointerout', () => this.onTip && this.onTip(null));
  }
  pick(kind, id) {
    this.selected = { kind, id };
    let f = null;
    if (kind === 'app' || kind === 'site') { const d = this.desks.get(id); if (d) f = this.roomFrame(d.room.id); }
    else if (kind === 'session') { const m = this.mates.get(id); if (m) f = this.roomFrame(m.room.id); }
    else if (kind === 'district') f = this.roomFrame(id);
    else if (kind === 'system') f = this.roomFrame('srv');
    else if (kind === 'security') f = this.roomFrame('rec');
    if (f) { this.manualUntil = this.t + 90; this.camTarget = f; this.navChanged(); }
    if (this.onSelect) this.onSelect(kind, id);
  }
  clearSelection() { this.selected = null; }
  setupNav() {
    const cv = this.app.canvas, pts = new Map(), sig = this.sig;
    let start = null, pinch = null;
    cv.style.touchAction = 'none';
    window.addEventListener('pointerdown', e => { if (e.target !== cv) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); start = { x: e.clientX, y: e.clientY }; this.dragMoved = false; }, { capture: true, signal: sig.signal });
    window.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId); if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) { if (!this.dragMoved && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) this.dragMoved = true; if (this.dragMoved) this.panBy(dx, dy); }
      else if (pts.size === 2) { const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (pinch) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch); pinch = d; this.dragMoved = true; }
    }, sig);
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
    window.addEventListener('pointerup', up, sig);
    window.addEventListener('pointercancel', up, sig);
    cv.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false, signal: sig.signal });
    cv.addEventListener('dblclick', () => this.resetView(), sig);
  }
  manual() { this.manualUntil = this.t + 90; this.camTarget = null; this.urgent = null; this.navChanged(); }
  panBy(dx, dy) { if (!this.camBase) return; this.manual(); if (this.onTip) this.onTip(null); this.camBase.x += dx; this.camBase.y += dy; }
  zoomAt(sx, sy, f) {
    if (!this.camBase) return;
    this.manual();
    const cb = this.camBase, ns = clamp(cb.s * f, 0.15, 3);
    const wx = (sx - cb.x) / cb.s, wy = (sy - cb.y) / cb.s;
    this.camBase = { s: ns, x: sx - wx * ns, y: sy - wy * ns };
  }
  zoomBy(f) { this.zoomAt(this.app.screen.width / 2, this.app.screen.height / 2, f); }
  resetView() { this.manualUntil = 0; this.shot = null; this.shotT = 0; this.camTarget = this.overview; this.navChanged(); }
  navState() { return this.manualUntil > this.t ? { mode: 'manual', left: Math.ceil(this.manualUntil - this.t) } : { mode: this.directorOn ? 'director' : 'fixed' }; }
  navChanged() { if (this.onNav) this.onNav(this.navState()); }

  tipFor(u) {
    if (u.kind === 'app' || u.kind === 'site') {
      const d = this.desks.get(u.id); if (!d) return null;
      const a = d.data;
      return { title: a.name, body: `${a.kind && a.kind !== a.name ? `<b>${esc(a.kind)}</b> · ` : ''}${d.site ? 'puesto con laptop (sitio)' : 'escritorio con su empleado (servicio)'} · ${esc(d.room.a.label)}`,
        meta: `${{ online: 'trabajando', degraded: 'a medias (parcial)', down: 'FUERA DE SERVICIO (caído)' }[a.status] || a.status}${!d.site ? ` · CPU ${(a.cpu || 0).toFixed(1)}% · RAM ${fmtBytes(a.mem || 0)}` : ''} · ${a.reqMin || 0} visitas/min`, hint: 'Clic para ver el detalle' };
    }
    if (u.kind === 'session') { const m = this.mates.get(u.id); return m && { title: 'Compañero · agente de Claude Code', body: esc(m.s.activity || ''), meta: m.s.waitKind ? 'Tiene la mano levantada: espera su permiso' : { working: 'Trabajando', thinking: 'Pensando', idle: 'En pausa' }[m.s.state] || '', hint: 'Clic para ver la línea de tiempo' }; }
    if (u.kind === 'district') { const r = this.rooms.get(u.id); return r && { title: r.a.label, body: `Una sala con ${r.G.items.length} puestos. Su directorio, debajo, los nombra a todos.`, meta: r.caption, hint: 'Clic para ver la sala' }; }
    if (u.kind === 'system') return { title: 'Sala de servidores', body: 'El <b>servidor</b>: las luces de los racks titilan más rápido con más CPU; una se pone ámbar si falla un servicio clave.', meta: this.state?.system ? `CPU ${this.state.system.cpu.toFixed(0)}% · RAM ${this.state.system.mem.pct.toFixed(0)}% · carga ${this.state.system.load[0].toFixed(2)}` : '', hint: 'Clic para ver el servidor completo' };
    if (u.kind === 'security') return { title: 'Recepción', body: 'Por el ascensor entra todo: visitas (aviones de papel), correo y los intrusos, que se quedan en los torniquetes.', meta: '', hint: 'Clic para ver la defensa' };
    return null;
  }

  // ------------------------------------------------------------------ cuadro a cuadro
  tick(dt) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const t = this.t;
    this.directorTick(dt);
    if (this.camBase && this.camTarget) {
      const f = 1 - Math.pow(0.18, dt), cb = this.camBase, ct = this.camTarget, W = this.app.screen.width, H = this.app.screen.height;
      const cx = (W / 2 - cb.x) / cb.s, cy = (H / 2 - cb.y) / cb.s, tx = (W / 2 - ct.x) / ct.s, ty = (H / 2 - ct.y) / ct.s;
      const ns = Math.exp(lerp(Math.log(cb.s), Math.log(ct.s), f));
      this.camBase = { s: ns, x: W / 2 - lerp(cx, tx, f) * ns, y: H / 2 - lerp(cy, ty, f) * ns };
    }
    if (!this.camBase) return;
    const s = this.camBase.s;
    this.cam.scale.set(s); this.cam.x = this.camBase.x; this.cam.y = this.camBase.y;
    const blink = Math.floor(t * 3) % 2 === 0;
    const cpu = this.state?.system?.cpu || 0;
    // racks: luces que titilan con la CPU
    if (this.racks) for (const r of this.racks) {
      const p = iso(r.gx + 0.85, r.gy + 0.15), g = r.led.clear();
      for (let k = 0; k < 10; k++) {
        const on = Math.sin(t * (2 + cpu / 8) + k * 1.9 + r.ph) > -0.1;
        const c = this.failed && k === 0 ? (blink ? 0xf0a040 : 0x402a10) : on ? 0x59e08a : 0x1a3a24;
        g.rect(p.x - 26 + (k % 2) * 8, p.y - 88 + Math.floor(k / 2) * 14 + (k % 2) * 4, 4, 3).fill(c);
      }
    }
    if (this.gateLamp) {
      this.gateFlash = Math.max(0, (this.gateFlash || 0) - dt * 1.5);
      const g = this.gateLamp.clear();
      for (const gx of [3.2, 4.2]) { const p = iso(gx + 0.45, 2.5); g.rect(p.x - 3, p.y - 34, 6, 5).fill(this.gateFlash > 0.05 ? (blink ? 0xff3b2e : 0x5a1010) : 0x59e08a); }
    }
    // puestos: pantalla segun estado y actividad; el empleado teclea con la CPU
    const zoomed = this.overview && s > this.overview.s * 1.45;
    let focus = null;
    if (zoomed) { let best = 1e9; const cx = (this.app.screen.width / 2 - this.camBase.x) / s, cy = (this.app.screen.height / 2 - this.camBase.y) / s; for (const r of this.rooms.values()) if (r.G) { const k = Math.hypot(r.x + (r.box.x0 + r.box.x1) / 2 - cx, r.y + (r.box.y0 + r.box.y1) / 2 - cy); if (k < best) { best = k; focus = r; } } }
    for (const d of this.desks.values()) {
      const a = d.data, st = a.status;
      d.lit = Math.max(0, d.lit - dt * 2);
      const scr = st === 'down' ? (blink ? SCREEN.down : '#5a1010') : st === 'degraded' ? SCREEN.degraded : d.lit > 0.3 ? SCREEN.lit : SCREEN.online;
      if (scr !== d.screen) { d.screen = scr; d.sprite.texture = d.site ? laptopTex(scr) : deskTex(scr); }
      if (d.worker) {
        d.worker.visible = st !== 'down';
        const speed = st === 'online' ? 2 + (a.cpu || 0) / 6 : 0.5;
        const fr = Math.floor(t * speed + d.gx) % 2;
        if (fr !== d.frame) { d.frame = fr; d.worker.texture = avatarTex(d.hair, d.skin, d.shirt, { seated: true, frame: st === 'degraded' ? 0 : fr }); }
        d.worker.rotation = st === 'degraded' ? 0.12 : 0;
      }
      d.tag.visible = (zoomed && d.room === focus) || st === 'down';
      d.tag.scale.set(clamp(1 / s, 0.8, 1.6));
    }
    // etiquetas que no se pisan: gana la del puesto mas adelante (mas cerca de quien mira)
    const shown = [...this.desks.values()].filter(d => d.tag.visible).sort((p, q) => (q.gx + q.gy) - (p.gx + p.gy));
    const taken = [];
    for (const d of shown) {
      const w = d.tagBg.width * d.tag.scale.x / 2 + 3, h = d.tagBg.height * d.tag.scale.y;
      const r = { x0: d.tag.x - w, x1: d.tag.x + w, y0: d.tag.y - h, y1: d.tag.y + 2 };
      if (taken.some(o => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0) && d.data.status !== 'down') d.tag.visible = false; else taken.push(r);
    }
    for (const r of this.rooms.values()) if (r.label) r.label.scale.set(Math.max(0.6, Math.min(clamp(0.75 / s, 1, 2.4), r.label.maxScale)));
    // companeros: caminan por su sala hasta el frente de un escritorio; con la mano levantada si esperan
    for (const m of this.mates.values()) {
      const R = m.room, waiting = !!m.s.waitKind;
      if (waiting) { m.tx = 0.6 + m.slot * 0.9; m.ty = R.aisle; }
      else if ((m.wait -= dt) <= 0) {
        const it = R.G.items[Math.floor(Math.random() * R.G.items.length)], d = it && this.desks.get(it.id);
        if (d) { m.tx = d.gx + 0.5; m.ty = d.gy + 1.1; }
        m.wait = 3 + Math.random() * 4;
      }
      // primero por el pasillo (gy) y luego a lo largo de gx, como en una grilla
      const sp = 1.6 * dt;
      let moving = false;
      if (Math.abs(m.ty - m.gy) > 0.02) { m.gy += Math.sign(m.ty - m.gy) * Math.min(sp, Math.abs(m.ty - m.gy)); moving = true; }
      else if (Math.abs(m.tx - m.gx) > 0.02) { m.gx += Math.sign(m.tx - m.gx) * Math.min(sp, Math.abs(m.tx - m.gx)); moving = true; }
      const p = iso(m.gx, m.gy);
      m.spr.x = p.x; m.spr.y = p.y + 4; m.spr.zIndex = (m.gx + m.gy) * 10 + 3;
      const fr = moving ? Math.floor(t * 6) % 2 : 0;
      const key = fr + (waiting ? 'h' : '');
      if (key !== m.key) { m.key = key; m.spr.texture = avatarTex(m.hair, m.skin, '#d97a3a', { frame: fr, hand: waiting }); }
      m.spr.alpha = m.s.state === 'idle' ? 0.7 : 1;
    }
    // seleccion: rombo sobre la casilla del puesto elegido
    if (!this.selG) { this.selG = new Graphics(); this.tags.addChild(this.selG); }
    const sel = this.selected && this.desks.get(this.selected.id);
    this.selG.clear();
    if (sel) {
      const r = sel.room, a = iso(sel.gx, sel.gy), b = iso(sel.gx + 1, sel.gy), c = iso(sel.gx + 1, sel.gy + 1), d = iso(sel.gx, sel.gy + 1);
      this.selG.poly([a.x, a.y, b.x, b.y, c.x, c.y, d.x, d.y].map((v, i) => v + (i % 2 ? r.y : r.x))).stroke({ width: 3, color: 0xffd24a, alpha: 0.6 + 0.4 * Math.sin(t * 6) });
    }
    this.placePlaques(s);
    this.navT = (this.navT || 0) + dt;
    if (this.navT > 1) { this.navT = 0; this.navChanged(); }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.age += dt;
      if (!f.tick(f, dt)) { f.obj.destroy(); this.fx.splice(i, 1); }
    }
  }

  // directorios HTML: debajo de cada sala, del ancho de la sala, con letra que acompana al zoom
  placePlaques(s) {
    const fs = clamp(s * 22, 11, 17);
    const settled = this.overview && Math.abs(s - this.overview.s) < this.overview.s * 0.03 && Math.abs(this.camBase.x - this.overview.x) < 4;
    let off = false;
    for (const r of this.rooms.values()) {
      if (!r.plaque) continue;
      const x = this.camBase.x + (r.x + (r.box.x0 + r.box.x1) / 2) * s, y = this.camBase.y + (r.y + r.box.y1 + 6) * s;
      r.plaque.style.transform = `translate(${x | 0}px, ${y | 0}px)`;
      r.plaque.style.minWidth = '0'; r.plaque.style.width = Math.round(r.box.w * s) + 'px'; // del ancho de su sala: nunca pisa a la vecina
      r.plaque.style.fontSize = fs.toFixed(1) + 'px';
      r.plaque.classList.toggle('compact', !!this.compact && s < (this.overview?.s || 1) * 1.45);
      // medida real: si el directorio no cabe en lo reservado, se rearma la distribucion
      if (settled && this.refits < 4 && r.plaque.offsetHeight) { const u = r.plaque.offsetHeight / s + 12; if (u > (r.G.plaqueU || 0) * 1.08) { this.measured.set(r.id, u); off = true; } }
    }
    if (off && this.state) { this.refits++; this.layoutKey = ''; this.layout(this.state); }
  }
}
