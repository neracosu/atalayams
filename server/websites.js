'use strict';
// Sitios vigilados por su dominio: para proyectos que no viven en un servidor propio (Cloudflare Pages, Netlify,
// Vercel sin conector...) o que simplemente se quieren mirar desde afuera. No se instala nada: el dueno escribe el
// dominio y Atalaya lo visita cada 5 minutos como un visitante mas.
//  - cada sitio declara que respuesta es la correcta (una puerta que exige llave responde 401 y esta sana) y,
//    si quiere, una frase que debe aparecer en la pagina: un sitio publicado en blanco tambien responde 200
//  - un fallo se vuelve a probar antes de darlo por caido, y si tampoco responde la direccion de control el
//    problema es de esta Atalaya: se anota «sin medir» y no se acusa a nadie
//  - se avisa una vez al caer y una vez al volver
//  - las visitas llegan con el script opcional (a.js), porque de estos sitios no hay registros del servidor
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { readJSON, writeJSONAtomic } = require('./util');
const { lookup, blockedHost } = require('./netguard');

const ACCOUNT = '_sitios';
const SLUG = /^[a-z0-9][a-z0-9-]{0,30}$/;
const DOMAIN = /^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/;
const EVERY = 5 * 60000, RETRY = 30000, TIMEOUT = 12000, KEEP = 288; // 288 medidas = 24 horas
const EXPECT = [0, 200, 204, 401, 403, 404]; // 0 = cualquier respuesta 2xx
const CONTROL = () => process.env.ATALAYA_PROBE_CONTROL || 'https://www.gstatic.com/generate_204';
const UA = 'Mozilla/5.0 (compatible; Atalaya-monitor/1.0; vigilancia de disponibilidad)';

// una visita: sigue hasta 4 redirecciones y lee como mucho 512 KB de la pagina
function visit(url, hops = 0) {
  return new Promise(resolve => {
    const t0 = Date.now();
    let u; try { u = new URL(url); } catch { return resolve({ status: 0, ms: 0, error: 'dirección inválida' }); }
    if (blockedHost(u.hostname)) return resolve({ status: 0, ms: 0, error: 'dirección interna' });
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.request(u, { method: 'GET', timeout: TIMEOUT, lookup, headers: { 'User-Agent': UA, Accept: 'text/html,*/*' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 4) {
        res.resume();
        return resolve(visit(new URL(res.headers.location, u).toString(), hops + 1).then(r => ({ ...r, ms: r.ms + (Date.now() - t0) })));
      }
      let body = '', size = 0;
      res.setEncoding('utf8');
      res.on('data', c => { size += c.length; if (size <= 512 * 1024) body += c; else req.destroy(); });
      const done = () => resolve({ status: res.statusCode, ms: Date.now() - t0, body });
      res.on('end', done); res.on('close', done);
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, ms: Date.now() - t0, error: `no respondió en ${TIMEOUT / 1000} s` }); });
    req.on('error', e => resolve({ status: 0, ms: Date.now() - t0, error: WHY[e.code] || e.code || e.message }));
    req.end();
  });
}
const WHY = { ENOTFOUND: 'el dominio no resuelve', EAI_AGAIN: 'el dominio no resuelve', ECONNREFUSED: 'rechazó la conexión', ECONNRESET: 'cortó la conexión',
  CERT_HAS_EXPIRED: 'el certificado está vencido', DEPTH_ZERO_SELF_SIGNED_CERT: 'el certificado no es de confianza', ERR_TLS_CERT_ALTNAME_INVALID: 'el certificado es de otro dominio',
  EPRIVATE: 'dirección interna', ETIMEDOUT: 'no respondió a tiempo' };

const textOf = html => String(html || '').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');

// la medida contra lo que el dueno declaro: null si esta bien, o el motivo en palabras
function verdict(site, r) {
  if (!r.status) return r.error || 'no respondió';
  const want = Number(site.expect) || 0;
  if (want ? r.status !== want : r.status < 200 || r.status > 299) return `respondió ${r.status}${want ? ` y se esperaba ${want}` : ''}`;
  // la frase se busca en el texto que se lee (sin etiquetas ni codigo): una pagina en blanco puede traerla en un script
  if (site.phrase && !textOf(r.body).toLowerCase().includes(String(site.phrase).toLowerCase().replace(/\s+/g, ' '))) return 'la página abre pero no trae la frase esperada';
  return null;
}

