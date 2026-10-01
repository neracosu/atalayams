'use strict';
// Servicios de systemd: los de aplicacion se muestran como edificios (distrito "_sys" o la cuenta de
// su User=) y los servicios clave del servidor como tablero de estado en la Torre de control.
// CPU y memoria salen del cgroup de cada unidad (incluye todos sus procesos).
const { execFile } = require('child_process');
const fx = require('../platform/fsx');

// unidades clave: se muestran si existen en el sistema
const KEY = [
  ['httpd', 'Apache'], ['apache2', 'Apache'], ['nginx', 'Nginx'], ['lsws', 'LiteSpeed'], ['lshttpd', 'LiteSpeed'],
  ['mariadb', 'MariaDB'], ['mysqld', 'MySQL'], ['mysql', 'MySQL'], ['postgresql', 'PostgreSQL'], ['redis', 'Redis'], ['redis-server', 'Redis'],
  ['exim', 'Exim'], ['exim4', 'Exim'], ['postfix', 'Postfix'], ['dovecot', 'Dovecot'],
  ['sshd', 'SSH'], ['ssh', 'SSH'], ['crond', 'Cron'], ['cron', 'Cron'], ['fail2ban', 'fail2ban'], ['csf', 'CSF'], ['lfd', 'LFD'],
  ['cpanel', 'cPanel'], ['cphulkd', 'cPHulk'], ['imunify360', 'Imunify360'], ['psa', 'Plesk'], ['directadmin', 'DirectAdmin'],
  ['lscpd', 'CyberPanel'], ['pdns', 'PowerDNS'], ['named', 'BIND DNS'], ['docker', 'Docker'], ['php-fpm', 'PHP-FPM'],
  ['mongod', 'MongoDB'], ['smbd', 'Samba'], ['smb', 'Samba'], ['nfs-server', 'NFS'], ['nfs-kernel-server', 'NFS'],
  ['tailscaled', 'Tailscale'], ['zerotier-one', 'ZeroTier'], ['strongswan', 'IPsec'], ['strongswan-starter', 'IPsec'],
];
// servicios clave que viven como instancias de una plantilla (wg-quick@wg0, openvpn-server@oficina, postgresql@16-main):
// no tienen archivo propio; las instancias encendidas son enlaces en las carpetas *.wants
const KEY_TEMPLATES = [['wg-quick', 'WireGuard'], ['openvpn-server', 'OpenVPN'], ['openvpn-client', 'OpenVPN cliente'], ['openvpn', 'OpenVPN'], ['postgresql', 'PostgreSQL']];
const MAX_INSTANCES = 6;
const UNIT_DIRS = ['/etc/systemd/system', '/usr/lib/systemd/system', '/lib/systemd/system'];
const APP_EXEC = /^(?:\/opt\/|\/home\/|\/srv\/|\/var\/www\/|\/usr\/local\/bin\/|\S*\b(?:node|nodejs|bun|deno|python\d?(?:\.\d+)?|uvicorn|gunicorn|java|php|dotnet|ruby|go)\b)/;
const PROPS = ['Id', 'LoadState', 'ActiveState', 'SubState', 'MainPID', 'NRestarts', 'ExecMainStartTimestampMonotonic', 'User', 'Description', 'WorkingDirectory', 'ControlGroup', 'Type'];

// lee un archivo .service: ExecStart, User, Type y si lo creo el administrador
function readUnit(file) {
  const t = fx.read(file);
  const get = k => (t.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1] || '';
  return { exec: get('ExecStart').replace(/^[-@:+!]+/, '').trim(), user: get('User'), type: get('Type') || 'simple', desc: get('Description'), wd: get('WorkingDirectory') };
}

// servicios de aplicacion: creados por el admin (archivo propio en /etc/systemd/system, no enlace),
// de larga vida y cuyo programa es una app (no un daemon del sistema ni PM2)
function appUnits(cfg = {}) {
  const inc = new Set((cfg.services && cfg.services.include) || []), exc = new Set((cfg.services && cfg.services.exclude) || []);
  const out = [];
  for (const f of fx.ls('/etc/systemd/system')) {
    if (!f.endsWith('.service') || f.includes('@')) continue;
    const name = f.slice(0, -8);
    if (exc.has(name)) continue;
    const st = fx.stat('/etc/systemd/system/' + f);
    if (!st || !st.isFile()) continue;
    try { if (require('fs').lstatSync(fx.P('/etc/systemd/system/' + f)).isSymbolicLink()) continue; } catch { continue; }
    const u = readUnit('/etc/systemd/system/' + f);
    const isApp = inc.has(name) || (u.type !== 'oneshot' && !name.startsWith('pm2-') && APP_EXEC.test(u.exec) && !/^\/usr\/local\/cpanel\//.test(u.exec));
    if (isApp) out.push({ unit: f, name, ...u });
  }
  return out;
}

function keyUnits() {
  const seen = new Set(), out = [];
  for (const [id, label] of KEY) {
    if (seen.has(label)) continue;
    if (UNIT_DIRS.some(d => fx.exists(`${d}/${id}.service`))) { out.push({ unit: id + '.service', label }); seen.add(label); }
  }
  // instancias de plantillas: en Debian «postgresql.service» es solo un envoltorio que siempre dice activo; la base real
  // es postgresql@<version>-<cluster>, asi que la instancia reemplaza al envoltorio
  const inst = templateInstances();
  for (const [tpl, label] of KEY_TEMPLATES) {
    const mine = inst.filter(u => u.startsWith(tpl + '@')).slice(0, MAX_INSTANCES);
    if (!mine.length) continue;
    const i = out.findIndex(k => k.unit === tpl + '.service');
    if (i >= 0) out.splice(i, 1);
    for (const u of mine) out.push({ unit: u, label: `${label} ${u.slice(tpl.length + 1, -8)}` });
  }
  return out;
}
function templateInstances() {
  const found = new Set();
  for (const d of fx.ls('/etc/systemd/system')) {
    if (!d.endsWith('.wants')) continue;
    for (const f of fx.ls('/etc/systemd/system/' + d)) if (/^[A-Za-z0-9_.-]+@[A-Za-z0-9_.:-]+\.service$/.test(f)) found.add(f);
  }
  return [...found].sort();
}

// salida de `systemctl show a b -p ...`: bloques separados por linea en blanco
function parseShow(text) {
  return String(text).trim().split(/\n\s*\n/).map(b => Object.fromEntries(b.split('\n').filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i), l.slice(i + 1)]; })));
}

