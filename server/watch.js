'use strict';
// Vigilancia: sitios o apps que hoy reciben algo fuera de lo normal, para que la pantalla lo haga notar.
// Motivos, del mas grave al menos (no significan lo mismo):
//  - exposed:    una ruta sensible respondio con su contenido (verificado): alguien encontro algo
//  - bruteforce: una IP con muchos intentos de login (POST a wp-login, xmlrpc, /login) en 10 min
//  - scraping:   una sola IP con cientos de pedidos en 5 min (disfrazada o no de navegador)
//  - multi:      la misma IP sondeando varios sitios del servidor a la vez
//  - scan:       muchos sondeos a rutas sensibles (.env, phpinfo, wp-login...) en 15 min
//  - surge:    las visitas se multiplican frente a lo normal del sitio y llegan de muchas IPs: puede ser que
//              se hizo viral o un ataque distribuido; la ficha muestra de donde viene
// Un sitio entra en vigilancia al pasar el umbral y sale 10 min despues de volver a la calma. Se ignora el
// trafico de la propia pantalla de Atalaya (su direccion publica) y los buscadores conocidos.
const MIN = 60000;
const { internal } = require('./blocksafe');
const T = { scanN: 25, scanWin: 15 * MIN, scrapeN: 150, scrapeWin: 5 * MIN, surgeMin: 60, surgeX: 5, surgeIps: 15, calm: 10 * MIN,
  bruteN: 20, bruteWin: 10 * MIN, multiSites: 3, multiWin: 15 * MIN, exposedWin: 24 * 60 * MIN };
const LOGIN_RE = /\/(wp-login\.php|xmlrpc\.php)|\/(login|signin|log-in|user\/login|admin\/login|administrator)\/?(\?|$)/i;
const GOOD_BOTS = /googlebot|bingbot|applebot|duckduckbot|yandexbot|baiduspider|facebookexternalhit|slurp/i;

class Watch {
  constructor(cfg, bus, webdef, opts = {}) {
    this.cfg = cfg; this.bus = bus; this.webdef = webdef;
    this.T = { ...T, ...(opts.thresholds || {}) };
    this.keys = new Map(); // clave -> { account, app, site, domain, min: Map(minuto -> n), ips: Map(ip -> [t...]) }
    this.active = new Map(); // clave -> { reason, since, last, n, ips, share, rate, base }
    this.ignored = new Map(); // ip -> hasta cuando (bloqueadas: su trafico viejo no vuelve a disparar)
    this.own = (() => { try { return new URL(cfg.publicUrl || '').hostname; } catch { return ''; } })();
    bus.on('ev', e => { if (e.kind === 'http') this.onHttp(e); });
    if (!opts.manual) setInterval(() => this.evaluate(), 20000).unref();
  }

  keyOf(e) { return e.app ? 'app:' + e.account + '/' + e.app : e.site ? 'site:' + e.site : null; }

  onHttp(e) {
    if (e.late) return;
    if (this.own && e.domain === this.own) return;
    const k = this.keyOf(e); if (!k) return;
    const now = e.at || Date.now();
    if (e.ip && this.ignored.has(e.ip)) return;
    const inside = e.ip && internal(e.ip, e.uaRaw || e.ua); // el propio servidor o Atalaya: cuenta como visita, nunca como sospechoso
    const x = this.keys.get(k) || { account: e.account, app: e.app || null, site: e.site || null, domain: e.domain, min: new Map(), ips: new Map(), posts: new Map() };
    this.keys.set(k, x);
    const m = Math.floor(now / MIN);
    x.min.set(m, (x.min.get(m) || 0) + 1);
    const ua = typeof e.ua === 'object' && e.ua ? e.ua.name || '' : String(e.ua || '');
    if (e.ip && !inside && e.method === 'POST' && LOGIN_RE.test(String(e.path || ''))) {
      const arr = x.posts.get(e.ip) || []; arr.push(now); if (arr.length > 500) arr.shift(); x.posts.set(e.ip, arr);
    }
    if (e.ip && !inside && !(e.bot && GOOD_BOTS.test(ua))) {
      const arr = x.ips.get(e.ip) || [];
      arr.push(now); if (arr.length > 2000) arr.splice(0, arr.length - 2000);
      x.ips.set(e.ip, arr);
    }
  }

