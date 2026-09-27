// Tema "Ops": mesa tactica holografica en 3D (three.js, motor Stage3D), nitida y a resolucion completa.
//  - la mesa es un disco con anillos y rumbos; cada cuenta es un SECTOR con su color
//  - a los costados, la FICHA de cada sector (unida a su rumbo con una linea guia) nombra todos sus
//    servicios y sitios con su cartel: se ubica cualquier proyecto sin hacer clic
//  - cada servicio es una COLUMNA que sube con su CPU; cada sitio un PRISMA que sube con sus visitas;
//    verde bien, ambar a medias, rojo parpadeando caido; encima, su cartel en pixel art
//  - el BARRIDO gira y hace brillar cada columna al pasar
//  - en el centro, la BASE (el servidor) con su CUPULA de escudo
//  - cada visita es un punto de luz que cae en arco sobre su columna; cada intento de acceso, un MISIL
//    rojo contra la cupula (si la IP queda bloqueada: NEUTRALIZADO)
//  - cada sesion de Claude Code es un DRON sobre su sector (ambar con aviso si espera su permiso)
// Regla de oro: geometria limpia y textos nitidos; el pixel art va en los carteles; el color solo
// significa amigo, alerta u hostil.
import { Stage3D, THREE, color, clamp, billboard, groupsOf, layoutKeyOf, iconURL, plaqueList } from '../../js/stage3d.js';
import { signCanvas } from '../../js/sprites.js';
import { esc, fmtBytes } from '../../js/hud.js';
import { accountCaption } from '../../js/accounts.js';
import { healthLine } from '../../js/layout.js';

const R = 10;
const TAU = Math.PI * 2;
const CARD_W = 250; // ancho de una ficha en pixeles (a 1080p); a los costados de la mesa
const SVGNS = 'http://www.w3.org/2000/svg';

export default class Ops3D extends Stage3D {
  constructor(el, opts) {
    super(el, opts);
    this.C.grid = '#3a4a2c'; this.C.dim = '#5d6e48';
    this.fov = 38; this.fitScale = 1; this.orbitSpeed = 0;
    this.items = new Map(); this.sectors = new Map(); this.drones = new Map();
    this.layoutKey = ''; this.sweep = 0;
    this.view = { az: Math.PI / 2, el: 0.95, dist: 30, tx: 0, ty: 0, tz: 0, zoom: 1 };
    this.orbit = { ...this.view }; this.goal = { ...this.view };
  }

