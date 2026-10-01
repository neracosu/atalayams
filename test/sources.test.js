'use strict';
// Fuentes de procesos: Docker (API simulada por socket) y systemd (unidades y salida de systemctl).
// Uso: node test/sources.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-src-'));
process.env.ATALAYA_FSROOT = root;
const w = (p, t) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), t); };

// ---------- systemd: que unidades cuentan como "app"
w('/etc/systemd/system/miapi.service', '[Service]\nExecStart=/usr/bin/node /opt/miapi/server.js\nUser=deploy\n');
w('/etc/systemd/system/worker.service', '[Service]\nExecStart=/usr/bin/python3 -m worker\n');
w('/etc/systemd/system/backup.service', '[Service]\nType=oneshot\nExecStart=/opt/backup.sh\n');
w('/etc/systemd/system/pm2-ana.service', '[Service]\nExecStart=/home/ana/.nvm/pm2 resurrect\n');
w('/etc/systemd/system/cpanel.service', '[Service]\nExecStart=/usr/local/cpanel/scripts/restartsrv_cpsrvd\n');
w('/etc/systemd/system/nginx.service', '[Service]\nExecStart=/usr/sbin/nginx\n');
w('/usr/lib/systemd/system/mariadb.service', '[Service]\nExecStart=/usr/sbin/mariadbd\n');
w('/usr/lib/systemd/system/mysql.service', '[Service]\nExecStart=/usr/sbin/mariadbd\n');
const { appUnits, keyUnits, parseShow, ServicesCollector } = require('../server/collectors/services');
assert.deepStrictEqual(appUnits().map(u => u.name).sort(), ['miapi', 'worker'], 'solo apps de larga vida, sin oneshot, pm2 ni daemons');
assert.deepStrictEqual(appUnits({ services: { include: ['backup'], exclude: ['worker'] } }).map(u => u.name).sort(), ['backup', 'miapi']);
assert.ok(keyUnits().some(k => k.label === 'MariaDB') && keyUnits().some(k => k.label === 'Nginx'));
// VPN, archivos compartidos y PostgreSQL de Debian: instancias de plantilla encendidas (enlaces en *.wants)
assert.ok(!keyUnits().some(k => /WireGuard|OpenVPN|Samba/.test(k.label)), 'lo que no esta instalado no aparece');
w('/usr/lib/systemd/system/smbd.service', '[Service]\nExecStart=/usr/sbin/smbd\n');
w('/usr/lib/systemd/system/postgresql.service', '[Service]\nType=oneshot\nExecStart=/bin/true\n');
w('/etc/systemd/system/multi-user.target.wants/wg-quick@wg0.service', '');
w('/etc/systemd/system/multi-user.target.wants/openvpn-server@oficina.service', '');
w('/etc/systemd/system/multi-user.target.wants/postgresql@16-main.service', '');
w('/etc/systemd/system/multi-user.target.wants/getty@tty1.service', '');
{
  const k = keyUnits();
  assert.ok(k.some(x => x.unit === 'smbd.service' && x.label === 'Samba'));
  assert.ok(k.some(x => x.unit === 'wg-quick@wg0.service' && x.label === 'WireGuard wg0'));
  assert.ok(k.some(x => x.unit === 'openvpn-server@oficina.service' && x.label === 'OpenVPN oficina'));
  assert.ok(k.some(x => x.unit === 'postgresql@16-main.service' && x.label === 'PostgreSQL 16-main') && !k.some(x => x.unit === 'postgresql.service'), 'la base real reemplaza al envoltorio');
  assert.ok(!k.some(x => /getty/.test(x.unit)), 'otras plantillas no cuentan');
}
for (const f of ['multi-user.target.wants/wg-quick@wg0.service', 'multi-user.target.wants/openvpn-server@oficina.service', 'multi-user.target.wants/postgresql@16-main.service', 'multi-user.target.wants/getty@tty1.service'])
  fs.rmSync(path.join(root, '/etc/systemd/system', f));
fs.rmSync(path.join(root, '/usr/lib/systemd/system/smbd.service')); fs.rmSync(path.join(root, '/usr/lib/systemd/system/postgresql.service'));

