'use strict';
// Informe mensual por correo para el cliente final: el dia 1 de cada mes (desde las 8 de la manana), cada sitio o
// app con destinatarios recibe su mes anterior completo contra el previo: un resumen en palabras, visitantes,
// paginas vistas, paginas por visita y rebote, la curva por dia, de donde llegan, sus paginas mas vistas, paises,
// dispositivos, la hora pico y las paginas rotas. Sale del mismo correo de las alertas (Alertas > Correo).
// Todo vive en <stateDir>/reports.json (600): { sites: { clave: { to, active, name, since } }, sent: { clave: 'AAAA-MM' } }.
const fs = require('fs');
const path = require('path');
const { readJSON, writeJSONAtomic } = require('./util');
const { sendMail } = require('./smtp');

const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,}$/i;
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = n => Number(n || 0).toLocaleString('es-VE');
const pad2 = n => String(n).padStart(2, '0');
const ymOf = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
const monthName = ym => { const [y, m] = ym.split('-').map(Number); return new Date(y, m - 1, 15).toLocaleDateString('es-VE', { month: 'long', year: 'numeric' }); };
const prevYm = ym => { const [y, m] = ym.split('-').map(Number); return ymOf(new Date(y, m - 2, 15)); };
let regions = null; try { regions = new Intl.DisplayNames(['es'], { type: 'region' }); } catch { }
const country = cc => { try { return cc && cc !== '??' && regions ? regions.of(cc) : 'Sin identificar'; } catch { return cc; } };
const SRC = { search: 'Buscadores', social: 'Redes sociales', ai: 'Asistentes de IA', referral: 'Otros sitios', direct: 'Directo o sin referencia' };

