'use strict';
// Conectores de nube: se crean, reinician o quitan en caliente segun <stateDir>/connectors.json.
const { VercelConnector } = require('./vercel');
const { SupabaseConnector } = require('./supabase');
const { GithubConnector } = require('./github');
const { CloudflareConnector } = require('./cloudflare');

class Connectors {
  constructor(cfg, bus, secrets, geo) {
    this.cfg = cfg; this.bus = bus; this.secrets = secrets; this.geo = geo;
    this.list = new Map(); // id -> { sig, inst }
    this.apps = [];
  }
  start() {
    this.reconcile();
    // se compara siempre contra lo guardado: otros modulos tambien releen el archivo y se llevaban el aviso de cambio,
    // asi que un conector recien agregado no arrancaba hasta reiniciar
    setInterval(() => { this.secrets.sync(); this.reconcile(); }, 5000);
    setInterval(() => { this.apps = [...this.list.values()].flatMap(x => x.inst.apps); }, 2000);
  }
  // la misma cuenta de Cloudflare conectada dos veces (un token con los proyectos y otro con las visitas) es un solo
  // distrito: manda el que se conecto primero y usa tambien los tokens de los demas
  wanted() {
    const want = new Map(), main = new Map();
    const list = this.secrets.connectors().map((c, i) => ({ c, i })).sort((a, b) => String(a.c.added || '').localeCompare(String(b.c.added || '')) || a.i - b.i);
    for (const { c } of list) {
      const k = c.type === 'cloudflare' && c.accountId ? c.accountId : null, m = k && main.get(k);
      if (m) { if (c.token) m.more.push(c.token); m.merged.push(c.name || c.id); this.mergedInto.set(c.id, m.id); continue; }
      const x = k ? { ...c, more: [], merged: [] } : c;
      if (k) main.set(k, x);
      want.set(c.id, x);
    }
    return want;
  }
  reconcile() {
    this.mergedInto = new Map(); // conector sumado a otro -> el que manda
    const want = this.wanted();
    for (const [id, x] of this.list) {
      const c = want.get(id);
      if (!c || JSON.stringify(c) !== x.sig) { x.inst.stop(); this.list.delete(id); }
    }
    for (const [id, c] of want) {
      if (this.list.has(id)) continue;
      const inst = c.type === 'vercel' ? new VercelConnector(c, this.bus, this.geo) : c.type === 'supabase' ? new SupabaseConnector(c, this.bus) : c.type === 'github' ? new GithubConnector(c) : c.type === 'cloudflare' ? new CloudflareConnector(c, this.bus) : null;
      if (!inst) continue;
      inst.start();
      this.list.set(id, { sig: JSON.stringify(c), inst });
    }
  }
  // distritos virtuales: uno por conector
  virtual() { return [...this.list.values()].filter(({ inst }) => inst.account).map(({ inst }) => ({ id: inst.account, label: inst.label, publicLabel: inst.label.split(' · ')[0] })); }
  ofType(type) { return [...this.list.values()].map(x => x.inst).filter(i => i.info().type === type); }
  drain(id, raw, headers) {
    const x = this.list.get(id);
    if (!x || !x.inst.drain) return { status: 404, error: 'conector desconocido' };
    return x.inst.drain(raw, headers);
  }
  infos() { return [...this.list.values()].map(x => x.inst.info()); }
  // si esa cuenta de Cloudflare ya esta conectada, con que conector
  sameAccount(type, accountId, except) { const c = this.secrets.connectors().find(x => x.type === type && x.accountId && x.accountId === accountId && x.id !== except); return c ? { id: c.id, name: c.name || c.id } : null; }
  byAccount(account) { return [...this.list.values()].map(x => x.inst).find(i => i.account === account) || null; }
}

module.exports = { Connectors };
