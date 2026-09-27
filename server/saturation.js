'use strict';
// Saturacion: que tan cerca esta el servidor de no dar abasto, y que sitios se quedaron sin procesos PHP.
//  - Servidor: CPU, carga por nucleo, memoria, swap, conexiones de MySQL y errores 5xx. Una causa cuenta si se
//    sostiene dos muestras seguidas (40 s): un pico de un segundo no es saturacion.
//  - PHP-FPM: los avisos «server reached max_children» de los registros de PHP (cPanel: ea-phpXX). Cada pool es
//    un sitio (tienda_ejemplo_com = tienda.ejemplo.com); si tocó el tope, sus visitas esperan en fila.
// Solo lectura. Al entrar o salir de «al limite» se avisa (evento), y la Salud del servidor lo explica.
const fs = require('fs');
const path = require('path');

const SAMPLE_MS = 20000;
const PHP_GLOBS = ['/opt/cpanel'];
const PHP_RE = /^\[(\d{2}-\w{3}-\d{4} \d{2}:\d{2}:\d{2})\] WARNING: \[pool ([^\]]+)\] server reached (?:pm\.)?max_children setting \((\d+)\)/;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const phpTime = s => { const m = s.match(/(\d{2})-(\w{3})-(\d{4}) (\d{2}):(\d{2}):(\d{2})/); return m ? new Date(+m[3], MONTHS[m[2]], +m[1], +m[4], +m[5], +m[6]).getTime() : 0; };

function phpLogs(roots = PHP_GLOBS) {
  const out = [];
  for (const r of roots) {
    let ents = []; try { ents = fs.readdirSync(r); } catch { continue; }
    for (const d of ents) if (/^ea-php\d+$/.test(d)) { const f = path.join(r, d, 'root/usr/var/log/php-fpm/error.log'); if (fs.existsSync(f)) out.push({ ver: d.replace('ea-php', ''), file: f }); }
  }
  return out;
}

class Saturation {
  constructor(cfg, bus, ctx, opts = {}) {
    this.cfg = cfg; this.bus = bus; this.ctx = ctx;
    this.logs = opts.phpLogs || phpLogs();
    this.pos = new Map(); // archivo -> bytes leidos
    this.pools = new Map(); // pool -> { hits: [t...], max, ver, last }
    this.streak = new Map(); // causa -> muestras seguidas
    this.level = 'ok'; this.causes = []; this.since = 0;
    this.readPhp(true);
    if (!opts.manual) setInterval(() => { try { this.sample(); } catch (e) { console.error('[saturacion]', e.message); } }, SAMPLE_MS).unref();
  }

  available() { return (this.cfg.edition || 'vps') === 'vps'; }

  // lee lo nuevo de cada registro de PHP-FPM (al arrancar, los ultimos 7 dias)
  readPhp(initial) {
    const weekAgo = Date.now() - 7 * 86400000;
    for (const { ver, file } of this.logs) {
      let st; try { st = fs.statSync(file); } catch { continue; }
      let from = this.pos.get(file);
      if (from == null || from > st.size) from = initial ? Math.max(0, st.size - 4 * 1024 * 1024) : st.size;
      if (st.size <= from) { this.pos.set(file, st.size); continue; }
      let buf = '';
      try { const fd = fs.openSync(file, 'r'); const b = Buffer.alloc(Math.min(st.size - from, 8 * 1024 * 1024)); fs.readSync(fd, b, 0, b.length, from); fs.closeSync(fd); buf = b.toString('utf8'); } catch { continue; }
      this.pos.set(file, st.size);
      for (const line of buf.split('\n')) {
        const m = PHP_RE.exec(line); if (!m) continue;
        const t = phpTime(m[1]); if (t < weekAgo) continue;
        const p = this.pools.get(m[2]) || { hits: [], max: +m[3], ver, last: 0 };
        p.hits.push(t); if (p.hits.length > 5000) p.hits.shift();
        p.max = +m[3]; p.ver = ver; p.last = Math.max(p.last, t);
        this.pools.set(m[2], p);
      }
    }
    for (const [k, p] of this.pools) { p.hits = p.hits.filter(t => t >= weekAgo); if (!p.hits.length) this.pools.delete(k); }
  }

  // de que sitio es un pool: su nombre es el dominio con _ en lugar de .
  siteOfPool(pool) {
    const L = this.ctx.logs;
    const g = L && L.sites ? L.sites.find(x => x.domain && x.domain.replace(/[.-]/g, '_') === pool) : null;
    return g ? { account: g.account, site: g.id, domain: g.domain } : { domain: pool.replace(/_/g, '.') };
  }

