'use strict';
// Supabase: cada proyecto es un edificio (torre de base de datos) con CPU, memoria, disco, conexiones y
// reinicios desde la Metrics API (formato Prometheus, cada minuto). Con un token de gestion opcional
// tambien se lee el estado del proyecto (activo, pausado, iniciando) y su region.
const https = require('https');

const HOST = process.env.ATALAYA_SUPABASE_HOST || null; // pruebas: http://127.0.0.1:puerto
const MGMT = process.env.ATALAYA_SUPABASE_API || 'https://api.supabase.com';

function request(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? require('http') : https;
    const req = mod.request(u, { method: 'GET', timeout: 15000, headers: { 'User-Agent': 'Atalaya', ...headers } }, res => {
      let d = ''; res.setEncoding('utf8');
      res.on('data', c => { d += c; if (d.length > 32 << 20) req.destroy(); });
      res.on('end', () => res.statusCode === 200 ? resolve(d) : reject(new Error(`Supabase ${res.statusCode}`)));
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject); req.end();
  });
}

// texto Prometheus -> [{ name, labels, value }]
function parseProm(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line || line[0] === '#') continue;
    const m = line.match(/^([a-zA-Z_:][\w:]*)(?:\{(.*)\})?\s+(\S+)/);
    if (!m) continue;
    const labels = {};
    if (m[2]) for (const x of m[2].matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) labels[x[1]] = x[2];
    const v = Number(m[3]);
    if (!Number.isNaN(v)) out.push({ name: m[1], labels, value: v });
  }
  return out;
}
const sum = (rows, name, f = () => true) => rows.filter(r => r.name === name && f(r.labels)).reduce((n, r) => n + r.value, 0);
const has = (rows, name) => rows.some(r => r.name === name);

class SupabaseConnector {
  // conn: { id, name, projects: [{ ref, name, serviceKey }], mgmtToken }
  constructor(conn, bus) {
    this.conn = conn; this.bus = bus;
    this.account = '_supa-' + conn.id;
    this.label = 'Supabase · ' + (conn.name || conn.id);
    this.apps = [];
    this.prev = new Map(); // ref -> { cpuTotal, cpuIdle, restarts, t }
    this.meta = new Map(); // ref -> { status, region, name }
    this.data = new Map();
    this.error = null; this.lastOk = 0; this.timers = [];
  }

  start() {
    const tick = () => this.poll().catch(e => { this.error = e.message; }).then(() => this.build());
    tick();
    this.timers.push(setInterval(tick, 60000));
  }
  stop() { for (const t of this.timers) clearInterval(t); this.timers = []; }

  async poll() {
    if (this.conn.mgmtToken) {
      try {
        const list = JSON.parse(await request(`${MGMT}/v1/projects`, { Authorization: 'Bearer ' + this.conn.mgmtToken }));
        for (const p of list) this.meta.set(p.id || p.ref, { status: p.status, region: p.region, name: p.name });
      } catch (e) { this.error = e.message; }
    }
    let okAny = false;
    for (const p of this.conn.projects || []) {
      const base = HOST || `https://${p.ref}.supabase.co`;
      try {
        const txt = await request(`${base}/customer/v1/privileged/metrics`, { Authorization: 'Basic ' + Buffer.from('service_role:' + p.serviceKey).toString('base64') });
        this.data.set(p.ref, { t: Date.now(), rows: parseProm(txt), ok: true });
        okAny = true;
      } catch (e) {
        const prevData = this.data.get(p.ref);
        this.data.set(p.ref, { ...(prevData || {}), ok: false, err: e.message });
      }
    }
    if (okAny) { this.error = null; this.lastOk = Date.now(); }
  }

  build() {
    this.apps = (this.conn.projects || []).map(p => {
      const d = this.data.get(p.ref) || {};
      const rows = d.rows || [];
      const meta = this.meta.get(p.ref) || {};
      const cpuTotal = sum(rows, 'node_cpu_seconds_total'), cpuIdle = sum(rows, 'node_cpu_seconds_total', l => l.mode === 'idle' || l.mode === 'iowait');
      const pr = this.prev.get(p.ref);
      const cpu = pr && cpuTotal > pr.cpuTotal ? Math.max(0, (1 - (cpuIdle - pr.cpuIdle) / (cpuTotal - pr.cpuTotal)) * 100) : 0;
      const memTotal = sum(rows, 'node_memory_MemTotal_bytes'), memAvail = sum(rows, 'node_memory_MemAvailable_bytes');
      const root = l => l.mountpoint === '/' || l.mountpoint === '/data';
      const diskSize = sum(rows, 'node_filesystem_size_bytes', root), diskAvail = sum(rows, 'node_filesystem_avail_bytes', root);
      const restarts = sum(rows, 'postgresql_restarts_total');
      if (pr && restarts > pr.restarts) this.bus.emit('ev', { kind: 'pm2', account: this.account, app: p.name || p.ref, action: 'restart', source: 'supabase' });
      if (rows.length) this.prev.set(p.ref, { cpuTotal, cpuIdle, restarts, t: d.t });
      const paused = /INACTIVE|PAUSED/i.test(meta.status || '');
      const status = paused ? 'down' : !d.ok ? (d.rows ? 'degraded' : 'down') : /COMING_UP|RESTORING|UPGRADING/i.test(meta.status || '') ? 'degraded' : 'online';
      return {
        account: this.account, name: p.name || meta.name || p.ref, source: 'supabase', image: 'postgres', status,
        substate: paused ? 'pausado' : meta.status ? meta.status.toLowerCase().replace(/_/g, ' ') : d.ok ? 'activo' : (d.err || 'sin datos'),
        instances: 1, online: status === 'online' ? 1 : 0, cpu: Math.round(cpu * 10) / 10, mem: memTotal ? memTotal - memAvail : 0, uptime: 0,
        restartsTotal: restarts, ref: p.ref, region: meta.region || '',
        memTotal, disk: diskSize ? { used: diskSize - diskAvail, total: diskSize, pct: (diskSize - diskAvail) / diskSize * 100 } : null,
        pooler: has(rows, 'supavisor_connections_active') ? sum(rows, 'supavisor_connections_active') : null,
        dbConns: has(rows, 'pg_stat_database_numbackends') ? sum(rows, 'pg_stat_database_numbackends') : null,
        dbSize: has(rows, 'pg_database_size_bytes') ? sum(rows, 'pg_database_size_bytes') : null,
        authReq: has(rows, 'http_server_duration_milliseconds_count') ? sum(rows, 'http_server_duration_milliseconds_count', l => l.service_type === 'gotrue') : null,
        metrics: rows.length, lastScrape: d.t || 0,
      };
    });
  }

  info() { return { id: this.conn.id, type: 'supabase', label: this.label, account: this.account, error: this.error, lastOk: this.lastOk, projects: (this.conn.projects || []).length }; }
}

module.exports = { SupabaseConnector, parseProm };
