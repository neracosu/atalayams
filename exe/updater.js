'use strict';
// Atalaya Equipo: actualizacion automatica de la APLICACION (no del ejecutable). El ejecutable es Node mas la
// aplicacion empaquetada; aqui se baja solo la aplicacion nueva, se verifica y queda lista para el proximo
// arranque. Asi no hay que volver a descargar el .zip en cada version, ni reemplazar un .exe en uso.
//
// Una actualizacion automatica es una via para ejecutar codigo en la computadora de la persona, asi que:
//  - el aviso de version viene FIRMADO (ed25519) y la clave publica va dentro del ejecutable, no se baja
//  - el paquete se acepta solo si su tamano y su SHA-256 son los del aviso firmado
//  - nunca se baja a una version anterior ni igual
//  - la firma y la huella se verifican otra vez en cada arranque, antes de usar el paquete
//  - si la version nueva no llega a arrancar, se marca como mala y se vuelve a la que trae el ejecutable
//  - se puede apagar: modo 'off'
// Solo modulos propios de Node: este archivo va dentro del ejecutable (scripts/build-exe.js lo incrusta).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const KIND = 'atalaya-equipo-app';
const LAUNCHER = 1; // lo que este arranque sabe hacer; una aplicacion que pida mas necesita el ejecutable nuevo
const MAX = 64 << 20; // 64 MB: tope del paquete
const verKey = v => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v || '')); return m ? m.slice(1).map(Number) : null; };
const newer = (a, b) => { const x = verKey(a), y = verKey(b); if (!x || !y) return false; for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };
const sha256 = buf => crypto.createHash('sha256').update(buf).digest('hex');

// aviso publicado: { payload: "<json>", sig: "<base64>" }. Devuelve el aviso ya validado o lanza
function verifyManifest(env, pubPem) {
  if (!env || typeof env.payload !== 'string' || typeof env.sig !== 'string' || env.payload.length > 8192) throw new Error('aviso de versión inválido');
  if (!crypto.verify(null, Buffer.from(env.payload, 'utf8'), crypto.createPublicKey(pubPem), Buffer.from(env.sig, 'base64'))) throw new Error('la firma del aviso no es válida');
  const m = JSON.parse(env.payload);
  // la misma clave firma otras cosas (definiciones): el tipo evita que un paquete de otra clase pase por una actualizacion
  if (m.kind !== KIND) throw new Error('el aviso es de otro tipo');
  if (!verKey(m.version) || !/^[0-9a-f]{64}$/.test(String(m.sha256)) || !(m.size > 0 && m.size <= MAX)) throw new Error('aviso de versión incompleto');
  if (!/^app-\d+\.\d+\.\d+\.tgz$/.test(String(m.file)) || m.file !== `app-${m.version}.tgz`) throw new Error('nombre de paquete inválido');
  return m;
}

class Updater {
  // opts: { dir, pub, embedded, base, fetch, now, log }
  constructor(opts) {
    this.dir = opts.dir; this.pub = opts.pub; this.embedded = opts.embedded;
    this.base = String(opts.base || '').replace(/\/+$/, '');
    this.fetch = opts.fetch || ((u, o) => fetch(u, { ...o, signal: AbortSignal.timeout(60000) }));
    this.now = opts.now || (() => Date.now());
    this.log = opts.log || (() => { });
    this.running = opts.embedded;
    fs.mkdirSync(this.dir, { recursive: true });
  }
  file(n) { return path.join(this.dir, n); }
  read(n, d = null) { try { return JSON.parse(fs.readFileSync(this.file(n), 'utf8')); } catch { return d; } }
  write(n, v) { const f = this.file(n); fs.writeFileSync(f + '.tmp', JSON.stringify(v)); fs.renameSync(f + '.tmp', f); }
  mode() { const m = this.read('mode.json', {}); return m && m.mode === 'off' ? 'off' : 'auto'; }
  setMode(m) { this.write('mode.json', { mode: m === 'off' ? 'off' : 'auto' }); this.status({}); return this.mode(); }
  bad() { return new Set(this.read('bad.json', []) || []); }
  markBad(v, why) { const b = this.bad(); b.add(v); this.write('bad.json', [...b].slice(-20)); this.log(`La versión ${v} no arrancó (${why}): se usa la anterior.`); this.status({ error: `La versión ${v} no arrancó: se usa la que trae el ejecutable` }); }
  status(patch) { const s = { ...(this.read('status.json', {}) || {}), ...patch, mode: this.mode(), running: this.running, embedded: this.embedded, launcher: LAUNCHER }; this.write('status.json', s); return s; }

