'use strict';
// Conectar Supabase: el proyecto se reconoce venga como venga, la llave publica se rechaza con su explicacion y
// la llave se prueba contra el proyecto antes de guardar. Uso: node test/supabaseconnect.test.js
const assert = require('assert');
const http = require('http');

(async () => {
  let answer = 200;
  const srv = await new Promise(r => { const s = http.createServer((req, res) => { res.statusCode = answer; res.end(answer === 200 ? 'node_load1 0.2\n' : ''); }).listen(0, '127.0.0.1', () => r(s)); });
  process.env.ATALAYA_SUPABASE_HOST = `http://127.0.0.1:${srv.address().port}`;
  const { refOf, keyKind, verify } = require('../server/connectors/supabase');
  const jwt = role => 'eyJhbGciOiJIUzI1NiJ9.' + Buffer.from(JSON.stringify({ iss: 'supabase', role })).toString('base64url') + '.firma';

  for (const v of ['abcdefghijklmnopqrst', 'https://abcdefghijklmnopqrst.supabase.co', 'https://abcdefghijklmnopqrst.supabase.co/', ' ABCDEFGHIJKLMNOPQRST.supabase.co/rest/v1/ ', 'https://supabase.com/dashboard/project/abcdefghijklmnopqrst/settings/api'])
    assert.strictEqual(refOf(v), 'abcdefghijklmnopqrst', v);
  for (const v of ['', 'mi base', 'https://ejemplo.com', 'abc', 'evil.com/#', '127.0.0.1', 'abcdefghij@evil.com', 'evil.com/abcdefghijklmnop.supabase.co']) assert.strictEqual(refOf(v), null, v);
  // lo unico que sale es el codigo: la conexion va siempre a <codigo>.supabase.co, nunca a lo que venga detras
  assert.strictEqual(refOf('abcdefghijklmnop.supabase.co.evil.com/x'), 'abcdefghijklmnop');
  assert.strictEqual(keyKind('sb_secret_abc'), 'secret'); assert.strictEqual(keyKind('sb_publishable_abc'), 'public');
  assert.strictEqual(keyKind(jwt('service_role')), 'secret'); assert.strictEqual(keyKind(jwt('anon')), 'public'); assert.strictEqual(keyKind(''), 'none');

  await assert.rejects(verify({ ref: 'mi base', serviceKey: 'sb_secret_x' }), /No reconozco el proyecto/);
  await assert.rejects(verify({ ref: 'abcdefghijklmnopqrst', serviceKey: '' }), /Falta la llave secreta/);
  await assert.rejects(verify({ ref: 'abcdefghijklmnopqrst', serviceKey: jwt('anon') }), /llave pública/);
  answer = 401; await assert.rejects(verify({ ref: 'abcdefghijklmnopqrst', serviceKey: 'sb_secret_x' }), /rechazó la llave/);
  answer = 503; await assert.rejects(verify({ ref: 'abcdefghijklmnopqrst', serviceKey: 'sb_secret_x' }), /puede estar pausado/);
  answer = 200;
  assert.deepStrictEqual(await verify({ ref: 'https://abcdefghijklmnopqrst.supabase.co', serviceKey: ' sb_secret_x ', name: ' Base de la  tienda ' }), { ref: 'abcdefghijklmnopqrst', serviceKey: 'sb_secret_x', name: 'Base de la tienda' });
  // un conector sin proyectos no se da por bueno
  const { SupabaseConnector } = require('../server/connectors/supabase');
  assert.match(new SupabaseConnector({ id: 'x', projects: [] }, { emit() { } }).info().error, /No tiene ningún proyecto/);
  srv.close();
  console.log('supabaseconnect.test.js OK');
})().catch(e => { console.error(e); process.exit(1); });
