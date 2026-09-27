'use strict';
// Credenciales de conectores de nube (Vercel, Supabase) y tokens de equipos remotos de Claude Code.
// Viven en <stateDir>/connectors.json (600), nunca en config.json ni en el navegador.
// El servicio relee el archivo cuando el CLI lo cambia.
const fs = require('fs');
const crypto = require('crypto');
const { readJSON, writeJSONAtomic } = require('./util');

const SLUG = /^[a-z0-9][a-z0-9-]{0,30}$/;

class Secrets {
  constructor(cfg) {
    this.file = cfg.stateDir + '/connectors.json';
    this.limits = cfg.limits || {}; // Atalaya Cloud: lo que permite el plan del cliente
    this.mtime = -1;
    this.data = { connectors: {}, remotes: {}, agents: {} };
    this.sync();
  }
  sync() {
    let m = 0; try { m = fs.statSync(this.file).mtimeMs; } catch { }
    if (m === this.mtime) return false;
    this.mtime = m;
    const d = readJSON(this.file, {}) || {};
    this.data = { connectors: d.connectors || {}, remotes: d.remotes || {}, agents: d.agents || {} };
    return true;
  }
  save() { writeJSONAtomic(this.file, this.data, 0o600); }
  // tope del plan (Atalaya Cloud) al dar de alta algo nuevo en una lista; sin tope en las demas ediciones
  checkLimit(kind, id) {
    const max = this.limits[kind], list = this.data[kind] || {};
    if (max == null || Object.prototype.hasOwnProperty.call(list, id) || Object.keys(list).length < max) return;
    const what = { connectors: 'conectores', remotes: 'equipos remotos', agents: 'hostings y sitios WordPress' }[kind];
    throw new Error(`Su plan permite hasta ${max} ${what}. Borre uno o pida un plan mayor.`);
  }

  connectors() { return Object.entries(this.data.connectors).map(([id, c]) => ({ id, ...c })); }
  addConnector(id, c) {
    if (!SLUG.test(id)) throw new Error('Nombre invalido: minusculas, numeros y guiones (hasta 31)');
    this.checkLimit('connectors', id);
    this.data.connectors[id] = { ...c, added: new Date().toISOString() };
    this.save();
  }
  delConnector(id) { if (!this.data.connectors[id]) throw new Error('No existe ese conector'); delete this.data.connectors[id]; this.save(); }

  // equipos remotos (laptops) que envian hooks de Claude Code por HTTPS: se guarda solo el sha256 del token
  addRemote(name) {
    if (!SLUG.test(name)) throw new Error('Nombre invalido: minusculas, numeros y guiones (hasta 31)');
    this.checkLimit('remotes', name);
    const token = crypto.randomBytes(32).toString('base64url');
    this.data.remotes[name] = { sha: crypto.createHash('sha256').update(token).digest('hex'), added: new Date().toISOString() };
    this.save();
    return token;
  }
  delRemote(name) { if (!this.data.remotes[name]) throw new Error('No existe ese equipo'); delete this.data.remotes[name]; this.save(); }
  remotes() { return Object.keys(this.data.remotes); }
  // "equipo:token" -> nombre del equipo o null (comparacion en tiempo constante)
  checkRemote(header) {
    this.sync();
    const h = String(header || ''), i = h.indexOf(':');
    if (i < 1) return null;
    const name = h.slice(0, i), token = h.slice(i + 1);
    const r = Object.prototype.hasOwnProperty.call(this.data.remotes, name) ? this.data.remotes[name] : null;
    if (!r || token.length < 32) return null;
    const got = crypto.createHash('sha256').update(token).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(r.sha)) ? name : null;
  }
}

module.exports = { Secrets, SLUG };
