'use strict';
// Atalaya: servidor HTTP + SSE. Solo lectura sobre el VPS.
const http = require('http');
const fs = require('fs');
const path = require('path');
const { EventEmitter } = require('events');
const { readJSON, statSafe, listDir } = require('./util');
const { HostCollector } = require('./collectors/host');
const { ClaudeCollector } = require('./collectors/claude');
const { LogsCollector } = require('./collectors/logs');
const { Auth } = require('./auth');
const { makePrivacy } = require('./privacy');
const { History } = require('./history');

const ROOT = path.resolve(__dirname, '..');
// configuracion en capas: defaults < config.json (opcional) < settings.json del asistente
const settings = require('./settings');
const users = require('./users');
const maestroPass = require('./maestropass');
const cfg = settings.load(ROOT);
// la carpeta de datos puede no existir todavia (primera vez en Windows o macOS, o un ATALAYA_STATE nuevo)
try { fs.mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 }); } catch (e) { console.error('[datos] no se pudo crear', cfg.stateDir, e.message); }
const WEB = path.join(ROOT, 'web'); // con path.join: en Windows las rutas usan \ y la comprobacion de serveStatic fallaba
const VERSION = (readJSON(ROOT + '/package.json', {}) || {}).version || '0.0.0';

const bus = new EventEmitter();
bus.setMaxListeners(100);
// plataforma: panel, servidor web, logs de seguridad y correo, base de paises (todo autodetectado)
const platformMod = require('./platform');
const platform = platformMod.detect(cfg);
if (platform.geo && !cfg.geoipPath) cfg.geoipPath = platform.geo;
const s0 = platformMod.summary(cfg);
console.log(`[plataforma] ${s0.panel} · web ${s0.web} · ${s0.accounts} cuentas · ${s0.sites} sitios · correo ${s0.mail || '—'} · bloqueos ${s0.bans.join(', ') || '—'}`);
const { Accounts } = require('./accounts');
const accounts = new Accounts(cfg, bus, platform);
const host = new HostCollector(cfg, bus);
host.accountsHome = accounts.homes().filter(a => a.user !== 'root');
const claude = new ClaudeCollector(cfg, bus, host);
const { ServicesCollector } = require('./collectors/services');
const { DockerCollector } = require('./collectors/docker');
const services = new ServicesCollector(cfg, bus);
const docker = new DockerCollector(cfg, bus);
host.extra = [services, docker];
// distritos virtuales segun lo que haya
const virtualAccounts = () => [
  ...(services.apps.some(a => a.account === '_sys') ? [{ id: '_sys', label: 'Servicios del sistema' }] : []),
  ...(docker.apps.length ? [{ id: '_docker', label: 'Contenedores' }] : []),
  ...(typeof connectors !== 'undefined' ? connectors.virtual() : []),
  ...(typeof secrets !== 'undefined' ? secrets.remotes().map(m => ({ id: '_dev-' + m, label: 'Equipo ' + m, publicLabel: 'Equipo remoto' })) : []),
  ...(typeof agents !== 'undefined' ? agents.virtual() : []),
  ...(typeof websites !== 'undefined' ? websites.virtual() : []),
];
accounts.virtual = virtualAccounts;
let virtualKey = '';
setInterval(() => {
  const k = virtualAccounts().map(v => v.id).join(',');
  if (k !== virtualKey) { virtualKey = k; accounts.sync(); }
}, 5000);
const logs = new LogsCollector(cfg, bus, host);
logs.platform = platform;
const auth = new Auth(cfg);
const privacy = makePrivacy(cfg);
const history = new History(bus, host);
const { MetricsCollector } = require('./collectors/metrics');
const metrics = new MetricsCollector(bus, cfg);
const { DiskMap } = require('./collectors/diskmap');
const diskmap = new DiskMap(cfg, metrics);
const { Jobs } = require('./jobs');
const jobs = new Jobs();
diskmap.start(jobs);
const { DatabaseAudit } = require('./audits/databases');
const dbAudit = new DatabaseAudit(cfg, logs);
const { SetupFlow } = require('./setupflow');
history.logs = logs;
history.persistToday(path.join(cfg.stateDir, 'today.json'));
logs.geo = new (require('./geo').Geo)(cfg);
// conectores de nube (Vercel, Supabase) y equipos remotos de Claude Code: credenciales en connectors.json
const { Secrets } = require('./secrets');
const { Connectors } = require('./connectors');
const secrets = new Secrets(cfg);
const setup = new SetupFlow({ cfg, auth, secrets, platform, platformMod, logs, ROOT, VERSION });
setup.ensureCode();
// settings.json tambien lo escribe el ayudante (ej. la URL publica tras publicar): se relee al cambiar
let settingsMtime = 0;
setInterval(() => {
  const st = statSafe(path.join(cfg.stateDir, 'settings.json'));
  if (!st || st.mtimeMs === settingsMtime) return;
  settingsMtime = st.mtimeMs;
  const fresh = settings.load(ROOT);
  for (const k of ['title', 'subtitle', 'publicUrl', 'public', 'privateOptions', 'setupDone', 'theme']) cfg[k] = fresh[k];
}, 3000);
const connectors = new Connectors(cfg, bus, secrets, logs.geo);
// hostings compartidos que envian sus datos con el agente por cron
const { Agents } = require('./agents');
const agents = new Agents(cfg, bus, secrets, logs);
// sitios vigilados por su dominio (sin instalar nada): se visitan cada 5 minutos desde aqui
const crypto = require('crypto');
const { parseUA } = require('./ua');
// seguimiento de uso (solo en Atalaya Cloud): acciones y errores de la pantalla, sin lo que la persona escribe
const { Track } = require('./track');
const track = new Track(cfg);
const { WebSites } = require('./websites');
const websites = new WebSites(cfg, bus);
websites.onChange = () => { logs.loadDomains(true); accounts.sync(); };
logs.extra = { vhosts: () => [...agents.vhosts(), ...websites.vhosts()], mains: () => [...agents.mains(), ...websites.mains()] };
host.extra.push(connectors);
const ctx = { host, claude, logs, history, services, docker, connectors, metrics, diskmap, dbAudit, jobs, agents, websites };
websites.start();
// revisiones del servidor: respaldos, actualizaciones, cola de correo, cron y puertos (solo lectura)
const { HostAudit } = require('./audits/host');
ctx.hostAudit = new HostAudit(cfg);
// archivos expuestos (.git, .env) por todos los nombres de cada sitio y la IP: una vez al dia
const { ExposureAudit } = require('./audits/exposure');
ctx.exposure = new ExposureAudit(cfg, platform);
// buscadores de filtraciones (LeakIX): con la clave del conector, una vez al dia
const { LeakixAudit } = require('./audits/leakix');
ctx.leakix = new LeakixAudit(cfg, secrets, platform);
if (ctx.exposure.available()) ctx.hostAudit.extra = [() => ctx.exposure.section(), () => ctx.leakix.section()];
// actividad de las bases (usuario de MySQL con solo PROCESS, creado desde la ficha de Bases de datos)
const { DbActivity } = require('./collectors/dbactivity');
ctx.dbActivity = new DbActivity(cfg, dbAudit, bus);
ctx.dbActivity.start();
ctx.hostAudit.extra = [...(ctx.hostAudit.extra || []), () => ctx.dbActivity.section()];
// saturacion: servidor al limite (CPU, carga, memoria, swap, MySQL, 5xx) y sitios sin procesos PHP-FPM
const { Saturation } = require('./saturation');
ctx.saturation = new Saturation(cfg, bus, ctx);
ctx.hostAudit.extra.push(() => ctx.saturation.section());
// archivos PHP nuevos o sospechosos en los docroots (posibles puertas traseras)
const { PhpFilesAudit } = require('./audits/phpfiles');
ctx.phpFiles = new PhpFilesAudit(cfg, logs, bus);
ctx.hostAudit.extra.push(() => ctx.phpFiles.section());
// cuota de disco, inodos y ancho de banda por cuenta (lo que cPanel ya calcula)
const { QuotaAudit } = require('./audits/quotas');
ctx.quotas = new QuotaAudit(cfg);
ctx.hostAudit.extra.push(() => ctx.quotas.section());
// certificados SSL por vencer y servicios que se reinician solos
const { ServiceAudit } = require('./audits/services');
ctx.svcAudit = new ServiceAudit(cfg, bus);
ctx.hostAudit.extra.push(() => ctx.svcAudit.section());
ctx.svcAudit.onUpdate = () => ctx.hostAudit.refresh();
// accesos a cPanel, WHM y webmail: contrasenas equivocadas y entradas desde IPs nuevas
const { LoginAudit } = require('./audits/logins');
ctx.logins = new LoginAudit(cfg, bus);
ctx.hostAudit.extra.push(() => ctx.logins.section());
ctx.logins.start();
ctx.svcAudit.start();
ctx.exposure.start();
ctx.leakix.start();
ctx.hostAudit.start();
// iconos reales de cada proyecto (favicon de su dominio); se piden de a uno, sin apuro
const { Favicons } = require('./favicons');
ctx.favicons = new Favicons(path.join(cfg.stateDir, 'favicons'));
function wantFavicons() {
  for (const g of logs.groups ? logs.groups.values() : []) if (g.domain && g.type !== 'empty') ctx.favicons.want(g.domain);
  for (const a of host.apps) if (a.domains && a.domains[0]) ctx.favicons.want(a.domains[0]);
}
setTimeout(wantFavicons, 20000);
setInterval(wantFavicons, 10 * 60000);
// defensa web: robots que buscan rutas vulnerables en cada sitio, y archivos expuestos confirmados
const { WebDefense } = require('./webdefense');
// definiciones (que se detecta y como empezar a resolverlo): integradas y actualizadas a diario, firmadas
const { Defs } = require('./defs');
ctx.defs = new Defs(cfg);
logs.defs = ctx.defs;
ctx.defs.start();
ctx.webdef = new WebDefense(cfg, bus, logs, ctx.defs);
// vigilancia: escaneos, scraping y picos de visitas por sitio (para hacerlos notar en el mapa)
const { Watch } = require('./watch');
ctx.watch = new Watch(cfg, bus, ctx.webdef);
// defensa: bloqueos temporales de IPs (manuales o, si el dueno la enciende, automaticos) por medio del ayudante
// alertas por Telegram (lo grave llega al telefono aunque nadie mire la pantalla)
const { Alerts } = require('./alerts');
// registro de seguridad (expediente de cada preso e historial de cada sitio)
const { SecLog } = require('./seclog');
ctx.seclog = new SecLog(cfg, bus);
// analitica de visitas desde los registros (sin JavaScript ni cookies): totales por dia de cada sitio y app
const { Analytics } = require('./analytics');
ctx.analytics = new Analytics(cfg, bus, { domainsOf: key => {
  const out = new Set();
  for (const g of [...(logs.groups ? logs.groups.values() : []), ...(logs.sites || [])]) {
    if ((g.app && g.account + '/' + g.app === key) || 'site:' + g.id === key) for (const d of (g.domainList || [g.domain])) if (d) out.add(String(d).toLowerCase().replace(/^www\./, ''));
  }
  return [...out];
} });
ctx.analytics.start();
// al detenerse, se guarda lo ultimo de la analitica (si no, se recupera releyendo los logs al arrancar)
process.once('SIGTERM', () => { try { ctx.analytics.flush(); } catch { } process.exit(0); });
// informe mensual de la analitica por correo, para el cliente final de cada sitio (sale del correo de las alertas)
const { Reports } = require('./reports');
ctx.reports = new Reports(cfg, ctx);
// bloqueo en Cloudflare: la carcel tambien alla, para los sitios detras de su proxy
const { Cloudflare } = require('./cloudflare');
ctx.cloudflare = new Cloudflare(cfg, bus);
const { Defense } = require('./defense');
ctx.alerts = new Alerts(cfg, bus, secrets, { goOf: e => privacy.goOf(e, ctx),
  healthLine: () => { const h = ctx.hostAudit && ctx.hostAudit.summary(); return h ? (h.bad ? `Salud del servidor: ${h.bad} grave(s)${h.warn ? `, ${h.warn} para revisar` : ''}` : h.warn ? `Salud del servidor: ${h.warn} para revisar` : 'Salud del servidor: en orden') : ''; } });
