'use strict';
// Lectores de logs de seguridad y correo con lineas reales de cada formato. Uso: node test/parsers.test.js
const assert = require('assert');
const { LogsCollector } = require('../server/collectors/logs');

const ev = [];
const L = new LogsCollector({ stateDir: '/tmp/atalaya-test', logs: {} }, { emit: (_, e) => ev.push(e) }, { apps: [] });
const take = () => ev.splice(0);

L.onFail2ban('2026-09-25 10:00:01,123 fail2ban.actions        [812]: NOTICE  [sshd] Ban 203.0.113.9');
L.onFail2ban('2026-09-25 10:05:01,123 fail2ban.actions        [812]: NOTICE  [sshd] Unban 203.0.113.9');
let e = take();
assert.strictEqual(e.length, 1); assert.strictEqual(e[0].kind, 'block'); assert.strictEqual(e[0].service, 'sshd'); assert.strictEqual(e[0].ip, '203.0.113.9');

L.onLfd('Sep 25 10:00:00 srv lfd[1234]: (sshd) Failed SSH login from 198.51.100.7 (CN/China/-): 5 in the last 3600 secs - *Blocked in csf* [LF_SSHD]');
L.onLfd('Sep 25 10:00:00 srv lfd[1234]: Daemon started');
e = take();
assert.strictEqual(e.length, 1); assert.strictEqual(e[0].service, 'sshd'); assert.strictEqual(e[0].ip, '198.51.100.7');

L.onPostfix('Sep 25 10:00:00 srv postfix/smtp[1]: ABC: to=<x@gmail.com>, relay=gmail-smtp-in.l.google.com[1.2.3.4]:25, delay=1, status=sent (250 OK)');
L.onPostfix('Sep 25 10:00:00 srv postfix/lmtp[2]: DEF: to=<ana@ana.dev>, relay=mail.ana.dev[private/dovecot-lmtp], status=sent (250 2.0.0 Saved)');
L.onPostfix('Sep 25 10:00:00 srv postfix/smtp[3]: GHI: to=<no@existe.com>, relay=mx.existe.com[5.6.7.8]:25, status=bounced (user unknown)');
L.onPostfix('Sep 25 10:00:00 srv postfix/smtpd[4]: connect from unknown[9.9.9.9]');
const tot = () => ({ out: L.mail.out, in: L.mail.in, bounce: L.mail.bounce });
assert.deepStrictEqual(tot(), { out: 1, in: 1, bounce: 1 });
let mev = take();
assert.strictEqual(mev.find(x => x.dir === 'bounce').to, 'no@existe.com');
assert.strictEqual(mev.find(x => x.dir === 'bounce').cat, 'nouser');

// Exim: llegada con su usuario de cPanel, entrega remota, entrega local y rebote con motivo, unidos por el id
L.cfg.accounts = { ana: {} };
L.onExim('2026-09-25 11:00:00 1t3xYz-000abc-Ab <= ana@ana.dev U=ana P=local S=812 T="Hola" for x@gmail.com');
L.onExim('2026-09-25 11:00:01 1t3xYz-000abc-Ab => x@gmail.com R=dkim_lookuphost T=dkim_remote_smtp H=gmail-smtp-in.l.google.com');
L.onExim('2026-09-25 11:00:02 1t3xZa-000abd-Cd => user <u@dominio.com> R=virtual_user T=dovecot_virtual_delivery');
L.onExim('2026-09-25 11:00:03 1t3xZb-000abe-Ef <= ana@ana.dev U=ana P=local S=640');
L.onExim('2026-09-25 11:00:04 1t3xZb-000abe-Ef ** z@gmail.com R=dkim_lookuphost T=dkim_remote_smtp H=gmail-smtp-in.l.google.com: SMTP error from remote mail server after pipelined end of data: 550-5.7.26 Unauthenticated email is not accepted');
L.onExim('2026-09-25 11:00:05 1t3xZb-000abe-Ef == y@gmail.com R=dkim_lookuphost defer (-44): retry time not reached');
assert.deepStrictEqual(tot(), { out: 2, in: 2, bounce: 2 });
mev = take().filter(x => x.kind === 'mail');
const out = mev.find(x => x.dir === 'out'), bnc = mev.find(x => x.dir === 'bounce');
assert.deepStrictEqual([out.from, out.to, out.account], ['ana@ana.dev', 'x@gmail.com', 'ana']);
assert.deepStrictEqual([bnc.account, bnc.cat, bnc.code], ['ana', 'auth', '550-5.7.26']);
assert.strictEqual(L.mail.byAccount.ana.reasons.auth, 1);
console.log('ok   correo: remitente, destinatario, cuenta y motivo de cada rebote (Exim y Postfix)');

L.onAuth('Sep 25 12:00:01 vmi sshd[1]: Invalid user admin from 1.2.3.4 port 5');
L.onAuth('Sep 25 12:00:02 vmi sshd[1]: Failed password for invalid user admin from 1.2.3.4 port 5 ssh2');
L.onAuth('Sep 25 12:00:03 vmi sshd[2]: Failed password for root from 1.2.3.5 port 6 ssh2');
L.onAuth('Sep 25 12:00:04 vmi sshd[3]: Accepted publickey for root from 1.2.3.6 port 7 ssh2');
assert.strictEqual(L.security.failed, 2); assert.strictEqual(L.security.logins, 1);

console.log('ok   lectores: fail2ban, CSF/LFD, Postfix, Exim, SSH');
