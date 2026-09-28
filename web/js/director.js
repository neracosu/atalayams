// Director: la camara sigue lo que pasa en el servidor. Cada evento importante (un servicio que se cae, un
// archivo expuesto, un despliegue, una consulta lenta, una sesion nueva de Claude) se pondera; el director
// encuadra su edificio o su agente unos segundos con un rotulo que dice que pasa. Si no hay novedades,
// muestra lo que esta activo (un agente trabajando, el sitio con mas visitas); si todo esta quieto, deja al
// tema su recorrido de siempre. Funciona con cualquier tema: usa pick(kind, id) sin abrir la ficha.
import { px } from './pixicons.js';

const HOLD = 9, URGENT_HOLD = 12, QUIET = 20, FORGET = 120, STALE = 60;

export class Director {
  constructor({ getWorld, getState, caption, mark }) {
    this.getWorld = getWorld; this.getState = getState; this.cap = caption; this.mark = mark || (() => { });
    this.queue = []; this.shown = new Map(); this.cur = null; this.lastShow = 0;
    setInterval(() => this.tick(), 1000);
  }

  get on() { const w = this.getWorld(); return !!(w && w.directorOn) && document.visibilityState === 'visible'; }

  // nombres visibles (ya vienen con la privacidad aplicada en el estado)
  name(kind, id) {
    const st = this.getState(); if (!st) return '';
    if (kind === 'app') { const a = st.apps.find(x => x.id === id); return a ? a.name || a.kind : ''; }
    if (kind === 'site') { const g = st.sites.find(x => x.id === id); return g ? g.name || g.kind : ''; }
    if (kind === 'session') { const s = st.sessions.find(x => x.id === id); return s ? (s.target ? s.target.name : (st.accounts.find(a => a.id === s.account) || {}).label || '') : ''; }
    return '';
  }

  // evento -> candidato { key, kind, id, text, icon, score, urgent }
  consider(e) {
    const where = (app, site) => app ? ['app', app] : site ? ['site', site] : [null, null];
    let c = null;
    if (e.kind === 'claude') {
      if (e.action === 'start') c = { kind: 'session', id: e.sid, icon: 'bot', score: 55, text: n => `Nueva sesión de Claude${n ? ' en ' + n : ''}`, later: true };
      else if (e.action === 'permission') c = { kind: 'session', id: e.sid, icon: 'ask', score: 85, urgent: true, text: n => `Un agente espera su permiso${n ? ' · ' + n : ''}` };
      else if (e.action === 'spawn') c = { kind: 'session', id: e.sid, icon: 'bot', score: 40, text: n => `Lanzó un subagente${n ? ' · ' + n : ''}` };
      else if (e.action === 'touch' && e.mode === 'edit') { const [k, id] = where(e.app, e.site); if (k) c = { kind: k, id, icon: 'bot', score: 35, text: n => `Un agente edita ${n || 'un proyecto'}` }; }
    } else if (e.kind === 'pm2' && e.action === 'down') c = { kind: 'app', id: e.app, icon: 'fire', score: 90, urgent: true, text: () => `${e.appName || 'Una app'} se detuvo` };
    else if (e.kind === 'deploy') c = { kind: 'app', id: e.app, icon: 'rocket', score: e.action === 'error' ? 80 : 60, text: () => e.action === 'error' ? `Falló el despliegue de ${e.appName}` : e.action === 'ready' ? `${e.appName} se desplegó` : `Desplegando ${e.appName}` };
    else if (e.kind === 'probe' && e.exposed) { const [k, id] = where(e.app, e.site); if (k) c = { kind: k, id, icon: 'bad', score: 95, urgent: true, text: n => `Archivo expuesto en ${n || 'un sitio'}` }; }
    else if (e.kind === 'db' && e.action === 'slow') { const [k, id] = where(e.app, e.site); c = { kind: k || 'district', id: id || e.account, icon: 'db', score: 50, text: n => `Consulta lenta de ${e.secs} s${n ? ' en ' + n : ''}` }; }
    else if (e.kind === 'watch' && e.action === 'start') { const [k, id] = where(e.app, e.site); if (k) c = { kind: k, id, icon: 'siren', score: e.reason === 'surge' ? 75 : e.reason === 'exposed' ? 96 : 88, urgent: e.reason !== 'surge',
      text: n => ({ surge: `Pico de visitas en ${n || 'un sitio'}: ${e.n}/min`, scraping: `Una IP le hace ${e.n} pedidos a ${n || 'un sitio'}`,
        exposed: `Alguien encontró una ruta expuesta en ${n || 'un sitio'}`, bruteforce: `Fuerza bruta al login de ${n || 'un sitio'}: ${e.n} intentos`,
        multi: `La misma IP sondea ${e.n} de sus sitios`, scan: `Escaneo en ${n || 'un sitio'}: ${e.n} sondeos` }[e.reason] || `Vigilancia en ${n || 'un sitio'}`) }; }
    else if (e.kind === 'defense' && e.action === 'block') { const [k, id] = where(e.app, e.site); if (k) c = { kind: k, id, icon: 'shield', score: 80,
      text: n => `Las patrullas se llevan a la IP que atacaba ${n || 'el sitio'}${e.by === 'auto' ? ' · defensa automática' : ''}` }; }
    else if (e.kind === 'phpfile' && e.site && e.action === 'quarantine') c = { kind: 'site', id: e.site, icon: 'ok', score: 70, text: n => `Una patrulla se lleva la puerta trasera de ${n || 'un sitio'} a la cárcel` };
    else if (e.kind === 'phpfile' && e.site) c = { kind: 'site', id: e.site, icon: 'bad', score: 97, urgent: true, text: n => e.action === 'hit' ? `Alguien buscó el archivo PHP sospechoso de ${n || 'un sitio'}` : `Archivo PHP sospechoso en ${n || 'un sitio'}: posible puerta trasera` };
    else if (e.kind === 'saturation' && e.action === 'start') c = { kind: 'system', id: 'root', icon: 'fire', score: 92, urgent: true, text: () => `Servidor al límite: ${(e.causes || []).join(', ')}` };
    else if (e.kind === 'uptime' && e.action === 'down' && e.site) c = { kind: 'site', id: e.site, icon: 'siren', score: 94, urgent: true, text: n => `${n || 'Un sitio'} dejó de responder${e.why ? ': ' + e.why : ''}` };
    else if (e.kind === 'keysvc' && e.action === 'down') c = { kind: 'system', id: 'root', icon: 'siren', score: 95, urgent: true, text: () => `${e.label} falló` };
    if (!c || !c.id) return;
    c.key = e.kind + ':' + (e.action || '') + ':' + c.kind + ':' + c.id;
    c.at = Date.now();
    if (this.shown.has(c.key) && Date.now() - this.shown.get(c.key) < FORGET * 1000) return;
    this.queue = this.queue.filter(x => x.key !== c.key);
    this.queue.push(c);
    // lo urgente o mucho mas importante interrumpe lo que se esta mostrando (despues de 3 s)
    if (this.cur && c.score >= this.cur.score + 30 && Date.now() - this.cur.at0 > 3000) this.cur.until = 0;
  }