  // motivo actual de una clave (o null)
  judge(k, x, now) {
    const T = this.T;
    // escaneo: los sondeos que ya clasifica la defensa web
    const s = this.webdef && this.webdef.sites.get(k);
    const probes = s ? s.hits.filter(h => now - h.t < T.scanWin && !(h.ip && this.ignored.has(h.ip))).length : 0; // sin las IPs ya bloqueadas
    // una IP con cientos de pedidos
    let top = null, ipsRecent = 0, totalRecent = 0;
    for (const [ip, arr] of x.ips) {
      while (arr.length && now - arr[0] > T.scrapeWin) arr.shift();
      if (!arr.length) { x.ips.delete(ip); continue; }
      ipsRecent++; totalRecent += arr.length;
      if (!top || arr.length > top.n) top = { ip, n: arr.length };
    }
    // pico: ultimos 2 min contra la mediana de la hora anterior (sin los ultimos 5)
    const cur = Math.floor(now / MIN);
    for (const m of x.min.keys()) if (m < cur - 70) x.min.delete(m);
    const rate = ((x.min.get(cur) || 0) + (x.min.get(cur - 1) || 0)) / 2;
    const prev = []; for (let m = cur - 65; m < cur - 5; m++) prev.push(x.min.get(m) || 0);
    prev.sort((a, b) => a - b);
    const base = prev[Math.floor(prev.length / 2)] || 0;
    const info = { probes, top, ips: ipsRecent, rate: Math.round(rate), base, share: totalRecent ? top.n / totalRecent : 0 };
    // expuesto: la defensa web verifico que una ruta sensible responde con su contenido
    const exp = this.webdef && this.webdef.exposed ? [...this.webdef.exposed.values()].filter(e => e.verdict === 'exposed' && now - (e.last || 0) < T.exposedWin
      && (e.app ? 'app:' + e.account + '/' + e.app : 'site:' + e.site) === k) : [];
    if (exp.length) { const last = exp.sort((a, b) => b.last - a.last)[0]; return { reason: 'exposed', n: exp.length, ...info, top: last.ip ? { ip: last.ip, n: last.n } : top, path: last.path }; }
    // fuerza bruta: una IP con muchos POST al login
    let brute = null;
    for (const [ip, arr] of x.posts) {
      while (arr.length && now - arr[0] > T.bruteWin) arr.shift();
      if (!arr.length) { x.posts.delete(ip); continue; }
      if (!brute || arr.length > brute.n) brute = { ip, n: arr.length };
    }
    if (brute && brute.n >= T.bruteN) return { reason: 'bruteforce', n: brute.n, ...info, top: brute };
    if (top && top.n >= T.scrapeN) return { reason: 'scraping', n: top.n, ...info };
    // la misma IP en varios sitios (calculado para todo el servidor en evaluate)
    const m = this.multi && this.multi.get(k);
    if (m) return { reason: 'multi', n: m.sites, ...info, top: { ip: m.ip, n: m.n } };
    if (probes >= T.scanN) {
      let prober = null;
      for (const [ip, v] of (s && s.ips) || []) if (now - (v.t || 0) < T.scanWin && !internal(ip) && (!prober || v.n > prober.n)) prober = { ip, n: v.n };
      return { reason: 'scan', n: probes, ...info, top: prober };
    }
    if (rate >= T.surgeMin && rate >= T.surgeX * Math.max(base, 1) && ipsRecent >= T.surgeIps) return { reason: 'surge', n: Math.round(rate), ...info };
    return null;
  }

  // IPs que sondean varios sitios a la vez: ip -> claves de los sitios que toco en la ventana
  multiMap(now) {
    const by = new Map(), out = new Map();
    if (!this.webdef) return out;
    for (const [k, s] of this.webdef.sites || []) for (const [ip, v] of s.ips || []) {
      if (now - (v.t || 0) > this.T.multiWin || this.ignored.has(ip) || internal(ip)) continue;
      if (!by.has(ip)) by.set(ip, []); by.get(ip).push(k);
    }
    for (const [ip, keys] of by) if (keys.length >= this.T.multiSites) for (const k of keys) {
      const cur = out.get(k);
      if (!cur || keys.length > cur.sites) out.set(k, { ip, sites: keys.length, n: keys.length });
    }
    return out;
  }

  // una IP bloqueada: su trafico viejo deja de contar y lo que disparo se da por resuelto
  ignore(ip, ms = 24 * 60 * MIN) {
    this.ignored.set(ip, Date.now() + ms);
    for (const x of this.keys.values()) { x.ips.delete(ip); x.posts.delete(ip); }
  }
  resolve(k) {
    const a = this.active.get(k);
    if (!a) return;
    this.active.delete(k);
    this.bus.emit('ev', { kind: 'watch', action: 'end', reason: a.reason, resolved: true, account: a.account, app: a.app, site: a.site, domain: a.domain });
  }

  evaluate(now = Date.now()) {
    for (const [ip, until] of this.ignored) if (until < now) this.ignored.delete(ip);
    this.multi = this.multiMap(now);
    // las sitios con motivos que no pasan por el trafico propio (expuesto, varios sitios) tambien se evaluan
    if (this.webdef) for (const [k, s] of this.webdef.sites || []) if (!this.keys.has(k) && (this.multi.has(k) || [...(this.webdef.exposed ? this.webdef.exposed.values() : [])].some(e => e.verdict === 'exposed' && (e.app ? 'app:' + e.account + '/' + e.app : 'site:' + e.site) === k)))
      this.keys.set(k, { account: s.account, app: s.app, site: s.site, domain: s.domain, min: new Map(), ips: new Map(), posts: new Map() });
    for (const [k, x] of this.keys) {
      const j = this.judge(k, x, now);
      const a = this.active.get(k);
      if (j) {
        if (!a || a.reason !== j.reason) {
          this.active.set(k, { ...j, key: k, account: x.account, app: x.app, site: x.site, domain: x.domain, since: now, last: now });
          console.log(`[vigilancia] ${x.domain || k}: ${j.reason} (${j.n})`);
          this.bus.emit('ev', { kind: 'watch', action: 'start', reason: j.reason, n: j.n, ips: j.ips, account: x.account, app: x.app, site: x.site, domain: x.domain, ip: j.top ? j.top.ip : null, path: j.path || null });
        } else Object.assign(a, j, { last: now, n: Math.max(a.n, j.n) });
      } else if (a && now - a.last > this.T.calm) {
        this.active.delete(k);
        this.bus.emit('ev', { kind: 'watch', action: 'end', reason: a.reason, account: x.account, app: x.app, site: x.site, domain: x.domain });
      }
      if (!x.min.size && !x.ips.size && !this.active.has(k)) this.keys.delete(k);
    }
  }

  of(k) {
    const a = this.active.get(k);
    return a ? { reason: a.reason, n: a.n, ips: a.ips, rate: a.rate, base: a.base, since: a.since, share: Math.round(a.share * 100), topIp: a.top ? a.top.ip : null, path: a.path || null } : null;
  }
  list() { return [...this.active.values()]; }
}

module.exports = { Watch, THRESHOLDS: T };
