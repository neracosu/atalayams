// Escena del inicio: una Atalaya en miniatura (simulada). Pixel art para edificios, carteles, robot e invasores;
// textos nitidos a resolucion completa (la mezcla de la Ciudad clasica). Se detiene fuera de la vista.
import { SIGNS, ICON_COLORS, ROBOT_FRAMES, INVADER, ENVELOPE, paintCanvas, shade } from './pixeldata.js';

const BUILDINGS = [
  { name: 'Vercel', sign: 'box', color: '#1e293b', w: 22, h: 46 },
  { name: 'Supabase', sign: 'db', color: '#12352a', w: 20, h: 36 },
  { name: 'GitHub', sign: 'page', color: '#241b3a', w: 18, h: 52 },
  { name: 'WordPress', sign: 'wp', color: '#132a44', w: 22, h: 30 },
  { name: 'Hosting', sign: 'web', color: '#2a1f14', w: 20, h: 40 },
  { name: 'VPS', sign: 'chart', color: '#1b2540', w: 24, h: 58 },
];
const EVENTS = [
  ['Vercel', 'tienda-web desplegada en 41 s', 'ok'],
  ['Supabase', 'la base «pedidos» lleva 6 días sin uso: se pausará', 'warn'],
  ['SSH', '38 intentos bloqueados desde 3 países', 'bad'],
  ['WordPress', 'blog-ana tiene 4 plugins por actualizar', 'warn'],
  ['GitHub', 'un archivo .env quedó subido en «landing-cliente»', 'bad'],
  ['Certificado', 'api.cliente.com vence en 9 días', 'warn'],
  ['Claude Code', 'laptop-ana pide permiso para ejecutar un comando', 'warn'],
  ['Hosting', '212 visitas en la última hora, 3 errores de PHP', 'ok'],
  ['VPS', 'respaldos al día, 2 actualizaciones de seguridad', 'ok'],
  ['Dominio', 'mi-estudio.com se renueva en 23 días', 'ok'],
];

