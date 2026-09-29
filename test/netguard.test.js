'use strict';
// Candado de red estricto (server/netguard.js): lo que se revisa siempre, sin mirar la edicion, para las salidas
// que cualquiera puede pedir desde Internet. Sin red real: la resolucion se inyecta.
const assert = require('assert');
const ng = require('../server/netguard');

const bloqueadas = ['127.0.0.1', '127.8.9.10', '10.0.0.1', '10.255.255.255', '172.16.0.1', '172.31.255.254', '192.168.1.1', '169.254.169.254',
  '100.64.0.1', '100.127.255.254', '0.0.0.0', '0.1.2.3', '224.0.0.1', '239.255.255.250', '240.0.0.1', '255.255.255.255',
  '198.18.0.1', '198.19.255.255', '192.0.0.8', '192.0.2.10', '198.51.100.7', '203.0.113.99', '192.88.99.1',
  '::', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:10.0.0.1', '::ffff:169.254.169.254', '::127.0.0.1', '::ffff:0:10.0.0.1',
  '64:ff9b::7f00:1', '64:ff9b::808:808', '64:ff9b:1::1', '2001:db8::1', '2001:db8:ffff::1', '2001::1', '3fff::1', '100::1',
  'fc00::1', 'fd12:3456::1', 'fe80::1', 'fe80::1%eth0', 'febf::1', 'fec0::1', 'ff02::1', '2002:7f00:1::1', '2002:a00:1::1',
  '[::1]', 'no-es-una-ip', ''];
for (const ip of bloqueadas) assert.strictEqual(ng.blockedIpStrict(ip), true, `debe bloquear ${ip}`);
const publicas = ['8.8.8.8', '1.1.1.1', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1', '198.17.255.255', '198.20.0.1',
  '192.0.1.1', '223.255.255.255', '::ffff:8.8.8.8', '2606:4700:4700::1111', '2a00:1450:4001::1', '2002:808:808::1', '2001:4860:4860::8888'];
for (const ip of publicas) assert.strictEqual(ng.blockedIpStrict(ip), false, `no debe bloquear ${ip}`);
console.log('ok   netguard estricto: internas, reservadas, documentación, NAT64 e IPv4 dentro de IPv6');

// IPs propias: por lista, por variable de entorno y por las interfaces de la maquina
assert.strictEqual(ng.blockedIpStrict('8.8.4.4', ['8.8.4.4']), true, 'la IP propia pasada por quien llama');
assert.strictEqual(ng.blockedIpStrict('::ffff:8.8.4.4', ['8.8.4.4']), true, 'la propia tambien en forma IPv6');
assert.strictEqual(ng.blockedIpStrict('2a00:1450:4001:0:0:0:0:1', ['2a00:1450:4001::1']), true, 'IPv6 propia escrita de otra forma');
assert.strictEqual(ng.blockedIpStrict('8.8.4.4', () => ['8.8.4.4']), true, 'la lista puede ser una funcion');
process.env.ATALAYA_OWN_IPS = '9.9.9.9, 149.112.112.112';
assert.strictEqual(ng.blockedIpStrict('149.112.112.112'), true, 'ATALAYA_OWN_IPS');
delete process.env.ATALAYA_OWN_IPS;
assert.strictEqual(ng.blockedIpStrict('149.112.112.112'), false);
console.log('ok   netguard estricto: IPs propias (lista, ATALAYA_OWN_IPS)');

// literales y nombres
assert.strictEqual(ng.blockedHostStrict('127.0.0.1'), true);
assert.strictEqual(ng.blockedHostStrict('[::1]'), true);
assert.strictEqual(ng.blockedHostStrict('8.8.8.8'), false);
assert.strictEqual(ng.blockedHostStrict('ejemplo.com'), false, 'un nombre lo revisa el lookup');

// siempre revisa, aunque la edicion no sea cloud; las funciones de antes siguen igual
delete process.env.ATALAYA_EDITION;
assert.strictEqual(ng.strict(), false);
assert.strictEqual(ng.blockedHost('127.0.0.1'), false, 'blockedHost fuera de la nube no cambia');
assert.strictEqual(ng.blockedHostStrict('127.0.0.1'), true, 'la estricta no mira la edicion');
assert.strictEqual(ng.privateIp('198.18.0.1'), false, 'privateIp no cambia');
console.log('ok   netguard estricto: literales y sin depender de la edición (las funciones de antes, igual)');

(async () => {
  const base = map => (host, opts, cb) => {
    const v = map[host];
    if (!v) return cb(Object.assign(new Error('no existe'), { code: 'ENOTFOUND' }));
    cb(null, [].concat(v).map(a => ({ address: a, family: a.includes(':') ? 6 : 4 })));
  };
  const look = ng.makeStrictLookup({ base: base({ 'bien.example': '8.8.8.8', 'mal.example': '10.1.1.1', 'mixto.example': ['8.8.8.8', '127.0.0.1'],
    'v6.example': '::1', 'mapeada.example': '::ffff:127.0.0.1', 'propia.example': '8.8.4.4' }), own: ['8.8.4.4'] });
  const ask = (h, o = {}) => new Promise(r => look(h, o, (err, a, f) => r(err ? { code: err.code } : { a, f })));
  assert.deepStrictEqual(await ask('bien.example'), { a: '8.8.8.8', f: 4 });
  assert.deepStrictEqual((await ask('bien.example', { all: true })).a, [{ address: '8.8.8.8', family: 4 }]);
  for (const h of ['mal.example', 'mixto.example', 'v6.example', 'mapeada.example', 'propia.example']) assert.strictEqual((await ask(h)).code, 'EPRIVATE', h);
  assert.strictEqual((await ask('nada.example')).code, 'ENOTFOUND', 'los errores del DNS pasan tal cual');
  // rebinding: cada conexion vuelve a preguntar y cada respuesta se revisa
  let n = 0;
  const cambia = ng.makeStrictLookup({ base: (h, o, cb) => cb(null, [{ address: n++ ? '127.0.0.1' : '8.8.8.8', family: 4 }]) });
  const r1 = await new Promise(r => cambia('x.example', {}, (e, a) => r(e ? e.code : a)));
  const r2 = await new Promise(r => cambia('x.example', {}, (e, a) => r(e ? e.code : a)));
  assert.deepStrictEqual([r1, r2], ['8.8.8.8', 'EPRIVATE']);
  console.log('ok   netguard estricto: lookup (mezcla, IPv6, mapeadas, propias y rebinding)');
})().catch(e => { console.error(e); process.exit(1); });
