'use strict';
// Utilidades compartidas: lectura segura, tail de archivos y buffers circulares
const fs = require('fs');
const fsp = fs.promises;

function readText(path, fallback = null) {
  try { return fs.readFileSync(path, 'utf8'); } catch { return fallback; }
}

function readJSON(path, fallback = null) {
  const t = readText(path);
  if (t == null) return fallback;
  try { return JSON.parse(t); } catch { return fallback; }
}

function writeJSONAtomic(path, obj, mode = 0o600) {
  const tmp = path + '.tmp' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2), { mode });
  fs.renameSync(tmp, path);
}

function listDir(path) {
  try { return fs.readdirSync(path); } catch { return []; }
}

function statSafe(path) {
  try { return fs.statSync(path); } catch { return null; }
}

// Sigue un archivo de texto que crece (como tail -F), soporta rotacion y truncado
class Tailer {
  // guard(lstat): si devuelve false no se lee (ej. enlace simbolico o dueno equivocado)
  // backfill: al abrir, empezar esa cantidad de bytes antes del final (para recuperar lo reciente)
  constructor(path, onLine, { fromEnd = true, maxChunk = 1 << 20, guard = null, backfill = 0 } = {}) {
    this.guard = guard; this.backfill = backfill;
    this.path = path;
    this.onLine = onLine;
    this.pos = null;
    this.ino = null;
    this.fromEnd = fromEnd;
    this.maxChunk = maxChunk;
    this.partial = '';
    this.busy = false;
  }

  async poll() {
    if (this.busy) return;
    this.busy = true;
    try {
      let st;
      try { st = await (this.guard ? fsp.lstat(this.path) : fsp.stat(this.path)); } catch { this.pos = null; return; }
      if (this.guard && !this.guard(st)) return;
      if (this.pos === null) {
        this.ino = st.ino;
        this.pos = this.fromEnd ? Math.max(0, st.size - this.backfill) : 0;
        this.skipFirst = this.fromEnd && this.pos > 0; // la primera linea quedo cortada
        this.fromEnd = false; // tras rotar se lee desde el inicio
        if (this.pos === st.size) return;
      }
      if (st.ino !== this.ino || st.size < this.pos) { this.ino = st.ino; this.pos = 0; this.partial = ''; }
      if (st.size === this.pos) return;
      let start = this.pos;
      if (st.size - start > this.maxChunk) { start = st.size - this.maxChunk; this.partial = ''; }
      const len = st.size - start;
      const fh = await fsp.open(this.path, this.guard ? fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW : 'r');
      try {
        const buf = Buffer.alloc(len);
        await fh.read(buf, 0, len, start);
        this.pos = st.size;
        const text = this.partial + buf.toString('utf8');
        const lines = text.split('\n');
        this.partial = lines.pop();
        if (this.skipFirst) { lines.shift(); this.skipFirst = false; }
        for (const l of lines) if (l) { try { this.onLine(l); } catch (e) { /* linea mala, se ignora */ } }
      } finally { await fh.close(); }
    } finally { this.busy = false; }
  }
}

// Lee los ultimos bytes de un archivo y devuelve lineas completas
function readTailLines(path, bytes = 256 * 1024) {
  try {
    const st = fs.statSync(path);
    const start = Math.max(0, st.size - bytes);
    const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); // nunca sigue enlaces
    try {
      const buf = Buffer.alloc(st.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const lines = buf.toString('utf8').split('\n');
      if (start > 0) lines.shift();
      return { lines: lines.filter(Boolean), size: st.size, ino: st.ino };
    } finally { fs.closeSync(fd); }
  } catch { return { lines: [], size: 0, ino: null }; }
}

class Ring {
  constructor(n) { this.n = n; this.a = []; }
  push(v) { this.a.push(v); if (this.a.length > this.n) this.a.shift(); }
  toArray() { return this.a.slice(); }
}

// Mapa uid -> usuario desde /etc/passwd
function loadPasswd() {
  const map = new Map();
  for (const line of (readText('/etc/passwd', '') || '').split('\n')) {
    const p = line.split(':');
    if (p.length > 5) map.set(Number(p[2]), { name: p[0], home: p[5] });
  }
  return map;
}

module.exports = { readText, readJSON, writeJSONAtomic, listDir, statSafe, Tailer, readTailLines, Ring, loadPasswd };
