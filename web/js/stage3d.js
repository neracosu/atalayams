// Motor 3D compartido por los temas (three.js). Resuelve lo que todos necesitan y deja al tema solo su mundo:
//  - renderer nitido (resolucion completa), escena, luces base, niebla y sombras
//  - camara que orbita un punto (arrastrar = girar, rueda = acercar, doble clic = volver) y modo director
//  - encuadre en el area libre del HUD (setInsets / #worldArea) corriendo el centro de la vista
//  - etiquetas HTML nitidas que siguen a puntos del mundo (nombres, cuentas, avisos que suben)
//  - clics y avisos al pasar el mouse por raycasting sobre objetos con userData { kind, id }
//  - efectos con vida propia (fx) y limpieza completa al cambiar de tema
// Un tema extiende Stage3D e implementa: build(), layout(state), update(state), onEvent(e, priv),
// tipFor(userData), locate(kind, id) -> { x, y, z, zoom } y, si quiere, shots() para el director.
import * as THREE from '../vendor/three.module.min.js';
export { THREE };

const TAU = Math.PI * 2;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const color = h => new THREE.Color(h);

// textura nitida a partir de un canvas (pixel art sin suavizado)
export function pixelTexture(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// cartel que siempre mira a la camara
export function billboard(canvas, size = 1) {
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: pixelTexture(canvas), transparent: true, depthWrite: false }));
  s.scale.set(size * canvas.width / canvas.height, size, 1);
  return s;
}
// canvas a partir de una matriz de caracteres (una letra por color)
export function rowsCanvas(rows, pal, scale = 1) {
  const w = Math.max(...rows.map(r => r.length)), h = rows.length;
  const cv = document.createElement('canvas'); cv.width = w * scale; cv.height = h * scale;
  const cx = cv.getContext('2d');
  rows.forEach((r, y) => [...r].forEach((ch, x) => { if (pal[ch]) { cx.fillStyle = pal[ch]; cx.fillRect(x * scale, y * scale, scale, scale); } }));
  return cv;
}

// piezas comunes de los temas (agrupar, repartir en filas, placas): viven en layout.js, sirven tambien a los temas 2D
export { groupsOf, layoutKeyOf, packRows, iconURL, plaqueList } from './layout.js';

export class Stage3D {
  constructor(el, { manifest } = {}) {
    this.el = el; this.manifest = manifest || {};
    const p = this.manifest.palette || {};
    this.C = { ok: p.ok || '#4ade80', warn: p.warn || '#fbbf24', crit: p.crit || '#ef4444', ink: p.ink || '#e2e8f0', bg: p.bg || '#050912', accent: p.accent || '#22d3ee', dim: '#64748b' };
    this.t = 0; this.fx = []; this.pickables = []; this.labelsList = [];
    this.directorOn = true; this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.view = { az: -0.7, el: 0.85, dist: 40, tx: 0, ty: 0, tz: 0, zoom: 1 };   // lo que el tema considera la vista general
    this.orbit = { ...this.view }; this.goal = { ...this.view };
    this.manualUntil = 0; this.shotT = 8; this.shotIdx = 0; this.fitZoom = 1; this.orbitSpeed = 0.05;
  }

