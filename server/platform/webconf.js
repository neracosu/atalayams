'use strict';
// Lectores minimos de configuracion de Apache y Nginx: nombre, alias, carpeta, log y proxy de cada sitio.
// No pretenden entender todo el lenguaje; solo lo necesario para ubicar sitios y sus logs.

const unq = v => String(v || '').trim().replace(/^["']|["']$/g, '');
const portOf = url => { const m = String(url || '').match(/^(?:https?|h2c?):\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d{2,5})/); return m ? Number(m[1]) : null; };

// <VirtualHost *:80> ... </VirtualHost>
function parseApache(text) {
  const out = [];
  const lines = String(text).replace(/\\\n/g, ' ').split('\n');
  let cur = null;
  for (let raw of lines) {
    const line = raw.replace(/^\s*#.*$/, '').trim();
    if (!line) continue;
    if (/^<VirtualHost\b/i.test(line)) { cur = { servername: '', aliases: [], docroot: '', logs: [], proxyPort: null, user: '', ssl: /:443\b/.test(line) }; continue; }
    if (/^<\/VirtualHost>/i.test(line)) { if (cur && cur.servername) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const [k, ...rest] = line.split(/\s+/);
    const key = k.toLowerCase();
    if (key === 'servername') cur.servername = unq(rest[0]).replace(/:\d+$/, '');
    else if (key === 'serveralias') cur.aliases.push(...rest.map(unq).filter(Boolean));
    else if (key === 'documentroot') cur.docroot = unq(rest.join(' ')).replace(/\/$/, '');
    else if (key === 'customlog' || key === 'transferlog') { const f = unq(rest[0]); if (f && !f.startsWith('|')) cur.logs.push(f); }
    else if (key === 'proxypass' && !cur.proxyPort) cur.proxyPort = portOf(rest[1]);
    else if (key === 'rewriterule' && !cur.proxyPort && /\[.*P.*\]/.test(line)) cur.proxyPort = portOf(rest[1]);
    else if (key === 'suexecusergroup' || key === 'assignuserid') cur.user = unq(rest[0]);
  }
  return out;
}

// server { ... } respetando llaves anidadas (location { ... })
function parseNginx(text) {
  const src = String(text).split('\n').map(l => l.replace(/(^|\s)#.*$/, '')).join('\n');
  const out = [];
  const re = /\bserver\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1, i = re.lastIndex;
    while (i < src.length && depth) { if (src[i] === '{') depth++; else if (src[i] === '}') depth--; i++; }
    const body = src.slice(re.lastIndex, i - 1);
    re.lastIndex = i;
    // directivas del nivel superior del bloque (las de location se usan solo para proxy_pass)
    let top = '', d = 0;
    for (const ch of body) { if (ch === '{') d++; if (d === 0) top += ch; if (ch === '}') d--; }
    const dir = name => { const r = new RegExp('(?:^|;|\\n)\\s*' + name + '\\s+([^;]+);', 'g'); const vals = []; let x; while ((x = r.exec(top))) vals.push(x[1].trim()); return vals; };
    const names = dir('server_name').flatMap(v => v.split(/\s+/)).map(unq).filter(n => n && n !== '_' && n !== 'localhost');
    if (!names.length) continue;
    const logs = dir('access_log').map(v => unq(v.split(/\s+/)[0])).filter(f => f && f !== 'off' && !f.startsWith('syslog:'));
    const pp = (body.match(/proxy_pass\s+([^;]+);/) || [])[1];
    out.push({ servername: names[0], aliases: names.slice(1), docroot: unq((dir('root')[0] || '')).replace(/\/$/, ''), logs,
      proxyPort: portOf(unq(pp)), ssl: /listen\s+[^;]*443/.test(top) });
  }
  return out;
}

// une bloques del mismo sitio (ej. :80 y :443) por nombre
function mergeSites(list) {
  const by = new Map();
  for (const v of list) {
    const k = v.servername;
    const e = by.get(k);
    if (!e) { by.set(k, { ...v, aliases: [...v.aliases], logs: [...v.logs] }); continue; }
    for (const a of v.aliases) if (!e.aliases.includes(a)) e.aliases.push(a);
    for (const l of v.logs) if (!e.logs.includes(l)) e.logs.push(l);
    e.docroot = e.docroot || v.docroot; e.proxyPort = e.proxyPort || v.proxyPort; e.user = e.user || v.user;
  }
  return [...by.values()];
}

module.exports = { parseApache, parseNginx, mergeSites, portOf };
