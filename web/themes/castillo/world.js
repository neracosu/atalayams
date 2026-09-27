// Tema "Castillo": un castillo gotico de noche visto de costado, en pixel art dibujado en codigo (inspirado en los
// juegos de accion de castillos de los 80 y 90; nada copiado: arte, nombres y personajes propios).
//  - la TORRE DEL RELOJ es el servidor: sus agujas giran mas rapido con la CPU; si falla un servicio clave, sus
//    ventanas se encienden en rojo. Al pie, el PORTON (el cortafuegos) sobre el foso
//  - cada cuenta es una SALA del castillo con su estandarte; debajo, su PLACA nombra todo lo que hay adentro
//  - cada servicio es un CANDELABRO: sus llamas crecen con la CPU; a medias, llama azul y debil; caido, apagado
//  - cada sitio es un VITRAL: su haz de luz se enciende con las visitas; caido, oscuro
//  - cada visita es un MURCIELAGO que baja de la luna hasta su candelabro o vitral (gris si es un robot;
//    rojo si fue un error del servidor)
//  - cada intento de acceso es un ESPECTRO que flota hasta el porton; si la IP cae, un rayo de luz lo disuelve
//  - cada sesion de Claude Code es una CAZADORA que recorre su sala con su antorcha; si espera su permiso, se
//    detiene con la antorcha en alto
//  - el correo son cuervos que salen o llegan a la torre
// Regla de oro: pixel art para el castillo y sus habitantes; textos nitidos; la luz (llamas, vitrales,
// ventanas) cuenta lo que pasa.
import { Application, Container, Graphics, Sprite, Text, Texture } from '../../vendor/pixi.csp.mjs';
import { signTexture, signCanvas } from '../../js/sprites.js';
import { groupsOf, layoutKeyOf, packRows, iconURL, plaqueList, healthLine } from '../../js/layout.js';
import { esc, fmtBytes } from '../../js/hud.js';
import { accountCaption } from '../../js/accounts.js';
import { pixiScreen } from '../../js/commfx.js';

const PX = 2;                       // escala del pixel art
const SLOT_W = 80, SLOT_H = 108;    // lugar de cada candelabro o vitral dentro de una sala
const HEAD = 46, PAD = 20, B = 12;  // alto del encabezado de la sala, margen interior, grosor del muro
const TOWER_W = 128, GAP = 44;
const FONT_T = "'Jacquard 24', 'Pixelify Sans', serif", FONT = "'Pixelify Sans', ui-monospace, monospace";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const hexn = h => parseInt(String(h).slice(1), 16);
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
function shade(hex, f) {
  const n = hexn(hex), c = v => Math.round(v + ((f < 0 ? 0 : 255) - v) * Math.abs(f)).toString(16).padStart(2, '0');
  return '#' + c(n >> 16) + c(n >> 8 & 255) + c(n & 255);
}
// textura nitida a partir de filas de caracteres (una letra por color)
const TEX = new Map();
function rowsTex(key, rows, pal) {
  if (TEX.has(key)) return TEX.get(key);
  const w = Math.max(...rows.map(r => r.length)), h = rows.length;
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) { cx.fillStyle = pal[ch]; cx.fillRect(x, y, 1, 1); } }));
  const t = Texture.from(cv); t.source.scaleMode = 'nearest';
  TEX.set(key, t);
  return t;
}
function canvasTex(key, w, h, draw) {
  if (TEX.has(key)) return TEX.get(key);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  draw(cv.getContext('2d'));
  const t = Texture.from(cv); t.source.scaleMode = 'nearest';
  TEX.set(key, t);
  return t;
}

// ------------------------------------------------------------------ pixel art
const CANDELABRA = [
  '..w...w...w..', '..w...w...w..', '..w...w...w..', '.gGg.gGg.gGg.', '..g...g...g..', '..ggggGgggg..',
  '......g......', '......G......', '.....gGg.....', '......g......', '......G......', '......g......',
  '.....gGg.....', '....ggGgg....', '...gggGggg...'];
const BAT = [
  ['k.......k', 'kk.kkk.kk', '.kkkrkkk.', '..kkkkk..', '...k.k...'],
  ['.........', '...kkk...', '.kkkrkkk.', 'kk.kkk.kk', 'k..k.k..k']];
const GHOST = [
  ['...wwww...', '..wwwwww..', '.wwwwwwww.', '.wkkwwkkw.', '.wkkwwkkw.', '.wwwwwwww.', '.wwwkkwww.', '.wwwwwwww.', '.wwwwwwww.', '.wwwwwwww.', '.w.ww.ww.w', 'w..w..w..w'],
  ['...wwww...', '..wwwwww..', '.wwwwwwww.', '.wkkwwkkw.', '.wkkwwkkw.', '.wwwwwwww.', '.wwwkkwww.', '.wwwwwwww.', '.wwwwwwww.', '.wwwwwwww.', 'w.ww.ww.w.', '.w..w..w..']];
const RAVEN = [['k.......k', 'kk.....kk', '.kkkykkk.', '..kkkkk..', '....k....'], ['.........', '...kyk...', '.kkkkkkk.', 'kk.kkk.kk', 'k.......k']];
// cazadora de 12 x 16: capa de su color, pelo, tunica, botas; frames: quieta, caminando
const HUNTER_BASE = [
  '....hhhh....', '...hhhhhh...', '...hsssssh..', '...ssesses..', '....ssss....', '..cctttttc..', '.ccttyytttc.', '.cctttttttc.',
  '.cc.tbbt.cc.', '.c..tttt..c.', '.c..pppp..c.', '....pp.pp...', '....pp.pp...', '....pp.pp...', '...bbb.bbb..', '............'];
function hunterRows(frame) {
  const r = HUNTER_BASE.slice();
  if (frame === 1) { r[11] = '....pp..pp..'; r[12] = '...pp....pp.'; r[13] = '...pp....pp.'; r[14] = '..bbb....bbb'; }
  return r;
}
const HPAL = (cape, hair) => ({ h: hair, s: '#f0c8a0', e: '#1a1020', c: cape, t: '#3a2a4a', y: '#d8b24a', b: '#2a1a14', p: '#4a3a5a' });

