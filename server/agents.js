'use strict';
// Agentes de hosting compartido: cada cuenta de un hosting (cPanel, hPanel...) corre un script por cron
// que envia a Atalaya lo que puede leer de si misma. Aqui se vinculan, se autentican y se interpreta
// lo que mandan. Cada agente es un distrito "_host-<id>" con sus sitios, visitas y datos de la cuenta.
//  - vinculacion: codigo de un solo uso (24 h) -> token propio; se guarda solo el sha256 de ambos
//  - el agente solo recibe palabras de una lista cerrada ("full", "du"); nunca codigo
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const crypto = require('crypto');
const { readJSON, writeJSONAtomic, Ring } = require('./util');
const { scrub } = require('./privacy');

const SLUG = /^[a-z0-9][a-z0-9-]{0,30}$/;
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const safeEq = (a, b) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const CURRENT_AGENT = 1;
const STALE_MS = 5 * 60000;

class Agents {
  constructor(cfg, bus, secrets, logs) {
    this.cfg = cfg; this.bus = bus; this.secrets = secrets; this.logs = logs;
    this.dir = path.join(cfg.stateDir, 'agents');
    this.state = new Map(); // id -> estado vivo
    this.pending = new Map(); // id -> Set de pedidos para el proximo envio
    this.pairFails = new Map(); // ip -> { n, t }
    this.spreadMs = 55000;
  }

  reg() { this.secrets.sync(); return this.secrets.data.agents || (this.secrets.data.agents = {}); }
  ids() { return Object.keys(this.reg()); }
  account(id) { return '_host-' + id; }
  idOf(account) { return account && account.startsWith('_host-') ? account.slice(6) : null; }

  // alta: devuelve el codigo de vinculacion (se muestra una sola vez)
  create(id, label) {
    id = String(id || '').toLowerCase();
    if (!SLUG.test(id)) throw new Error('Nombre inválido: minúsculas, números y guiones (hasta 31)');
    const r = this.reg();
    if (r[id] && r[id].sha) throw new Error('Ya existe un hosting con ese nombre');
    this.secrets.checkLimit('agents', id);
    const code = crypto.randomBytes(8).toString('hex').toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
    r[id] = { label: String(label || id).slice(0, 60), pairSha: sha(code), pairExp: Date.now() + 86400000, added: new Date().toISOString() };
    this.secrets.save();
    return { id, code };
  }
  // nuevo codigo para un hosting existente (ej. reinstalar); el token anterior deja de valer al canjearlo
  recode(id) {
    const r = this.reg();
    if (!r[id]) throw new Error('No existe ese hosting');
    const code = crypto.randomBytes(8).toString('hex').toUpperCase().replace(/(.{4})(?=.)/g, '$1-');
    Object.assign(r[id], { pairSha: sha(code), pairExp: Date.now() + 86400000 });
    this.secrets.save();
    return { id, code };
  }
  remove(id) {
    const r = this.reg();
    if (!r[id]) throw new Error('No existe ese hosting');
    delete r[id]; this.secrets.save();
    this.state.delete(id);
    try { fs.unlinkSync(path.join(this.dir, id + '.json')); } catch { }
    if (this.logs) this.logs.loadDomains(true);
  }

  // canje del codigo: publico, con limite de intentos por IP
  pair(body, ip) {
    const f = this.pairFails.get(ip);
    if (f && f.n >= 10 && Date.now() - f.t < 3600000) return null;
    const code = String(body.code || '').toUpperCase();
    const h = sha(code);
    const r = this.reg();
    const id = Object.keys(r).find(k => r[k].pairSha && r[k].pairExp > Date.now() && safeEq(r[k].pairSha, h));
    if (!id) { this.pairFails.set(ip, { n: (f && Date.now() - f.t < 3600000 ? f.n : 0) + 1, t: Date.now() }); return null; }
    const token = crypto.randomBytes(32).toString('base64url');
    Object.assign(r[id], { sha: sha(token), pairSha: null, pairExp: 0, paired: new Date().toISOString(),
      user: String(body.user || '').slice(0, 64), host: String(body.host || '').slice(0, 128), kind: body.kind === 'wordpress' ? 'wordpress' : 'shell' });
    this.secrets.save();
    console.log(`[agente] vinculado ${id} (${r[id].user}@${r[id].host}) desde ${ip}`);
    return id + ':' + token;
  }