export function hero(cv, ticker) {
  const cx = cv.getContext('2d');
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const robotColors = c => ({ o: '#050814', B: c, b: shade(c, -0.35), h: shade(c, 0.45), v: '#0b1020', e: '#e0f7ff', g: '#94a3b8', a: '#fbbf24' });
  const spr = {
    signs: Object.fromEntries(BUILDINGS.map(b => [b.sign, paintCanvas(SIGNS[b.sign], ICON_COLORS, 1)])),
    walk: ROBOT_FRAMES.walk.map(f => paintCanvas(f, robotColors('#22d3ee'), 1)),
    idle: ROBOT_FRAMES.idle.map(f => paintCanvas(f, robotColors('#22d3ee'), 1)),
    inv: INVADER.map(f => paintCanvas(f, { x: '#f87171' }, 1)),
    mail: paintCanvas(ENVELOPE, { x: '#e2e8f0' }, 1),
  };
  let W = 0, H = 0, U = 3, AW = 0, AH = 150, ground = 0, dpr = 1;
  let blds = [], tower = null, stars = [];
  const packets = [], invaders = [], sparks = [], pops = [];
  const robot = { x: 0, target: 0, wait: 0, ask: 0, frame: 0 };

  function layout() {
    dpr = Math.min(2, devicePixelRatio || 1);
    W = cv.width = Math.round(cv.clientWidth * dpr);
    H = cv.height = Math.round(cv.clientHeight * dpr);
    U = Math.max(2, Math.floor(H / AH));
    AW = Math.floor(W / U);
    ground = Math.floor(H / U) - 26;
    // torre al centro, tres edificios a cada lado (en pantallas angostas, dos)
    const narrow = AW < 230;
    const list = narrow ? [BUILDINGS[0], BUILDINGS[1], BUILDINGS[3], BUILDINGS[5]] : BUILDINGS;
    const half = list.length / 2;
    tower = { x: Math.floor(AW / 2 - 13), w: 26, h: Math.min(84, ground - 34) };
    const side = Math.floor(AW / 2) - 30;
    blds = list.map((b, i) => {
      const left = i < half, k = left ? i : i - half;
      const slot = side / half;
      const x = left ? Math.floor(8 + k * slot + (slot - b.w) / 2) : Math.floor(AW / 2 + 22 + k * slot + (slot - b.w) / 2);
      const h = Math.min(b.h, ground - 30);
      const wins = [];
      for (let y = 6; y < h - 4; y += 5) for (let wx = 3; wx < b.w - 3; wx += 5) wins.push({ x: wx, y, on: Math.random() < 0.45 });
      return { ...b, x, h, wins, flash: 0, light: 'ok', lightT: 0 };
    });
    stars = Array.from({ length: Math.floor(AW / 5) }, () => ({ x: Math.random() * AW, y: Math.random() * (ground - 60), p: Math.random() * 6 }));
    robot.x = robot.target = blds[1] ? blds[1].x + blds[1].w / 2 : AW / 3;
  }

  const px = (x, y, w, h, c) => { cx.fillStyle = c; cx.fillRect(Math.round(x) * U, Math.round(y) * U, w * U, h * U); };
  const img = (c, x, y, flip = false) => {
    cx.save();
    if (flip) { cx.translate((Math.round(x) + c.width) * U, Math.round(y) * U); cx.scale(-1, 1); cx.drawImage(c, 0, 0, c.width * U, c.height * U); }
    else cx.drawImage(c, Math.round(x) * U, Math.round(y) * U, c.width * U, c.height * U);
    cx.restore();
  };
  const text = (s, x, y, { size = 12, color = '#a9b6ca', align = 'center', weight = 500 } = {}) => {
    cx.font = `${weight} ${size * dpr}px 'Space Grotesk', system-ui, sans-serif`;
    cx.textAlign = align; cx.textBaseline = 'middle'; cx.fillStyle = color;
    cx.fillText(s, x * U, y * U);
  };

  // ---- eventos de la simulacion
  function spawnPacket() {
    const b = blds[Math.floor(Math.random() * blds.length)];
    const fromLeft = Math.random() < 0.5;
    const err = Math.random() < 0.06;
    packets.push({ x: fromLeft ? -2 : AW + 2, y: ground + 4 + Math.floor(Math.random() * 5), to: b, v: (fromLeft ? 1 : -1) * (0.6 + Math.random() * 0.5), c: err ? '#f87171' : Math.random() < 0.5 ? '#22d3ee' : '#a78bfa', err });
  }
  function spawnInvader() {
    const fromLeft = Math.random() < 0.5;
    invaders.push({ x: fromLeft ? Math.random() * AW * 0.3 : AW - Math.random() * AW * 0.3, y: -10, t: 0 });
  }
  let evIdx = 0;
  function pushEvent() {
    if (!ticker) return;
    const [who, what, sev] = EVENTS[evIdx++ % EVENTS.length];
    const li = document.createElement('li');
    li.className = sev;
    li.innerHTML = `<i></i><b>${who}</b><span>${what}</span>`;
    ticker.prepend(li);
    while (ticker.children.length > 3) ticker.lastElementChild.remove();
    // el edificio del evento se marca
    const b = blds.find(x => x.name === who);
    if (b) { b.light = sev; b.lightT = 5; b.flash = 1; }
  }

  let last = 0, acc = { p: 0, i: 0, e: 0, a: 0 };
  function step(dt) {
    acc.p += dt; acc.i += dt; acc.e += dt; acc.a += dt;
    if (acc.p > 0.22) { acc.p = 0; spawnPacket(); }
    if (acc.i > 3.6) { acc.i = 0; spawnInvader(); }
    if (acc.e > 3.2) { acc.e = 0; pushEvent(); }
    for (const p of packets) {
      p.x += p.v * dt * 60;
      const door = p.to.x + p.to.w / 2;
      if ((p.v > 0 && p.x >= door) || (p.v < 0 && p.x <= door)) { p.done = true; p.to.flash = 1; if (p.err) { p.to.light = 'bad'; p.to.lightT = 1.2; } }
    }
    const top = { x: tower.x + tower.w / 2, y: ground - tower.h - 4 }, R = 34;
    for (const v of invaders) {
      v.t += dt;
      const dx = top.x - v.x, dy = top.y - v.y, d = Math.hypot(dx, dy);
      v.x += dx / d * 0.5 * dt * 60; v.y += dy / d * 0.5 * dt * 60 + Math.sin(v.t * 4) * 0.2;
      if (d < R) {
        v.done = true; tower.shield = 1;
        for (let k = 0; k < 10; k++) sparks.push({ x: v.x + 5, y: v.y + 4, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.8) * 2, life: 0.6 });
        pops.push({ x: v.x + 5, y: v.y - 4, s: 'bloqueado', life: 1.2 });
      }
    }
    for (const s of sparks) { s.x += s.vx * dt * 30; s.y += s.vy * dt * 30; s.vy += dt * 3; s.life -= dt; }
    for (const p of pops) { p.y -= dt * 6; p.life -= dt; }
    for (const b of blds) { b.flash = Math.max(0, b.flash - dt * 2); if (b.lightT > 0 && (b.lightT -= dt) <= 0) b.light = 'ok'; if (Math.random() < dt * 0.6) { const w = b.wins[Math.floor(Math.random() * b.wins.length)]; if (w) w.on = !w.on; } }
    tower.shield = Math.max(0, (tower.shield || 0) - dt * 1.5);
    // el robot (una sesion de Claude Code) va de edificio en edificio y a veces pide permiso
    robot.frame += dt * 6;
    if (robot.ask > 0) robot.ask -= dt;
    else if (robot.wait > 0) { robot.wait -= dt; if (robot.wait <= 0) robot.target = blds[Math.floor(Math.random() * blds.length)].x + 4; }
    else {
      const d = robot.target - robot.x;
      if (Math.abs(d) < 0.6) { robot.wait = 1.5 + Math.random() * 2.5; if (acc.a > 9) { acc.a = 0; robot.ask = 3; } }
      else robot.x += Math.sign(d) * Math.min(Math.abs(d), dt * 16);
    }
    for (const arr of [packets, invaders, sparks, pops]) for (let i = arr.length - 1; i >= 0; i--) if (arr[i].done || arr[i].life <= 0) arr.splice(i, 1);
  }

  function draw(t) {
    cx.imageSmoothingEnabled = false;
    // cielo
    const g = cx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#050914'); g.addColorStop(0.7, '#0b1733'); g.addColorStop(1, '#0d1a33');
    cx.fillStyle = g; cx.fillRect(0, 0, W, H);
    for (const s of stars) px(s.x, s.y, 1, 1, `rgba(207,232,255,${0.25 + 0.5 * (1 + Math.sin(t / 700 + s.p)) / 2})`);
    // luna pixel
    const mx = AW - 34, my = 12;
    for (let y = 0; y < 12; y++) for (let x = 0; x < 12; x++) { const d = Math.hypot(x - 5.5, y - 5.5); if (d < 6 && Math.hypot(x - 8, y - 4) > 4.2) px(mx + x, my + y, 1, 1, d > 4.8 ? '#cbd5e1' : '#f1f5f9'); }
    // suelo y calle
    px(0, ground, AW, 30, '#0a1222');
    px(0, ground + 2, AW, 9, '#111c33');
    for (let x = (t / 60) % 8; x < AW; x += 8) px(x, ground + 6, 3, 1, '#1e2c4a');
    // edificios
    for (const b of blds) {
      const y0 = ground - b.h;
      px(b.x, y0, b.w, b.h, b.color);
      px(b.x, y0, 1, b.h, shade(b.color, 0.12)); px(b.x + b.w - 1, y0, 1, b.h, shade(b.color, -0.3));
      px(b.x - 1, y0 - 1, b.w + 2, 1, shade(b.color, 0.25));
      for (const w of b.wins) px(b.x + w.x, y0 + w.y, 2, 2, w.on || b.flash > 0.5 ? (b.flash > 0.5 ? '#fef3c7' : '#fbbf24') : '#0b1224');
      px(b.x + Math.floor(b.w / 2) - 2, ground - 5, 4, 5, '#050814');
      // cartel pixel y luz de estado
      img(spr.signs[b.sign], b.x + Math.floor(b.w / 2) - 5, y0 - 13);
      const lc = { ok: '#4ade80', warn: '#fbbf24', bad: '#f87171' }[b.light];
      px(b.x + b.w - 3, y0 - 3, 2, 2, lc);
      text(b.name, b.x + b.w / 2, ground + 18, { size: 11, color: '#8fa0bb' });
    }
    // torre de control con su escudo
    const ty = ground - tower.h;
    px(tower.x, ty, tower.w, tower.h, '#0f1a30');
    px(tower.x + 2, ty, 2, tower.h, '#1a2a4a'); px(tower.x + tower.w - 3, ty, 2, tower.h, '#08101f');
    px(tower.x - 3, ty - 4, tower.w + 6, 4, '#1e2d4f');
    for (let y = ty + 6; y < ground - 8; y += 6) for (let x = tower.x + 6; x < tower.x + tower.w - 5; x += 5) px(x, y, 2, 3, Math.sin(t / 500 + x + y) > 0.2 ? '#22d3ee' : '#0e3b4a');
    px(tower.x + tower.w / 2 - 1, ty - 12, 2, 8, '#94a3b8');
    px(tower.x + tower.w / 2 - 1, ty - 13, 2, 2, Math.sin(t / 300) > 0 ? '#f87171' : '#7f1d1d');
    const sh = tower.shield || 0;
    cx.strokeStyle = `rgba(34,211,238,${0.18 + sh * 0.6})`; cx.lineWidth = U * (1 + sh);
    cx.beginPath(); cx.arc((tower.x + tower.w / 2) * U, (ty - 4) * U, 34 * U, Math.PI * 1.05, Math.PI * 1.95); cx.stroke();
    text('Torre de control', tower.x + tower.w / 2, ground + 18, { size: 11, color: '#cfe8ff', weight: 600 });
    // visitas, invasores, chispas
    for (const p of packets) px(p.x, p.y, 2, 2, p.c);
    for (const v of invaders) img(spr.inv[Math.floor(v.t * 3) % 2], v.x, v.y);
    for (const s of sparks) px(s.x, s.y, 1, 1, `rgba(251,191,36,${Math.max(0, s.life / 0.6)})`);
    for (const p of pops) text(p.s, p.x, p.y, { size: 10, color: `rgba(252,165,165,${Math.max(0, p.life)})` });
    // robot
    const moving = robot.ask <= 0 && robot.wait <= 0;
    const fr = (moving ? spr.walk : spr.idle)[Math.floor(robot.frame) % 2];
    const ry = ground - 17 + 3;
    if (robot.ask > 0) {
      cx.strokeStyle = `rgba(251,191,36,${0.5 + 0.4 * Math.sin(t / 150)})`; cx.lineWidth = U;
      cx.beginPath(); cx.ellipse((robot.x + 7) * U, (ry + 16) * U, 10 * U, 3 * U, 0, 0, Math.PI * 2); cx.stroke();
      const bx = robot.x + 7, by = ry - 9;
      cx.fillStyle = '#fbbf24'; cx.fillRect((bx - 22) * U, (by - 5) * U, 44 * U, 10 * U);
      text('¿Me da permiso?', bx, by, { size: 10, color: '#1a1204', weight: 700 });
    }
    img(fr, robot.x, ry, robot.target < robot.x);
    img(spr.mail, AW - 14 - ((t / 40) % (AW + 20)), 30 + Math.sin(t / 400) * 3);
  }

  let raf = 0, visible = true;
  function loop(t) {
    const dt = Math.min(0.05, (t - (last || t)) / 1000);
    last = t;
    step(dt);
    draw(t);
    raf = visible && !document.hidden ? requestAnimationFrame(loop) : 0;
  }
  const resume = () => { if (!raf && visible && !document.hidden && !still) { last = 0; raf = requestAnimationFrame(loop); } };
  new IntersectionObserver(es => { visible = es[0].isIntersecting; resume(); }).observe(cv);
  document.addEventListener('visibilitychange', resume);
  new ResizeObserver(() => { layout(); if (still) draw(0); }).observe(cv);
  layout();
  for (let i = 0; i < 3; i++) pushEvent();
  if (still) { for (let i = 0; i < 40; i++) spawnPacket(); for (const p of packets) p.x = Math.random() * AW; draw(0); } else resume();
}
