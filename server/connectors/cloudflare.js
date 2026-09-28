'use strict';
// Cloudflare: los proyectos de Pages y los Workers como edificios, sus despliegues, las visitas de cada dominio
// y los relojes (cron) que dejaron de correr. Todo con un token de SOLO LECTURA de la cuenta del cliente.
//  - Pages: proyectos, dominios, repo (GitHub o GitLab) y despliegues (construyendo, listo, fallo)
//  - Workers: cuantas veces corrio cada uno y cuantas fallo (GraphQL, workersInvocationsAdaptive). Un Worker con
//    reloj que deja de correr no da ningun error: simplemente calla. Se compara lo que deberia correr con lo que corrio
//  - Visitas: totales por hora de cada zona (GraphQL, httpRequests1hGroups), sin pegar nada en el sitio
// Permisos del token: Cuenta > Cloudflare Pages: Read, Workers Scripts: Read, Account Analytics: Read;
// Zona > Zone: Read, Analytics: Read. Si falta alguno, esa parte se apaga y el resto sigue.
const API = () => process.env.ATALAYA_CF_API || 'https://api.cloudflare.com/client/v4';
const HOUR = 3600000;

// cada cuanto deberia correr un cron de Cloudflare ("*/5 * * * *", "0 */6 * * *", "10 4 * * *"), en ms
function cronEvery(expr) {
  const f = String(expr || '').trim().split(/\s+/);
  if (f.length < 5) return 24 * HOUR;
  const step = x => { const m = /^\*\/(\d+)$/.exec(x); return m ? Number(m[1]) : 0; };
  const [min, hour, dom, , dow] = f;
  if (min === '*') return 60000;
  if (step(min)) return step(min) * 60000;
  if (hour === '*') return HOUR * (min.includes(',') ? 1 / min.split(',').length : 1);
  if (step(hour)) return step(hour) * HOUR;
  if (hour.includes(',')) return 24 * HOUR / hour.split(',').length;
  if (dom !== '*' && dow === '*') return 31 * 24 * HOUR;
  if (dow !== '*' && !dow.includes(',') && !dow.includes('-')) return 7 * 24 * HOUR;
  return 24 * HOUR;
}

// etapa de un despliegue de Pages -> el mismo vocabulario que los de Vercel
function deployState(d) {
  const s = (d && d.latest_stage) || {};
  if (s.status === 'failure') return 'ERROR';
  if (s.status === 'canceled') return 'CANCELED';
  if (s.status === 'success') return s.name === 'deploy' ? 'READY' : 'BUILDING';
  if (s.status === 'active') return 'BUILDING';
  return 'QUEUED';
}
const STATUS = { READY: 'online', ERROR: 'down', CANCELED: 'online', BUILDING: 'degraded', QUEUED: 'degraded' };
const ACTION = { BUILDING: 'building', QUEUED: 'building', READY: 'ready', ERROR: 'error', CANCELED: 'canceled' };

class CloudflareConnector {
  // conn: { id, name, token, accountId? }
  constructor(conn, bus, opts = {}) {
    this.conn = conn; this.bus = bus;
    this.account = '_cf-' + conn.id;
    this.label = 'Cloudflare · ' + (conn.name || conn.id);
    this.fetch = opts.fetch || ((u, o) => fetch(u, { ...o, signal: AbortSignal.timeout(20000) }));
    this.now = opts.now || (() => Date.now());
    this.apps = [];
    this.accountId = conn.accountId || null; this.accountName = '';
    this.projects = new Map(); // nombre -> proyecto de Pages
    this.deployments = new Map(); // nombre -> despliegues recientes
    this.states = new Map(); // id de despliegue -> estado conocido
    this.workers = new Map(); // nombre -> { created, modified, crons: [], runs, errors, last, silent }
    this.zones = []; // [{ id, name }]
    this.traffic = new Map(); // zona -> cifras de hoy y de 7 dias
    this.warn = {}; // parte -> por que no se pudo leer (permiso que falta)
    this.error = null; this.lastOk = 0;
    this.timers = [];
  }

