'use strict';
// Cuotas por cuenta: lee lo que cPanel ya calcula (repquota.cache, bandwidth.cache, BWLIMIT) y marca al 85 %.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { QuotaAudit } = require('../server/audits/quotas');

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-quota-'));
fs.writeFileSync(path.join(base, 'repquota.cache'), `*** Report for user quotas on device /dev/sda3
User            used    soft    hard  grace    used  soft  hard  grace
----------------------------------------------------------------------
root      -- 275932488       0       0         306425     0     0
ana       +- 9500000 9000000 10000000  6days    1200     0     0
beto      --  1000000       0       0         620000     0     0
`);
fs.mkdirSync(path.join(base, 'bandwidth.cache')); fs.mkdirSync(path.join(base, 'users'));
fs.writeFileSync(path.join(base, 'bandwidth.cache', 'ana'), '100');
fs.writeFileSync(path.join(base, 'bandwidth.cache', 'beto'), String(96 * 1073741824));
fs.writeFileSync(path.join(base, 'users', 'ana'), 'BWLIMIT=0\n');
fs.writeFileSync(path.join(base, 'users', 'beto'), `PLAN=x\nBWLIMIT=${100 * 1073741824}\n`);
const Q = new QuotaAudit({ edition: 'vps', accounts: { ana: {}, beto: {}, carla: {} } }, { base });
const r = Q.read();
assert.ok(Math.abs(r.ana.disk.pct - 0.95) < 0.001 && r.ana.disk.limit === 10000000 * 1024);
assert.ok(!r.carla, 'una cuenta sin datos de cuota no aparece');
assert.deepStrictEqual(Q.alert('ana'), { what: 'disco', pct: 95, level: 'bad' });
assert.deepStrictEqual(Q.alert('beto'), { what: 'ancho de banda', pct: 96, level: 'bad' });
const sec = Q.section();
assert.ok(sec.status === 'bad' && sec.findings.some(f => /ana: disco al 95/.test(f.title)) && sec.findings.some(f => /beto: ancho de banda al 96/.test(f.title)));
assert.ok(sec.findings.some(f => /beto: 620\.000 archivos/.test(f.title)), 'muchos inodos sin límite: aviso informativo');
console.log('ok   cuotas: disco, inodos y ancho de banda por cuenta; aviso al 85 % y muchos inodos');
fs.rmSync(base, { recursive: true, force: true });

// cron que produce salida seguido (correo «Cron <usuario@host> comando» en el registro de Exim)
{
  const { cronMails } = require('../server/audits/host');
  const f = path.join(os.tmpdir(), 'atalaya-exim-' + process.pid);
  const d = x => new Date(Date.now() - x * 86400000).toISOString().slice(0, 19).replace('T', ' ');
  fs.writeFileSync(f, [
    `${d(1)} 1abc <= ana@srv U=ana P=local S=700 T="Cron <ana@srv> php /home/ana/public_html/cron.php" for ana`,
    `${d(2)} 1abd <= ana@srv U=ana P=local S=700 T="Cron <ana@srv> php /home/ana/public_html/cron.php" for ana`,
    `${d(3)} 1abe <= beto@srv U=beto P=local S=700 T="Cron <beto@srv> /bin/true" for beto`,
    `${d(10)} 1abf <= ana@srv U=ana P=local S=700 T="Cron <ana@srv> viejo" for ana`,
    `${d(1)} 1abg <= info@sitio.com U=ana P=local S=900 T="Hola" for x@y.com`, ''].join('\n'));
  const r = cronMails(f);
  assert.deepStrictEqual(r.map(x => [x.user, x.n, x.command]), [['ana', 2, 'php /home/ana/public_html/cron.php']], 'solo las que se repiten en 7 días');
  fs.rmSync(f);
  console.log('ok   cron: las tareas que producen salida seguido (posible error), del registro de Exim');
}
