'use strict';
// revisiones del servidor: lectura de configuracion, cron y puertos, y que en publico no salgan los detalles
const assert = require('assert');
const H = require('../server/audits/host');
const { makePrivacy } = require('../server/privacy');

assert.deepStrictEqual(H.kv("BACKUPENABLE: 'yes'\nBACKUPDIR: /backup\nUPDATES=daily"), { BACKUPENABLE: 'yes', BACKUPDIR: '/backup', UPDATES: 'daily' });
// las revisiones livianas corren sobre el sistema real sin fallar y con la forma esperada
for (const fn of ['backups', 'mailQueue', 'crons', 'ports']) {
  const r = H[fn]();
  assert.ok(r.id && r.title && Array.isArray(r.items) && Array.isArray(r.findings), fn);
  assert.ok(['ok', 'warn', 'bad', 'unknown'].includes(r.status), fn + ': estado');
  for (const f of r.findings) assert.ok(f.title && f.fix, fn + ': cada hallazgo con su como arreglarlo');
}
const u = H.updates({ tool: 'apt', pending: 90, security: 6, names: ['a', 'b'], t: Date.now() });
assert.ok(u.findings.some(f => /6 actualizaciones de seguridad/.test(f.title)), 'actualizaciones de seguridad');
assert.strictEqual(H.updates(null).items.find(i => i.label === 'Paquetes por actualizar').value, 'sin revisar');

// en publico: estado y cifras, pero no los hallazgos ni las filas (puertos, comandos)
const cfg = { accounts: {}, public: {}, apps: {} };
const pv = makePrivacy(cfg);
const result = { t: Date.now(), sections: [{ id: 'cron', title: 'Tareas cron', icon: 'clock', status: 'bad', items: [{ label: 'Tareas', value: '3' }],
  findings: [{ sev: 'bad', title: 'secreto', detail: 'x', fix: 'y', rows: [{ user: 'ana', schedule: '* * * * *', command: 'curl -H "Authorization: Bearer abc"' }] }] }] };
const ctx = { hostAudit: { get: () => result }, jobs: { busy: () => null } };
const pub = pv.detail(ctx, 'audit', 'all', false), priv = pv.detail(ctx, 'audit', 'all', true);
assert.strictEqual(pub.kind, 'audit');
assert.deepStrictEqual(pub.sections[0].findings, [{ sev: 'bad' }], 'en publico solo la gravedad');
assert.strictEqual(priv.sections[0].findings[0].rows[0].user, 'ana', 'en privado, las filas');
assert.ok(!/abc/.test(JSON.stringify(priv)), 'aun en privado se tapan los tokens');
console.log('ok   revisiones del servidor: respaldos, actualizaciones, correo, cron y puertos; en publico sin detalles');
process.exit(0);