class Reports {
  constructor(cfg, ctx, opts = {}) {
    this.cfg = cfg; this.ctx = ctx;
    this.file = path.join(cfg.stateDir || '.', 'reports.json');
    this.data = readJSON(this.file, null) || {};
    this.data.sites = this.data.sites || {}; this.data.sent = this.data.sent || {}; this.data.tries = this.data.tries || {};
    this.now = opts.now || (() => Date.now());
    this.send = opts.send || sendMail;
    if (!opts.manual) { const t = setInterval(() => this.tick().catch(e => console.error('[informes]', e.message)), 30 * 60000); t.unref && t.unref(); }
  }
  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeJSONAtomic(this.file, this.data, 0o600); } catch (e) { console.error('[informes]', e.message); } }
  smtp() { const A = this.ctx.alerts; const m = A && A.email && A.email(); return m && m.host ? m : null; }

  // lo que ve la ficha de analitica (solo en privado)
  info(key) {
    const s = this.data.sites[key] || null, now = new Date(this.now());
    const last = ymOf(new Date(now.getFullYear(), now.getMonth() - 1, 15)), cur = ymOf(now);
    // para enviarlo ya: el mes anterior si se midió; si no (recién conectado), el mes en curso hasta hoy
    const since = this.ctx.analytics && this.ctx.analytics.firstDay(key);
    const month = since && since <= `${last}-31` ? last : cur;
    return { to: s ? s.to : [], active: !!(s && s.active), lastSent: this.data.sent[key] || null, month, monthLabel: monthName(month) + (month === cur ? ' (hasta hoy)' : ''), mail: !!this.smtp() };
  }
  set(key, { to, active, name } = {}) {
    const list = String(Array.isArray(to) ? to.join(',') : to || '').split(/[,;\s]+/).map(x => x.trim()).filter(Boolean);
    const bad = list.filter(x => !EMAIL_RE.test(x));
    if (bad.length) throw new Error(`Correo inválido: ${bad[0]}`);
    if (list.length > 10) throw new Error('Como máximo diez destinatarios por sitio');
    if (!list.length) { delete this.data.sites[key]; this.save(); return this.info(key); }
    const cur = this.data.sites[key] || { since: new Date(this.now()).toISOString() };
    this.data.sites[key] = { ...cur, to: list, active: active !== false, name: name || cur.name || key };
    this.save();
    return this.info(key);
  }

  // el correo de un mes: asunto, texto plano y HTML sobrio que se lee bien en cualquier cliente de correo
  build(key, ym, name) {
    const A = this.ctx.analytics; if (!A) throw new Error('La analítica no está activa');
    const r = A.monthReport(key, ym), T = r.totals, P = r.prev, cmp = r.comparable;
    const partial = ymOf(new Date(this.now())) === ym;
    const mes = monthName(ym), mesAnt = monthName(prevYm(ym)).split(' ')[0];
    const pctCh = (a, b) => (cmp && b ? Math.round((a - b) / b * 100) : null);
    const ch = pctCh(T.visitors, P.visitors);
    const srcTotal = r.sources.reduce((n, x) => n + x.n, 0), devTotal = r.dev.reduce((n, x) => n + x.n, 0);
    const mobile = devTotal ? Math.round((r.dev.find(x => x.name === 'movil') || { n: 0 }).n / devTotal * 100) : null;
    const topSrc = r.sources[0], topSearch = r.search[0], topSocial = r.social[0];
    const from = !topSrc ? '' : topSrc.name === 'search' && topSearch ? `desde ${topSearch.name}` : topSrc.name === 'social' && topSocial ? `desde ${topSocial.name}` : topSrc.name === 'direct' ? 'directo, escribiendo su dirección o desde un enlace guardado' : `desde ${(SRC[topSrc.name] || '').toLowerCase()}`;
    const peak = T.hours.reduce((b, n, h) => n > T.hours[b] ? h : b, 0);
    // el resumen en palabras, lo primero que se lee
    const lines = [];
    if (!T.visitors) lines.push(`En ${mes.split(' ')[0]} no registramos visitas de personas en <b>${esc(name)}</b>.`);
    else {
      lines.push(`En ${mes.split(' ')[0]}, <b>${esc(name)}</b> recibió <b>${num(T.visitors)} visitante${T.visitors === 1 ? '' : 's'}</b>${ch == null ? '' : ch === 0 ? `, igual que en ${mesAnt}` : `, un <b>${Math.abs(ch)} % ${ch > 0 ? 'más' : 'menos'}</b> que en ${mesAnt}`}.`);
      if (from) lines.push(`La mayoría llegó ${esc(from)}${mobile != null ? ` y el ${mobile} % lo visitó desde el celular` : ''}.`);
      if (T.hours.some(Boolean)) lines.push(`La hora de más movimiento fue entre las ${peak}:00 y las ${peak + 1}:00.`);
    }
    const kpi = (label, val, a, b, inverse) => {
      const p = pctCh(a, b), good = p == null ? null : inverse ? p < 0 : p > 0;
      return `<td width="25%" style="padding:12px 8px;border:1px solid #e2e8f0;border-radius:10px;text-align:center"><div style="font-size:12px;color:#64748b">${label}</div><div style="font-size:22px;font-weight:700;color:#0f172a;margin:4px 0">${val}</div><div style="font-size:12px;color:${p == null ? '#94a3b8' : p === 0 ? '#64748b' : good ? '#15803d' : '#b91c1c'}">${p == null ? '&nbsp;' : p === 0 ? 'igual' : `${p > 0 ? '+' : ''}${p} %`}</div></td>`;
    };
    const maxV = Math.max(1, ...r.series.map(x => x.visitors));
    // los dias antes de que se empezara a medir van en gris: no son ceros
    const today = ymOf(new Date(this.now())) === ym ? new Date(this.now()).toISOString().slice(0, 10) : null;
    const before = x => (r.since && x.date < r.since) || (today && x.date > today);
    const sinceTxt = r.since && r.since > r.from ? new Date(r.since + 'T12:00:00').toLocaleDateString('es-VE', { day: 'numeric', month: 'long' }) : null;
    const chart = `<table width="100%" cellpadding="0" cellspacing="0" style="table-layout:fixed"><tr valign="bottom" style="height:90px">${r.series.map(x => `<td style="padding:0 1px;vertical-align:bottom"><div title="${x.date}: ${x.visitors}" style="height:${before(x) ? 3 : Math.max(2, Math.round(x.visitors / maxV * 86))}px;background:${before(x) ? '#e2e8f0' : '#0891b2'};border-radius:2px 2px 0 0"></div></td>`).join('')}</tr></table>${sinceTxt ? `<p style="margin:4px 0 0;font-size:12px;color:#94a3b8">Se mide desde el ${esc(sinceTxt)}: los días anteriores van en gris.</p>` : ''}
      <table width="100%" cellpadding="0" cellspacing="0"><tr><td style="font-size:11px;color:#94a3b8">1</td><td style="font-size:11px;color:#94a3b8;text-align:right">${r.series.length}</td></tr></table>`;
    const list = (title, arr, fmt, total, hint) => !arr.length ? '' : `<h3 style="font-size:15px;margin:22px 0 6px;color:#0f172a">${title}</h3>${hint ? `<p style="margin:0 0 6px;font-size:12px;color:#64748b">${hint}</p>` : ''}
      <table width="100%" cellpadding="0" cellspacing="0">${arr.slice(0, 5).map(x => `<tr><td style="padding:5px 0;font-size:14px;color:#334155;border-bottom:1px solid #f1f5f9">${fmt(x.name)}</td><td style="padding:5px 0;font-size:14px;color:#0f172a;text-align:right;border-bottom:1px solid #f1f5f9;white-space:nowrap">${num(x.n)}${total ? ` <span style="color:#94a3b8">· ${Math.round(x.n / total * 100)} %</span>` : ''}</td></tr>`).join('')}</table>`;
    // con el script de Atalaya en el sitio: tiempo real, rebote real, cuanto leen y conversiones
    const KIND = { whatsapp: 'Clics en WhatsApp', llamada: 'Llamadas', correo: 'Correos', formulario: 'Formularios enviados', descarga: 'Descargas', externo: 'Enlaces a otros sitios', propio: 'Eventos propios' };
    const mmss = x => x == null ? '–' : x < 60 ? x + ' s' : Math.floor(x / 60) + ' min ' + pad2(x % 60) + ' s';
    const jsBlock = J => !J ? '' : `<h3 style="font-size:15px;margin:22px 0 6px;color:#0f172a">Lo que hicieron en la página</h3>
      <table width="100%" cellpadding="0" cellspacing="6"><tr>
        <td width="33%" style="padding:10px 8px;border:1px solid #e2e8f0;border-radius:10px;text-align:center"><div style="font-size:12px;color:#64748b">Tiempo en la página</div><div style="font-size:18px;font-weight:700;color:#0f172a">${mmss(J.avgSecs)}</div></td>
        <td width="33%" style="padding:10px 8px;border:1px solid #e2e8f0;border-radius:10px;text-align:center"><div style="font-size:12px;color:#64748b">Rebote real</div><div style="font-size:18px;font-weight:700;color:#0f172a">${J.bounce == null ? '–' : Math.round(J.bounce * 100) + ' %'}</div></td>
        <td width="33%" style="padding:10px 8px;border:1px solid #e2e8f0;border-radius:10px;text-align:center"><div style="font-size:12px;color:#64748b">Conversiones</div><div style="font-size:18px;font-weight:700;color:#0f172a">${num(J.conv)}</div></td></tr></table>
      ${J.convKinds.length ? list('Conversiones', J.convKinds, k => esc(KIND[k] || k), J.conv) : ''}`;
    if (r.js && r.js.conv) lines.push(`Además hubo <b>${num(r.js.conv)} conversion${r.js.conv === 1 ? '' : 'es'}</b>${r.js.convKinds[0] ? ` (sobre todo, ${esc((KIND[r.js.convKinds[0].name] || r.js.convKinds[0].name).toLowerCase())})` : ''}.`);
    const brand = this.cfg.reportBrand || 'NERACOSU';
    const html = `<div style="background:#f8fafc;padding:24px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:26px">
  <div style="font:700 12px/1 ui-monospace,monospace;letter-spacing:.16em;color:#0891b2">INFORME MENSUAL · ${esc(mes.toUpperCase())}${partial ? ' · HASTA HOY' : ''}</div>
  <h1 style="font-size:22px;margin:10px 0 14px;color:#0f172a">${esc(name)}</h1>
  ${lines.map(l => `<p style="margin:0 0 8px;font-size:15px;line-height:1.55;color:#334155">${l}</p>`).join('')}
  <table width="100%" cellpadding="0" cellspacing="6" style="margin:16px 0 4px"><tr>
    ${kpi('Visitantes', num(T.visitors), T.visitors, P.visitors)}${kpi('Páginas vistas', num(T.pv), T.pv, P.pv)}
    ${kpi('Páginas por visita', T.pagesPerVisit == null ? '–' : T.pagesPerVisit.toFixed(1), T.pagesPerVisit, P.pagesPerVisit)}${kpi('Rebote', T.bounce == null ? '–' : Math.round(T.bounce * 100) + ' %', T.bounce, P.bounce, true)}
  </tr></table>
  <p style="margin:0 0 16px;font-size:12px;color:#94a3b8">${cmp ? `Las variaciones comparan con ${esc(mesAnt)}.` : 'Sin comparación: el mes anterior todavía no se medía completo.'}</p>
  <h3 style="font-size:15px;margin:10px 0 8px;color:#0f172a">Visitantes por día</h3>${chart}
  ${list('De dónde llegan', r.sources, k => esc(SRC[k] || k), srcTotal)}
  ${list('Páginas más vistas', r.pages, k => `<span style="font-family:ui-monospace,monospace;font-size:13px">${esc(k)}</span>`, T.pv)}
  ${jsBlock(r.js)}
  ${list('Países', r.cc, k => esc(country(k)), T.visitors)}
  ${list('Dispositivos', r.dev, k => k === 'movil' ? 'Celular o tableta' : 'Computadora', devTotal)}
  ${list('Páginas que no existen', r.notFound, k => `<span style="font-family:ui-monospace,monospace;font-size:13px">${esc(k)}</span>`, 0, 'Visitantes que llegaron a un error 404: un enlace roto o una página que se movió. Una redirección los recupera.')}
  <p style="margin:24px 0 0;padding-top:14px;border-top:1px solid #e2e8f0;font-size:12px;line-height:1.5;color:#64748b">Informe automático de <b>Atalaya Monitor Server</b> para ${esc(brand)}. Se mide sin cookies ni código en su sitio: sale de los registros del servidor y no guarda datos personales de sus visitantes. Puede responder este correo si tiene preguntas.</p>
</div></div>`;
    const text = `Informe mensual de ${name} · ${mes}\n\n${lines.map(l => l.replace(/<[^>]+>/g, '')).join('\n')}\n\nVisitantes: ${num(T.visitors)} · Páginas vistas: ${num(T.pv)} · Páginas por visita: ${T.pagesPerVisit == null ? '-' : T.pagesPerVisit.toFixed(1)} · Rebote: ${T.bounce == null ? '-' : Math.round(T.bounce * 100) + ' %'}\n\n--\nInforme automático de Atalaya Monitor Server para ${brand}. Sin cookies ni datos personales.`;
    return { subject: `${name}: su informe de ${mes}${partial ? ' (hasta hoy)' : ''}`, html, text, report: r };
  }

  async sendNow(key, { ym, to, name } = {}) {
    const m = this.smtp(); if (!m) throw new Error('Primero conecte un correo en Alertas: el informe sale desde ahí');
    const s = this.data.sites[key] || {};
    const dest = to ? String(to).split(/[,;\s]+/).filter(x => EMAIL_RE.test(x)) : s.to || [];
    if (!dest.length) throw new Error('Escriba al menos un correo de destino');
    const month = ym || this.info(key).month, nm = name || s.name || key;
    const mail = this.build(key, month, nm);
    await this.send({ ...m, fromName: `Informe mensual · ${this.cfg.reportBrand || this.cfg.title || 'Atalaya'}` }, { to: dest, subject: mail.subject, text: mail.text, html: mail.html });
    console.log(`[informes] ${nm} · ${month} -> ${dest.length} destinatario(s)`);
    return { ok: true, month, to: dest };
  }

  // cada media hora: del dia 1 al 3 del mes, desde las 8, cada sitio activo recibe su mes anterior una sola vez
  async tick() {
    const now = new Date(this.now());
    if (now.getDate() > 3 || now.getHours() < 8 || !this.smtp()) return;
    const ym = ymOf(new Date(now.getFullYear(), now.getMonth() - 1, 15));
    for (const [key, s] of Object.entries(this.data.sites)) {
      if (!s.active || this.data.sent[key] === ym) continue;
      const tk = key + '|' + ym; if ((this.data.tries[tk] || 0) >= 3) continue;
      const since = this.ctx.analytics && this.ctx.analytics.firstDay(key);
      if (!since || since > `${ym}-31`) { this.data.sent[key] = ym; this.save(); continue; } // ese mes todavia no se medía
      try { await this.sendNow(key, { ym }); this.data.sent[key] = ym; delete this.data.tries[tk]; }
      catch (e) { this.data.tries[tk] = (this.data.tries[tk] || 0) + 1; console.error(`[informes] ${s.name}: ${e.message}`); }
      this.save();
    }
  }
}

module.exports = { Reports, monthName };
