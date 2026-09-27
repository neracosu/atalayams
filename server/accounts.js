'use strict';
// Registro de cuentas: se detectan solas (cPanel o usuarios con PM2/Claude/sitio) y config.json
// solo ajusta etiquetas y colores. A cada cuenta nueva se le asigna un nombre publico y un color
// que quedan guardados para que no cambien al aparecer o desaparecer otras.
const fs = require('fs');
const { listDir, readJSON, writeJSONAtomic, loadPasswd } = require('./util');

const PUBLIC_NAMES = ['Distrito Norte', 'Distrito Este', 'Distrito Sur', 'Distrito Oeste', 'Distrito Puerto', 'Distrito Centro',
  'Distrito Bahía', 'Distrito Valle', 'Distrito Colina', 'Distrito Río', 'Distrito Faro', 'Distrito Muelle', 'Distrito Mirador',
  'Distrito Palmar', 'Distrito Arena', 'Distrito Cumbre'];
const COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f472b6', '#60a5fa', '#fb923c', '#a3e635', '#e879f9', '#2dd4bf',
  '#f87171', '#facc15', '#818cf8', '#4ade80', '#f9a8d4', '#38bdf8'];

// WSL en Windows: `wsl.exe -l --running -q` responde en UTF-16 (o UTF-8 con WSL_UTF8=1); nombres de las
// distribuciones encendidas, sin las internas de Docker Desktop
function parseWslList(buf) {
  if (!buf || !buf.length) return [];
  const txt = buf.includes(0) ? buf.toString('utf16le') : buf.toString('utf8');
  return txt.replace(/^\uFEFF/, '').replace(/\0/g, '').split(/\r?\n/).map(x => x.trim()).filter(x => x && !/^docker-desktop/i.test(x));
}
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'x';

// usuario de este equipo como id de distrito (en Windows puede traer espacios o mayusculas)
function localUser() {
  let n = 'equipo';
  try { n = require('os').userInfo().username || n; } catch { }
  return n.toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32) || 'equipo';
}

class Accounts {
  constructor(cfg, bus, platform = null) {
    this.cfg = cfg;
    this.bus = bus;
    this.platform = platform;
    this.configured = { ...(cfg.accounts || {}) }; // lo que el usuario fijo a mano
    this.file = cfg.stateDir + '/accounts.json';
    this.saved = readJSON(this.file, {}) || {};
    this.list = new Map(); // id -> { id, home, cpanel, detected }
    this.sync(true);
    if (process.platform === 'win32' && cfg.edition === 'equipo') { this.refreshWsl(); const t = setInterval(() => this.refreshWsl(), 60000); t.unref && t.unref(); }
  }

  // distribuciones de WSL encendidas y sus usuarios con ~/.claude/projects (se revisa cada minuto; una apagada
  // no se enciende: \\wsl.localhost solo se toca para las que ya estan corriendo)
  refreshWsl(done) {
    if (process.platform !== 'win32' || this.cfg.edition !== 'equipo') return done && done();
    require('child_process').execFile('wsl.exe', ['-l', '--running', '-q'], { timeout: 8000, encoding: 'buffer', windowsHide: true }, (err, out) => {
      const homes = [];
      for (const d of err ? [] : parseWslList(out)) {
        const path = require('path');
        const root = ['\\\\wsl.localhost\\' + d, '\\\\wsl$\\' + d].find(r => { try { fs.accessSync(r); return true; } catch { return false; } });
        if (!root) continue;
        for (const h of [path.join(root, 'root'), ...listDir(path.join(root, 'home')).map(u => path.join(root, 'home', u))]) {
          try { fs.accessSync(path.join(h, '.claude', 'projects')); homes.push({ distro: d, user: path.basename(h), home: h }); } catch { }
        }
      }
      const changed = JSON.stringify(homes) !== JSON.stringify(this.wsl || []);
      this.wsl = homes;
      if (changed) { if (homes.length) console.log(`[wsl] Claude Code en ${homes.map(h => h.distro + '/' + h.user).join(', ')}`); this.sync(); if (this.onHomes) this.onHomes(); }
      if (done) done();
    });
  }

