// Tema "Raid": arena de mazmorra al estilo de un MMO de fantasia, en pixel art dibujado en codigo.
//  - cada cuenta es un GRUPO de la banda; cada servicio o sitio un HEROE con su barra de vida (estado)
//    y de mana (CPU; en los sitios, cuanto trafico recibe). La clase depende de que es.
//  - cada visita es un numero de combate que sube del heroe (+1 verde; -502 rojo si es un error)
//  - un servicio caido es un heroe muerto (lapida); al reiniciarse "resucita"
//  - el servidor es el GUARDIAN que protege a la banda; los intentos de acceso son ataques del jefe,
//    EL INTRUSO: el guardian los absorbe, y cada IP bloqueada le quita vida al jefe
//  - cada sesion de Claude Code es un JUGADOR con aura dorada y barra de lanzamiento (lo que hace);
//    si espera su permiso, aparece la comprobacion "?"
// Regla de oro: el color es la clase o el estado, nunca adorno; los numeros de combate cuentan lo que pasa.
import { Application, Container, Graphics, Sprite, Text, Texture, Rectangle } from '../../vendor/pixi.csp.mjs';
import { esc, fmtBytes } from '../../js/hud.js';
import { accountCaption, forEdition } from '../../js/accounts.js';
import { healthLine } from '../../js/layout.js';
import { pixiScreen } from '../../js/commfx.js';

const U = 16;
const FONT = "'Jersey 10', ui-monospace, monospace";
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hexn = h => parseInt(String(h).slice(1), 16);

function canvasTex(w, h, draw) {
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  const px = (x, y, c, ww = 1, hh = 1) => { if (c) { cx.fillStyle = c; cx.fillRect(x, y, ww, hh); } };
  draw(px, cx);
  const t = Texture.from(cv); t.source.scaleMode = 'nearest';
  return t;
}
function rowsTex(rows, pal) { return canvasTex(Math.max(...rows.map(r => r.length)), rows.length, px => rows.forEach((r, y) => [...r].forEach((ch, x) => px(x, y, pal[ch])))); }
function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

const P = { k: '#120f0d', z: '#e2b48c', a: '#c7ccd4', A: '#7d838c', w: '#8b5a2b', y: '#e8c55a', Y: '#b8912e', x: '#f4f1e8', r: '#d94a3a', b: '#4a8fe0', g: '#5fbf4a', v: '#8a4fd0', d: '#3b3346', o: '#e68a2e', s: '#9aa0a8' };

// clases: colores de armadura (C), detalle (c), casco o pelo (H) y el arma
const CLASSES = {
  guerrero: { C: '#b53a2e', c: '#7a261e', H: '#c7ccd4', weapon: 'espada', name: 'Guerrero' },
  paladin: { C: '#e8c55a', c: '#b8912e', H: '#e8c55a', weapon: 'martillo', name: 'Paladín' },
  ingeniero: { C: '#c9772e', c: '#8a4f1c', H: '#5b4636', weapon: 'llave', name: 'Ingeniero' },
  mago: { C: '#4a6fe0', c: '#2e45a0', H: '#4a6fe0', weapon: 'baston', name: 'Mago' },
  sacerdote: { C: '#f4f1e8', c: '#c9c3b0', H: '#e8c55a', weapon: 'orbe', name: 'Sacerdote' },
  arquero: { C: '#4f8a3a', c: '#355e27', H: '#355e27', weapon: 'arco', name: 'Arquero' },
  picaro: { C: '#3b3346', c: '#221d29', H: '#221d29', weapon: 'dagas', name: 'Pícaro' },
};
function classOf(it) {
  if (it._k === 'site') return it.type === 'wordpress' ? 'arquero' : it.type === 'php' ? 'picaro' : 'arquero';
  return { pm2: 'guerrero', systemd: 'paladin', docker: 'ingeniero', vercel: 'mago', cloudflare: 'mago', beat: 'sacerdote', supabase: 'sacerdote' }[it.source] || 'guerrero';
}
function heroRows(cls) {
  const base = [
    '................', '......kkkk......', '.....kHHHHk.....', '.....kzzzzk.....', '.....kzkzkk.....', '......kzzk......',
    '....kkCCCCkk....', '...kCCCCCCCCk...', '...kCCccccCCk...', '...kzCCCCCCzk...', '....kCCCCCCk....', '....kcccccck....',
    '....kCCkkCCk....', '....kCCk.kCCk...', '....kkk..kkk....', '................'].map(r => [...r]);
  const set = (x, y, ch) => { if (base[y] && x >= 0 && x < 16) base[y][x] = ch; };
  const w = CLASSES[cls].weapon;
  if (w === 'espada') { for (let y = 2; y <= 9; y++) set(13, y, 'a'); set(12, 9, 'y'); set(14, 9, 'y'); set(13, 10, 'w'); for (let y = 7; y <= 11; y++) { set(1, y, 'w'); set(2, y, 'w'); } set(1, 8, 'y'); set(2, 9, 'y'); }
  if (w === 'martillo') { for (let y = 4; y <= 11; y++) set(13, y, 'w'); for (let x = 11; x <= 15; x++) { set(x, 3, 'a'); set(x, 4, 'a'); } set(13, 2, 'k'); }
  if (w === 'llave') { for (let y = 6; y <= 11; y++) set(13, y, 'a'); set(12, 5, 'a'); set(14, 5, 'a'); set(12, 4, 'a'); set(14, 4, 'a'); set(6, 4, 'b'); set(8, 4, 'b'); }
  if (w === 'baston') { for (let y = 3; y <= 13; y++) set(13, y, 'w'); set(13, 2, 'b'); set(12, 2, 'b'); set(14, 2, 'b'); set(13, 1, 'x'); set(6, 0, 'k'); set(7, 0, 'C'); set(7, 1, 'C'); set(8, 1, 'C'); }
  if (w === 'orbe') { for (let y = 4; y <= 13; y++) set(13, y, 'y'); set(12, 3, 'y'); set(14, 3, 'y'); set(13, 2, 'x'); set(13, 3, 'x'); }
  if (w === 'arco') { for (let y = 3; y <= 12; y++) set(y < 5 || y > 10 ? 13 : 14, y, 'w'); for (let y = 4; y <= 11; y++) set(12, y, 'x'); set(5, 1, 'k'); }
  if (w === 'dagas') { set(1, 8, 'a'); set(1, 9, 'a'); set(1, 10, 'k'); set(14, 8, 'a'); set(14, 9, 'a'); set(14, 10, 'k'); set(6, 3, 'k'); set(9, 3, 'k'); }
  return base.map(r => r.join(''));
}
const TOMB = ['....kkkk....', '...kssssk...', '..ksssssssk.', '..kssksssk..', '..ksskkkssk.', '..kssksssk..', '..ksssssssk.', '..ksssssssk.', '..ksssssssk.', '.kkkkkkkkkkk', 'kddddddddddk'];
// esbirro del Intruso capturado (una IP bloqueada), cofre maldito con cadenas (archivo en cuarentena),
// buzon, pergamino (un correo) y cofre del banco del grupo (bases de datos: 1 a 3 montones de oro)
const MINION = [['...kkkk...', '..kvvvvk..', '.kvrvvrvk.', '.kvvvvvvk.', '..kvkkvk..', '.kkvvvvkk.', 'kvkvvvvkvk', '..kvvvvk..', '..kv..vk..', '..kk..kk..'],
  ['...kkkk...', '..kvvvvk..', '.kvrvvrvk.', '.kvvvvvvk.', '..kvkkvk..', 'kkkvvvvkkk', '..kvvvvk..', '..kvvvvk..', '.kv....vk.', '.kk....kk.']];
