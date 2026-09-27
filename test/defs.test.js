'use strict';
// Definiciones: se aceptan solo firmadas por la clave de Atalaya, mas nuevas y con reglas validas; se guardan
// y se usan al reiniciar; lo que no cumple se descarta sin tocar las que hay.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { Defs, DEFAULT, compile, verKey } = require('../server/defs');

const base = JSON.parse(fs.readFileSync(path.join(__dirname, '../defs/definiciones.json'), 'utf8'));
assert.ok(compile(base).webFamilies.length >= 5 && compile(base).mailRules.length >= 6);
assert.throws(() => compile({ ...base, formato: 2 }), /formato/);
assert.throws(() => compile({ ...base, web: { ...base.web, familias: [{ id: 'x', name: 'x', pattern: '(' }] } }));
assert.ok(verKey('2026.10.1.1') > verKey('2026.09.26.9'), 'las versiones se comparan por numero, no por texto');
console.log('ok   definiciones: las integradas compilan y una regla rota se rechaza');

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-defs-'));
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const other = crypto.generateKeyPairSync('ed25519').privateKey;
  const sign = (d, key = privateKey) => { const payload = JSON.stringify(d); return { payload, sig: crypto.sign(null, Buffer.from(payload), key).toString('base64') }; };
  const make = () => { const D = new Defs({ stateDir: dir }); D.pub = publicKey.export({ type: 'spki', format: 'pem' }); return D; };
  const newer = JSON.parse(JSON.stringify(base));
  newer.version = '2099.01.01.1';
  newer.web.familias.push({ id: 'nueva', name: 'Familia nueva', pattern: '\\/sondeo-2099', flags: 'i' });
  newer.correo.arreglos.nouser = 'Texto actualizado';

  let D = make();
  D.fetcher = async () => sign(newer, other);
  assert.strictEqual(await D.update(), false); assert.match(D.error, /firma/); assert.strictEqual(D.rules, DEFAULT);
  D.fetcher = async () => { const e = sign(newer); e.payload = e.payload.replace('Texto actualizado', 'Texto cambiado'); return e; };
  assert.strictEqual(await D.update(), false, 'un paquete alterado despues de firmar se rechaza');
  D.fetcher = async () => sign({ ...base, version: '2000.01.01.1' });
  assert.strictEqual(await D.update(), false, 'una version mas vieja no reemplaza a la actual');
  assert.strictEqual(D.error, null);
  let changed = null; D.on('change', i => { changed = i; });
  D.fetcher = async () => sign(newer);
  assert.strictEqual(await D.update(), true);
  assert.strictEqual(D.rules.version, '2099.01.01.1'); assert.strictEqual(D.source, 'actualizadas'); assert.ok(changed);
  assert.ok(D.rules.webFamilies.some(([id]) => id === 'nueva')); assert.strictEqual(D.rules.mailFix.nouser, 'Texto actualizado');
  console.log('ok   definiciones: solo firmadas por la clave de Atalaya, intactas y mas nuevas');

  // al reiniciar se usan las guardadas (vuelven a verificarse)
  D = make();
  const saved = new Defs({ stateDir: dir }); // con la clave publica real del repositorio: no la reconoce
  assert.strictEqual(saved.rules, DEFAULT, 'guardadas con otra clave: se ignoran');
  const orig = fs.readFileSync(path.join(__dirname, '../defs/definiciones.pub'), 'utf8');
  assert.ok(orig.includes('BEGIN PUBLIC KEY'));
  // la defensa web y el correo usan las reglas nuevas
  const { WebDefense } = require('../server/webdefense');
  const { EventEmitter } = require('events');
  const ok = make(); ok.fetcher = async () => sign(newer); await ok.update();
  const bus = new EventEmitter(), W = new WebDefense({}, bus, { sites: [] }, ok);
  bus.emit('ev', { kind: 'http', account: 'ana', site: 's', domain: 'x.dev', path: '/sondeo-2099', status: 404, at: Date.now() });
  assert.deepStrictEqual(W.sites.get('site:s').fam, { nueva: 1 });
  console.log('ok   definiciones: la defensa web aplica al instante una familia nueva');
  fs.rmSync(dir, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
