'use strict';
// Salidas a Internet hacia direcciones que da el usuario (favicons, sondas web): en Atalaya Cloud no pueden
// tocar la red interna de la maquina que aloja (127.0.0.1, 10.x, etc.). La revision va en el `lookup` del
// socket, asi un DNS que cambia entre la consulta y la conexion (rebinding) tampoco pasa.
const dns = require('dns');
const net = require('net');

function privateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const l = ip.toLowerCase();
  if (l.startsWith('::ffff:') && net.isIPv4(l.slice(7))) return privateIp(l.slice(7));
  return l === '::1' || l === '::' || l.startsWith('fc') || l.startsWith('fd') || l.startsWith('fe80') || l.startsWith('ff');
}

const strict = () => process.env.ATALAYA_EDITION === 'cloud';

// mismo contrato que dns.lookup; en la nube falla si alguna direccion es interna
function lookup(host, opts, cb) {
  if (typeof opts === 'function') { cb = opts; opts = {}; }
  if (!strict()) return dns.lookup(host, opts, cb);
  dns.lookup(host, { ...opts, all: true }, (err, list) => {
    if (err) return cb(err);
    if (!list.length || list.some(x => privateIp(x.address))) return cb(Object.assign(new Error('direccion interna'), { code: 'EPRIVATE' }));
    if (opts.all) return cb(null, list);
    cb(null, list[0].address, list[0].family);
  });
}

// un IP literal no pasa por lookup: se revisa aparte
function blockedHost(host) { return strict() && net.isIP(String(host).replace(/^\[|\]$/g, '')) && privateIp(String(host).replace(/^\[|\]$/g, '')); }

module.exports = { privateIp, lookup, blockedHost, strict };
