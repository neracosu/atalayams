'use strict';
// Asistente web: configuracion en capas, codigo de un solo uso, tokens de descarga y validaciones del ayudante.
// Uso: node test/setup.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-setup-'));
const cfgFile = path.join(tmp, 'config.json');
fs.writeFileSync(cfgFile, JSON.stringify({ stateDir: tmp, port: 3999, title: 'Base' }));
process.env.ATALAYA_CONFIG = cfgFile;
const settings = require('../server/settings');

// capas: defaults < config.json < settings.json, y solo claves permitidas
let cfg = settings.load(path.resolve(__dirname, '..'));
assert.strictEqual(cfg.title, 'Base'); assert.strictEqual(cfg.sessionDays, 30);
settings.save(cfg, { title: 'Oficina', port: 80, stateDir: '/etc', public: { showAppNames: true } });
assert.strictEqual(cfg.title, 'Oficina', 'se aplica en caliente');
cfg = settings.load(path.resolve(__dirname, '..'));
assert.strictEqual(cfg.title, 'Oficina'); assert.strictEqual(cfg.port, 3999, 'el puerto no se puede cambiar desde el asistente');
assert.strictEqual(cfg.stateDir, tmp, 'stateDir tampoco'); assert.strictEqual(cfg.public.showAppNames, true); assert.strictEqual(cfg.public.showAccountNames, false);
console.log('ok   configuracion en capas y lista cerrada de campos');

// codigo de un solo uso y tokens de descarga
const { Auth } = require('../server/auth');
const { SetupFlow } = require('../server/setupflow');
const auth = new Auth(cfg);
const S = new SetupFlow({ cfg, auth, secrets: { connectors: () => [], remotes: () => [] }, logs: {}, ROOT: path.resolve(__dirname, '..'), VERSION: 'test' });
assert.ok(S.isSetupMode());
S.ensureCode();
const code = S.code();
assert.match(code, /^[0-9A-F]{5}-[0-9A-F]{5}$/);
assert.strictEqual(S.verify('AAAAA-AAAAA', '1.1.1.1').status, 401);
assert.ok(S.verify(code.toLowerCase(), '1.1.1.1').token, 'el codigo no distingue mayusculas');
for (let i = 0; i < 5; i++) S.verify('ZZZZZ-ZZZZZ', '2.2.2.2');
assert.strictEqual(S.verify(code, '2.2.2.2').status, 429, 'tras 5 fallos esa IP espera');
const t = S.distToken('ana');
assert.ok(S.useDist(t, false)); assert.ok(!S.useDist('otro', false));
for (let i = 0; i < 5; i++) assert.ok(S.useDist(t, true));
assert.ok(!S.useDist(t, true), 'el token se agota a los 5 usos');
auth.setUser('ana', '739164', 'owner');
assert.ok(!S.isSetupMode(), 'con un usuario termina el modo configuracion');
S.finish(); assert.strictEqual(S.code(), null); assert.strictEqual(cfg.setupDone, true);
console.log('ok   codigo de un solo uso, bloqueo por intentos y tokens de descarga');

// ayudante: acciones fuera de la lista y parametros maliciosos se rechazan
const req = path.join(tmp, 'requests'); fs.mkdirSync(req, { recursive: true });
const put = (id, o) => fs.writeFileSync(path.join(req, id + '.json'), JSON.stringify({ id, ...o }));
put('aaaaaaaaaaaaaaaaaa', { action: 'rm-rf' });
put('bbbbbbbbbbbbbbbbbb', { action: 'cpanel-publish', params: { sub: 'a;b', domain: 'x.com' } });
put('cccccccccccccccccc', { action: 'cpanel-publish', params: { sub: 'ok', domain: '../../etc' } });
execFileSync(process.execPath, [path.join(__dirname, '../server/helper.js')], { env: { ...process.env, ATALAYA_CONFIG: cfgFile } });
const r = id => JSON.parse(fs.readFileSync(path.join(tmp, 'results', id + '.json'), 'utf8'));
assert.strictEqual(r('aaaaaaaaaaaaaaaaaa').error, 'Accion no permitida');
assert.strictEqual(r('bbbbbbbbbbbbbbbbbb').error, 'Subdominio o dominio invalido');
assert.strictEqual(r('cccccccccccccccccc').error, 'Subdominio o dominio invalido');
assert.deepStrictEqual(fs.readdirSync(req), [], 'los pedidos se consumen siempre');
console.log('ok   ayudante: lista cerrada de acciones y validacion de parametros');
fs.rmSync(tmp, { recursive: true, force: true });
