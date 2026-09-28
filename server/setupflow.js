'use strict';
// Asistente web de primera configuracion y distribucion a otros servidores.
// - Modo configuracion: mientras no haya usuarios. Se entra con un codigo de un solo uso que deja el
//   instalador en <stateDir>/setup-token (nadie puede "reclamar" la instalacion sin acceso al servidor).
// - Despues, el dueno puede volver a abrir el asistente desde el menu.
// - "Instalar en otro servidor": tokens de descarga de 24 h para el paquete de esta version.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const zlib = require('zlib');
const { execFile } = require('child_process');
const settings = require('./settings');
const { readJSON, writeJSONAtomic } = require('./util');

const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const rid = () => crypto.randomBytes(9).toString('hex');

// una cuenta de Cloudflare conectada mas de una vez: los conectores que llegaron despues se suman al primero
function joinedTo(c, all) {
  if (c.type !== 'cloudflare' || !c.accountId) return undefined;
  const first = all.filter(x => x.type === 'cloudflare' && x.accountId === c.accountId).sort((a, b) => String(a.added || '').localeCompare(String(b.added || '')))[0];
  return first && first.id !== c.id ? first.name || first.id : undefined;
}

class SetupFlow {
  constructor(ctx) {
    Object.assign(this, ctx); // cfg, auth, secrets, platform, platformMod, logs, ROOT, VERSION
    this.tokenFile = path.join(this.cfg.stateDir, 'setup-token');
    this.distFile = path.join(this.cfg.stateDir, 'dist-tokens.json');
    this.sessions = new Map(); // sha(cookie) -> expira
    this.fails = new Map();
  }

  isSetupMode() { this.auth.syncUsers(); return Object.keys(this.auth.users).length === 0; }

  // codigo de un solo uso (lo crea el instalador; si falta, el servicio lo crea al arrancar en modo configuracion)
  ensureCode() {
    if (!this.isSetupMode() || fs.existsSync(this.tokenFile)) return;
    const code = crypto.randomBytes(5).toString('hex').toUpperCase().replace(/(.{5})(.{5})/, '$1-$2');
    fs.writeFileSync(this.tokenFile, code + '\n', { mode: 0o600 });
    console.log(`[asistente] modo configuracion: abra /setup; el codigo esta en ${this.tokenFile}`);
  }
  code() { try { return fs.readFileSync(this.tokenFile, 'utf8').trim(); } catch { return null; } }

  // quien puede usar el asistente: sesion de configuracion (modo inicial) o un dueno ya logueado
  allowed(req, session) {
    if (session && session.role === 'owner') return true;
    if (!this.isSetupMode()) return false;
    const c = (req.headers.cookie || '').match(/(?:^|;\s*)atalaya_setup=([^;]+)/);
    const exp = c && this.sessions.get(sha(decodeURIComponent(c[1])));
    return !!exp && exp > Date.now();
  }

  verify(code, ip) {
    const f = this.fails.get(ip) || { n: 0, until: 0 };
    if (f.until > Date.now()) return { status: 429, error: 'Demasiados intentos. Espere unos minutos.' };
    const want = this.code();
    const got = String(code || '').trim().toUpperCase();
    const ok = want && got.length === want.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
    if (!ok) { f.n++; if (f.n >= 5) { f.until = Date.now() + 15 * 60000; f.n = 0; } this.fails.set(ip, f); return { status: 401, error: 'Código incorrecto' }; }
    this.fails.delete(ip);
    const token = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(sha(token), Date.now() + 2 * 3600000);
    return { token };
  }

  state(req) {
    const s = this.platformMod.summary(this.cfg);
    const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
    const proto = req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
    let domains = [];
    if ((this.cfg.edition || 'vps') === 'vps') try { domains = [...new Set(fs.readFileSync('/etc/userdomains', 'utf8').split('\n').map(l => l.split(':')[0].trim()).filter(d => d && d !== '*' && !d.startsWith('*.')))].sort().slice(0, 300); } catch { }
    return {
      version: this.VERSION, edition: this.cfg.edition, setupMode: this.isSetupMode(), users: Object.keys(this.auth.users).length,
      platform: s, settings: { title: this.cfg.title, subtitle: this.cfg.subtitle, publicUrl: this.cfg.publicUrl, public: this.cfg.public, promo: this.cfg.promo !== false },
      guessUrl: host ? `${proto}://${host}` : '', geo: this.logs.geo && this.logs.geo.file ? this.logs.geo.file : null,
      connectors: this.secrets.connectors().map(c => ({ id: c.id, type: c.type, name: c.name || c.id, joined: joinedTo(c, this.secrets.connectors()), projects: c.type === 'supabase' ? (c.projects || []).map(p => p.name || p.ref) : undefined })), remotes: this.secrets.remotes(), agents: Object.keys(this.secrets.data.agents || {}).filter(k => this.secrets.data.agents[k].sha),
      helper: (this.cfg.edition || 'vps') === 'vps' && fs.existsSync('/etc/systemd/system/atalaya-helper.path'), limits: this.cfg.limits || null, cpanelDomains: s.panelId === 'cpanel' ? domains : [],
      ...this.proxySnippet(s.proxyHint),
    };
  }

