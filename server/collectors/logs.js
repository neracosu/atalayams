'use strict';
// Logs en vivo: accesos de Apache por dominio, SSH/cPHulk y correo de Exim
const fs = require('fs');
const path = require('path');
const { Tailer, Ring, readTailLines } = require('../util');
const fx = require('../platform/fsx');
const { parseUA } = require('../ua');

// formato combined: ip - - [fecha] "METODO ruta HTTP/x" estado bytes "referer" "agente"
const LOG_RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(\S+) (\S*)[^"]*" (\d{3}) (\S+) "([^"]*)" "([^"]*)"/;
// registro de trafico de cPanel (una linea por peticion, de todos los sitios, escrito al instante):
// "[apache-traffic.log] fecha protocolo tls host bytes_in bytes_out ip_cliente ip"
const TRAFFIC_RE = /^(?:\S+\.log )?\d{4}-\d\d-\d\d \S+ \S+ (\S+) \S+ \S+ (\S+)/;
const TRAFFIC_LOG = '/var/log/cpanel-server-traffic/web/traffic-apache.log';
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
// "25/Sep/2026:19:22:11 -0700" -> milisegundos
function logTime(s) {
  const m = /^(\d\d)\/(\w{3})\/(\d{4}):(\d\d):(\d\d):(\d\d) ([+-])(\d\d)(\d\d)/.exec(s || '');
  if (!m) return Date.now();
  const off = (m[7] === '-' ? -1 : 1) * (Number(m[8]) * 60 + Number(m[9]));
  return Date.UTC(+m[3], MONTHS[m[2]] ?? 0, +m[1], +m[4], +m[5], +m[6]) - off * 60000;
}
const SKIP_PREFIX = /^(www|mail|cpanel|webmail|webdisk|cpcalendars|cpcontacts|autodiscover|autoconfig)\./;
const TYPE_LABEL = { wordpress: 'Sitio WordPress', php: 'Sitio PHP', static: 'Sitio web', proxy: 'Proxy a servicio', wip: 'Sitio en construcción', empty: 'Sin contenido' };

class LogsCollector {
  constructor(cfg, bus, host) {
    this.cfg = cfg;
    this.bus = bus;
    this.host = host;
    this.tailers = new Map();
    this.domains = new Map(); // dominio -> grupo (sitio o app)
    this.groups = new Map(); // cuenta:carpeta -> grupo
    this.sites = []; // grupos que no son apps de PM2
    this.mainDomain = new Map(); // cuenta -> dominio principal
    this.changes = new Ring(100); // altas, bajas y cambios de dominios
    this.geo = null; // lo asigna index.js
    // visitas que no vienen de logs locales (ej. Vercel Drains) tambien suman al trafico
    if (bus.on) bus.on('ev', e => { if (e.kind === 'http' && e.via) this.countExternal(e); });
    this.platform = null; // deteccion de plataforma (index.js)
    this.logMap = new Map();
    this.minute = this.newBucket();
    this.history = new Ring(60); // req por intervalo de 10 s, 10 min
    this.bucket10 = { t: Date.now(), req: 0, err: 0, bots: 0 };
    this.lastMinute = { req: 0, err: 0, perAccount: {}, perApp: {}, perSite: {} };
    this.security = { failed: 0, blocked: 0, logins: 0 };
    this.mail = { out: 0, in: 0, bounce: 0 };
    // cPanel escribe los logs de cada dominio por tandas (splitlogs los acumula hasta llenar un bufer): en un
    // sitio con poco trafico las visitas llegan con minutos de atraso. Si existe el registro de trafico (escrito
    // al instante), las visitas se cuentan de ahi, en vivo, y los logs de cada dominio aportan el detalle
    // (pagina, codigo, navegador, origen) con su hora real.
    this.live = false; this.liveSeen = 0;
    this.botIps = new Map(); // ip -> ultima vez que se la vio como robot (aprendido de los logs con navegador)
  }

  newBucket() { return { t: Date.now(), req: 0, err: 0, perAccount: {}, perApp: {}, perSite: {} }; }

  start() {
    this.startedAt = Date.now();
    this.loadDomains();
    this.scanDomlogs();
    const d = this.platform || {};
    const T = (key, file, fn) => { if (file) this.tailers.set(key, new Tailer(fx.P(file), fn)); };
    T('auth', d.auth, l => this.onAuth(l));
    for (const b of d.bans || []) T('ban:' + b.kind, b.file, b.kind === 'cphulk' ? l => this.onHulk(l) : b.kind === 'fail2ban' ? l => this.onFail2ban(l) : l => this.onLfd(l));
    if (d.mail) {
      const onMail = d.mail.kind === 'postfix' ? l => this.onPostfix(l) : l => this.onExim(l);
      // lo ultimo del log al arrancar: la ficha de Correo no empieza vacia (sin animar: llega como tardio)
      try { this.mailLate = true; for (const l of readTailLines(fx.P(d.mail.file), 256 * 1024).lines) onMail(l); } catch { } finally { this.mailLate = false; }
      T('mail', d.mail.file, onMail);
    }
    const traffic = (this.cfg.logs && this.cfg.logs.traffic) || (this.platform && this.platform.panel && this.platform.panel.id === 'cpanel' ? TRAFFIC_LOG : null);
    if (traffic && fx.exists(traffic)) T('traffic', traffic, l => this.onTraffic(l));
    setInterval(() => { for (const t of this.tailers.values()) t.poll().catch(() => {}); }, 1000);
    // respaldo por si el vigilante de index.js no ve el cambio
    setInterval(() => { this.loadDomains(true); this.scanDomlogs(); }, 60000);
    setInterval(() => this.roll10(), 10000);
    setInterval(() => { this.lastMinute = this.minute; this.minute = this.newBucket(); }, 60000);
  }

  // Catalogo de sitios desde /var/cpanel/userdata: cada vhost con sus alias, agrupados por carpeta.
  // Cada grupo es una app de PM2 (si la carpeta es la suya o su .htaccess apunta a su puerto) o un sitio propio.
  loadDomains(emitChanges = false) {
    const panel = this.platform && this.platform.panel;
    if (!panel && !this.extra) return;
    const prevGroups = this.groups;
    const domains = new Map(), groups = new Map();
    const main = new Map(panel ? panel.accounts().map(a => [a.id, a.main || '']) : []);
    // sitios de hostings remotos (agentes): llegan ya clasificados, sin archivos locales
    const extra = this.extra ? this.extra.vhosts() : [];
    if (this.extra) for (const [a, m] of this.extra.mains()) main.set(a, m);
    const logMap = new Map(); // archivo de log -> dominio que lo escribe ('' si es un log compartido)
    for (const v of [...(panel ? panel.vhosts() : []), ...extra]) {
      const key = v.account + ':' + (v.docroot || v.servername);
      const g = groups.get(key) || { id: key, account: v.account, docroot: v.docroot, names: new Set(), servernames: [], logs: new Set(), proxyPort: null,
        ...(v.remote ? { remote: true, remoteType: v.type, remoteWp: v.wpVersion } : {}) };
      g.servernames.push(v.servername);
      for (const n of [v.servername, ...(v.aliases || [])]) { if (!SKIP_PREFIX.test(n)) g.names.add(n); domains.set(n, g); }
      for (const f of v.logs || []) { g.logs.add(f); if (!logMap.has(f)) logMap.set(f, v.servername); }
      if (v.sharedLog && !logMap.has(v.sharedLog)) logMap.set(v.sharedLog, '');
      g.proxyPort = g.proxyPort || v.proxyPort || null;
      groups.set(key, g);
    }
    for (const g of groups.values()) {
      const md = main.get(g.account);
      const names = [...g.names];
      // nombre visible: el dominio "real" (addon) antes que el subdominio tecnico del panel
      const real = names.filter(n => !n.startsWith('*') && (!md || n === md || !n.endsWith('.' + md)));
      g.domain = (real.length ? real : names).sort((a, b) => a.length - b.length)[0] || g.servernames[0];
      g.domainList = names.sort((a, b) => (a === g.domain ? -1 : b === g.domain ? 1 : a.length - b.length));
      Object.assign(g, this.classify(g));
      // ultima visita: fecha del log mas reciente del sitio
      g.lastSeen = 0;
      for (const f of g.logs) { const st = fx.stat(f); if (st && st.size > 0) g.lastSeen = Math.max(g.lastSeen, st.mtimeMs); }
      // sin pagina de inicio pero con visitas recientes: se muestra como sitio en construccion
      if (g.type === 'empty' && Date.now() - g.lastSeen < 7 * 86400000) g.type = 'wip';
    }
    if (!domains.size && panel) return; // un panel sin sitios suele ser una lectura fallida: se conserva lo anterior
    this.domains = domains; this.groups = groups; this.mainDomain = main; this.logMap = logMap; this.bindApps();
    if (emitChanges && prevGroups && prevGroups.size) this.diffDomains(prevGroups, groups);
  }

  // compara el catalogo anterior con el nuevo: dominios que aparecen, desaparecen o cambian de tipo
  diffDomains(before, after) {
    const names = gs => { const m = new Map(); for (const g of gs.values()) for (const n of g.domainList) m.set(n, g); return m; };
    const a = names(before), b = names(after);
    const label = g => (g.app ? 'App ' + g.app : TYPE_LABEL[g.type] || 'Sitio');
    for (const [n, g] of b) if (!a.has(n)) {
      this.bus.emit('ev', { kind: 'domain', action: 'added', account: g.account, domain: n, what: label(g), typeLabel: g.app ? 'Servicio' : TYPE_LABEL[g.type] });
      this.changes.push({ t: Date.now(), action: 'added', account: g.account, domain: n, what: label(g) });
    }
    for (const [n, g] of a) if (!b.has(n)) {
      this.bus.emit('ev', { kind: 'domain', action: 'removed', account: g.account, domain: n, what: label(g), typeLabel: g.app ? 'Servicio' : TYPE_LABEL[g.type] });
      this.changes.push({ t: Date.now(), action: 'removed', account: g.account, domain: n, what: label(g) });
    }
    for (const [id, g] of after) {
      const old = before.get(id);
      if (old && (old.type !== g.type || old.app !== g.app)) {
        this.bus.emit('ev', { kind: 'domain', action: 'changed', account: g.account, domain: g.domain, what: `${label(old)} → ${label(g)}`, typeLabel: g.app ? 'Servicio' : TYPE_LABEL[g.type] });
        this.changes.push({ t: Date.now(), action: 'changed', account: g.account, domain: g.domain, what: `${label(old)} → ${label(g)}` });
      }
    }
  }

  // tipo de sitio mirando la carpeta (solo lectura, sin seguir nada raro)
  classify(g) {
    if (g.remote) return { type: g.remoteType || 'empty', ...(g.remoteType === 'wordpress' ? { wpVersion: g.remoteWp || '' } : {}) };
    if (!g.docroot) return g.proxyPort ? { type: 'proxy', proxyPort: g.proxyPort } : { type: 'empty' };
    const has = f => fx.exists(g.docroot + '/' + f);
    const ht = fx.read(g.docroot + '/.htaccess');
    const port = g.proxyPort || Number((ht.match(/^[^#\n]*127\.0\.0\.1:(\d{2,5})/m) || [])[1]) || null;
    if (port) return { type: 'proxy', proxyPort: port };
    if (has('wp-config.php') || has('wp-includes/version.php')) {
      const v = fx.read(g.docroot + '/wp-includes/version.php').match(/\$wp_version\s*=\s*'([^']+)'/);
      return { type: 'wordpress', wpVersion: v ? v[1] : '' };
    }
    if (has('index.php')) return { type: 'php' };
    if (has('index.html') || has('index.htm')) return { type: 'static' };
    return { type: 'empty' };
  }

  // une cada grupo con su app de PM2 (por carpeta o por puerto del proxy); el resto son sitios
  bindApps() {
    const apps = this.host.apps;
    this.sites = [];
    for (const g of this.groups.values()) {
      // 1) el .htaccess apunta a su puerto  2) la carpeta es exactamente la suya
      // 3) la carpeta cuelga de la suya, salvo que la app corra desde el home o public_html (ej. n8n en ~)
      const home = '/home/' + g.account;
      const inside = a => a.cwd && a.cwd !== home && a.cwd !== home + '/public_html' && g.docroot.startsWith(a.cwd + '/');
      const app = (g.proxyPort && apps.find(a => a.port === g.proxyPort))
        || apps.find(a => a.account === g.account && a.cwd === g.docroot)
        || apps.find(a => a.account === g.account && inside(a)) || null;
      g.app = app ? app.name : null;
      if (!g.app && g.type !== 'empty') this.sites.push(g);
    }
    this.sites.sort((a, b) => a.account.localeCompare(b.account) || a.domain.localeCompare(b.domain));
    this.boundAppsKey = apps.map(a => a.account + a.name + a.port).join('|');
  }
  siteLabel(g) { const c = (this.cfg.sites || {})[g.domain]; return (c && c.label) || TYPE_LABEL[g.type] || 'Sitio web'; }
  // icono del catalogo o el de 'en construccion'; el resto recibe uno propio (ver pickIcon en privacy.js)
  siteIcon(g) { const c = (this.cfg.sites || {})[g.domain]; return (c && c.icon) || (g.type === 'wip' ? 'wip' : null); }

  // dominio del log -> cuenta, app o sitio
  appFor(domain) {
    const g = this.domains.get(domain) || this.domains.get('*.' + domain.split('.').slice(1).join('.'));
    if (!g) return { account: null, app: null, site: null };
    if (this.boundAppsKey !== this.host.apps.map(a => a.account + a.name + a.port).join('|')) this.bindApps();
    return { account: g.account, app: g.app, site: g.app ? null : g.id, group: g };
  }

  // abre (o cierra) el seguimiento de cada log de visitas segun el catalogo del proveedor
  scanDomlogs() {
    const want = this.logMap || new Map();
    for (const k of [...this.tailers.keys()]) if (k.startsWith('/') && (!want.has(k) || !fx.exists(k))) this.tailers.delete(k);
    for (const [file, domain] of want) {
      if (this.tailers.has(file) || !fx.exists(file)) continue;
      // se relee la ultima parte del log al abrirlo: la ultima hora vuelve a los paneles de detalle
      this.tailers.set(file, new Tailer(fx.P(file), l => this.onAccess(domain, l), { fromEnd: true, backfill: 192 * 1024 }));
    }
  }

  // el registro de trafico esta vivo si se escribio hace poco
  liveOn() { return this.live && Date.now() - this.liveSeen < 10 * 60000; }
  count(account, app, site, status, bot) {
    const b = this.minute;
    b.req++; if (status >= 500) b.err++;
    if (account) b.perAccount[account] = (b.perAccount[account] || 0) + 1;
    if (app) b.perApp[account + '/' + app] = (b.perApp[account + '/' + app] || 0) + 1;
    if (site) b.perSite[site] = (b.perSite[site] || 0) + 1;
    this.bucket10.req++; if (status >= 500) this.bucket10.err++; if (bot) this.bucket10.bots++;
  }

  // una peticion del registro de trafico: cuenta en vivo (sin pagina ni codigo: eso llega despues por el log del dominio)
  onTraffic(line) {
    const m = TRAFFIC_RE.exec(line);
    if (!m) return;
    this.live = true; this.liveSeen = Date.now();
    const domain = m[1].toLowerCase().replace(/:\d+$/, '').replace(/\.$/, ''), ip = m[2];
    const { account, app, site } = this.appFor(domain);
    const seen = this.botIps.get(ip), bot = !!seen && Date.now() - seen < 6 * 3600000;
    this.count(account, app, site, 0, bot);
    const geo = this.geo ? this.geo.country(ip) : null;
    this.bus.emit('ev', { kind: 'http', live: true, account, app, site, domain, status: 0, method: '', path: '', ip, bot,
      ua: bot ? { bot: true, name: 'Robot', kind: 'bot' } : { name: '', os: '' }, cc: geo ? geo.cc : null, country: geo ? geo.name : null, ref: '', refHost: '', bytes: 0 });
  }

  onAccess(domain, line) {
    const m = line.match(LOG_RE);
    if (!m) return;
    const [, ip, when, method, url, statusS, bytesS, ref, uaRaw] = m;
    const status = Number(statusS);
    const ua = parseUA(uaRaw);
    const at = logTime(when), age = Date.now() - at;
    if (age > 3600000) return; // mas de una hora: ya no suma a nada (lectura inicial)
    if (ua.bot) { this.botIps.set(ip, Date.now()); if (this.botIps.size > 5000) this.botIps.delete(this.botIps.keys().next().value); }
    const geo = this.geo ? this.geo.country(ip) : null;
    const { account, app, site } = this.appFor(domain);
    // tarde (llego por tandas o es de la lectura inicial) o ya contada en vivo: solo aporta el detalle
    const late = this.liveOn() || age > 90000;
    if (!late) this.count(account, app, site, status, ua.bot);
    else if (status >= 500 && age < 90000) { this.minute.err++; this.bucket10.err++; }
    let refHost = '';
    if (ref && ref !== '-') { try { refHost = new URL(ref).hostname.replace(/^www\./, ''); } catch { refHost = ''; } }
    this.bus.emit('ev', { kind: 'http', late, at, account, app, site, domain, status, method, path: url.slice(0, 160), ip, bot: ua.bot,
      ua, uaRaw: String(uaRaw || '').slice(0, 200), cc: geo ? geo.cc : null, country: geo ? geo.name : null, ref: ref && ref !== '-' ? ref.slice(0, 200) : '', refHost,
      bytes: Number(bytesS) || 0 });
  }

  countExternal(e) {
    const b = this.minute;
    b.req++; if (e.status >= 500) b.err++;
    if (e.account) b.perAccount[e.account] = (b.perAccount[e.account] || 0) + 1;
    if (e.app) b.perApp[e.account + '/' + e.app] = (b.perApp[e.account + '/' + e.app] || 0) + 1;
    this.bucket10.req++; if (e.status >= 500) this.bucket10.err++; if (e.bot) this.bucket10.bots++;
  }

  roll10() {
    this.history.push({ t: Date.now(), req: this.bucket10.req, err: this.bucket10.err, bots: this.bucket10.bots });
    this.bucket10 = { t: Date.now(), req: 0, err: 0, bots: 0 };
  }

  onAuth(line) {
    let m;
    // "Invalid user X" y luego "Failed password for invalid user X" son el MISMO intento:
    // se cuenta la primera linea y se ignora la segunda
    if (/sshd\[\d+\]: Failed (?:password|publickey) for invalid user /.test(line)) return;
    if ((m = line.match(/sshd\[\d+\]: Failed (?:password|publickey) for (\S+) from (\S+)/))) {
      this.security.failed++;
      this.bus.emit('ev', { kind: 'attack', service: 'ssh', user: m[1], ip: m[2], ...this.where(m[2]) });
    } else if ((m = line.match(/sshd\[\d+\]: Invalid user (\S*) from (\S+)/))) {
      this.security.failed++;
      this.bus.emit('ev', { kind: 'attack', service: 'ssh', user: m[1], ip: m[2], ...this.where(m[2]) });
    } else if ((m = line.match(/sshd\[\d+\]: Accepted (\S+) for (\S+) from (\S+)/))) {
      this.security.logins++;
      this.bus.emit('ev', { kind: 'login', service: 'ssh', method: m[1], user: m[2], ip: m[3], ...this.where(m[3]) });
    }
  }

  // visitas del ultimo minuto: 5 intervalos de 10 s cerrados + el actual
  slidingMinute() {
    const last = this.history.a.slice(-5);
    return {
      reqMin: last.reduce((n, b) => n + b.req, 0) + this.bucket10.req,
      errMin: last.reduce((n, b) => n + b.err, 0) + this.bucket10.err,
    };
  }

  where(ip) { const g = this.geo ? this.geo.country(ip) : null; return g ? { cc: g.cc, country: g.name } : {}; }

  onHulk(line) {
    const m = line.match(/Login Blocked: ([^\[]+)\[Service\]=\[(\w+)\] \[Remote IP Address\]=\[([^\]]+)\].*?\[Username\]=\[([^\]]*)\]/);
    if (!m) return;
    this.security.blocked++;
    this.bus.emit('ev', { kind: 'block', reason: m[1].trim(), service: m[2], ip: m[3], user: m[4], ...this.where(m[3]) });
  }

  // fail2ban: "... fail2ban.actions [123]: NOTICE [sshd] Ban 1.2.3.4"
  onFail2ban(line) {
    const m = line.match(/\[([\w.-]+)\]\s+Ban\s+(\S+)/);
    if (!m) return;
    this.security.blocked++;
    this.bus.emit('ev', { kind: 'block', reason: 'fail2ban', service: m[1], ip: m[2], user: '', ...this.where(m[2]) });
  }
  // CSF/LFD: "lfd[1]: (sshd) Failed SSH login from 1.2.3.4 (CN/China/-): 5 in the last 3600 secs - *Blocked in csf*"
  onLfd(line) {
    if (!/Blocked in csf/i.test(line)) return;
    const m = line.match(/\((\w+)\).*?from\s+([0-9a-f.:]+)/i) || line.match(/(\w+).*?([0-9]{1,3}(?:\.[0-9]{1,3}){3})/);
    if (!m) return;
    this.security.blocked++;
    this.bus.emit('ev', { kind: 'block', reason: 'csf', service: m[1], ip: m[2], user: '', ...this.where(m[2]) });
  }
  // Postfix: status=sent hacia fuera, entrega local, o rebote
  // Postfix: el remitente sale de qmgr (from=) y cada entrega o rebote trae su destinatario y su motivo
  onPostfix(line) {
    const qid = (line.match(/: ([0-9A-F]{6,}|[0-9A-Za-z]{10,}): /) || [])[1];
    if (!this.msgs) this.msgs = new Map();
    if (qid && /postfix\/qmgr\[/.test(line)) {
      const from = (line.match(/ from=<([^>]*)>/) || [])[1];
      if (from != null) { this.msgs.set(qid, { from }); if (this.msgs.size > 5000) this.msgs.delete(this.msgs.keys().next().value); }
      return;
    }
    if (!/postfix\/(?:smtp|lmtp|local|virtual|pipe)\[/.test(line)) return;
    const bounced = /status=bounced/.test(line);
    if (!bounced && !/status=sent/.test(line)) return;
    const local = /postfix\/(?:lmtp|local|virtual|pipe)\[/.test(line) || /relay=(?:local|dovecot|private\/)/.test(line);
    const msg = (qid && this.msgs.get(qid)) || {};
    const to = (line.match(/ to=<([^>]*)>/) || [])[1] || '';
    const dir = bounced ? 'bounce' : local ? 'in' : 'out';
    const mail = { kind: 'mail', dir, from: msg.from || '', to, account: this.mailAccount(dir, msg, to), ...(this.mailLate ? { late: true, at: mailTime(line) } : {}) };
    if (bounced) Object.assign(mail, bounceReason(' : ' + ((line.match(/status=bounced \((.*)\)\s*$/) || [])[1] || ''), this.defs ? this.defs.rules.mailRules : undefined));
    this.countMail(mail);
    this.bus.emit('ev', mail);
  }

  // Exim: cada mensaje llega (<=) con su remitente y quien lo envio (usuario de cPanel U= o login SMTP A=),
  // y despues se entrega (=>) o rebota (**) con el motivo del servidor remoto. Se unen por el id del mensaje
  // para que cada movimiento diga de quien, a quien, desde que cuenta y por que.
  onExim(line) {
    const m = line.match(/\b([0-9A-Za-z]{6}-[0-9A-Za-z]{6,11}-[0-9A-Za-z]{2,4}) (<=|=>|->|\*\*|==) (\S+)(.*)$/);
    if (!m) return;
    const [, id, op, addr, rest] = m;
    if (!this.msgs) this.msgs = new Map();
    if (op === '<=') {
      const user = (rest.match(/ U=(\S+)/) || [])[1] || '', auth = (rest.match(/ A=\w+:(\S+)/) || [])[1] || '';
      this.msgs.set(id, { from: addr === '<>' ? '' : addr, user, auth });
      if (this.msgs.size > 5000) this.msgs.delete(this.msgs.keys().next().value);
      return;
    }
    if (op === '->' || op === '==') return; // copia adicional o entrega demorada (se reintenta sola)
    const msg = this.msgs.get(id) || {};
    const to = addr.replace(/^<|>$/g, '');
    const dir = op === '**' ? 'bounce' : /T=(?:dkim_)?remote_smtp\b/.test(rest) ? 'out' : 'in';
    const mail = { kind: 'mail', dir, from: msg.from || '', to, account: this.mailAccount(dir, msg, to), ...(this.mailLate ? { late: true, at: mailTime(line) } : {}) };
    if (dir === 'bounce') Object.assign(mail, bounceReason(rest, this.defs ? this.defs.rules.mailRules : undefined));
    this.countMail(mail);
    this.bus.emit('ev', mail);
  }
  // de que cuenta es el movimiento: quien lo envio (usuario, login o dominio del remitente) o, si entra, el dominio destino
  mailAccount(dir, msg, to) {
    if (msg.user && msg.user !== 'mailnull' && msg.user !== 'root' && this.cfg.accounts[msg.user]) return msg.user;
    const dom = a => String(a || '').split('@')[1] || '';
    const d = dir === 'in' ? dom(to) : dom(msg.auth) || dom(msg.from);
    return d ? this.appFor(d.toLowerCase()).account || null : null;
  }
  countMail(e) {
    this.mail[e.dir]++;
    if (!this.mail.byAccount) this.mail.byAccount = {};
    const k = e.account || '';
    const a = this.mail.byAccount[k] || (this.mail.byAccount[k] = { out: 0, in: 0, bounce: 0, reasons: {} });
    a[e.dir]++;
    if (e.dir === 'bounce') a.reasons[e.cat] = (a.reasons[e.cat] || 0) + 1;
  }
}

// motivos de rebote: vienen de las definiciones (server/defs.js), en palabras simples y con su codigo
const { DEFAULT: DEFS } = require('../defs');
function mailTime(line) {
  let m = line.match(/^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)/);
  if (m) return Date.parse(`${m[1]}T${m[2]}`) || null;
  m = line.match(/^([A-Z][a-z]{2}) +(\d{1,2}) (\d\d:\d\d:\d\d)/);
  if (m) { const d = new Date(`${m[1]} ${m[2]} ${new Date().getFullYear()} ${m[3]}`); return isNaN(d) ? null : d.getTime(); }
  return null;
}
function bounceReason(rest, rules = DEFS.mailRules) {
  const txt = rest.replace(/^.*?: /, '');
  const code = (txt.match(/\b([245]\d\d[ -](?:[245]\.\d{1,3}\.\d{1,3})?)/) || [])[1] || '';
  const hit = rules.find(([, , re]) => re.test(txt));
  // el mensaje del servidor remoto, legible: sin los saltos escapados de Exim (\n550-5.7.26), sin repetir el
  // codigo en cada renglon y sin el prefijo "SMTP error from remote mail server after ..."
  const clean = txt.replace(/\\n/g, ' ').replace(/(^|\s)[245]\d\d[- ](?:[245]\.\d{1,3}\.\d{1,3}\s)?/g, ' ')
    .replace(/^.*?SMTP error from remote mail server after [^:]*:\s*/i, '').replace(/\s+/g, ' ').trim();
  return { cat: hit ? hit[0] : 'other', why: hit ? hit[1] : 'Otro motivo', code: code.trim(), reason: clean.slice(0, 320) };
}

module.exports = { LogsCollector, bounceReason };
