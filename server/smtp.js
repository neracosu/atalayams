'use strict';
// Cliente SMTP minimo (sin dependencias) para las alertas por correo: SSL (465) o STARTTLS (587), AUTH PLAIN o
// LOGIN, y un mensaje multipart (texto + HTML) en UTF-8. Sirve con Gmail (contrasena de aplicacion), Outlook,
// Yahoo, Zoho, el correo de un hosting o cualquier servidor SMTP.
const net = require('net');
const tls = require('tls');
const os = require('os');
const crypto = require('crypto');

const PRESETS = {
  gmail: { label: 'Gmail', host: 'smtp.gmail.com', port: 465, secure: 'ssl', help: 'Use una contraseña de aplicación (Cuenta de Google › Seguridad › Verificación en 2 pasos › Contraseñas de aplicaciones): Google no acepta la contraseña normal.', helpUrl: 'https://myaccount.google.com/apppasswords' },
  outlook: { label: 'Outlook / Microsoft 365', host: 'smtp.office365.com', port: 587, secure: 'starttls', help: 'Con verificación en dos pasos, use una contraseña de aplicación. En Microsoft 365, SMTP autenticado debe estar habilitado para el buzón.' },
  yahoo: { label: 'Yahoo', host: 'smtp.mail.yahoo.com', port: 465, secure: 'ssl', help: 'Genere una contraseña de aplicación en la seguridad de su cuenta de Yahoo.' },
  zoho: { label: 'Zoho Mail', host: 'smtp.zoho.com', port: 465, secure: 'ssl', help: 'Use su correo de Zoho y su contraseña (o una de aplicación si tiene 2FA).' },
  hosting: { label: 'El correo de su hosting (cPanel)', host: 'mail.su-dominio.com', port: 465, secure: 'ssl', help: 'Un buzón creado en cPanel › Cuentas de correo. Servidor: mail.<su dominio>, usuario: el correo completo.' },
  custom: { label: 'Otro servidor SMTP', host: '', port: 587, secure: 'starttls', help: '' },
};

const b64 = s => Buffer.from(s, 'utf8').toString('base64');
const wrap76 = s => s.replace(/.{1,76}/g, '$&\r\n');
const encWord = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
const addr = s => String(s || '').trim();

// una conversacion SMTP: lee respuestas (con multilinea) y manda comandos
function session(sock) {
  let buf = '', waiting = null;
  const onData = d => {
    buf += d.toString('latin1');
    const lines = buf.split('\r\n');
    for (let i = 0; i < lines.length - 1; i++) {
      if (/^\d{3} /.test(lines[i])) { const text = lines.slice(0, i + 1).join('\n'); buf = lines.slice(i + 1).join('\r\n'); const w = waiting; waiting = null; if (w) w(text); return; }
    }
  };
  sock.on('data', onData);
  const read = () => new Promise(r => { waiting = r; onData(Buffer.alloc(0)); });
  const cmd = async (line, expect) => {
    if (line != null) sock.write(line + '\r\n');
    const res = await read();
    const code = +res.slice(0, 3);
    if (expect && !expect.includes(code)) { const e = new Error(res.replace(/^\d{3}[ -]/gm, '').trim().slice(0, 300)); e.code = code; throw e; }
    return res;
  };
  return { cmd, detach: () => sock.off('data', onData) };
}

// envia un correo; lanza un Error con un mensaje claro para la pantalla
async function sendMail(opt, msg) {
  const host = String(opt.host || '').trim(), port = +opt.port || 587, secure = opt.secure || 'starttls';
  if (!host) throw new Error('Falta el servidor SMTP');
  const to = (Array.isArray(msg.to) ? msg.to : String(msg.to || '').split(/[,;\s]+/)).map(addr).filter(Boolean);
  if (!to.length) throw new Error('Falta el destinatario');
  const from = addr(opt.from || opt.user);
  const connect = () => new Promise((resolve, reject) => {
    const o = { host, port, servername: host, timeout: 20000 };
    const s = secure === 'ssl' ? tls.connect(o) : net.connect(o);
    s.setTimeout(20000, () => { s.destroy(); reject(new Error(`El servidor ${host}:${port} no responde`)); });
    s.once(secure === 'ssl' ? 'secureConnect' : 'connect', () => resolve(s));
    s.once('error', e => reject(new Error(e.code === 'ENOTFOUND' ? `No existe el servidor ${host}` : e.code === 'ECONNREFUSED' ? `${host}:${port} rechazó la conexión` : e.message)));
  });
  let sock = await connect();
  try {
    let S = session(sock);
    await S.cmd(null, [220]);
    const me = os.hostname() || 'atalaya';
    let ehlo = await S.cmd(`EHLO ${me}`, [250]);
    if (secure === 'starttls') {
      if (!/STARTTLS/i.test(ehlo)) throw new Error('El servidor no ofrece STARTTLS: pruebe con SSL en el puerto 465');
      await S.cmd('STARTTLS', [220]);
      S.detach();
      sock = await new Promise((resolve, reject) => { const t = tls.connect({ socket: sock, servername: host }, () => resolve(t)); t.once('error', reject); });
      S = session(sock);
      ehlo = await S.cmd(`EHLO ${me}`, [250]);
    }
    if (opt.user) {
      try {
        if (/AUTH[^\n]*PLAIN/i.test(ehlo)) await S.cmd(`AUTH PLAIN ${b64(`\0${opt.user}\0${opt.pass || ''}`)}`, [235]);
        else { await S.cmd('AUTH LOGIN', [334]); await S.cmd(b64(opt.user), [334]); await S.cmd(b64(opt.pass || ''), [235]); }
      } catch (e) {
        throw new Error(/gmail/i.test(host) ? 'Gmail rechazó el usuario o la contraseña: use una contraseña de aplicación (no la normal).' : 'El servidor rechazó el usuario o la contraseña: ' + e.message);
      }
    }
    await S.cmd(`MAIL FROM:<${from}>`, [250]);
    for (const r of to) await S.cmd(`RCPT TO:<${r}>`, [250, 251]);
    await S.cmd('DATA', [354]);
    const bound = 'atalaya-' + crypto.randomBytes(8).toString('hex');
    const head = [
      `From: ${encWord(opt.fromName || 'Atalaya')} <${from}>`, `To: ${to.join(', ')}`, `Subject: ${encWord(msg.subject || 'Atalaya')}`,
      `Date: ${new Date().toUTCString()}`, `Message-ID: <${crypto.randomBytes(12).toString('hex')}@${host.replace(/^smtp\./, '')}>`,
      'MIME-Version: 1.0', `Content-Type: multipart/alternative; boundary="${bound}"`, 'X-Mailer: Atalaya Monitor Server'];
    const part = (type, body) => [`--${bound}`, `Content-Type: ${type}; charset=UTF-8`, 'Content-Transfer-Encoding: base64', '', wrap76(b64(body))].join('\r\n');
    const data = head.join('\r\n') + '\r\n\r\n' + part('text/plain', msg.text || '') + '\r\n' + part('text/html', msg.html || '') + `\r\n--${bound}--\r\n`;
    sock.write(data + '\r\n.\r\n');
    await S.cmd(null, [250]);
    await S.cmd('QUIT', [221]).catch(() => { });
    return true;
  } finally { try { sock.destroy(); } catch { } }
}

module.exports = { sendMail, PRESETS };
