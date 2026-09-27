'use strict';
// Archivos expuestos: una vez al dia Atalaya busca en los docroots carpetas de control de versiones (.git,
// .svn, .hg) y archivos .env, y los pide a este mismo servidor por TODOS los nombres que llegan a ese
// docroot: el dominio, sus alias (www., mail. y los que tenga), la subcarpeta vista desde el dominio padre y
// la IP directa. El caso tipico: un .git se sirve por mail.dominio y por la IP aunque el
// dominio principal lo tapaba. Solo lectura: se pide el primer kilobyte, se decide con las mismas reglas
// que la defensa web y nunca se guarda el contenido.
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { readJSON, writeJSONAtomic } = require('../util');
const { looksExposed } = require('../webdefense');

const SENSITIVE = [['.git', 'HEAD'], ['.git', 'config'], ['.svn', 'entries'], ['.hg', 'requires'], ['.env', null]];
const MAX_DEPTH = 3, MAX_FILES = 400, MAX_PROBES = 1500;

// IP publica del servidor. Con el servicio endurecido (sin AF_NETLINK) os.networkInterfaces() falla: se usa
// la IP principal que guarda cPanel, o la de la configuracion.
function publicIPv4(cfg = {}) {
  if (cfg.publicIp) return cfg.publicIp;
  let ifs = {};
  try { ifs = os.networkInterfaces(); } catch { ifs = {}; }
  const main = (() => { try { return fs.readFileSync('/var/cpanel/mainip', 'utf8').trim(); } catch { return ''; } })();
  if (/^\d+\.\d+\.\d+\.\d+$/.test(main)) return main;
  for (const list of Object.values(ifs)) for (const i of list || []) if (i.family === 'IPv4' && !i.internal && !/^(10|127|169\.254|192\.168)\./.test(i.address) && !/^172\.(1[6-9]|2\d|3[01])\./.test(i.address)) return i.address;
  return null;
}

// carpetas y archivos sensibles dentro de un docroot (sin entrar a node_modules ni seguir enlaces)
function findSensitive(root) {
  const out = [];
  const walk = (dir, depth) => {
    if (depth > MAX_DEPTH || out.length >= MAX_FILES) return;
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      if (e.isSymbolicLink()) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory() && (e.name === '.git' || e.name === '.svn' || e.name === '.hg')) {
        for (const [d, f] of SENSITIVE) if (d === e.name && f && fs.existsSync(path.join(p, f))) out.push(path.join(p, f));
        continue;
      }
      if (e.isFile() && /^\.env(\.[\w-]+)?$/.test(e.name) && !/example|sample|dist|template/i.test(e.name)) out.push(p);
      if (e.isDirectory() && !/^(node_modules|vendor|\.next|cache|tmp|\.well-known)$/.test(e.name) && !e.name.startsWith('.')) walk(p, depth + 1);
    }
  };
  walk(root, 0);
  return out;
}

// un pedido a este mismo servidor como si llegara por ese nombre (SNI y Host), solo el primer kilobyte
function probe(name, urlPath, port = 443) {
  return new Promise(resolve => {
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(name);
    const req = https.request({ host: '127.0.0.1', port, path: urlPath, method: 'GET', servername: isIp ? undefined : name, rejectUnauthorized: false, timeout: 8000,
      headers: { Host: name, 'User-Agent': 'Atalaya-monitor (revision de archivos expuestos)', Range: 'bytes=0-1023' } }, res => {
      let b = Buffer.alloc(0);
      res.on('data', c => { b = Buffer.concat([b, c]); if (b.length > 1024) req.destroy(); });
      res.on('close', () => resolve({ status: res.statusCode, type: String(res.headers['content-type'] || ''), head: b.slice(0, 1024).toString('latin1') }));
    });
    req.on('timeout', () => { req.destroy(); resolve(null); });
    req.on('error', () => resolve(null));
    req.end();
  });
}

class ExposureAudit {
  constructor(cfg, platform) {
    this.cfg = cfg; this.platform = platform;
    this.file = path.join(cfg.stateDir, 'audits', 'exposure.json');
    this.result = readJSON(this.file, null);
    this.running = false;
  }
  available() { return (this.cfg.edition || 'vps') === 'vps' && !!(this.platform && this.platform.panel); }

