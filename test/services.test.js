'use strict';
// Certificados y servicios: vencimientos, autofirmados, alias de dominios adicionales, servicios que no escuchan,
// reinicios de chkservd y un solo aviso por certificado y nivel.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { EventEmitter } = require('events');
const { ServiceAudit, chkservdRestarts, covers } = require('../server/audits/services');
const { Alerts } = require('../server/alerts');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-svc-'));
const ssl = path.join(base, 'ssl'), state = path.join(base, 'state');
fs.mkdirSync(path.join(ssl, 'apache_tls'), { recursive: true }); fs.mkdirSync(state);

let haveOpenssl = true;
function cert(domain, days) {
  const dir = path.join(ssl, 'apache_tls', domain); fs.mkdirSync(dir, { recursive: true });
  const key = path.join(base, 'k.pem'), out = path.join(dir, 'certificates');
  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', out, '-days', String(days), '-subj', `/CN=${domain}`, '-addext', `subjectAltName=DNS:${domain}`], { stdio: 'ignore' });
  fs.unlinkSync(key);
}
try {
  cert('pronto.com', 5);
  cert('bien.com', 80);
  cert('bien.com.principal.com', 3); // alias de dominio adicional: no se revisa
  cert('huerfano.com', 2); // ya no pertenece a ninguna cuenta: no se revisa
} catch { haveOpenssl = false; }

fs.writeFileSync(path.join(base, 'userdomains'), 'pronto.com: ana\nbien.com: beto\nprincipal.com: beto\nbien.com.principal.com: beto\n*: nobody\n');
const now = Date.now();
fs.writeFileSync(path.join(ssl, 'ftp-NOT_AFTER'), String(Math.floor((now - 3 * 86400000) / 1000)));
fs.writeFileSync(path.join(ssl, 'exim-NOT_AFTER'), String(Math.floor((now + 4 * 86400000) / 1000)));
fs.writeFileSync(path.join(ssl, 'exim-CN'), 'servidor.ejemplo.com');

// chkservd: dos reinicios de httpd esta semana, uno de mysql hace un mes
const d = t => { const x = new Date(t); const p = n => String(n).padStart(2, '0'); return `${x.getUTCFullYear()}-${p(x.getUTCMonth() + 1)}-${p(x.getUTCDate())} ${p(x.getUTCHours())}:${p(x.getUTCMinutes())}:${p(x.getUTCSeconds())} +0000`; };
const log = path.join(base, 'chkservd.log');
fs.writeFileSync(log, [
  `[${d(now - 30 * 86400000)}] Service check ....`, 'mysql [[check command:-][fail count:1]Restarting mysql....',
  `[${d(now - 2 * 86400000)}] Service check ....`, 'Timeout while trying to get data from service: Died[check command:N/A][fail count:1]Restarting httpd....',
  `[${d(now - 3600000)}] Service check ....`, 'Timeout while trying to get data from service: Died[check command:N/A][fail count:1]Restarting httpd....',
  'sshd [[check command:+]]...', ''].join('\n'));

(async () => {
  const r = chkservdRestarts(log);
  assert.strictEqual(r.httpd.n, 2, 'dos reinicios de Apache');
  assert.ok(!r.mysql, 'el de hace un mes no cuenta');
  assert.ok(covers({ subjectAltName: 'DNS:*.ejemplo.com' }, 'a.ejemplo.com') && !covers({ subjectAltName: 'DNS:*.ejemplo.com' }, 'a.b.ejemplo.com'));

  const bus = new EventEmitter(), evs = [];
  bus.on('ev', e => evs.push(e));
  const a = new ServiceAudit({ stateDir: state, edition: 'vps' }, bus, { sslBase: ssl, userdomains: path.join(base, 'userdomains'), chkservd: log, systemd: false, ports: new Set([25, 465, 2083]) });
  await a.refresh();
  const s = a.section();
  const titles = s.findings.map(f => f.title);
  assert.ok(titles.some(t => /Apache se reinició solo 2 veces/.test(t)), 'avisa los reinicios de Apache');
  assert.ok(!titles.some(t => /FTP/.test(t)), 'FTP no escucha: su certificado vencido no importa');
  assert.ok(titles.some(t => /correo saliente \(Exim\) vence en [34] días/.test(t)), 'el de Exim vence pronto');
  if (haveOpenssl) {
    assert.ok(titles.some(t => /pronto\.com vence en [45] días/.test(t)), 'pronto.com vence');
    assert.ok(titles.some(t => /pronto\.com usa un certificado autofirmado/.test(t)), 'autofirmado');
    assert.ok(!titles.some(t => /principal\.com|huerfano/.test(t)), 'ni el alias ni el huérfano');
    assert.strictEqual(a.certOf('bien.com').days >= 78, true);
    assert.strictEqual(s.status, 'bad');
  }
  // un aviso por certificado y nivel, recordado entre reinicios
  const certEvs = evs.filter(e => e.kind === 'cert');
  assert.ok(certEvs.some(e => e.service && /Exim/.test(e.service) && e.action === 'bad'));
  const before = evs.length;
  const b = new ServiceAudit({ stateDir: state, edition: 'vps' }, bus, a.opts);
  await b.refresh();
  assert.strictEqual(evs.length, before, 'no repite el aviso tras reiniciar');

  // el aviso de Telegram/correo
  const al = new Alerts({ stateDir: state }, new EventEmitter());
  const m = al.alertOf({ kind: 'cert', action: 'bad', domain: 'pronto.com', days: 5 });
  assert.strictEqual(m.cat, 'down'); assert.ok(/\[CERTIFICADO\].*pronto\.com.*vence en 5/.test(m.text));
  assert.ok(/venció hace 3/.test(al.alertOf({ kind: 'cert', action: 'expired', service: 'FTP', days: -3 }).text));

  fs.rmSync(base, { recursive: true, force: true });
  console.log('services: ok' + (haveOpenssl ? '' : ' (sin openssl: se omitieron los certificados de dominio)'));
})().catch(e => { console.error(e); process.exit(1); });
