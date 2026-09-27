// HUD tipo Grafana: KPIs, agentes, graficas, procesos y ticker de eventos
import { animate, stagger } from '../vendor/anime.esm.min.js';
import { px } from './pixicons.js';
import { forEdition } from './accounts.js';
import uPlot from '../vendor/uPlot.esm.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtBytes = (b, d = 1) => { if (!b && b !== 0) return '–'; const u = ['B', 'KB', 'MB', 'GB', 'TB']; let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return b.toFixed(i >= 3 ? d : 0) + ' ' + u[i]; };
const fmtRate = b => fmtBytes(b, 1) + '/s';
const fmtNum = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(Math.round(n));
const ago = ms => { const s = Math.max(0, Math.round(ms / 1000)); return s < 60 ? s + ' s' : s < 3600 ? Math.round(s / 60) + ' min' : Math.round(s / 3600) + ' h'; };
const STATE_LABEL = { working: 'Trabajando', thinking: 'Pensando', waiting: 'Lo espera', idle: 'En pausa' };

// ---------------------------------------------------------------- KPIs
const KPI_TIP = {
  cpu: 'CPU|Uso total de todos los núcleos del servidor. Ámbar desde 70 %, rojo desde 90 %.',
  mem: 'Memoria|RAM en uso sobre el total. Ámbar desde 80 %.',
  disk: 'Disco|Espacio ocupado en el disco principal. Ámbar desde 80 %.',
  load: 'Carga 1 min|Procesos esperando turno de CPU. Si es menor que la cantidad de núcleos, el servidor va holgado.',
  rx: 'Red entrante|Datos que llegan al servidor por segundo.',
  tx: 'Red saliente|Datos que el servidor envía por segundo.',
  req: 'Visitas por minuto|Peticiones a todos los sitios en el último minuto, robots incluidos.',
  err: 'Errores 5xx|Veces que un sitio falló al responder en el último minuto. Lo ideal es 0.',
};
const KPI_DEF = [
  { id: 'cpu', k: 'CPU', fmt: v => v.toFixed(0), unit: '%', bar: true, warn: 70, bad: 90 },
  { id: 'mem', k: 'Memoria', fmt: v => v.toFixed(0), unit: '%', bar: true, warn: 80, bad: 92 },
  { id: 'disk', k: 'Disco', fmt: v => v.toFixed(0), unit: '%', bar: true, warn: 80, bad: 90 },
  { id: 'load', k: 'Carga 1 min', fmt: v => v.toFixed(2), unit: '' },
  { id: 'rx', k: 'Red ↓', fmt: v => fmtRate(v), unit: '' },
  { id: 'tx', k: 'Red ↑', fmt: v => fmtRate(v), unit: '' },
  { id: 'req', k: 'Visitas / min', fmt: v => fmtNum(v), unit: '' },
  { id: 'err', k: 'Errores 5xx', fmt: v => String(Math.round(v)), unit: '/min', warn: 1, bad: 10 },
];
const kpiVals = {};
export function initKpis() {
  $('kpis').innerHTML = KPI_DEF.map(d => `<div class="kpi link" id="kpi-${d.id}" data-go="metric:${d.id}" role="button" tabindex="0" data-tip="${KPI_TIP[d.id]}|Clic para ver el detalle"><div class="k">${d.k}</div><div class="v"><span>–</span><small>${d.unit}</small></div>${d.bar ? '<div class="bar"><i></i></div>' : ''}</div>`).join('');
  animate('.kpi', { opacity: [0, 1], translateY: [-8, 0], delay: stagger(60), duration: 600, ease: 'outQuad' });
}
function setKpi(id, v) {
  const d = KPI_DEF.find(x => x.id === id);
  const el = $('kpi-' + id); if (!el || v == null || Number.isNaN(v)) return;
  const span = el.querySelector('.v span');
  const obj = { v: kpiVals[id] ?? v };
  kpiVals[id] = v;
  animate(obj, { v, duration: 900, ease: 'outQuad', onUpdate: () => { span.textContent = d.fmt(obj.v); } });
  if (d.bar) el.querySelector('.bar i').style.width = Math.min(100, v) + '%';
  el.classList.toggle('warn', d.warn != null && v >= d.warn && !(d.bad != null && v >= d.bad));
  el.classList.toggle('bad', d.bad != null && v >= d.bad);
}