// vitral en arco: vidrios de colores (salen del nombre) con plomo negro
function windowTex(seed, dark) {
  return canvasTex('win' + seed + (dark ? 'd' : ''), 14, 24, cx => {
    const cols = ['#b0203a', '#2a5ab0', '#d8b24a', '#3a9a5a', '#8a3ab0', '#c86a2a'];
    let r = seed || 1; const rnd = () => { r = Math.imul(r ^ r >>> 13, 1274126177) >>> 0; return r; };
    const a = cols[rnd() % 6], b = cols[rnd() % 6], c = cols[rnd() % 6];
    for (let y = 0; y < 24; y++) for (let x = 0; x < 14; x++) {
      const dx = x - 6.5, top = y < 7 ? Math.hypot(dx, 7 - y) > 7 : false;
      if (top) continue;
      const edge = x === 0 || x === 13 || y === 23 || (y < 7 && Math.hypot(dx, 7 - y) > 5.9);
      const lead = x === 7 || y % 6 === 5 || (y > 6 && x % 4 === 3 && y % 12 < 6);
      cx.fillStyle = edge ? '#1a1418' : lead ? '#141018' : dark ? '#2a2430' : ((x >> 2) + (y / 6 | 0)) % 3 === 0 ? a : ((x >> 2) + (y / 6 | 0)) % 3 === 1 ? b : c;
      cx.fillRect(x, y, 1, 1);
    }
  });
}
// ladrillos para los muros (se repiten)
function brickTex(key, base, line) {
  return canvasTex(key, 32, 16, cx => {
    cx.fillStyle = base; cx.fillRect(0, 0, 32, 16);
    cx.fillStyle = line;
    cx.fillRect(0, 7, 32, 1); cx.fillRect(0, 15, 32, 1);
    cx.fillRect(15, 0, 1, 7); cx.fillRect(7, 8, 1, 7); cx.fillRect(23, 8, 1, 7);
    cx.fillStyle = shade(base, 0.08); cx.fillRect(1, 1, 13, 1); cx.fillRect(17, 1, 13, 1); cx.fillRect(9, 9, 13, 1);
  });
}

function text(str, size, color, font = FONT, weight = '400') {
  const t = new Text({ text: str, style: { fontFamily: font, fontSize: size, fill: color, fontWeight: weight, stroke: { color: '#0a0610', width: 4 } } });
  t.resolution = 2;
  return t;
}

export default class CastilloWorld {
  constructor(el) {
    this.el = el;
    this.rooms = new Map(); this.items = new Map(); this.hunters = new Map();
    this.fx = []; this.t = 0; this.layoutKey = '';
    this.directorOn = true; this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.measured = new Map(); this.refits = 0;
  }

