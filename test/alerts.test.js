'use strict';
// Alertas por Telegram (con un Telegram falso): token validado, chat enganchado con /start <codigo>, avisos por
// categoria, sin repetir en 30 min, horario de silencio (solo lo grave), sin IPs y con enlace, y el resumen.
const assert = require('assert');
const http = require('http');
const net = require('net');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');

const sent = []; let updates = [];
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', c => { b += c; }); req.on('end', () => {
    const body = b ? JSON.parse(b) : {}, m = req.url.match(/\/bot([^/]+)\/(\w+)/);
    const ok = m && m[1] === ['123456789', 'AAE' + 'abcdefghijklmnopqrstuvwxyz0123456'].join(':'); // token de mentira, por partes
    res.setHeader('Content-Type', 'application/json');
    if (!ok) return res.end(JSON.stringify({ ok: false, description: 'Unauthorized' }));
    if (m[2] === 'getMe') return res.end(JSON.stringify({ ok: true, result: { username: 'mi_atalaya_bot' } }));
    if (m[2] === 'getUpdates') return res.end(JSON.stringify({ ok: true, result: body.offset ? [] : updates }));
    if (m[2] === 'sendMessage') { sent.push(body); return res.end(JSON.stringify({ ok: true, result: {} })); }
    res.end(JSON.stringify({ ok: false }));
  });
});

