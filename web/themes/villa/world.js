// Tema "Villa": RPG de casillas visto desde arriba, en pixel art dibujado en codigo (sin assets de terceros).
//  - el servidor es el CASTILLO; cada cuenta es un PUEBLO amurallado con su estandarte
//  - cada servicio es una casa de piedra con chimenea (humo = CPU, fuego = caido, ventanas = visitas);
//    cada sitio es una cabana de paja; el cartel de la puerta dice que es
//  - cada visita es un aldeano que camina del borde al castillo y de ahi a la casa (los robots son pajaros)
//  - cada intento de acceso es un slime que golpea la muralla del castillo; si la IP cae, un guardia lo derrota
//  - cada sesion de Claude Code es un mago en la plaza de su pueblo ("!" = espera su permiso)
// Regla de oro: nada de numeros sobre el mapa; todo se cuenta con casas, humo, fuego y gente.
import { Application, Container, Graphics, Sprite, Text, Texture, TilingSprite, Rectangle } from '../../vendor/pixi.csp.mjs';
import { signTexture } from '../../js/sprites.js';
import { esc, fmtBytes } from '../../js/hud.js';
import { accountCaption } from '../../js/accounts.js';
import { healthLine } from '../../js/layout.js';
import { pixiScreen } from '../../js/commfx.js';

const U = 16; // una casilla = 16 pixeles de arte
const FONT_T = "'Jacquard 24', 'Pixelify Sans', serif";
const FONT = "'Pixelify Sans', ui-monospace, monospace";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ------------------------------------------------------------------ pintura de texturas
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16), r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
  const m = f < 0 ? 0 : 255, t = Math.abs(f);
  const c = v => Math.round(v + (m - v) * t).toString(16).padStart(2, '0');
  return '#' + c(r) + c(g) + c(b);
}
function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  const px = (x, y, c, ww = 1, hh = 1) => { if (c) { cx.fillStyle = c; cx.fillRect(x, y, ww, hh); } };
  draw(px, cx);
  const t = Texture.from(cv); t.source.scaleMode = 'nearest';
  return t;
}
function rowsTex(rows, pal) {
  return canvasTex(Math.max(...rows.map(r => r.length)), rows.length, px => rows.forEach((r, y) => [...r].forEach((ch, x) => px(x, y, pal[ch]))));
}

const P = {
  k: '#1b1410', g: '#4a8c3f', G: '#3a7334', l: '#5fa24c', f: '#f2d24b', p: '#e87aa8', d: '#a07b4c', D: '#86653d', e: '#b8925e',
  s: '#8d929b', S: '#62676f', h: '#b3b8c0', w: '#8b5a2b', W: '#5e3b1c', y: '#a8733c', b: '#4a2f17', j: '#f5d76e', c: '#33414f',
  x: '#f4f1e8', z: '#e2b48c', n: '#3c4f8a', m: '#b53a2e', v: '#6d47b3', V: '#4b2f86', q: '#6fcf4a', Q: '#3f8f2a', a: '#c7ccd4', A: '#7d838c',
  i: '#f59e2b', I: '#fde047', t: '#2f6b2a', T: '#3f8a35', o: '#c9a04a', O: '#a88232',
};

// personajes 12x12 (dos cuadros)
const VILLAGER = [
  ['....kkkk....', '...kzzzzk...', '...kzkzkk...', '...kzzzzk...', '....kkkk....', '...kMMMMk...', '..kMMMMMMk..', '..kzMMMMzk..', '...kMMMMk...', '...knnnnk...', '...kn..nk...', '...kk..kk...'],
  ['....kkkk....', '...kzzzzk...', '...kzkzkk...', '...kzzzzk...', '....kkkk....', '...kMMMMk...', '..kMMMMMMk..', '..kzMMMMzk..', '...kMMMMk...', '...knnnnk...', '...knk.kk...', '...kk..nk...'],
];
const MAGE = [
  ['.....kk.....', '....kvvk....', '...kvvvvk...', '..kvHHHHvk..', '.kkkkkkkkkk.', '...kzzzzk.w.', '...kzkzkk.w.', '...kzzzzk.I.', '..kvvvvvvkw.', '..kvVvvVvkw.', '..kvvvvvvk..', '...kk..kk...'],
  ['.....kk.....', '....kvvk....', '...kvvvvk...', '..kvHHHHvk..', '.kkkkkkkkkk.', '...kzzzzk.I.', '...kzkzkk.w.', '...kzzzzk.w.', '..kvvvvvvkw.', '..kvVvvVvkw.', '..kvvvvvvk..', '...kk..kk...'],
];
const SLIME = [
  ['............', '............', '....kkkk....', '...kqqqqk...', '..kqqxqxqk..', '..kqqkqkqk..', '.kqqqqqqqqk.', '.kQQQQQQQQk.', '..kkkkkkkk..'],
  ['............', '............', '............', '....kkkk....', '..kkqqqqkk..', '.kqqxqqxqqk.', '.kqqkqqkqqk.', 'kQQQQQQQQQQk', '.kkkkkkkkkk.'],
];
const GUARD = [
  ['.....a......', '....kAk.....', '...kaaak.a..', '..kaAAAak.a.', '..kzkzkzk.a.', '..kzzzzzk.a.', '.kAAaaaAAka.', '.kAAaaaAAkz.', '..kAaaaAk.a.', '..knnnnnk.a.', '..kn...nk...', '..kk...kk...'],
];
const BIRD = [['........', '.kk...kk', 'kssk.kssk', '.kssskss.', '..kkkkk..', '........'], ['........', '........', '..kkkkk..', '.kssssssk', 'ks.ksk.sk', '.k..k..k.']];
const FIRE = [
  ['...I....', '..IiI...', '..IiiI..', '.IiiiI..', '.iimiiI.', 'IimmmiI.', 'imm.mmi.', '.m...m..'],
  ['....I...', '...IiI..', '..IiiI..', '..IiiiI.', '.IiimiI.', '.IimmmiI', '.imm.mmi', '..m...m.'],
];
const TREE = ['.....tttt.....', '...tttTTttt...', '..ttTTTTTTtt..', '.ttTTTtTTTTtt.', '.tTTTTTTTtTTt.', 'ttTTtTTTTTTTtt', 'tTTTTTTtTTTTTt', 'ttTTTTTTTTtTtt', '.ttTtTTTTTTtt.', '.tttTTTTtTttt.', '..tttttttttt..', '....ttWWtt....', '......WW......', '......WW......', '.....WWWW.....'];

export default class VillaWorld {
  constructor(el, { manifest } = {}) {
    this.el = el;
    this.pal = (manifest && manifest.palette) || {};
    this.houses = new Map(); this.villages = new Map(); this.mages = new Map();
    this.actors = []; this.fx = []; this.t = 0; this.layoutKey = '';
    this.directorOn = true; this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.cam = { s: 1, x: 0, y: 0 }; this.camTarget = null; this.manualUntil = 0; this.shotT = 0; this.shotIdx = 0;
    this.texCache = new Map();
  }

