'use strict';
// Defensa: la primera accion de Atalaya sobre el servidor, siempre elegida por el dueno. Bloquea una IP de forma
// TEMPORAL (nftables la suelta sola al vencer) por medio del ayudante, que vuelve a revisar que sea seguro.
//  - Manual: boton «Bloquear esta IP» en la ficha de un sitio en vigilancia.
//  - Automatica (opcional, apagada de fabrica): expuesto, fuerza bruta, scraping y la misma IP en varios sitios.
//  - Freno antes de la caida (con la automatica): si las conexiones de MySQL pasan del 85 % o la carga se
//    dispara, se bloquea a quienes estan atacando en ese momento.
// Nunca: Cloudflare, redes privadas, el propio servidor, la lista blanca ni IPs de usuarios de Atalaya.
const fs = require('fs');
const path = require('path');
const { readJSON, writeJSONAtomic } = require('./util');
const { unsafe } = require('./blocksafe');

const AUTO_REASONS = new Set(['exposed', 'bruteforce', 'scraping', 'multi', 'phpfile']);
const LABEL = { exposed: 'encontró una ruta expuesta', bruteforce: 'fuerza bruta a un login', scraping: 'scraping', multi: 'sondeaba varios sitios',
  scan: 'escaneo', saturation: 'atacaba con el servidor al límite', manual: 'bloqueo manual', phpfile: 'buscó un archivo PHP malicioso' };