  // Cuentas del panel detectado (cPanel, Plesk, DirectAdmin, CyberPanel o duenos de sitios sin panel)
  // mas los usuarios reales con PM2, Claude Code o public_html, y root.
  detect() {
    const found = new Map();
    if (this.cfg.edition === 'equipo') {
      found.set(localUser(), { id: localUser(), home: require('os').homedir(), cpanel: false, label: 'Este equipo', publicLabel: 'Este equipo' });
      // Claude Code dentro de WSL: cada distribucion y usuario con sesiones es su propio distrito
      for (const w of this.wsl || []) found.set(`wsl-${slug(w.distro)}-${slug(w.user)}`, { id: `wsl-${slug(w.distro)}-${slug(w.user)}`, home: w.home, cpanel: false, label: `WSL · ${w.distro} (${w.user})`, publicLabel: `WSL · ${w.distro}`, wsl: true });
      for (const v of this.virtual ? this.virtual() : []) found.set(v.id, { id: v.id, home: '/', cpanel: false, label: v.label, publicLabel: v.publicLabel, virtual: true });
      return found;
    }
    if (this.cfg.edition === 'hosting' || this.cfg.edition === 'cloud') {
      for (const v of this.virtual ? this.virtual() : []) found.set(v.id, { id: v.id, home: '/', cpanel: false, label: v.label, publicLabel: v.publicLabel, virtual: true });
      return found;
    }
    const passwd = loadPasswd();
    const byName = new Map([...passwd.values()].map(u => [u.name, u]));
    const panel = this.platform && this.platform.panel;
    for (const a of panel ? panel.accounts() : []) {
      if (!a.id.startsWith('_') && !byName.has(a.id)) continue;
      found.set(a.id, { id: a.id, home: a.home, cpanel: panel.id === 'cpanel', panel: panel.id, main: a.main || '', label: a.label });
    }
    for (const [uid, u] of passwd) {
      if (found.has(u.name) || uid < 1000 || !u.home || !u.home.startsWith('/home')) continue;
      if (['.pm2', '.claude', 'public_html'].some(d => fs.existsSync(u.home + '/' + d))) found.set(u.name, { id: u.name, home: u.home, cpanel: false });
    }
    found.set('root', { id: 'root', home: '/root', cpanel: false });
    // distritos virtuales: servicios de systemd sin cuenta propia, contenedores Docker
    for (const v of this.virtual ? this.virtual() : []) found.set(v.id, { id: v.id, home: '/', cpanel: false, label: v.label, publicLabel: v.publicLabel, virtual: true });
    // las que el usuario configuro a mano y existen en el sistema, aunque no se detecten
    for (const id of Object.keys(this.configured)) if (!found.has(id) && byName.has(id)) found.set(id, { id, home: byName.get(id).home, cpanel: false });
    return found;
  }

  // Arma cfg.accounts = detectadas + ajustes de config. Emite eventos de alta y baja.
  sync(initial = false) {
    const found = this.detect();
    const usedNames = new Set(Object.values(this.saved).map(x => x.publicLabel));
    const usedColors = new Set(Object.values(this.saved).map(x => x.color));
    let dirty = false;
    for (const id of found.keys()) {
      if (this.saved[id] || id === 'root') continue;
      const c = this.configured[id] || {};
      // los distritos virtuales no revelan a nadie: su nombre publico es el mismo
      const virt = found.get(id).virtual;
      const publicLabel = c.publicLabel || found.get(id).publicLabel || (virt ? found.get(id).publicLabel || found.get(id).label : PUBLIC_NAMES.find(n => !usedNames.has(n)) || `Distrito ${Object.keys(this.saved).length + 1}`);
      const color = c.color || COLORS.find(x => !usedColors.has(x)) || COLORS[Object.keys(this.saved).length % COLORS.length];
      usedNames.add(publicLabel); usedColors.add(color);
      this.saved[id] = { publicLabel, color, firstSeen: new Date().toISOString() };
      dirty = true;
    }
    if (dirty) { try { writeJSONAtomic(this.file, this.saved); } catch (e) { console.error('[cuentas] no se pudo guardar', e.message); } }

    const next = {};
    for (const [id, a] of found) {
      const s = this.saved[id] || {}, c = this.configured[id] || {};
      next[id] = id === 'root'
        ? { label: 'Torre de control', publicLabel: 'Torre de control', color: '#f8fafc', ...c }
        : { label: c.label || a.label || id, publicLabel: c.publicLabel || s.publicLabel, color: c.color || s.color };
    }
    if (!initial) {
      for (const id of Object.keys(next)) if (!this.cfg.accounts[id]) this.bus.emit('ev', { kind: 'account', action: 'added', account: id });
      for (const id of Object.keys(this.cfg.accounts)) if (!next[id]) {
        const old = this.cfg.accounts[id];
        this.bus.emit('ev', { kind: 'account', action: 'removed', account: id, privLabel: old.label, publicLabel: old.publicLabel });
      }
    }
    // se reemplaza el contenido del mismo objeto: todos los modulos leen cfg.accounts
    for (const k of Object.keys(this.cfg.accounts || {})) delete this.cfg.accounts[k];
    this.cfg.accounts = Object.assign(this.cfg.accounts || {}, next);
    this.list = found;
  }

  homes() { return [...this.list.values()].filter(a => !a.id.startsWith('_')).map(a => ({ user: a.id, home: a.home })); }
}

module.exports = { Accounts, localUser, parseWslList };
