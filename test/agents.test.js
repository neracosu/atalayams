'use strict';
// Agentes de hosting compartido: vinculacion, autenticacion, lectura de envios y pedidos.
// Uso: node test/agents.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const { execFileSync } = require('child_process');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-ag-'));
const cfg = { stateDir: root, accounts: {} };
const { Secrets } = require('../server/secrets');
const { Agents, cronRows } = require('../server/agents');
const visits = [];
let reloads = 0;
const logs = { onAccess: (d, l) => visits.push([d, l]), loadDomains: () => reloads++ };
const A = new Agents(cfg, {}, new Secrets(cfg), logs);
A.spreadMs = 0;

// alta y canje del codigo (un solo uso)
const { id, code } = A.create('tienda-ana', 'Tienda de Ana');
assert.throws(() => A.create('Mal Nombre'), /inválido/);
assert.strictEqual(A.virtual().length, 0, 'sin vincular no hay distrito');
assert.strictEqual(A.pair({ code: 'AAAA-BBBB-CCCC-DDDD' }, '1.1.1.1'), null);
const cred = A.pair({ code: code.toLowerCase(), user: 'ana', host: 'srv1.hosting.com' }, '1.1.1.1');
assert.ok(cred && cred.startsWith(id + ':'));
assert.strictEqual(A.pair({ code }, '1.1.1.1'), null, 'el codigo no se reusa');
assert.strictEqual(A.check(cred), id);
assert.strictEqual(A.check(id + ':' + 'x'.repeat(43)), null);
assert.strictEqual(A.check('otro:' + cred.split(':')[1]), null);
const saved = JSON.parse(fs.readFileSync(path.join(root, 'connectors.json'), 'utf8'));
assert.ok(!JSON.stringify(saved).includes(cred.split(':')[1]), 'el token no se guarda en claro');
assert.deepStrictEqual(A.virtual().map(v => v.id), ['_host-tienda-ana']);
// limite de intentos por IP
for (let i = 0; i < 12; i++) A.pair({ code: 'X' }, '9.9.9.9');
const c2 = A.recode(id).code;
assert.strictEqual(A.pair({ code: c2 }, '9.9.9.9'), null, 'IP bloqueada tras muchos intentos');

// envio completo (como lo arma agent.sh)
const uapi = (mod, data) => JSON.stringify({ apiversion: 3, module: mod, result: { status: 1, data } });
const now = Math.floor(Date.now() / 1000);
const body = [
  '@@meta', 'v=1', 'user=ana', 'full=1', 'load=0.5 0.4 0.3',
  '@@access ana.com', '1.2.3.4 - - [25/Sep/2026:10:00:00 -0400] "GET / HTTP/1.1" 200 512 "-" "Mozilla/5.0"',
  '5.6.7.8 - - [25/Sep/2026:10:00:01 -0400] "GET /x HTTP/1.1" 500 12 "-" "curl/8"',
  '@@access ../../etc', 'nada',
  '@@errlog 2048 ' + now + ' /home/ana/public_html/error_log', "PHP Fatal error: x in /home/ana/public_html/a.php on line 3", 'PHP Warning: y',
  '@@uapi DomainInfo domains_data', uapi('DomainInfo', { main_domain: { domain: 'ana.com', documentroot: '/home/ana/public_html', serveralias: 'www.ana.com' },
    addon_domains: [{ domain: 'blog.com', documentroot: '/home/ana/blog', serveralias: 'www.blog.com' }], sub_domains: [], parked_domains: ['ana.net'] }),
  '@@uapi Quota get_quota_info', uapi('Quota', { megabytes_used: 900, megabyte_limit: '1000', inodes_used: 5 }),
  '@@uapi Mysql list_databases', uapi('Mysql', [{ database: 'ana_wp', disk_usage: 5000, users: ['ana_u'] }]),
  '@@uapi SSL installed_hosts', uapi('SSL', [{ servername: 'ana.com', certificate: { not_after: now + 5 * 86400, 'issuer.organizationName': "Let's Encrypt" } }]),
  '@@uapi Email list_pops_with_disk', uapi('Email', [{ email: 'a@ana.com', _diskused: '100' }]),
  '@@crontab', '# comentario', 'MAILTO=x', '*/5 * * * * curl -H "Authorization: Bearer abcdefghijklmnop1234" https://ana.com/cron >> /home/ana/public_html/logs/c.log',
  '@@docroots', '/home/ana/public_html\twordpress\t6.6', '/home/ana/blog\tstatic\t',
  '@@disk', '/dev/sda1 1000 600 400 60% /',
].join('\n');
const reply = A.push(id, zlib.gzipSync(body), 'gzip');
assert.strictEqual(reply, 'ok');
assert.deepStrictEqual(visits.map(v => v[0]), ['ana.com', 'ana.com'], 'visitas por dominio; dominios raros descartados');
assert.ok(reloads >= 1, 'dominios nuevos recargan el catalogo');
const vh = A.vhosts();
assert.deepStrictEqual(vh.map(v => [v.account, v.servername, v.type]), [['_host-tienda-ana', 'ana.com', 'wordpress'], ['_host-tienda-ana', 'blog.com', 'static']]);
assert.ok(vh[0].aliases.includes('ana.net') && vh[0].aliases.includes('www.ana.com'));
assert.deepStrictEqual(A.mains(), [['_host-tienda-ana', 'ana.com']]);

