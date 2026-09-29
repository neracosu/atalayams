'use strict';
// Defensa web: los robots que recorren cada sitio buscando rutas vulnerables (wp-login.php en un sitio que
// no es WordPress, /.env, /.git/config, phpmyadmin, webshells, ../../etc/passwd...). Sale de las visitas que
// ya se leen de los logs: nada nuevo se instala ni se abre. Cuando una ruta de secretos o de webshell
// responde 200, Atalaya la vuelve a pedir una vez para confirmar si de verdad expone algo; nunca guarda ni
// muestra el contenido, solo el veredicto.
const https = require('https');
const http = require('http');
const { lookup, blockedHost } = require('./netguard');

// las familias de sondeo, cuales son sensibles y sus arreglos vienen de las definiciones (server/defs.js)
const { DEFAULT } = require('./defs');
const FAMILIES = DEFAULT.webFamilies; // las integradas (para quien no pasa definiciones, p. ej. pruebas)
const LABEL = Object.fromEntries(FAMILIES.map(([id, name]) => [id, name]));
const HOUR = 3600000;

function classify(path, isWp, families = FAMILIES) {
  const p = String(path || '').split('#')[0];
  for (const [id, , re] of families) {
    if (!re.test(p)) continue;
    // en un sitio WordPress su propio login no es un sondeo (salvo los POST, que cuentan como fuerza bruta)
    if (id === 'wordpress' && isWp) return null;
    return id;
  }
  return null;
}

class WebDefense {
  constructor(cfg, bus, logs, defs = null) {
    this.cfg = cfg; this.bus = bus; this.logs = logs; this.defs = defs;
    this.sites = new Map(); // clave sitio -> { account, app, site, domain, hits: [], fam: {}, paths: Map, ips: Map, cc: Map, ok200: Set, bruteWp }
    this.exposed = new Map(); // domain+path -> { account, app, site, domain, path, fam, status, verdict, first, last, n }
    this.checks = new Map(); // domain+path -> ultima verificacion (una por dia)
    this.total = { hour: [] };
    this.lastEmit = 0;
    this.onRefused = null; // (ip, momento) de cada sondeo rechazado; lo asigna quien lo necesite
    bus.on('ev', e => { if (e.kind === 'http' && e.path) this.onHttp(e); });
    setInterval(() => this.prune(), 60000).unref();
  }

  get rules() { return this.defs ? this.defs.rules : DEFAULT; }
  keyOf(e) { return e.app ? 'app:' + e.account + '/' + e.app : e.site ? 'site:' + e.site : e.domain ? 'dom:' + e.domain : null; }
  isWp(e) {
    if (!e.site) return false;
    const g = this.logs.sites.find(x => x.id === e.site);
    return !!(g && g.type === 'wordpress');
  }

