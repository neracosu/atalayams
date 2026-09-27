// Tema "Planta" (3D, three.js): una fabrica de automatizacion con la paleta de 16 colores de PICO-8.
//  - el servidor es la CENTRAL: su chimenea echa humo segun la CPU y dos silos muestran memoria y disco
//  - cada cuenta es una NAVE con su color; cada servicio una MAQUINA (engranaje que gira con la CPU, foco
//    de estado, tanque de memoria); cada sitio una PRENSA que golpea con sus visitas; encima, su cartel pixel
//  - debajo de cada nave, su PLACA nombra a todas sus maquinas (se ubica sin hacer clic); al acercarse,
//    cada maquina lleva su nombre encima
//  - cada visita es una PIEZA que entra por el porton, viaja por la cinta hasta su maquina y entra;
//    un error 5xx sale roja y cae al contenedor de CHATARRA junto a la central
//  - cada intento de acceso es un DRON que llega al cerco; la TORRETA lo derriba si la IP queda bloqueada
//  - cada sesion de Claude Code es un ROBOT OBRERO que lleva cajas; si espera su permiso, se detiene en
//    la barrera con luz ambar
// Regla de oro: todo fluye por cintas; los cuellos de botella y la chatarra se ven sin leer un numero.
import { Stage3D, THREE, color, clamp, billboard, groupsOf, layoutKeyOf, packRows, iconURL, plaqueList } from '../../js/stage3d.js';
import { signCanvas, robotCanvas } from '../../js/sprites.js';
import { esc, fmtBytes } from '../../js/hud.js';
import { accountCaption } from '../../js/accounts.js';
import { healthLine } from '../../js/layout.js';

// PICO-8
const K = { black: '#000000', navy: '#1d2b53', plum: '#7e2553', green: '#008751', brown: '#ab5236', dgray: '#5f574f', lgray: '#c2c3c7', white: '#fff1e8', red: '#ff004d', orange: '#ffa300', yellow: '#ffec27', lime: '#00e436', blue: '#29adff', lav: '#83769c', pink: '#ff77a8', peach: '#ffccaa' };
const SP = 2.3, COLS = 6, FONT_K = 0.36, EL = 0.8;

function tileTex() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 32;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#2a2a33'; cx.fillRect(0, 0, 32, 32);
  for (const [x, y] of [[0, 0], [16, 0], [0, 16], [16, 16]]) { cx.fillStyle = '#33333d'; cx.fillRect(x, y, 15, 15); cx.fillStyle = '#3d3d48'; cx.fillRect(x, y, 15, 1); cx.fillStyle = K.dgray; cx.fillRect(x + 2, y + 2, 1, 1); cx.fillRect(x + 12, y + 12, 1, 1); }
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function beltTex() {
  const cv = document.createElement('canvas'); cv.width = 16; cv.height = 8;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#1b1b22'; cx.fillRect(0, 0, 16, 8);
  cx.fillStyle = K.dgray; for (let x = 0; x < 16; x += 4) cx.fillRect(x, 1, 2, 6);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.magFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function gearGeo(r = 0.42, teeth = 8) {
  const shape = new THREE.Shape();
  for (let i = 0; i < teeth * 2; i++) { const a = i / (teeth * 2) * Math.PI * 2, rr = i % 2 ? r * 0.78 : r; const p = [Math.cos(a) * rr, Math.sin(a) * rr]; if (i) shape.lineTo(...p); else shape.moveTo(...p); }
  const hole = new THREE.Path(); hole.absarc(0, 0, r * 0.25, 0, Math.PI * 2, true); shape.holes.push(hole);
  return new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: false });
}

export default class Planta3D extends Stage3D {
  constructor(el, opts) {
    super(el, opts);
    this.fov = 30; this.fitScale = 1; this.orbitSpeed = 0;
    this.machines = new Map(); this.halls = new Map(); this.bots = new Map();
    this.layoutKey = ''; this.scrap = 0;
    this.view = { az: Math.PI / 2, el: EL, dist: 50, tx: 0, ty: 0, tz: 0, zoom: 1 };
    this.orbit = { ...this.view }; this.goal = { ...this.view };
  }