  // sin novedades: lo que esta vivo ahora
  ambient() {
    const st = this.getState(); if (!st) return null;
    const working = st.sessions.filter(s => s.state === 'working' || s.state === 'thinking').sort((a, b) => b.lastActivity - a.lastActivity)[0];
    if (working && !this.recent('amb:s:' + working.id)) return { key: 'amb:s:' + working.id, kind: 'session', id: working.id, icon: 'bot', score: 20,
      text: n => `${working.state === 'working' ? (working.activity || 'Trabajando') : 'Pensando'}${n ? ' · ' + n : ''}` };
    const busy = [...st.sites, ...st.apps].filter(x => x.reqMin >= 20).sort((a, b) => b.reqMin - a.reqMin)[0];
    if (busy && !this.recent('amb:b:' + busy.id)) { const k = st.sites.includes(busy) ? 'site' : 'app';
      return { key: 'amb:b:' + busy.id, kind: k, id: busy.id, icon: 'web', score: 15, text: n => `${busy.reqMin} visitas por minuto en ${n || 'un sitio'}` }; }
    return null;
  }
  recent(key) { return this.shown.has(key) && Date.now() - this.shown.get(key) < FORGET * 1000; }

  tick() {
    const w = this.getWorld();
    const now = Date.now();
    if (!this.on || !w || typeof w.pick !== 'function') { if (this.cur) this.stop(); return; }
    // el usuario tomo la camara (manualUntil mas lejos de lo que puso el director): se aparta
    if (this.cur && w.manualUntil && w.manualUntil - w.t > this.cur.hold + 2) { this.stop(true); return; }
    if (this.cur && now < this.cur.until) return;
    if (this.cur) this.stop();
    this.queue = this.queue.filter(c => now - c.at < STALE * 1000);
    let next = this.queue.sort((a, b) => b.score - a.score || b.at - a.at).shift();
    if (!next && now - this.lastShow > QUIET * 1000) next = this.ambient();
    if (!next) return;
    this.show(next);
  }

  show(c) {
    const w = this.getWorld();
    const hold = c.urgent ? URGENT_HOLD : HOLD;
    // pick sin abrir la ficha ni dejar la seleccion puesta
    const sel = w.onSelect, prev = w.selected;
    w.onSelect = null;
    let ok = true;
    try { w.pick(c.kind, c.id); } catch { ok = false; } finally { w.onSelect = sel; w.selected = prev; }
    if (ok && w.t != null) { w.manualUntil = w.t + hold; w.directing = true; }
    this.cur = { ...c, hold, at0: Date.now(), until: Date.now() + hold * 1000 };
    this.shown.set(c.key, Date.now()); this.lastShow = Date.now();
    for (const [k, t] of this.shown) if (Date.now() - t > FORGET * 1000) this.shown.delete(k);
    this.cap(`${px(c.icon)}<span>${escapeHtml(c.text(this.name(c.kind, c.id)))}</span>`);
    this.mark(c.kind, c.id, hold);
    if (w.navChanged) w.navChanged();
  }

  stop(byUser) {
    const w = this.getWorld();
    if (w && w.directing) { w.directing = false; if (!byUser) w.manualUntil = w.t ? Math.min(w.manualUntil || 0, w.t) : 0; }
    this.cur = null;
    this.cap(null); this.mark(null);
    if (w && w.navChanged) w.navChanged();
  }

  label() { return this.cur ? this.cur.text(this.name(this.cur.kind, this.cur.id)) : ''; }
}

const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