  async api(p) {
    const r = await this.fetch(API() + p, { method: 'GET', headers: { Authorization: 'Bearer ' + this.conn.token, 'Content-Type': 'application/json' } });
    let j = null; try { j = await r.json(); } catch { }
    if (!j || !j.success) {
      const e = (j && j.errors && j.errors[0]) || {};
      const err = new Error(e.code === 10000 || r.status === 401 || r.status === 403 ? 'sin permiso' : e.message || `Cloudflare respondió ${r.status}`);
      err.denied = err.message === 'sin permiso'; throw err;
    }
    return j;
  }
  async all(p, max = 10) {
    const out = [];
    for (let page = 1; page <= max; page++) {
      const j = await this.api(`${p}${p.includes('?') ? '&' : '?'}page=${page}`);
      out.push(...(j.result || []));
      if (!j.result_info || !j.result_info.total_pages || page >= j.result_info.total_pages) break;
    }
    return out;
  }
  async gql(query) {
    const r = await this.fetch(API() + '/graphql', { method: 'POST', headers: { Authorization: 'Bearer ' + this.conn.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    let j = null; try { j = await r.json(); } catch { }
    if (!j || (j.errors && j.errors.length) || !j.data) {
      const m = (j && j.errors && j.errors[0] && j.errors[0].message) || `Cloudflare respondió ${r.status}`;
      const err = new Error(/auth|permission|not authorized|access/i.test(m) || r.status === 401 || r.status === 403 ? 'sin permiso' : m);
      err.denied = err.message === 'sin permiso'; throw err;
    }
    return j.data;
  }

  start() {
    const NEED = { pages: 'Cloudflare Pages: Read', workers: 'Workers Scripts: Read', runs: 'Account Analytics: Read', zones: 'Zone: Read', traffic: 'Zone › Analytics: Read' };
    this.part = async (name, fn) => {
      try { await fn(); delete this.warn[name]; this.lastOk = this.now(); this.error = null; }
      catch (e) { this.warn[name] = e.denied ? `Al token le falta el permiso «${NEED[name]}»` : e.message; if (name === 'account') this.error = this.warn[name]; }
      this.build();
    };
    const first = async () => {
      await this.part('account', () => this.pollAccount());
      if (!this.accountId) return;
      await this.part('pages', () => this.pollPages());
      await this.part('workers', () => this.pollWorkers());
      await this.part('runs', () => this.pollRuns());
      await this.part('zones', () => this.pollZones());
      await this.part('traffic', () => this.pollTraffic());
    };
    first();
    const every = (ms, name, fn) => this.timers.push(setInterval(() => { if (this.accountId) this.part(name, fn); else first(); }, ms));
    every(60000, 'pages', () => this.pollPages());
    every(30 * 60000, 'workers', () => this.pollWorkers());
    every(5 * 60000, 'runs', () => this.pollRuns());
    every(60 * 60000, 'zones', () => this.pollZones());
    every(10 * 60000, 'traffic', () => this.pollTraffic());
  }
  stop() { for (const t of this.timers) clearInterval(t); this.timers = []; }

  async pollAccount() {
    if (this.accountId && this.checkedAccount) return;
    this.checkedAccount = true;
    let list = [];
    try { list = (await this.api('/accounts?per_page=20')).result || []; }
    catch (e) { if (!this.conn.accountId || !e.denied) throw e; } // un token sin permiso para listar cuentas sirve igual si se dio el ID
    const a = this.conn.accountId ? list.find(x => x.id === this.conn.accountId) || { id: this.conn.accountId, name: '' } : list[0];
    if (!a) throw new Error('El token no ve ninguna cuenta de Cloudflare: escriba el ID de la cuenta');
    this.accountId = a.id; this.accountName = a.name || '';
    this.accounts = list.length;
  }

  async pollPages() {
    const list = await this.all(`/accounts/${this.accountId}/pages/projects?per_page=10`, 20);
    const seen = new Set();
    for (const p of list) {
      seen.add(p.name);
      const prev = this.projects.get(p.name);
      this.projects.set(p.name, p);
      const d = p.latest_deployment;
      if (!d) continue;
      const st = deployState(d), known = this.states.get(d.id);
      const meta = (d.deployment_trigger && d.deployment_trigger.metadata) || {};
      // un despliegue nuevo o que cambia de estado genera un evento (los que ya estaban al conectar, no)
      if (prev && known !== st && ACTION[st] && (known || this.now() - Date.parse(d.created_on) < 600000)) {
        this.bus.emit('ev', { kind: 'deploy', account: this.account, app: p.name, action: ACTION[st], target: d.environment === 'production' ? 'production' : 'preview',
          url: d.url, branch: meta.branch, commit: meta.commit_message, creator: d.deployment_trigger && d.deployment_trigger.type === 'ad_hoc' ? 'subida directa' : '' });
      }
      this.states.set(d.id, st);
      // el historial se relee solo si hay un despliegue nuevo o cambio de estado
      if (!this.deployments.has(p.name) || known !== st) {
        try {
          const r = await this.api(`/accounts/${this.accountId}/pages/projects/${encodeURIComponent(p.name)}/deployments?per_page=8`);
          this.deployments.set(p.name, (r.result || []).slice(0, 8).map(x => this.deployRow(x)));
        } catch { this.deployments.set(p.name, [this.deployRow(d)]); }
      }
    }
    for (const n of [...this.projects.keys()]) if (!seen.has(n)) { this.projects.delete(n); this.deployments.delete(n); }
    if (this.states.size > 2000) this.states = new Map([...this.states].slice(-1000));
  }
  deployRow(d) {
    const meta = (d.deployment_trigger && d.deployment_trigger.metadata) || {}, st = deployState(d);
    return { uid: d.id, url: d.url, state: st, target: d.environment === 'production' ? 'production' : 'preview', created: Date.parse(d.created_on) || 0,
      ready: st === 'READY' ? Date.parse(d.modified_on || d.created_on) || 0 : 0, branch: meta.branch, commit: meta.commit_message,
      creator: d.deployment_trigger && d.deployment_trigger.type === 'ad_hoc' ? 'subida directa' : '' };
  }

  async pollWorkers() {
    const list = (await this.api(`/accounts/${this.accountId}/workers/scripts`)).result || [];
    const seen = new Set();
    for (const w of list) {
      const name = w.id; if (!name) continue;
      seen.add(name);
      const x = this.workers.get(name) || { runs: 0, errors: 0, last: 0, silent: false, crons: [] };
      x.created = Date.parse(w.created_on) || 0; x.modified = Date.parse(w.modified_on) || 0;
      try { const r = await this.api(`/accounts/${this.accountId}/workers/scripts/${encodeURIComponent(name)}/schedules`); x.crons = ((r.result && r.result.schedules) || []).map(s => s.cron).filter(Boolean); }
      catch { /* sin relojes o sin permiso: se conserva lo anterior */ }
      this.workers.set(name, x);
    }
    for (const n of [...this.workers.keys()]) if (!seen.has(n)) this.workers.delete(n);
  }

  // cuantas veces corrio cada Worker en 48 horas, por hora: de ahi sale la ultima corrida y los errores de hoy
  async pollRuns() {
    if (!this.workers.size) return;
    const to = new Date(this.now()), from = new Date(this.now() - 48 * HOUR);
    const d = await this.gql(`{ viewer { accounts(filter: {accountTag: "${this.accountId}"}) {
      runs: workersInvocationsAdaptive(limit: 9000, filter: {datetime_geq: "${from.toISOString()}", datetime_leq: "${to.toISOString()}"}, orderBy: [datetimeHour_DESC]) {
        sum { requests errors } dimensions { scriptName datetimeHour } } } } }`);
    const rows = (((d.viewer || {}).accounts || [])[0] || {}).runs || [];
    const by = new Map();
    for (const r of rows) {
      const n = r.dimensions.scriptName, t = Date.parse(r.dimensions.datetimeHour) || 0;
      const x = by.get(n) || { runs: 0, errors: 0, last: 0 };
      if (r.sum.requests > 0 && t > x.last) x.last = t;
      if (this.now() - t <= 24 * HOUR) { x.runs += r.sum.requests || 0; x.errors += r.sum.errors || 0; }
      by.set(n, x);
    }
    for (const [name, w] of this.workers) {
      const x = by.get(name) || { runs: 0, errors: 0, last: 0 };
      Object.assign(w, x);
      // reloj callado: deberia haber corrido varias veces y no hay ni una corrida. La ultima corrida se conoce por
      // hora y las cifras llegan con atraso: por eso el margen es de al menos 3 horas
      const every = w.crons.length ? Math.min(...w.crons.map(cronEvery)) : 0;
      const since = w.last ? w.last + HOUR : Math.max(w.modified || 0, w.created || 0);
      const silent = !!every && every <= 24 * HOUR && this.now() - since > Math.max(3 * every, 3 * HOUR) && this.now() - (w.modified || 0) > 3 * HOUR;
      if (silent !== w.silent && (silent || w.silent)) {
        if (w.checked) this.bus.emit('ev', { kind: 'cron', action: silent ? 'silent' : 'back', account: this.account, app: name, since: w.last || 0, every });
        else if (silent) this.bus.emit('ev', { kind: 'cron', action: 'silent', account: this.account, app: name, since: w.last || 0, every });
      }
      w.silent = silent; w.every = every; w.checked = true;
    }
  }

  async pollZones() {
    const list = await this.all('/zones?per_page=50', 4);
    this.zones = list.map(z => ({ id: z.id, name: z.name })).slice(0, 40);
  }

  // visitas de cada zona: hoy por hora y los ultimos 7 dias. Son totales de Cloudflare: no hay paginas ni IPs
  async pollTraffic() {
    const now = this.now(), day = new Date(now).toISOString().slice(0, 10);
    const from = new Date(now - 24 * HOUR).toISOString().slice(0, 13) + ':00:00Z', week = new Date(now - 7 * 24 * HOUR).toISOString().slice(0, 10);
    let denied = 0, lastErr = null;
    for (const z of this.zones) {
      try {
        const d = await this.gql(`{ viewer { zones(filter: {zoneTag: "${z.id}"}) {
          horas: httpRequests1hGroups(limit: 30, filter: {datetime_geq: "${from}"}, orderBy: [datetime_ASC]) { dimensions { datetime } sum { requests pageViews } uniq { uniques } }
          dias: httpRequests1dGroups(limit: 9, filter: {date_geq: "${week}"}, orderBy: [date_ASC]) { dimensions { date } sum { requests pageViews } uniq { uniques } }
          detalle: httpRequests1dGroups(limit: 1, filter: {date: "${day}"}) { sum { countryMap { clientCountryName requests } responseStatusMap { edgeResponseStatus requests } } } } } }`);
        const x = ((d.viewer || {}).zones || [])[0];
        if (!x || (!(x.horas || []).length && !(x.dias || []).length)) { this.traffic.delete(z.name); continue; } // zona sin trafico medido
        const det = ((x.detalle || [])[0] || {}).sum || {}, hours = x.horas || [];
        const full = hours.filter(h => now - Date.parse(h.dimensions.datetime) >= HOUR).slice(-1)[0];
        this.traffic.set(z.name, {
          at: now,
          day: { visitors: hours.reduce((s, h) => s + h.uniq.uniques, 0), pages: hours.reduce((s, h) => s + h.sum.pageViews, 0), requests: hours.reduce((s, h) => s + h.sum.requests, 0),
            err5xx: (det.responseStatusMap || []).filter(s => s.edgeResponseStatus >= 500).reduce((s, v) => s + v.requests, 0) },
          reqMin: full ? Math.round(full.sum.requests / 60) : 0,
          hours: hours.map(h => ({ t: Date.parse(h.dimensions.datetime), visitors: h.uniq.uniques, requests: h.sum.requests })),
          days: (x.dias || []).map(v => ({ date: v.dimensions.date, visitors: v.uniq.uniques, pages: v.sum.pageViews })),
          countries: (det.countryMap || []).slice().sort((a, b) => b.requests - a.requests).slice(0, 8).map(c => ({ key: c.clientCountryName, n: c.requests })),
        });
      } catch (e) { lastErr = e; if (e.denied) denied++; }
    }
    for (const n of [...this.traffic.keys()]) if (!this.zones.some(z => z.name === n)) this.traffic.delete(n);
    if (this.zones.length && denied === this.zones.length) throw lastErr;
  }

  zoneOf(host) { const h = String(host || '').toLowerCase(); return this.zones.map(z => z.name).filter(n => h === n || h.endsWith('.' + n)).sort((a, b) => b.length - a.length)[0] || null; }

  // un edificio por proyecto de Pages y uno por Worker
  build() {
    const apps = [];
    for (const p of this.projects.values()) {
      const deps = this.deployments.get(p.name) || [];
      const prod = deps.find(d => d.target === 'production') || deps[0];
      const building = deps.find(d => ['BUILDING', 'QUEUED'].includes(d.state) && this.now() - d.created < HOUR);
      const status = building ? 'degraded' : prod ? STATUS[prod.state] || 'online' : 'online';
      const domains = [...new Set([...(p.domains || []), p.subdomain].filter(Boolean))];
      const zone = domains.map(d => this.zoneOf(d)).find(Boolean) || null, tr = zone ? this.traffic.get(zone) : null;
      const src = p.source && p.source.config ? p.source : null;
      apps.push({
        account: this.account, name: p.name, source: 'cloudflare', cfKind: 'pages', status, substate: building ? 'desplegando' : prod ? prod.state.toLowerCase() : 'sin despliegues',
        instances: 1, online: status === 'down' ? 0 : 1, cpu: 0, mem: 0, uptime: prod && prod.ready ? (this.now() - prod.ready) / 1000 : 0,
        framework: '', deployments: deps, domains,
        repo: src && src.type === 'github' && src.config.owner && src.config.repo_name ? `${src.config.owner}/${src.config.repo_name}` : null,
        repoHost: src ? src.type : null, zone, traffic: tr || null, cfReqMin: tr ? tr.reqMin : 0, restartsTotal: 0,
      });
    }
    // los Workers que son la parte de funciones de un proyecto de Pages no se repiten
    for (const [name, w] of this.workers) {
      if (this.projects.has(name)) continue;
      const bad = w.runs >= 20 && w.errors / w.runs > 0.5;
      const status = w.silent ? 'down' : bad ? 'degraded' : 'online';
      apps.push({
        account: this.account, name, source: 'cloudflare', cfKind: 'worker', status,
        substate: w.silent ? 'sus relojes no corren' : bad ? 'falla más de la mitad de las veces' : w.crons.length ? 'con reloj' : 'activo',
        instances: 1, online: status === 'down' ? 0 : 1, cpu: 0, mem: 0, uptime: w.modified ? (this.now() - w.modified) / 1000 : 0,
        deployments: [], domains: [], repo: null, crons: w.crons.slice(0, 6), every: w.every || 0, runs: w.runs, runErrors: w.errors, lastRun: w.last || 0, silent: !!w.silent,
        cfReqMin: 0, restartsTotal: 0,
      });
    }
    this.apps = apps.sort((a, b) => a.name.localeCompare(b.name));
  }

  info() {
    return { id: this.conn.id, type: 'cloudflare', label: this.label, account: this.account, error: this.error, lastOk: this.lastOk, projects: this.projects.size + [...this.workers.keys()].filter(n => !this.projects.has(n)).length,
      pages: this.projects.size, workers: this.workers.size, zones: this.zones.length, warn: Object.entries(this.warn).filter(([k]) => k !== 'account').map(([, v]) => v), accountName: this.accountName, accounts: this.accounts || 0 };
  }
  // para la ficha del distrito: las visitas de cada zona
  trafficOf() { return this.zones.map(z => ({ zone: z.name, ...(this.traffic.get(z.name) || {}) })).filter(x => x.day); }
}

// antes de guardar el conector: el token debe ver una cuenta
async function verify(token, accountId, fetchFn) {
  token = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{30,120}$/.test(token)) throw new Error('Ese no parece un token de API de Cloudflare');
  const c = new CloudflareConnector({ id: 'x', token, accountId: accountId || undefined }, { emit() { } }, fetchFn ? { fetch: fetchFn } : {});
  try { await c.pollAccount(); } catch (e) { throw new Error(e.denied ? 'Cloudflare rechazó el token. Revise que esté activo y que tenga permisos de lectura sobre la cuenta.' : e.message); }
  return { accountId: c.accountId, accountName: c.accountName, accounts: c.accounts };
}

module.exports = { CloudflareConnector, cronEvery, deployState, verify };