// bloqueos manuales del firewall: las reglas DROP guardadas (netfilter-persistent) y, si existe, el archivo de
// notas de root con el motivo de cada una (las lineas # son el motivo de las IPs que siguen). Solo lectura.
const RULES = '/etc/iptables/rules.v4', NOTES = '/root/bloqueos-ips.txt';
function manualBlocks(rulesFile = RULES, notesFile = NOTES) {
  let rules = '', notes = '';
  try { rules = fs.readFileSync(rulesFile, 'utf8'); } catch { return []; }
  try { notes = fs.readFileSync(notesFile, 'utf8'); } catch { notes = ''; }
  const why = new Map();
  let cur = '';
  for (const l of notes.split('\n')) {
    const t = l.trim();
    if (!t) continue;
    if (t.startsWith('#')) { const c = t.replace(/^#+\s*/, ''); if (!/^IPs bloqueadas en el firewall/i.test(c)) cur = c.replace(/^\d{4}-\d{2}-\d{2}\s*·\s*/, ''); continue; }
    const ip = t.split(/\s+/)[0]; if (require('net').isIP(ip)) why.set(ip, cur);
  }
  let st = null; try { st = fs.statSync(rulesFile); } catch { }
  const out = [];
  for (const m of rules.matchAll(/^-A INPUT -s ([0-9a-f.:]+?)(?:\/(?:32|128))? -j DROP\s*$/gim)) {
    out.push({ ip: m[1], reason: 'manual', why: why.get(m[1]) || 'Bloqueo manual en el firewall', permanent: true, at: st ? st.mtimeMs : null, by: 'firewall' });
  }
  return out;
}

class Defense {
  constructor(cfg, bus, ctx, opts = {}) {
    this.cfg = cfg; this.bus = bus; this.ctx = ctx;
    this.file = path.join(cfg.stateDir, 'defense.json');
    const d = readJSON(this.file, null) || {};
    this.records = d.records || [];
    this.conf = { auto: false, hours: 24, allow: [], ...(d.settings || {}) };
    this.pending = new Set();
    this.request = opts.request || ((action, params, by) => ctx.setup.request(action, params, by));
    this.result = opts.result || (id => ctx.setup.result(id));
    this.available = () => (cfg.edition || 'vps') === 'vps' && (opts.helper != null ? opts.helper : fs.existsSync('/etc/systemd/system/atalaya-helper.path'));
    bus.on('ev', e => { if (e.kind === 'watch' && e.action === 'start') this.onWatch(e); });
    // quien pide la ruta exacta de un archivo PHP sospechoso: con la defensa automatica, a la carcel
    bus.on('ev', e => { if (e.kind === 'phpfile' && e.action === 'hit' && e.ip && this.conf.auto) this.block(e.ip, { reason: 'phpfile', by: 'auto', account: e.account, site: e.site, domain: e.domain }).catch(err => console.log(`[defensa] no se bloqueó ${e.ip}: ${err.message}`)); });
    // tras un reinicio, la vigilancia vuelve a ignorar a los que siguen bloqueados
    setImmediate(() => { if (ctx.watch) for (const r of this.active()) ctx.watch.ignore(r.ip, r.until - Date.now()); });
    if (!opts.manual) { setInterval(() => this.tick(), 20000).unref(); }
  }

  save() { try { writeJSONAtomic(this.file, { settings: this.conf, records: this.records.slice(-500) }); } catch (e) { console.error('[defensa]', e.message); } }

  // IPs de usuarios de Atalaya (las sesiones de los ultimos 30 dias): nunca se bloquean
  userIps() {
    const auth = this.ctx.auth, out = [];
    if (auth && auth.sessions) for (const s of auth.sessions.values()) if (Date.now() - (s.seen || 0) < 30 * 86400000 && s.ip) out.push(String(s.ip).replace(/^::ffff:/, ''));
    return out;
  }
  why(ip) { return unsafe(ip, [...(this.conf.allow || []), ...this.userIps()]); }
  active() { const now = Date.now(); return this.records.filter(r => r.status === 'active' && r.until > now); }
  isBlocked(ip) { return this.active().some(r => r.ip === ip); }

  waitResult(id, ms = 20000) {
    return new Promise(resolve => {
      const t0 = Date.now();
      const poll = () => { const r = this.result(id); if (r) return resolve(r); if (Date.now() - t0 > ms) return resolve({ ok: false, error: 'El ayudante no respondió' }); setTimeout(poll, 400); };
      poll();
    });
  }

  // bloquea una IP; lanza un Error con el motivo si no se puede
  async block(ip, o = {}) {
    ip = String(ip || '').trim();
    if (!this.available()) throw new Error('La defensa necesita el ayudante de Atalaya (edición VPS)');
    const why = this.why(ip); if (why) throw new Error(why);
    if (this.isBlocked(ip)) return this.active().find(r => r.ip === ip);
    if (this.pending.has(ip)) throw new Error('Ya se está bloqueando esa IP');
    // de que sitio viene: la vigilancia activa donde esa IP es la principal
    const w = this.ctx.watch ? this.ctx.watch.list().find(a => a.top && a.top.ip === ip) : null;
    // sin vigilancia: quizas pidio una puerta trasera (su sitio sale de ahi)
    const ph = !w && !o.site && this.ctx.phpFiles ? this.ctx.phpFiles.siteOfHit(ip) : null;
    if (ph) Object.assign(o, { account: ph.account, site: ph.site, domain: ph.domain, reason: o.reason || 'phpfile' });
    const hours = Math.max(1, Math.min(168, Math.round(Number(o.hours) || this.conf.hours || 24)));
    const reason = o.reason || (w ? w.reason : 'manual');
    this.pending.add(ip);
    try {
      const id = this.request('block-ip', { ip, hours }, o.by || 'defensa');
      const r = await this.waitResult(id);
      if (!r.ok) throw new Error(r.error || 'No se pudo bloquear');
    } finally { this.pending.delete(ip); }
    const rec = { ip, reason, by: o.by || 'manual', at: Date.now(), until: Date.now() + hours * 3600000, hours, status: 'active',
      key: w ? w.key : o.key || null, account: w ? w.account : o.account || null, app: w ? w.app : o.app || null, site: w ? w.site : o.site || null, domain: w ? w.domain : o.domain || null };
    this.records.push(rec); this.save();
    if (this.ctx.watch) { this.ctx.watch.ignore(ip, hours * 3600000); if (rec.key) this.ctx.watch.resolve(rec.key); }
    console.log(`[defensa] ${ip} bloqueada ${hours} h (${LABEL[reason] || reason}) por ${rec.by}${rec.domain ? ' en ' + rec.domain : ''}`);
    this.bus.emit('ev', { kind: 'defense', action: 'block', ip, reason, by: rec.by, hours, account: rec.account, app: rec.app, site: rec.site, domain: rec.domain });
    return rec;
  }

  async unblock(ip, by = 'manual') {
    const rec = this.active().find(r => r.ip === ip);
    const id = this.request('unblock-ip', { ip }, by);
    const r = await this.waitResult(id);
    if (!r.ok) throw new Error(r.error || 'No se pudo desbloquear');
    if (rec) { rec.status = 'lifted'; rec.liftedAt = Date.now(); rec.liftedBy = by; this.save(); }
    console.log(`[defensa] ${ip} desbloqueada por ${by}`);
    this.bus.emit('ev', { kind: 'defense', action: 'unblock', ip, account: rec && rec.account, app: rec && rec.app, site: rec && rec.site });
    return true;
  }

  setConf(patch) {
    if (typeof patch.auto === 'boolean') this.conf.auto = patch.auto;
    if (patch.hours != null) this.conf.hours = Math.max(1, Math.min(168, Math.round(Number(patch.hours) || 24)));
    if (Array.isArray(patch.allow)) this.conf.allow = [...new Set(patch.allow.map(x => String(x).trim()).filter(x => require('net').isIP(x)))].slice(0, 200);
    this.save();
    console.log(`[defensa] automática ${this.conf.auto ? 'encendida' : 'apagada'} · ${this.conf.hours} h · ${this.conf.allow.length} IP(s) en lista blanca`);
    return this.conf;
  }

  onWatch(e) {
    if (!this.conf.auto || !e.ip || !AUTO_REASONS.has(e.reason)) return;
    this.block(e.ip, { reason: e.reason, by: 'auto' }).catch(err => console.log(`[defensa] no se bloqueó ${e.ip}: ${err.message}`));
  }

  // el servidor cerca del limite: se frena a quienes atacan ahora (escaneo incluido), antes de que se caiga
  saturated() {
    const s = this.ctx.dbActivity && this.ctx.dbActivity.available() ? this.ctx.dbActivity.snapshot() : null;
    const sys = this.ctx.host && this.ctx.host.system;
    const db = s && s.max ? s.conns / s.max : 0;
    const load = sys && sys.cores ? (sys.load || [0])[0] / sys.cores : 0;
    return db >= 0.85 ? `conexiones de MySQL al ${Math.round(db * 100)} %` : load >= 2 ? `carga del servidor ${load.toFixed(1)} veces sus núcleos` : null;
  }

  tick(now = Date.now()) {
    let changed = false;
    for (const r of this.records) if (r.status === 'active' && r.until <= now) {
      r.status = 'expired'; changed = true;
      this.bus.emit('ev', { kind: 'defense', action: 'expire', ip: r.ip, account: r.account, app: r.app, site: r.site });
    }
    if (changed) this.save();
    if (!this.conf.auto || !this.ctx.watch) return;
    const why = this.saturated();
    if (!why) return;
    for (const a of this.ctx.watch.list()) if (a.top && a.top.ip && a.reason !== 'surge' && !this.isBlocked(a.top.ip)) {
      console.log(`[defensa] servidor al límite (${why}): se frena a ${a.top.ip}`);
      this.block(a.top.ip, { reason: 'saturation', by: 'auto' }).catch(() => { });
    }
  }

  // la carcel: bloqueos manuales del firewall (permanentes) y los de Atalaya activos (con vencimiento)
  jail() {
    if (!this.jailCache || Date.now() - this.jailCache.at > 60000) this.jailCache = { at: Date.now(), list: manualBlocks(this.rulesFile, this.notesFile) };
    const act = this.active().map(r => ({ ...r, why: LABEL[r.reason] || r.reason, permanent: false }));
    const own = new Set(act.map(r => r.ip));
    return [...act, ...this.jailCache.list.filter(m => !own.has(m.ip))];
  }
  async release(ip, by = 'manual') {
    const man = this.jail().find(r => r.ip === ip && r.permanent);
    if (!man) return this.unblock(ip, by);
    const id = this.request('unblock-manual', { ip }, by);
    const r = await this.waitResult(id);
    if (!r.ok) throw new Error(r.error || 'No se pudo liberar');
    this.jailCache = null;
    console.log(`[defensa] ${ip} liberada del firewall por ${by}`);
    this.bus.emit('ev', { kind: 'defense', action: 'unblock', ip });
    return true;
  }

  // expediente de una IP: carcel e historial de bloqueos, sitios donde se la vio, puertas traseras que busco,
  // episodios del registro de seguridad y sus ultimas peticiones en los registros de Apache
  dossier(ip) {
    const L = this.ctx.logs, W = this.ctx.webdef, P = this.ctx.phpFiles, S = this.ctx.seclog;
    const inJail = this.jail().find(r => r.ip === ip) || null;
    const records = this.records.filter(r => r.ip === ip).slice().reverse();
    const geo = L && L.geo ? L.geo.country(ip) : null;
    const sites = [];
    if (W) for (const s of W.sites.values()) { const x = s.ips && s.ips.get(ip); if (x) sites.push({ account: s.account, site: s.site, app: s.app, domain: s.domain, n: x.n, t: x.t }); }
    const php = P ? P.suspects().concat(P.jailed).filter(r => ((P.hits.get(r.path) || {}).list || []).some(h => h.ip === ip)).map(r => ({ domain: r.domain, site: r.site, path: r.path, quarantined: P.jailed.includes(r) })) : [];
    const events = S ? S.ofIp(ip, 100) : [];
    const reqs = this.requestsOf(ip);
    return { ip, geo, inJail, records, sites: sites.sort((a, b) => b.n - a.n), php, events, reqs, why: this.why(ip) };
  }
  // ultimas peticiones de una IP en los registros de dominio (el final de cada uno; se recuerda 5 min)
  requestsOf(ip) {
    this.reqCache = this.reqCache || new Map();
    const c = this.reqCache.get(ip); if (c && Date.now() - c.at < 300000) return c.v;
    const files = this.ctx.logs && this.ctx.logs.tailers ? [...this.ctx.logs.tailers.keys()].filter(k => k.startsWith('/')) : [];
    const RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+)\s+(\S+)[^"]*" (\d{3}) \S+(?: "[^"]*" "([^"]*)")?/;
    const list = [];
    for (const f of files) {
      let txt = '';
      try { const st = fs.statSync(f), len = Math.min(st.size, 8 * 1024 * 1024), fd = fs.openSync(f, 'r'), b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, st.size - len); fs.closeSync(fd); txt = b.toString('latin1'); } catch { continue; }
      if (!txt.includes(ip + ' ')) continue;
      const domain = path.basename(f).replace(/-ssl_log$/, '');
      for (const line of txt.split('\n')) {
        if (!line.startsWith(ip + ' ')) continue;
        const m = RE.exec(line); if (!m) continue;
        list.push({ t: Date.parse(m[2].replace(':', ' ').replace(/\//g, ' ')) || 0, domain, method: m[3], path: m[4].split('?')[0].slice(0, 160), status: +m[5], ua: (m[6] || '').slice(0, 120) });
      }
    }
    list.sort((a, b) => b.t - a.t);
    const byPath = new Map(); for (const r of list) { const x = byPath.get(r.path) || { path: r.path, n: 0, status: r.status }; x.n++; byPath.set(r.path, x); }
    const v = { total: list.length, first: list.length ? list[list.length - 1].t : null, last: list.length ? list[0].t : null, recent: list.slice(0, 40),
      topPaths: [...byPath.values()].sort((a, b) => b.n - a.n).slice(0, 10), ua: list.find(r => r.ua) ? list.find(r => r.ua).ua : '' };
    this.reqCache.set(ip, { at: Date.now(), v });
    if (this.reqCache.size > 200) this.reqCache.delete(this.reqCache.keys().next().value);
    return v;
  }

  // para la pantalla (la privacidad la aplica server/privacy.js)
  summary() {
    const act = this.active();
    return { available: this.available(), auto: this.conf.auto, hours: this.conf.hours, allow: this.conf.allow, active: act.length,
      records: this.records.slice(-40).reverse(), label: LABEL };
  }
}

module.exports = { Defense, LABEL, manualBlocks };
