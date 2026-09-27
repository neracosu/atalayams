#!/usr/bin/env node
'use strict';
// Graba el stream de Atalaya en MODO PUBLICO para el simulador del kit de temas (sin nombres, dominios ni IPs).
// Uso: ATALAYA_USER=… ATALAYA_PIN=… node scripts/record-sim.js <salida.jsonl> [minutos]
const fs = require('fs');
const URL0 = process.env.ATALAYA_URL || 'http://127.0.0.1:3950';
const [out, mins = '8'] = process.argv.slice(2);
if (!out) { console.log('Uso: node scripts/record-sim.js <salida.jsonl> [minutos]'); process.exit(1); }
(async () => {
  const H = { 'X-Atalaya': '1', 'Content-Type': 'application/json' };
  const r = await fetch(URL0 + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ user: process.env.ATALAYA_USER, pin: process.env.ATALAYA_PIN }) });
  if (!r.ok) throw new Error('No se pudo entrar: ' + r.status);
  const cookie = r.headers.get('set-cookie').split(';')[0];
  await fetch(URL0 + '/api/public', { method: 'POST', headers: { ...H, cookie }, body: '{}' });
  const res = await fetch(URL0 + '/api/stream', { headers: { cookie } });
  const t0 = Date.now(), end = t0 + Number(mins) * 60000;
  const f = fs.createWriteStream(out);
  const dec = new TextDecoder(); let buf = '', n = 0;
  for await (const chunk of res.body) {
    buf += dec.decode(chunk, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const block = buf.slice(0, i); buf = buf.slice(i + 2);
      const ev = (block.match(/^event: (.+)$/m) || [])[1], data = (block.match(/^data: (.+)$/m) || [])[1];
      if (!ev || !data) continue;
      const d = JSON.parse(data);
      if (d.priv) throw new Error('La sesion quedo en modo privado: se cancela la grabacion');
      f.write(JSON.stringify({ t: Date.now() - t0, e: ev, d }) + '\n'); n++;
    }
    if (Date.now() > end) break;
  }
  f.end();
  console.log(`grabados ${n} mensajes en ${Math.round((Date.now() - t0) / 1000)} s`);
  process.exit(0);
})().catch(e => { console.error(e.message); process.exit(1); });