  // "id:token" -> id o null (tiempo constante)
  check(header) {
    const h = String(header || ''), i = h.indexOf(':');
    if (i < 1) return null;
    const id = h.slice(0, i), token = h.slice(i + 1);
    const r = this.reg();
    const a = Object.prototype.hasOwnProperty.call(r, id) ? r[id] : null;
    if (!a || !a.sha || token.length < 32) return null;
    return safeEq(sha(token), a.sha) ? id : null;
  }

  // pedido de un dueno ("Analizar ahora"): se entrega en la respuesta del proximo envio
  request(id, what) {
    if (!['full', 'du'].includes(what)) throw new Error('Pedido inválido');
    if (!this.reg()[id]) throw new Error('No existe ese hosting');
    if (!this.pending.has(id)) this.pending.set(id, new Set());
    this.pending.get(id).add(what);
    const s = this.get(id);
    if (what === 'du') s.duRequested = Date.now();
  }

  get(id) {
    if (!this.state.has(id)) {
      const saved = readJSON(path.join(this.dir, id + '.json'), null) || {};
      this.state.set(id, { lastPush: saved.lastPush || 0, meta: saved.meta || {}, vhosts: saved.vhosts || [], main: saved.main || '',
        quota: saved.quota || null, dbs: saved.dbs || [], ssl: saved.ssl || [], mail: saved.mail || [], usage: saved.usage || [],
        cron: saved.cron || [], disk: saved.disk || null, du: saved.du || null, fullAt: saved.fullAt || 0, wp: saved.wp || null, wpAt: saved.wpAt || 0,
        errlogs: new Map((saved.errlogs || []).map(e => [e.file, { ...e, recent: new Ring(20), hits: [] }])),
        pushes: 0, bytes: 0, duRequested: 0 });
    }
    return this.state.get(id);
  }

