'use strict';
// Definiciones: que detecta Atalaya y como empezar a resolverlo (familias de sondeos web, motivos de rebote
// y sus arreglos). Vienen integradas (defs/definiciones.json) y se actualizan solas, como las de un
// antivirus: una vez al dia se baja el ultimo paquete publicado, se verifica su firma ed25519 con la clave
// publica que trae Atalaya (defs/definiciones.pub), se valida (version mas nueva, reglas que compilan) y se
// aplica en caliente. Si algo falla, se siguen usando las que habia. No se envia ningun dato del servidor.
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const { readJSON, writeJSONAtomic } = require('./util');

const ROOT = path.resolve(__dirname, '..');
const BUILTIN = path.join(ROOT, 'defs', 'definiciones.json');
const PUBKEY = path.join(ROOT, 'defs', 'definiciones.pub');
const DEFAULT_URL = 'https://nube.neracosu.com/definiciones/latest.json';

// "2026.09.26.1" -> comparable
const verKey = v => String(v || '0').split('.').map(n => String(Number(n) || 0).padStart(6, '0')).join('.');

// definiciones -> reglas listas para usar (lanza si algo no es valido)
function compile(d) {
  if (!d || d.formato !== 1 || !d.version || !d.web || !d.correo) throw new Error('formato de definiciones desconocido');
  const re = (x, where) => {
    if (!x || typeof x.pattern !== 'string' || x.pattern.length > 4000) throw new Error('regla invalida en ' + where);
    return new RegExp(x.pattern, String(x.flags || '').replace(/[^imsu]/g, ''));
  };
  const webFamilies = d.web.familias.map(f => [String(f.id), String(f.name), re(f, 'web/' + f.id)]);
  const mailRules = d.correo.rebotes.map(r => [String(r.id), String(r.why), re(r, 'correo/' + r.id)]);
  if (!webFamilies.length || !mailRules.length) throw new Error('definiciones vacias');
  return { version: String(d.version), fecha: String(d.fecha || ''), webFamilies, sensitive: new Set(d.web.sensibles || []),
    webFix: { ...(d.web.arreglos || {}) }, mailRules, mailFix: { ...(d.correo.arreglos || {}) } };
}

const DEFAULT = compile(JSON.parse(fs.readFileSync(BUILTIN, 'utf8')));

// paquete publicado: { payload: "<json de las definiciones>", sig: "<firma ed25519 en base64>" }
function verifyEnvelope(env, pubPem) {
  if (!env || typeof env.payload !== 'string' || typeof env.sig !== 'string') throw new Error('paquete sin firma');
  const ok = crypto.verify(null, Buffer.from(env.payload, 'utf8'), crypto.createPublicKey(pubPem), Buffer.from(env.sig, 'base64'));
  if (!ok) throw new Error('la firma no coincide');
  return JSON.parse(env.payload);
}

class Defs extends EventEmitter {
  constructor(cfg = {}) {
    super();
    this.cfg = cfg;
    this.file = cfg.stateDir ? path.join(cfg.stateDir, 'definiciones.json') : null;
    this.pub = fs.existsSync(PUBKEY) ? fs.readFileSync(PUBKEY, 'utf8') : null;
    this.rules = DEFAULT; this.source = 'integradas';
    this.checkedAt = 0; this.error = null;
    // una actualizacion guardada antes (ya verificada), si es mas nueva que las integradas
    try {
      const env = this.file && readJSON(this.file, null);
      if (env && this.pub) { const r = compile(verifyEnvelope(env, this.pub)); if (verKey(r.version) > verKey(DEFAULT.version)) { this.rules = r; this.source = 'actualizadas'; } }
    } catch (e) { this.error = 'guardadas: ' + e.message; }
  }

  info() { return { version: this.rules.version, fecha: this.rules.fecha, source: this.source, checkedAt: this.checkedAt, error: this.error, auto: this.enabled() }; }
  enabled() { return !(this.cfg.defs && this.cfg.defs.updates === false) && !!this.pub; }

  fetch(url) {
    return new Promise((resolve, reject) => {
      const req = https.get(url, { timeout: 15000, lookup: require('./netguard').lookup, headers: { 'User-Agent': 'Atalaya-monitor (definiciones)' } }, res => {
        if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
        let b = ''; res.setEncoding('utf8');
        res.on('data', c => { b += c; if (b.length > 1 << 20) req.destroy(new Error('demasiado grande')); });
        res.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error('respuesta invalida')); } });
      });
      req.on('timeout', () => req.destroy(new Error('sin respuesta')));
      req.on('error', reject);
    });
  }

  // baja el ultimo paquete, lo verifica y, si es mas nuevo, lo aplica y lo guarda
  async update() {
    this.checkedAt = Date.now();
    try {
      const env = await (this.fetcher || (u => this.fetch(u)))((this.cfg.defs && this.cfg.defs.url) || DEFAULT_URL);
      const r = compile(verifyEnvelope(env, this.pub));
      this.error = null;
      if (verKey(r.version) <= verKey(this.rules.version)) return false;
      this.rules = r; this.source = 'actualizadas';
      if (this.file) writeJSONAtomic(this.file, env, 0o600);
      console.log(`[definiciones] actualizadas a ${r.version}`);
      this.emit('change', this.info());
      return true;
    } catch (e) { this.error = e.message; console.log(`[definiciones] no se actualizaron: ${e.message}`); return false; }
  }

  start() {
    if (!this.enabled()) return;
    setTimeout(() => this.update(), 60000 + Math.random() * 60000).unref();
    setInterval(() => this.update(), 24 * 3600000 + Math.random() * 3600000).unref();
  }
}

module.exports = { Defs, DEFAULT, compile, verifyEnvelope, verKey };