  async build() {
    const S = this.scene;
    S.add(new THREE.HemisphereLight(0xfff1e8, 0x1d2b53, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.9); sun.position.set(-12, 30, 18); S.add(sun);
    const t = tileTex(); t.repeat.set(60, 60);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(240, 240), new THREE.MeshStandardMaterial({ map: t, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; S.add(ground);
    this.beltT = beltTex();
    this.plant = new THREE.Group(); S.add(this.plant);
  }

  // ------------------------------------------------------------------ la planta
  layout(state) {
    const key = layoutKeyOf(state);
    if (key === this.layoutKey) return;
    if (key !== this.realKey) { this.realKey = key; this.refits = 0; }
    this.layoutKey = key;
    this.plant.clear();
    for (const h of this.halls.values()) h.plaque.remove();
    for (const m of this.machines.values()) m.label.remove();
    if (this.centralLabel) this.centralLabel.remove();
    this.halls.clear(); this.machines.clear();
    this.pickables = this.pickables.filter(p => p.userData.kind === 'session');
    const list = groupsOf(state);
    list.forEach(h => { h.cols = Math.min(h.items.length, clamp(Math.ceil(Math.sqrt(h.items.length * 1.6)), 2, COLS)); h.rows = Math.ceil(h.items.length / h.cols); h.w = h.cols * SP + 1.6; h.d = h.rows * SP + 0.6; });
    const plaqueE = h => (FONT_K * 1.3 * this.plaqueLines(h.items.length, h.w, FONT_K) + 0.5) / Math.sin(EL);
    const CW = 7; // la central abre la primera fila
    const plaqueD = g => (g.plaqueU = this.plaqueUnits(g.a.id, plaqueE(g)));
    const best = packRows(list, { w: h => h.w, h: h => h.d + plaqueD(h) + 1, gap: 1.6, lead: CW + 1.6, aspect: this.areaAspect() * Math.sin(EL) });
    let z = 0;
    best.rows.forEach((row, ri) => {
      let x = -best.widths[ri] / 2;
      if (ri === 0) { this.buildCentral(x + CW / 2, z + 3); x += CW + 1.6; }
      for (const h of row) { h.x = x + h.w / 2; h.z = z + h.d / 2; x += h.w + 1.6; this.buildHall(h); }
      z += best.heights[ri];
    });
    this.extent = { w: best.W, z0: -1, z1: z };
    this.fit(true);
  }
  fit(snap) {
    const E = this.extent; if (!E) return;
    const depth = (E.z1 - E.z0) * Math.sin(EL) + 5 * Math.cos(EL);
    this.setView({ dist: this.distToFit(E.w + 2, depth + 1) * 1.02, tz: (E.z0 + E.z1) / 2, ty: 0.8 }, snap);
  }
  setInsets(ins) { super.setInsets(ins); if (this.extent) this.fit(false); }

  buildCentral(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z);
    const mat = c => new THREE.MeshStandardMaterial({ color: color(c), roughness: 0.7, flatShading: true });
    const base = new THREE.Mesh(new THREE.BoxGeometry(4, 2.2, 3.4), mat(K.lgray)); base.position.set(-0.8, 1.1, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(4.2, 0.25, 3.6), mat(K.dgray)); roof.position.set(-0.8, 2.3, 0);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(4.02, 0.3, 0.05), new THREE.MeshBasicMaterial({ color: color(K.yellow) })); stripe.position.set(-0.8, 0.4, 1.71);
    const chimney = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.45, 4, 10), mat(K.brown)); chimney.position.set(-2, 3.2, -0.8);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.37, 0.37, 0.3, 10), new THREE.MeshBasicMaterial({ color: color(K.white) })); band.position.set(-2, 4.6, -0.8);
    const silo = (c, sx) => {
      const shell = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 3.2, 16, 1, true), new THREE.MeshStandardMaterial({ color: color(K.lgray), transparent: true, opacity: 0.25, side: THREE.DoubleSide, depthWrite: false }));
      shell.position.set(sx, 1.6, 0.4);
      const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 1, 16), new THREE.MeshStandardMaterial({ color: color(c), emissive: color(c), emissiveIntensity: 0.25 }));
      fill.geometry.translate(0, 0.5, 0); fill.position.set(sx, 0.02, 0.4);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.75, 0.5, 16), mat(K.dgray)); cap.position.set(sx, 3.45, 0.4);
      g.add(shell, fill, cap);
      return fill;
    };
    const mem = silo(K.blue, 1.9), disk = silo(K.orange, 3.4);
    // torreta
    const tb = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.5, 8), mat(K.dgray)); tb.position.set(0.3, 2.6, 0.6);
    const gun = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 1), mat(K.lgray)); gun.position.set(0.3, 2.95, 0.6);
    // contenedor de chatarra
    const bin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.8, 1.1), mat(K.green)); bin.position.set(-1.6, 0.4, 2.8);
    this.scrapFill = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 0.9), mat(K.dgray)); this.scrapFill.geometry.translate(0, 0.5, 0); this.scrapFill.position.set(-1.6, 0.3, 2.8); this.scrapFill.scale.y = 0.05;
    // cerco
    const fence = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(8, 1.2, 7)), new THREE.LineBasicMaterial({ color: color(K.lgray), transparent: true, opacity: 0.5 }));
    fence.position.set(0.4, 0.6, 0.6);
    g.add(base, roof, stripe, chimney, band, tb, gun, bin, this.scrapFill, fence);
    [base, roof, chimney].forEach(m => { m.userData = { kind: 'system', id: 'root' }; this.pickables.push(m); });
    this.plant.add(g);
    this.central = { g, x, z, mem, disk, gun, chimneyTop: new THREE.Vector3(x - 2, 5.3, z - 0.8), gunPos: new THREE.Vector3(x + 0.3, 3, z + 0.6), bin: new THREE.Vector3(x - 1.6, 0.9, z + 2.8), fence: { x: x + 0.4, z: z + 0.6 } };
    this.centralLabel = this.label('w3-plaque w3-central', '<b>Central · servidor</b><small></small><i class="hl"></i>', new THREE.Vector3(x, 0.05, z + 4.2));
    this.centralLabel.d.dataset.go = 'system:root';
  }

  buildHall(H) {
    const { a, items } = H;
    const floorM = new THREE.MeshStandardMaterial({ color: color(a.color).lerp(color('#2a2a33'), 0.82), roughness: 1 });
    const floor = new THREE.Mesh(new THREE.BoxGeometry(H.w, 0.12, H.d), floorM); floor.position.set(H.x, 0.06, H.z);
    floor.userData = { kind: 'district', id: a.id };
    const wallM = new THREE.MeshStandardMaterial({ color: color(K.dgray), roughness: 0.9 });
    const back = new THREE.Mesh(new THREE.BoxGeometry(H.w, 1, 0.18), wallM); back.position.set(H.x, 0.5, H.z - H.d / 2);
    const side = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1, H.d), wallM); side.position.set(H.x + H.w / 2, 0.5, H.z);
    const roofStripe = new THREE.Mesh(new THREE.BoxGeometry(H.w, 0.14, 0.3), new THREE.MeshBasicMaterial({ color: color(a.color) })); roofStripe.position.set(H.x, 1.06, H.z - H.d / 2);
    // porton amarillo a la izquierda y barrera de los robots
    const gate = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.9, 1.2), new THREE.MeshStandardMaterial({ color: color(K.yellow), emissive: color(K.yellow), emissiveIntensity: 0.2 })); gate.position.set(H.x - H.w / 2, 0.45, H.z + H.d / 2 - 1);
    const barrier = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.08), new THREE.MeshStandardMaterial({ color: color(K.red) })); barrier.position.set(H.x - H.w / 2 + 0.8, 0.6, H.z + H.d / 2 - 0.2);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: color(K.dgray) })); lamp.position.set(H.x - H.w / 2 + 0.2, 0.9, H.z + H.d / 2 - 0.2);
    this.plant.add(floor, back, side, roofStripe, gate, barrier, lamp);
    this.pickables.push(floor);
    H.lamp = lamp; H.gate = new THREE.Vector3(H.x - H.w / 2, 0.35, H.z + H.d / 2 - 1);
    const nA = items.filter(x => x._k === 'app').length;
    H.caption = accountCaption(a, nA, items.length - nA);
    // una cinta delante de cada fila de maquinas
    H.belts = [];
    for (let r = 0; r < H.rows; r++) {
      const bz = H.z - H.d / 2 + 0.3 + r * SP + SP * 0.78;
      const tex = this.beltT.clone(); tex.needsUpdate = true; tex.repeat.set(H.w * 1.6, 1);
      const belt = new THREE.Mesh(new THREE.BoxGeometry(H.w - 0.3, 0.1, 0.45), [0, 0, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.8 }), 0, 0, 0].map(m => m || new THREE.MeshStandardMaterial({ color: 0x1b1b22 })));
      belt.position.set(H.x, 0.17, bz);
      this.plant.add(belt);
      H.belts.push({ z: bz, tex, jam: false });
    }
    items.forEach((it, i) => this.addMachine(it, H, H.x - H.w / 2 + 0.8 + SP / 2 + (i % H.cols) * SP, H.z - H.d / 2 + 0.3 + SP * 0.35 + Math.floor(i / H.cols) * SP, Math.floor(i / H.cols)));
    H.plaque = this.label('w3-plaque', `<b style="border-color:${a.color}">${esc(a.label)}</b><small>${esc(H.caption)}</small><div class="fishlist"></div>`, new THREE.Vector3(H.x, 0.05, H.z + H.d / 2 + 0.25));
    H.plaque.d.dataset.go = 'district:' + a.id;
    this.halls.set(a.id, H);
    this.fillPlaque(H);
  }
  fillPlaque(H) {
    H.plaque.d.querySelector('.fishlist').innerHTML = plaqueList(H.items.map(it => ({ ...it, ...(this.machines.get(it.id)?.data || {}) })), it => iconURL('sign:' + (it.icon || 'web'), () => signCanvas(it.icon || 'web', 2)));
  }

  addMachine(it, H, x, z, row) {
    const site = it._k === 'site';
    const g = new THREE.Group(); g.position.set(x, 0.12, z);
    const bodyM = new THREE.MeshStandardMaterial({ color: color(site ? K.lav : K.lgray), roughness: 0.6, flatShading: true });
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.3, site ? 0.5 : 1, 1), bodyM); body.position.y = site ? 0.25 : 0.5;
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: color(K.lime) })); lamp.position.set(-0.45, site ? 0.62 : 1.12, 0.3);
    g.add(body, lamp);
    const m = { g, body, lamp, data: it, site, H, row, x, z, spin: 0, press: 0, hits: 0 };
    if (site) {
      // prensa: dos columnas, un cabezal que baja con cada visita
      const colM = new THREE.MeshStandardMaterial({ color: color(K.dgray) });
      const c1 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 1.4, 0.14), colM); c1.position.set(-0.5, 0.7, -0.3);
      const c2 = c1.clone(); c2.position.x = 0.5;
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.18, 0.3), colM); top.position.set(0, 1.45, -0.3);
      const head = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.3, 0.5), new THREE.MeshStandardMaterial({ color: color(K.orange), flatShading: true })); head.position.set(0, 1.1, 0);
      g.add(c1, c2, top, head); m.head = head;
    } else {
      const gear = new THREE.Mesh(gearGeo(), new THREE.MeshStandardMaterial({ color: color(K.orange), metalness: 0.4, roughness: 0.5, flatShading: true }));
      gear.position.set(0.15, 0.55, 0.5);
      const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.9, 12, 1, true), new THREE.MeshStandardMaterial({ color: color(K.lgray), transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
      tank.position.set(0.5, 1.45, -0.2);
      const fill = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.17, 1, 12), new THREE.MeshStandardMaterial({ color: color(K.blue), emissive: color(K.blue), emissiveIntensity: 0.3 }));
      fill.geometry.translate(0, 0.5, 0); fill.position.set(0.5, 1.0, -0.2); fill.scale.y = 0.1;
      g.add(gear, tank, fill); m.gear = gear; m.fill = fill;
    }
    const sign = billboard(signCanvas(it.icon || 'web', 6), 0.7); sign.position.set(-0.2, site ? 1.95 : 1.75, 0);
    g.add(sign); m.sign = sign;
    const jam = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.5), new THREE.MeshBasicMaterial({ color: color(K.red), transparent: true, side: THREE.DoubleSide }));
    jam.rotation.x = -Math.PI / 2; jam.rotation.z = Math.PI / 4; jam.position.set(0, 0.12, SP * 0.43); jam.visible = false; g.add(jam); m.jam = jam;
    g.userData = { kind: site ? 'site' : 'app', id: it.id };
    this.plant.add(g); this.pickables.push(g);
    m.label = this.label('w3-item', esc(it.name), () => m.named ? new THREE.Vector3(x, 2.5, z) : null);
    this.machines.set(it.id, m);
  }

  // ------------------------------------------------------------------ estado
  update(state) {
    this.state = state;
    this.layout(state);
    const replate = new Set();
    for (const x of [...state.apps, ...(state.sites || [])]) {
      const m = this.machines.get(x.id);
      if (!m) continue;
      const prev = m.data.status;
      m.data = { ...x, _k: m.data._k };
      if (prev && prev !== x.status) { replate.add(m.H); if (x.status === 'down') this.float(new THREE.Vector3(m.x, 2.6, m.z), `${x.name}: detenida`, 'crit'); }
      if (m.fill) m.fill.scale.y = clamp(Math.log2(1 + (x.mem || 0) / 20e6) / 6, 0.05, 1) * 0.9;
    }
    replate.forEach(H => this.fillPlaque(H));
    const s = state.system;
    if (s && this.central) {
      this.central.mem.scale.y = clamp(s.mem.pct / 100, 0.03, 1) * 3.1;
      this.central.disk.scale.y = clamp((s.disk?.pct ?? 0) / 100, 0.03, 1) * 3.1;
      this.central.mem.material.color.set(s.mem.pct > 85 ? K.red : K.blue);
      this.central.disk.material.color.set((s.disk?.pct ?? 0) > 85 ? K.red : K.orange);
      this.centralLabel.d.querySelector('small').textContent = `CPU ${s.cpu.toFixed(0)}% · memoria ${s.mem.pct.toFixed(0)}% · disco ${Math.round(s.disk?.pct ?? 0)}%`;
    }
    this.failed = (state.keys || []).some(k => k.state === 'failed');
    // salud del servidor junto a su nombre
    const hl = healthLine(state), he = this.centralLabel && this.centralLabel.d.querySelector('.hl');
    if (he && hl) { he.textContent = hl.text; he.style.color = hl.color; }
    this.syncBots(state.sessions || []);
  }

  syncBots(sessions) {
    const seen = new Set(), per = {};
    for (const s of sessions) {
      seen.add(s.id);
      let b = this.bots.get(s.id);
      const H = this.halls.get(s.account) || [...this.halls.values()][0];
      if (!H) continue;
      if (!b) {
        const spr = billboard(robotCanvas(H.a.color, 4), 1.1); spr.center.set(0.5, 0);
        spr.userData = { kind: 'session', id: s.id };
        const box = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.3, 0.35), new THREE.MeshStandardMaterial({ color: color(K.brown) }));
        this.scene.add(spr, box); this.pickables.push(spr);
        b = { spr, box, H, x: H.gate.x + 0.6, z: H.gate.z, tx: 0, tz: 0, wait: 0 };
        b.label = this.label('w3-agent', '', () => spr.position.clone().setY(1.5));
        this.bots.set(s.id, b);
      }
      b.s = s; b.H = H;
      per[H.a.id] = (per[H.a.id] || 0) + 1; b.slot = per[H.a.id] - 1;
      b.label.d.innerHTML = s.waitKind ? 'Robot <em>ESPERA SU PERMISO</em>' : '';
    }
    for (const [id, b] of this.bots) if (!seen.has(id)) { this.scene.remove(b.spr, b.box); b.label.remove(); this.pickables = this.pickables.filter(p => p !== b.spr); this.bots.delete(id); }
  }

  // ------------------------------------------------------------------ eventos
  onEvent(e, priv) {
    switch (e.kind) {
      case 'http': {
        const m = this.machines.get(e.app || e.site);
        if (!m || this.fx.length > 240) return;
        return this.piece(m, e.status >= 500, e.bot);
      }
      case 'attack': return this.drone(false);
      case 'block': return this.drone(true, priv ? e.ip : null);
      case 'login': return this.central && this.float(this.central.gunPos.clone().setY(4), priv && e.user ? `Entró ${e.user}` : 'Entró el operador', 'ok');
      case 'deploy': {
        const m = this.machines.get(e.app);
        const T = { building: ['Montando la máquina', 'warn'], ready: ['Máquina lista', 'ok'], error: ['Falló el montaje', 'crit'], canceled: ['Cancelado', 'dim'] }[e.action];
        if (m && T) { this.float(new THREE.Vector3(m.x, 2.6, m.z), T[0], T[1]); if (e.action === 'ready') this.sparks(new THREE.Vector3(m.x, 1.2, m.z), K.yellow, 12); }
        return;
      }
      case 'pm2': { const m = this.machines.get(e.app); if (m && e.action !== 'down') { this.float(new THREE.Vector3(m.x, 2.6, m.z), 'Reiniciada', 'warn'); this.ring(new THREE.Vector3(m.x, 0.15, m.z), 'warn'); } return; }
      case 'domain': { const H = this.halls.get(e.account); if (H) this.float(new THREE.Vector3(H.x, 2.2, H.z), ({ added: 'Máquina nueva', removed: 'Se retiró una máquina', changed: 'Cambió un sitio' }[e.action] || '') + (priv && e.domain ? ` · ${e.domain}` : ''), e.action === 'removed' ? 'warn' : 'ok'); return; }
      case 'claude': {
        const b = this.bots.get(e.sid) || [...this.bots.entries()].find(([k]) => e.sid && k.startsWith(e.sid))?.[1];
        if (!b) return;
        const p = b.spr.position.clone().setY(2.2);
        if (e.action === 'permission') { this.attention(b.spr.position, 2.8); this.float(p, 'Espera en la barrera', 'warn'); }
        else if (e.action === 'done') { this.float(p, 'Entrega hecha', 'ok'); this.sparks(b.spr.position.clone().setY(1), K.lime, 10); }
        else if (e.action === 'prompt') this.float(p, priv && e.text ? e.text.slice(0, 60) : 'Nueva orden', 'accent');
        return;
      }
    }
  }

  // pieza: del porton de la nave por la cinta de su fila hasta la maquina (o a la chatarra si es un error)
  piece(m, bad, bot) {
    const H = m.H, belt = H.belts[m.row];
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshStandardMaterial({ color: color(bad ? K.red : bot ? K.lav : K.peach), emissive: color(bad ? K.red : K.black), emissiveIntensity: 0.4 }));
    const y = 0.34, start = H.gate.clone().setY(y), onBelt = new THREE.Vector3(H.x - H.w / 2 + 0.3, y, belt.z), at = new THREE.Vector3(m.x, y, belt.z), into = new THREE.Vector3(m.x, 0.5, m.z + 0.2);
    const pts = [start, onBelt, at];
    if (m.data.status === 'down') { this.travel(cube, new THREE.CatmullRomCurve3(pts, false, 'centripetal'), 2 + Math.abs(m.x - H.x) / 6, () => { belt.jam = 1; }); return; }
    const path = new THREE.CatmullRomCurve3([...pts, into], false, 'centripetal');
    this.travel(cube, path, 2.2 + Math.abs(m.x - H.x) / 6, () => {
      if (m.site) m.press = 1; else m.hits = Math.min(m.hits + 0.3, 1.5);
      if (bad && this.central) {
        const r = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.22), new THREE.MeshStandardMaterial({ color: color(K.red), emissive: color(K.red), emissiveIntensity: 0.5 }));
        const a = new THREE.Vector3(m.x, 1, m.z), b = this.central.bin;
        this.travel(r, new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, 0.5).setY(6), b), 1.6, () => { this.scrap = Math.min(1, this.scrap + 0.04); });
      }
    });
  }
  drone(blocked, ip) {
    if (!this.central) return;
    const C = this.central;
    const ang = Math.PI * (0.9 + Math.random() * 0.9);
    const from = new THREE.Vector3(C.fence.x + Math.cos(ang) * 30, 7, C.fence.z + Math.sin(ang) * 30);
    const hit = new THREE.Vector3(C.fence.x + Math.cos(ang) * 4.6, 1.6, C.fence.z + Math.sin(ang) * 4);
    const g = new THREE.Group();
    const dm = new THREE.MeshStandardMaterial({ color: color(K.red), emissive: color(K.red), emissiveIntensity: 0.4, flatShading: true });
    g.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.18, 0.5), dm));
    for (const [dx, dz] of [[-0.35, -0.35], [0.35, -0.35], [-0.35, 0.35], [0.35, 0.35]]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.03, 10), new THREE.MeshBasicMaterial({ color: color(K.lgray), transparent: true, opacity: 0.6 })); r.position.set(dx, 0.12, dz); g.add(r); }
    this.travel(g, new THREE.QuadraticBezierCurve3(from, from.clone().lerp(hit, 0.5).setY(9), hit), 3, () => {
      if (blocked) {
        const pts = [C.gunPos, hit];
        const laser = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: color(K.yellow) }));
        this.addFx(laser, f => f.age < 0.35);
        this.sparks(hit, K.orange, 14, 4);
        this.float(hit.clone().setY(3), ip ? `Dron derribado · ${ip}` : 'Dron derribado', 'warn');
      } else {
        this.sparks(hit, K.red, 6, 2);
        const fall = g.clone(); fall.position.copy(hit);
        this.addFx(fall, (f, dt) => { fall.position.y = Math.max(0.1, fall.position.y - dt * 1.5); fall.rotation.y += dt * 4; return f.age < 1.6; });
      }
    });
  }

  // ------------------------------------------------------------------ cuadro a cuadro
  frame(dt) {
    if (this.directorOn && !this.manualUntil && !this.urgent) this.goal.az = Math.PI / 2 + Math.sin(this.t * 0.06) * 0.2;
    const s = this.state?.system;
    // humo de la chimenea segun la CPU
    if (this.central && s && Math.random() < dt * (1 + s.cpu / 12)) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(0.25, 8, 6), new THREE.MeshStandardMaterial({ color: color(K.lgray), transparent: true, opacity: 0.7, flatShading: true }));
      puff.position.copy(this.central.chimneyTop);
      const drift = (Math.random() - 0.3) * 0.6;
      this.addFx(puff, (f, d) => { puff.position.y += d * 1.2; puff.position.x += d * drift; puff.scale.setScalar(1 + f.age * 0.8); puff.material.opacity = 0.7 * (1 - f.age / 3); return f.age < 3; });
    }
    if (this.scrapFill) { this.scrap = Math.max(0, this.scrap - dt * 0.004); this.scrapFill.scale.y = 0.05 + this.scrap * 0.9; }
    if (this.central) this.central.gun.rotation.y = Math.sin(this.t * 0.5) * 0.8;
    const blink = Math.floor(this.t * 3) % 2 === 0;
    let focus = null;
    if (this.orbit.zoom > 1.5) { let best = 1e9; for (const H of this.halls.values()) { const k = Math.hypot(H.x - this.orbit.tx, H.z - this.orbit.tz); if (k < best) { best = k; focus = H; } } }
    this.refitPlaques([...this.halls.values()], Math.sin(EL));
    this.sizePlaques([...this.halls.values()].map(H => [H.plaque, H.w]).concat(this.centralLabel ? [[this.centralLabel, 7, 150]] : []), FONT_K);
    for (const H of this.halls.values()) for (const b of H.belts) { b.tex.offset.x -= dt * (b.jam ? 0.1 : 0.8); b.jam = Math.max(0, (b.jam || 0) - dt * 0.3); }
    for (const m of this.machines.values()) {
      const st = m.data.status;
      m.lamp.material.color.set(st === 'down' ? (blink ? K.red : '#3b0010') : st === 'degraded' ? K.orange : K.lime);
      m.jam.visible = st === 'down';
      m.jam.material.opacity = blink ? 1 : 0.4;
      if (m.gear) { m.hits = Math.max(0, m.hits - dt * 0.3); m.gear.rotation.z -= dt * (st === 'down' ? 0 : 0.6 + (m.data.cpu || 0) / 8 + m.hits * 3); }
      if (m.head) { m.press = Math.max(0, m.press - dt * 3); m.head.position.y = 1.1 - m.press * 0.45; }
      m.named = m.H === focus || st === 'down';
      m.label.d.classList.toggle('down', st === 'down');
    }
    for (const b of this.bots.values()) {
      const H = b.H, waiting = !!b.s.waitKind;
      if (waiting) { b.tx = H.x - H.w / 2 + 0.8 + b.slot * 0.6; b.tz = H.z + H.d / 2 + 0.3; }
      else {
        b.wait -= dt;
        if (b.wait <= 0) { const m = H.items.length ? this.machines.get(H.items[Math.floor(Math.random() * H.items.length)].id) : null; if (m) { b.tx = m.x + 0.9; b.tz = m.z + 0.2; } b.wait = 3 + Math.random() * 3; }
      }
      const dx = b.tx - b.x, dz = b.tz - b.z, d = Math.hypot(dx, dz), st = 1.3 * dt;
      if (d > st) { b.x += dx / d * st; b.z += dz / d * st; }
      b.spr.position.set(b.x, 0.12 + (b.s.state === 'working' ? Math.abs(Math.sin(this.t * 8)) * 0.06 : 0), b.z);
      b.box.position.set(b.x, b.spr.position.y + 1.2, b.z); b.box.visible = b.s.state !== 'idle' && !waiting;
      b.spr.material.opacity = b.s.state === 'idle' ? 0.6 : 1;
    }
    for (const H of this.halls.values()) {
      const w = [...this.bots.values()].some(b => b.H === H && b.s.waitKind);
      H.lamp.material.color.set(w ? (blink ? K.orange : '#553300') : K.dgray);
    }
  }

  // ------------------------------------------------------------------ camara, avisos y enfoque
  zoomFor(H) { return clamp((this.extent?.w || 20) / (H.w + 6), 1.7, 4); }
  shots() { return [...this.halls.values()].map(H => ({ x: H.x, y: 0.5, z: H.z + 1, zoom: this.zoomFor(H), el: EL })); }
  locate(kind, id) {
    if (kind === 'app' || kind === 'site') { const m = this.machines.get(id); if (m) return { x: m.H.x, y: 0.5, z: m.H.z + 1, zoom: this.zoomFor(m.H) }; }
    if (kind === 'session') { const b = this.bots.get(id); if (b) return { x: b.x, y: 0.5, z: b.z, zoom: 3.4 }; }
    if (kind === 'district') { const H = this.halls.get(id); if (H) return { x: H.x, y: 0.5, z: H.z + 1, zoom: this.zoomFor(H) }; }
    if ((kind === 'system' || kind === 'security') && this.central) return { x: this.central.x, y: 1, z: this.central.z + 1, zoom: 2.8 };
    return null;
  }
  tipFor(u) {
    if (u.kind === 'app' || u.kind === 'site') {
      const m = this.machines.get(u.id); if (!m) return null;
      const a = m.data;
      return { title: a.name, body: `${a.kind && a.kind !== a.name ? `<b>${esc(a.kind)}</b> · ` : ''}${m.site ? 'prensa (sitio)' : 'máquina (servicio)'} · nave ${esc(m.H.a.label)}`,
        meta: `${{ online: 'en marcha', degraded: 'lenta (parcial)', down: 'DETENIDA (caída)' }[a.status] || a.status}${!m.site ? ` · CPU ${(a.cpu || 0).toFixed(1)}% · RAM ${fmtBytes(a.mem || 0)}` : ''} · ${a.reqMin || 0} piezas/min`, hint: 'Clic para ver el detalle' };
    }
    if (u.kind === 'session') { const b = this.bots.get(u.id); return b && { title: 'Robot obrero · agente de Claude Code', body: esc(b.s.activity || ''), meta: b.s.waitKind ? 'Espera su permiso en la barrera' : { working: 'Trabajando', thinking: 'Pensando', idle: 'En pausa' }[b.s.state] || '', hint: 'Clic para ver la línea de tiempo' }; }
    if (u.kind === 'district') { const H = this.halls.get(u.id); return H && { title: H.a.label, body: `Una nave con ${H.items.length} máquinas y prensas. Su placa, delante, las nombra a todas.`, meta: H.caption, hint: 'Clic para ver la nave' }; }
    if (u.kind === 'system') return { title: 'Central', body: 'El <b>servidor</b>: la chimenea echa más humo con más CPU; los silos azul y naranja son la memoria y el disco.', meta: this.state?.system ? `CPU ${this.state.system.cpu.toFixed(0)}% · RAM ${this.state.system.mem.pct.toFixed(0)}% · carga ${this.state.system.load[0].toFixed(2)}` : '', hint: 'Clic para ver el servidor completo' };
    return null;
  }
}
