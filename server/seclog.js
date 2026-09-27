'use strict';
// Registro de seguridad: cada episodio (vigilancia, carcel, puerta trasera, cuarentena, alguien la busco, ruta
// expuesta) queda en <stateDir>/seguridad.jsonl, una linea por evento, para armar el expediente de cada preso y el
// historial de cada sitio. Se rota al pasar 5 MB (queda un .1). Solo datos del propio servidor.
const fs = require('fs');
const path = require('path');

const KEEP = ['watch', 'defense', 'phpfile', 'login'];
const MAX = 5 * 1024 * 1024;

class SecLog {
  constructor(cfg, bus) {
    this.file = path.join(cfg.stateDir, 'seguridad.jsonl');
    if (bus) bus.on('ev', e => { try { this.onEvent(e); } catch (err) { console.error('[seguridad]', err.message); } });
  }
  onEvent(e) {
    if (e.late) return;
    const keep = KEEP.includes(e.kind) || (e.kind === 'probe' && e.exposed);
    if (!keep) return;
    const rec = { t: Date.now(), kind: e.kind, action: e.action || null, reason: e.reason || null, ip: e.ip || null, by: e.by || null, n: e.n || null,
      account: e.account || null, site: e.site || null, app: e.app || null, domain: e.domain || null, path: e.path || null, why: e.why || null, status: e.status || null, hours: e.hours || null, user: e.user || null, service: e.service || null };
    this.append(rec);
  }
  append(rec) {
    try {
      const st = fs.statSync(this.file);
      if (st.size > MAX) fs.renameSync(this.file, this.file + '.1');
    } catch { }
    try { fs.appendFileSync(this.file, JSON.stringify(rec) + '\n', { mode: 0o600 }); } catch (e) { console.error('[seguridad]', e.message); }
  }
  // lo que coincide con un filtro, de lo mas nuevo a lo mas viejo (se leen el archivo actual y el rotado)
  find(fn, limit = 200) {
    const out = [];
    for (const f of [this.file, this.file + '.1']) {
      let txt = ''; try { txt = fs.readFileSync(f, 'utf8'); } catch { continue; }
      const lines = txt.split('\n');
      for (let i = lines.length - 1; i >= 0 && out.length < limit; i--) {
        if (!lines[i]) continue;
        let r; try { r = JSON.parse(lines[i]); } catch { continue; }
        if (fn(r)) out.push(r);
      }
      if (out.length >= limit) break;
    }
    return out;
  }
  ofIp(ip, limit) { return this.find(r => r.ip === ip, limit); }
  ofSite(site, limit) { return this.find(r => r.site === site, limit); }
}

module.exports = { SecLog };
