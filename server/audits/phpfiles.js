'use strict';
// Archivos PHP nuevos en los docroots: la señal clasica de una puerta trasera (webshell). Cada 30 min se recorren
// los docroots; la primera vez solo se toma una foto de referencia y desde ahi se avisa de cada .php nuevo.
// Es sospechoso si esta en una carpeta de subidas o cache, tiene nombre aleatorio o vive en una carpeta oculta,
// o su contenido trae firmas de webshell. Muchos archivos nuevos a la vez en la misma carpeta son una
// actualizacion o un despliegue: se agrupan como informacion. Solo lectura (se leen los primeros 64 KB para las
// firmas; nunca se guarda el contenido). Lo revisado por el dueno se recuerda.
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const LOG_RE = /^(\S+) \S+ \S+ \[([^\]]+)\] "(?:GET|POST|HEAD|PUT)\s+(\S+)[^"]*" (\d{3})/;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const { readJSON, writeJSONAtomic } = require('../util');

const SKIP_DIRS = /^(node_modules|\.git|\.svn|\.next|\.cache|vendor\/composer)$/;
// subidas reales: wp-content/uploads o una carpeta uploads/ que no sea parte del codigo de plugins, temas o librerias
const UPLOAD_DIR = /\/wp-content\/uploads\/|^(?!.*\/(wp-content\/(plugins|themes|mu-plugins)|wp-includes|vendor|src|lib|library|node_modules)\/).*\/uploads?\//;
const SILENCE = /^\s*<\?php\s*(\/\/\s*Silence is golden\.?|\/\*[^*]*\*\/)?\s*(\?>)?\s*$/i;
const HIDDEN_DIR = /\/\.[^/]+\//;
const SIGS = [
  [/eval\s*\(\s*(base64_decode|gzinflate|gzuncompress|str_rot13|strrev)\s*\(/i, 'código ofuscado que se ejecuta (eval + base64/gzinflate)'],
  [/(assert|eval|system|shell_exec|passthru|exec|popen|proc_open)\s*\(\s*\$_(POST|GET|REQUEST|COOKIE|SERVER)/i, 'ejecuta lo que llega en la petición'],
  [/\$_(POST|GET|REQUEST|COOKIE)\s*\[[^\]]*\]\s*\(/i, 'llama a una función que manda el visitante'],
  [/preg_replace\s*\(\s*['"].*\/e['"]/i, 'preg_replace con /e (ejecuta código)'],
  [/(FilesMan|b374k|\bWSO\s*[2-5]\.\d|r57shell|c99shell|Indoxploit|AlfaTeam|Mini\s*Shell\s*v)/i, 'firma de un webshell conocido'],
  [/move_uploaded_file\s*\([^)]*\$_FILES[^)]*\)\s*;?\s*\?>\s*$/i, 'subidor mínimo de archivos'],
  [/(?:\\x[0-9a-f]{2}){40,}/i, 'cadena larga en hexadecimal (ofuscación)'],
];
// un bloque base64 enorme solo es sospechoso si el archivo tambien decodifica y ejecuta (iconos e imagenes no)
const B64 = /[A-Za-z0-9+/]{2000,}={0,2}/, EXEC = /\b(eval|assert|create_function|gzinflate|gzuncompress|str_rot13)\s*\(|base64_decode\s*\(/i;

// nombre que parece generado (sin vocales normales o mezcla rara de letras y numeros)
function randomName(file) {
  const b = path.basename(file, '.php');
  if (/^(index|wp-[a-z-]+|xmlrpc|config|functions|admin|login|ajax|api|cron|install|upgrade|update|setup)$/i.test(b)) return false;
  if (b.length >= 6 && /^[a-z0-9]+$/i.test(b) && /\d/.test(b) && /[a-z]/i.test(b) && !/[aeiou]{1}[a-z]*[aeiou]/i.test(b.replace(/\d/g, ''))) return true;
  if (/^[a-f0-9]{8,}$/i.test(b)) return true;
  return false;
}

class PhpFilesAudit {
  constructor(cfg, logs, bus, opts = {}) {
    this.cfg = cfg; this.logs = logs; this.bus = bus;
    this.file = path.join(cfg.stateDir, 'audits', 'phpfiles.json');
    const d = readJSON(this.file, null) || {};
    this.base = new Map(Object.entries(d.base || {})); // ruta -> mtime (la foto de referencia)
    this.found = d.found || []; // archivos nuevos: { path, site, account, at, size, sev, why, group }
    this.ack = new Set(d.ack || []);
    this.jailed = d.jailed || []; // en cuarentena: { path, site, account, at }
    this.qdir = opts.qdir || path.join(cfg.stateDir, 'cuarentena');
    this.loadQuarantine();
    this.lastScan = d.lastScan || 0; this.running = false;
    this.roots = opts.roots || null;
    this.hits = new Map(); // archivo sospechoso -> { at, list: [{ ip, t, status, path }] } (quien lo pidio)
    this.logDirs = opts.logDirs || (acc => [`/etc/apache2/logs/domlogs/${acc}`, `/home/${acc}/logs`]);
    // en vivo: alguien pide un archivo sospechoso (la ruta exacta de una puerta trasera es una señal muy clara)
    if (bus) bus.on('ev', e => { if (e.kind === 'http' && e.path && !e.late) this.onHttp(e); });
    if (!opts.manual) {
      setTimeout(() => this.scan().catch(e => console.error('[php nuevos]', e.message)), 120000).unref();
      setInterval(() => this.scan().catch(e => console.error('[php nuevos]', e.message)), 30 * 60000).unref();
    }
  }
  available() { return (this.cfg.edition || 'vps') === 'vps'; }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeJSONAtomic(this.file, { base: Object.fromEntries(this.base), found: this.found.slice(-400), ack: [...this.ack].slice(-2000), jailed: this.jailed.slice(-200), lastScan: this.lastScan }); } catch (e) { console.error('[php nuevos]', e.message); } }

  sites() {
    if (this.roots) return this.roots;
    const seen = new Set(), out = [];
    for (const g of (this.logs && this.logs.sites) || []) if (g.docroot && !seen.has(g.docroot)) { seen.add(g.docroot); out.push({ docroot: g.docroot, site: g.id, account: g.account, domain: g.domain }); }
    return out;
  }

  // recorre un docroot sin bloquear (cede cada 400 entradas)
  async walk(root, onFile, skip = new Set()) {
    let n = 0;
    const stack = [[root, 0]];
    while (stack.length) {
      const [dir, depth] = stack.pop();
      if (depth > 9) continue;
      let ents; try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const e of ents) {
        if (++n % 400 === 0) await new Promise(r => setImmediate(r));
        if (e.isSymbolicLink()) continue;
        const p = path.join(dir, e.name);
        if (e.isDirectory()) { if (!SKIP_DIRS.test(e.name) && !skip.has(p)) stack.push([p, depth + 1]); continue; } // otro docroot: es de su sitio
        if (e.isFile() && /\.(php\d?|phtml|phar)$/i.test(e.name)) onFile(p);
      }
    }
  }

  judge(p, st) {
    const why = [];
    let sev = 'info';
    if (UPLOAD_DIR.test(p)) { sev = 'bad'; why.push('está en una carpeta de subidas o caché, donde no debería haber PHP'); }
    if (HIDDEN_DIR.test(p) && !/\/\.well-known\/acme-challenge\//.test(p)) { sev = 'bad'; why.push('vive en una carpeta oculta'); }
    if (randomName(p)) { sev = sev === 'bad' ? 'bad' : 'warn'; why.push('su nombre parece generado al azar'); }
    let head = '';
    try { const fd = fs.openSync(p, 'r'); const b = Buffer.alloc(Math.min(st.size, 65536)); fs.readSync(fd, b, 0, b.length, 0); fs.closeSync(fd); head = b.toString('latin1'); } catch { }
    if (st.size < 300 && SILENCE.test(head)) return { sev: 'info', why: [] }; // el index.php vacio de WordPress
    for (const [re, w] of SIGS) if (re.test(head)) { sev = 'bad'; why.push(w); }
    if (B64.test(head) && EXEC.test(head)) { sev = 'bad'; why.push('bloque base64 enorme que se decodifica y ejecuta'); }
    return { sev, why };
  }

  async scan(now = Date.now()) {
    if (!this.available() || this.running) return;
    this.running = true;
    try {
      const first = this.base.size === 0;
      const seen = new Set(), fresh = [];
      const all = this.sites(), roots = new Set(all.map(s => s.docroot.replace(/\/+$/, '')));
      for (const s of all) {
        const mine = s.docroot.replace(/\/+$/, '');
        await this.walk(s.docroot, p => {
          seen.add(p);
          if (this.base.has(p)) return;
          let st; try { st = fs.statSync(p); } catch { return; }
          this.base.set(p, st.mtimeMs);
          // primer recorrido: foto de referencia, y de lo que ya existia solo se reporta lo sospechoso
          if (!first) fresh.push({ p, st, s });
          else if (this.judge(p, st).sev === 'bad') fresh.push({ p, st, s, existing: true });
        }, new Set([...roots].filter(r => r !== mine && r.startsWith(mine + '/'))));
      }
      for (const p of [...this.base.keys()]) if (!seen.has(p)) this.base.delete(p); // borrados
      // muchos nuevos en la misma carpeta a la vez: actualizacion o despliegue (se agrupan, sin alarma salvo firmas)
      const byDir = new Map();
      for (const f of fresh) { const d = path.dirname(f.p); byDir.set(d, (byDir.get(d) || 0) + 1); }
      for (const f of fresh) {
        const j = this.judge(f.p, f.st);
        if (f.existing && j.sev !== 'bad') continue;
        const bulk = !f.existing && byDir.get(path.dirname(f.p)) >= 15 && !j.why.some(w => !/nombre|carpeta de subidas/.test(w));
        if (bulk && j.sev !== 'bad') j.sev = 'info';
        const rec = { path: f.p, site: f.s.site, account: f.s.account, domain: f.s.domain, at: now, mtime: f.st.mtimeMs, size: f.st.size, sev: j.sev, why: j.why, bulk, existing: !!f.existing };
        this.found.push(rec);
        if (rec.sev === 'bad') {
          console.log(`[php nuevos] sospechoso en ${rec.domain}: ${rec.path} (${rec.why.join('; ')})`);
          this.bus.emit('ev', { kind: 'phpfile', action: 'suspect', account: rec.account, site: rec.site, domain: rec.domain, path: rec.path, why: rec.why[0] });
        }
      }
      this.found = this.found.filter(r => now - r.at < 14 * 86400000);
      // cada hallazgo (y lo que esta en cuarentena), al sitio mas especifico (el docroot mas largo que lo contiene)
      this.loadQuarantine();
      for (const r of this.found.concat(this.jailed)) {
        const best = all.filter(x => r.path.startsWith(x.docroot.replace(/\/+$/, '') + '/')).sort((a, b) => b.docroot.length - a.docroot.length)[0];
        if (best) { r.site = best.site; r.account = best.account; r.domain = best.domain; }
      }
      this.lastScan = now;
      this.save();
      if (first) console.log(`[php nuevos] foto de referencia: ${this.base.size} archivos PHP en ${this.sites().length} docroots`);
    } finally { this.running = false; }
  }

  onHttp(e) {
    const sus = this.suspects(); if (!sus.length) return;
    const url = String(e.path).split('?')[0];
    const r = sus.find(x => url.endsWith('/' + path.basename(x.path)) && x.path.endsWith(url.replace(/^.*?(\/[^/]+\/[^/]+)$/, '$1')));
    if (!r || !e.ip) return;
    const h = this.hits.get(r.path) || { at: 0, list: [] };
    h.list.unshift({ ip: e.ip, t: e.at || Date.now(), status: e.status, path: url }); h.list = h.list.slice(0, 50);
    this.hits.set(r.path, h);
    console.log(`[php nuevos] ${e.ip} pidió el archivo sospechoso ${url} (${e.status})`);
    this.bus.emit('ev', { kind: 'phpfile', action: 'hit', account: r.account, site: r.site, domain: r.domain, path: r.path, ip: e.ip, status: e.status, why: r.why[0] });
  }

  // quien pidio un archivo sospechoso: se busca su nombre en los registros de Apache de la cuenta (los actuales y
  // los archivados de este mes y el anterior). Se recuerda 6 h.
  whoRequested(r) {
    const c = this.hits.get(r.path);
    if (c && Date.now() - c.at < 6 * 3600000) return c.list;
    const name = path.basename(r.path), out = [];
    const now = new Date(), months = [0, 1].map(k => { const d = new Date(now.getFullYear(), now.getMonth() - k, 1); return `${MON[d.getMonth()]}-${d.getFullYear()}`; });
    for (const dir of this.logDirs(r.account)) {
      let files = []; try { files = fs.readdirSync(dir); } catch { continue; }
      for (const f of files) {
        if (/bytes|imap|pop3|smtp|ftp/.test(f)) continue;
        const full = path.join(dir, f);
        let txt = '';
        try {
          if (f.endsWith('.gz')) { if (!months.some(m => f.includes(m))) continue; const b = fs.readFileSync(full); if (b.length > 80 * 1024 * 1024) continue; txt = zlib.gunzipSync(b).toString('latin1'); }
          else { const st = fs.statSync(full); if (!st.isFile() || st.size > 200 * 1024 * 1024) continue; txt = fs.readFileSync(full, 'latin1'); }
        } catch { continue; }
        if (!txt.includes(name)) continue;
        for (const line of txt.split('\n')) {
          if (!line.includes(name)) continue;
          const m = LOG_RE.exec(line); if (!m) continue;
          const t = Date.parse(m[2].replace(':', ' ').replace(/\//g, ' ')) || 0;
          out.push({ ip: m[1], t, status: +m[4], path: m[3].split('?')[0] });
        }
      }
    }
    const seen = new Set(), list = out.sort((a, b) => b.t - a.t).filter(x => { const k = x.ip + x.t; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 50);
    const live = (c && c.list) || [];
    this.hits.set(r.path, { at: Date.now(), list: [...live.filter(x => !list.some(y => y.ip === x.ip && y.t === x.t)), ...list].slice(0, 50) });
    return this.hits.get(r.path).list;
  }

  acknowledge(p) { this.ack.add(p); this.save(); }
  quarantined(p, info = {}) {
    const r = this.found.find(x => x.path === p);
    if (r) this.jailed.push({ path: p, site: r.site, account: r.account, domain: r.domain, at: Date.now(), by: info.by || null, qpath: info.qpath || null,
      why: r.why, size: r.size, mtime: r.mtime, foundAt: r.at, existing: !!r.existing });
    this.found = this.found.filter(x => x.path !== p); this.base.delete(p); this.save();
    return r;
  }
  // la carpeta de cuarentena manda: cada archivo con su .origen.json (tambien los de antes de que existiera la lista)
  loadQuarantine() {
    let dirs = []; try { dirs = fs.readdirSync(this.qdir); } catch { return; }
    const have = new Set(this.jailed.map(j => j.path));
    const walk = d => { let e = []; try { e = fs.readdirSync(d, { withFileTypes: true }); } catch { return; } for (const x of e) { const p = path.join(d, x.name); if (x.isDirectory()) walk(p); else if (x.name.endsWith('.origen.json')) {
      try {
        const o = JSON.parse(fs.readFileSync(p, 'utf8')), qpath = p.replace(/\.origen\.json$/, '');
        const j = this.jailed.find(x => x.path === o.path);
        if (j) { if (!j.qpath) j.qpath = qpath; continue; }
        if (!o.path || have.has(o.path)) continue;
        have.add(o.path);
        const sites = this.sites(), best = sites.filter(s => o.path.startsWith(s.docroot.replace(/\/+$/, '') + '/')).sort((a, b) => b.docroot.length - a.docroot.length)[0];
        // de antes de que existiera la historia: se reconstruye del archivo guardado (el rename conserva fecha y tamano)
        let st = null, why = []; try { st = fs.statSync(qpath); why = this.judge(qpath, st).why; } catch { }
        this.jailed.push({ path: o.path, site: best ? best.site : null, account: best ? best.account : null, domain: best ? best.domain : null, at: Date.parse(o.at) || 0,
          qpath, why, size: st ? st.size : null, mtime: st ? st.mtimeMs : null, foundAt: null, by: o.by || null, rebuilt: true });
      } catch { } } } };
    for (const d of dirs) walk(path.join(this.qdir, d));
  }
  // se saca de la lista al borrarlo para siempre o restaurarlo (restaurado: queda como revisado, no vuelve a marcarse)
  unjail(p, restored) { this.jailed = this.jailed.filter(x => x.path !== p); if (restored) { this.ack.add(p); } this.save(); }
  jailedList() { return this.jailed.map(j => ({ ...j, hits: this.whoRequested(j) })); }
  // de que sitio es una IP que pidio una puerta trasera (para la escolta hasta la carcel)
  siteOfHit(ip) {
    for (const r of this.suspects().concat(this.jailed)) { const h = this.hits.get(r.path); if (h && h.list.some(x => x.ip === ip)) return r; }
    return null;
  }
  isFound(p) { return this.found.some(r => r.path === p); }
  suspects() { return this.found.filter(r => r.sev === 'bad' && !this.ack.has(r.path)); }
  siteState(siteId) { const n = this.suspects().filter(r => r.site === siteId).length; return n ? { n } : null; }

  section() {
    if (!this.available()) return null;
    if (!this.lastScan) return { id: 'phpfiles', title: 'Archivos PHP nuevos', icon: 'bad', status: 'unknown', items: [{ label: 'Estado', value: 'primera revisión en curso' }], findings: [] };
    const sus = this.suspects(), recent = this.found.filter(r => Date.now() - r.at < 7 * 86400000 && !this.ack.has(r.path));
    const f = [];
    if (sus.length) f.push({ sev: 'bad', title: `${sus.length} archivo(s) PHP sospechoso(s) aparecieron`, detail: sus.slice(0, 6).map(r => `${r.domain}: ${r.path.replace(/^\/home\/[^/]+\//, '~/')} (${r.why[0]})`).join(' · '),
      fix: 'Ábralos (sin ejecutarlos) y compárelos con el sitio original. Si no los subió usted, bórrelos, cambie las contraseñas de cPanel, FTP y WordPress, actualice plugins y temas, y revise quién más entró. Luego márquelos como revisados en la ficha del sitio.',
      names: [...new Set(sus.map(r => r.domain))] });
    const warn = recent.filter(r => r.sev === 'warn');
    if (warn.length) f.push({ sev: 'warn', title: `${warn.length} archivo(s) PHP nuevo(s) con nombre raro`, detail: warn.slice(0, 6).map(r => `${r.domain}: ${path.basename(r.path)}`).join(' · '), fix: 'Revise si son de un plugin o un despliegue suyo; si no, trátelos como sospechosos.' });
    const info = recent.filter(r => r.sev === 'info');
    if (info.length) f.push({ sev: 'info', title: `${info.length} archivo(s) PHP nuevo(s) esta semana`, detail: 'La mayoría suelen ser actualizaciones de WordPress, plugins o despliegues.', fix: '' });
    return { id: 'phpfiles', title: 'Archivos PHP nuevos', icon: 'bad', status: sus.length ? 'bad' : warn.length ? 'warn' : 'ok', findings: f,
      items: [{ label: 'Archivos vigilados', value: String(this.base.size) }, { label: 'Nuevos esta semana', value: String(recent.length) }, { label: 'Sospechosos', value: String(sus.length) }] };
  }
}

module.exports = { PhpFilesAudit, randomName, SIGS };