  // ------------------------------------------------------------------ texturas (se pintan una vez)
  tex(key, make) { if (!this.texCache.has(key)) this.texCache.set(key, make()); return this.texCache.get(key); }
  grassTex() {
    return this.tex('grass', () => canvasTex(64, 64, px => {
      const r = rng(7);
      px(0, 0, P.g, 64, 64);
      for (let i = 0; i < 64 * 64; i++) { const v = r(); if (v < 0.12) px(i % 64, i / 64 | 0, P.G); else if (v < 0.18) px(i % 64, i / 64 | 0, P.l); }
      for (let i = 0; i < 10; i++) { const x = r() * 62 | 0, y = r() * 62 | 0; px(x, y, r() < 0.5 ? P.f : P.p); px(x + 1, y + 1, P.G); }
    }));
  }
  pathTex() {
    return this.tex('path', () => canvasTex(U, U, px => {
      const r = rng(3); px(0, 0, P.d, U, U);
      for (let i = 0; i < U * U; i++) { const v = r(); if (v < 0.14) px(i % U, i / U | 0, P.D); else if (v < 0.22) px(i % U, i / U | 0, P.e); }
    }));
  }
  wallTex() {
    return this.tex('wall', () => canvasTex(U, U, px => {
      px(0, 0, P.s, U, U);
      for (let row = 0; row < 4; row++) {
        const y = row * 4, off = row % 2 ? 4 : 0;
        px(0, y + 3, P.S, U, 1);
        for (let x = off; x < U; x += 8) px(x, y, P.S, 1, 3);
        px(0, y, P.h, U, 1);
      }
      px(0, 0, P.k, U, 1); px(0, U - 1, P.k, U, 1);
    }));
  }
  houseTex(color, cottage, lit) {
    return this.tex(`h${color}${cottage}${lit}`, () => canvasTex(32, 32, px => {
      const roof = cottage ? P.o : color, roofD = cottage ? P.O : shade(color, -0.3), roofL = cottage ? '#e0bd6a' : shade(color, 0.25);
      const wall = cottage ? P.y : P.s, wallD = cottage ? P.w : P.S;
      // chimenea (solo servicios)
      if (!cottage) { px(22, 0, P.k, 6, 9); px(23, 1, P.S, 4, 8); px(23, 1, P.h, 4, 1); }
      // techo con tejas
      for (let y = 3; y <= 15; y++) {
        const inset = Math.max(0, 5 - (y - 3)); // pendiente arriba
        px(1 + inset, y, P.k, 30 - inset * 2, 1);
        px(2 + inset, y, (y - 3) % 3 === 2 ? roofD : roof, 28 - inset * 2, 1);
      }
      px(7, 3, roofL, 18, 1);
      px(1, 15, P.k, 30, 1); px(2, 14, roofD, 28, 1);
      // pared frontal
      px(2, 16, P.k, 28, 16); px(3, 16, wall, 26, 15);
      for (let y = 18; y < 31; y += 4) px(3, y, wallD, 26, 1);
      // ventanas
      for (const wx of [6, 22]) { px(wx - 1, 19, P.k, 6, 6); px(wx, 20, lit ? P.j : P.c, 4, 4); px(wx + 2, 20, P.k, 1, 4); px(wx, 22, P.k, 4, 1); }
      // puerta
      px(12, 22, P.k, 8, 10); px(13, 23, P.b, 6, 9); px(17, 27, P.j, 1, 1);
    }));
  }
  castleTex(accent) {
    return this.tex('castle' + accent, () => canvasTex(96, 96, px => {
      const wallBlock = (x, y, w, h) => {
        px(x, y, P.k, w, h); px(x + 1, y + 1, P.s, w - 2, h - 2);
        for (let yy = y + 4; yy < y + h - 1; yy += 5) { px(x + 1, yy, P.S, w - 2, 1); for (let xx = x + ((yy / 5 | 0) % 2 ? 4 : 0) + 1; xx < x + w - 1; xx += 8) px(xx, yy - 4, P.S, 1, 4); }
        px(x + 1, y + 1, P.h, w - 2, 1);
      };
      const merlons = (x, y, w) => { for (let xx = x; xx < x + w - 2; xx += 6) { px(xx, y - 4, P.k, 5, 5); px(xx + 1, y - 3, P.s, 3, 4); } };
      // muralla y torre del homenaje
      wallBlock(8, 40, 80, 50); merlons(8, 40, 80);
      wallBlock(28, 14, 40, 34); merlons(28, 14, 40);
      px(29, 2, P.k, 38, 13); for (let y = 3; y < 14; y++) px(29 + (14 - y), y, '#4b5563', 38 - (14 - y) * 2, 1);
      // torres
      for (const tx of [2, 78]) { wallBlock(tx, 30, 16, 60); px(tx, 18, P.k, 16, 13); for (let y = 19; y < 30; y++) px(tx + Math.max(0, (30 - y) / 2 | 0), y, '#4b5563', 16 - Math.max(0, (30 - y) / 2 | 0) * 2, 1); }
      // bandera
      px(86, 4, P.k, 1, 15); px(87, 5, accent, 8, 5); px(87, 5, shade(accent, 0.3), 8, 1);
      // porton
      px(38, 68, P.k, 20, 22); px(39, 69, '#1f1510', 18, 21);
      for (let x = 41; x < 57; x += 3) px(x, 69, P.A, 1, 21);
      for (let y = 72; y < 90; y += 4) px(39, y, P.A, 18, 1);
      // ventanas del homenaje
      for (const wx of [36, 58]) { px(wx, 24, P.k, 4, 7); px(wx + 1, 25, P.j, 2, 5); }
    }));
  }
  bannerTex(color) { return this.tex('ban' + color, () => canvasTex(8, 14, px => { px(0, 0, P.k, 1, 14); px(1, 1, P.k, 7, 8); px(2, 2, color, 5, 6); px(2, 2, shade(color, 0.3), 5, 1); px(3, 8, color, 3, 2); })); }
  gateTex() { return this.tex('gate', () => canvasTex(32, U, px => { px(0, 0, P.k, 6, U); px(1, 1, P.w, 4, U - 1); px(26, 0, P.k, 6, U); px(27, 1, P.w, 4, U - 1); px(0, 0, P.k, 32, 3); px(1, 1, P.y, 30, 1); })); }
  frames(rows, extra = {}) {
    const key = rows[0].join('') + JSON.stringify(extra);
    return this.tex(key, () => rows.map(r => rowsTex(r, { ...P, ...extra })));
  }

