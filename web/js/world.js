// Mundo isometrico de Atalaya (PixiJS v8)
import { Application, Container, Graphics, Text, Sprite, Rectangle, Polygon } from '../vendor/pixi.csp.mjs';
import { px } from './pixicons.js';
import { robotTextures, monoTextures, iconTexture, signTexture, carTexture, suspectTexture, INVADER, ENVELOPE } from './sprites.js';
import { STATION_TIPS } from './tips.js';
import { esc, fmtBytes } from './hud.js';
import { accountCaption, forEdition } from './accounts.js';
import { healthLine } from './layout.js';
import { pixiScreen } from './commfx.js';

const TW = 64, TH = 32; // tile isometrico
const iso = (gx, gy) => ({ x: (gx - gy) * TW / 2, y: (gx + gy) * TH / 2 });
const lerp = (a, b, t) => a + (b - a) * t;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hex = s => parseInt(String(s).replace('#', ''), 16);
function mix(c1, c2, t) {
  const r = lerp((c1 >> 16) & 255, (c2 >> 16) & 255, t), g = lerp((c1 >> 8) & 255, (c2 >> 8) & 255, t), b = lerp(c1 & 255, c2 & 255, t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b);
}
const STATIONS = ['desk', 'library', 'workshop', 'terminal', 'antenna', 'portal'];
// nombre visible de cada estacion (lo que esta haciendo el agente que se para ahi)
// ancho de una fila de estaciones: 6 estaciones a 92 px, mas el robot al costado y los nombres
const STATION_GAP = 92, STATION_ROW = STATION_GAP * 5 + 160;
const STATION_NAME = { desk: 'En pausa', library: 'Leyendo', workshop: 'Editando', terminal: 'Terminal', antenna: 'Web', portal: 'Subagentes' };
const STATUS_COLOR = { online: 0x22c55e, degraded: 0xf59e0b, down: 0xef4444 };
const PIXEL_FONT = { fontFamily: 'Silkscreen, monospace' };
const UI_FONT = { fontFamily: 'Space Grotesk, system-ui, sans-serif' };

function label(text, size, color = 0xe6edf7, font = PIXEL_FONT) {
  const t = new Text({ text, style: { ...font, fontSize: size, fill: color, align: 'center' }, resolution: 3 });
  t.anchor.set(0.5, 0.5);
  return t;
}

// ------------------------------------------------------------ edificio (app PM2)
// caja isometrica con el mismo estilo de los edificios (caras con luz y sombra, techo con borde); para la
// carcel, la oficina de correos y lo que venga. opts: bars (rejas en las caras), windows (ventanas), roof (color).
function isoBox(g, hw, hh, h, color, opts = {}) {
  const top = opts.roof != null ? opts.roof : mix(color, 0xffffff, 0.15);
  const left = mix(color, 0x000000, 0.35), right = mix(color, 0x000000, 0.12);
  g.poly([0, -hh + 6, hw + 6, 6, 0, hh + 6, -hw - 6, 6]).fill({ color: 0x000000, alpha: 0.35 });
  g.poly([-hw, 0, 0, hh, 0, hh - h, -hw, -h]).fill(left);
  g.poly([0, hh, hw, 0, hw, -h, 0, hh - h]).fill(right);
  g.poly([0, -hh - h, hw, -h, 0, hh - h, -hw, -h]).fill(top).stroke({ width: 1, color: mix(top, 0xffffff, 0.3), alpha: 0.6 });
  if (opts.windows) for (let r = 0; r < opts.windows; r++) for (let c = 0; c < 3; c++) for (const side of [-1, 1]) {
    const t0 = 0.16 + c * 0.26, t1 = t0 + 0.14, yy = -h + 8 + r * 10;
    const x0 = side * hw * (1 - t0), x1 = side * hw * (1 - t1), y0 = yy + hh * t0, y1 = yy + hh * t1;
    g.poly([x0, y0, x1, y1, x1, y1 + 5, x0, y0 + 5]).fill({ color: opts.lit ? 0xfff3c4 : 0x67e8f9, alpha: 0.85 });
  }
  if (opts.bars) for (const side of [-1, 1]) for (let k = 1; k < 8; k++) {
    const t = k / 8, x = side * hw * (1 - t), y = hh * t;
    g.moveTo(x, y - 4).lineTo(x, y - h + 6);
  }
  if (opts.bars) g.stroke({ width: 2, color: 0xcbd5e1, alpha: 0.9 });
}
// silo de datos (cilindro isometrico): cuerpo con luz y sombra, bandas, tapa. opts: active (0-1, anillo que late),
// hot (rojo: conexiones al limite), sleep (anillos tenues: conexiones dormidas), paused (gris, tapa cerrada),
// fill (0-1, linea de llenado: disco usado)
function drawSilo(g, r, h, color, opts = {}, t = 0) {
  const ry = r * 0.5;
  const body = opts.paused ? 0x4b5563 : opts.hot ? mix(color, 0xef4444, 0.55) : color;
  const left = mix(body, 0x000000, 0.35), right = mix(body, 0x000000, 0.1), top = opts.paused ? 0x6b7280 : mix(body, 0xffffff, 0.25);
  g.ellipse(0, 4, r + 6, ry + 4).fill({ color: 0x000000, alpha: 0.35 });
  if (opts.sleep) for (let k = 1; k <= Math.min(3, opts.sleep); k++) g.ellipse(0, 0, r + 6 + k * 7, ry + 3 + k * 3.5).stroke({ width: 1, color: 0x94a3b8, alpha: 0.18 });
  g.rect(-r, -h, r, h).fill(left); g.rect(0, -h, r, h).fill(right);
  g.ellipse(0, 0, r, ry).fill(right);
  g.rect(-r, -h, r, 1).fill(left);
  for (let y = -h + 12; y < -4; y += 12) g.moveTo(-r, y).bezierCurveTo(-r * 0.5, y + ry * 0.9, r * 0.5, y + ry * 0.9, r, y);
  g.stroke({ width: 1.5, color: mix(body, 0x000000, 0.5), alpha: 0.7 });
  if (opts.fill != null) { const y = -h * Math.min(1, opts.fill); g.moveTo(-r, y).bezierCurveTo(-r * 0.5, y + ry * 0.9, r * 0.5, y + ry * 0.9, r, y).stroke({ width: 2.5, color: opts.fill > 0.85 ? 0xef4444 : 0xfde68a, alpha: 0.9 }); }
  g.ellipse(0, -h, r, ry).fill(top).stroke({ width: 1, color: mix(top, 0xffffff, 0.3), alpha: 0.7 });
  if (opts.paused) g.rect(-r * 0.6, -h - 2, r * 1.2, 3).fill(0x374151); // tapa cerrada
  else if (opts.active) { const p = 0.5 + 0.5 * Math.sin(t * 6); g.ellipse(0, -h, r * (0.55 + 0.25 * p), ry * (0.55 + 0.25 * p)).fill({ color: 0xa5f3fc, alpha: 0.35 + 0.4 * opts.active }); }
}

// parcela chica (mini distrito) bajo un edificio especial
function isoPlate(g, hw, hh, color) {
  g.poly([0, -hh, hw, 0, 0, hh, -hw, 0]).fill({ color: mix(color, 0x060a14, 0.86) }).stroke({ width: 2, color, alpha: 0.55 });
  g.poly([-hw, 0, 0, hh, 0, hh + 8, -hw, 8]).fill(mix(color, 0x000000, 0.8));
  g.poly([0, hh, hw, 0, hw, 8, 0, hh + 8]).fill(mix(color, 0x000000, 0.7));
}

