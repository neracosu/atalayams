'use strict';
// Bloqueo en Cloudflare: si los sitios estan detras de Cloudflare, el trafico web llega desde sus nodos y el
// firewall del servidor no frena al atacante. Con un token de la cuenta de Cloudflare del cliente, cada IP que la
// defensa lleva a la carcel se bloquea tambien en la zona de Cloudflare del sitio (IP Access Rules, modo block);
// si el bloqueo es de todo el servidor, en todas las zonas conectadas. Al salir de la carcel, la regla se borra.
// Vive en <stateDir>/cloudflare.json (600): { token, zones: [{ id, name }], on, rules: { ip: [{ zone, id }] } }.
// Permisos del token: Zona > Zone > Read y Zona > Firewall Services > Edit (en las zonas que quiera proteger).
const fs = require('fs');
const path = require('path');
const { readJSON, writeJSONAtomic } = require('./util');

const API = 'https://api.cloudflare.com/client/v4';

class Cloudflare {
  constructor(cfg, bus, opts = {}) {
    this.cfg = cfg;
    this.file = path.join(cfg.stateDir || '.', 'cloudflare.json');
    this.data = readJSON(this.file, null) || {};
    this.data.rules = this.data.rules || {};
    this.fetch = opts.fetch || ((u, o) => fetch(u, { ...o, signal: AbortSignal.timeout(15000) }));
    this.lastError = null;
    if (bus) bus.on('ev', e => {
      if (e.kind !== 'defense' || !this.connected() || this.data.on === false) return;
      const job = e.action === 'block' ? this.block(e.ip, e) : (e.action === 'unblock' || e.action === 'expire') ? this.unblock(e.ip) : null;
      if (job) job.catch(err => { this.lastError = err.message; console.error('[cloudflare]', err.message); });
    });
  }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeJSONAtomic(this.file, this.data, 0o600); } catch (e) { console.error('[cloudflare]', e.message); } }
  connected() { return !!(this.data.token && (this.data.zones || []).length); }

  async api(method, p, body, token = this.data.token) {
    const r = await this.fetch(API + p, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await r.json(); } catch { }
    if (!j || !j.success) {
      const e = (j && j.errors && j.errors[0]) || {};
      const err = new Error(e.code === 10000 || r.status === 401 || r.status === 403 ? 'Cloudflare rechazó el token o le faltan permisos' : e.message || `Cloudflare respondió ${r.status}`);
      err.code = e.code; throw err;
    }
    return j;
  }

  // conectar: el token debe estar activo y ver al menos una zona
  async connect(token) {
    token = String(token || '').trim();
    if (!/^[A-Za-z0-9_-]{30,80}$/.test(token)) throw new Error('Ese no parece un token de API de Cloudflare');
    await this.api('GET', '/user/tokens/verify', null, token);
    const zones = [];
    for (let page = 1; page <= 10; page++) {
      const j = await this.api('GET', `/zones?per_page=50&page=${page}`, null, token);
      for (const z of j.result || []) zones.push({ id: z.id, name: z.name, status: z.status });
      if (!j.result_info || page >= j.result_info.total_pages) break;
    }
    if (!zones.length) throw new Error('El token no ve ninguna zona: dele permiso de lectura (Zone > Zone > Read) sobre sus dominios');
    this.data = { ...this.data, token, zones, on: true, connectedAt: new Date().toISOString() };
    this.lastError = null; this.save();
    console.log(`[cloudflare] conectado: ${zones.length} zona(s)`);
    return this.status();
  }
  disconnect() { this.data = { rules: {} }; this.save(); }
  setOn(on) { this.data.on = !!on; this.save(); return this.status(); }
  status() {
    return { connected: this.connected(), on: this.data.on !== false, zones: (this.data.zones || []).map(z => z.name),
      rules: Object.values(this.data.rules).reduce((n, l) => n + l.length, 0), lastError: this.lastError };
  }
  // la zona de un dominio (o todas si no se sabe de que sitio vino)
  zonesFor(domain) {
    const d = String(domain || '').toLowerCase().replace(/^www\./, '');
    const Z = this.data.zones || [];
    const z = d && Z.find(x => d === x.name || d.endsWith('.' + x.name));
    return z ? [z] : d ? [] : Z;
  }
  // a la carcel tambien en Cloudflare
  async block(ip, e = {}) {
    const zones = this.zonesFor(e.domain).filter(z => !(this.data.rules[ip] || []).some(r => r.zone === z.id));
    if (!zones.length) return 0;
    const until = e.hours ? new Date(Date.now() + e.hours * 3600000).toISOString().slice(0, 16).replace('T', ' ') : '';
    let n = 0;
    for (const z of zones) {
      try {
        const j = await this.api('POST', `/zones/${z.id}/firewall/access_rules/rules`, { mode: 'block', configuration: { target: ip.includes(':') ? 'ip6' : 'ip', value: ip }, notes: `Atalaya · ${e.reason || 'bloqueo'}${until ? ' · hasta ' + until : ''}` });
        (this.data.rules[ip] = this.data.rules[ip] || []).push({ zone: z.id, id: j.result.id }); n++;
      } catch (err) { if (err.code !== 10009) throw err; } // 10009: ya tenia una regla para esa IP
    }
    this.save();
    if (n) console.log(`[cloudflare] ${ip} bloqueada en ${n} zona(s)`);
    return n;
  }
  // sale de la carcel: se borran sus reglas
  async unblock(ip) {
    const list = this.data.rules[ip] || []; if (!list.length) return 0;
    const left = [];
    for (const r of list) { try { await this.api('DELETE', `/zones/${r.zone}/firewall/access_rules/rules/${r.id}`); } catch (err) { if (!/not found|10014/i.test(err.message)) left.push(r); } }
    if (left.length) this.data.rules[ip] = left; else delete this.data.rules[ip];
    this.save();
    console.log(`[cloudflare] ${ip} liberada en ${list.length - left.length} zona(s)`);
    return list.length - left.length;
  }
}

module.exports = { Cloudflare };
