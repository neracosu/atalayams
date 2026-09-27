'use strict';
// Historial reciente por entidad (servicio, agente, seguridad) para los paneles de detalle.
// Escucha el bus de eventos: los recolectores no necesitan saber que existe.
const { Ring } = require('./util');

const ring = (map, key, n) => { let r = map.get(key); if (!r) { r = new Ring(n); map.set(key, r); } return r; };

// Contadores de la ultima hora en 6 tramos de 10 min: paises, navegadores, paginas, referers, dominios
class Roll {
  constructor(slots = 6, span = 600000) { this.slots = slots; this.span = span; this.b = []; }
  // tramo de un momento (por defecto, ahora); los datos que llegan tarde caen en el tramo de su hora real
  cur(at) {
    const now = Math.floor(Date.now() / this.span), t = at ? Math.min(now, Math.floor(at / this.span)) : now;
    if (t <= now - this.slots) return null;
    let x = this.b.find(q => q.t === t);
    if (!x) { x = { t, f: {} }; this.b.push(x); this.b.sort((p, q) => p.t - q.t); while (this.b.length > this.slots) this.b.shift(); }
    return x;
  }
  add(field, key, n = 1, at) {
    if (key == null || key === '') return;
    const slot = this.cur(at);
    if (!slot) return;
    const f = slot.f;
    const m = f[field] || (f[field] = new Map());
    if (m.size > 2000 && !m.has(key)) return; // tope por tramo
    m.set(key, (m.get(key) || 0) + n);
  }
  top(field, k = 8) {
    const minT = Math.floor(Date.now() / this.span) - this.slots + 1;
    const acc = new Map();
    for (const x of this.b) if (x.t >= minT && x.f[field]) for (const [key, n] of x.f[field]) acc.set(key, (acc.get(key) || 0) + n);
    return [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, k);
  }
  total(field) { return this.top(field, 1e9).reduce((n, [, v]) => n + v, 0); }
  distinct(field) { return this.top(field, 1e9).length; }
}

class History {
  constructor(bus, host) {
    this.host = host;
    this.appHist = new Map(); // cuenta/app -> [{t, cpu, mem}] 10 min
    this.appReq = new Map(); // cuenta/app -> [{t, req, err}] intervalos de 10 s, 10 min
    this.appBucket = new Map(); // cuenta/app -> {req, err} del intervalo actual
    this.appRecent = new Map(); // cuenta/app -> ultimas peticiones
    this.appEvents = new Map(); // cuenta/app -> reinicios y caidas
    this.agentLog = new Map(); // sid o sid/agente -> linea de tiempo
    this.security = new Ring(80); // intentos, bloqueos y accesos
    this.ips = new Map(); // ip -> {n, last, users, blocked}
    this.mail = new Ring(40);
    this.errors = new Ring(60); // ultimas respuestas 5xx de cualquier sitio
    this.rolls = new Map(); // clave de entidad -> Roll
    this.visitors = new Map(); // clave de entidad -> Map(ip -> ultima vez): visitantes de los ultimos 5 min
    this.today = new Map(); // clave de entidad -> { day, n, ips:Set }: visitas y visitantes de hoy
    this.global = new Roll();
    this.logs = null; // lo asigna index.js (para los sitios)
    bus.on('ev', e => this.onEv(e));
    bus.on('tick', () => this.sample());
    setInterval(() => this.roll10(), 10000);
  }

  sample() {
    const t = Date.now();
    for (const a of this.host.apps) ring(this.appHist, a.account + '/' + a.name, 300).push({ t, cpu: Math.round(a.cpu * 10) / 10, mem: a.mem });
  }

