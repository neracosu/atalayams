'use strict';
// Certificados SSL y servicios que se reinician solos, en solo lectura:
//  - certificados de cada dominio (/var/cpanel/ssl/apache_tls/<dominio>/certificates, solo la parte publica; nunca
//    se lee la llave), los del propio servidor (cPanel, correo, FTP: <svc>-NOT_AFTER) y los de Let's Encrypt sin panel
//  - reinicios que hizo el vigilante de cPanel (chkservd.log, ultimos 7 dias), servicios de systemd con reinicios
//    automaticos (NRestarts) o en estado fallido, y procesos que el kernel mato por falta de memoria
// Corre aparte cada 15 min (systemctl y journalctl son asincronos); la revision muestra lo ultimo que encontro.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { readJSON, writeJSONAtomic } = require('../util');

const DAY = 86400000;
const WARN_DAYS = 20, BAD_DAYS = 7; // AutoSSL renueva unos 30 dias antes: con menos de 20, la renovacion esta fallando
const ls = p => { try { return fs.readdirSync(p); } catch { return []; } };
const read = p => { try { return fs.readFileSync(p, 'utf8'); } catch { return null; } };
const RANK = { ok: 0, info: 0, unknown: 1, warn: 2, bad: 3 };
const worst = list => list.reduce((w, f) => (RANK[f.sev] > RANK[w] ? f.sev : w), 'ok');
function run(cmd, args, timeout = 20000) {
  return new Promise(res => execFile(cmd, args, { timeout, maxBuffer: 8 << 20 }, (err, out) => res(err && !out ? '' : String(out || ''))));
}
// el primer certificado de un PEM (el del dominio; los siguientes son la cadena)
function firstCert(pem) {
  const m = /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/.exec(pem || '');
  if (!m) return null;
  try { return new crypto.X509Certificate(m[0]); } catch { return null; }
}
function covers(cert, domain) {
  const names = String(cert.subjectAltName || '').split(',').map(s => s.trim().replace(/^DNS:/, '').toLowerCase());
  return names.some(n => n === domain || (n.startsWith('*.') && domain.endsWith(n.slice(1)) && domain.split('.').length === n.split('.').length));
}
// dominio -> cuenta, de /etc/userdomains (solo se revisan dominios que siguen perteneciendo a una cuenta)
function userDomains(file = '/etc/userdomains') {
  const m = new Map();
  for (const l of String(read(file) || '').split('\n')) { const x = /^([^:\s]+):\s*(\S+)/.exec(l); if (x && x[2] !== 'nobody') m.set(x[1].toLowerCase(), x[2]); }
  return m;
}

// ------------------------------------------------------------------ certificados
function certificates(opts = {}) {
  const base = opts.sslBase || '/var/cpanel/ssl', now = opts.now || Date.now();
  const owners = userDomains(opts.userdomains);
  const out = [];
  for (const d of ls(path.join(base, 'apache_tls'))) {
    const domain = d.toLowerCase();
    if (owners.size && !owners.has(domain)) continue;
    // el alias que cPanel crea para cada dominio adicional (dominio.com.principal.com): nadie lo visita
    if ([...owners.keys()].some(o => o !== domain && domain.startsWith(o + '.') && owners.has(domain.slice(o.length + 1)))) continue;
    const c = firstCert(read(path.join(base, 'apache_tls', d, 'certificates')));
    if (!c) continue;
    const self = c.issuer === c.subject;
    out.push({ domain, account: owners.get(domain) || null, until: Date.parse(c.validTo), issuer: (/O=([^\n]+)/.exec(c.issuer) || /CN=([^\n]+)/.exec(c.issuer) || [])[1] || '?', self, covers: covers(c, domain) });
  }
  // los del servidor, solo si el servicio esta escuchando (sin FTP activo, su certificado vencido no importa)
  const ports = opts.ports || null;
  for (const [svc, label, pp] of [['cpanel', 'cPanel y WHM', [2083, 2087, 2096]], ['exim', 'correo saliente (Exim)', [25, 465, 587]], ['dovecot', 'correo entrante (Dovecot)', [993, 995, 143, 110]], ['ftp', 'FTP', [21, 990]]]) {
    if (ports && !pp.some(p => ports.has(p))) continue;
    const na = +String(read(path.join(base, svc + '-NOT_AFTER')) || '').trim();
    if (na) out.push({ service: svc, label, domain: String(read(path.join(base, svc + '-CN')) || '').trim() || null, until: na * 1000 });
  }
  // sin panel: Let's Encrypt de certbot
  for (const d of ls(opts.leBase || '/etc/letsencrypt/live')) {
    const c = firstCert(read(path.join(opts.leBase || '/etc/letsencrypt/live', d, 'cert.pem')));
    if (c) out.push({ domain: d, account: null, until: Date.parse(c.validTo), issuer: "Let's Encrypt", self: false, covers: covers(c, d) });
  }
  for (const r of out) r.days = Math.floor((r.until - now) / DAY);
  return out.sort((a, b) => a.until - b.until);
}

