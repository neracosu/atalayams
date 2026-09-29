'use strict';
// Accesos a cPanel, WHM y webmail, en solo lectura:
//  - /usr/local/cpanel/logs/login_log: intentos fallidos (IP, usuario, servicio) de los ultimos 7 dias
//  - /usr/local/cpanel/logs/session_log: entradas que funcionaron (NEW ... method=handle_form_login) y las de root
//    abriendo un cPanel desde WHM (create_user_session)
// Una entrada a WHM o cPanel desde una IP que ese usuario no uso en 30 dias avisa (evento 'login'); si esa IP venia
// fallando la contrasena, es grave: alguien pudo adivinarla. Se recuerdan las IPs conocidas en audits/logins.json.
const fs = require('fs');
const path = require('path');
const { readJSON, writeJSONAtomic } = require('../util');
const { internal } = require('../blocksafe');

const DAY = 86400000;
const SVC = { whostmgrd: 'WHM', cpaneld: 'cPanel', webmaild: 'webmail' };
const TS = /^\[(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d) ([+-]\d\d)(\d\d)\]/;
const ts = m => Date.parse(`${m[1]}T${m[2]}${m[3]}:${m[4]}`);

function tail(file, bytes) {
  try {
    const fd = fs.openSync(file, 'r'); const size = fs.fstatSync(fd).size, len = Math.min(size, bytes);
    const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd);
    const txt = buf.toString('utf8'); return len < size ? txt.slice(txt.indexOf('\n') + 1) : txt;
  } catch { return null; }
}
// hora de la primera linea con fecha de un trozo de registro (para saber desde cuando cubre lo leido)
function firstTime(txt) {
  for (const l of String(txt || '').split('\n')) { const m = TS.exec(l); if (m) return ts(m); }
  return null;
}
// [fecha] info [whostmgrd] 1.2.3.4 - root "POST /login/..." FAILED LOGIN whostmgrd: user password incorrect
function parseFailed(txt, since) {
  const out = [];
  for (const l of String(txt || '').split('\n')) {
    if (!l.includes('FAILED LOGIN')) continue;
    const m = TS.exec(l); if (!m) continue;
    const t = ts(m); if (t < since) continue;
    const x = /\] \w+ \[(\w+)\] (\S+) - (\S+) .*FAILED LOGIN \w+: (.*)$/.exec(l); if (!x) continue;
    // sin usuario son escaneres tocando el puerto del panel, no alguien probando contrasenas
    if (x[3] === '-' || /without username/.test(x[4])) { out.scans = (out.scans || 0) + 1; continue; }
    out.push({ t, svc: x[1], ip: x[2], user: x[3], why: x[4].trim() });
  }
  return out;
}
// [fecha] info [cpaneld] 1.2.3.4 NEW usuario:sesion address=...,app=cpaneld,creator=usuario,method=handle_form_login,...
function parseSessions(txt, since) {
  const out = [];
  for (const l of String(txt || '').split('\n')) {
    if (!l.includes(' NEW ')) continue;
    const m = TS.exec(l); if (!m) continue;
    const t = ts(m); if (t < since) continue;
    const x = /\] \w+ \[(\w+)\] (\S+) NEW ([^:\s]+):\S+ (.*)$/.exec(l); if (!x) continue;
    const kv = {}; for (const p of x[4].split(',')) { const i = p.indexOf('='); if (i > 0) kv[p.slice(0, i)] = p.slice(i + 1); }
    const method = kv.method || '';
    if (method !== 'handle_form_login' && method !== 'create_user_session') continue;
    out.push({ t, svc: x[1], ip: x[2], user: decodeURIComponent(x[3]), via: method === 'create_user_session' ? (kv.creator || 'root') : null });
  }
  return out;
}

class LoginAudit {
  constructor(cfg, bus, opts = {}) {
    this.cfg = cfg; this.bus = bus; this.opts = opts;
    this.dir = opts.logDir || '/usr/local/cpanel/logs';
    this.file = path.join(cfg.stateDir, 'audits', 'logins.json');
    const saved = readJSON(this.file, null) || {};
    this.known = saved.known || null; // { usuario: { ip: ultima vez } }
    this.seen = saved.seen || 0;      // hasta donde ya se avisaron entradas
    this.data = null;
  }
  available() { return (this.cfg.edition || 'vps') === 'vps' && fs.existsSync(path.join(this.dir, 'login_log')); }
  start() { if (!this.available()) return; setTimeout(() => this.refresh(), 8000); setInterval(() => this.refresh(), 5 * 60000).unref(); }