w('/proc/uptime', '1000.00 900.00\n');
w('/sys/fs/cgroup/system.slice/miapi.service/memory.current', '52428800\n');
w('/sys/fs/cgroup/system.slice/miapi.service/cpu.stat', 'usage_usec 1000000\n');
const ev = [];
const S = new ServicesCollector({ accounts: { deploy: {} } }, { emit: (_, e) => ev.push(e) });
S.discover();
const show = (restarts, state = 'active', mysqlId = 'mariadb.service') => [
  `Id=miapi.service\nLoadState=loaded\nActiveState=${state}\nSubState=running\nMainPID=10\nNRestarts=${restarts}\nExecMainStartTimestampMonotonic=400000000\nUser=deploy\nControlGroup=/system.slice/miapi.service`,
  'Id=worker.service\nLoadState=loaded\nActiveState=failed\nSubState=failed\nControlGroup=',
  ...S.keyList.map(k => `Id=${k.unit === 'mysql.service' ? mysqlId : k.unit}\nLoadState=loaded\nActiveState=active\nSubState=running`),
].join('\n\n');
S.apply(parseShow(show(0)));
let api = S.apps.find(a => a.name === 'miapi');
assert.strictEqual(api.account, 'deploy', 'User= de una cuenta conocida va a su distrito');
assert.strictEqual(S.apps.find(a => a.name === 'worker').account, '_sys');
assert.strictEqual(S.apps.find(a => a.name === 'worker').status, 'down');
assert.strictEqual(api.mem, 52428800);
assert.strictEqual(Math.round(api.uptime), 600);
assert.strictEqual(S.keys.filter(k => k.label === 'MariaDB').length, 1, 'mysql es alias de mariadb: no se repite');
S.apply(parseShow(show(1)));
assert.ok(ev.some(e => e.action === 'restart' && e.app === 'miapi'), 'NRestarts sube: reinicio');
S.apply(parseShow(show(1, 'failed')));
assert.ok(ev.some(e => e.action === 'down' && e.app === 'miapi'), 'deja de estar activo: caida');
console.log('ok   systemd: apps, cuentas, cgroup, alias, reinicio y caida');

// ---------- Docker: API simulada en un socket unix
const sock = '/var/run/docker.sock';
fs.mkdirSync(path.dirname(path.join(root, sock)), { recursive: true });
let started = '2026-09-25T10:00:00Z';
const containers = [
  { Id: 'a'.repeat(64), Names: ['/db'], Image: 'postgres:16', State: 'running', Status: 'Up 2 hours', Labels: { 'com.docker.compose.project': 'tienda', 'com.docker.compose.service': 'db' }, Ports: [{ IP: '127.0.0.1', PrivatePort: 5432, PublicPort: 5432, Type: 'tcp' }] },
  { Id: 'b'.repeat(64), Names: ['/web'], Image: 'ghcr.io/ana/tienda-web:1.4', State: 'running', Status: 'Up 5 min', Labels: {}, Ports: [{ IP: '0.0.0.0', PrivatePort: 3000, PublicPort: 8080, Type: 'tcp' }] },
];
w(`/sys/fs/cgroup/system.slice/docker-${'a'.repeat(64)}.scope/memory.current`, '104857600\n');
w(`/sys/fs/cgroup/system.slice/docker-${'a'.repeat(64)}.scope/cpu.stat`, 'usage_usec 5000\n');
const server = http.createServer((req, res) => {
  if (req.url.startsWith('/containers/json')) return res.end(JSON.stringify(containers));
  const m = req.url.match(/^\/containers\/(\w+)\/json/);
  if (m) return res.end(JSON.stringify({ RestartCount: 0, State: { StartedAt: m[1].startsWith('a') ? started : '2026-09-25T11:00:00Z' } }));
  res.statusCode = 404; res.end();
}).listen(path.join(root, sock), async () => {
  try {
    const { DockerCollector } = require('../server/collectors/docker');
    const dev = [];
    const D = new DockerCollector({}, { emit: (_, e) => dev.push(e) });
    assert.strictEqual(D.socket, sock);
    await D.poll();
    const db = D.apps.find(a => a.name === 'db');
    assert.strictEqual(D.apps.length, 2);
    assert.strictEqual(db.account, '_docker'); assert.strictEqual(db.image, 'postgres:16'); assert.strictEqual(db.compose, 'tienda');
    assert.strictEqual(db.mem, 104857600); assert.strictEqual(db.port, 5432);
    assert.deepStrictEqual(D.apps.find(a => a.name === 'web').ports, ['8080→3000/tcp']);
    // reinicio: cambia StartedAt; caida: pasa a exited
    started = '2026-09-25T12:00:00Z'; D.inspectAt = 0;
    await D.poll();
    assert.ok(dev.some(e => e.action === 'restart' && e.app === 'db'), 'StartedAt cambia: reinicio');
    containers[1].State = 'exited';
    await D.poll();
    assert.ok(dev.some(e => e.action === 'down' && e.app === 'web'), 'running -> exited: caida');
    assert.strictEqual(D.apps.find(a => a.name === 'web').status, 'down');
    const { makePrivacy } = require('../server/privacy');
    console.log('ok   docker: lista, compose, puertos, cgroup, reinicio y caida');
  } catch (e) { console.log('FALLA docker: ' + e.message); process.exitCode = 1; }
  server.close(); fs.rmSync(root, { recursive: true, force: true });
});