class WebSites {
  constructor(cfg, bus, opts = {}) {
    this.cfg = cfg; this.bus = bus;
    this.file = path.join(cfg.stateDir || '.', 'websites.json');
    this.visit = opts.visit || visit;
    this.now = opts.now || (() => Date.now());
    this.retryMs = opts.retryMs != null ? opts.retryMs : RETRY;
    const d = readJSON(this.file, null) || {};
    this.sites = d.sites || {}; // id -> { domain, label, path, expect, phrase, added }
    this.state = d.state || {}; // id -> { ok, since, last, status, ms, why, log: [[t, ms, ok]] }
    this.onChange = null; // lo asigna index.js (rearmar el catalogo de sitios)
    this.account = ACCOUNT;
  }
  start() {
    // repartidas: no todas en el mismo segundo
    const tick = () => { const ids = Object.keys(this.sites); ids.forEach((id, i) => setTimeout(() => this.check(id).catch(() => { }), Math.round(i * Math.min(3000, 60000 / Math.max(1, ids.length))))); };
    setTimeout(tick, 15000).unref();
    this.timer = setInterval(tick, EVERY); this.timer.unref();
  }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeJSONAtomic(this.file, { sites: this.sites, state: this.state }, 0o600); } catch (e) { console.error('[sitios]', e.message); } }

  ids() { return Object.keys(this.sites); }
  groupId(id) { const s = this.sites[id]; return s ? ACCOUNT + ':' + s.domain : null; }
  idOfGroup(gid) { return this.ids().find(id => this.groupId(id) === gid) || null; }
  idOfDomain(host) { const h = String(host || '').toLowerCase().replace(/^www\./, ''); return this.ids().find(id => h === this.sites[id].domain || h.endsWith('.' + this.sites[id].domain)) || null; }

  add(input) {
    let domain = String(input.domain || '').trim().toLowerCase().replace(/^https?:\/\//, '');
    let p = '/';
    const cut = domain.indexOf('/');
    if (cut > 0) { p = domain.slice(cut); domain = domain.slice(0, cut); }
    domain = domain.replace(/^www\./, '').replace(/:\d+$/, '');
    if (input.path) p = String(input.path);
    if (!DOMAIN.test(domain)) throw new Error('Escriba el dominio como lo ve en el navegador, por ejemplo mitienda.com');
    if (!p.startsWith('/') || p.length > 200 || /\s/.test(p)) throw new Error('La dirección dentro del sitio debe empezar con / y no llevar espacios');
    const id = String(input.id || domain.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 31)).toLowerCase();
    if (!SLUG.test(id)) throw new Error('Nombre inválido: minúsculas, números y guiones (hasta 31)');
    if (input.edit && !this.sites[id]) throw new Error('No vigila ese sitio');
    const editing = !!input.edit && !!this.sites[id];
    if (!editing && this.sites[id]) throw new Error('Ya vigila ese sitio');
    if (!editing && this.ids().some(x => this.sites[x].domain === domain)) throw new Error('Ya vigila ese dominio');
    const max = this.cfg.limits && this.cfg.limits.sites;
    if (!editing && max != null && this.ids().length >= max) throw new Error(`Su plan permite hasta ${max} sitios vigilados. Quite uno o pida un plan mayor.`);
    const expect = Number(input.expect) || 0;
    if (!EXPECT.includes(expect)) throw new Error('Respuesta esperada inválida');
    const prev = this.sites[id] || {};
    this.sites[id] = { domain: editing ? prev.domain : domain, label: String(input.label || prev.label || domain).slice(0, 60), path: p, expect, phrase: String(input.phrase || '').trim().slice(0, 120), added: prev.added || new Date().toISOString() };
    if (!editing) this.state[id] = { ok: null, since: 0, last: 0, log: [] };
    this.save();
    if (this.onChange) this.onChange();
    this.check(id).catch(() => { });
    return { id, ...this.sites[id] };
  }
  remove(id) {
    if (!this.sites[id]) throw new Error('No vigila ese sitio');
    delete this.sites[id]; delete this.state[id];
    this.save();
    if (this.onChange) this.onChange();
  }

  // distrito y catalogo para el mapa (mismo formato que un hosting remoto)
  virtual() { return this.ids().length ? [{ id: ACCOUNT, label: 'Sitios vigilados', publicLabel: 'Sitios vigilados' }] : []; }
  vhosts() { return this.ids().map(id => ({ account: ACCOUNT, servername: this.sites[id].domain, aliases: ['www.' + this.sites[id].domain], docroot: '', remote: true, type: 'static', logs: [] })); }
  mains() { return []; }

  // una medida. Un fallo se repite una vez; si tampoco responde la direccion de control, no se pudo medir
  async check(id) {
    const s = this.sites[id]; if (!s) return null;
    const url = 'https://' + s.domain + (s.path || '/');
    let r = await this.visit(url), why = verdict(s, r);
    if (why) { if (this.retryMs) await new Promise(f => setTimeout(f, this.retryMs)); if (!this.sites[id]) return null; r = await this.visit(url); why = verdict(s, r); }
    if (why && !r.status) { const c = await this.visit(CONTROL()); if (!c.status) return this.note(id, { unmeasured: true, why: 'Atalaya no pudo salir a Internet para medir' }); }
    return this.note(id, { ok: !why, why, status: r.status, ms: r.ms });
  }
  note(id, m) {
    const st = this.state[id] || (this.state[id] = { ok: null, since: 0, last: 0, log: [] }), s = this.sites[id], t = this.now();
    st.last = t;
    if (m.unmeasured) { st.unmeasured = t; st.note = m.why; return st; }
    delete st.note;
    st.log.push([t, m.ms || 0, m.ok ? 1 : 0]); if (st.log.length > KEEP) st.log.splice(0, st.log.length - KEEP);
    st.status = m.status; st.ms = m.ms; st.why = m.why || null;
    const was = st.ok;
    if (was !== m.ok) {
      const downFor = was === false && st.since ? t - st.since : 0;
      st.ok = m.ok; st.since = t;
      // la primera medida de un sitio sano no es noticia; la de uno caido, si
      if (was !== null || !m.ok) this.bus.emit('ev', { kind: 'uptime', action: m.ok ? 'up' : 'down', account: ACCOUNT, site: this.groupId(id), domain: s.domain, label: s.label, status: m.status, why: m.why || null, downFor });
      this.save();
    } else if (st.log.length % 12 === 0) this.save();
    return st;
  }

  isDown(gid) { const id = this.idOfGroup(gid), st = id && this.state[id]; return !!(st && st.ok === false); }
  // para la ficha del sitio: como esta ahora y como le fue en 24 horas
  info(gid, priv) {
    const id = this.idOfGroup(gid); if (!id) return null;
    const s = this.sites[id], st = this.state[id] || { log: [] }, log = st.log || [];
    const good = log.filter(x => x[2]), ms = good.map(x => x[1]);
    const out = { id, ok: st.ok, since: st.since || null, last: st.last || null, status: st.status || null, ms: st.ms || null, why: st.ok === false ? st.why : null,
      note: st.note || null, expect: s.expect || 0, checks: log.length, pct: log.length ? Math.round(good.length / log.length * 1000) / 10 : null,
      avgMs: ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length) : null, series: log.slice(-96).map(x => ({ t: x[0], ms: x[1], ok: !!x[2] })), hasPhrase: !!s.phrase };
    if (priv) Object.assign(out, { url: 'https://' + s.domain + (s.path || '/'), phrase: s.phrase || '', path: s.path || '/', label: s.label });
    return out;
  }
  list() { return this.ids().map(id => { const st = this.state[id] || {}; return { id, ...this.sites[id], ok: st.ok, since: st.since || null, last: st.last || null, why: st.ok === false ? st.why : null, note: st.note || null, ms: st.ms || null }; }); }
}

module.exports = { WebSites, verdict, visit, ACCOUNT, EXPECT };