  // ------------------------------------------------------------------ montaje
  async init() {
    this.ac = new AbortController();
    const sig = { signal: this.ac.signal };
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setClearColor(this.C.bg);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    if (this.shadows) { this.renderer.shadowMap.enabled = true; this.renderer.shadowMap.type = THREE.PCFSoftShadowMap; }
    this.renderer.domElement.style.display = 'block';
    this.el.appendChild(this.renderer.domElement);
    this.labels = Object.assign(document.createElement('div'), { className: 'w3-labels' });
    this.el.appendChild(this.labels);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.fov || 36, 1, 0.1, 500);
    this.ray = new THREE.Raycaster();
    this.fxG = new THREE.Group(); this.scene.add(this.fxG);
    await this.build();
    this.setupNav(sig);
    window.addEventListener('resize', () => this.resize(), sig);
    this.resize();
    this.clock = new THREE.Clock();
    const loop = () => { this.raf = requestAnimationFrame(loop); this.tick(Math.min(this.clock.getDelta(), 0.1)); };
    loop();
  }
  // donde esta cada cosa en la pantalla (comunicacion entre agentes, web/js/commfx.js): se busca entre lo
  // que se puede tocar y se proyecta a la ventana; los subagentes van junto a su sesion
  screenOf(kind, id) {
    const k = kind === 'agent' ? 'session' : kind, want = kind === 'agent' ? String(id).split('/')[0] : id;
    const o = this.pickables.find(m => m.userData && m.userData.id === want && (m.userData.kind === k || (k !== 'session' && (m.userData.kind === 'app' || m.userData.kind === 'site'))));
    if (!o || !o.visible) return null;
    return this.screenAt(o.getWorldPosition(new THREE.Vector3()));
  }
  // un punto del mundo en pixeles de la ventana (null si queda detras de la camara o fuera de la vista)
  screenAt(p) {
    const v = p.clone().project(this.camera);
    if (v.z > 1 || Math.abs(v.x) > 1.05 || Math.abs(v.y) > 1.05) return null;
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height };
  }

  destroy() {
    this.ac.abort(); cancelAnimationFrame(this.raf);
    this.scene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); });
    this.renderer.dispose(); this.renderer.domElement.remove(); this.labels.remove();
  }
  // los temas lo sobreescriben
  async build() { }
  frame() { }
  shots() { return []; }
  tipFor() { return null; }
  locate() { return null; }

  // ------------------------------------------------------------------ etiquetas HTML
  // pos: Vector3 o funcion que devuelve un Vector3 (se reevalua cada cuadro)
  label(cls, html, pos) {
    const d = document.createElement('div'); d.className = 'w3-label ' + cls; d.innerHTML = html;
    this.labels.appendChild(d);
    const L = { d, pos, remove: () => { d.remove(); this.labelsList = this.labelsList.filter(x => x !== L); } };
    this.labelsList.push(L);
    return L;
  }
  float(pos, text, tone = 'ok', secs = 3) {
    const p = pos.clone();
    const L = this.label('w3-float ' + tone, text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])), p);
    this.addFx(null, f => { p.y += 0.6 * (1 / 60); L.d.style.opacity = f.age < secs - 0.7 ? 1 : Math.max(0, (secs - f.age) / 0.7); if (f.age >= secs) { L.remove(); return false; } return true; });
  }
  toScreen(v) {
    const p = v.clone().project(this.camera);
    return { x: (p.x + 1) / 2 * this.W, y: (1 - p.y) / 2 * this.H, behind: p.z > 1 || p.z < -1 };
  }
  // los nombres chicos (w3-item, w3-fish) no se pisan: si dos chocan en pantalla, se ve el mas cercano a la camara
  placeLabels() {
    const crowd = [];
    for (const L of this.labelsList) {
      const v = typeof L.pos === 'function' ? L.pos() : L.pos;
      if (!v) { L.d.style.visibility = 'hidden'; continue; }
      const p = this.toScreen(v);
      L.d.style.transform = `translate(${p.x | 0}px, ${p.y | 0}px)`;
      L.d.style.visibility = p.behind ? 'hidden' : '';
      if (L.small === undefined) L.small = /\bw3-(item|fish)\b/.test(L.d.className);
      if (L.small && !p.behind && L.d.style.display !== 'none' && L.d.textContent) crowd.push({ L, p, z: v.distanceTo(this.camera.position) });
    }
    if (!crowd.length) return;
    crowd.sort((a, b) => a.z - b.z);
    const taken = [];
    for (const c of crowd) {
      const t = c.L.d.textContent;
      if (c.L.txt !== t) { c.L.txt = t; c.L.w = c.L.d.offsetWidth; c.L.h = c.L.d.offsetHeight; }
      const r = { x0: c.p.x - c.L.w / 2 - 2, x1: c.p.x + c.L.w / 2 + 2, y0: c.p.y - c.L.h - 1, y1: c.p.y + 1 };
      const hit = taken.some(o => r.x0 < o.x1 && r.x1 > o.x0 && r.y0 < o.y1 && r.y1 > o.y0);
      if (hit) c.L.d.style.visibility = 'hidden'; else taken.push(r);
    }
  }

  // ------------------------------------------------------------------ efectos
  addFx(obj, tick) { if (obj) this.fxG.add(obj); this.fx.push({ obj, tick, age: 0 }); }
  ring(pos, tone = 'ok', size = 1, y = 0.03) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.5, 40), new THREE.MeshBasicMaterial({ color: color(this.C[tone] || tone), transparent: true, side: THREE.DoubleSide, depthWrite: false }));
    m.rotation.x = -Math.PI / 2; m.position.set(pos.x, y, pos.z);
    this.addFx(m, f => { const k = f.age / 1.1; m.scale.setScalar(1 + k * size * 3); m.material.opacity = 1 - k; return k < 1; });
  }
  // un objeto que viaja por una curva y avisa al llegar
  travel(obj, curve, secs, done) {
    this.addFx(obj, f => { const k = f.age / secs; if (k >= 1) { if (done) done(); return false; } obj.position.copy(curve.getPoint(k)); return true; });
  }
  sparks(pos, tone = 'accent', n = 10, speed = 3) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 0.08), new THREE.MeshBasicMaterial({ color: color(this.C[tone] || tone), transparent: true }));
      m.position.copy(pos);
      const v = new THREE.Vector3((Math.random() - 0.5) * speed, Math.random() * speed, (Math.random() - 0.5) * speed);
      this.addFx(m, (f, dt) => { m.position.addScaledVector(v, dt); v.y -= 6 * dt; m.material.opacity = 1 - f.age; return f.age < 1; });
    }
  }

  // ------------------------------------------------------------------ cuadro a cuadro
  tick(dt) {
    this.t += dt;
    this.frame(dt);
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]; f.age += dt;
      if (!f.tick(f, dt)) { if (f.obj) { this.fxG.remove(f.obj); f.obj.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach(m => { if (m.map && !m.map.userData.keep) m.map.dispose(); m.dispose(); }); }); } this.fx.splice(i, 1); }
    }
    this.director(dt);
    const k = 1 - Math.pow(0.03, dt), o = this.orbit, g = this.goal;
    for (const key of ['el', 'dist', 'tx', 'ty', 'tz', 'zoom']) o[key] += (g[key] - o[key]) * k;
    const dAz = ((g.az - o.az + Math.PI) % TAU + TAU) % TAU - Math.PI; o.az += dAz * k;
    this.camera.position.set(o.tx + Math.cos(o.az) * Math.cos(o.el) * o.dist, o.ty + Math.sin(o.el) * o.dist, o.tz + Math.sin(o.az) * Math.cos(o.el) * o.dist);
    this.camera.lookAt(o.tx, o.ty, o.tz);
    this.camera.zoom = this.fitZoom * o.zoom; this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    this.placeLabels();
    if (this.manualUntil && this.manualUntil < this.t) { this.manualUntil = 0; this.resetGoal(); this.navChanged(); }
    else if (this.manualUntil && Math.floor(this.t) !== this.lastNav) { this.lastNav = Math.floor(this.t); this.navChanged(); }
  }

  // ------------------------------------------------------------------ camara y encuadre
  resize() {
    const r = this.el.getBoundingClientRect();
    this.W = r.width; this.H = r.height;
    this.renderer.setSize(this.W, this.H, false);
    this.renderer.domElement.style.width = this.W + 'px'; this.renderer.domElement.style.height = this.H + 'px';
    this.camera.aspect = this.W / this.H;
    this.setInsets(this.insets);
  }
  setInsets(ins) {
    this.insets = ins;
    if (!this.camera || !this.W) return;
    const aw = Math.max(200, this.W - ins.left - ins.right), ah = Math.max(200, this.H - ins.top - ins.bottom);
    const cx = ins.left + aw / 2, cy = ins.top + ah / 2;
    this.camera.setViewOffset(this.W, this.H, this.W / 2 - cx, this.H / 2 - cy, this.W, this.H);
    // en un area mas alta que ancha (telefono en vertical) se aleja: la escena suele ser mas ancha que alta
    this.fitZoom = Math.min(aw / this.W, ah / this.H) * (this.fitScale || 1.2) * (aw < ah ? (aw / ah) ** 2 : 1);
    this.camera.updateProjectionMatrix();
  }
  // el tema fija su vista general (y la camara va hacia ella)
  setView(v, snap) { Object.assign(this.view, v); if (!this.manualUntil) { this.resetGoal(); if (snap) Object.assign(this.orbit, this.goal); } }
  resetGoal() { const az = this.goal.az; Object.assign(this.goal, this.view); if (this.directorOn) this.goal.az = az; }
  director(dt) {
    if (this.manualUntil) return;
    if (this.urgent && this.urgent.until > this.t) { Object.assign(this.goal, this.urgent.goal); return; }
    this.urgent = null;
    if (!this.directorOn) { Object.assign(this.goal, this.view); return; }
    this.goal.az += dt * this.orbitSpeed;
    this.shotT -= dt;
    if (this.shotT > 0) return;
    const shots = this.shots();
    this.shotIdx = (this.shotIdx + 1) % (shots.length * 2 || 1);
    if (this.shotIdx % 2 === 0 || !shots.length) { this.resetGoal(); this.shotT = 12; return; }
    const s = shots[Math.floor(this.shotIdx / 2) % shots.length];
    Object.assign(this.goal, { tx: s.x, ty: s.y || 0, tz: s.z, zoom: s.zoom || 1.8, el: s.el || this.view.el * 0.85 });
    this.shotT = s.secs || 12;
  }
  // llamar a la camara hacia un punto por un rato (ej. un agente que pide permiso)
  attention(pos, zoom = 2, secs = 12) { this.urgent = { until: this.t + secs, goal: { tx: pos.x, ty: 0, tz: pos.z, zoom, el: this.view.el * 0.85 } }; }
  setDirector(on) { this.directorOn = on; this.shotT = 0; }
  navState() { return this.manualUntil ? { mode: 'manual', left: Math.max(0, Math.ceil(this.manualUntil - this.t)) } : { mode: this.directorOn ? 'director' : 'fixed' }; }
  navChanged() { if (this.onNav) this.onNav(this.navState()); }
  manual() { this.manualUntil = this.t + 90; this.navChanged(); }
  resetView() { this.manualUntil = 0; this.resetGoal(); this.shotT = 12; this.navChanged(); }
  // distancia de camara para que un rectangulo de w x h unidades (visto de frente) entre en el area libre del HUD
  distToFit(w, h) {
    if (!this.W || !this.H) return 40;
    const aw = Math.max(200, this.W - this.insets.left - this.insets.right), ah = Math.max(200, this.H - this.insets.top - this.insets.bottom);
    const k = 2 * Math.tan(this.fov * Math.PI / 360) / (this.fitZoom || 1);
    return Math.max(h * this.H / (k * ah), w * this.H / (k * aw));
  }
  areaAspect() { return this.W && this.H ? Math.max(0.4, (this.W - this.insets.left - this.insets.right) / Math.max(1, this.H - this.insets.top - this.insets.bottom)) : 1.6; }
  // placas medidas de verdad (la letra de cada tema ocupa distinto): alto en unidades del mundo por cuenta.
  // Si alguna no cabe en lo que se le reservo, se rearma la distribucion (como mucho 3 veces por cambio real)
  plaqueUnits(id, estimate) { return Math.max(estimate, (this.measured && this.measured.get(id)) || 0); }
  // Si la pantalla es chica (la letra de la lista quedaria ilegible), las placas pasan a modo compacto:
  // nombre, cuenta y cantidad; los nombres se ven al acercarse. En pantallas grandes, la lista completa.
  refitPlaques(groups, k = 1, fontK = 0.36) {
    this.measured = this.measured || new Map();
    if ((this.refits || 0) >= 4 || (this.nextMeasure || 0) > this.t) return;
    this.nextMeasure = this.t + 1.5;
    // solo con la camara quieta en la vista general
    if (Math.abs(this.orbit.zoom - 1) > 0.05 || Math.abs(this.orbit.dist - this.view.dist) > this.view.dist * 0.05) return;
    const ppu = this.pxPerUnit(new THREE.Vector3(this.orbit.tx, 0, this.orbit.tz));
    const compact = this.compactPlaques ? ppu * fontK < 10 : ppu * fontK < 7.5;
    let off = compact !== !!this.compactPlaques;
    if (off) { this.compactPlaques = compact; this.measured.clear(); }
    else for (const g of groups) {
      if (!g.plaque || !g.plaque.d.offsetHeight) continue;
      const u = g.plaque.d.offsetHeight / ppu / k + 0.4;
      if (u > (g.plaqueU || 0) * 1.08) { this.measured.set(g.a.id, u); off = true; }
    }
    if (off && this.state) { this.refits = (this.refits || 0) + 1; this.layoutKey = ''; this.layout(this.state); }
  }
  // lineas de texto que ocupa una placa: titulo y cuenta, mas la lista en columnas (si no esta compacta)
  plaqueLines(n, wUnits, fontK = 0.36) { return 2.8 + (this.compactPlaques ? 0 : Math.ceil(n / Math.max(1, Math.floor(wUnits / (fontK * 10.5))))); }
  // lo comun a cada cuadro: ancho y letra de cada placa segun el zoom, y su modo compacto
  sizePlaques(list, fontK = 0.36) {
    const ppu = this.pxPerUnit(new THREE.Vector3(this.orbit.tx, 0, this.orbit.tz));
    const fs = clamp(ppu * fontK, 11, 17).toFixed(1) + 'px';
    for (const [pl, w, min] of list) { pl.d.style.width = Math.round(Math.max(w * ppu, min || 130)) + 'px'; pl.d.style.fontSize = fs; pl.d.classList.toggle('compact', !!this.compactPlaques && this.orbit.zoom < 1.5); }
  }
  // cuantos pixeles mide una unidad del mundo en pantalla alrededor de un punto (para escalar placas)
  pxPerUnit(p) {
    p = p || new THREE.Vector3(this.orbit.tx, this.orbit.ty, this.orbit.tz);
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrixWorld, 0);
    const a = this.toScreen(p), b = this.toScreen(p.clone().add(right));
    return Math.max(2, Math.hypot(b.x - a.x, b.y - a.y));
  }
  zoomBy(f) { this.manual(); this.goal.zoom = clamp(this.goal.zoom * f, 0.5, 6); }
  pick(kind, id) {
    this.selected = { kind, id };
    const p = this.locate(kind, id);
    if (p) { this.manual(); Object.assign(this.goal, { tx: p.x, ty: p.y || 0, tz: p.z, zoom: p.zoom || 2.5, el: this.view.el * 0.85 }); }
    if (this.onSelect) this.onSelect(kind, id);
  }
  clearSelection() { this.selected = null; }

  // ------------------------------------------------------------------ clics y avisos
  hitTest(clientX, clientY) {
    const r = this.renderer.domElement.getBoundingClientRect();
    const v = new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(v, this.camera);
    const hits = this.ray.intersectObjects(this.pickables, true);
    // lo mas especifico primero: servicios y agentes antes que el suelo de una cuenta
    const ud = h => { let o = h.object; while (o && !o.userData.kind) o = o.parent; return o ? o.userData : null; };
    const all = hits.map(ud).filter(Boolean);
    return all.find(u => u.kind !== 'district') || all[0] || null;
  }
  setupNav(sig) {
    const cv = this.renderer.domElement;
    let start = null, last = null;
    cv.style.touchAction = 'none';
    window.addEventListener('pointerdown', e => { if (e.target !== cv) return; start = last = { x: e.clientX, y: e.clientY }; this.dragMoved = false; }, { capture: true, signal: sig.signal });
    window.addEventListener('pointermove', e => {
      if (start) {
        if (!this.dragMoved && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 6) this.dragMoved = true;
        if (this.dragMoved) {
          if (!this.manualUntil) this.manual(); else this.manualUntil = this.t + 90;
          this.goal.az += (e.clientX - last.x) * 0.006; this.orbit.az = this.goal.az;
          this.goal.el = clamp(this.goal.el + (e.clientY - last.y) * 0.004, 0.25, 1.45); this.orbit.el = this.goal.el;
          if (this.onTip) this.onTip(null);
        }
        last = { x: e.clientX, y: e.clientY };
        return;
      }
      if (e.target !== cv) return;
      const u = this.hitTest(e.clientX, e.clientY);
      cv.style.cursor = u ? 'pointer' : 'grab';
      if (this.onTip) this.onTip(u ? this.tipFor(u) : null, e.clientX, e.clientY);
    }, sig);
    window.addEventListener('pointerup', e => {
      if (start && !this.dragMoved && e.target === cv) { const u = this.hitTest(e.clientX, e.clientY); if (u) this.pick(u.kind, u.id); }
      start = null;
    }, sig);
    cv.addEventListener('pointerleave', () => this.onTip && this.onTip(null), sig);
    cv.addEventListener('wheel', e => { e.preventDefault(); this.zoomBy(Math.exp(-e.deltaY * 0.0015)); }, { passive: false, signal: sig.signal });
    cv.addEventListener('dblclick', () => this.resetView(), sig);
    this.labels.addEventListener('click', e => { const el = e.target.closest('[data-go]'); if (el) { const [k, ...r] = el.dataset.go.split(':'); this.pick(k, r.join(':')); } }, sig);
  }
}
