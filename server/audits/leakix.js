'use strict';
// Buscadores de filtraciones: una vez al dia se consulta LeakIX (leakix.net) por la IP del servidor y sus
// dominios. LeakIX recorre internet buscando .git, .env, paneles y servicios mal configurados y los publica;
// si el servidor aparece ahi, cualquiera puede verlo. Requiere una clave gratuita de LeakIX (conector
// «leakix» en el asistente). Solo lectura: se guardan el tipo, el nombre y las fechas de cada hallazgo, nunca
// el contenido filtrado (puede traer claves).
const fs = require('fs');
const path = require('path');
const https = require('https');
const { readJSON, writeJSONAtomic } = require('../util');
const { publicIPv4 } = require('./exposure');
const { registrable } = require('./web');

const API = process.env.ATALAYA_LEAKIX_API || 'https://leakix.net';
const PLUGIN_LABEL = {
  GitConfigHttpPlugin: 'Repositorio .git expuesto', DotEnvConfigPlugin: 'Archivo .env expuesto', PhpInfoHttpPlugin: 'phpinfo() a la vista',
  ApacheStatusHttpPlugin: 'server-status de Apache a la vista', DirectoryListingPlugin: 'Listado de carpetas abierto', MysqlOpenPlugin: 'MySQL abierto a internet',
  ElasticSearchOpenPlugin: 'Elasticsearch abierto', MongoOpenPlugin: 'MongoDB abierto', RedisOpenPlugin: 'Redis abierto', SSHOpenPlugin: 'SSH',
};

function get(url, key) {
  return new Promise(resolve => {
    const req = (url.startsWith('http:') ? require('http') : https).get(url, { timeout: 20000, headers: { Accept: 'application/json', 'api-key': key, 'User-Agent': 'Atalaya-monitor' } }, res => {
      let b = ''; res.setEncoding('utf8');
      res.on('data', c => { b += c; if (b.length > 8 << 20) req.destroy(); });
      res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { } resolve({ status: res.statusCode, json: j }); });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0 }); });
    req.on('error', () => resolve({ status: 0 }));
  });
}
const wait = ms => new Promise(r => setTimeout(r, process.env.ATALAYA_LEAKIX_API ? 0 : ms));

// eventos de LeakIX -> hallazgos sin contenido
function leaksOf(json) {
  const list = Array.isArray(json) ? json : json ? [...(json.Leaks || json.leaks || []), ...(json.Services || []).filter(s => s.leak && s.leak.severity)] : [];
  return list.filter(e => e && (e.event_source || e.plugin))
    .map(e => ({ plugin: String(e.event_source || e.plugin), host: String(e.host || e.ip || ''), port: Number(e.port) || null,
      url: String((e.http && e.http.url) || ''), time: Date.parse(e.time || e.last_seen || '') || null, severity: String((e.leak && e.leak.severity) || '') }));
}

class LeakixAudit {
  constructor(cfg, secrets, platform) {
    this.cfg = cfg; this.secrets = secrets; this.platform = platform;
    this.file = path.join(cfg.stateDir, 'audits', 'leakix.json');
    this.result = readJSON(this.file, null);
  }
  key() { const c = this.secrets && this.secrets.connectors().find(x => x.type === 'leakix'); return c ? c.apiKey : null; }
  available() { return (this.cfg.edition || 'vps') === 'vps' && !!this.key(); }

  domains() {
    const vh = this.platform && this.platform.panel ? this.platform.panel.vhosts() : [];
    return [...new Set(vh.map(v => registrable(v.servername)).filter(d => d && d.includes('.')))].slice(0, 40);
  }

  async check() {
    const key = this.key();
    if (!key) return null;
    const ip = publicIPv4(this.cfg);
    const found = new Map(); let error = null, asked = 0;
    const add = arr => { for (const l of arr) { const k = l.plugin + '|' + l.host + '|' + l.port; const x = found.get(k); if (!x || (l.time || 0) > (x.time || 0)) found.set(k, l); } };
    const targets = [...(ip ? ['/host/' + ip] : []), ...this.domains().map(d => '/domain/' + d)];
    for (const t of targets) {
      const r = await get(API + t, key);
      asked++;
      if (r.status === 401 || r.status === 403) { error = 'La clave de LeakIX no es válida'; break; }
      if (r.status === 429) { error = 'LeakIX pidió esperar (demasiadas consultas)'; break; }
      if (r.status === 200) add(leaksOf(r.json));
      await wait(1500);
    }
    this.result = { t: Date.now(), ip, asked, leaks: [...found.values()].sort((a, b) => (b.time || 0) - (a.time || 0)), error };
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeJSONAtomic(this.file, this.result); } catch { }
    return this.result;
  }

  start() {
    setTimeout(() => { if (this.available()) this.check().catch(() => { }); }, 150000).unref();
    setInterval(() => { if (this.available()) this.check().catch(() => { }); }, 24 * 3600000).unref();
  }

  section() {
    const r = this.result;
    if (!this.key()) return null;
    if (!r) return { id: 'leakix', title: 'Buscadores de filtraciones', icon: 'search', status: 'unknown', items: [{ label: 'Estado', value: 'primera consulta en curso' }], findings: [] };
    if (r.error) return { id: 'leakix', title: 'Buscadores de filtraciones', icon: 'search', status: 'unknown', items: [{ label: 'Estado', value: r.error }], findings: [] };
    const recent = Date.now() - 30 * 86400000;
    const byPlugin = new Map();
    for (const l of r.leaks) { const x = byPlugin.get(l.plugin) || { plugin: l.plugin, hosts: new Set(), last: 0 }; x.hosts.add(l.host); x.last = Math.max(x.last, l.time || 0); byPlugin.set(l.plugin, x); }
    const f = [...byPlugin.values()].map(x => ({ sev: x.last > recent ? 'bad' : 'warn', title: `${PLUGIN_LABEL[x.plugin] || x.plugin}: publicado en LeakIX`,
      detail: `Visto por ${x.hosts.size} nombre(s)${x.last ? `, la última vez el ${new Date(x.last).toLocaleDateString('es-VE')}` : ''}. Cualquiera puede verlo en leakix.net.`,
      fix: 'Corrija la causa (vea «Archivos expuestos»), cambie las claves que pudieran estar en lo filtrado y pida la baja escribiendo a blacklist@leakix.net.',
      names: [...x.hosts] }));
    const status = f.some(x => x.sev === 'bad') ? 'bad' : f.length ? 'warn' : 'ok';
    return { id: 'leakix', title: 'Buscadores de filtraciones', icon: 'search', status, findings: f,
      items: [{ label: 'Consultas', value: String(r.asked) }, { label: 'Hallazgos publicados', value: String(r.leaks.length) }] };
  }
}

module.exports = { LeakixAudit, leaksOf };
