'use strict';
// Iconos reales de cada proyecto: el favicon de su dominio. Sin IA ni servicios de terceros: se pide la pagina
// de inicio del propio sitio, se leen sus <link rel="icon"> (o /favicon.ico) y se guarda la imagen en disco.
//  - de a una descarga por vez, con limite de tiempo y de tamano; se renueva cada 7 dias (fallos: cada 24 h)
//  - solo imagenes reales (se revisa la firma del archivo); nunca se sigue un enlace a una IP interna,
//    salvo el propio dominio del sitio (que suele resolver a este mismo servidor)
//  - solo se muestran en MODO PRIVADO: un favicon delata la marca del proyecto
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const dns = require('dns').promises;
const http = require('http');
const https = require('https');

const DAY = 86400000;
const MAX_HTML = 256 * 1024, MAX_ICON = 512 * 1024, TIMEOUT = 6000;
const UA = 'Mozilla/5.0 (compatible; Atalaya-monitor; favicon)';

const keyOf = domain => crypto.createHash('sha1').update('fav:' + String(domain).toLowerCase()).digest('hex').slice(0, 16);

// firma del archivo: que tipo de imagen es (o null si no es una imagen)
function sniff(buf) {
  if (!buf || buf.length < 4) return null;
  if (buf[0] === 0x89 && buf.slice(1, 4).toString() === 'PNG') return 'image/png';
  if (buf[0] === 0 && buf[1] === 0 && (buf[2] === 1 || buf[2] === 2) && buf[3] === 0) return 'image/x-icon';
  if (buf.slice(0, 3).toString() === 'GIF') return 'image/gif';
  if (buf[0] === 0xff && buf[1] === 0xd8) return 'image/jpeg';
  if (buf.slice(0, 4).toString() === 'RIFF' && buf.slice(8, 12).toString() === 'WEBP') return 'image/webp';
  const head = buf.slice(0, 512).toString('utf8').trimStart().toLowerCase();
  if (head.startsWith('<svg') || (head.startsWith('<?xml') && head.includes('<svg'))) return 'image/svg+xml';
  return null;
}

const { privateIp, lookup, blockedHost, strict } = require('./netguard');

// GET con tope de bytes y de tiempo; sigue hasta 3 redirecciones
function get(url, max, siteHost, hops = 0) {
  return new Promise(async (resolve, reject) => {
    let u;
    try { u = new URL(url); } catch { return reject(new Error('url')); }
    if (!/^https?:$/.test(u.protocol)) return reject(new Error('protocolo'));
    try {
      const { address } = await dns.lookup(u.hostname);
      if (privateIp(address) && (u.hostname !== siteHost || strict())) return reject(new Error('ip interna'));
    } catch { return reject(new Error('dns')); }
    if (blockedHost(u.hostname)) return reject(new Error('ip interna'));
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(u, { headers: { 'User-Agent': UA, Accept: '*/*' }, timeout: TIMEOUT, rejectUnauthorized: false, lookup }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && hops < 3) {
        res.resume();
        return get(new URL(res.headers.location, u).href, max, siteHost, hops + 1).then(resolve, reject);
      }
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('http ' + res.statusCode)); }
      const chunks = []; let n = 0;
      res.on('data', c => { n += c.length; if (n > max) { req.destroy(); return reject(new Error('muy grande')); } chunks.push(c); });
      res.on('end', () => resolve({ body: Buffer.concat(chunks), url: u.href, type: String(res.headers['content-type'] || '') }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('tiempo')));
    req.on('error', reject);
  });
}

// candidatos del HTML: primero los mas grandes (se ven mejor al achicarlos), luego /favicon.ico
function candidates(html, base) {
  const out = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(tag) || [])[1] || '';
    if (!/\bicon\b|apple-touch-icon/i.test(rel) || /mask-icon/i.test(rel)) continue;
    const href = (/\bhref\s*=\s*["']?([^"'\s>]+)/i.exec(tag) || [])[1];
    if (!href || href.startsWith('data:')) continue;
    const sizes = (/\bsizes\s*=\s*["']?(\d+)/i.exec(tag) || [])[1];
    let score = sizes ? Math.min(+sizes, 256) : /apple-touch/i.test(rel) ? 180 : /\.svg(\?|$)/i.test(href) ? 200 : 32;
    try { out.push({ url: new URL(href, base).href, score }); } catch { }
  }
  out.sort((a, b) => b.score - a.score);
  try { out.push({ url: new URL('/favicon.ico', base).href, score: 0 }); } catch { }
  return [...new Map(out.map(c => [c.url, c])).values()].slice(0, 5);
}

class Favicons {
  constructor(dir, log = () => { }) {
    this.dir = dir; this.log = log;
    this.meta = new Map(); // key -> { domain, ok, t, type }
    this.queue = []; this.busy = false;
    try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch { }
    try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8')))) this.meta.set(k, v); } catch { }
  }
  // clave del favicon listo para mostrar (o null)
  ready(domain) {
    if (!domain) return null;
    const m = this.meta.get(keyOf(domain));
    return m && m.ok ? keyOf(domain) : null;
  }
  // pide el favicon de un dominio si no lo tiene o esta viejo
  want(domain) {
    if (!domain || /^\*|^localhost$|^\d+\.\d+\.\d+\.\d+$/.test(domain)) return;
    const k = keyOf(domain), m = this.meta.get(k);
    if (m && Date.now() - m.t < (m.ok ? 7 * DAY : DAY)) return;
    if (this.queue.some(q => q.k === k)) return;
    this.queue.push({ k, domain });
    this.pump();
  }
  async pump() {
    if (this.busy) return;
    this.busy = true;
    while (this.queue.length) {
      const { k, domain } = this.queue.shift();
      let ok = false, type = null;
      try {
        const icon = await this.fetchIcon(domain);
        if (icon) { fs.writeFileSync(path.join(this.dir, k), icon.body, { mode: 0o600 }); ok = true; type = icon.type; }
      } catch (e) { this.log(`[favicon] ${domain}: ${e.message}`); }
      this.meta.set(k, { domain, ok, type, t: Date.now() });
      this.save();
      await new Promise(r => setTimeout(r, 400)); // sin apuro: una por vez
    }
    this.busy = false;
  }
  async fetchIcon(domain) {
    let page = null;
    for (const proto of ['https', 'http']) { try { page = await get(`${proto}://${domain}/`, MAX_HTML, domain); break; } catch { } }
    const base = page ? page.url : `https://${domain}/`;
    const list = candidates(page ? page.body.toString('utf8') : '', base);
    for (const c of list) {
      try {
        const r = await get(c.url, MAX_ICON, domain);
        const type = sniff(r.body);
        if (type && r.body.length > 60) return { body: r.body, type };
      } catch { }
    }
    return null;
  }
  save() {
    const tmp = path.join(this.dir, 'index.json.tmp');
    try { fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.meta)), { mode: 0o600 }); fs.renameSync(tmp, path.join(this.dir, 'index.json')); } catch { }
  }
  // el archivo para servir: { body, type } o null
  file(key) {
    if (!/^[0-9a-f]{16}$/.test(key)) return null;
    const m = this.meta.get(key);
    if (!m || !m.ok) return null;
    try { const body = fs.readFileSync(path.join(this.dir, key)); return { body, type: sniff(body) || m.type }; } catch { return null; }
  }
}

module.exports = { Favicons, keyOf, sniff, candidates, privateIp };
