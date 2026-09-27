// Tema "Terminal": una consola de fosforo verde de los 80, con ventanas de texto como tmux. Todo es texto real
// (nitido y seleccionable); el pixel art queda en los carteles de cada linea.
//  - root@atalaya es el servidor: barras ASCII de CPU, memoria, disco y carga, y sus servicios clave como un
//    arranque de systemd ([  OK  ] / [ FALLO ])
//  - cada cuenta es una VENTANA con una linea por servicio o sitio: nombre, barra de CPU al estilo htop,
//    grafica de visitas con caracteres y su estado; cada proyecto se lee sin hacer clic
//  - cada visita hace parpadear su linea y corre por el tail -f del access.log (gris si es un robot; rojo si es 5xx)
//  - cada intento de acceso aparece en el registro de sshd; si la IP cae, BLOQUEADA
//  - cada sesion de Claude Code es un proceso con cursor parpadeante; si espera su permiso pregunta [s/N]
// Regla de oro: solo texto; el color significa estado (verde bien, ambar a medias, rojo caido).
import { signCanvas } from '../../js/sprites.js';
import { groupsOf, layoutKeyOf, iconURL } from '../../js/layout.js';
import { esc, fmtBytes } from '../../js/hud.js';
import { accountCaption } from '../../js/accounts.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const SPARK = '.:-=+*#@'; // grafica de visitas con caracteres ASCII (de poco a mucho)
const bar = (v, n = 10) => { const k = Math.round(clamp(v, 0, 1) * n); return '[' + '|'.repeat(k) + ' '.repeat(n - k) + ']'; };
const pad = (s, n) => { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length); };
const lpad = (s, n) => { s = String(s); return s.length >= n ? s : ' '.repeat(n - s.length) + s; };
const now = () => new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

export default class TerminalWorld {
  constructor(el) {
    this.el = el;
    this.rows = new Map(); this.panes = new Map(); this.hist = new Map();
    this.directorOn = true; this.insets = { top: 0, right: 0, bottom: 0, left: 0 };
    this.zoom = 1; this.layoutKey = ''; this.t = 0;
  }