class Building extends Container {
  constructor(app, color, isSite = false) {
    super();
    this.isSite = isSite;
    this.fp = isSite ? 0.62 : 1; // huella relativa
    this.appId = app.id;
    this.color = hex(color);
    this.h = 30; this.targetH = 30; this.heat = 0; this.targetHeat = 0;
    this.status = 'online'; this.flash = 0; this.lit = new Set(); this.activity = 0;
    this.glow = new Graphics(); this.g = new Graphics(); this.beacon = new Graphics();
    // letrero: icono de categoria + que es (y el nombre real en modo privado)
    this.sign = new Container();
    this.signBg = new Graphics();
    this.signIcon = new Sprite(signTexture('web')); this.signIcon.anchor.set(0, 0.5); this.signIcon.scale.set(2.2);
    this.signMain = new Text({ text: '', style: { ...UI_FONT, fontSize: 15, fill: 0xe6edf7, fontWeight: '600' }, resolution: 3 });
    this.signSub = new Text({ text: '', style: { ...UI_FONT, fontSize: 11, fill: 0x8a9ab3 }, resolution: 3 });
    this.signMain.anchor.set(0, 0.5); this.signSub.anchor.set(0, 0.5);
    this.sign.addChild(this.signBg, this.signIcon, this.signMain, this.signSub);
    this.addChild(this.glow, this.g, this.beacon); // el letrero va en la capa de etiquetas del mundo
    this.update(app);
  }
  update(app) {
    this.app = app;
    const mb = (app.mem || 0) / 1048576;
    this.targetH = app.source === 'supabase' ? 28 + clamp(Math.log2(1 + ((app.sb && app.sb.size) || 0) / 1048576) * 7, 0, 70)
      : this.isSite ? 14 + clamp(Math.log2(1 + (app.reqMin || 0)) * 7, 0, 36)
      : 26 + clamp(Math.log2(Math.max(mb, 16) / 16) * 13, 0, 90);
    this.targetHeat = clamp((app.cpu || 0) / 80, 0, 1);
    this.status = app.status;
    this.activity = app.reqMin || 0;
    const main = app.name || app.kind || '';
    const sub = app.kind && app.kind !== main ? app.kind : '';
    if (this.signMain.text !== main || this.signSub.text !== sub || this.signIconName !== app.icon) this.setSign(main, sub, app.icon);
    this.redraw();
  }
  setSign(main, sub, icon) {
    this.signIconName = icon;
    if (this.full === false) { this.signMain.text = main; this.signSub.text = sub; this.signIcon.texture = signTexture(icon || 'web'); return; }
    this.signIcon.texture = signTexture(icon || 'web');
    this.signMain.text = main; this.signSub.text = sub;
    const iw = 22, gap = 7, padX = 9;
    const tw = Math.max(this.signMain.width, this.signSub.width);
    const w = padX * 2 + iw + gap + tw, h = sub ? 40 : 30;
    const x0 = -w / 2;
    this.signIcon.x = x0 + padX; this.signIcon.y = 0;
    this.signMain.x = this.signSub.x = x0 + padX + iw + gap;
    this.signMain.y = sub ? -7 : 0; this.signSub.y = 10;
    this.signBg.clear().roundRect(x0, -h / 2, w, h, 8).fill({ color: 0x0a1122, alpha: 0.88 })
      .stroke({ width: 1.5, color: this.color, alpha: 0.55 });
  }
  // detalle completo de cerca; de lejos solo el icono, con tamano constante en pantalla
  setDetail(full, camScale) {
    if (full !== this.full) {
      this.full = full;
      this.signMain.visible = this.signSub.visible = full;
      if (full) this.setSign(this.signMain.text, this.signSub.text, this.signIconName);
      else {
        this.signIcon.x = -11; this.signIcon.y = 0;
        this.signBg.clear().roundRect(-17, -16, 34, 32, 8).fill({ color: 0x0a1122, alpha: 0.9 }).stroke({ width: 1.5, color: this.color, alpha: 0.6 });
      }
    }
    this.sign.scale.set(full ? 1 : clamp(0.62 / camScale, 1, 2.2));
  }
  pulse() { this.flash = 1; }
  // proyecto de Supabase: silo verde; altura = tamano de la base, luces de la tapa = conexiones activas, linea de
  // llenado = disco usado, gris con la tapa cerrada si esta pausado o no responde
  redrawSilo() {
    const g = this.g; g.clear(); this.glow.clear(); this.beacon.visible = false; // el silo no lleva la antena de los edificios
    const sb = this.app.sb || {};
    drawSilo(g, 22, this.h, 0x3ecf8e, { paused: this.status === 'down', fill: sb.disk != null ? sb.disk / 100 : null });
    const n = Math.min(12, sb.conns || 0);
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; g.rect(Math.cos(a) * 15 - 1.5, -this.h + Math.sin(a) * 7 - 1.5, 3, 3).fill({ color: i < n ? 0xa7f3d0 : 0x14532d, alpha: i < n ? 1 : 0.8 }); }
    this.hitArea = new Polygon([-26, 8, 26, 8, 26, -this.h - 16, -26, -this.h - 16]);
    this.windows = 1;
  }
  redraw() {
    if (this.app && this.app.source === 'supabase') return this.redrawSilo();
    const g = this.g; g.clear();
    const hw = TW * this.fp, hh = TH * this.fp, h = this.h; // huella 2x2 tiles (sitios: menor)
    const down = this.status === 'down';
    const base = down ? 0x374151 : mix(this.color, 0x0b1222, 0.55);
    const hot = mix(base, 0xf97316, this.heat * 0.8);
    const top = mix(down ? 0x4b5563 : mix(this.color, 0xffffff, this.isSite ? 0.45 : 0.1), 0xfb923c, this.heat);
    const left = mix(hot, 0x000000, 0.35), right = mix(hot, 0x000000, 0.12);
    // base / sombra
    g.poly([0, -hh + 6, hw + 6, 6, 0, hh + 6, -hw - 6, 6]).fill({ color: 0x000000, alpha: 0.35 });
    // caras
    g.poly([-hw, 0, 0, hh, 0, hh - h, -hw, -h]).fill(left);
    g.poly([0, hh, hw, 0, hw, -h, 0, hh - h]).fill(right);
    g.poly([0, -hh - h, hw, -h, 0, hh - h, -hw, -h]).fill(top).stroke({ width: 1, color: mix(top, 0xffffff, 0.3), alpha: 0.6 });
    // ventanas: filas en ambas caras
    const rows = Math.floor((h - 10) / 9);
    let idx = 0;
    for (let r = 0; r < rows; r++) {
      const yy = -h + 8 + r * 9;
      for (let c = 0; c < 4; c++) {
        for (const side of [-1, 1]) {
          const t0 = 0.12 + c * 0.21, t1 = t0 + 0.12;
          const x0 = side * hw * (1 - t0), x1 = side * hw * (1 - t1);
          const y0 = yy + hh * t0, y1 = yy + hh * t1;
          const on = !down && this.lit.has(idx);
          g.poly([x0, y0, x1, y1, x1, y1 + 4, x0, y0 + 4]).fill({ color: on ? 0xfff3c4 : 0x0b1222, alpha: on ? 0.95 : 0.55 });
          idx++;
        }
      }
    }
    this.windows = idx;
    this.hitArea = new Polygon([-hw, 0, 0, hh, hw, 0, hw, -h - 30, 0, -hh - h - 30, -hw, -h - 30]);
    // brillo por calor/actividad
    this.glow.clear();
    const ga = this.flash * 0.6 + this.heat * 0.25;
    if (ga > 0.02) this.glow.ellipse(0, hh - h / 2, hw * 1.5, h / 1.4 + hh).fill({ color: this.flash > 0.05 ? 0xffffff : 0xf97316, alpha: ga * 0.35 });
  }
  tick(dt, t) {
    let dirty = false;
    if (Math.abs(this.h - this.targetH) > 0.3) { this.h = lerp(this.h, this.targetH, 1 - Math.pow(0.02, dt)); dirty = true; }
    if (Math.abs(this.heat - this.targetHeat) > 0.01) { this.heat = lerp(this.heat, this.targetHeat, 1 - Math.pow(0.05, dt)); dirty = true; }
    if (this.flash > 0) { this.flash = Math.max(0, this.flash - dt * 1.5); dirty = true; }
    // parpadeo de ventanas segun trafico
    this.winT = (this.winT || 0) + dt;
    if (this.winT > 0.6) {
      this.winT = 0;
      const want = clamp(Math.round((this.windows || 8) * (0.15 + Math.min(this.activity, 60) / 80)), 1, this.windows || 8);
      const s = new Set([...this.lit].filter(() => Math.random() > 0.25));
      while (s.size < want) s.add(Math.floor(Math.random() * (this.windows || 8)));
      while (s.size > want) s.delete([...s][0]);
      this.lit = s; dirty = true;
    }
    if (dirty) this.redraw();
    // baliza de estado en el techo
    const b = this.beacon; b.clear();
    const on = this.status === 'online' ? 0.5 + 0.5 * Math.sin(t * 2) : (Math.sin(t * 8) > 0 ? 1 : 0.15);
    b.rect(-1, -this.h - TH - 10, 2, 10).fill(0x94a3b8);
    b.circle(0, -this.h - TH - 12, 3).fill({ color: STATUS_COLOR[this.status] || 0x94a3b8, alpha: 0.4 + 0.6 * on });
    b.circle(0, -this.h - TH - 12, 7).fill({ color: STATUS_COLOR[this.status] || 0x94a3b8, alpha: 0.18 * on });
  }
  roof() { return { x: this.x, y: this.y - this.h }; }
}

// ------------------------------------------------------------ robot (sesion de Claude)
class Robot extends Container {
  constructor(color, small = false) {
    super();
    this.tex = robotTextures(color);
    this.shadow = new Graphics().ellipse(0, 0, 18, 7).fill({ color: 0x000000, alpha: 0.4 });
    this.sprite = new Sprite(this.tex.idle[0]);
    this.sprite.anchor.set(0.5, 1);
    this.sprite.scale.set(small ? 2.8 : 4);
    this.bubble = new Container();
    this.bubbleBg = new Graphics();
    this.bubbleText = new Text({ text: '', style: { ...UI_FONT, fontSize: 19, fill: 0x0b1020, fontWeight: '600' }, resolution: 3 });
    this.bubbleText.anchor.set(0.5, 0.5);
    this.bubble.addChild(this.bubbleBg, this.bubbleText);
    this.bubble.y = -this.sprite.height - 30;
    this.bubble.alpha = 0;
    this.mark = label('', small ? 16 : 22, 0xfbbf24);
    this.mark.y = -this.sprite.height - 4;
    this.addChild(this.shadow, this.sprite, this.mark, this.bubble);
    this.target = null; this.anim = 'idle'; this.frame = 0; this.ft = 0; this.state = 'idle';
    this.bubbleTTL = 0; this.bob = Math.random() * 6; this.beam = 0;
  }
  say(text, secs = 5, bg = 0xf8fafc) {
    if (!text) return;
    const s = text.length > 42 ? text.slice(0, 41) + '…' : text;
    this.bubbleText.text = s;
    const w = this.bubbleText.width + 24, h = 32;
    this.bubbleBg.clear().roundRect(-w / 2, -h / 2, w, h, 10).fill({ color: bg, alpha: 0.95 })
      .poly([-7, h / 2 - 1, 7, h / 2 - 1, 0, h / 2 + 9]).fill({ color: bg, alpha: 0.95 });
    this.bubbleTTL = secs;
  }
  moveTo(p) { this.target = p; }
  tick(dt, t) {
    this.ft += dt;
    let anim = 'idle';
    if (this.target) {
      const dx = this.target.x - this.x, dy = this.target.y - this.y, d = Math.hypot(dx, dy);
      if (d < 2) { this.target = null; }
      else {
        const sp = Math.min(d, 140 * dt);
        this.x += dx / d * sp; this.y += dy / d * sp; anim = 'walk';
        if (Math.abs(dx) > 1) this.sprite.scale.x = Math.abs(this.sprite.scale.x) * (dx < 0 ? -1 : 1);
      }
    }
    if (anim !== 'walk') anim = this.state === 'working' ? 'work' : this.state === 'waiting' ? 'wave' : this.state === 'idle' ? 'sit' : 'idle';
    const rate = anim === 'walk' ? 0.18 : anim === 'work' ? 0.14 : anim === 'wave' ? 0.35 : 1.8;
    if (anim !== this.anim) { this.anim = anim; this.frame = 0; this.ft = 0; }
    if (this.ft > rate) { this.ft = 0; this.frame = (this.frame + 1) % this.tex[anim].length; }
    // parpadeo: el frame 1 de idle/sit dura poco
    const f = (anim === 'idle' || anim === 'sit') && this.frame === 1 && this.ft > 0.15 ? 0 : this.frame;
    this.sprite.texture = this.tex[anim][f];
    this.sprite.y = anim === 'idle' || anim === 'sit' ? Math.sin(t * 2 + this.bob) * 1.2 : 0;
    // marca de estado sobre la cabeza
    const m = this.state === 'thinking' ? '.'.repeat(1 + Math.floor(t * 3) % 3) : this.state === 'waiting' ? '!' : this.state === 'idle' ? 'z' : '';
    if (this.mark.text !== m) this.mark.text = m;
    this.mark.alpha = this.state === 'waiting' ? 0.5 + 0.5 * Math.sin(t * 8) : 1;
    this.mark.y = -this.sprite.height - 4 + (this.state === 'idle' ? -Math.abs(Math.sin(t)) * 6 : 0);
    if (this.bubbleTTL > 0) { this.bubbleTTL -= dt; this.bubble.alpha = Math.min(1, this.bubble.alpha + dt * 5); }
    else this.bubble.alpha = Math.max(0, this.bubble.alpha - dt * 2);
    if (this.beam > 0) { this.beam -= dt; this.sprite.alpha = 1 - this.beam; }
    if (!this.halo) { this.halo = new Graphics(); this.addChildAt(this.halo, 0); }
    this.halo.clear();
    if (this.state === 'waiting') {
      const a = 0.5 + 0.5 * Math.sin(t * 5);
      this.halo.ellipse(0, 0, 30 + a * 6, 12 + a * 3).stroke({ width: 3, color: 0xfbbf24, alpha: 0.4 + 0.5 * a })
        .rect(-3, -170, 6, 110).fill({ color: 0xfbbf24, alpha: 0.12 + 0.18 * a });
    }
    this.zIndex = this.y;
  }
}

// ------------------------------------------------------------ mundo
export class World {
  // interfaz de un mundo de tema: init, update(state), onEvent(e, priv), pick, clearSelection, setDirector,
  // resetView, zoomBy, setInsets, destroy; avisa por onSelect, onTip y onNav
  constructor(el) {
    this.el = el;
    this.districts = new Map(); // cuenta -> distrito
    this.buildings = new Map(); // app id -> Building
    this.robots = new Map(); // sid o sid/agent -> Robot
    this.fx = []; // efectos con tick propio
    this.t = 0;
    this.layoutKey = '';
    this.directorOn = true;
    this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
  }

