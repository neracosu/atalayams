// Tema "Villa": RPG de casillas visto desde arriba, en pixel art dibujado en codigo (sin assets de terceros).
//  - el servidor es el CASTILLO; cada cuenta es un PUEBLO amurallado con su estandarte
//  - cada servicio es una casa de piedra con chimenea (humo = CPU, fuego = caido, ventanas = visitas);
//    cada sitio es una cabana de paja; el cartel de la puerta dice que es
//  - cada visita es un aldeano que camina del borde al castillo y de ahi a la casa (los robots son pajaros)
//  - cada intento de acceso es un slime que golpea la muralla del castillo; si la IP cae, un guardia lo derrota
//  - cada sesion de Claude Code es un mago en la plaza de su pueblo ("!" = espera su permiso)
//  - junto al castillo, el CALABOZO (IPs bloqueadas: bandidos tras las rejas; toneles sellados = archivos en
//    cuarentena) y el PALOMAR (el correo: palomas que salen, llegan o vuelven heridas); en cada pueblo con bases,
//    su GRANERO, con acequias hacia las casas que las usan; si el servidor llega al limite, el castillo queda asediado
// Regla de oro: nada de numeros sobre el mapa; todo se cuenta con casas, humo, fuego y gente.
import { Application, Container, Graphics, Sprite, Text, Texture, TilingSprite, Rectangle } from '../../vendor/pixi.csp.mjs';
import { signTexture } from '../../js/sprites.js';
import { esc, fmtBytes } from '../../js/hud.js';
import { accountCaption, forEdition } from '../../js/accounts.js';
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
const PRISONER = [
  ['....kkkk....', '...kzzzzk...', '...kzkzkk...', '...kzzzzk...', '....kkkk....', '...kxkxkk...', '..kxkxkxkk..', '..kzxkxkzk..', '...kxkxkk...', '...kkkkkk...', '...kk..kk...', '...kk..kk...'],
  ['....kkkk....', '...kzzzzk...', '...kzkzkk...', '...kzzzzk...', '....kkkk....', '...kxkxkk...', '..kxkxkxkk..', '..kzxkxkzk..', '...kxkxkk...', '...kkkkkk...', '...kk..kk...', '..kk....kk..'],
];
// tonel sellado con cadenas: un archivo en cuarentena (madera y hierro, como pide el tema)
const BARREL = ['..kkkkkk..', '.kWwwwwWk.', 'kAAAAAAAAk', 'kwWwwwwWwk', 'kwwmwwmwwk', 'kwwwmmwwwk', 'kwwmwwmwwk', 'kwWwwwwWwk', 'kAAAAAAAAk', '.kWwwwwWk.', '..kkkkkk..'];
const WELL = ['....kkkkkkkk....', '...kwwwwwwwwk...', '...kW......Wk...', '...kW......Wk...', '..kkkkkkkkkkkk..', '.khhhhhhhhhhhhk.', 'kSccccccccccccSk', 'kSccccccccccccSk', 'khSSSSSSSSSSSShk', 'khhhhhhhhhhhhhhk', 'kSShhSShhSShhSSk', '.kkkkkkkkkkkkkk.'];
const ROCK = ['...kkkk...', '.kkhhhhk..', 'khhssshhk.', 'khsssssShk', 'kSsssSSSSk', '.kkkkkkkk.'];
const BUSH = ['...kkkk...', '.kkTtTtkk.', 'kTtpTtTptk', 'ktTtTTtTtk', 'kTtTpTtTTk', '.kkkkkkkk.'];
const DUCK = [['..kk....', '.kxxk...', '.kxkxii.', '..kxxk..', 'kkxxxxk.', 'kxxxxxxk', '.kkkkkk.'], ['..kk....', '.kxxk...', '.kxkxii.', '..kxxk..', '.kxxxxk.', 'kxxxxxxk', '.kkkkkk.']];
const TORCH = ['kk', 'ww', 'ww', 'WW', 'WW', 'WW', 'WW', 'kk'];
const LETTER = ['kkkkkkkk', 'kxxxxxxk', 'kxkxxkxk', 'kxxkkxxk', 'kxxxxxxk', 'kkkkkkkk'];
const ZZZ = ['kkk', '..k', '.k.', 'kkk'];
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
    this.post = null; this.jail = null; this.mailLog = []; this.jamQ = 0;
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
  // calabozo: torreon de piedra con ventana enrejada y una puerta de hierro
  jailTex() {
    return this.tex('jail', () => canvasTex(40, 52, px => {
      px(2, 10, P.k, 36, 42); px(3, 11, P.S, 34, 40);
      for (let y = 14; y < 50; y += 5) { px(3, y, '#4d5259', 34, 1); for (let x = 3 + ((y / 5 | 0) % 2 ? 4 : 0); x < 37; x += 8) px(x, y - 4, '#4d5259', 1, 4); }
      for (let x = 2; x < 38; x += 6) { px(x, 4, P.k, 5, 7); px(x + 1, 5, P.S, 3, 6); }
      px(3, 11, P.A, 34, 1);
      px(13, 18, P.k, 14, 12); px(14, 19, '#140d0a', 12, 10); for (let x = 15; x < 26; x += 3) px(x, 19, P.a, 1, 10); px(14, 24, P.a, 12, 1);
      px(14, 36, P.k, 12, 16); px(15, 37, '#3a3f47', 10, 15); for (let y = 39; y < 51; y += 4) px(15, y, P.A, 10, 1); px(23, 44, P.j, 1, 2);
    }));
  }
  // palomar: torre redonda de piedra con nidos y techo conico, con palomas posadas
  postTex() {
    return this.tex('post', () => canvasTex(32, 60, px => {
      for (let y = 2; y < 16; y++) { const w = Math.min(30, 4 + (y - 2) * 2); px(16 - w / 2, y, P.k, w, 1); if (w > 2) px(16 - w / 2 + 1, y, y % 3 ? P.m : '#8f2c22', w - 2, 1); }
      px(1, 15, P.k, 30, 45); px(2, 16, P.y, 28, 20); px(2, 36, P.s, 28, 23);
      for (let y = 19; y < 35; y += 5) px(2, y, P.w, 28, 1);
      for (let y = 40; y < 58; y += 5) { px(2, y, P.S, 28, 1); for (let x = 2 + ((y / 5 | 0) % 2 ? 4 : 0); x < 30; x += 8) px(x, y - 4, P.S, 1, 4); }
      for (const [x, y] of [[6, 21], [14, 21], [22, 21], [10, 28], [18, 28]]) { px(x, y, P.k, 5, 4); px(x + 1, y + 1, '#1b1410', 3, 3); }
      for (const [x, y] of [[7, 19], [23, 19], [19, 26]]) { px(x, y, P.x, 3, 2); px(x + 3, y, P.k, 1, 1); }
      px(12, 46, P.k, 8, 14); px(13, 47, P.b, 6, 13);
    }));
  }
  // granero: torre de madera con techo conico; tres alturas segun el tamano de las bases
  granaryTex(size) {
    const h = [34, 42, 52][size];
    return this.tex('gran' + size, () => canvasTex(28, h, px => {
      for (let y = 0; y < 12; y++) { const w = Math.min(28, 4 + y * 2); px(14 - w / 2, y, P.k, w, 1); if (w > 2) px(14 - w / 2 + 1, y, y % 3 ? P.o : P.O, w - 2, 1); }
      px(2, 11, P.k, 24, h - 11); px(3, 12, '#9b3b2a', 22, h - 13);
      for (let x = 7; x < 25; x += 5) px(x, 12, '#7c2d20', 1, h - 13);
      px(3, 12, '#b64a36', 22, 1);
      px(8, h - 14, P.k, 12, 13); px(9, h - 13, P.x, 10, 12); for (let i = 0; i < 10; i++) { px(9 + i, h - 13 + i + 1, '#9b3b2a', 1, 1); px(18 - i, h - 13 + i + 1, '#9b3b2a', 1, 1); }
      for (let y = 18; y < h - 16; y += 7) px(12, y, P.j, 4, 3);
    }));
  }
  waterTex(k) {
    return this.tex('water' + k, () => canvasTex(U, U, px => {
      px(0, 0, '#3f74b8', U, U);
      const r = rng(11 + k * 7);
      for (let i = 0; i < 7; i++) { const x = r() * 12 | 0, y = r() * 15 | 0; px(x, y, '#6ea0d8', 3 + (r() * 2 | 0), 1); }
      for (let i = 0; i < 4; i++) { const x = r() * 14 | 0, y = r() * 15 | 0; px(x, y, '#2f5d99', 2, 1); }
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
    this.night = new Graphics(); this.lights = new Container(); // de noche: velo oscuro y, encima, antorchas y ventanas
    this.world.addChild(this.ground, this.roads, this.selG, this.scene, this.night, this.lights, this.fxL);
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
    if (kind === 'jail') return this.jail ? pixiScreen(this.app, this.jail.b) : null;   // aqui dejan a los bloqueados
    if (kind === 'mail') return this.post ? pixiScreen(this.app, this.post.t) : null;
    if (kind === 'tower' || kind === 'gate') return pixiScreen(this.app, this.castleSprite); // de aqui salen las patrullas
    return pixiScreen(this.app, this.houses.get(id));
  }

  destroy() { this.ac.abort(); this.app.destroy({ removeView: true }, { children: true }); }

  // ------------------------------------------------------------------ el mapa
  layout(state) {
    const accounts = state.accounts.filter(a => a.id !== 'root');
    const by = {};
    for (const a of state.apps) (by[a.account] = by[a.account] || []).push({ ...a, _k: 'app' });
    for (const x of state.sites || []) (by[x.account] = by[x.account] || []).push({ ...x, _k: 'site' });
    // calabozo y palomar junto al castillo (si el servidor los tiene); granero en los pueblos con bases de datos
    const jailOn = !!state.jail, postOn = !!state.mail && forEdition('TORRE DE CONTROL') === 'TORRE DE CONTROL';
    const silos = new Set(((state.silos && state.silos.list) || []).map(x => x.account));
    const key = (jailOn ? 'J' : '') + (postOn ? 'P' : '') + '|' + accounts.map(a => a.id + ':' + a.color + ':' + (silos.has(a.id) ? 's' : '') + ':' + (by[a.id] || []).map(x => x.id + (x.icon || '')).join(',')).join('|');
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.fx = this.fx.filter(f => { if (!f.obj.destroyed) f.obj.destroy(); return false; }); // efectos en curso (textos que suben, humo) se van con el mapa viejo
    for (const c of [this.ground, this.roads, this.scene, this.screen, this.lights]) c.removeChildren().forEach(o => o.destroy({ children: true }));
    this.torches = []; this.ducks = []; this.pond = null;
    this.houses.clear(); this.villages.clear();
    for (const m of this.mages.values()) m.dead = true;
    this.mages.clear();
    this.actors = this.actors.filter(a => { a.sprite.destroy(); return false; });
    this.jamQ = 0;

    // pueblos: casas en grilla de 3x3 casillas y una plaza abajo; muralla alrededor
    const vs = accounts.map(a => {
      const items = (by[a.id] || []).sort((x, y) => (x._k === y._k ? 0 : x._k === 'app' ? -1 : 1));
      const n = Math.max(1, items.length);
      const cols = clamp(Math.ceil(Math.sqrt(n * 1.5)), 2, 9), rows = Math.ceil(n / cols);
      const silo = silos.has(a.id);
      const w = cols * 3 + 3 + (silo ? 3 : 0), h = Math.max(rows * 3 + 5, silo ? 9 : 0);
      return { a, items, cols, rows, w, h, x: 0, y: 0, silo };
    }).sort((p, q) => q.items.length - p.items.length);
    // posiciones iniciales en anillo alrededor del castillo, luego se separan
    const slots = [[1, 0], [-1, 0], [0.6, -1], [-0.6, -1], [0, 1], [0.9, 0.9], [-0.9, 0.9], [0, -1.2], [1.3, -0.4], [-1.3, -0.4]];
    vs.forEach((v, i) => { const s = slots[i % slots.length], k = 1 + Math.floor(i / slots.length) * 0.6; v.x = Math.round(s[0] * (10 + v.w / 2) * k - v.w / 2); v.y = Math.round(s[1] * (9 + v.h / 2) * k - v.h / 2); });
    const castle = { x: -4, y: -4, w: 8, h: 8 };
    const fixed = [castle, ...(jailOn ? [{ x: 6, y: -4, w: 6, h: 6 }] : []), ...(postOn ? [{ x: -10, y: -4, w: 4, h: 6 }] : [])];
    const overlap = (p, q, m) => p.x < q.x + q.w + m && q.x < p.x + p.w + m && p.y < q.y + q.h + m && q.y < p.y + p.h + m;
    for (let it = 0; it < 200; it++) {
      let moved = false;
      for (const v of vs) {
        for (const o of [...fixed, ...vs]) {
          if (o === v || !overlap(v, o, 3)) continue;
          const dx = (v.x + v.w / 2) - (o.x + o.w / 2), dy = (v.y + v.h / 2) - (o.y + o.h / 2);
          if (Math.abs(dx) * o.h >= Math.abs(dy) * o.w) v.x += Math.sign(dx || 1); else v.y += Math.sign(dy || 1);
          moved = true;
        }
      }
      if (!moved) break;
    }
    // limites del mapa
    const all = [...fixed, ...vs];
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
    this.castleSprite = cs;
    this.jail = jailOn ? this.buildJail() : null;
    this.post = postOn ? this.buildPost() : null;

    // caminos: busqueda sobre la cuadricula desde el porton del castillo hasta cada puerta, esquivando murallas
    // y prefiriendo caminos ya trazados (asi se juntan como en un mapa de verdad)
    const roadSet = new Set();
    const road = (x, y) => roadSet.add(x + ',' + y);
    for (let x = -3; x <= 3; x++) for (let y = 4; y <= 5; y++) road(x, y);
    const gx0 = bx0 - 2, gy0 = by0 - 2, GW = bx1 - bx0 + 4, GH = by1 - by0 + 4;
    const solid = new Uint8Array(GW * GH);
    const idx = (x, y) => (y - gy0) * GW + (x - gx0);
    const inside = (x, y) => x >= gx0 && y >= gy0 && x < gx0 + GW && y < gy0 + GH;
    for (const o of [...fixed, ...vs]) for (let y = o.y; y < o.y + o.h; y++) for (let x = o.x; x < o.x + o.w; x++) if (inside(x, y)) solid[idx(x, y)] = 1;
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
    // antorchas: en el porton del castillo, del calabozo, del palomar y de cada pueblo (se encienden de noche)
    this.torch(-30, 3 * U + 6); this.torch(30, 3 * U + 6);
    if (this.jail) { this.torch(7.5 * U - 16, 1 * U); this.torch(7.5 * U + 16, 1 * U); }
    if (this.post) this.torch(-8 * U + 20, 1 * U);
    for (const v of vs) { const g = v.gate; this.torch((g.tx - 1) * U - 6, g.ty * U + (v.gateTop ? 2 : U)); this.torch((g.tx + 1) * U + 6, g.ty * U + (v.gateTop ? 2 : U)); }
    // arboles en lo que queda de pasto
    const r = rng(42), blocked = (tx, ty) => roadSet.has(tx + ',' + ty) || all.some(o => tx >= o.x - 1 && tx <= o.x + o.w && ty >= o.y - 2 && ty <= o.y + o.h + 1)
      || (this.pond && tx >= this.pond.tx - 1 && tx <= this.pond.tx + this.pond.w && ty >= this.pond.ty - 1 && ty <= this.pond.ty + this.pond.h);
    // un estanque con patos en un claro libre (el primero que entre, buscando desde las esquinas del mapa)
    for (const [cx, cy] of [[bx0 + 1, by1 - 6], [bx1 - 9, by1 - 6], [bx0 + 1, by0 + 1], [bx1 - 9, by0 + 1], [bx0 + 1, 0], [bx1 - 9, 0]]) {
      let ok = true;
      for (let y = cy - 1; y <= cy + 4 && ok; y++) for (let x = cx - 1; x <= cx + 7 && ok; x++) if (blocked(x, y)) ok = false;
      if (!ok) continue;
      this.pond = { tx: cx, ty: cy, w: 7, h: 4 };
      const water = new TilingSprite({ texture: this.waterTex(0), width: 7 * U, height: 4 * U }); water.x = cx * U; water.y = cy * U;
      const mask = new Graphics().roundRect(cx * U, cy * U, 7 * U, 4 * U, 18).fill(0xffffff); water.mask = mask;
      const shore = new Graphics().roundRect(cx * U - 3, cy * U - 3, 7 * U + 6, 4 * U + 6, 20).fill(0xb8925e).roundRect(cx * U - 1, cy * U - 1, 7 * U + 2, 4 * U + 2, 19).fill(0x2f5d99);
      this.roads.addChild(shore, water, mask);
      this.pond.water = water;
      for (let i = 0; i < 2; i++) { const d = new Sprite(this.frames(DUCK)[0]); d.anchor.set(0.5, 1); d.scale.set(1.3); this.scene.addChild(d); this.ducks.push({ s: d, ph: i * Math.PI, sp: 0.18 + i * 0.07 }); }
      break;
    }
    const trees = [];
    for (let i = 0; i < (bx1 - bx0) * (by1 - by0) / 14; i++) {
      const tx = bx0 - 6 + Math.floor(r() * (bx1 - bx0 + 12)), ty = by0 - 6 + Math.floor(r() * (by1 - by0 + 12));
      if (blocked(tx, ty) || blocked(tx + 1, ty) || trees.some(t => Math.abs(t[0] - tx) < 2 && Math.abs(t[1] - ty) < 2)) continue;
      trees.push([tx, ty]);
      // mayormente arboles; de a ratos una roca o un arbusto con flores
      const kind = r(), rows = kind < 0.72 ? TREE : kind < 0.86 ? ROCK : BUSH;
      const s = new Sprite(this.tex('deco' + (rows === TREE ? 't' : rows === ROCK ? 'r' : 'b'), () => rowsTex(rows, P))); s.anchor.set(0.5, 1); s.x = tx * U + U / 2; s.y = ty * U + U; s.zIndex = s.y;
      if (rows !== TREE) s.scale.set(1.4);
      this.scene.addChild(s);
    }
    this.drawNight(true);
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
    const well = new Sprite(this.tex('well', () => rowsTex(WELL, P))); well.anchor.set(0.5, 1); well.scale.set(1.25);
    well.x = x0 + (v.w - 2) * U - 6; well.y = (plazaTy + 2) * U + 6; well.zIndex = well.y; this.scene.addChild(well);
    if (v.silo) {
      const gx = (v.x + v.w - 2.5) * U, gy = v.gateTop ? (v.y + v.h - 1) * U : (v.y + 5) * U;
      const g = new Sprite(this.granaryTex(0)); g.anchor.set(0.5, 1); g.x = gx; g.y = gy; g.zIndex = gy;
      g.eventMode = 'static'; g.cursor = 'pointer';
      g.on('pointertap', () => { if (!this.dragMoved) this.pick('databases', a.id); });
      this.tipOn(g, () => this.siloTip(v));
      this.scene.addChild(g);
      v.gran = { s: g, x: gx, y: gy, size: 0, zT: 0, grainT: 0 };
    }
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
    h.name = new Text({ text: it.name || '', style: { fontFamily: FONT, fontSize: 14, fill: '#f4e7c5', stroke: { color: '#1b1410', width: 4 }, fontWeight: '600' } });
    h.name.anchor.set(0.5, 0); h.name.visible = false; this.screen.addChild(h.name);
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

  // ------------------------------------------------------------------ dia y noche
  // antorcha: palo en la escena y llama (fuego pixel) en la capa de luces, sobre el velo de la noche
  torch(x, y) {
    const pole = new Sprite(this.tex('torch', () => rowsTex(TORCH, P))); pole.anchor.set(0.5, 1); pole.scale.set(1.5); pole.x = x; pole.y = y; pole.zIndex = y;
    const flame = new Sprite(this.frames(FIRE)[0]); flame.anchor.set(0.5, 1); flame.scale.set(0.7); flame.x = x; flame.y = y - 11; flame.visible = false;
    this.scene.addChild(pole); this.lights.addChild(flame);
    this.torches.push({ pole, flame, ph: Math.random() * 3 });
  }
  // cuanto de noche es segun la hora local de quien mira: 0 de dia, 1 de noche, con atardecer y amanecer
  nightness() {
    const d = new Date(), h = this.hourOverride != null ? this.hourOverride : d.getHours() + d.getMinutes() / 60;
    if (h >= 20 || h < 5.5) return 1;
    if (h >= 18) return (h - 18) / 2;
    if (h < 7) return 1 - (h - 5.5) / 1.5;
    return 0;
  }
  drawNight(force) {
    const n = this.nightness();
    if (!force && Math.abs(n - (this.nightN ?? -1)) < 0.01) return;
    this.nightN = n;
    const b = this.bounds; if (!b) return;
    this.night.clear();
    if (n > 0) this.night.rect(b.x0 - 60 * U, b.y0 - 60 * U, b.x1 - b.x0 + 120 * U, b.y1 - b.y0 + 120 * U).fill({ color: 0x0b1030, alpha: 0.5 * n });
  }

  // ------------------------------------------------------------------ calabozo, palomar y graneros
  // Calabozo, a la derecha del castillo: las IPs bloqueadas son bandidos tras las rejas del patio (hasta 6 a la vista)
  // y los archivos en cuarentena, frascos de alquimista sellados en la puerta
  buildJail() {
    const bx = 7.5 * U, by = 1 * U;
    const b = new Sprite(this.jailTex()); b.anchor.set(0.5, 1); b.x = bx; b.y = by; b.zIndex = by;
    const yard = new Graphics().rect(9.3 * U, -2.2 * U, 2.5 * U, 3 * U).fill({ color: 0x5b4632, alpha: 0.85 });
    this.roads.addChild(yard);
    const bars = new Graphics();
    const X0 = 9.3 * U, X1 = 11.8 * U, Y0 = -2.2 * U, Y1 = 0.8 * U;
    for (let x = X0; x <= X1 + 0.5; x += 5) bars.rect(x, Y0 - 6, 1.5, Y1 - Y0 + 6).fill(0x7d838c);
    bars.rect(X0, Y0 - 6, X1 - X0 + 1.5, 2).fill(0x9aa1ab).rect(X0, Y1 - 2, X1 - X0 + 1.5, 2).fill(0x9aa1ab);
    bars.zIndex = Y1 + 2;
    const prisoners = new Container(); prisoners.zIndex = Y1 - 1;
    const flasks = new Container(); flasks.zIndex = 1.9 * U + 1;
    const hit = new Container(); hit.eventMode = 'static'; hit.cursor = 'pointer'; hit.hitArea = new Rectangle(5.8 * U, -4.5 * U, 6.4 * U, 6 * U);
    hit.on('pointertap', () => { if (!this.dragMoved) this.pick('jail', 'all'); });
    this.tipOn(hit, () => ({ title: 'Calabozo', body: 'Las IPs <b>bloqueadas</b>: bandidos tras las rejas, los que se bloquearon a mano en el firewall y los que atrapó la defensa de Atalaya. Los <b>toneles</b> sellados con cadenas son archivos PHP maliciosos en cuarentena: no pueden hacer daño y se pueden restaurar.',
      meta: `${Math.max(0, this.jail.n)} preso(s)${this.jail.q ? ` · ${this.jail.q} tonel(es)` : ''}`, hint: 'Clic para ver cada uno' }));
    this.scene.addChild(b, bars, prisoners, flasks); this.roads.addChild(hit);
    return { b, prisoners, flasks, n: -1, q: -1, yard: { x0: X0, x1: X1, y0: Y0, y1: Y1 }, label: this.label('Calabozo', false), sub: this.subLabel(''), labelPos: { x: 8.7 * U, y: -4.4 * U } };
  }
  drawJail(J) {
    const j = this.jail; if (!j || !J) return;
    const n = J.n || 0, q = J.quarantine || 0;
    if (n !== j.n) {
      j.n = n; j.prisoners.removeChildren().forEach(o => o.destroy());
      const fr = this.frames(PRISONER);
      for (let i = 0; i < Math.min(6, n); i++) {
        const sp = new Sprite(fr[0]); sp.anchor.set(0.5, 1);
        sp.x = j.yard.x0 + 8 + (i % 3) * 12; sp.y = j.yard.y0 + 18 + Math.floor(i / 3) * 18; sp.fi = i;
        j.prisoners.addChild(sp);
      }
    }
    if (q !== j.q) {
      j.q = q; j.flasks.removeChildren().forEach(o => o.destroy());
      for (let i = 0; i < Math.min(4, q); i++) { const f = new Sprite(this.tex('barrel', () => rowsTex(BARREL, P))); f.anchor.set(0.5, 1); f.scale.set(1.3); f.x = 6.4 * U + i * 14; f.y = 1.9 * U; f.zIndex = f.y; j.flasks.addChild(f); }
    }
    j.sub.text = (n ? `${n} preso${n === 1 ? '' : 's'}` : 'vacío') + (q ? ` · ${q} tonel${q === 1 ? '' : 'es'}` : '');
  }
  // Palomar, a la izquierda del castillo: por aqui pasa el correo; las cartas se apilan si la cola se atasca
  buildPost() {
    const px0 = -8 * U, py0 = 1 * U;
    const t = new Sprite(this.postTex()); t.anchor.set(0.5, 1); t.x = px0; t.y = py0; t.zIndex = py0;
    t.eventMode = 'static'; t.cursor = 'pointer';
    t.on('pointertap', () => { if (!this.dragMoved) this.pick('mail', 'all'); });
    this.tipOn(t, () => ({ title: 'Palomar', body: 'Por aquí pasa el correo del servidor: las palomas <b>blancas</b> salen de un pueblo, las <b>violetas</b> llegan y las <b>rojas</b> rebotaron y vuelven heridas con el motivo. La pila de cartas es la cola de correo esperando salir.', meta: this.postLine(), hint: 'Clic para ver el correo' }));
    const pile = new Container(); pile.zIndex = py0 + 1;
    this.scene.addChild(t, pile);
    return { t, pile, pileN: -1, x: px0, y: py0 - 44, label: this.label('Palomar', false), sub: this.subLabel(''), labelPos: { x: px0, y: -4.4 * U } };
  }
  postLine() {
    const now = this.t; this.mailLog = this.mailLog.filter(x => now - x.t < 60);
    const n = d => this.mailLog.filter(x => x.dir === d).length;
    const parts = [[n('out'), 'salen'], [n('in'), 'llegan'], [n('bounce'), 'rebotan']].filter(x => x[0]).map(x => `${x[0]} ${x[1]}`);
    return parts.length ? parts.join(' · ') + ' en 1 min' : 'sin palomas en el último minuto';
  }
  drawPost() {
    const P0 = this.post; if (!P0) return;
    const line = this.postLine(); if (P0.sub.text !== line) P0.sub.text = line;
    const q = this.mailQueue || 0, want = q > 1000 ? 9 : q > 100 ? 6 : q > 20 ? 3 : 0;
    if (want === P0.pileN) return;
    P0.pileN = want; P0.pile.removeChildren().forEach(o => o.destroy());
    for (let i = 0; i < want; i++) { const l = new Sprite(this.tex('letter', () => rowsTex(LETTER, P))); l.anchor.set(0.5, 1); l.scale.set(1.4); l.x = P0.x + 22 + (i % 3) * 3; l.y = P0.y + 44 - i * 5; l.tint = q > 1000 ? 0xff9a8a : 0xffffff; P0.pile.addChild(l); }
  }
  // paloma mensajera: sale del pueblo, pasa por el palomar y se va; llega al reves; si rebota, vuelve roja al pueblo
  letter(dir, e = {}) {
    if (!this.post) return this.pigeon(dir);
    this.mailLog.push({ t: this.t, dir }); if (this.mailLog.length > 3000) this.mailLog.shift();
    this.drawPost();
    this.mailLast = this.mailLast || {};
    if (this.t - (this.mailLast[dir] || -9) < 0.35 || this.actors.length > 140) return;
    this.mailLast[dir] = this.t;
    const b = this.bounds || { x0: -500, x1: 500, y0: -500 };
    const v = e.account && this.villages.get(e.account);
    const home = v ? { x: v.plaza.x + v.plaza.w / 2, y: v.plaza.y - 20 } : { x: this.castle.cx, y: this.castle.cy - 40 };
    const post = { x: this.post.x, y: this.post.y - 10 }, sky = { x: b.x0 - 2 * U, y: b.y0 - 2 * U };
    const crash = { x: (post.x + sky.x) / 2, y: (post.y + sky.y) / 2 };
    const pts = dir === 'in' ? [sky, post, home] : dir === 'bounce' ? [home, post, crash, post, home] : [home, post, sky];
    const fr = this.frames(BIRD, dir === 'bounce' ? { s: '#ff7a45' } : dir === 'in' ? { s: '#b69cf0' } : { s: '#f4f1e8' });
    const sp = new Sprite(fr[0]); sp.anchor.set(0.5, 1); sp.scale.set(1.3); sp.x = pts[0].x; sp.y = pts[0].y; sp.zIndex = 99999;
    this.fxL.addChild(sp);
    const SHORT = { auth: 'SIN AUTENTICAR', nouser: 'NO EXISTE', full: 'BUZÓN LLENO', spam: 'SPAM', domain: 'DOMINIO', rate: 'DEMASIADOS' };
    this.actors.push({ sprite: sp, fr, pts, seg: 0, speed: 170, bot: true, fly: true, onSeg: (a, seg) => {
      if (seg === 1) this.sparkle(post.x, post.y + 4, 2);
      if (dir === 'bounce' && seg === 2) { this.puff(sp.x, sp.y, 0xff7a45, 5); this.floatText(sp.x, sp.y - 16, SHORT[e.cat] || 'REBOTÓ', '#ff9a7a'); }
    } });
  }
  // graneros: tamano segun las bases, grano que salta si hay consultas, «z» si hay conexiones dormidas, rojo al limite
  siloTip(v) {
    const x = v.gran && v.gran.data; if (!x) return { title: 'Granero', body: 'Las bases de datos del pueblo.', hint: 'Clic para ver sus bases' };
    const mb = n => n > 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.round(n / 1048576) + ' MB';
    return { title: 'Granero · bases de datos', body: `${x.n} base${x.n === 1 ? '' : 's'} MySQL del pueblo, ${mb(x.size)}. ${x.conns ? `<b>${x.conns}</b> conexión(es)${x.active ? `, <b>${x.active}</b> con consultas en curso` : ''}${x.sleep >= 10 ? `, <b>${x.sleep} dormidas</b> (las «z»)` : ''}.` : 'Sin conexiones ahora.'} Las acequias llevan agua a las casas que las usan.`,
      meta: x.busy ? `ocupado el ${x.busy}% de los últimos 15 min` : '', hint: 'Clic para ver sus bases' };
  }
  updateSilos(S) {
    this.siloHot = !!(S && S.hot >= 0.85);
    for (const x of (S && S.list) || []) {
      const v = this.villages.get(x.account); if (!v || !v.gran) continue;
      v.gran.data = x;
      const size = x.size > 2 * 1073741824 ? 2 : x.size > 200 * 1048576 ? 1 : 0;
      if (size !== v.gran.size) { v.gran.size = size; v.gran.s.texture = this.granaryTex(size); }
    }
  }
  // acequias del granero a cada casa que usa sus bases, con gotas que corren si hay consultas
  drawCanals() {
    let g = this.canals; if (!g || g.destroyed) g = this.canals = new Graphics();
    if (!g.parent) this.roads.addChild(g);
    g.clear();
    for (const v of this.villages.values()) {
      const G = v.gran; if (!G || !G.data) continue;
      for (const l of G.data.links || []) {
        const h = this.houses.get(l.id); if (!h) continue;
        const a = { x: G.x, y: G.y + 2 }, m = { x: h.x, y: G.y + 2 }, b2 = { x: h.x, y: h.y + 4 };
        g.moveTo(a.x, a.y).lineTo(m.x, m.y).lineTo(b2.x, b2.y).stroke({ width: 3, color: 0x3b6fb5, alpha: 0.75 });
        if (!l.active) continue;
        const L1 = Math.abs(m.x - a.x), L2 = Math.abs(b2.y - m.y), L = L1 + L2 || 1, n = Math.min(4, 1 + l.active);
        for (let i = 0; i < n; i++) {
          const u = ((this.t * (0.35 + (l.busy || 0) / 200) + i / n) % 1) * L;
          const p = u < L1 ? { x: a.x + Math.sign(m.x - a.x) * u, y: a.y } : { x: m.x, y: m.y + Math.sign(b2.y - m.y) * (u - L1) };
          g.rect(p.x - 1.5, p.y - 1.5, 3, 3).fill(0xbfe3ff);
        }
      }
    }
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
    // calabozo, palomar y graneros
    this.drawJail(state.jail);
    this.mailQueue = state.mailQueue; this.drawPost();
    this.updateSilos(state.silos);
    // servidor al limite: castillo asediado y fila en el porton
    const jam = !!(state.saturation && state.saturation.level === 'bad');
    if (!jam && this.jam) this.jamNext = 0;
    this.jam = jam;
    // cuota al limite: una linea bajo el nombre del pueblo
    for (const a of state.accounts) {
      const v = this.villages.get(a.id); if (!v) continue;
      const txt = a.quota ? `${String(a.quota.what).toUpperCase()} AL ${a.quota.pct} %` : '';
      if (txt && !v.q) v.q = this.subLabel('');
      if (v.q) { v.q.text = txt; v.q.style.fill = a.quota && a.quota.level === 'bad' ? '#ff8a7a' : '#f5d76e'; v.q.visible = !!txt; }
    }
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
      case 'mail': return this.letter(e.dir, e);
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
    // castillo asediado: cada aldeano toma el ultimo lugar de la fila del porton, espera su turno y sigue despacio
    let hold = null;
    if (this.jam && !bot) {
      if (this.jamQ >= 16) return; // la fila ya muestra el asedio: no crece sin fin
      const now = this.t; this.jamNext = Math.min(now + 8, Math.max(this.jamNext || 0, now) + 0.5);
      const slot = this.jamQ++;
      const gi = entry.length; // indice del porton en pts
      pts.splice(gi, 0, { x: this.castle.gate.x + (slot % 2 ? 5 : -5), y: this.castle.gate.y + 14 + slot * 9 });
      hold = { seg: gi, until: this.jamNext };
    }
    const sp = new Sprite(fr[0]); sp.anchor.set(0.5, 1);
    sp.x = start.x; sp.y = start.y;
    this.scene.addChild(sp);
    this.actors.push({ sprite: sp, fr, pts, seg: 0, speed: (bot ? 150 : 70 + Math.random() * 30) * (this.jam ? 0.45 : 1), bot, err, h, hold });
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
      if (a.hold && a.seg === a.hold.seg && a.hold.until > this.t) { sp.texture = a.fr[0]; continue; }
      if (a.hold && a.seg === a.hold.seg) { a.hold = null; this.jamQ = Math.max(0, this.jamQ - 1); }
      const dx = to.x - sp.x, dy = to.y - sp.y, d = Math.hypot(dx, dy), st = a.speed * dt;
      if (d <= st) { sp.x = to.x; sp.y = to.y; a.seg++; if (a.onSeg) a.onSeg(a, a.seg); }
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
    // noche: se revisa cada segundo; antorchas encendidas y ventanas de las casas con visitas
    if (Math.floor(this.t) !== this.nightT) { this.nightT = Math.floor(this.t); this.drawNight(false); }
    const lit = (this.nightN || 0) > 0.15;
    for (const tq of this.torches || []) { tq.flame.visible = lit; if (lit) tq.flame.texture = this.frames(FIRE)[Math.floor(this.t * 5 + tq.ph) % 2]; }
    for (const h of this.houses.values()) {
      const on = lit && h.lit;
      if (on && !h.glow) { h.glow = new Graphics().rect(h.x - 10, h.y - 12, 4, 4).fill(0xffe28a).rect(h.x + 6, h.y - 12, 4, 4).fill(0xffe28a); this.lights.addChild(h.glow); }
      if (h.glow) h.glow.visible = on;
    }
    // estanque: el agua se mueve y los patos nadan en ronda
    if (this.pond) {
      this.pond.water.texture = this.waterTex(Math.floor(this.t * 1.5) % 2);
      const P2 = this.pond, cx = (P2.tx + P2.w / 2) * U, cy = (P2.ty + P2.h / 2) * U + 6;
      for (const d of this.ducks) { const a = this.t * d.sp + d.ph; d.s.x = cx + Math.cos(a) * (P2.w * U / 2 - 18); d.s.y = cy + Math.sin(a) * (P2.h * U / 2 - 14); d.s.zIndex = d.s.y; d.s.scale.x = 1.3 * (Math.sin(a) > 0 ? -1 : 1); d.s.texture = this.frames(DUCK)[Math.floor(this.t * 2) % 2]; }
    }
    // castillo asediado: se tiñe de rojo y late
    if (this.castleSprite) this.castleSprite.tint = this.jam ? (Math.floor(this.t * 3) % 2 ? 0xff9a8a : 0xffc4b8) : 0xffffff;
    if (this.jam && Math.random() < dt * 2) this.puff(this.castle.cx + (Math.random() - 0.5) * 60, this.castle.cy - 30, 0x5b3b3b, 1);
    // calabozo: los presos se mueven en su lugar; los frascos brillan despacio
    if (this.jail) {
      const fr = this.frames(PRISONER);
      this.jail.prisoners.children.forEach(sp => { sp.texture = fr[(Math.floor(this.t * 2 + sp.fi) % 2)]; });
      // los toneles se sacuden de a ratos: algo se mueve adentro
      this.jail.flasks.children.forEach((f, i) => { const k = (this.t * 0.7 + i * 0.37) % 1; f.rotation = k < 0.08 ? Math.sin(k * 150) * 0.12 : 0; });
    }
    // graneros
    for (const v of this.villages.values()) {
      const G = v.gran; if (!G || !G.data) continue;
      const x = G.data, top = G.y - G.s.height;
      G.s.tint = this.siloHot ? (Math.floor(this.t * 3) % 2 ? 0xff8a7a : 0xffc4b8) : 0xffffff;
      if (x.active) { G.grainT -= dt * (0.8 + x.active); if (G.grainT <= 0) { G.grainT = 1; this.sparkle(G.x, top + 6, 2); } }
      if (x.sleep >= 10) { G.zT -= dt; if (G.zT <= 0) { G.zT = 2.2; const z = new Sprite(this.tex('zzz', () => rowsTex(ZZZ, { k: '#cbd5e1' }))); z.anchor.set(0.5, 1); z.x = G.x + 8; z.y = top + 4; z.scale.set(1.2); this.addFx(z, (f, dt2) => { z.y -= 8 * dt2; z.x += Math.sin(f.age * 3) * 0.3; z.alpha = 1 - f.age / 2.2; return f.age < 2.2; }); } }
    }
    this.drawCanals();
    // efectos
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.age += dt;
      if (f.obj.destroyed || !f.tick(f, dt)) { if (!f.obj.destroyed) f.obj.destroy(); this.fx.splice(i, 1); }
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
    for (const v of this.villages.values()) { const p = toScreen(v.labelPos); v.label.scale.set(ts); v.sub.scale.set(ts); v.label.x = p.x; v.label.y = p.y - 20 * ts; v.sub.x = p.x; v.sub.y = p.y; if (v.q) { v.q.scale.set(ts); v.q.x = p.x; v.q.y = p.y + 20 * ts; } }
    // calabozo y palomar: su rotulo aparece al acercarse (en la vista general se encimaria con el del castillo)
    const mid = this.overview && this.cam.s >= this.overview.s * 1.5;
    for (const o of [this.jail, this.post]) if (o) { o.label.visible = o.sub.visible = mid; if (mid) { const p = toScreen(o.labelPos); o.label.scale.set(ts * 0.85); o.sub.scale.set(ts * 0.85); o.label.x = p.x; o.label.y = p.y - 18 * ts; o.sub.x = p.x; o.sub.y = p.y; } }
    // nombres de las casas: aparecen al acercarse (de lejos, el cartel pixel alcanza)
    const near = this.overview && this.cam.s >= Math.max(2.2, this.overview.s * 1.9);
    for (const h of this.houses.values()) {
      h.name.visible = near;
      if (near) { const p = toScreen({ x: h.x, y: h.y + 3 }); h.name.x = p.x; h.name.y = p.y; }
    }
    for (const f of this.fx) if (f.world && !f.obj.destroyed) { const p = toScreen(f.world); f.obj.x = p.x; f.obj.y = p.y; }
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
    else if (kind === 'jail' && this.jail) p = { x: 8.5 * U, y: -1.5 * U, s: 4 };
    else if (kind === 'mail' && this.post) p = { x: this.post.x, y: -1.5 * U, s: 4 };
    else if (kind === 'databases') { const v = this.villages.get(id); if (v && v.gran) p = { x: v.gran.x, y: v.gran.y - 20, s: 4 }; }
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