  // el paquete guardado mas nuevo que pase TODAS las verificaciones, o null (se usa el del ejecutable)
  pick() {
    if (!this.pub) return null;
    // un intento anterior que no llego a escuchar: esa version es mala
    const trying = this.read('trying.json', null);
    if (trying && trying.version) { this.markBad(trying.version, 'no llegó a abrir'); try { fs.unlinkSync(this.file('trying.json')); } catch { } }
    if (this.mode() === 'off') return null;
    const bad = this.bad();
    let best = null;
    for (const n of fs.readdirSync(this.dir)) {
      const m = /^app-(\d+\.\d+\.\d+)\.json$/.exec(n); if (!m) continue;
      try {
        const man = verifyManifest(this.read(n), this.pub);
        if (man.version !== m[1] || bad.has(man.version) || !newer(man.version, this.embedded) || (man.launcher || 1) > LAUNCHER) continue;
        if (best && !newer(man.version, best.version)) continue;
        const buf = fs.readFileSync(this.file(man.file));
        if (buf.length !== man.size || sha256(buf) !== man.sha256) throw new Error('el paquete guardado no coincide con su aviso');
        best = { version: man.version, buf, notes: man.notes || '' };
      } catch (e) { this.log(`Se descarta ${n}: ${e.message}`); try { fs.unlinkSync(this.file(n)); } catch { } }
    }
    return best;
  }
  // antes de arrancar una version bajada se deja una marca; se quita cuando el servidor ya escucha
  trying(version) { this.running = version; this.write('trying.json', { version, t: this.now() }); }
  started() { try { fs.unlinkSync(this.file('trying.json')); } catch { } this.status({ started: this.now(), error: null }); this.clean(); }
  // paquetes viejos: se quedan solo el que corre y el que esta listo
  clean() {
    const keep = new Set([this.running, (this.read('status.json', {}) || {}).ready].filter(Boolean));
    for (const n of fs.readdirSync(this.dir)) { const m = /^app-(\d+\.\d+\.\d+)\.(json|tgz)$/.exec(n); if (m && !keep.has(m[1]) && !newer(m[1], this.running)) { try { fs.unlinkSync(this.file(n)); } catch { } } }
  }

  // busca una version nueva y, si la hay, la baja y la deja lista. Devuelve el estado
  async check() {
    if (this.mode() === 'off') return this.status({ checked: this.now() });
    if (!this.pub || !this.base) return this.status({ error: 'Este ejecutable no trae de dónde actualizarse' });
    if (!/^https:\/\//.test(this.base) && !/^http:\/\/127\.0\.0\.1[:/]/.test(this.base)) return this.status({ error: 'La dirección de actualizaciones debe ser https' });
    try {
      const r = await this.fetch(`${this.base}/equipo.json`, { headers: { 'User-Agent': 'Atalaya-Equipo/' + this.running } });
      if (r.status !== 200) throw new Error('el servidor de actualizaciones respondió ' + r.status);
      const env = await r.json(), man = verifyManifest(env, this.pub);
      const st = { checked: this.now(), latest: man.version, error: null };
      if (!newer(man.version, this.running)) return this.status({ ...st, ready: (this.read('status.json', {}) || {}).ready && newer((this.read('status.json', {}) || {}).ready, this.running) ? this.read('status.json').ready : null });
      if ((man.launcher || 1) > LAUNCHER) return this.status({ ...st, needsExe: man.version, ready: null });
      if (this.bad().has(man.version)) return this.status({ ...st, ready: null });
      if (fs.existsSync(this.file(man.file)) && fs.existsSync(this.file(`app-${man.version}.json`))) return this.status({ ...st, ready: man.version, notes: man.notes || '' });
      const p = await this.fetch(`${this.base}/${man.file}`, { headers: { 'User-Agent': 'Atalaya-Equipo/' + this.running } });
      if (p.status !== 200) throw new Error('el paquete respondió ' + p.status);
      const buf = Buffer.from(await p.arrayBuffer());
      if (buf.length !== man.size) throw new Error('el paquete llegó incompleto');
      if (sha256(buf) !== man.sha256) throw new Error('la huella del paquete no coincide con el aviso firmado');
      fs.writeFileSync(this.file(man.file + '.tmp'), buf); fs.renameSync(this.file(man.file + '.tmp'), this.file(man.file));
      this.write(`app-${man.version}.json`, env);
      this.log(`Hay una versión nueva lista: ${man.version}. Se usará la próxima vez que abra Atalaya.`);
      return this.status({ ...st, ready: man.version, notes: man.notes || '', downloaded: this.now() });
    } catch (e) { return this.status({ checked: this.now(), error: 'No se pudo buscar actualizaciones: ' + String(e.message || e).slice(0, 160) }); }
  }
}

module.exports = { Updater, verifyManifest, newer, verKey, sha256, KIND, LAUNCHER };