const CURSED = ['.kkkkkkkkkk.', 'kvvvvvvvvvvk', 'kvsvvvvvvsvk', 'kkkkkkkkkkkk', 'kwwwssswwwwk', 'kwwsyysswwwk', 'kwwwssswwwwk', 'kssssssssssk', 'kkkkkkkkkkkk'];
const MAILBOX = ['..kkkkkkkk..', '.krrrrrrrrk.', 'krRRRRRRRRrk', 'krRkkkkkkRrk', 'krRRRRRRRRrk', 'krRRRRyRRRrk', 'krRRRRRRRRrk', 'kkkkkkkkkkkk', '....kwwk....', '....kwwk....', '....kwwk....', '....kwwk....', '....kwwk....', '...kkwwkk...', '..kddddddk..'];
const SCROLL = ['.kkkkkk.', 'kxxxxxxk', 'kxkkkkxk', 'kxxxxxxk', 'kxkkkxxk', '.kkkkkk.'];
function bankRows(fill) {
  const top = fill >= 3 ? ['...yYyyYy...', '.yYyyYyyYyy.'] : fill >= 2 ? ['............', '..yYyyYyy...'] : ['............', '............'];
  return [...top, 'kkkkkkkkkkkk', 'kwwwwwwwwwwk', 'kwYwwwwwwYwk', 'kkkkkyykkkkk', 'kwwwwyywwwwk', 'kwYwwwwwwYwk', 'kwwwwwwwwwwk', 'kkkkkkkkkkkk'];
}
const TORCH = [['..y..', '.yoy.', '.oro.', '..r..', '.kwk.', '.kwk.', '.kwk.'], ['.y...', '.yoy.', '.oor.', '..r..', '.kwk.', '.kwk.', '.kwk.']];

export default class RaidWorld {
  constructor(el, { manifest } = {}) {
    this.el = el;
    this.heroes = new Map(); this.groups = new Map(); this.players = new Map();
    this.fx = []; this.t = 0; this.layoutKey = ''; this.tex = new Map();
    this.boss = { hp: 100, dead: 0 };
    this.directorOn = true; this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.cam = { s: 1, x: 0, y: 0 }; this.camTarget = null; this.manualUntil = 0; this.shotT = 0; this.shotIdx = 0;
    this.pending = new Map(); // visitas agrupadas por heroe (para no llenar de "+1")
    this.cage = null; this.mailbox = null; this.mailLog = []; this.jam = false;
  }
  T(key, make) { if (!this.tex.has(key)) this.tex.set(key, make()); return this.tex.get(key); }
  heroTex(cls, dead) { return dead ? this.T('tomb', () => rowsTex(TOMB, P)) : this.T('h' + cls, () => rowsTex(heroRows(cls), { ...P, ...CLASSES[cls] })); }
  floorTex() {
    return this.T('floor', () => canvasTex(32, 32, px => {
      const r = rng(11);
      px(0, 0, '#2d2925', 32, 32);
      for (let by = 0; by < 32; by += 8) for (let bx = (by / 8) % 2 ? 4 : 0; bx < 32; bx += 16) {
        px(bx, by, '#3a3530', 15, 7); px(bx, by, '#46403a', 15, 1);
      }
      for (let i = 0; i < 30; i++) px(r() * 32 | 0, r() * 32 | 0, '#221f1c');
    }));
  }
  bossTex() {
    return this.T('boss', () => canvasTex(40, 40, px => {
      // cuerpo
      px(10, 16, P.k, 20, 20); px(11, 17, '#5a2f86', 18, 18); px(11, 17, '#7a47b0', 18, 3);
      // brazos
      px(4, 18, P.k, 7, 14); px(5, 19, '#5a2f86', 5, 12); px(29, 18, P.k, 7, 14); px(30, 19, '#5a2f86', 5, 12);
      px(3, 30, P.k, 8, 5); px(4, 31, '#3d1f5c', 6, 3); px(29, 30, P.k, 8, 5); px(30, 31, '#3d1f5c', 6, 3);
      // cabeza y cuernos
      px(13, 6, P.k, 14, 12); px(14, 7, '#6b3a9e', 12, 10);
      px(9, 1, P.k, 5, 8); px(10, 2, P.x, 3, 6); px(26, 1, P.k, 5, 8); px(27, 2, P.x, 3, 6);
      px(16, 10, '#ff3b2e', 3, 2); px(21, 10, '#ff3b2e', 3, 2); px(16, 10, '#ffd24a', 1, 1); px(21, 10, '#ffd24a', 1, 1);
      px(16, 14, P.k, 8, 2); for (let x = 17; x < 24; x += 2) px(x, 14, P.x, 1, 1);
      // runas en el pecho
      px(18, 22, '#ff3b2e', 4, 1); px(19, 21, '#ff3b2e', 2, 3); px(15, 27, '#3d1f5c', 10, 1);
      px(12, 36, P.k, 6, 4); px(22, 36, P.k, 6, 4);
    }));
  }
  guardTex() {
    return this.T('guard', () => rowsTex(['................', '......kkkk......', '.....kaaaak.....', '.....kakkak.....', '.....kzzzzk.....', '......kkkk......',
      '...kkkaaaakk....', '..kyyykaaaaak...', '..kyAyykaaaak...', '..kyAAyykaazk...', '..kyAyykaaak....', '..kyyykaaaak....', '...kkkkAkAk.....', '....kaak.kaak...', '....kkk..kkk....', '................'], P));
  }

