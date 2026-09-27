'use strict';
// Usuarios con PIN de 6 digitos, sesiones por cookie y modo privado por sesion
const crypto = require('crypto');
const fs = require('fs');
const { promisify } = require('util');
const { readJSON, writeJSONAtomic } = require('./util');

const SCRYPT = { N: 16384, r: 8, p: 1 };
const scryptAsync = promisify(crypto.scrypt);
// async: un ataque de fuerza bruta no debe congelar el event loop (ni las pantallas)
const hashPin = async (pin, salt) => (await scryptAsync(pin, salt, 32, SCRYPT)).toString('hex');
const hashPinSync = (pin, salt) => crypto.scryptSync(pin, salt, 32, SCRYPT).toString('hex');
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const PIN_RE = /^\d{6}$/;
const USER_RE = /^[a-z0-9][a-z0-9._-]{1,31}$/i;
const RESERVED = new Set(['__proto__', 'constructor', 'prototype', 'hasownproperty', 'tostring', 'valueof']);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const DUMMY_SALT = '00000000000000000000000000000000';

// reglas de usuario y PIN (tambien las usa el portal de Atalaya Cloud antes de gastar una invitacion)
function checkCredentials(name, pin) {
  if (!USER_RE.test(name) || RESERVED.has(name.toLowerCase())) throw new Error('Usuario invalido (2-32 caracteres: letras, numeros, . _ -)');
  if (!PIN_RE.test(pin)) throw new Error('El PIN debe tener exactamente 6 digitos');
  if (/^(\d)\1{5}$/.test(pin) || '0123456789'.includes(pin) || '9876543210'.includes(pin)) throw new Error('PIN demasiado obvio');
}

class Auth {
  constructor(cfg) {
    this.cfg = cfg;
    this.dir = cfg.stateDir;
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    this.usersFile = this.dir + '/users.json';
    this.sessionsFile = this.dir + '/sessions.json';
    this.revokeFile = this.dir + '/revoke.json'; // el CLI escribe aqui "sesiones anteriores a X quedan revocadas"
    this.users = this.loadUsers();
    this.sessions = new Map(Object.entries(readJSON(this.sessionsFile, {}) || {})); // sha(token) -> sesion
    this.fails = new Map(); // clave -> { n, until, at }
    this.saveTimer = null;
    this.revokeBefore = 0;
    this.syncRevoke();
    // el registro de fallos no debe crecer sin limite (un usuario o IP inventado por intento)
    setInterval(() => {
      const now = Date.now();
      for (const [k, f] of this.fails) if (f.until < now && now - f.at > 30 * 60000) this.fails.delete(k);
    }, 5 * 60000).unref();
  }