  // ------------------------------------------------------------------ montaje
  async init() {
    this.ac = new AbortController();
    const sig = { signal: this.ac.signal };
    await Promise.all([document.fonts.load(`24px ${FONT_T}`), document.fonts.load(`20px ${FONT}`)]).catch(() => { });
    this.app = new Application();
    await this.app.init({ resizeTo: this.el, background: '#2b4a26', antialias: false, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2), roundPixels: true, preference: 'webgl' });
    this.el.appendChild(this.app.canvas);
    this.world = new Container();
    this.ground = new Container(); this.roads = new Container(); this.scene = new Container(); this.scene.sortableChildren = true;
    this.fxL = new Container(); this.selG = new Graphics();
    this.world.addChild(this.ground, this.roads, this.selG, this.scene, this.fxL);
    this.screen = new Container(); // textos a tamano de pantalla (nitidos a cualquier zoom)
    this.app.stage.addChild(this.world, this.screen);
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.setupNav(sig);
    this.app.ticker.add(tk => this.tick(Math.min(tk.deltaMS / 1000, 0.1)));
    window.addEventListener('resize', () => this.fit(true), sig);
  }
  // donde esta cada cosa en la pantalla (comunicacion entre agentes); los subagentes van junto a su sesion
  screenOf(kind, id) {
    if (kind === 'session' || kind === 'agent') return pixiScreen(this.app, this.mages.get(String(id).split('/')[0]));
    return pixiScreen(this.app, this.houses.get(id));
  }

  destroy() { this.ac.abort(); this.app.destroy({ removeView: true }, { children: true }); }

  // ------------------------------------------------------------------ el mapa
  layout(state) {
    const accounts = state.accounts.filter(a => a.id !== 'root');
    const by = {};
    for (const a of state.apps) (by[a.account] = by[a.account] || []).push({ ...a, _k: 'app' });
    for (const x of state.sites || []) (by[x.account] = by[x.account] || []).push({ ...x, _k: 'site' });
    const key = accounts.map(a => a.id + ':' + a.color + ':' + (by[a.id] || []).map(x => x.id + (x.icon || '')).join(',')).join('|');
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    for (const c of [this.ground, this.roads, this.scene, this.screen]) c.removeChildren().forEach(o => o.destroy({ children: true }));
    this.houses.clear(); this.villages.clear();
    for (const m of this.mages.values()) m.dead = true;
    this.mages.clear();
    this.actors = this.actors.filter(a => { a.sprite.destroy(); return false; });

    // pueblos: casas en grilla de 3x3 casillas y una plaza abajo; muralla alrededor
    const vs = accounts.map(a => {
      const items = (by[a.id] || []).sort((x, y) => (x._k === y._k ? 0 : x._k === 'app' ? -1 : 1));
      const n = Math.max(1, items.length);
      const cols = clamp(Math.ceil(Math.sqrt(n * 1.5)), 2, 9), rows = Math.ceil(n / cols);
      const w = cols * 3 + 3, h = rows * 3 + 5;
      return { a, items, cols, rows, w, h, x: 0, y: 0 };
    }).sort((p, q) => q.items.length - p.items.length);
    // posiciones iniciales en anillo alrededor del castillo, luego se separan
    const slots = [[1, 0], [-1, 0], [0.6, -1], [-0.6, -1], [0, 1], [0.9, 0.9], [-0.9, 0.9], [0, -1.2], [1.3, -0.4], [-1.3, -0.4]];
    vs.forEach((v, i) => { const s = slots[i % slots.length], k = 1 + Math.floor(i / slots.length) * 0.6; v.x = Math.round(s[0] * (10 + v.w / 2) * k - v.w / 2); v.y = Math.round(s[1] * (9 + v.h / 2) * k - v.h / 2); });
    const castle = { x: -4, y: -4, w: 8, h: 8 };
    const overlap = (p, q, m) => p.x < q.x + q.w + m && q.x < p.x + p.w + m && p.y < q.y + q.h + m && q.y < p.y + p.h + m;
    for (let it = 0; it < 200; it++) {
      let moved = false;
      for (const v of vs) {
        for (const o of [castle, ...vs]) {
          if (o === v || !overlap(v, o, 3)) continue;
          const dx = (v.x + v.w / 2) - (o.x + o.w / 2), dy = (v.y + v.h / 2) - (o.y + o.h / 2);
          if (Math.abs(dx) * o.h >= Math.abs(dy) * o.w) v.x += Math.sign(dx || 1); else v.y += Math.sign(dy || 1);
          moved = true;
        }
      }
      if (!moved) break;
    }
    // limites del mapa
    const all = [castle, ...vs];
    const bx0 = Math.min(...all.map(v => v.x)) - 4, by0 = Math.min(...all.map(v => v.y)) - 4, bx1 = Math.max(...all.map(v => v.x + v.w)) + 4, by1 = Math.max(...all.map(v => v.y + v.h)) + 4;
    this.bounds = { x0: bx0 * U, y0: by0 * U, x1: bx1 * U, y1: by1 * U };
    const grass = new TilingSprite({ texture: this.grassTex(), width: (bx1 - bx0 + 40) * U, height: (by1 - by0 + 40) * U });
    grass.x = (bx0 - 20) * U; grass.y = (by0 - 20) * U;
    this.ground.addChild(grass);

    // castillo
    const accent = this.pal.accent || '#e0b04a';
    const cs = new Sprite(this.castleTex(accent)); cs.anchor.set(0.5, 1); cs.x = 0; cs.y = 3 * U; cs.zIndex = cs.y;
    cs.eventMode = 'static'; cs.cursor = 'pointer';
    cs.on('pointertap', () => { if (!this.dragMoved) this.pick('system', 'root'); });
    this.tipOn(cs, () => ({ title: 'Castillo', body: 'El <b>servidor</b>. Todas las visitas pasan por su portón antes de ir a cada pueblo; los slimes golpean su muralla.',
      meta: this.state?.system ? `CPU ${this.state.system.cpu.toFixed(0)}% · RAM ${this.state.system.mem.pct.toFixed(0)}% · carga ${this.state.system.load[0].toFixed(2)}` : '', hint: 'Clic para ver el servidor completo' }));
    this.scene.addChild(cs);
    this.castle = { gate: { x: 0, y: 4 * U }, cx: 0, cy: -U };
    this.castleLabel = this.label('Castillo', true);
    this.castleHealth = this.subLabel(''); // salud del servidor, bajo el nombre del castillo

    // caminos: busqueda sobre la cuadricula desde el porton del castillo hasta cada puerta, esquivando murallas
    // y prefiriendo caminos ya trazados (asi se juntan como en un mapa de verdad)
    const roadSet = new Set();
    const road = (x, y) => roadSet.add(x + ',' + y);
    for (let x = -3; x <= 3; x++) for (let y = 4; y <= 5; y++) road(x, y);
    const gx0 = bx0 - 2, gy0 = by0 - 2, GW = bx1 - bx0 + 4, GH = by1 - by0 + 4;
    const solid = new Uint8Array(GW * GH);
    const idx = (x, y) => (y - gy0) * GW + (x - gx0);
    const inside = (x, y) => x >= gx0 && y >= gy0 && x < gx0 + GW && y < gy0 + GH;
    for (const o of [castle, ...vs]) for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) if (inside(x, y)) solid[idx(x, y)] = 1;
    const findPath = (sx, sy, tx, ty) => {
      const dist = new Float32Array(GW * GH).fill(Infinity), prev = new Int32Array(GW * GH).fill(-1);
      const buckets = [[idx(sx, sy)]]; dist[idx(sx, sy)] = 0;
      for (let c = 0; c < buckets.length; c++) {
        for (const i of buckets[c] || []) {
          if (dist[i] !== c) continue;
          const x = i % GW + gx0, y = (i / GW | 0) + gy0;
          if (x === tx && y === ty) { const out = []; for (let k = i; k >= 0; k = prev[k]) out.push([k % GW + gx0, (k / GW | 0) + gy0]); return out.reverse(); }
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const nx = x + dx, ny = y + dy;
            if (!inside(nx, ny)) continue;
            const j = idx(nx, ny);
            if (solid[j] && !(nx === tx && ny === ty)) continue;
            const nc = c + (roadSet.has(nx + ',' + ny) ? 1 : 3);
            if (nc < dist[j]) { dist[j] = nc; prev[j] = i; (buckets[nc] = buckets[nc] || []).push(j); }
          }
        }
      }
      return [[sx, sy], [tx, ty]];
    };
    // camino real de entrada: del borde sur del mapa hasta el porton del castillo, esquivando pueblos
    const turns = path => path.filter(([x, y], i) => { const a = path[i - 1], b = path[i + 1]; return !a || !b || (a[0] - x) !== (x - b[0]) || (a[1] - y) !== (y - b[1]); })
      .map(([x, y]) => ({ x: x * U + U / 2, y: y * U + U / 2 }));
    const entry = findPath(0, gy0 + GH - 1, 0, 5);
    for (const [x, y] of entry) road(x, y);
    this.entryRoute = turns(entry);
    for (const v of vs) {
      // porton del lado que mira al castillo (arriba o abajo); la plaza queda de ese lado
      v.gateTop = v.y + v.h / 2 > 0;
      const gx = v.x + Math.floor(v.w / 2), gy = v.gateTop ? v.y : v.y + v.h - 1;
      v.gate = { tx: gx, ty: gy };
      const ay = v.gateTop ? gy - 1 : gy + 1; // casilla justo afuera del porton
      const path = findPath(0, 5, gx, ay);
      for (const [x, y] of path) road(x, y);
      // puntos de giro del camino (para que los aldeanos caminen por el)
      const pts = [];
      path.forEach(([x, y], i) => {
        const a = path[i - 1], b = path[i + 1];
        if (!a || !b || (a[0] - x) !== (x - b[0]) || (a[1] - y) !== (y - b[1])) pts.push({ x: x * U + U / 2, y: y * U + U / 2 });
      });
      pts.push({ x: gx * U + U / 2, y: gy * U + U / 2 });
      v.route = pts;
    }
    const pt = this.pathTex();
    for (const k of roadSet) { const [x, y] = k.split(',').map(Number); const s = new Sprite(pt); s.x = x * U; s.y = y * U; this.roads.addChild(s); }

    // pueblos
    for (const v of vs) this.buildVillage(v);
    // arboles en lo que queda de pasto
    const r = rng(42), blocked = (tx, ty) => roadSet.has(tx + ',' + ty) || all.some(o => tx >= o.x - 1 && tx <= o.x + o.w && ty >= o.y - 2 && ty <= o.y + o.h + 1);
    const trees = [];
    for (let i = 0; i < (bx1 - bx0) * (by1 - by0) / 14; i++) {
      const tx = bx0 - 6 + Math.floor(r() * (bx1 - bx0 + 12)), ty = by0 - 6 + Math.floor(r() * (by1 - by0 + 12));
      if (blocked(tx, ty) || blocked(tx + 1, ty) || trees.some(t => Math.abs(t[0] - tx) < 2 && Math.abs(t[1] - ty) < 2)) continue;
      trees.push([tx, ty]);
      const s = new Sprite(this.tex('tree', () => rowsTex(TREE, P))); s.anchor.set(0.5, 1); s.x = tx * U + U / 2; s.y = ty * U + U; s.zIndex = s.y;
      this.scene.addChild(s);
    }
    this.fit(true);
  }

  buildVillage(v) {
    const { a } = v, x0 = v.x * U, y0 = v.y * U;
    const wall = this.wallTex(), gt = v.gate;
    // muralla (con abertura de dos casillas en la puerta)
    for (let tx = v.x; tx < v.x + v.w; tx++) for (const ty of [v.y, v.y + v.h - 1]) {
      if (ty === gt.ty && (tx === gt.tx || tx === gt.tx - 1)) continue;
      const s = new Sprite(wall); s.x = tx * U; s.y = ty * U; s.zIndex = s.y + U; this.scene.addChild(s);
    }
    for (let ty = v.y + 1; ty < v.y + v.h - 1; ty++) for (const tx of [v.x, v.x + v.w - 1]) { const s = new Sprite(wall); s.x = tx * U; s.y = ty * U; s.zIndex = s.y + U; this.scene.addChild(s); }
    const gate = new Sprite(this.gateTex()); gate.x = (gt.tx - 1) * U; gate.y = gt.ty * U; gate.zIndex = gate.y + U + 1; this.scene.addChild(gate);
    for (const bx of [gt.tx - 2, gt.tx + 1]) { const b = new Sprite(this.bannerTex(a.color)); b.anchor.set(0, 1); b.x = bx * U + 4; b.y = gt.ty * U + (v.gateTop ? 0 : 2); b.zIndex = b.y + U + 2; this.scene.addChild(b); }
    // plaza del lado del porton; casas en el resto
    const plazaTy = v.gateTop ? v.y + 1 : v.y + v.h - 4;
    const plaza = new Graphics().rect(x0 + U, plazaTy * U, (v.w - 2) * U, 3 * U).fill({ color: 0xb8925e, alpha: 0.55 });
    this.roads.addChild(plaza);
    const hit = new Container(); hit.eventMode = 'static'; hit.cursor = 'pointer'; hit.hitArea = new Rectangle(x0, plazaTy * U, v.w * U, 3 * U);
    hit.on('pointertap', () => { if (!this.dragMoved) this.pick('district', a.id); });
    this.tipOn(hit, () => ({ title: a.label, body: `Pueblo con ${v.items.length} casas: de piedra con chimenea los servicios, de paja los sitios.`, meta: v.sub ? v.sub.text : '', hint: 'Clic para ver el pueblo' }));
    this.roads.addChild(hit);
    const houseTy = v.gateTop ? v.y + 4 : v.y + 1;
    v.items.forEach((it, i) => {
      const cx = v.x + 2 + (i % v.cols) * 3, cy = houseTy + Math.floor(i / v.cols) * 3;
      this.addHouse(it, cx * U + U, cy * U + 2 * U + 4, a);
    });
    v.plaza = { x: x0 + 2 * U, y: (plazaTy + 1) * U + 4, w: (v.w - 4) * U, h: U };
    v.label = this.label(a.label, false);
    const nA = v.items.filter(x => x._k === 'app').length;
    v.sub = this.subLabel(accountCaption(a, nA, v.items.length - nA));
    v.labelPos = { x: x0 + v.w * U / 2, y: y0 - 6 };
    this.villages.set(a.id, v);
  }

  addHouse(it, x, y, acc) {
    const cottage = it._k === 'site';
    const s = new Sprite(this.houseTex(acc.color, cottage, false));
    s.anchor.set(0.5, 1); s.x = x; s.y = y; s.zIndex = y;
    const sign = new Sprite(signTexture(it.icon || 'web')); sign.anchor.set(0.5, 1); sign.x = x + 13; sign.y = y - 1; sign.zIndex = y + 1;
    s.eventMode = 'static'; s.cursor = 'pointer';
    const h = { s, sign, data: it, kind: it._k, acc, x, y, cottage, lit: false, smokeT: Math.random() * 2, fire: null };
    s.on('pointertap', () => { if (!this.dragMoved) this.pick(h.kind, it.id); });
    this.tipOn(s, () => {
      const a = h.data;
      const st = { online: 'en pie', degraded: 'a medias', down: 'EN LLAMAS (caído)' }[a.status] || a.status;
      return { title: a.name, body: `${a.kind && a.kind !== a.name ? `<b>${esc(a.kind)}</b> · ` : ''}${cottage ? 'cabaña (sitio)' : 'casa (servicio)'} de ${esc(acc.label)}`,
        meta: `${st}${!cottage ? ` · CPU ${(a.cpu || 0).toFixed(1)}% · RAM ${fmtBytes(a.mem || 0)}` : ''} · ${a.reqMin || 0} visitas/min`, hint: 'Clic para ver el detalle' };
    });
    this.scene.addChild(s, sign);
    this.houses.set(it.id, h);
  }

  subLabel(text) {
    const t = new Text({ text, style: { fontFamily: FONT, fontSize: 17, fill: '#e6d3a6', stroke: { color: '#2a1a0c', width: 4 }, fontWeight: '600' } });
    t.anchor.set(0.5, 1); this.screen.addChild(t);
    return t;
  }

  label(text, big) {
    const t = new Text({ text, style: { fontFamily: FONT_T, fontSize: big ? 34 : 28, fill: '#f4e7c5', stroke: { color: '#2a1a0c', width: 5 }, letterSpacing: 1 } });
    t.anchor.set(0.5, 1);
    this.screen.addChild(t);
    return t;
  }

  // ------------------------------------------------------------------ estado
  update(state) {
    this.state = state;
    this.layout(state);
    const hl = healthLine(state);
    if (hl && this.castleHealth && this.castleHealth.text !== hl.text) { this.castleHealth.text = hl.text; this.castleHealth.style.fill = hl.color; }
    for (const x of [...state.apps, ...(state.sites || [])]) {
      const h = this.houses.get(x.id);
      if (!h) continue;
      const prev = h.data.status;
      h.data = { ...x, _k: h.kind };
      const lit = (x.reqMin || 0) > 0;
      if (lit !== h.lit) { h.lit = lit; h.s.texture = this.houseTex(h.acc.color, h.cottage, lit); }
      if (x.status === 'down' && !h.fire) {
        h.fire = new Sprite(this.frames(FIRE)[0]); h.fire.anchor.set(0.5, 1); h.fire.x = h.x - 4; h.fire.y = h.y - 18; h.fire.zIndex = h.y + 2; h.fire.scale.set(1.4);
        this.scene.addChild(h.fire);
        if (prev && prev !== 'down') this.floatText(h.x, h.y - 40, '¡Se incendió!', '#ff7a45');
      } else if (x.status !== 'down' && h.fire) { h.fire.destroy(); h.fire = null; }
    }
    this.failed = (state.keys || []).filter(k => k.state === 'failed').map(k => k.label);
    this.syncMages(state.sessions || []);
  }

  syncMages(sessions) {
    const seen = new Set(), per = {};
    for (const s of sessions) {
      seen.add(s.id);
      let m = this.mages.get(s.id);
      const v = this.villages.get(s.account) || null;
      if (!m) {
        const acc = this.state.accounts.find(a => a.id === s.account);
        const fr = this.frames(MAGE, { H: acc ? acc.color : '#e0b04a' });
        const sp = new Sprite(fr[0]); sp.anchor.set(0.5, 1); sp.eventMode = 'static'; sp.cursor = 'pointer'; sp.scale.set(1.2);
        const bub = new Graphics().rect(-5, -12, 10, 11).fill(0xfff3c4).stroke({ width: 1, color: 0x1b1410 }).rect(-1, -10, 2, 5).fill(0xb53a2e).rect(-1, -4, 2, 2).fill(0xb53a2e);
        bub.visible = false;
        sp.on('pointertap', () => { if (!this.dragMoved) this.pick('session', s.id); });
        this.tipOn(sp, () => ({ title: 'Mago · agente de Claude Code', body: `${esc(m.s.activity || '')}${m.s.subagents && m.s.subagents.length ? ` · ${m.s.subagents.length} aprendiz(es)` : ''}`,
          meta: m.s.waitKind ? 'Espera su permiso o su respuesta' : { working: 'Trabajando', thinking: 'Pensando', idle: 'En pausa' }[m.s.state] || '', hint: 'Clic para ver la línea de tiempo' }));
        this.scene.addChild(sp); this.fxL.addChild(bub);
        m = { sp, bub, fr, s, x: 0, y: 0, tx: 0, ty: 0, wait: 0, apprentices: [] };
        this.mages.set(s.id, m);
        const home = this.magePoint(v, 0);
        m.x = m.tx = home.x; m.y = m.ty = home.y;
      }
      m.s = s; m.v = v;
      per[s.account] = (per[s.account] || 0) + 1;
      m.slot = per[s.account] - 1;
      // aprendices = subagentes
      const want = Math.min(4, (s.subagents || []).length);
      while (m.apprentices.length < want) { const a = new Sprite(this.frames(VILLAGER, { M: '#6d47b3' })[0]); a.anchor.set(0.5, 1); a.scale.set(0.8); this.scene.addChild(a); m.apprentices.push(a); }
      while (m.apprentices.length > want) m.apprentices.pop().destroy();
    }
    for (const [id, m] of this.mages) if (!seen.has(id)) { m.sp.destroy(); m.bub.destroy(); m.apprentices.forEach(a => a.destroy()); this.mages.delete(id); }
  }
  magePoint(v, slot) {
    if (!v) return { x: 60 + slot * 24, y: 5 * U + 8 };
    return { x: v.plaza.x + 20 + ((slot * 53) % Math.max(20, v.plaza.w - 40)), y: v.plaza.y + 10 };
  }

  // ------------------------------------------------------------------ eventos
  onEvent(e, priv) {
    switch (e.kind) {
      case 'http': return this.visitor(e);
      case 'attack': return this.slime(false);
      case 'block': return this.slime(true, priv ? e.ip : null);
      case 'login': return this.floatText(0, -4 * U, priv && e.user ? `Entró ${e.user}` : 'Entró un administrador', '#bff5a0');
      case 'mail': return this.pigeon(e.dir);
      case 'deploy': {
        const h = this.houses.get(e.app);
        if (!h) return;
        const T = { building: ['Construyendo…', '#f5d76e'], ready: ['¡Obra terminada!', '#bff5a0'], error: ['La obra falló', '#ff7a45'], canceled: ['Obra cancelada', '#c7ccd4'] }[e.action];
        if (T) { this.floatText(h.x, h.y - 44, T[0], T[1]); if (e.action === 'ready') this.sparkle(h.x, h.y - 30); if (e.action === 'error') this.puff(h.x, h.y - 20, 0x3b3b3b, 6); }
        return;
      }
      case 'pm2': { const h = this.houses.get(e.app); if (h) { this.floatText(h.x, h.y - 44, e.action === 'down' ? '¡Se cayó!' : 'Se reinició', e.action === 'down' ? '#ff7a45' : '#f5d76e'); this.puff(h.x, h.y - 20, 0x9aa0a8, 5); } return; }
      case 'domain': {
        const v = this.villages.get(e.account);
        if (v) this.floatText(v.labelPos.x, v.labelPos.y + 40, { added: 'Nuevo dominio', removed: 'Dominio eliminado', changed: 'Un sitio cambió' }[e.action] + (priv && e.domain ? `: ${e.domain}` : ''), e.action === 'removed' ? '#ff7a45' : '#bff5a0');
        return;
      }
      case 'claude': {
        const m = this.mages.get(e.sid) || [...this.mages.entries()].find(([k]) => e.sid && k.startsWith(e.sid))?.[1];
        if (!m) return;
        if (e.action === 'permission') { this.urgent = { x: m.x, y: m.y, until: this.t + 12 }; this.floatText(m.x, m.y - 40, 'Pide su permiso', '#f5d76e'); }
        else if (e.action === 'done') { this.sparkle(m.x, m.y - 20); this.floatText(m.x, m.y - 40, '¡Hechizo listo!', '#bff5a0'); }
        else if (e.action === 'error') this.puff(m.x, m.y - 14, 0xb53a2e, 4);
        else if (e.action === 'tool') this.sparkle(m.x + 6, m.y - 18, 1);
        return;
      }
    }
  }

  // aldeano: del borde sur al porton del castillo, por el camino a la puerta del pueblo y a la casa
  visitor(e) {
    if (this.actors.length > 140) return;
    const h = this.houses.get(e.app || e.site);
    const v = h ? this.villages.get(h.acc.id) : this.villages.get(e.account);
    const b = this.bounds || { x0: -400, x1: 400, y1: 400 };
    // por el camino de entrada (con un poco de desorden para que no caminen en fila india)
    const j = () => (Math.random() - 0.5) * 6;
    const entry = (this.entryRoute || [{ x: 0, y: b.y1 + U }]).map(p => ({ x: p.x + j(), y: p.y + j() }));
    const start = entry[0];
    const pts = [...entry, { ...this.castle.gate }];
    if (v) pts.push(...v.route.slice(1));
    if (h) pts.push({ x: h.x, y: h.y + 6 }, { x: h.x, y: h.y - 2 });
    const bot = !!e.bot, err = e.status >= 500;
    const shirts = ['#b53a2e', '#3c7ab5', '#c98a2b', '#4f8a3a', '#8a4fb5', '#c2c2c2'];
    const fr = bot ? this.frames(BIRD) : this.frames(VILLAGER, { M: err ? '#ff4d3d' : shirts[Math.random() * shirts.length | 0] });
    const sp = new Sprite(fr[0]); sp.anchor.set(0.5, 1);
    sp.x = start.x; sp.y = start.y;
    this.scene.addChild(sp);
    this.actors.push({ sprite: sp, fr, pts, seg: 0, speed: bot ? 150 : 70 + Math.random() * 30, bot, err, h });
  }

  // slime: viene desde un borde y golpea la muralla del castillo
  slime(blocked, ip) {
    const b = this.bounds || { x0: -500, x1: 500, y0: -500, y1: 500 };
    const side = Math.random() * 4 | 0;
    const start = side === 0 ? { x: b.x0 - U, y: b.y0 + Math.random() * (b.y1 - b.y0) } : side === 1 ? { x: b.x1 + U, y: b.y0 + Math.random() * (b.y1 - b.y0) }
      : side === 2 ? { x: b.x0 + Math.random() * (b.x1 - b.x0), y: b.y0 - U } : { x: b.x0 + Math.random() * (b.x1 - b.x0), y: b.y1 + U };
    const ang = Math.atan2(start.y - this.castle.cy, start.x - this.castle.cx);
    const hit = { x: this.castle.cx + Math.cos(ang) * 60, y: this.castle.cy + Math.sin(ang) * 48 };
    const fr = this.frames(SLIME);
    const sp = new Sprite(fr[0]); sp.anchor.set(0.5, 1); sp.scale.set(1.5); sp.x = start.x; sp.y = start.y;
    this.scene.addChild(sp);
    this.actors.push({ sprite: sp, fr, pts: [start, hit], seg: 0, speed: 55, slime: true, blocked, ip, hits: 0 });
  }

  pigeon(dir) {
    const b = this.bounds || { x1: 500, y0: -500 };
    const fr = this.frames(BIRD, dir === 'bounce' ? { s: '#ff7a45' } : {});
    const from = { x: this.castle.cx, y: this.castle.cy - 40 }, to = { x: b.x1 + 2 * U, y: b.y0 - 2 * U };
    const pts = dir === 'in' ? [to, from] : [from, to];
    const sp = new Sprite(fr[0]); sp.anchor.set(0.5, 1); sp.x = pts[0].x; sp.y = pts[0].y; sp.zIndex = 99999;
    this.fxL.addChild(sp);
    this.actors.push({ sprite: sp, fr, pts, seg: 0, speed: 180, bot: true, fly: true });
  }

  addFx(obj, tick, layer = this.fxL) { layer.addChild(obj); this.fx.push({ obj, tick, age: 0 }); }
  puff(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const g = new Graphics().rect(-2, -2, 4, 4).fill(color);
      g.x = x + (Math.random() - 0.5) * 12; g.y = y; const vx = (Math.random() - 0.5) * 14, vy = -18 - Math.random() * 14;
      this.addFx(g, (f, dt) => { g.x += vx * dt; g.y += vy * dt; g.alpha = 1 - f.age / 1.4; g.scale.set(1 + f.age); return f.age < 1.4; });
    }
  }
  sparkle(x, y, n = 6) {
    for (let i = 0; i < n; i++) {
      const g = new Graphics().rect(-1, -1, 2, 2).fill(0xfde047);
      const a = Math.random() * Math.PI * 2, sp = 20 + Math.random() * 30;
      g.x = x; g.y = y;
      this.addFx(g, (f, dt) => { g.x += Math.cos(a) * sp * dt; g.y += Math.sin(a) * sp * dt - 10 * dt; g.alpha = 1 - f.age; return f.age < 1; });
    }
  }
  floatText(x, y, text, color) {
    const t = new Text({ text, style: { fontFamily: FONT, fontSize: 22, fill: color, stroke: { color: '#1b1410', width: 5 }, fontWeight: '700' } });
    t.anchor.set(0.5, 1);
    this.screen.addChild(t);
    this.fx.push({ obj: t, age: 0, world: { x, y }, tick: f => { f.world.y -= 0.25; t.alpha = f.age < 2.2 ? 1 : 1 - (f.age - 2.2) / 0.8; return f.age < 3; } });
  }

  // ------------------------------------------------------------------ cuadro a cuadro
  tick(dt) {
    this.t += dt;
    const frame = Math.floor(this.t * 5) % 2;
    // actores que caminan
    for (let i = this.actors.length - 1; i >= 0; i--) {
      const a = this.actors[i], sp = a.sprite;
      const to = a.pts[a.seg + 1];
      if (!to) {
        if (a.slime) {
          if (a.hits < 3) { a.hits++; this.wallFlash = 1; this.puff(sp.x, sp.y - 8, 0x6fcf4a, 2); a.pts = [{ x: sp.x, y: sp.y }, { x: sp.x - Math.sign(sp.x - this.castle.cx || 1) * -10, y: sp.y + 6 }, { x: sp.x, y: sp.y }]; a.seg = 0; continue; }
          if (a.blocked) { this.guard(sp.x, sp.y); this.floatText(sp.x, sp.y - 30, a.ip ? `¡Derrotado! ${a.ip}` : '¡Derrotado!', '#bff5a0'); }
          this.puff(sp.x, sp.y - 6, 0x6fcf4a, 6);
        } else if (a.h) { a.h.flash = 1; if (a.err) this.puff(sp.x, sp.y - 10, 0xff4d3d, 5); }
        sp.destroy(); this.actors.splice(i, 1); continue;
      }
      const dx = to.x - sp.x, dy = to.y - sp.y, d = Math.hypot(dx, dy), st = a.speed * dt;
      if (d <= st) { sp.x = to.x; sp.y = to.y; a.seg++; }
      else { sp.x += dx / d * st; sp.y += dy / d * st; if (Math.abs(dx) > 0.5) sp.scale.x = Math.abs(sp.scale.x) * (dx < 0 ? -1 : 1); }
      sp.texture = a.fr[(a.slime ? Math.floor(this.t * 3) : frame) % a.fr.length];
      if (!a.fly) sp.zIndex = sp.y;
    }
    // casas: humo segun CPU, destello al recibir visitas, fuego si cayo
    for (const h of this.houses.values()) {
      if (!h.cottage) {
        const cpu = h.data.cpu || 0;
        h.smokeT -= dt * (0.4 + Math.min(cpu, 100) / 25);
        if (h.smokeT <= 0 && h.data.status !== 'down') { h.smokeT = 1; this.puff(h.x + 9, h.y - 32, cpu > 50 ? 0x5b5b5b : 0xc9ccd1, 1); }
      }
      if (h.flash) { h.flash = Math.max(0, h.flash - dt * 2); h.s.tint = h.flash > 0.1 ? 0xfff6c8 : 0xffffff; }
      if (h.fire) { h.fire.texture = this.frames(FIRE)[frame]; if (Math.random() < dt * 3) this.puff(h.x - 4, h.y - 34, 0x3b3b3b, 1); }
      h.s.alpha = h.data.status === 'degraded' ? 0.8 + Math.sin(this.t * 4) * 0.2 : 1;
    }
    // magos: pasean por la plaza; quietos con "!" si esperan
    for (const m of this.mages.values()) {
      const waiting = !!m.s.waitKind;
      m.wait -= dt;
      if (!waiting && m.wait <= 0) { const p = this.magePoint(m.v, m.slot); m.tx = p.x + (Math.random() - 0.5) * 40; m.ty = p.y + (Math.random() - 0.5) * 8; m.wait = 3 + Math.random() * 4; }
      const dx = m.tx - m.x, dy = m.ty - m.y, d = Math.hypot(dx, dy), st = 18 * dt;
      if (!waiting && d > st) { m.x += dx / d * st; m.y += dy / d * st; m.sp.scale.x = 1.2 * (dx < 0 ? -1 : 1); }
      m.sp.x = m.x; m.sp.y = m.y; m.sp.zIndex = m.y;
      m.sp.texture = m.fr[(m.s.state === 'working' ? Math.floor(this.t * 3) : frame) % 2];
      m.sp.alpha = m.s.state === 'idle' ? 0.75 : 1;
      m.bub.visible = waiting && Math.floor(this.t * 2.5) % 2 === 0;
      m.bub.x = m.x; m.bub.y = m.y - 22;
      m.apprentices.forEach((a, i) => { a.x = m.x + (i % 2 ? 1 : -1) * (14 + (i >> 1) * 10); a.y = m.y + 2; a.zIndex = a.y; a.texture = this.frames(VILLAGER, { M: '#6d47b3' })[frame]; });
      if (m.s.state === 'working' && Math.random() < dt * 0.8) this.sparkle(m.x + 6, m.y - 18, 1);
    }
    // efectos
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.age += dt;
      if (!f.tick(f, dt)) { f.obj.destroy(); this.fx.splice(i, 1); }
    }
    this.drawSelection();
    this.director(dt);
    if (this.camTarget) {
      const k = 1 - Math.pow(0.02, dt);
      this.cam.s += (this.camTarget.s - this.cam.s) * k; this.cam.x += (this.camTarget.x - this.cam.x) * k; this.cam.y += (this.camTarget.y - this.cam.y) * k;
    }
    const W = this.app.screen.width, H = this.app.screen.height;
    this.world.scale.set(this.cam.s);
    this.world.x = Math.round(W / 2 + this.cam.x); this.world.y = Math.round(H / 2 + this.cam.y);
    // textos en pantalla: siguen su punto del mundo
    const toScreen = p => ({ x: this.world.x + p.x * this.cam.s, y: this.world.y + p.y * this.cam.s });
    if (this.castleLabel) { const p = toScreen({ x: 0, y: -4.4 * U }); this.castleLabel.x = p.x; this.castleLabel.y = p.y; }
    // en pantallas chicas los textos se achican con el area del mundo (no se enciman)
    const ts = clamp(Math.min((W - this.insets.left - this.insets.right) / 900, (H - this.insets.top - this.insets.bottom) / 560), 0.5, 1);
    if (this.castleLabel) this.castleLabel.scale.set(ts);
    if (this.castleHealth && this.castleLabel) { this.castleHealth.scale.set(ts); this.castleHealth.x = this.castleLabel.x; this.castleHealth.y = this.castleLabel.y + 22 * ts; }
    for (const v of this.villages.values()) { const p = toScreen(v.labelPos); v.label.scale.set(ts); v.sub.scale.set(ts); v.label.x = p.x; v.label.y = p.y - 20 * ts; v.sub.x = p.x; v.sub.y = p.y; }
    for (const f of this.fx) if (f.world) { const p = toScreen(f.world); f.obj.x = p.x; f.obj.y = p.y; }
    if (this.manualUntil && this.manualUntil < this.t) { this.manualUntil = 0; this.camTarget = this.overview; this.navChanged(); }
    else if (this.manualUntil && Math.floor(this.t) !== this.lastNav) { this.lastNav = Math.floor(this.t); this.navChanged(); }
  }

  guard(x, y) {
    const sp = new Sprite(this.frames(GUARD)[0]); sp.anchor.set(0.5, 1); sp.scale.set(1.4); sp.x = x + 14; sp.y = y; sp.zIndex = y;
    this.scene.addChild(sp);
    this.fx.push({ obj: sp, age: 0, tick: f => { sp.alpha = f.age < 1.6 ? 1 : 1 - (f.age - 1.6) / 0.6; return f.age < 2.2; } });
  }

  drawSelection() {
    const g = this.selG; g.clear();
    const s = this.selected;
    if (!s) return;
    let r = null;
    if (s.kind === 'app' || s.kind === 'site') { const h = this.houses.get(s.id); if (h) r = { x: h.x - 20, y: h.y - 36, w: 40, h: 42 }; }
    else if (s.kind === 'session') { const m = this.mages.get(s.id); if (m) r = { x: m.x - 12, y: m.y - 24, w: 24, h: 28 }; }
    if (!r) return;
    const k = Math.floor(this.t * 4) % 2 ? 2 : 0;
    g.rect(r.x - k, r.y - k, r.w + k * 2, r.h + k * 2).stroke({ width: 2, color: 0xfde047 });
  }

  // ------------------------------------------------------------------ camara y navegacion
  setInsets(ins) { this.insets = ins; this.fit(true); }
  fit(snap) {
    if (!this.app || !this.bounds) return;
    const W = this.app.screen.width, H = this.app.screen.height, i = this.insets, b = this.bounds;
    const aw = Math.max(200, W - i.left - i.right), ah = Math.max(200, H - i.top - i.bottom);
    let s = Math.min(aw / (b.x1 - b.x0), ah / (b.y1 - b.y0));
    if (s >= 2) s = Math.floor(s); // escala entera: pixeles parejos
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
    this.overview = { s, x: (i.left - i.right) / 2 - cx * s, y: (i.top - i.bottom) / 2 - cy * s };
    if (!this.manualUntil) { this.camTarget = this.overview; if (snap) Object.assign(this.cam, this.overview); }
  }
  frameOn(x, y, s) { const i = this.insets; return { s, x: (i.left - i.right) / 2 - x * s, y: (i.top - i.bottom) / 2 - y * s }; }
  director(dt) {
    if (this.manualUntil || !this.overview) return;
    if (this.urgent && this.urgent.until > this.t) { this.camTarget = this.frameOn(this.urgent.x, this.urgent.y, Math.max(3, this.overview.s * 2.5)); return; }
    this.urgent = null;
    if (!this.directorOn) { this.camTarget = this.overview; return; }
    this.shotT -= dt;
    if (this.shotT > 0) return;
    const vs = [...this.villages.values()];
    this.shotIdx = (this.shotIdx + 1) % (vs.length * 2 || 1);
    if (this.shotIdx % 2 === 0 || !vs.length) { this.camTarget = this.overview; this.shotT = 10; return; }
    const v = vs[Math.floor(this.shotIdx / 2) % vs.length];
    const W = this.app.screen.width - this.insets.left - this.insets.right, H = this.app.screen.height - this.insets.top - this.insets.bottom;
    const s = Math.max(this.overview.s, Math.floor(Math.min(W / ((v.w + 4) * U), H / ((v.h + 6) * U))) || this.overview.s);
    this.camTarget = this.frameOn((v.x + v.w / 2) * U, (v.y + v.h / 2) * U, s); this.shotT = 12;
  }
  setDirector(on) { this.directorOn = on; this.shotT = 0; }
  navState() { return this.manualUntil ? { mode: 'manual', left: Math.max(0, Math.ceil(this.manualUntil - this.t)) } : { mode: this.directorOn ? 'director' : 'fixed' }; }
  navChanged() { if (this.onNav) this.onNav(this.navState()); }
  manual() { this.manualUntil = this.t + 90; this.navChanged(); }
  resetView() { this.manualUntil = 0; this.camTarget = this.overview; this.shotT = 10; this.navChanged(); }
  zoomBy(f) {
    this.manual();
    const c = this.camTarget || this.cam, W = this.app.screen.width / 2, H = this.app.screen.height / 2;
    const ns = clamp(c.s * f, this.overview.s * 0.7, 8);
    // zoom respecto del centro de la pantalla
    this.camTarget = { s: ns, x: c.x * ns / c.s, y: c.y * ns / c.s };
    void W; void H;
  }
  pick(kind, id) {
    this.selected = { kind, id };
    let p = null;
    if (kind === 'app' || kind === 'site') { const h = this.houses.get(id); if (h) p = { x: h.x, y: h.y - 16, s: 4 }; }
    else if (kind === 'session') { const m = this.mages.get(id); if (m) p = { x: m.x, y: m.y - 10, s: 4 }; }
    else if (kind === 'district') { const v = this.villages.get(id); if (v) p = { x: (v.x + v.w / 2) * U, y: (v.y + v.h / 2) * U, s: 3 }; }
    else if (kind === 'system' || kind === 'security') p = { x: 0, y: -U, s: 3 };
    if (p) { this.manual(); this.camTarget = this.frameOn(p.x, p.y, Math.max(p.s, this.overview ? this.overview.s : 1)); }
    if (this.onSelect) this.onSelect(kind, id);
  }
  clearSelection() { this.selected = null; }
  tipOn(obj, fn) {
    obj.on('pointerover', e => { if (this.onTip && !this.dragMoved) this.onTip(fn(), e.client.x, e.client.y); });
    obj.on('pointerout', () => this.onTip && this.onTip(null));
  }
  setupNav(sig) {
    const cv = this.app.canvas;
    let start = null, last = null;
    cv.style.touchAction = 'none';
    window.addEventListener('pointerdown', e => { if (e.target !== cv) return; start = last = { x: e.clientX, y: e.clientY }; this.dragMoved = false; }, { capture: true, signal: sig.signal });
    window.addEventListener('pointermove', e => {
      if (!start) return;
      if (!this.dragMoved && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) this.dragMoved = true;
      if (this.dragMoved) {
        if (!this.manualUntil) this.manual(); else this.manualUntil = this.t + 90;
        const c = this.camTarget || this.cam;
        this.camTarget = { ...c, x: c.x + (e.clientX - last.x), y: c.y + (e.clientY - last.y) };
        Object.assign(this.cam, this.camTarget);
        if (this.onTip) this.onTip(null);
      }
      last = { x: e.clientX, y: e.clientY };
    }, sig);
    window.addEventListener('pointerup', () => { start = null; }, sig);
    cv.addEventListener('wheel', e => { e.preventDefault(); this.zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false, signal: sig.signal });
    cv.addEventListener('dblclick', () => this.resetView(), sig);
  }
}