  onHttp(e) {
    // el propio servidor y las revisiones de Atalaya (verificacion de expuestos, favicons) no son sondeos
    if (require('./blocksafe').internal(e.ip, e.uaRaw)) return;
    const wp = this.isWp(e);
    let fam = classify(e.path, wp, this.rules.webFamilies);
    // fuerza bruta: POST al login o a xmlrpc de un WordPress
    if (!fam && wp && e.method === 'POST' && /\/(wp-login|xmlrpc)\.php/i.test(e.path)) fam = 'wordpress';
    if (!fam) return;
    // un panel que existe no es un sondeo (el admin.php de un sitio PHP); pero un phpMyAdmin o un Adminer
    // que responde a cualquiera desde Internet se anota como riesgo
    if (fam === 'panels' && e.status > 0 && e.status < 400) {
      if (/phpmyadmin|\/pma\b|myadmin|adminer/i.test(e.path)) this.panelOpen(e);
      return;
    }
    const key = this.keyOf(e);
    if (!key) return;
    const now = e.at || Date.now();
    const s = this.sites.get(key) || { account: e.account, app: e.app || null, site: e.site || null, domain: e.domain, hits: [], fam: {}, paths: new Map(), ips: new Map(), cc: new Map() };
    this.sites.set(key, s);
    s.domain = s.domain || e.domain;
    s.hits.push({ t: now, fam, status: e.status, ip: e.ip || null }); // la IP: la vigilancia descuenta las ya bloqueadas
    s.fam[fam] = (s.fam[fam] || 0) + 1;
    const path = String(e.path).split('?')[0].slice(0, 120);
    // los objetos de un repositorio (/.git/objects/ab/cdef...) van en una sola linea: los descarga una herramienta, uno por uno
    const pkey = path.replace(/^(.*\/\.git\/objects)\/.*$/, '$1/…').replace(/^(.*\/\.git\/refs)\/.*$/, '$1/…');
    s.paths.set(pkey, { n: ((s.paths.get(pkey) || {}).n || 0) + 1, fam, status: e.status, t: now });
    if (/\/\.git\/objects\/[0-9a-f]{2}\/[0-9a-f]{38}/i.test(path)) s.gitDump = (s.gitDump || 0) + 1;
    if (e.ip) { const x = s.ips.get(e.ip) || { n: 0, cc: e.cc, country: e.country }; x.n++; x.t = now; s.ips.set(e.ip, x); }
    if (e.cc) s.cc.set(e.cc, (s.cc.get(e.cc) || 0) + 1);
    this.total.hour.push(now);
    const blocked = e.status === 403 || e.status === 404 || e.status === 410 || e.status === 444 || e.status === 401;
    // el sondeo se quedo sin nada: lo cuentan los totales publicos de anoche (server/publictotals.js), si estan encendidos
    if (blocked && this.onRefused) this.onRefused(e.ip, now);
    const hit = this.rules.sensitive.has(fam) && e.status === 200 && (e.bytes || 0) > 0;
    if (hit) this.suspect(s, path, fam, e);
    // a la pantalla: un sondeo cada tanto (los escaneos llegan de a cientos)
    if (!e.late && (hit || now - this.lastEmit > 700)) {
      this.lastEmit = now;
      this.bus.emit('ev', { kind: 'probe', account: e.account, app: e.app || null, site: e.site || null, fam, status: e.status, blocked, exposed: hit,
        ip: e.ip, cc: e.cc, country: e.country, path });
    }
  }

  panelOpen(e) {
    const path = String(e.path).split('?')[0].slice(0, 120), k = (e.domain || '') + path;
    const x = this.exposed.get(k) || { account: e.account, app: e.app || null, site: e.site || null, domain: e.domain, path, fam: 'panels', first: e.at || Date.now(), n: 0, verdict: 'panel' };
    x.n++; x.last = e.at || Date.now(); x.status = e.status;
    if (e.ip) x.ip = e.ip; // quien lo encontro (para bloquearlo)
    this.exposed.set(k, x);
  }

  // una ruta de secretos o webshell respondio 200: se anota y se verifica
  suspect(s, path, fam, e) {
    const k = s.domain + path;
    const x = this.exposed.get(k) || { account: s.account, app: s.app, site: s.site, domain: s.domain, path, fam, first: e.at || Date.now(), n: 0, verdict: 'pending' };
    x.n++; x.last = e.at || Date.now(); x.status = e.status;
    this.exposed.set(k, x);
    const last = this.checks.get(k) || 0;
    if (Date.now() - last > 24 * HOUR) { this.checks.set(k, Date.now()); this.verify(x).catch(() => { }); }
  }