const pub = A.info('_host-tienda-ana', false), priv = A.info('_host-tienda-ana', true);
assert.strictEqual(pub.user, undefined, 'en publico no hay usuario ni host');
assert.strictEqual(pub.dbs, undefined);
assert.strictEqual(pub.dbCount, 1);
assert.strictEqual(priv.user, 'ana');
assert.strictEqual(priv.errlogs[0].file, '~/public_html/error_log');
assert.strictEqual(priv.errlogs[0].lastHour, 2);
assert.ok(!JSON.stringify(priv).includes('abcdefghijklmnop1234'), 'secreto del cron tapado');
const texts = priv.findings.map(f => f.text).join(' | ');
assert.ok(/ana\.com vence en 5 días/.test(texts), texts);
assert.ok(/90% de su cuota/.test(texts));
assert.ok(/token o contraseña/.test(texts) && /public_html/.test(texts));

// pedidos de un dueno: lista cerrada, se entregan en la respuesta del proximo envio
assert.throws(() => A.request(id, 'rm -rf'), /inválido/);
A.request(id, 'du');
assert.ok(A.info('_host-tienda-ana', true).duPending);
assert.strictEqual(A.push(id, Buffer.from('@@meta\nv=1\nfull=0\n'), ''), 'ok du');
A.push(id, Buffer.from('@@meta\nv=1\n@@du\n2048\t/home/ana\n1024\t/home/ana/mail\n'), '');
const du = A.info('_host-tienda-ana', true);
assert.ok(!du.duPending && du.du.rows[1].path === '~/mail' && du.du.rows[1].size === 1048576);

// persistencia: un proceso nuevo recupera el ultimo estado
const B = new Agents(cfg, {}, new Secrets(cfg), null);
assert.strictEqual(B.get(id).main, 'ana.com');
assert.strictEqual(B.info('_host-tienda-ana', true).errlogs.length, 1);

// cron: variantes
assert.strictEqual(cronRows('@daily /bin/backup.sh')[0].schedule, '@daily');
assert.strictEqual(cronRows('0 3 * * * php /home/a/x.php')[0].secret, false);

A.remove(id);
assert.strictEqual(A.virtual().length, 0);
assert.strictEqual(A.check(cred), null, 'baja: el token deja de valer');

// el script del agente es sh valido y el instalador rechaza direcciones sin https
execFileSync('sh', ['-n', path.join(__dirname, '../agent/agent.sh')]);
execFileSync('sh', ['-n', path.join(__dirname, '../agent/install.sh')]);
let out = '';
try { execFileSync('sh', [path.join(__dirname, '../agent/install.sh'), 'http://evil.com', 'AAAA'], { env: { ...process.env, ATALAYA_AGENT_DIR: path.join(root, 'x') } }); } catch (e) { out = String(e.stdout); }
assert.ok(/Uso:/.test(out), 'solo https');

console.log('ok   agentes de hosting: vinculación, token, envíos, hallazgos, pedidos y persistencia');
fs.rmSync(root, { recursive: true, force: true });
