'use strict';
// Cuota de disco, inodos y ancho de banda por cuenta (cPanel). Solo lectura de lo que cPanel ya calcula:
//  - /var/cpanel/repquota.cache: bloques (KB) e inodos usados por usuario, con sus limites blando y duro
//  - /var/cpanel/bandwidth.cache/<cuenta>: bytes transferidos en el mes
//  - /var/cpanel/users/<cuenta>: BWLIMIT (bytes al mes; 0 = ilimitado)
// Una cuenta al 85 % de un limite se marca (en el mapa, una linea bajo su distrito); el detalle va a la ficha.
const fs = require('fs');
const path = require('path');

const WARN = 0.85, BAD = 0.95;
const INODE_HINT = 500000; // sin limite propio, se avisa desde aqui: muchos hostings cortan en 250-500 mil

function readRepquota(file) {
  let txt = ''; try { txt = fs.readFileSync(file, 'utf8'); } catch { return new Map(); }
  const out = new Map();
  for (const l of txt.split('\n')) {
    const m = l.match(/^(\S+)\s+[-+]{2}\s+(\d+)\s+(\d+)\s+(\d+)\s+(?:\S+\s+)?(\d+)\s+(\d+)\s+(\d+)/);
    if (m) out.set(m[1], { used: +m[2] * 1024, soft: +m[3] * 1024, hard: +m[4] * 1024, inodes: +m[5], isoft: +m[6], ihard: +m[7] });
  }
  return out;
}

class QuotaAudit {
  constructor(cfg, opts = {}) {
    this.cfg = cfg;
    this.base = opts.base || '/var/cpanel';
    this.cache = null; this.at = 0;
  }
  available() { return (this.cfg.edition || 'vps') === 'vps' && fs.existsSync(path.join(this.base, 'repquota.cache')); }

  // por cuenta: disco, inodos y ancho de banda con sus limites y porcentajes (se relee cada 5 min)
  read() {
    if (this.cache && Date.now() - this.at < 300000) return this.cache;
    const rq = readRepquota(path.join(this.base, 'repquota.cache'));
    const out = {};
    for (const acc of Object.keys(this.cfg.accounts || {})) {
      const q = rq.get(acc); if (!q) continue;
      let bw = 0, bwLimit = 0;
      try { bw = Number(fs.readFileSync(path.join(this.base, 'bandwidth.cache', acc), 'utf8').trim()) || 0; } catch { }
      try { const m = fs.readFileSync(path.join(this.base, 'users', acc), 'utf8').match(/^BWLIMIT=(\d+)/m); bwLimit = m ? +m[1] : 0; } catch { }
      const diskLimit = q.hard || q.soft, inodeLimit = q.ihard || q.isoft;
      out[acc] = {
        disk: { used: q.used, limit: diskLimit, pct: diskLimit ? q.used / diskLimit : null },
        inodes: { used: q.inodes, limit: inodeLimit, pct: inodeLimit ? q.inodes / inodeLimit : null },
        bw: { used: bw, limit: bwLimit, pct: bwLimit ? bw / bwLimit : null },
      };
    }
    this.cache = out; this.at = Date.now();
    return out;
  }

  // lo que pide atencion de una cuenta (para el mapa): la mas alta de las tres, si pasa del 85 %
  alert(acc) {
    const q = this.read()[acc]; if (!q) return null;
    const c = [['disco', q.disk.pct], ['inodos', q.inodes.pct], ['ancho de banda', q.bw.pct]].filter(x => x[1] != null && x[1] >= WARN).sort((a, b) => b[1] - a[1])[0];
    return c ? { what: c[0], pct: Math.round(c[1] * 100), level: c[1] >= BAD ? 'bad' : 'warn' } : null;
  }

  section() {
    if (!this.available()) return null;
    const all = this.read(), gb = b => (b / 1073741824).toFixed(b >= 1e11 ? 0 : 1) + ' GB', f = [];
    for (const [acc, q] of Object.entries(all)) {
      for (const [what, x, fmt, fix] of [
        ['disco', q.disk, gb, 'Libere espacio (respaldos viejos, logs, cachés) o suba la cuota de la cuenta en WHM › Modify an Account.'],
        ['inodos', q.inodes, n => n.toLocaleString('es-VE'), 'Borre cachés y sesiones viejas (muchos archivos chicos) o suba el límite de inodos.'],
        ['ancho de banda', q.bw, gb, 'Revise en la ficha de sus sitios qué consume (robots, scraping, descargas grandes) o suba el límite en WHM.'],
      ]) {
        if (x.pct == null || x.pct < WARN) continue;
        f.push({ sev: x.pct >= BAD ? 'bad' : 'warn', title: `${acc}: ${what} al ${Math.round(x.pct * 100)} %`, detail: `${fmt(x.used)} de ${fmt(x.limit)}.`, fix, names: [acc] });
      }
      if (!q.inodes.limit && q.inodes.used >= INODE_HINT) f.push({ sev: 'info', title: `${acc}: ${q.inodes.used.toLocaleString('es-VE')} archivos (inodos)`, detail: 'Sin límite en este servidor, pero muchos hostings cortan entre 250 y 500 mil; tantos archivos hacen lentos los respaldos.', fix: 'Busque carpetas de caché, sesiones o node_modules que se puedan limpiar.', names: [acc] });
    }
    const top = Object.entries(all).sort((a, b) => b[1].bw.used - a[1].bw.used)[0];
    const status = f.some(x => x.sev === 'bad') ? 'bad' : f.some(x => x.sev === 'warn') ? 'warn' : 'ok';
    return { id: 'quotas', title: 'Cuotas de las cuentas', icon: 'folder', status, findings: f,
      items: [{ label: 'Cuentas', value: String(Object.keys(all).length) }, ...(top ? [{ label: 'Más tráfico este mes', value: `${top[0]} · ${gb(top[1].bw.used)}` }] : [])] };
  }
}

module.exports = { QuotaAudit, readRepquota };