function cgroupStats(cg) {
  if (!cg) return null;
  const base = '/sys/fs/cgroup' + cg;
  const mem = Number(fx.read(base + '/memory.current').trim());
  const usec = Number((fx.read(base + '/cpu.stat').match(/^usage_usec (\d+)/m) || [])[1]);
  if (!mem && !usec) return null;
  return { mem: mem || 0, usec: usec || 0 };
}

const STATUS = s => s === 'active' ? 'online' : s === 'activating' || s === 'reloading' || s === 'deactivating' ? 'degraded' : 'down';

class ServicesCollector {
  constructor(cfg, bus) {
    this.cfg = cfg; this.bus = bus;
    this.apps = []; this.keys = [];
    this.prev = new Map(); // unidad -> { usec, t, restarts, start }
    this.units = []; this.keyList = [];
  }

  start() {
    if (!fx.isDir('/run/systemd/system') && !process.env.ATALAYA_FSROOT) return; // no es systemd
    this.discover();
    setInterval(() => this.discover(), 60000);
    this.poll();
    setInterval(() => this.poll(), 5000);
  }

  discover() { this.units = appUnits(this.cfg); this.keyList = keyUnits(); }

  poll() {
    const all = [...this.units.map(u => u.unit), ...this.keyList.map(k => k.unit)];
    if (!all.length) return;
    execFile('systemctl', ['show', ...all, '-p', PROPS.join(','), '--no-pager'], { timeout: 4000, maxBuffer: 1 << 20 }, (err, out) => {
      if (err && !out) return;
      this.apply(parseShow(out));
    });
  }

  apply(blocks) {
    const now = Date.now();
    const upNowUs = Number(fx.read('/proc/uptime').split(' ')[0]) * 1e6;
    // systemctl responde en el mismo orden pedido; con alias (mysql -> mariadb) el Id es el real
    const asked = [...this.units.map(u => u.unit), ...this.keyList.map(k => k.unit)];
    const byId = new Map(asked.map((u, i) => [u, blocks[i] || {}]));
    const accounts = this.cfg.accounts || {};
    this.apps = this.units.map(u => {
      const b = byId.get(u.unit) || {};
      const cg = cgroupStats(b.ControlGroup);
      const p = this.prev.get(u.unit);
      const cpu = cg && p && now > p.t ? Math.max(0, (cg.usec - p.usec) / ((now - p.t) * 1000) * 100) : 0;
      const restarts = Number(b.NRestarts) || 0, start = b.ExecMainStartTimestampMonotonic || '';
      const user = b.User || u.user || 'root';
      const account = accounts[user] && user !== 'root' ? user : '_sys';
      if (p && b.ActiveState === 'active' && (restarts > p.restarts || (start && p.start && start !== p.start))) this.bus.emit('ev', { kind: 'pm2', account, app: u.name, action: 'restart', source: 'systemd' });
      if (p && p.state === 'active' && b.ActiveState && b.ActiveState !== 'active' && b.ActiveState !== 'activating') this.bus.emit('ev', { kind: 'pm2', account, app: u.name, action: 'down', source: 'systemd' });
      this.prev.set(u.unit, { usec: cg ? cg.usec : 0, t: now, restarts, start, state: b.ActiveState });
      const startUs = Number(start) || 0;
      return {
        account, name: u.name, source: 'systemd', unit: u.unit, status: STATUS(b.ActiveState), substate: b.SubState || '', instances: 1,
        online: b.ActiveState === 'active' ? 1 : 0, cpu: Math.round(cpu * 10) / 10, mem: cg ? cg.mem : 0,
        uptime: startUs && b.ActiveState === 'active' ? Math.max(0, (upNowUs - startUs) / 1e6) : 0, restartsTotal: restarts,
        user, cwd: b.WorkingDirectory || u.wd || '', exec: u.exec, description: b.Description || u.desc || '',
      };
    });
    // servicios clave: solo su estado (y aviso cuando uno cae o vuelve)
    const seenReal = new Set();
    this.keys = this.keyList.filter(k => {
      const b = byId.get(k.unit) || {};
      if (b.LoadState === 'not-found' || !b.Id || seenReal.has(b.Id)) return false; // alias repetido o inexistente
      seenReal.add(b.Id);
      return true;
    }).map(k => {
      const b = byId.get(k.unit) || {};
      const prevState = this.prev.get('key:' + k.unit);
      if (prevState && prevState !== b.ActiveState && (b.ActiveState === 'failed' || (prevState === 'failed' && b.ActiveState === 'active')))
        this.bus.emit('ev', { kind: 'keysvc', label: k.label, unit: k.unit, action: b.ActiveState === 'active' ? 'up' : 'down' });
      this.prev.set('key:' + k.unit, b.ActiveState);
      return { unit: k.unit, label: k.label, state: b.ActiveState || 'unknown', substate: b.SubState || '' };
    });
  }
}

module.exports = { ServicesCollector, parseShow, appUnits, keyUnits, readUnit };