  // ejemplo de proxy para el servidor web detectado, con el puerto real
  proxySnippet(hint) {
    const file = { 'subdomain-htaccess': 'cpanel-htaccess', plesk: 'plesk-nginx.conf', directadmin: 'directadmin.conf', openlitespeed: 'openlitespeed.conf', nginx: 'nginx.conf', apache: 'apache.conf' }[hint] || 'nginx.conf';
    let text = '';
    try { text = fs.readFileSync(path.join(this.ROOT, 'deploy/proxy', file), 'utf8').replace(/127\.0\.0\.1:3950/g, `127.0.0.1:${this.cfg.port}`); } catch { }
    return { proxyFile: file, proxySnippet: text };
  }

  // pedido al ayudante privilegiado (lista cerrada de acciones)
  request(action, params, by) {
    if (!['install-hooks', 'uninstall-hooks', 'cpanel-publish', 'mysql-monitor', 'mysql-monitor-off', 'block-ip', 'unblock-ip', 'block-list', 'unblock-manual', 'quarantine-php', 'quarantine-delete', 'quarantine-restore'].includes(action)) throw new Error('Accion no permitida');
    const dir = path.join(this.cfg.stateDir, 'requests');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const id = rid();
    writeJSONAtomic(path.join(dir, id + '.json'), { id, action, params: params || {}, by, at: new Date().toISOString() }, 0o600);
    return id;
  }
  result(id) {
    if (!/^[a-f0-9]{18}$/.test(String(id))) return null;
    return readJSON(path.join(this.cfg.stateDir, 'results', id + '.json'), null);
  }

  // base de paises gratuita (DB-IP Lite, CC-BY 4.0) en la carpeta de estado
  downloadGeo() {
    const dest = path.join(this.cfg.stateDir, 'dbip-country-lite.mmdb');
    const months = [0, 1].map(k => { const x = new Date(); x.setDate(1); x.setMonth(x.getMonth() - k); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; });
    const one = m => new Promise((resolve, reject) => https.get(`https://download.db-ip.com/free/dbip-country-lite-${m}.mmdb.gz`, r => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('HTTP ' + r.statusCode)); }
      const out = fs.createWriteStream(dest + '.tmp');
      r.pipe(zlib.createGunzip()).pipe(out).on('finish', () => { fs.renameSync(dest + '.tmp', dest); resolve(dest); }).on('error', reject);
    }).on('error', reject));
    return one(months[0]).catch(() => one(months[1])).then(f => { this.cfg.geoipPath = f; if (this.logs.geo) this.logs.geo.load(); return f; });
  }

  finish() {
    settings.save(this.cfg, { setupDone: true });
    try { fs.unlinkSync(this.tokenFile); } catch { }
    this.sessions.clear();
  }

  // ---------------- distribucion
  distToken(by) {
    const token = crypto.randomBytes(24).toString('base64url');
    const d = readJSON(this.distFile, {}) || {};
    for (const [k, v] of Object.entries(d)) if (v.exp < Date.now()) delete d[k];
    d[sha(token)] = { exp: Date.now() + 24 * 3600000, uses: 5, by };
    writeJSONAtomic(this.distFile, d, 0o600);
    return token;
  }
  useDist(token, consume) {
    const d = readJSON(this.distFile, {}) || {};
    const k = sha(String(token || ''));
    const t = Object.prototype.hasOwnProperty.call(d, k) ? d[k] : null;
    if (!t || t.exp < Date.now() || t.uses <= 0) return false;
    if (consume) { t.uses--; writeJSONAtomic(this.distFile, d, 0o600); }
    return true;
  }
  // paquete de esta version: el codigo sin config.json, sin .git y sin dependencias de desarrollo
  bundle() {
    const dir = path.join(this.cfg.stateDir, 'dist');
    const file = path.join(dir, `atalaya-${this.VERSION}.tar.gz`);
    if (fs.existsSync(file)) return Promise.resolve(file);
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    return new Promise((resolve, reject) => execFile('tar', ['-czf', file + '.tmp', '--exclude=./config.json', '--exclude=./.git', '--exclude=./vendor-src/node_modules',
      '--exclude=./test/fixtures', '--exclude=./docs', '--exclude=*.atalaya-bak*', '--exclude=./cloud', '--exclude=./site', '--exclude=./public', '--exclude=./dist', '-C', this.ROOT, '.'], { timeout: 60000 }, err => {
      if (err) return reject(err);
      fs.renameSync(file + '.tmp', file); resolve(file);
    }));
  }
  installCommand(req, by) {
    const base = this.cfg.publicUrl || `https://${req.headers.host}`;
    const t = this.distToken(by);
    return { command: `curl -fsSL ${base}/get | sudo sh -s -- --token=${t}`, hostingCommand: `curl -fsSL ${base}/get | sh -s -- --hosting --token=${t} --domain=atalaya.SU-DOMINIO.com`,
      expires: Date.now() + 24 * 3600000, base };
  }
}

module.exports = { SetupFlow };
