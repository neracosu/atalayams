'use strict';
// Actividad de las bases de datos MySQL/MariaDB: que consultas corren ahora, en que base, cuanto tardan y
// que tan cerca esta el servidor de quedarse sin conexiones. Usa un usuario con el unico permiso PROCESS
// (lo crea el ayudante: accion «mysql-monitor»), asi que ve las consultas en curso pero no puede leer ni
// cambiar ningun dato. Cada 5 s una muestra de la lista de procesos; cada 30 s los contadores globales.
// El texto de las consultas se guarda sin sus valores (cadenas y numeros -> ?) y solo se muestra en privado.
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const SAMPLE_MS = 5000, STATUS_MS = 30000;
const WINDOW = 180; // muestras por base (15 min a 5 s)
const SLOW_S = 10; // una consulta activa mas de esto es lenta
const IDLE_CMDS = new Set(['Sleep', 'Daemon', 'Binlog Dump', 'Slave_IO', 'Slave_SQL', 'Connect']);
const STATUS_KEYS = ['Questions', 'Com_select', 'Com_insert', 'Com_update', 'Com_delete', 'Slow_queries', 'Aborted_connects',
  'Aborted_clients', 'Threads_connected', 'Threads_running', 'Max_used_connections', 'Connection_errors_max_connections', 'Uptime'];

// consulta sin valores: nunca se guarda un correo, una clave o un dato de cliente que venga en el SQL
function normalize(q) {
  return String(q || '')
    .replace(/\\[nrt]/g, ' ')
    .replace(/'(?:[^'\\]|\\.)*'/g, '?').replace(/"(?:[^"\\]|\\.)*"/g, '?')
    .replace(/\b0x[0-9a-f]+\b/gi, '?').replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, '(?…)')
    .replace(/\s+/g, ' ').trim().slice(0, 240);
}

// salida de mysql -B -N: columnas separadas por tab, NULL literal, \t y \n escapados
function parseRows(out) {
  return String(out || '').split('\n').filter(Boolean).map(l => l.split('\t').map(v => (v === 'NULL' ? null : v)));
}

class DbActivity {
  constructor(cfg, dbAudit, bus) {
    this.cfg = cfg; this.dbAudit = dbAudit; this.bus = bus;
    this.file = path.join(cfg.stateDir, 'mysql-monitor.cnf');
    this.bin = (cfg.mysql && cfg.mysql.client) || 'mysql';
    this.perDb = new Map(); // base -> { conns, active, bits: [], longest, users: Set }
    this.status = null; this.prev = null; this.rates = null; this.max = 0;
    this.history = []; // { t, conns, running, qps }
    this.error = null; this.lastOk = 0; this.slowSeen = new Map();
    this.timers = [];
  }

  available() { return (this.cfg.edition || 'vps') === 'vps' && fs.existsSync(this.file); }

