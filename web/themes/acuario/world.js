// Tema "Acuario" (3D, three.js): una pared de peceras como en una tienda de acuarios.
//  - cada cuenta es una PECERA independiente sobre su estante, con una placa debajo: su nombre, su cuenta
//    de cPanel y la LISTA DE SUS PECES, cada uno con su dibujo en pixel art (se ubica cualquier proyecto sin clic)
//  - cada servicio o sitio es un PEZ con colores propios (salen de su nombre): tamano = memoria,
//    velocidad = CPU; parcial = quieto en el fondo; caido = panza arriba y gris
//  - al acercar la camara a una pecera, cada pez lleva su nombre encima
//  - cada visita es comida que cae y el pez va a buscarla; un error 5xx, una nube roja
//  - cada intento de acceso es una medusa que cae sobre la tapa de una pecera; si la IP cae, se deshace
//  - cada sesion de Claude Code es un BUZO en la arena de su pecera
//  - a la izquierda, el FILTRO es el servidor: su agua sube con el disco usado y burbujea segun la carga
// Regla de oro: calma y claridad; todo se mueve lento y cada pez se puede nombrar de un vistazo.
import { Stage3D, THREE, color, clamp } from '../../js/stage3d.js';
import { esc, fmtBytes } from '../../js/hud.js';
import { accountCaption } from '../../js/accounts.js';
import { healthLine } from '../../js/layout.js';

const FISH_COLORS = ['#ff8a3d', '#ffd23f', '#ff5e8a', '#7be0ff', '#b48cff', '#7be06b', '#ff4d5e', '#f4f1e8', '#3ddbd9', '#ffb3c7'];
function hash(s) { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }
const TH = 3.6, TD = 2.6, GAP = 1.6; // alto y fondo de cada pecera, espacio entre peceras
const FONT_K = 0.36; // la letra de las placas mide 0.36 unidades del mundo: crece y se achica con la camara

// el dibujo del pez en la placa: 9x5 pixeles con sus dos colores (el acento pixel de la interfaz)
const FISH_PX = ['..aaaa..b', '.aaaaaabb', 'aakaaaabb', '.aaaaaabb', '..aaaa..b'];
function fishIcon(a, b, dead) {
  const c = document.createElement('canvas'); c.width = 9; c.height = 5;
  const x = c.getContext('2d');
  FISH_PX.forEach((row, y) => [...row].forEach((ch, i) => {
    if (ch === '.') return;
    x.fillStyle = ch === 'k' ? '#081620' : dead ? (ch === 'a' ? '#8a9aa0' : '#6d7c82') : ch === 'a' ? a : b;
    x.fillRect(i, dead ? 4 - y : y, 1, 1);
  }));
  return c.toDataURL();
}

export default class Acuario3D extends Stage3D {
  constructor(el, opts) {
    super(el, opts);
    this.fov = 30; this.fitScale = 1; this.orbitSpeed = 0;
    this.fish = new Map(); this.tanks = new Map(); this.divers = new Map();
    this.layoutKey = '';
    this.view = { az: Math.PI / 2, el: 0.12, dist: 60, tx: 0, ty: 1, tz: 0, zoom: 1 };
    this.orbit = { ...this.view }; this.goal = { ...this.view };
  }

