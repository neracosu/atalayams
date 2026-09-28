// Tema "Ciudad 3D": la ciudad de Atalaya en tres dimensiones (three.js), de noche.
//  - cada cuenta es una PARCELA elevada con el borde de su color y su nombre (y su cuenta de cPanel)
//  - cada servicio es un EDIFICIO: altura = memoria, ventanas encendidas = visitas, techo naranja = CPU alta,
//    baliza de estado (verde, ambar, roja parpadeando); cada sitio, un edificio bajo; encima, su cartel pixel
//  - en el centro, la TORRE DE CONTROL (el servidor) con su escudo; calles hacia cada distrito y el portal
//    "Internet" por donde entran las visitas (puntos de luz que recorren las calles hasta su edificio)
//  - los robots de Claude Code caminan por su distrito (pixel art); los invasores chocan contra el escudo
//  - a un lado de la torre, la CARCEL; al otro, la OFICINA DE CORREOS (los sobres pasan por ella)
//  - servidor al limite: la torre se pone roja y las visitas hacen fila frente al portal (atasco)
//  - a un costado de la torre, la CARCEL (IPs bloqueadas, un auto por preso, capsulas de cuarentena); en la esquina de
//    cada distrito, su SILO de datos (bases MySQL) con tuberias hacia los sitios que las usan
// Regla de oro: la informacion vive en la ciudad (altura, luces, techos); el pixel art es el acento.
import { Stage3D, THREE, color, clamp, billboard, rowsCanvas, pixelTexture } from '../../js/stage3d.js';
import { forEdition } from '../../js/accounts.js';
import { signCanvas, robotCanvas, INVADER, ENVELOPE } from '../../js/sprites.js';
import { esc, fmtBytes } from '../../js/hud.js';
import { accountCaption } from '../../js/accounts.js';
import { healthLine } from '../../js/layout.js';
import { PROBE_CAR, CAR_COLORS, paintCanvas } from '../../js/pixeldata.js';

const GAP = 2.1; // distancia entre edificios
const JAIL = { x: -16, z: -2, w: 7, d: 5.4 }; // la carcel, a un costado de la torre (vista desde la camara inicial)
const POST = { x: 6, z: 16, w: 6, d: 5 };     // la oficina de correos, del otro lado
const SHORT = { auth: 'SIN AUTENTICAR', nouser: 'NO EXISTE', full: 'BUZÓN LLENO', spam: 'SPAM', domain: 'DOMINIO', rate: 'DEMASIADOS' };
const SILO_W = 2.2; // franja de la parcela para el silo de datos
const shade = (hex, f) => color(hex).lerp(color(f < 0 ? '#000000' : '#ffffff'), Math.abs(f));

// fachada: ventanas en grilla (el mismo canvas sirve de color y de brillo)
function facadeCanvas(seed) {
  const cv = document.createElement('canvas'); cv.width = 16; cv.height = 32;
  const cx = cv.getContext('2d');
  cx.fillStyle = '#10131c'; cx.fillRect(0, 0, 16, 32);
  let r = seed;
  for (let y = 2; y < 32; y += 4) for (let x = 2; x < 16; x += 4) {
    r = (r * 1103515245 + 12345) & 0x7fffffff;
    cx.fillStyle = r % 7 === 0 ? '#3a3f52' : '#ffe9a8';
    cx.fillRect(x, y, 2, 2);
  }
  return cv;
}

export default class Ciudad3D extends Stage3D {
  constructor(el, opts) {
    super(el, opts);
    this.shadows = true; this.fov = 34; this.fitScale = 1.4;
    this.buildings = new Map(); this.districts = new Map(); this.robots = new Map(); this.pipes = [];
    this.layoutKey = '';
    this.view = { az: -0.9, el: 0.78, dist: 58, tx: 0, ty: 0, tz: 0, zoom: 1 };
    this.orbit = { ...this.view }; this.goal = { ...this.view };
  }