// solicitudes de acceso de la nube que vive en este servidor (si la hay): avisan por Telegram o correo
if (maestroPass.available(cfg)) {
  ctx.alerts.watchRequests(path.join(cfg.cloudDir || '/var/lib/atalaya-cloud', 'requests.json'));
  ctx.alerts.watchAportes(path.join(cfg.cloudDir || '/var/lib/atalaya-cloud', 'aportes'));
  ctx.alerts.watchTracking(path.join(cfg.cloudDir || '/var/lib/atalaya-cloud', 'tenants'));
}
ctx.defense = new Defense(cfg, bus, { ...ctx, get phpFiles() { return ctx.phpFiles; }, get seclog() { return ctx.seclog; }, get auth() { return auth; }, get setup() { return setup; }, get watch() { return ctx.watch; }, get dbActivity() { return ctx.dbActivity; } });
// primera vez del registro de seguridad: se vuelca lo que ya se sabia (bloqueos, puertas traseras, cuarentenas)
if (!fs.existsSync(ctx.seclog.file)) {
  const past = [];
  for (const r of ctx.defense.records) past.push({ t: r.at, kind: 'defense', action: 'block', reason: r.reason, ip: r.ip, by: r.by, account: r.account, site: r.site, app: r.app, domain: r.domain, hours: r.hours });
  for (const r of ctx.phpFiles.found.filter(x => x.sev === 'bad').concat(ctx.phpFiles.jailed)) past.push({ t: r.foundAt || r.at, kind: 'phpfile', action: 'suspect', account: r.account, site: r.site, domain: r.domain, path: r.path, why: (r.why || [])[0] || null });
  for (const r of ctx.phpFiles.jailed) past.push({ t: r.at, kind: 'phpfile', action: 'quarantine', account: r.account, site: r.site, domain: r.domain, path: r.path, by: r.by || null });
  for (const r of past.filter(x => x.t).sort((a, b) => a.t - b.t)) ctx.seclog.append(r);
  if (past.length) console.log(`[seguridad] registro creado con ${past.length} episodio(s) anteriores`);
}
// mapa de proyectos: une repos, despliegues, sitios, hostings y bases en fichas con puntaje de buenas practicas
const { Projects } = require('./projects');
ctx.projects = new Projects(cfg, ctx);

const HOOK_EVENTS = new Set(['SessionStart', 'SessionEnd', 'UserPromptSubmit', 'PermissionRequest', 'Notification', 'PreToolUse',
  'PostToolUse', 'PostToolUseFailure', 'PermissionDenied', 'Stop', 'SubagentStart', 'SubagentStop']);
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };

const SEC_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; worker-src 'self' blob:; connect-src 'self'; font-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
};

function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  // Apache AGREGA la IP real al final; lo anterior lo puede escribir el cliente. Solo se confia en el ultimo salto.
  // en la nube solo el portal habla con la pantalla (por su socket): tambien es un salto de confianza
  if (cfg.trustProxy && xf && (process.env.ATALAYA_SOCKET || ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress))) return xf.split(',').pop().trim();
  return req.socket.remoteAddress;
}
function isHttps(req) { return req.headers['x-forwarded-proto'] === 'https'; }
function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}
// un envio del script de analitica: el sitio debe existir y el envio venir de uno de sus dominios; tope por IP
// (la IP solo se usa para el tope, no se guarda)
const beaconHits = new Map(), beaconSites = { at: 0, map: new Map() };
setInterval(() => beaconHits.clear(), 60000).unref();
function beacon(req, text) {
  const ip = clientIp(req), n = (beaconHits.get(ip) || 0) + 1; beaconHits.set(ip, n);
  if (n > 120) throw new Error('tope');
  if (/bot|crawl|spider|headless|lighthouse|preview/i.test(req.headers['user-agent'] || '')) throw new Error('robot');
  let b; try { b = JSON.parse(text); } catch { throw new Error('json'); }
  const id = String(b && b.s || '');
  // del identificador fijo a la clave: se arma la tabla con todos los sitios y apps conocidos (se renueva cada minuto)
  if (Date.now() - beaconSites.at > 60000) {
    beaconSites.at = Date.now(); beaconSites.map.clear();
    const keys = new Set(Object.values(ctx.analytics.index || {}));
    for (const g of [...(logs.groups ? logs.groups.values() : []), ...(logs.sites || [])]) keys.add(g.app ? g.account + '/' + g.app : 'site:' + g.id);
    for (const k of keys) beaconSites.map.set(ctx.analytics.siteToken(k), { key: k });
  }
  const t = beaconSites.map.get(id);
  if (!t) throw new Error('sitio');
  const from = (() => { try { return new URL(req.headers.origin || req.headers.referer || '').hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } })();
  const doms = ctx.analytics.doms(t.key).map(d => String(d).toLowerCase().replace(/^www\./, ''));
  if (!from || !doms.some(d => from === d || from.endsWith('.' + d))) throw new Error('origen');
  ctx.analytics.beacon(t.key, b);
  // de un sitio vigilado no hay registros del servidor: la primera senal de cada pagina cuenta como su visita.
  // La IP no se guarda ni se muestra: se usa para el pais y queda como una huella corta que cambia cada dia
  const gid = t.key.startsWith('site:') ? t.key.slice(5) : null;
  if (gid && websites.idOfGroup(gid) && b.t === 'pv' && b.f) {
    const uaRaw = String(req.headers['user-agent'] || '').slice(0, 200), geo = logs.geo ? logs.geo.country(ip) : null;
    let ref = String(b.r || '').slice(0, 200), refHost = '';
    if (ref) { try { refHost = new URL(ref).hostname.replace(/^www\./, ''); } catch { ref = ''; } }
    const mark = 'v-' + crypto.createHash('sha1').update(ctx.analytics.salt + new Date().toISOString().slice(0, 10) + ip).digest('hex').slice(0, 8);
    logs.count(websites.account, null, gid, 200, false);
    bus.emit('ev', { kind: 'http', at: Date.now(), account: websites.account, app: null, site: gid, domain: from, status: 200, method: 'GET', path: String(b.p || '/').slice(0, 160),
      ip: mark, bot: false, ua: parseUA(uaRaw), uaRaw, cc: geo ? geo.cc : null, country: geo ? geo.name : null, ref, refHost, bytes: 0, script: true });
  }
}
function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SEC_HEADERS, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function json(res, status, obj, headers = {}) { if (status >= 400 && obj && obj.error) res.atalayaError = obj.error; send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json', ...headers }); }

function readBody(req, max = 4096) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > max) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString() || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