  async build() {
    const S = this.scene;
    S.add(new THREE.HemisphereLight(0xbfe9ff, 0x0a1520, 0.9));
    const key = new THREE.DirectionalLight(0xffffff, 0.9); key.position.set(4, 20, 18); S.add(key);
    // pared del fondo, con la luz de acuario que ondula
    this.wallMat = new THREE.MeshStandardMaterial({ color: 0x0b1e2d, roughness: 1, emissive: 0x06202c, emissiveIntensity: 0.6 });
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(400, 120), this.wallMat);
    wall.position.set(0, 0, -3); S.add(wall);
    this.rack = new THREE.Group(); S.add(this.rack);
  }

  // ------------------------------------------------------------------ las peceras
  layout(state) {
    const accounts = state.accounts.filter(a => a.id !== 'root');
    const by = {};
    for (const a of state.apps) (by[a.account] = by[a.account] || []).push({ ...a, _k: 'app' });
    for (const x of state.sites || []) (by[x.account] = by[x.account] || []).push({ ...x, _k: 'site' });
    const key = accounts.map(a => a.id + ':' + a.label + ':' + (a.cpanel || '') + ':' + (by[a.id] || []).map(x => x.id + x.name).join(',')).join('|');
    if (key === this.layoutKey) return;
    if (key !== this.realKey) { this.realKey = key; this.refits = 0; }
    this.layoutKey = key;
    this.rack.clear();
    for (const t of this.tanks.values()) t.plaque.remove();
    for (const f of this.fish.values()) f.label.remove();
    for (const d of this.divers.values()) d.label.remove();
    if (this.filterLabel) this.filterLabel.remove();
    this.tanks.clear(); this.fish.clear(); this.divers.clear();
    this.pickables = [];
    const list = accounts.filter(a => (by[a.id] || []).length)
      .map(a => ({ a, items: by[a.id].sort((x, y) => (x._k === y._k ? 0 : x._k === 'app' ? -1 : 1)) }))
      .sort((x, y) => y.items.length - x.items.length);
    list.forEach(t => { t.w = clamp(3.2 + t.items.length * 0.34, 4.6, 14); });
    // estantes: se prueba con 1 a 4 filas y se queda la que deja las peceras mas grandes en pantalla
    const FW = 3.2;
    let best = null;
    for (let n = 1; n <= Math.min(4, list.length); n++) {
      const sum = list.reduce((k, t) => k + t.w + GAP, FW + GAP), target = sum / n;
      const rows = [[]]; let used = FW + GAP;
      for (const t of list) { if (used + t.w / 2 > target && rows[rows.length - 1].length && rows.length < n) { rows.push([]); used = 0; } rows[rows.length - 1].push(t); used += t.w + GAP; }
      const widths = rows.map((r, i) => r.reduce((k, t) => k + t.w, 0) + (r.length - 1) * GAP + (i === 0 ? FW + GAP : 0));
      const heights = rows.map(r => TH + 0.6 + Math.max(...r.map(t => (t.plaqueU = this.plaqueUnits(t.a.id, FONT_K * 1.3 * this.plaqueLines(t.items.length, t.w, FONT_K) + 0.6)))));
      const w = Math.max(...widths) + 3, h = heights.reduce((k, x) => k + x, 0) + 1;
      const score = Math.min(this.areaAspect() / w, 1 / h);
      if (!best || score > best.score) best = { rows, widths, heights, w, h, score };
    }
    let y = 0;
    best.rows.forEach((row, ri) => {
      const total = best.widths[ri];
      let x = -total / 2;
      const shelf = new THREE.Mesh(new THREE.BoxGeometry(total + 1.6, 0.25, TD + 0.8), new THREE.MeshStandardMaterial({ color: 0x2a3440, metalness: 0.6, roughness: 0.45 }));
      shelf.position.set(0, y - 0.13, 0); this.rack.add(shelf);
      if (ri === 0) { this.buildFilter(x + FW / 2, y, FW); x += FW + GAP; }
      for (const t of row) { t.x = x + t.w / 2; t.y = y; x += t.w + GAP; this.buildTank(t); }
      y -= best.heights[ri];
    });
    this.extent = { w: best.w, h: best.h, top: TH + 0.8, bottom: y + 0.4 };
    this.fit(true);
  }
  // encuadre: que entren todas las peceras y sus placas (fov 30: se ve 0.536 x distancia de alto)
  fit(snap) {
    const E = this.extent; if (!E) return;
    const dist = this.distToFit(E.w, E.h) * 1.03;
    this.setView({ dist, ty: (E.top + E.bottom) / 2 + E.h * 0.05 }, snap); // la camara mira un poco desde arriba: se sube el centro
  }
  setInsets(ins) { super.setInsets(ins); if (this.extent) this.fit(false); }

  buildFilter(x, y, w) {
    const g = new THREE.Group(); g.position.set(x, y, 0);
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, TH, TD * 0.8), new THREE.MeshStandardMaterial({ color: 0x9fd9e6, transparent: true, opacity: 0.18, depthWrite: false }));
    body.position.y = TH / 2;
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, TH, TD * 0.8)), new THREE.LineBasicMaterial({ color: 0x3ddbd9 }));
    frame.position.y = TH / 2;
    const water = new THREE.Mesh(new THREE.BoxGeometry(w - 0.2, 1, TD * 0.8 - 0.2), new THREE.MeshStandardMaterial({ color: 0x3ddbd9, transparent: true, opacity: 0.35, emissive: 0x3ddbd9, emissiveIntensity: 0.3, depthWrite: false }));
    water.geometry.translate(0, 0.5, 0); water.position.y = 0.1;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.42, w * 0.42, 0.35, 24), new THREE.MeshStandardMaterial({ color: 0x1b2833, metalness: 0.6, roughness: 0.4 }));
    cap.position.y = TH + 0.17;
    const led = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshBasicMaterial({ color: color(this.C.ok) }));
    led.position.set(0, TH + 0.4, 0);
    body.userData = water.userData = cap.userData = { kind: 'system', id: 'root' };
    g.add(body, frame, water, cap, led);
    this.rack.add(g);
    this.pickables.push(body, cap);
    this.filter = { g, water, led, x, y, w };
    this.filterLabel = this.label('w3-plaque w3-filter', '<b>Servidor</b><small></small><i class="hl"></i>', new THREE.Vector3(x, y - 0.3, TD / 2));
    this.filterLabel.d.dataset.go = 'system:root';
  }

  buildTank(t) {
    const { a, items, w } = t;
    const g = new THREE.Group(); g.position.set(t.x, t.y, 0);
    const water = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, TH - 0.35, TD - 0.1), new THREE.MeshStandardMaterial({ color: 0x1f7a90, transparent: true, opacity: 0.3, roughness: 0.2, emissive: 0x0b3a4a, emissiveIntensity: 0.8, depthWrite: false }));
    water.position.y = (TH - 0.35) / 2 + 0.02;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.1, TH - 0.35), new THREE.MeshStandardMaterial({ color: 0x0f4a5c, emissive: 0x0b3a4a, emissiveIntensity: 0.7, roughness: 1 }));
    back.position.set(0, (TH - 0.35) / 2 + 0.02, -TD / 2 + 0.06);
    const sand = new THREE.Mesh(new THREE.BoxGeometry(w - 0.1, 0.3, TD - 0.1), new THREE.MeshStandardMaterial({ color: 0xd9c08c, roughness: 1 }));
    sand.position.y = 0.15;
    const frame = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w, TH, TD)), new THREE.LineBasicMaterial({ color: 0xcfeee4, transparent: true, opacity: 0.7 }));
    frame.position.y = TH / 2;
    const lid = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.12, TD + 0.1), new THREE.MeshStandardMaterial({ color: 0x2e4450, emissive: new THREE.Color(0xffb347), emissiveIntensity: 0 }));
    lid.position.y = TH + 0.06;
    // franja del color de la cuenta en el borde de abajo: une pecera, placa y lista del HUD
    const band = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.22, 0.05), new THREE.MeshBasicMaterial({ color: color(a.color) }));
    band.position.set(0, 0.11, TD / 2 + 0.03);
    g.add(back, water, sand, frame, lid, band);
    // decoracion: rocas y plantas que se mecen
    let r = hash(a.id) || 1; const rnd = () => { r = Math.imul(r ^ r >>> 13, 1274126177) >>> 0; return (r % 1000) / 1000; };
    for (let i = 0; i < 2 + Math.floor(w / 4); i++) { const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.22 + rnd() * 0.25), new THREE.MeshStandardMaterial({ color: 0x5b6a70, roughness: 1, flatShading: true })); rock.position.set((rnd() - 0.5) * (w - 1), 0.35, (rnd() - 0.5) * (TD - 0.8)); g.add(rock); }
    const plants = [];
    for (let i = 0; i < 3 + Math.floor(w / 2.5); i++) {
      const h = 0.8 + rnd() * 1.8;
      const p = new THREE.Mesh(new THREE.BoxGeometry(0.09, h, 0.09), new THREE.MeshStandardMaterial({ color: rnd() < 0.5 ? 0x3f9a4a : 0x2e7a5a }));
      p.geometry.translate(0, h / 2, 0);
      p.position.set((rnd() - 0.5) * (w - 0.6), 0.3, -TD / 2 + 0.3 + rnd() * 0.5);
      p.userData.ph = rnd() * 6; g.add(p); plants.push(p);
    }
    water.userData = back.userData = { kind: 'district', id: a.id };
    this.pickables.push(water, back);
    this.rack.add(g);
    const nA = items.filter(x => x._k === 'app').length;
    const caption = accountCaption(a, nA, items.length - nA);
    const tank = { a, g, w, x: t.x, y: t.y, items, lid, plants, caption };
    this.tanks.set(a.id, tank);
    items.forEach(it => this.addFish(it, tank));
    // la placa: nombre, cuenta y la lista de sus peces con su dibujo
    tank.plaque = this.label('w3-plaque', `<b style="border-color:${a.color}">${esc(a.label)}</b><small>${esc(caption)}</small><div class="fishlist"></div>`, new THREE.Vector3(t.x, t.y - 0.3, TD / 2));
    tank.plaque.d.dataset.go = 'district:' + a.id;
    this.fillPlaque(tank);
  }

  fillPlaque(tank) {
    const rows = tank.items.map(it => {
      const f = this.fish.get(it.id);
      return `<span data-go="${it._k === 'site' ? 'site' : 'app'}:${esc(it.id)}"${f.dead ? ' class="down"' : ''}><img alt="" src="${f.dead ? f.iconDead : f.icon}"><em>${esc(f.data.name)}</em></span>`;
    });
    tank.plaque.d.querySelector('.fishlist').innerHTML = rows.join('');
  }

  addFish(it, tank) {
    const seed = hash(it.id + it.name);
    const hex = FISH_COLORS[seed % FISH_COLORS.length];
    let hex2 = FISH_COLORS[(seed >>> 5) % FISH_COLORS.length];
    if (hex2 === hex) hex2 = FISH_COLORS[(seed % FISH_COLORS.length + 3) % FISH_COLORS.length];
    const small = it._k === 'site';
    const g = new THREE.Group();
    const inner = new THREE.Group(); g.add(inner); // inner gira (panza arriba) sin tocar el rumbo
    const mat = new THREE.MeshStandardMaterial({ color: color(hex), roughness: 0.35, emissive: color(hex), emissiveIntensity: 0.18 });
    const mat2 = new THREE.MeshStandardMaterial({ color: color(hex2), roughness: 0.5, emissive: color(hex2), emissiveIntensity: 0.12 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), mat);
    body.scale.set(1.5, 0.95, 0.55);
    const tail = new THREE.Group(); tail.position.x = -0.42;
    const fin = new THREE.Mesh(new THREE.ConeGeometry(0.24, 0.42, 4), mat2);
    fin.rotation.z = Math.PI / 2; fin.position.x = -0.18; fin.scale.z = 0.35; tail.add(fin);
    const dorsal = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.3, 3), mat2);
    dorsal.position.set(-0.05, 0.3, 0); dorsal.scale.z = 0.3;
    const eyeM = new THREE.MeshBasicMaterial({ color: 0x081620 });
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), eyeM); eye.position.set(0.3, 0.07, 0.13);
    const eye2 = eye.clone(); eye2.position.z = -0.13;
    inner.add(body, tail, dorsal, eye, eye2);
    if (!small) { const stripe = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.045, 6, 18), mat2); stripe.rotation.y = Math.PI / 2; stripe.position.x = 0.05; stripe.scale.set(1, 1, 0.62); inner.add(stripe); }
    g.userData = { kind: small ? 'site' : 'app', id: it.id };
    tank.g.add(g);
    this.pickables.push(g);
    const half = tank.w / 2 - 0.6;
    const f = { g, inner, tail, mat, mat2, hex, hex2, seed, small, data: it, kind: it._k, tank, half,
      icon: fishIcon(hex, hex2, false), iconDead: fishIcon(hex, hex2, true),
      x: (Math.random() - 0.5) * half * 2, y: 0.9 + Math.random() * 1.8, z: (Math.random() - 0.5) * (TD - 1), tx: 0, ty: 1.5, tz: 0, retarget: 0, scale: 1, dead: it.status === 'down', ate: 0 };
    f.label = this.label('w3-fish', esc(it.name), () => f.nameVisible ? new THREE.Vector3(tank.x + f.x, tank.y + f.y + 0.4 * f.scale, f.z) : null);
    this.fish.set(it.id, f);
    this.paintFish(f);
  }
  paintFish(f) {
    f.mat.color.set(f.dead ? '#8a9aa0' : f.hex); f.mat.emissive.set(f.dead ? '#000000' : f.hex);
    f.mat2.color.set(f.dead ? '#6d7c82' : f.hex2); f.mat2.emissive.set(f.dead ? '#000000' : f.hex2);
  }

  // ------------------------------------------------------------------ estado
  update(state) {
    this.state = state;
    this.layout(state);
    const replate = new Set();
    for (const x of [...state.apps, ...(state.sites || [])]) {
      const f = this.fish.get(x.id);
      if (!f) continue;
      f.data = { ...x, _k: f.kind };
      const dead = x.status === 'down';
      if (dead !== f.dead) {
        f.dead = dead; this.paintFish(f); replate.add(f.tank);
        this.float(new THREE.Vector3(f.tank.x, f.tank.y + TH + 0.6, 0), dead ? `${x.name}: panza arriba` : `${x.name} volvió a nadar`, dead ? 'crit' : 'ok');
      }
      f.scale = f.small ? 0.72 : clamp(0.85 + Math.log2(1 + (x.mem || 0) / 60e6) * 0.16, 0.85, 1.6);
    }
    replate.forEach(t => this.fillPlaque(t));
    if (this.filter && state.system) {
      const s = state.system;
      this.filter.level = clamp((s.disk?.pct ?? 50) / 100, 0.05, 1);
      this.filter.load = s.load[0] / Math.max(1, s.cores);
      const bad = (state.keys || []).some(k => k.state === 'failed');
      this.filter.led.material.color.set(bad ? this.C.warn : this.C.ok);
      this.filterLabel.d.querySelector('small').textContent = `disco ${Math.round(s.disk?.pct ?? 0)}% · carga ${s.load[0].toFixed(1)}`;
    }
    // salud del servidor junto a su nombre
    const hl = healthLine(state), he = this.filterLabel && this.filterLabel.d.querySelector('.hl');
    if (he && hl) { he.textContent = hl.text; he.style.color = hl.color; }
    this.syncDivers(state.sessions || []);
  }

  syncDivers(sessions) {
    const seen = new Set(), per = {};
    for (const s of sessions) {
      const tank = this.tanks.get(s.account) || [...this.tanks.values()][0];
      if (!tank) continue;
      seen.add(s.id);
      let d = this.divers.get(s.id);
      if (d && d.tank !== tank) { this.dropDiver(s.id); d = null; }
      if (!d) {
        const g = new THREE.Group();
        const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), new THREE.MeshStandardMaterial({ color: 0xc8a24a, metalness: 0.8, roughness: 0.3 }));
        helmet.position.y = 0.78;
        const visor = new THREE.Mesh(new THREE.CircleGeometry(0.1, 14), new THREE.MeshBasicMaterial({ color: 0xa6e3c8 }));
        visor.position.set(0, 0.8, 0.19);
        const suit = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.19, 0.5, 12), new THREE.MeshStandardMaterial({ color: 0xffb347, roughness: 0.6 }));
        suit.position.y = 0.42;
        const tankB = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.36, 8), new THREE.MeshStandardMaterial({ color: 0x9aa7ad, metalness: 0.7 }));
        tankB.position.set(0, 0.5, -0.2);
        g.add(helmet, visor, suit, tankB);
        g.userData = { kind: 'session', id: s.id };
        tank.g.add(g); this.pickables.push(g);
        d = { g, tank, s, walk: Math.random() * 6 };
        d.label = this.label('w3-agent', '', () => new THREE.Vector3(tank.x + g.position.x, tank.y + 1.35, g.position.z));
        this.divers.set(s.id, d);
      }
      d.s = s;
      per[tank.a.id] = (per[tank.a.id] || 0) + 1; d.slot = per[tank.a.id] - 1;
      d.label.d.innerHTML = s.waitKind ? 'Buzo <em>ESPERA SU PERMISO</em>' : '';
    }
    for (const id of [...this.divers.keys()]) if (!seen.has(id)) this.dropDiver(id);
  }
  dropDiver(id) {
    const d = this.divers.get(id); if (!d) return;
    d.g.parent && d.g.parent.remove(d.g); d.label.remove();
    this.pickables = this.pickables.filter(p => p !== d.g);
    this.divers.delete(id);
  }

  // ------------------------------------------------------------------ eventos
  onEvent(e, priv) {
    switch (e.kind) {
      case 'http': {
        const f = this.fish.get(e.app || e.site);
        if (!f || f.dead || this.fx.length > 220) return;
        return e.status >= 500 ? this.murk(f) : this.food(f, e.bot);
      }
      case 'attack': return this.jelly(false);
      case 'block': return this.jelly(true, priv ? e.ip : null);
      case 'login': return this.filter && this.float(new THREE.Vector3(this.filter.x, this.filter.y + TH + 0.8, 0), priv && e.user ? `Entró ${e.user}` : 'Entró el acuarista', 'ok');
      case 'deploy': {
        const f = this.fish.get(e.app);
        const T = { building: ['nace un pez nuevo', 'warn'], ready: ['¡nació!', 'ok'], error: ['el huevo no prosperó', 'crit'], canceled: ['cancelado', 'dim'] }[e.action];
        if (f && T) this.float(new THREE.Vector3(f.tank.x + f.x, f.tank.y + TH + 0.6, 0), `${f.data.name}: ${T[0]}`, T[1]);
        return;
      }
      case 'pm2': { const f = this.fish.get(e.app); if (f && e.action !== 'down') this.float(new THREE.Vector3(f.tank.x + f.x, f.tank.y + TH + 0.6, 0), `${f.data.name} se reanimó`, 'warn'); return; }
      case 'domain': { const t = this.tanks.get(e.account); if (t) this.float(new THREE.Vector3(t.x, t.y + TH + 0.6, 0), ({ added: 'Pez nuevo en la pecera', removed: 'Un pez se fue', changed: 'Cambió un sitio' }[e.action] || '') + (priv && e.domain ? ` · ${e.domain}` : ''), e.action === 'removed' ? 'warn' : 'ok'); return; }
      case 'claude': {
        const d = this.divers.get(e.sid) || [...this.divers.entries()].find(([k]) => e.sid && k.startsWith(e.sid))?.[1];
        if (!d) return;
        const p = new THREE.Vector3(d.tank.x + d.g.position.x, d.tank.y + 1.8, d.g.position.z);
        if (e.action === 'permission') { this.urgent = { until: this.t + 12, goal: { tx: d.tank.x, ty: d.tank.y + TH / 2, tz: 0, zoom: this.zoomFor(d.tank), el: this.view.el } }; this.float(p, 'Pide su permiso', 'warn'); }
        else if (e.action === 'done') this.float(p, 'Tarea hecha', 'ok');
        else if (e.action === 'prompt') this.float(p, priv && e.text ? e.text.slice(0, 60) : 'Nueva instrucción', 'accent');
        return;
      }
    }
  }

  food(f, bot) {
    const t = f.tank;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), new THREE.MeshBasicMaterial({ color: bot ? 0x9aa7ad : 0xd9c08c }));
    m.position.set(t.x + clamp(f.x + (Math.random() - 0.5), -f.half, f.half), t.y + TH - 0.4, f.z);
    this.addFx(m, (fx, dt) => {
      m.position.y -= 0.6 * dt;
      const fx0 = t.x + f.x, fy0 = t.y + f.y;
      if (Math.hypot(fx0 - m.position.x, fy0 - m.position.y, f.z - m.position.z) < 0.35 * f.scale + 0.1) { f.ate = 1; return false; }
      if (fx.age > 0.3 && !f.dead) { f.tx = m.position.x - t.x; f.ty = m.position.y - t.y; f.tz = m.position.z; f.retarget = 1.2; }
      return m.position.y > t.y + 0.4 && fx.age < 6;
    });
  }
  murk(f) {
    const p = new THREE.Vector3(f.tank.x + f.x, f.tank.y + f.y, f.z);
    for (let i = 0; i < 8; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), new THREE.MeshBasicMaterial({ color: 0xff4d5e, transparent: true, opacity: 0.55, depthWrite: false }));
      m.position.copy(p); const v = new THREE.Vector3((Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.4);
      this.addFx(m, (fx, dt) => { m.position.addScaledVector(v, dt); m.scale.setScalar(1 + fx.age * 1.5); m.material.opacity = 0.55 * (1 - fx.age / 2.2); return fx.age < 2.2; });
    }
  }
  jelly(blocked, ip) {
    const tanks = [...this.tanks.values()]; if (!tanks.length) return;
    const t = tanks[Math.floor(Math.random() * tanks.length)];
    const g = new THREE.Group();
    const bell = new THREE.Mesh(new THREE.SphereGeometry(0.35, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe07ad8, emissive: 0xe07ad8, emissiveIntensity: 0.5, transparent: true, opacity: 0.85 }));
    g.add(bell);
    for (let i = 0; i < 6; i++) { const tl = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.5, 0.025), bell.material); tl.position.set(Math.cos(i * 1.05) * 0.2, -0.25, Math.sin(i * 1.05) * 0.2); g.add(tl); }
    const x = t.x + (Math.random() - 0.5) * (t.w - 1);
    g.position.set(x, t.y + TH + 4, 0.3);
    const lidY = t.y + TH + 0.4;
    this.addFx(g, (fx, dt) => {
      if (!fx.hit) {
        g.position.y -= 1.6 * dt; g.scale.y = 1 + Math.sin(fx.age * 6) * 0.12;
        if (g.position.y <= lidY) { fx.hit = fx.age; t.lidFlash = 1; if (blocked) this.float(new THREE.Vector3(x, lidY + 0.8, 0), ip ? `IP bloqueada · ${ip}` : 'IP bloqueada', 'warn'); }
        return true;
      }
      g.position.y += 0.7 * dt; bell.material.opacity = Math.max(0, 0.85 - (fx.age - fx.hit) * (blocked ? 1 : 0.4));
      return bell.material.opacity > 0;
    });
  }
  bubble(x, y, z, top, tone = 0xa6e3c8) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.04 + Math.random() * 0.03, 6, 4), new THREE.MeshBasicMaterial({ color: tone, transparent: true, opacity: 0.8 }));
    m.position.set(x, y, z);
    const sw = Math.random() * 6;
    this.addFx(m, (fx, dt) => { m.position.y += 0.9 * dt; m.position.x += Math.sin(fx.age * 4 + sw) * 0.15 * dt; return m.position.y < top; });
  }

  // ------------------------------------------------------------------ cuadro a cuadro
  frame(dt) {
    // la camara se mece suave frente a la pared (en vez de orbitar)
    if (this.directorOn && !this.manualUntil && !this.urgent) this.goal.az = Math.PI / 2 + Math.sin(this.t * 0.07) * 0.18;
    this.wallMat.emissiveIntensity = 0.55 + Math.sin(this.t * 0.6) * 0.08;
    // pecera enfocada: la mas cercana al punto que mira la camara, si la camara esta cerca
    let focus = null;
    if (this.orbit.zoom > 1.5) { let best = 1e9; for (const t of this.tanks.values()) { const d = Math.hypot(t.x - this.orbit.tx, t.y + TH / 2 - this.orbit.ty); if (d < best) { best = d; focus = t; } } }
    const F = this.filter;
    if (F) {
      const lvl = (F.level ?? 0.5) * (TH - 0.4);
      F.water.scale.y += (lvl - F.water.scale.y) * Math.min(1, dt * 2);
      if (Math.random() < dt * (1 + (F.load || 0.2) * 8)) this.bubble(F.x + (Math.random() - 0.5) * (F.w - 0.6), F.y + 0.3, (Math.random() - 0.5) * 0.8, F.y + 0.1 + F.water.scale.y, 0x7be0ff);
    }
    for (const t of this.tanks.values()) {
      t.plants.forEach(p => { p.rotation.z = Math.sin(this.t * 1.1 + p.userData.ph) * 0.12; });
      t.lidFlash = Math.max(0, (t.lidFlash || 0) - dt * 1.2);
      t.lid.material.emissiveIntensity = t.lidFlash * 1.6;
      if (Math.random() < dt * 0.7) this.bubble(t.x - t.w / 2 + 0.45, t.y + 0.4, -TD / 2 + 0.35, t.y + TH - 0.4);
    }
    // la placa ocupa el ancho de su pecera y su letra crece al acercarse
    this.refitPlaques([...this.tanks.values()], 1);
    this.sizePlaques([...this.tanks.values()].map(t => [t.plaque, t.w]).concat(this.filterLabel && F ? [[this.filterLabel, F.w]] : []), FONT_K);
    for (const f of this.fish.values()) {
      const a = f.data;
      if (f.dead) {
        f.y += ((TH - 0.6) - f.y) * Math.min(1, dt); f.x += Math.sin(this.t * 0.3 + f.seed) * 0.08 * dt;
        f.inner.rotation.x += (Math.PI - f.inner.rotation.x) * Math.min(1, dt * 2);
      } else {
        f.inner.rotation.x += (0 - f.inner.rotation.x) * Math.min(1, dt * 2);
        const speed = a.status === 'degraded' ? 0.12 : 0.35 + Math.min(a.cpu || 0, 100) * 0.025;
        f.retarget -= dt;
        if (f.retarget <= 0 || Math.hypot(f.tx - f.x, f.ty - f.y, f.tz - f.z) < 0.15) {
          f.retarget = 2 + Math.random() * 4;
          f.tx = (Math.random() - 0.5) * f.half * 2;
          f.ty = a.status === 'degraded' ? 0.6 : 0.75 + Math.random() * (TH - 1.6);
          f.tz = (Math.random() - 0.5) * (TD - 1.1);
        }
        const dx = f.tx - f.x, dy = f.ty - f.y, dz = f.tz - f.z, d = Math.hypot(dx, dy, dz) || 1;
        f.x += dx / d * speed * dt; f.y += dy / d * speed * 0.6 * dt; f.z += dz / d * speed * 0.5 * dt;
        const want = Math.atan2(-dz, dx);
        const dYaw = ((want - f.g.rotation.y + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        f.g.rotation.y += dYaw * Math.min(1, dt * 3);
        f.tail.rotation.y = Math.sin(this.t * (6 + speed * 6) + f.seed) * 0.5;
        f.ate = Math.max(0, f.ate - dt * 2);
        if ((a.reqMin || 0) > 0 && Math.random() < dt * Math.min(1.2, a.reqMin / 25)) this.bubble(f.tank.x + f.x + 0.3, f.tank.y + f.y + 0.1, f.z, f.tank.y + TH - 0.4);
      }
      f.x = clamp(f.x, -f.half, f.half); f.y = clamp(f.y, 0.55, TH - 0.55); f.z = clamp(f.z, -(TD / 2 - 0.45), TD / 2 - 0.45);
      f.g.position.set(f.x, f.y, f.z);
      f.g.scale.setScalar(f.scale * (1 + f.ate * 0.15));
      // su nombre encima cuando se mira esa pecera de cerca (o si esta caido)
      f.nameVisible = f.tank === focus || f.dead;
      f.label.d.classList.toggle('down', f.dead);
    }
    for (const d of this.divers.values()) {
      const waiting = !!d.s.waitKind;
      const half = d.tank.w / 2 - 0.5;
      d.g.position.set(clamp(-half + 0.4 + d.slot * 1.0 + (waiting ? 0 : (Math.sin(this.t * 0.2 + d.walk) + 1) * 0.5), -half, half), 0.3, TD / 2 - 0.5);
      if (d.s.state === 'working' && Math.random() < dt * 3) this.bubble(d.tank.x + d.g.position.x, d.tank.y + 1.05, d.g.position.z, d.tank.y + TH - 0.4, 0xffe0a8);
    }
  }

  // ------------------------------------------------------------------ camara, avisos y enfoque
  zoomFor(t) { return clamp((this.extent?.w || 30) / (t.w + 6), 1.7, 4.5); }
  shots() { return [...this.tanks.values()].map(t => ({ x: t.x, y: t.y + TH / 2 - 0.8, z: 0, zoom: this.zoomFor(t), el: this.view.el })); }
  locate(kind, id) {
    let t = null;
    if (kind === 'app' || kind === 'site') t = this.fish.get(id)?.tank;
    else if (kind === 'session') t = this.divers.get(id)?.tank;
    else if (kind === 'district') t = this.tanks.get(id);
    else if ((kind === 'system' || kind === 'security') && this.filter) return { x: this.filter.x, y: this.filter.y + TH / 2 - 0.8, z: 0, zoom: 3 };
    return t ? { x: t.x, y: t.y + TH / 2 - 0.8, z: 0, zoom: this.zoomFor(t) } : null;
  }
  tipFor(u) {
    if (u.kind === 'app' || u.kind === 'site') {
      const f = this.fish.get(u.id); if (!f) return null;
      const a = f.data;
      return { title: a.name, body: `${a.kind && a.kind !== a.name ? `<b>${esc(a.kind)}</b> · ` : ''}${f.small ? 'pez de un sitio' : 'pez de un servicio'} · pecera ${esc(f.tank.a.label)}`,
        meta: `${{ online: 'nada tranquilo', degraded: 'quieto en el fondo (parcial)', down: 'panza arriba (caído)' }[a.status] || a.status}${!f.small ? ` · CPU ${(a.cpu || 0).toFixed(1)}% · RAM ${fmtBytes(a.mem || 0)}` : ''} · ${a.reqMin || 0} visitas/min`, hint: 'Clic para ver el detalle' };
    }
    if (u.kind === 'session') { const d = this.divers.get(u.id); return d && { title: 'Buzo · agente de Claude Code', body: esc(d.s.activity || ''), meta: d.s.waitKind ? 'Espera su permiso o su respuesta' : { working: 'Trabajando', thinking: 'Pensando', idle: 'Descansando' }[d.s.state] || '', hint: 'Clic para ver la línea de tiempo' }; }
    if (u.kind === 'district') { const t = this.tanks.get(u.id); return t && { title: t.a.label, body: `Pecera con ${t.items.length} peces: los servicios y sitios de esta cuenta. Su placa, abajo, los nombra a todos.`, meta: t.caption, hint: 'Clic para acercarse y ver los nombres sobre cada pez' }; }
    if (u.kind === 'system') return { title: 'Filtro · servidor', body: 'El agua del filtro llega tan alto como el disco usado; burbujea más rápido con más carga.', meta: this.state?.system ? `CPU ${this.state.system.cpu.toFixed(0)}% · RAM ${this.state.system.mem.pct.toFixed(0)}% · carga ${this.state.system.load[0].toFixed(2)}` : '', hint: 'Clic para ver el servidor completo' };
    return null;
  }
}
