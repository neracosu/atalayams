'use strict';
// Auditoria de bases de datos MySQL/MariaDB SIN credenciales: se leen los archivos del datadir
// (un archivo por tabla con innodb_file_per_table). Solo lectura; nunca se conecta ni ejecuta SQL.
//  - lista (liviana, en vivo): tamano, tablas, ultima escritura y cuenta duena de cada base
//  - auditoria de una base (a pedido): tablas, motor, que sitio la usa y hallazgos, con historial
const fs = require('fs');
const path = require('path');
const { readJSON, writeJSONAtomic } = require('../util');

const SYSTEM = new Set(['mysql', 'performance_schema', 'sys', 'information_schema', '#innodb_temp', '#innodb_redo', 'lost+found']);
const ENGINE = { '.ibd': 'InnoDB', '.MYD': 'MyISAM', '.MYI': 'MyISAM', '.MAD': 'Aria', '.MAI': 'Aria', '.CSV': 'CSV', '.ARZ': 'Archive' };
// nombres de tablas que suelen crecer sin control (WordPress, WooCommerce, frameworks)
const BLOAT = [
  [/(_|^)(actionscheduler_logs|actionscheduler_actions)$/, 'Registro de tareas de Action Scheduler (WooCommerce): suele acumular millones de filas; se puede purgar.'],
  [/(_|^)(wc_sessions|woocommerce_sessions|sessions?)$/, 'Sesiones: si crece mucho, las sesiones vencidas no se están limpiando.'],
  [/(_|^)options$/, 'wp_options: si pesa mucho, suele haber "autoload" o transients acumulados.'],
  [/(_|^)postmeta$/, 'wp_postmeta: metadatos de entradas; crece con plugins que guardan mucho por entrada.'],
  [/logs?$|_log_|audit|history|activity|events?$/i, 'Tabla de registros o historial: revise si tiene política de limpieza.'],
  [/(^|_)cache|_transient/, 'Caché en base de datos: se puede vaciar sin perder información.'],
];

class DatabaseAudit {
  constructor(cfg, logs) {
    this.cfg = cfg; this.logs = logs;
    this.datadir = (cfg.mysql && cfg.mysql.datadir) || detectDatadir() || '/var/lib/mysql';
    this.dir = path.join(cfg.stateDir, 'audits');
    this.cache = null; this.cacheAt = 0;
  }

  // la lista es liviana (solo stat de archivos) pero se reutiliza 30 s para no repetirla en cada refresco
  cached() {
    if (!this.cache || Date.now() - this.cacheAt > 30000) { this.cache = this.list(); this.cacheAt = Date.now(); }
    return this.cache;
  }
  snapFile(dirName) { return path.join(this.dir, 'db-' + dirName.replace(/[^A-Za-z0-9_@$-]/g, '_') + '.json'); }
  // ultimo resultado guardado de una base (o null si nunca se audito)
  lastResult(dirName) { const s = readJSON(this.snapFile(dirName), null); return s && s.result ? s.result : null; }

  // hace falta poder listar el datadir (en un hosting compartido o sin CAP_DAC_READ_SEARCH no se puede)
  available() {
    if ((this.cfg.edition || 'vps') !== 'vps') return false;
    try { fs.accessSync(this.datadir, fs.constants.R_OK | fs.constants.X_OK); return fs.statSync(this.datadir).isDirectory(); } catch { return false; }
  }

  // dueno de una base en cPanel: el prefijo "cuenta_" (si la cuenta existe)
  ownerOf(db) {
    const acc = this.cfg.accounts || {};
    const pre = db.split('_')[0];
    return db.includes('_') && acc[pre] ? pre : null;
  }