  async init() {
    this.ac = new AbortController();
    const sig = { signal: this.ac.signal };
    this.sig = sig;
    await Promise.all([document.fonts.load(`20px ${FONT_T}`), document.fonts.load(`14px ${FONT}`)]).catch(() => { });
    this.app = new Application();
    await this.app.init({ resizeTo: this.el, background: '#0c0816', antialias: false, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2), preference: 'webgl' });
    this.el.appendChild(this.app.canvas);
    this.cam = new Container();
    this.sky = new Container(); this.castle = new Container(); this.itemsL = new Container(); this.fxLayer = new Container(); this.tags = new Container();
    this.cam.addChild(this.sky, this.castle, this.itemsL, this.fxLayer, this.tags);
    this.app.stage.addChild(this.cam);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.plaques = Object.assign(document.createElement('div'), { className: 'w3-labels' });
    this.el.appendChild(this.plaques);
    this.plaques.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) { const [k, ...r] = g.dataset.go.split(':'); this.pick(k, r.join(':')); } }, sig);
    this.setupNav();
    this.app.ticker.add(tk => this.tick(tk.deltaMS / 1000));
    window.addEventListener('resize', () => this.fit(), sig);
  }
  // donde esta cada cosa en la pantalla (comunicacion entre agentes); los subagentes van junto a su sesion
  screenOf(kind, id) {
    if (kind === 'session' || kind === 'agent') return pixiScreen(this.app, this.hunters.get(String(id).split('/')[0]));
    return pixiScreen(this.app, this.items.get(id));
  }

  destroy() { this.ac.abort(); this.plaques.remove(); this.app.destroy({ removeView: true }, { children: true }); }
  setInsets(ins) { this.insets = ins; this.fit(); }

  // ------------------------------------------------------------------ el castillo
  layout(state) {
    const key = layoutKeyOf(state);
    if (key === this.layoutKey) return;
    if (key !== this.realKey) { this.realKey = key; this.refits = 0; }
    this.layoutKey = key;
    for (const L of [this.sky, this.castle, this.itemsL, this.tags]) L.removeChildren().forEach(c => c.destroy({ children: true }));
    for (const r of this.rooms.values()) r.plaque.remove();
    for (const h of this.hunters.values()) h.spr.destroy();
    this.rooms.clear(); this.items.clear(); this.hunters.clear();
    this.selG = null;
    const list = groupsOf(state);
    for (const R of list) {
      R.cols = Math.min(R.items.length, clamp(Math.ceil(Math.sqrt(R.items.length * 2)), 2, 7));
      R.rows = Math.ceil(R.items.length / R.cols);
      R.w = R.cols * SLOT_W + PAD * 2; R.h = HEAD + R.rows * SLOT_H + 8;
    }
    const K = 22;
    const est = R => K * 1.3 * (2.8 + (this.compact ? 0 : Math.ceil(R.items.length / Math.max(1, Math.floor(R.w / (K * 10.5)))))) + 14;
    const plaqueH = R => (R.plaqueU = Math.max(est(R), this.measured.get(R.a.id) || 0));
    const W = this.app.screen.width - this.insets.left - this.insets.right, H = this.app.screen.height - this.insets.top - this.insets.bottom;
    const best = packRows(list, { w: R => R.w + 2 * B, h: R => R.h + 2 * B + 26 + plaqueH(R) + 18, gap: GAP, lead: 0, aspect: Math.max(0.4, W / Math.max(1, H)) * 0.92 });
    // la torre del reloj a la izquierda, a todo lo alto; las salas a su derecha, en pisos
    const x0 = TOWER_W + 60;
    let y = 0;
    best.rows.forEach((row, ri) => {
      let x = x0 + (best.W - best.widths[ri]) / 2;
      for (const R of row) { this.buildRoom(R, x + B, y + 26 + B); x += R.w + 2 * B + GAP; }
      y += best.heights[ri];
    });
    this.groundY = y + 10;
    this.width = x0 + best.W + 40;
    this.buildTower();
    this.buildScenery();
    this.bounds = { x0: -40, x1: this.width + 20, y0: -150, y1: this.groundY + 60 };
    this.fit();
    this.camBase = { ...this.overview };
  }

  buildScenery() {
    // cielo: estrellas, luna y montanas lejanas (detras del castillo)
    const g = new Graphics();
    let r = 7; const rnd = () => { r = Math.imul(r ^ r >>> 13, 1274126177) >>> 0; return r / 4294967296; };
    for (let i = 0; i < 160; i++) g.rect(-600 + rnd() * (this.width + 1200), -500 + rnd() * (this.groundY + 400), 2, 2).fill({ color: 0xc8b8e8, alpha: 0.3 + rnd() * 0.5 });
    this.moon = { x: this.width - 40, y: -110 };
    g.circle(this.moon.x, this.moon.y, 70).fill({ color: 0xf4e8c8, alpha: 0.08 });
    g.circle(this.moon.x, this.moon.y, 48).fill(0xf4e8c8);
    g.circle(this.moon.x - 14, this.moon.y - 8, 9).fill(0xe0d0a8); g.circle(this.moon.x + 16, this.moon.y + 12, 6).fill(0xe0d0a8);
    // montanas
    const pts = [-700, this.groundY + 60];
    for (let x = -700; x <= this.width + 700; x += 90) pts.push(x, this.groundY - 120 - 110 * Math.abs(Math.sin(x * 0.0071)) - 60 * rnd());
    pts.push(this.width + 700, this.groundY + 60);
    g.poly(pts).fill(0x160f24);
    // silueta del castillo detras de las salas (une los pisos en un solo edificio)
    const rooms = [...this.rooms.values()];
    if (rooms.length) {
      const xa = Math.min(...rooms.map(R => R.x - B)) - 16, xb = Math.max(...rooms.map(R => R.x + R.w + B)) + 16, ya = Math.min(...rooms.map(R => R.y - B)) - 20;
      g.rect(xa, ya, xb - xa, this.groundY - ya).fill(0x1c1428);
      for (let x = xa; x < xb; x += 24) g.rect(x, ya - 12, 12, 12).fill(0x1c1428);
      for (const sx of [xa - 24, xb]) { g.rect(sx, ya - 60, 40, this.groundY - ya + 60).fill(0x1a1226); g.poly([sx - 6, ya - 60, sx + 20, ya - 120, sx + 46, ya - 60]).fill(0x2a1a36); }
    }
    // suelo y foso
    g.rect(-700, this.groundY, this.width + 1400, 26).fill(0x1e2a1a);
    g.rect(-700, this.groundY + 26, this.width + 1400, 60).fill(0x0e1a2a);
    for (let x = -700; x < this.width + 700; x += 18) g.rect(x, this.groundY + 30 + (x % 36 ? 4 : 0), 10, 2).fill({ color: 0x3a5a7a, alpha: 0.5 });
    this.sky.addChild(g);
  }

  buildTower() {
    const x = 40, top = -60, h = this.groundY - top, g = new Graphics();
    const stone = new Sprite(brickTex('bT', '#4a4458', '#332e40'));
    const T = new Container();
    // cuerpo de la torre con ladrillos (mosaico de la textura)
    const wall = new Graphics();
    for (let yy = 0; yy < h; yy += 16) for (let xx = 0; xx < TOWER_W; xx += 32) { const s = new Sprite(stone.texture); s.x = x + xx; s.y = top + yy; s.width = Math.min(32, TOWER_W - xx); s.height = Math.min(16, h - yy); T.addChild(s); }
    stone.destroy();
    // techo en punta, almenas y aguja
    g.poly([x - 14, top, x + TOWER_W / 2, top - 120, x + TOWER_W + 14, top]).fill(0x2a1a36);
    g.poly([x - 14, top, x + TOWER_W / 2, top - 120, x + TOWER_W / 2, top]).fill(0x221430);
    g.rect(x + TOWER_W / 2 - 2, top - 150, 4, 32).fill(0x8a7a5a);
    g.poly([x + TOWER_W / 2 + 2, top - 150, x + TOWER_W / 2 + 22, top - 143, x + TOWER_W / 2 + 2, top - 136]).fill(0xb0203a);
    // reloj
    this.clock = { x: x + TOWER_W / 2, y: top + 56, r: 40 };
    g.circle(this.clock.x, this.clock.y, this.clock.r + 6).fill(0x2a2233);
    g.circle(this.clock.x, this.clock.y, this.clock.r).fill(0xe8dcb8);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.rect(this.clock.x + Math.cos(a) * (this.clock.r - 7) - 2, this.clock.y + Math.sin(a) * (this.clock.r - 7) - 2, 4, 4).fill(0x2a2233); }
    // ventanas en ranura, porton y puente
    this.towerWins = [];
    for (let yy = top + 130; yy < this.groundY - 110; yy += 90) this.towerWins.push({ x: x + TOWER_W / 2 - 7, y: yy });
    this.gate = { x: x + TOWER_W / 2, y: this.groundY };
    g.rect(this.gate.x - 30, this.groundY - 70, 60, 70).fill(0x140c10);
    g.circle(this.gate.x, this.groundY - 70, 30).fill(0x140c10);
    for (let k = -24; k <= 24; k += 12) g.rect(this.gate.x + k - 2, this.groundY - 92, 4, 92).fill(0x4a3a2a);
    g.rect(this.gate.x + 30, this.groundY + 2, 140, 10).fill(0x5a3a22);
    T.addChild(g);
    this.dyn = new Graphics(); T.addChild(this.dyn); // agujas y ventanas (cada cuadro)
    T.eventMode = 'static'; T.cursor = 'pointer';
    this.tappable(T, () => this.pick('system', 'root'), () => this.tipFor({ kind: 'system' }));
    this.castle.addChild(T);
    const t = text('TORRE DEL RELOJ', 18, 0xe8dcb8, FONT_T); t.anchor.set(0.5, 1); t.x = this.clock.x; t.y = top - 160;
    this.towerSub = text('', 12, 0xb8a8c8); this.towerSub.anchor.set(0.5, 0); this.towerSub.x = this.clock.x; this.towerSub.y = this.groundY + 90;
    this.towerTitle = t;
    this.towerHealth = text('', 14, 0x4ade80, FONT, '700'); this.towerHealth.anchor.set(0.5, 0); this.towerHealth.x = this.clock.x; this.towerHealth.y = this.groundY + 110;
    this.tags.addChild(t, this.towerSub, this.towerHealth);
    this.towerTop = { x: this.clock.x, y: top - 100 };
  }

  buildRoom(R, x, y) {
    const { a, items } = R;
    R.x = x; R.y = y;
    const C = new Container();
    // muro exterior (ladrillo claro) e interior (ladrillo oscuro)
    const outer = brickTex('bO', '#5a5468', '#433d52'), inner = brickTex('bI', '#2c2438', '#241c30');
    const fill = (tex, fx, fy, fw, fh) => { for (let yy = 0; yy < fh; yy += 16) for (let xx = 0; xx < fw; xx += 32) { const s = new Sprite(tex); s.x = fx + xx; s.y = fy + yy; s.width = Math.min(32, fw - xx); s.height = Math.min(16, fh - yy); C.addChild(s); } };
    fill(outer, x - B, y - B, R.w + 2 * B, R.h + 2 * B);
    fill(inner, x, y, R.w, R.h);
    const g = new Graphics();
    // almenas y arco del techo
    for (let xx = x - B; xx < x + R.w + B; xx += 20) g.rect(xx, y - B - 12, 12, 12).fill(0x5a5468);
    for (let xx = x + 10; xx < x + R.w - 20; xx += 40) g.poly([xx, y, xx + 20, y + 14, xx + 40, y, xx + 40, y + 2, xx + 20, y + 16, xx, y + 2]).fill({ color: 0x1a1424, alpha: 0.8 });
    // estandarte de la cuenta que cuelga en el centro
    const t = text(a.label.toUpperCase(), 17, 0xf4e8c8, FONT_T); t.anchor.set(0.5, 0);
    const bw = Math.min(R.w - 16, t.width + 36);
    const bx = x + R.w / 2 - bw / 2;
    g.poly([bx, y + 4, bx + bw, y + 4, bx + bw, y + 32, bx + bw / 2, y + 40, bx, y + 32]).fill(hexn(shade(a.color, -0.45)));
    g.rect(bx, y + 4, bw, 3).fill(0xd8b24a);
    t.x = x + R.w / 2; t.y = y + 8;
    if (t.width > bw - 14) t.scale.set((bw - 14) / t.width);
    // repisas de cada fila
    for (let r = 0; r < R.rows; r++) {
      const fy = y + HEAD + (r + 1) * SLOT_H - 6;
      g.rect(x, fy, R.w, 8).fill(0x5a3a22); g.rect(x, fy, R.w, 2).fill(0x7a5a32);
    }
    C.addChild(g, t);
    C.eventMode = 'static';
    this.tappable(C, () => this.pick('district', a.id), () => this.tipFor({ kind: 'district', id: a.id }));
    this.castle.addChild(C);
    const nA = items.filter(i => i._k === 'app').length;
    R.caption = accountCaption(a, nA, items.length - nA);
    items.forEach((it, i) => this.addItem(it, R, x + PAD + (i % R.cols + 0.5) * SLOT_W, y + HEAD + (Math.floor(i / R.cols) + 1) * SLOT_H - 6));
    R.walkY = y + HEAD + R.rows * SLOT_H - 6;
    // placa HTML debajo de la sala
    R.plaque = document.createElement('div');
    R.plaque.className = 'w3-label w3-plaque';
    R.plaque.dataset.go = 'district:' + a.id;
    R.plaque.innerHTML = `<b style="border-color:${a.color}">${esc(a.label)}</b><small>${esc(R.caption)}</small><div class="fishlist"></div>`;
    this.plaques.appendChild(R.plaque);
    this.rooms.set(a.id, R);
    this.fillPlaque(R);
  }
  fillPlaque(R) {
    R.plaque.querySelector('.fishlist').innerHTML = plaqueList(R.items.map(it => ({ ...it, ...(this.items.get(it.id)?.data || {}) })), it => iconURL('sign:' + (it.icon || 'web'), () => signCanvas(it.icon || 'web', 2)));
  }

  // candelabro (servicio) o vitral (sitio) sobre la repisa; x = centro, y = repisa
  addItem(it, R, x, y) {
    const site = it._k === 'site';
    const seed = hash(it.id + it.name);
    const C = new Container();
    const d = { data: it, site, R, x, y, C, lit: 0, seed };
    if (site) {
      d.beam = new Graphics(); C.addChild(d.beam);
      d.win = new Sprite(windowTex(seed, false)); d.win.scale.set(PX + 0.5); d.win.anchor.set(0.5, 1); d.win.x = x; d.win.y = y - 20;
      const sill = new Graphics().rect(x - 22, y - 20, 44, 5).fill(0x6a6078);
      C.addChild(d.win, sill);
    } else {
      const ped = new Graphics().rect(x - 16, y - 18, 32, 18).fill(0x4a4458).rect(x - 16, y - 18, 32, 3).fill(0x6a6078).rect(x - 20, y - 4, 40, 4).fill(0x3a3446);
      d.cand = new Sprite(rowsTex('cand', CANDELABRA, { w: '#efe6d0', g: '#c8a040', G: '#8a6a28' })); d.cand.scale.set(PX); d.cand.anchor.set(0.5, 1); d.cand.x = x; d.cand.y = y - 18;
      d.flame = new Graphics();
      d.glow = new Graphics();
      C.addChild(d.glow, ped, d.cand, d.flame);
    }
    // cartel pixel (o favicon) en un escudo sobre cada cosa
    d.sign = new Sprite(signTexture(it.icon || 'web')); d.sign.scale.set(PX); d.sign.anchor.set(0.5, 1);
    d.sign.x = x; d.sign.y = y - (site ? 88 : 70);
    const shield = new Graphics().roundRect(x - 14, d.sign.y - 24, 28, 28, 4).fill({ color: 0x140c1c, alpha: 0.7 });
    C.addChild(shield, d.sign);
    C.eventMode = 'static';
    this.tappable(C, () => this.pick(site ? 'site' : 'app', it.id), () => this.tipFor({ kind: site ? 'site' : 'app', id: it.id }));
    this.itemsL.addChild(C);
    // nombre (se ve al acercarse a la sala, o siempre si esta caido)
    const tag = new Container();
    const tt = text(it.name.length > 22 ? it.name.slice(0, 21) + '…' : it.name, 12, 0xf4e8c8); tt.anchor.set(0.5, 1);
    const bg = new Graphics().roundRect(-tt.width / 2 - 6, -tt.height - 2, tt.width + 12, tt.height + 4, 3).fill({ color: 0x0a0610, alpha: 0.8 });
    tag.addChild(bg, tt); tag.x = x; tag.y = d.sign.y - 28; tag.visible = false;
    this.tags.addChild(tag);
    d.tag = tag; d.tagBg = bg;
    this.items.set(it.id, d);
  }

  // ------------------------------------------------------------------ estado
  update(state) {
    this.state = state;
    this.layout(state);
    const replate = new Set();
    for (const x of [...state.apps, ...(state.sites || [])]) {
      const d = this.items.get(x.id);
      if (!d) continue;
      const prev = d.data.status;
      d.data = { ...x, _k: d.data._k };
      if (prev && prev !== x.status) {
        replate.add(d.R);
        if (d.win) d.win.texture = windowTex(d.seed, x.status === 'down');
        if (x.status === 'down') this.bubble(d.x, d.y - 110, d.data.name, d.site ? 'El vitral se apagó' : 'Se apagaron las velas', 'crit');
        else if (prev === 'down') this.bubble(d.x, d.y - 110, d.data.name, 'Vuelve la luz', 'ok');
      }
      if (d.sign.texture !== signTexture(x.icon || 'web')) d.sign.texture = signTexture(x.icon || 'web');
    }
    replate.forEach(R => this.fillPlaque(R));
    const s = state.system;
    if (s && this.towerSub) this.towerSub.text = `CPU ${s.cpu.toFixed(0)}% · memoria ${s.mem.pct.toFixed(0)}% · disco ${Math.round(s.disk?.pct ?? 0)}%`;
    const hl = healthLine(state);
    if (hl && this.towerHealth && this.towerHealth.text !== hl.text) { this.towerHealth.text = hl.text; this.towerHealth.style.fill = hl.color; }
    this.failed = (state.keys || []).filter(k => k.state === 'failed').map(k => k.label);
    this.syncHunters(state.sessions || []);
  }

  syncHunters(sessions) {
    const seen = new Set(), per = {};
    for (const s of sessions) {
      const R = this.rooms.get(s.account) || [...this.rooms.values()][0];
      if (!R) continue;
      seen.add(s.id);
      let h = this.hunters.get(s.id);
      if (!h) {
        const hs = hash(s.id);
        h = { R, x: R.x + 30, tx: R.x + 30, wait: 0, dir: 1, cape: ['#b0203a', '#2a5ab0', '#3a9a5a', '#8a3ab0'][hs % 4], hair: ['#e8d8a8', '#2a1a10', '#8a4a2a', '#c8c8d0'][(hs >> 3) % 4] };
        h.spr = new Sprite(rowsTex('hunter0' + h.cape + h.hair, hunterRows(0), HPAL(h.cape, h.hair))); h.spr.scale.set(PX); h.spr.anchor.set(0.5, 1);
        h.torch = new Graphics();
        h.spr.eventMode = 'static';
        this.tappable(h.spr, () => this.pick('session', s.id), () => this.tipFor({ kind: 'session', id: s.id }));
        this.itemsL.addChild(h.torch, h.spr);
        this.hunters.set(s.id, h);
      }
      h.s = s; h.R = R;
      per[R.a.id] = (per[R.a.id] || 0) + 1; h.slot = per[R.a.id] - 1;
    }
    for (const [id, h] of this.hunters) if (!seen.has(id)) { h.spr.destroy(); h.torch.destroy(); this.hunters.delete(id); }
  }

  // ------------------------------------------------------------------ eventos
  onEvent(e, priv) {
    switch (e.kind) {
      case 'http': {
        const d = this.items.get(e.app || e.site);
        if (!d || this.fx.length > 160) return;
        return this.bat(d, e.bot, e.status >= 500);
      }
      case 'attack': return this.ghost(false);
      case 'block': return this.ghost(true, priv ? e.ip : null);
      case 'login': return this.gate && this.bubble(this.gate.x, this.gate.y - 110, 'Portón', priv && e.user ? `Se abre para ${e.user}` : 'Se abre para el señor del castillo', 'ok');
      case 'mail': return this.raven(e.dir);
      case 'deploy': {
        const d = this.items.get(e.app);
        const T = { building: ['Encendiendo velas nuevas…', 'warn'], ready: ['¡Candelabro listo!', 'ok'], error: ['Se quebró el candelabro', 'crit'], canceled: ['Se canceló', 'dim'] }[e.action];
        if (d && T) this.bubble(d.x, d.y - 110, d.data.name, T[0], T[1]);
        return;
      }
      case 'pm2': { const d = this.items.get(e.app); if (d && e.action !== 'down') this.bubble(d.x, d.y - 110, d.data.name, 'Volvieron a encenderse', 'warn'); return; }
      case 'domain': { const R = this.rooms.get(e.account); if (R) this.bubble(R.x + R.w / 2, R.y - 20, R.a.label, ({ added: 'Una luz nueva en la sala', removed: 'Se retiró un candelabro', changed: 'Cambió un vitral' }[e.action] || '') + (priv && e.domain ? ` · ${e.domain}` : ''), e.action === 'removed' ? 'warn' : 'ok'); return; }
      case 'claude': {
        const h = this.hunters.get(e.sid) || [...this.hunters.entries()].find(([k]) => e.sid && k.startsWith(e.sid))?.[1];
        if (!h) return;
        const y = h.R.walkY - 60;
        if (e.action === 'permission') { this.urgent = { id: h.R.a.id, until: this.t + 12 }; this.bubble(h.x, y, 'Cazadora', '¿Me da permiso?', 'warn'); }
        else if (e.action === 'done') this.bubble(h.x, y, 'Cazadora', '¡Misión cumplida!', 'ok');
        else if (e.action === 'prompt') this.bubble(h.x, y, 'Cazadora', priv && e.text ? e.text.slice(0, 60) : 'Una misión nueva', 'accent');
        else if (e.action === 'error') this.bubble(h.x, y, 'Cazadora', 'Algo salió mal', 'crit');
        return;
      }
    }
  }

  addFx(obj, tick) { this.fxLayer.addChild(obj); this.fx.push({ obj, tick, age: 0 }); }
  // murcielago: baja desde la luna en arco hasta su candelabro o vitral
  bat(d, bot, bad) {
    const pal = { k: bad ? '#b0203a' : bot ? '#6a6478' : '#1a1020', r: bad ? '#ffd24a' : '#ff3b3b' };
    const key = 'bat' + pal.k;
    const s = new Sprite(rowsTex(key + '0', BAT[0], pal)); s.scale.set(PX); s.anchor.set(0.5);
    const a = { x: (this.moon?.x || 0) + (Math.random() - 0.5) * 60, y: (this.moon?.y || 0) + 20 }, b = { x: d.x + (Math.random() - 0.5) * 20, y: d.y - (d.site ? 60 : 50) };
    const m = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 80 };
    const dur = 1.6 + Math.hypot(b.x - a.x, b.y - a.y) / 700;
    this.addFx(s, f => {
      const k = f.age / dur;
      if (k >= 1) { d.lit = 1; if (bad) this.sparks(b.x, b.y, 0xb0203a); return false; }
      const u = 1 - k;
      s.x = u * u * a.x + 2 * u * k * m.x + k * k * b.x; s.y = u * u * a.y + 2 * u * k * m.y + k * k * b.y + Math.sin(f.age * 18) * 3;
      s.texture = rowsTex(key + (Math.floor(f.age * 10) % 2), BAT[Math.floor(f.age * 10) % 2], pal);
      s.scale.x = (b.x < a.x ? -1 : 1) * PX;
      return true;
    });
  }
  sparks(x, y, color) {
    for (let i = 0; i < 8; i++) {
      const g = new Graphics().rect(-2, -2, 4, 4).fill(color); g.x = x; g.y = y;
      const vx = (Math.random() - 0.5) * 120, vy = -Math.random() * 120;
      this.addFx(g, (f, dt) => { g.x += vx * dt; g.y += (vy + f.age * 300) * dt; g.alpha = 1 - f.age / 0.8; return f.age < 0.8; });
    }
  }
  raven(dir) {
    if (!this.towerTop) return;
    const pal = { k: '#141018', y: dir === 'bounce' ? '#ff3b3b' : '#d8b24a' };
    const s = new Sprite(rowsTex('rav0' + pal.y, RAVEN[0], pal)); s.scale.set(PX); s.anchor.set(0.5);
    const far = { x: -300, y: -200 - Math.random() * 100 };
    const [a, b] = dir === 'in' ? [far, this.towerTop] : [this.towerTop, far];
    this.addFx(s, f => {
      const k = Math.min(1, f.age / 2.4);
      s.x = lerp(a.x, b.x, k); s.y = lerp(a.y, b.y, k) - Math.sin(k * Math.PI) * 60;
      s.texture = rowsTex('rav' + (Math.floor(f.age * 8) % 2) + pal.y, RAVEN[Math.floor(f.age * 8) % 2], pal);
      s.scale.x = (b.x < a.x ? -1 : 1) * PX;
      return k < 1;
    });
  }
  // espectro: flota por el campo hasta el porton; si la IP cae, un rayo de luz lo disuelve
  ghost(blocked, ip) {
    if (!this.gate) return;
    const s = new Sprite(rowsTex('gh0', GHOST[0], { w: '#d8e0f0', k: '#1a1020' })); s.scale.set(PX); s.anchor.set(0.5, 1); s.alpha = 0.85;
    const from = { x: this.width + 60, y: this.groundY - 6 }, to = { x: this.gate.x + 44, y: this.groundY - 6 };
    this.addFx(s, f => {
      s.texture = rowsTex('gh' + (Math.floor(f.age * 4) % 2), GHOST[Math.floor(f.age * 4) % 2], { w: '#d8e0f0', k: '#1a1020' });
      if (!f.hit) {
        const k = Math.min(1, f.age / 4);
        s.x = lerp(from.x, to.x, k); s.y = to.y - 10 - Math.sin(f.age * 3) * 6; s.scale.x = -PX;
        if (k >= 1) {
          f.hit = f.age; this.gateFlash = 1;
          if (blocked) {
            const beam = new Graphics().rect(-14, -400, 28, 400).fill({ color: 0xfff4c8, alpha: 0.6 }); beam.x = s.x; beam.y = to.y;
            this.addFx(beam, g => { beam.alpha = 1 - g.age / 0.9; beam.scale.x = 1 + g.age; return g.age < 0.9; });
            this.bubble(s.x, to.y - 90, 'Guardia', ip ? `Espectro disuelto · ${ip}` : 'Espectro disuelto', 'crit');
          }
        }
        return true;
      }
      const k = (f.age - f.hit) / (blocked ? 0.7 : 2);
      if (blocked) { s.alpha = 0.85 * (1 - k); s.scale.y = PX * (1 + k); }
      else { s.x += 1.5; s.scale.x = PX; s.alpha = 0.85 * (1 - k); }
      return k < 1;
    });
  }
  // globo como un pergamino: el nombre en negrita y el mensaje
  bubble(x, y, who, msg, tone = 'ok') {
    if (this.fx.filter(f => f.bubble).length > 8) return;
    const TONE = { ok: 0x2f7a3a, warn: 0x9a6a10, crit: 0xa0202a, dim: 0x6a6078, accent: 0x5a2a8a };
    const c = new Container();
    const a = new Text({ text: who + ': ', style: { fontFamily: FONT, fontSize: 13, fill: 0x2a1a10, fontWeight: '700' } });
    const b = new Text({ text: msg, style: { fontFamily: FONT, fontSize: 13, fill: TONE[tone] || 0x2a1a10 } });
    a.resolution = b.resolution = 2; b.x = a.width;
    const w = a.width + b.width + 18, h = Math.max(a.height, b.height) + 10;
    const g = new Graphics().rect(-w / 2, -h, w, h).fill(0xf0e2c0).stroke({ width: 2, color: 0x3a2a1a })
      .rect(-w / 2 - 4, -h - 2, 4, h + 4).fill(0xc8b088).rect(w / 2, -h - 2, 4, h + 4).fill(0xc8b088);
    const inner = new Container(); inner.addChild(a, b); inner.x = -w / 2 + 9; inner.y = -h + 5;
    c.addChild(g, inner); c.x = x; c.y = y;
    const s0 = this.textScale || 1; c.scale.set(s0);
    this.addFx(c, f => { c.y = y - f.age * 6; c.alpha = f.age < 3.6 ? 1 : Math.max(0, (4.4 - f.age) / 0.8); return f.age < 4.4; });
    this.fx[this.fx.length - 1].bubble = true;
  }

  // ------------------------------------------------------------------ camara y navegacion
  fit() {
    if (!this.app || !this.bounds) return;
    const { x0, x1, y0, y1 } = this.bounds;
    const W = this.app.screen.width - this.insets.left - this.insets.right, H = this.app.screen.height - this.insets.top - this.insets.bottom;
    const s = Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.97;
    this.overview = { s, x: this.insets.left + W / 2 - (x0 + x1) / 2 * s, y: this.insets.top + H / 2 - (y0 + y1) / 2 * s };
    if (!this.camBase) this.camBase = { ...this.overview };
    const compact = s * 22 < (this.compact ? 10 : 7.5);
    if (compact !== !!this.compact) { this.compact = compact; this.measured.clear(); this.layoutKey = ''; if (this.state) this.layout(this.state); }
  }
  frame(x0, x1, y0, y1, maxS = 1.8) {
    const W = this.app.screen.width - this.insets.left - this.insets.right, H = this.app.screen.height - this.insets.top - this.insets.bottom;
    const s = Math.min(maxS, Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.92);
    return { s, x: this.insets.left + W / 2 - (x0 + x1) / 2 * s, y: this.insets.top + H / 2 - (y0 + y1) / 2 * s };
  }
  roomFrame(id) {
    if (id === 'tower') return this.frame(0, TOWER_W + 120, -230, this.groundY + 110);
    const R = this.rooms.get(id);
    if (!R) return null;
    return this.frame(R.x - B - 20, R.x + R.w + B + 20, R.y - B - 20, R.y + R.h + B + Math.min(R.plaqueU || 0, 160) + 20);
  }
  directorTick(dt) {
    if (!this.overview || this.manualUntil > this.t) return;
    this.shotT = (this.shotT || 0) - dt;
    const resolve = id => id === 'overview' ? this.overview : (this.roomFrame(id) || this.overview);
    if (this.urgent && this.urgent.until > this.t) { this.camTarget = resolve(this.urgent.id); return; }
    if (!this.directorOn || !this.rooms.size) { this.camTarget = this.overview; return; }
    if (this.shotT <= 0 || !this.shot) {
      const order = ['overview', ...this.rooms.keys(), 'tower'];
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
    if (kind === 'app' || kind === 'site') { const d = this.items.get(id); if (d) f = this.roomFrame(d.R.a.id); }
    else if (kind === 'session') { const h = this.hunters.get(id); if (h) f = this.roomFrame(h.R.a.id); }
    else if (kind === 'district') f = this.roomFrame(id);
    else if (kind === 'system' || kind === 'security') f = this.roomFrame('tower');
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
    const cb = this.camBase, ns = clamp(cb.s * f, 0.12, 3);
    const wx = (sx - cb.x) / cb.s, wy = (sy - cb.y) / cb.s;
    this.camBase = { s: ns, x: sx - wx * ns, y: sy - wy * ns };
  }
  zoomBy(f) { this.zoomAt(this.app.screen.width / 2, this.app.screen.height / 2, f); }
  resetView() { this.manualUntil = 0; this.shot = null; this.shotT = 0; this.camTarget = this.overview; this.navChanged(); }
  navState() { return this.manualUntil > this.t ? { mode: 'manual', left: Math.ceil(this.manualUntil - this.t) } : { mode: this.directorOn ? 'director' : 'fixed' }; }
  navChanged() { if (this.onNav) this.onNav(this.navState()); }

  tipFor(u) {
    if (u.kind === 'app' || u.kind === 'site') {
      const d = this.items.get(u.id); if (!d) return null;
      const a = d.data;
      return { title: a.name, body: `${a.kind && a.kind !== a.name ? `<b>${esc(a.kind)}</b> · ` : ''}${d.site ? 'vitral (sitio)' : 'candelabro (servicio)'} · ${esc(d.R.a.label)}`,
        meta: `${{ online: d.site ? 'iluminado' : 'velas encendidas', degraded: 'llama débil (parcial)', down: 'APAGADO (caído)' }[a.status] || a.status}${!d.site ? ` · CPU ${(a.cpu || 0).toFixed(1)}% · RAM ${fmtBytes(a.mem || 0)}` : ''} · ${a.reqMin || 0} visitas/min`, hint: 'Clic para ver el detalle' };
    }
    if (u.kind === 'session') { const h = this.hunters.get(u.id); return h && { title: 'Cazadora · agente de Claude Code', body: esc(h.s.activity || ''), meta: h.s.waitKind ? 'Con la antorcha en alto: espera su permiso' : { working: 'Recorriendo la sala', thinking: 'Pensando', idle: 'Descansando' }[h.s.state] || '', hint: 'Clic para ver la línea de tiempo' }; }
    if (u.kind === 'district') { const R = this.rooms.get(u.id); return R && { title: R.a.label, body: `Una sala del castillo con ${R.items.length} luces. Su placa, debajo, las nombra a todas.`, meta: R.caption, hint: 'Clic para ver la sala' }; }
    if (u.kind === 'system') return { title: 'Torre del reloj', body: 'El <b>servidor</b>: sus agujas giran más rápido con más CPU. Al pie, el portón: los espectros (intentos de acceso) se quedan afuera.', meta: this.state?.system ? `CPU ${this.state.system.cpu.toFixed(0)}% · RAM ${this.state.system.mem.pct.toFixed(0)}% · carga ${this.state.system.load[0].toFixed(2)}` : '', hint: 'Clic para ver el servidor completo' };
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
    // textos del mundo legibles: nunca por debajo de ~11 px en pantalla
    this.textScale = clamp(0.8 / s, 1, 3.2);
    const blink = Math.floor(t * 3) % 2 === 0;
    const cpu = this.state?.system?.cpu || 0;
    // torre: agujas del reloj, ventanas y alarma
    if (this.dyn && this.clock) {
      this.hand = (this.hand || 0) + dt * (0.15 + cpu / 40);
      const C = this.clock, g = this.dyn.clear();
      g.moveTo(C.x, C.y).lineTo(C.x + Math.cos(this.hand) * (C.r - 10), C.y + Math.sin(this.hand) * (C.r - 10)).stroke({ width: 4, color: 0x2a2233 });
      g.moveTo(C.x, C.y).lineTo(C.x + Math.cos(this.hand / 12) * (C.r - 18), C.y + Math.sin(this.hand / 12) * (C.r - 18)).stroke({ width: 5, color: 0x2a2233 });
      g.circle(C.x, C.y, 4).fill(0xb0203a);
      const bad = this.failed && this.failed.length;
      for (const w of this.towerWins) { g.rect(w.x, w.y, 14, 40).fill(bad ? (blink ? 0xff3b3b : 0x5a1010) : 0xf0b848); g.rect(w.x + 6, w.y, 2, 40).fill(0x2a1a14); }
      this.gateFlash = Math.max(0, (this.gateFlash || 0) - dt * 1.5);
      if (this.gateFlash > 0.02) g.rect(this.gate.x - 30, this.groundY - 92, 60, 92).fill({ color: 0xb0203a, alpha: this.gateFlash * 0.5 });
      this.towerTitle.text = bad ? 'ALERTA: ' + this.failed.join(', ') : 'TORRE DEL RELOJ';
      this.towerTitle.style.fill = bad ? 0xff5a5a : 0xe8dcb8;
      this.towerTitle.scale.set(this.textScale); this.towerSub.scale.set(this.textScale);
      if (this.towerHealth) { this.towerHealth.scale.set(this.textScale); this.towerHealth.y = this.towerSub.y + this.towerSub.height + 4; }
    }
    // sala enfocada (para mostrar los nombres)
    const zoomed = this.overview && s > this.overview.s * 1.45;
    let focus = null;
    if (zoomed) { let best = 1e9; const cx = (this.app.screen.width / 2 - this.camBase.x) / s, cy = (this.app.screen.height / 2 - this.camBase.y) / s; for (const R of this.rooms.values()) { const k = Math.hypot(R.x + R.w / 2 - cx, R.y + R.h / 2 - cy); if (k < best) { best = k; focus = R; } } }
    for (const d of this.items.values()) {
      const a = d.data, st = a.status;
      d.lit = Math.max(0, d.lit - dt * 1.2);
      if (d.site) {
        const on = st !== 'down', k = on ? clamp(Math.sqrt(a.reqMin || 0) / 6, 0.08, 0.6) + d.lit * 0.4 : 0;
        const wy = d.y - 20;
        d.beam.clear();
        if (k > 0) d.beam.poly([d.x - 14, wy - 10, d.x + 14, wy - 10, d.x + 34, d.y, d.x - 34, d.y]).fill({ color: 0xf8e8b0, alpha: k * 0.35 });
      } else {
        // llamas: tamano segun la CPU; parcial = azul y debil; caido = apagado con humo
        const g = d.flame.clear(), gl = d.glow.clear();
        const top = d.y - 18 - CANDELABRA.length * PX;
        if (st === 'down') {
          if (Math.random() < dt * 2) { const p = new Graphics().rect(-2, -2, 4, 4).fill({ color: 0x8a8098, alpha: 0.6 }); p.x = d.x + (Math.random() - 0.5) * 16; p.y = top - 4; this.addFx(p, (f, dd) => { p.y -= 20 * dd; p.alpha = 0.6 * (1 - f.age / 1.5); return f.age < 1.5; }); }
        } else {
          const weak = st === 'degraded';
          const hgt = weak ? 3 : 3 + Math.min(5, (a.cpu || 0) / 12) + d.lit * 2;
          for (const cxp of [2.5, 6.5, 10.5]) {
            const fx = d.x + (cxp - 6.5) * PX, fl = hgt + (Math.sin(t * 12 + cxp + d.seed) > 0 ? 1 : 0);
            g.rect(fx - 2, top - fl * PX, 4, fl * PX).fill(weak ? 0x6a9aff : 0xffb040);
            g.rect(fx - 1, top - (fl - 1) * PX, 2, (fl - 1) * PX).fill(weak ? 0xc8e0ff : 0xfff0a0);
          }
          gl.circle(d.x, top - 6, 26 + hgt * 3).fill({ color: weak ? 0x6a9aff : 0xffb040, alpha: 0.08 + d.lit * 0.08 });
        }
      }
      d.tag.visible = (zoomed && d.R === focus) || st === 'down';
      d.tag.scale.set(clamp(1 / s, 0.8, 1.8));
    }
    // nombres que no se pisan: gana el de mas abajo (el mas cercano a quien mira)
    const shown = [...this.items.values()].filter(d => d.tag.visible).sort((p, q) => q.y - p.y);
    const taken = [];
    for (const d of shown) {
      const w = d.tagBg.width * d.tag.scale.x / 2 + 3, h = d.tagBg.height * d.tag.scale.y;
      const r = { x0: d.tag.x - w, x1: d.tag.x + w, y0: d.tag.y - h, y1: d.tag.y + 2 };
      if (taken.some(o => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0) && d.data.status !== 'down') d.tag.visible = false; else taken.push(r);
    }
    // cazadoras: recorren la repisa de abajo de su sala; con la antorcha en alto si esperan
    for (const h of this.hunters.values()) {
      const R = h.R, waiting = !!h.s.waitKind;
      if (waiting) h.tx = R.x + 30 + h.slot * 30;
      else if ((h.wait -= dt) <= 0) { h.tx = R.x + 30 + Math.random() * (R.w - 60); h.wait = 3 + Math.random() * 4; }
      const dx = h.tx - h.x, step = 70 * dt, moving = Math.abs(dx) > step;
      if (moving) { h.x += Math.sign(dx) * step; h.dir = Math.sign(dx); }
      const fr = moving ? Math.floor(t * 6) % 2 : 0;
      h.spr.texture = rowsTex('hunter' + fr + h.cape + h.hair, hunterRows(fr), HPAL(h.cape, h.hair));
      h.spr.x = h.x; h.spr.y = R.walkY; h.spr.scale.x = PX * (h.dir || 1);
      h.spr.alpha = h.s.state === 'idle' ? 0.7 : 1;
      // antorcha: en la mano, o en alto si espera su permiso
      const tx = h.x + 9 * (h.dir || 1), ty = waiting ? R.walkY - 40 : R.walkY - 18;
      const g = h.torch.clear();
      g.rect(tx - 1, ty, 3, waiting ? 18 : 12).fill(0x6a4a2a);
      const fl = 3 + (Math.sin(t * 14 + h.x) > 0 ? 1 : 0);
      g.rect(tx - 3, ty - fl * 2, 7, fl * 2).fill(0xff8a2a).rect(tx - 1, ty - fl * 2 + 2, 3, fl * 2 - 2).fill(0xffe08a);
      if (waiting) { g.circle(tx + 1, ty - 8, 16).fill({ color: 0xffb040, alpha: blink ? 0.25 : 0.1 }); }
    }
    // seleccion
    if (!this.selG) { this.selG = new Graphics(); this.tags.addChild(this.selG); }
    const sel = this.selected && this.items.get(this.selected.id);
    this.selG.clear();
    if (sel) this.selG.rect(sel.x - SLOT_W / 2 + 4, sel.y - SLOT_H + 8, SLOT_W - 8, SLOT_H - 8).stroke({ width: 3, color: 0xd8b24a, alpha: 0.6 + 0.4 * Math.sin(t * 6) });
    this.placePlaques(s);
    this.navT = (this.navT || 0) + dt;
    if (this.navT > 1) { this.navT = 0; this.navChanged(); }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.age += dt;
      if (!f.tick(f, dt)) { f.obj.destroy({ children: true }); this.fx.splice(i, 1); }
    }
  }

  // placas HTML debajo de cada sala, del ancho de la sala, con letra que acompana al zoom
  placePlaques(s) {
    const fs = clamp(s * 22, 11, 17);
    const settled = this.overview && Math.abs(s - this.overview.s) < this.overview.s * 0.03 && Math.abs(this.camBase.x - this.overview.x) < 4;
    let off = false;
    for (const R of this.rooms.values()) {
      const x = this.camBase.x + (R.x + R.w / 2) * s, y = this.camBase.y + (R.y + R.h + B + 8) * s;
      R.plaque.style.transform = `translate(${x | 0}px, ${y | 0}px)`;
      R.plaque.style.minWidth = '0'; R.plaque.style.width = Math.round((R.w + 2 * B) * s) + 'px'; // del ancho de su sala: nunca pisa a la vecina
      R.plaque.style.fontSize = fs.toFixed(1) + 'px';
      R.plaque.classList.toggle('compact', !!this.compact && s < (this.overview?.s || 1) * 1.45);
      if (settled && this.refits < 4 && R.plaque.offsetHeight) { const u = R.plaque.offsetHeight / s + 14; if (u > (R.plaqueU || 0) * 1.08) { this.measured.set(R.a.id, u); off = true; } }
    }
    if (off && this.state) { this.refits++; this.layoutKey = ''; this.layout(this.state); }
  }
}
