'use strict';
// Vercel: proyectos como edificios, despliegues (en construccion, listo, fallo) y visitas en vivo por Drains.
// API REST con token (solo lectura). Las visitas llegan por POST firmado (HMAC-SHA1, x-vercel-signature).
const https = require('https');
const crypto = require('crypto');
const { parseUA } = require('../ua');

const API = process.env.ATALAYA_VERCEL_API || 'https://api.vercel.com';

function get(url, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? require('http') : https;
    const req = mod.request(u, { method: 'GET', timeout: 10000, headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'Atalaya' } }, res => {
      let d = ''; res.setEncoding('utf8');
      res.on('data', c => { d += c; if (d.length > 16 << 20) req.destroy(); });
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Vercel ${res.statusCode}: ${d.slice(0, 120)}`));
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject); req.end();
  });
}

const STATE = s => ({ READY: 'online', ERROR: 'down', CANCELED: 'down', BUILDING: 'degraded', QUEUED: 'degraded', INITIALIZING: 'degraded' }[s] || 'online');
const DEPLOY_ACTION = { BUILDING: 'building', QUEUED: 'building', INITIALIZING: 'building', READY: 'ready', ERROR: 'error', CANCELED: 'canceled' };

class VercelConnector {
  // conn: { id, name, token, teamId, drainSecret }
  constructor(conn, bus, geo) {
    this.conn = conn; this.bus = bus; this.geo = geo;
    this.account = '_vercel-' + conn.id;
    this.label = 'Vercel · ' + (conn.name || conn.id);
    this.apps = [];
    this.projects = new Map(); // id -> proyecto
    this.deployments = new Map(); // projectId -> [despliegues recientes]
    this.domains = new Map(); // projectId -> [dominios]
    this.states = new Map(); // uid -> estado conocido
    this.bucket = new Map(); // nombre de proyecto -> visitas del minuto
    this.lastMinute = new Map();
    this.seenReq = new Set(); // requestId ya contados (un request trae varias lineas)
    this.error = null; this.lastOk = 0; this.drainAt = 0;
    this.timers = [];
  }

  q(path) {
    const sep = path.includes('?') ? '&' : '?';
    return `${API}${path}${this.conn.teamId ? `${sep}teamId=${encodeURIComponent(this.conn.teamId)}` : ''}`;
  }

  start() {
    const run = async fn => { try { await fn(); this.error = null; this.lastOk = Date.now(); } catch (e) { this.error = e.message; } this.build(); };
    run(() => this.pollProjects()).then(() => run(() => this.pollDeployments())).then(() => run(() => this.pollDomains()));
    this.timers.push(setInterval(() => run(() => this.pollProjects()), 120000));
    this.timers.push(setInterval(() => run(() => this.pollDeployments()), 20000));
    this.timers.push(setInterval(() => run(() => this.pollDomains()), 600000));
    this.timers.push(setInterval(() => { this.lastMinute = this.bucket; this.bucket = new Map(); this.build(); }, 60000));
  }
  stop() { for (const t of this.timers) clearInterval(t); this.timers = []; }

  async pollProjects() {
    const r = await get(this.q('/v9/projects?limit=100'), this.conn.token);
    const list = r.projects || [];
    this.projects = new Map(list.map(p => [p.id, p]));
  }

  async pollDeployments() {
    const r = await get(this.q('/v6/deployments?limit=60'), this.conn.token);
    const by = new Map();
    for (const d of r.deployments || []) {
      const st = d.state || d.readyState;
      const known = this.states.get(d.uid);
      const proj = this.projects.get(d.projectId) || { name: d.name };
      // un despliegue nuevo o que cambia de estado genera un evento
      if (this.lastOk && known !== st && DEPLOY_ACTION[st] && (known || Date.now() - d.created < 600000)) {
        this.bus.emit('ev', { kind: 'deploy', account: this.account, app: proj.name, action: DEPLOY_ACTION[st], target: d.target || 'preview',
          url: d.url, branch: d.meta && d.meta.githubCommitRef, commit: d.meta && d.meta.githubCommitMessage, creator: d.creator && d.creator.username });
      }
      this.states.set(d.uid, st);
      const arr = by.get(d.projectId) || [];
      if (arr.length < 8) arr.push({ uid: d.uid, url: d.url, state: st, target: d.target || 'preview', created: d.created, ready: d.ready,
        branch: d.meta && d.meta.githubCommitRef, commit: d.meta && d.meta.githubCommitMessage, creator: d.creator && d.creator.username });
      by.set(d.projectId, arr);
    }
    this.deployments = by;
    if (this.states.size > 2000) this.states = new Map([...this.states].slice(-1000));
  }

  async pollDomains() {
    for (const id of this.projects.keys()) {
      try { const r = await get(this.q(`/v9/projects/${id}/domains?limit=20`), this.conn.token); this.domains.set(id, (r.domains || []).map(x => x.name)); }
      catch { /* sin permiso o proyecto borrado */ }
    }
  }

  // un edificio por proyecto; el estado sale del ultimo despliegue de produccion (o del mas reciente)
  build() {
    this.apps = [...this.projects.values()].map(p => {
      const deps = this.deployments.get(p.id) || [];
      const prod = deps.find(d => d.target === 'production') || deps[0];
      const building = deps.find(d => ['BUILDING', 'QUEUED', 'INITIALIZING'].includes(d.state));
      const status = building ? 'degraded' : prod ? STATE(prod.state) : 'online';
      return {
        account: this.account, name: p.name, source: 'vercel', status, substate: building ? 'desplegando' : prod ? prod.state.toLowerCase() : 'sin despliegues',
        instances: 1, online: status === 'down' ? 0 : 1, cpu: 0, mem: 0, uptime: prod && prod.ready ? (Date.now() - prod.ready) / 1000 : 0,
        framework: p.framework || '', projectId: p.id, deployments: deps, domains: this.domains.get(p.id) || [],
        repo: p.link && p.link.type === 'github' && p.link.org && p.link.repo ? `${p.link.org}/${p.link.repo}` : null,
        reqMin: this.lastMinute.get(p.name) || 0, restartsTotal: 0,
      };
    });
  }

  // POST de un Drain: verifica la firma y convierte cada request en una visita
  drain(raw, headers) {
    if (this.conn.drainSecret) {
      const want = crypto.createHmac('sha1', this.conn.drainSecret).update(raw).digest('hex');
      const got = String(headers['x-vercel-signature'] || '');
      if (got.length !== want.length || !crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want))) return { status: 403, error: 'firma invalida' };
    }
    const text = raw.toString('utf8').trim();
    let items;
    try { items = text.startsWith('[') ? JSON.parse(text) : text.split('\n').filter(Boolean).map(l => JSON.parse(l)); }
    catch { return { status: 400, error: 'formato invalido' }; }
    this.drainAt = Date.now();
    let n = 0;
    for (const it of items) {
      const px = it.proxy;
      if (!px) continue; // lineas de build o de logs de funciones sin request
      const rid = it.requestId || px.vercelId || it.id;
      if (rid && this.seenReq.has(rid)) continue;
      if (rid) { this.seenReq.add(rid); if (this.seenReq.size > 5000) this.seenReq.delete(this.seenReq.values().next().value); }
      const proj = [...this.projects.values()].find(p => p.id === it.projectId);
      const app = (proj && proj.name) || it.projectName || null;
      const ip = px.clientIp || '';
      const geo = this.geo && ip ? this.geo.country(ip) : null;
      const ua = parseUA((px.userAgent || [])[0]);
      let refHost = '';
      if (px.referer) { try { refHost = new URL(px.referer.includes('://') ? px.referer : 'https://' + px.referer).hostname.replace(/^www\./, ''); } catch { } }
      const status = Number(px.statusCode > 0 ? px.statusCode : it.statusCode) || 200;
      if (app) this.bucket.set(app, (this.bucket.get(app) || 0) + 1);
      this.bus.emit('ev', { kind: 'http', account: this.account, app, domain: px.host, status, method: px.method, path: String(px.path || '').slice(0, 160),
        ip, bot: ua.bot, ua, cc: geo ? geo.cc : null, country: geo ? geo.name : null, ref: px.referer || '', refHost, bytes: px.responseByteSize || 0,
        cache: px.vercelCache, region: px.region, via: 'vercel' });
      n++;
    }
    return { status: 200, n };
  }

  info() { return { id: this.conn.id, type: 'vercel', label: this.label, account: this.account, error: this.error, lastOk: this.lastOk, drainAt: this.drainAt, projects: this.projects.size }; }
}

module.exports = { VercelConnector };