// ------------------------------------------------------------------ reinicios de cPanel (chkservd)
// lee solo el final del registro (puede pesar cientos de MB): bloques "[fecha] Service check" seguidos de "Restarting x"
function chkservdRestarts(file = '/var/log/chkservd.log', since = Date.now() - 7 * DAY, tailBytes = 6 << 20) {
  let txt = '';
  try {
    const fd = fs.openSync(file, 'r'); const size = fs.fstatSync(fd).size, len = Math.min(size, tailBytes);
    const buf = Buffer.alloc(len); fs.readSync(fd, buf, 0, len, size - len); fs.closeSync(fd); txt = buf.toString('utf8');
  } catch { return null; }
  const out = {}; let t = 0;
  for (const l of txt.split('\n')) {
    const d = /^\[(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) ([+-]\d\d)(\d\d)\]/.exec(l);
    if (d) { t = Date.parse(`${d[1].replace(' ', 'T')}${d[2]}:${d[3]}`); continue; }
    const r = /Restarting ([A-Za-z0-9_-]+)\.\.\./.exec(l);
    if (r && t >= since) { const s = out[r[1]] || (out[r[1]] = { n: 0, last: 0, why: '' }); s.n++; s.last = t; s.why = (/\[check command output:([^\]]*)/.exec(l) || /^([^[]{8,})\[/.exec(l) || [])[1] || s.why; }
  }
  return out;
}

// ------------------------------------------------------------------ systemd
const IGNORE_FAILED = /^(systemd-networkd-wait-online|NetworkManager-wait-online)\.service$/;
async function systemdState() {
  const failed = (await run('systemctl', ['list-units', '--type=service', '--state=failed', '--no-legend', '--plain']))
    .split('\n').map(l => l.trim().split(/\s+/)[0]).filter(u => u && u.endsWith('.service') && !IGNORE_FAILED.test(u));
  const running = (await run('systemctl', ['list-units', '--type=service', '--state=running', '--no-legend', '--plain']))
    .split('\n').map(l => l.trim().split(/\s+/)[0]).filter(u => u && u.endsWith('.service'));
  const restarts = [];
  if (running.length) {
    const txt = await run('systemctl', ['show', '-p', 'Id,NRestarts,ActiveEnterTimestamp', ...running]);
    for (const blk of txt.split('\n\n')) {
      const o = {}; for (const l of blk.split('\n')) { const i = l.indexOf('='); if (i > 0) o[l.slice(0, i)] = l.slice(i + 1); }
      if (+o.NRestarts > 0) restarts.push({ unit: o.Id, n: +o.NRestarts, since: Date.parse(o.ActiveEnterTimestamp) || null });
    }
  }
  const failedInfo = [];
  for (const u of failed.slice(0, 12)) {
    const o = {}; for (const l of (await run('systemctl', ['show', '-p', 'Description,Result,InactiveEnterTimestamp', u])).split('\n')) { const i = l.indexOf('='); if (i > 0) o[l.slice(0, i)] = l.slice(i + 1); }
    failedInfo.push({ unit: u, desc: o.Description || '', result: o.Result || '', at: Date.parse(o.InactiveEnterTimestamp) || null });
  }
  return { failed: failedInfo, restarts: restarts.sort((a, b) => b.n - a.n) };
}
// procesos que el kernel mato por falta de memoria (ultimos 7 dias)
async function oomKills() {
  const txt = await run('journalctl', ['-k', '--since', '-7d', '--no-pager', '-o', 'short-unix', '-g', 'Killed process'], 15000);
  const out = [];
  for (const l of txt.split('\n')) { const m = /^(\d+)\.\d+ .*Killed process \d+ \(([^)]+)\)/.exec(l); if (m) out.push({ t: +m[1] * 1000, proc: m[2] }); }
  return out;
}

const SVC_NAME = { httpd: 'Apache', mysql: 'MySQL', named: 'DNS (named)', exim: 'correo saliente (Exim)', imap: 'correo (IMAP)', pop: 'correo (POP)', lmtp: 'entrega de correo (LMTP)', cpsrvd: 'cPanel', apache_php_fpm: 'PHP-FPM', spamd: 'antispam (SpamAssassin)', ftpd: 'FTP', sshd: 'SSH', crond: 'cron', 'cpanel_php_fpm': 'PHP de cPanel', dnsadmin: 'administrador de DNS', queueprocd: 'cola de tareas de cPanel', cpanellogd: 'estadísticas de cPanel' };
const fmtDate = t => new Date(t).toLocaleDateString('es-VE', { day: 'numeric', month: 'short' });

class ServiceAudit {
  constructor(cfg, bus, opts = {}) {
    this.cfg = cfg; this.bus = bus; this.opts = opts;
    this.file = path.join(cfg.stateDir, 'audits', 'services.json');
    this.notified = (readJSON(this.file, null) || {}).notified || {};
    this.data = null;
  }
  available() { return (this.cfg.edition || 'vps') === 'vps'; }
  start() { if (!this.available()) return; setTimeout(() => this.refresh(), 20000); setInterval(() => this.refresh(), 15 * 60000).unref(); }
  async refresh() {
    const now = Date.now();
    let ports = null;
    if (!this.opts.sslBase) try { ports = new Set([...require('./host').listening().values()].map(e => e.port)); } catch { }
    const certs = certificates({ ...this.opts, ports: this.opts.ports || ports });
    const chk = chkservdRestarts(this.opts.chkservd);
    const sd = this.opts.systemd === false ? { failed: [], restarts: [] } : await systemdState();
    const oom = this.opts.systemd === false ? [] : await oomKills();
    this.data = { t: now, certs, chk, sd, oom };
    this.notify(certs);
    if (this.onUpdate) try { this.onUpdate(); } catch { }
    return this.data;
  }
  // un aviso por certificado y nivel (se recuerda entre reinicios para no repetir)
  notify(certs) {
    if (!this.bus) return;
    let changed = false;
    for (const c of certs) {
      const lv = c.days < 0 ? 'expired' : c.days <= BAD_DAYS ? 'bad' : c.days <= WARN_DAYS ? 'warn' : null;
      const key = c.service ? 'svc:' + c.service : c.domain;
      if (!lv) { if (this.notified[key]) { delete this.notified[key]; changed = true; } continue; }
      const mark = lv + ':' + c.until;
      if (this.notified[key] === mark) continue;
      this.notified[key] = mark; changed = true;
      this.bus.emit('ev', { kind: 'cert', action: lv, domain: c.domain, account: c.account || null, service: c.label || null, days: c.days });
    }
    if (changed) try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeJSONAtomic(this.file, { notified: this.notified }); } catch { }
  }
  certOf(domain) { const d = String(domain || '').toLowerCase(); return this.data && this.data.certs.find(c => c.domain === d && !c.service) || null; }

  section() {
    if (!this.available() || !this.data) return null;
    const { certs, chk, sd, oom } = this.data, f = [];
    // certificados
    const siteCerts = certs.filter(c => !c.service);
    for (const c of certs) {
      const who = c.service ? `El certificado de ${c.label}` : `El certificado de ${c.domain}`;
      const fix = c.service ? 'En WHM › Service Configuration › Manage Service SSL Certificates renuévelo (o pulse «Reset Certificate» para uno nuevo de AutoSSL).'
        : 'En WHM › SSL/TLS › Manage AutoSSL › Logs vea por qué no se renovó (lo usual: el dominio ya no apunta a este servidor o Cloudflare bloquea la validación) y pulse «Run AutoSSL» para esa cuenta.';
      if (c.days < 0) f.push({ sev: 'bad', title: `${who} venció hace ${-c.days} día${c.days === -1 ? '' : 's'}`, detail: c.service ? 'Los programas de correo y los navegadores muestran un aviso de seguridad.' : 'Los visitantes ven «La conexión no es privada» y los buscadores lo castigan.', fix, names: c.account ? [c.account] : undefined });
      else if (c.days <= BAD_DAYS) f.push({ sev: 'bad', title: `${who} vence en ${c.days} día${c.days === 1 ? '' : 's'}`, detail: `Vence el ${fmtDate(c.until)} y no se ha renovado.`, fix, names: c.account ? [c.account] : undefined });
      else if (c.days <= WARN_DAYS) f.push({ sev: 'warn', title: `${who} vence en ${c.days} días`, detail: `Vence el ${fmtDate(c.until)}. La renovación automática suele hacerse unos 30 días antes, así que parece estar fallando.`, fix, names: c.account ? [c.account] : undefined });
      if (!c.service && c.self && c.days >= 0) f.push({ sev: 'warn', title: `${c.domain} usa un certificado autofirmado`, detail: c.domain.startsWith('*.') ? 'Cualquier subdominio sin certificado propio muestra «La conexión no es privada» (si pasa por Cloudflare en modo Full, Cloudflare lo acepta y el visitante no lo nota).' : 'Los navegadores lo marcan como inseguro, salvo que el dominio pase por Cloudflare en modo Full.', fix: c.domain.startsWith('*.') ? 'AutoSSL no emite comodines por HTTP: dé a cada subdominio que se use su propio certificado (AutoSSL lo hace solo al crearlo), o ponga el dominio detrás de Cloudflare.' : 'Active AutoSSL para la cuenta (WHM › SSL/TLS › Manage AutoSSL) o instale uno válido.', names: c.account ? [c.account] : undefined });
      else if (!c.service && !c.covers && c.days >= 0) f.push({ sev: 'warn', title: `El certificado de ${c.domain} no cubre ese nombre`, detail: 'Es de otro dominio: el navegador muestra un aviso.', fix: 'Vuelva a correr AutoSSL para la cuenta para que emita uno con este nombre.', names: c.account ? [c.account] : undefined });
    }
    // reinicios de cPanel
    for (const [svc, s] of Object.entries(chk || {}).sort((a, b) => b[1].n - a[1].n)) {
      if (s.n < 2) continue;
      const name = SVC_NAME[svc] || svc;
      f.push({ sev: s.n >= 10 ? 'bad' : 'warn', title: `${name} se reinició solo ${s.n} veces esta semana`, detail: `El vigilante de cPanel lo encontró caído y lo levantó; la última vez el ${fmtDate(s.last)}.${s.why ? ' Motivo: ' + s.why.trim().slice(0, 160) : ''}`, fix: svc === 'httpd' ? 'Suele ser por falta de memoria o demasiadas conexiones: revise la saturación y los procesos PHP-FPM, y el error_log de Apache a esa hora.' : svc === 'mysql' ? 'Revise /var/lib/mysql/*.err a esa hora (memoria, tablas dañadas o disco lleno).' : `Revise el registro de ${name} a la hora del reinicio (journalctl -u o /var/log).` });
    }
    // systemd
    const flappy = sd.restarts.filter(r => r.n >= 3);
    for (const r of flappy.slice(0, 6)) f.push({ sev: r.n >= 10 ? 'bad' : 'warn', title: `${r.unit.replace(/\.service$/, '')} se reinició solo ${r.n} veces`, detail: `Se cae y systemd lo vuelve a levantar${r.since ? ` (arriba desde el ${fmtDate(r.since)})` : ''}.`, fix: `Revise por qué se cae: journalctl -u ${r.unit} alrededor de los reinicios.` });
    if (sd.failed.length) f.push({ sev: 'warn', title: `${sd.failed.length} servicio${sd.failed.length === 1 ? '' : 's'} en estado fallido`, detail: sd.failed.map(x => `${x.unit.replace(/\.service$/, '')}${x.desc ? ` (${x.desc})` : ''}${x.at ? ', desde el ' + fmtDate(x.at) : ''}`).join('; ').replace(/\.?$/, '.'), fix: 'Si alguno ya no se usa, desactívelo (systemctl disable); si se usa, revise su registro con journalctl -u y vuelva a iniciarlo.', rows: sd.failed });
    // memoria
    if (oom.length) {
      const by = {}; for (const k of oom) by[k.proc] = (by[k.proc] || 0) + 1;
      f.push({ sev: oom.length >= 3 ? 'bad' : 'warn', title: `El sistema mató ${oom.length} proceso${oom.length === 1 ? '' : 's'} por falta de memoria esta semana`, detail: Object.entries(by).map(([p, n]) => `${p} (${n})`).join(', ') + `; la última vez el ${fmtDate(oom[oom.length - 1].t)}.`, fix: 'Baje pm.max_children o la memoria de las apps Node, o sume memoria o swap al servidor.' });
    }
    const next = siteCerts.find(c => c.days >= 0);
    const restartsWeek = Object.values(chk || {}).reduce((a, s) => a + s.n, 0);
    return { id: 'services', title: 'Certificados y servicios', icon: 'shield', status: worst(f), findings: f,
      items: [
        { label: 'Certificados', value: String(siteCerts.length), sub: next ? `el próximo vence en ${next.days} días (${next.domain})` : '' },
        { label: 'Reinicios automáticos', value: String(restartsWeek + sd.restarts.reduce((a, r) => a + r.n, 0)), sub: 'cPanel esta semana + systemd' },
        { label: 'Servicios fallidos', value: String(sd.failed.length) },
      ] };
  }
}

module.exports = { ServiceAudit, certificates, chkservdRestarts, covers, firstCert };