  // objeto sin prototipo: "constructor" o "__proto__" no resuelven a nada
  loadUsers() { return Object.assign(Object.create(null), readJSON(this.usersFile, {}) || {}); }
  userOf(name) { const k = String(name || '').toLowerCase(); return own(this.users, k) ? this.users[k] : null; }
  reloadUsers() { this.users = this.loadUsers(); }
  // relee users.json si el CLI lo modifico (alta, baja o cambio de PIN)
  syncUsers() {
    let m = 0; try { m = fs.statSync(this.usersFile).mtimeMs; } catch { }
    if (m !== this.usersMtime) { this.usersMtime = m; this.reloadUsers(); }
  }
  // revocacion global pedida desde el CLI
  syncRevoke() {
    let m = 0; try { m = fs.statSync(this.revokeFile).mtimeMs; } catch { }
    if (m === this.revokeMtime) return;
    this.revokeMtime = m;
    const r = readJSON(this.revokeFile, {}) || {};
    this.revokeBefore = Number(r.before) || 0;
    let n = 0;
    for (const [k, s] of this.sessions) if (s.created < this.revokeBefore) { this.sessions.delete(k); n++; }
    if (n) this.saveSessions();
  }
  saveUsers() { writeJSONAtomic(this.usersFile, this.users); }
  saveSessions() {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => writeJSONAtomic(this.sessionsFile, Object.fromEntries(this.sessions)), 500);
  }

  setUser(name, pin, role = 'owner') {
    checkCredentials(name, pin);
    const salt = crypto.randomBytes(16).toString('hex');
    // "cred" cambia con cada alta o cambio de PIN: invalida las sesiones abiertas con la credencial vieja
    this.users[name.toLowerCase()] = { salt, hash: hashPinSync(pin, salt), role, cred: crypto.randomBytes(8).toString('hex'), updated: new Date().toISOString() };
    this.saveUsers();
  }
  // baja de un usuario: sus sesiones caducan al instante (get() ya no lo encuentra)
  delUser(name) {
    const k = String(name || '').toLowerCase();
    if (!own(this.users, k)) throw new Error('No existe ese usuario');
    delete this.users[k];
    this.saveUsers();
  }
  owners() { return Object.keys(this.users).filter(n => this.users[n].role === 'owner'); }
  sessionsOf(name) { const k = String(name || '').toLowerCase(); let n = 0; for (const s of this.sessions.values()) if (s.user === k) n++; return n; }
  // despues de cambiar su propio PIN, la sesion desde la que se cambio sigue abierta
  keepSession(s) { const u = this.userOf(s.user); if (u && this.sessions.has(s.key)) { this.sessions.get(s.key).cred = u.cred; s.cred = u.cred; this.saveSessions(); } }
  // usuario que entra con un pase firmado (panel maestro): no tiene PIN propio, asi que no puede entrar con login()
  ensurePassUser(name, role = 'owner') {
    const k = String(name || '').toLowerCase();
    if (!USER_RE.test(k) || RESERVED.has(k)) throw new Error('Usuario invalido');
    if (!own(this.users, k)) { this.users[k] = { role, pass: true, cred: crypto.randomBytes(8).toString('hex'), updated: new Date().toISOString() }; this.saveUsers(); }
  }
  openSession(name, ip) {
    this.syncUsers();
    const u = this.userOf(name);
    if (!u) return null;
    const token = crypto.randomBytes(32).toString('base64url');
    const s = { user: String(name).toLowerCase(), cred: u.cred || u.updated, created: Date.now(), seen: Date.now(), ip, privateUntil: 0 };
    this.sessions.set(sha(token), s);
    this.saveSessions();
    return { token, session: { ...s, role: u.role } };
  }
  // para el CLI: cambia el rol sin tocar el PIN
  setRole(name, role) {
    const u = this.userOf(name);
    if (!u) throw new Error('No existe ese usuario');
    u.role = role; u.updated = new Date().toISOString();
    this.saveUsers();
  }

  // Bloqueo progresivo por IP y por usuario
  isLocked(key) {
    const f = this.fails.get(key);
    return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 1000) : 0;
  }
  noteFail(key, max, lockMs) {
    const f = this.fails.get(key) || { n: 0, until: 0, at: 0 };
    f.n++; f.at = Date.now();
    if (f.n >= max) { f.until = Date.now() + lockMs; f.n = 0; }
    this.fails.set(key, f);
  }

  async checkPin(name, pin) {
    const u = this.userOf(name);
    // se calcula el hash aunque el usuario no exista, para no filtrar cuales existen por tiempo
    const h = Buffer.from(await hashPin(String(pin || ''), u && u.salt ? u.salt : DUMMY_SALT), 'hex');
    const ok = !!u && typeof u.hash === 'string' && PIN_RE.test(String(pin)) && crypto.timingSafeEqual(h, Buffer.from(u.hash, 'hex'));
    return ok ? u : null;
  }

  async login(name, pin, ip) {
    this.syncUsers();
    const uname = String(name || '').toLowerCase();
    const uKey = 'u:' + uname, ipKey = 'ip:' + ip;
    const wait = Math.max(this.isLocked(uKey), this.isLocked(ipKey));
    if (wait) return { error: `Demasiados intentos. Espere ${Math.ceil(wait / 60)} min.`, status: 429 };
    // se anota el intento antes del hash: varias peticiones en paralelo no se saltan el limite
    this.noteFail(uKey, 5, 15 * 60000);
    this.noteFail(ipKey, 10, 30 * 60000);
    const u = await this.checkPin(uname, pin);
    if (!u) return { error: 'Usuario o PIN incorrecto', status: 401 };
    this.fails.delete(uKey); this.fails.delete(ipKey);
    const token = crypto.randomBytes(32).toString('base64url');
    const s = { user: uname, cred: u.cred || u.updated, created: Date.now(), seen: Date.now(), ip, privateUntil: 0 };
    this.sessions.set(sha(token), s);
    this.saveSessions();
    return { token, session: { ...s, role: u.role } };
  }

  get(token) {
    if (!token) return null;
    this.syncUsers();
    this.syncRevoke();
    const k = sha(token);
    const s = this.sessions.get(k);
    if (!s) return null;
    const u = this.userOf(s.user);
    const maxAge = this.cfg.sessionDays * 86400000;
    // usuario borrado, PIN cambiado o sesion vieja: fuera
    if (!u || Date.now() - s.seen > maxAge || s.cred !== (u.cred || u.updated) || s.created < this.revokeBefore) {
      this.sessions.delete(k); this.saveSessions(); return null;
    }
    // el rol se toma siempre del archivo de usuarios: bajar a viewer quita el modo privado al instante
    s.role = u.role;
    if (u.role !== 'owner' && s.privateUntil) { s.privateUntil = 0; this.saveSessions(); }
    if (Date.now() - s.seen > 3600000) { s.seen = Date.now(); this.saveSessions(); }
    s.key = k;
    return s;
  }

  // valida una sesion ya abierta (streams SSE): mismas reglas que get()
  stillValid(s) {
    const u = this.userOf(s.user);
    const ok = !!u && this.sessions.has(s.key) && s.cred === (u.cred || u.updated) && s.created >= this.revokeBefore;
    if (ok) { s.role = u.role; if (u.role !== 'owner') s.privateUntil = 0; } // un stream abierto tambien pierde el privado
    return ok;
  }

  logout(token) { if (token) { this.sessions.delete(sha(token)); this.saveSessions(); } }

  // privateUntil: 0 = publico, -1 = privado hasta bloquear, >0 = timestamp de expiracion
  isPrivate(s) { return !!s && s.role === 'owner' && (s.privateUntil === -1 || s.privateUntil > Date.now()); }

  async unlock(s, pin, minutes, ip) {
    if (s.role !== 'owner') return { error: 'Su usuario solo puede ver el modo público', status: 403 };
    const key = 'p:' + s.user;
    const wait = Math.max(this.isLocked(key), this.isLocked('ip:' + ip));
    if (wait) return { error: `Demasiados intentos. Espere ${Math.ceil(wait / 60)} min.`, status: 429 };
    this.noteFail(key, 5, 15 * 60000);
    if (!(await this.checkPin(s.user, pin))) return { error: 'PIN incorrecto', status: 401 };
    this.fails.delete(key);
    const m = Number(minutes);
    s.privateUntil = m > 0 ? Date.now() + m * 60000 : -1;
    this.saveSessions();
    return { ok: true };
  }

  lock(s) { s.privateUntil = 0; this.saveSessions(); }
  lockAll() { for (const s of this.sessions.values()) s.privateUntil = 0; this.saveSessions(); }
}

module.exports = { Auth, PIN_RE, USER_RE, RESERVED, checkCredentials };