// ---------------------------------------------------------------- graficas
let chCpu, chReq;
const cpuData = [[], [], []], reqData = [[], [], []];
function chartOpts(el, series, yRange) {
  return {
    width: el.clientWidth, height: el.clientHeight, pxAlign: false,
    padding: [8, 20, 0, 0], // margen a la derecha: la ultima hora del eje no se corta en el borde
    cursor: { points: { size: 8 }, drag: { x: false, y: false } },
    legend: { show: false },
    scales: { x: { time: true }, y: yRange ? { range: yRange } : { range: (u, mn, mx) => [0, Math.max(5, mx * 1.2)] } },
    axes: [
      { stroke: '#6b7a93', grid: { show: false }, ticks: { show: false }, font: '11px ui-monospace', size: 22, space: 70,
        values: (u, vals) => vals.map(v => new Date(v * 1000).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false })) },
      { stroke: '#6b7a93', grid: { stroke: 'rgba(148,163,184,.08)', width: 1 }, ticks: { show: false }, font: '11px ui-monospace', size: 34, space: 30 },
    ],
    series: [{}, ...series],
  };
}
// colores de las graficas: los pone el tema con --chart-1..4 (con los de la Ciudad como respaldo)
function chartColor(n, fb) { const v = getComputedStyle(document.body).getPropertyValue('--chart-' + n).trim(); return v || fb; }
function alpha(hex, a) { const m = /^#([0-9a-f]{6})$/i.exec(hex); if (!m) return hex; const n = parseInt(m[1], 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
function buildCharts() {
  const e1 = $('chCpu'), e2 = $('chReq');
  if (chCpu) chCpu.destroy(); if (chReq) chReq.destroy();
  e1.innerHTML = ''; e2.innerHTML = '';
  const c1 = chartColor(1, '#22d3ee'), c2 = chartColor(2, '#a78bfa'), c3 = chartColor(3, '#67e8f9'), c4 = chartColor(4, '#ef4444');
  chCpu = new uPlot(chartOpts(e1, [
    { label: 'CPU %', stroke: c1, width: 2, fill: alpha(c1, 0.10), points: { show: false } },
    { label: 'RAM %', stroke: c2, width: 2, points: { show: false } },
  ], [0, 100]), cpuData, e1);
  chReq = new uPlot(chartOpts(e2, [
    { label: 'req', stroke: c3, width: 2, fill: alpha(c3, 0.08), points: { show: false } },
    { label: '5xx', stroke: c4, width: 2, points: { show: false } },
  ]), reqData, e2);
}
// al cambiar de tema: mismas series, colores nuevos
export function rethemeCharts() { if (chCpu) { fitRight(); buildCharts(); } }
// si la columna derecha no cabe en su alto, las dos graficas se achican lo justo (hasta 3 rem) para que se vea todo
function fitRight() {
  const r = $('right'); if (!r || document.body.classList.contains('compact')) return;
  const charts = [...r.querySelectorAll('.chart')];
  charts.forEach(c => { c.style.height = ''; });
  const over = r.scrollHeight - r.clientHeight;
  // limite de filas por regla de estilo (sobrevive a los redibujos de cada estado)
  let st = document.getElementById('fitRightStyle');
  if (!st) { st = document.createElement('style'); st.id = 'fitRightStyle'; document.head.appendChild(st); }
  st.textContent = '';
  if (over > 0 && charts.length) {
    const min = parseFloat(getComputedStyle(document.documentElement).fontSize) * 3;
    charts.forEach(c => { c.style.height = Math.max(min, c.clientHeight - Math.ceil(over / charts.length)) + 'px'; });
  }
  // si aun no cabe: menos procesos (minimo 3) y menos proyectos (minimo 1)
  const vis = sel => [...r.querySelectorAll(sel)].filter(x => getComputedStyle(x).display !== 'none').length;
  let np = vis('#procs > *'), nj = vis('#proj .projrow');
  while (r.scrollHeight > r.clientHeight + 1 && (np > 3 || nj > 1)) {
    if (np > 3 && np >= nj + 2) np--; else if (nj > 1) nj--; else np--;
    st.textContent = `#right #procs > :nth-child(n+${np + 1}), #right #proj .projrow:nth-of-type(n+${nj + 1}) { display: none !important; }`;
  }
  // ultimo recurso: achicar las secciones de texto (no las graficas: su cursor se descalibra con zoom), hasta 80 %
  const over2 = r.scrollHeight - r.clientHeight;
  if (over2 > 1) {
    const txt = [...r.children].filter(x => !x.querySelector('.chart'));
    const h = txt.reduce((n, x) => n + x.offsetHeight, 0);
    const k = Math.max(0.8, (h - over2 - 2) / h).toFixed(3);
    st.textContent += ` #right > :not(:has(.chart)) { zoom: ${k}; }`;
  }
  if (chCpu) { const e1 = $('chCpu'), e2 = $('chReq'); chCpu.setSize({ width: e1.clientWidth, height: e1.clientHeight }); chReq.setSize({ width: e2.clientWidth, height: e2.clientHeight }); }
}
let fitRightT = 0;
function fitRightSoon() { clearTimeout(fitRightT); fitRightT = setTimeout(fitRight, 120); }
export function initCharts(history) {
  for (const p of history.system) { cpuData[0].push(p.t / 1000); cpuData[1].push(p.cpu); cpuData[2].push(p.mem); }
  for (const p of history.traffic) { reqData[0].push(p.t / 1000); reqData[1].push(p.req); reqData[2].push(p.err); }
  buildCharts();
  const e1 = $('chCpu'), e2 = $('chReq');
  new ResizeObserver(() => { chCpu.setSize({ width: e1.clientWidth, height: e1.clientHeight }); chReq.setSize({ width: e2.clientWidth, height: e2.clientHeight }); fitRightSoon(); }).observe($('right'));
  fitRightSoon();
}
function pushPoint(data, chart, t, vals, max) {
  if (data[0].length && t <= data[0][data[0].length - 1]) return;
  data[0].push(t); vals.forEach((v, i) => data[i + 1].push(v));
  if (data[0].length > max) data.forEach(a => a.shift());
  chart && chart.setData(data);
}

// ---------------------------------------------------------------- agentes
const cards = new Map();
function agentHtml(s, acc, priv) {
  const title = priv && s.title ? s.title : `Agente · ${acc?.label || ''}`;
  // que proyecto y que cuenta (lo que importa de un vistazo); abajo, la carpeta exacta y el modelo
  const proj = s.target ? s.target.name : '';
  const where = priv ? [s.project, s.model].filter(Boolean).join(' · ') : s.model || '';
  const WAIT = { permission: 'Espera su permiso', question: 'Le hizo una pregunta', idle: 'Espera su respuesta' };
  const act = s.waitKind ? `${WAIT[s.waitKind] || 'Lo espera'} hace ${ago(Date.now() - s.waitSince)}${priv && s.detail && s.waitKind === 'permission' ? ' · ' + s.detail : ''}`
    : s.state === 'idle' ? `Sin actividad hace ${ago(Date.now() - s.lastActivity)}`
    : priv && s.detail ? s.detail : s.activity || '';
  const tool = priv && s.tool && s.state !== 'idle' ? `<span class="tool">${esc(s.tool)}</span>` : '';
  const subs = (s.subagents || []).map(x => `<div class="subag" data-agent="${esc(x.id)}"><span class="st">↳ ${esc(STATE_LABEL[x.state] || x.state)}</span><span>${esc(priv ? (x.title || x.detail || x.activity) : x.activity)}</span></div>`).join('');
  return `<div class="row1"><div class="ttl">${esc(title)}</div><span class="badge ${s.state}" data-tip="${STATE_LABEL[s.state]}|${{ working: 'Está usando una herramienta ahora mismo.', thinking: 'Está razonando su próximo paso.', waiting: 'Necesita que usted responda o dé permiso.', idle: 'Terminó su turno y espera una nueva instrucción.' }[s.state] || ''}">${STATE_LABEL[s.state] || s.state}</span></div>
    <div class="proj">${proj ? `${px(s.target.kind === 'app' ? 'rocket' : 'house')}<b>${esc(proj)}</b>` : ''}${acc?.label ? `<span class="acct">${proj ? 'cuenta ' : ''}${esc(acc.label)}</span>` : ''}</div>
    ${where ? `<div class="where">${esc(where)}</div>` : ''}
    <div class="act">${tool}<span class="det">${esc(act)}</span></div>
    <div class="meta">${s.hooks ? `<span data-tip="En vivo|Esta sesión avisa por hooks: su estado es exacto y al instante.">${px('bolt')} en vivo</span>` : ''}<span>${fmtNum(s.tokensOut)} tokens</span><span>${s.tools} herramientas</span>${s.errors ? `<span>${s.errors} errores</span>` : ''}${s.subagents?.length ? `<span>${s.subagents.length} subagentes</span>` : ''}</div>
    ${subs ? `<div class="subs">${subs}</div>` : ''}`;
}
function renderAgents(sessions, accounts, priv) {
  const host = $('agents');
  const order = { waiting: 0, working: 1, thinking: 2, idle: 3 };
  const list = [...sessions].sort((a, b) => order[a.state] - order[b.state] || b.lastActivity - a.lastActivity);
  const seen = new Set();
  list.forEach((s, i) => {
    seen.add(s.id);
    let el = cards.get(s.id);
    const acc = accounts.find(a => a.id === s.account);
    if (!el) {
      el = document.createElement('div');
      el.className = 'agent';
      el.tabIndex = 0;
      el.setAttribute('role', 'button');
      el.dataset.go = 'session:' + s.id;
      cards.set(s.id, el);
      host.appendChild(el);
      animate(el, { opacity: [0, 1], translateX: [-30, 0], duration: 600, ease: 'outExpo' });
    }
    el.style.setProperty('--c', acc?.color || '#94a3b8');
    el.classList.toggle('waiting', s.state === 'waiting');
    const html = agentHtml(s, acc, priv);
    if (el._html !== html) { el.innerHTML = html; el._html = html; }
    if (host.children[i] !== el) host.insertBefore(el, host.children[i] || null);
  });
  for (const [id, el] of cards) if (!seen.has(id)) {
    cards.delete(id);
    animate(el, { opacity: 0, translateX: -30, duration: 400, ease: 'inQuad', onComplete: () => el.remove() });
  }
  $('agentCount').textContent = sessions.length;
  $('agentsEmpty').hidden = sessions.length > 0;
}

// ---------------------------------------------------------------- procesos, defensa, correo
function renderProcs(top, system) {
  const max = Math.max(100, ...top.map(p => p.cpu));
  $('procs').innerHTML = top.slice(0, 7).map(p => `<div class="proc"><span class="n">${esc(p.comm)} <small>×${p.n}</small></span>
    <span class="b"><i style="width:${Math.min(100, p.cpu / max * 100)}%"></i></span><span class="c">${p.cpu.toFixed(1)}%</span></div>`).join('');
  $('procCount').textContent = system ? `${system.procs} procesos · ${system.cores} núcleos` : '';
}
// salud del servidor: un chip por revision (respaldos, actualizaciones, correo, cron, puertos)
function renderHealth(list) {
  const el = $('health'); if (!el) return;
  if (!list || !list.length) return;
  const LBL = { ok: 'en orden', warn: 'para revisar', bad: 'grave', unknown: 'sin revisar' };
  const SHORT = { backups: 'Respaldos', updates: 'Paquetes', mail: 'Correo', cron: 'Cron', ports: 'Puertos' };
  el.innerHTML = list.map(h => `<span class="hchip ${h.status}" data-go="audit:${esc(h.id)}" title="${esc(h.title)}: ${LBL[h.status] || h.status}">${px(h.icon)}<i>${esc(SHORT[h.id] || h.title)}</i><b>${h.bad + h.warn || (h.status === 'unknown' ? '?' : '')}</b></span>`).join('');
  const bad = list.reduce((n, h) => n + h.bad, 0), warn = list.reduce((n, h) => n + h.warn, 0);
  $('healthSub').textContent = bad ? `${bad} grave${bad === 1 ? '' : 's'}${warn ? ` · ${warn} para revisar` : ''}` : warn ? `${warn} para revisar` : 'en orden';
  $('healthSub').className = 'sub ' + (bad ? 'bad' : warn ? 'warn' : 'ok');
}
function renderMini(state) {
  renderHealth(state.health);
  const s = state.security, m = state.mail;
  const w = state.webdef;
  $('sec').innerHTML = `<div><span>Intentos SSH</span><b>${fmtNum(s.failed)}</b></div><div><span>IPs bloqueadas</span><b>${fmtNum(s.blocked)}</b></div><div><span>Accesos OK</span><b>${fmtNum(s.logins)}</b></div>`
    + (w ? `<div class="link" data-go="webdef:all" data-tip="Defensa web|Robots que buscan rutas vulnerables en sus sitios (/.env, wp-login.php, phpmyadmin, webshells) en la última hora."><span>Sondeos web / h</span><b>${fmtNum(w.hour)}</b></div>`
      + `<div class="link ${w.exposed ? 'bad' : w.suspect ? 'warn' : ''}" data-go="webdef:all"><span>Archivos expuestos</span><b>${w.exposed || (w.suspect ? '?' : 0)}</b></div>` : '')
    + (state.jail ? `<div class="link" data-go="jail:all" data-tip="Cárcel|IPs bloqueadas a mano en el firewall y por la defensa de Atalaya. Clic para ver cada una."><span>En la cárcel</span><b>${fmtNum(state.jail.n)}</b></div>` : '');
  $('mail').innerHTML = `<div><span>Enviados</span><b>${fmtNum(m.out)}</b></div><div><span>Recibidos</span><b>${fmtNum(m.in)}</b></div><div><span>Rebotes</span><b>${fmtNum(m.bounce)}</b></div>`;
}

// ---------------------------------------------------------------- ticker
const pending = { attack: 0, http5: 0, probe: 0, probeFam: {} };
const FAM_TXT = { secrets: 'secretos (.env, .git, respaldos)', shells: 'webshells', panels: 'paneles de administración', exploits: 'exploits', wordpress: 'el login de WordPress' };
export function tickerEvent(e, accounts, priv) {
  const acc = accounts.find(a => a.id === e.account);
  const tag = acc ? acc.label : '';
  let ic = '', text = '', color = acc?.color;
  switch (e.kind) {
    case 'claude':
      if (e.action === 'tool') return; // demasiado frecuente: se ve en el mundo
      if (e.action === 'permission') {
        const what = { permission: 'Un agente espera su permiso', question: 'Un agente le hizo una pregunta', idle: 'Un agente espera su respuesta' }[e.waitKind] || 'Un agente lo espera';
        addTicker('ask', tag, what + (priv && e.detail ? ` · ${e.tool ? e.tool + ': ' : ''}${e.detail}` : ''), '#fbbf24', 'session:' + e.sid);
        return;
      }
      ic = { prompt: 'chat', done: 'ok', error: 'warn', start: 'bot', end: 'exit', spawn: 'portal', despawn: 'portal', compact: 'squeeze' }[e.action] || 'bot';
      text = { prompt: priv && e.text ? e.text : 'Nueva instrucción para un agente', done: 'Un agente terminó su turno', error: 'Una herramienta falló',
        start: 'Nuevo agente en línea', end: 'Un agente se desconectó', compact: 'Un agente compactó su memoria', spawn: 'Subagente creado' + (priv && e.detail ? ': ' + e.detail : ''), despawn: 'Subagente terminó' }[e.action];
      if (!text) return;
      break;
    case 'pm2': ic = e.action === 'down' ? 'fire' : 'refresh'; text = `${e.appName} ${e.action === 'down' ? 'se detuvo' : 'se reinició'}`; break;
    case 'http': if (e.status < 500) return; pending.http5++; pending.http5App = e.app; return;
    case 'attack': pending.attack++; return;
    // sondeos web: se agrupan cada 10 s; un archivo expuesto sale solo y en rojo
    case 'probe':
      if (!e.exposed) { pending.probe++; pending.probeFam[e.fam] = (pending.probeFam[e.fam] || 0) + 1; return; }
      ic = 'bad'; color = '#ef4444';
      text = `${e.confirmed ? 'ARCHIVO EXPUESTO confirmado' : 'Una ruta sensible respondió'}${priv && e.path ? `: ${e.path}` : ` (${FAM_TXT[e.fam] || e.fam})`} · verificando`;
      if (e.confirmed) text = text.replace(' · verificando', '');
      break;
    case 'block': ic = 'shield'; text = 'IP bloqueada por cPHulk' + (priv && e.ip ? ` · ${e.ip}` : ''); color = '#fb7185'; break;
    case 'login': ic = 'key'; text = 'Acceso SSH correcto' + (priv && e.user ? ` · ${e.user} desde ${e.ip}` : ''); color = '#4ade80'; break;
    case 'mail': if (e.dir !== 'bounce') return; ic = 'mailBad'; text = 'Correo rebotado'; color = '#f87171'; break;
    case 'domain':
      ic = { added: 'wip', removed: 'trash', changed: 'refresh' }[e.action];
      text = { added: 'Nuevo dominio', removed: 'Dominio eliminado', changed: 'Un sitio cambió' }[e.action] + (e.domain ? `: ${e.domain} (${e.what})` : e.typeLabel ? ` · ${e.typeLabel}` : '');
      color = e.action === 'removed' ? '#f87171' : '#4ade80';
      addTicker(ic, e.label || tag, text, color, 'district:' + e.account); return;
    case 'deploy': {
      const T = { building: ['wip', 'Desplegando'], ready: ['rocket', 'Desplegado'], error: ['boom', 'Falló el despliegue de'], canceled: ['dotS', 'Se canceló el despliegue de'] }[e.action] || ['rocket', 'Despliegue'];
      addTicker(T[0], e.label || tag, `${T[1]} ${e.appName}${e.target === 'production' ? ' a producción' : ' (preview)'}${e.commit ? ' · ' + e.commit : ''}`,
        e.action === 'error' ? '#ef4444' : e.action === 'ready' ? '#4ade80' : '#fbbf24', 'app:' + e.app);
      return;
    }
    case 'keysvc':
      addTicker(e.action === 'down' ? 'siren' : 'ok', forEdition('Torre de control'), e.action === 'down' ? `${e.label} FALLÓ` : `${e.label} volvió a funcionar`, e.action === 'down' ? '#ef4444' : '#4ade80', 'system:root');
      return;
    case 'watch': {
      if (e.action !== 'start') return;
      const st = window.atalaya && window.atalaya.state;
      const nm = e.name || (st && ((st.sites.find(x => x.id === e.site) || st.apps.find(x => x.id === e.app)) || {}).name) || 'un sitio';
      const T = { scan: [`Escaneo en ${nm}: ${e.n} sondeos en 15 min`, '#ef4444', 'siren'], scraping: [`Scraping en ${nm}: una IP hizo ${e.n} pedidos en 5 min${priv && e.ip ? ' · ' + e.ip : ''}`, '#ef4444', 'siren'],
        surge: [`Pico de visitas en ${nm}: ${e.n}/min desde ${e.ips} IPs · ¿se hizo viral o es un ataque?`, '#fbbf24', 'fire'],
        exposed: [`Ruta expuesta en ${nm}${priv && e.path ? ': ' + e.path : ''} · alguien encontró algo`, '#ef4444', 'bad'],
        bruteforce: [`Fuerza bruta en ${nm}: ${e.n} intentos de login en 10 min${priv && e.ip ? ' · ' + e.ip : ''}`, '#ef4444', 'key'],
        multi: [`La misma IP sondea ${e.n} de sus sitios${priv && e.ip ? ' · ' + e.ip : ''}`, '#ef4444', 'siren'] }[e.reason];
      if (T) addTicker(T[2], e.label || '', T[0], T[1], e.reason === 'surge' ? (e.site ? 'site:' + e.site : 'app:' + e.app) : 'webdef:all');
      return;
    }
    case 'phpfile': {
      const st = window.atalaya && window.atalaya.state;
      const nm = e.name || (st && (st.sites.find(x => x.id === e.site) || {}).name) || 'un sitio';
      if (e.action === 'quarantine') { addTicker('ok', e.label || '', `Archivo PHP sospechoso de ${nm} en cuarentena: ya no funciona`, '#4ade80', 'jail:all'); return; }
      if (e.action === 'hit') addTicker('siren', e.label || '', `${priv && e.ip ? e.ip : 'Alguien'} pidió el archivo PHP sospechoso de ${nm} (respuesta ${e.status || '?'})`, '#ef4444', e.site ? 'site:' + e.site : null);
      else addTicker('bad', e.label || '', `Archivo PHP sospechoso en ${nm}${priv && e.path ? ': ' + e.path.replace(/^\/home\/[^/]+\//, '~/') : ''} · ${e.why || ''}`, '#ef4444', e.site ? 'site:' + e.site : null);
      return;
    }
    case 'saturation':
      if (e.action === 'start') addTicker('fire', forEdition('Torre de control'), `${forEdition('Servidor')} al límite: ${(e.causes || []).join(', ')}`, '#ef4444', 'system:root');
      else addTicker('ok', forEdition('Torre de control'), forEdition('El servidor volvió a tener margen'), '#4ade80', 'system:root');
      return;
    case 'defense': {
      const st = window.atalaya && window.atalaya.state;
      const nm = e.name || (st && ((st.sites.find(x => x.id === e.site) || st.apps.find(x => x.id === e.app)) || {}).name) || '';
      const who = priv && e.ip ? e.ip : 'Una IP';
      if (e.action === 'block') addTicker('shield', e.label || '', `${who} bloqueada${e.hours ? ` ${e.hours} h` : ''}${nm ? ' en ' + nm : ''}${e.by === 'auto' ? ' · defensa automática' : ''}`, '#4ade80', 'webdef:all');
      else if (e.action === 'unblock') addTicker('shield', e.label || '', `${who} desbloqueada`, '#94a3b8', 'webdef:all');
      return;
    }
    case 'db':
      if (e.action !== 'slow') return;
      addTicker('db', e.label || '', `Consulta lenta en ${e.db}: ${e.secs} s`, '#fbbf24', 'database:' + e.db);
      return;
    case 'account':
      addTicker(e.action === 'added' ? 'city' : 'ruin', e.label || '', e.action === 'added' ? 'Nueva cuenta en el servidor: aparece un distrito nuevo' : 'Una cuenta fue eliminada del servidor', e.action === 'added' ? '#4ade80' : '#f87171', e.action === 'added' ? 'district:' + e.account : null);
      return;
    default: return;
  }
  const go = e.kind === 'claude' ? (e.action === 'end' ? null : 'session:' + e.sid) : e.kind === 'pm2' ? 'app:' + e.app
    : e.kind === 'block' || e.kind === 'login' ? 'security:all' : e.kind === 'mail' ? 'mail:all' : e.kind === 'probe' ? 'webdef:all' : null;
  addTicker(ic, tag, text, color, go);
}
setInterval(() => {
  if (pending.attack) { addTicker('invader', '', `${pending.attack} intento${pending.attack > 1 ? 's' : ''} de intrusión SSH repelido${pending.attack > 1 ? 's' : ''}`, '#f87171', 'security:all'); pending.attack = 0; }
  // los sondeos se avisan como mucho una vez por minuto (llegan de a miles por hora)
  if (pending.probe && Date.now() - (pending.probeAt || 0) > 60000) {
    pending.probeAt = Date.now();
    const top = Object.entries(pending.probeFam).sort((a, b) => b[1] - a[1])[0];
    addTicker('invader', '', `${pending.probe} sondeo${pending.probe > 1 ? 's' : ''} de robots buscando rutas vulnerables${top ? ` (sobre todo ${FAM_TXT[top[0]] || top[0]})` : ''}`, '#fb923c', 'webdef:all');
    pending.probe = 0; pending.probeFam = {};
  }
  if (pending.http5) { addTicker('boom', '', `${pending.http5} error${pending.http5 > 1 ? 'es' : ''} 5xx en los sitios`, '#ef4444', pending.http5App ? 'app:' + pending.http5App : 'system:root'); pending.http5 = 0; pending.http5App = null; }
}, 10000);
// historial de la cinta (se vacia al cambiar de modo: puede contener texto privado)
const events = [];
export const getEvents = () => events;
export function clearTicker() {
  events.length = 0;
  $('log').innerHTML = `<span class="ev ph"><span class="ic">${px('antenna')}</span><span>Escuchando eventos del servidor…</span></span>`;
  $('tcount').textContent = '0';
}
const CAT = { chat: 'agentes', ok: 'agentes', warn: 'agentes', bot: 'agentes', exit: 'agentes', portal: 'agentes', squeeze: 'agentes', ask: 'agentes',
  invader: 'seguridad', shield: 'seguridad', key: 'seguridad', fire: 'servicios', refresh: 'servicios', siren: 'servicios', wip: 'sitios', trash: 'sitios',
  city: 'sitios', ruin: 'sitios', boom: 'sitios', rocket: 'servicios', dotS: 'servicios', mailBad: 'correo' };
function addTicker(ic, tag, text, color, go) {
  events.unshift({ t: Date.now(), ic, tag, text, color, go, cat: CAT[ic] || 'otros' });
  if (events.length > 200) events.length = 200;
  $('tcount').textContent = String(events.length);
  const log = $('log');
  const el = document.createElement(go ? 'button' : 'span');
  el.className = 'ev' + (go ? ' link' : '');
  if (go) el.dataset.go = go;
  el.style.setProperty('--c', color || '');
  const time = new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false });
  el.innerHTML = `<span class="ic">${px(ic)}</span>${tag ? `<span class="tag">${esc(tag)}</span>` : ''}<span>${esc(text.length > 90 ? text.slice(0, 89) + '…' : text)}</span><time>${time}</time>`;
  log.prepend(el);
  animate(el, { opacity: [0, 1], translateX: [-40, 0], duration: 500, ease: 'outExpo' });
  log.querySelector('.ph')?.remove(); // el aviso "Escuchando eventos..." se va con la primera novedad
  while (log.children.length > 10) log.lastChild.remove();
}