// arma el .zip del plugin de WordPress (con la configuracion de vinculacion si se pasa)
function wpPluginZip(conf) {
  const dir = path.join(ROOT, 'wordpress', 'atalaya-agent');
  const files = fs.readdirSync(dir).filter(f => /\.(php|txt)$/.test(f) && f !== 'atalaya-config.php').map(f => ({ name: 'atalaya-agent/' + f, data: fs.readFileSync(path.join(dir, f)) }));
  if (conf) {
    const q = v => "'" + String(v).replace(/[\\']/g, '\\$&') + "'";
    // sin codigo (plugin generico) solo trae la direccion, para que el formulario ya la tenga puesta
    files.push({ name: 'atalaya-agent/atalaya-config.php', data: `<?php\n// Vinculacion con Atalaya (codigo de un solo uso, vence en 24 h). Se usa al activar el plugin.\nif (!defined('ABSPATH')) { exit; }\nreturn array('url' => ${q(conf.url)}, 'code' => ${q(conf.code || '')});\n` });
  }
  return require('./zip').zip(files);
}

// temas: web/themes/<id>/theme.json (se relee en cada consulta: se pueden agregar sin reiniciar)
function listThemes() {
  const dir = path.join(WEB, 'themes');
  const out = [];
  for (const id of listDir(dir)) {
    if (!/^[a-z0-9][a-z0-9-]{0,30}$/.test(id)) continue;
    const m = readJSON(path.join(dir, id, 'theme.json'), null);
    if (!m || m.id !== id || !m.name || !m.world) continue;
    out.push({ id, name: String(m.name), description: String(m.description || ''), author: String(m.author || ''), version: String(m.version || ''),
      license: String(m.license || ''), palette: m.palette || {}, preview: m.preview ? `/themes/${id}/${m.preview}` : null });
  }
  return out.sort((a, b) => (a.id === 'ciudad' ? -1 : b.id === 'ciudad' ? 1 : a.name.localeCompare(b.name)));
}

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > max) { reject(new Error('too big')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function serveStatic(res, rel) {
  const file = path.normalize(path.join(WEB, rel));
  if (!file.startsWith(WEB + path.sep)) return send(res, 404, 'No encontrado');
  fs.readFile(file, (err, data) => {
    if (err) return send(res, 404, 'No encontrado');
    const ext = path.extname(file);
    const cache = rel.startsWith('/vendor/') || rel.startsWith('/fonts/') ? 'public, max-age=604800' : 'no-cache';
    // ETag: el navegador revalida en cada carga y recibe 304 si no cambio, o el archivo nuevo si cambio
    const etag = '"' + require('crypto').createHash('sha1').update(data).digest('base64url').slice(0, 16) + '"';
    if (res.req && res.req.headers['if-none-match'] === etag) return send(res, 304, '', { ETag: etag, 'Cache-Control': cache });
    send(res, 200, data, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache, ETag: etag });
  });
}

// CHANGELOG.md -> [{ version, date, groups: [{ title, items }] }] (sin "Sin publicar")
function parseChangelog() {
  const text = fs.readFileSync(ROOT + '/CHANGELOG.md', 'utf8');
  const out = [];
  let rel = null, grp = null;
  for (const line of text.split('\n')) {
    let m;
    if ((m = line.match(/^## \[(\d+\.\d+\.\d+)\](?: - (\S+))?/))) { rel = { version: m[1], date: m[2] || '', groups: [] }; out.push(rel); grp = null; continue; }
    if (/^## /.test(line)) { rel = null; continue; }
    if (!rel) continue;
    if ((m = line.match(/^### (.+)/))) { grp = { title: m[1].trim(), items: [] }; rel.groups.push(grp); continue; }
    if (!grp) continue;
    if (/^- /.test(line)) grp.items.push(line.slice(2).trim());
    else if (/^\s+\S/.test(line) && grp.items.length) grp.items[grp.items.length - 1] += ' ' + line.trim();
  }
  return out;
}

// ---- clientes SSE ----
const clients = new Set();

function sseWrite(c, event, data) {
  try { c.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`); } catch { /* cliente cerrado */ }
}

function helloFor(c) {
  const priv = auth.isPrivate(c.session);
  return {
    title: cfg.title, subtitle: priv ? cfg.subtitle : '', edition: cfg.edition, user: c.session.user, role: c.session.role, version: VERSION, theme: cfg.theme || 'ciudad',
    priv, privateUntil: c.session.privateUntil, privateOptions: cfg.privateOptions,
    maestro: c.session.role === 'owner' && maestroPass.available(cfg),
    history: { system: host.history.toArray(), traffic: logs.history.toArray() },
  };
}

function pushState(c) {
  const priv = auth.isPrivate(c.session);
  c.priv = priv;
  sseWrite(c, 'state', privacy.state(ctx, priv));
}

bus.on('tick', () => {
  const pub = privacy.state(ctx, false);
  let privState = null;
  auth.syncUsers();
  auth.syncRevoke();
  for (const c of clients) {
    // usuario borrado o sesion cerrada: se corta el stream
    if (!auth.stillValid(c.session)) { try { c.res.end(); } catch { } clients.delete(c); continue; }
    const priv = auth.isPrivate(c.session);
    if (priv !== c.priv) { sseWrite(c, 'mode', helloFor(c)); }
    c.priv = priv;
    if (priv) sseWrite(c, 'state', privState || (privState = privacy.state(ctx, true)));
    else sseWrite(c, 'state', pub);
  }
});

// eventos con limite por segundo para no saturar la TV
let evCount = 0;
setInterval(() => { evCount = 0; }, 1000);
bus.on('ev', e => {
  // las lineas atrasadas de los logs ya se animaron en vivo (o son viejas): a la pantalla solo van sus errores recientes
  if (e.kind === 'http' && e.late && !(e.status >= 500 && Date.now() - e.at < 90000)) return;
  if (e.kind === 'mail' && e.late) return; // lo leido al arrancar solo carga la ficha
  if (e.kind === 'http' && ++evCount > 60) return;
  let pub = null, priv = null;
  for (const c of clients) {
    const p = auth.isPrivate(c.session);
    const out = p ? (priv || (priv = privacy.event(e, true))) : (pub || (pub = privacy.event(e, false)));
    if (out) sseWrite(c, 'ev', out);
  }
});

function modeChanged(sessionKey) {
  for (const c of clients) if (!sessionKey || c.session.key === sessionKey) { sseWrite(c, 'mode', helloFor(c)); pushState(c); }
}

// ---- rutas ----
const CLOUD_OFF = new Set(['/api/setup/action', '/api/setup/result', '/api/setup/geo', '/api/setup/install-command', '/api/setup/agent-local',
  '/api/audit/updates', '/api/disk/analyze', '/api/audit/db']);
async function handle(req, res) {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const ip = clientIp(req);
  const token = getCookie(req, 'atalaya_sid');
  const session = auth.get(token);
  track.request(req, res, p, url, session);

  // Atalaya Cloud: la maquina es del servicio, no del cliente
  if ((cfg.edition === 'cloud' || cfg.edition === 'equipo') && (CLOUD_OFF.has(p) || p.startsWith('/get'))) return json(res, 404, { error: cfg.edition === 'cloud' ? 'No disponible en Atalaya Cloud' : 'No disponible en Atalaya Equipo' });
  // ---------------- asistente de configuracion
  if (p.startsWith('/api/setup/')) return handleSetup(req, res, p, url, session, ip);
  if (p === '/setup' && req.method === 'GET') {
    if (!setup.isSetupMode() && !(session && session.role === 'owner')) return send(res, 302, '', { Location: session ? './' : 'login' });
    return serveStatic(res, '/setup.html');
  }
  // ---------------- instalacion en otros servidores (el script es publico; el paquete exige token)
  if (p === '/get' && req.method === 'GET') {
    return fs.readFile(ROOT + '/scripts/get.sh', 'utf8', (err, t) => err ? send(res, 404, '')
      : send(res, 200, t.replace(/__ORIGIN__/g, cfg.publicUrl || `https://${req.headers.host}`), { 'Content-Type': 'text/x-shellscript; charset=utf-8' }));
  }
  // ---------------- ejecutables de la edicion Equipo (los arma scripts/build-exe.js en dist/): solo el dueno
  if ((p === '/api/downloads' || p.startsWith('/download/')) && req.method === 'GET') {
    if (!session) return json(res, 401, { error: 'Sesion expirada' });
    if (session.role !== 'owner' || cfg.edition === 'cloud' || cfg.edition === 'equipo') return json(res, 403, { error: 'Solo el dueño de un Atalaya VPS puede descargar los ejecutables' });
    const dir = path.join(ROOT, 'dist');
    const files = (() => { try { return fs.readdirSync(dir); } catch { return []; } })();
    if (p === '/api/downloads') {
      const sums = {};
      for (const f of files.filter(x => /^SHA256SUMS-/.test(x))) for (const l of fs.readFileSync(path.join(dir, f), 'utf8').split('\n')) { const m = /^([0-9a-f]{64})\s+\*?(\S+)$/.exec(l.trim()); if (m) sums[m[2]] = m[1]; }
      const PLAT = { 'win-x64': 'Windows (64 bits)', 'darwin-arm64': 'macOS con chip Apple (M1 o más nuevo)', 'darwin-x64': 'macOS con Intel', 'linux-x64': 'Linux (64 bits)', 'linux-arm64': 'Linux ARM (Raspberry Pi 4/5, servidores ARM)' };
      const list = files.map(f => { const m = /^atalaya-(\d+\.\d+\.\d+)-([a-z]+-[a-z0-9]+)\.(zip|tar\.gz)$/.exec(f); return m && { file: f, version: m[1], plat: m[2], label: PLAT[m[2]] || m[2], size: fs.statSync(path.join(dir, f)).size, sha256: sums[f] || null }; })
        .filter(Boolean).sort((a, b) => Object.keys(PLAT).indexOf(a.plat) - Object.keys(PLAT).indexOf(b.plat));
      return json(res, 200, { version: VERSION, files: list });
    }
    const name = decodeURIComponent(p.slice('/download/'.length));
    if (!/^atalaya-\d+\.\d+\.\d+-[a-z]+-[a-z0-9]+\.(zip|tar\.gz)$/.test(name) || !files.includes(name)) return send(res, 404, 'No existe ese archivo');
    const file = path.join(dir, name);
    console.log(`[descarga] ${name} por ${session.user} desde ${ip}`);
    res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': name.endsWith('.zip') ? 'application/zip' : 'application/gzip', 'Content-Length': fs.statSync(file).size, 'Content-Disposition': `attachment; filename="${name}"`, 'Cache-Control': 'no-store' });
    return fs.createReadStream(file).pipe(res);
  }
  if ((p === '/get/atalaya.tar.gz' || p === '/get/atalaya.sha256') && req.method === 'GET') {
    const t = url.searchParams.get('t');
    if (!setup.useDist(t, p.endsWith('.tar.gz'))) return send(res, 403, 'Token vencido o invalido. Genere un comando nuevo desde Atalaya > Instalar en otro servidor.');
    try {
      const file = await setup.bundle();
      if (p.endsWith('.sha256')) return send(res, 200, require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex') + '\n', { 'Content-Type': 'text/plain' });
      res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': 'application/gzip', 'Cache-Control': 'no-store', 'X-Atalaya-Version': VERSION });
      return fs.createReadStream(file).pipe(res);
    } catch (e) { console.error('[dist]', e.message); return json(res, 500, { error: 'No se pudo armar el paquete' }); }
  }

  // Vercel Drains: publico pero firmado (HMAC-SHA1 con el secreto del drain)
  const dm = p.match(/^\/api\/drains\/vercel\/([a-z0-9-]{1,31})$/);
  if (dm && req.method === 'POST') {
    let raw;
    try { raw = await readRaw(req, 6 << 20); } catch { return json(res, 413, { error: 'demasiado grande' }); }
    const r = connectors.drain(dm[1], raw, req.headers);
    return json(res, r.status, r.error ? { error: r.error } : { ok: true, n: r.n });
  }
  // hooks de Claude Code desde un equipo remoto: token por equipo en X-Atalaya-Hook
  if (p === '/api/hook/remote' && req.method === 'POST') {
    const machine = secrets.checkRemote(req.headers['x-atalaya-hook']);
    if (!machine) { req.resume(); return json(res, 401, { error: 'token invalido' }); }
    let raw;
    try { raw = await readRaw(req, 256 << 10); } catch { return json(res, 413, { error: 'demasiado grande' }); }
    let ev; try { ev = JSON.parse(raw.toString('utf8')); } catch { return json(res, 400, { error: 'json invalido' }); }
    if (ev && HOOK_EVENTS.has(ev.hook_event_name)) { try { claude.onRemoteHook(ev, machine); } catch (e) { console.error('[hook remoto]', e.message); } }
    return send(res, 204, '');
  }
  // agentes de hosting compartido: vinculacion con codigo de un solo uso y envios firmados con su token
  if (p === '/api/agent/pair' && req.method === 'POST') {
    let body;
    try { body = JSON.parse((await readRaw(req, 2048)).toString('utf8')); } catch { return json(res, 400, { error: 'solicitud invalida' }); }
    const cred = agents.pair(body || {}, clientIp(req));
    if (!cred) return send(res, 403, 'codigo invalido o vencido\n', { 'Content-Type': 'text/plain' });
    accounts.sync();
    return send(res, 200, cred, { 'Content-Type': 'text/plain' });
  }
  if (p === '/api/agent/push' && req.method === 'POST') {
    const id = agents.check(req.headers['x-atalaya-agent']);
    if (!id) { req.resume(); return send(res, 401, 'token invalido\n', { 'Content-Type': 'text/plain' }); }
    let raw;
    try { raw = await readRaw(req, 8 << 20); } catch { return send(res, 413, 'demasiado grande\n', { 'Content-Type': 'text/plain' }); }
    try { return send(res, 200, agents.push(id, raw, req.headers['content-encoding']) + '\n', { 'Content-Type': 'text/plain' }); }
    catch (e) { console.error('[agente]', id, e.message); return send(res, 400, 'no se pudo leer\n', { 'Content-Type': 'text/plain' }); }
  }
  // analitica sin cookies (opcional): el script que se pega en los sitios y los envios que hace desde el navegador
  if (p === '/a.js' && req.method === 'GET') {
    return fs.readFile(ROOT + '/web/a.js', (err, data) => err ? send(res, 404, '') : send(res, 200, data, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin' }));
  }
  if (p === '/api/beacon') {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'POST', 'Access-Control-Allow-Headers': 'Content-Type' };
    if (req.method === 'OPTIONS') return send(res, 204, '', cors);
    if (req.method !== 'POST') return send(res, 405, '', cors);
    let raw; try { raw = await readRaw(req, 4096); } catch { return send(res, 413, '', cors); }
    try { beacon(req, raw.toString('utf8')); } catch (e) { if (!/^(sitio|origen|tope|robot|json)/.test(e.message)) console.error('[beacon]', e.message); }
    return send(res, 204, '', cors); // siempre 204: el navegador del visitante no espera nada
  }
  if ((p === '/install/agent.sh' || p === '/install/agent-run.sh') && req.method === 'GET') {
    return fs.readFile(ROOT + (p === '/install/agent.sh' ? '/agent/install.sh' : '/agent/agent.sh'), (err, data) => err ? send(res, 404, '') : send(res, 200, data, { 'Content-Type': 'text/x-shellscript; charset=utf-8' }));
  }
  // plugin de WordPress (generico, sin codigo): se conecta pegando la direccion y el codigo en Ajustes › Atalaya
  if (p === '/install/atalaya-wp.zip' && req.method === 'GET') {
    try { return send(res, 200, wpPluginZip({ url: cfg.publicUrl || `https://${req.headers.host}`, code: '' }), { 'Content-Type': 'application/zip', 'Content-Disposition': 'attachment; filename="atalaya-agent.zip"' }); }
    catch (e) { console.error('[wp]', e.message); return send(res, 500, ''); }
  }
  // el mismo instalador en Node, para Windows (y para quien no tenga curl ni sh)
  if (p === '/install/remote-hook.js' && req.method === 'GET') {
    return fs.readFile(ROOT + '/hooks/remote-install.js', (err, data) => err ? send(res, 404, '') : send(res, 200, data, { 'Content-Type': 'text/javascript; charset=utf-8' }));
  }
  if (p === '/install/remote-hook.sh' && req.method === 'GET') {
    return fs.readFile(ROOT + '/hooks/remote-install.sh', (err, data) => err ? send(res, 404, '') : send(res, 200, data, { 'Content-Type': 'text/x-shellscript; charset=utf-8' }));
  }

  if (req.method === 'POST') {
    // defensa CSRF: cabecera propia + JSON
    if (req.headers['x-atalaya'] !== '1' || !String(req.headers['content-type'] || '').startsWith('application/json')) return json(res, 400, { error: 'Solicitud invalida' });
    let body;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Solicitud invalida' }); }

    if (p === '/api/login') {
      const r = await auth.login(String(body.user || '').trim(), String(body.pin || ''), ip);
      if (r.error) { console.log(`[login] fallo user=${String(body.user).slice(0, 32)} ip=${ip}`); return json(res, r.status, { error: r.error }); }
      console.log(`[login] ok user=${r.session.user} ip=${ip}`);
      const cookie = `atalaya_sid=${r.token}; Path=${cfg.basePath}; HttpOnly; SameSite=Strict; Max-Age=${cfg.sessionDays * 86400}${isHttps(req) ? '; Secure' : ''}`;
      return json(res, 200, { ok: true }, { 'Set-Cookie': cookie });
    }
    if (!session) return json(res, 401, { error: 'Sesion expirada' });
    // errores de la pantalla que reporta el navegador (solo se guardan en Atalaya Cloud)
    if (p === '/api/clienterror') { track.client(body || {}, session); return json(res, 200, { ok: true }); }
    if (p === '/api/logout') {
      auth.logout(token);
      return json(res, 200, { ok: true }, { 'Set-Cookie': `atalaya_sid=; Path=${cfg.basePath}; Max-Age=0; HttpOnly; SameSite=Strict` });
    }
    if (p === '/api/private') {
      const r = await auth.unlock(session, String(body.pin || ''), body.minutes, ip);
      if (r.error) return json(res, r.status, { error: r.error });
      console.log(`[privado] activado user=${session.user} min=${body.minutes} ip=${ip}`);
      modeChanged(session.key);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/public') { auth.lock(session); modeChanged(session.key); return json(res, 200, { ok: true }); }
    // usuarios desde la pantalla y pase al panel maestro de la nube: solo un dueno con el modo privado activo
    // defensa: bloquear o desbloquear una IP y la defensa automatica (dueno con el modo privado activo)
    if (p.startsWith('/api/defense/')) {
      if (session.role !== 'owner') return json(res, 403, { error: 'Solo un dueño puede hacer esto' });
      if (!auth.isPrivate(session)) return json(res, 403, { error: 'Active el modo privado' });
      const D = ctx.defense;
      try {
        if (p === '/api/defense/block') return json(res, 200, { ok: true, record: await D.block(String(body.ip || ''), { by: session.user, hours: body.hours, reason: ['phpfile'].includes(body.reason) ? body.reason : undefined }) });
        if (p === '/api/defense/unblock') { await D.unblock(String(body.ip || ''), session.user); return json(res, 200, { ok: true }); }
        if (p === '/api/defense/release') { await D.release(String(body.ip || ''), session.user); return json(res, 200, { ok: true }); }
        if (p === '/api/defense/settings') return json(res, 200, { ok: true, settings: D.setConf(body || {}) });
      } catch (e) { return json(res, 400, { error: e.message }); }
      return json(res, 404, { error: 'No encontrado' });
    }
    // archivos PHP sospechosos: marcar como revisado o poner en cuarentena (solo los que marco el detector)
    // archivos en cuarentena: borrar para siempre o restaurar a su lugar
    if (p === '/api/phpfiles/qdelete' || p === '/api/phpfiles/qrestore') {
      if (session.role !== 'owner') return json(res, 403, { error: 'Solo un dueño puede hacer esto' });
      if (!auth.isPrivate(session)) return json(res, 403, { error: 'Active el modo privado' });
      const j = ctx.phpFiles.jailed.find(x => x.path === String(body.path || ''));
      if (!j || !j.qpath) return json(res, 404, { error: 'Ese archivo no está en cuarentena' });
      const restore = p.endsWith('qrestore');
      const id = setup.request(restore ? 'quarantine-restore' : 'quarantine-delete', { qpath: j.qpath }, session.user);
      const r = await ctx.defense.waitResult(id);
      if (!r.ok) return json(res, 400, { error: r.error || 'No se pudo' });
      ctx.phpFiles.unjail(j.path, restore);
      console.log(`[php nuevos] ${session.user} ${restore ? 'restauró' : 'borró para siempre'} ${j.path}`);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/phpfiles/ack' || p === '/api/phpfiles/quarantine') {
      if (session.role !== 'owner') return json(res, 403, { error: 'Solo un dueño puede hacer esto' });
      if (!auth.isPrivate(session)) return json(res, 403, { error: 'Active el modo privado' });
      const file = String(body.path || '');
      if (!ctx.phpFiles.isFound(file)) return json(res, 404, { error: 'Ese archivo no está en la lista de sospechosos' });
      if (p === '/api/phpfiles/ack') { ctx.phpFiles.acknowledge(file); console.log(`[php nuevos] ${session.user} marcó como revisado ${file}`); return json(res, 200, { ok: true }); }
      const id = setup.request('quarantine-php', { path: file, by: session.user }, session.user);
      const r = await ctx.defense.waitResult(id);
      if (!r.ok) return json(res, 400, { error: r.error || 'No se pudo poner en cuarentena' });
      const rec = ctx.phpFiles.quarantined(file, { qpath: r.output, by: session.user });
      // animacion: una patrulla se lleva los bichos en una capsula a la carcel
      if (rec) bus.emit('ev', { kind: 'phpfile', action: 'quarantine', account: rec.account, site: rec.site, domain: rec.domain, path: file, why: rec.why[0] });
      console.log(`[php nuevos] ${session.user} puso en cuarentena ${file} -> ${r.output}`);
      return json(res, 200, { ok: true });
    }
    // alertas por Telegram: conectar el bot, enganchar chats, elegir que avisa (dueno con el modo privado activo)
    if (p.startsWith('/api/alerts/')) {
      if (session.role !== 'owner') return json(res, 403, { error: 'Solo un dueño puede hacer esto' });
      if (!auth.isPrivate(session)) return json(res, 403, { error: 'Active el modo privado' });
      const A = ctx.alerts, act = p.slice('/api/alerts/'.length);
      try {
        if (act === 'state') return json(res, 200, A.status());
        if (act === 'token') return json(res, 200, { ok: true, ...(await A.setToken(body.token)) });
        if (act === 'link') return json(res, 200, { ok: true, ...A.startLink() });
        if (act === 'check') return json(res, 200, { ok: true, ...(await A.checkLink()) });
        if (act === 'conf') return json(res, 200, { ok: true, conf: A.setConf(body || {}) });
        if (act === 'unlink') { A.unlink(body.chat); return json(res, 200, { ok: true }); }
        if (act === 'email') return json(res, 200, await A.setEmail(body || {}));
        if (act === 'emailoff') { A.removeEmail(); return json(res, 200, { ok: true }); }
        if (act === 'disconnect') { A.disconnect(); console.log(`[alertas] ${session.user} desconectó Telegram`); return json(res, 200, { ok: true }); }
        if (act === 'test') { const ok = await A.send(`<b>Prueba de Atalaya</b>\nSi ve este mensaje, las alertas de <b>${cfg.title || 'Atalaya'}</b> llegan bien.`, { force: true }); return ok ? json(res, 200, { ok: true }) : json(res, 400, { error: 'Telegram no entregó el mensaje: revise que el chat siga enganchado' }); }
        if (act === 'summary') { const ok = await A.send(A.summary(), { force: true }); return ok ? json(res, 200, { ok: true }) : json(res, 400, { error: 'No se pudo enviar' }); }
      } catch (e) { return json(res, 400, { error: e.message }); }
      return json(res, 404, { error: 'No encontrado' });
    }
    // Cloudflare: conectar el token, apagar o desconectar (dueno con el modo privado activo)
    if (p.startsWith('/api/cloudflare/')) {
      if (session.role !== 'owner') return json(res, 403, { error: 'Solo un dueño puede hacer esto' });
      if (!auth.isPrivate(session)) return json(res, 403, { error: 'Active el modo privado' });
      const act = p.slice('/api/cloudflare/'.length), C = ctx.cloudflare;
      try {
        if (act === 'connect') { const st = await C.connect(body.token); console.log(`[cloudflare] ${session.user} conectó ${st.zones.length} zona(s)`); return json(res, 200, { ok: true, ...st }); }
        if (act === 'on') return json(res, 200, { ok: true, ...C.setOn(body.on) });
        if (act === 'disconnect') { C.disconnect(); console.log(`[cloudflare] ${session.user} desconectó Cloudflare`); return json(res, 200, { ok: true }); }
      } catch (e) { return json(res, 400, { error: e.message }); }
      return json(res, 404, { error: 'No encontrado' });
    }
    // informe mensual por correo: destinatarios de un sitio y envio inmediato (dueno con el modo privado activo)
    if (p === '/api/reports/save' || p === '/api/reports/send') {
      if (session.role !== 'owner') return json(res, 403, { error: 'Solo un dueño puede hacer esto' });
      if (!auth.isPrivate(session)) return json(res, 403, { error: 'Active el modo privado' });
      const t = privacy.analyticsTarget(ctx, body.id);
      if (!t) return json(res, 404, { error: 'No existe ese sitio' });
      try {
        if (p === '/api/reports/save') { const info = ctx.reports.set(t.key, { to: body.to, active: body.active !== false, name: t.name }); console.log(`[informes] ${session.user} guardó el informe de ${t.name}: ${info.to.length} destinatario(s)`); return json(res, 200, { ok: true, monthly: info }); }
        return json(res, 200, await ctx.reports.sendNow(t.key, { to: body.to, name: t.name, ym: body.ym }));
      } catch (e) { return json(res, 400, { error: e.message }); }
    }
    if (p.startsWith('/api/users/') || p === '/api/maestro') {
      if (session.role !== 'owner') return json(res, 403, { error: 'Solo un dueño puede hacer esto' });
      if (!auth.isPrivate(session)) return json(res, 403, { error: 'Active el modo privado' });
      if (p === '/api/maestro') {
        try { const url = maestroPass.link(cfg, session.user); console.log(`[maestro] pase para ${session.user} ip=${ip}`); return json(res, 200, { url }); }
        catch (e) { return json(res, 409, { error: e.message }); }
      }
      const action = p.slice('/api/users/'.length);
      if (action === 'list') return json(res, 200, { users: users.list(auth, session.user) });
      try { return json(res, 200, users.apply(auth, session, action, body)); } catch (e) { return json(res, 400, { error: e.message }); }
    }
    // analisis del disco a pedido (pesado: solo duenos; corre con la prioridad mas baja)
    // actualizaciones pendientes: consulta al gestor de paquetes (sin red), a pedido y por la cola de tareas pesadas
    if (p === '/api/audit/updates') {
      if (session.role !== 'owner') return json(res, 403, { error: 'Solo un dueño puede iniciar la revisión' });
      const r = jobs.run('updates', 'revisión de actualizaciones', session.user, () => ctx.hostAudit.checkPackages());
      return r.ok ? json(res, 200, { ok: true }) : json(res, 409, { error: r.error });
    }
    if (p === '/api/disk/analyze') {
      if (session.role !== 'owner') return json(res, 403, { error: 'Solo un dueño puede iniciar el análisis' });
      const r = diskmap.request(session.user);
      if (!r.ok) return json(res, 409, { error: r.error });
      return json(res, 200, { ok: true, status: diskmap.status() });
    }
    // auditoria de una base a pedido (solo lectura de archivos; pasa por la cola de tareas pesadas)
    if (p === '/api/audit/db') {
      if (session.role !== 'owner') return json(res, 403, { error: 'Solo un dueño puede iniciar una auditoría' });
      if (!auth.isPrivate(session)) return json(res, 403, { error: 'Active el modo privado para auditar una base' });
      const name = String(body.name || '').slice(0, 128);
      const db = dbAudit.cached().find(d => d.name === name);
      if (!db) return json(res, 404, { error: 'No existe esa base' });
      const r = jobs.run('db:' + db.dirName, 'auditoría de ' + db.name, session.user, () => { dbAudit.analyze(db.dirName); dbAudit.cache = null; });
      if (!r.ok) return json(res, 409, { error: r.error });
      return json(res, 200, { ok: true });
    }
    // proyectos: revision a pedido (sale a Internet: certificados, respuesta, RDAP y API de GitHub), unir y separar
    if (p.startsWith('/api/projects/')) {
      if (session.role !== 'owner') return json(res, 403, { error: 'Solo un dueño puede hacer esto' });
      if (!auth.isPrivate(session)) return json(res, 403, { error: 'Active el modo privado' });
      const P = ctx.projects;
      if (p === '/api/projects/analyze') {
        const ids = body.id === 'all' ? P.build().map(x => x.id) : [String(body.id || '')];
        if (!ids.length || (body.id !== 'all' && !P.byId(ids[0]))) return json(res, 404, { error: 'No existe ese proyecto' });
        const r = jobs.run('proyectos', ids.length > 1 ? `revisión de ${ids.length} proyectos` : `revisión de ${P.byId(ids[0]).name}`, session.user, async () => {
          for (const id of ids) { try { await P.analyze(id); } catch (e) { console.error('[proyectos]', id, e.message); } }
        });
        return r.ok ? json(res, 200, { ok: true }) : json(res, 409, { error: r.error });
      }
      const conf = JSON.parse(JSON.stringify(cfg.projects || {}));
      conf.merges = conf.merges || []; conf.splits = conf.splits || []; conf.names = conf.names || {}; conf.hidden = conf.hidden || [];
      const a = P.byId(String(body.id || ''));
      if (!a) return json(res, 404, { error: 'No existe ese proyecto' });
      if (p === '/api/projects/merge') {
        const b = P.byId(String(body.into || ''));
        if (!b || b === a) return json(res, 400, { error: 'Elija otro proyecto' });
        conf.merges.push([a.parts[0].key, b.parts[0].key]);
      } else if (p === '/api/projects/split') {
        // separa las piezas sugeridas por nombre y deshace uniones manuales que las incluyan
        const keys = new Set(a.parts.map(x => x.key));
        conf.merges = conf.merges.filter(([x, y]) => !(keys.has(x) || keys.has(y)));
        conf.splits.push(...a.suggested);
      } else if (p === '/api/projects/rename') conf.names[a.key] = String(body.name || '').trim().slice(0, 60) || undefined;
      else if (p === '/api/projects/hide') conf.hidden.push(a.key);
      else return json(res, 404, { error: 'No encontrado' });
      settings.save(cfg, { projects: conf });
      P.invalidate();
      return json(res, 200, { ok: true });
    }
    // hostings compartidos: alta (devuelve el comando con el codigo), nuevo codigo, baja y pedidos
    if (p.startsWith('/api/agents/')) {
      if (session.role !== 'owner') return json(res, 403, { error: 'Solo un dueño puede administrar hostings' });
      try {
        const base = cfg.publicUrl || `https://${req.headers.host}`;
        const cmd = r => ({ ...r, url: base, command: `curl -fsSL ${base}/install/agent.sh | sh -s -- ${base} ${r.code}`, cron: `curl -fsSL ${base}/install/agent.sh | sh -s -- ${base} ${r.code}` });
        if (p === '/api/agents/create') { const r = cmd(agents.create(body.id, body.label)); console.log(`[agente] alta ${r.id} por ${session.user}`); return json(res, 200, r); }
        if (p === '/api/agents/recode') return json(res, 200, cmd(agents.recode(String(body.id || ''))));
        if (p === '/api/agents/remove') { agents.remove(String(body.id || '')); accounts.sync(); console.log(`[agente] baja ${body.id} por ${session.user}`); return json(res, 200, { ok: true }); }
        if (p === '/api/agents/request') { agents.request(String(body.id || ''), String(body.what || '')); return json(res, 200, { ok: true }); }
        // .zip del plugin de WordPress con la direccion y un codigo de un solo uso: se sube, se activa y queda conectado
        if (p === '/api/agents/wp-plugin') {
          const id = String(body.id || '').toLowerCase();
          const r = agents.reg()[id] ? agents.recode(id) : agents.create(id, body.label || id);
          console.log(`[agente] plugin de WordPress para ${r.id} por ${session.user}`);
          return send(res, 200, wpPluginZip({ url: base, code: r.code }), { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename="atalaya-agent-${r.id}.zip"` });
        }
        if (p === '/api/agents/list') return json(res, 200, { agents: agents.ids().map(id => ({ id, ...agents.info(agents.account(id), true), pending: !agents.reg()[id].sha })) });
      } catch (e) { return json(res, 400, { error: e.message }); }
      return json(res, 404, { error: 'No encontrado' });
    }
    // sitios vigilados por su dominio: alta, cambio, baja y medir ahora
    if (p.startsWith('/api/websites/')) {
      if (session.role !== 'owner') return json(res, 403, { error: 'Solo un dueño puede administrar los sitios vigilados' });
      try {
        const W = ctx.websites, withToken = x => ({ ...x, siteToken: ctx.analytics.siteToken('site:' + W.groupId(x.id)) });
        if (p === '/api/websites/list') return json(res, 200, { sites: W.list().map(withToken), script: new URL('a.js', (cfg.publicUrl || `https://${req.headers.host}`).replace(/\/?$/, '/')).href, max: cfg.limits && cfg.limits.sites != null ? cfg.limits.sites : null });
        if (p === '/api/websites/add') { const r = W.add(body || {}); res.atalayaNote = `${r.domain}${r.expect ? ' · espera ' + r.expect : ''}${r.phrase ? ' · con frase' : ''}`; console.log(`[sitios] ${session.user} ${body.edit ? 'cambió' : 'agregó'} ${r.domain}`); return json(res, 200, { ok: true, site: withToken(r) }); }
        if (p === '/api/websites/remove') { W.remove(String(body.id || '')); console.log(`[sitios] ${session.user} quitó ${body.id}`); return json(res, 200, { ok: true }); }
        if (p === '/api/websites/check') { const st = await W.check(String(body.id || '')); if (!st) throw new Error('No vigila ese sitio'); return json(res, 200, { ok: true, site: W.list().find(x => x.id === body.id) }); }
      } catch (e) { return json(res, 400, { error: e.message }); }
      return json(res, 404, { error: 'No encontrado' });
    }
    // tema por defecto para todas las pantallas (cada pantalla puede elegir otro solo para ella)
    if (p === '/api/theme') {
      if (session.role !== 'owner') return json(res, 403, { error: 'Solo un dueño puede cambiar el tema de todas las pantallas' });
      const id = String(body.id || '');
      if (!listThemes().some(t => t.id === id)) return json(res, 404, { error: 'No existe ese tema' });
      settings.save(cfg, { theme: id });
      for (const c of clients) sseWrite(c, 'theme', { id });
      console.log(`[tema] ${id} por ${session.user}`);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/public-all') { auth.lockAll(); console.log(`[privado] bloqueo global por ${session.user}`); modeChanged(null); return json(res, 200, { ok: true }); }
    return json(res, 404, { error: 'No encontrado' });
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '');

  if (p === '/api/stream') {
    if (!session) return json(res, 401, { error: 'Sesion expirada' });
    res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.write('retry: 3000\n\n');
    const c = { res, session, priv: auth.isPrivate(session) };
    clients.add(c);
    sseWrite(c, 'hello', helloFor(c));
    pushState(c);
    const hb = setInterval(() => { try { res.write(': hb\n\n'); } catch { } }, 15000);
    req.on('close', () => { clearInterval(hb); clients.delete(c); });
    return;
  }
  // favicon de un proyecto: solo con sesion en modo privado (la imagen delata la marca)
  if (p.startsWith('/api/favicon/')) {
    if (!session || !auth.isPrivate(session)) return send(res, 404, '');
    const f = ctx.favicons.file(p.slice('/api/favicon/'.length));
    if (!f) return send(res, 404, '');
    res.writeHead(200, { ...SEC_HEADERS, 'Content-Type': f.type, 'Cache-Control': 'private, max-age=86400', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'", 'Content-Disposition': 'inline' });
    return res.end(f.body);
  }
  if (p === '/api/detail') {
    if (!session) return json(res, 401, { error: 'Sesion expirada' });
    const kind = url.searchParams.get('kind'), id = String(url.searchParams.get('id') || '').slice(0, 80);
    if (!['app', 'site', 'session', 'district', 'system', 'security', 'webdef', 'mail', 'metric', 'databases', 'database', 'projects', 'project', 'audit', 'jail', 'prisoner', 'analytics'].includes(kind)) return json(res, 400, { error: 'Tipo invalido' });
    const d = privacy.detail(ctx, kind, id, auth.isPrivate(session), { path: url.searchParams.get('path') || '', range: Number(url.searchParams.get('range')) || 30 });
    return d ? json(res, 200, d) : json(res, 404, { error: 'Ya no existe' });
  }
  // temas instalados: cada carpeta de web/themes con su theme.json
  if (p === '/api/themes') {
    if (!session) return json(res, 401, { error: 'Sesion expirada' });
    return json(res, 200, { current: cfg.theme || 'ciudad', themes: listThemes() });
  }
  if (p === '/api/changelog') {
    if (!session) return json(res, 401, { error: 'Sesion expirada' });
    return json(res, 200, { version: VERSION, releases: parseChangelog() });
  }
  // lo que la pantalla de acceso necesita saber antes de entrar (sin datos del servidor)
  if (p === '/api/acceso') return json(res, 200, cfg.promo !== false ? { promo: true, version: VERSION } : { promo: false });
  if (p === '/api/me') return session ? json(res, 200, { user: session.user, role: session.role }) : json(res, 401, { error: 'no' });

  if (p === '/login') return setup.isSetupMode() ? send(res, 302, '', { Location: 'setup' }) : serveStatic(res, '/login.html');
  if (p === '/' || p === '/index.html') {
    if (setup.isSetupMode()) return send(res, 302, '', { Location: 'setup' });
    if (!session) return send(res, 302, '', { Location: 'login' });
    return serveStatic(res, '/index.html');
  }
  if (/^\/(vendor|js|css|img|fonts|themes)\//.test(p) || p === '/favicon.svg') return serveStatic(res, p);
  return send(res, 404, 'No encontrado');
}

// API del asistente: codigo de un solo uso en modo configuracion; despues, solo duenos
async function handleSetup(req, res, p, url, session, ip) {
  if (req.method === 'POST' && req.headers['x-atalaya'] !== '1') return json(res, 400, { error: 'Solicitud invalida' });
  let body = {};
  if (req.method === 'POST') { try { body = await readBody(req, 16384); } catch { return json(res, 400, { error: 'Solicitud invalida' }); } }
  if (p === '/api/setup/verify' && req.method === 'POST') {
    if (!setup.isSetupMode()) return json(res, 409, { error: 'Atalaya ya está configurado: entre con su usuario.' });
    const r = setup.verify(body.code, ip);
    if (r.error) return json(res, r.status, { error: r.error });
    return json(res, 200, { ok: true }, { 'Set-Cookie': `atalaya_setup=${r.token}; Path=${cfg.basePath}; HttpOnly; SameSite=Strict; Max-Age=7200${isHttps(req) ? '; Secure' : ''}` });
  }
  if (p === '/api/setup/mode') return json(res, 200, { setupMode: setup.isSetupMode(), owner: !!(session && session.role === 'owner'), version: VERSION, edition: cfg.edition });
  if (!setup.allowed(req, session)) return json(res, 401, { error: 'Necesita el código de configuración o entrar como dueño' });
  const by = session ? session.user : 'asistente';
  try {
    if (p === '/api/setup/state') return json(res, 200, setup.state(req));
    if (p === '/api/setup/owner' && req.method === 'POST') {
      if (!setup.isSetupMode()) return json(res, 409, { error: 'Ya existe un dueño' });
      auth.setUser(String(body.user || '').trim(), String(body.pin || ''), 'owner');
      const r = await auth.login(String(body.user).trim(), String(body.pin), ip);
      if (r.error) return json(res, r.status, { error: r.error });
      console.log(`[asistente] dueño creado: ${r.session.user}`);
      return json(res, 200, { ok: true }, { 'Set-Cookie': `atalaya_sid=${r.token}; Path=${cfg.basePath}; HttpOnly; SameSite=Strict; Max-Age=${cfg.sessionDays * 86400}${isHttps(req) ? '; Secure' : ''}` });
    }
    if (p === '/api/setup/settings' && req.method === 'POST') {
      const patch = {};
      if (typeof body.title === 'string') patch.title = body.title.trim().slice(0, 40) || 'Atalaya';
      if (typeof body.subtitle === 'string') patch.subtitle = body.subtitle.trim().slice(0, 80);
      if (typeof body.publicUrl === 'string' && cfg.edition !== 'cloud') { const u = body.publicUrl.trim().replace(/\/$/, ''); if (u && !/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(u)) return json(res, 400, { error: 'URL inválida (ej. https://atalaya.su-dominio.com)' }); patch.publicUrl = u; }
      if (body.public && typeof body.public === 'object') patch.public = { showAccountNames: !!body.public.showAccountNames, showAppNames: !!body.public.showAppNames };
      if (typeof body.promo === 'boolean') patch.promo = body.promo;
      settings.save(cfg, patch);
      return json(res, 200, { ok: true });
    }
    if (p === '/api/setup/geo' && req.method === 'POST') { const f = await setup.downloadGeo(); return json(res, 200, { ok: true, file: f }); }
    if (p === '/api/setup/action' && req.method === 'POST') {
      if (!fs.existsSync('/etc/systemd/system/atalaya-helper.path')) return json(res, 409, { error: 'El ayudante no está instalado: ejecute de nuevo ./install.sh' });
      return json(res, 200, { id: setup.request(String(body.action), body.params || {}, by) });
    }
    if (p === '/api/setup/result') return json(res, 200, setup.result(url.searchParams.get('id')) || { pending: true });
    if (p === '/api/setup/connector' && req.method === 'POST') {
      const id = String(body.id || '').toLowerCase();
      res.atalayaNote = `${String(body.type || '').slice(0, 20)} ${id.slice(0, 31)}`;
      if (body.type === 'vercel') secrets.addConnector(id, { type: 'vercel', name: id, token: String(body.token || ''), teamId: body.teamId || undefined, drainSecret: body.drainSecret || undefined });
      else if (body.type === 'supabase') secrets.addConnector(id, { type: 'supabase', name: id, mgmtToken: body.mgmtToken || undefined,
        projects: (body.projects || []).filter(x => x && /^[a-z0-9]{8,40}$/.test(String(x.ref || '')) && x.serviceKey).map(x => ({ ref: String(x.ref), name: String(x.name || x.ref), serviceKey: String(x.serviceKey) })) });
      else if (body.type === 'github') secrets.addConnector(id, { type: 'github', name: id, token: String(body.token || '') });
      else if (body.type === 'cloudflare') {
        // el token se prueba antes de guardarlo: debe ver la cuenta
        const accountId = /^[0-9a-f]{32}$/.test(String(body.accountId || '').trim()) ? String(body.accountId).trim() : undefined;
        let v; try { v = await require('./connectors/cloudflare').verify(body.token, accountId); } catch (e) { return json(res, 400, { error: e.message }); }
        secrets.addConnector(id, { type: 'cloudflare', name: id, token: String(body.token).trim(), accountId: v.accountId });
        return json(res, 200, { ok: true, account: v.accountName, accounts: v.accounts });
      }
      else if (body.type === 'leakix') { secrets.addConnector('leakix', { type: 'leakix', name: 'leakix', apiKey: String(body.apiKey || '').trim() }); ctx.leakix.check().catch(() => { }); }
      else return json(res, 400, { error: 'Tipo de conector desconocido' });
      return json(res, 200, { ok: true, drainUrl: body.type === 'vercel' ? `${cfg.publicUrl || 'https://' + req.headers.host}/api/drains/vercel/${id}` : null });
    }
    // Atalaya Hosting: instala el agente en esta misma cuenta (crea su tarea cron) con un clic del asistente
    if (p === '/api/setup/agent-local' && req.method === 'POST') {
      if (cfg.edition !== 'hosting') return json(res, 400, { error: 'Solo en la edición Hosting' });
      const base = cfg.publicUrl || `${req.headers['x-forwarded-proto'] === 'http' ? 'http' : 'https'}://${String(req.headers['x-forwarded-host'] || req.headers.host).split(',')[0].trim()}`;
      const r = agents.reg()['esta-cuenta'] ? agents.recode('esta-cuenta') : agents.create('esta-cuenta', 'Esta cuenta');
      // asincrono: el instalador le habla a este mismo servidor (canje del codigo y primer envio)
      const out = await new Promise(resolve => require('child_process').execFile('sh', [ROOT + '/agent/install.sh', base, r.code], { timeout: 120000 },
        (err, stdout, stderr) => resolve({ status: err ? (err.code || 1) : 0, stdout: String(stdout), stderr: String(stderr) })));
      console.log(`[agente] instalacion local por ${by}: codigo ${out.status}`);
      if (out.status !== 0) return json(res, 500, { error: (out.stdout + out.stderr).trim().split('\n').slice(-3).join(' ') || 'No se pudo instalar' });
      accounts.sync();
      return json(res, 200, { ok: true, output: out.stdout.trim() });
    }
    if (p === '/api/setup/remote' && req.method === 'POST') {
      const name = String(body.name || '').toLowerCase();
      const token = secrets.addRemote(name);
      const base = cfg.publicUrl || `https://${req.headers.host}`;
      res.atalayaNote = name.slice(0, 31);
      return json(res, 200, { command: `curl -fsSL ${base}/install/remote-hook.sh | sh -s -- ${base} ${name}:${token}`,
        commandWin: `irm ${base}/install/remote-hook.js -OutFile $env:TEMP\\atalaya-hook.js; node $env:TEMP\\atalaya-hook.js ${base} ${name}:${token}` });
    }
    if (p === '/api/setup/install-command' && req.method === 'POST') {
      if (!(session && session.role === 'owner')) return json(res, 403, { error: 'Solo un dueño' });
      return json(res, 200, setup.installCommand(req, by));
    }
    if (p === '/api/setup/finish' && req.method === 'POST') { setup.finish(); return json(res, 200, { ok: true }); }
  } catch (e) { return json(res, 400, { error: e.message }); }
  return json(res, 404, { error: 'No encontrado' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch(e => { console.error(e); try { json(res, 500, { error: 'Error interno' }); } catch { } });
});

// ---- receptor de hooks de Claude Code: solo 127.0.0.1, puerto aparte que Apache no expone ----

const rejected = new Set();
// Cada cuenta tiene su token (hooks/install.js lo genera): ~/.claude/atalaya-hook.header, legible solo por
// esa cuenta. Aqui se guarda su sha256. Sin token valido no se acepta ningun evento.
const hookTokensFile = cfg.stateDir + '/hook-tokens.json';
let hookTokens = {}, hookTokensMtime = -1;
function hookUser(req) {
  let m = 0; try { m = fs.statSync(hookTokensFile).mtimeMs; } catch { }
  if (m !== hookTokensMtime) { hookTokensMtime = m; hookTokens = readJSON(hookTokensFile, {}) || {}; }
  const h = String(req.headers['x-atalaya-hook'] || '');
  const i = h.indexOf(':');
  if (i < 1) return null;
  const user = h.slice(0, i), token = h.slice(i + 1);
  const want = Object.prototype.hasOwnProperty.call(hookTokens, user) ? hookTokens[user] : null;
  if (!want || token.length < 32) return null;
  const got = require('crypto').createHash('sha256').update(token).digest('hex');
  return got.length === want.length && require('crypto').timingSafeEqual(Buffer.from(got), Buffer.from(want)) ? user : null;
}
const hookServer = http.createServer((req, res) => {
  const done = code => { res.writeHead(code); res.end(); };
  if (req.method !== 'POST' || req.url !== '/hook' || req.headers['x-forwarded-for']) return done(404);
  const tokenUser = hookUser(req);
  if (!tokenUser) { const k = 'token'; if (!rejected.has(k)) { rejected.add(k); console.log('[hook] descartado: token ausente o invalido'); } req.resume(); return done(401); }
  let n = 0; const chunks = [];
  req.on('data', c => { n += c.length; if (n <= 262144) chunks.push(c); });
  req.on('end', () => {
    done(204);
    if (n > 262144) return; // payload gigante (ej. Write de un archivo enorme): se ignora
    let ev;
    try { ev = JSON.parse(Buffer.concat(chunks).toString()); } catch { return; }
    const reject = why => { const k = why + ev?.hook_event_name; if (!rejected.has(k)) { rejected.add(k); console.log(`[hook] descartado (${why}): ${ev?.hook_event_name} ${String(ev?.transcript_path).slice(0, 120)}`); } };
    if (!ev || !HOOK_EVENTS.has(ev.hook_event_name) || typeof ev.transcript_path !== 'string') return reject('evento');
    // la cuenta sale de la ruta del transcript, no de lo que diga el cliente
    const tp = path.normalize(ev.transcript_path);
    const m = tp.match(/^\/(?:home\/([a-z0-9_-]+)|(root))\/\.claude\/projects\/[^/]+\/[0-9a-f-]{36}\.jsonl$/);
    if (!m) return reject('ruta');
    const user = m[1] || m[2];
    if (!cfg.accounts[user]) return reject('cuenta');
    // el token dice quien envia: solo puede hablar de sus propias sesiones
    if (user !== tokenUser) return reject('token de otra cuenta');
    ev.transcript_path = tp;
    try { claude.onHook(ev, user); } catch (e) { console.error('[hook]', e.message); }
  });
});
// si el puerto de hooks falla (ej. ocupado) el tablero sigue vivo: solo se pierde el detalle de hooks
hookServer.on('error', e => console.error(`[hook] receptor no disponible en :${cfg.hookPort || 3952}: ${e.code || e.message}. El tablero sigue funcionando con los transcripts.`));
// en Atalaya Hosting no hay puerto de hooks (Passenger solo atiende el principal)
if (cfg.hookPort !== 0) hookServer.listen(cfg.hookPort || 3952, '127.0.0.1');

claude.homes = accounts.homes();
// WSL (Windows): una distribucion con Claude Code que se enciende o se apaga cambia las carpetas a leer
accounts.onHomes = () => { host.accountsHome = accounts.homes().filter(a => a.user !== 'root'); claude.homes = accounts.homes(); };
// a que proyecto pertenece un archivo que un agente lee o edita: la app de PM2 cuya carpeta lo contiene o
// el sitio cuyo docroot lo contiene (gana la ruta mas larga); para el haz del agente al edificio
claude.projectOf = file => {
  let best = null, len = 0;
  const inside = dir => dir && (file === dir || file.startsWith(dir.replace(/\/+$/, '') + '/'));
  for (const a of host.apps) if (a.source === 'pm2' && inside(a.cwd) && a.cwd.length > len) { best = { account: a.account, app: a.name }; len = a.cwd.length; }
  for (const g of logs.sites) if (inside(g.docroot) && g.docroot.length > len) { best = { account: g.account, site: g.id }; len = g.docroot.length; }
  return best;
};

// Altas y bajas de cuentas y dominios: se revisa cada 15 s si cambio algo en cPanel o en /etc/passwd
// (solo se mira la fecha de modificacion; la relectura completa ocurre solo cuando hay cambios)
let watchSig = '';
function watchSignature() {
  const paths = ['/etc/passwd', ...(platform.panel ? platform.panel.watchPaths() : [])];
  return paths.map(f => { const st = statSafe(f); return f + ':' + (st ? st.mtimeMs : 0); }).join('|');
}
setInterval(() => {
  const sig = watchSignature();
  if (sig === watchSig) return;
  const first = !watchSig;
  watchSig = sig;
  if (first) return;
  accounts.sync();
  host.accountsHome = accounts.homes().filter(a => a.user !== 'root');
  claude.homes = accounts.homes();
  logs.loadDomains(true);
  logs.scanDomlogs();
}, 15000);
watchSig = watchSignature();

if (!(cfg.services && cfg.services.disabled)) services.start();
if (!(cfg.docker && cfg.docker.disabled)) docker.start();
connectors.start();
if (track.on) setInterval(() => track.connectors(connectors.infos()), 60000).unref();
host.start();
claude.start();
logs.start();
if (process.env.ATALAYA_SOCKET) { try { fs.unlinkSync(process.env.ATALAYA_SOCKET); } catch { } }
const listenOn = process.env.ATALAYA_SOCKET ? [process.env.ATALAYA_SOCKET] : [cfg.port, cfg.host];
server.listen(...listenOn, () => console.log(`Atalaya ${VERSION}${{ hosting: ' (edición Hosting)', cloud: ' (edición Cloud)', equipo: ' (edición Equipo)' }[cfg.edition] || ''} escuchando en ${process.env.ATALAYA_SOCKET || `http://${cfg.host}:${server.address().port}`}`));

// Instalacion nueva: el asistente tambien responde en un puerto publico temporal (solo /setup, su API
// y los archivos de la interfaz) hasta que se termina el asistente; despues ese puerto se cierra solo.
if (setup.isSetupMode() && cfg.setupPort !== 0) {
  const sp = cfg.setupPort || 3951;
  const allow = p => p === '/setup' || p.startsWith('/api/setup/') || /^\/(vendor|js|css|fonts)\//.test(p) || p === '/favicon.svg';
  const tmp = http.createServer((req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    if (p === '/') { res.writeHead(302, { Location: '/setup' }); return res.end(); }
    if (!allow(p)) { res.writeHead(404); return res.end(); }
    handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch { } });
  });
  tmp.on('error', e => console.log(`[asistente] puerto temporal ${sp} no disponible (${e.code})`));
  tmp.listen(sp, '0.0.0.0', () => console.log(`[asistente] tambien disponible en el puerto ${sp} mientras no haya usuarios`));
  // se cierra al terminar el asistente (no al crear el dueno: quedan pasos por hacer) o a las 2 horas
  const opened = Date.now();
  const t = setInterval(() => {
    if (cfg.setupDone || Date.now() - opened > 2 * 3600000) { tmp.close(); clearInterval(t); console.log('[asistente] puerto temporal cerrado'); }
  }, 5000);
}