  // se pide la ruta y otra que no puede existir: si ambas responden igual, el sitio contesta 200 a todo
  // (una SPA, una pagina de error con 200) y no expone nada. Solo se miran los primeros bytes.
  // Se pide la ruta y otra que no puede existir: si ambas responden igual, el sitio contesta 200 a todo (una
  // SPA, una pagina de error con 200) y no expone nada. Si por el dominio no se ve, se prueba por www. y mail.:
  // un .git puede estar tapado para el dominio y servirse por otro nombre del mismo sitio. Solo se miran los primeros bytes; nunca se guardan.
  async verify(x) {
    if (!x.domain || blockedHost(x.domain)) { x.verdict = 'unknown'; return x; }
    const get = (host, p) => this.fetch ? this.fetch(host, p) : new Promise(resolve => {
      const req = https.get({ host, path: p, timeout: 8000, lookup, rejectUnauthorized: false, headers: { 'User-Agent': 'Atalaya-monitor (verificacion de exposicion)', Range: 'bytes=0-2047' } }, res => {
        let b = Buffer.alloc(0);
        res.on('data', c => { b = Buffer.concat([b, c]); if (b.length > 2048) req.destroy(); });
        res.on('close', () => resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), head: b.slice(0, 2048).toString('latin1') }));
      });
      req.on('timeout', () => { req.destroy(); resolve(null); });
      req.on('error', () => resolve(null));
    });
    const base = x.domain.replace(/^(www|mail)\./i, '');
    const names = [...new Set([x.domain, 'www.' + base, 'mail.' + base])];
    x.checked = Date.now();
    let best = null;
    for (const host of names) {
      const [a, b] = await Promise.all([get(host, x.path), get(host, '/atalaya-' + Math.random().toString(36).slice(2, 10) + '.txt')]);
      if (!a) continue;
      if (a.status !== 200 && a.status !== 206) { best = best || 'closed'; continue; }
      const same = b && (b.status === 200 || b.status === 206) && b.head.slice(0, 400) === a.head.slice(0, 400);
      if (looksExposed(x.path, a)) { x.verdict = 'exposed'; x.via = host; break; }
      const v = same || /text\/html/i.test(a.type) ? 'catchall' : 'possible';
      best = best === 'possible' ? best : v;
    }
    if (x.verdict !== 'exposed') x.verdict = best || 'unknown';
    if (x.verdict === 'exposed') this.bus.emit('ev', { kind: 'probe', account: x.account, app: x.app, site: x.site, fam: x.fam, status: 200, exposed: true, confirmed: true, path: x.path });
    return x;
  }

  prune() {
    const cut = Date.now() - 24 * HOUR;
    for (const [k, s] of this.sites) {
      s.hits = s.hits.filter(h => h.t > cut);
      if (!s.hits.length) { this.sites.delete(k); continue; }
      if (s.paths.size > 300) s.paths = new Map([...s.paths].sort((a, b) => b[1].n - a[1].n).slice(0, 200));
      if (s.ips.size > 500) s.ips = new Map([...s.ips].sort((a, b) => b[1].n - a[1].n).slice(0, 300));
    }
    this.total.hour = this.total.hour.filter(t => t > Date.now() - HOUR);
    for (const [k, x] of this.exposed) if (x.last < cut && x.verdict !== 'exposed') this.exposed.delete(k);
  }

  // resumen para la pantalla
  summary() {
    const since = Date.now() - HOUR;
    let hour = 0;
    for (const s of this.sites.values()) hour += s.hits.filter(h => h.t > since).length;
    const exposed = [...this.exposed.values()].filter(x => x.verdict === 'exposed' || x.verdict === 'possible' || x.verdict === 'pending');
    const gitDump = [...this.sites.values()].filter(s => (s.gitDump || 0) >= 20).length;
    return { hour, sites: this.sites.size, exposed: exposed.filter(x => x.verdict === 'exposed').length, suspect: exposed.length + gitDump };
  }
}

// lo que delata un archivo expuesto (sin guardar su contenido)
function looksExposed(path, r) {
  const h = r.head || '';
  if (/\/\.env/i.test(path)) return /^\s*[A-Z][A-Z0-9_]{2,}\s*=/m.test(h) && !/<html/i.test(h);
  if (/\/\.git\//i.test(path)) return /\[core\]|repositoryformatversion|^ref: refs\//m.test(h);
  if (/\.(sql)$/i.test(path)) return /(CREATE TABLE|INSERT INTO|mysqldump|-- MySQL dump)/i.test(h);
  if (/\.(zip|tar|tgz|gz|rar|7z|bak)$/i.test(path)) return /zip|gzip|x-tar|octet-stream|x-7z|x-rar/i.test(r.type) || /^PK\x03\x04|^\x1f\x8b/.test(h);
  if (/wp-config|config\.php|settings\.php|configuration\.php/i.test(path)) return /DB_PASSWORD|DB_NAME|\$db|password/i.test(h) && !/<html/i.test(h);
  if (/\.php/i.test(path)) return /(uname|safe_mode|shell|cmd|eval\(|base64_decode|upload|wso|b374k|FilesMan)/i.test(h);
  return false;
}

module.exports = { WebDefense, classify, looksExposed, FAMILIES, LABEL };