  query(sql) {
    return new Promise((resolve, reject) => execFile(this.bin, [`--defaults-file=${this.file}`, '-N', '-B', '-e', sql], { timeout: 4000, maxBuffer: 4 << 20 },
      (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message).trim().split('\n').pop())) : resolve(out))));
  }

  ownerOf(db) { return this.dbAudit && db ? this.dbAudit.ownerOf(db) : null; }

  // que sitio o app usa la base (busca su nombre en la configuracion de la cuenta; se recuerda 6 h)
  projectOf(db) {
    const c = (this.projCache || (this.projCache = new Map())).get(db);
    if (c && Date.now() - c.at < 6 * 3600000) return c.p;
    let p = null;
    try {
      const account = this.ownerOf(db);
      const hit = account && this.dbAudit.usedBy ? this.dbAudit.usedBy(db, account).find(h => h.domain || h.app) : null;
      const logs = this.dbAudit && this.dbAudit.logs;
      if (hit && hit.domain && logs) { const g = logs.sites.find(x => x.domain === hit.domain && x.account === account); if (g) p = { account, site: g.id }; }
      if (!p && hit && hit.app) p = { account, app: hit.app };
    } catch { p = null; }
    this.projCache.set(db, { at: Date.now(), p });
    return p;
  }

  async sample() {
    let rows;
    try { rows = parseRows(await this.query("SELECT ID, USER, DB, COMMAND, TIME, STATE, LEFT(INFO, 600) FROM information_schema.PROCESSLIST WHERE ID <> CONNECTION_ID()")); }
    catch (e) { this.fail(e); return; }
    this.error = null; this.lastOk = Date.now();
    const now = new Map();
    for (const [id, user, db, cmd, time, state, info] of rows) {
      if (user === 'system user' || user === 'event_scheduler') continue;
      const key = db || '';
      const x = now.get(key) || { conns: 0, active: 0, longest: null, users: new Set() };
      x.conns++; if (user) x.users.add(user);
      if (!IDLE_CMDS.has(cmd) && info) {
        x.active++;
        const t = Number(time) || 0;
        if (!x.longest || t > x.longest.time) x.longest = { id, time: t, state: state || '', query: normalize(info), user };
        if (t >= SLOW_S && key && !this.slowSeen.has(id)) {
          this.slowSeen.set(id, Date.now());
          this.bus.emit('ev', { kind: 'db', action: 'slow', db: key, account: this.ownerOf(key), target: this.projectOf(key), secs: t, query: normalize(info) });
        }
      }
      now.set(key, x);
    }
    for (const [id, at] of this.slowSeen) if (Date.now() - at > 600000) this.slowSeen.delete(id);
    // cada base guarda si tuvo una consulta activa en cada muestra: «ocupada el 12% de los ultimos 15 min»
    for (const key of new Set([...this.perDb.keys(), ...now.keys()])) {
      const cur = now.get(key);
      const d = this.perDb.get(key) || { bits: [], peak: 0 };
      d.bits.push(cur ? cur.active : 0); if (d.bits.length > WINDOW) d.bits.shift();
      d.conns = cur ? cur.conns : 0; d.active = cur ? cur.active : 0; d.users = cur ? [...cur.users] : [];
      d.longest = cur ? cur.longest : null;
      if (d.longest && (!d.peak || d.longest.time > d.peak.time)) d.peak = { ...d.longest, at: Date.now() };
      if (d.peak && Date.now() - d.peak.at > 3600000) d.peak = 0;
      if (!cur && d.bits.every(b => !b)) { this.perDb.delete(key); continue; }
      this.perDb.set(key, d);
    }
  }

  async readStatus() {
    let rows;
    try {
      rows = parseRows(await this.query(`SHOW GLOBAL STATUS WHERE Variable_name IN (${STATUS_KEYS.map(k => `'${k}'`).join(',')}); SELECT 'max_connections', @@max_connections;`));
    } catch (e) { this.fail(e); return; }
    const st = Object.fromEntries(rows.map(([k, v]) => [k, Number(v) || 0]));
    this.max = st.max_connections || this.max;
    const t = Date.now();
    if (this.prev && st.Uptime >= this.prev.st.Uptime) {
      const dt = (t - this.prev.t) / 1000, d = k => Math.max(0, (st[k] || 0) - (this.prev.st[k] || 0));
      this.rates = { qps: d('Questions') / dt, select: d('Com_select') / dt, insert: d('Com_insert') / dt, update: d('Com_update') / dt, delete: d('Com_delete') / dt,
        slow: d('Slow_queries'), aborted: d('Aborted_connects'), refused: d('Connection_errors_max_connections') };
      this.history.push({ t, conns: st.Threads_connected, running: st.Threads_running, qps: Math.round(this.rates.qps * 10) / 10 });
      if (this.history.length > 120) this.history.shift();
    }
    this.prev = { t, st };
    this.status = st;
  }

  fail(e) {
    const msg = /Access denied/i.test(e.message) ? 'El usuario de monitoreo no tiene acceso (actívelo de nuevo desde Bases de datos)'
      : /Can't connect|No such file|ENOENT/i.test(e.message) ? 'No se pudo conectar con MySQL/MariaDB' : e.message.slice(0, 200);
    if (msg !== this.error) console.error('[bases]', msg);
    this.error = msg;
  }

  start() {
    const tick = () => { if (this.available()) this.sample().catch(() => { }); };
    const stat = () => { if (this.available()) this.readStatus().catch(() => { }); };
    tick(); stat();
    this.timers.push(setInterval(tick, SAMPLE_MS), setInterval(stat, STATUS_MS));
    for (const t of this.timers) t.unref && t.unref();
  }

  // resumen para la pantalla (la privacidad la aplica server/privacy.js)
  snapshot() {
    if (!this.available()) return { available: false };
    const st = this.status || {};
    const dbs = [...this.perDb.entries()].filter(([k]) => k).map(([db, d]) => ({
      db, account: this.ownerOf(db), conns: d.conns, active: d.active, users: d.users,
      busy: d.bits.length ? Math.round(d.bits.filter(Boolean).length / d.bits.length * 100) : 0,
      samples: d.bits.length, longest: d.longest, peak: d.peak || null,
    })).sort((a, b) => b.busy - a.busy || b.active - a.active || b.conns - a.conns);
    const noDb = this.perDb.get('');
    return { available: true, error: this.error, lastOk: this.lastOk, max: this.max, conns: st.Threads_connected || 0, running: st.Threads_running || 0,
      maxUsed: st.Max_used_connections || 0, uptime: st.Uptime || 0, refusedTotal: st.Connection_errors_max_connections || 0,
      rates: this.rates, history: this.history, dbs, noDbConns: noDb ? noDb.conns : 0 };
  }

  // seccion de «Salud del servidor»
  section() {
    if (!this.available()) return null;
    const s = this.snapshot();
    const base = { id: 'dbactivity', title: 'Actividad de bases', icon: 'db' };
    if (s.error && !s.lastOk) return { ...base, status: 'unknown', items: [{ label: 'Estado', value: s.error }], findings: [] };
    const f = [], pct = s.max ? s.conns / s.max : 0, peak = s.max ? s.maxUsed / s.max : 0;
    if (pct >= 0.8) f.push({ sev: 'bad', title: `Conexiones casi agotadas: ${s.conns} de ${s.max}`, detail: 'Cuando se llega al máximo, los sitios muestran «Error establishing a database connection» o «Too many connections».',
      fix: 'Busque qué base acumula conexiones (casi siempre apps con un pool grande o conexiones que no se cierran) o suba max_connections si el servidor tiene memoria.' });
    else if (peak >= 0.9) f.push({ sev: 'warn', title: `El pico llegó a ${s.maxUsed} de ${s.max} conexiones`, detail: `Desde que MySQL arrancó (hace ${Math.round(s.uptime / 86400)} días) estuvo a punto de rechazar conexiones.`,
      fix: 'Revise las bases con más conexiones abiertas en Bases de datos › Actividad. Muchas conexiones dormidas suelen ser pools de apps Node o PHP persistente.' });
    if (s.refusedTotal) f.push({ sev: 'warn', title: `${s.refusedTotal} conexión(es) rechazadas por llegar al máximo`, detail: 'Desde el último arranque de MySQL, alguien intentó conectarse y no hubo lugar.', fix: 'Igual que arriba: bajar las conexiones que se quedan abiertas o subir el máximo.' });
    const slow = s.dbs.filter(d => d.peak && d.peak.time >= SLOW_S);
    if (slow.length) f.push({ sev: 'warn', title: `Consultas lentas en ${slow.length} base(s) en la última hora`, detail: slow.slice(0, 4).map(d => `${d.db}: ${d.peak.time} s`).join(', '),
      fix: 'Abra la base en Bases de datos para ver la consulta (sin sus valores). Suele faltar un índice o se recorre una tabla entera.', names: slow.map(d => d.db) });
    const status = f.some(x => x.sev === 'bad') ? 'bad' : f.length ? 'warn' : 'ok';
    return { ...base, status, findings: f, items: [{ label: 'Conexiones', value: `${s.conns} de ${s.max}` }, { label: 'Consultas por segundo', value: s.rates ? s.rates.qps.toFixed(1) : '…' },
      { label: 'Pico histórico', value: `${s.maxUsed} de ${s.max}` }] };
  }
}

module.exports = { DbActivity, normalize, parseRows };
