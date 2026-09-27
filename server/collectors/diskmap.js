'use strict';
// Mapa del disco: que carpetas y archivos ocupan el espacio. Recorrer cientos de GB es pesado, asi que:
//  - una sola pasada por particion: `du -x -k -a --threshold=50M` (carpetas y archivos >= 50 MB, a
//    cualquier profundidad), con la prioridad mas baja de disco y CPU (ionice idle + nice 19);
//  - corre una vez al dia de madrugada y a pedido; el resultado queda en <stateDir>/diskmap.json;
//  - compara con el analisis anterior para mostrar que crecio.
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { readJSON, writeJSONAtomic } = require('../util');

const THRESHOLD = '50M';
// categorias con consejo: se suman carpetas por patron de ruta (aproximado: no descuenta anidadas)
const CATEGORIES = [
  { id: 'backups', label: 'Respaldos', re: /^\/backup(s)?$|\/(backups?|respaldos?|cpbackup|cpmove-[^/]+)$/i, tip: 'Revise la retención: los respaldos viejos suelen ser lo primero que se puede mover a otro almacenamiento.' },
  { id: 'mail', label: 'Correo', re: /^\/home\/[^/]+\/mail$/, tip: 'Buzones grandes: considere cuotas por buzón o archivar correos antiguos.' },
  { id: 'db', label: 'Bases de datos', re: /^\/var\/lib\/(mysql|postgresql|pgsql|mongodb|redis)$/, tip: 'Tablas o logs binarios grandes: revise binlogs de MySQL y tablas de logs de las apps.' },
  { id: 'logs', label: 'Logs', re: /^\/var\/log$|^\/usr\/local\/(apache|cpanel)\/logs$|^\/etc\/apache2\/logs$|^\/home\/[^/]+\/logs$/, tip: 'Revise la rotación y compresión de logs (logrotate) y los logs de acceso por dominio.' },
  { id: 'trash', label: 'Papeleras', re: /^\/home\/[^/]+\/\.trash$/, tip: 'Archivos borrados desde el administrador de archivos de cPanel que siguen ocupando espacio.' },
  { id: 'deps', label: 'Dependencias y cachés', re: /\/(node_modules|\.npm|\.cache|\.yarn|\.pnpm-store|vendor-src)$/, tip: 'node_modules, cachés de npm, yarn y compilaciones: se pueden regenerar.' },
  { id: 'docker', label: 'Docker', re: /^\/var\/lib\/(docker|containers)$/, tip: 'Imágenes y volúmenes sin usar: docker system prune (con cuidado).' },
  { id: 'journal', label: 'Registro del sistema (journal)', re: /^\/var\/log\/journal$/, tip: 'journalctl --vacuum-size=500M limita su tamaño.' },
];

class DiskMap {
  constructor(cfg, metrics) {
    this.cfg = cfg; this.metrics = metrics;
    this.file = path.join(cfg.stateDir, 'diskmap.json');
    this.data = readJSON(this.file, null);
    this.running = null; // { startedAt, by, mount }
    this.index = null;
    this.buildIndex();
  }

  // Por defecto solo corre a pedido ("Analizar ahora"). Opcional: config.json > diskmap.daily = true
  // lo corre una vez al dia entre las 4 y las 5 de la manana.
  start(jobs) {
    this.jobs = jobs;
    if (!(this.cfg.diskmap && this.cfg.diskmap.daily)) return;
    setInterval(() => {
      const now = new Date(), last = this.data ? new Date(this.data.finishedAt) : null;
      if (now.getHours() === 4 && (!last || now - last > 20 * 3600000)) this.request('automático');
    }, 10 * 60000);
  }
  // pedido de analisis: pasa por la cola de tareas pesadas (una a la vez)
  request(by) {
    if (!this.jobs) return { ok: this.analyze(by) };
    return this.jobs.run('disco', 'mapa del disco', by, () => new Promise(resolve => { this.analyze(by); const t = setInterval(() => { if (!this.running) { clearInterval(t); resolve(); } }, 1000); }));
  }