  scanDb(db) {
    const dir = path.join(this.datadir, db);
    const tables = new Map();
    let size = 0, last = 0;
    for (const f of fs.readdirSync(dir)) {
      let st; try { st = fs.statSync(path.join(dir, f)); } catch { continue; }
      if (!st.isFile()) continue;
      size += st.size; last = Math.max(last, st.mtimeMs);
      const ext = path.extname(f);
      if (ext === '.opt' || ext === '.frm' && tables.has(f.slice(0, -4))) continue;
      const base = decodeName(f.slice(0, f.length - ext.length).replace(/#P#.*$/i, ''));
      if (!ENGINE[ext] && ext !== '.frm') continue;
      const t = tables.get(base) || { name: base, size: 0, mtime: 0, engine: ENGINE[ext] || '' };
      if (ENGINE[ext]) { t.size += st.size; t.engine = ENGINE[ext]; t.mtime = Math.max(t.mtime, st.mtimeMs); }
      tables.set(base, t);
    }
    return { size, last, tables: [...tables.values()] };
  }

  list() {
    if (!this.available()) return [];
    const out = [];
    let names; try { names = fs.readdirSync(this.datadir); } catch { return []; }
    for (const name of names) {
      let st; try { st = fs.statSync(path.join(this.datadir, name)); } catch { continue; }
      if (!st.isDirectory()) continue;
      let s; try { s = this.scanDb(name); } catch { continue; }
      out.push({ name: decodeName(name), dirName: name, size: s.size, tables: s.tables.length, lastWrite: s.last,
        account: this.ownerOf(name), system: SYSTEM.has(name), shadow: /_shadow$/.test(name) });
    }
    return out.sort((a, b) => b.size - a.size);
  }

  // Donde se usa la base: se busca su nombre (palabra completa) en archivos de configuracion del home de
  // la cuenta: docroots, apps y ~/.config/<proyecto>/ (donde se guardan los secretos fuera del docroot).
  // Se leen solo archivos de configuracion chicos; nunca se muestra su contenido.
  usedBy(db, account) {
    const re = new RegExp(`(^|[^A-Za-z0-9_])${db.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^A-Za-z0-9_])`);
    const CONF = /^(\.env(\..+)?|env\.php|wp-config\.php|config(uration)?\.(php|json|ya?ml|ini|js|ts)|database\.(php|ya?ml|json)|settings\.(php|py|json)|local\.xml|\.my\.cnf|db\.(php|json|ini)|secrets?\.(php|json|ya?ml|env|ini)|credentials?\.(php|json|ya?ml|ini)|ecosystem\.config\.c?js|(docker-)?compose\.ya?ml)$/i;
    const SKIP = /^(node_modules|vendor|mail|\.cache|\.npm|\.claude|\.trash|backups?|respaldos?|tmp|logs?|public_ftp|\.git|\.cpanel|ssl|etc|\.nvm|\.local|\.pm2|\.next|dist|build|cache|uploads|wp-content)$/i;
    const homeDir = path.join(this.cfg.homeRoot || '/home', account || '');
    const home = account && this.cfg.accounts[account] && fs.existsSync(homeDir) ? homeDir : null;
    const hits = [];
    const seen = new Set();
    let budget = 4000;
    const walk = (dir, depth) => {
      if (depth > 4 || budget <= 0 || hits.length >= 10) return;
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of ents) {
        if (--budget <= 0) return;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP.test(e.name) && (e.name[0] !== '.' || e.name === '.config')) walk(p, depth + 1); continue; }
        // en ~/.config/<proyecto>/ (secretos fuera del docroot) vale cualquier archivo de texto de configuracion
        const inConfig = dir.startsWith(home + '/.config/') && /^(\.?env|[\w.-]+\.(env|json|ini|conf|cnf|php|ya?ml|toml))$/i.test(e.name);
        if (!e.isFile() || /\.(bak|old|orig)|~$|\.bak-/i.test(e.name) || !(CONF.test(e.name) || inConfig) || seen.has(p)) continue;
        seen.add(p);
        let st; try { st = fs.statSync(p); } catch { continue; }
        if (st.size > 262144) continue;
        let t = ''; try { t = fs.readFileSync(p, 'utf8'); } catch { continue; }
        if (!re.test(t)) continue;
        // a que sitio pertenece: el grupo cuyo docroot (o carpeta de app) contiene el archivo
        const g = this.logs && this.logs.groups ? [...this.logs.groups.values()].find(x => x.account === account && x.docroot && p.startsWith(x.docroot + '/')) : null;
        const rel = p.slice(home.length + 1).split('/');
        const proj = g ? null : rel[0] === '.config' && rel.length > 2 ? rel[1] : rel.length > 1 ? rel[0] : null;
        hits.push({ file: '~/' + p.slice(home.length + 1), domain: g ? g.domain : null, app: g ? g.app : null, project: proj });
      }
    };
    if (home) walk(home, 0);
    return hits;
  }

  // auditoria de una base (a pedido): guarda una foto para comparar con la proxima
  analyze(name) {
    const dbs = this.list();
    const db = dbs.find(d => d.name === name || d.dirName === name);
    if (!db) throw new Error('No existe esa base');
    const s = this.scanDb(db.dirName);
    const snapFile = this.snapFile(db.dirName);
    const prev = readJSON(snapFile, null);
    const prevTables = prev ? Object.fromEntries(prev.tables.map(t => [t.name, t.size])) : null;
    const tables = s.tables.sort((a, b) => b.size - a.size).map(t => ({ ...t, delta: prevTables && prevTables[t.name] != null ? t.size - prevTables[t.name] : null }));
    const users = db.system ? [] : this.usedBy(db.dirName, db.account);
    const findings = [];
    const now = Date.now();
    const recent = now - s.last < 7 * 86400000;
    if (!db.system && !users.length) findings.push(db.shadow
      ? { level: 'info', text: 'Base "shadow" de Prisma: la usa solo `prisma migrate dev`. En un servidor de producción normalmente se puede eliminar.' }
      : recent
        ? { level: 'info', text: `Ningún archivo de configuración la menciona, pero recibió escrituras hace ${ago(now - s.last)}: algo la usa (variables de entorno del proceso, un cron o un script).` }
        : { level: 'warn', text: `Ningún archivo de configuración de la cuenta la menciona y no recibe escrituras hace ${ago(now - s.last)}: podría ser una base huérfana o de una versión anterior. Revise antes de borrar.` });
    if (db.shadow && users.length) findings.push({ level: 'info', text: 'Base "shadow" de Prisma: solo la usa `prisma migrate dev` (desarrollo). No guarda datos reales.' });
    for (const t of tables.slice(0, 15)) {
      const b = BLOAT.find(([re]) => re.test(t.name));
      if (b && t.size > 20 * 1048576) findings.push({ level: 'warn', text: `${t.name} pesa ${fmt(t.size)}. ${b[1]}` });
    }
    const myisam = tables.filter(t => t.engine === 'MyISAM');
    if (myisam.length) findings.push({ level: 'info', text: `${myisam.length} tabla(s) en MyISAM: motor antiguo sin transacciones ni recuperación ante caídas; conviene migrarlas a InnoDB.` });
    const stale = tables.filter(t => t.mtime && now - t.mtime > 365 * 86400000 && t.size > 10 * 1048576);
    if (stale.length) findings.push({ level: 'info', text: `${stale.length} tabla(s) grandes sin escritura hace más de un año (${stale.slice(0, 3).map(t => t.name).join(', ')}${stale.length > 3 ? '…' : ''}): datos históricos que podrían archivarse.` });
    if (prev && s.size - prev.size > 500 * 1048576) findings.push({ level: 'warn', text: `Creció ${fmt(s.size - prev.size)} desde la auditoría anterior (${new Date(prev.at).toLocaleDateString('es-VE')}).` });
    if (!findings.length) findings.push({ level: 'ok', text: 'Sin hallazgos: tamaño razonable y en uso.' });
    const result = { name: db.name, dirName: db.dirName, size: s.size, lastWrite: s.last, account: db.account, system: db.system, tables, users, findings,
      at: now, prevAt: prev ? prev.at : null, prevSize: prev ? prev.size : null };
    try { fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 }); writeJSONAtomic(snapFile, { at: now, size: s.size, tables: s.tables.map(t => ({ name: t.name, size: t.size })), result }, 0o600); } catch { }
    return result;
  }
}

