'use strict';
// Pais de una IP con la base GeoLite2-Country (formato MMDB) que Imunify360 mantiene al dia.
// Lector MMDB propio y minimo: sin dependencias, solo lo necesario para leer el pais.
const fs = require('fs');
const net = require('net');

const MARKER = Buffer.from('abcdef4d61784d696e642e636f6d', 'hex'); // \xAB\xCD\xEF MaxMind.com

class Mmdb {
  constructor(buf) {
    this.buf = buf;
    const at = buf.lastIndexOf(MARKER);
    if (at < 0) throw new Error('MMDB sin metadatos');
    const metaStart = at + MARKER.length;
    this.meta = this.decode(metaStart, metaStart)[0];
    this.nodeCount = this.meta.node_count;
    this.recordSize = this.meta.record_size;
    this.nodeBytes = this.recordSize * 2 / 8;
    this.treeSize = this.nodeBytes * this.nodeCount;
    this.dataStart = this.treeSize + 16;
    // en arboles IPv6 las IPv4 cuelgan de ::/96
    this.v4Start = 0;
    if (this.meta.ip_version === 6) for (let i = 0; i < 96 && this.v4Start < this.nodeCount; i++) this.v4Start = this.record(this.v4Start, 0);
  }

  record(node, bit) {
    const b = this.buf, o = node * this.nodeBytes;
    if (this.recordSize === 24) return bit ? b.readUIntBE(o + 3, 3) : b.readUIntBE(o, 3);
    if (this.recordSize === 28) return bit ? ((b[o + 3] & 0x0f) << 24) | b.readUIntBE(o + 4, 3) : ((b[o + 3] & 0xf0) << 20) | b.readUIntBE(o, 3);
    return bit ? b.readUInt32BE(o + 4) : b.readUInt32BE(o);
  }

  // decodifica el dato en `off`; base = inicio de la seccion para resolver punteros
  decode(off, base) {
    const b = this.buf;
    const ctrl = b[off++];
    let type = ctrl >> 5;
    if (type === 1) { // puntero
      const ss = (ctrl >> 3) & 3, v = ctrl & 7;
      let p;
      if (ss === 0) { p = (v << 8) | b[off]; off += 1; }
      else if (ss === 1) { p = ((v << 16) | b.readUInt16BE(off)) + 2048; off += 2; }
      else if (ss === 2) { p = ((v << 24) | b.readUIntBE(off, 3)) + 526336; off += 3; }
      else { p = b.readUInt32BE(off); off += 4; }
      return [this.decode(base + p, base)[0], off];
    }
    if (type === 0) type = 7 + b[off++];
    let size = ctrl & 0x1f;
    if (size === 29) size = 29 + b[off++];
    else if (size === 30) { size = 285 + b.readUInt16BE(off); off += 2; }
    else if (size === 31) { size = 65821 + b.readUIntBE(off, 3); off += 3; }
    switch (type) {
      case 2: return [b.toString('utf8', off, off + size), off + size];
      case 3: return [b.readDoubleBE(off), off + 8];
      case 4: return [b.subarray(off, off + size), off + size];
      case 5: case 6: case 9: case 10: {
        let n = 0; for (let i = 0; i < size; i++) n = n * 256 + b[off + i];
        return [n, off + size];
      }
      case 8: return [size ? b.readIntBE(off, size) : 0, off + size];
      case 7: {
        const m = {};
        for (let i = 0; i < size; i++) {
          const [k, o1] = this.decode(off, base); const [v, o2] = this.decode(o1, base);
          m[k] = v; off = o2;
        }
        return [m, off];
      }
      case 11: {
        const a = [];
        for (let i = 0; i < size; i++) { const [v, o] = this.decode(off, base); a.push(v); off = o; }
        return [a, off];
      }
      case 14: return [size !== 0, off];
      case 15: return [b.readFloatBE(off), off + 4];
      default: return [null, off + size];
    }
  }

  lookup(ip) {
    let bits, node;
    if (net.isIPv4(ip)) { bits = ip.split('.').flatMap(x => byteBits(Number(x))); node = this.v4Start; }
    else if (net.isIPv6(ip)) { bits = expand6(ip).flatMap(byteBits); node = 0; }
    else return null;
    for (let i = 0; i < bits.length && node < this.nodeCount; i++) node = this.record(node, bits[i]);
    if (node === this.nodeCount || node < this.nodeCount) return null;
    return this.decode(this.treeSize + (node - this.nodeCount), this.dataStart)[0];
  }
}

function byteBits(n) { const r = []; for (let i = 7; i >= 0; i--) r.push((n >> i) & 1); return r; }
function expand6(ip) {
  const [head, tail] = ip.split('::');
  const h = head ? head.split(':') : [], t = tail != null && tail !== '' ? tail.split(':') : [];
  const groups = [...h, ...Array(8 - h.length - t.length).fill('0'), ...t];
  return groups.flatMap(g => { const n = parseInt(g || '0', 16); return [n >> 8, n & 255]; });
}

// Busca la base mas reciente de Imunify360 (se renueva sola) o la indicada en config
class Geo {
  constructor(cfg) {
    this.cfg = cfg;
    this.cache = new Map();
    this.db = null;
    this.load();
    setInterval(() => this.load(), 6 * 3600000).unref();
  }
  findDb() {
    if (this.cfg.geoipPath) return this.cfg.geoipPath;
    const base = '/var/imunify360/files/geo';
    let dirs = [];
    try { dirs = fs.readdirSync(base).sort(); } catch { return null; }
    for (let i = dirs.length - 1; i >= 0; i--) {
      const f = `${base}/${dirs[i]}/GeoLite2-Country.mmdb`;
      if (fs.existsSync(f)) return f;
    }
    return null;
  }
  load() {
    const f = this.findDb();
    if (!f || f === this.file) return;
    try { this.db = new Mmdb(fs.readFileSync(f)); this.file = f; this.cache.clear(); console.log(`[geo] base de paises: ${f}`); }
    catch (e) { console.error('[geo] no se pudo cargar', f, e.message); }
  }
  // -> { cc: 'VE', name: 'Venezuela' } o null
  country(ip) {
    if (!this.db || !ip) return null;
    if (this.cache.has(ip)) return this.cache.get(ip);
    let out = null;
    try {
      const r = this.db.lookup(ip);
      const c = r && (r.country || r.registered_country);
      if (c && c.iso_code) out = { cc: c.iso_code, name: (c.names && (c.names.es || c.names.en)) || c.iso_code };
    } catch { out = null; }
    if (this.cache.size > 20000) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(ip, out);
    return out;
  }
}

module.exports = { Geo, Mmdb };
