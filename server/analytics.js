'use strict';
// Analitica de visitas desde los registros de acceso (sin JavaScript ni cookies en el sitio): por cada sitio o app,
// totales por dia de paginas vistas, visitantes, paginas de entrada, de donde llegan, paises, dispositivos,
// navegadores, horas, campanas (utm) y paginas que no existen. Se guarda un archivo por sitio y mes en
// <stateDir>/analytics/<clave>/<AAAA-MM>.json (pocos KB por dia); los visitantes del dia se cuentan con una huella
// corta de IP + navegador que se descarta al cambiar el dia (no se guardan IPs en la analitica).
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJSON, writeJSONAtomic } = require('./util');

const TOP = 40; // entradas por lista y dia
const ASSET = /\.(css|js|mjs|map|png|jpe?g|gif|webp|avif|svg|ico|bmp|woff2?|ttf|otf|eot|mp4|webm|mp3|ogg|wav|pdf|zip|gz|rar|7z|xml|txt|json|webmanifest|csv|xls|xlsx|doc|docx)$/i;
const NOT_PAGE = /^\/(wp-admin|wp-json|wp-cron\.php|wp-login\.php|xmlrpc\.php|wp-includes|wp-content|feed|comments\/feed|\.well-known|cgi-bin|api\/|_next\/|static\/|assets\/|favicon)/i;
const SEARCH = /(^|\.)(google\.[a-z.]+|bing\.com|duckduckgo\.com|search\.yahoo\.com|yahoo\.com|yandex\.[a-z]+|ecosia\.org|baidu\.com|search\.brave\.com|qwant\.com|startpage\.com)$/i;
const SOCIAL = [[/(^|\.)(facebook\.com|fb\.com|fb\.me|m\.facebook\.com|l\.facebook\.com|lm\.facebook\.com)$/i, 'Facebook'], [/(^|\.)instagram\.com$/i, 'Instagram'],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/i, 'X (Twitter)'], [/(^|\.)(linkedin\.com|lnkd\.in)$/i, 'LinkedIn'], [/(^|\.)(youtube\.com|youtu\.be)$/i, 'YouTube'],
  [/(^|\.)tiktok\.com$/i, 'TikTok'], [/(^|\.)pinterest\.[a-z.]+$/i, 'Pinterest'], [/(^|\.)reddit\.com$/i, 'Reddit'], [/(^|\.)(whatsapp\.com|wa\.me)$/i, 'WhatsApp'],
  [/(^|\.)(t\.me|telegram\.org)$/i, 'Telegram'], [/(^|\.)threads\.net$/i, 'Threads']];