  // una pasada de du por cada particion real (sin cruzar a otras)
  analyze(by = '') {
    if (this.running) return false;
    const mounts = this.cfg.diskmap && this.cfg.diskmap.roots ? this.cfg.diskmap.roots
      : (this.metrics && this.metrics.mounts.length ? this.metrics.mounts : [{ mount: '/' }]).map(m => m.mount);
    const entries = {};
    const startedAt = Date.now();
    this.running = { startedAt, by, mount: mounts[0] };
    const runOne = mount => new Promise(resolve => {
      this.running.mount = mount;
      const p = spawn('ionice', ['-c3', 'nice', '-n', '19', 'du', '-x', '-k', '-a', '--threshold=' + THRESHOLD, mount], { stdio: ['ignore', 'pipe', 'ignore'] });
      let buf = '';
      p.stdout.setEncoding('utf8');
      p.stdout.on('data', c => {
        buf += c;
        const lines = buf.split('\n'); buf = lines.pop();
        for (const l of lines) { const i = l.indexOf('\t'); if (i > 0) entries[l.slice(i + 1)] = Number(l.slice(0, i)) * 1024; }
      });
      p.on('close', resolve); p.on('error', resolve);
      setTimeout(() => { try { p.kill(); } catch { } }, 3 * 3600000); // limite de seguridad
    });
    (async () => {
      for (const m of mounts) await runOne(m);
      // separar archivos de carpetas (solo entradas grandes: pocas)
      const files = [];
      for (const p of Object.keys(entries)) {
        let st; try { st = fs.lstatSync(p); } catch { continue; }
        if (st.isFile()) files.push({ path: p, size: entries[p], mtime: st.mtimeMs });
      }
      const prev = this.data;
      const top = {};
      for (const [p, s] of Object.entries(entries)) if (p.split('/').filter(Boolean).length <= 3) top[p] = s;
      this.data = {
        startedAt, finishedAt: Date.now(), durationMs: Date.now() - startedAt, by, mounts, threshold: THRESHOLD,
        entries, files: files.sort((a, b) => b.size - a.size).slice(0, 40),
        prevTop: prev ? Object.fromEntries(Object.entries(prev.entries).filter(([p]) => p.split('/').filter(Boolean).length <= 3)) : null,
        prevFinishedAt: prev ? prev.finishedAt : null,
      };
      try { writeJSONAtomic(this.file, this.data, 0o600); } catch (e) { console.error('[disco] no se pudo guardar el mapa', e.message); }
      this.buildIndex();
      console.log(`[disco] mapa listo en ${Math.round(this.data.durationMs / 1000)} s (${Object.keys(entries).length} entradas >= ${THRESHOLD})`);
      this.running = null;
    })().catch(e => { console.error('[disco]', e.message); this.running = null; });
    return true;
  }

  buildIndex() {
    if (!this.data) return;
    const kids = new Map();
    for (const p of Object.keys(this.data.entries)) {
      if (p === '/') continue;
      const parent = path.dirname(p);
      if (!kids.has(parent)) kids.set(parent, []);
      kids.get(parent).push(p);
    }
    this.index = kids;
  }

  // hijos de una carpeta, con lo que no alcanza el umbral agrupado en "otros"
  children(dir) {
    if (!this.data) return null;
    const size = this.data.entries[dir];
    if (size == null) return null;
    const files = new Set(this.data.files.map(f => f.path));
    const list = (this.index.get(dir) || []).map(p => ({ path: p, name: path.basename(p), size: this.data.entries[p],
      file: files.has(p) || (!this.index.has(p) && isFile(p)), more: this.index.has(p) }))
      .sort((a, b) => b.size - a.size);
    const shown = list.reduce((n, x) => n + x.size, 0);
    const prevSize = this.data.prevTop ? this.data.prevTop[dir] : undefined;
    return { dir, size, children: list.slice(0, 40), rest: Math.max(0, size - shown), prevSize };
  }

  categories() {
    if (!this.data) return [];
    const out = [];
    for (const c of CATEGORIES) {
      let size = 0, n = 0;
      const hits = Object.entries(this.data.entries).filter(([p]) => c.re.test(p));
      // en dependencias se cuentan solo las carpetas de mas arriba (node_modules dentro de node_modules no)
      const top = hits.filter(([p]) => !hits.some(([q]) => q !== p && p.startsWith(q + '/')));
      for (const [, s] of top) { size += s; n++; }
      if (size > 0) out.push({ id: c.id, label: c.label, size, n, tip: c.tip, paths: top.sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, s]) => ({ path: p, size: s })) });
    }
    return out.sort((a, b) => b.size - a.size);
  }

  // lo que mas crecio o se achico desde el analisis anterior (carpetas de hasta 3 niveles)
  growth() {
    if (!this.data || !this.data.prevTop) return [];
    const out = [];
    const cur = Object.fromEntries(Object.entries(this.data.entries).filter(([p]) => p.split('/').filter(Boolean).length <= 3));
    for (const p of new Set([...Object.keys(cur), ...Object.keys(this.data.prevTop)])) {
      const d = (cur[p] || 0) - (this.data.prevTop[p] || 0);
      if (Math.abs(d) >= 200 * 1048576) out.push({ path: p, delta: d, size: cur[p] || 0 });
    }
    // no repetir padre e hijo con el mismo cambio
    return out.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).filter((x, i, arr) => !arr.slice(0, i).some(y => y.path.startsWith(x.path + '/') && Math.abs(y.delta - x.delta) < 100 * 1048576)).slice(0, 10);
  }

  status() {
    return { running: this.running ? { startedAt: this.running.startedAt, by: this.running.by, mount: this.running.mount } : null,
      finishedAt: this.data ? this.data.finishedAt : null, durationMs: this.data ? this.data.durationMs : null, by: this.data ? this.data.by : null,
      threshold: THRESHOLD, prevFinishedAt: this.data ? this.data.prevFinishedAt : null };
  }
}

function isFile(p) { try { return fs.lstatSync(p).isFile(); } catch { return false; } }

module.exports = { DiskMap, CATEGORIES };
