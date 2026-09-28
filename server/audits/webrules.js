'use strict';
// Revision web diaria de los sitios vigilados por dominio: una vez al dia se visita cada sitio como lo haria un
// buscador y se anotan las FALTAS. Nace de un caso real: Cloudflare encendio sola la casilla que bloquea a los
// rastreadores de IA en robots.txt y los espejos *.pages.dev estuvieron indexables durante meses sin que nadie
// lo notara.
//  - cada sitio es publico (debe encontrarse: portada, robots.txt, sitemap.xml, llms.txt) o privado (no debe
//    encontrarse: basta con que no se pueda indexar)
//  - «no pude medir» no es «esta roto»: una peticion que falla se repite una vez; si sigue sin responder, esa
//    comprobacion va a `unmeasured`, no genera faltas y las que ya habia de ese archivo se conservan (si no, un
//    corte de red anunciaria un arreglo que nadie hizo)
//  - solo las faltas graves avisan: una vez al aparecer y una vez al arreglarse
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { readJSON, writeJSONAtomic } = require('../util');
const { lookup, blockedHost } = require('../netguard');

const FIRST = 2 * 60000, EVERY = 24 * 3600000, RETRY = 5000, TIMEOUT = 20000, MIN_TEXT = 300;
const UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const MIRRORS = ['.pages.dev', '.vercel.app', '.netlify.app', '.workers.dev']; // espejos tecnicos: nadie quiere verlos en Google
const AI_BOTS = ['GPTBot', 'ClaudeBot', 'CCBot', 'PerplexityBot', 'Google-Extended', 'Applebot-Extended', 'Bytespider', 'meta-externalagent', 'Amazonbot', 'OAI-SearchBot', 'ChatGPT-User', 'anthropic-ai'];
const GHOST = '/no-existe-atalaya-zz9';
// nombre de cada comprobacion (lo que se lee en `unmeasured`) y de que comprobacion sale cada falta
const HOME = 'portada', ROBOTS = 'robots.txt', SITEMAP = 'sitemap.xml', LLMS = 'llms.txt', NOWHERE = 'dirección inventada';
const SOURCE = { indexable: HOME, noindex: HOME, empty: HOME, h1: HOME, title: HOME, description: HOME, jsonld: HOME, robots: ROBOTS, ai: ROBOTS, all: ROBOTS, sitemap: SITEMAP, llms: LLMS, soft404: NOWHERE };
const ORDER = Object.keys(SOURCE), RANK = { ok: 0, info: 1, warn: 2, bad: 3 };
const WHY = { ENOTFOUND: 'el dominio no resuelve', EAI_AGAIN: 'el dominio no resuelve', ECONNREFUSED: 'rechazó la conexión', ECONNRESET: 'cortó la conexión',
  CERT_HAS_EXPIRED: 'el certificado está vencido', DEPTH_ZERO_SELF_SIGNED_CERT: 'el certificado no es de confianza', ERR_TLS_CERT_ALTNAME_INVALID: 'el certificado es de otro dominio',
  EPRIVATE: 'dirección interna', ETIMEDOUT: 'no respondió a tiempo' };