  async init() {
    // escuchas globales atadas a este mundo: al cambiar de tema se quitan todas juntas
    this.ac = new AbortController();
    const sig = { signal: this.ac.signal };
    this.sig = sig;
    this.app = new Application();
    await this.app.init({ resizeTo: this.el, backgroundAlpha: 0, antialias: true, autoDensity: true, resolution: Math.min(window.devicePixelRatio || 1, 2), preference: 'webgl' });
    this.el.appendChild(this.app.canvas);
    this.cam = new Container();
    this.stars = new Graphics();
    this.ground = new Container();
    this.roads = new Graphics();
    this.scene = new Container(); this.scene.sortableChildren = true;
    this.fxLayer = new Container();
    this.labels = new Container();
    this.signs = new Container(); // letreros encima de todos los edificios
    this.pipes = new Graphics(); // tuberias de datos (silo -> sitio), se redibujan cada cuadro con sus pulsos
    this.silos = new Map(); // cuenta -> silo de sus bases
    this.cam.addChild(this.ground, this.roads, this.pipes, this.scene, this.signs, this.fxLayer, this.labels);
    this.app.stage.addChild(this.stars, this.cam);
    this.makeStars();
    this.buildHQ();
    // Pixi v8: el escenario debe ser interactivo para que los clics lleguen a sus hijos
    this.app.stage.eventMode = 'static';
    this.app.stage.hitArea = this.app.screen;
    this.selG = new Graphics();
    this.ground.addChild(this.selG);
    this.setupNav();
    this.app.ticker.add(tk => this.tick(tk.deltaMS / 1000));
    window.addEventListener('resize', () => { this.makeStars(); this.fit(); }, sig);
  }

  // al cambiar de tema: quita escuchas, canvas y objetos (las texturas compartidas quedan en cache)
  // donde esta cada cosa en la pantalla (para la comunicacion entre agentes, web/js/commfx.js)
  screenOf(kind, id) {
    if (kind === 'gate') return pixiScreen(this.app, this.hwBar); // el peaje: de ahi salen los sondeos
    if (kind === 'tower') return this.hq ? pixiScreen(this.app, this.hq.c) : null; // de aqui salen las patrullas
    if (kind === 'jail') return this.jail && this.jail.c.visible ? pixiScreen(this.app, this.jail.c) : null; // aqui dejan a los bloqueados
    if (kind === 'session' || kind === 'agent') return pixiScreen(this.app, this.robots.get(id));
    return pixiScreen(this.app, this.buildings.get(id));
  }

  destroy() {
    this.ac.abort();
    this.app.destroy({ removeView: true }, { children: true });
  }

  setInsets(ins) { this.insets = ins; this.fit(); }

  makeStars() {
    const g = this.stars; g.clear();
    const w = this.app.screen.width, h = this.app.screen.height;
    this.starList = Array.from({ length: 160 }, () => ({ x: Math.random() * w, y: Math.random() * h, r: Math.random() * 1.4 + 0.3, p: Math.random() * 6 }));
  }

  // --- torre de control (Apache/root) en el centro
  buildHQ() {
    const hq = new Container();
    const shield = new Graphics();
    const tower = new Graphics();
    const radar = new Graphics();
    const plate = new Graphics();
    const S = 2.2; // huella
    plate.poly([0, -TH * S, TW * S, 0, 0, TH * S, -TW * S, 0]).fill({ color: 0x0f1a30 }).stroke({ width: 2, color: 0x334155 });
    for (let i = 1; i < 4; i++) {
      const k = i / 4;
      plate.poly([0, -TH * S * k, TW * S * k, 0, 0, TH * S * k, -TW * S * k, 0]).stroke({ width: 1, color: 0x1e293b });
    }
    const hw = TW * 0.9, hh = TH * 0.9, h = 150;
    tower.poly([-hw, 0, 0, hh, 0, hh - h, -hw, -h]).fill(0x1e293b);
    tower.poly([0, hh, hw, 0, hw, -h, 0, hh - h]).fill(0x334155);
    tower.poly([0, -hh - h, hw, -h, 0, hh - h, -hw, -h]).fill(0x64748b);
    for (let y = -h + 14; y < -8; y += 14) {
      tower.poly([-hw + 6, y + 3, -6, y + hh - 3, -6, y + hh + 1, -hw + 6, y + 7]).fill({ color: 0x22d3ee, alpha: 0.5 });
      tower.poly([6, y + hh - 3, hw - 6, y + 3, hw - 6, y + 7, 6, y + hh + 1]).fill({ color: 0x22d3ee, alpha: 0.35 });
    }
    // mastil
    tower.rect(-2, -h - hh - 40, 4, 40).fill(0x94a3b8);
    radar.y = -h - hh - 40;
    const name = label('TORRE DE CONTROL', 20, 0xe6edf7); this.hqName = name;
    name.y = TH * S + 26;
    this.hqTag = label('apache · mariadb · exim', 13, 0x6b7a93);
    this.hqTag.y = TH * S + 50;
    // salud del servidor bajo la torre (respaldos, actualizaciones, correo, cron, puertos)
    this.hqHealth = label('', 14, 0x4ade80, UI_FONT);
    this.hqHealth.y = TH * S + 72;
    hq.addChild(shield, plate, tower, radar, name, this.hqTag, this.hqHealth);
    hq.zIndex = 0;
    this.hq = { c: hq, shield, radar, h, rx: 190, ry: 105, flash: 0, heat: 0 };
    this.scene.addChild(hq);
    this.tappable(hq, new Rectangle(-170, -h - 100, 340, h + 170), () => this.pick('system', 'root'));
    this.hoverTip(hq, () => ({ title: 'Torre de control', body: 'El <b>servidor</b>: Apache recibe todo el tráfico y lo reparte a cada distrito. El <b>escudo</b> se enciende cuando repele un ataque.',
      meta: (this.state?.system ? `CPU ${this.state.system.cpu.toFixed(0)}% · RAM ${this.state.system.mem.pct.toFixed(0)}% · carga ${this.state.system.load[0].toFixed(2)}` : '')
        + (this.state?.keys?.length ? `<br>${this.state.keys.map(k => px(k.state === 'active' ? 'dotG' : k.state === 'failed' ? 'dotR' : 'dotS') + ' ' + esc(k.label)).join(' · ')}` : ''),
      hint: 'Clic para ver el servidor completo' }));
    this.buildHighway(h);
    this.stations = new Map(); // cuenta -> {name: point}
    // debajo del nombre, los servicios y la linea de salud (que termina en TH * S + 80)
    this.stations.set('root', this.makeStations(null, { x: 0, y: TH * S + 150 }));
  }

  makeStations(d, origin) {
    // fila de 6 estaciones en el frente de la parcela, cada una con su nombre debajo: se entiende que hace
    // cada agente sin pasar el mouse. Vacia queda tenue; ocupada se enciende (anillo, icono y nombre).
    const pts = {}, items = {};
    const cont = new Container();
    STATIONS.forEach((s, i) => {
      const p = { x: origin.x + (i - 2.5) * STATION_GAP, y: origin.y + (i % 2) * 8 };
      pts[s] = p;
      const pad = new Graphics().ellipse(0, 0, 28, 12).fill({ color: 0x0f172a, alpha: 0.9 }).stroke({ width: 1, color: 0x334155 });
      const ring = new Graphics().ellipse(0, 0, 32, 14).stroke({ width: 3, color: 0x22d3ee });
      const ic = new Sprite(iconTexture(s)); ic.anchor.set(0.5, 1); ic.scale.set(3.6);
      const name = label(STATION_NAME[s], 13, 0x8a9ab3, UI_FONT);
      pad.x = ring.x = ic.x = name.x = p.x; pad.y = ring.y = p.y; ic.y = p.y - 2; name.y = p.y + 24;
      ring.alpha = 0; ic.alpha = 0.55; name.alpha = 0.6;
      this.hoverTip(ic, () => ({ title: STATION_TIPS[s][0], body: STATION_TIPS[s][1] }));
      cont.addChild(ring, pad, ic, name);
      items[s] = { ring, ic, name, on: false };
    });
    this.ground.addChild(cont);
    return { pts, cont, items };
  }

  // estaciones ocupadas: se encienden con el color de quien las usa
  lightStations(occupancy) {
    for (const [acc, st] of this.stations) {
      if (!st.items) continue;
      for (const [s, it] of Object.entries(st.items)) {
        const on = occupancy.has(acc + '/' + s) || (s === 'desk' && occupancy.has(acc + '/waiting'));
        const wait = s === 'desk' && occupancy.has(acc + '/waiting');
        if (on === it.on && wait === it.wait) continue;
        it.on = on; it.wait = wait;
        it.ic.alpha = on ? 1 : 0.55;
        it.name.alpha = on ? 1 : 0.6;
        it.name.style.fill = on ? (wait ? 0xfbbf24 : 0xf1f5f9) : 0x8a9ab3;
        it.name.text = wait ? 'Espera su respuesta' : STATION_NAME[s];
        it.ring.clear().ellipse(0, 0, 32, 14).stroke({ width: 3, color: wait ? 0xfbbf24 : on ? hex(this.colorOf(acc === 'root' ? 'root' : acc)) : 0x22d3ee });
        it.ring.alpha = on ? 0.9 : 0;
      }
    }
  }

  // Autopista desde Internet: baja desde fuera del mapa hasta la torre. En el peaje (el firewall) la barrera
  // se levanta para las visitas y los ataques revientan contra ella. Pixel en autos, caseta e invasores;
  // carteles con texto nitido.
  buildHighway(h) {
    const top = -h - 3000, toll = -h - 190; // la autopista sale siempre por arriba de la pantalla
    this.gate = { x: 0, y: toll - 40 }; // entrada de las visitas (justo antes del peaje)
    this.hw = { top, toll, laneIn: 9, laneAtk: -9, bar: 0, barHit: 0 };
    const g = new Graphics();
    // asfalto, bordes y linea central discontinua
    g.rect(-26, top, 52, toll - top + 30).fill(0x0b1222);
    g.rect(-28, top, 3, toll - top + 30).fill({ color: 0x334155, alpha: 0.9 }).rect(25, top, 3, toll - top + 30).fill({ color: 0x334155, alpha: 0.9 });
    for (let y = top; y < toll - 10; y += 28) g.rect(-1.5, y, 3, 14).fill({ color: 0xfbbf24, alpha: 0.55 });
    // tramo final hasta la torre
    g.rect(-12, toll + 30, 24, -h - 20 - (toll + 30) + 20).fill(0x0b1222);
    // caseta de peaje: techo, cabina con ventanilla y luz
    const booth = new Graphics();
    booth.rect(-52, -30, 20, 26).fill(0x1e293b).stroke({ width: 1, color: 0x475569 });
    booth.rect(-49, -24, 14, 8).fill(0x67e8f9);
    booth.rect(-58, -36, 32, 6).fill(0x334155);
    booth.rect(-60, -40, 120, 4).fill({ color: 0x22d3ee, alpha: 0.35 }); // marquesina
    booth.rect(32, -30, 20, 26).fill(0x1e293b).stroke({ width: 1, color: 0x475569 });
    booth.rect(35, -24, 14, 8).fill(0x67e8f9);
    booth.rect(26, -36, 32, 6).fill(0x334155);
    booth.x = 0; booth.y = toll;
    // barrera (brazo a rayas): se dibuja en cada cuadro segun este arriba o abajo
    this.hwBar = new Graphics(); this.hwBar.x = -32; this.hwBar.y = toll - 8;
    const sign = label('AUTOPISTA · INTERNET', 15, 0x8a9ab3, UI_FONT); sign.x = 0; sign.y = toll - 250;
    const tollName = label('PEAJE · FIREWALL', 13, 0x67e8f9, UI_FONT); tollName.x = 0; tollName.y = toll + 18;
    this.ground.addChild(g);
    this.labels.addChild(booth, this.hwBar, sign, tollName);
    this.tappable(booth, new Rectangle(-64, -44, 128, 60), () => this.pick('security', 'all'));
    this.buildJail(toll);
    this.buildPost(toll);
    this.hoverTip(booth, () => ({ title: 'Peaje · firewall', body: 'Por la autopista llegan las visitas desde Internet: autos <b>cian</b> (personas), <b>grises</b> (robots), <b>ámbar</b> (error del visitante) y <b>rojos</b> (error del servidor). Los <b>invasores</b> son intentos de acceso: revientan contra la barrera.', hint: 'Clic para ver la defensa' }));
  }

