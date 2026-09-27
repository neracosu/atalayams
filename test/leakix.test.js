'use strict';
// Buscadores de filtraciones: con un LeakIX simulado, la clave invalida se avisa, los hallazgos recientes
// son graves y los viejos para revisar, y el contenido filtrado (que puede traer claves) nunca se guarda.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const now = Date.now();
const srv = http.createServer((req, res) => {
  if (req.headers['api-key'] !== 'buena') { res.writeHead(401); return res.end('{}'); }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  if (req.url.startsWith('/host/')) return res.end(JSON.stringify({ Services: [], Leaks: [
    { event_source: 'GitConfigHttpPlugin', host: 'mail.ana.dev', port: 443, time: new Date(now - 86400000).toISOString(), leak: { severity: 'medium' }, http: { url: 'https://mail.ana.dev' }, summary: 'url = https://ana:ClaveSecreta@gitlab.com/ana/x.git' },
  ] }));
  if (req.url === '/domain/ana.dev') return res.end(JSON.stringify([
    { event_source: 'GitConfigHttpPlugin', host: 'ana.dev', port: 443, time: new Date(now - 2 * 86400000).toISOString() },
    { event_source: 'DotEnvConfigPlugin', host: 'viejo.ana.dev', port: 443, time: new Date(now - 200 * 86400000).toISOString(), summary: 'DB_PASSWORD=otra' },
  ]));
  res.end('[]');
});
srv.listen(0, '127.0.0.1', async () => {
  process.env.ATALAYA_LEAKIX_API = 'http://127.0.0.1:' + srv.address().port;
  const { LeakixAudit } = require('../server/audits/leakix');
  const T = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-lk-'));
  try {
    let key = 'mala';
    const secrets = { connectors: () => [{ id: 'leakix', type: 'leakix', apiKey: key }] };
    const platform = { panel: { vhosts: () => [{ servername: 'ana.dev' }, { servername: 'tienda.ana.dev' }] } };
    const L = new LeakixAudit({ stateDir: T }, secrets, platform);
    let r = await L.check();
    assert.match(r.error, /clave/);
    assert.strictEqual(L.section().status, 'unknown');
    key = 'buena';
    r = await L.check();
    assert.strictEqual(r.error, null);
    assert.strictEqual(r.leaks.length, 3);
    const s = L.section();
    assert.strictEqual(s.status, 'bad', 'un hallazgo de ayer es grave');
    const git = s.findings.find(f => /Repositorio \.git/.test(f.title)), env = s.findings.find(f => /\.env/.test(f.title));
    assert.strictEqual(git.sev, 'bad'); assert.deepStrictEqual(git.names.sort(), ['ana.dev', 'mail.ana.dev']);
    assert.strictEqual(env.sev, 'warn', 'uno de hace 200 dias es para revisar');
    const saved = fs.readFileSync(path.join(T, 'audits', 'leakix.json'), 'utf8');
    assert.ok(!/ClaveSecreta|DB_PASSWORD/.test(saved), 'lo filtrado no se guarda');
    assert.strictEqual(new LeakixAudit({ stateDir: T }, { connectors: () => [] }, platform).section(), null, 'sin clave, la seccion no aparece');
    console.log('ok   leakix: clave invalida avisada, hallazgos recientes graves y viejos para revisar, sin guardar lo filtrado');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { srv.close(); fs.rmSync(T, { recursive: true, force: true }); }
});