// ---------------------------------------------------------------- estado completo
export function renderState(st) {
  const sys = st.system;
  // Atalaya Equipo en macOS o Windows: sin red por interfaz ni procesos (y en Windows, sin carga)
  document.body.classList.toggle('sys-lite', !!(sys && sys.lite));
  document.body.classList.toggle('sys-noload', !!(sys && sys.lite && !sys.load.some(Boolean)));
  if (sys) {
    setKpi('cpu', sys.cpu); setKpi('mem', sys.mem.pct); setKpi('disk', sys.disk?.pct); setKpi('load', sys.load[0]);
    setKpi('rx', sys.net.rx); setKpi('tx', sys.net.tx);
    pushPoint(cpuData, chCpu, sys.ts / 1000, [sys.cpu, Math.round(sys.mem.pct * 10) / 10], 300);
  }
  if (st.trafficPoint) pushPoint(reqData, chReq, st.trafficPoint.t / 1000, [st.trafficPoint.req, st.trafficPoint.err], 60);
  setKpi('req', st.traffic.reqMin); setKpi('err', st.traffic.errMin);
  renderAgents(st.sessions, st.accounts, st.priv);
  renderProcs(st.top, sys);
  renderMini(st);
  const r = $('right'); if (r && r.scrollHeight > r.clientHeight + 2) fitRightSoon(); // si algo crecio
}