  async init() {
    this.ac = new AbortController();
    const sig = { signal: this.ac.signal };
    await document.fonts.load(`24px ${FONT}`).catch(() => { });
    this.app = new Application();
    await this.app.init({ resizeTo: this.el, background: '#141110', antialias: false, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2), roundPixels: true, preference: 'webgl' });
    this.el.appendChild(this.app.canvas);
    this.world = new Container();
    this.floor = new Container(); this.scene = new Container(); this.scene.sortableChildren = true; this.bars = new Graphics(); this.fxL = new Container(); this.selG = new Graphics();
    this.world.addChild(this.floor, this.selG, this.scene, this.bars, this.fxL);
    this.screen = new Container();
    this.app.stage.addChild(this.world, this.screen);
    this.app.stage.eventMode = 'static'; this.app.stage.hitArea = this.app.screen;
    this.setupNav(sig);
    this.app.ticker.add(tk => this.tick(Math.min(tk.deltaMS / 1000, 0.1)));
    window.addEventListener('resize', () => this.fit(true), sig);
  }
  // donde esta cada cosa en la pantalla (comunicacion entre agentes); los subagentes van junto a su sesion
  screenOf(kind, id) {
    if (kind === 'session' || kind === 'agent') return pixiScreen(this.app, this.players.get(String(id).split('/')[0]));
    if (kind === 'jail') return this.cage ? pixiScreen(this.app, this.cage.s) : null;          // aqui dejan a los bloqueados
    if (kind === 'mail') return this.mailbox ? pixiScreen(this.app, this.mailbox.s) : null;
    if (kind === 'gate' || kind === 'tower') return this.guard ? pixiScreen(this.app, this.guard.s) : null; // de aqui salen las patrullas
    return pixiScreen(this.app, this.heroes.get(id));
  }

  destroy() { this.ac.abort(); this.app.destroy({ removeView: true }, { children: true }); }

  // ------------------------------------------------------------------ la arena
  layout(state) {
    const accounts = state.accounts.filter(a => a.id !== 'root');
    const by = {};
    for (const a of state.apps) (by[a.account] = by[a.account] || []).push({ ...a, _k: 'app' });
    for (const x of state.sites || []) (by[x.account] = by[x.account] || []).push({ ...x, _k: 'site' });
    const jailOn = !!state.jail, mailOn = !!state.mail && forEdition('TORRE DE CONTROL') === 'TORRE DE CONTROL';
    const silos = new Set(((state.silos && state.silos.list) || []).map(x => x.account));
    const key = accounts.map(a => a.id + ':' + (silos.has(a.id) ? 'b' : '') + ':' + (by[a.id] || []).map(x => x.id + (x.source || x.type)).join(',')).join('|') + (jailOn ? '|J' : '') + (mailOn ? '|M' : '');
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    for (const c of [this.floor, this.scene, this.screen, this.fxL]) c.removeChildren().forEach(o => o.destroy({ children: true }));
    this.fx = []; this.heroes.clear(); this.groups.clear(); this.players.clear(); this.cage = null; this.mailbox = null; this.queueT = null; this.enrageV = null; // sus textos se destruyen con la capa de pantalla
    // grupos en dos columnas si hace falta; cada heroe ocupa 28 x 44 pixeles de arte
    const COLS = 10, HW = 28, HH = 46, GAP = 30;
    const groups = accounts.map(a => ({ a, items: (by[a.id] || []).sort((x, y) => (x._k === y._k ? 0 : x._k === 'app' ? -1 : 1)) }))
      .filter(g => g.items.length).sort((x, y) => y.items.length - x.items.length);
    groups.forEach(g => { const n = g.items.length; g.cols = Math.min(COLS, n); g.rows = Math.ceil(n / COLS); g.bank = silos.has(g.a.id); g.w = g.cols * HW + 40 + (g.bank ? 34 : 0); g.h = g.rows * HH + 28; });
    const totalH = groups.reduce((n, g) => n + g.h + GAP, 0);
    const twoCols = totalH > 520;
    const colX = twoCols ? [-340, 30] : [-170], colY = twoCols ? [0, 0] : [0];
    for (const g of groups) {
      const c = twoCols ? (colY[0] <= colY[1] ? 0 : 1) : 0;
      g.x = colX[c]; g.y = colY[c] + 150; colY[c] += g.h + GAP;
    }
    const height = Math.max(...colY) + 150, width = twoCols ? 720 : 400;
    this.arena = { x0: -width / 2 - 40, y0: -150, x1: width / 2 + 40, y1: height + 40 };
    // piso, muros y antorchas
    const A = this.arena;
    const fl = new Graphics();
    this.floor.addChild(fl);
    for (let y = A.y0; y < A.y1; y += 32) for (let x = A.x0; x < A.x1; x += 32) { const s = new Sprite(this.floorTex()); s.x = x; s.y = y; this.floor.addChild(s); }
    const wall = new Graphics().rect(A.x0 - 12, A.y0 - 12, A.x1 - A.x0 + 24, 12).fill(0x1e1b18).rect(A.x0 - 12, A.y1, A.x1 - A.x0 + 24, 12).fill(0x1e1b18)
      .rect(A.x0 - 12, A.y0, 12, A.y1 - A.y0).fill(0x1e1b18).rect(A.x1, A.y0, 12, A.y1 - A.y0).fill(0x1e1b18);
    this.floor.addChild(wall);
    this.torches = [];
    for (const [x, y] of [[A.x0 + 8, A.y0 + 4], [A.x1 - 14, A.y0 + 4], [A.x0 + 8, A.y1 - 30], [A.x1 - 14, A.y1 - 30], [-80, A.y0 + 4], [74, A.y0 + 4]]) {
      const s = new Sprite(this.T('torch0', () => rowsTex(TORCH[0], P))); s.x = x; s.y = y; s.scale.set(2); this.scene.addChild(s); this.torches.push(s);
    }
    // estrado del jefe
    fl.rect(-90, A.y0 + 10, 180, 100).fill(0x3d3731).rect(-90, A.y0 + 10, 180, 3).fill(0x55504a).rect(-90, A.y0 + 107, 180, 4).fill(0x221f1c);
    const boss = new Sprite(this.bossTex()); boss.anchor.set(0.5, 1); boss.scale.set(2); boss.x = 0; boss.y = A.y0 + 104; boss.zIndex = boss.y;
    boss.eventMode = 'static'; boss.cursor = 'pointer';
    boss.on('pointertap', () => { if (!this.dragMoved) this.pick('security', 'all'); });
    this.tipOn(boss, () => ({ title: 'El Intruso', body: 'El jefe: cada <b>intento de acceso fallido</b> es uno de sus ataques. Cada <b>IP bloqueada</b> le quita vida.', meta: `Vida ${Math.round(this.boss.hp)}%`, hint: 'Clic para ver la defensa' }));
    this.scene.addChild(boss); this.bossS = boss; this.bossPos = { x: 0, y: A.y0 + 60 };
    this.bossName = this.label('El Intruso', 30, '#ff7a6b');
    // guardian (el servidor), entre el jefe y la banda
    const gd = new Sprite(this.guardTex()); gd.anchor.set(0.5, 1); gd.scale.set(2.2); gd.x = 0; gd.y = 150 - 12; gd.zIndex = gd.y;
    gd.eventMode = 'static'; gd.cursor = 'pointer';
    gd.on('pointertap', () => { if (!this.dragMoved) this.pick('system', 'root'); });
    this.tipOn(gd, () => ({ title: 'El Guardián', body: 'El <b>servidor</b>: protege a la banda y absorbe los ataques del Intruso.', meta: this.state?.system ? `CPU ${this.state.system.cpu.toFixed(0)}% · RAM ${this.state.system.mem.pct.toFixed(0)}% · carga ${this.state.system.load[0].toFixed(2)}` : '', hint: 'Clic para ver el servidor completo' }));
    this.scene.addChild(gd); this.guard = { s: gd, x: 0, y: 150 - 30 };
    // nombre y salud del servidor, bajo el guardian
    this.guardName = this.label('El Guardián', 20, '#e8c55a');
    this.guardHealth = this.label('', 16, '#3fcf4a');
    // grupos
    groups.forEach((g, gi) => {
      const lbl = this.label(`Grupo ${gi + 1} · ${g.a.label}`, 24, '#e8c55a');
      g.label = lbl; g.labelPos = { x: g.x + 20, y: g.y + 4 };
      lbl.anchor.set(0, 1);
      { const nA = g.items.filter(x => x._k === 'app').length; g.caption = accountCaption(g.a, nA, g.items.length - nA); }
      g.sub = this.label(g.caption, 18, '#cdbf9c'); g.sub.anchor.set(0, 1);
      const pad = new Graphics().rect(g.x, g.y + 8, g.w, g.h - 8).fill({ color: 0x000000, alpha: 0.18 }).rect(g.x, g.y + 8, 3, g.h - 8).fill(hexn(g.a.color));
      this.floor.addChild(pad);
      const hit = new Container(); hit.eventMode = 'static'; hit.cursor = 'pointer'; hit.hitArea = new Rectangle(g.x, g.y - 20, g.w, 30);
      hit.on('pointertap', () => { if (!this.dragMoved) this.pick('district', g.a.id); });
      this.tipOn(hit, () => ({ title: g.a.label, body: `Grupo de ${g.items.length} héroes: servicios y sitios de esta cuenta.`, meta: g.caption, hint: 'Clic para ver el grupo' }));
      this.scene.addChild(hit);
      g.items.forEach((it, i) => this.addHero(it, g.x + 34 + (i % COLS) * HW, g.y + 50 + Math.floor(i / COLS) * HH, g.a));
      if (g.bank) {
        const bx = g.x + g.w - 24, by = g.y + 50;
        const b = new Sprite(this.T('bank1', () => rowsTex(bankRows(1), P))); b.anchor.set(0.5, 1); b.scale.set(1.6); b.x = bx; b.y = by; b.zIndex = by;
        b.eventMode = 'static'; b.cursor = 'pointer';
        b.on('pointertap', () => { if (!this.dragMoved) this.pick('databases', g.a.id); });
        this.tipOn(b, () => this.bankTip(g));
        this.scene.addChild(b);
        g.bankS = { s: b, x: bx, y: by, fill: 1, hot: false, data: null };
      }
      this.groups.set(g.a.id, g);
    });
    // jaula a la izquierda del estrado y buzon a la derecha (si el servidor los tiene)
    if (jailOn) this.buildCage();
    if (mailOn) this.buildMailbox();
    this.fit(true);
  }

  addHero(it, x, y, acc) {
    const cls = classOf(it);
    const s = new Sprite(this.heroTex(cls, it.status === 'down')); s.anchor.set(0.5, 1); s.x = x; s.y = y; s.zIndex = y;
    s.eventMode = 'static'; s.cursor = 'pointer';
    const h = { s, cls, data: it, kind: it._k, acc, x, y, flash: 0, dead: it.status === 'down', cast: null };
    s.on('pointertap', () => { if (!this.dragMoved) this.pick(h.kind, it.id); });
    this.tipOn(s, () => {
      const a = h.data;
      return { title: a.name, body: `<b>${CLASSES[cls].name}</b> · ${a.kind && a.kind !== a.name ? esc(a.kind) + ' · ' : ''}${esc(acc.label)}`,
        meta: `${{ online: 'Vivo', degraded: 'Herido', down: 'MUERTO (caído)' }[a.status] || a.status}${h.kind === 'app' ? ` · CPU ${(a.cpu || 0).toFixed(1)}% · RAM ${fmtBytes(a.mem || 0)}` : ''} · ${a.reqMin || 0} visitas/min`, hint: 'Clic para ver el detalle' };
    });
    this.scene.addChild(s);
    this.heroes.set(it.id, h);
  }

  // ------------------------------------------------------------------ jaula, buzon y bancos
  // Jaula, a la izquierda del estrado: las IPs bloqueadas son esbirros del Intruso capturados (hasta 6 a la vista);
  // los archivos en cuarentena, cofres malditos encadenados delante
  buildCage() {
    const A = this.arena, cx = (A.x0 + 12 - 90) / 2, top = A.y0 + 16;
    const s = new Sprite(this.T('cage', () => canvasTex(44, 40, px => {
      px(0, 0, P.k, 44, 3); px(0, 37, P.k, 44, 3); px(1, 1, '#6b6f78', 42, 1); px(1, 38, '#55504a', 42, 1);
      for (let x = 1; x < 44; x += 6) { px(x, 3, P.k, 3, 34); px(x + 1, 3, '#8a8f99', 1, 34); }
      px(0, 18, P.k, 44, 2); px(19, 17, '#e8c55a', 6, 4);
    })));
    s.anchor.set(0.5, 0); s.scale.set(2); s.x = cx; s.y = top; s.zIndex = top + 80;
    s.eventMode = 'static'; s.cursor = 'pointer';
    s.on('pointertap', () => { if (!this.dragMoved) this.pick('jail', 'all'); });
    this.tipOn(s, () => ({ title: 'Jaula', body: 'Las IPs <b>bloqueadas</b> son esbirros del Intruso capturados: las que se bloquearon a mano en el firewall y las que atrapó la defensa de Atalaya. Los <b>cofres malditos</b> encadenados son archivos PHP maliciosos en cuarentena: no pueden hacer daño y se pueden restaurar.', meta: this.cageLine(), hint: 'Clic para ver cada uno' }));
    const minions = new Container(); minions.zIndex = top + 40;
    const chests = new Container(); chests.zIndex = top + 100;
    this.scene.addChild(minions, s, chests);
    this.cage = { s, minions, chests, n: -1, q: -1, x: cx, top, name: this.label('Jaula', 20, '#e8c55a'), sub: this.label('', 15, '#cdbf9c') };
  }
  cageLine() { const c = this.cage; if (!c) return ''; const n = Math.max(0, c.n), q = Math.max(0, c.q); return (n ? `${n} esbirro${n === 1 ? '' : 's'}` : 'vacía') + (q ? ` · ${q} cofre${q === 1 ? '' : 's'} maldito${q === 1 ? '' : 's'}` : ''); }
  drawCage(J) {
    const c = this.cage; if (!c || !J) return;
    const n = J.n || 0, q = J.quarantine || 0;
    if (n !== c.n) {
      if (c.n >= 0 && n > c.n) this.combat(c.x, c.top - 6, '¡Capturado!', '#ffd24a', 24);
      c.n = n; c.minions.removeChildren().forEach(o => o.destroy());
      for (let i = 0; i < Math.min(6, n); i++) { const m = new Sprite(this.T('min0', () => rowsTex(MINION[0], P))); m.anchor.set(0.5, 1); m.scale.set(1.6); m.x = c.x - 26 + (i % 3) * 26; m.y = c.top + 36 + Math.floor(i / 3) * 36; m.fi = i; c.minions.addChild(m); }
    }
    if (q !== c.q) {
      c.q = q; c.chests.removeChildren().forEach(o => o.destroy());
      for (let i = 0; i < Math.min(4, q); i++) { const k = new Sprite(this.T('cursed', () => rowsTex(CURSED, P))); k.anchor.set(0.5, 1); k.scale.set(1.8); k.x = c.x - 33 + i * 22; k.y = c.top + 104; c.chests.addChild(k); }
    }
    c.sub.text = this.cageLine();
  }
  // Buzon, a la derecha del estrado: cada correo es un pergamino que pasa por el; los rebotados vuelven con el motivo
  buildMailbox() {
    const A = this.arena, cx = (90 + A.x1 - 12) / 2, by = A.y0 + 104;
    const s = new Sprite(this.T('mailbox', () => rowsTex(MAILBOX, { ...P, R: '#b53a2e' }))); s.anchor.set(0.5, 1); s.scale.set(2.4); s.x = cx; s.y = by; s.zIndex = by;
    s.eventMode = 'static'; s.cursor = 'pointer';
    s.on('pointertap', () => { if (!this.dragMoved) this.pick('mail', 'all'); });
    this.tipOn(s, () => ({ title: 'Buzón', body: 'Por aquí pasa el correo del servidor: los pergaminos salen de un grupo, llegan de afuera o <b>rebotan</b> y vuelven con el motivo. Los que se apilan encima son la cola de correo esperando salir.', meta: this.postLine() + ' (último minuto)', hint: 'Clic para ver el correo' }));
    const pile = new Container(); pile.zIndex = by + 1;
    this.scene.addChild(s, pile);
    this.mailbox = { s, pile, pileN: -1, x: cx, y: by - 30, top: by - 36, name: this.label('Buzón', 20, '#e8c55a'), sub: this.label('', 15, '#cdbf9c') };
  }
  postLine() {
    const now = this.t; this.mailLog = this.mailLog.filter(x => now - x.t < 60);
    const n = d => this.mailLog.filter(x => x.dir === d).length;
    const parts = [[n('out'), 'salen'], [n('in'), 'llegan'], [n('bounce'), 'rebotan']].filter(x => x[0]).map(x => `${x[0]} ${x[1]}`);
    return parts.length ? parts.join(' · ') : 'sin correo';
  }
  drawPost() {
    const M = this.mailbox; if (!M) return;
    const line = this.postLine(); if (M.sub.text !== line) M.sub.text = line;
    const q = this.mailQueue || 0, want = q > 1000 ? 7 : q > 100 ? 5 : q > 20 ? 3 : 0;
    if (want === M.pileN) return;
    M.pileN = want; M.pile.removeChildren().forEach(o => o.destroy());
    for (let i = 0; i < want; i++) { const l = new Sprite(this.T('scroll', () => rowsTex(SCROLL, P))); l.anchor.set(0.5, 1); l.scale.set(1.6); l.x = M.x + (i % 2 ? 4 : -4); l.y = M.top - i * 7; l.tint = q > 1000 ? 0xff9a8a : 0xffffff; M.pile.addChild(l); }
  }
  // pergamino: sale del grupo, pasa por el buzon y se va por arriba; llega al reves; si rebota, vuelve con el motivo
  letter(dir, e) {
    this.mailLog.push({ t: this.t, dir }); if (this.mailLog.length > 3000) this.mailLog.shift();
    this.drawPost();
    this.mailLast = this.mailLast || {};
    if (this.t - (this.mailLast[dir] || -9) < 0.35 || this.fx.length > 220) return;
    this.mailLast[dir] = this.t;
    const g = e.account && this.groups.get(e.account), A = this.arena;
    const home = g ? { x: g.x + g.w / 2, y: g.y } : { x: this.guard.x, y: this.guard.y - 20 };
    const box = { x: this.mailbox.x, y: this.mailbox.y }, sky = { x: this.mailbox.x + 40, y: A.y0 - 60 };
    const pts = dir === 'in' ? [sky, box, home] : dir === 'bounce' ? [home, box, { x: box.x + 20, y: (box.y + sky.y) / 2 }, box, home] : [home, box, sky];
    const sp = new Sprite(this.T('scroll', () => rowsTex(SCROLL, P))); sp.anchor.set(0.5); sp.scale.set(1.6);
    sp.tint = dir === 'bounce' ? 0xff9a6a : dir === 'in' ? 0xc8b4f4 : 0xffffff;
    const SHORT = { auth: 'SIN AUTENTICAR', nouser: 'NO EXISTE', full: 'BUZÓN LLENO', spam: 'SPAM', domain: 'DOMINIO', rate: 'DEMASIADOS' };
    const legs = pts.slice(1).map((b, i) => ({ a: pts[i], b, d: 0.5 + Math.hypot(b.x - pts[i].x, b.y - pts[i].y) / 260 }));
    this.addFx(sp, f => {
      let t0 = f.age, i = 0;
      while (i < legs.length && t0 > legs[i].d) { t0 -= legs[i].d; i++; }
      if (i >= legs.length) return false;
      if (i !== f.leg) { f.leg = i; if (dir === 'bounce' && i === 2) this.combat(box.x, box.y - 40, `Rebotó: ${SHORT[e.cat] || 'sin motivo'}`, '#ff9a4d', 22); }
      const L = legs[i], k = t0 / L.d;
      sp.x = L.a.x + (L.b.x - L.a.x) * k; sp.y = L.a.y + (L.b.y - L.a.y) * k - Math.sin(k * Math.PI) * 24; sp.rotation = Math.sin(f.age * 8) * 0.2;
      return true;
    });
  }
  // banco del grupo: el cofre se llena de oro con el tamano de las bases; rojizo al limite; hilos dorados a los heroes
  bankTip(g) {
    const x = g.bankS && g.bankS.data; if (!x) return { title: 'Banco del grupo', body: 'Las bases de datos del grupo.', hint: 'Clic para ver sus bases' };
    const mb = n => n > 1073741824 ? (n / 1073741824).toFixed(1) + ' GB' : Math.round(n / 1048576) + ' MB';
    return { title: 'Banco del grupo · bases de datos', body: `${x.n} base${x.n === 1 ? '' : 's'} MySQL, ${mb(x.size)}. ${x.conns ? `<b>${x.conns}</b> conexión(es)${x.active ? `, <b>${x.active}</b> con consultas en curso` : ''}${x.sleep >= 10 ? `, <b>${x.sleep} dormidas</b> (las «z»)` : ''}.` : 'Sin conexiones ahora.'} Los hilos dorados llegan a los héroes que las usan.`,
      meta: x.busy ? `ocupado el ${x.busy}% de los últimos 15 min` : '', hint: 'Clic para ver sus bases' };
  }
  updateBanks(S) {
    const hotAll = !!(S && S.hot >= 0.85);
    for (const x of (S && S.list) || []) {
      const g = this.groups.get(x.account); if (!g || !g.bankS) continue;
      g.bankS.data = x;
      const fill = x.size > 2 * 1073741824 ? 3 : x.size > 200 * 1048576 ? 2 : 1, hot = hotAll || (x.busy || 0) >= 85;
      if (fill !== g.bankS.fill) { g.bankS.fill = fill; g.bankS.s.texture = this.T('bank' + fill, () => rowsTex(bankRows(fill), P)); }
      g.bankS.hot = hot;
    }
  }
  drawBankLinks(g0) {
    for (const g of this.groups.values()) {
      const B = g.bankS; if (!B || !B.data) continue;
      B.s.tint = B.hot ? (Math.floor(this.t * 3) % 2 ? 0xff9a8a : 0xffd0c8) : 0xffffff;
      for (const l of B.data.links || []) {
        const h = this.heroes.get(l.id); if (!h) continue;
        const a = { x: B.x, y: B.y - 20 }, b = { x: h.x, y: h.y - 30 }, m = { x: (a.x + b.x) / 2, y: Math.min(a.y, b.y) - 14 };
        const at = k => ({ x: (1 - k) * (1 - k) * a.x + 2 * (1 - k) * k * m.x + k * k * b.x, y: (1 - k) * (1 - k) * a.y + 2 * (1 - k) * k * m.y + k * k * b.y });
        g0.moveTo(a.x, a.y); for (let k = 1; k <= 12; k++) { const p = at(k / 12); g0.lineTo(p.x, p.y); }
        g0.stroke({ width: 1, color: 0xe8c55a, alpha: 0.45 });
        if (!l.active) continue;
        const n = Math.min(4, 1 + l.active);
        for (let i = 0; i < n; i++) { const p = at((this.t * (0.35 + (l.busy || 0) / 200) + i / n) % 1); g0.rect(p.x - 1.5, p.y - 1.5, 3, 3).fill(0xffd24a); }
      }
    }
  }

  label(text, size, color) {
    const t = new Text({ text, style: { fontFamily: FONT, fontSize: size, fill: color, stroke: { color: '#0b0908', width: 5 }, letterSpacing: 1 } });
    t.anchor.set(0.5, 1); this.screen.addChild(t);
    return t;
  }

  // ------------------------------------------------------------------ estado
  update(state) {
    this.state = state;
    this.layout(state);
    const hl = healthLine(state);
    if (hl && this.guardHealth && this.guardHealth.text !== hl.text) { this.guardHealth.text = hl.text; this.guardHealth.style.fill = hl.color; }
    for (const x of [...state.apps, ...(state.sites || [])]) {
      const h = this.heroes.get(x.id);
      if (!h) continue;
      const wasDead = h.dead;
      h.data = { ...x, _k: h.kind };
      h.dead = x.status === 'down';
      if (h.dead !== wasDead) {
        h.s.texture = this.heroTex(h.cls, h.dead);
        this.combat(h.x, h.y - 30, h.dead ? '¡Murió!' : 'Resucitado', h.dead ? '#ff4d3d' : '#8dffa0', 30);
        if (!h.dead) this.sparkle(h.x, h.y - 12, 0xe8c55a, 10);
      }
    }
    this.syncPlayers(state.sessions || []);
    // jaula, buzon y bancos
    this.drawCage(state.jail);
    this.mailQueue = state.mailQueue; this.drawPost();
    this.updateBanks(state.silos);
    // servidor al limite: el Intruso se enfurece y las visitas hacen cola para entrar
    const jam = !!(state.saturation && state.saturation.level === 'bad');
    if (jam && !this.jam && this.guard) this.combat(this.guard.x, this.guard.y - 60, '¡El Intruso se enfurece!', '#ff4d3d', 32);
    this.jam = jam;
    // cuota al limite: junto al nombre del grupo
    for (const a of state.accounts) {
      const g = this.groups.get(a.id); if (!g) continue;
      const txt = a.quota ? `${String(a.quota.what).toUpperCase()} AL ${a.quota.pct} %` : '';
      if (txt && !g.q) g.q = this.label('', 18, '#f5d76e');
      if (g.q) { g.q.text = txt; g.q.style.fill = a.quota && a.quota.level === 'bad' ? '#ff8a7a' : '#f5d76e'; g.q.visible = !!txt; }
    }
  }

  syncPlayers(sessions) {
    const seen = new Set(), per = {};
    for (const s of sessions) {
      seen.add(s.id);
      let p = this.players.get(s.id);
      if (!p) {
        const sp = new Sprite(this.heroTex('mago', false)); sp.anchor.set(0.5, 1); sp.scale.set(1.3);
        sp.eventMode = 'static'; sp.cursor = 'pointer';
        sp.on('pointertap', () => { if (!this.dragMoved) this.pick('session', s.id); });
        this.tipOn(sp, () => ({ title: 'Jugador · agente de Claude Code', body: `Lanzando: ${esc(p.s.activity || '—')}${p.s.subagents && p.s.subagents.length ? ` · ${p.s.subagents.length} invocación(es)` : ''}`,
          meta: p.s.waitKind ? 'Espera su permiso o su respuesta' : { working: 'En combate', thinking: 'Concentrado', idle: 'Descansando' }[p.s.state] || '', hint: 'Clic para ver la línea de tiempo' }));
        const aura = new Graphics();
        this.scene.addChild(sp); this.fxL.addChild(aura);
        const castT = this.label('', 18, '#f4e7c5'); castT.anchor.set(0.5, 0);
        p = { sp, aura, castT, s, castStart: this.t };
        this.players.set(s.id, p);
      }
      if (p.s.activity !== s.activity) p.castStart = this.t;
      p.s = s;
      per[s.account] = (per[s.account] || 0) + 1;
      const g = this.groups.get(s.account);
      p.x = g ? g.x + g.w + 22 : 150 + per[s.account] * 26; p.y = (g ? g.y + 50 : 150) + (per[s.account] - 1) * 40;
    }
    for (const [id, p] of this.players) if (!seen.has(id)) { p.sp.destroy(); p.aura.destroy(); p.castT.destroy(); this.players.delete(id); }
  }

  // ------------------------------------------------------------------ eventos
  onEvent(e, priv) {
    switch (e.kind) {
      case 'http': {
        const h = this.heroes.get(e.app || e.site);
        if (!h) return;
        if (e.status >= 500) { this.combat(h.x, h.y - 26, `-${e.status}`, '#ff4d3d', 30); h.flash = 1; return; }
        const k = h.data.id; this.pending.set(k, (this.pending.get(k) || 0) + 1);
        return;
      }
      case 'attack': return this.bossAttack(false);
      case 'block': return this.bossAttack(true, priv ? e.ip : null);
      case 'login': return this.combat(this.guard.x, this.guard.y - 40, priv && e.user ? `${e.user} entró` : 'Refuerzos: acceso SSH', '#8dffa0', 24);
      case 'mail': if (this.mailbox) return this.letter(e.dir, e); if (e.dir === 'bounce') this.combat(this.guard.x + 60, this.guard.y - 20, 'Carta rebotada', '#ff9a4d', 22); return;
      case 'deploy': {
        const h = this.heroes.get(e.app);
        if (!h) return;
        if (e.action === 'building') h.cast = { text: 'Desplegando', start: this.t, dur: 8 };
        else { h.cast = null; this.combat(h.x, h.y - 30, { ready: '¡Desplegado!', error: 'Interrumpido', canceled: 'Cancelado' }[e.action] || '', e.action === 'ready' ? '#8dffa0' : '#ff4d3d', 26); if (e.action === 'ready') this.sparkle(h.x, h.y - 12, 0x8dffa0, 12); }
        return;
      }
      case 'pm2': { const h = this.heroes.get(e.app); if (h && e.action !== 'down') this.combat(h.x, h.y - 30, 'Reaparece', '#e8c55a', 24); return; }
      case 'domain': {
        const g = this.groups.get(e.account);
        if (g) this.combat(g.x + g.w / 2, g.y - 16, { added: 'Se unió un dominio', removed: 'Un dominio dejó el grupo', changed: 'Un sitio cambió' }[e.action] + (priv && e.domain ? `: ${e.domain}` : ''), e.action === 'removed' ? '#ff9a4d' : '#8dffa0', 22);
        return;
      }
      case 'claude': {
        const p = this.players.get(e.sid) || [...this.players.entries()].find(([k]) => e.sid && k.startsWith(e.sid))?.[1];
        if (!p) return;
        if (e.action === 'permission') { this.urgent = { x: p.x, y: p.y, until: this.t + 12 }; this.combat(p.x, p.y - 40, 'Comprobación: ¿listo?', '#e8c55a', 24); }
        else if (e.action === 'done') { this.sparkle(p.x, p.y - 16, 0xe8c55a, 10); this.combat(p.x, p.y - 40, 'Misión cumplida', '#8dffa0', 22); }
        else if (e.action === 'error') this.combat(p.x, p.y - 30, 'Fallo', '#ff4d3d', 22);
        return;
      }
    }
  }

  // el jefe ataca al guardian; si la IP quedo bloqueada, el guardian contraataca
  bossAttack(blocked, ip) {
    if (this.boss.dead > this.t) return;
    const from = { ...this.bossPos }, to = { x: this.guard.x, y: this.guard.y - 20 };
    this.projectile(from, to, 0xb04aff, () => {
      this.combat(to.x + (Math.random() - 0.5) * 40, to.y - 20, 'Absorbido', '#d9d2ff', 22);
      this.guard.flash = 1;
      if (!blocked) return;
      this.projectile({ x: to.x, y: to.y - 10 }, { x: this.bossPos.x, y: this.bossPos.y }, 0xe8c55a, () => {
        this.boss.hp = Math.max(0, this.boss.hp - 12);
        this.bossFlash = 1;
        this.combat(this.bossPos.x + (Math.random() - 0.5) * 50, this.bossPos.y - 40, ip ? `¡Crítico! ${ip} bloqueada` : '¡Crítico! IP bloqueada', '#ffd24a', 30);
        if (this.boss.hp <= 0) { this.boss.dead = this.t + 20; this.combat(0, this.bossPos.y - 70, 'El Intruso fue derrotado', '#ffd24a', 36); this.sparkle(0, this.bossPos.y, 0xffd24a, 30); }
      });
    });
  }

  projectile(from, to, color, done) {
    const g = new Graphics().rect(-3, -3, 6, 6).fill(color).rect(-1, -1, 2, 2).fill(0xffffff);
    g.x = from.x; g.y = from.y;
    this.addFx(g, (f, dt) => {
      const dx = to.x - g.x, dy = to.y - g.y, d = Math.hypot(dx, dy), st = 260 * dt;
      if (Math.random() < 0.6) { const t = new Graphics().rect(-1, -1, 2, 2).fill(color); t.x = g.x; t.y = g.y; this.addFx(t, f2 => { t.alpha = 1 - f2.age * 3; return f2.age < 0.33; }); }
      if (d <= st) { done(); return false; }
      g.x += dx / d * st; g.y += dy / d * st;
      return true;
    });
  }
  addFx(obj, tick) { this.fxL.addChild(obj); this.fx.push({ obj, tick, age: 0 }); }
  sparkle(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const g = new Graphics().rect(-1, -1, 2, 2).fill(color);
      const a = Math.random() * Math.PI * 2, sp = 20 + Math.random() * 40;
      g.x = x; g.y = y;
      this.addFx(g, (f, dt) => { g.x += Math.cos(a) * sp * dt; g.y += Math.sin(a) * sp * dt - 16 * dt; g.alpha = 1 - f.age; return f.age < 1; });
    }
  }
  // numero de combate: sube y se desvanece (a tamano de pantalla, siempre nitido)
  combat(x, y, text, color, size = 22) {
    const t = new Text({ text, style: { fontFamily: FONT, fontSize: size, fill: color, stroke: { color: '#0b0908', width: 5 } } });
    t.anchor.set(0.5, 1); this.screen.addChild(t);
    const drift = (Math.random() - 0.5) * 10;
    this.fx.push({ obj: t, age: 0, world: { x, y }, tick: (f, dt) => { f.world.y -= 22 * dt; f.world.x += drift * dt; t.alpha = f.age < 1.3 ? 1 : 1 - (f.age - 1.3) / 0.6; t.scale.set(f.age < 0.12 ? 1 + (0.12 - f.age) * 4 : 1); return f.age < 1.9; } });
  }

  // ------------------------------------------------------------------ cuadro a cuadro
  tick(dt) {
    this.t += dt;
    // visitas agrupadas cada medio segundo: "+3" en vez de tres "+1"
    // al limite las visitas hacen cola: se sueltan de a poco y el guardian muestra cuantas esperan
    this.flushT = (this.flushT || 0) - dt;
    if (this.flushT <= 0) {
      this.flushT = this.jam ? 1.6 : 0.5;
      let budget = this.jam ? 3 : Infinity;
      for (const [id, n] of this.pending) {
        if (budget-- <= 0) break;
        const h = this.heroes.get(id); if (h && !h.dead) { this.combat(h.x + (Math.random() - 0.5) * 12, h.y - 24, `+${n}`, h.data.bot ? '#b5b5b5' : '#6dff7a', n > 4 ? 26 : 20); h.flash = 0.6; }
        this.pending.delete(id);
      }
    }
    if (!this.queueT && this.guard) this.queueT = this.label('', 18, '#ff9a4d');
    if (this.queueT) { let q = 0; for (const n of this.pending.values()) q += n; this.queueT.text = this.jam && q ? `En cola: ${q} visitas` : ''; }
    // barras de vida y mana sobre cada heroe
    const g = this.bars; g.clear();
    for (const h of this.heroes.values()) {
      const a = h.data, x = h.x - 11, y = h.y - 22;
      const hp = a.status === 'down' ? 0 : a.status === 'degraded' ? 0.5 : 1;
      g.rect(x - 1, y - 1, 24, 7).fill(0x0b0908);
      g.rect(x, y, 22 * hp, 3).fill(hp > 0.6 ? 0x3fcf4a : hp > 0 ? 0xe8c55a : 0x000000);
      const mp = h.kind === 'app' ? clamp((a.cpu || 0) / 100, 0, 1) : clamp(Math.sqrt(a.reqMin || 0) / 10, 0, 1);
      g.rect(x, y + 4, 22 * mp, 2).fill(h.kind === 'app' ? 0x3b82f6 : 0xe89a2e);
      if (h.cast) {
        const k = clamp((this.t - h.cast.start) / h.cast.dur, 0, 1);
        g.rect(x - 4, h.y + 3, 30, 5).fill(0x0b0908).rect(x - 3, h.y + 4, 28 * k, 3).fill(0xe8c55a);
      }
      h.flash = Math.max(0, h.flash - dt * 2.5);
      h.s.tint = h.flash > 0.05 ? 0xfff6c8 : 0xffffff;
      if (!h.dead) h.s.y = h.y - (a.status === 'degraded' ? 0 : Math.abs(Math.sin(this.t * 3 + h.x)) * (a.reqMin > 0 ? 1.5 : 0));
    }
    // jefe: vida (se recupera sola) y barra
    if (this.bossS) {
      const dead = this.boss.dead > this.t;
      if (!dead && this.boss.dead && this.boss.hp <= 0) { this.boss.hp = 100; this.combat(0, this.bossPos.y - 70, 'El Intruso regresa', '#ff7a6b', 30); }
      if (!dead) this.boss.hp = Math.min(100, this.boss.hp + dt * 0.8);
      this.bossS.alpha = dead ? 0.15 : 1;
      this.bossFlash = Math.max(0, (this.bossFlash || 0) - dt * 3);
      this.bossS.tint = this.bossFlash > 0.05 ? 0xffd0a0 : 0xffffff;
      this.bossS.y = this.bossPos.y + 44 + Math.sin(this.t * 1.5) * 2;
      const bx = -60, by = this.arena.y0 + 116;
      g.rect(bx - 2, by - 2, 124, 10).fill(0x0b0908).rect(bx, by, 120 * this.boss.hp / 100, 6).fill(0xc0392b).rect(bx, by, 120 * this.boss.hp / 100, 2).fill(0xff6b5b);
      this.guard.flash = Math.max(0, (this.guard.flash || 0) - dt * 3);
      this.guard.s.tint = this.guard.flash > 0.05 ? 0xd9d2ff : 0xffffff;
      // escudo del guardian
      g.circle(this.guard.x, this.guard.y - 10, 34 + (this.guard.flash || 0) * 6).stroke({ width: 2, color: 0xb04aff, alpha: 0.25 + (this.guard.flash || 0) * 0.6 });
    }
    this.drawBankLinks(g);
    // jaula: los esbirros se agitan; los cofres malditos se sacuden y sueltan un brillo violeta
    if (this.cage) {
      const fr = Math.floor(this.t * 3) % 2;
      this.cage.minions.children.forEach(m => { const f2 = (fr + m.fi) % 2; m.texture = this.T('min' + f2, () => rowsTex(MINION[f2], P)); });
      this.cage.chests.children.forEach((k, i) => { const u = (this.t * 0.6 + i * 0.37) % 1; k.rotation = u < 0.08 ? Math.sin(u * 150) * 0.1 : 0; g.ellipse(k.x, k.y - 8, 12, 5).fill({ color: 0x8a4fd0, alpha: 0.12 + 0.08 * Math.sin(this.t * 3 + i) }); });
    }
    // bancos con conexiones dormidas: sueltan una «z»
    this.zT = (this.zT || 0) - dt;
    if (this.zT <= 0) {
      this.zT = 1.6;
      for (const gr of this.groups.values()) if (gr.bankS && gr.bankS.data && gr.bankS.data.sleep >= 10) this.combat(gr.bankS.x + 6, gr.bankS.y - 26, 'z', '#d8d0ff', 20);
    }
    // furia: el jefe crece y se tine de rojo; el escudo del guardian se pone rojo
    if (this.bossS) { const k = this.jam ? 1.12 + 0.04 * Math.sin(this.t * 6) : 1; this.bossS.scale.set(2 * k); if (this.jam && !(this.bossFlash > 0.05)) this.bossS.tint = Math.floor(this.t * 3) % 2 ? 0xff8a7a : 0xffc0b0; }
    if (this.jam && this.guard) g.circle(this.guard.x, this.guard.y - 10, 40).stroke({ width: 3, color: 0xff4d3d, alpha: 0.4 + 0.3 * Math.sin(this.t * 6) });
    // jugadores (agentes de Claude)
    const frame = Math.floor(this.t * 4) % 2;
    for (const p of this.players.values()) {
      p.sp.x = p.x; p.sp.y = p.y + Math.sin(this.t * 2 + p.x) * 1.5; p.sp.zIndex = p.y;
      const waiting = !!p.s.waitKind;
      p.aura.clear().ellipse(p.x, p.y + 1, 12, 4).fill({ color: 0xe8c55a, alpha: 0.25 + 0.15 * Math.sin(this.t * 4) });
      if (waiting && frame) p.aura.rect(p.x - 6, p.y - 44, 12, 14).fill(0xe8c55a).stroke({ width: 1, color: 0x0b0908 }).rect(p.x - 1, p.y - 42, 3, 6).fill(0x0b0908).rect(p.x - 1, p.y - 34, 3, 2).fill(0x0b0908);
      p.sp.alpha = p.s.state === 'idle' ? 0.7 : 1;
      // barra de lanzamiento: lo que esta haciendo
      if (p.s.state === 'working' || p.s.state === 'thinking') {
        const k = ((this.t - p.castStart) % 4) / 4;
        this.bars.rect(p.x - 24, p.y + 5, 48, 6).fill(0x0b0908).rect(p.x - 23, p.y + 6, 46 * k, 4).fill(0xe8c55a);
      }
      const txt = waiting ? ({ question: 'Le hizo una pregunta', idle: 'Terminó y lo espera' }[p.s.waitKind] || 'Espera su permiso') : p.s.state === 'idle' ? 'Descansando' : (p.s.activity || '');
      if (p.castT.text !== txt) p.castT.text = txt;
      p.castPos = { x: p.x, y: p.y + 12 };
    }
    for (let i = this.torches ? this.torches.length - 1 : -1; i >= 0; i--) this.torches[i].texture = this.T('torch' + frame, () => rowsTex(TORCH[frame], P));
    for (let i = this.fx.length - 1; i >= 0; i--) { const f = this.fx[i]; f.age += dt; if (!f.tick(f, dt)) { f.obj.destroy(); this.fx.splice(i, 1); } }
    this.drawSelection();
    this.director(dt);
    if (this.camTarget) { const k = 1 - Math.pow(0.02, dt); this.cam.s += (this.camTarget.s - this.cam.s) * k; this.cam.x += (this.camTarget.x - this.cam.x) * k; this.cam.y += (this.camTarget.y - this.cam.y) * k; }
    const W = this.app.screen.width, H = this.app.screen.height;
    this.world.scale.set(this.cam.s);
    this.world.x = Math.round(W / 2 + this.cam.x); this.world.y = Math.round(H / 2 + this.cam.y);
    const toS = p => ({ x: this.world.x + p.x * this.cam.s, y: this.world.y + p.y * this.cam.s });
    if (this.bossName) { const p = toS({ x: 0, y: this.arena.y0 + 132 }); this.bossName.x = p.x; this.bossName.y = p.y + 24; }
    // en pantallas chicas los textos se achican con el area del mundo (no se enciman)
    const ts = clamp(Math.min((W - this.insets.left - this.insets.right) / 900, (H - this.insets.top - this.insets.bottom) / 560), 0.5, 1);
    // encima del guardian (debajo va la fila de grupos)
    if (this.guardName) { const p = toS({ x: 0, y: 150 - 60 }); this.guardName.x = this.guardHealth.x = p.x; this.guardHealth.y = p.y - 4 * ts; this.guardName.y = p.y - 26 * ts; this.guardName.scale.set(ts); this.guardHealth.scale.set(ts); }
    if (this.bossName) this.bossName.scale.set(ts);
    for (const gr of this.groups.values()) {
      const p = toS(gr.labelPos); gr.label.scale.set(ts); gr.sub.scale.set(ts); gr.label.x = p.x; gr.label.y = p.y;
      // si el nombre y el subtitulo no caben en el ancho del grupo, el subtitulo baja una linea (no pisa al grupo vecino)
      const qw = gr.q && gr.q.visible ? gr.q.width + 14 * ts : 0, room = (gr.w - 20) * this.cam.s;
      if (gr.label.width + 14 * ts + gr.sub.width + qw <= room) { gr.sub.x = p.x + gr.label.width + 14 * ts; gr.sub.y = p.y - 2 * ts; }
      else { gr.sub.x = p.x; gr.sub.y = p.y + 17 * ts; }
      if (gr.q) { gr.q.anchor.set(0, 1); gr.q.scale.set(ts); gr.q.x = gr.sub.x + gr.sub.width + 14 * ts; gr.q.y = gr.sub.y; }
    }
    for (const o of [this.cage, this.mailbox]) if (o) {
      const p = toS({ x: o.x, y: o === this.cage ? o.top - 4 : o.top - 30 });
      const zs = ts * clamp(this.cam.s / Math.max(0.01, this.overview?.s || 1), 0.8, 1.3);
      o.name.scale.set(zs); o.sub.scale.set(zs); o.name.x = o.sub.x = p.x; o.name.y = p.y - 18 * zs; o.sub.y = p.y;
    }
    if (this.queueT && this.guard) { const p = toS({ x: this.guard.x, y: this.guard.y + 34 }); this.queueT.scale.set(ts); this.queueT.x = p.x; this.queueT.y = p.y; }
    if (this.jam) { if (!this.enrageV) { this.enrageV = new Graphics(); this.screen.addChildAt(this.enrageV, 0); } const a = 0.35 + 0.2 * Math.sin(this.t * 5), v = this.enrageV.clear(); for (let k = 0; k < 4; k++) v.rect(k * 6, k * 6, W - k * 12, H - k * 12).stroke({ width: 6, color: 0xd94a3a, alpha: a * (1 - k / 4) }); }
    else if (this.enrageV) this.enrageV.clear();
    if (this.bossName) { const txt = this.jam ? 'El Intruso · ¡ENFURECIDO!' : 'El Intruso'; if (this.bossName.text !== txt) this.bossName.text = txt; }
    for (const p of this.players.values()) if (p.castPos) { const q = toS(p.castPos); p.castT.x = q.x; p.castT.y = q.y; p.castT.visible = this.cam.s > 1.2; }
    for (const f of this.fx) if (f.world) { const p = toS(f.world); f.obj.x = p.x; f.obj.y = p.y; }
    if (this.manualUntil && this.manualUntil < this.t) { this.manualUntil = 0; this.camTarget = this.overview; this.navChanged(); }
    else if (this.manualUntil && Math.floor(this.t) !== this.lastNav) { this.lastNav = Math.floor(this.t); this.navChanged(); }
  }

  drawSelection() {
    const g = this.selG; g.clear();
    const s = this.selected;
    if (!s) return;
    let p = null;
    if (s.kind === 'app' || s.kind === 'site') { const h = this.heroes.get(s.id); if (h) p = { x: h.x, y: h.y }; }
    else if (s.kind === 'session') { const q = this.players.get(s.id); if (q) p = { x: q.x, y: q.y }; }
    if (!p) return;
    g.ellipse(p.x, p.y + 1, 14 + Math.sin(this.t * 6) * 2, 5).stroke({ width: 2, color: 0x3fcf4a });
  }

  // ------------------------------------------------------------------ camara y navegacion
  setInsets(ins) { this.insets = ins; this.fit(true); }
  fit(snap) {
    if (!this.app || !this.arena) return;
    const W = this.app.screen.width, H = this.app.screen.height, i = this.insets, A = this.arena;
    const aw = Math.max(200, W - i.left - i.right), ah = Math.max(200, H - i.top - i.bottom);
    let s = Math.min(aw / (A.x1 - A.x0 + 40), ah / (A.y1 - A.y0 + 40));
    if (s >= 2) s = Math.floor(s);
    const cx = (A.x0 + A.x1) / 2, cy = (A.y0 + A.y1) / 2;
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
    const gs = [...this.groups.values()];
    const shots = ['all', 'boss', ...gs];
    this.shotIdx = (this.shotIdx + 1) % (shots.length * 2);
    const sh = this.shotIdx % 2 === 0 ? 'all' : shots[Math.floor(this.shotIdx / 2) % shots.length];
    if (sh === 'all') { this.camTarget = this.overview; this.shotT = 10; return; }
    if (sh === 'boss') { this.camTarget = this.frameOn(0, this.arena.y0 + 90, Math.max(this.overview.s * 2, 2)); this.shotT = 8; return; }
    this.camTarget = this.frameOn(sh.x + sh.w / 2, sh.y + sh.h / 2, Math.max(this.overview.s * 1.8, 2)); this.shotT = 10;
  }
  setDirector(on) { this.directorOn = on; this.shotT = 0; }
  navState() { return this.manualUntil ? { mode: 'manual', left: Math.max(0, Math.ceil(this.manualUntil - this.t)) } : { mode: this.directorOn ? 'director' : 'fixed' }; }
  navChanged() { if (this.onNav) this.onNav(this.navState()); }
  manual() { this.manualUntil = this.t + 90; this.navChanged(); }
  resetView() { this.manualUntil = 0; this.camTarget = this.overview; this.shotT = 10; this.navChanged(); }
  zoomBy(f) { this.manual(); const c = this.camTarget || this.cam; const ns = clamp(c.s * f, this.overview.s * 0.7, 8); this.camTarget = { s: ns, x: c.x * ns / c.s, y: c.y * ns / c.s }; }
  pick(kind, id) {
    this.selected = { kind, id };
    let p = null;
    if (kind === 'app' || kind === 'site') { const h = this.heroes.get(id); if (h) p = { x: h.x, y: h.y - 10, s: 4 }; }
    else if (kind === 'session') { const q = this.players.get(id); if (q) p = { x: q.x, y: q.y - 10, s: 4 }; }
    else if (kind === 'district') { const g = this.groups.get(id); if (g) p = { x: g.x + g.w / 2, y: g.y + g.h / 2, s: 2.5 }; }
    else if (kind === 'system') p = { x: 0, y: this.guard.y, s: 3 };
    else if (kind === 'security') p = { x: 0, y: this.arena.y0 + 80, s: 3 };
    else if (kind === 'jail' && this.cage) p = { x: this.cage.x, y: this.cage.top + 50, s: 3.5 };
    else if (kind === 'mail' && this.mailbox) p = { x: this.mailbox.x, y: this.mailbox.y - 10, s: 3.5 };
    else if (kind === 'databases') { const g = this.groups.get(id); if (g) p = { x: g.x + g.w / 2, y: g.y + g.h / 2, s: 2.5 }; }
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
