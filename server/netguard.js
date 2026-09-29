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

// ---------------------------------------------------------------- variante estricta
// Para lo que cualquiera puede pedir desde Internet (la revision publica de un dominio): revisa SIEMPRE, sin mirar
// la edicion, y ademas de lo interno bloquea lo reservado (documentacion, pruebas de rendimiento, NAT64) y las
// direcciones propias del servidor: sin eso, «su-dominio.com» apuntando a la IP publica de esta maquina llegaria a
// los servicios que solo escuchan hacia afuera. Las propias salen de ATALAYA_OWN_IPS (separadas por coma), de las
// interfaces de red de la maquina y de la lista que pase quien llama.
const os = require('os');

const V4_BLOCK = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15],
  ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([ip, bits]) => [v4num(ip), bits]);
function v4num(ip) { return ip.split('.').reduce((n, x) => n * 256 + Number(x), 0); }
function v4blocked(ip) {
  const n = v4num(ip);
  return V4_BLOCK.some(([base, bits]) => Math.floor(n / 2 ** (32 - bits)) === Math.floor(base / 2 ** (32 - bits)));
}

// las 8 palabras de 16 bits de una IPv6 valida (acepta la forma con IPv4 al final)
function v6words(ip) {
  let s = ip.toLowerCase();
  const tail = [];
  const m = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (m) {
    const o = m[1].split('.').map(Number);
    tail.push(o[0] * 256 + o[1], o[2] * 256 + o[3]);
    s = s.slice(0, -m[1].length);
    if (s.endsWith(':') && !s.endsWith('::')) s = s.slice(0, -1);
  }
  const [a, b] = s.split('::');
  const head = a ? a.split(':') : [], back = b ? b.split(':') : [];
  const fill = s.includes('::') ? 8 - head.length - back.length - tail.length : 0;
  return [...head, ...Array(Math.max(0, fill)).fill('0'), ...back].map(x => parseInt(x, 16)).concat(tail);
}
const wordsToV4 = (hi, lo) => [hi >> 8, hi & 255, lo >> 8, lo & 255].join('.');

// forma comparable de una IP (para la lista de propias)
function normIp(ip) {
  ip = String(ip || '').trim().replace(/^\[|\]$/g, '').split('%')[0];
  if (net.isIPv4(ip)) return ip;
  if (!net.isIPv6(ip)) return '';
  const w = v6words(ip);
  if (w.slice(0, 5).every(x => x === 0) && w[5] === 0xffff) return wordsToV4(w[6], w[7]);
  return w.map(x => x.toString(16)).join(':');
}

let ifCache = { at: 0, list: [] };
function ownIps(extra = []) {
  if (Date.now() - ifCache.at > 60000) {
    let list = [];
    try { list = Object.values(os.networkInterfaces()).flat().map(x => x && x.address); } catch { }
    ifCache = { at: Date.now(), list };
  }
  const env = String(process.env.ATALAYA_OWN_IPS || '').split(',');
  return new Set([...env, ...ifCache.list, ...(typeof extra === 'function' ? extra() : extra || [])].map(normIp).filter(Boolean));
}

// true si la IP no se puede visitar desde una revision publica
function blockedIpStrict(ip, own = []) {
  const n = normIp(ip);
  if (!n) return true; // lo que no es una IP valida tampoco pasa
  if (ownIps(own).has(n)) return true;
  if (net.isIPv4(n)) return v4blocked(n);
  const w = v6words(n); // las ::ffff:a.b.c.d ya llegan como IPv4 (normIp)
  // solo el unicast global (2000::/3) sale a Internet: fuera queda ::, ::1, las IPv4 compatibles y traducidas,
  // 64:ff9b::/96 (NAT64), 100::/64, fc00::/7, fe80::/10, fec0::/10 y ff00::/8
  if ((w[0] & 0xe000) !== 0x2000) return true;
  if (w[0] === 0x2001 && w[1] < 0x0200) return true; // 2001::/23: Teredo, pruebas de rendimiento y otros reservados
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true; // 2001:db8::/32, documentacion
  if (w[0] === 0x3fff && w[1] < 0x1000) return true; // 3fff::/20, documentacion
  if (w[0] === 0x2002) return v4blocked(wordsToV4(w[1], w[2])); // 6to4 lleva una IPv4 adentro
  return false;
}

// un IP literal no pasa por el lookup: se revisa aparte (un nombre devuelve false; lo revisa strictLookup)
function blockedHostStrict(host, own = []) {
  const h = String(host || '').replace(/^\[|\]$/g, '');
  return net.isIP(h.split('%')[0]) ? blockedIpStrict(h, own) : false;
}

// mismo contrato que dns.lookup, siempre estricto: falla si CUALQUIERA de las direcciones esta bloqueada.
// `base` permite inyectar la resolucion en las pruebas; `own` agrega IPs propias (lista o funcion).
function makeStrictLookup({ base = dns.lookup, own = [] } = {}) {
  return function strictLookupFn(host, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (typeof opts === 'number') opts = { family: opts };
    base(host, { ...opts, all: true }, (err, list) => {
      if (err) return cb(err);
      if (!Array.isArray(list) || !list.length || list.some(x => blockedIpStrict(x.address, own))) return cb(Object.assign(new Error('direccion interna o reservada'), { code: 'EPRIVATE' }));
      if (opts.all) return cb(null, list);
      cb(null, list[0].address, list[0].family);
    });
  };
}
const strictLookup = makeStrictLookup();

module.exports = { privateIp, lookup, blockedHost, strict, blockedIpStrict, blockedHostStrict, strictLookup, makeStrictLookup, normIp, ownIps };
