'use strict';
// Actividad de bases: consultas sin valores, muestras por base (ocupada %), consultas lentas con su aviso,
// contadores globales y la alerta de conexiones casi agotadas. Usa un cliente mysql falso.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { DbActivity, normalize, parseRows } = require('../server/collectors/dbactivity');

assert.strictEqual(normalize("SELECT * FROM wp_users WHERE user_email = 'ana@correo.com' AND id IN (1, 2, 3) LIMIT 10"),
  'SELECT * FROM wp_users WHERE user_email = ? AND id IN (?…) LIMIT ?');
assert.strictEqual(normalize('UPDATE t SET token="abc\\"def", n=0x1F\\nWHERE id=7'), 'UPDATE t SET token=?, n=? WHERE id=?');
assert.deepStrictEqual(parseRows('1\tana\tNULL\n'), [['1', 'ana', null]]);
console.log('ok   bases: las consultas se guardan sin valores (correos, claves, ids)');

// en algunos servidores /tmp no deja ejecutar: el cliente falso va en ~/.cache
fs.mkdirSync(path.join(os.homedir(), '.cache'), { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.homedir(), '.cache', 'atalaya-dbact-'));
const fake = path.join(tmp, 'mysql');
const state = path.join(tmp, 'state.json');
fs.writeFileSync(fake, `#!/usr/bin/env node
const fs = require('fs'); const st = JSON.parse(fs.readFileSync(${JSON.stringify(state)}, 'utf8'));
const sql = process.argv[process.argv.indexOf('-e') + 1];
if (!process.argv.some(a => a.startsWith('--defaults-file='))) process.exit(3);
if (st.fail) { process.stderr.write("ERROR 1045 (28000): Access denied for user 'atalaya_monitor'\\n"); process.exit(1); }
if (/PROCESSLIST/.test(sql)) process.stdout.write(st.rows.map(r => r.join('\\t')).join('\\n') + '\\n');
else process.stdout.write(Object.entries(st.status).map(([k, v]) => k + '\\t' + v).join('\\n') + '\\nmax_connections\\t' + st.max + '\\n');
`, { mode: 0o755 });
const put = o => fs.writeFileSync(state, JSON.stringify(o));
fs.writeFileSync(path.join(tmp, 'mysql-monitor.cnf'), '[client]\nuser=x\n', { mode: 0o600 });

(async () => {
  const bus = new EventEmitter(); const evs = []; bus.on('ev', e => evs.push(e));
  const dbAudit = { ownerOf: db => db.split('_')[0], usedBy: () => [{ domain: 'tienda.com' }], logs: { sites: [{ id: 'g1', domain: 'tienda.com', account: 'ana' }] } };
  const A = new DbActivity({ stateDir: tmp, edition: 'vps', mysql: { client: fake } }, dbAudit, bus);
  assert.ok(A.available());
  const status = n => ({ Questions: 1000 + n, Com_select: 800 + n, Com_insert: 10, Com_update: 5, Com_delete: 0, Slow_queries: 1, Aborted_connects: 0, Aborted_clients: 0,
    Threads_connected: 130, Threads_running: 3, Max_used_connections: 147, Connection_errors_max_connections: 2, Uptime: 1000 });
  put({ max: 151, status: status(0), rows: [
    [11, 'ana', 'ana_tienda', 'Query', 14, 'Sending data', "SELECT * FROM pedidos WHERE email='x@y.com'"],
    [12, 'ana', 'ana_tienda', 'Sleep', 300, '', 'NULL'],
    [13, 'beto', 'beto_blog', 'Sleep', 5, '', 'NULL'],
    [14, 'root', 'NULL', 'Sleep', 1, '', 'NULL'],
  ] });
  await A.sample(); await A.readStatus();
  put({ max: 151, status: { ...status(300), Uptime: 1030 }, rows: [[13, 'beto', 'beto_blog', 'Sleep', 35, '', 'NULL']] });
  A.prev.t -= 30000;
  await A.sample(); await A.readStatus();
  const s = A.snapshot();
  const t = s.dbs.find(d => d.db === 'ana_tienda');
  assert.strictEqual(t.busy, 50, 'ocupada en 1 de 2 muestras');
  assert.strictEqual(t.peak.time, 14); assert.ok(!t.peak.query.includes('x@y.com'));
  assert.strictEqual(s.dbs.find(d => d.db === 'beto_blog').conns, 1);
  assert.ok(Math.abs(s.rates.qps - 10) < 0.5, 'consultas por segundo: ' + s.rates.qps);
  const slow = evs.filter(e => e.kind === 'db');
  assert.strictEqual(slow.length, 1, 'un solo aviso por consulta lenta');
  assert.deepStrictEqual([slow[0].db, slow[0].secs, slow[0].target], ['ana_tienda', 14, { account: 'ana', site: 'g1' }]);
  const sec = A.section();
  assert.strictEqual(sec.status, 'bad', 'con 130 de 151 conexiones');
  assert.ok(sec.findings.some(f => /casi agotadas/.test(f.title)) && sec.findings.some(f => /rechazadas/.test(f.title)) && sec.findings.some(f => /lentas/.test(f.title)));
  console.log('ok   bases: ocupada %, consulta más lenta, consultas por segundo y un aviso por consulta lenta');
  console.log('ok   bases: conexiones casi agotadas y rechazadas llegan a la Salud del servidor');

  put({ fail: true });
  await A.sample();
  assert.ok(/no tiene acceso/.test(A.snapshot().error));
  fs.rmSync(path.join(tmp, 'mysql-monitor.cnf'));
  assert.ok(!A.available() && A.section() === null, 'sin usuario de monitoreo no hay sección');
  console.log('ok   bases: sin acceso se explica; sin usuario de monitoreo no aparece');

  // privacidad del aviso: en publico sin nombre de base ni consulta
  const { makePrivacy } = require('../server/privacy');
  const P = makePrivacy({ accounts: { ana: { label: 'ana', publicLabel: 'Distrito Norte' } }, public: {}, apps: {}, sites: {}, stateDir: tmp });
  const pub = P.event(slow[0], false);
  assert.ok(pub.site && pub.db.startsWith('b') && !pub.query && !JSON.stringify(pub).includes('ana_tienda'), JSON.stringify(pub));
  assert.ok(P.event(slow[0], true).query.includes('pedidos'));
  console.log('ok   bases: en modo público el aviso va con alias y sin consulta');
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });

// el boton de la ficha pasa por la lista de acciones permitidas del asistente
{
  const src = fs.readFileSync(path.join(__dirname, '../server/setupflow.js'), 'utf8');
  assert.ok(/'mysql-monitor', 'mysql-monitor-off'/.test(src), 'el asistente acepta activar y apagar la actividad de bases');
  const helper = fs.readFileSync(path.join(__dirname, '../server/helper.js'), 'utf8');
  assert.ok(/'mysql-monitor':/.test(helper) && /GRANT PROCESS ON \*\.\*/.test(helper) && !/GRANT (ALL|SELECT)/.test(helper), 'el ayudante da solo PROCESS');
  console.log('ok   bases: el botón llega al ayudante, que da solo el permiso PROCESS');
}