// una visita como la de websites.js, pero con el nombre de Googlebot y devolviendo las cabeceras que importan y la
// direccion final (un espejo que redirige al dominio principal no es un espejo indexable)
function visit(url, hops = 0) {
  return new Promise(resolve => {
    const t0 = Date.now();
    let u; try { u = new URL(url); } catch { return resolve({ status: 0, ms: 0, error: 'dirección inválida' }); }
    if (blockedHost(u.hostname)) return resolve({ status: 0, ms: 0, error: 'dirección interna' });
    const mod = u.protocol === 'http:' ? http : https;
    let req;
    try {
      req = mod.request(u, { method: 'GET', timeout: TIMEOUT, lookup, headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,text/plain,*/*' } }, res => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops < 4) {
          res.resume();
          let next; try { next = new URL(res.headers.location, u).toString(); } catch { return resolve({ status: 0, ms: Date.now() - t0, error: 'redirección inválida' }); }
          return resolve(visit(next, hops + 1).then(r => ({ ...r, ms: r.ms + (Date.now() - t0) })));
        }
        let body = '', size = 0;
        res.setEncoding('utf8');
        res.on('data', c => { size += c.length; if (size <= 512 * 1024) body += c; else req.destroy(); });
        const done = () => resolve({ status: res.statusCode, ms: Date.now() - t0, body, url: u.toString(), headers: { 'x-robots-tag': [].concat(res.headers['x-robots-tag'] || []).join(', '), 'content-type': String(res.headers['content-type'] || '') } });
        res.on('end', done); res.on('close', done);
      });
    } catch (e) { return resolve({ status: 0, ms: Date.now() - t0, error: e.message }); }
    req.on('timeout', () => { req.destroy(); resolve({ status: 0, ms: Date.now() - t0, error: `no respondió en ${TIMEOUT / 1000} s` }); });
    req.on('error', e => resolve({ status: 0, ms: Date.now() - t0, error: WHY[e.code] || e.code || e.message }));
    req.end();
  });
}

// ---- lectura de lo que responde el sitio ----
const head = r => String((r && r.body) || '').replace(/^﻿/, '').trimStart().slice(0, 200).toLowerCase();
const ok2xx = r => !!r && r.status >= 200 && r.status <= 299;
const header = (r, name) => { const h = (r && r.headers) || {}, k = Object.keys(h).find(x => x.toLowerCase() === name); return k ? [].concat(h[k] || []).join(', ') : ''; };
// una portada disfrazada de archivo: los sitios de una sola pagina responden su HTML (200) a cualquier direccion
const looksHtml = r => /^<(!doctype|html|head|body)\b/.test(head(r));
const isHtml = r => looksHtml(r) || /html/i.test(header(r, 'content-type')) || (!header(r, 'content-type') && /<(meta|title|div|h1|p|a|script)\b/i.test(String(r.body || '')));
const isFile = r => ok2xx(r) && r.status !== 204 && !looksHtml(r);
// el texto que se lee, sin codigo ni estilos (la idea de textOf de websites.js)
const textOf = html => String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/gi, ' ').replace(/&[a-z0-9#]+;/gi, 'x').replace(/\s+/g, ' ').trim();
function metas(html) {
  const out = [];
  for (const tag of String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').match(/<meta\b[^>]*>/gi) || []) {
    const a = {};
    tag.replace(/([a-z:_-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+))/gi, (m, k, d, s, b) => { a[k.toLowerCase()] = d != null ? d : s != null ? s : b; return m; });
    out.push(a);
  }
  return out;
}
// noindex en la cabecera o en la pagina («none» equivale a noindex, nofollow); vale el general y el dirigido a Google
function noindex(r) {
  const bad = v => /\b(noindex|none)\b/i.test(String(v || ''));
  if (bad(header(r, 'x-robots-tag'))) return true;
  return metas(r.body).some(m => /^(robots|googlebot)$/i.test(String(m.name || '').trim()) && bad(m.content));
}

// robots.txt por grupos de verdad: varias lineas User-agent seguidas comparten las reglas que vienen despues, y un
// User-agent que aparece despues de una regla abre un grupo nuevo
function parseRobots(txt) {
  const groups = []; let cur = null, inRules = false;
  for (const raw of String(txt || '').replace(/^﻿/, '').split(/\r?\n|\r/)) {
    const line = raw.replace(/#.*$/, '').trim(), i = line.indexOf(':');
    if (i < 1) continue;
    const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim();
    if (k === 'user-agent') { if (!cur || inRules) { cur = { agents: [], rules: [] }; groups.push(cur); inRules = false; } cur.agents.push(v.toLowerCase()); }
    else if (k === 'allow' || k === 'disallow') { if (cur) { cur.rules.push([k, v]); inRules = true; } }
    else if (cur && cur.agents.length) inRules = true; // crawl-delay y similares tambien cierran la lista de nombres
  }
  return groups;
}
// cerrado del todo para ese rastreador: tiene «Disallow: /» y ningun «Allow: /» que lo abra. null si no se le nombra
function blocked(groups, agent) {
  const rules = [].concat(...groups.filter(g => g.agents.includes(agent.toLowerCase())).map(g => g.rules));
  if (!groups.some(g => g.agents.includes(agent.toLowerCase()))) return null;
  const root = v => v === '/' || v === '/*';
  return rules.some(([k, v]) => k === 'disallow' && root(v)) && !rules.some(([k, v]) => k === 'allow' && root(v));
}
const robotsInfo = txt => { const g = parseRobots(txt); return { ai: AI_BOTS.filter(b => blocked(g, b) === true), all: blocked(g, '*') === true, cloudflare: /cloudflare[ -]managed/i.test(String(txt || '')) }; };

// publico o privado: lo que el dueno declare (index) manda; si no, se deduce
function kindOf(site) {
  if (site.index === false) return 'private';
  if (site.index === true) return 'public';
  const d = String(site.domain || '').toLowerCase();
  return [401, 403].includes(Number(site.expect)) || MIRRORS.some(m => d.endsWith(m)) ? 'private' : 'public';
}

// ---- las faltas, con su primer paso para arreglarlas ----
const list = a => (a.length > 1 ? a.slice(0, -1).join(', ') + ' y ' + a[a.length - 1] : a[0] || '');
const F = {
  indexable: () => ['bad', 'Se puede indexar: cualquiera lo encuentra en Google', 'Si este sitio no es para el público, póngale contraseña o haga que responda con la cabecera «X-Robots-Tag: noindex». Si es un espejo de Cloudflare Pages, Vercel o Netlify, desactive esa dirección o protéjala desde el panel de ese servicio.'],
  noindex: () => ['bad', 'Dejó de indexarse: va a desaparecer de Google', 'Busque «noindex» en el código de la portada y en la configuración del sitio (en WordPress: Ajustes › Lectura › «Disuadir a los motores de búsqueda») y quítelo.'],
  empty: n => ['bad', `Entrega la página vacía a los buscadores y a las IA (${n} caracteres de texto)`, 'El contenido aparece solo cuando corre el código en el navegador. Pida a quien desarrolla el sitio que lo publique con el texto ya escrito en la página (prerenderizado o generación estática).'],
  robots: () => ['bad', 'No tiene un archivo robots.txt de verdad', 'Cree un archivo de texto llamado robots.txt en la carpeta principal del sitio con dos líneas: «User-agent: *» y «Allow: /». Compruebe que al abrir /robots.txt se vea ese texto y no la portada.'],
  ai: (bots, cf) => ['bad', `El robots.txt bloquea a los rastreadores de IA: ${list(bots)}`, (cf ? 'Cloudflare lo enciende solo: Security › Settings › Bot traffic › desactive el bloqueo de robots de IA. ' : '') + 'En el robots.txt quite la línea «Disallow: /» de esos rastreadores o cámbiela por «Allow: /».'],
  all: () => ['bad', 'El robots.txt bloquea a TODOS los buscadores', 'En el robots.txt, debajo de «User-agent: *», cambie «Disallow: /» por «Allow: /». Suele quedar así cuando se publica la configuración de un sitio de pruebas.'],
  sitemap: () => ['warn', 'No tiene un sitemap.xml válido', 'Genere el mapa del sitio (la mayoría de los sistemas lo hace solo o con un complemento), publíquelo en /sitemap.xml y anótelo en el robots.txt con una línea «Sitemap:».'],
  llms: () => ['info', 'No tiene llms.txt', 'Es opcional: un archivo de texto en /llms.txt que resume el sitio y sus páginas principales para los asistentes de IA.'],
  soft404: () => ['warn', 'Responde 200 a una dirección que no existe: Google lo cuenta como páginas duplicadas', 'Configure el sitio para que las direcciones que no existen respondan 404 (en Cloudflare Pages o Netlify, agregue una página 404.html).'],
  h1: () => ['warn', 'La portada no tiene un título principal (h1)', 'Ponga el título principal de la portada dentro de una etiqueta <h1>, una sola vez.'],
  title: () => ['warn', 'La portada no tiene título (title)', 'Agregue en la cabecera de la página una etiqueta <title> con el nombre del sitio y lo que ofrece.'],
  description: () => ['info', 'La portada no tiene descripción', 'Agregue <meta name="description"> con una o dos frases que inviten a entrar: es el texto que Google muestra debajo del título.'],
  jsonld: () => ['info', 'No tiene datos estructurados', 'Agregue un bloque «application/ld+json» con los datos del negocio (nombre, dirección, horario) para que los buscadores y las IA lo entiendan mejor.'],
};
const finding = (id, ...args) => { const [level, text, fix] = F[id](...args); return { id, level, text, fix }; };
const fmtDate = t => new Date(t).toLocaleDateString('es-VE', { day: 'numeric', month: 'short' });

class WebRules {
  constructor(cfg, websites, bus, opts = {}) {
    this.cfg = cfg; this.websites = websites; this.bus = bus;
    this.file = path.join(cfg.stateDir || '.', 'webrules.json');
    this.visit = opts.visit || visit;
    this.now = opts.now || (() => Date.now());
    this.retryMs = opts.retryMs != null ? opts.retryMs : RETRY;
    const d = readJSON(this.file, null) || {};
    this.results = d.results || {}; // gid -> { at, kind, findings, unmeasured, checked }
    this.last = d.last || 0;
    this.running = false;
    this.onUpdate = null; // lo puede asignar index.js (refrescar «Salud del servidor»)
  }
  start() {
    const run = () => this.checkAll().catch(e => console.error('[revision web]', e.message));
    setTimeout(run, FIRST).unref();
    this.timer = setInterval(run, EVERY); this.timer.unref();
  }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeJSONAtomic(this.file, { last: this.last, results: this.results }, 0o600); } catch (e) { console.error('[revision web]', e.message); } }

  // una peticion con su segundo intento; null si no se pudo medir
  async get(url) {
    let r = await this.visit(url).catch(() => null);
    if (!r || !r.status) { if (this.retryMs) await new Promise(f => setTimeout(f, this.retryMs)); r = await this.visit(url).catch(() => null); }
    return r && r.status ? r : null;
  }
  // un archivo del sitio: null = sin medir. Un 401, 403, 429 o 5xx tampoco es una medida: es el servidor (o su
  // cortafuegos, que desconfia de un Googlebot que no viene de Google) negandose a responder, no un archivo ausente
  async ask(url, name, un) {
    const r = await this.get(url);
    if (!r || [401, 403, 429].includes(r.status) || r.status >= 500) { un.push(name); return null; }
    return r;
  }

  async check(id) {
    const s = this.websites.sites[id]; if (!s) return null;
    const gid = this.websites.groupId(id), kind = kindOf(s), base = 'https://' + s.domain, f = [], un = [];
    let checked = 0;
    const add = (rule, ...a) => f.push(finding(rule, ...a));
    if (kind === 'private') {
      const r = await this.get(base + (s.path || '/'));
      if (!r) un.push(HOME);
      else {
        checked++;
        // un espejo que redirige a otro dominio no se indexa: lo que se leyo es el otro sitio
        let away = false; try { const h = new URL(r.url).hostname.toLowerCase().replace(/^www\./, ''); away = h !== s.domain && !h.endsWith('.' + s.domain); } catch { }
        if (ok2xx(r) && !away && isHtml(r) && !noindex(r)) add('indexable');
      }
    } else {
      const home = await this.ask(base + (s.path || '/'), HOME, un);
      // una portada que no responde 2xx es asunto de la vigilancia de cada 5 minutos: aqui no hay pagina que leer
      if (home && !ok2xx(home)) un.push(HOME);
      else if (home) {
        checked++;
        const html = String(home.body || ''), text = textOf(html), m = metas(html), t = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
        if (noindex(home)) add('noindex');
        if (text.length < MIN_TEXT) add('empty', text.length);
        if (!/<h1[\s>]/i.test(html)) add('h1');
        if (!t || !textOf(t[1])) add('title');
        if (!m.some(x => String(x.name || '').trim().toLowerCase() === 'description' && String(x.content || '').trim())) add('description');
        if (!/application\/ld\+json/i.test(html)) add('jsonld');
      }
      if (!this.websites.sites[id]) return null; // lo quitaron mientras se revisaba
      const robots = await this.ask(base + '/robots.txt', ROBOTS, un);
      if (robots) {
        checked++;
        if (!isFile(robots)) add('robots');
        else { const i = robotsInfo(robots.body); if (i.ai.length) add('ai', i.ai, i.cloudflare); if (i.all) add('all'); }
      }
      const map = await this.ask(base + '/sitemap.xml', SITEMAP, un);
      if (map) { checked++; if (!ok2xx(map) || !/<(urlset|sitemapindex)\b/i.test(String(map.body || ''))) add('sitemap'); }
      const llms = await this.ask(base + '/llms.txt', LLMS, un);
      if (llms) { checked++; if (!isFile(llms) || !String(llms.body || '').trim()) add('llms'); }
      const ghost = await this.ask(base + GHOST, NOWHERE, un);
      if (ghost) { checked++; if (ghost.status === 200) add('soft404'); }
    }
    if (!this.websites.sites[id]) return null;
    return this.note(gid, s, { kind, findings: f, unmeasured: un, checked });
  }
  note(gid, s, res) {
    const prev = this.results[gid], same = prev && prev.kind === res.kind ? prev : null;
    // lo que no se pudo medir hoy conserva las faltas de ayer: ni aparecen ni se dan por arregladas
    if (same) for (const old of same.findings) if (res.unmeasured.includes(SOURCE[old.id]) && !res.findings.some(x => x.id === old.id)) res.findings.push(old);
    res.findings.sort((a, b) => RANK[b.level] - RANK[a.level] || ORDER.indexOf(a.id) - ORDER.indexOf(b.id));
    const out = this.results[gid] = { at: this.now(), kind: res.kind, findings: res.findings, unmeasured: res.unmeasured, checked: res.checked };
    const was = (same ? same.findings : []).filter(x => x.level === 'bad'), is = out.findings.filter(x => x.level === 'bad');
    const ev = (action, x) => this.bus.emit('ev', { kind: 'webrule', action, account: this.websites.account, site: gid, domain: s.domain, rule: x.id, text: x.text });
    for (const x of is) if (!was.some(y => y.id === x.id)) ev('found', x);
    for (const x of was) if (!is.some(y => y.id === x.id)) ev('fixed', x);
    this.save();
    return out;
  }
  async checkAll() {
    if (this.running) return this.results;
    this.running = true;
    try {
      // lo que ya no se vigila se olvida
      const live = new Set(this.websites.ids().map(id => this.websites.groupId(id)));
      for (const gid of Object.keys(this.results)) if (!live.has(gid)) delete this.results[gid];
      for (const id of this.websites.ids()) await this.check(id).catch(e => console.error('[revision web]', id, e.message));
      this.last = this.now();
      this.save();
    } finally { this.running = false; }
    if (this.onUpdate) try { this.onUpdate(); } catch { }
    return this.results;
  }

  of(gid) { return (this.websites.idOfGroup(gid) && this.results[gid]) || null; }

  // resumen para «Salud del servidor»: una linea por falta grave o aviso; las mejoras opcionales, juntas por sitio
  section() {
    const rows = this.websites.ids().map(id => [this.websites.sites[id], this.of(this.websites.groupId(id))]).filter(x => x[1]);
    if (!rows.length) return null;
    const f = [];
    let unmeasured = 0;
    for (const [s, r] of rows) {
      const what = `Sitio ${r.kind === 'private' ? 'privado' : 'público'}, revisado el ${fmtDate(r.at)}.`;
      for (const x of r.findings.filter(y => y.level !== 'info')) f.push({ sev: x.level, title: `${s.domain}: ${x.text}`, detail: what + (r.unmeasured.includes(SOURCE[x.id]) ? ' Hoy no se pudo volver a comprobar: se conserva lo visto en la revisión anterior.' : ''), fix: x.fix, names: [s.domain] });
      const info = r.findings.filter(y => y.level === 'info');
      if (info.length) f.push({ sev: 'info', title: `${s.domain}: ${info.length} ${info.length === 1 ? 'mejora opcional' : 'mejoras opcionales'}`, detail: info.map(y => y.text).join('; ') + '.', fix: info.map(y => y.fix).join(' '), names: [s.domain] });
      if (r.unmeasured.length) { unmeasured++; f.push({ sev: 'info', title: `${s.domain}: quedó sin medir ${list(r.unmeasured)}`, detail: 'El sitio no respondió a esa petición o la rechazó. No se cuenta como falta.', fix: 'No tiene que hacer nada: se vuelve a intentar en la próxima revisión. Si se repite varios días, revise si el cortafuegos del sitio rechaza a los buscadores.', names: [s.domain] }); }
    }
    f.sort((a, b) => RANK[b.sev] - RANK[a.sev]);
    const n = sev => f.filter(x => x.sev === sev).length, at = Math.max(...rows.map(x => x[1].at));
    const status = n('bad') ? 'bad' : n('warn') ? 'warn' : 'ok';
    return { id: 'webrules', title: 'Revisión web diaria', icon: 'search', status, findings: f,
      items: [
        { label: 'Sitios revisados', value: String(rows.length), sub: `última revisión el ${fmtDate(at)}` },
        { label: 'Faltas graves', value: String(n('bad')) },
        { label: 'Avisos', value: String(n('warn')) },
        ...(unmeasured ? [{ label: 'Sin medir', value: String(unmeasured), sub: 'no se cuentan como faltas' }] : []),
      ] };
  }
}

module.exports = { WebRules, visit, kindOf, parseRobots, robotsInfo, noindex, textOf, AI_BOTS };