export function resetAgents() { for (const el of cards.values()) el.remove(); cards.clear(); }
export { fmtBytes, esc, fmtNum, ago };

// ---------------------------------------------------------------- cinta que rota
// Cada 4,5 s avanza a la siguiente novedad; se pausa si el usuario la toca, la desliza o pasa el mouse.
(() => {
  const sc = $('tscroll');
  let hover = false, userAt = 0, i = 0;
  sc.addEventListener('mouseenter', () => { hover = true; });
  sc.addEventListener('mouseleave', () => { hover = false; });
  sc.addEventListener('wheel', e => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) { sc.scrollLeft += e.deltaY; e.preventDefault(); } userAt = Date.now(); }, { passive: false });
  sc.addEventListener('touchstart', () => { userAt = Date.now(); }, { passive: true });
  sc.addEventListener('scroll', () => { if (!sc._auto) userAt = Date.now(); sc._auto = false; }, { passive: true });
  setInterval(() => {
    if (hover || Date.now() - userAt < 10000) return;
    const items = [...$('log').children];
    if (items.length < 2 || sc.scrollWidth <= sc.clientWidth + 4) { i = 0; return; }
    i = (i + 1) % items.length;
    const target = i === 0 ? 0 : Math.min(items[i].offsetLeft - 12, sc.scrollWidth - sc.clientWidth);
    if (target >= sc.scrollWidth - sc.clientWidth - 2 && i !== 0) i = items.length - 1; // al final vuelve al inicio en la proxima
    sc._auto = true;
    sc.scrollTo({ left: target, behavior: 'smooth' });
  }, 4500);
})();