// datadir declarado en la configuracion de MySQL/MariaDB (si no es el de siempre)
function detectDatadir() {
  const files = ['/etc/my.cnf', '/etc/mysql/my.cnf'];
  for (const d of ['/etc/my.cnf.d', '/etc/mysql/conf.d', '/etc/mysql/mariadb.conf.d', '/etc/mysql/mysql.conf.d']) {
    try { for (const f of fs.readdirSync(d)) if (f.endsWith('.cnf')) files.push(path.join(d, f)); } catch { }
  }
  for (const f of files) {
    let t; try { t = fs.readFileSync(f, 'utf8'); } catch { continue; }
    const m = t.match(/^\s*datadir\s*=\s*"?([^"\s#]+)/m);
    if (m) return m[1].replace(/\/$/, '');
  }
  return null;
}

// MySQL codifica caracteres especiales en nombres de archivo (@002d = '-')
function decodeName(n) { return n.replace(/@([0-9a-f]{4})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))); }
function ago(ms) { const d = Math.floor(ms / 86400000); return d >= 1 ? d + (d === 1 ? ' día' : ' días') : Math.max(1, Math.floor(ms / 3600000)) + ' h'; }
function fmt(b) { const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return b.toFixed(i >= 3 ? 1 : 0) + ' ' + u[i]; }

module.exports = { DatabaseAudit };