  async build() {
    const S = this.scene;
    S.fog = new THREE.Fog(this.C.bg, 70, 150);
    S.add(new THREE.HemisphereLight(0x8fa6ff, 0x0a0a14, 0.55));
    const moon = new THREE.DirectionalLight(0xc8d4ff, 0.9);
    moon.position.set(-30, 50, 20); moon.castShadow = true;
    moon.shadow.mapSize.set(2048, 2048);
    Object.assign(moon.shadow.camera, { left: -60, right: 60, top: 60, bottom: -60, near: 1, far: 150 });
    S.add(moon);
    // suelo y estrellas
    const ground = new THREE.Mesh(new THREE.CircleGeometry(160, 64), new THREE.MeshStandardMaterial({ color: 0x070b16, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; S.add(ground);
    const grid = new THREE.GridHelper(200, 100, 0x16203a, 0x0e1528); grid.position.y = 0.01; S.add(grid);
    const sp = []; for (let i = 0; i < 600; i++) { const a = Math.random() * Math.PI * 2, e = Math.random() * 0.9 + 0.1; sp.push(Math.cos(a) * Math.cos(e) * 140, Math.sin(e) * 140, Math.sin(a) * Math.cos(e) * 140); }
    const stars = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(sp, 3)), new THREE.PointsMaterial({ color: 0x9fb4d9, size: 0.6, sizeAttenuation: true }));
    S.add(stars);
    this.city = new THREE.Group(); S.add(this.city);
    this.buildHQ();
    this.buildJail();
    this.buildPost();
  }

  buildHQ() {
    const g = new THREE.Group();
    const tower = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.9, 9, 8), new THREE.MeshStandardMaterial({ color: 0x2a3550, metalness: 0.5, roughness: 0.4, emissive: color(this.C.accent), emissiveIntensity: 0.08 }));
    tower.position.y = 4.5; tower.castShadow = true;
    const bands = new THREE.Group();
    for (let i = 0; i < 6; i++) { const b = new THREE.Mesh(new THREE.CylinderGeometry(1.5 + (5 - i) * 0.08, 1.5 + (5 - i) * 0.08, 0.12, 8, 1, true), new THREE.MeshBasicMaterial({ color: color(this.C.accent), transparent: true, opacity: 0.8, side: THREE.DoubleSide })); b.position.y = 1.2 + i * 1.3; bands.add(b); }
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.5, 16), new THREE.MeshStandardMaterial({ color: 0x1c2438, metalness: 0.6, roughness: 0.4 }));
    deck.position.y = 9.2; deck.castShadow = true;
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.1, 3), new THREE.MeshStandardMaterial({ color: 0x8a95ad }));
    mast.position.y = 11;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 8), new THREE.MeshBasicMaterial({ color: color(this.C.crit) }));
    beacon.position.y = 12.6;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(4.2, 4.6, 0.4, 32), new THREE.MeshStandardMaterial({ color: 0x141b2e, roughness: 0.8 }));
    pad.position.y = 0.2; pad.receiveShadow = true;
    const shield = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshBasicMaterial({ color: color(this.C.accent), wireframe: true, transparent: true, opacity: 0.07 }));
    g.add(pad, tower, bands, deck, mast, beacon, shield);
    g.userData = { kind: 'system', id: 'root' };
    this.scene.add(g);
    this.pickables.push(tower, deck, pad);
    [tower, deck, pad].forEach(m => { m.userData = { kind: 'system', id: 'root' }; });
    this.hq = { g, tower, bands, beacon, shield, flash: 0 };
    this.hqLabel = this.label('w3-group', '<b>TORRE DE CONTROL</b><small></small><i class="hl"></i>', new THREE.Vector3(0, 13.8, 0));
    // portal "Internet"
    this.gatePos = new THREE.Vector3(-20, 4, 22); // detras de la ciudad vista desde la camara inicial
    const gate = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.18, 12, 48), new THREE.MeshBasicMaterial({ color: color(this.C.accent) }));
    gate.position.copy(this.gatePos); this.scene.add(gate);
    this.gate = gate;
    this.label('w3-agent', 'INTERNET', this.gatePos.clone().setY(7));
  }

  // Carcel: las IPs bloqueadas (a mano en el firewall y por la defensa de Atalaya). Edificio con rejas, patio
  // cercado con un auto oscuro por preso (hasta 6) y, en la esquina, las capsulas de cuarentena
  buildJail() {
    const g = new THREE.Group(); g.position.set(JAIL.x, 0, JAIL.z); g.rotation.y = Math.atan2(-JAIL.x, -JAIL.z); // de frente a la torre
    const ud = { kind: 'jail', id: 'all' };
    const plate = new THREE.Mesh(new THREE.BoxGeometry(JAIL.w, 0.3, JAIL.d), new THREE.MeshStandardMaterial({ color: shade('#94a3b8', -0.84), roughness: 0.9 }));
    plate.position.y = 0.15; plate.receiveShadow = true;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(plate.geometry), new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.6 }));
    edge.position.copy(plate.position);
    // el edificio atras, con rejas en el frente y los costados
    const house = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.4, 1.8), new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.7 }));
    house.position.set(-1.2, 1.5, -1.5); house.castShadow = true; house.receiveShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.8, 0.16, 2), new THREE.MeshStandardMaterial({ color: 0x64748b }));
    roof.position.set(-1.2, 2.78, -1.5);
    const barMat = new THREE.MeshStandardMaterial({ color: 0xcbd5e1, metalness: 0.7, roughness: 0.3 });
    const bars = new THREE.Group();
    for (let i = 0; i < 9; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2, 0.06), barMat); b.position.set(-2.8 + i * 0.4, 1.4, -0.58); bars.add(b); }
    for (const sx of [-3.03, 0.63]) for (let i = 0; i < 4; i++) { const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2, 0.06), barMat); b.position.set(sx, 1.4, -2.2 + i * 0.4); bars.add(b); }
    // patio cercado adelante, donde quedan los presos
    const yard = { x0: -3, x1: 1, z0: -0.2, z1: 2.3 }, fence = [];
    const P = (x, z) => new THREE.Vector3(x, 0.3, z);
    const ring = [P(yard.x0, yard.z0), P(yard.x1, yard.z0), P(yard.x1, yard.z1), P(yard.x0, yard.z1), P(yard.x0, yard.z0)];
    for (let i = 0; i < 4; i++) {
      const a = ring[i], b = ring[i + 1], n = Math.round(a.distanceTo(b) / 0.5);
      for (let k = 0; k < n; k++) { const q = a.clone().lerp(b, k / n); fence.push(q.x, 0.3, q.z, q.x, 0.85, q.z); }
      fence.push(a.x, 0.85, a.z, b.x, 0.85, b.z, a.x, 0.6, a.z, b.x, 0.6, b.z);
    }
    const fenceL = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(fence, 3)), new THREE.LineBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0.8 }));
    const cars = new THREE.Group(), caps = new THREE.Group();
    g.add(plate, edge, house, roof, bars, fenceL, cars, caps);
    for (const m of [g, plate, house, roof]) m.userData = ud;
    this.scene.add(g);
    this.pickables.push(plate, house, roof);
    const carMat = new THREE.SpriteMaterial({ map: pixelTexture(paintCanvas(PROBE_CAR[1], CAR_COLORS, 1)), transparent: true, depthWrite: false });
    const label = this.label('w3-group', '<b style="color:#fca5a5">CÁRCEL</b><small></small>', new THREE.Vector3(JAIL.x, 3.9, JAIL.z));
    label.d.dataset.go = 'jail:all'; label.d.style.translate = '-50% 0';
    this.jail = { g, cars, caps, carMat, label, yard, n: -1, qn: -1, pos: new THREE.Vector3(JAIL.x, 1.2, JAIL.z) };
  }
  drawJail(J) {
    const j = this.jail;
    j.g.visible = !!J; j.label.d.style.display = J ? '' : 'none';
    if (!J) return;
    const n = J.n || 0, q = J.quarantine || 0;
    if (n !== j.n) {
      j.n = n; j.cars.clear();
      for (let i = 0; i < Math.min(6, n); i++) {
        const s = new THREE.Sprite(j.carMat); s.scale.set(0.95, 0.95 * 8 / 20, 1);
        s.position.set(j.yard.x0 + 0.7 + (i % 3) * 1.25, 0.55, j.yard.z0 + 0.7 + Math.floor(i / 3) * 1.1);
        j.cars.add(s);
      }
    }
    if (q !== j.qn) {
      // capsulas: tubo de vidrio verde con tapa y un bicho rojo adentro, en la esquina del patio
      j.qn = q; j.caps.clear();
      for (let i = 0; i < Math.min(4, q); i++) {
        const c = new THREE.Group(); c.position.set(2 + (i % 2) * 0.75, 0.3, -0.9 + Math.floor(i / 2) * 1.1);
        const glass = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.55, 4, 12), new THREE.MeshStandardMaterial({ color: 0x14532d, emissive: new THREE.Color(0x4ade80), emissiveIntensity: 0.4, transparent: true, opacity: 0.55, roughness: 0.2 }));
        glass.position.y = 0.55;
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.1, 12), new THREE.MeshStandardMaterial({ color: 0xbbf7d0 }));
        cap.position.y = 1.08;
        const bug = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.14, 0.12), new THREE.MeshBasicMaterial({ color: 0xef4444 }));
        bug.position.y = 0.55;
        c.add(glass, cap, bug); c.userData = { kind: 'jail', id: 'all' };
        j.caps.add(c);
      }
    }
    const parts = [n ? `${n} preso${n === 1 ? '' : 's'}` : 'vacía'];
    if (q) parts.push(`${q} en cuarentena`);
    j.label.d.querySelector('small').textContent = parts.join(' · ');
  }

  // Oficina de correos: por aqui pasa todo el correo. Buzon rojo, un sobre pixel que salta al recibir, el
  // movimiento del ultimo minuto en su rotulo y una pila de sobres si la cola de correo se atasca
  buildPost() {
    const g = new THREE.Group(); g.position.set(POST.x, 0, POST.z); g.rotation.y = Math.atan2(-POST.x, -POST.z);
    const ud = { kind: 'mail', id: 'all' };
    const plate = new THREE.Mesh(new THREE.BoxGeometry(POST.w, 0.3, POST.d), new THREE.MeshStandardMaterial({ color: shade('#fbbf24', -0.86), roughness: 0.9 }));
    plate.position.y = 0.15; plate.receiveShadow = true;
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(plate.geometry), new THREE.LineBasicMaterial({ color: 0xfbbf24, transparent: true, opacity: 0.55 }));
    edge.position.copy(plate.position);
    const fac = new THREE.CanvasTexture(facadeCanvas(4242)); fac.magFilter = THREE.NearestFilter; fac.colorSpace = THREE.SRGBColorSpace;
    const house = new THREE.Mesh(new THREE.BoxGeometry(3.4, 2.2, 2.4), new THREE.MeshStandardMaterial({ color: 0x9a3412, map: fac, emissiveMap: fac, emissive: new THREE.Color(0xffd98a), emissiveIntensity: 0.6, roughness: 0.7 }));
    house.position.set(-0.4, 1.4, -0.6); house.castShadow = true; house.receiveShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.18, 2.6), new THREE.MeshStandardMaterial({ color: 0xfbbf24, roughness: 0.5 }));
    roof.position.set(-0.4, 2.59, -0.6);
    // buzon rojo en el frente
    const box = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.6, 0.35), new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.5 }));
    box.position.set(1.9, 0.95, 1.4); box.castShadow = true;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.35, 0.08), new THREE.MeshStandardMaterial({ color: 0x475569 }));
    leg.position.set(1.9, 0.47, 1.4);
    const env = billboard(rowsCanvas(ENVELOPE.map(r => r.replace(/x/g, 'e')), { e: '#fde68a' }, 4), 0.7);
    env.position.set(-0.4, 3.35, -0.6);
    const pile = new THREE.Group();
    g.add(plate, edge, house, roof, box, leg, env, pile);
    for (const m of [g, plate, house, roof, box]) m.userData = ud;
    this.scene.add(g);
    this.pickables.push(plate, house, roof, box);
    const label = this.label('w3-group', '<b style="color:#fde68a">CORREO</b><small></small>', new THREE.Vector3(POST.x, 4.3, POST.z));
    label.d.dataset.go = 'mail:all'; label.d.style.translate = '-50% 0';
    this.post = { g, env, pile, label, log: [], pileN: -1, at: new THREE.Vector3(POST.x, 2.4, POST.z) };
  }
  postLine() {
    const P = this.post, now = this.t;
    P.log = P.log.filter(x => now - x.t < 60);
    const n = d => P.log.filter(x => x.dir === d).length;
    const parts = [[n('out'), 'salen'], [n('in'), 'entran'], [n('bounce'), 'rebotan']].filter(x => x[0]).map(x => `${x[0]} ${x[1]}`);
    return parts.length ? parts.join(' · ') + ' en 1 min' : 'sin movimiento en el último minuto';
  }
  drawPost(queue) {
    const P = this.post;
    const sm = P.label.d.querySelector('small'), txt = this.postLine();
    if (sm.textContent !== txt) sm.textContent = txt;
    sm.style.color = P.log.some(x => x.dir === 'bounce') ? '#fca5a5' : '';
    const q = queue || 0, want = q > 1000 ? 9 : q > 100 ? 6 : q > 20 ? 3 : 0; // la pila crece con la cola
    if (want === P.pileN) return;
    P.pileN = want; P.pile.clear();
    const mat = new THREE.SpriteMaterial({ map: pixelTexture(rowsCanvas(ENVELOPE.map(r => r.replace(/x/g, 'e')), { e: q > 1000 ? '#f87171' : '#fbbf24' }, 1)), transparent: true, depthWrite: false });
    for (let i = 0; i < want; i++) { const e = new THREE.Sprite(mat); e.scale.set(0.5, 0.39, 1); e.position.set(-2.4 + (i % 3) * 0.08, 0.5 + i * 0.22, 1.3); P.pile.add(e); }
  }

  // ------------------------------------------------------------------ distritos y edificios
  layout(state) {
    const accounts = state.accounts.filter(a => a.id !== 'root');
    const by = {};
    for (const a of state.apps) (by[a.account] = by[a.account] || []).push({ ...a, _k: 'app' });
    for (const x of state.sites || []) (by[x.account] = by[x.account] || []).push({ ...x, _k: 'site' });
    const silos = new Set(((state.silos && state.silos.list) || []).map(x => x.account)); // cuentas con bases
    const key = (state.jail ? 'J' : '') + (this.post.g.visible ? 'P|' : '|') + accounts.map(a => a.id + ':' + (a.cpanel || '') + ':' + (silos.has(a.id) ? 's' : '') + ':' + (by[a.id] || []).map(x => x.id + (x.icon || '')).join(',')).join('|');
    if (key === this.layoutKey) return;
    this.layoutKey = key;
    // limpiar
    this.city.clear();
    for (const d of this.districts.values()) d.label.remove();
    for (const b of this.buildings.values()) b.label.remove();
    for (const d of this.districts.values()) if (d.silo) d.silo.label.remove();
    this.districts.clear(); this.buildings.clear(); this.pipes = []; this.pipeKey = '';
    this.pickables = this.pickables.filter(p => ['system', 'session', 'jail'].includes(p.userData.kind));
    const list = accounts.filter(a => (by[a.id] || []).length).map(a => {
      const items = by[a.id].sort((x, y) => (x._k === y._k ? 0 : x._k === 'app' ? -1 : 1));
      const cols = clamp(Math.ceil(Math.sqrt(items.length * 1.3)), 2, 8), rows = Math.ceil(items.length / cols);
      const silo = silos.has(a.id);
      return { a, items, cols, rows, silo, w: cols * GAP + 1.6 + (silo ? SILO_W : 0), d: rows * GAP + 3.2 };
    }).sort((x, y) => y.items.length - x.items.length);
    // posiciones: anillo alrededor de la torre y luego se separan
    const slots = [[1, 0], [-1, 0], [0, 1], [0.7, -0.8], [-0.7, -0.8], [0.8, 0.9], [-0.8, 0.9], [0, -1.2]];
    list.forEach((it, i) => { const s = slots[i % slots.length], k = 1 + Math.floor(i / slots.length) * 0.7; it.x = s[0] * (9 + it.w / 2) * k; it.z = s[1] * (9 + it.d / 2) * k; });
    const fixed = [this.jail.g.visible && JAIL, this.post.g.visible && POST].filter(Boolean);
    for (let n = 0; n < 80; n++) for (const A of list) {
      for (const B of list) if (A !== B) {
        const ox = (A.w + B.w) / 2 + 2 - Math.abs(A.x - B.x), oz = (A.d + B.d) / 2 + 2 - Math.abs(A.z - B.z);
        if (ox > 0 && oz > 0) { if (ox < oz) A.x += Math.sign(A.x - B.x || 1) * ox / 2; else A.z += Math.sign(A.z - B.z || 1) * oz / 2; }
      }
      const ox = A.w / 2 + 6 - Math.abs(A.x), oz = A.d / 2 + 6 - Math.abs(A.z);
      if (ox > 0 && oz > 0) { if (ox < oz) A.x += Math.sign(A.x || 1) * ox; else A.z += Math.sign(A.z || 1) * oz; }
      // la carcel y el correo tampoco se mueven: el distrito se aparta
      for (const F of fixed) {
        const jx = (A.w + F.w) / 2 + 2 - Math.abs(A.x - F.x), jz = (A.d + F.d) / 2 + 2 - Math.abs(A.z - F.z);
        if (jx > 0 && jz > 0) { if (jx < jz) A.x += Math.sign(A.x - F.x || 1) * jx; else A.z += Math.sign(A.z - F.z || 1) * jz; }
      }
    }
    let ext = 12;
    for (const F of fixed) ext = Math.max(ext, Math.abs(F.x) + F.w / 2, Math.abs(F.z) + F.d / 2);
    for (const it of list) { this.buildDistrict(it); ext = Math.max(ext, Math.abs(it.x) + it.w / 2, Math.abs(it.z) + it.d / 2); }
    // la vista general abarca toda la ciudad
    this.setView({ dist: 20 + ext * 2.1 }, true);
  }

  buildDistrict(it) {
    const { a, items, cols } = it;
    const g = new THREE.Group(); g.position.set(it.x, 0, it.z);
    // parcela
    const plate = new THREE.Mesh(new THREE.BoxGeometry(it.w, 0.35, it.d), new THREE.MeshStandardMaterial({ color: shade(a.color, -0.82), roughness: 0.9 }));
    plate.position.y = 0.175; plate.receiveShadow = true; plate.userData = { kind: 'district', id: a.id };
    const edge = new THREE.LineSegments(new THREE.EdgesGeometry(plate.geometry), new THREE.LineBasicMaterial({ color: color(a.color) }));
    edge.position.copy(plate.position);
    g.add(plate, edge);
    this.pickables.push(plate);
    const plateEdge = edge;
    // calle desde la torre
    const len = Math.hypot(it.x, it.z) - Math.min(it.w, it.d) / 2 - 4;
    if (len > 0) {
      const road = new THREE.Mesh(new THREE.PlaneGeometry(1.1, len), new THREE.MeshStandardMaterial({ color: 0x131a2c, roughness: 1 }));
      const ang = Math.atan2(it.x, it.z);
      road.rotation.x = -Math.PI / 2; road.rotation.z = -ang + Math.PI;
      const mid = 4 + len / 2;
      road.position.set(Math.sin(ang) * mid, 0.03, Math.cos(ang) * mid);
      road.receiveShadow = true;
      this.city.add(road);
      for (let d = 5; d < 4 + len; d += 1.4) { const dash = new THREE.Mesh(new THREE.PlaneGeometry(0.12, 0.6), new THREE.MeshBasicMaterial({ color: 0x334a7a })); dash.rotation.x = -Math.PI / 2; dash.rotation.z = -ang; dash.position.set(Math.sin(ang) * d, 0.04, Math.cos(ang) * d); this.city.add(dash); }
    }
    this.city.add(g);
    const nA = items.filter(x => x._k === 'app').length;
    const caption = accountCaption(a, nA, items.length - nA);
    const d = { a, g, edge: plateEdge, x: it.x, z: it.z, w: it.w, dd: it.d, caption, center: new THREE.Vector3(it.x, 0, it.z) };
    d.label = this.label('w3-group', `<b style="color:${a.color}">${esc(a.label)}</b><small>${esc(caption)}</small>`, new THREE.Vector3(it.x, 0.4, it.z + it.d / 2 + 0.8));
    d.label.d.dataset.go = 'district:' + a.id;
    d.label.d.style.translate = '-50% 0';
    // edificios en grilla; la franja del frente queda libre para los robots
    items.forEach((x, i) => {
      const bx = -it.w / 2 + 1.8 + (i % cols) * GAP, bz = -it.d / 2 + 1.6 + Math.floor(i / cols) * GAP;
      this.addBuilding(x, g, bx, bz, a);
    });
    d.plaza = { x0: it.x - it.w / 2 + 1, x1: it.x + it.w / 2 - 1, z: it.z + it.d / 2 - 0.9 };
    if (it.silo) d.silo = this.addSilo(g, it.w / 2 - SILO_W / 2 - 0.2, -it.d / 2 + 1.5, a);
    this.districts.set(a.id, d);
  }

  // silo de datos de una cuenta (sus bases MySQL): altura = tamano, anillo de la tapa que late = consultas en
  // curso, anillos tenues en el suelo = conexiones dormidas, rojo = el servidor de bases al limite
  addSilo(parent, x, z, acc) {
    const g = new THREE.Group(); g.position.set(x, 0.35, z);
    const ud = { kind: 'databases', id: acc.id };
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 1, 24), new THREE.MeshStandardMaterial({ color: shade(acc.color, 0.1), roughness: 0.45, metalness: 0.35 }));
    body.geometry.translate(0, 0.5, 0); body.castShadow = true; body.receiveShadow = true;
    const bands = [0, 1, 2].map(() => new THREE.Mesh(new THREE.TorusGeometry(0.71, 0.035, 6, 32), new THREE.MeshStandardMaterial({ color: shade(acc.color, -0.55) })));
    bands.forEach(b => { b.rotation.x = Math.PI / 2; });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.72, 24, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: shade(acc.color, 0.3), roughness: 0.4, metalness: 0.3 }));
    cap.scale.y = 0.35;
    const glow = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ color: 0xa5f3fc, transparent: true, opacity: 0, depthWrite: false }));
    glow.rotation.x = -Math.PI / 2;
    const sleeps = [1, 2, 3].map(k => { const m = new THREE.Mesh(new THREE.RingGeometry(0.8 + k * 0.28, 0.84 + k * 0.28, 40), new THREE.MeshBasicMaterial({ color: 0x94a3b8, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false })); m.rotation.x = -Math.PI / 2; m.position.y = 0.02; return m; });
    g.add(body, ...bands, cap, glow, ...sleeps);
    for (const m of [g, body, cap]) m.userData = ud;
    parent.add(g);
    this.pickables.push(body, cap);
    const o = { g, body, bands, cap, glow, sleeps, acc, h: 1, target: 1.4, x: null };
    o.label = this.label('w3-item', '', () => g.getWorldPosition(new THREE.Vector3()).setY(0.35 + o.h + 0.9));
    o.label.d.dataset.go = 'databases:' + acc.id;
    return o;
  }

  // tuberias: del silo a cada sitio que usa sus bases (y de cada Supabase a su app), con pulsos si hay consultas
  buildPipes(S) {
    const list = (S && S.list) || [], sb = (S && S.sb) || [];
    const key = list.map(x => x.account + ':' + x.links.map(l => l.id).join(',')).join('|') + '#' + sb.map(l => l.from + '>' + l.to).join(',');
    if (key === this.pipeKey) return;
    this.pipeKey = key;
    for (const p of this.pipes) { this.city.remove(p.tube, p.dots); p.tube.geometry.dispose(); p.tube.material.dispose(); }
    this.pipes = [];
    const at = o => o.getWorldPosition(new THREE.Vector3()).setY(0.62);
    const add = (a, b, col, get) => {
      const mid = a.clone().lerp(b, 0.5); mid.y += 0.6 + a.distanceTo(b) * 0.08;
      const curve = new THREE.QuadraticBezierCurve3(a, mid, b);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.07, 6), new THREE.MeshBasicMaterial({ color: shade(col, 0.35), transparent: true, opacity: 0.5, depthWrite: false }));
      const dots = new THREE.Group();
      for (let i = 0; i < 4; i++) dots.add(new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, 0.14), new THREE.MeshBasicMaterial({ color: col === '#3ecf8e' ? 0xa7f3d0 : 0xa5f3fc })));
      this.city.add(tube, dots);
      this.pipes.push({ curve, tube, dots, get });
    };
    for (const x of list) {
      const d = this.districts.get(x.account); if (!d || !d.silo) continue;
      for (const l of x.links) {
        const b = this.buildings.get(l.id); if (!b) continue;
        add(at(d.silo.g), at(b.g), d.a.color, () => { const s = d.silo.x && d.silo.x.links.find(k => k.id === l.id); return s ? { n: s.active, speed: 0.5 + (s.busy || 0) / 100 } : null; });
      }
    }
    for (const l of sb) {
      const a = this.buildings.get(l.from), b = this.buildings.get(l.to); if (!a || !b) continue;
      add(at(a.g), at(b.g), '#3ecf8e', () => { const c = a.data.sb && a.data.sb.conns; return c ? { n: Math.round(c / 5), speed: 0.45 } : null; });
    }
  }

  addBuilding(it, parent, x, z, acc) {
    const site = it._k === 'site';
    const fac = new THREE.CanvasTexture(facadeCanvas((it.id.charCodeAt(0) || 1) * 97 + (it.id.charCodeAt(1) || 3)));
    fac.magFilter = THREE.NearestFilter; fac.colorSpace = THREE.SRGBColorSpace; fac.wrapT = THREE.RepeatWrapping;
    const w = site ? 1.5 : 1.25;
    const mat = new THREE.MeshStandardMaterial({ color: site ? shade(acc.color, 0.35) : shade(acc.color, -0.15), map: fac, emissiveMap: fac, emissive: new THREE.Color(0xffd98a), emissiveIntensity: 0.05, roughness: 0.6, metalness: 0.2 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, 1, w), mat);
    body.geometry.translate(0, 0.5, 0);
    body.castShadow = true; body.receiveShadow = true;
    const roof = new THREE.Mesh(new THREE.BoxGeometry(w + 0.1, 0.14, w + 0.1), new THREE.MeshStandardMaterial({ color: 0x2a2f40, emissive: new THREE.Color(0xff8a2a), emissiveIntensity: 0 }));
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshBasicMaterial({ color: color(this.C.ok) }));
    const sign = billboard(signCanvas(it.icon || 'web', 6), 0.8);
    const g = new THREE.Group(); g.position.set(x, 0.35, z);
    g.add(body, roof, beacon, sign);
    g.userData = { kind: site ? 'site' : 'app', id: it.id };
    parent.add(g);
    this.pickables.push(g);
    const label = this.label('w3-item', '', () => g.getWorldPosition(new THREE.Vector3()).setY(0.35 + b.h + 1.55));
    const b = { g, body, roof, beacon, sign, fac, data: it, site, acc, h: 1, target: 1, lit: 0, flash: 0, label };
    this.buildings.set(it.id, b);
  }

  // ------------------------------------------------------------------ estado
  update(state) {
    // edicion Equipo: el edificio central es «este equipo»
    if (this.hqLabel && this.hqLabel.d && forEdition('TORRE DE CONTROL') !== 'TORRE DE CONTROL' && !this.eqLabel) { this.eqLabel = true; this.hqLabel.d.innerHTML = this.hqLabel.d.innerHTML.replace('TORRE DE CONTROL', 'ESTE EQUIPO'); }
    this.state = state;
    this.drawJail(state.jail);
    // la oficina de correos, salvo en la edicion Equipo (una computadora no reparte correo)
    const mailOn = !!state.mail && forEdition('TORRE DE CONTROL') === 'TORRE DE CONTROL';
    this.post.g.visible = mailOn; this.post.label.d.style.display = mailOn ? '' : 'none';
    this.mailQueue = state.mailQueue;
    if (mailOn) this.drawPost(state.mailQueue);
    // servidor al limite: torre roja y atasco frente al portal
    const jam = !!(state.saturation && state.saturation.level === 'bad');
    if (!jam && this.jam) this.jamNext = 0;
    this.jam = jam;
    this.layout(state);
    // cuota al limite (disco, inodos o ancho de banda): una linea ambar o roja bajo el nombre del distrito
    for (const a of state.accounts) {
      const d = this.districts.get(a.id); if (!d) continue;
      const txt = a.quota ? `${a.quota.what.toUpperCase()} AL ${a.quota.pct} %` : '', bad = a.quota && a.quota.level === 'bad';
      let q = d.label.d.querySelector('.quota');
      if (txt && !q) { q = document.createElement('em'); q.className = 'quota'; d.label.d.appendChild(q); }
      if (q) { q.textContent = txt; q.style.color = bad ? '#f87171' : '#fbbf24'; q.style.display = txt ? '' : 'none'; }
      d.quota = a.quota ? (bad ? this.C.crit : this.C.warn) : null;
    }    const top = new Set([...state.apps, ...(state.sites || [])].sort((x, y) => (y.reqMin || 0) - (x.reqMin || 0)).slice(0, 5).filter(x => x.reqMin > 0).map(x => x.id));
    for (const x of [...state.apps, ...(state.sites || [])]) {
      const b = this.buildings.get(x.id);
      if (!b) continue;
      const prev = b.data.status;
      b.data = { ...x, _k: b.site ? 'site' : 'app' };
      b.target = b.site ? 0.8 + clamp(Math.sqrt(x.reqMin || 0) * 0.15, 0, 1.2) : 1.4 + clamp(Math.log2(1 + (x.mem || 0) / 40e6) * 0.9, 0, 6.5);
      b.lit = clamp(Math.sqrt(x.reqMin || 0) / 6, 0, 1);
      b.cpu = x.cpu || 0;
      b.label.d.textContent = x.name; b.star = top.has(x.id) || x.status === 'down';
      if (prev && prev !== x.status && x.status === 'down') this.float(b.g.getWorldPosition(new THREE.Vector3()).setY(b.h + 2.4), 'CAÍDO', 'crit');
    }
    this.failed = (state.keys || []).filter(k => k.state === 'failed').map(k => k.label);
    this.hq.cpu = state.system ? state.system.cpu : 0;
    this.hqLabel.d.querySelector('small').textContent = (state.keys || []).filter(k => k.state === 'active').map(k => k.label).filter(l => !['SSH', 'Cron'].includes(l)).slice(0, 4).join(' · ');
    // salud del servidor junto a su nombre
    const hl = healthLine(state), he = this.hqLabel && this.hqLabel.d.querySelector('.hl');
    if (he && hl) { he.textContent = hl.text; he.style.color = hl.color; }
    this.syncRobots(state.sessions || []);
    // silos de datos
    this.silosHot = !!(state.silos && state.silos.hot >= 0.85);
    for (const x of (state.silos && state.silos.list) || []) {
      const d = this.districts.get(x.account); if (!d || !d.silo) continue;
      d.silo.x = x;
      d.silo.target = 1.2 + clamp(Math.log2(1 + x.size / 1048576) * 0.32, 0, 4.5);
      d.silo.label.d.textContent = `${x.n} base${x.n === 1 ? '' : 's'}`;
    }
    this.buildPipes(state.silos);
  }

  syncRobots(sessions) {
    const seen = new Set(), per = {};
    for (const s of sessions) {
      const add = (id, sub, parent) => {
        seen.add(id);
        let r = this.robots.get(id);
        const acc = this.state.accounts.find(a => a.id === s.account);
        if (!r) {
          const spr = billboard(robotCanvas(acc ? acc.color : '#22d3ee', 4), sub ? 0.8 : 1.25);
          spr.userData = { kind: 'session', id: s.id };
          const halo = new THREE.Mesh(new THREE.RingGeometry(0.45, 0.6, 24), new THREE.MeshBasicMaterial({ color: color(this.C.warn), transparent: true, opacity: 0, side: THREE.DoubleSide }));
          halo.rotation.x = -Math.PI / 2;
          this.scene.add(spr, halo);
          this.pickables.push(spr);
          r = { spr, halo, sub, x: 0, z: 0, tx: 0, tz: 0, wait: 0, label: sub ? null : this.label('w3-agent', '', () => spr.position.clone().setY(spr.position.y + 1.1)) };
          const d = this.districts.get(s.account);
          const p = this.plazaPoint(d);
          r.x = r.tx = p.x; r.z = r.tz = p.z;
          this.robots.set(id, r);
        }
        r.s = s; r.parent = parent;
        return r;
      };
      per[s.account] = (per[s.account] || 0) + 1;
      const main = add(s.id, false, null);
      main.slot = per[s.account] - 1;
      if (main.label) main.label.d.innerHTML = s.waitKind ? `Agente <em>${({ question: 'TIENE UNA PREGUNTA', idle: 'TERMINÓ: LO ESPERA' }[s.waitKind] || 'ESPERA SU PERMISO')}</em>` : '';
      (s.subagents || []).slice(0, 4).forEach((sa, i) => { const r = add(s.id + '/' + (sa.id || i), true, main); r.slot = i; });
    }
    for (const [id, r] of this.robots) if (!seen.has(id)) { this.scene.remove(r.spr, r.halo); if (r.label) r.label.remove(); this.pickables = this.pickables.filter(p => p !== r.spr); this.robots.delete(id); }
  }
  plazaPoint(d) {
    if (!d) return { x: 3 + Math.random() * 2, z: 5 };
    return { x: d.plaza.x0 + Math.random() * (d.plaza.x1 - d.plaza.x0), z: d.plaza.z };
  }

  // ------------------------------------------------------------------ eventos
  onEvent(e, priv) {
    switch (e.kind) {
      case 'http': return this.visit(e);
      case 'attack': return this.invader(false);
      case 'block': return this.invader(true, priv ? e.ip : null);
      case 'login': this.sparks(new THREE.Vector3(0, 10, 0), 'ok', 14); return this.float(new THREE.Vector3(0, 12, 0), priv && e.user ? `Acceso SSH · ${e.user}` : 'Acceso SSH', 'ok');
      case 'mail': return this.letter(e.dir, e);
      case 'deploy': {
        const b = this.buildings.get(e.app);
        const T = { building: ['Desplegando', 'warn'], ready: ['Desplegado', 'ok'], error: ['Falló el despliegue', 'crit'], canceled: ['Cancelado', 'dim'] }[e.action];
        if (b && T) { const p = b.g.getWorldPosition(new THREE.Vector3()); this.float(p.clone().setY(b.h + 2.4), T[0], T[1]); this.ring(p, T[1]); if (e.action === 'ready') this.sparks(p.clone().setY(b.h + 1), 'ok', 12); }
        return;
      }
      case 'pm2': { const b = this.buildings.get(e.app); if (b && e.action !== 'down') { const p = b.g.getWorldPosition(new THREE.Vector3()); this.float(p.clone().setY(b.h + 2.4), 'Reinicio', 'warn'); this.ring(p, 'warn'); } return; }
      case 'domain': { const d = this.districts.get(e.account); if (d) { this.float(d.center.clone().setY(3), ({ added: 'Nuevo dominio', removed: 'Dominio eliminado', changed: 'Un sitio cambió' }[e.action] || '') + (priv && e.domain ? ` · ${e.domain}` : ''), e.action === 'removed' ? 'crit' : 'ok'); this.ring(d.center, e.action === 'removed' ? 'crit' : 'ok', 2); } return; }
      case 'claude': {
        const r = this.robots.get(e.sid) || [...this.robots.entries()].find(([k]) => e.sid && k.startsWith(e.sid))?.[1];
        if (!r) return;
        const p = r.spr.position.clone();
        if (e.action === 'permission') { this.attention(p, 2.6); this.float(p.clone().setY(p.y + 1.8), ({ question: 'Tengo una pregunta', idle: 'Listo. ¿Qué sigue?' }[e.waitKind] || '¿Me da permiso?'), e.waitKind === 'idle' ? 'ok' : 'warn'); }
        else if (e.action === 'done') { this.sparks(p.clone().setY(p.y + 0.8), 'ok', 10); this.float(p.clone().setY(p.y + 1.8), 'Listo', 'ok'); }
        else if (e.action === 'prompt') this.float(p.clone().setY(p.y + 1.8), priv && e.text ? e.text.slice(0, 60) : 'Nueva instrucción', 'accent');
        else if (e.action === 'error') this.sparks(p.clone().setY(p.y + 0.8), 'crit', 8);
        return;
      }
    }
  }

  // visita: del portal a la torre, por la calle al distrito y a su edificio
  visit(e) {
    if (this.fx.length > 220) return;
    const b = this.buildings.get(e.app || e.site);
    const d = b ? this.districts.get(b.acc.id) : this.districts.get(e.account);
    const pts = [this.gatePos.clone(), new THREE.Vector3(0, 10.5, 0)];
    if (d) pts.push(new THREE.Vector3(d.x * 0.55, 3, d.z * 0.55), d.center.clone().setY(1.2));
    if (b) pts.push(b.g.getWorldPosition(new THREE.Vector3()).setY(b.h + 0.5));
    const c = e.status >= 500 ? this.C.crit : e.status >= 400 ? this.C.warn : e.bot ? '#64748b' : '#67e8f9';
    const m = new THREE.Mesh(new THREE.SphereGeometry(e.bot ? 0.1 : 0.14, 8, 6), new THREE.MeshBasicMaterial({ color: color(c) }));
    const arrive = () => { if (b) { b.flash = e.status >= 500 ? 1 : 0.4; if (e.status >= 500) this.sparks(b.g.getWorldPosition(new THREE.Vector3()).setY(b.h + 0.6), 'crit', 8); } };
    // atasco: cada visita toma el ultimo lugar de la fila que llega a la torre, espera su turno y sigue lenta
    if (this.jam) {
      if ((this.jamQ || 0) >= 18) return; // la fila ya muestra el atasco: no crece sin fin
      const now = this.t; this.jamNext = Math.min(now + 8, Math.max(this.jamNext || 0, now) + 0.45);
      const wait = this.jamNext - now, slot = this.jamQ = (this.jamQ || 0) + 1;
      const head = pts[1].clone().lerp(this.gatePos, 0.14), spot = head.clone().lerp(this.gatePos, Math.min(17, slot - 1) * 0.035);
      const rest = new THREE.CatmullRomCurve3([head, ...pts.slice(1)]); // de la cabeza de la fila a la torre y al edificio
      let phase = 0;
      this.addFx(m, f => {
        if (phase === 0) { const k = Math.min(1, f.age / 0.8); m.position.copy(this.gatePos).lerp(spot, k); m.scale.setScalar(1.7); if (f.age >= Math.max(0.8, wait)) { phase = 1; f.go = f.age; this.jamQ = Math.max(0, this.jamQ - 1); } return true; }
        if (phase === 1) { const k = Math.min(1, (f.age - f.go) / 0.5); m.position.copy(spot).lerp(head, k); m.scale.setScalar(1.7 - 0.7 * k); if (k >= 1) { phase = 2; f.go = f.age; } return true; }
        const k = (f.age - f.go) / 6; // tres veces mas lento que lo normal
        if (k >= 1) { arrive(); return false; }
        m.position.copy(rest.getPoint(k)); return true;
      });
      return;
    }
    this.travel(m, new THREE.CatmullRomCurve3(pts), 2.2 + Math.random() * 0.6, arrive);
  }

  invader(blocked, ip) {
    const ang = Math.random() * Math.PI * 2;
    const from = new THREE.Vector3(Math.cos(ang) * 60, 12 + Math.random() * 8, Math.sin(ang) * 60);
    const hit = new THREE.Vector3(Math.cos(ang) * 5.6, 2.5, Math.sin(ang) * 5.6);
    const spr = billboard(rowsCanvas(INVADER[0].map(r => r.replace(/x/g, 'r')), { r: blocked ? '#fb7185' : '#f87171' }, 4), 1.1);
    this.travel(spr, new THREE.QuadraticBezierCurve3(from, from.clone().lerp(hit, 0.5).setY(18), hit), 3.2, () => {
      this.hq.flash = 1; this.sparks(hit, 'crit', 12, 4);
      if (blocked) this.float(hit.clone().setY(4.5), ip ? `IP bloqueada · ${ip}` : 'IP bloqueada', 'crit');
    });
  }

  // correo: sale de su distrito, pasa por la oficina y se va por el portal (ambar); entra por el portal, pasa
  // por la oficina y llega a su distrito (violeta); rebota: sale, choca antes del portal y vuelve roto a quien lo
  // envio (rojo), con el motivo. Llega en rafagas: un sobre cada 0,35 s por tipo; el resto suma al rotulo
  letter(dir, e = {}) {
    const P = this.post;
    if (!P.g.visible) return;
    P.log.push({ t: this.t, dir }); if (P.log.length > 3000) P.log.shift();
    this.drawPost(this.mailQueue);
    this.mailLast = this.mailLast || {};
    if (this.t - (this.mailLast[dir] || -9) < 0.35 || this.fx.length > 220) return;
    this.mailLast[dir] = this.t;
    const d = e.account && this.districts.get(e.account);
    const home = d ? d.center.clone().setY(1.2) : new THREE.Vector3(0, 10, 0), post = P.at.clone(), gate = this.gatePos.clone();
    const crash = post.clone().lerp(gate, 0.6);
    const legs = dir === 'in' ? [gate, post, home] : dir === 'bounce' ? [home, post, crash, post, home] : [home, post, gate];
    const spr = billboard(rowsCanvas(ENVELOPE.map(r => r.replace(/x/g, 'e')), { e: dir === 'bounce' ? '#f87171' : dir === 'in' ? '#c084fc' : '#fbbf24' }, 4), 0.7);
    const arc = (a, b) => new THREE.QuadraticBezierCurve3(a, a.clone().lerp(b, 0.5).setY(Math.max(a.y, b.y) + 2 + a.distanceTo(b) * 0.12), b);
    let leg = 0, u = 0, tag = null;
    this.addFx(spr, (f, dt) => {
      const a = legs[leg], b = legs[leg + 1];
      if (!b) { if (tag) tag.remove(); return false; }
      u += dt * 9 / Math.max(3, a.distanceTo(b));
      const k = Math.min(1, u);
      spr.position.copy(arc(a, b).getPoint(k));
      spr.material.opacity = leg === legs.length - 2 && k > 0.85 ? (1 - k) / 0.15 : 1;
      if (tag) tag.pos.copy(spr.position).setY(spr.position.y + 0.8);
      if (k >= 1) {
        leg++; u = 0;
        if (legs[leg] === post) P.env.scale.set(0.9 * 9 / 7, 0.9, 1); // la oficina «recibe» el sobre
        // rebote: al chocar se rompe (chispas) y vuelve con el motivo
        if (dir === 'bounce' && leg === 3 && !tag) {
          this.sparks(spr.position.clone(), 'crit', 10);
          spr.material.rotation = 0.5;
          tag = this.label('w3-float crit', SHORT[e.cat] || 'REBOTADO', spr.position.clone());
        }
      }
      return true;
    });
  }

  // ------------------------------------------------------------------ cuadro a cuadro
  frame(dt) {
    // al acercarse a un distrito se ven los nombres de todos sus edificios; de lejos, solo los 5 con mas visitas y los caidos
    let focus = null;
    if (this.orbit.zoom > 1.5) { let best = 1e9; for (const d of this.districts.values()) { const k = Math.hypot(d.x - this.orbit.tx, d.z - this.orbit.tz); if (k < best) { best = k; focus = d.a.id; } } }
    for (const b of this.buildings.values()) b.label.d.style.display = b.star || b.acc.id === focus ? '' : 'none';
    for (const d of this.districts.values()) if (d.silo) d.silo.label.d.style.display = d.a.id === focus ? '' : 'none';
    const blink = Math.floor(this.t * 3) % 2 === 0;
    for (const b of this.buildings.values()) {
      b.h += (b.target - b.h) * Math.min(1, dt * 2.5);
      b.body.scale.y = b.h;
      b.fac.repeat.set(1, Math.max(1, Math.round(b.h / 1.2)));
      b.roof.position.y = b.h + 0.07; b.beacon.position.y = b.h + 0.28; b.sign.position.y = b.h + 0.95;
      b.flash = Math.max(0, b.flash - dt * 2);
      b.body.material.emissiveIntensity = 0.05 + b.lit * 1.1 + b.flash * 1.5;
      b.roof.material.emissiveIntensity = b.site ? 0 : clamp((b.cpu - 30) / 60, 0, 1) * 1.5;
      const st = b.data.status;
      b.beacon.material.color.set(st === 'down' ? (blink ? this.C.crit : '#3b0a0a') : st === 'degraded' ? this.C.warn : this.C.ok);
    }
    // silos: crecen con el tamano; la tapa late con las consultas; anillos tenues por conexiones dormidas
    for (const d of this.districts.values()) {
      const o = d.silo; if (!o) continue;
      const x = o.x || {};
      o.h += (o.target - o.h) * Math.min(1, dt * 2.5);
      o.body.scale.y = o.h;
      o.bands.forEach((b, i) => { b.position.y = o.h * (i + 1) / 4; });
      o.cap.position.y = o.h; o.glow.position.y = o.h + 0.26;
      o.body.material.color.set(this.silosHot ? shade(d.a.color, 0.1).lerp(color(this.C.crit), 0.55) : shade(d.a.color, 0.1));
      const act = x.active ? clamp(0.3 + (x.busy || 0) / 60, 0, 1) : 0, p = 0.5 + 0.5 * Math.sin(this.t * 6);
      o.glow.material.opacity = act ? 0.35 + 0.45 * act * p : 0;
      o.glow.scale.setScalar(act ? 0.7 + 0.35 * p : 1);
      const sl = x.sleep >= 10 ? Math.min(3, Math.ceil(x.sleep / 12)) : 0;
      o.sleeps.forEach((m, i) => { m.material.opacity = i < sl ? 0.22 : 0; });
    }
    for (const p of this.pipes) {
      const v = p.get(), n = v ? clamp(1 + v.n, 1, 4) : 0;
      p.tube.material.opacity = v && v.n ? 0.75 : 0.45;
      p.dots.children.forEach((m, i) => { m.visible = i < n && v.n > 0; if (m.visible) m.position.copy(p.curve.getPoint((this.t * v.speed * 0.5 + i / n) % 1)); });
    }
    if (this.jail.caps.children.length) this.jail.caps.children.forEach((c, i) => { c.children[0].material.emissiveIntensity = 0.35 + 0.3 * Math.sin(this.t * 2.4 + i); });
    // torre: bandas que corren con la CPU, escudo y alarma de servicios clave
    this.hq.flash = Math.max(0, this.hq.flash - dt * 1.5);
    this.hq.bands.children.forEach((b, i) => { b.material.opacity = 0.25 + 0.6 * Math.max(0, Math.sin(this.t * (1 + (this.hq.cpu || 0) / 25) - i * 0.6)); });
    for (const d of this.districts.values()) d.edge.material.color.set(d.quota && blink ? d.quota : d.a.color);
    const hot = this.jam ? 0.5 + 0.5 * Math.sin(this.t * 5) : 0;
    this.hq.tower.material.emissive.set(this.jam ? this.C.crit : this.C.accent);
    this.hq.tower.material.emissiveIntensity = this.jam ? 0.25 + 0.45 * hot : 0.08;
    if (this.jam) this.hq.bands.children.forEach(b => b.material.color.set(this.C.crit));
    else if (this.hq.wasJam) this.hq.bands.children.forEach(b => b.material.color.set(this.C.accent));
    this.hq.wasJam = this.jam;
    const bad = this.failed && this.failed.length;
    this.hq.shield.material.opacity = 0.06 + this.hq.flash * 0.45 + (bad ? 0.08 * (blink ? 1 : 0) : 0);
    this.hq.shield.material.color.set(this.hq.flash > 0.1 ? this.C.crit : bad ? this.C.warn : this.C.accent);
    this.hq.beacon.visible = Math.floor(this.t * 1.5) % 2 === 0;
    this.gate.rotation.y += dt * 0.6;
    const pe = this.post.env; if (pe.scale.y > 0.7) { const k = Math.max(0.7, pe.scale.y - dt * 0.8); pe.scale.set(k * 9 / 7, k, 1); }
    if (this.post.g.visible && Math.floor(this.t) !== this.postSec) { this.postSec = Math.floor(this.t); this.drawPost(this.mailQueue); } // el minuto corre
    // robots: pasean por el frente de su distrito; quietos con halo si esperan
    for (const r of this.robots.values()) {
      const s = r.s, waiting = !!s.waitKind;
      if (r.sub && r.parent) { r.x = r.parent.x + (r.slot % 2 ? 0.7 : -0.7) * (1 + (r.slot >> 1) * 0.6); r.z = r.parent.z + 0.5; }
      else {
        r.wait -= dt;
        if (!waiting && r.wait <= 0) { const p = this.plazaPoint(this.districts.get(s.account)); r.tx = p.x; r.tz = p.z; r.wait = 3 + Math.random() * 4; }
        const dx = r.tx - r.x, dz = r.tz - r.z, dd = Math.hypot(dx, dz), st = 1.1 * dt;
        if (!waiting && dd > st) { r.x += dx / dd * st; r.z += dz / dd * st; }
      }
      const bob = s.state === 'working' ? Math.abs(Math.sin(this.t * 8)) * 0.08 : 0;
      r.spr.position.set(r.x, 0.35 + (r.sub ? 0.4 : 0.62) + bob, r.z);
      r.spr.material.opacity = s.state === 'idle' ? 0.6 : 1;
      r.halo.position.set(r.x, 0.4, r.z);
      r.halo.material.opacity = waiting && !r.sub ? 0.5 + 0.5 * Math.sin(this.t * 6) : 0;
    }
    // seleccion
    const sel = this.selected, sb = sel && this.buildings.get(sel.id);
    if (sb && !this.selRing) { this.selRing = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.2, 40), new THREE.MeshBasicMaterial({ color: color(this.C.accent), side: THREE.DoubleSide, transparent: true })); this.selRing.rotation.x = -Math.PI / 2; this.scene.add(this.selRing); }
    if (this.selRing) { this.selRing.visible = !!sb; if (sb) { this.selRing.position.copy(sb.g.getWorldPosition(new THREE.Vector3())).setY(0.4); this.selRing.scale.setScalar(1 + 0.08 * Math.sin(this.t * 5)); } }
  }

  // ------------------------------------------------------------------ camara, avisos y enfoque
  shots() { return [...this.districts.values()].map(d => ({ x: d.x, z: d.z, zoom: clamp(46 / (Math.max(d.w, d.dd) + 8), 1.6, 3.2) })); }
  locate(kind, id) {
    if (kind === 'app' || kind === 'site') { const b = this.buildings.get(id); if (b) { const p = b.g.getWorldPosition(new THREE.Vector3()); return { x: p.x, y: b.h / 2, z: p.z, zoom: 3.6 }; } }
    if (kind === 'session') { const r = this.robots.get(id); if (r) return { x: r.x, z: r.z, zoom: 3.8 }; }
    if (kind === 'district') { const d = this.districts.get(id); if (d) return { x: d.x, z: d.z, zoom: clamp(46 / (Math.max(d.w, d.dd) + 8), 1.6, 3.2) }; }
    if (kind === 'system' || kind === 'security') return { x: 0, y: 4, z: 0, zoom: 2.2 };
    if (kind === 'jail') return { x: JAIL.x, y: 1, z: JAIL.z, zoom: 3.4 };
    if (kind === 'mail') return { x: POST.x, y: 1, z: POST.z, zoom: 3.4 };
    if (kind === 'databases') { const d = this.districts.get(id); if (d && d.silo) { const p = d.silo.g.getWorldPosition(new THREE.Vector3()); return { x: p.x, y: d.silo.h / 2, z: p.z, zoom: 3.6 }; } }
    return null;
  }
  // la capa de efectos (patrullas, escolta a la carcel, sondeos) pregunta donde estan la carcel, el portal y la torre
  screenOf(kind, id) {
    if (kind === 'jail') return this.jail.g.visible ? this.screenAt(this.jail.pos) : null;
    if (kind === 'mail') return this.post.g.visible ? this.screenAt(this.post.at) : null;
    if (kind === 'gate') return this.screenAt(this.gatePos);
    if (kind === 'tower') return this.screenAt(new THREE.Vector3(0, 9.5, 0));
    return super.screenOf(kind, id);
  }
  tipFor(u) {
    if (u.kind === 'app' || u.kind === 'site') {
      const b = this.buildings.get(u.id); if (!b) return null;
      const a = b.data;
      return { title: a.name, body: `${a.kind && a.kind !== a.name ? `<b>${esc(a.kind)}</b> · ` : ''}${b.site ? 'sitio (edificio bajo)' : 'servicio'} · ${esc(b.acc.label)}`,
        meta: `${{ online: 'en línea', degraded: 'parcial', down: 'CAÍDO' }[a.status] || a.status}${!b.site ? ` · CPU ${(a.cpu || 0).toFixed(1)}% · RAM ${fmtBytes(a.mem || 0)}` : ''} · ${a.reqMin || 0} visitas/min`, hint: 'Clic para ver el detalle' };
    }
    if (u.kind === 'session') { const r = this.robots.get(u.id); return r && { title: 'Robot · agente de Claude Code', body: esc(r.s.activity || ''), meta: r.s.waitKind ? 'Espera su permiso o su respuesta' : { working: 'Trabajando', thinking: 'Pensando', idle: 'En pausa' }[r.s.state] || '', hint: 'Clic para ver la línea de tiempo' }; }
    if (u.kind === 'district') { const d = this.districts.get(u.id); return d && { title: d.a.label, body: 'Un distrito: una cuenta con sus servicios (edificios) y sitios (edificios bajos). Sus robots caminan por el frente.', meta: d.caption, hint: 'Clic para ver el distrito' }; }
    if (u.kind === 'jail') { const j = this.jail; return { title: 'Cárcel', body: `Las IPs <b>bloqueadas</b>: las que se bloquearon a mano en el firewall y las que bloqueó la defensa de Atalaya. Las patrullas traen aquí a cada una.${j.qn ? ' Las <b>cápsulas</b> verdes son archivos PHP maliciosos en cuarentena: ya no pueden ejecutarse.' : ''}`, meta: `${Math.max(0, j.n)} preso(s)${j.qn ? ` · ${j.qn} archivo(s) en cuarentena` : ''}`, hint: 'Clic para ver cada una' }; }
    if (u.kind === 'mail') return { title: 'Oficina de correos', body: 'Por aquí pasa el correo del servidor: <b>ámbar</b> sale de una cuenta hacia internet, <b>violeta</b> entra y va a su cuenta, <b>rojo</b> rebotó y vuelve roto a quien lo envió. La pila de sobres es la cola de correo esperando salir.', meta: this.postLine(), hint: 'Clic para ver el correo' };
    if (u.kind === 'databases') {
      const d = this.districts.get(u.id), x = d && d.silo && d.silo.x; if (!x) return null;
      const mb = v => v > 1073741824 ? (v / 1073741824).toFixed(1) + ' GB' : Math.round(v / 1048576) + ' MB';
      return { title: 'Bases de datos', body: `${x.n} base${x.n === 1 ? '' : 's'} MySQL de esta cuenta, ${mb(x.size)}. ${x.conns ? `<b>${x.conns}</b> conexión(es) abierta(s)${x.active ? `, <b>${x.active}</b> con consultas en curso` : ''}${x.sleep >= 10 ? `, <b>${x.sleep} dormidas</b> (anillos tenues)` : ''}.` : 'Sin conexiones ahora.'} Las tuberías van a los sitios que las usan; los pulsos son consultas en curso.`,
        meta: x.busy ? `ocupada el ${x.busy}% de los últimos 15 min` : '', hint: 'Clic para ver sus bases' };
    }
    if (u.kind === 'system') return { title: 'Torre de control', body: 'El <b>servidor</b>: recibe todas las visitas y las reparte por las calles. Su escudo se enciende cuando repele un ataque.', meta: this.state?.system ? `CPU ${this.state.system.cpu.toFixed(0)}% · RAM ${this.state.system.mem.pct.toFixed(0)}% · carga ${this.state.system.load[0].toFixed(2)}` : '', hint: 'Clic para ver el servidor completo' };
    return null;
  }
}