const AI = /(^|\.)(chatgpt\.com|chat\.openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/i;

// rutas que buscan los robots de ataque (/.env, /.git, wp-config, phpmyadmin...): no son enlaces rotos de sus
// visitantes y en un informe para el cliente solo asustan. La defensa de Atalaya las vigila aparte
const PROBE = /(^|\/)\.|wp-config|phpmyadmin|pma\/|adminer|\/vendor\/|\/cgi-bin|xmlrpc|\.(sql|bak|old|orig|swp|save|zip|tar|gz|rar|7z|ya?ml|ini|log|env|pem|key|conf)$|(^|\/)(backup|config|credentials|debug|shell|cmd|eval|setup|install)\b/i;
const dayOf = t => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const bump = (o, k, n = 1) => { if (k == null || k === '') return; if (!(k in o) && Object.keys(o).length >= 500) k = '(otros)'; o[k] = (o[k] || 0) + n; };
const trim = o => Object.fromEntries(Object.entries(o || {}).sort((a, b) => b[1] - a[1]).slice(0, TOP));

// de donde llego: buscador, red social, IA, otro sitio o directo (sin referer o desde el mismo sitio)
function sourceOf(refHost, ownDomains) {
  const h = String(refHost || '').toLowerCase().replace(/^www\./, '');
  if (!h) return { kind: 'direct', name: 'Directo' };
  if (ownDomains && ownDomains.some(d => h === d || h.endsWith('.' + d))) return { kind: 'internal', name: h };
  if (SEARCH.test(h)) return { kind: 'search', name: /google/.test(h) ? 'Google' : /bing/.test(h) ? 'Bing' : /duckduckgo/.test(h) ? 'DuckDuckGo' : /yahoo/.test(h) ? 'Yahoo' : /yandex/.test(h) ? 'Yandex' : h };
  for (const [re, name] of SOCIAL) if (re.test(h)) return { kind: 'social', name };
  if (AI.test(h)) return { kind: 'ai', name: /openai|chatgpt/.test(h) ? 'ChatGPT' : /perplexity/.test(h) ? 'Perplexity' : /claude/.test(h) ? 'Claude' : /gemini/.test(h) ? 'Gemini' : 'Copilot' };
  return { kind: 'referral', name: h };
}
function isPage(e) {
  if (e.method && e.method !== 'GET') return false;
  if (!(e.status >= 200 && e.status < 400) || e.status === 301 || e.status === 302) return false;
  const [p, q = ''] = String(e.path || '/').split('?');
  if (ASSET.test(p) || NOT_PAGE.test(p)) return false;
  // precargas internas de los frameworks (Next.js pide cada pagina por dentro con ?_rsc=): no son visitas
  if (/(?:^|&)(_rsc|__nextDataReq|_data)=/.test(q) || /^\/(socket\.io|sockjs|graphql|trpc)\b/.test(p)) return false;
  return true;
}
function emptyDay() {
  return { pv: 0, visitors: 0, bounces: 0, hits: 0, bots: 0, err: 0, hours: new Array(24).fill(0),
    pages: {}, entries: {}, sources: {}, refs: {}, search: {}, social: {}, campaigns: {}, cc: {}, dev: {}, browsers: {}, os: {}, notFound: {}, botNames: {} };
}

// lo del script (a.js) de un periodo: tiempo promedio, rebote real, lectura, conversiones y el tiempo por pagina
function jsOut(J, P, top) {
  if (!J.pv) return null;
  const avg = (s, n) => n ? Math.round(s / n) : null;
  const times = Object.entries(J.pages).filter(([, n]) => n >= 3).map(([name, n]) => ({ name, n, secs: avg(J.pageSecs[name] || 0, n) })).sort((x, y) => y.n - x.n).slice(0, 10);
  const conv = Object.values(J.conv).reduce((a, n) => a + n, 0), pconv = Object.values(P.conv || {}).reduce((a, n) => a + n, 0);
  return { pv: J.pv, avgSecs: avg(J.secs, J.pv), bounce: J.entries ? J.bounces / J.entries : null, scroll: avg(J.scroll, J.pv), conv, prev: P.pv ? { avgSecs: avg(P.secs, P.pv), bounce: P.entries ? P.bounces / P.entries : null, conv: pconv } : null,
    convKinds: top(J.conv, 8), convPages: top(J.convPages, 10), times };
}

class Analytics {
  constructor(cfg, bus, opts = {}) {
    this.cfg = cfg;
    this.dir = path.join(cfg.stateDir, 'analytics');
    this.domainsOf = opts.domainsOf || (() => []); // clave -> dominios propios (para no contar el trafico interno como referido)
    this.months = new Map(); // "clave|AAAA-MM" -> { days: { fecha: dia } }
    this.dirty = new Set();
    this.seen = new Map(); // clave -> { day, v: Map(huella -> paginas vistas) } visitantes de hoy
    const st = readJSON(path.join(this.dir, 'state.json'), null) || {};
    this.mark = st.mark || {}; // dominio -> ultima hora ya contada (para no recontar al releer los logs al arrancar)
    this.saved = { ...this.mark }; // lo contado hasta el ultimo guardado: solo eso se descarta al releer
    this.index = st.index || {}; // carpeta -> clave
    this.startedAt = Date.now();
    this.salt = st.salt || crypto.randomBytes(8).toString('hex');
    if (bus) bus.on('ev', e => { if (e.kind === 'http' && !e.live) try { this.hit(e); } catch (err) { console.error('[analitica]', err.message); } });
  }
  start() { this.timer = setInterval(() => this.flush(), 5 * 60000); this.timer.unref && this.timer.unref(); }

  doms(key) {
    const c = this.domCache || (this.domCache = new Map()), x = c.get(key);
    if (x && Date.now() - x.t < 120000) return x.d;
    const d = this.domainsOf(key) || []; c.set(key, { t: Date.now(), d }); return d;
  }
  keyOf(e) { return e.app ? e.account + '/' + e.app : e.site ? 'site:' + e.site : null; }
  folder(key) { const f = crypto.createHash('sha1').update(key).digest('hex').slice(0, 16); this.index[f] = key; return f; }
  month(key, ym) {
    const id = key + '|' + ym;
    let m = this.months.get(id);
    if (!m) { m = readJSON(path.join(this.dir, this.folder(key), ym + '.json'), null) || { key, days: {} }; this.months.set(id, m); }
    return m;
  }
  day(key, date) {
    const m = this.month(key, date.slice(0, 7));
    return m.days[date] || (m.days[date] = emptyDay());
  }

  hit(e) {
    const key = this.keyOf(e); if (!key) return;
    const at = e.at || Date.now();
    // al arrancar se releen los ultimos minutos de cada log: lo ya contado antes de reiniciar no se vuelve a sumar
    const dm = e.domain || key;
    if (at < this.startedAt && this.saved[dm] && at <= this.saved[dm]) return;
    if (!this.mark[dm] || at > this.mark[dm]) this.mark[dm] = at;
    const date = dayOf(at), d = this.day(key, date);
    this.dirty.add(key + '|' + date.slice(0, 7));
    d.hits++;
    const ua = e.ua || {};
    if (ua.bot || e.bot) { d.bots++; bump(d.botNames, ua.name || 'Robot'); return; }
    if (e.status >= 500) d.err++;
    const p = String(e.path || '/').split('?')[0].slice(0, 120) || '/';
    if (e.status === 404 && !ASSET.test(p) && !NOT_PAGE.test(p)) bump(d.notFound, p);
    if (!isPage(e)) return;
    d.pv++;
    d.hours[new Date(at).getHours()]++;
    bump(d.pages, p);
    // visitante del dia: huella corta de IP + navegador (no se guarda la IP)
    const sk = key + '|' + date;
    let s = this.seen.get(sk);
    if (!s) {
      const t = readJSON(path.join(this.dir, this.folder(key), 'today.json'), null);
      s = { key, day: date, v: new Map(t && t.day === date ? t.v : []) }; this.seen.set(sk, s);
      if (this.seen.size > 400) for (const [k2, v2] of this.seen) if (v2.day < dayOf(Date.now() - 2 * 86400000)) this.seen.delete(k2);
    }
    const fp = crypto.createHash('sha1').update(this.salt + date + (e.ip || '') + (e.uaRaw || ua.name || '')).digest('base64').slice(0, 10);
    const n = s.v.get(fp) || 0;
    if (s.v.size < 200000 || n) s.v.set(fp, n + 1);
    const src = sourceOf(e.refHost, this.doms(key));
    if (n === 0) {
      // primera pagina del dia de este visitante: entrada, origen, pais, dispositivo, navegador y campana
      d.visitors++; d.bounces++;
      bump(d.entries, p);
      const kind = src.kind === 'internal' ? 'direct' : src.kind;
      bump(d.sources, kind);
      if (kind === 'search') bump(d.search, src.name);
      else if (kind === 'social') bump(d.social, src.name);
      else if (kind === 'referral' || kind === 'ai') bump(d.refs, src.name);
      const q = String(e.path || '').split('?')[1] || '';
      const utm = /(?:^|&)utm_source=([^&]*)/.exec(q), camp = /(?:^|&)utm_campaign=([^&]*)/.exec(q);
      if (utm || camp) { let v = ''; try { v = decodeURIComponent(((utm && utm[1]) || '') + (camp ? ' · ' + camp[1] : '')).replace(/\+/g, ' ').slice(0, 80); } catch { } bump(d.campaigns, v); }
      bump(d.cc, e.cc || '??');
      bump(d.dev, ua.mobile ? 'movil' : 'escritorio');
      bump(d.browsers, ua.name || 'Otro');
      bump(d.os, ua.os || 'Otro');
    } else if (n === 1) d.bounces--; // ya vio una segunda pagina: no reboto
  }

  // identificador fijo de un sitio para el script (no cambia al reiniciar: sale de la sal guardada en disco)
  siteToken(key) { return 'a' + crypto.createHash('sha1').update(this.salt + '|js|' + key).digest('hex').slice(0, 11); }
  // lo que manda el script opcional (a.js) desde el navegador: tiempo visible en la pagina, cuanto se leyo, el
  // rebote real y las conversiones. Sin cookies ni identificadores: cada envio es una pagina de una visita
  beacon(key, b) {
    const date = dayOf(Date.now()), d = this.day(key, date);
    this.dirty.add(key + '|' + date.slice(0, 7));
    const J = d.js || (d.js = { pv: 0, secs: 0, entries: 0, bounces: 0, scroll: 0, pages: {}, pageSecs: {}, conv: {}, convPages: {} });
    const p = String(b.p || '/').split('?')[0].slice(0, 120) || '/';
    if (b.t === 'pv') {
      const sec = Math.max(0, Math.min(1800, Math.round(+b.sec || 0)));
      if (b.f) {
        J.pv++; bump(J.pages, p); J.scroll += Math.max(0, Math.min(100, Math.round(+b.sc || 0)));
        if (b.e) { J.entries++; if (!b.n && sec < 10) J.bounces++; } // entro, no siguio a otra pagina ni se quedo 10 s: reboto de verdad
      }
      J.secs += sec; bump(J.pageSecs, p, sec);
    } else if (b.t === 'ev') {
      const k = String(b.k || '').slice(0, 20); if (!k) return;
      bump(J.conv, k); bump(J.convPages, (k + ' · ' + (String(b.l || '').slice(0, 60) || p)).slice(0, 100));
    }
  }

  flush() {
    try { fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 }); } catch { }
    for (const id of this.dirty) {
      const m = this.months.get(id); if (!m) continue;
      const [key, ym] = [id.slice(0, id.lastIndexOf('|')), id.slice(id.lastIndexOf('|') + 1)];
      const out = { key, days: {} };
      for (const [date, d] of Object.entries(m.days)) {
        const t = { ...d };
        for (const f of ['pages', 'entries', 'refs', 'search', 'social', 'campaigns', 'cc', 'browsers', 'os', 'notFound', 'botNames']) t[f] = trim(d[f]);
        if (d.js) { t.js = { ...d.js }; for (const f of ['pages', 'pageSecs', 'conv', 'convPages']) t.js[f] = trim(d.js[f]); }
        out.days[date] = t;
      }
      const dir = path.join(this.dir, this.folder(key));
      try { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); writeJSONAtomic(path.join(dir, ym + '.json'), out); } catch (e) { console.error('[analitica]', e.message); }
      // los visitantes de hoy (huellas cortas, sin IP) para no recontarlos si Atalaya se reinicia
      const sv = this.seen.get(key + '|' + dayOf(Date.now()));
      if (sv && sv.day.startsWith(ym)) try { writeJSONAtomic(path.join(dir, 'today.json'), { day: sv.day, v: [...sv.v] }); } catch { }
    }
    this.dirty.clear();
    // los meses viejos de memoria (solo queda el actual y el anterior)
    const cur = dayOf(Date.now()).slice(0, 7);
    for (const id of this.months.keys()) if (!id.endsWith(cur) && this.months.size > 200) this.months.delete(id);
    try { writeJSONAtomic(path.join(this.dir, 'state.json'), { mark: this.mark, index: this.index, salt: this.salt }); } catch { }
  }

  // dias de un sitio entre dos fechas (inclusive), leyendo los meses que hagan falta
  days(key, from, to) {
    const out = [];
    for (let t = new Date(from + 'T12:00:00'); dayOf(t) <= to; t.setDate(t.getDate() + 1)) {
      const date = dayOf(t), m = this.month(key, date.slice(0, 7));
      out.push({ date, d: m.days[date] || null });
    }
    return out;
  }
  // informe de un periodo: serie por dia, totales, comparacion con el periodo anterior y las listas sumadas
  report(key, range = 30, now = Date.now()) {
    range = Math.max(1, Math.min(400, Math.round(range) || 30));
    const end = new Date(now), start = new Date(now); start.setDate(start.getDate() - range + 1);
    const pEnd = new Date(start); pEnd.setDate(pEnd.getDate() - 1);
    const pStart = new Date(pEnd); pStart.setDate(pStart.getDate() - range + 1);
    return this.period(key, dayOf(start), dayOf(end), dayOf(pStart), dayOf(pEnd), range);
  }
  // un mes calendario completo (AAAA-MM) contra el mes anterior: el informe mensual por correo
  monthReport(key, ym) {
    const [y, m] = ym.split('-').map(Number);
    const last = d => dayOf(new Date(d.getFullYear(), d.getMonth() + 1, 0, 12));
    const from = new Date(y, m - 1, 1, 12), pfrom = new Date(y, m - 2, 1, 12);
    const days = new Date(y, m, 0).getDate();
    return this.period(key, dayOf(from), last(from), dayOf(pfrom), last(pfrom), days);
  }
  period(key, from, to, pFrom, pTo, range) {
    const cur = this.days(key, from, to), prev = this.days(key, pFrom, pTo);
    const sum = list => {
      const t = { pv: 0, visitors: 0, bounces: 0, hits: 0, bots: 0, err: 0, hours: new Array(24).fill(0) }, lists = {};
      const J = { pv: 0, secs: 0, entries: 0, bounces: 0, scroll: 0, pages: {}, pageSecs: {}, conv: {}, convPages: {} };
      for (const { d } of list) {
        if (!d) continue;
        for (const k of ['pv', 'visitors', 'bounces', 'hits', 'bots', 'err']) t[k] += d[k] || 0;
        (d.hours || []).forEach((n, i) => { t.hours[i] += n; });
        if (d.js) { for (const k of ['pv', 'secs', 'entries', 'bounces', 'scroll']) J[k] += d.js[k] || 0; for (const f of ['pages', 'pageSecs', 'conv', 'convPages']) for (const [k, n] of Object.entries(d.js[f] || {})) J[f][k] = (J[f][k] || 0) + n; }
        for (const f of ['pages', 'entries', 'sources', 'refs', 'search', 'social', 'campaigns', 'cc', 'dev', 'browsers', 'os', 'notFound', 'botNames']) {
          const o = lists[f] || (lists[f] = {}); for (const [k, n] of Object.entries(d[f] || {})) o[k] = (o[k] || 0) + n;
        }
      }
      return { t, lists, J };
    };
    const a = sum(cur), b = sum(prev);
    const top = (o, k = 15) => Object.entries(o || {}).sort((x, y) => y[1] - x[1]).slice(0, k).map(([name, n]) => ({ name, n }));
    const rate = t => t.visitors ? t.bounces / t.visitors : null;
    const since = this.firstDay(key);
    return {
      range, from, to, since,
      // solo se compara si ya se medía durante todo el periodo anterior
      comparable: range > 1 && !!since && since <= pFrom, // hoy va por la mitad: no se compara con un dia completo
      series: cur.map(({ date, d }) => ({ date, pv: d ? d.pv : 0, visitors: d ? d.visitors : 0, bots: d ? d.bots : 0 })),
      totals: { ...a.t, bounce: rate(a.t), pagesPerVisit: a.t.visitors ? a.t.pv / a.t.visitors : null },
      prev: { pv: b.t.pv, visitors: b.t.visitors, bots: b.t.bots, bounce: rate(b.t), pagesPerVisit: b.t.visitors ? b.t.pv / b.t.visitors : null },
      pages: top(a.lists.pages), entries: top(a.lists.entries), sources: top(a.lists.sources, 8), search: top(a.lists.search, 8), social: top(a.lists.social, 10),
      refs: top(a.lists.refs), campaigns: top(a.lists.campaigns, 10), cc: top(a.lists.cc, 12), dev: top(a.lists.dev, 3), browsers: top(a.lists.browsers, 8),
      js: jsOut(a.J, b.J, top), os: top(a.lists.os, 8), notFound: top(Object.fromEntries(Object.entries(a.lists.notFound || {}).filter(([k]) => !PROBE.test(k))), 10), botNames: top(a.lists.botNames, 8),
    };
  }
  // primer dia con datos de un sitio (para decir "desde cuando se mide")
  firstDay(key) {
    let files = []; try { files = fs.readdirSync(path.join(this.dir, this.folder(key))).filter(f => /^\d{4}-\d\d\.json$/.test(f)).sort(); } catch { }
    const mem = [...this.months.keys()].filter(id => id.startsWith(key + '|')).map(id => id.slice(-7) + '.json');
    // los meses que se leyeron sin datos tambien quedan en memoria: el primero con algun dia
    for (const f of [...new Set([...files, ...mem])].sort()) {
      const m = this.month(key, f.slice(0, 7));
      const d = Object.keys(m.days).filter(x => m.days[x] && m.days[x].hits).sort()[0];
      if (d) return d;
    }
    return null;
  }
  // resumen corto para la ficha: visitantes de 7 dias contra los 7 anteriores
  summary(key) {
    const r = this.report(key, 7);
    return { visitors: r.totals.visitors, pv: r.totals.pv, prevVisitors: r.comparable ? r.prev.visitors : null, bounce: r.totals.bounce, series: r.series.map(x => x.visitors), since: r.since };
  }
}

module.exports = { Analytics, sourceOf, isPage, dayOf, PROBE };
