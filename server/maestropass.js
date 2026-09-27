'use strict';
// Pase al panel maestro de Atalaya Cloud desde la Atalaya del mismo servidor: un dueno con el modo privado
// activo pulsa «Panel maestro» y entra a la nube sin otro usuario ni PIN. El portal de la nube deja una clave
// en <nube>/maestro/puente.key (solo su usuario la lee; este servicio corre como root con permiso de lectura)
// y con ella se firma un pase de un solo uso que vence en un minuto.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const dirOf = cfg => cfg.cloudDir || '/var/lib/atalaya-cloud';
const keyOf = cfg => { try { return fs.readFileSync(path.join(dirOf(cfg), 'maestro', 'puente.key'), 'utf8').trim(); } catch { return ''; } };

function available(cfg) { return (cfg.edition || 'vps') === 'vps' && /^[0-9a-f]{64}$/.test(keyOf(cfg)); }

function link(cfg, user) {
  const key = keyOf(cfg);
  if (!/^[0-9a-f]{64}$/.test(key)) throw new Error('No hay una Atalaya Cloud en este servidor');
  let base = '';
  try { base = JSON.parse(fs.readFileSync(path.join(dirOf(cfg), 'cloud.json'), 'utf8')).publicUrl || ''; } catch { }
  if (!base) throw new Error('La nube no tiene dirección pública (publicUrl en cloud.json)');
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + 60000, n: crypto.randomBytes(12).toString('hex') })).toString('base64url');
  const sig = crypto.createHmac('sha256', Buffer.from(key, 'hex')).update(payload).digest('base64url');
  return `${base.replace(/\/$/, '')}/maestro/entrar?t=${payload}.${sig}`;
}

// lado de la nube: valida el pase (firma, vencimiento y un solo uso)
const used = new Map();
function verify(key, t) {
  const [payload, sig] = String(t || '').split('.');
  if (!payload || !sig || !/^[0-9a-f]{64}$/.test(key)) return null;
  const want = crypto.createHmac('sha256', Buffer.from(key, 'hex')).update(payload).digest();
  let got; try { got = Buffer.from(sig, 'base64url'); } catch { return null; }
  if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
  let d; try { d = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')); } catch { return null; }
  const now = Date.now();
  for (const [n, exp] of used) if (exp < now) used.delete(n);
  if (!d || typeof d.u !== 'string' || !(d.exp > now) || d.exp > now + 120000 || used.has(d.n)) return null;
  used.set(d.n, d.exp);
  return d;
}

module.exports = { available, link, verify };
