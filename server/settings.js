'use strict';
// Configuracion en capas: valores por defecto < config.json (opcional) < <stateDir>/settings.json.
// settings.json lo escribe el asistente web (el servicio no puede escribir en su carpeta de codigo).
// Solo se aceptan claves de una lista cerrada y se aplican en caliente sobre el mismo objeto cfg.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { readJSON, writeJSONAtomic } = require('./util');

const DEFAULTS = {
  title: 'Atalaya', subtitle: '', host: '127.0.0.1', port: 3950, stateDir: '/var/lib/atalaya', trustProxy: true, sessionDays: 30,
  privateOptions: [15, 60, 240, 0], public: { showAccountNames: false, showAppNames: false }, publicUrl: '', promo: true,
  accounts: {}, apps: {}, sites: {}, claude: { idleMinutes: 8, goneMinutes: 45, subagentGoneSeconds: 150 }, logs: {}, platform: { panel: 'auto' },
  // totales publicos de anoche (server/publictotals.js): solo desde config.json, nunca desde el asistente
  publicTotals: { on: false },
};
// lo que el asistente puede cambiar
// promo: el enlace «Conozca Atalaya» de la pantalla de acceso (el dueno lo puede apagar)
const EDITABLE = ['title', 'subtitle', 'publicUrl', 'public', 'privateOptions', 'accounts', 'apps', 'sites', 'services', 'setupDone', 'projects', 'theme', 'promo'];

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
function merge(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b || {})) out[k] = isObj(v) && isObj(a[k]) ? merge(a[k], v) : v;
  return out;
}

// Atalaya Hosting (app Node dentro de una cuenta de hosting compartido, sin root): datos en el home,
// sin puertos extra (Passenger atiende uno solo), sin lectura del panel del servidor ni de systemd.
function hostingDefaults() {
  const home = os.homedir();
  return { stateDir: path.join(home, '.atalaya-data'), port: Number(process.env.PORT) || 3950, setupPort: 0, hookPort: 0,
    platform: { panel: 'none' }, diskmap: { roots: [home] }, services: { disabled: true }, docker: { disabled: true } };
}

// Atalaya Cloud: una pantalla por cliente detras del portal (cloud/portal.js), que la levanta con estas
// variables. No mira el servidor donde corre: solo conectores, agentes y equipos remotos del cliente.
function cloudDefaults() {
  const E = process.env;
  let limits = {};
  try { limits = JSON.parse(E.ATALAYA_LIMITS || '{}') || {}; } catch { }
  return { stateDir: E.ATALAYA_STATE, host: '127.0.0.1', port: Number(E.PORT) || 0, setupPort: 0, hookPort: 0, trustProxy: true,
    basePath: E.ATALAYA_BASE || '/', publicUrl: E.ATALAYA_PUBLIC_URL || '', title: E.ATALAYA_TITLE || 'Atalaya', limits,
    platform: { panel: 'none' }, services: { disabled: true }, docker: { disabled: true }, diskmap: { disabled: true },
    ...(E.ATALAYA_GEOIP ? { geoipPath: E.ATALAYA_GEOIP } : {}) };
}

// Atalaya Equipo: el ejecutable unico en la computadora de la persona (Windows, macOS o Linux). Solo
// escucha en 127.0.0.1; ve este equipo, sus sesiones de Claude Code y los conectores de nube. En Linux muestra tambien
// los servicios de systemd y los contenedores (un servidor en casa, una PC con Docker); en Windows y macOS no.
function equipoDefaults() {
  const E = process.env;
  const home = os.homedir();
  const data = E.ATALAYA_STATE || (process.platform === 'win32' ? path.join(E.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Atalaya')
    : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support', 'Atalaya') : path.join(E.XDG_DATA_HOME || path.join(home, '.local', 'share'), 'atalaya'));
  const off = process.platform !== 'linux' || E.ATALAYA_FORCE_LITE === '1';
  return { stateDir: data, host: '127.0.0.1', port: Number(E.PORT) || 3950, setupPort: 0, hookPort: 0, trustProxy: false, subtitle: os.hostname(),
    platform: { panel: 'none' }, services: { disabled: off }, docker: { disabled: off }, diskmap: { disabled: true } };
}

function load(root) {
  const file = process.env.ATALAYA_CONFIG || path.join(root, 'config.json');
  const edition = ['hosting', 'cloud', 'equipo'].includes(process.env.ATALAYA_EDITION) ? process.env.ATALAYA_EDITION : 'vps';
  if (edition === 'cloud' && !process.env.ATALAYA_STATE) throw new Error('Atalaya Cloud necesita ATALAYA_STATE');
  // en la nube config.json es del VPS que lo aloja: no se lee
  const base = edition === 'cloud' ? merge(DEFAULTS, cloudDefaults())
    : merge(merge(DEFAULTS, edition === 'hosting' ? hostingDefaults() : edition === 'equipo' ? equipoDefaults() : {}), readJSON(file, {}) || {});
  base.edition = edition;
  const local = readJSON(path.join(base.stateDir, 'settings.json'), {}) || {};
  const cfg = merge(base, pick(local));
  // la direccion y el prefijo los fija el portal, no el cliente
  if (edition === 'cloud') { cfg.publicUrl = base.publicUrl; cfg.basePath = base.basePath; }
  cfg.basePath = cfg.basePath || '/';
  cfg._configFile = edition !== 'cloud' && fs.existsSync(file) ? file : null;
  return cfg;
}
function pick(o) { const out = {}; for (const k of EDITABLE) if (o && o[k] !== undefined) out[k] = o[k]; return out; }

// guarda cambios del asistente y los aplica sobre el cfg vivo
function save(cfg, patch) {
  const file = path.join(cfg.stateDir, 'settings.json');
  const cur = readJSON(file, {}) || {};
  const next = merge(cur, pick(patch));
  writeJSONAtomic(file, next, 0o600);
  for (const [k, v] of Object.entries(pick(patch))) cfg[k] = isObj(v) && isObj(cfg[k]) ? merge(cfg[k], v) : v;
  return next;
}

module.exports = { load, save, merge, DEFAULTS, EDITABLE };
