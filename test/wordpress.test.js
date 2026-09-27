'use strict';
// Plugin de WordPress: .zip valido, sintaxis PHP, y de punta a punta en un WordPress simulado (test/wp/wp-stub.php)
// contra un receptor de agentes real. La parte PHP se salta si la maquina no tiene php.
// Uso: node test/wordpress.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const zlib = require('zlib');
const { execFileSync, spawnSync } = require('child_process');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-wp-'));
  const { zip } = require('../server/zip');
  const { Agents, wpFindings, phpStatus } = require('../server/agents');
  const { Secrets } = require('../server/secrets');

  // hallazgos a partir de lo que envia el plugin
  const now = Date.parse('2026-09-25T12:00:00Z');
  assert.strictEqual(phpStatus('7.4.33', now).level, 'bad');
  assert.strictEqual(phpStatus('8.2.1', now).level, 'warn');
  assert.strictEqual(phpStatus('8.4.0', now).level, 'ok');
  const f = wpFindings({ version: '6.5', coreUpdate: '6.8', php: '8.3.1', plugins: [{ name: 'A', version: '1', active: true, update: '2' }], themes: [], https: true,
    registration: true, defaultRole: 'subscriber', debugDisplay: false, fileEdit: false, xmlrpc: false }, true);
  assert.ok(f.some(x => /versión nueva de WordPress/.test(x.text)) && f.some(x => /A 1 → 2/.test(x.text)));
  assert.ok(f.some(x => x.level === 'info' && /registro de usuarios está abierto/.test(x.text)), 'registro abierto como suscriptor: solo aviso');
  assert.ok(!wpFindings({ plugins: [{ name: 'Secreto', update: '2' }] }, false)[0].text.includes('Secreto'), 'en público sin nombres de plugins');

  // .zip del plugin
  const dir = path.join(__dirname, '../wordpress/atalaya-agent');
  const files = fs.readdirSync(dir).map(n => ({ name: 'atalaya-agent/' + n, data: fs.readFileSync(path.join(dir, n)) }));
  const zf = path.join(root, 'p.zip');
  fs.writeFileSync(zf, zip(files));
  if (spawnSync('unzip', ['-v']).status === 0) execFileSync('unzip', ['-tq', zf]);

  const php = spawnSync('php', ['-v']).status === 0;
  if (!php) { console.log('ok   wordpress: hallazgos y .zip (sin php: se salta la prueba del plugin)'); return; }
  for (const n of ['atalaya-agent.php', 'uninstall.php']) execFileSync('php', ['-l', path.join(dir, n)], { stdio: 'ignore' });

  // receptor real de agentes en un puerto local
  const cfg = { stateDir: root, accounts: {} };
  const A = new Agents(cfg, {}, new Secrets(cfg), { onAccess() { }, loadDomains() { } });
  A.spreadMs = 0;
  const srv = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c)).on('end', () => {
      const raw = Buffer.concat(chunks);
      if (req.url === '/api/agent/pair') { const c = A.pair(JSON.parse(raw), '127.0.0.1'); res.writeHead(c ? 200 : 403); return res.end(c || 'no'); }
      const id = A.check(req.headers['x-atalaya-agent']);
      if (!id) { res.writeHead(401); return res.end('token invalido'); }
      res.writeHead(200); res.end(A.push(id, raw, req.headers['content-encoding']));
    });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const { code } = A.create('blog', 'Blog');
  // sitio simulado con el plugin "subido" y su configuracion de vinculacion
  const site = path.join(root, 'site');
  const pdir = path.join(site, 'wp-content/plugins/atalaya-agent');
  fs.mkdirSync(pdir, { recursive: true });
  for (const x of files) fs.writeFileSync(path.join(site, 'wp-content/plugins', x.name), x.data);
  fs.writeFileSync(path.join(pdir, 'atalaya-config.php'), `<?php if (!defined('ABSPATH')) { exit; } return array('url' => '${url}', 'code' => '${code}');`);
  fs.writeFileSync(path.join(site, 'wp-content/debug.log'), 'PHP Warning: x\n');
  const run = act => new Promise((resolve, reject) => require('child_process').execFile('php', [path.join(__dirname, 'wp/wp-stub.php'), site, act], (e, out) => e ? reject(e) : resolve(JSON.parse(out.trim().split('\n').pop()))));
  assert.strictEqual((await run('activate')).paired, true, 'se conecta solo al activarse');
  assert.strictEqual((await run('tick')).error, '');
  const info = A.info('_host-blog', true);
  assert.strictEqual(info.kind, 'wordpress');
  assert.strictEqual(info.wp.version, '6.5.2');
  assert.deepStrictEqual(A.virtual().map(v => v.label), ['WordPress · Blog']);
  assert.deepStrictEqual(A.vhosts().map(v => [v.servername, v.type]), [['blog-ana.com', 'wordpress']]);
  const txt = info.findings.map(x => x.text).join('\n');
  for (const re of [/WP_DEBUG muestra/, /usuario llamado "admin"/, /rol "administrator"/, /debug\.log/, /Akismet 5\.1 → 5\.4/]) assert.ok(re.test(txt), 'falta hallazgo ' + re);
  assert.strictEqual(info.errlogs[0].lastHour, 1);
  A.remove('blog');
  assert.ok(/rechazó el token/.test((await run('tick')).error), 'quitado en Atalaya: el plugin lo avisa');
  assert.strictEqual((await run('uninstall')).paired, false, 'al desinstalar no deja nada');
  srv.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('ok   wordpress: .zip, sintaxis, conexión automática, envíos, hallazgos, baja y desinstalación');
})().catch(e => { console.error(e); process.exit(1); });