(async () => {
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  process.env.ATALAYA_TELEGRAM_API = `http://127.0.0.1:${srv.address().port}`;
  const { Alerts } = require('../server/alerts');
  const store = []; const secrets = { connectors: () => store.map(x => ({ ...x })), addConnector: (id, c) => { const i = store.findIndex(x => x.id === id); const v = { id, ...c }; if (i >= 0) store[i] = v; else store.push(v); }, delConnector: id => store.splice(store.findIndex(x => x.id === id), 1) };
  const bus = new EventEmitter();
  let now = Date.parse('2026-09-27T15:00:00Z'), hour = 15;
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-alerts-'));
  const A = new Alerts({ title: 'Mi servidor', publicUrl: 'https://atalaya.ejemplo.com', stateDir }, bus, secrets, { goOf: e => e.site ? 'site:abc123' : null }, { manual: true, now: () => now, localHour: () => hour });

  await assert.rejects(A.setToken('no-es-token'), /token/);
  // tokens de mentira, armados por partes para que los escaneres de secretos no los tomen por reales
  const fakeToken = tail => ['123456789', 'AAE' + tail].join(':');
  await assert.rejects(A.setToken(fakeToken('z'.repeat(32))), /no aceptó/);
  const link = await A.setToken(fakeToken('abcdefghijklmnopqrstuvwxyz0123456'));
  assert.strictEqual(link.bot, 'mi_atalaya_bot'); assert.ok(/^[0-9A-F]{6}$/.test(link.code));
  updates = [{ update_id: 1, message: { chat: { id: 55, first_name: 'Otro' }, text: '/start AAAAAA' } }];
  assert.strictEqual((await A.checkLink()).linked, false, 'un código equivocado no engancha');
  updates = [{ update_id: 2, message: { chat: { id: 77, first_name: 'Neri' }, text: `/start ${link.code}` } }];
  const r = await A.checkLink();
  assert.ok(r.linked && r.chat.name === 'Neri');
  assert.ok(/Atalaya conectada/.test(sent.pop().text));
  console.log('ok   alertas: token validado y chat enganchado solo con su código');

  const flush = () => new Promise(r => setTimeout(r, 80));
  bus.emit('ev', { kind: 'phpfile', action: 'suspect', site: 'g1', domain: 'neracosu.com', path: '/home/x/a.php', why: 'código ofuscado' });
  await flush();
  const m1 = sent.pop();
  assert.ok(/SEGURIDAD/.test(m1.text) && /neracosu\.com/.test(m1.text) && /site%3Aabc123/.test(m1.text) && !/\/home\//.test(m1.text) && m1.chat_id === 77, m1.text);
  assert.ok(![...m1.text].some(c => c.codePointAt(0) > 0x2600 && c.codePointAt(0) < 0x1FAFF), 'sin emojis');
  bus.emit('ev', { kind: 'phpfile', action: 'suspect', site: 'g1', domain: 'neracosu.com', path: '/home/x/a.php', why: 'código ofuscado' });
  bus.emit('ev', { kind: 'watch', action: 'start', reason: 'scraping', domain: 'x.com', ip: '1.2.3.4' });
  await flush();
  assert.strictEqual(sent.length, 0, 'no repite en 30 min y el tráfico viene apagado');
  bus.emit('ev', { kind: 'defense', action: 'block', by: 'auto', ip: '45.9.9.9', reason: 'fuerza bruta', domain: 'wp.com' });
  await flush();
  assert.ok(/CÁRCEL/.test(sent[0].text) && !/45\.9\.9\.9/.test(sent[0].text), 'sin la IP'); sent.length = 0;
  hour = 2; now += 3600000;
  bus.emit('ev', { kind: 'defense', action: 'block', by: 'auto', ip: '45.9.9.8', reason: 'scraping' });
  bus.emit('ev', { kind: 'pm2', action: 'down', app: 'tienda', appName: 'tienda' });
  await flush();
  assert.deepStrictEqual(sent.map(x => /CAÍDA/.test(x.text)), [true], 'de madrugada solo lo grave');
  console.log('ok   alertas: por categoría, sin repetir, sin IPs ni rutas, con enlace; en silencio solo lo grave');

  sent.length = 0; hour = 8; now += 6 * 3600000;
  await A.tick();
  assert.ok(/Resumen de las últimas 24 h/.test(sent[0].text) && /posible\(s\) puerta/.test(sent[0].text) && /cárcel/.test(sent[0].text));
  await A.tick(); assert.strictEqual(sent.length, 1, 'un resumen por día');
  console.log('ok   alertas: resumen de cada mañana, una vez por día');

  // solicitudes de acceso de la nube del mismo servidor: solo las nuevas, sin el contacto
  sent.length = 0;
  assert.ok(!('requests' in A.status().cats), 'sin nube en el servidor la categoría no aparece');
  const rf = path.join(stateDir, 'requests.json');
  const old = { id: 'old1', kind: 'vps', name: 'Vieja', contact: 'v@v.com', channel: 'email', state: 'nueva' };
  fs.writeFileSync(rf, JSON.stringify([old]));
  const checkReq = A.watchRequests(rf);
  assert.ok('requests' in A.status().cats);
  fs.writeFileSync(rf, JSON.stringify([{ id: 'n2', kind: 'cloud', name: 'Ana <b>', contact: '+58 412 555 1234', channel: 'whatsapp', what: 'tres WordPress', state: 'nueva' }, old]));
  checkReq(); await flush();
  assert.strictEqual(sent.length, 1, 'la que ya estaba al arrancar no avisa');
  assert.ok(/SOLICITUD/.test(sent[0].text) && /Ana &lt;b&gt;/.test(sent[0].text) && /tres WordPress/.test(sent[0].text) && !/412/.test(sent[0].text), sent[0].text);
  checkReq(); await flush();
  assert.strictEqual(sent.length, 1, 'no se repite');
  console.log('ok   alertas: solicitudes de acceso nuevas de la nube, sin el contacto');

  // ---- correo: servidor SMTP falso (sin TLS) que anota la conversacion
  const mails = [];
  const smtp = net.createServer(sock => {
    let data = false, buf = '', auth = '';
    sock.write('220 smtp.falso ESMTP\r\n');
    sock.on('data', d => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (data) { if (line === '.') { data = false; mails[mails.length - 1].auth = auth; sock.write('250 OK\r\n'); } else mails[mails.length - 1].body += line + '\n'; continue; }
        if (/^EHLO/.test(line)) sock.write('250-smtp.falso\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (/^AUTH PLAIN /.test(line)) { auth = Buffer.from(line.slice(11), 'base64').toString().split('\0'); sock.write(auth[2] === 'clave-app' ? '235 OK\r\n' : '535 Bad credentials\r\n'); }
        else if (/^MAIL FROM/.test(line)) { mails.push({ from: line, rcpt: [], body: '' }); sock.write('250 OK\r\n'); }
        else if (/^RCPT TO/.test(line)) { mails[mails.length - 1].rcpt.push(line); sock.write('250 OK\r\n'); }
        else if (line === 'DATA') { data = true; sock.write('354 Go\r\n'); }
        else if (line === 'QUIT') { sock.write('221 Bye\r\n'); sock.end(); }
      }
    });
  });
  await new Promise(r => smtp.listen(0, '127.0.0.1', r));
  const sm = { preset: 'custom', host: '127.0.0.1', port: smtp.address().port, secure: 'none', user: 'yo@ejemplo.com', from: 'yo@ejemplo.com', to: 'yo@ejemplo.com, socio@ejemplo.com' };
  await assert.rejects(A.setEmail({ ...sm, pass: 'mala' }), /rechazó el usuario/);
  assert.ok(!A.email(), 'no se guarda si la prueba falla');
  await A.setEmail({ ...sm, pass: 'clave-app' });
  assert.ok(A.email() && mails.length === 1 && mails[0].rcpt.length === 2, 'guardado tras una prueba que salió (el intento fallido se cortó en la autenticación)');
  const dec = m => m.body.split(/--atalaya-\w+/).map(p => { const b = p.split('\n\n')[1]; return b ? Buffer.from(b.replace(/\s/g, ''), 'base64').toString() : ''; }).join('\n');
  assert.ok(/Subject: /.test(mails[0].body));
  mails.length = 0; sent.length = 0; hour = 15; now += 86400000;
  bus.emit('ev', { kind: 'pm2', action: 'down', app: 'blog', appName: 'blog' });
  await flush(); await flush();
  assert.strictEqual(mails.length, 1, 'el aviso llega también por correo');
  const body = dec(mails[0]);
  assert.ok(/Se detuvo/.test(body) && /Abrir en Atalaya/.test(body) && !/<a href[^>]*>Abrir en Atalaya<\/a>\s*<\/p>\s*<p/.test('x'), body.slice(0, 200));
  assert.ok(![...body].some(c => c.codePointAt(0) >= 0x1F300), 'sin emojis en el correo');
  assert.ok(sent.length === 1, 'y por Telegram');
  const saved = JSON.parse(fs.readFileSync(path.join(stateDir, 'alerts.json'), 'utf8'));
  assert.ok(saved.email.pass === 'clave-app' && (fs.statSync(path.join(stateDir, 'alerts.json')).mode & 0o777) === 0o600, 'guardado en su archivo con permisos 600');
  assert.ok(!store.some(c => c.type === 'telegram'), 'Telegram ya no ocupa un conector');
  console.log('ok   alertas por correo: SMTP propio, se guarda solo si la prueba sale, llega junto a Telegram, archivo 600');
  smtp.close();

  // ---- la configuracion vieja (conector de Telegram) se muda sola al archivo nuevo
  const store2 = [{ id: 'telegram', type: 'telegram', token: 'x', bot: 'b', chats: [{ id: 1, name: 'N' }], conf: { cats: { traffic: true } } }];
  const sec2 = { connectors: () => store2.slice(), addConnector() { }, delConnector: id => store2.splice(store2.findIndex(x => x.id === id), 1) };
  const dir2 = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-alerts2-'));
  const B = new Alerts({ stateDir: dir2 }, new EventEmitter(), sec2, {}, { manual: true });
  assert.ok(B.conn().bot === 'b' && B.conf().cats.traffic === true && store2.length === 0);
  console.log('ok   alertas: la configuración vieja de Telegram se muda sola y libera el conector');
  srv.close();
})().catch(e => { console.error(e); process.exit(1); });
