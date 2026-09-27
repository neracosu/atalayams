'use strict';
// Acceso a archivos del sistema con una raiz configurable (ATALAYA_FSROOT) para poder probar
// cada plataforma contra un servidor simulado (test/fixtures/<plataforma>/...).
const fs = require('fs');
const path = require('path');

const ROOT = process.env.ATALAYA_FSROOT || '';
const P = p => (ROOT ? path.join(ROOT, p) : p);

const exists = p => { try { fs.accessSync(P(p)); return true; } catch { return false; } };
const isDir = p => { try { return fs.statSync(P(p)).isDirectory(); } catch { return false; } };
const read = (p, fb = '') => { try { return fs.readFileSync(P(p), 'utf8'); } catch { return fb; } };
const ls = p => { try { return fs.readdirSync(P(p)); } catch { return []; } };
const stat = p => { try { return fs.statSync(P(p)); } catch { return null; } };
const mtime = p => { const s = stat(p); return s ? s.mtimeMs : 0; };
// patron simple con un solo * en el nombre de archivo: /etc/nginx/conf.d/*.conf
function glob(pattern) {
  const dir = path.dirname(pattern), base = path.basename(pattern);
  if (!base.includes('*')) return exists(pattern) ? [pattern] : [];
  const re = new RegExp('^' + base.split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$');
  return ls(dir).filter(f => re.test(f)).map(f => dir + '/' + f);
}
// dueno de un archivo o carpeta: nombre de usuario segun /etc/passwd del sistema (o del simulado)
let passwdCache = null;
function passwd() {
  if (passwdCache) return passwdCache;
  const byUid = new Map(), byName = new Map();
  for (const line of read('/etc/passwd').split('\n')) {
    const p = line.split(':');
    if (p.length > 5) { const u = { name: p[0], uid: Number(p[2]), home: p[5] }; byUid.set(u.uid, u); byName.set(u.name, u); }
  }
  passwdCache = { byUid, byName };
  return passwdCache;
}
function owner(p) {
  const st = stat(p);
  if (!st) return null;
  // en simulaciones el dueno real es root: se usa un archivo .owner si existe
  const o = read(p + '/.owner').trim() || (ROOT ? read(path.dirname(p) + '/.owner').trim() : '');
  if (o) return o;
  const u = passwd().byUid.get(st.uid);
  return u ? u.name : null;
}
function resetCaches() { passwdCache = null; }

module.exports = { ROOT, P, exists, isDir, read, ls, stat, mtime, glob, passwd, owner, resetCaches };