  // Carcel, junto a la autopista antes del peaje: las IPs bloqueadas (a mano en el firewall y por la defensa de
  // Atalaya). Rejas y un auto oscuro por preso; hasta 6 a la vista y el total en el cartel.
  buildJail(toll) {
    const c = new Container(); c.x = 124; c.y = toll - 150;
    const g = new Graphics();
    isoPlate(g, 78, 42, 0x94a3b8);
    // patio cercado adelante (donde quedan los presos) y el edificio con rejas atras
    const yard = new Graphics();
    yard.poly([6, 2, 52, 22, 6, 42, -40, 22]).stroke({ width: 1.5, color: 0x94a3b8, alpha: 0.7 });
    for (let k = 0; k <= 6; k++) { const t = k / 6; yard.moveTo(6 + 46 * t, 2 + 20 * t).lineTo(6 + 46 * t, 2 + 20 * t - 7); yard.moveTo(6 - 46 * t, 2 + 20 * t).lineTo(6 - 46 * t, 2 + 20 * t - 7); }
    yard.stroke({ width: 1.5, color: 0x94a3b8, alpha: 0.7 });
    const box = new Graphics(); box.x = -18; box.y = -8;
    isoBox(box, 30, 16, 38, 0x475569, { bars: true, roof: 0x64748b });
    const cars = new Container();
    const sign = label('CÁRCEL', 12, 0xfca5a5, UI_FONT); sign.y = -78;
    const count = label('', 11, 0x94a3b8, UI_FONT); count.y = 58;
    c.addChild(g, box, yard, cars, sign, count);
    this.labels.addChild(c);
    this.jail = { c, cars, sign, count, n: -1 };
    this.drawJail(0);
    this.tappable(c, new Rectangle(-80, -90, 160, 160), () => this.pick('jail', 'all'));
    this.hoverTip(c, () => ({ title: 'Cárcel', body: 'Las IPs <b>bloqueadas</b>: las que se bloquearon a mano en el firewall y las que bloqueó la defensa de Atalaya. Las patrullas traen aquí a cada una.', meta: `${Math.max(0, this.jail.n)} preso(s)`, hint: 'Clic para ver cada una' }));
  }
  // Oficina de correos, frente a la carcel: por aqui pasa todo el correo. Buzon, contador del ultimo minuto y
  // una pila de sobres si la cola de correo se atasca.
  buildPost(toll) {
    const c = new Container(); c.x = -124; c.y = toll - 150;
    const g = new Graphics();
    isoPlate(g, 78, 42, 0xfbbf24);
    const box = new Graphics(); box.y = -4;
    isoBox(box, 34, 18, 34, 0x9a3412, { windows: 2, lit: true, roof: 0xfbbf24 });
    // buzon rojo en el frente
    const mb = new Graphics(); mb.x = 40; mb.y = 14;
    isoBox(mb, 6, 3, 14, 0xdc2626, { roof: 0xef4444 });
    mb.rect(-1, 0, 2, 8).fill(0x475569);
    const env = new Sprite(monoTextures([ENVELOPE], '#fde68a')[0]); env.anchor.set(0.5); env.scale.set(1.8); env.y = -58;
    const pile = new Container();
    const sign = label('CORREO', 12, 0xfde68a, UI_FONT); sign.y = -84;
    const count = label('', 10, 0x94a3b8, UI_FONT); count.y = 58;
    c.addChild(g, box, mb, pile, env, sign, count);
    this.labels.addChild(c);
    this.post = { c, pile, count, env, log: [], queue: -1 };
    this.tappable(c, new Rectangle(-80, -100, 160, 170), () => this.onSelect && this.onSelect('mail', 'all'));
    this.hoverTip(c, () => ({ title: 'Oficina de correos', body: 'Por aquí pasa el correo del servidor: <b>ámbar</b> sale de una cuenta hacia internet, <b>violeta</b> entra y va a su cuenta, <b>rojo</b> rebotó y vuelve roto a quien lo envió. La pila de sobres es la cola de correo esperando salir.', meta: this.postLine(), hint: 'Clic para ver el correo' }));
  }
  postLine() {
    const P = this.post; if (!P) return '';
    const now = this.t; P.log = P.log.filter(x => now - x.t < 60);
    const n = d => P.log.filter(x => x.dir === d).length;
    const parts = [[n('out'), 'salen'], [n('in'), 'entran'], [n('bounce'), 'rebotan']].filter(x => x[0]).map(x => `${x[0]} ${x[1]}`);
    return parts.length ? parts.join(' · ') + ' en 1 min' : 'sin movimiento en el último minuto';
  }
  drawPost(queue) {
    const P = this.post; if (!P) return;
    P.count.text = this.postLine();
    P.count.style.fill = P.log.some(x => x.dir === 'bounce') ? 0xfca5a5 : 0x94a3b8;
    const q = queue == null ? 0 : queue;
    const want = q > 1000 ? 9 : q > 100 ? 6 : q > 20 ? 3 : 0; // la pila crece con la cola
    if (want === P.pileN) return;
    P.pileN = want;
    P.pile.removeChildren().forEach(x => x.destroy());
    for (let i = 0; i < want; i++) {
      const e = new Sprite(monoTextures([ENVELOPE], q > 1000 ? '#f87171' : '#fbbf24')[0]); e.anchor.set(0.5); e.scale.set(1.3);
      e.x = -50 - (i % 3) * 3; e.y = 22 - i * 6 - (i % 2) * 2; e.rotation = (i % 2 ? 0.12 : -0.1);
      P.pile.addChild(e);
    }
  }

  // archivos en cuarentena: capsulas verdes con un bicho adentro, en la esquina del patio de la carcel
  drawQuarantine(n) {
    const J = this.jail; if (!J || J.qn === n) return;
    J.qn = n;
    if (!J.caps) {
      J.caps = new Container(); J.capsGlow = new Graphics(); J.capsLabel = label('', 10, 0x86efac, UI_FONT);
      J.caps.addChild(J.capsGlow); J.c.addChild(J.caps, J.capsLabel);
      this.tappable(J.caps, new Rectangle(34, -30, 70, 70), () => this.onSelect && this.onSelect('jail', 'all'));
      this.hoverTip(J.caps, () => ({ title: 'Archivos en cuarentena', body: 'Cada cápsula es un <b>archivo PHP malicioso</b> que se sacó de un sitio: ya no puede ejecutarse. En la ficha, dónde estaba, qué era, cuándo y quién lo buscó.', meta: `${J.qn} archivo(s)`, hint: 'Clic para ver su historia' }));
    }
    for (const x of J.caps.children.slice(1)) x.destroy();
    J.capsGlow.clear();
    // capsulas: tubo verde con tapa y un bicho rojo adentro, junto al patio
    for (let i = 0; i < Math.min(4, n); i++) {
      const g = new Graphics(), x = 62 + (i % 2) * 18, y = -6 + Math.floor(i / 2) * 22 + (i % 2) * 6;
      g.roundRect(x - 7, y - 11, 14, 24, 7).fill({ color: 0x14532d, alpha: 0.85 }).stroke({ width: 2, color: 0x4ade80 });
      g.rect(x - 5, y - 15, 10, 4).fill(0xbbf7d0);
      g.rect(x - 4, y - 1, 8, 6).fill(0xef4444).rect(x - 2, y + 1, 1, 1).fill(0xfde68a).rect(x + 1, y + 1, 1, 1).fill(0xfde68a); // bicho
      g.rect(x - 5, y - 5, 2, 6).fill({ color: 0xffffff, alpha: 0.35 }); // brillo del vidrio
      J.caps.addChild(g);
      J.capsGlow.ellipse(x, y + 1, 14, 18).fill({ color: 0x4ade80, alpha: 0.12 });
    }
    J.capsLabel.text = n ? `CUARENTENA · ${n}` : ''; J.capsLabel.x = 71; J.capsLabel.y = n > 2 ? 44 : 24;
  }
  drawJail(n) {
    const J = this.jail; if (!J || J.n === n) return;
    J.n = n;
    J.cars.removeChildren().forEach(x => x.destroy());
    for (let i = 0; i < Math.min(6, n); i++) {
      const sp = new Sprite(suspectTexture()); sp.anchor.set(0.5); sp.scale.set(1.1);
      sp.x = -10 + (i % 3) * 20 - Math.floor(i / 3) * 10; sp.y = 16 + (i % 3) * 5 + Math.floor(i / 3) * 12;
      J.cars.addChild(sp);
    }
    J.count.text = n ? `${n} preso${n === 1 ? '' : 's'}` : 'vacía';
    J.count.style.fill = n ? 0xfca5a5 : 0x64748b;
  }