  // causas del servidor ahora (cada una con su nivel)
  measure() {
    const sys = this.ctx.host && this.ctx.host.system, out = [];
    if (sys && sys.cores) {
      const cpu = sys.cpu || 0, load = (sys.load || [0])[0] / sys.cores, mem = (sys.mem && sys.mem.pct) || 0;
      const swap = sys.swap && sys.swap.total ? sys.swap.used / sys.swap.total * 100 : 0;
      if (cpu >= 75) out.push({ id: 'cpu', level: cpu >= 90 ? 'bad' : 'warn', label: `CPU ${Math.round(cpu)} %`, value: cpu });
      if (load >= 1.2) out.push({ id: 'load', level: load >= 2 ? 'bad' : 'warn', label: `carga ${load.toFixed(1)} veces sus núcleos`, value: load });
      if (mem >= 85) out.push({ id: 'mem', level: mem >= 92 ? 'bad' : 'warn', label: `memoria ${Math.round(mem)} %`, value: mem });
      if (swap >= 50) out.push({ id: 'swap', level: swap >= 80 ? 'bad' : 'warn', label: `swap ${Math.round(swap)} %`, value: swap });
    }
    const X = this.ctx.dbActivity;
    if (X && X.available()) {
      const s = X.snapshot(), pct = s.max ? s.conns / s.max * 100 : 0;
      if (pct >= 70) out.push({ id: 'mysql', level: pct >= 85 ? 'bad' : 'warn', label: `conexiones de MySQL ${s.conns} de ${s.max}`, value: pct });
    }
    const L = this.ctx.logs && this.ctx.logs.lastMinute;
    if (L && L.req >= 30) {
      const e = L.err / L.req * 100;
      if (e >= 5) out.push({ id: '5xx', level: e >= 15 ? 'bad' : 'warn', label: `${Math.round(e)} % de errores 5xx`, value: e });
    }
    return out;
  }

  sample(now = Date.now()) {
    this.readPhp(false);
    const cur = this.measure();
    // una causa cuenta si se sostiene dos muestras seguidas
    const ids = new Set(cur.map(c => c.id));
    for (const id of [...this.streak.keys()]) if (!ids.has(id)) this.streak.delete(id);
    for (const c of cur) this.streak.set(c.id, (this.streak.get(c.id) || 0) + 1);
    this.causes = cur.filter(c => this.streak.get(c.id) >= 2);
    const lv = this.causes.some(c => c.level === 'bad') ? 'bad' : this.causes.length ? 'warn' : 'ok';
    if ((lv === 'bad') !== (this.level === 'bad')) {
      this.since = now;
      console.log(`[saturacion] servidor ${lv === 'bad' ? 'al límite: ' + this.causes.map(c => c.label).join(', ') : 'volvió a la normalidad'}`);
      this.bus.emit('ev', { kind: 'saturation', action: lv === 'bad' ? 'start' : 'end', causes: this.causes.map(c => c.label) });
    }
    this.level = lv;
  }

  // sitios que se quedaron sin procesos PHP: recientes (15 min, para el mapa) y de la semana (para la ficha)
  phpSites(now = Date.now()) {
    return [...this.pools.entries()].map(([pool, p]) => ({ pool, ...this.siteOfPool(pool), max: p.max, ver: p.ver, last: p.last,
      week: p.hits.length, recent: p.hits.filter(t => now - t < 15 * 60000).length })).sort((a, b) => b.last - a.last);
  }
  siteState(siteId, now = Date.now()) {
    const x = this.phpSites(now).find(p => p.site === siteId && p.recent);
    return x ? { php: true, max: x.max, n: x.recent } : null;
  }

  state() { return { level: this.level, causes: this.causes.map(c => ({ id: c.id, level: c.level, label: c.label })), since: this.since }; }

  // seccion de «Salud del servidor»
  section() {
    if (!this.available()) return null;
    const f = [];
    if (this.level !== 'ok') f.push({ sev: this.level, title: `Servidor ${this.level === 'bad' ? 'al límite' : 'exigido'}: ${this.causes.map(c => c.label).join(', ')}`,
      detail: 'Si sigue así, los sitios se ponen lentos o empiezan a fallar.',
      fix: 'Mire en Procesos qué consume más, en Bases de datos quién acapara conexiones y en Defensa web si hay un ataque; con la defensa automática encendida, Atalaya frena a los atacantes antes de la caída.' });
    const php = this.phpSites();
    if (php.length) {
      const top = php.slice(0, 8);
      const sev = php.some(p => p.recent) ? 'bad' : php.some(p => p.week >= 10) ? 'warn' : 'info';
      f.push({ sev, title: `${php.length} sitio(s) se quedaron sin procesos PHP esta semana`, detail: top.map(p => `${p.domain}: ${p.week} vez(ces), tope ${p.max}${p.recent ? ' (ahora)' : ''}`).join(' · '),
        fix: `Cuando un sitio llega a su tope de procesos PHP-FPM, sus visitas esperan en fila. Súbalo en WHM › MultiPHP Manager › PHP-FPM (o en la cuenta: MultiPHP INI › pm.max_children), por ejemplo de 5 a 10-15 si el servidor tiene memoria; y active caché de página en los WordPress que más lo tocan.`,
        names: top.map(p => p.domain) });
    }
    const status = f.some(x => x.sev === 'bad') ? 'bad' : f.some(x => x.sev === 'warn') ? 'warn' : 'ok';
    return { id: 'saturation', title: 'Saturación', icon: 'fire', status, findings: f,
      items: [{ label: 'Estado', value: this.level === 'bad' ? 'al límite' : this.level === 'warn' ? 'exigido' : 'con margen' }, { label: 'Sitios sin PHP (semana)', value: String(php.length) }] };
  }
}

module.exports = { Saturation, phpLogs, PHP_RE };
