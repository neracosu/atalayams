'use strict';
// Archivos expuestos: reproduce el caso tipico. El sitio tapa su .git para el dominio
// principal pero lo sirve por mail.dominio y por la IP; la revision diaria tiene que encontrarlo igual.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const { ExposureAudit, findSensitive } = require('../server/audits/exposure');

const T = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-exp-'));
const root = path.join(T, 'public_html');
fs.mkdirSync(path.join(root, '.git'), { recursive: true });
fs.mkdirSync(path.join(root, 'tienda', '.git'), { recursive: true });
fs.mkdirSync(path.join(root, 'node_modules', 'x', '.git'), { recursive: true });
fs.writeFileSync(path.join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
fs.writeFileSync(path.join(root, 'tienda', '.git', 'HEAD'), 'ref: refs/heads/main\n');
fs.writeFileSync(path.join(root, 'node_modules', 'x', '.git', 'HEAD'), 'ref: refs/heads/main\n');
fs.writeFileSync(path.join(root, '.env'), 'APP_KEY=secreto\nDB_PASSWORD=otro\n');
fs.writeFileSync(path.join(root, '.env.example'), 'APP_KEY=\n');

const found = findSensitive(root).map(f => path.relative(root, f)).sort();
assert.deepStrictEqual(found, ['.env', '.git/HEAD', 'tienda/.git/HEAD'], 'sin node_modules ni .env.example: ' + found);
console.log('ok   expuestos: encuentra .git y .env en los docroots (sin node_modules ni ejemplos)');

execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', '/CN=localhost', '-keyout', path.join(T, 'k.pem'), '-out', path.join(T, 'c.pem')], { stdio: 'ignore' });
// servidor de prueba: el dominio principal tapa lo oculto; mail. sirve el docroot entero (el bypass real)
const srv = https.createServer({ key: fs.readFileSync(path.join(T, 'k.pem')), cert: fs.readFileSync(path.join(T, 'c.pem')) }, (req, res) => {
  const host = String(req.headers.host || '');
  const file = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (host === 'ana.dev' && /\/\./.test(req.url)) { res.writeHead(403); return res.end('prohibido'); }
  if (host === 'mail.ana.dev' && file.startsWith(root) && fs.existsSync(file) && fs.statSync(file).isFile()) { res.writeHead(200, { 'Content-Type': 'text/plain' }); return res.end(fs.readFileSync(file)); }
  res.writeHead(404); res.end('no');
});
srv.listen(0, '127.0.0.1', async () => {
  try {
    const platform = { panel: { vhosts: () => [{ servername: 'ana.dev', aliases: ['www.ana.dev', 'mail.ana.dev'], docroot: root, account: 'ana' }] } };
    const E = new ExposureAudit({ stateDir: T }, platform);
    E.port = srv.address().port;
    const r = await E.scan();
    const names = [...new Set(r.exposed.map(e => e.name))];
    assert.deepStrictEqual(names, ['mail.ana.dev'], 'solo el alias sirve los archivos: ' + JSON.stringify(r.exposed));
    assert.deepStrictEqual(r.exposed.map(e => e.path).sort(), ['/.env', '/.git/HEAD', '/tienda/.git/HEAD']);
    const s = E.section();
    assert.strictEqual(s.status, 'bad');
    assert.ok(s.findings.some(f => /repositorio por 1 nombre/.test(f.title) && f.names.includes('mail.ana.dev')));
    assert.ok(!JSON.stringify(r).includes('DB_PASSWORD=otro'), 'el contenido no se guarda');
    console.log('ok   expuestos: el .git tapado en el dominio pero servido por mail. se detecta');
  } catch (e) { console.error(e); process.exitCode = 1; }
  finally { srv.close(); fs.rmSync(T, { recursive: true, force: true }); }
});