  // envio del agente (cuerpo gzip). Devuelve el texto de respuesta: "ok" + pedidos pendientes
  push(id, raw, encoding) {
    let buf = raw;
    if (/gzip/i.test(encoding || '')) buf = zlib.gunzipSync(raw, { maxOutputLength: 32 << 20 });
    const s = this.get(id);
    const secs = parse(buf.toString('utf8'));
    const meta = Object.fromEntries((secs.find(x => x.name === 'meta')?.body || '').split('\n').filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
    s.meta = meta; s.lastPush = Date.now(); s.pushes++; s.bytes += raw.length;
    let domainsChanged = false;
    const types = new Map();
    const lines = [];
    for (const x of secs) {
      const [kind, ...rest] = x.name.split(' ');
      if (kind === 'access') {
        const dom = rest.join(' ').toLowerCase();
        if (!/^[a-z0-9*.-]{1,253}$/.test(dom)) continue;
        for (const l of x.body.split('\n')) if (l) lines.push([dom, l]);
      } else if (kind === 'errlog') this.onErrlog(s, rest, x.body);
      else if (kind === 'uapi') {
        let j; try { j = JSON.parse(x.body); } catch { continue; }
        const data = j && j.result ? j.result.data : null;
        if (!data) continue;
        const fn = rest.join(' ');
        if (fn === 'DomainInfo domains_data') domainsChanged = this.onDomains(s, id, data) || domainsChanged;
        else if (fn === 'Quota get_quota_info') s.quota = { usedMB: Number(data.megabytes_used) || 0, limitMB: Number(data.megabyte_limit) || 0, inodes: Number(data.inodes_used) || 0, inodeLimit: Number(data.inode_limit) || 0 };
        else if (fn === 'Mysql list_databases') s.dbs = (Array.isArray(data) ? data : []).map(d => ({ name: String(d.database), size: Number(d.disk_usage) || 0, users: (d.users || []).length })).sort((a, b) => b.size - a.size);
        else if (fn === 'SSL installed_hosts') s.ssl = (Array.isArray(data) ? data : []).map(h => sslRow(h)).filter(Boolean);
        else if (fn === 'Email list_pops_with_disk') s.mail = (Array.isArray(data) ? data : []).map(m => ({ email: String(m.email || m.login || ''), used: Number(m._diskused) || 0, quota: Number(m._diskquota) || 0 })).sort((a, b) => b.used - a.used);
        else if (fn === 'ResourceUsage get_usages') s.usage = (Array.isArray(data) ? data : []).filter(u => u && u.id && !u.error).map(u => ({ id: String(u.id), label: String(u.description || u.id), usage: Number(u.usage) || 0, max: u.maximum == null ? null : Number(u.maximum), bytes: u.formatter === 'format_bytes' }));
      } else if (kind === 'crontab') s.cron = cronRows(x.body);
      else if (kind === 'docroots') for (const l of x.body.split('\n')) { const [d, t, v] = l.split('\t'); if (d && t) types.set(d, { type: t, wpVersion: v || '' }); }
      else if (kind === 'domains' && !s.vhosts.some(v => v.fromUapi)) {
        // sin uapi: dominio<TAB>carpeta
        const vh = x.body.split('\n').map(l => l.split('\t')).filter(([d, r]) => d && r).map(([d, r]) => ({ servername: d, aliases: ['www.' + d], docroot: r }));
        domainsChanged = setVhosts(s, vh, vh[0] ? vh[0].servername : '') || domainsChanged;
      } else if (kind === 'wp') {
        try { const j = JSON.parse(x.body); if (j && typeof j === 'object') { s.wp = j; s.wpAt = Date.now(); } } catch { }
      } else if (kind === 'disk') { const f = x.body.trim().split(/\s+/); if (f.length >= 4) s.disk = { total: Number(f[1]) * 1024, used: Number(f[2]) * 1024, avail: Number(f[3]) * 1024 }; }
      else if (kind === 'du') s.du = { at: Date.now(), rows: x.body.split('\n').map(l => { const i = l.indexOf('\t'); return i > 0 ? { size: Number(l.slice(0, i)) * 1024, path: l.slice(i + 1) } : null; }).filter(Boolean) };
    }
    if (types.size) {
      for (const v of s.vhosts) { const t = types.get(v.docroot); if (t && (v.type !== t.type || v.wpVersion !== t.wpVersion)) { Object.assign(v, t); domainsChanged = true; } }
      s.types = Object.fromEntries(types);
    }
    if (meta.full === '1') s.fullAt = Date.now();
    if (domainsChanged && this.logs) this.logs.loadDomains(true);
    this.spread(lines);
    if (meta.full === '1' || domainsChanged) this.save(id, s);
    const want = this.pending.get(id);
    this.pending.delete(id);
    return 'ok' + (want && want.size ? ' ' + [...want].join(' ') : '');
  }

  // las visitas llegan de a minuto: se reparten en los proximos segundos para que el mapa se vea vivo
  spread(lines) {
    if (!this.logs || !lines.length) return;
    const n = lines.length, max = Math.min(n, 5000);
    const step = this.spreadMs / max;
    for (let i = 0; i < n; i++) {
      const [dom, l] = lines[i];
      if (!this.spreadMs || i >= max) { this.logs.onAccess(dom, l); continue; }
      setTimeout(() => this.logs.onAccess(dom, l), Math.round(i * step));
    }
  }

  onDomains(s, id, data) {
    const vh = [];
    const main = data.main_domain || {};
    const aliasesOf = d => String(d.serveralias || '').split(/\s+/).filter(Boolean);
    if (main.domain) vh.push({ servername: main.domain, aliases: [...aliasesOf(main), ...(data.parked_domains || []).map(p => typeof p === 'string' ? p : p.domain).filter(Boolean)], docroot: main.documentroot || '', fromUapi: true });
    for (const d of [...(data.addon_domains || []), ...(data.sub_domains || [])]) if (d && d.domain) vh.push({ servername: d.domain, aliases: aliasesOf(d), docroot: d.documentroot || '', fromUapi: true });
    return setVhosts(s, vh, main.domain || '');
  }

  onErrlog(s, rest, body) {
    const [size, mtime, ...f] = rest;
    const file = f.join(' ');
    if (!file) return;
    const e = s.errlogs.get(file) || { file, size: 0, mtime: 0, recent: new Ring(20), hits: [] };
    e.size = Number(size) || 0; e.mtime = Number(mtime) * 1000 || 0;
    const now = Date.now();
    for (const l of body.split('\n')) {
      if (!l.trim()) continue;
      e.recent.push({ t: now, text: scrub(l.slice(0, 400)) });
      e.hits.push(now);
    }
    e.hits = e.hits.filter(t => now - t < 3600000);
    s.errlogs.set(file, e);
  }

  save(id, s) {
    try {
      fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const { errlogs, pushes, bytes, duRequested, ...rest } = s;
      writeJSONAtomic(path.join(this.dir, id + '.json'), { ...rest, errlogs: [...errlogs.values()].map(({ recent, hits, ...e }) => e) }, 0o600);
    } catch (e) { console.error('[agente] no se pudo guardar', e.message); }
  }

  // distritos virtuales, uno por hosting vinculado
  virtual() {
    const r = this.reg();
    let h = 0, w = 0;
    return Object.keys(r).filter(id => r[id].sha).map(id => r[id].kind === 'wordpress'
      ? { id: this.account(id), label: 'WordPress · ' + r[id].label, publicLabel: 'Sitio WordPress ' + (++w) }
      : { id: this.account(id), label: 'Hosting ' + r[id].label, publicLabel: 'Hosting ' + (++h) });
  }
  // catalogo de sitios para LogsCollector (mismo formato que un panel local)
  vhosts() {
    const out = [];
    for (const id of this.ids()) {
      const s = this.get(id);
      for (const v of s.vhosts) out.push({ account: this.account(id), servername: v.servername, aliases: v.aliases || [], docroot: v.docroot, remote: true,
        type: v.type || null, wpVersion: v.wpVersion || '', logs: [] });
    }
    return out;
  }
  mains() { return this.ids().map(id => [this.account(id), this.get(id).main]); }

  // resumen para el panel del distrito
  info(account, priv) {
    const id = this.idOf(account);
    if (!id || !this.reg()[id]) return null;
    const r = this.reg()[id], s = this.get(id), now = Date.now();
    const stale = !s.lastPush || now - s.lastPush > STALE_MS;
    const tilde = p => String(p || '').replace(/^\/home\d*\/[^/]+\/?/, '~/').replace(/^\/[^/]+\/[^/]+\/(?=public_html|domains)/, '~/');
    const soon = s.ssl.filter(c => c.expires && c.expires - now < 21 * 86400000);
    const errs = [...s.errlogs.values()].map(e => ({ file: tilde(e.file), size: e.size, mtime: e.mtime, lastHour: e.hits.filter(t => now - t < 3600000).length,
      recent: e.recent.toArray().slice(-8).reverse() })).sort((a, b) => b.lastHour - a.lastHour || b.mtime - a.mtime);
    const findings = [];
    if (stale) findings.push({ level: 'warn', text: s.lastPush ? `El agente no envía datos hace ${Math.round((now - s.lastPush) / 60000)} min: revise que la tarea cron siga activa.` : 'El agente todavía no envió datos.' });
    if (Number(s.meta.v || 0) < CURRENT_AGENT) findings.push({ level: 'info', text: 'Hay una versión más nueva del agente: reinstálelo con un código nuevo.' });
    for (const c of soon) findings.push({ level: c.expires < now ? 'warn' : 'info', text: c.expires < now ? `El certificado de ${c.domain} está vencido.` : `El certificado de ${c.domain} vence en ${Math.ceil((c.expires - now) / 86400000)} días${c.auto ? ' (AutoSSL debería renovarlo solo)' : ''}.` });
    if (s.quota && s.quota.limitMB && s.quota.usedMB / s.quota.limitMB > 0.85) findings.push({ level: 'warn', text: `La cuenta usa el ${Math.round(s.quota.usedMB / s.quota.limitMB * 100)}% de su cuota de disco.` });
    const nSecret = s.cron.filter(c => c.secret).length, nLog = s.cron.filter(c => c.logInDocroot).length;
    const tareas = n => n === 1 ? 'Una tarea cron lleva' : `${n} tareas cron llevan`;
    if (nSecret) findings.push({ level: 'warn', text: `${tareas(nSecret)} un token o contraseña escrito en la línea del cron: cualquiera con acceso a la cuenta lo ve. Conviene leerlo de un archivo fuera de public_html.` });
    if (nLog) findings.push({ level: 'warn', text: `${nLog === 1 ? 'Una tarea cron guarda' : nLog + ' tareas cron guardan'} su salida dentro de public_html: esos logs podrían descargarse desde la web si el servidor sirve esa carpeta.` });
    if (s.wp) findings.push(...wpFindings(s.wp, priv));
    const hotErr = errs.find(e => e.lastHour >= 20);
    if (hotErr) findings.push({ level: 'warn', text: `Un error_log sumó ${hotErr.lastHour} líneas en la última hora${priv ? ` (${hotErr.file})` : ''}.` });
    const out = {
      id, stale, lastPush: s.lastPush, fullAt: s.fullAt, agentVersion: Number(s.meta.v || 0), paired: !!r.sha,
      quota: s.quota, disk: s.disk, usage: s.usage.filter(u => ['disk_usage', 'cachedmysqldiskusage', 'bandwidth', 'lvecpu', 'lvememphy', 'lveep', 'lvenproc', 'lveiops', 'lveio', 'mailaccounts', 'addon_domains', 'subdomains'].includes(u.id)),
      dbCount: s.dbs.length, dbSize: s.dbs.reduce((n, d) => n + d.size, 0), mailCount: s.mail.length, mailSize: s.mail.reduce((n, m) => n + m.used, 0),
      sslCount: s.ssl.length, sslSoon: soon.length, cronCount: s.cron.length, errFiles: errs.length, errLastHour: errs.reduce((n, e) => n + e.lastHour, 0),
      kind: r.kind || 'shell', wp: s.wp ? wpSummary(s.wp, priv) : null,
      findings, duPending: !!(s.duRequested && (!s.du || s.du.at < s.duRequested)), duAt: s.du ? s.du.at : null,
    };
    if (priv) Object.assign(out, {
      user: r.user, host: r.host, label: r.label, load: s.meta.load || '',
      dbs: s.dbs.slice(0, 20), mail: s.mail.slice(0, 12).map(m => ({ ...m })), ssl: s.ssl.slice().sort((a, b) => (a.expires || 9e15) - (b.expires || 9e15)).slice(0, 20),
      cron: s.cron.map(c => ({ schedule: c.schedule, command: c.command })), errlogs: errs.slice(0, 10),
      du: s.du ? { at: s.du.at, rows: s.du.rows.slice(0, 60).map(x => ({ size: x.size, path: tilde(x.path) })) } : null,
    });
    return out;
  }
}

// ------------------------------------------------------------------ WordPress (lo que envia el plugin)
// fin del soporte de seguridad de cada rama de PHP (php.net/supported-versions)
const PHP_EOL = { '7.4': '2022-11-28', '8.0': '2023-11-26', '8.1': '2025-12-31', '8.2': '2026-12-31', '8.3': '2027-12-31', '8.4': '2028-12-31', '8.5': '2029-12-31' };
function phpStatus(v, now = Date.now()) {
  const m = String(v || '').match(/^(\d+)\.(\d+)/);
  if (!m) return null;
  const k = m[1] + '.' + m[2];
  const eol = PHP_EOL[k] ? Date.parse(PHP_EOL[k] + 'T23:59:59Z') : (Number(m[1]) < 7 || k < '7.4' ? 0 : null);
  if (eol == null) return { branch: k, eol: null, level: 'ok' };
  return { branch: k, eol, level: eol < now ? 'bad' : eol - now < 120 * 86400000 ? 'warn' : 'ok' };
}

function wpFindings(wp, priv) {
  const f = [];
  const add = (level, text) => f.push({ level, text });
  const plugins = Array.isArray(wp.plugins) ? wp.plugins : [], themes = Array.isArray(wp.themes) ? wp.themes : [];
  const upd = plugins.filter(p => p.update), inactive = plugins.filter(p => !p.active), tUpd = themes.filter(t => t.update), tIn = themes.filter(t => !t.active);
  if (wp.coreUpdate) add('warn', `Hay una versión nueva de WordPress (${wp.coreUpdate}); el sitio tiene la ${wp.version}. Actualice desde Escritorio › Actualizaciones, con un respaldo antes.`);
  if (upd.length) add(upd.length >= 5 ? 'bad' : 'warn', `${upd.length} plugin(s) con actualización pendiente${priv ? ': ' + upd.slice(0, 6).map(p => `${p.name} ${p.version} → ${p.update}`).join(', ') + (upd.length > 6 ? '…' : '') : ''}. Los plugins viejos son la causa más común de sitios hackeados.`);
  if (tUpd.length) add('warn', `${tUpd.length} tema(s) con actualización pendiente.`);
  if (inactive.length) add('info', `${inactive.length} plugin(s) desactivado(s)${priv ? ' (' + inactive.slice(0, 5).map(p => p.name).join(', ') + (inactive.length > 5 ? '…' : '') + ')' : ''}: si no los usa, bórrelos; aun desactivados pueden tener fallas explotables.`);
  if (tIn.length > 1) add('info', `${tIn.length} temas sin usar: deje solo el activo y uno por defecto.`);
  const php = phpStatus(wp.php);
  if (php && php.level !== 'ok') add(php.level, php.level === 'bad' ? `PHP ${php.branch} ya no recibe parches de seguridad. Cámbielo a 8.3 o superior en el panel del hosting (Seleccionar versión de PHP / MultiPHP).` : `PHP ${php.branch} deja de recibir parches de seguridad el ${new Date(php.eol).toLocaleDateString('es-VE')}. Planifique pasar a 8.3 o superior.`);
  if (wp.debugDisplay) add('bad', 'WP_DEBUG muestra los errores a los visitantes: revela rutas y detalles internos. En wp-config.php ponga WP_DEBUG_DISPLAY en false.');
  if (wp.debugLogPublic) add('warn', 'Existe wp-content/debug.log: se puede descargar desde la web y suele tener rutas y datos. Bórrelo o mueva el log fuera de la carpeta pública.');
  if (wp.https === false) add('bad', 'El sitio no usa HTTPS: las contraseñas viajan sin cifrar. Active el certificado y cambie la dirección del sitio a https://.');
  if (wp.adminUser) add('warn', 'Existe un usuario llamado "admin": es el primero que prueban los ataques. Cree otro administrador y borre ese.');
  if (wp.registration && ['administrator', 'editor', 'shop_manager'].includes(wp.defaultRole)) add('bad', `Cualquiera puede registrarse y recibe el rol "${wp.defaultRole}". Cambie el rol por defecto a "suscriptor" en Ajustes › Generales.`);
  else if (wp.registration) add('info', 'El registro de usuarios está abierto: si no lo necesita, ciérrelo en Ajustes › Generales.');
  if (wp.fileEdit) add('info', 'El editor de archivos de wp-admin está activo: si alguien entra como administrador, puede inyectar código. Agregue define(\'DISALLOW_FILE_EDIT\', true); a wp-config.php.');
  if (wp.admins > 3) add('info', `${wp.admins} administradores: revise que todos sigan siendo necesarios.`);
  if (wp.cronLate > 5) add('warn', `${wp.cronLate} tareas programadas atrasadas: WP-Cron no está corriendo a tiempo${wp.cronDisabled ? ' (DISABLE_WP_CRON activo sin un cron real)' : ' (pocas visitas)'}. Agregue una tarea cron del hosting que abra wp-cron.php cada 5 minutos.`);
  if (wp.autoload > 1048576) add('warn', `Las opciones que WordPress carga en cada visita pesan ${(wp.autoload / 1048576).toFixed(1)} MB: frenan todo el sitio. Suele ser un plugin que guarda de más; un plugin de limpieza de opciones lo resuelve.`);
  if (wp.xmlrpc) add('info', 'XML-RPC está activo: si no usa la app móvil ni Jetpack, desactívelo (es blanco de ataques de fuerza bruta).');
  return f;
}

function wpSummary(wp, priv) {
  const plugins = Array.isArray(wp.plugins) ? wp.plugins : [], themes = Array.isArray(wp.themes) ? wp.themes : [];
  const out = { version: wp.version, coreUpdate: wp.coreUpdate || '', php: wp.php, phpStatus: phpStatus(wp.php), db: wp.db, dbSize: wp.dbSize || 0,
    plugins: plugins.length, pluginsActive: plugins.filter(p => p.active).length, pluginUpdates: plugins.filter(p => p.update).length,
    themes: themes.length, themeUpdates: themes.filter(t => t.update).length, woocommerce: wp.woocommerce || '', users: wp.users || 0, admins: wp.admins || 0,
    https: wp.https !== false, multisite: !!wp.multisite };
  if (priv) Object.assign(out, { name: wp.name, home: wp.home,
    pluginList: plugins.slice().sort((a, b) => (b.update ? 1 : 0) - (a.update ? 1 : 0) || (b.active ? 1 : 0) - (a.active ? 1 : 0) || String(a.name).localeCompare(b.name))
      .map(p => ({ name: p.name, version: p.version, active: !!p.active, update: p.update || '', auto: !!p.auto })),
    themeList: themes.map(t => ({ name: t.name, version: t.version, active: !!t.active, update: t.update || '' })) });
  return out;
}

// cuerpo del agente: secciones "\n@@nombre\n<contenido>"
function parse(text) {
  const out = [];
  const parts = ('\n' + text).split('\n@@');
  for (const p of parts.slice(1)) {
    const i = p.indexOf('\n');
    out.push({ name: (i < 0 ? p : p.slice(0, i)).trim().slice(0, 600), body: i < 0 ? '' : p.slice(i + 1) });
  }
  return out;
}

function setVhosts(s, vh, main) {
  const key = x => x.map(v => v.servername + '|' + v.docroot + '|' + (v.aliases || []).join(',')).sort().join(';');
  // conserva el tipo ya detectado de cada carpeta
  for (const v of vh) { const t = s.types && s.types[v.docroot]; if (t) Object.assign(v, t); else { const o = s.vhosts.find(x => x.docroot === v.docroot); if (o) Object.assign(v, { type: o.type, wpVersion: o.wpVersion }); } }
  const changed = key(vh) !== key(s.vhosts) || s.main !== main;
  s.vhosts = vh; s.main = main;
  return changed;
}

function sslRow(h) {
  const c = h.certificate || {};
  const dom = h.servername || (h.domains || [])[0];
  if (!dom) return null;
  const na = Number(c.not_after) || 0;
  return { domain: String(dom), expires: na ? na * 1000 : null, issuer: String(c['issuer.organizationName'] || ''), selfSigned: !!Number(c.is_self_signed),
    auto: !!c.auto_ssl_provider_display_name || /let's encrypt|sectigo|cpanel/i.test(String(c['issuer.organizationName'] || '')) };
}

// lineas de crontab (sin comentarios ni variables); los secretos se tapan antes de guardar
function cronRows(body) {
  const out = [];
  for (const l of body.split('\n')) {
    const t = l.trim();
    if (!t || t.startsWith('#') || /^[A-Z_]+=/.test(t)) continue;
    const m = t.match(/^(@\w+|(?:\S+\s+){4}\S+)\s+(.*)$/);
    if (!m) continue;
    const clean = scrub(m[2]);
    const secret = clean !== m[2] || /(bearer|token|apikey|api_key|password|passwd|secret)[=: ]+\S{8,}/i.test(m[2]);
    out.push({ schedule: m[1], command: scrub(m[2].replace(/(bearer|token|apikey|api_key|password|passwd|secret)([=: ]+)\S{8,}/gi, '$1$2•••')).slice(0, 300),
      secret, logInDocroot: />>?\s*\S*\/public_html\/\S*\.(log|txt)\b/.test(m[2]) });
    if (out.length >= 60) break;
  }
  return out;
}

module.exports = { Agents, parse, cronRows, CURRENT_AGENT, wpFindings, phpStatus };
