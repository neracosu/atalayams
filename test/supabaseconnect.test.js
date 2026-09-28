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
  for (const v of ['postgresql://postgres:clave@db.abcdefghijklmnopqrst.supabase.co:5432/postgres', 'db.abcdefghijklmnopqrst.supabase.co', 'postgresql://postgres.abcdefghijklmnopqrst:clave@aws-0-us-east-1.pooler.supabase.com:6543/postgres'])
    assert.strictEqual(refOf(v), 'abcdefghijklmnopqrst', v);
  for (const v of ['Project ID: abcdefghijklmnopqrst', '"abcdefghijklmnopqrst"', 'abcdefghijklmnopqrst.', 'ABCDEFGHIJKLMNOPQRST ']) assert.strictEqual(refOf(v), 'abcdefghijklmnopqrst', v);
  for (const v of ['', 'mi base', 'https://ejemplo.com', 'abc', 'evil.com/#', '127.0.0.1', 'abcdefghij@evil.com', 'evil.com/abcdefghijklmnop.supabase.co']) assert.strictEqual(refOf(v), null, v);
  // lo unico que sale es el codigo: la conexion va siempre a <codigo>.supabase.co, nunca a lo que venga detras
  assert.strictEqual(refOf('abcdefghijklmnop.supabase.co.evil.com/x'), 'abcdefghijklmnop');
  assert.strictEqual(keyKind('sb_secret_abc'), 'secret'); assert.strictEqual(keyKind('sb_publishable_abc'), 'public');
  assert.strictEqual(keyKind(jwt('service_role')), 'secret'); assert.strictEqual(keyKind(jwt('anon')), 'public'); assert.strictEqual(keyKind(''), 'none');

  await assert.rejects(verify({ ref: 'mi base', serviceKey: 'sb_secret_x' }), /parece el nombre del proyecto/);
  await assert.rejects(verify({ ref: '', serviceKey: 'sb_secret_x' }), /Falta el ID del proyecto/);
  await assert.rejects(verify({ ref: 'sb_secret_abc', serviceKey: 'sb_secret_x' }), /pegó una llave/);
  await assert.rejects(verify({ ref: jwt('service_role'), serviceKey: '' }), /pegó una llave/);
  await assert.rejects(verify({ ref: 'https://ejemplo.com/x', serviceKey: 'sb_secret_x' }), /No reconozco eso como un proyecto/);
  await assert.rejects(verify({ ref: 'abcdefghijklmnopqrst', serviceKey: '' }), /Falta la llave secreta/);
  await assert.rejects(verify({ ref: 'abcdefghijklmnopqrst', serviceKey: jwt('anon') }), /llave pública/);
  answer = 401; await assert.rejects(verify({ ref: 'abcdefghijklmnopqrst', serviceKey: 'sb_secret_x' }), /rechazó la llave/);
  answer = 503; await assert.rejects(verify({ ref: 'abcdefghijklmnopqrst', serviceKey: 'sb_secret_x' }), /puede estar pausado/);
  answer = 200;
  assert.deepStrictEqual(await verify({ ref: 'https://abcdefghijklmnopqrst.supabase.co', serviceKey: ' sb_secret_x ', name: ' Base de la  tienda ' }), { ref: 'abcdefghijklmnopqrst', serviceKey: 'sb_secret_x', name: 'Base de la tienda' });
  // el correo del proyecto: solo una lista cerrada de campos, nunca el usuario ni la contrasena del SMTP
  const { mailOf, discover } = require('../server/connectors/supabase');
  let m = mailOf({ smtp_host: 'live.smtp.mailtrap.io', smtp_port: '587', smtp_user: 'api', smtp_pass: 'CLAVE-SECRETA', smtp_admin_email: 'avisos@tienda.com', smtp_sender_name: 'La Tienda', rate_limit_email_sent: 100, smtp_max_frequency: 60, mailer_autoconfirm: false });
  assert.strictEqual(m.provider, 'Mailtrap'); assert.strictEqual(m.sandbox, false); assert.strictEqual(m.custom, true); assert.strictEqual(m.perHour, 100); assert.strictEqual(m.confirm, true);
  assert.deepStrictEqual(m.findings, []);
  assert.ok(!JSON.stringify(m).includes('CLAVE-SECRETA') && !('user' in m) && !('pass' in m));
  m = mailOf({ smtp_host: 'sandbox.smtp.mailtrap.io', smtp_port: 2525, smtp_admin_email: 'a@b.com' });
  assert.strictEqual(m.sandbox, true); assert.deepStrictEqual(m.findings.map(f => f.level), ['bad'], 'el buzon de pruebas no entrega a nadie');
  m = mailOf({ smtp_host: '', mailer_autoconfirm: true });
  assert.strictEqual(m.custom, false); assert.strictEqual(m.provider, 'Correo de prueba de Supabase'); assert.deepStrictEqual(m.findings.map(f => f.level), ['warn', 'info']);
  assert.strictEqual(mailOf({ smtp_host: 'smtp.resend.com' }).provider, 'Resend'); assert.strictEqual(mailOf({ smtp_host: 'mail.miempresa.com' }).provider, 'Servidor propio');
  assert.strictEqual(mailOf(null), null);

  // con el token de la cuenta: todos los proyectos de una vez
  let keysFor = ref => [{ name: 'anon', api_key: jwt('anon') }, { name: 'service_role', api_key: jwt('service_role') }, { name: 'default', type: 'secret', api_key: 'sb_secret_' + ref }];
  const seen = [];
  const mg = await new Promise(r => { const s = http.createServer((req, res) => { seen.push(req.method + ' ' + req.url);
    if (req.headers.authorization !== 'Bearer sbp_' + 'a'.repeat(40)) { res.statusCode = 401; return res.end('{}'); }
    if (req.url === '/v1/projects') return res.end(JSON.stringify([{ id: 'aaaaaaaaaaaaaaaaaaaa', name: 'Tienda', status: 'ACTIVE_HEALTHY' }, { id: 'bbbbbbbbbbbbbbbbbbbb', name: 'Panel', status: 'INACTIVE' }, { id: 'cccccccccccccccccccc', name: 'Sin llave', status: 'ACTIVE_HEALTHY' }]));
    const k = /^\/v1\/projects\/([a-z]{20})\/api-keys\?reveal=true$/.exec(req.url);
    if (k) return res.end(JSON.stringify(k[1][0] === 'c' ? [{ name: 'anon', api_key: jwt('anon') }] : keysFor(k[1])));
    res.statusCode = 404; res.end('{}'); }).listen(0, '127.0.0.1', () => r(s)); });
  process.env.ATALAYA_SUPABASE_API = `http://127.0.0.1:${mg.address().port}`;
  delete require.cache[require.resolve('../server/connectors/supabase')];
  const SB = require('../server/connectors/supabase');
  await assert.rejects(SB.discover('corto'), /no parece un token de cuenta/);
  await assert.rejects(SB.discover('sb_secret_' + 'x'.repeat(30)), /llave de un proyecto/);
  await assert.rejects(SB.discover('sbp_' + 'z'.repeat(40)), /rechazó el token de la cuenta/);
  const found = await SB.discover('sbp_' + 'a'.repeat(40));
  assert.deepStrictEqual(found.map(x => [x.name, !!x.serviceKey]), [['Tienda', true], ['Panel', false], ['Sin llave', false]]);
  assert.strictEqual(found[0].serviceKey, 'sb_secret_aaaaaaaaaaaaaaaaaaaa', 'entre las llaves secretas se prefiere la nueva');
  assert.match(found[1].error, /pausado/); assert.match(found[2].error, /no entregó la llave secreta/);
  assert.ok(seen.every(x => x.startsWith('GET ')), 'con el token de la cuenta solo se lee');
  mg.close();
  // un conector sin proyectos no se da por bueno
  const { SupabaseConnector } = require('../server/connectors/supabase');
  assert.match(new SupabaseConnector({ id: 'x', projects: [] }, { emit() { } }).info().error, /No tiene ningún proyecto/);
  srv.close();
  console.log('supabaseconnect.test.js OK');
})().catch(e => { console.error(e); process.exit(1); });