  refresh(now = Date.now()) {
    if (!this.available()) return null;
    const failed = parseFailed(tail(path.join(this.dir, 'login_log'), 8 << 20), now - 7 * DAY);
    const logins = parseSessions(tail(path.join(this.dir, 'session_log'), 4 << 20), now - 30 * DAY);
    const first = !this.known;
    if (first) this.known = {};
    const failsBefore = l => failed.filter(f => f.ip === l.ip && f.user === l.user && f.t < l.t).length;
    let changed = first;
    for (const l of logins.slice().sort((a, b) => a.t - b.t)) {
      if (l.via || l.svc === 'webmaild' || internal(l.ip)) continue; // root desde WHM y el webmail (celulares) no avisan
      const k = this.known[l.user] || (this.known[l.user] = {});
      const isNew = !k[l.ip];
      k[l.ip] = Math.max(k[l.ip] || 0, l.t); changed = true;
      l.newIp = isNew && !first;
      if (!first && l.t > this.seen && isNew && this.bus) {
        const bad = failsBefore(l);
        this.bus.emit('ev', { kind: 'login', action: bad >= 3 ? 'guessed' : 'new', ip: l.ip, user: l.user, service: SVC[l.svc] || l.svc, n: bad >= 3 ? bad : null });
      }
    }
    // se olvidan las IPs que no se usan hace 60 dias
    for (const u of Object.keys(this.known)) for (const [ip, t] of Object.entries(this.known[u])) if (now - t > 60 * DAY) { delete this.known[u][ip]; changed = true; }
    if (logins.length) this.seen = Math.max(this.seen, ...logins.map(l => l.t));
    if (changed) try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeJSONAtomic(this.file, { known: this.known, seen: this.seen }); } catch { }
    this.data = { t: now, failed, scans: failed.scans || 0, logins, tfa: this.tfaUsers() };
    return this.data;
  }
  // quienes tienen verificacion en dos pasos en WHM/cPanel
  tfaUsers() {
    const d = readJSON(this.opts.tfaFile || '/var/cpanel/authn/twofactor_auth/tfa_userdata.json', null);
    return d ? Object.keys(d).filter(u => d[u] && d[u].secret) : null;
  }
  // IPs con mas intentos fallidos, para el expediente y la carcel
  topFailed(limit = 12) {
    if (!this.data) return [];
    const by = new Map();
    for (const f of this.data.failed) {
      const x = by.get(f.ip) || { ip: f.ip, n: 0, users: new Set(), svcs: new Set(), last: 0 };
      x.n++; x.users.add(f.user); x.svcs.add(SVC[f.svc] || f.svc); x.last = Math.max(x.last, f.t); by.set(f.ip, x);
    }
    return [...by.values()].sort((a, b) => b.n - a.n).slice(0, limit).map(x => ({ ip: x.ip, n: x.n, users: [...x.users].slice(0, 4), svcs: [...x.svcs], last: x.last }));
  }
  ofIp(ip) {
    if (!this.data) return null;
    const f = this.data.failed.filter(x => x.ip === ip), l = this.data.logins.filter(x => x.ip === ip);
    if (!f.length && !l.length) return null;
    return { failed: f.length, users: [...new Set(f.map(x => x.user))].slice(0, 6), svcs: [...new Set(f.map(x => SVC[x.svc] || x.svc))], last: f.length ? f[f.length - 1].t : null,
      logins: l.slice(-10).reverse().map(x => ({ t: x.t, user: x.user, svc: SVC[x.svc] || x.svc })) };
  }

  section() {
    if (!this.available() || !this.data) return null;
    const { failed, scans, logins, tfa } = this.data, f = [];
    const top = this.topFailed(12);
    const failIps = new Set(failed.map(x => x.ip));
    // una entrada que funciono desde una IP que venia fallando: alguien pudo adivinar la contrasena
    const before = l => failed.filter(x => x.ip === l.ip && x.user === l.user && x.t < l.t).length;
    const guessed = logins.filter(l => !l.via && l.svc !== 'webmaild' && before(l) >= 3);
    for (const g of guessed.slice(-3)) f.push({ sev: 'bad', title: `Entraron a ${SVC[g.svc] || g.svc} como ${g.user} desde una IP que venía fallando la contraseña`, detail: `El ${new Date(g.t).toLocaleString('es-VE', { hour12: false })} desde ${g.ip}, después de ${before(g)} intentos fallidos. Si no fue usted, alguien adivinó la contraseña.`, fix: `Cambie ya la contraseña de ${g.user}, active la verificación en dos pasos, cierre sus sesiones (WHM › Security Center) y lleve esa IP a la cárcel.`, names: [g.user], rows: [{ ip: g.ip, n: before(g) }] });
    const whm = failed.filter(x => x.svc === 'whostmgrd');
    if (failed.length >= 30) {
      const rootTfa = tfa && tfa.includes('root');
      const spread = failIps.size >= 20 && failed.length / failIps.size < 5;
      f.push({ sev: whm.length >= 200 && !rootTfa ? 'bad' : 'warn', title: `${failed.length.toLocaleString('es-VE')} contraseñas equivocadas en los paneles esta semana`, detail: `Desde ${failIps.size} IPs${whm.length ? `; ${whm.length.toLocaleString('es-VE')} contra WHM` : ''}. Son robots probando contraseñas: cPHulk bloquea a los que insisten${rootTfa ? ' y root tiene verificación en dos pasos, así que aunque acierten la contraseña no entran' : ''}.`,
        fix: (spread ? `Es un ataque repartido (unos ${Math.round(failed.length / failIps.size)} intentos por IP, justo para no despertar a cPHulk): llevarlas a la cárcel una por una no sirve. ` : '') + (rootTfa ? 'Para que ni lo intenten: en WHM › Host Access Control permita el puerto 2087 solo desde sus IPs.' : 'Active la verificación en dos pasos para root (WHM › Two-Factor Authentication) y limite el puerto 2087 a sus IPs en WHM › Host Access Control.'),
        rows: top });
    }
    // las ultimas entradas que funcionaron (solo en privado: la regla publico/privado quita los hallazgos)
    const recent = this.recent(10).filter(l => !l.via);
    if (recent.length) f.push({ sev: 'info', title: 'Últimas entradas a los paneles', detail: recent.some(l => l.newIp) ? 'Las marcadas como nuevas son de una IP que ese usuario no usaba. Si no reconoce alguna, cambie la contraseña.' : 'Revise que reconozca cada una.', rows: recent.map(l => ({ ip: l.ip, t: l.t, user: l.user, svc: l.svc, newIp: l.newIp })) });
    if (tfa && !tfa.includes('root')) f.push({ sev: 'warn', title: 'root no tiene verificación en dos pasos', detail: 'Con solo la contraseña se entra a todo el servidor.', fix: 'Actívela en WHM › Security Center › Two-Factor Authentication.' });
    const real = logins.filter(l => !l.via && l.svc !== 'webmaild');
    const last = real[real.length - 1];
    const ips = new Set(real.filter(l => l.t > Date.now() - 7 * DAY).map(l => l.ip));
    return { id: 'logins', title: 'Accesos a los paneles', icon: 'key', status: f.some(x => x.sev === 'bad') ? 'bad' : f.some(x => x.sev === 'warn') ? 'warn' : 'ok', findings: f,
      items: [
        { label: 'Contraseñas equivocadas', value: failed.length.toLocaleString('es-VE'), sub: `últimos 7 días · ${failIps.size} IPs${scans ? ` · más ${scans.toLocaleString('es-VE')} toques de escáneres` : ''}` },
        { label: 'Entradas', value: String(real.filter(l => l.t > Date.now() - 7 * DAY).length), sub: `desde ${ips.size} IP${ips.size === 1 ? '' : 's'} esta semana` },
        ...(last ? [{ label: 'Última entrada', value: `${SVC[last.svc] || last.svc}`, sub: new Date(last.t).toLocaleString('es-VE', { hour12: false, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) }] : []),
        ...(tfa ? [{ label: 'Dos pasos', value: String(tfa.length), sub: tfa.includes('root') ? 'root protegido' : 'root sin protección' }] : []),
      ] };
  }
  // entradas recientes, para la ficha (privado)
  recent(limit = 15) {
    if (!this.data) return [];
    return this.data.logins.slice(-limit).reverse().map(l => ({ t: l.t, svc: SVC[l.svc] || l.svc, user: l.user, ip: l.ip, via: l.via, newIp: !!l.newIp }));
  }
}

module.exports = { LoginAudit, parseFailed, parseSessions, tail, firstTime };