  line(points, c, opacity = 1) {
    return new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(points), new THREE.LineBasicMaterial({ color: color(c), transparent: opacity < 1, opacity }));
  }

  async build() {
    await document.fonts.load("24px 'VT323'").catch(() => { });
    const S = this.scene;
    S.fog = new THREE.Fog(this.C.bg, 60, 110);
    S.add(new THREE.AmbientLight(0xffffff, 0.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.1); sun.position.set(8, 20, 6); S.add(sun);
    // mesa
    const disc = new THREE.Mesh(new THREE.CircleGeometry(R * 1.12, 96), new THREE.MeshStandardMaterial({ color: 0x10140c, roughness: 0.9, metalness: 0.1 }));
    disc.rotation.x = -Math.PI / 2; disc.position.y = -0.02; S.add(disc);
    const pts = [];
    for (const f of [0.25, 0.5, 0.75, 1]) for (let i = 0; i < 128; i++) {
      const a = i / 128 * TAU, b = (i + 1) / 128 * TAU;
      pts.push(new THREE.Vector3(Math.cos(a) * R * f, 0, Math.sin(a) * R * f), new THREE.Vector3(Math.cos(b) * R * f, 0, Math.sin(b) * R * f));
    }
    for (let d = 0; d < 360; d += 10) {
      const a = d / 180 * Math.PI, l = d % 30 === 0 ? 0.6 : 0.25;
      pts.push(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R), new THREE.Vector3(Math.cos(a) * (R + l), 0, Math.sin(a) * (R + l)));
    }
    S.add(this.line(pts, this.C.dim, 0.9));
    const rim = new THREE.Mesh(new THREE.TorusGeometry(R * 1.12, 0.08, 8, 128), new THREE.MeshStandardMaterial({ color: 0x2b3322, metalness: 0.6, roughness: 0.4 }));
    rim.rotation.x = Math.PI / 2; S.add(rim);
    this.sectorG = new THREE.Group(); S.add(this.sectorG);
    this.itemsG = new THREE.Group(); S.add(this.itemsG);
    // base
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 1.4, 8), new THREE.MeshStandardMaterial({ color: 0x1b2214, emissive: color(this.C.ok), emissiveIntensity: 0.15, metalness: 0.5, roughness: 0.4 }));
    core.position.y = 0.7; core.userData = { kind: 'system', id: 'root' };
    const dome = new THREE.Mesh(new THREE.SphereGeometry(1.9, 24, 12, 0, TAU, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: color(this.C.ok), wireframe: true, transparent: true, opacity: 0.18 }));
    S.add(core, dome);
    this.base = { core, dome, flash: 0 };
    this.baseLabel = this.label('w3-group ops-base', '<b>BASE</b><small></small><i class="hl"></i>', new THREE.Vector3(0, -0.2, 2.4));
    this.baseLabel.d.dataset.go = 'system:root';
    this.baseLabel.d.style.translate = '-50% 0';
    // barrido
    this.sweepG = new THREE.Group();
    for (let i = 0; i < 12; i++) {
      const m = new THREE.Mesh(new THREE.CircleGeometry(R, 32, 0, 0.045), new THREE.MeshBasicMaterial({ color: color(this.C.ok), transparent: true, opacity: 0.32 * (1 - i / 12), side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.rotation.x = -Math.PI / 2; m.position.y = 0.01; m.rotation.z = -i * 0.045;
      this.sweepG.add(m);
    }
    S.add(this.sweepG);
    // lineas guia de las fichas (SVG sobre el lienzo, debajo de las etiquetas)
    this.svg = document.createElementNS(SVGNS, 'svg');
    this.svg.setAttribute('class', 'ops-leaders');
    this.labels.prepend(this.svg);
  }

  // ------------------------------------------------------------------ sectores y columnas
  layout(state) {
    const key = layoutKeyOf(state);
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    this.itemsG.clear(); this.sectorG.clear();
    for (const it of this.items.values()) it.label.remove();
    for (const s of this.sectors.values()) { s.card.remove(); s.path.remove(); }
    this.items.clear(); this.sectors.clear();
    this.pickables = [this.base.core, ...[...this.drones.values()].map(d => d.mesh)];
    const list = groupsOf(state);
    const weights = list.map(g => Math.max(4, g.items.length)), total = weights.reduce((n, w) => n + w, 0) || 1;
    let a0 = -Math.PI / 2;
    list.forEach(({ a: acc, items }, i) => {
      const w = weights[i] / total * TAU, a1 = a0 + w, mid = a0 + w / 2;
      const wedge = new THREE.Mesh(new THREE.RingGeometry(2.3, R, 48, 1, -a1, w), new THREE.MeshBasicMaterial({ color: color(acc.color), transparent: true, opacity: 0.07, side: THREE.DoubleSide, depthWrite: false }));
      wedge.rotation.x = -Math.PI / 2; wedge.position.y = 0.005; wedge.userData = { kind: 'district', id: acc.id };
      this.sectorG.add(wedge);
      this.sectorG.add(this.line([new THREE.Vector3(Math.cos(a0) * 2.3, 0.01, Math.sin(a0) * 2.3), new THREE.Vector3(Math.cos(a0) * R, 0.01, Math.sin(a0) * R)], acc.color, 0.7));
      // arco del borde con el color del sector: ahi nace la linea guia de su ficha
      const arcPts = []; for (let k = 0; k < 24; k++) { const x0 = a0 + w * k / 24, x1 = a0 + w * (k + 1) / 24; arcPts.push(new THREE.Vector3(Math.cos(x0) * R * 1.12, 0.02, Math.sin(x0) * R * 1.12), new THREE.Vector3(Math.cos(x1) * R * 1.12, 0.02, Math.sin(x1) * R * 1.12)); }
      this.sectorG.add(this.line(arcPts, acc.color, 1));
      const nA = items.filter(x => x._k === 'app').length;
      const caption = accountCaption(acc, nA, items.length - nA);
      const card = this.label('w3-plaque ops-card', `<b style="border-color:${acc.color}">${esc(acc.label)}</b><small>${esc(caption)}</small><div class="fishlist"></div>`, null);
      card.d.dataset.go = 'district:' + acc.id;
      card.manual = true; // la posicion la pone placeCards, no el motor
      const path = document.createElementNS(SVGNS, 'polyline'); path.setAttribute('stroke', acc.color); this.svg.appendChild(path);
      const sec = { a: acc, items, a0, a1, mid, card, path, wedge, caption, rim: new THREE.Vector3(Math.cos(mid) * R * 1.12, 0, Math.sin(mid) * R * 1.12) };
      this.sectors.set(acc.id, sec);
      this.pickables.push(wedge);
      // anillos parejos desde la base hasta el borde; cada anillo con tantas columnas como quepan
      let radii = [6.2];
      for (let rows = 1; rows <= 9; rows++) {
        radii = rows === 1 ? [6.2] : Array.from({ length: rows }, (_, k) => 3.4 + k * (R * 0.9 - 3.4) / (rows - 1));
        if (radii.reduce((n, r) => n + Math.max(1, Math.floor(w * r / 0.95)), 0) >= items.length) break;
      }
      const caps = radii.map(r => Math.max(1, Math.floor(w * r / 0.95)));
      const totalCap = caps.reduce((n, c) => n + c, 0);
      const take = caps.map(c => Math.floor(items.length * c / totalCap));
      for (let k = 0, left = items.length - take.reduce((n, x) => n + x, 0); left > 0; k = (k + 1) % take.length) if (take[k] < caps[k]) { take[k]++; left--; }
      let idx = 0;
      radii.forEach((r, k) => { for (let j = 0; j < take[k]; j++) this.addItem(items[idx++], a0 + (j + 0.5) * (w / take[k]), r, sec); });
      this.fillCard(sec);
      a0 = a1;
    });
  }
  fillCard(sec) {
    sec.card.d.querySelector('.fishlist').innerHTML = plaqueList(sec.items.map(it => ({ ...it, ...(this.items.get(it.id)?.data || {}) })), it => iconURL('sign:' + (it.icon || 'web'), () => signCanvas(it.icon || 'web', 2)));
  }

  addItem(it, ang, r, sec) {
    const site = it._k === 'site';
    const geo = site ? new THREE.CylinderGeometry(0.26, 0.26, 1, 6) : new THREE.BoxGeometry(0.44, 1, 0.44);
    geo.translate(0, 0.5, 0);
    const mat = new THREE.MeshStandardMaterial({ color: color(this.C.ok), emissive: color(this.C.ok), emissiveIntensity: 0.25, metalness: 0.3, roughness: 0.5, transparent: site, opacity: site ? 0.9 : 1 });
    const mesh = new THREE.Mesh(geo, mat);
    const g = new THREE.Group(); g.position.set(Math.cos(ang) * r, 0, Math.sin(ang) * r);
    const sign = billboard(signCanvas(it.icon || 'web', 6), 0.7);
    g.add(mesh, sign);
    mesh.userData = { kind: site ? 'site' : 'app', id: it.id };
    this.itemsG.add(g);
    this.pickables.push(mesh);
    const o = { g, mesh, sign, data: it, site, sec, ang: ((ang % TAU) + TAU) % TAU, r, h: 0.4, target: 0.4, lit: 0, flash: 0 };
    o.label = this.label('w3-item', esc(it.name), () => o.named ? g.position.clone().setY(o.h + 0.95) : null);
    this.items.set(it.id, o);
  }

  // ------------------------------------------------------------------ estado
  update(state) {
    this.state = state;
    this.layout(state);
    const top = new Set([...state.apps, ...(state.sites || [])].sort((x, y) => (y.reqMin || 0) - (x.reqMin || 0)).slice(0, 6).filter(x => x.reqMin > 0).map(x => x.id));
    const recard = new Set();
    for (const x of [...state.apps, ...(state.sites || [])]) {
      const it = this.items.get(x.id);
      if (!it) continue;
      const prev = it.data.status;
      it.data = { ...x, _k: it.site ? 'site' : 'app' };
      it.target = it.site ? 0.35 + clamp(Math.sqrt(x.reqMin || 0) * 0.35, 0, 3.2) : 0.4 + clamp((x.cpu || 0) / 100, 0, 1) * 3.2 + clamp(Math.log2(1 + (x.mem || 0) / 100e6) * 0.12, 0, 0.6);
      const c = x.status === 'down' ? this.C.crit : x.status === 'degraded' ? this.C.warn : this.C.ok;
      it.mesh.material.color.set(c); it.mesh.material.emissive.set(c);
      it.star = top.has(x.id) || x.status === 'down';
      it.label.d.classList.toggle('down', x.status === 'down');
      if (prev && prev !== x.status) { recard.add(it.sec); if (x.status === 'down') this.float(it.g.position.clone().setY(it.h + 1), 'CAÍDO', 'crit'); }
    }
    recard.forEach(s => this.fillCard(s));
    this.failed = (state.keys || []).filter(k => k.state === 'failed').map(k => k.label);
    this.baseLabel.d.querySelector('small').textContent = (state.keys || []).filter(k => k.state === 'active').map(k => k.label).filter(l => !['SSH', 'Cron'].includes(l)).slice(0, 4).join(' · ');
    // salud del servidor junto a su nombre
    const hl = healthLine(state), he = this.baseLabel && this.baseLabel.d.querySelector('.hl');
    if (he && hl) { he.textContent = hl.text; he.style.color = hl.color; }
    this.syncDrones(state.sessions || []);
  }

  syncDrones(sessions) {
    const seen = new Set(), per = {};
    sessions.forEach((s, n) => {
      seen.add(s.id);
      let d = this.drones.get(s.id);
      if (!d) {
        const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.7, 3), new THREE.MeshStandardMaterial({ color: color(this.C.ink), emissive: color(this.C.ink), emissiveIntensity: 0.3 }));
        mesh.userData = { kind: 'session', id: s.id };
        this.scene.add(mesh); this.pickables.push(mesh);
        d = { mesh, s, ph: Math.random() * TAU };
        d.label = this.label('w3-agent ops-drone', '', () => mesh.position.clone().setY(mesh.position.y + 0.6));
        this.drones.set(s.id, d);
      }
      d.s = s;
      per[s.account] = (per[s.account] || 0) + 1; d.slot = per[s.account] - 1;
      d.label.d.innerHTML = `ESC-${String(n + 1).padStart(2, '0')}${s.waitKind ? ' <em>ESPERA PERMISO</em>' : ''}`;
    });
    for (const [id, d] of this.drones) if (!seen.has(id)) { this.scene.remove(d.mesh); d.label.remove(); this.pickables = this.pickables.filter(p => p !== d.mesh); this.drones.delete(id); }
  }

  // ------------------------------------------------------------------ eventos
  onEvent(e, priv) {
    switch (e.kind) {
      case 'http': return this.visit(e);
      case 'attack': return this.missile(false);
      case 'block': return this.missile(true, priv ? e.ip : null);
      case 'login': return this.float(new THREE.Vector3(0, 3, 0), priv && e.user ? `ACCESO SSH · ${e.user}` : 'ACCESO SSH', 'ok');
      case 'deploy': {
        const it = this.items.get(e.app);
        const T = { building: ['DESPLEGANDO', 'warn'], ready: ['DESPLEGADO', 'ok'], error: ['FALLÓ EL DESPLIEGUE', 'crit'], canceled: ['CANCELADO', 'dim'] }[e.action];
        if (it && T) { this.float(it.g.position.clone().setY(it.h + 1), T[0], T[1]); this.ring(it.g.position, T[1]); }
        return;
      }
      case 'pm2': { const it = this.items.get(e.app); if (it && e.action !== 'down') { this.float(it.g.position.clone().setY(it.h + 1), 'REINICIO', 'warn'); this.ring(it.g.position, 'warn'); } return; }
      case 'domain': { const s = this.sectors.get(e.account); if (s) this.float(new THREE.Vector3(Math.cos(s.mid) * R * 0.7, 1, Math.sin(s.mid) * R * 0.7), ({ added: 'NUEVO DOMINIO', removed: 'DOMINIO ELIMINADO', changed: 'SITIO CAMBIÓ' }[e.action] || '') + (priv && e.domain ? ` · ${e.domain}` : ''), e.action === 'removed' ? 'crit' : 'ok'); return; }
      case 'claude': {
        const d = this.drones.get(e.sid) || [...this.drones.entries()].find(([k]) => e.sid && k.startsWith(e.sid))?.[1];
        if (!d) return;
        const p = d.mesh.position.clone().setY(d.mesh.position.y + 1);
        if (e.action === 'permission') { this.attention(d.mesh.position, 1.9); this.float(p, 'SOLICITA PERMISO', 'warn'); }
        else if (e.action === 'done') this.float(p, 'MISIÓN CUMPLIDA', 'ok');
        return;
      }
    }
  }

  // visita: punto de luz que cae en arco desde el borde hasta su columna
  visit(e) {
    if (this.fx.length > 180) return;
    const it = this.items.get(e.app || e.site);
    const ang = it ? it.ang + (Math.random() - 0.5) * 0.1 : Math.random() * TAU;
    const from = new THREE.Vector3(Math.cos(ang) * (R + 1.5), 2.5, Math.sin(ang) * (R + 1.5));
    const to = it ? it.g.position.clone().setY(it.h + 0.05) : new THREE.Vector3(Math.cos(ang) * 3, 0, Math.sin(ang) * 3);
    const c = e.status >= 500 ? this.C.crit : e.status >= 400 ? this.C.warn : e.bot ? this.C.dim : this.C.ink;
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 6, 6), new THREE.MeshBasicMaterial({ color: color(c) }));
    this.travel(m, new THREE.QuadraticBezierCurve3(from, from.clone().lerp(to, 0.5).setY(Math.max(from.y, to.y) + 2), to), 1 + Math.random() * 0.4, () => { if (it) { it.lit = 1; if (e.status >= 500) it.flash = 1; } });
  }

  // intento de acceso: misil rojo desde afuera que se estrella contra la cupula
  missile(blocked, ip) {
    const ang = Math.random() * TAU;
    const from = new THREE.Vector3(Math.cos(ang) * R * 1.8, 6, Math.sin(ang) * R * 1.8);
    const hit = new THREE.Vector3(Math.cos(ang) * 1.5, 1.1, Math.sin(ang) * 1.5);
    const curve = new THREE.QuadraticBezierCurve3(from, from.clone().lerp(hit, 0.5).setY(8), hit);
    const m = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.45, 6), new THREE.MeshBasicMaterial({ color: color(this.C.crit) }));
    this.addFx(m, f => {
      const k = f.age / 2.2;
      if (k >= 1) {
        this.base.flash = 1; this.ring(hit.clone().setY(0), 'crit', 2.6);
        if (blocked) this.float(hit.clone().setY(2.6), ip ? `NEUTRALIZADO · ${ip}` : 'NEUTRALIZADO', 'crit');
        return false;
      }
      const p = curve.getPoint(k), q = curve.getPoint(Math.min(1, k + 0.02));
      m.position.copy(p); m.lookAt(q); m.rotateX(Math.PI / 2);
      if (Math.random() < 0.5) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.05, 4, 4), new THREE.MeshBasicMaterial({ color: color(this.C.crit), transparent: true, opacity: 0.6 }));
        s.position.copy(p);
        this.addFx(s, g => { s.material.opacity = 0.6 * (1 - g.age / 0.8); return g.age < 0.8; });
      }
      return true;
    });
  }

  // ------------------------------------------------------------------ cuadro a cuadro
  frame(dt) {
    if (this.directorOn && !this.manualUntil && !this.urgent) this.goal.az = Math.PI / 2 + Math.sin(this.t * 0.05) * 0.35;
    const prev = this.sweep;
    this.sweep = (this.sweep + dt * TAU / 6) % TAU;
    this.sweepG.rotation.y = -this.sweep;
    const passed = a => { const p = prev, c = this.sweep; return p <= c ? a > p && a <= c : a > p || a <= c; };
    const blink = Math.floor(this.t * 3) % 2 === 0;
    let focus = null;
    if (this.orbit.zoom > 1.4) { let best = 1e9; for (const s of this.sectors.values()) { const k = Math.hypot(Math.cos(s.mid) * R * 0.55 - this.orbit.tx, Math.sin(s.mid) * R * 0.55 - this.orbit.tz); if (k < best) { best = k; focus = s; } } }
    for (const it of this.items.values()) {
      it.h += (it.target - it.h) * Math.min(1, dt * 3);
      it.mesh.scale.y = it.h;
      it.sign.position.y = it.h + 0.45;
      if (passed(it.ang)) it.lit = 1;
      it.lit = Math.max(0, it.lit - dt * 0.5); it.flash = Math.max(0, it.flash - dt * 2);
      const down = it.data.status === 'down';
      it.mesh.material.emissiveIntensity = (down ? (blink ? 0.9 : 0.1) : 0.15) + it.lit * 0.9 + it.flash;
      it.named = it.sec === focus || (!focus && it.star);
    }
    this.base.flash = Math.max(0, this.base.flash - dt * 1.5);
    const bad = this.failed && this.failed.length;
    this.base.dome.material.color.set(bad ? this.C.warn : this.base.flash > 0.1 ? this.C.crit : this.C.ok);
    this.base.dome.material.opacity = 0.14 + this.base.flash * 0.5 + (bad ? 0.1 * Math.sin(this.t * 4) : 0);
    this.base.dome.rotation.y += dt * 0.15;
    for (const d of this.drones.values()) {
      const s = this.sectors.get(d.s.account);
      const mid = s ? s.mid : -Math.PI / 2, r = R * 0.45 + (d.slot % 3) * 1.1;
      const a = mid + Math.sin(this.t * 0.35 + d.ph) * 0.15 + d.slot * 0.12;
      d.mesh.position.set(Math.cos(a) * r, 3.2 + Math.sin(this.t * 1.5 + d.ph) * 0.2, Math.sin(a) * r);
      d.mesh.rotation.set(Math.PI, this.t, 0);
      const waiting = !!d.s.waitKind;
      const c = waiting ? this.C.warn : d.s.state === 'idle' ? this.C.dim : this.C.ink;
      d.mesh.material.color.set(c); d.mesh.material.emissive.set(c);
      d.mesh.material.emissiveIntensity = waiting ? (blink ? 1 : 0.2) : 0.3;
      d.label.d.classList.toggle('wait', waiting);
    }
    // seleccion
    const sel = this.selected, si = sel && this.items.get(sel.id);
    if (si && !this.selRing) { this.selRing = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 32), new THREE.MeshBasicMaterial({ color: color(this.C.warn), side: THREE.DoubleSide, transparent: true })); this.selRing.rotation.x = -Math.PI / 2; this.scene.add(this.selRing); }
    if (this.selRing) { this.selRing.visible = !!si; if (si) { this.selRing.position.set(si.g.position.x, 0.04, si.g.position.z); this.selRing.scale.setScalar(1 + 0.15 * Math.sin(this.t * 6)); } }
  }

  // fichas a los costados de la mesa, apiladas sin encimarse, con su linea guia hasta el borde del sector
  placeLabels() {
    super.placeLabels();
    if (!this.W || !this.sectors.size) return;
    const zoomed = this.orbit.zoom > 1.4 || this.cardsOff; // sin lugar a los costados (telefono): sin fichas
    const ins = this.insets, top = ins.top + 8, bottom = this.H - ins.bottom - 8;
    const c = this.toScreen(new THREE.Vector3(this.orbit.tx, 0, this.orbit.tz));
    const rimPx = Math.abs(this.toScreen(new THREE.Vector3(this.orbit.tx + R * 1.12, 0, this.orbit.tz)).x - c.x);
    const scale = clamp(this.H / 1080, 0.75, 2);
    const w = Math.round(CARD_W * scale);
    const sides = { L: [], R: [] };
    for (const s of this.sectors.values()) {
      const p = this.toScreen(s.rim);
      s.p = p;
      s.card.d.style.display = zoomed ? 'none' : '';
      s.path.style.display = zoomed ? 'none' : '';
      if (zoomed) continue;
      s.card.d.style.width = w + 'px';
      s.card.d.style.fontSize = (12.5 * scale).toFixed(1) + 'px';
      s.card.d.classList.toggle('compact', !!this.compactCards);
      sides[p.x < c.x ? 'L' : 'R'].push(s);
    }
    if (zoomed) return;
    let overflow = false;
    for (const side of ['L', 'R']) {
      const list = sides[side].sort((a, b) => a.p.y - b.p.y);
      const x = side === 'L' ? Math.max(ins.left + 8, c.x - rimPx - 40 - w) : Math.min(this.W - ins.right - 8 - w, c.x + rimPx + 40);
      const hs = list.map(s => s.card.d.offsetHeight + 8);
      const totalH = hs.reduce((n, h) => n + h, 0);
      if (totalH > bottom - top) overflow = true;
      // cada ficha a la altura de su sector; si chocan, se empujan hacia abajo y luego hacia arriba
      const ys = list.map((s, i) => s.p.y - hs[i] / 2);
      for (let i = 0; i < ys.length; i++) ys[i] = Math.max(ys[i], i ? ys[i - 1] + hs[i - 1] : top);
      for (let i = ys.length - 1; i >= 0; i--) ys[i] = Math.min(ys[i], (i < ys.length - 1 ? ys[i + 1] : bottom) - hs[i]);
      for (let i = 0; i < ys.length; i++) ys[i] = Math.max(ys[i], i ? ys[i - 1] + hs[i - 1] : top);
      list.forEach((s, i) => {
        s.card.d.style.visibility = '';
        s.card.d.style.transform = `translate(${x | 0}px, ${ys[i] | 0}px)`;
        const ey = ys[i] + 14, ex = side === 'L' ? x + w : x, kx = side === 'L' ? ex + 16 : ex - 16;
        s.path.setAttribute('points', `${s.p.x | 0},${s.p.y | 0} ${kx | 0},${ey | 0} ${ex | 0},${ey | 0}`);
      });
    }
    // si no caben con la lista, fichas compactas (nombre y cuenta); con espacio de sobra, vuelve la lista
    if (overflow && !this.compactCards) this.compactCards = true;
    else if (!overflow && this.compactCards && this.H > (this.lastCompactH || 0) + 50) { this.compactCards = false; }
    if (overflow) this.lastCompactH = this.H;
  }

  // la mesa deja lugar a las fichas a ambos lados
  setInsets(ins) {
    super.setInsets(ins);
    if (!this.W) return;
    const aw = Math.max(200, this.W - ins.left - ins.right);
    const w = CARD_W * clamp(this.H / 1080, 0.75, 2);
    this.cardsOff = aw < 2 * (w + 50) + 320;
    const k = this.cardsOff ? 1 : aw / Math.max(200, aw - 2 * (w + 50)); // cuanto mas ancha debe "verse" la mesa
    this.setView({ dist: this.distToFit(R * 2.3 * k, R * 2.3 * Math.sin(this.view.el) + 1.5) }, true);
  }

  // ------------------------------------------------------------------ camara, avisos y enfoque
  shots() { return [...this.sectors.values()].map(s => ({ x: Math.cos(s.mid) * R * 0.55, y: 0, z: Math.sin(s.mid) * R * 0.55, zoom: 2.2, el: 0.75 })); }
  locate(kind, id) {
    if (kind === 'app' || kind === 'site') { const it = this.items.get(id); if (it) return { x: it.g.position.x, z: it.g.position.z, zoom: 3.2 }; }
    if (kind === 'session') { const d = this.drones.get(id); if (d) return { x: d.mesh.position.x, z: d.mesh.position.z, zoom: 3 }; }
    if (kind === 'district') { const s = this.sectors.get(id); if (s) return { x: Math.cos(s.mid) * R * 0.55, z: Math.sin(s.mid) * R * 0.55, zoom: 2.2 }; }
    if (kind === 'system' || kind === 'security') return { x: 0, z: 0, zoom: 2.6 };
    return null;
  }
  tipFor(u) {
    if (u.kind === 'app' || u.kind === 'site') {
      const it = this.items.get(u.id); if (!it) return null;
      const a = it.data;
      return { title: a.name, body: `${a.kind && a.kind !== a.name ? `<b>${esc(a.kind)}</b> · ` : ''}${it.site ? 'sitio (prisma)' : 'servicio (columna)'} · ${esc(it.sec.a.label)}`,
        meta: `${{ online: 'en línea', degraded: 'parcial', down: 'CAÍDO' }[a.status] || a.status}${!it.site ? ` · CPU ${(a.cpu || 0).toFixed(1)}% · RAM ${fmtBytes(a.mem || 0)}` : ''} · ${a.reqMin || 0} visitas/min`, hint: 'Clic para ver el detalle' };
    }
    if (u.kind === 'session') { const d = this.drones.get(u.id); return d && { title: 'Dron · agente de Claude Code', body: esc(d.s.activity || ''), meta: d.s.waitKind ? 'Espera su permiso o su respuesta' : { working: 'Trabajando', thinking: 'Pensando', idle: 'En pausa' }[d.s.state] || '', hint: 'Clic para ver la línea de tiempo' }; }
    if (u.kind === 'district') { const s = this.sectors.get(u.id); return s && { title: s.a.label, body: 'Sector: una cuenta con sus servicios (columnas) y sitios (prismas). Su ficha, al costado, los nombra a todos.', meta: s.caption, hint: 'Clic para ver el sector' }; }
    if (u.kind === 'system') return { title: 'Base', body: 'El <b>servidor</b>. La cúpula es el escudo: los misiles (intentos de acceso) se estrellan contra ella.', meta: this.state?.system ? `CPU ${this.state.system.cpu.toFixed(0)}% · RAM ${this.state.system.mem.pct.toFixed(0)}% · carga ${this.state.system.load[0].toFixed(2)}` : '', hint: 'Clic para ver el servidor completo' };
    return null;
  }
}
