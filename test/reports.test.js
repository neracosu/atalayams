'use strict';
// Informe mensual por correo: el mes calendario contra el anterior, el correo (resumen, cifras y listas) y el
// envio programado del dia 1 (una sola vez por mes y sitio, solo si ese mes ya se medía). Uso: node test/reports.test.js
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { Analytics } = require('../server/analytics');
const { Reports } = require('../server/reports');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-informes-'));
const cfg = { stateDir: dir, title: 'Prueba', reportBrand: 'NERACOSU' };
const A = new Analytics(cfg, null);
A.startedAt = 0;
const key = 'site:s1';
const at = (y, m, d, h) => new Date(y, m - 1, d, h, 0, 0).getTime();
let n = 0;
const hit = (t, path, extra = {}) => A.hit({ site: 's1', domain: 'ana.com', at: t, path, status: 200, ip: '10.0.0.' + (n++ % 50), uaRaw: 'UA' + (n % 7), ua: { name: 'Chrome', os: 'Android', mobile: n % 3 !== 0 }, refHost: n % 2 ? 'www.google.com' : '', cc: n % 4 ? 'VE' : 'CO', ...extra });
// agosto: 40 visitas; septiembre: 60 visitas y un 404
for (let i = 0; i < 40; i++) hit(at(2026, 8, 1 + (i % 28), 10), '/');
for (let i = 0; i < 60; i++) hit(at(2026, 9, 1 + (i % 30), 15), i % 3 ? '/' : '/precios');
hit(at(2026, 9, 12, 15), '/vieja', { status: 404 });
A.flush();

// el script (a.js): tiempo, lectura, rebote real y conversiones; se guardan en el dia de hoy
const realNow = Date.now;
Date.now = () => at(2026, 9, 20, 16);
A.beacon(key, { t: 'pv', f: 1, sec: 40, sc: 80, e: 1, n: 1, p: '/precios' });
A.beacon(key, { t: 'pv', f: 1, sec: 4, sc: 20, e: 1, n: 0, p: '/' });
A.beacon(key, { t: 'pv', f: 0, sec: 20, p: '/precios' });
A.beacon(key, { t: 'ev', k: 'whatsapp', p: '/precios' });
A.beacon(key, { t: 'ev', k: 'formulario', l: 'contacto', p: '/' });
Date.now = realNow;
A.flush();
const tok = A.siteToken(key);
assert.strictEqual(new Analytics(cfg, null).siteToken(key), tok, 'el identificador del script no cambia al reiniciar');
const r = A.monthReport(key, '2026-09');
assert.ok(r.js && r.js.pv === 2 && r.js.avgSecs === 32 && r.js.scroll === 50 && r.js.bounce === 0.5 && r.js.conv === 2, JSON.stringify(r.js));
assert.strictEqual(r.from, '2026-09-01'); assert.strictEqual(r.to, '2026-09-30'); assert.strictEqual(r.series.length, 30);
assert.ok(r.totals.visitors > 0 && r.prev.visitors > 0, 'septiembre y agosto con visitantes');
assert.ok(r.comparable, 'agosto se midió completo: se compara');

const sent = [];
let now = at(2026, 10, 1, 7);
const ctx = { analytics: A, alerts: { email: () => ({ host: 'smtp.x', port: 465, secure: 'ssl', user: 'info@x.com', pass: 'p', from: 'info@x.com' }) } };
const R = new Reports(cfg, ctx, { manual: true, now: () => now, send: async (opt, msg) => { sent.push({ opt, msg }); } });
assert.throws(() => R.set(key, { to: 'no-es-correo' }), /inválido/);
R.set(key, { to: 'cliente@ana.com, otro@ana.com', name: 'ana.com' });
assert.deepStrictEqual(R.info(key).to, ['cliente@ana.com', 'otro@ana.com']);

const mail = R.build(key, '2026-09', 'ana.com');
assert.ok(/ana\.com: su informe de septiembre/.test(mail.subject), mail.subject);
assert.ok(mail.html.includes('Visitantes') && mail.html.includes('/precios') && mail.html.includes('/vieja') && mail.html.includes('Venezuela'), 'cifras, paginas, 404 y paises');
assert.ok(/recibió <b>\d+ visitantes<\/b>, un <b>\d+ % más<\/b> que en agosto/.test(mail.html), 'el resumen en palabras compara con el mes anterior');
assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(mail.html), 'sin emojis');
assert.ok(mail.html.includes('Lo que hicieron en la página') && mail.html.includes('Clics en WhatsApp') && /2 conversiones/.test(mail.html), 'el informe suma el script');

(async () => {
  await R.tick(); assert.strictEqual(sent.length, 0, 'antes de las 8 no sale');
  now = at(2026, 10, 1, 9);
  await R.tick(); assert.strictEqual(sent.length, 1, 'el dia 1 desde las 8 sale el mes anterior');
  assert.deepStrictEqual(sent[0].msg.to, ['cliente@ana.com', 'otro@ana.com']);
  assert.ok(/septiembre/.test(sent[0].msg.subject));
  await R.tick(); assert.strictEqual(sent.length, 1, 'una sola vez por mes');
  now = at(2026, 10, 5, 9);
  R.data.sent = {}; await R.tick(); assert.strictEqual(sent.length, 1, 'despues del dia 3 ya no se recupera');
  // un sitio que se empezo a medir despues de ese mes no recibe informe vacio
  const R2 = new Reports({ ...cfg, stateDir: fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-informes2-')) }, { ...ctx, analytics: { ...A, firstDay: () => '2026-10-01', monthReport: A.monthReport.bind(A) } }, { manual: true, now: () => at(2026, 10, 1, 9), send: async () => sent.push(1) });
  R2.set(key, { to: 'x@y.com' }); await R2.tick(); assert.strictEqual(sent.length, 1, 'sin informe de un mes que no se medía');
  await assert.rejects(new Reports(cfg, { analytics: A, alerts: { email: () => null } }, { manual: true }).sendNow(key), /Alertas/);
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ok   informe mensual y script: mes contra mes, tiempo, rebote real y conversiones, envío del día 1 una sola vez');
})().catch(e => { console.error(e); process.exit(1); });
