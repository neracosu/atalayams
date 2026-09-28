'use strict';
// Hook de Claude Code en una laptop: lo que sale de la computadora es una lista cerrada. Se instala en una carpeta
// de prueba, se le pasa un evento con contenido de archivos, llaves y respuestas, y se mira lo que envia.
// Uso: node test/remotehook.test.js
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const home = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-hook-'));
const env = { ...process.env, HOME: home, USERPROFILE: home };
const inst = path.join(__dirname, '../hooks/remote-install.js');
const cred = 'laptop-ana:' + 'A1b2C3d4'.repeat(5);
const SECRET = 'sb_secret_ESTO_NO_DEBE_SALIR_NUNCA';
const event = { hook_event_name: 'PostToolUse', session_id: '11111111-2222-3333-4444-555555555555', cwd: 'C:\\Users\\ana\\proyectos\\tienda-secreta', transcript_path: 'C:\\Users\\ana\\.claude\\projects\\x.jsonl',
  tool_name: 'Write', tool_use_id: 'toolu_1', permission_mode: 'default',
  tool_input: { file_path: '/home/ana/proyectos/tienda-secreta/.env', content: 'LLAVE=' + SECRET, old_string: SECRET, new_string: SECRET, command: 'export LLAVE=' + SECRET + ' && npm run deploy' },
  tool_response: { content: 'LLAVE=' + SECRET, stdout: SECRET }, prompt: 'crea el .env con la llave ' + SECRET + ' y despliega', message: 'listo ' + SECRET, env: { LLAVE: SECRET } };
// el reenviador se prueba sin red: en vez de enviar, imprime lo que enviaria
const sent = () => {
  const src = fs.readFileSync(path.join(home, '.claude/atalaya-remote.js'), 'utf8');
  assert.ok(src.includes('const req = https.request('), 'el reenviador cambio: ajuste esta prueba');
  const probe = path.join(home, '.claude/probe.js');
  fs.writeFileSync(probe, src.replace('const req = https.request(', "process.stdout.write(out); return done(); const req = https.request("));
  const r = spawnSync(process.execPath, [probe], { input: JSON.stringify(event), env, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stderr);
  return r.stdout;
};

assert.throws(() => execFileSync(process.execPath, [inst, 'http://sin-https.com', cred], { env, stdio: 'pipe' }), 'solo https');
assert.throws(() => execFileSync(process.execPath, [inst, 'https://nube.ejemplo.com/ana', 'sin-token'], { env, stdio: 'pipe' }));

// por defecto: solo actividad
let out = execFileSync(process.execPath, [inst, 'https://nube.ejemplo.com/ana/', cred], { env, encoding: 'utf8' });
assert.match(out, /Nunca el contenido de sus archivos/);
const conf = JSON.parse(fs.readFileSync(path.join(home, '.claude/atalaya-remote.json'), 'utf8'));
assert.deepStrictEqual(conf, { url: 'https://nube.ejemplo.com/ana', cred, detail: false });
if (process.platform !== 'win32') assert.strictEqual(fs.statSync(path.join(home, '.claude/atalaya-remote.json')).mode & 0o777, 0o600);
let raw = sent(), o = JSON.parse(raw);
assert.deepStrictEqual(o, { hook_event_name: 'PostToolUse', session_id: event.session_id, permission_mode: 'default', tool_name: 'Write', tool_use_id: 'toolu_1', cwd: 'tienda-secreta' }, 'solo la lista cerrada, y del proyecto solo el nombre de su carpeta');
assert.ok(!raw.includes('ESTO_NO_DEBE_SALIR') && !raw.includes('.env') && !raw.includes('Users') && !raw.includes('despliega'));

// con detalle: archivo, comando e inicio de la instruccion, con las llaves tapadas; nunca contenido ni respuestas
out = execFileSync(process.execPath, [inst, 'https://nube.ejemplo.com/ana', cred, '--detalle'], { env, encoding: 'utf8' });
assert.match(out, /el archivo o comando de cada paso/);
raw = sent(); o = JSON.parse(raw);
assert.deepStrictEqual(Object.keys(o).sort(), ['cwd', 'hook_event_name', 'message', 'permission_mode', 'prompt', 'session_id', 'tool_input', 'tool_name', 'tool_use_id']);
assert.deepStrictEqual(Object.keys(o.tool_input).sort(), ['command', 'file_path']);
assert.strictEqual(o.tool_input.file_path, '/home/ana/proyectos/tienda-secreta/.env');
assert.ok(!raw.includes('ESTO_NO_DEBE_SALIR'), 'las llaves se tapan tambien en el comando y en la instruccion: ' + raw);
assert.ok(o.prompt.startsWith('crea el .env con la llave ***'));
assert.ok(!('tool_response' in o) && !('env' in o) && !('transcript_path' in o) && !('content' in o.tool_input));

// los hooks: doce eventos, sin duplicar al reinstalar, y conservando los de la persona
const st = () => JSON.parse(fs.readFileSync(path.join(home, '.claude/settings.json'), 'utf8'));
assert.strictEqual(Object.keys(st().hooks).length, 12);
assert.strictEqual(st().hooks.Stop.length, 1, 'reinstalar no duplica');
assert.ok(st().hooks.Stop[0].hooks[0].command.startsWith('node "') && !st().hooks.Stop[0].hooks[0].command.includes('\\'));
execFileSync(process.execPath, [inst, '--uninstall'], { env, encoding: 'utf8' });
assert.strictEqual(st().hooks, undefined);
assert.ok(!fs.existsSync(path.join(home, '.claude/atalaya-remote.js')) && !fs.existsSync(path.join(home, '.claude/atalaya-remote.json')));
fs.rmSync(home, { recursive: true, force: true });
console.log('remotehook.test.js OK');