  // silos de datos: uno por cuenta en la esquina de su distrito (bases MySQL); altura por tamano
  updateSilos(S) {
    this.siloData = S || null;
    const seen = new Set();
    for (const x of (S && S.list) || []) {
      const d = this.districts.get(x.account); if (!d) continue;
      seen.add(x.account);
      let o = this.silos.get(x.account);
      if (!o) {
        const c = new Container(); c.x = d.siloAt.x; c.y = d.siloAt.y; c.zIndex = c.y;
        const g = new Graphics(), lab = label('', 10, 0x94a3b8, UI_FONT); lab.y = 20;
        c.addChild(g, lab); this.scene.addChild(c);
        o = { c, g, lab, d };
        this.silos.set(x.account, o);
        this.tappable(c, new Rectangle(-34, -120, 68, 150), () => this.onSelect && this.onSelect('databases', o.x.account));
        this.hoverTip(c, () => this.siloTip(o));
      }
      o.x = x; o.h = 22 + clamp(Math.log2(1 + x.size / 1048576) * 5, 0, 60);
      o.lab.text = `${x.n} base${x.n === 1 ? '' : 's'}`;
    }
    for (const [k, o] of this.silos) if (!seen.has(k)) { o.c.destroy({ children: true }); this.silos.delete(k); }
  }
  siloTip(o) {
    const x = o.x, mb = v => v > 1073741824 ? (v / 1073741824).toFixed(1) + ' GB' : Math.round(v / 1048576) + ' MB';
    return { title: 'Bases de datos', body: `${x.n} base${x.n === 1 ? '' : 's'} MySQL de esta cuenta, ${mb(x.size)}. ${x.conns ? `<b>${x.conns}</b> conexión(es) abierta(s)${x.active ? `, <b>${x.active}</b> con consultas en curso` : ''}${x.sleep >= 10 ? `, <b>${x.sleep} dormidas</b> (anillos tenues)` : ''}.` : 'Sin conexiones ahora.'} Las tuberías van a los sitios que las usan; los pulsos son consultas en curso.`,
      meta: x.busy ? `ocupada el ${x.busy}% de los últimos 15 min` : '', hint: 'Clic para ver sus bases' };
  }
  // cada cuadro: silos (el anillo de la tapa late si hay consultas) y tuberias con pulsos que viajan
  drawSilosAndPipes(t) {
    const S = this.siloData, g = this.pipes; g.clear();
    if (!S) return;
    const hot = S.hot >= 0.85;
    const pulse = (a, b, color, n, speed) => {
      for (let i = 0; i < n; i++) { const u = (t * speed + i / n) % 1; g.rect(lerp(a.x, b.x, u) - 2.5, lerp(a.y, b.y, u) - 2.5, 5, 5).fill({ color, alpha: 0.95 }); }
    };
    for (const o of this.silos.values()) {
      const x = o.x;
      o.g.clear();
      drawSilo(o.g, 18, o.h, hex(o.d.color), { active: x.active ? clamp(0.3 + x.busy / 60, 0, 1) : 0, hot, sleep: x.sleep >= 10 ? Math.ceil(x.sleep / 12) : 0 }, t);
      for (const l of x.links) {
        const b = this.buildings.get(l.id); if (!b) continue;
        const a = { x: o.c.x, y: o.c.y - 4 }, bb = { x: b.x, y: b.y };
        g.moveTo(a.x, a.y).lineTo(bb.x, bb.y).stroke({ width: 3, color: hex(o.d.color), alpha: 0.3 });
        if (l.active) pulse(a, bb, 0xa5f3fc, Math.min(4, 1 + l.active), 0.5 + l.busy / 100);
      }
    }
    // Supabase unido a su app: tuberia verde, con pulsos si la base tiene conexiones
    for (const l of S.sb || []) {
      const a = this.buildings.get(l.from), b = this.buildings.get(l.to); if (!a || !b) continue;
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 3, color: 0x3ecf8e, alpha: 0.35 });
      const sb = a.app && a.app.sb;
      if (sb && sb.conns) pulse(a, b, 0xa7f3d0, Math.min(4, 1 + Math.round(sb.conns / 5)), 0.45);
    }
  }

  drawBar(dt) {
    const hw = this.hw; if (!hw) return;
    hw.bar = Math.max(0, hw.bar - dt * 1.8); hw.barHit = Math.max(0, hw.barHit - dt * 1.5);
    const up = Math.min(1, hw.bar * 3), hit = hw.barHit > 0.05;
    const b = this.hwBar.clear();
    b.rect(-4, -6, 8, 12).fill(0x475569);
    for (let i = 0; i < 8; i++) b.rect(i * 8, -2, 8, 4).fill(hit ? (i % 2 ? 0xef4444 : 0x7f1d1d) : (i % 2 ? 0xf8fafc : 0xef4444));
    b.rotation = -up * 1.25;
  }

  // --- distribucion de distritos alrededor de la torre
  layout(state) {
    const accounts = state.accounts.filter(a => a.id !== 'root');
    // cada distrito: sus apps de PM2 y despues sus sitios (WordPress, PHP, estaticos...)
    const appsBy = {};
    for (const a of state.apps) (appsBy[a.account] = appsBy[a.account] || []).push(a);
    for (const x of state.sites || []) (appsBy[x.account] = appsBy[x.account] || []).push({ ...x, _site: true });
    const key = accounts.map(a => a.id + ':' + (appsBy[a.id] || []).map(e => e.id).join(',') + ':' + (a.cpanel || '')).join('|');
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    // limpiar distritos anteriores
    for (const d of this.districts.values()) { d.plate.destroy({ children: true }); d.st.cont.destroy({ children: true }); d.name.destroy(); d.sub.destroy(); if (d.quotaLabel) d.quotaLabel.destroy(); }
    for (const b of this.buildings.values()) { b.sign.destroy({ children: true }); b.destroy({ children: true }); }
    this.districts.clear(); this.buildings.clear();
    for (const o of this.silos.values()) o.c.destroy({ children: true });
    this.silos.clear();

    const items = accounts.map(a => {
      const n = Math.max(1, (appsBy[a.id] || []).length);
      const cols = Math.max(2, Math.ceil(Math.sqrt(n)));
      const rows = Math.ceil(n / cols);
      const W = cols * 4 + 1, H = rows * 4 + 1;
      // ancho: la parcela o la fila de estaciones con sus nombres, lo que sea mayor (si no, las de distritos
      // chicos vecinos se pisan); alto incluye edificios y estaciones
      const sw = Math.max((W + H) * TW / 2, STATION_ROW), sh = (W + H) * TH / 2 + 180;
      return { a, n, cols, rows, W, H, sw, sh };
    }).sort((x, y) => y.n - x.n);
    // ranuras: der, izq, arriba-der, arriba-izq, abajo, abajo-der, abajo-izq
    const slots = [[1, 0.05], [-1, 0.05], [0.55, -0.9], [-0.55, -0.9], [0, 1], [0.8, 0.95], [-0.8, 0.95]];
    const RX = 300, RY = 250;
    items.forEach((it, i) => {
      const s = slots[i % slots.length];
      it.cx = s[0] * (RX + it.sw / 2); it.cy = s[1] * (RY + it.sh / 3);
    });
    // separar solapes
    for (let k = 0; k < 60; k++) {
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const A = items[i], B = items[j];
        const ox = (A.sw + B.sw) / 2 + 30 - Math.abs(A.cx - B.cx), oy = (A.sh + B.sh) / 2 + 10 - Math.abs(A.cy - B.cy);
        if (ox > 0 && oy > 0) {
          if (ox < oy) { const d = Math.sign(B.cx - A.cx) || 1; B.cx += d * ox / 2; A.cx -= d * ox / 2; }
          else { const d = Math.sign(B.cy - A.cy) || 1; B.cy += d * oy / 2; A.cy -= d * oy / 2; }
        }
      }
      for (const it of items) { // no pisar la autopista (baja por x = 0 sobre la torre)
        if (it.cy < 0) { const need = it.sw / 2 + 150 - Math.abs(it.cx); if (need > 0) it.cx += (Math.sign(it.cx) || 1) * need; }
      }
      for (const it of items) { // no pisar la torre
        const ox = it.sw / 2 + STATION_ROW / 2 - Math.abs(it.cx), oy = it.sh / 2 + 290 - Math.abs(it.cy);
        if (ox > 0 && oy > 0) { if (ox < oy) it.cx += (Math.sign(it.cx) || 1) * ox; else it.cy += (Math.sign(it.cy) || 1) * oy; }
      }
    }
    for (const it of items) this.buildDistrict(it, appsBy[it.a.id] || []);
    this.drawRoads();
    this.fit();
  }

  buildDistrict(it, apps) {
    const { a, cols, W, H } = it;
    const color = hex(a.color);
    // origen para que la parcela quede centrada en (cx, cy)
    const c = iso(W / 2, H / 2);
    const ox = it.cx - c.x, oy = it.cy - c.y - 40;
    const P = (gx, gy) => { const p = iso(gx, gy); return { x: p.x + ox, y: p.y + oy }; };
    const plate = new Graphics();
    const q = [P(0, 0), P(W, 0), P(W, H), P(0, H)];
    // grosor de la parcela
    plate.poly([q[3].x, q[3].y, q[2].x, q[2].y, q[2].x, q[2].y + 10, q[3].x, q[3].y + 10]).fill(mix(color, 0x000000, 0.8));
    plate.poly([q[2].x, q[2].y, q[1].x, q[1].y, q[1].x, q[1].y + 10, q[2].x, q[2].y + 10]).fill(mix(color, 0x000000, 0.7));
    plate.poly(q.flatMap(p => [p.x, p.y])).fill({ color: mix(color, 0x060a14, 0.86) }).stroke({ width: 2, color, alpha: 0.55 });
    for (let x = 1; x < W; x++) { const p0 = P(x, 0), p1 = P(x, H); plate.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y); }
    for (let y = 1; y < H; y++) { const p0 = P(0, y), p1 = P(W, y); plate.moveTo(p0.x, p0.y).lineTo(p1.x, p1.y); }
    plate.stroke({ width: 1, color, alpha: 0.08 });
    this.ground.addChild(plate);
    this.tappable(plate, new Polygon(q.flatMap(p => [p.x, p.y])), () => this.pick('district', a.id));
    this.hoverTip(plate, () => ({ title: a.label, body: `Un <b>distrito</b> = una cuenta de cPanel con sus servicios (${apps.length}). Sus robots trabajan en las estaciones del frente.`, hint: 'Clic para ver el distrito' }));
    const name = label(a.label.toUpperCase(), 24, color);
    const front0 = P(W, H);
    name.x = front0.x; name.y = front0.y + 120;
    this.labels.addChild(name);
    const nApps = apps.filter(e => !e._site).length, nSites = apps.length - nApps;
    const sub = label(accountCaption(a, nApps, nSites), 14, 0x8a9ab3, UI_FONT);
    sub.x = name.x; sub.y = name.y + 26;
    this.labels.addChild(sub);
    const d = { id: a.id, color: a.color, plate, name, sub, center: { x: it.cx, y: it.cy }, entry: P(W / 2, H / 2), apps: [], siloAt: { x: q[1].x + 26, y: q[1].y + 14 } };
    // edificios
    apps.forEach((app, i) => {
      const gx = 1 + (i % cols) * 4 + 1.5, gy = 1 + Math.floor(i / cols) * 4 + 1.5;
      const kind = app._site ? 'site' : 'app';
      const b = new Building(app, a.color, !!app._site);
      const p = P(gx, gy);
      b.x = p.x; b.y = p.y; b.zIndex = p.y;
      this.scene.addChild(b);
      b.sign.x = p.x; b.sign.y = p.y + TH * b.fp + 22;
      this.signs.addChild(b.sign);
      this.tappable(b, null, () => this.pick(kind, app.id), () => { b.flash = Math.max(b.flash, 0.35); });
      this.tappable(b.sign, null, () => this.pick(kind, app.id));
      b.districtLabel = a.label;
      this.hoverTip(b, () => this.buildingTip(b));
      this.hoverTip(b.sign, () => this.buildingTip(b));
      this.buildings.set(app.id, b);
      d.apps.push(app.id);
    });
    // estaciones en el borde frontal (abajo de la parcela)
    const front = P(W, H);
    d.st = this.makeStations(d, { x: front.x, y: front.y + 60 });
    this.stations.set(a.id, d.st);
    this.districts.set(a.id, d);
  }

  drawRoads() {
    const g = this.roads; g.clear();
    for (const d of this.districts.values()) {
      const a = { x: 0, y: 30 }, b = d.center;
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 14, color: 0x0f172a, alpha: 0.9 });
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1.5, color: hex(d.color), alpha: 0.35 });
    }
  }

  bounds() {
    // la autopista sigue hacia arriba fuera de cuadro: se encuadra desde un poco antes del peaje
    let x0 = -300, x1 = 300, y0 = this.gate.y - 240, y1 = 300;
    for (const d of this.districts.values()) {
      const b = d.plate.getLocalBounds();
      x0 = Math.min(x0, b.minX); x1 = Math.max(x1, b.maxX); y0 = Math.min(y0, b.minY - 150); y1 = Math.max(y1, b.maxY + 150);
    }
    return { x0, x1, y0, y1 };
  }

  fit() {
    if (!this.app) return;
    const { x0, x1, y0, y1 } = this.bounds();
    const W = this.app.screen.width - this.insets.left - this.insets.right;
    const H = this.app.screen.height - this.insets.top - this.insets.bottom;
    const s = Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.96;
    this.overview = { s, x: this.insets.left + W / 2 - (x0 + x1) / 2 * s, y: this.insets.top + H / 2 - (y0 + y1) / 2 * s };
    if (!this.camBase) this.camBase = { ...this.overview };
  }

  // encuadre de un rectangulo del mundo dentro del area libre
  frame(x0, x1, y0, y1, maxS = 1.35) {
    const W = this.app.screen.width - this.insets.left - this.insets.right;
    const H = this.app.screen.height - this.insets.top - this.insets.bottom;
    const s = Math.min(maxS, Math.min(W / (x1 - x0), H / (y1 - y0)) * 0.92);
    return { s, x: this.insets.left + W / 2 - (x0 + x1) / 2 * s, y: this.insets.top + H / 2 - (y0 + y1) / 2 * s };
  }
  districtFrame(id) {
    if (id === 'root') return this.frame(-330, 330, -this.hq.h - 120, 250);
    const d = this.districts.get(id);
    if (!d) return null;
    const b = d.plate.getLocalBounds();
    return this.frame(b.minX - 20, b.maxX + 20, b.minY - 150, b.maxY + 150);
  }

  // Modo director: vista general y luego un paseo por cada distrito.
  // Un evento urgente (agente pidiendo permiso) toma la camara unos segundos.
  setDirector(on) { this.directorOn = on; this.shot = null; this.shotT = 0; }
  directorTick(dt) {
    if (!this.overview) return;
    if (this.manualUntil > this.t) return; // el usuario esta navegando: la camara es suya
    this.shotT -= dt;
    // el objetivo se guarda como nombre y se resuelve en cada cuadro (el layout puede cambiar)
    const resolve = id => id === 'overview' ? this.overview : (this.districtFrame(id) || this.overview);
    if (this.urgent && this.urgent.until > this.t) { this.camTarget = resolve(this.urgent.account); return; }
    if (!this.directorOn || !this.districts.size) { this.camTarget = this.overview; return; }
    if (this.shotT <= 0 || !this.shot) {
      const order = ['overview', ...this.districts.keys(), 'root'];
      this.shotIdx = ((this.shotIdx ?? -1) + 1) % order.length;
      this.shot = order[this.shotIdx];
      this.shotT = this.shot === 'overview' ? 18 : 9;
    }
    this.camTarget = resolve(this.shot);
  }
  focus(account, secs = 10) { this.urgent = { account, until: this.t + secs }; }

  // ---------------- navegacion e interaccion ----------------
  tappable(obj, hitArea, onTap, onHover) {
    obj.eventMode = 'static';
    obj.cursor = 'pointer';
    if (hitArea) obj.hitArea = hitArea;
    obj.on('pointertap', ev => { if (this.dragMoved) return; ev.stopPropagation(); onTap(); });
    if (onHover) obj.on('pointerover', onHover);
  }

  hoverTip(obj, fn) {
    if (obj.eventMode !== 'static') obj.eventMode = 'static';
    obj.on('pointerover', e => { if (this.onTip && !this.dragMoved) this.onTip(fn(), e.client.x, e.client.y); });
    obj.on('pointerout', () => this.onTip && this.onTip(null));
  }
  buildingTip(b) {
    const a = b.app || {}, ST = { online: px('dotG') + ' en línea', degraded: px('dotY') + ' parcial', down: px('dotR') + ' caído' };
    if (b.isSite) return {
      title: a.name || a.kind || 'Sitio',
      body: `${a.kind && a.kind !== a.name ? `<b>${esc(a.kind)}</b> · ` : ''}sitio de ${esc(b.districtLabel || '')} que Apache sirve directamente (no es un proceso de PM2). Su <b>altura</b> crece con las visitas.`,
      meta: `${a.reqMin || 0} visitas/min`,
      hint: 'Clic para ver dominios, países y visitas',
    };
    return {
      title: a.name || a.kind || 'Servicio',
      body: `${a.kind && a.kind !== a.name ? `<b>${esc(a.kind)}</b> · ` : ''}servicio de ${esc(b.districtLabel || '')}. La <b>altura</b> es la memoria que usa, el <b>techo naranja</b> indica CPU alta y las <b>ventanas</b> se encienden con las visitas.`,
      meta: `${ST[a.status] || ''} · CPU ${(a.cpu || 0).toFixed(1)}% · ${fmtBytes(a.mem || 0)} · ${a.reqMin || 0} visitas/min`,
      hint: 'Clic para ver su detalle',
    };
  }
  robotTip(r) {
    const a = r.info || {}, L = { working: 'Trabajando', thinking: 'Pensando', waiting: 'Lo espera', idle: 'En pausa' };
    const W = { permission: 'espera su permiso', question: 'le hizo una pregunta', idle: 'espera su respuesta' };
    return {
      title: a.title || (r.small ? 'Subagente de Claude' : 'Agente de Claude'),
      body: `${r.small ? 'Un <b>subagente</b>: ayudante que lanzó un agente principal.' : 'Una <b>sesión de Claude Code</b> trabajando en el servidor.'} Ahora: <b>${L[a.state] || ''}</b>${a.waitKind ? ` — ${W[a.waitKind] || 'lo espera'}` : ''}${a.activity && a.state !== 'idle' ? ` · ${esc(a.activity)}` : ''}.`,
      meta: a.detail ? esc(a.detail) : `${Math.round((a.tokensOut || 0) / 100) / 10}k tokens · ${a.tools || 0} herramientas`,
      hint: r.small ? '' : 'Clic para ver su línea de tiempo',
    };
  }

  pick(kind, id) {
    this.selected = { kind, id };
    this.focusOn(kind, id);
    if (this.onSelect) this.onSelect(kind, id);
  }
  clearSelection() { this.selected = null; }

  // encuadra una entidad y deja la camara en modo manual un rato
  focusOn(kind, id) {
    let f = null;
    if (kind === 'app' || kind === 'site') { const b = this.buildings.get(id); if (b) f = this.frame(b.x - 240, b.x + 240, b.y - b.h - TH - 130, b.y + TH + 110, 1.5); }
    else if (kind === 'session') { const r = this.robotById(id); if (r) f = this.frame(r.x - 280, r.x + 280, r.y - 200, r.y + 130, 1.6); }
    else if (kind === 'district') f = this.districtFrame(id);
    else if (kind === 'system') f = this.districtFrame('root');
    else if (kind === 'security') f = this.frame(-420, 420, this.gate.y - 80, 260, 1.1);
    else if (kind === 'jail' && this.jail && this.jail.c.visible) f = this.frame(this.jail.c.x - 200, this.jail.c.x + 200, this.jail.c.y - 140, this.jail.c.y + 140, 1.6);
    if (!f) return;
    this.manualUntil = this.t + 90;
    this.camTarget = f;
    this.navChanged();
  }
  robotById(sid) {
    return this.robots.get(sid) || [...this.robots.entries()].find(([k]) => k.startsWith(sid + '/'))?.[1] || null;
  }

  setupNav() {
    const cv = this.app.canvas;
    const pts = new Map();
    let start = null, pinch = null;
    cv.style.touchAction = 'none';
    // fase de captura en window: corre antes que los manejadores de Pixi, que no dejan propagar
    const sig = this.sig;
    window.addEventListener('pointerdown', e => {
      if (e.target !== cv) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      start = { x: e.clientX, y: e.clientY };
      this.dragMoved = false;
    }, { capture: true, signal: sig.signal });
    window.addEventListener('pointermove', e => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        if (!this.dragMoved && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) this.dragMoved = true;
        if (this.dragMoved) this.panBy(dx, dy);
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, d / pinch);
        pinch = d; this.dragMoved = true;
      }
    }, sig);
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; };
    window.addEventListener('pointerup', up, sig);
    window.addEventListener('pointercancel', up, sig);
    cv.addEventListener('wheel', e => { e.preventDefault(); this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
    cv.addEventListener('dblclick', () => this.resetView());
  }
  manual() {
    this.manualUntil = this.t + 90;
    this.camTarget = null;
    this.urgent = null;
    this.navChanged();
  }
  panBy(dx, dy) { if (!this.camBase) return; this.manual(); if (this.onTip) this.onTip(null); this.camBase.x += dx; this.camBase.y += dy; }
  zoomAt(sx, sy, f) {
    if (!this.camBase) return;
    this.manual();
    const cb = this.camBase, ns = clamp(cb.s * f, 0.18, 2.6);
    const wx = (sx - cb.x) / cb.s, wy = (sy - cb.y) / cb.s;
    this.camBase = { s: ns, x: sx - wx * ns, y: sy - wy * ns };
  }
  zoomBy(f) { this.zoomAt(this.app.screen.width / 2, this.app.screen.height / 2, f); }
  resetView() {
    this.manualUntil = 0; this.shot = null; this.shotT = 0;
    this.camTarget = this.overview;
    this.navChanged();
  }
  navState() {
    if (this.manualUntil > this.t) return { mode: 'manual', left: Math.ceil(this.manualUntil - this.t) };
    return { mode: this.directorOn ? 'director' : 'fixed' };
  }
  navChanged() { if (this.onNav) this.onNav(this.navState()); }

  // --- estado periodico
  update(state) {
    this.state = state;
    this.layout(state);
    // cuota al limite (disco, inodos o ancho de banda): una linea ambar/roja bajo el nombre del distrito
    for (const a of state.accounts) {
      const d = this.districts.get(a.id); if (!d) continue;
      const txt = a.quota ? `${a.quota.what.toUpperCase()} AL ${a.quota.pct} %` : '';
      if (!d.quotaLabel && txt) { d.quotaLabel = label('', 13, 0xfbbf24, UI_FONT); d.quotaLabel.x = d.sub.x; d.quotaLabel.y = d.sub.y + 22; this.labels.addChild(d.quotaLabel); }
      if (d.quotaLabel) { d.quotaLabel.text = txt; d.quotaLabel.style.fill = a.quota && a.quota.level === 'bad' ? 0xf87171 : 0xfbbf24; }
    }
    for (const app of state.apps) { const b = this.buildings.get(app.id); if (b) b.update(app); }
    for (const x of state.sites || []) { const b = this.buildings.get(x.id); if (b) b.update(x); }
    for (const d of this.districts.values()) {
      const a = state.accounts.find(x => x.id === d.id);
      if (a && d.name.text !== a.label.toUpperCase()) d.name.text = a.label.toUpperCase();
    }
    this.hq.heat = clamp((state.system?.cpu || 0) / 100, 0, 1);
    this.hq.alarm = (state.keys || []).filter(k => k.state === 'failed').map(k => k.label);
    // sin defensa (Cloud, Equipo, Hosting) no hay a quien encerrar: la carcel no se dibuja
    if (this.jail) this.jail.c.visible = !!state.jail;
    if (state.jail) { this.drawJail(state.jail.n); this.drawQuarantine(state.jail.quarantine || 0); }
    this.lastQueue = state.mailQueue; this.drawPost(state.mailQueue);
    if (this.hqName) { const n = forEdition('TORRE DE CONTROL'); if (this.hqName.text !== n) this.hqName.text = n; }
    this.updateSilos(state.silos);
    // servidor al limite: los autos hacen fila en el peaje y avanzan lento (atasco)
    const jam = !!(state.saturation && state.saturation.level === 'bad');
    if (!jam && this.jam) this.jamNext = 0;
    this.jam = jam;
    // bajo la torre: los servicios clave que realmente corren en este servidor
    const act = (state.keys || []).filter(k => k.state === 'active').map(k => k.label.toLowerCase());
    const tag = act.filter(l => !['ssh', 'cron'].includes(l)).slice(0, 4).join(' · ') || 'servidor';
    if (this.hqTag.text !== tag) this.hqTag.text = tag;
    const hl = healthLine(state);
    if (hl && this.hqHealth.text !== hl.text) { this.hqHealth.text = hl.text; this.hqHealth.style.fill = hl.color; }
    this.syncRobots(state.sessions, state.accounts);
  }

  colorOf(account) {
    const a = this.state?.accounts.find(x => x.id === account);
    return a ? a.color : '#94a3b8';
  }

  stationPoint(account, station, slot) {
    const st = this.stations.get(account) || this.stations.get('root');
    const p = st.pts[station === 'waiting' ? 'desk' : station] || st.pts.desk;
    // adelante y a la derecha del icono (no encima): el icono y su nombre siguen a la vista
    const ang = slot * 2.4;
    const r = slot ? 18 + slot * 4 : 0;
    return { x: p.x + 38 + Math.cos(ang) * r, y: p.y + 10 + Math.sin(ang) * r * 0.5 };
  }

  syncRobots(sessions, accounts) {
    const seen = new Set();
    const occupancy = new Map();
    const place = (key, account, agent, small, parentPos) => {
      seen.add(key);
      let r = this.robots.get(key);
      const color = small ? '#e2e8f0' : this.colorOf(account);
      if (!r) {
        r = new Robot(small ? this.colorOf(account) : color, small);
        const start = parentPos || this.stationPoint(account, 'portal', 0);
        r.x = start.x; r.y = start.y;
        r.beam = 1;
        this.beamFx(r.x, r.y, hex(this.colorOf(account)));
        this.scene.addChild(r);
        this.robots.set(key, r);
        r.small = small;
        this.tappable(r, new Rectangle(-26, -80, 52, 90), () => this.pick('session', key.split('/')[0]));
        this.hoverTip(r, () => this.robotTip(r));
      }
      r.state = agent.state;
      const occKey = account + '/' + agent.station;
      const slot = occupancy.get(occKey) || 0;
      occupancy.set(occKey, slot + 1);
      const p = this.stationPoint(account, agent.station, slot);
      if (!r.dest || Math.hypot(r.dest.x - p.x, r.dest.y - p.y) > 3) { r.dest = p; r.moveTo(p); }
      r.info = agent;
      return r;
    };
    for (const s of sessions) {
      const acc = this.stations.has(s.account) ? s.account : 'root';
      const r = place(s.id, acc, s, false);
      for (const sub of s.subagents || []) place(s.id + '/' + sub.id, acc, sub, true, { x: r.x, y: r.y });
    }
    for (const [k, r] of this.robots) {
      if (!seen.has(k)) { this.beamFx(r.x, r.y, 0xffffff); r.destroy({ children: true }); this.robots.delete(k); }
    }
    this.lightStations(occupancy);
  }

  robotFor(e) {
    const s = this.robots.get(e.agent ? e.sid + '/' + e.agent : e.sid);
    return s || this.robots.get(e.sid);
  }

  // --- eventos discretos
  onEvent(e, priv) {
    switch (e.kind) {
      case 'http': return this.packet(e);
      case 'attack': return this.invader(false);
      case 'block': return this.invader(true, priv ? e.ip : null);
      case 'login': return this.comet(priv ? `SSH ✓ ${e.user}` : 'SSH ✓');
      case 'mail': return this.mail(e.dir, e);
      case 'deploy': {
        const b = this.buildings.get(e.app);
        if (!b) return;
        const T = { building: ['DESPLEGANDO', 0xfbbf24], ready: ['DESPLEGADO ✓', 0x4ade80], error: ['FALLÓ EL DESPLIEGUE', 0xef4444], canceled: ['CANCELADO', 0x94a3b8] }[e.action];
        if (!T) return;
        b.pulse(); this.ring(b.x, b.y - b.h / 2, T[1]); this.floatText(b.x, b.y - b.h - 60, T[0], T[1]);
        if (e.action === 'ready') this.spark(b.x, b.y - b.h - 20, 0x4ade80);
        return;
      }
      case 'domain': {
        const d = this.districts.get(e.account);
        const p = d ? d.center : { x: 0, y: 0 };
        const txt = { added: 'NUEVO DOMINIO', removed: 'DOMINIO ELIMINADO', changed: 'SITIO CAMBIÓ' }[e.action];
        const col = e.action === 'removed' ? 0xf87171 : e.action === 'added' ? 0x4ade80 : 0xfbbf24;
        this.ring(p.x, p.y, col); this.floatText(p.x, p.y - 80, priv && e.domain ? `${txt}: ${e.domain}` : txt, col);
        return;
      }
      case 'pm2': {
        const b = this.buildings.get(e.app);
        if (b) { b.pulse(); this.ring(b.x, b.y - b.h / 2, e.action === 'down' ? 0xef4444 : 0xfbbf24); this.floatText(b.x, b.y - b.h - 50, e.action === 'down' ? 'CAÍDA' : 'REINICIO', e.action === 'down' ? 0xef4444 : 0xfbbf24); }
        return;
      }
      case 'claude': {
        const r = this.robotFor(e);
        if (!r) return;
        if (e.action === 'permission') {
          const q = { permission: '¿Me da permiso?', question: 'Tengo una pregunta', idle: 'Lo espero…' }[e.waitKind] || '¿Me da permiso?';
          r.say(priv && e.tool && e.waitKind === 'permission' ? `${q} ${e.tool}` : q, 12, 0xfbbf24);
          this.focus(this.stations.has(e.account) ? e.account : 'root', 12);
          this.ring(r.x, r.y - 20, 0xfbbf24);
        }
        else if (e.action === 'approved') { r.say('¡Gracias! Manos a la obra', 3); this.spark(r.x, r.y - 30, 0x22c55e); }
        else if (e.action === 'tool') r.say(priv && e.detail ? e.detail : e.activity, 5);
        else if (e.action === 'prompt') r.say(priv && e.text ? e.text : 'Nueva instrucción', 6);
        else if (e.action === 'error') this.spark(r.x, r.y - 30, 0xef4444);
        else if (e.action === 'done') { r.say('✓ Listo', 4); this.spark(r.x, r.y - 30, 0x22c55e); }
        return;
      }
    }
  }

  addFx(obj, tick) { this.fxLayer.addChild(obj); this.fx.push({ obj, tick, age: 0 }); }

  packet(e) {
    if (this.fx.length > 260) return;
    const d = this.districts.get(e.account);
    const b = e.app ? this.buildings.get(e.app) : e.site ? this.buildings.get(e.site) : null;
    const color = e.status >= 500 ? 0xef4444 : e.status >= 400 ? 0xf59e0b : e.bot ? 0x64748b : 0x67e8f9;
    const hw = this.hw, lane = hw.laneIn;
    const pts = [{ x: lane, y: hw.toll - 520 }, { x: lane, y: hw.toll - 30 }, { x: lane, y: hw.toll + 20 }, { x: 0, y: -this.hq.h + 10 }, { x: 0, y: 30 }];
    if (d) pts.push({ ...d.center });
    if (b) pts.push({ x: b.x, y: b.y - b.h - TH / 2 });
    // auto pixel visto desde arriba (8x14): carroceria del color de la visita, parabrisas, faros y luces
    // traseras; el frente mira hacia donde va
    const g = new Sprite(carTexture('#' + color.toString(16).padStart(6, '0')));
    g.anchor.set(0.5); g.scale.set(e.bot ? 1.1 : 1.4);
    g.x = pts[0].x; g.y = pts[0].y;
    let seg = 0, wait = 0, queued = false; const speed = 520 + Math.random() * 200;
    // en un atasco, cada auto espera su turno en el peaje: toma el ultimo lugar de la fila (uno detras del otro)
    if (this.jam) {
      if ((this.jamQ || 0) >= 18) return; // la fila ya muestra el atasco: no crece sin fin
      const now = this.t; this.jamNext = Math.min(now + 8, Math.max(this.jamNext || 0, now) + 0.45); wait = this.jamNext - now;
      this.jamQ = (this.jamQ || 0) + 1; queued = true;
      pts[1] = { x: lane, y: hw.toll - 30 - Math.min(20, this.jamQ - 1) * 17 };
    }
    this.addFx(g, (f, dt) => {
      if (seg === 1 && wait > 0) { wait -= dt; return true; } // espera en su lugar de la fila
      if (seg === 1 && queued) { queued = false; this.jamQ = Math.max(0, this.jamQ - 1); }
      if (seg === 1) hw.bar = 1; // llega al peaje: sube la barrera
      const a = pts[seg + 1];
      if (!a) {
        if (b) b.flash = Math.max(b.flash, e.status >= 500 ? 1 : 0.25);
        if (e.status >= 500) this.spark(g.x, g.y, 0xef4444);
        return false;
      }
      const dx = a.x - g.x, dy = a.y - g.y, dd = Math.hypot(dx, dy);
      const st = speed * (this.jam ? 0.35 : 1) * dt;
      if (dd > 0.5) g.rotation = Math.atan2(dy, dx) - Math.PI / 2;
      if (dd <= st) { g.x = a.x; g.y = a.y; seg++; } else { g.x += dx / dd * st; g.y += dy / dd * st; }
      return true;
    });
  }

  invader(blocked, ip) {
    const tex = monoTextures(INVADER, blocked ? '#fb7185' : '#f87171');
    const s = new Sprite(tex[0]); s.anchor.set(0.5); s.scale.set(2.2);
    const hw = this.hw, hq = this.hq;
    s.x = hw.laneAtk + (Math.random() - 0.5) * 10; s.y = hw.toll - 560 - Math.random() * 120;
    const hit = { x: hw.laneAtk, y: hw.toll - 16 };
    this.addFx(s, (f, dt) => {
      s.texture = tex[Math.floor(f.age * 4) % 2];
      const dx = hit.x - s.x, dy = hit.y - s.y, dd = Math.hypot(dx, dy);
      const st = 300 * dt;
      if (dd <= st) {
        this.explode(hit.x, hit.y, blocked ? 0xfb7185 : 0xf87171);
        hw.barHit = 1; hq.flash = Math.max(hq.flash, 0.4);
        if (blocked) this.floatText(hit.x, hit.y - 30, ip ? 'BLOQUEADA ' + ip : 'IP BLOQUEADA', 0xfb7185);
        return false;
      }
      s.x += dx / dd * st; s.y += dy / dd * st;
      return true;
    });
  }

  comet(text) {
    const g = new Graphics().circle(0, 0, 4).fill(0x4ade80).circle(0, 0, 10).fill({ color: 0x4ade80, alpha: 0.25 });
    g.x = -900; g.y = -500;
    this.addFx(g, (f, dt) => {
      const dx = 0 - g.x, dy = -this.hq.h - g.y, dd = Math.hypot(dx, dy);
      if (dd < 12) { this.ring(0, -this.hq.h / 2, 0x4ade80); this.floatText(0, -this.hq.h - 60, text, 0x4ade80); return false; }
      g.x += dx / dd * 700 * dt; g.y += dy / dd * 700 * dt;
      return true;
    });
  }

  // Correo: sale del distrito de la cuenta, pasa por la oficina y se va por la autopista (ambar); entra por la
  // autopista, pasa por la oficina y llega a su cuenta (violeta); rebota: sale, choca antes del peaje y vuelve
  // roto a quien lo envio (rojo), con el motivo. Llega en rafagas: un sobre cada 0,35 s por tipo, el resto suma
  // al contador de la oficina.
  mail(dir, e = {}) {
    const P = this.post;
    if (P) { P.log.push({ t: this.t, dir }); if (P.log.length > 3000) P.log.shift(); }
    this.mailLast = this.mailLast || {};
    if (this.t - (this.mailLast[dir] || -9) < 0.35 || this.fx.length > 240) { this.drawPost(this.lastQueue); return; }
    this.mailLast[dir] = this.t;
    const d = e.account && this.districts.get(e.account);
    const home = d ? { ...d.center } : { x: 0, y: -this.hq.h + 10 };
    const post = P ? { x: P.c.x, y: P.c.y - 10 } : { x: 0, y: -this.hq.h };
    const lane = this.hw ? this.hw.laneIn : 0;
    const sky = { x: lane - 20, y: (this.hw ? this.hw.toll : -300) - 560 };
    const color = dir === 'bounce' ? '#f87171' : dir === 'in' ? '#a78bfa' : '#fbbf24';
    const s = new Sprite(monoTextures([ENVELOPE], color)[0]); s.anchor.set(0.5); s.scale.set(2);
    const crash = { x: lane - 20, y: (this.hw ? this.hw.toll : -300) - 240 };
    const legs = dir === 'in' ? [sky, post, home] : dir === 'bounce' ? [home, post, crash, post, home] : [home, post, sky];
    const SHORT = { auth: 'SIN AUTENTICAR', nouser: 'NO EXISTE', full: 'BUZÓN LLENO', spam: 'SPAM', domain: 'DOMINIO', rate: 'DEMASIADOS' };
    let leg = 0, u = 0, torn = false, tag = null;
    s.x = legs[0].x; s.y = legs[0].y; s.alpha = 0;
    this.addFx(s, (f, dt) => {
      const a = legs[leg], b = legs[leg + 1];
      if (!b) { if (tag) tag.destroy(); return false; }
      const dist = Math.max(40, Math.hypot(b.x - a.x, b.y - a.y));
      u += dt * 420 / dist;
      const k = Math.min(1, u);
      s.x = lerp(a.x, b.x, k); s.y = lerp(a.y, b.y, k) - Math.sin(k * Math.PI) * Math.min(80, dist * 0.2);
      s.alpha = leg === 0 ? Math.min(1, u * 4) : leg === legs.length - 2 && k > 0.85 ? (1 - k) / 0.15 : 1;
      if (tag) { tag.x = s.x; tag.y = s.y - 22; }
      if (k >= 1) {
        leg++; u = 0;
        // rebote: al chocar se rompe (chispas y una X) y vuelve con el motivo
        if (dir === 'bounce' && leg === 3 && !torn) {
          torn = true; this.spark(s.x, s.y, 0xef4444); s.rotation = 0.5; s.tint = 0xfca5a5;
          tag = label(SHORT[e.cat] || 'REBOTADO', 10, 0xfca5a5, UI_FONT); tag.x = s.x; tag.y = s.y - 22; this.labels.addChild(tag);
        }
        if (leg === 1 && this.post) this.post.env.scale.set(2.3); // la oficina «recibe» el sobre
      }
      if (this.post && this.post.env.scale.x > 1.8) this.post.env.scale.set(Math.max(1.8, this.post.env.scale.x - dt * 2));
      return true;
    });
    this.drawPost(this.lastQueue);
  }

  spark(x, y, color) {
    for (let i = 0; i < 10; i++) {
      const g = new Graphics().rect(-1.5, -1.5, 3, 3).fill(color);
      g.x = x; g.y = y;
      const a = Math.random() * Math.PI * 2, v = 60 + Math.random() * 90;
      const vx = Math.cos(a) * v, vy = Math.sin(a) * v - 60;
      this.addFx(g, (f, dt) => { g.x += vx * dt; g.y += (vy + f.age * 220) * dt; g.alpha = 1 - f.age / 0.8; return f.age < 0.8; });
    }
  }
  explode(x, y, color) { this.spark(x, y, color); this.ring(x, y, color); }

  ring(x, y, color) {
    const g = new Graphics(); g.x = x; g.y = y;
    this.addFx(g, f => {
      const t = f.age / 0.7;
      g.clear().ellipse(0, 0, 10 + t * 60, (10 + t * 60) * 0.5).stroke({ width: 3, color, alpha: 1 - t });
      return t < 1;
    });
  }

  beamFx(x, y, color) {
    const g = new Graphics(); g.x = x; g.y = y;
    this.addFx(g, f => {
      const t = f.age / 1.1;
      g.clear().rect(-10 * (1 - t), -220, 20 * (1 - t), 220).fill({ color, alpha: 0.35 * (1 - t) }).ellipse(0, 0, 18, 7).fill({ color, alpha: 0.5 * (1 - t) });
      return t < 1;
    });
  }

  floatText(x, y, text, color) {
    const t = label(text, 18, color); t.x = x; t.y = y;
    this.addFx(t, (f, dt) => { t.y -= 18 * dt; t.alpha = 1 - Math.max(0, f.age - 1.6) / 0.8; return f.age < 2.4; });
  }

  drawSelection(t) {
    const g = this.selG; g.clear();
    const sel = this.selected;
    if (!sel) return;
    let x, y, rx;
    if (sel.kind === 'app' || sel.kind === 'site') { const b = this.buildings.get(sel.id); if (!b) return; x = b.x; y = b.y; rx = TW * 1.35 * b.fp; }
    else if (sel.kind === 'session') { const r = this.robotById(sel.id); if (!r) return; x = r.x; y = r.y; rx = 36; }
    else if (sel.kind === 'system') { x = 0; y = 0; rx = TW * 2.6; }
    else return;
    const a = 0.5 + 0.5 * Math.sin(t * 4);
    g.ellipse(x, y, rx + a * 6, (rx + a * 6) * 0.5).stroke({ width: 3, color: 0x22d3ee, alpha: 0.5 + 0.4 * a })
      .ellipse(x, y, rx * 0.8, rx * 0.4).fill({ color: 0x22d3ee, alpha: 0.08 });
  }

  tick(dt) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const t = this.t;
    // estrellas
    const sg = this.stars; sg.clear();
    for (const s of this.starList || []) sg.rect(s.x, s.y, s.r, s.r).fill({ color: 0x9fb4d9, alpha: 0.2 + 0.4 * (0.5 + 0.5 * Math.sin(t * 0.9 + s.p)) });
    // camara: se desliza hacia el objetivo del director, con respiracion lenta
    this.directorTick(dt);
    if (this.camBase && this.camTarget) {
      const f = 1 - Math.pow(0.18, dt);
      const cb = this.camBase, ct = this.camTarget;
      // interpolar en espacio de mundo para que el paneo no haga arcos raros
      const cx = (this.app.screen.width / 2 - cb.x) / cb.s, cy = (this.app.screen.height / 2 - cb.y) / cb.s;
      const tx = (this.app.screen.width / 2 - ct.x) / ct.s, ty = (this.app.screen.height / 2 - ct.y) / ct.s;
      const ns = Math.exp(lerp(Math.log(cb.s), Math.log(ct.s), f));
      const nx = lerp(cx, tx, f), ny = lerp(cy, ty, f);
      this.camBase = { s: ns, x: this.app.screen.width / 2 - nx * ns, y: this.app.screen.height / 2 - ny * ns };
    }
    if (this.camBase) {
      const k = 1 + Math.sin(t * 0.12) * 0.012;
      this.cam.scale.set(this.camBase.s * k);
      this.cam.x = this.camBase.x + Math.sin(t * 0.07) * 8;
      this.cam.y = this.camBase.y + Math.cos(t * 0.09) * 5;
      const full = this.cam.scale.x >= 0.72;
      for (const b of this.buildings.values()) b.setDetail(full, this.cam.scale.x);
    }
    // torre: radar, escudo, calor
    const hq = this.hq;
    hq.radar.clear().moveTo(0, 0).lineTo(Math.cos(t * 1.6) * 22, Math.sin(t * 1.6) * 8).stroke({ width: 3, color: 0x22d3ee })
      .circle(0, 0, 3).fill(0xfbbf24);
    hq.flash = Math.max(0, hq.flash - dt * 1.8);
    if (hq.alarm && hq.alarm.length) {
      hq.flash = Math.max(hq.flash, 0.5 + 0.5 * Math.sin(t * 6));
      if (!this.alarmText) { this.alarmText = label('', 18, 0xf87171); this.alarmText.y = -hq.h - 110; this.labels.addChild(this.alarmText); }
      this.alarmText.text = 'ALERTA: ' + hq.alarm.join(', ') + (hq.alarm.length > 1 ? ' CAÍDOS' : ' CAÍDO');
      this.alarmText.alpha = 0.6 + 0.4 * Math.sin(t * 6);
    } else if (this.alarmText) { this.alarmText.destroy(); this.alarmText = null; }
    const sa = 0.12 + 0.06 * Math.sin(t * 1.3) + hq.flash * 0.6;
    hq.shield.clear().ellipse(0, -60, hq.rx, hq.ry).stroke({ width: 2 + hq.flash * 3, color: hq.flash > 0.1 ? 0xfb7185 : 0x22d3ee, alpha: sa })
      .ellipse(0, -60, hq.rx, hq.ry).fill({ color: 0x22d3ee, alpha: 0.02 + hq.flash * 0.05 });
    this.drawBar(dt);
    for (const b of this.buildings.values()) b.tick(dt, t);
    this.drawSilosAndPipes(t);
    if (this.jail && this.jail.capsGlow) this.jail.capsGlow.alpha = 0.6 + 0.4 * Math.sin(t * 2.4); // las capsulas laten
    for (const r of this.robots.values()) r.tick(dt, t);
    this.drawSelection(t);
    this.navT = (this.navT || 0) + dt;
    if (this.navT > 1) { this.navT = 0; this.navChanged(); }
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.age += dt;
      if (!f.tick(f, dt)) { f.obj.destroy(); this.fx.splice(i, 1); }
    }
  }
}