  // la entidad recibe conteo en vivo (registro de trafico): los logs atrasados no deben volver a contarse
  liveFor(k) { return !!(this.logs && this.logs.liveOn && this.logs.liveOn()); }
  visitorsNow(k, mins = 5) { const v = this.visitors.get(k); if (!v) return 0; const lim = Date.now() - mins * 60000; let n = 0; for (const [ip, t] of v) { if (t >= lim) n++; else v.delete(ip); } return n; }
  // contadores de hoy en disco: sobreviven a un reinicio de Atalaya
  persistToday(file) {
    const fs = require('fs');
    try {
      const day = new Date().toDateString();
      for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) if (v.day === day) this.today.set(k, { day, n: v.n, ips: new Set(v.ips) });
    } catch { }
    setInterval(() => {
      const out = {};
      for (const [k, v] of this.today) out[k] = { day: v.day, n: v.n, ips: [...v.ips].slice(-5000) };
      try { fs.writeFileSync(file + '.tmp', JSON.stringify(out), { mode: 0o600 }); fs.renameSync(file + '.tmp', file); } catch { }
    }, 60000).unref();
  }
  todayOf(k) { const d = this.today.get(k); return d && d.day === new Date().toDateString() ? { visits: d.n, visitors: d.ips.size } : { visits: 0, visitors: 0 }; }
  roll(key) { let r = this.rolls.get(key); if (!r) { r = new Roll(); this.rolls.set(key, r); } return r; }

  roll10() {
    const t = Date.now();
    const keys = [...this.host.apps.map(a => a.account + '/' + a.name), ...((this.logs && this.logs.sites) || []).map(g => 'site:' + g.id)];
    for (const k of keys) {
      const b = this.appBucket.get(k) || { req: 0, err: 0 };
      ring(this.appReq, k, 60).push({ t, req: b.req, err: b.err });
    }
    this.appBucket.clear();
  }

  onEv(e) {
    const t = Date.now();
    switch (e.kind) {
      case 'http': {
        // live: del registro de trafico (cuenta, sin detalle) · late: del log del dominio, ya contada o atrasada (solo detalle)
        const ua = e.ua || {};
        const uaName = ua.bot ? ua.name : ua.name + (ua.os ? ' · ' + ua.os : '');
        const path = String(e.path || '').split('?')[0].slice(0, 80);
        const at = e.late ? e.at : undefined, counts = !e.late;
        const g = this.global;
        if (counts) { g.add('cc', e.cc || '??'); g.add('kind', ua.bot ? 'bot:' + (ua.kind || 'bot') : (ua.mobile ? 'movil' : 'escritorio')); }
        if (e.status >= 500) this.errors.push({ t: e.at || t, status: e.status, account: e.account, app: e.app, site: e.site, domain: e.domain, path: e.path, method: e.method, cc: e.cc });
        const k = e.app ? e.account + '/' + e.app : e.site ? 'site:' + e.site : null;
        if (!k) return;
        const r = this.roll(k);
        if (counts) {
          const b = this.appBucket.get(k) || { req: 0, err: 0 };
          b.req++; if (e.status >= 500) b.err++;
          this.appBucket.set(k, b);
          r.add('req', 'all'); if (ua.bot) r.add('req', 'bot');
          r.add('cc', e.cc || '??'); r.add('dom', e.domain);
          if (e.ip && !ua.bot) {
            r.add('ip', e.ip);
            const v = this.visitors.get(k) || new Map(); v.set(e.ip, t); this.visitors.set(k, v);
            if (v.size > 3000) v.delete(v.keys().next().value);
            const day = new Date().toDateString(), d = this.today.get(k);
            const cur = d && d.day === day ? d : { day, n: 0, ips: new Set() };
            cur.n++; if (cur.ips.size < 20000) cur.ips.add(e.ip); this.today.set(k, cur);
          }
        }
        if (e.status >= 500) { r.add('req', 'err', 1, at); const b = this.appBucket.get(k) || { req: 0, err: 0 }; if (e.late && Date.now() - e.at < 90000) { b.err++; this.appBucket.set(k, b); } }
        if (e.live) return; // lo demas (pagina, codigo, navegador) llega con el log del dominio
        ring(this.appRecent, k, 40).push({ t: e.at || t, method: e.method, path: e.path, status: e.status, ip: e.ip, bot: e.bot, domain: e.domain,
          cc: e.cc, country: e.country, ua: uaName, uaKind: ua.kind, mobile: ua.mobile, ref: e.ref, refHost: e.refHost, bytes: e.bytes });
        if (e.late && (!this.liveFor(k) || e.at < (this.logs.startedAt || 0))) { r.add('req', 'all', 1, at); if (ua.bot) r.add('req', 'bot', 1, at); r.add('cc', e.cc || '??', 1, at); r.add('dom', e.domain, 1, at); }
        r.add('ua', uaName, 1, at);
        if (!ua.bot) { r.add('path', path, 1, at); if (e.refHost) r.add('ref', e.refHost, 1, at); r.add('dev', ua.mobile ? 'movil' : 'escritorio', 1, at); }
        else r.add('botname', ua.name, 1, at);
        r.add('status', String(Math.floor(e.status / 100)) + 'xx', 1, at);
        return;
      }
      case 'pm2':
        ring(this.appEvents, e.account + '/' + e.app, 20).push({ t, action: e.action });
        return;
      case 'attack': case 'block': case 'login': {
        this.security.push({ t, kind: e.kind, service: e.service, ip: e.ip, user: e.user, reason: e.reason, method: e.method, cc: e.cc, country: e.country });
        if (!e.ip) return;
        const x = this.ips.get(e.ip) || { n: 0, last: 0, users: [], blocked: false, ok: 0, cc: e.cc, country: e.country };
        if (e.kind === 'login') x.ok++; else x.n++;
        x.last = t;
        if (e.kind === 'block') x.blocked = true;
        if (e.user && !x.users.includes(e.user) && x.users.length < 6) x.users.push(e.user);
        this.ips.delete(e.ip); this.ips.set(e.ip, x); // el mas reciente al final
        if (this.ips.size > 3000) this.ips.delete(this.ips.keys().next().value);
        return;
      }
      case 'mail':
        this.mail.push({ t: e.at || t, dir: e.dir, from: e.from, to: e.to, account: e.account, cat: e.cat, why: e.why, code: e.code, reason: e.reason });
        return;
      case 'claude': {
        const k = e.agent ? e.sid + '/' + e.agent : e.sid;
        ring(this.agentLog, k, 40).push({ t, action: e.action, tool: e.tool, station: e.station, detail: e.detail, text: e.text, waitKind: e.waitKind });
        if (e.action === 'end') { this.agentLog.delete(k); }
        return;
      }
    }
  }

  topIps(n = 8) {
    return [...this.ips.entries()].filter(([, x]) => x.n > 0).sort((a, b) => b[1].n - a[1].n).slice(0, n);
  }
}

module.exports = { History };
