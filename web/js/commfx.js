// Comunicacion entre agentes, dibujada encima de cualquier tema: el encargo que va del agente al subagente,
// el resultado que vuelve, los mensajes (SendMessage) y el haz del agente al proyecto que lee o edita.
// Cada tema dice donde esta cada cosa con world.screenOf(kind, id) -> { x, y } en pixeles de la ventana;
// si no lo sabe, se usan las tarjetas del panel de agentes. Sobres y chispas en pixel art, textos nitidos.
import { ENVELOPE, POLICE_CAR, FLY_POLICE, PROBE_CAR, CAR_COLORS, BUG, paintCanvas } from './pixeldata.js';
import { SKINS } from './fxskins.js';

const COLORS = { task: '#22d3ee', result: '#4ade80', message: '#c084fc', edit: '#fbbf24', read: '#38bdf8' };
const LABEL = { task: 'encargo', result: 'resultado', message: 'mensaje' };
const MAX = 14;

export class CommFx {
  constructor(getWorld) {
    this.getWorld = getWorld;
    this.cv = Object.assign(document.createElement('canvas'), { className: 'commfx' });
    this.cv.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.cv);
    this.cx = this.cv.getContext('2d');
    this.fx = [];
    this.env = {};
    for (const [k, c] of Object.entries(COLORS)) this.env[k] = paintCanvas(ENVELOPE, { x: c }, 1);
    this.still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    // autos de perfil (2 cuadros: las luces alternan); se dibujan al doble, sin suavizar
    // el elenco de la ciudad (autos de policia); cada tema puede traer el suyo (web/js/fxskins.js)
    this.base = { cars: { police: POLICE_CAR.map(f => paintCanvas(f, CAR_COLORS, 1)), fly: FLY_POLICE.map(f => paintCanvas(f, CAR_COLORS, 1)), probe: PROBE_CAR.map(f => paintCanvas(f, CAR_COLORS, 1)),
      queue: PROBE_CAR.map(f => paintCanvas(f.map(r => r.replace(/[Rr]/g, '.')), { ...CAR_COLORS, g: '#64748b', d: '#334155' }, 1)) },
      bug: BUG.map(f => paintCanvas(f, { k: '#111827', r: '#ef4444', w: '#fde68a' }, 1)), capsule: { fill: 'rgba(74, 222, 128, .18)', stroke: '#4ade80', lid: '#bbf7d0', label: '#4ade80' } };
    this.skinCache = new Map();
    this.sat = null; // servidor al limite (del estado)
    this.patrols = new Map(); // sitio vigilado -> { w, phase: out | on | back, t0, park }
    this.resize = () => { const d = Math.min(2, devicePixelRatio || 1); this.dpr = d; this.cv.width = innerWidth * d; this.cv.height = innerHeight * d; };
    this.resize(); addEventListener('resize', this.resize);
    this.raf = 0;
  }

  // el elenco del tema activo: sus personajes en vez de los autos de la ciudad (none: el tema no dibuja vehiculos)
  get skin() {
    const id = document.body.dataset.theme || 'ciudad';
    if (!this.skinCache.has(id)) {
      let W = null; try { W = this.getWorld(); } catch { W = null; }
      const S = (W && W.fxSkin) || SKINS[id]; // un tema del kit puede traer su propio elenco (mismo formato que fxskins.js)
      if (!S) this.skinCache.set(id, this.base);
      else if (S.none) this.skinCache.set(id, { ...this.base, none: true });
      else {
        const norm = f => { const w = Math.max(...f.map(r => r.length)); return f.map(r => r.padEnd(w, '.')); };
        const paint = frames => frames.map(f => paintCanvas(norm(f), S.pal, 1));
        const two = fr => fr.length > 1 ? fr : [fr[0], fr[0]];
        this.skinCache.set(id, { cars: { police: two(paint(S.police)), fly: two(paint(S.fly)), probe: two(paint(S.probe)), queue: two(paint(S.queue)) }, bug: two(paint(S.bug)), capsule: { ...this.base.capsule, ...S.capsule } });
      }
    }
    return this.skinCache.get(id);
  }
  get cars() { return this.skin.cars; }
  get bug() { return this.skin.bug; }

  // posicion en pantalla: primero el mundo del tema, despues el panel de agentes
  pos(kind, id, sid) {
    const w = this.getWorld();
    let p = null;
    try { p = w && w.screenOf ? w.screenOf(kind, id) : null; } catch { p = null; }
    if (p && p.x >= 0 && p.y >= 0 && p.x <= innerWidth && p.y <= innerHeight && !this.covered(p)) return { ...p, world: true };
    let el = null;
    if (kind === 'session') el = document.querySelector(`#agents [data-go="session:${CSS.escape(id)}"]`);
    if (kind === 'agent') el = document.querySelector(`#agents [data-go="session:${CSS.escape(sid)}"] [data-agent="${CSS.escape(id)}"]`)
      || document.querySelector(`#agents [data-go="session:${CSS.escape(sid)}"]`);
    if (!el || !el.offsetParent) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width * 0.85, y: r.top + r.height / 2, card: true };
  }

  // un punto del mundo tapado por el HUD (paneles, barra de arriba, ticker, ficha abierta): ahi no se dibuja
  covered(p) {
    const now = performance.now();
    if (!this.hud || now - this.hudAt > 500) {
      this.hudAt = now;
      this.hud = ['top', 'left', 'right', 'ticker', 'drawer'].map(id => document.getElementById(id))
        .filter(el => el && !el.hidden && el.getClientRects().length).map(el => el.getBoundingClientRect());
    }
    return this.hud.some(r => p.x >= r.left && p.x <= r.right && p.y >= r.top && p.y <= r.bottom);
  }

  onEvent(e) {
    if (e.kind === 'probe') return this.probe(e);
    // bloqueo: las patrullas se llevan al auto sospechoso a la torre
    if (e.kind === 'defense' && e.action === 'block' && (e.app || e.site)) return this.escort(e.app ? 'app' : 'site', e.app || e.site);
    // puerta trasera: en cuarentena (una patrulla se lleva los bichos en una capsula a la carcel) o alguien la busco
    if (e.kind === 'phpfile' && e.site && e.action === 'quarantine') return this.capsule('site', e.site);
    if (e.kind === 'phpfile' && e.site && e.action === 'hit') { (this.phpHit || (this.phpHit = new Map())).set(e.site, performance.now() / 1000 + 8); this.run(); return; }
    // un preso sale de la carcel (vencio su bloqueo o lo liberaron) y se va por la autopista
    if (e.kind === 'defense' && (e.action === 'unblock' || e.action === 'expire')) return this.release();
    // consulta lenta: un solo pulso ambar sobre el edificio que usa la base (si no se sabe cual, solo el ticker)
    if (e.kind === 'db' && e.action === 'slow') {
      const at = e.app ? this.pos('app', e.app) : e.site ? this.pos('site', e.site) : null;
      if (at && at.world && this.fx.length < MAX) { this.fx.push({ type: 'dbslow', at, secs: e.secs, t: 0, dur: this.still ? 0.8 : 2.2 }); this.run(); }
      return;
    }
    if (e.kind !== 'claude' || this.fx.length >= MAX) return;
    const me = e.agent ? this.pos('agent', e.sid + '/' + e.agent, e.sid) : this.pos('session', e.sid);
    if (e.action === 'spawn') {
      // el subagente aparece en el mundo un instante despues: se espera su lugar
      const from = this.pos('session', e.sid);
      if (from) this.later(() => this.pos('agent', e.sid + '/' + e.agent, e.sid), to => this.packet(from, to || nudge(from), 'task'));
    } else if (e.action === 'despawn') {
      const from = this.pos('agent', e.sid + '/' + e.agent, e.sid) || nudge(this.pos('session', e.sid));
      const to = this.pos('session', e.sid);
      if (from && to) this.packet(from, to, 'result');
    } else if (e.action === 'message') {
      const to = e.to == null ? null : e.to === '' ? this.pos('session', e.sid) : this.pos('agent', e.sid + '/' + e.to, e.sid);
      if (me) this.packet(me, to || nudge(me, -1), 'message');
    } else if (e.action === 'start') {
      // sesion nueva: el bot aparece un instante despues; baja un haz donde se pare
      this.later(() => this.pos('session', e.sid), to => { if (to) this.warp(to, 'in'); }, 12);
    } else if (e.action === 'end') {
      // sesion cerrada: el bot sigue en su lugar hasta el proximo estado; sube un haz y se va
      if (me) this.warp(me, 'out', e.reason);
    } else if (e.action === 'touch') {
      const to = e.app ? this.pos('app', e.app) : e.site ? this.pos('site', e.site) : null;
      if (me && to && to.world) this.beam(me, to, e.mode === 'edit' ? 'edit' : 'read');
    }
  }

  // un robot que busca una ruta vulnerable: auto oscuro con luz roja que va al edificio y rebota; si la
  // ruta respondio (archivo expuesto), el edificio queda marcado en rojo con el cartel EXPUESTO
  probe(e) {
    if (this.skin.none) return;
    if (this.fx.filter(f => f.type === 'probe').length >= 4 && !e.exposed) return;
    const to = e.app ? this.pos('app', e.app) : e.site ? this.pos('site', e.site) : null;
    if (!to || !to.world) return;
    const w = this.getWorld();
    let from = null;
    try { from = w && w.screenOf ? w.screenOf('gate') : null; } catch { from = null; }
    if (!from) from = { x: Math.max(20, Math.min(innerWidth - 20, to.x + (Math.random() - 0.5) * 400)), y: 70 };
    this.fx.push({ type: 'probe', from, to, t: 0, dur: this.still ? 0.5 : 1.1 + Math.random() * 0.4, exposed: !!e.exposed, status: e.status });
    this.run();
  }

  drawProbe(f) {
    const { cx } = this;
    const go = Math.min(1, f.t / f.dur);
    let u, fade = 1;
    if (f.exposed) u = go;
    else {
      // ida hasta la puerta y vuelta corta: rebota
      const back = f.t > f.dur ? Math.min(1, (f.t - f.dur) / 0.35) : 0;
      u = go - back * 0.35; fade = 1 - back;
    }
    const x = f.from.x + (f.to.x - f.from.x) * u, y = f.from.y + (f.to.y - f.from.y) * u;
    cx.globalAlpha = fade;
    // auto sospechoso de perfil (escala 2): oscuro, con la sirena roja que parpadea; mira hacia donde va
    this.car('probe', x, y, f.t, f.to.x < f.from.x);
    if (!f.exposed && f.t > f.dur && f.status) {
      cx.font = "600 11px 'Space Grotesk', system-ui, sans-serif"; cx.textAlign = 'center'; cx.fillStyle = '#94a3b8';
      cx.fillText(String(f.status), f.to.x, f.to.y - 14 - (f.t - f.dur) * 20);
    }
    cx.globalAlpha = 1;
    if (f.exposed && go >= 1) {
      const k = (f.t - f.dur) % 0.8 / 0.8, r = 10 + k * 26;
      cx.globalAlpha = 1 - k; cx.strokeStyle = '#ef4444'; cx.lineWidth = 3;
      cx.strokeRect(Math.round(f.to.x - r), Math.round(f.to.y - r), Math.round(r * 2), Math.round(r * 2));
      cx.globalAlpha = 1;
      cx.font = "700 12px 'Space Grotesk', system-ui, sans-serif"; cx.textAlign = 'center';
      const tw = cx.measureText('EXPUESTO').width + 12;
      cx.fillStyle = '#ef4444'; cx.fillRect(Math.round(f.to.x - tw / 2), Math.round(f.to.y - 42), Math.round(tw), 18);
      cx.fillStyle = '#fff'; cx.fillText('EXPUESTO', f.to.x, f.to.y - 29);
    }
  }

  // auto de perfil centrado en (x, y), escala 2; flip = mira a la izquierda
  car(kind, x, y, t, flip) {
    const img = this.cars[kind][frame2(t * 6)], w = img.width * 2, h = img.height * 2, { cx } = this;
    cx.save();
    cx.translate(Math.round(x), Math.round(y - h / 2));
    if (flip) cx.scale(-1, 1);
    cx.drawImage(img, -w / 2, 0, w, h);
    cx.restore();
  }

  // vigilancia (del estado). Escaneo o scraping: dos patrullas voladoras despegan de la torre de control,
  // vuelan en arco hasta el edificio y quedan suspendidas a sus lados con las luces encendidas; cuando la
  // amenaza se descarta, vuelven a la torre. Pico de visitas: reflectores sobre el edificio. Con su cartel.
  setWatch(list) {
    if (this.skin.none) { this.patrols.clear(); return; }
    const now = performance.now() / 1000, keys = new Set();
    for (const w of list || []) {
      const k = w.kind + ':' + w.id; keys.add(k);
      const P = this.patrols.get(k);
      if (!P) this.patrols.set(k, { w, phase: w.reason === 'surge' || w.reason === 'php' || w.reason === 'phpbad' ? 'on' : 'out', t0: now, park: [] });
      else { P.w = w; if (P.phase === 'back' && !P.escort) { P.phase = 'out'; P.t0 = now; } } // una escolta en curso no se interrumpe
    }
    for (const [k, P] of this.patrols) if (!keys.has(k) && P.phase !== 'back' && P.phase !== 'home') {
      if (P.w.reason === 'surge' || P.w.reason === 'php' || P.w.reason === 'phpbad') this.patrols.delete(k); else { P.phase = 'back'; P.t0 = now; }
    }
    if (this.patrols.size) this.run();
  }
  escort(kind, id) {
    if (this.skin.none) return;
    const k = kind + ':' + id, now = performance.now() / 1000;
    const P = this.patrols.get(k);
    if (P && P.w.reason !== 'surge') { P.phase = 'back'; P.t0 = now; P.escort = true; }
    else this.patrols.set(k, { w: { kind, id, reason: 'block' }, phase: 'back', t0: now, park: [], escort: true });
    this.run();
  }
  // donde queda la carcel (si el tema la dibuja)
  jailPos() {
    const w = this.getWorld();
    let p = null;
    try { p = w && w.screenOf ? w.screenOf('jail') : null; } catch { p = null; }
    return p && Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null; // aunque este fuera de pantalla: vuelan hacia alla
  }
  // cuarentena: la patrulla baja desde la torre, encierra los bichos en una capsula verde y la lleva a la carcel
  capsule(kind, id) {
    // arranca aunque el edificio este tapado por un panel (la ficha se cierra sola): se usa su posicion en el mundo
    let b = this.pos(kind, id);
    if (!b) { const w = this.getWorld(); try { b = w && w.screenOf ? w.screenOf(kind, id) : null; } catch { b = null; } }
    if (!b || this.still || this.skin.none) return;
    // los bichos de ese edificio dejan de dibujarse ya (van dentro de la capsula)
    for (const [k, P] of this.patrols) if (P.w.reason === 'phpbad' && P.w.id === id) this.patrols.delete(k);
    this.fx.push({ type: 'capsule', kind, id, last: b, t: 0, dur: 16 });
    this.run();
  }
  drawCapsule(f) {
    const { cx } = this, t = f.t;
    let b = this.pos(f.kind, f.id);
    if (!b) { const w = this.getWorld(); try { b = w && w.screenOf ? w.screenOf(f.kind, f.id) : null; } catch { b = null; } }
    b = b || f.last; f.last = b;
    const home = this.home(b) || { x: b.x, y: -60 }, jail = this.jailPos() || home;
    const ease = u => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
    const arc = (a, c, u, lift) => { const k = ease(Math.min(1, Math.max(0, u))), mx = (a.x + c.x) / 2, my = Math.min(a.y, c.y) - lift;
      return { x: (1 - k) ** 2 * a.x + 2 * (1 - k) * k * mx + k * k * c.x, y: (1 - k) ** 2 * a.y + 2 * (1 - k) * k * my + k * k * c.y }; };
    const above = { x: b.x, y: b.y - 62 };
    // 0-5 s: baja la patrulla · 5-7.5 s: captura (la capsula crece alrededor de los bichos) · 7.5-15 s: a la carcel
    let car = null, cap = null, grow = 1;
    if (t < 5) { car = arc(home, above, t / 5, 120); this.drawBugs(b, t, 1); }
    else if (t < 7.5) { car = { x: above.x, y: above.y + Math.sin(t * 3) * 2 }; grow = (t - 5) / 2.5; cap = { x: b.x, y: b.y - 24 - grow * 20 }; this.drawBugs({ x: b.x, y: b.y - grow * 20 }, t, 1 - grow * 0.4); }
    else if (t < 15) { car = arc(above, { x: jail.x, y: jail.y - 50 }, (t - 7.5) / 7.5, 160); cap = { x: car.x, y: car.y + 24 }; }
    if (cap) {
      const r = 14 + 6 * Math.min(1, grow);
      const C = this.skin.capsule;
      cx.globalAlpha = 0.85; cx.fillStyle = C.fill; cx.strokeStyle = C.stroke; cx.lineWidth = 2;
      cx.beginPath(); cx.ellipse(cap.x, cap.y, r * 0.7, r, 0, 0, Math.PI * 2); cx.fill(); cx.stroke();
      if (t >= 7.5) { const img = this.bug[frame2(t * 10)]; cx.drawImage(img, cap.x - img.width, cap.y - img.height, img.width * 2, img.height * 2); }
      cx.fillStyle = C.lid; cx.fillRect(Math.round(cap.x - 3), Math.round(cap.y - r - 3), 6, 3); // tapa
      cx.globalAlpha = 1;
      if (car) { cx.strokeStyle = 'rgba(148, 163, 184, .8)'; cx.lineWidth = 1; cx.beginPath(); cx.moveTo(car.x, car.y + 8); cx.lineTo(cap.x, cap.y - r); cx.stroke(); } // cable
    }
    if (car) this.car('fly', car.x, car.y, t, (t < 5 ? above.x < home.x : jail.x < above.x));
    if (t > 5 && t < 15) this.watchLabel({ x: (cap || b).x, y: (cap || b).y + 8 }, 'EN CUARENTENA', this.skin.capsule.label);
  }
  // bichos caminando sobre un punto (los usa la capsula mientras los atrapa)
  drawBugs(p, t, a = 1) {
    const { cx } = this; cx.globalAlpha = a;
    for (let i = 0; i < 2; i++) { const ang = t * 1.3 + i * 2.1, img = this.bug[frame2(t * 8 + i)];
      cx.save(); cx.translate(Math.round(p.x + Math.cos(ang) * 22), Math.round(p.y - 24 + Math.sin(ang) * 10)); cx.rotate(ang + Math.PI); cx.drawImage(img, -img.width, -img.height, img.width * 2, img.height * 2); cx.restore(); }
    cx.globalAlpha = 1;
  }
  release() {
    const from = this.jailPos(); if (!from || this.still || this.skin.none) return;
    const w = this.getWorld();
    let to = null; try { to = w && w.screenOf ? w.screenOf('gate') : null; } catch { to = null; }
    this.fx.push({ type: 'release', from, to: to || { x: from.x, y: -40 }, t: 0, dur: 6 });
    this.run();
  }
  drawRelease(f) {
    const k = Math.min(1, f.t / f.dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    const x = f.from.x + (f.to.x - f.from.x) * e, y = f.from.y + (f.to.y - f.from.y) * e;
    const { cx } = this;
    cx.globalAlpha = k > 0.8 ? (1 - k) / 0.2 : 1;
    this.car('probe', x, y, f.t, f.to.x < f.from.x);
    cx.font = "700 10px 'Space Grotesk', system-ui, sans-serif"; cx.textAlign = 'center';
    const tw = cx.measureText('LIBERADA').width + 10;
    cx.fillStyle = 'rgba(5, 9, 18, .85)'; cx.fillRect(Math.round(x - tw / 2), Math.round(y - 30), Math.round(tw), 15);
    cx.fillStyle = '#94a3b8'; cx.fillText('LIBERADA', x, y - 19);
    cx.globalAlpha = 1;
  }
  // de donde salen: la torre de control del tema; si no la hay, el borde de la pantalla mas cercano
  home(b) {
    const w = this.getWorld();
    let p = null;
    try { p = w && w.screenOf ? w.screenOf('tower') : null; } catch { p = null; }
    if (p && p.x > -200 && p.x < innerWidth + 200 && p.y > -200 && p.y < innerHeight + 200) return { x: p.x, y: p.y - 30 };
    return b ? { x: b.x < innerWidth / 2 ? -60 : innerWidth + 60, y: Math.max(40, b.y - 160) } : null;
  }
  drawWatch(nowMs) {
    const { cx } = this, t = nowMs / 1000;
    const ease = u => (u < 0.5 ? 2 * u * u : 1 - (-2 * u + 2) ** 2 / 2);
    for (const [k, P] of this.patrols) {
      const w = P.w, b = this.pos(w.kind, w.id);
      if (w.reason === 'phpbad') {
        // archivo PHP sospechoso: un bicho rojo que camina en circulos sobre el edificio
        if (!b) continue;
        const hit = this.phpHit && this.phpHit.get(w.id) > t; // alguien la busco: se agitan, sirena y cartel
        if (hit) {
          cx.globalAlpha = 0.25 + 0.2 * Math.sin(t * 12); cx.fillStyle = '#ef4444'; cx.beginPath(); cx.ellipse(b.x, b.y - 20, 46, 26, 0, 0, Math.PI * 2); cx.fill(); cx.globalAlpha = 1;
          cx.fillStyle = Math.floor(t * 8) % 2 ? '#ef4444' : '#3b82f6'; cx.fillRect(Math.round(b.x - 5), Math.round(b.y - 92), 10, 6);
        }
        for (let i = 0; i < Math.min(3, w.n || 1) + (hit ? 2 : 0); i++) {
          const sp = hit ? 4 : 1.3, a = t * sp + i * 2.1, img = this.bug[frame2(t * (hit ? 16 : 8) + i)], s = hit ? 2.4 : 2;
          const x = b.x + Math.cos(a) * 26 + (hit ? Math.sin(t * 40 + i) * 2 : 0), y = b.y - 24 + Math.sin(a) * 12;
          cx.save(); cx.translate(Math.round(x), Math.round(y)); cx.rotate(a + Math.PI); cx.drawImage(img, -img.width * s / 2, -img.height * s / 2, img.width * s, img.height * s); cx.restore();
        }
        this.watchLabel(b, hit ? 'ALGUIEN LA BUSCÓ' : w.n > 1 ? `${w.n} ARCHIVOS PHP SOSPECHOSOS` : 'ARCHIVO PHP SOSPECHOSO', '#ef4444');
        continue;
      }
      if (w.reason === 'php') {
        // sin procesos PHP: tres autos grises esperando en fila junto al edificio
        if (!b) continue;
        for (let i = 0; i < 3; i++) this.car('queue', b.x + 52 + i * 44, b.y + 26 + Math.sin(t * 3 + i) * 0.5, 0, true);
        this.watchLabel(b, `PHP AL LÍMITE · tope ${w.max || '?'} procesos`, '#fbbf24');
        continue;
      }
      if (w.reason === 'surge') {
        if (!b) continue;
        // dos reflectores que barren el cielo desde el edificio
        for (const side of [-1, 1]) {
          const a = -Math.PI / 2 + side * (0.35 + 0.25 * Math.sin(t * 1.3 + side)), L = 120;
          cx.globalAlpha = 0.22; cx.fillStyle = '#fde68a';
          cx.beginPath(); cx.moveTo(b.x + side * 10, b.y - 10);
          cx.lineTo(b.x + side * 10 + Math.cos(a - 0.09) * L, b.y - 10 + Math.sin(a - 0.09) * L);
          cx.lineTo(b.x + side * 10 + Math.cos(a + 0.09) * L, b.y - 10 + Math.sin(a + 0.09) * L);
          cx.closePath(); cx.fill();
        }
        cx.globalAlpha = 1;
        this.watchLabel(b, `PICO DE VISITAS · ${w.n}/min`, '#fbbf24');
        continue;
      }
      const home = this.home(b), e = t - P.t0;
      let moving = false;
      const drawn = [];
      for (const i of [0, 1]) {
        const side = i ? 1 : -1;
        if (b) P.park[i] = { x: b.x + side * 48, y: b.y - 4 };
        const park = P.park[i];
        const hover = Math.sin(t * 2.2 + i * 1.7) * 3;
        if (!park || !home) continue;
        // escolta: del edificio a la carcel (si la hay) y de ahi, sin el preso, a la torre
        const jail = P.escort || P.phase === 'home' ? this.jailPos() || P.jailLast : null; // en vivo: la camara se mueve
        if (jail) P.jailLast = jail;
        const from = P.phase === 'home' ? jail : P.phase === 'back' ? park : home;
        const to = P.phase === 'home' ? home : P.phase === 'back' ? (jail ? { x: jail.x + (i ? 26 : -26), y: jail.y - 36 } : home) : park;
        if (!from || !to) continue;
        // vuelo pausado, para disfrutarlo en pantalla: 4 a 9 s segun la distancia; la escolta, mas lenta todavia
        const d = Math.hypot(to.x - from.x, to.y - from.y), dur = this.still ? 0.6 : P.escort && P.phase === 'back' ? Math.min(11, Math.max(5, d / 80)) : Math.min(9, Math.max(4, d / 110));
        let u = P.phase === 'on' ? 1 : Math.min(1, Math.max(0, (e - i * 0.6) / dur));
        if (P.phase !== 'on' && u < 1) moving = true;
        if (P.phase === 'home' && u <= 0) { this.car('fly', from.x, from.y, t, false); moving = true; continue; } // espera su turno junto a la carcel
        if (P.phase === 'out' && u <= 0) continue; // todavia no despego
        if ((P.phase === 'back' || P.phase === 'home') && u >= 1) continue; // ya llego
        const k2 = ease(u), lift = Math.min(200, 60 + d * 0.35);
        const mx = (from.x + to.x) / 2, my = Math.min(from.y, to.y) - lift;
        const x = (1 - k2) ** 2 * from.x + 2 * (1 - k2) * k2 * mx + k2 * k2 * to.x;
        const y = (1 - k2) ** 2 * from.y + 2 * (1 - k2) * k2 * my + k2 * k2 * to.y + (P.phase === 'on' ? hover : 0);
        // en vuelo mira hacia donde va; suspendida, hacia el edificio
        const flip = P.phase === 'on' ? side > 0 : to.x < from.x;
        this.car('fly', x, y, t + i * 0.3, flip);
        drawn.push({ x, y, flip });
      }
      // escolta: el auto sospechoso va entre las dos patrullas, un poco mas abajo, con su cartel
      if (P.escort && P.phase === 'back' && drawn.length === 2) {
        const sx = (drawn[0].x + drawn[1].x) / 2, sy = (drawn[0].y + drawn[1].y) / 2 + 16;
        this.car('probe', sx, sy, t, drawn[0].flip);
        cx.font = "700 10px 'Space Grotesk', system-ui, sans-serif"; cx.textAlign = 'center';
        const tw = cx.measureText('IP BLOQUEADA').width + 10;
        cx.fillStyle = 'rgba(5, 9, 18, .85)'; cx.fillRect(Math.round(sx - tw / 2), Math.round(sy - 36), Math.round(tw), 15);
        cx.fillStyle = '#4ade80'; cx.fillText('IP BLOQUEADA', sx, sy - 25);
      }
      if (P.phase === 'out' && !moving && e > 0.5) P.phase = 'on';
      if (P.phase === 'back' && !moving && e > 0.5) {
        if (P.escort && P.jailLast) { P.phase = 'home'; P.t0 = t; P.escort = false; P.escorted = true; continue; } // dejaron al preso
        this.patrols.delete(k); continue;
      }
      if (P.phase === 'home' && !moving && e > 0.5) { this.patrols.delete(k); continue; }
      if (b && P.phase === 'on') {
        cx.globalAlpha = 0.16; cx.fillStyle = Math.floor(t * 6) % 2 ? '#ef4444' : '#3b82f6';
        cx.fillRect(Math.round(b.x - 72), Math.round(b.y + 14), 144, 12); cx.globalAlpha = 1;
      }
      const LBL = { scraping: `EN VIGILANCIA · UNA IP · ${w.n} pedidos`, scan: `EN VIGILANCIA · ${w.n} sondeos`, exposed: 'EXPUESTO · una ruta respondió',
        bruteforce: `FUERZA BRUTA · ${w.n} intentos`, multi: `LA MISMA IP EN ${w.n} SITIOS` };
      if (b && P.phase !== 'back' && LBL[w.reason]) this.watchLabel(b, LBL[w.reason], '#ef4444');
    }
  }
  setSaturation(s) {
    if (this.skin.none) { this.sat = null; return; } // en Terminal el aviso es una linea de texto
    this.sat = s && s.level === 'bad' ? s : null;
    if (this.sat) this.run();
  }
  drawSaturation(nowMs) {
    const w = this.getWorld();
    let p = null; try { p = w && w.screenOf ? w.screenOf('tower') : null; } catch { p = null; }
    if (!p || this.covered(p)) p = { x: innerWidth / 2, y: 150 };
    const { cx } = this, t = nowMs / 1000;
    // anillo rojo que late y ondas de calor que suben
    for (let i = 0; i < 2; i++) { const u = (t * 0.7 + i * 0.5) % 1; this.burst({ x: p.x, y: p.y }, '#ef4444', u, 0.85); }
    cx.strokeStyle = '#fb923c'; cx.lineWidth = 2;
    for (let i = -1; i <= 1; i++) {
      const u = (t * 0.6 + (i + 1) * 0.33) % 1;
      cx.globalAlpha = (1 - u) * 0.6; cx.beginPath();
      for (let k = 0; k <= 10; k++) { const yy = p.y - 30 - u * 70 - k * 3, xx = p.x + i * 16 + Math.sin(k * 0.9 + t * 5) * 3; k ? cx.lineTo(xx, yy) : cx.moveTo(xx, yy); }
      cx.stroke();
    }
    cx.globalAlpha = 1;
    this.watchLabel({ x: p.x, y: p.y - 60 }, `SERVIDOR AL LÍMITE · ${(this.sat.causes[0] || {}).label || ''}`.toUpperCase(), '#ef4444');
  }
  watchLabel(p, label, col) {
    const { cx } = this;
    cx.font = "700 11px 'Space Grotesk', system-ui, sans-serif"; cx.textAlign = 'center';
    const tw = cx.measureText(label).width + 14, ly = Math.round(p.y - 58);
    cx.fillStyle = 'rgba(5, 9, 18, .88)'; cx.fillRect(Math.round(p.x - tw / 2), ly - 13, Math.round(tw), 19);
    cx.fillStyle = col; cx.fillRect(Math.round(p.x - tw / 2), ly - 13, 3, 19); cx.fillRect(Math.round(p.x - tw / 2), ly + 5, Math.round(tw), 1);
    cx.fillText(label, p.x + 1, ly + 1);
  }

  later(find, then, tries = 8) {
    const p = find();
    if (p || tries <= 0) return then(p);
    setTimeout(() => this.later(find, then, tries - 1), 120);
  }

  packet(from, to, kind) {
    // mismo lugar (un tema sin subagentes dibujados): el sobre sale hacia un costado
    if (Math.hypot(to.x - from.x, to.y - from.y) < 14) to = nudge(from, kind === 'result' ? -1 : 1);
    const d = Math.hypot(to.x - from.x, to.y - from.y);
    this.fx.push({ type: 'packet', kind, from, to, t: 0, dur: this.still ? 0.6 : Math.min(1.8, 0.7 + d / 700), lift: Math.min(140, 30 + d * 0.35) });
    this.run();
  }
  beam(from, to, kind) {
    this.fx.push({ type: 'beam', kind, from, to, t: 0, dur: this.still ? 0.6 : 1.3 });
    this.run();
  }
  // marca del director: esquinas pixeladas sobre lo que esta mostrando (se recalcula cada cuadro: la camara se mueve)
  spot(kind, id, secs) {
    this.fx = this.fx.filter(f => f.type !== 'spot');
    this.fx.push({ type: 'spot', kind, id, t: 0, dur: secs });
    this.run();
  }
  unspot() { for (const f of this.fx) if (f.type === 'spot') f.t = Math.max(f.t, f.dur); }
  warp(at, dir, reason) {
    const label = dir === 'in' ? 'nueva sesión' : reason === 'timeout' ? 'sin actividad' : 'sesión cerrada';
    this.fx.push({ type: 'warp', dir, at, label, t: 0, dur: this.still ? 0.6 : 1.6, seed: Math.random() * 1000 });
    this.run();
  }
  run() { if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(t => this.frame(t)); } }

  frame(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000); this.last = now;
    const { cx, dpr } = this;
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.clearRect(0, 0, this.cv.width, this.cv.height);
    cx.setTransform(dpr, 0, 0, dpr, 0, 0);
    cx.imageSmoothingEnabled = false;
    if (this.sat) this.drawSaturation(now);
    if (this.patrols.size) this.drawWatch(now);
    for (const f of this.fx) { f.t += dt; (f.type === 'packet' ? this.drawPacket : f.type === 'probe' ? this.drawProbe : f.type === 'warp' ? this.drawWarp : f.type === 'dbslow' ? this.drawDbSlow : f.type === 'spot' ? this.drawSpot : f.type === 'release' ? this.drawRelease : f.type === 'capsule' ? this.drawCapsule : this.drawBeam).call(this, f); }
    // un archivo expuesto queda marcado 6 s; lo demas se va al terminar
    this.fx = this.fx.filter(f => f.t < f.dur + (f.type === 'probe' && f.exposed ? 6 : 0.35));
    this.raf = this.fx.length || this.patrols.size || this.sat ? requestAnimationFrame(t => this.frame(t)) : 0;
    if (!this.raf) cx.clearRect(0, 0, innerWidth, innerHeight);
  }

  // sobre en arco con estela de pixeles; al llegar, un destello cuadrado
  drawPacket(f) {
    const { cx } = this, c = COLORS[f.kind];
    const k = Math.min(1, f.t / f.dur), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;
    const at = u => { const mx = (f.from.x + f.to.x) / 2, my = Math.min(f.from.y, f.to.y) - f.lift;
      return { x: (1 - u) ** 2 * f.from.x + 2 * (1 - u) * u * mx + u * u * f.to.x, y: (1 - u) ** 2 * f.from.y + 2 * (1 - u) * u * my + u * u * f.to.y }; };
    cx.fillStyle = c;
    for (let i = 1; i <= 7; i++) { const u = e - i * 0.035; if (u <= 0) break; const p = at(u); cx.globalAlpha = 0.5 * (1 - i / 8); cx.fillRect(Math.round(p.x) - 2, Math.round(p.y) - 2, 4, 4); }
    cx.globalAlpha = 1;
    if (k < 1) {
      const p = at(e), s = 3, img = this.env[f.kind];
      cx.drawImage(img, Math.round(p.x - img.width * s / 2), Math.round(p.y - img.height * s / 2), img.width * s, img.height * s);
      if (LABEL[f.kind]) { cx.font = "600 11px 'Space Grotesk', system-ui, sans-serif"; cx.textAlign = 'center'; cx.fillStyle = c; cx.fillText(LABEL[f.kind], p.x, p.y - 16); }
    } else this.burst(f.to, c, (f.t - f.dur) / 0.35);
  }

  // haz punteado del agente al proyecto; el edificio recibe un pulso (ambar si edita, celeste si lee)
  drawBeam(f) {
    const { cx } = this, c = COLORS[f.kind];
    const k = Math.min(1, f.t / (f.dur * 0.45));
    const fade = f.t > f.dur ? 1 - (f.t - f.dur) / 0.35 : 1;
    const x = f.from.x + (f.to.x - f.from.x) * k, y = f.from.y + (f.to.y - f.from.y) * k;
    const n = Math.max(2, Math.floor(Math.hypot(x - f.from.x, y - f.from.y) / 9));
    cx.fillStyle = c;
    for (let i = 0; i < n; i++) { const u = i / n; cx.globalAlpha = fade * (0.25 + 0.65 * u); cx.fillRect(Math.round(f.from.x + (x - f.from.x) * u) - 1.5, Math.round(f.from.y + (y - f.from.y) * u) - 1.5, 3, 3); }
    cx.globalAlpha = 1;
    if (k >= 1) this.burst(f.to, c, ((f.t - f.dur * 0.45) / (f.dur * 0.55 + 0.35)) % 1, fade);
  }

  // haz de sesion: columna de luz pixelada. Salida: crece, los pixeles del bot suben y se apaga hacia arriba.
  // Entrada: baja desde arriba y se abre en el piso. El cartel dice que paso, sin nombres (sirve en publico).
  drawWarp(f) {
    const { cx } = this, out = f.dir === 'out', c = out ? '#a5b4fc' : '#4ade80';
    const k = Math.min(1, f.t / f.dur), fade = f.t > f.dur ? Math.max(0, 1 - (f.t - f.dur) / 0.35) : 1;
    const x = Math.round(f.at.x), foot = Math.round(f.at.y + 16), top = foot - 120;
    // la columna: aparece rapido, se sostiene y se angosta hasta una linea
    const grow = Math.min(1, k / 0.18), shrink = k > 0.6 ? 1 - (k - 0.6) / 0.4 : 1;
    const w = Math.max(2, Math.round(26 * grow * shrink)), h = foot - top;
    const y0 = out ? foot - Math.round(h * grow) : top, y1 = out ? foot : top + Math.round(h * grow);
    for (let y = y0; y < y1; y += 4) {
      const u = (y - top) / h;
      cx.globalAlpha = fade * (out ? 0.15 + 0.45 * u : 0.6 - 0.45 * u) * (0.75 + 0.25 * Math.sin(f.seed + y * 0.3 + f.t * 18));
      cx.fillStyle = c; cx.fillRect(x - w / 2, y, w, 3);
    }
    cx.globalAlpha = fade * 0.9; cx.fillStyle = '#fff'; cx.fillRect(x - 1, y0, 2, y1 - y0);
    // pixeles que suben (salida) o caen (entrada)
    for (let i = 0; i < 14; i++) {
      const r = (Math.sin(f.seed + i * 12.9898) * 43758.5453) % 1, ph = ((k * 1.4 + Math.abs(r)) % 1);
      const py = out ? foot - ph * (h + 20) : top + ph * (h + 10), px = x + (Math.abs(r) - 0.5) * 30;
      cx.globalAlpha = fade * (1 - ph) * 0.9; cx.fillStyle = i % 3 ? c : '#fff';
      cx.fillRect(Math.round(px) - 2, Math.round(py) - 2, 4, 4);
    }
    // piso: anillo pixelado
    const ring = out ? 1 - k : k;
    cx.globalAlpha = fade * 0.7; cx.fillStyle = c;
    for (let a = 0; a < 16; a++) { const t = a / 16 * Math.PI * 2; cx.fillRect(Math.round(x + Math.cos(t) * (10 + 12 * ring)) - 1.5, Math.round(foot + Math.sin(t) * (3 + 3 * ring)) - 1.5, 3, 3); }
    // cartel
    cx.globalAlpha = fade * Math.min(1, f.t / 0.2);
    cx.font = "600 11px 'Space Grotesk', system-ui, sans-serif"; cx.textAlign = 'center';
    const tw = cx.measureText(f.label).width + 12, ly = top - 6;
    cx.fillStyle = 'rgba(5, 9, 18, .85)'; cx.fillRect(Math.round(x - tw / 2), ly - 13, Math.round(tw), 18);
    cx.fillStyle = c; cx.fillRect(Math.round(x - tw / 2), ly + 4, Math.round(tw), 2);
    cx.fillText(f.label, x, ly);
    cx.globalAlpha = 1;
  }

  drawSpot(f) {
    const p = this.pos(f.kind, f.id);
    if (!p || !p.world) return;
    const { cx } = this, c = '#22d3ee';
    const fade = f.t > f.dur ? Math.max(0, 1 - (f.t - f.dur) / 0.35) : Math.min(1, f.t / 0.3);
    const r = 34 + 4 * Math.sin(f.t * 4) + Math.max(0, 1 - f.t * 2) * 40, L = 10;
    const x = Math.round(p.x), y = Math.round(p.y);
    cx.globalAlpha = fade; cx.fillStyle = c;
    for (const [sx, sy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const cxp = x + sx * r, cyp = y + sy * r;
      cx.fillRect(Math.round(cxp - (sx > 0 ? L : 0)), Math.round(cyp - (sy > 0 ? 3 : 0)), L, 3);
      cx.fillRect(Math.round(cxp - (sx > 0 ? 3 : 0)), Math.round(cyp - (sy > 0 ? L : 0)), 3, L);
    }
    cx.globalAlpha = 1;
  }

  // consulta lenta: un cilindro de base pixelado sobre el edificio, con reloj de arena y dos ondas ambar
  drawDbSlow(f) {
    const { cx } = this, c = '#fbbf24', k = Math.min(1, f.t / f.dur);
    const fade = f.t > f.dur ? Math.max(0, 1 - (f.t - f.dur) / 0.35) : Math.min(1, f.t / 0.2);
    const x = Math.round(f.at.x), y = Math.round(f.at.y - 34 - 6 * Math.sin(Math.min(1, k * 2) * Math.PI / 2));
    for (let i = 0; i < 2; i++) { const u = (k * 1.6 + i * 0.5) % 1; this.burst({ x: f.at.x, y: f.at.y }, c, u, fade * 0.8); }
    cx.globalAlpha = fade;
    // cilindro 14x16 en pixeles de 2
    cx.fillStyle = '#78350f'; cx.fillRect(x - 8, y - 8, 16, 18);
    cx.fillStyle = c; cx.fillRect(x - 7, y - 8, 14, 3); cx.fillRect(x - 7, y - 1, 14, 2); cx.fillRect(x - 7, y + 6, 14, 2);
    cx.fillStyle = '#fde68a'; cx.fillRect(x - 5, y - 8, 4, 1);
    // reloj de arena al costado
    cx.fillStyle = '#e2e8f0'; cx.fillRect(x + 10, y - 7, 8, 2); cx.fillRect(x + 10, y + 6, 8, 2);
    cx.fillStyle = c; cx.fillRect(x + 11, y - 5, 6, 3); cx.fillRect(x + 13, y - 2, 2, 3); cx.fillRect(x + 11, y + 1 + Math.round(2 * (1 - k)), 6, 5 - Math.round(2 * (1 - k)));
    cx.font = "600 11px 'Space Grotesk', system-ui, sans-serif"; cx.textAlign = 'center';
    const label = `consulta lenta · ${f.secs} s`, tw = cx.measureText(label).width + 12;
    cx.fillStyle = 'rgba(5, 9, 18, .85)'; cx.fillRect(Math.round(x - tw / 2), y - 30, Math.round(tw), 17);
    cx.fillStyle = c; cx.fillText(label, x, y - 18);
    cx.globalAlpha = 1;
  }

  burst(p, c, u, fade = 1) {
    const { cx } = this, r = 6 + u * 22;
    cx.globalAlpha = Math.max(0, (1 - u) * fade);
    cx.strokeStyle = c; cx.lineWidth = 3;
    cx.strokeRect(Math.round(p.x - r), Math.round(p.y - r), Math.round(r * 2), Math.round(r * 2));
    cx.globalAlpha = 1;
  }

  destroy() { cancelAnimationFrame(this.raf); removeEventListener('resize', this.resize); this.cv.remove(); }
}

// sin lugar propio (un tema que no dibuja subagentes): un poco al lado del agente
function nudge(p, dir = 1) { return p ? { x: p.x + 56 * dir, y: p.y - 34 } : null; }

// posicion en pantalla de un objeto de PixiJS (sprite, contenedor o un objeto con .spr/.c/.cont/.root)
// cuadro 0 o 1 de una animacion de dos cuadros; siempre valido aunque el tiempo arranque negativo
const frame2 = x => ((Math.floor(x) % 2) + 2) % 2;

export function pixiScreen(app, o) {
  const d = o && [o, o.spr, o.sp, o.sprite, o.worker, o.s, o.C, o.c, o.cont, o.root, o.body].find(x => x && typeof x.getBounds === 'function');
  if (!app || !d || d.destroyed || typeof d.getBounds !== 'function' || !d.visible) return null;
  const b = d.getBounds();
  if (!b || !(b.width > 0)) return null;
  const r = app.canvas.getBoundingClientRect();
  return { x: r.left + b.x + b.width / 2, y: r.top + b.y + b.height * 0.4 };
}