  async init() {
    this.ac = new AbortController();
    const sig = { signal: this.ac.signal };
    await document.fonts.load("20px 'VT323'").catch(() => { });
    this.root = Object.assign(document.createElement('div'), { className: 'term' });
    this.root.innerHTML = '<div class="term-grid"></div>';
    this.el.appendChild(this.root);
    this.grid = this.root.firstChild;
    // registros vivos: servidor, access.log y sshd
    this.sys = this.pane('sys', 'root@atalaya', 'servidor', 'system:root');
    this.access = this.pane('log', 'tail -f access.log', 'visitas en vivo', null);
    this.sshd = this.pane('sec', 'journalctl -fu sshd', 'defensa', 'security:all');
    this.accessLines = []; this.sshdLines = [];
    // clics, avisos al pasar el mouse
    this.root.addEventListener('click', e => { const g = e.target.closest('[data-go]'); if (g) { const [k, ...r] = g.dataset.go.split(':'); this.pick(k, r.join(':')); } }, sig);
    this.root.addEventListener('mouseover', e => { const r = e.target.closest('[data-tip]'); if (r && this.onTip) this.onTip(this.tipFor(r.dataset.tip), e.clientX, e.clientY); }, sig);
    this.root.addEventListener('mouseout', e => { if (e.target.closest('[data-tip]') && this.onTip) this.onTip(null); }, sig);
    this.root.addEventListener('wheel', e => { if (!e.ctrlKey) return; e.preventDefault(); this.zoomBy(Math.exp(-e.deltaY * 0.002)); }, { passive: false, signal: sig.signal });
    this.root.addEventListener('dblclick', () => this.resetView(), sig);
    window.addEventListener('resize', () => this.fitSoon(), sig);
    this.timer = setInterval(() => this.tick(), 250);
    this.place();
  }
  // donde esta cada cosa en la pantalla (comunicacion entre agentes): la linea del proyecto o el proceso claude
  screenOf(kind, id) {
    const el = kind === 'session' || kind === 'agent' ? this.root.querySelector(`[data-go="session:${CSS.escape(String(id).split('/')[0])}"]`) : this.rows.get(id)?.line;
    if (!el || !el.offsetParent) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + Math.min(r.width, 160), y: r.top + r.height / 2 };
  }

  destroy() { this.ac.abort(); clearInterval(this.timer); this.root.remove(); }

  // una ventana: barra de titulo con caracteres de caja y un cuerpo de lineas
  pane(id, title, sub, go) {
    const d = document.createElement('section');
    d.className = 'term-pane'; d.dataset.pane = id;
    d.innerHTML = `<header${go ? ` data-go="${go}"` : ''}><b>${esc(title)}</b><small>${esc(sub)}</small></header><div class="term-body"></div>`;
    this.grid.appendChild(d);
    const p = { id, d, body: d.lastChild, head: d.firstChild };
    this.panes.set(id, p);
    return p;
  }

  setInsets(ins) { this.insets = ins; this.place(); }
  place() {
    if (!this.root) return;
    const i = this.insets;
    Object.assign(this.root.style, { left: i.left + 'px', top: i.top + 'px', right: i.right + 'px', bottom: i.bottom + 'px' });
    this.fitSoon();
  }
  // la letra se ajusta para que todas las ventanas quepan en el area libre (y el zoom la agranda)
  fitSoon() { cancelAnimationFrame(this.fitRaf); this.fitRaf = requestAnimationFrame(() => this.fit()); }
  fit() {
    if (!this.root) return;
    let lo = 9, hi = 30;
    for (let k = 0; k < 9; k++) {
      const mid = (lo + hi) / 2;
      this.root.style.fontSize = mid + 'px';
      if (this.grid.scrollHeight <= this.root.clientHeight + 1 && this.grid.scrollWidth <= this.root.clientWidth + 1 && !this.overflowing()) lo = mid; else hi = mid;
    }
    this.baseFont = lo;
    this.root.style.fontSize = (lo * this.zoom).toFixed(2) + 'px';
    this.root.classList.toggle('zoomed', this.zoom > 1.01);
  }

  // alguna linea mas ancha que su ventana?
  overflowing() { for (const p of this.panes.values()) if (p.body.scrollWidth > p.body.clientWidth + 1) return true; return false; }

  // ------------------------------------------------------------------ estado
  update(state) {
    this.state = state;
    const key = layoutKeyOf(state);
    if (key !== this.layoutKey) { this.layoutKey = key; this.build(state); }
    for (const x of [...state.apps, ...(state.sites || [])]) {
      const r = this.rows.get(x.id);
      if (!r) continue;
      const h = this.hist.get(x.id) || [];
      h.push(x.reqMin || 0); if (h.length > 12) h.shift();
      this.hist.set(x.id, h);
      r.data = { ...x, _k: r.data._k };
      this.renderRow(r);
    }
    this.renderSys(state);
    this.renderSessions(state.sessions || []);
    this.fitSoon();
  }

  build(state) {
    for (const [id, p] of this.panes) if (!['sys', 'log', 'sec'].includes(id)) { p.d.remove(); this.panes.delete(id); }
    this.rows.clear();
    for (const G of groupsOf(state)) {
      const nA = G.items.filter(x => x._k === 'app').length;
      const p = this.pane('acc:' + G.a.id, G.a.label, accountCaption(G.a, nA, G.items.length - nA), 'district:' + G.a.id);
      p.d.style.setProperty('--acc', G.a.color);
      p.a = G.a;
      p.body.innerHTML = '';
      for (const it of G.items) {
        const line = document.createElement('div');
        const kind = it._k === 'site' ? 'site' : 'app';
        line.className = 'term-row'; line.dataset.go = kind + ':' + it.id; line.dataset.tip = kind + ':' + it.id;
        line.innerHTML = `<img alt="" src="${iconURL('sign:' + (it.icon || 'web'), () => signCanvas(it.icon || 'web', 2))}"><span class="n"></span><span class="b"></span><span class="s"></span><span class="st"></span>`;
        p.body.appendChild(line);
        const r = { line, data: it, pane: p, n: line.children[1], b: line.children[2], s: line.children[3], st: line.children[4], blink: 0 };
        this.rows.set(it.id, r);
      }
      const ag = document.createElement('div'); ag.className = 'term-agents'; p.body.appendChild(ag); p.agents = ag;
      // la ventana del servidor y los registros quedan primero y al final
    }
    this.grid.appendChild(this.access.d);
    this.grid.appendChild(this.sshd.d);
    this.grid.prepend(this.sys.d);
    this.fitSoon();
  }

  renderRow(r) {
    const a = r.data, site = a._k === 'site';
    r.n.textContent = pad(a.name, 22);
    r.b.textContent = site ? pad(a.type || a.kind || 'sitio', 12) : bar((a.cpu || 0) / 100, 10);
    // escala logaritmica: 1 visita/min se ve bajo, 100 o mas se ve lleno
    const h = this.hist.get(a.id) || [];
    r.s.textContent = h.map(v => v ? SPARK[Math.min(7, Math.floor(Math.log2(v + 1)))] : ' ').join('').padStart(12, ' ') + lpad(a.reqMin || 0, 4) + '/m';
    const st = a.status;
    r.st.textContent = st === 'down' ? '[ FALLO ]' : st === 'degraded' ? '[ LENTO ]' : '[  OK   ]';
    r.line.classList.toggle('down', st === 'down');
    r.line.classList.toggle('warn', st === 'degraded');
  }

  renderSys(state) {
    const s = state.system; if (!s) return;
    const L = [];
    const row = (k, v, txt, warn) => `<div class="term-kv${warn ? ' warn' : ''}"><span>${pad(k, 8)}</span><span class="b">${bar(v, 16)}</span><span>${esc(txt)}</span></div>`;
    L.push(row('CPU', s.cpu / 100, `${lpad(s.cpu.toFixed(0), 3)}%  ${s.cores} núcleos`, s.cpu > 85));
    L.push(row('MEMORIA', s.mem.pct / 100, `${lpad(s.mem.pct.toFixed(0), 3)}%  ${fmtBytes(s.mem.used)}`, s.mem.pct > 85));
    L.push(row('DISCO', (s.disk?.pct ?? 0) / 100, `${lpad(Math.round(s.disk?.pct ?? 0), 3)}%`, (s.disk?.pct ?? 0) > 85));
    L.push(row('CARGA', clamp(s.load[0] / Math.max(1, s.cores), 0, 1), `${s.load.map(x => x.toFixed(2)).join(' ')}`, s.load[0] > s.cores));
    // salud del servidor: una linea por revision, como un chequeo de arranque
    const H = state.health || [];
    if (H.length) {
      L.push('<div class="term-sep"></div>');
      const TAG = { ok: '[  OK   ]', warn: '[ AVISO ]', bad: '[ GRAVE ]', unknown: '[   ?   ]' };
      for (const h of H) L.push(`<div class="term-unit ${h.status === 'bad' ? 'down' : h.status === 'warn' ? 'warn' : ''}"><span>${TAG[h.status] || TAG.unknown}</span> ${esc(h.title)}${h.bad + h.warn ? ` <small>${h.bad + h.warn} hallazgo${h.bad + h.warn === 1 ? '' : 's'}</small>` : ''}</div>`);
    }
    const keys = (state.keys || []).filter(k => k.state !== 'inactive');
    L.push('<div class="term-sep"></div>');
    for (const k of keys) L.push(`<div class="term-unit${k.state === 'failed' ? ' down' : ''}"><span>${k.state === 'failed' ? '[ FALLO ]' : '[  OK   ]'}</span> ${esc(k.label)}${k.unit ? ` <small>${esc(k.unit)}</small>` : ''}</div>`);
    const sec = state.security || {};
    this.sys.body.innerHTML = L.join('');
    this.sshd.head.querySelector('small').textContent = `${sec.failed ?? 0} intentos · ${sec.blocked ?? 0} IPs bloqueadas · ${sec.logins ?? 0} accesos`;
  }

  renderSessions(sessions) {
    const by = {};
    sessions.forEach((s, i) => (by[s.account] = by[s.account] || []).push({ s, n: i + 1 }));
    for (const p of this.panes.values()) {
      if (!p.agents) continue;
      const list = by[p.a.id] || [];
      p.agents.innerHTML = list.map(({ s, n }) => {
        const wait = !!s.waitKind;
        const act = s.activity ? esc(s.activity.slice(0, 44)) : { working: 'trabajando', thinking: 'pensando', idle: 'en pausa' }[s.state] || '';
        return `<div class="term-proc${wait ? ' wait' : ''}" data-go="session:${esc(s.id)}" data-tip="session:${esc(s.id)}">&gt; claude[ESC-${String(n).padStart(2, '0')}] ${wait ? '¿Permitir? [s/N] <i></i>' : `${act} <i></i>`}${(s.subagents || []).length ? ` <small>+${s.subagents.length} sub</small>` : ''}</div>`;
      }).join('');
    }
  }

  // ------------------------------------------------------------------ eventos
  onEvent(e, priv) {
    switch (e.kind) {
      case 'http': {
        const r = this.rows.get(e.app || e.site);
        if (r) r.blink = 1;
        if (this.accessQ > 6) return;
        this.accessQ = (this.accessQ || 0) + 1;
        const name = r ? r.data.name : 'sitio';
        return this.log(this.access, `${now()} ${e.status >= 500 ? '<em class="c">' : e.bot ? '<em class="d">' : '<em>'}${e.status || 200}</em> ${esc(pad(name, 24))} ${e.bot ? 'robot' : 'visita'}`, 'accessLines', 40);
      }
      case 'attack': return this.log(this.sshd, `${now()} <em class="c">Failed password</em> for invalid user`, 'sshdLines', 30);
      case 'block': return this.log(this.sshd, `${now()} <em class="c">BLOQUEADA</em> ${priv && e.ip ? esc(e.ip) : 'IP'} por cPHulk`, 'sshdLines', 30);
      case 'login': return this.log(this.sshd, `${now()} <em>Accepted publickey</em> ${priv && e.user ? 'for ' + esc(e.user) : ''}`, 'sshdLines', 30);
      case 'deploy': {
        const r = this.rows.get(e.app);
        const T = { building: ['desplegando…', 'w'], ready: ['desplegado', ''], error: ['FALLÓ el despliegue', 'c'], canceled: ['cancelado', 'd'] }[e.action];
        if (r && T) this.flash(r, T[0], T[1]);
        return;
      }
      case 'pm2': { const r = this.rows.get(e.app); if (r && e.action !== 'down') this.flash(r, 'reiniciado', 'w'); return; }
      case 'claude': {
        if (e.action === 'permission') { const s = (this.state?.sessions || []).find(x => x.id === e.sid || (e.sid && x.id.startsWith(e.sid))); if (s) this.pick('district', s.account, true); }
        return;
      }
    }
  }
  // una linea nueva arriba del registro (y se van las viejas)
  log(p, html, key, max) {
    const d = document.createElement('div'); d.className = 'term-line new'; d.innerHTML = html;
    p.body.prepend(d);
    this[key].unshift(d);
    while (this[key].length > max) this[key].pop().remove();
    setTimeout(() => d.classList.remove('new'), 600);
  }
  flash(r, text, tone) {
    const t = document.createElement('span'); t.className = 'term-note ' + tone; t.textContent = ' <- ' + text;
    r.line.appendChild(t);
    setTimeout(() => t.remove(), 5000);
  }

  // cada cuarto de segundo: parpadeos de actividad, cursor y director
  tick() {
    this.t += 0.25;
    this.accessQ = 0;
    for (const r of this.rows.values()) { r.line.classList.toggle('hit', r.blink > 0); r.blink = Math.max(0, r.blink - 0.5); }
    // director: el cursor recorre las ventanas y las resalta
    if (this.directorOn && !(this.manualUntil > this.t)) {
      if (!this.nextShot || this.t >= this.nextShot) {
        const ids = [...this.panes.keys()];
        this.shotIdx = ((this.shotIdx ?? -1) + 1) % ids.length;
        this.focusPane(ids[this.shotIdx]);
        this.nextShot = this.t + 9;
      }
    }
    if (this.manualUntil && this.manualUntil <= this.t) { this.manualUntil = 0; this.zoom = 1; this.fit(); this.navChanged(); }
    if (Math.floor(this.t) !== this.lastNav) { this.lastNav = Math.floor(this.t); this.navChanged(); }
  }
  focusPane(id) {
    for (const p of this.panes.values()) p.d.classList.toggle('focus', p.id === id);
    const p = this.panes.get(id);
    if (p && this.zoom > 1.01) p.d.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
  }

  // ------------------------------------------------------------------ navegacion
  pick(kind, id, quiet) {
    this.selected = { kind, id };
    let paneId = null, row = null;
    if (kind === 'app' || kind === 'site') { row = this.rows.get(id); paneId = row && row.pane.id; }
    else if (kind === 'district') paneId = 'acc:' + id;
    else if (kind === 'session') { const s = (this.state?.sessions || []).find(x => x.id === id); paneId = s && 'acc:' + s.account; }
    else if (kind === 'system') paneId = 'sys';
    else if (kind === 'security') paneId = 'sec';
    for (const r of this.rows.values()) r.line.classList.toggle('sel', r === row);
    if (paneId) { this.manualUntil = this.t + 90; this.focusPane(paneId); }
    if (!quiet && this.onSelect) this.onSelect(kind, id);
    this.navChanged();
  }
  clearSelection() { this.selected = null; for (const r of this.rows.values()) r.line.classList.remove('sel'); }
  setDirector(on) { this.directorOn = on; this.nextShot = 0; if (!on) for (const p of this.panes.values()) p.d.classList.remove('focus'); }
  resetView() { this.zoom = 1; this.manualUntil = 0; this.nextShot = 0; this.fit(); this.root.scrollTo({ top: 0, left: 0 }); this.navChanged(); }
  zoomBy(f) { this.zoom = clamp(this.zoom * f, 1, 3); this.manualUntil = this.t + 90; this.fit(); this.navChanged(); }
  navState() { return this.manualUntil > this.t ? { mode: 'manual', left: Math.ceil(this.manualUntil - this.t) } : { mode: this.directorOn ? 'director' : 'fixed' }; }
  navChanged() { if (this.onNav) this.onNav(this.navState()); }

  tipFor(key) {
    const [kind, ...rest] = key.split(':'), id = rest.join(':');
    if (kind === 'app' || kind === 'site') {
      const r = this.rows.get(id); if (!r) return null;
      const a = r.data;
      return { title: a.name, body: `${a.kind && a.kind !== a.name ? `<b>${esc(a.kind)}</b> · ` : ''}${kind === 'site' ? 'sitio' : 'servicio'} · ${esc(r.pane.a.label)}`,
        meta: `${{ online: 'en línea', degraded: 'parcial', down: 'CAÍDO' }[a.status] || a.status}${kind === 'app' ? ` · CPU ${(a.cpu || 0).toFixed(1)}% · RAM ${fmtBytes(a.mem || 0)}` : ''} · ${a.reqMin || 0} visitas/min`, hint: 'Clic para ver el detalle' };
    }
    if (kind === 'session') { const s = (this.state?.sessions || []).find(x => x.id === id); return s && { title: 'Proceso claude · agente de Claude Code', body: esc(s.activity || ''), meta: s.waitKind ? 'Espera su permiso o su respuesta' : { working: 'Trabajando', thinking: 'Pensando', idle: 'En pausa' }[s.state] || '', hint: 'Clic para ver la línea de tiempo' }; }
    return null;
  }
}