  // que URLs llegan a cada archivo sensible: por el sitio que lo contiene y por los sitios padre
  targets() {
    const vhosts = this.platform.panel.vhosts().filter(v => v.docroot);
    const ip = publicIPv4(this.cfg);
    const byRoot = new Map();
    for (const v of vhosts) {
      const names = [...new Set([v.servername, ...(v.aliases || [])].filter(n => n && !n.startsWith('*')))];
      const x = byRoot.get(v.docroot) || { docroot: v.docroot, account: v.account, names: new Set() };
      names.forEach(n => x.names.add(n));
      byRoot.set(v.docroot, x);
    }
    const roots = [...byRoot.values()];
    const files = new Set();
    for (const r of roots) for (const f of findSensitive(r.docroot)) files.add(f);
    const out = [];
    for (const f of files) {
      for (const r of roots) {
        if (!f.startsWith(r.docroot.replace(/\/+$/, '') + '/')) continue;
        const rel = '/' + path.relative(r.docroot, f).split(path.sep).join('/');
        for (const n of r.names) out.push({ file: f, account: r.account, name: n, path: rel });
        if (ip) out.push({ file: f, account: r.account, name: ip, path: rel });
      }
    }
    return { files: [...files], targets: out.slice(0, MAX_PROBES), sites: roots.length };
  }

  async scan() {
    if (!this.available() || this.running) return this.result;
    this.running = true;
    try {
      const { files, targets, sites } = this.targets();
      const exposed = [];
      for (const t of targets) {
        const r = await probe(t.name, t.path, this.port || 443);
        if (r && (r.status === 200 || r.status === 206) && looksExposed(t.path, r)) exposed.push({ ...t, status: r.status });
      }
      const dirs = files.filter(f => /\/\.(git|svn|hg)\//.test(f)).map(f => f.replace(/\/\.(git|svn|hg)\/.*$/, '/.$1'));
      this.result = { t: Date.now(), sites, files: files.length, probes: targets.length, repos: [...new Set(dirs)], exposed };
      try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeJSONAtomic(this.file, this.result); } catch { }
      if (exposed.length) console.log(`[expuestos] ${exposed.length} URL(s) sirven archivos sensibles`);
      return this.result;
    } finally { this.running = false; }
  }

  start() {
    if (!this.available()) return;
    setTimeout(() => this.scan().catch(e => console.error('[expuestos]', e.message)), 90000).unref();
    setInterval(() => this.scan().catch(e => console.error('[expuestos]', e.message)), 24 * 3600000).unref();
  }

  // seccion de "Salud del servidor"
  section() {
    const r = this.result;
    if (!r) return { id: 'exposure', title: 'Archivos expuestos', icon: 'key', status: 'unknown', items: [{ label: 'Estado', value: 'primera revisión en curso' }], findings: [] };
    const f = [];
    const bySite = new Map();
    for (const e of r.exposed) { const k = e.file; const x = bySite.get(k) || { ...e, names: [] }; x.names.push(e.name); bySite.set(k, x); }
    for (const x of bySite.values()) {
      f.push({ sev: 'bad', title: `Se sirve ${x.path.includes('.env') ? 'un archivo .env' : 'un repositorio'} por ${x.names.length} nombre(s)`, detail: `${x.path} responde con su contenido por ${x.names.slice(0, 6).join(', ')}${x.names.length > 6 ? '…' : ''}.`,
        fix: 'Niéguelo para todos los nombres, no solo el dominio principal: una regla global de Apache (/.git, /.env) o sacarlo del docroot. Dé por conocidas las claves que contenía.', names: x.names, rows: [{ name: x.path, command: x.file }] });
    }
    if (r.repos.length) f.push({ sev: 'warn', title: `${r.repos.length} carpeta(s) de control de versiones dentro de los docroots`, detail: 'Hoy no se sirven, pero basta un cambio en el .htaccess o un nombre nuevo del sitio para que queden a la vista.',
      fix: 'Tenga el repositorio fuera del docroot y despliegue con git --work-tree o rsync sin .git.', names: r.repos.map(p => p.replace(/^\/home\/[^/]+\//, '~/')) });
    const worst = f.some(x => x.sev === 'bad') ? 'bad' : f.length ? 'warn' : 'ok';
    return { id: 'exposure', title: 'Archivos expuestos', icon: 'key', status: worst, findings: f,
      items: [{ label: 'Sitios revisados', value: String(r.sites) }, { label: 'Pedidos de prueba', value: String(r.probes) }, { label: 'Expuestos', value: String(r.exposed.length) }] };
  }
}

module.exports = { ExposureAudit, findSensitive, probe, publicIPv4 };
