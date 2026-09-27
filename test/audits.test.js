'use strict';
// Auditoria de bases de datos: lectura del datadir, dueno por prefijo, "quien la usa" y hallazgos.
// Uso: node test/audits.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-aud-'));
const w = (p, t, ageDays = 0) => {
  const f = path.join(root, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, t);
  if (ageDays) { const d = new Date(Date.now() - ageDays * 86400000); fs.utimesSync(f, d, d); }
};
const MB = n => Buffer.alloc(n * 1048576);

// datadir: una base de WordPress con una tabla inflada, una usada desde ~/.config, una huerfana vieja y una shadow
w('mysql/ana_wp/db.opt', '');
w('mysql/ana_wp/wp_posts.ibd', MB(2));
w('mysql/ana_wp/wp_actionscheduler_logs.ibd', MB(25));
w('mysql/ana_wp/old_stats.MYD', MB(1));
w('mysql/ana_api/db.opt', '');
w('mysql/ana_api/User.ibd', MB(1));
w('mysql/ana_viejo/db.opt', '', 200);
w('mysql/ana_viejo/t.ibd', MB(1), 200);
w('mysql/ana_api_shadow/db.opt', '', 30);
w('mysql/mysql/user.MYD', 'x');
w('mysql/sin@002ddueno/db.opt', '');
// home de la cuenta
w('home/ana/public_html/wp-config.php', "define('DB_NAME', 'ana_wp');");
w('home/ana/.config/api/env', 'DATABASE_URL=mysql://u@localhost/ana_api');
w('home/ana/.config/api/env.bak-2026', 'DATABASE_URL=mysql://u@localhost/ana_viejo');
w('home/ana/.claude/projects/x.jsonl', 'ana_viejo');
w('home/ana/node_modules/pkg/config.json', '{"db":"ana_viejo"}');
w('home/ana/public_html/config.php', '$db = "ana_viejo_2";'); // otra base con prefijo: no debe contar

const { DatabaseAudit } = require('../server/audits/databases');
const cfg = { accounts: { ana: { label: 'ana' } }, stateDir: path.join(root, 'state'), mysql: { datadir: path.join(root, 'mysql') }, homeRoot: path.join(root, 'home') };
const logs = { groups: new Map([['g1', { account: 'ana', domain: 'ana.com', app: null, docroot: path.join(root, 'home/ana/public_html') }]]) };
const A = new DatabaseAudit(cfg, logs);

const list = A.list();
const by = n => list.find(d => d.name === n);
assert.ok(by('mysql').system, 'mysql es de sistema');
assert.strictEqual(by('ana_wp').account, 'ana');
assert.strictEqual(by('sin-dueno').account, null, 'nombre decodificado y sin cuenta');
assert.strictEqual(by('ana_wp').tables, 3);
assert.ok(by('ana_api_shadow').shadow);
assert.strictEqual(list[0].name, 'ana_wp', 'ordenadas por tamano');

const wp = A.analyze('ana_wp');
assert.deepStrictEqual(wp.users.map(u => u.domain), ['ana.com'], 'wp-config del docroot');
assert.ok(wp.findings.some(f => /actionscheduler/.test(f.text)), 'tabla inflada');
assert.ok(wp.findings.some(f => /MyISAM/.test(f.text)));
assert.strictEqual(wp.tables[0].delta, null, 'sin auditoria previa no hay delta');
w('mysql/ana_wp/wp_posts.ibd', MB(3));
assert.strictEqual(A.analyze('ana_wp').tables.find(t => t.name === 'wp_posts').delta, 1048576, 'compara con la foto anterior');
assert.ok(A.lastResult('ana_wp').findings.length, 'guarda el ultimo resultado');

const api = A.analyze('ana_api');
assert.deepStrictEqual(api.users.map(u => [u.file, u.project]), [['~/.config/api/env', 'api']], 'secretos fuera del docroot');

const viejo = A.analyze('ana_viejo');
assert.strictEqual(viejo.users.length, 0, 'no cuentan .bak, transcripciones de Claude, node_modules ni nombres mas largos');
assert.ok(viejo.findings.some(f => f.level === 'warn' && /huérfana/.test(f.text) && /Revise/.test(f.text)), 'huerfana solo como sospecha');

const sh = A.analyze('ana_api_shadow');
assert.ok(sh.findings.some(f => /shadow/.test(f.text)));

assert.throws(() => A.analyze('../etc'), /No existe/);
console.log('ok   auditoría de bases: datadir, dueño, quién la usa, hallazgos e historial');
fs.rmSync(root, { recursive: true, force: true });
