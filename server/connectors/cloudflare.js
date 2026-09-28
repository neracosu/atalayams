'use strict';
// Cloudflare: los proyectos de Pages y los Workers como edificios, sus despliegues, las visitas de cada dominio
// y los relojes (cron) que dejaron de correr. Todo con un token de SOLO LECTURA de la cuenta del cliente.
//  - Pages: proyectos, dominios, repo (GitHub o GitLab) y despliegues (construyendo, listo, fallo)
//  - Workers: cuantas veces corrio cada uno y cuantas fallo (GraphQL, workersInvocationsAdaptive). Un Worker con
//    reloj que deja de correr no da ningun error: simplemente calla. Se compara lo que deberia correr con lo que corrio
//  - Visitas: totales por hora de cada zona (GraphQL, httpRequests1hGroups), sin pegar nada en el sitio
//  - Visitas en vivo: cuantos pedidos recibio cada dominio en cada minuto (GraphQL, httpRequestsAdaptiveGroups).
//    Cloudflare las entrega con poco mas de un minuto de atraso; con eso se mueve el mapa. Son cuentas: no hay IPs
// Permisos del token: Cuenta > Cloudflare Pages: Read, Workers Scripts: Read, Account Analytics: Read;
// Zona > Zone: Read, Analytics: Read. Si falta alguno, esa parte se apaga y el resto sigue.
// La misma cuenta puede traer varios tokens (conn.more): para cada parte se usa el que tenga el permiso.
const API = () => process.env.ATALAYA_CF_API || 'https://api.cloudflare.com/client/v4';
const HOUR = 3600000, MIN = 60000;
const ERR_MAX = 12; // avisos de error que se dibujan por zona en cada minuto
const ERR_KEEP = 60; // errores recientes que se recuerdan de cada edificio (un dia como mucho)
const LIVE_MAX = 45; // visitas que se dibujan por zona en cada minuto; si hubo mas, cada una vale por varias

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
    this.tokens = [...new Set([conn.token, ...(conn.more || [])].filter(Boolean))];
    this.pref = new Map(); // parte de la API -> que token la pudo leer
    this.defer = opts.defer || ((fn, ms) => { const t = setTimeout(() => { this.pending.delete(t); fn(); }, ms); if (t.unref) t.unref(); this.pending.add(t); });
    this.pending = new Set();
    this.hosts = new Map(); // dominio propio de un Worker -> Worker
    this.routes = []; // [{ re, script, len }] rutas de Workers dentro de una zona
    this.liveAt = new Map(); // zona -> ultimo minuto ya repartido
    this.liveMin = new Map(); // edificio -> pedidos del ultimo minuto
    this.liveOk = false;
    this.errs = new Map(); // edificio -> errores recientes del servidor: que ruta fallo, con que codigo y cuando
    this.warn = {}; // parte -> por que no se pudo leer (permiso que falta)
    this.error = null; this.lastOk = 0;
    this.timers = [];
  }

  // prueba con el token que ya sirvio para esa parte y, si Cloudflare lo rechaza, con los demas de la cuenta
  async withToken(key, fn) {
    const first = this.pref.get(key) || 0;
    let err = null;
    for (let i = 0; i < this.tokens.length; i++) {
      const k = (first + i) % this.tokens.length;
      try { const r = await fn(this.tokens[k]); this.pref.set(key, k); return r; }
      catch (e) { err = e; if (!e.denied) throw e; }
    }
    throw err || new Error('sin token');
  }
  async api(p, token) {
    if (!token) return this.withToken(p.split('?')[0].replace(/[0-9a-f]{32}/g, '*').split('/').slice(0, 5).join('/'), t => this.api(p, t));
    const r = await this.fetch(API() + p, { method: 'GET', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } });
    let j = null; try { j = await r.json(); } catch { }
    if (!j || !j.success) {
      const e = (j && j.errors && j.errors[0]) || {};
      const err = new Error(e.code === 10000 || r.status === 401 || r.status === 403 ? 'sin permiso' : e.code === 6003 || /invalid request headers/i.test(e.message || '') ? 'token mal escrito' : e.message || `Cloudflare respondió ${r.status}`);
      err.denied = err.message === 'sin permiso'; err.malformed = err.message === 'token mal escrito'; throw err;
    }
    return j;
  }
  async all(p, max = 10, token) {
    const out = [];
    for (let page = 1; page <= max; page++) {
      const j = await this.api(`${p}${p.includes('?') ? '&' : '?'}page=${page}`, token);
      out.push(...(j.result || []));
      if (!j.result_info || !j.result_info.total_pages || page >= j.result_info.total_pages) break;
    }
    return out;
  }
  async gql(query, key = 'gql', token) {
    if (!token) return this.withToken(key, t => this.gql(query, key, t));
    const r = await this.fetch(API() + '/graphql', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ query }) });
    let j = null; try { j = await r.json(); } catch { }
    if (!j || (j.errors && j.errors.length) || !j.data) {
      const m = (j && j.errors && j.errors[0] && j.errors[0].message) || `Cloudflare respondió ${r.status}`;
      const err = new Error(/auth|permission|not authorized|access/i.test(m) || r.status === 401 || r.status === 403 ? 'sin permiso' : m);
      err.denied = err.message === 'sin permiso'; throw err;
    }
    return j.data;
  }

  start() {
    const NEED = { pages: 'Cloudflare Pages: Read', workers: 'Workers Scripts: Read', runs: 'Account Analytics: Read', zones: 'Zone: Read', traffic: 'Zone › Analytics: Read', live: 'Zone › Analytics: Read' };
    this.part = async (name, fn) => {
      try { await fn(); delete this.warn[name]; this.lastOk = this.now(); this.error = null; }
      catch (e) {
        this.warn[name] = e.denied ? `Al token le falta el permiso «${NEED[name]}»` : e.message; if (name === 'account') this.error = this.warn[name];
        if (name === 'live') { if (e.denied && this.warn.traffic) delete this.warn.live; this.liveOk = false; } // el mismo permiso que las visitas: un solo aviso
      }
      this.build();
    };
    const first = async () => {
      await this.part('account', () => this.pollAccount());
      if (!this.accountId) return;
      await this.part('pages', () => this.pollPages());
      await this.part('workers', () => this.pollWorkers());
      await this.part('runs', () => this.pollRuns());
      await this.part('zones', () => this.pollZones());
      await this.pollHosts();
      await this.part('traffic', () => this.pollTraffic());
      await this.part('live', () => this.pollLive());
    };
    first();
    const every = (ms, name, fn) => this.timers.push(setInterval(() => { if (this.accountId) this.part(name, fn); else first(); }, ms));
    every(60000, 'pages', () => this.pollPages());
    every(30 * 60000, 'workers', () => this.pollWorkers());
    every(5 * 60000, 'runs', () => this.pollRuns());
    every(60 * 60000, 'zones', () => this.pollZones());
    every(10 * 60000, 'traffic', () => this.pollTraffic());
    every(MIN, 'live', () => this.pollLive());
    this.timers.push(setInterval(() => { if (this.accountId) this.pollHosts(); }, 30 * 60000));
  }
  stop() { for (const t of this.timers) clearInterval(t); this.timers = []; for (const t of this.pending) clearTimeout(t); this.pending.clear(); }

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

  // cada token puede ver zonas distintas: se juntan
  async pollZones() {
    const by = new Map();
    let ok = 0, err = null;
    for (const t of this.tokens) {
      try { for (const z of await this.all('/zones?per_page=50', 4, t)) by.set(z.id, { id: z.id, name: z.name }); ok++; }
      catch (e) { err = e; }
    }
    if (!ok) throw err;
    this.zones = [...by.values()].slice(0, 40);
  }

  // a que Worker le toca cada dominio: sus dominios propios y las rutas de cada zona. Es opcional: si el token no lo
  // deja leer, las visitas de esos dominios se cuentan en el distrito pero no se dibujan sobre un edificio
  async pollHosts() {
    try {
      const d = (await this.api(`/accounts/${this.accountId}/workers/domains`)).result || [];
      this.hosts = new Map(d.filter(x => x.hostname && x.service).map(x => [String(x.hostname).toLowerCase(), x.service]));
    } catch { }
    const routes = [];
    for (const z of this.zones) {
      try {
        for (const r of (await this.api(`/zones/${z.id}/workers/routes`)).result || []) {
          const host = String(r.pattern || '').toLowerCase().replace(/^https?:\/\//, '').split('/')[0];
          if (!host || !r.script) continue;
          routes.push({ re: new RegExp('^' + host.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$'), script: r.script, len: host.replace(/\*/g, '').length });
        }
      } catch { }
    }
    if (routes.length || !this.routes.length) this.routes = routes.sort((a, b) => b.len - a.len);
  }

  // el edificio de un dominio: el proyecto de Pages que lo tiene, o el Worker que lo atiende
  appOf(host) {
    const h = String(host || '').toLowerCase();
    for (const p of this.projects.values()) if ([...(p.domains || []), p.subdomain].some(d => String(d || '').toLowerCase() === h)) return p.name;
    const w = this.hosts.get(h) || (this.routes.find(r => r.re.test(h)) || {}).script;
    return w && (this.workers.has(w) || this.projects.has(w)) ? w : null;
  }

  // visitas en vivo: cada minuto que ya cerro se reparte a lo largo del minuto siguiente, para que el mapa se mueva
  // al ritmo real. Si un minuto trajo mas de LIVE_MAX, cada visita dibujada vale por varias (n) y la cuenta no cambia
  async pollLive() {
    if (!this.zones.length) return;
    const now = this.now(), top = Math.floor((now - 90000) / MIN) * MIN; // ultimo minuto cerrado y ya asentado
    const iso = t => new Date(t).toISOString().slice(0, 19) + 'Z';
    let read = 0, lastErr = null;
    const lastMin = new Map();
    for (const z of this.zones) {
      const seen = this.liveAt.get(z.id) || 0, from = Math.max(seen, top - (seen ? 3 : 1) * MIN);
      if (top <= from) { read++; continue; }
      try {
        const d = await this.gql(`{ viewer { zones(filter: {zoneTag: "${z.id}"}) {
          vivo: httpRequestsAdaptiveGroups(limit: 3000, filter: {datetime_geq: "${iso(from + MIN)}", datetime_lt: "${iso(top + MIN)}"}, orderBy: [datetimeMinute_ASC]) {
            count dimensions { datetimeMinute clientRequestHTTPHost edgeResponseStatus clientCountryName } } } } }`, 'live:' + z.id);
        const rows = ((((d.viewer || {}).zones || [])[0] || {}).vivo || []).filter(r => r && r.count > 0 && r.dimensions);
        this.liveAt.set(z.id, top); read++;
        // los errores del servidor se piden aparte, con su ruta: «hubo un error» sin decir cual no le sirve a nadie.
        // Al conectar se lee el ultimo dia (sin avisar de cada uno) para que la ficha tenga que mostrar
        let conDetalle = false;
        try {
          if (!seen) await this.pollErrors(z, now - 24 * HOUR, from + MIN, false);
          if (rows.some(r => r.dimensions.edgeResponseStatus >= 500)) { await this.pollErrors(z, from + MIN, top + MIN, true); conDetalle = true; }
        } catch { /* sin ese detalle, los errores salen como una visita mas en rojo */ }
        const by = new Map(); // edificio (o ninguno) -> sus filas
        for (const r of rows) {
          const app = this.appOf(r.dimensions.clientRequestHTTPHost), k = app || '';
          if (app && Date.parse(r.dimensions.datetimeMinute) === top) lastMin.set(app, (lastMin.get(app) || 0) + r.count);
          if (conDetalle && r.dimensions.edgeResponseStatus >= 500) continue; // ya salieron con su ruta
          by.set(k, [...(by.get(k) || []), r]);
        }
        const total = [...by.values()].flat().reduce((s, r) => s + r.count, 0);
        for (const [k, list] of by) {
          const sum = list.reduce((s, r) => s + r.count, 0), n = total > LIVE_MAX ? Math.max(1, Math.round(sum * LIVE_MAX / total)) : sum;
          list.sort((a, b) => b.count - a.count);
          for (let i = 0; i < n; i++) {
            // la visita i representa el tramo i de los pedidos de ese edificio: asi salen sus paises y sus errores en proporcion
            let at = (i + 0.5) / n * sum, row = list[0];
            for (const r of list) { if (at < r.count) { row = r; break; } at -= r.count; }
            const D = row.dimensions, cc = /^[A-Z]{2}$/.test(D.clientCountryName || '') ? D.clientCountryName : null;
            const ev = { kind: 'http', live: true, via: 'cloudflare', at: now, account: this.account, app: k || null, site: null, domain: D.clientRequestHTTPHost, status: Number(D.edgeResponseStatus) || 0,
              method: '', path: '', ip: null, bot: false, ua: null, cc, country: cc, n: Math.floor(sum / n) + (i < sum % n ? 1 : 0) };
            this.defer(() => this.bus.emit('ev', ev), Math.round((i + Math.random()) / n * 58000));
          }
        }
      } catch (e) { lastErr = e; }
    }
    if (!read && lastErr) throw lastErr;
    this.liveMin = lastMin; this.liveOk = true;
  }

  // Errores del servidor (5xx) de una zona en un tramo: la ruta, el metodo, el codigo que vio el visitante y el que
  // dio el origen (0 = el origen no llego a responder). Se guardan por edificio y, si `avisar`, salen a la pantalla
  async pollErrors(z, from, to, avisar) {
    const iso = t => new Date(t).toISOString().slice(0, 19) + 'Z';
    const d = await this.gql(`{ viewer { zones(filter: {zoneTag: "${z.id}"}) {
      errores: httpRequestsAdaptiveGroups(limit: 300, filter: {datetime_geq: "${iso(from)}", datetime_lt: "${iso(to)}", edgeResponseStatus_geq: 500}, orderBy: [datetimeMinute_DESC]) {
        count dimensions { datetimeMinute clientRequestHTTPHost clientRequestPath clientRequestHTTPMethodName edgeResponseStatus originResponseStatus } } } } }`, 'errors:' + z.id);
    // se piden los mas nuevos primero (si hay mas de 300, se pierden los viejos) y se guardan en orden
    const rows = ((((d.viewer || {}).zones || [])[0] || {}).errores || []).filter(r => r && r.count > 0 && r.dimensions).reverse();
    const now = this.now(), out = [];
    for (const r of rows) {
      const D = r.dimensions, app = this.appOf(D.clientRequestHTTPHost) || '';
      const x = { t: Date.parse(D.datetimeMinute) || now, host: String(D.clientRequestHTTPHost || ''), path: String(D.clientRequestPath || '').slice(0, 160), method: String(D.clientRequestHTTPMethodName || '').slice(0, 8),
        status: Number(D.edgeResponseStatus) || 0, origin: Number(D.originResponseStatus) || 0, n: r.count, app };
      const list = this.errs.get(app) || [];
      const same = list.find(y => y.t === x.t && y.host === x.host && y.path === x.path && y.status === x.status && y.method === x.method);
      if (same) continue; // ese minuto ya se habia leido
      list.push(x); this.errs.set(app, list.filter(y => now - y.t < 24 * HOUR).slice(-ERR_KEEP));
      out.push(x);
    }
    if (!avisar || !out.length) return out.length;
    out.sort((a, b) => b.n - a.n).slice(0, ERR_MAX).forEach((x, i, l) => {
      const ev = { kind: 'http', live: true, via: 'cloudflare', at: now, account: this.account, app: x.app || null, site: null, domain: x.host, status: x.status, origin: x.origin,
        method: x.method, path: x.path, ip: null, bot: false, ua: null, cc: null, country: null, n: x.n };
      this.defer(() => this.bus.emit('ev', ev), Math.round((i + Math.random()) / l.length * 40000));
    });
    return out.length;
  }
  // lo que la ficha de un edificio muestra de sus errores: cuantos, de que codigo y en que rutas
  errorsOf(app) {
    const now = this.now(), list = (this.errs.get(app) || []).filter(x => now - x.t < 24 * HOUR);
    if (!list.length) return null;
    const codes = {};
    for (const x of list) { const k = x.status + '/' + x.origin; codes[k] = (codes[k] || 0) + x.n; }
    return { hour: list.filter(x => now - x.t < HOUR).reduce((s, x) => s + x.n, 0), total: list.reduce((s, x) => s + x.n, 0), last: list[list.length - 1].t,
      codes: Object.entries(codes).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([k, n]) => ({ status: Number(k.split('/')[0]), origin: Number(k.split('/')[1]), n })),
      list: list.slice(-25).reverse() };
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
      // con las visitas en vivo se sabe cuantas son de este proyecto; sin ellas solo se conoce el total de su zona
      const reqMin = this.liveOk ? this.liveMin.get(p.name) || 0 : tr ? tr.reqMin : 0;
      const src = p.source && p.source.config ? p.source : null;
      apps.push({
        account: this.account, name: p.name, source: 'cloudflare', cfKind: 'pages', status, substate: building ? 'desplegando' : prod ? prod.state.toLowerCase() : 'sin despliegues',
        instances: 1, online: status === 'down' ? 0 : 1, cpu: 0, mem: 0, uptime: prod && prod.ready ? (this.now() - prod.ready) / 1000 : 0,
        framework: '', deployments: deps, domains,
        repo: src && src.type === 'github' && src.config.owner && src.config.repo_name ? `${src.config.owner}/${src.config.repo_name}` : null,
        repoHost: src ? src.type : null, zone, traffic: tr || null, cfReqMin: reqMin, restartsTotal: 0, errors: this.errorsOf(p.name),
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
        cfReqMin: this.liveOk ? this.liveMin.get(name) || 0 : 0, restartsTotal: 0, errors: this.errorsOf(name),
      });
    }
    this.apps = apps.sort((a, b) => a.name.localeCompare(b.name));
  }

  info() {
    return { id: this.conn.id, type: 'cloudflare', label: this.label, account: this.account, error: this.error, lastOk: this.lastOk, projects: this.projects.size + [...this.workers.keys()].filter(n => !this.projects.has(n)).length,
      pages: this.projects.size, workers: this.workers.size, zones: this.zones.length, warn: [...new Set(Object.entries(this.warn).filter(([k]) => k !== 'account').map(([, v]) => v))], accountName: this.accountName, accounts: this.accounts || 0,
      live: this.liveOk, merged: this.conn.merged || [] };
  }
  // para la ficha del distrito: las visitas de cada zona
  trafficOf() { return this.zones.map(z => ({ zone: z.name, ...(this.traffic.get(z.name) || {}) })).filter(x => x.day); }
}

// antes de guardar el conector: el token debe ver una cuenta
async function verify(token, accountId, fetchFn) {
  token = String(token || '').trim();
  if (!/^[A-Za-z0-9_-]{30,120}$/.test(token)) throw new Error('Ese no parece un token de API de Cloudflare');
  const c = new CloudflareConnector({ id: 'x', token, accountId: accountId || undefined }, { emit() { } }, fetchFn ? { fetch: fetchFn } : {});
  try { await c.pollAccount(); } catch (e) {
    throw new Error(e.denied ? 'Cloudflare rechazó el token. Revise que esté activo y que tenga permisos de lectura sobre la cuenta.'
      : e.malformed ? 'Cloudflare no reconoció eso como un token de API. Debe ser el token que se crea en su perfil › API Tokens (se muestra una sola vez), no la Global API Key ni el ID de la cuenta. Cópielo completo.' : e.message);
  }
  return { accountId: c.accountId, accountName: c.accountName, accounts: c.accounts };
}

module.exports = { CloudflareConnector, cronEvery, deployState, verify };
