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
import { accountCaption } from '../../js/accounts.js';
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
  return { pm2: 'guerrero', systemd: 'paladin', docker: 'ingeniero', vercel: 'mago', supabase: 'sacerdote' }[it.source] || 'guerrero';
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
    return pixiScreen(this.app, this.heroes.get(id));
  }

  destroy() { this.ac.abort(); this.app.destroy({ removeView: true }, { children: true }); }

  // ------------------------------------------------------------------ la arena
  layout(state) {
    const accounts = state.accounts.filter(a => a.id !== 'root');
    const by = {};
    for (const a of state.apps) (by[a.account] = by[a.account] || []).push({ ...a, _k: 'app' });
    for (const x of state.sites || []) (by[x.account] = by[x.account] || []).push({ ...x, _k: 'site' });
    const key = accounts.map(a => a.id + ':' + (by[a.id] || []).map(x => x.id + (x.source || x.type)).join(',')).join('|');
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    for (const c of [this.floor, this.scene, this.screen, this.fxL]) c.removeChildren().forEach(o => o.destroy({ children: true }));
    this.fx = []; this.heroes.clear(); this.groups.clear(); this.players.clear();
    // grupos en dos columnas si hace falta; cada heroe ocupa 28 x 44 pixeles de arte
    const COLS = 10, HW = 28, HH = 46, GAP = 30;
    const groups = accounts.map(a => ({ a, items: (by[a.id] || []).sort((x, y) => (x._k === y._k ? 0 : x._k === 'app' ? -1 : 1)) }))
      .filter(g => g.items.length).sort((x, y) => y.items.length - x.items.length);
    groups.forEach(g => { const n = g.items.length; g.cols = Math.min(COLS, n); g.rows = Math.ceil(n / COLS); g.w = g.cols * HW + 40; g.h = g.rows * HH + 28; });
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
      this.groups.set(g.a.id, g);
    });
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
      case 'mail': if (e.dir === 'bounce') this.combat(this.guard.x + 60, this.guard.y - 20, 'Carta rebotada', '#ff9a4d', 22); return;
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
    this.flushT = (this.flushT || 0) - dt;
    if (this.flushT <= 0) {
      this.flushT = 0.5;
      for (const [id, n] of this.pending) { const h = this.heroes.get(id); if (h && !h.dead) { this.combat(h.x + (Math.random() - 0.5) * 12, h.y - 24, `+${n}`, h.data.bot ? '#b5b5b5' : '#6dff7a', n > 4 ? 26 : 20); h.flash = 0.6; } }
      this.pending.clear();
    }
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
      const txt = waiting ? 'Espera su permiso' : p.s.state === 'idle' ? 'Descansando' : (p.s.activity || '');
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
    for (const gr of this.groups.values()) { const p = toS(gr.labelPos); gr.label.scale.set(ts); gr.sub.scale.set(ts); gr.label.x = p.x; gr.label.y = p.y; gr.sub.x = p.x + gr.label.width + 14 * ts; gr.sub.y = p.y - 2 * ts; }
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
