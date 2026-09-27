#!/usr/bin/env node
'use strict';
// Graba respuestas de /api/detail en MODO PUBLICO para el simulador del kit de temas.
// Uso: ATALAYA_USER=… ATALAYA_PIN=… node scripts/record-details.js <grabacion.jsonl> <salida.json>
const fs = require('fs');
const URL0 = process.env.ATALAYA_URL || 'http://127.0.0.1:3950';
const [rec, out] = process.argv.slice(2);
(async () => {
  const H = { 'X-Atalaya': '1', 'Content-Type': 'application/json' };
  const r = await fetch(URL0 + '/api/login', { method: 'POST', headers: H, body: JSON.stringify({ user: process.env.ATALAYA_USER, pin: process.env.ATALAYA_PIN }) });
  const cookie = r.headers.get('set-cookie').split(';')[0];
  await fetch(URL0 + '/api/public', { method: 'POST', headers: { ...H, cookie }, body: '{}' });
  const lines = fs.readFileSync(rec, 'utf8').trim().split('\n').map(l => JSON.parse(l));
  const st = lines.filter(l => l.e === 'state').pop().d;
  const want = [['system', 'root'], ['security', 'all'], ['mail', 'all'], ['projects', 'all'], ['databases', 'all'], ['events', 'all'],
    ...['cpu', 'mem', 'disk', 'load', 'net', 'rx', 'tx', 'req', 'err'].map(m => ['metric', m]),
    ...st.accounts.map(a => ['district', a.id]), ...st.apps.slice(0, 40).map(a => ['app', a.id]), ...(st.sites || []).slice(0, 40).map(s => ['site', s.id]),
    ...st.sessions.map(s => ['session', s.id])];
  const det = {};
  for (const [k, id] of want) {
    const x = await fetch(`${URL0}/api/detail?kind=${k}&id=${encodeURIComponent(id)}`, { headers: { cookie } });
    if (!x.ok) continue;
    const d = await x.json();
    if (d.priv || JSON.stringify(d).includes('"priv":true')) throw new Error('respuesta privada: se cancela');
    det[k + ':' + id] = d;
  }
  const pr = det['projects:all'];
  if (pr) for (const p of pr.projects.slice(0, 10)) { const x = await fetch(`${URL0}/api/detail?kind=project&id=${p.id}`, { headers: { cookie } }); if (x.ok) det['project:' + p.id] = await x.json(); }
  det.changelog = await (await fetch(URL0 + '/api/changelog', { headers: { cookie } })).json();
  fs.writeFileSync(out, JSON.stringify(det));
  console.log(Object.keys(det).length, 'respuestas grabadas');
})().catch(e => { console.error(e.message); process.exit(1); });
