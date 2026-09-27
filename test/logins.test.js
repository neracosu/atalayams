'use strict';
// Accesos a los paneles: contrasenas equivocadas (sin contar escaneres), entradas desde IPs nuevas, la contrasena
// adivinada (entro despues de fallar) y el aviso por Telegram/correo.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { LoginAudit, parseFailed, parseSessions } = require('../server/audits/logins');
const { Alerts } = require('../server/alerts');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-logins-'));
const logs = path.join(base, 'logs'), state = path.join(base, 'state');
fs.mkdirSync(logs); fs.mkdirSync(state);
const now = Date.now();
const d = t => { const x = new Date(t); const p = n => String(n).padStart(2, '0'); return `[${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())} ${p(x.getUTCHours())}:${p(x.getUTCMinutes())}:${p(x.getUTCSeconds())} +0000]`; };
const fail = (t, ip, user, svc = 'whostmgrd') => `${d(t)} info [${svc}] ${ip} - ${user} "POST /login/?login_only=1 HTTP/1.1" FAILED LOGIN ${svc}: user password incorrect`;
const scan = (t, ip) => `${d(t)} info [cpaneld] ${ip} - - "GET /wp-login.php HTTP/1.1" FAILED LOGIN cpaneld: login attempt without username`;
const sess = (t, ip, user, svc = 'cpaneld', method = 'handle_form_login', creator = user) => `${d(t)} info [${svc}] ${ip} NEW ${user}:AbCdEf address=${ip},app=${svc},creator=${creator},method=${method},path=form,possessed=0`;

const lines = [];
for (let i = 0; i < 40; i++) lines.push(fail(now - 3 * 86400000 + i * 60000, `203.0.113.${i % 30}`, 'root'));
lines.push(fail(now - 20 * 86400000, '203.0.113.99', 'root')); // de hace 20 dias: no cuenta
for (let i = 0; i < 3; i++) lines.push(fail(now - 2 * 86400000 + i * 1000, '203.0.113.5', 'root'));
for (let i = 0; i < 5; i++) lines.push(scan(now - 86400000, '198.51.100.7'));
fs.writeFileSync(path.join(logs, 'login_log'), lines.join('\n') + '\n');
fs.writeFileSync(path.join(logs, 'session_log'), [
  sess(now - 10 * 86400000, '192.0.2.10', 'ana'),
  sess(now - 9 * 86400000, '192.0.2.10', 'root', 'whostmgrd'),
  sess(now - 8 * 86400000, '192.0.2.10', 'ana', 'cpaneld', 'create_user_session', 'root'), // root abriendo el cPanel de ana
  sess(now - 7 * 86400000, '192.0.2.10', 'ana', 'cpaneld', 'handle_auth_transfer'), // cambio de servicio: no cuenta
].join('\n') + '\n');
fs.writeFileSync(path.join(base, 'tfa.json'), JSON.stringify({ root: { secret: 'x' } }));

const f = parseFailed(fs.readFileSync(path.join(logs, 'login_log'), 'utf8'), now - 7 * 86400000);
assert.strictEqual(f.length, 43, 'solo las contraseñas de esta semana');
assert.strictEqual(f.scans, 5, 'los escáneres se cuentan aparte');
const s = parseSessions(fs.readFileSync(path.join(logs, 'session_log'), 'utf8'), now - 30 * 86400000);
assert.strictEqual(s.length, 3); assert.strictEqual(s[2].via, 'root');

const bus = new EventEmitter(), evs = [];
bus.on('ev', e => evs.push(e));
const opts = { logDir: logs, tfaFile: path.join(base, 'tfa.json') };
const a = new LoginAudit({ stateDir: state, edition: 'vps' }, bus, opts);
a.refresh();
assert.strictEqual(evs.length, 0, 'la primera pasada aprende las IPs sin avisar');
let sec = a.section();
assert.strictEqual(sec.status, 'warn');
const brute = sec.findings.find(x => /43 contraseñas equivocadas/.test(x.title));
assert.ok(brute && /repartido/.test(brute.fix) && /dos pasos/.test(brute.detail), 'ataque repartido y root con dos pasos');
assert.ok(sec.findings.some(x => x.sev === 'info' && x.rows.length === 2), 'últimas entradas (sin la de root desde WHM)');

// una IP conocida no avisa; una nueva si; una que venia fallando es grave
fs.appendFileSync(path.join(logs, 'session_log'), [sess(now - 60000, '192.0.2.10', 'ana'), sess(now - 50000, '192.0.2.44', 'ana'), sess(now - 40000, '203.0.113.5', 'root', 'whostmgrd')].join('\n') + '\n');
a.refresh();
assert.deepStrictEqual(evs.map(e => [e.action, e.ip]), [['new', '192.0.2.44'], ['guessed', '203.0.113.5']]);
sec = a.section();
assert.strictEqual(sec.status, 'bad');
assert.ok(sec.findings.some(x => x.sev === 'bad' && /venía fallando/.test(x.title)));
assert.ok(a.ofIp('203.0.113.5').failed >= 1 && a.ofIp('203.0.113.5').logins.length === 1, 'expediente de la IP');
// al reiniciar no repite
const b = new LoginAudit({ stateDir: state, edition: 'vps' }, bus, opts);
b.refresh();
assert.strictEqual(evs.length, 2, 'no repite tras reiniciar');

const al = new Alerts({ stateDir: state }, new EventEmitter());
const m = al.alertOf(evs[1]);
assert.strictEqual(m.cat, 'security'); assert.ok(/\[SEGURIDAD\].*root.*WHM.*203\.0\.113\.5/.test(m.text)); assert.strictEqual(m.go, 'prisoner:203.0.113.5');
assert.ok(/\[ACCESO\]/.test(al.alertOf(evs[0]).text));

fs.rmSync(base, { recursive: true, force: true });
console.log('logins: ok');
