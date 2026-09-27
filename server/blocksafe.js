'use strict';
// Que IPs NUNCA se bloquean. Lo usan la defensa (antes de pedir) y el ayudante (antes de ejecutar): doble
// revision. Nunca: redes privadas, el propio servidor, ni Cloudflare (si un sitio esta detras de Cloudflare,
// la IP que llega es la de su nodo: bloquearla dejaria sin servicio a todos los que entran por ahi).
const net = require('net');
const fs = require('fs');
const os = require('os');

const CLOUDFLARE = ['173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22', '141.101.64.0/18', '108.162.192.0/18',
  '190.93.240.0/20', '188.114.96.0/20', '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13', '104.24.0.0/14',
  '172.64.0.0/13', '131.0.72.0/22', '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32', '2405:8100::/32',
  '2a06:98c0::/29', '2c0f:f248::/32'];
const PRIVATE = ['0.0.0.0/8', '10.0.0.0/8', '100.64.0.0/10', '127.0.0.0/8', '169.254.0.0/16', '172.16.0.0/12', '192.168.0.0/16',
  '224.0.0.0/4', '240.0.0.0/4', '::/128', '::1/128', 'fc00::/7', 'fe80::/10', 'ff00::/8'];

function blockList(cidrs) {
  const bl = new net.BlockList();
  for (const c of cidrs) { const [a, b] = c.split('/'); bl.addSubnet(a, Number(b), net.isIP(a) === 6 ? 'ipv6' : 'ipv4'); }
  return bl;
}
const CF = blockList(CLOUDFLARE), PRIV = blockList(PRIVATE);

// IPs propias del servidor (interfaces y la principal de cPanel)
function ownIps() {
  const out = new Set();
  try { for (const l of Object.values(os.networkInterfaces())) for (const i of l || []) out.add(i.address); } catch { }
  try { const m = fs.readFileSync('/var/cpanel/mainip', 'utf8').trim(); if (m) out.add(m); } catch { }
  return out;
}

// null si se puede bloquear; si no, el motivo
function unsafe(ip, extra = []) {
  ip = String(ip || '').trim().replace(/^::ffff:/, '');
  const v = net.isIP(ip);
  if (!v) return 'No es una dirección IP válida';
  const fam = v === 6 ? 'ipv6' : 'ipv4';
  if (PRIV.check(ip, fam)) return 'Es una dirección privada o local';
  if (CF.check(ip, fam)) return 'Es un nodo de Cloudflare: bloquearlo cortaría el sitio a todos los que entran por ahí';
  if (ownIps().has(ip)) return 'Es una IP de este mismo servidor';
  if (extra.includes(ip)) return 'Está en la lista de IPs que nunca se bloquean (o es de un usuario conectado a Atalaya)';
  return null;
}

// trafico interno (el propio servidor, redes privadas o las revisiones de Atalaya): no es un visitante ni un atacante
let ownCache = null, ownAt = 0;
function internal(ip, ua) {
  if (ua && /Atalaya-monitor/i.test(typeof ua === 'object' ? ua.raw || ua.name || '' : ua)) return true;
  ip = String(ip || '').replace(/^::ffff:/, '');
  const v = net.isIP(ip); if (!v) return false;
  if (PRIV.check(ip, v === 6 ? 'ipv6' : 'ipv4')) return true;
  if (!ownCache || Date.now() - ownAt > 600000) { ownCache = ownIps(); ownAt = Date.now(); }
  return ownCache.has(ip);
}

// una IP de un nodo de Cloudflare (si el registro de un sitio solo trae estas, el servidor no recibe la IP real)
function isCloudflare(ip) { ip = String(ip || '').replace(/^::ffff:/, ''); const v = net.isIP(ip); return !!v && CF.check(ip, v === 6 ? 'ipv6' : 'ipv4'); }

module.exports = { unsafe, internal, isCloudflare, CLOUDFLARE };
