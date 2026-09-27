'use strict';
// Sondas web a pedido para el mapa de proyectos (solo lectura, desde afuera, como un visitante):
//  - certificado TLS: emisor y vencimiento (una conexion al 443)
//  - respuesta del sitio: codigo HTTP y tiempo (un GET a /, sin seguir redirecciones fuera del dominio)
//  - vencimiento del dominio: RDAP (el reemplazo moderno de WHOIS), via rdap.org
const tls = require('tls');
const https = require('https');
const http = require('http');
const { lookup, blockedHost } = require('../netguard');

const RDAP = process.env.ATALAYA_RDAP || 'https://rdap.org/domain/';
// sufijos de segundo nivel comunes (para sacar el dominio registrable de un subdominio)
const SLD = new Set(['com.ve', 'net.ve', 'org.ve', 'co.ve', 'gob.ve', 'com.ar', 'com.mx', 'com.co', 'com.pe', 'com.br', 'com.ec', 'com.uy', 'com.py', 'com.bo',
  'com.pa', 'com.do', 'com.gt', 'com.sv', 'com.hn', 'com.ni', 'co.cr', 'com.es', 'co.uk', 'org.uk', 'com.au', 'co.nz', 'co.za', 'co.jp', 'com.cn', 'com.tr']);

function registrable(host) {
  const h = String(host || '').toLowerCase().replace(/^\*\./, '').replace(/\.$/, '');
  const parts = h.split('.');
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  return SLD.has(last2) ? parts.slice(-3).join('.') : last2;
}

function certOf(host, { port = 443, timeout = 8000 } = {}) {
  return new Promise(resolve => {
    if (blockedHost(host)) return resolve({ ok: false, error: 'dirección interna' });
    const s = tls.connect({ host, port, servername: host, rejectUnauthorized: false, timeout, lookup }, () => {
      const c = s.getPeerCertificate();
      const ok = s.authorized;
      const err = s.authorizationError ? String(s.authorizationError) : null;
      s.end();
      if (!c || !c.valid_to) return resolve({ ok: false, error: 'sin certificado' });
      resolve({ ok, error: ok ? null : err, expires: Date.parse(c.valid_to) || null, issuer: (c.issuer && (c.issuer.O || c.issuer.CN)) || '',
        names: String(c.subjectaltname || '').split(',').map(x => x.trim().replace(/^DNS:/, '')).filter(Boolean).slice(0, 20) });
    });
    s.on('timeout', () => { s.destroy(); resolve({ ok: false, error: 'sin respuesta en el puerto 443' }); });
    s.on('error', e => resolve({ ok: false, error: e.code || e.message }));
  });
}

function httpCheck(host, { timeout = 10000 } = {}) {
  return new Promise(resolve => {
    const t0 = Date.now();
    if (blockedHost(host)) return resolve({ status: 0, ms: 0, error: 'dirección interna' });
    const req = https.request({ host, path: '/', method: 'GET', timeout, lookup, headers: { 'User-Agent': 'Atalaya-monitor (revision a pedido)' }, rejectUnauthorized: false }, res => {
      res.resume();
      resolve({ status: res.statusCode, ms: Date.now() - t0, location: res.headers.location || null, server: res.headers.server || '',
        hsts: !!res.headers['strict-transport-security'] });
    });
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, ms: Date.now() - t0, error: 'no respondió a tiempo' }); });
    req.on('error', e => resolve({ status: 0, ms: Date.now() - t0, error: e.code || e.message }));
    req.end();
  });
}

function getJson(url, hops = 0) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? http : https;
    const req = mod.get(u, { timeout: 12000, headers: { Accept: 'application/rdap+json, application/json', 'User-Agent': 'Atalaya' } }, res => {
      if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 4) { res.resume(); return resolve(getJson(new URL(res.headers.location, url).toString(), hops + 1)); }
      let d = ''; res.setEncoding('utf8');
      res.on('data', c => { d += c; if (d.length > 2 << 20) req.destroy(); });
      res.on('end', () => { if (res.statusCode !== 200) return reject(new Error('RDAP ' + res.statusCode)); try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject);
  });
}

// vencimiento del dominio (null si el registro no publica RDAP, ej. muchos .ve)
async function domainExpiry(domain) {
  try {
    const j = await getJson(RDAP + encodeURIComponent(domain));
    const ev = (j.events || []).find(e => /expiration/i.test(e.eventAction));
    const reg = (j.entities || []).find(e => (e.roles || []).includes('registrar'));
    const name = reg && reg.vcardArray ? ((reg.vcardArray[1] || []).find(v => v[0] === 'fn') || [])[3] : '';
    return { expires: ev ? Date.parse(ev.eventDate) || null : null, registrar: name || '', status: j.status || [] };
  } catch (e) { return { expires: null, error: e.message }; }
}

module.exports = { registrable, certOf, httpCheck, domainExpiry };
