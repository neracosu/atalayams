'use strict';
// Kit de temas: se exporta completo, el simulador arranca, lista los temas, transmite estado en vivo
// (en modo publico) y los escenarios funcionan. Uso: node test/kit.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync, spawn } = require('child_process');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-kit-'));
  // un tema "de la comunidad" que ya estaba en el kit debe sobrevivir a la exportacion
  fs.mkdirSync(path.join(dir, 'web/themes/comunidad'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'web/themes/comunidad/theme.json'), '{"id":"comunidad"}');
  execFileSync(process.execPath, [path.join(__dirname, '../scripts/export-kit.js'), dir]);
  for (const f of ['README.md', 'package.json', 'sim/server.js', 'sim/recording.jsonl', 'sim/details.json', 'docs/TEMAS.md', 'test/themes.test.js', 'web/index.html', 'web/themes/villa/theme.json', 'web/themes/comunidad/theme.json'])
    assert.ok(fs.existsSync(path.join(dir, f)), 'falta ' + f);
  for (const f of ['web/setup.html', 'web/login.html', 'web/js/setup.js']) assert.ok(!fs.existsSync(path.join(dir, f)), 'no deberia estar ' + f);
  // la grabacion es publica
  const rec = fs.readFileSync(path.join(dir, 'sim/recording.jsonl'), 'utf8');
  assert.ok(!rec.includes('"priv":true'), 'grabacion en modo publico');
  assert.ok(!/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/.test(rec.replace(/"(version|v)":"[^"]*"/g, '')), 'sin IPs');
  const port = require('./puerto')();
  const p = spawn(process.execPath, [path.join(dir, 'sim/server.js'), `--port=${port}`, '--speed=20'], { stdio: 'pipe' });
  await new Promise(r => p.stdout.once('data', r));
  const B = `http://127.0.0.1:${port}`;
  const th = await (await fetch(B + '/api/themes')).json();
  assert.ok(['ciudad', 'ops', 'villa'].every(id => th.themes.some(t => t.id === id)));
  assert.ok((await fetch(B + '/?theme=villa')).ok);
  assert.strictEqual((await fetch(B + '/themes/villa/world.js')).status, 200);
  // todo modulo que importe la interfaz tiene que estar en el kit
  const js = fs.readdirSync(path.join(dir, 'web/js')).filter(f => f.endsWith('.js'));
  for (const f of js) for (const m of fs.readFileSync(path.join(dir, 'web/js', f), 'utf8').matchAll(/from '\.\/([\w.-]+\.js)'/g)) assert.ok(js.includes(m[1]), `${f} importa ${m[1]}, que falta en el kit`);
  // stream: hello y al menos un estado
  const ctl = new AbortController();
  const res = await fetch(B + '/api/stream', { signal: ctl.signal });
  let buf = '', got = new Set();
  const dec = new TextDecoder();
  const t0 = Date.now();
  for await (const c of res.body) { buf += dec.decode(c); for (const m of buf.matchAll(/event: (\w+)/g)) got.add(m[1]); if ((got.has('state') && got.has('hello')) || Date.now() - t0 > 8000) break; }
  ctl.abort();
  assert.ok(got.has('hello') && got.has('state'), 'stream con hello y estado: ' + [...got]);
  assert.ok(/Se cayó|No hay/.test(await (await fetch(B + '/sim/caida', { method: 'POST' })).text()));
  assert.strictEqual((await fetch(B + '/api/private', { method: 'POST' })).status, 403, 'nada privado en el simulador');
  p.kill();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ok   kit de temas: exportación, simulador, temas, stream público y escenarios');
})().catch(e => { console.error(e); process.exit(1); });
