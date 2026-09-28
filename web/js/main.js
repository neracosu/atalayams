// Arranque: stream SSE, mundo, HUD y control del modo privado
import { animate } from '../vendor/anime.esm.min.js';
import { px } from './pixicons.js';
// marcadores del HTML estatico: <span data-px="nombre"></span>
document.querySelectorAll('[data-px]').forEach(el => { el.innerHTML = px(el.dataset.px); });
import { ThemeManager } from './themes.js';
import { initKpis, initCharts, rethemeCharts, renderState, tickerEvent, resetAgents, getEvents, clearTicker } from './hud.js';
import { buildPin } from './pin.js';
import { Drawer } from './drawer.js';
import { withFavicons, clearFavicons } from './favicons.js';
import { showTip, showWorldTip, hideTip, openLegend } from './tips.js';
import { CommFx } from './commfx.js';
import { ask } from './ask.js';
import { Director } from './director.js';
import { forEdition } from './accounts.js';
import { Tour } from './tour.js';

const $ = id => document.getElementById(id);
const post = (url, body = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: JSON.stringify(body) })
  .then(async r => { const j = await r.json().catch(() => ({})); if (r.status === 401 && url !== 'api/private') location.href = 'login'; if (!r.ok) throw new Error(j.error || 'Error'); return j; });

let hello = null, state = null, chartsReady = false, loadedVersion = null;
// encargos, resultados, mensajes y el haz al proyecto, encima de cualquier tema
const comm = new CommFx(() => world);
// el mundo lo pone el tema activo (web/themes/<id>); cambia en caliente
let world = null;
const tm = new ThemeManager($('world'), w => {
  world = w;
  w.onSelect = (kind, id) => { hideTip(); drawer.open(kind, id); };
  w.onTip = (t, x, y) => (t ? showWorldTip({ ...t, title: forEdition(t.title), body: forEdition(t.body) }, x, y) : hideTip()); // en la edicion Equipo, «este equipo»
  w.onNav = onNav;
  window.atalaya = { world: w, drawer, themes: tm, comm, tour, state }; // referencia para depurar desde la consola
});

// la visita guiada: senala cada cosa y dice para que sirve (tour.js; los pasos, en tourpasos.js)
const tour = new Tour({
  world: () => world, state: () => state, hello: () => hello,
  antes: () => { drawer.close(); hideTip(); openSheet(''); $('menu').hidden = true; },
});
let tourListo = false;
// con la primera foto del servidor: sigue la visita que quedo a medias o, la primera vez, la ofrece
function tourAlEntrar() {
  if (tourListo) return; tourListo = true;
  setTimeout(() => {
    if (tour.retomar()) return;
    if (document.querySelector('dialog[open]') || drawer.isOpen || new URLSearchParams(location.search).get('go')) return; // no encima de otra cosa
    tour.ofrecer();
  }, 2500);
}

// ---------------------------------------------------------------- detalle y navegacion
// Todo lo que se toca pasa por aqui: el mundo enfoca la entidad y el panel muestra su detalle
const drawer = new Drawer($('drawer'), {
  onNavigate: (kind, id) => openDetail(kind, id),
  onClose: () => world && world.clearSelection(),
});
function openDetail(kind, id) {
  if (['app', 'site', 'session', 'district', 'system', 'security'].includes(kind)) world.pick(kind, id); // enfoca y dispara onSelect
  else drawer.open(kind, id);
}
drawer.eventsProvider = getEvents;
$('tall').addEventListener('click', () => drawer.open('events', 'all'));
$('navHelp').addEventListener('click', () => openLegend(tm.manifest));
document.addEventListener('click', e => {
  const el = e.target.closest('[data-go]');
  if (!el || el.closest('#drawer')) return; // el panel maneja sus propios enlaces
  const [kind, ...rest] = el.dataset.go.split(':');
  openDetail(kind, rest.join(':'));
});
document.addEventListener('keydown', e => {
  if (e.key === 'Enter' && e.target.dataset?.go) e.target.click();
});
// el director sigue lo que pasa: enfoca y pone un rotulo (ver director.js)
const director = new Director({
  getWorld: () => world, getState: () => state,
  mark: (kind, id, secs) => (kind ? comm.spot(kind, id, secs) : comm.unspot()),
  caption: html => {
    const el = $('dirCap');
    if (!html) { el.classList.remove('show'); return; }
    el.innerHTML = html; el.hidden = false;
    requestAnimationFrame(() => el.classList.add('show'));
  },
});
function onNav(st) {
  const el = $('navState');
  if (world && world.directing) st = { mode: 'director' };
  const html = st.mode === 'manual' ? `${px('move')} Navegación libre · el director vuelve en ${st.left} s` : st.mode === 'director' ? `${px('camera')} Director` : `${px('pin')} Cámara fija`;
  if (el.dataset.html !== html) { el.dataset.html = html; el.innerHTML = html; }
  el.classList.toggle('manual', st.mode === 'manual');
}
$('navHome').addEventListener('click', () => world.resetView());
$('navIn').addEventListener('click', () => world.zoomBy(1.3));
$('navOut').addEventListener('click', () => world.zoomBy(1 / 1.3));
$('navState').addEventListener('click', () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' })));

// monta un tema y restaura lo que la pantalla tenia (director, margenes del HUD)
async function switchTheme(id) {
  drawer.close(); hideTip();
  await tm.load(id);
  rethemeCharts();
  try { if (localStorage.getItem('atalaya_director') === '0') world.setDirector(false); } catch { }
  requestAnimationFrame(() => world.setInsets(insets()));
  world.navChanged && world.navChanged();
}

// margenes que el HUD le quita al mundo, midiendo donde quedo cada panel (cada tema los acomoda distinto):
// barras anchas arriba o abajo, y columnas altas a los lados
function insets() {
  const vw = innerWidth, vh = innerHeight, ins = { top: 8, bottom: 8, left: 8, right: 8 };
  // si el tema declaro el area del mundo, manda esa
  const wa = $('worldArea');
  if (wa && getComputedStyle(wa).display !== 'none') {
    const r = wa.getBoundingClientRect();
    if (r.width > 100 && r.height > 100) return { top: r.top, left: r.left, right: vw - r.right, bottom: vh - r.bottom };
  }
  for (const id of ['top', 'left', 'right', 'ticker']) {
    const el = $(id);
    if (!el || el.hidden || getComputedStyle(el).display === 'none') continue;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    if (r.width > vw * 0.5) {
      if (r.top < vh * 0.25) ins.top = Math.max(ins.top, r.bottom + 8);
      else if (r.bottom > vh * 0.75) ins.bottom = Math.max(ins.bottom, vh - r.top + 8);
    } else if (r.height > vh * 0.35 && vw > 900) {
      if (r.left < vw * 0.3) ins.left = Math.max(ins.left, r.right + 8);
      else if (r.right > vw * 0.7) ins.right = Math.max(ins.right, vw - r.left + 8);
    }
  }
  return ins;
}

// ---------------------------------------------------------------- modo
function applyMode(h) {
  hello = h;
  document.body.classList.toggle('private', h.priv);
  const b = $('mode');
  b.classList.toggle('priv', h.priv); b.classList.toggle('pub', !h.priv);
  b.querySelector('.txt').textContent = h.priv ? 'PRIVADO' : 'PÚBLICO';
  $('title').firstChild.textContent = h.title + ' ';
  $('verChip').textContent = 'v' + h.version;
  document.querySelectorAll('.owneronly').forEach(b => { b.hidden = h.role !== 'owner'; });
  // Atalaya Cloud: sin servidor propio (ni metricas de maquina ni instalar en otro servidor)
  document.body.classList.toggle('ed-cloud', h.edition === 'cloud');
  document.body.classList.toggle('ed-equipo', h.edition === 'equipo');
  document.querySelectorAll('.nocloud').forEach(b => { b.hidden = b.hidden || h.edition === 'cloud' || h.edition === 'equipo'; });
  document.querySelectorAll('.noequipo').forEach(b => { b.hidden = b.hidden || h.edition === 'equipo'; });
  $('maestroBtn').hidden = !h.maestro;
  $('version').textContent = `${h.title} v${h.version}`;
  // tras una actualizacion, las novedades se muestran una vez
  let seen = null; try { seen = localStorage.getItem('atalaya_seen_version'); localStorage.setItem('atalaya_seen_version', h.version); } catch { }
  if (seen && seen !== h.version) setTimeout(() => openNews(seen), 1500);
  $('subtitle').textContent = h.priv ? h.subtitle : 'Monitor en vivo';
  document.title = h.title + (h.priv ? ' · privado' : '');
  resetAgents();
  updateCountdown();
}
function updateCountdown() {
  const el = $('mode').querySelector('.left');
  if (!hello || !hello.priv) { el.textContent = ''; return; }
  if (hello.privateUntil === -1) { el.textContent = '∞'; return; }
  const s = Math.max(0, Math.round((hello.privateUntil - Date.now()) / 1000));
  el.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
setInterval(updateCountdown, 1000);

// dialogo para activar el modo privado
let minutes = null;
const dlg = $('privDlg');
const privPin = buildPin($('privPin'), () => $('privForm').requestSubmit());
function openPrivate() {
  if (!hello) return;
  if (hello.role !== 'owner') { flash('Su usuario solo tiene acceso al modo público'); return; }
  const opts = hello.privateOptions;
  minutes = minutes ?? opts[0];
  const lbl = m => m === 0 ? 'Sin límite' : m < 60 ? `${m} min` : m === 60 ? '1 hora' : `${m / 60} horas`;
  $('durations').innerHTML = opts.map(m => `<button type="button" role="radio" aria-checked="${m === minutes}" data-m="${m}">${lbl(m)}</button>`).join('');
  $('privErr').textContent = '';
  dlg.showModal();
  privPin.clear();
  animate(dlg, { opacity: [0, 1], scale: [0.95, 1], duration: 300, ease: 'outQuad' });
}
$('durations').addEventListener('click', e => {
  const b = e.target.closest('button[data-m]'); if (!b) return;
  minutes = Number(b.dataset.m);
  for (const x of $('durations').children) x.setAttribute('aria-checked', x === b);
});
$('privCancel').addEventListener('click', () => dlg.close());
$('privForm').addEventListener('submit', async e => {
  e.preventDefault();
  if (privPin.value().length !== 6) { $('privErr').textContent = 'Complete los 6 dígitos'; return; }
  try { await post('api/private', { pin: privPin.value(), minutes }); dlg.close(); }
  catch (ex) { $('privErr').textContent = ex.message; privPin.clear(); }
});
async function goPublic() { try { await post('api/public'); } catch { } }

$('mode').addEventListener('click', () => (hello?.priv ? goPublic() : openPrivate()));

// menu
$('menuBtn').addEventListener('click', e => { e.stopPropagation(); $('menu').hidden = !$('menu').hidden; });
document.addEventListener('click', () => { $('menu').hidden = true; });
$('menu').addEventListener('click', async e => {
  const act = e.target.closest('button')?.dataset.act;
  if (act === 'tour') tour.abrir(0);
  if (act === 'theme') openThemes();
  if (act === 'fullscreen') toggleFs();
  if (act === 'lock') goPublic();
  if (act === 'setup') location.href = 'setup';
  if (act === 'connect') location.href = 'setup#conectar';
  if (act === 'hosting2') { if (!needPrivate('conectar un hosting')) openInstall('hosting'); }
  if (act === 'install') openInstall('vps');
  if (act === 'hosting') { if (!needPrivate('ver sus sitios, latidos y hostings')) openInstall('hosting'); }
  if (act === 'equipo') openInstall('equipo');
  if (act === 'director') document.dispatchEvent(new KeyboardEvent('keydown', { key: 'd' }));
  if (act === 'lockall') { await post('api/public-all').catch(() => { }); flash('Todas las pantallas pasaron a modo público'); }
  if (act === 'users') openUsers();
  if (act === 'update') openUpdate();
  if (act === 'alerts') openAlerts();
  if (act === 'maestro') openMaestro();
  if (act === 'logout') { await post('api/logout').catch(() => { }); location.href = 'login'; }
});
function toggleFs() { document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen().catch(() => { }); }

// atajos: L publico al instante, P privado, F pantalla completa
document.addEventListener('keydown', e => {
  if (dlg.open || $('legend').open || newsDlg.open || instDlg.open || themeDlg.open || e.target.tagName === 'INPUT' || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'escape' && drawer.isOpen) drawer.close();
  else if (k === 'l' || k === 'escape') goPublic();
  else if (k === 'p') openPrivate();
  else if (k === 'f') toggleFs();
  else if (k === 't') cycleTheme();
  else if (k === '?' || k === 'h') openLegend(tm.manifest);
  else if (k === 'd') { world.setDirector(!world.directorOn); world.navChanged(); try { localStorage.setItem('atalaya_director', world.directorOn ? '1' : '0'); } catch { } flash(world.directorOn ? 'Modo director: la cámara sigue lo que pasa en el servidor' : 'Cámara fija en la vista general'); }
});

function flash(msg) {
  const c = $('conn');
  c.textContent = msg; c.hidden = false; c.style.background = 'rgba(34,211,238,.15)'; c.style.borderColor = 'rgba(34,211,238,.5)'; c.style.color = '#cffafe';
  setTimeout(() => { c.hidden = true; c.removeAttribute('style'); }, 3500);
}

// ---------------------------------------------------------------- instalar en otro servidor
const instDlg = $('instDlg');
instDlg.querySelector('.iclose').addEventListener('click', () => instDlg.close());
const ie = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// errores de la pantalla: se reportan al servidor (Atalaya Cloud los guarda para corregirlos; las demas ediciones no)
let reported = 0;
window.atalayaReport = (msg, where) => {
  if (reported++ > 8 || !msg) return;
  fetch('api/clienterror', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' },
    body: JSON.stringify({ msg: String(msg).slice(0, 300), where: String(where || '').slice(0, 80), theme: document.body.dataset.theme || '', view: document.body.classList.contains('compact') ? 'celular' : 'escritorio' }) }).catch(() => { });
};
window.addEventListener('error', e => window.atalayaReport(e.message, (e.filename || '').split('/').pop() + ':' + (e.lineno || 0)));
window.addEventListener('unhandledrejection', e => window.atalayaReport(e.reason && e.reason.message || String(e.reason), 'promesa'));
const ipost = (url, body = {}) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: JSON.stringify(body) }).then(x => x.json()).catch(() => ({ error: 'Sin conexión' }));
const copyBox = (id, text) => `<div class="copy"><pre class="cmd">${ie(text)}</pre><button class="btn small" data-copy="${id}">Copiar</button></div>`;
let instTab = 'vps';
instDlg.querySelectorAll('[data-itab]').forEach(b => b.addEventListener('click', () => openInstall(b.dataset.itab)));
instDlg.addEventListener('click', ev => {
  const b = ev.target.closest('[data-copy]');
  if (b) navigator.clipboard?.writeText(b.previousElementSibling.textContent).then(() => { b.textContent = 'Copiado ✓'; });
});
async function openInstall(tab = instTab) {
  instTab = tab;
  instDlg.querySelectorAll('[data-itab]').forEach(b => b.setAttribute('aria-selected', b.dataset.itab === tab ? 'true' : 'false'));
  if (document.body.classList.contains('ed-cloud')) tab = instTab = 'hosting';
  if (tab === 'hosting') await renderHosting(); else if (tab === 'equipo') await renderEquipo(); else await renderVps();
  if (!instDlg.open) instDlg.showModal();
}
// Atalaya Equipo: el ejecutable para Windows, macOS o Linux, descargado desde este servidor
async function renderEquipo() {
  const r = await fetch('api/downloads').then(x => x.json()).catch(() => ({ error: 'Sin conexión' }));
  const mb = n => (n / 1048576).toFixed(1) + ' MB';
  const guess = /Windows/.test(navigator.userAgent) ? 'win-x64' : /Mac/.test(navigator.userAgent) ? 'darwin-arm64' : /Linux/.test(navigator.userAgent) ? 'linux-x64' : '';
  const rows = (r.files || []).map(f => `<li class="${f.plat === guess ? 'mine' : ''}"><span class="grow"><b>${ie(f.label)}</b>${f.plat === guess ? ' <span class="pill ok">su sistema</span>' : ''}<br><span class="dmuted mono">${ie(f.file)} · ${mb(f.size)}</span>
      ${f.sha256 ? `<br><span class="dmuted mono sha" title="Huella SHA-256 para verificar la descarga">${ie(f.sha256)}</span>` : ''}</span><a class="btn small${f.plat === guess ? '' : ' ghost'}" href="download/${encodeURIComponent(f.file)}" download>Descargar</a></li>`).join('');
  $('instBody').innerHTML = `
    <p class="lead"><b>Atalaya Equipo</b>: un solo archivo que trae todo. Muestra esa computadora (CPU, memoria, disco), sus sesiones de Claude Code y los conectores de nube que agregue.
      Solo se abre desde ese equipo: nadie más en la red puede verla.</p>
    ${r.error ? `<p class="dmuted">${ie(r.error)}</p>` : rows ? `<section><h4>Versión ${ie((r.files[0] || {}).version || r.version)}</h4><ul class="dlist dl-files">${rows}</ul></section>`
      : '<p class="dmuted">Todavía no hay ejecutables armados en este servidor.</p>'}
    <section><h4>Cómo se usa</h4>
      <div class="lrow"><div class="lico">${px('laptop', 'big')}</div><div><b>Windows</b><p>Descomprima el .zip y haga doble clic en <code>atalaya.exe</code>. Si aparece «Windows protegió su PC», pulse <b>Más información</b> y <b>Ejecutar de todas formas</b> (el archivo aún no tiene firma de un certificado comercial).</p></div></div>
      <div class="lrow"><div class="lico">${px('laptop', 'big')}</div><div><b>macOS</b><p>Descomprima, y en una Terminal dentro de la carpeta ejecute <code>./atalaya</code>. Si macOS no lo deja abrir: Ajustes del Sistema › Privacidad y seguridad › <b>Abrir de todas formas</b>.</p></div></div>
      <div class="lrow"><div class="lico">${px('terminal', 'big')}</div><div><b>Linux</b><p><code>tar xzf</code> el archivo y ejecute <code>./atalaya</code>.</p></div></div>
      <p class="lhelp">Se abre el navegador en el asistente con el código ya puesto: cree su usuario y su PIN. Deje la ventana abierta mientras lo use; para volver a entrar, abra el archivo de nuevo. Sus datos quedan en esa computadora.
        Para ver además sus hostings y sitios WordPress use esta pantalla (VPS) o Atalaya Cloud: necesitan una dirección pública.</p></section>`;
}
async function renderVps() {
  const r = await ipost('api/setup/install-command');
  if (!r.command) { $('instBody').innerHTML = `<p class="dmuted">${ie(r.error || 'No se pudo generar el comando')}</p>`; return; }
  const until = new Date(r.expires).toLocaleString('es-VE', { hour12: false });
  $('instBody').innerHTML = `
    <p class="lead"><b>Atalaya VPS</b>: para servidores con acceso root. Ve todo el servidor: cuentas, procesos, servicios, bases, logs y agentes de Claude Code.
    Este comando descarga Atalaya <b>desde este servidor</b> y lo instala en el otro. Vale hasta <b>${ie(until)}</b> y para 5 instalaciones.</p>
    ${copyBox('vps', r.command)}
    <section><h4>Dónde pegarlo</h4>
      <div class="lrow"><div class="lico">${px('terminal', 'big')}</div><div><b>cPanel / WHM</b><p>Entre a WHM como root › <b>Server Configuration › Terminal</b>, pegue el comando y pulse Enter. No necesita otro programa.</p></div></div>
      <div class="lrow"><div class="lico">${px('plug', 'big')}</div><div><b>Plesk</b><p><b>Tools & Settings › SSH Terminal</b> (o por SSH como root).</p></div></div>
      <div class="lrow"><div class="lico">${px('gear', 'big')}</div><div><b>DirectAdmin, CyberPanel o VPS sin panel</b><p>Por SSH como root (en Windows: PowerShell con <code>ssh root@IP</code>).</p></div></div>
      <div class="lrow"><div class="lico">${px('cloud', 'big')}</div><div><b>Solo nube (Vercel / Supabase)</b><p>Use cualquier VPS pequeño con Linux; al terminar, conecte sus cuentas en el asistente.</p></div></div>
    </section>
    <section><h4>Qué hace</h4><p class="lhelp">Instala Node.js si falta, descarga y verifica el paquete, crea el servicio de solo lectura y le muestra la <b>dirección y el código</b> del asistente web. Todo lo demás se configura desde el navegador.</p></section>
    <p class="lhelp">¿Su cliente solo tiene un hosting compartido (sin root)? Use la pestaña <a href="#" data-itab-go="hosting">Hosting compartido</a>.</p>`;
  $('instBody').querySelector('[data-itab-go]').addEventListener('click', ev => { ev.preventDefault(); openInstall('hosting'); });
}
// sitios vigilados por su dominio: no se instala nada, Atalaya los visita desde afuera
function sitesSection(W, made) {
  const rows = (W.sites || []).map(x => `<li><span class="pill ${x.ok === false ? 'bad' : x.ok ? 'ok' : 'waiting'}">${x.ok === false ? 'no responde' : x.ok ? 'responde' : 'midiendo'}</span>
      <span class="grow"><b>${ie(x.domain)}</b>${x.path && x.path !== '/' ? `<span class="dmuted mono">${ie(x.path)}</span>` : ''}${x.ok === false && x.why ? `<br><span class="dmuted">${ie(x.why)}</span>` : x.note ? `<br><span class="dmuted">sin medir: ${ie(x.note)}</span>` : ''}</span>
      <span class="dmuted">${x.ok && x.ms ? x.ms + ' ms' : ''}</span>
      <button class="btn small ghost" data-site-edit="${ie(x.id)}" data-path="${ie(x.path || '/')}" data-expect="${ie(x.expect || 0)}" data-phrase="${ie(x.phrase || '')}" data-domain="${ie(x.domain)}">Cambiar</button><button class="btn small ghost" data-site-line="${ie(x.siteToken)}">Línea de visitas</button><button class="btn small ghost" data-site-remove="${ie(x.id)}" data-site-name="${ie(x.domain)}">Quitar</button></li>`).join('');
  const line = t => `<script defer src="${W.script}" data-site="${t}"></script>`;
  return `<section class="sitebox"><h4>${px('antenna')} Vigilar un sitio por su dominio (sin instalar nada)</h4>
      <p class="lhelp">Para proyectos en <b>Cloudflare Pages, Netlify, Vercel</b> o cualquier sitio que quiera mirar desde afuera. Atalaya lo visita cada 5 minutos y le avisa <b>una vez al caer y una vez al volver</b>.</p>
      ${made ? `<div class="newagent"><h4>${px('ok')} Listo: ya vigila ${ie(made.domain)}</h4><p class="lhelp">En unos segundos aparece en el mapa, en el distrito «Sitios vigilados». Para ver además sus <b>visitas</b>, pegue esta línea en el sitio antes de &lt;/head&gt; (sin cookies):</p>${copyBox('siteline', line(made.siteToken))}</div>` : ''}
      <form id="siteForm" class="agform"><input name="domain" placeholder="mitienda.com  o  mitienda.com/api/salud" required>
        <select name="expect" aria-label="Qué respuesta es la correcta"><option value="0">Correcto: que abra bien</option><option value="401">Correcto: 401, puerta que exige llave</option><option value="403">Correcto: 403, prohibido</option><option value="204">Correcto: 204, sin contenido</option><option value="404">Correcto: 404, no debe existir</option></select>
        <input name="phrase" placeholder="Frase que debe aparecer (opcional)" maxlength="120"><button class="btn small">Vigilar</button></form>
      <p class="dmuted" id="siteErr"></p>
      <p class="lhelp">La frase detecta un sitio <b>publicado en blanco o roto</b>, que igual responde «todo bien»: escriba unas palabras que siempre estén en la página, como su lema.${W.max != null ? ` Su plan permite ${W.max} sitios.` : ''}</p>
      ${rows ? `<ul class="dlist">${rows}</ul><div id="siteLine"></div>` : ''}</section>`;
}
function bindSites(W, again) {
  $('siteForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const r = await ipost('api/websites/add', { domain: f.get('domain'), expect: Number(f.get('expect')), phrase: f.get('phrase') });
    if (r.error) { $('siteErr').textContent = r.error; return; }
    again(r.site);
  });
  // cambiar un sitio: el formulario se llena con lo que tiene y guarda sobre el mismo (no pierde su historial)
  let editing = null;
  $('instBody').querySelectorAll('[data-site-edit]').forEach(b => b.addEventListener('click', () => {
    const f = $('siteForm'), d = b.dataset;
    editing = d.siteEdit;
    f.domain.value = d.domain + (d.path && d.path !== '/' ? d.path : ''); f.domain.readOnly = false;
    f.expect.value = d.expect; f.phrase.value = d.phrase;
    f.querySelector('button').textContent = 'Guardar cambios';
    $('siteErr').textContent = `Cambiando ${d.domain}: puede cambiar la dirección dentro del sitio, la respuesta esperada y la frase. El dominio no cambia.`;
    f.scrollIntoView({ block: 'center' }); f.phrase.focus();
  }));
  $('siteForm').addEventListener('submit', async ev => {
    if (!editing) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const f = new FormData(ev.target), dom = String(f.get('domain') || ''), cut = dom.replace(/^https?:\/\//, '').indexOf('/');
    const r = await ipost('api/websites/add', { edit: true, id: editing, domain: dom, path: cut > 0 ? dom.replace(/^https?:\/\//, '').slice(cut) : '/', expect: Number(f.get('expect')), phrase: f.get('phrase') });
    if (r.error) { $('siteErr').textContent = r.error; return; }
    again();
  }, true);
  $('instBody').querySelectorAll('[data-site-line]').forEach(b => b.addEventListener('click', () => {
    $('siteLine').innerHTML = `<p class="lhelp">Pegue esta línea en el sitio, antes de &lt;/head&gt;:</p>${copyBox('siteline2', `<script defer src="${W.script}" data-site="${b.dataset.siteLine}"></script>`)}`;
  }));
  $('instBody').querySelectorAll('[data-site-remove]').forEach(b => b.addEventListener('click', async () => {
    if (!(await ask({ title: `Dejar de vigilar ${b.dataset.siteName}`, danger: true, icon: 'antenna', ok: 'Quitar', body: 'Atalaya deja de visitarlo y de avisarle. Las visitas ya contadas se conservan.' }))) return;
    const r = await ipost('api/websites/remove', { id: b.dataset.siteRemove });
    if (r.error) flash(r.error); else again();
  }));
}
// latidos: una direccion secreta que un cron, un respaldo o un programa toca al terminar
function beatsSection(B, made) {
  const ST = { ok: ['ok', 'al día'], late: ['bad', 'atrasado'], failed: ['bad', 'falló'], new: ['waiting', 'sin señal aún'] };
  const every = n => n < 60 ? `${n} min` : n < 1440 ? `${Math.round(n / 6) / 10} h`.replace('.', ',') : n === 1440 ? 'día' : n === 10080 ? 'semana' : `${Math.round(n / 144) / 10} días`.replace('.', ',');
  const rows = (B.beats || []).map(x => `<li><span class="pill ${x.paused ? 'waiting' : (ST[x.state] || ST.new)[0]}">${x.paused ? 'en pausa' : (ST[x.state] || ST.new)[1]}</span>
      <span class="grow"><b>${ie(x.name)}</b><br><span class="dmuted">cada ${every(x.every)}${x.last ? ' · última señal hace ' + (m => m < 120 ? m + ' min' : m < 2880 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' días')(Math.max(1, Math.round((Date.now() - x.last) / 60000))) : ''}</span></span>
      <button class="btn small ghost" data-beat-url="${ie(x.id)}">Dirección nueva</button><button class="btn small ghost" data-beat-pause="${ie(x.id)}" data-on="${x.paused ? '' : '1'}">${x.paused ? 'Reanudar' : 'Pausar'}</button><button class="btn small ghost" data-beat-remove="${ie(x.id)}" data-beat-name="${ie(x.name)}">Quitar</button></li>`).join('');
  const how = m => `<div class="newagent"><h4>${px('ok')} ${m.name ? 'Listo: «' + ie(m.name) + '»' : 'Dirección nueva'}</h4>
      <p class="lhelp">Esta es la dirección secreta del latido. <b>Se muestra solo esta vez</b>: quien la tenga puede dar la señal.</p>${copyBox('beaturl', m.url)}
      <p class="lhelp">Haga que su tarea la toque <b>al terminar bien</b>. Ejemplos:</p>
      ${(m.snippets || []).map(s => `<details${s.id === 'cron' ? ' open' : ''}><summary class="dmuted">${ie(s.title)}</summary>${copyBox('bs-' + s.id, s.code)}</details>`).join('')}</div>`;
  return `<section class="sitebox"><h4>${px('clock')} Latidos: respaldos, tareas cron y programas</h4>
      <p class="lhelp">Para saber que algo <b>sí corrió</b>. Su respaldo, su cron o su programa toca una dirección al terminar; si deja de tocarla, Atalaya le avisa. Sirve para lo que nunca da error cuando falla: simplemente no corre.</p>
      ${made ? how(made) : ''}
      <form id="beatForm" class="agform"><input name="name" placeholder="Nombre (ej. Respaldo de la tienda)" maxlength="60" required>
        <select name="every" aria-label="Cada cuánto debe avisar"><option value="5">Cada 5 minutos</option><option value="15">Cada 15 minutos</option><option value="60">Cada hora</option><option value="360">Cada 6 horas</option><option value="1440" selected>Una vez al día</option><option value="10080">Una vez a la semana</option></select>
        <button class="btn small">Crear latido</button></form>
      <p class="dmuted" id="beatErr"></p>
      ${rows ? `<ul class="dlist">${rows}</ul>` : ''}${B.max != null ? `<p class="lhelp">Su plan permite ${B.max} latidos.</p>` : ''}</section>`;
}
function bindBeats(again) {
  $('beatForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const r = await ipost('api/beats/create', { name: f.get('name'), every: Number(f.get('every')) });
    if (r.error) { $('beatErr').textContent = r.error; return; }
    again(r);
  });
  $('instBody').querySelectorAll('[data-beat-url]').forEach(b => b.addEventListener('click', async () => {
    if (!(await ask({ title: 'Generar una dirección nueva', danger: true, icon: 'clock', ok: 'Generar', body: 'La dirección anterior deja de servir: tendrá que pegar la nueva en su tarea.' }))) return;
    const r = await ipost('api/beats/retoken', { id: b.dataset.beatUrl });
    if (r.error) flash(r.error); else again(r);
  }));
  $('instBody').querySelectorAll('[data-beat-pause]').forEach(b => b.addEventListener('click', async () => {
    const r = await ipost('api/beats/update', { id: b.dataset.beatPause, paused: !!b.dataset.on });
    if (r.error) flash(r.error); else again();
  }));
  $('instBody').querySelectorAll('[data-beat-remove]').forEach(b => b.addEventListener('click', async () => {
    if (!(await ask({ title: `Quitar el latido «${b.dataset.beatName}»`, danger: true, icon: 'clock', ok: 'Quitar', body: 'Atalaya deja de esperarlo y su dirección deja de servir.' }))) return;
    const r = await ipost('api/beats/remove', { id: b.dataset.beatRemove });
    if (r.error) flash(r.error); else again();
  }));
}
async function renderHosting(created, madeSite, madeBeat) {
  const W = await ipost('api/websites/list');
  const B = await ipost('api/beats/list');
  const list = await ipost('api/agents/list');
  const rows = (list.agents || []).map(a => `<li><span class="pill ${a.pending ? 'waiting' : a.stale ? 'bad' : 'ok'}">${a.pending ? 'sin vincular' : a.stale ? 'sin señal' : 'conectado'}</span>
      <span class="grow"><b>${ie(a.label || a.id)}</b>${a.user ? ` <span class="dmuted mono">${ie(a.user)}@${ie(a.host)}</span>` : ''}</span>
      <span class="dmuted">${a.lastPush ? 'hace ' + Math.max(1, Math.round((Date.now() - a.lastPush) / 60000)) + ' min' : ''}</span>
      <button class="btn small ghost" data-recode="${ie(a.id)}">Nuevo código</button><button class="btn small ghost" data-remove="${ie(a.id)}">Quitar</button></li>`).join('');
  // codigo para pegar en el plugin de WordPress (Ajustes › Atalaya): la direccion y el codigo, cada uno con su boton
  const wpCode = c => `<div class="lrow"><div class="lico">${px('wp', 'big')}</div><div><b>En WordPress</b> (wp-admin › Ajustes › <b>Atalaya</b>)<p>Pegue estos dos datos y pulse <b>Conectar</b>:</p>
      <p class="dmuted">Dirección de Atalaya</p>${copyBox('wpurl', c.url || location.origin)}<p class="dmuted">Código</p>${copyBox('wpcode', c.code)}</div></div>`;
  const got = created && created.wp ? `<section class="newagent"><h4>${px('ok')} Listo: conecte el WordPress «${ie(created.id)}»</h4>
      <p class="lhelp">El código vale <b>24 horas</b> y sirve <b>una sola vez</b>.</p>${wpCode(created)}
      <p class="lhelp">En uno o dos minutos aparecerá en el mapa con su versión, plugins y avisos.</p></section>`
    : created ? `<section class="newagent"><h4>${px('ok')} Listo: ahora instale el agente en el hosting «${ie(created.id)}»</h4>
      <p class="lhelp">El código vale <b>24 horas</b> y sirve <b>una sola vez</b>. Elija la forma que permita el hosting:</p>
      <div class="lrow"><div class="lico">${px('terminal', 'big')}</div><div><b>Con Terminal</b> (cPanel › Avanzado › <b>Terminal</b>, o SSH)<p>Pegue y pulse Enter:</p>${copyBox('term', created.command)}</div></div>
      <div class="lrow"><div class="lico">${px('clock', 'big')}</div><div><b>Sin Terminal</b> (cPanel › <b>Trabajos de cron</b>, hPanel › Avanzado › <b>Cron Jobs</b>)
        <p>Cree una tarea <b>cada minuto</b> (<code>* * * * *</code>) con este comando. En su primera ejecución el agente se instala y esa tarea se borra sola.</p>${copyBox('cron', created.cron)}</div></div>
      ${created.code ? `<details><summary class="dmuted">¿Es un WordPress con el plugin ya instalado? Use la dirección y el código</summary>${wpCode(created)}</details>` : ''}
      <p class="lhelp">En uno o dos minutos aparecerá un distrito nuevo en el mapa con sus sitios y visitas.</p></section>` : '';
  $('instBody').innerHTML = `
    <p class="lead"><b>Atalaya Hosting</b>: para cuentas de hosting compartido (cPanel, Hostinger, GoDaddy, Namecheap…) donde no hay root.
      Un agente pequeño corre por cron cada minuto, <b>lee solo esa cuenta</b> y envía los datos a esta pantalla. No se instala nada en <code>public_html</code>, no usa base de datos y no abre puertos.</p>
    ${got}
    ${W.error ? '' : sitesSection(W, madeSite)}
    ${B.error ? '' : beatsSection(B, madeBeat)}
    <section class="wpbox"><h4>${px('wp')} Conectar un sitio WordPress (sin terminal ni cron)</h4>
      <p class="lhelp">Descargue el plugin <b>ya configurado</b> para este Atalaya, súbalo en <b>wp-admin › Plugins › Añadir nuevo › Subir plugin</b> y actívelo: se conecta solo.
        Además de lo del hosting, ve lo que solo se sabe desde adentro: versión de WordPress, plugins y temas por actualizar, PHP sin soporte, errores visibles, usuario «admin» y más.</p>
      <form id="wpForm" class="agform"><input name="id" placeholder="nombre-corto (ej. blog-ana)" pattern="[a-z0-9][a-z0-9-]{0,30}" required>
        <input name="label" placeholder="Descripción (ej. Blog de Ana)"><button class="btn small" value="zip">Descargar plugin</button><button class="btn small ghost" value="code">Ya lo tengo instalado: ver código</button></form>
      <p class="dmuted" id="wpErr"></p>
      <p class="lhelp">El .zip trae un código de un solo uso que vence en 24 horas. Si ya instaló el plugin (el <a href="install/atalaya-wp.zip">genérico</a> o uno cuyo código venció), escriba un nombre y pulse <b>Ya lo tengo instalado: ver código</b>: le da la dirección y el código para pegar en wp-admin › Ajustes › Atalaya.</p></section>
    <section><h4>Conectar un hosting</h4>
      <form id="agForm" class="agform"><input name="id" placeholder="nombre-corto (ej. cliente-godaddy)" pattern="[a-z0-9][a-z0-9-]{0,30}" required>
        <input name="label" placeholder="Descripción (ej. Tienda de Ana · GoDaddy)"><button class="btn small">Generar código</button></form>
      <p class="dmuted" id="agErr"></p></section>
    ${rows ? `<section><h4>Hostings conectados</h4><ul class="dlist">${rows}</ul></section>` : ''}
    <section class="nocloud-sec"><h4>¿Su cliente quiere su propia pantalla?</h4><p class="lhelp">Si el hosting permite apps Node (cPanel › <b>Setup Node.js App</b>), puede instalarle <b>Atalaya Hosting completo</b> en su cuenta:
      en su Terminal de cPanel pegue el comando (cambie el dominio por un subdominio suyo). Queda con su propio acceso, asistente y agente.</p>
      <div class="row"><button class="btn small" id="hcmd">Generar comando de instalación</button></div><div id="hcmdOut"></div></section>
    <section><h4>Qué verá de cada hosting</h4><p class="lhelp">Sus dominios y subdominios como edificios, las visitas en vivo con país, errores de PHP, cuota de disco, bases de datos, certificados SSL por vencer,
      buzones de correo, uso de recursos y tareas cron (con los secretos tapados). Con <b>Analizar ahora</b> puede pedirle qué carpetas ocupan más espacio.
      Necesita <code>curl</code> y cron, que traen todos los hostings; con cPanel se aprovecha además <code>uapi</code>.</p></section>`;
  if (!W.error) bindSites(W, made => renderHosting(null, made));
  if (!B.error) bindBeats(made => renderHosting(null, null, made));
  $('hcmd').addEventListener('click', async () => {
    const r = await ipost('api/setup/install-command');
    $('hcmdOut').innerHTML = r.hostingCommand ? `${copyBox('hosting', r.hostingCommand)}<p class="lhelp">Vale 24 horas y para 5 instalaciones. Sin Node en el hosting, conéctelo arriba como hosting de esta pantalla.</p>` : `<p class="dmuted">${ie(r.error || 'No se pudo generar')}</p>`;
  });
  $('wpForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    if (ev.submitter && ev.submitter.value === 'code') {
      const c = await ipost('api/agents/create', { id: f.get('id'), label: f.get('label') || f.get('id') });
      if (c.error && /existe/i.test(c.error)) { const rc = await ipost('api/agents/recode', { id: f.get('id') }); if (!rc.error) return renderHosting({ ...rc, wp: true }); }
      if (c.error) { $('wpErr').textContent = c.error; return; }
      return renderHosting({ ...c, wp: true });
    }
    const r = await fetch('api/agents/wp-plugin', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: JSON.stringify({ id: f.get('id'), label: f.get('label') || f.get('id') }) }).catch(() => null);
    if (!r || !r.ok) { const j = r ? await r.json().catch(() => ({})) : {}; $('wpErr').textContent = j.error || 'No se pudo generar el plugin'; return; }
    const url = URL.createObjectURL(await r.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `atalaya-agent-${f.get('id')}.zip` });
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 5000);
    $('wpErr').innerHTML = px('ok') + ' Descargado. Súbalo en wp-admin › Plugins › Añadir nuevo › Subir plugin y actívelo.';
    setTimeout(() => renderHosting(), 1500);
  });
  $('agForm').addEventListener('submit', async ev => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const r = await ipost('api/agents/create', { id: f.get('id'), label: f.get('label') || f.get('id') });
    if (r.error) { $('agErr').textContent = r.error; return; }
    renderHosting(r);
  });
  $('instBody').querySelectorAll('[data-recode]').forEach(b => b.addEventListener('click', async () => {
    const r = await ipost('api/agents/recode', { id: b.dataset.recode });
    if (r.error) flash(r.error); else renderHosting(r);
  }));
  $('instBody').querySelectorAll('[data-remove]').forEach(b => b.addEventListener('click', async () => {
    if (!(await ask({ title: `Quitar el hosting «${b.dataset.remove}»`, danger: true, icon: 'house', ok: 'Quitar', body: 'Dejará de aceptar sus envíos. El agente seguirá en el hosting hasta que lo desinstale.' }))) return;
    const r = await ipost('api/agents/remove', { id: b.dataset.remove });
    if (r.error) flash(r.error); else renderHosting();
  }));
}

// ---------------------------------------------------------------- temas
const themeDlg = $('themeDlg');
themeDlg.querySelector('.tclose').addEventListener('click', () => themeDlg.close());
async function themeList() { const r = await fetch('api/themes').then(x => x.ok ? x.json() : null).catch(() => null); return r ? r.themes : []; }
async function cycleTheme() {
  const list = await themeList();
  if (list.length < 2) return;
  const i = list.findIndex(t => t.id === document.body.dataset.theme);
  const next = list[(i + 1) % list.length];
  tm.setLocal(next.id); await switchTheme(next.id);
  flash(`Tema: ${next.name} (solo en esta pantalla)`);
}
async function openThemes() {
  const list = await themeList();
  const cur = document.body.dataset.theme, local = tm.localChoice(), owner = hello && hello.role === 'owner';
  const SW = ['ok', 'warn', 'crit', 'friendly', 'accent', 'bg', 'ink'];
  $('themeBody').innerHTML = `<p class="lead">Cada tema cambia el mundo <b>y</b> el HUD. Puede elegir uno solo para esta pantalla o, como dueño, el de todas.</p>
    <div class="tgrid">${list.map(t => `<article class="tcard${t.id === cur ? ' on' : ''}">
      ${t.preview ? `<img class="tprev" src="${ie(t.preview)}" alt="" loading="lazy">` : ''}
      <div class="tsw">${SW.filter(k => t.palette[k]).map(k => `<i style="background:${ie(t.palette[k])}" title="${k}"></i>`).join('')}</div>
      <h4>${ie(t.name)}${t.id === cur ? ' <span class="pill ok">en uso</span>' : ''}${t.id === tm.serverDefault ? ' <span class="pill">de todas</span>' : ''}</h4>
      <p>${ie(t.description)}</p>
      <p class="dmuted">${ie(t.author)}${t.version ? ' · v' + ie(t.version) : ''}${t.license ? ' · ' + ie(t.license) : ''}</p>
      <div class="row">${t.id !== cur ? `<button class="btn small" data-tlocal="${ie(t.id)}">Usar en esta pantalla</button>` : ''}
        ${owner && t.id !== tm.serverDefault ? `<button class="btn small ghost" data-tall="${ie(t.id)}">Usar en todas</button>` : ''}</div></article>`).join('')}</div>
    ${local ? `<p class="lhelp">Esta pantalla usa un tema propio. <a href="#" id="tforget">Volver al de todas las pantallas</a></p>` : ''}
    <p class="lhelp">Tecla <b>T</b>: pasar al tema siguiente en esta pantalla. También sirve la dirección con <code>?theme=ops</code>.</p>`;
  $('themeBody').querySelectorAll('[data-tlocal]').forEach(b => b.addEventListener('click', async () => { tm.setLocal(b.dataset.tlocal); await switchTheme(b.dataset.tlocal); openThemes(); }));
  $('themeBody').querySelectorAll('[data-tall]').forEach(b => b.addEventListener('click', async () => {
    try { await post('api/theme', { id: b.dataset.tall }); tm.serverDefault = b.dataset.tall; tm.setLocal(null); await switchTheme(b.dataset.tall); flash('Tema cambiado en todas las pantallas'); openThemes(); } catch (e) { flash(e.message); }
  }));
  $('tforget')?.addEventListener('click', async ev => { ev.preventDefault(); tm.setLocal(null); await switchTheme(tm.serverDefault); openThemes(); });
  if (!themeDlg.open) themeDlg.showModal();
}

// ---------------------------------------------------------------- resumen de proyectos (panel derecho)
// auto=1: es la pantalla la que pide, no una persona que abre la ficha (el seguimiento de la nube no lo anota)
async function refreshProjects() {
  const r = await fetch('api/detail?kind=projects&id=all&auto=1').then(x => x.ok ? x.json() : null).catch(() => null);
  if (!r || !r.projects) return;
  const n = r.projects.length, bad = r.projects.filter(x => x.bad || x.down).length, warn = r.projects.filter(x => !x.bad && !x.down && x.warn).length;
  $('projSub').textContent = n ? `${n} · promedio ${r.avg}` : '';
  if (!n) return;
  const worst = r.projects.slice(0, 3);
  $('proj').innerHTML = `<div class="projsum"><b class="${bad ? 'bad' : warn ? 'warn' : 'ok'}">${bad ? `${px('dotR')} ${bad} con problemas` : warn ? `${px('dotY')} ${warn} para revisar` : `${px('dotG')} todo en orden`}</b></div>
    ${worst.map(x => `<div class="projrow"><span class="score s${x.score >= 85 ? 'ok' : x.score >= 60 ? 'warn' : 'bad'}">${x.score}</span><span class="grow">${ie(x.name)}</span></div>`).join('')}`;
}
refreshProjects(); setInterval(refreshProjects, 60000);

// ---------------------------------------------------------------- usuarios (solo duenos con el modo privado activo)
const usersDlg = $('usersDlg');
usersDlg.querySelector('.uclose').addEventListener('click', () => usersDlg.close());
let uMode = { action: 'add' }, uPin = null, uPin2 = null;
function needPrivate(what) {
  if (hello?.priv) return false;
  flash(`Active el modo privado para ${what}`);
  openPrivate();
  return true;
}
// Atalaya para su computadora: actualizaciones de la aplicacion
async function openUpdate(r) {
  r = r || await ipost('api/update');
  if (r.error && !r.running) return flash(r.error);
  const when = t => t ? new Date(t).toLocaleString('es-VE', { hour12: false, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'todavía no';
  const head = r.ready ? `<b>La versión ${ie(r.ready)} ya está descargada y verificada.</b>${r.notes ? ' ' + ie(r.notes) : ''}<br>Se usa la próxima vez que abra Atalaya. Para usarla ya, reinicie: tarda unos segundos y esta página se recarga sola.`
    : r.needsExe ? `<b>La versión ${ie(r.needsExe)} necesita el ejecutable nuevo.</b> Esta vez cambió también el programa que abre Atalaya: descargue el archivo nuevo una vez; las siguientes se actualizan solas.`
    : `Está usando la versión <b>${ie(r.running)}</b>${r.latest && r.latest === r.running ? ', la más nueva' : ''}.`;
  setTimeout(() => { const c = document.querySelector('.askdlg #updAuto'); if (c) c.addEventListener('change', () => ipost('api/update/mode', { mode: c.checked ? 'auto' : 'off' })); }, 50);
  const ok = await ask({ title: 'Actualizaciones', icon: 'rocket', ok: r.ready ? 'Reiniciar ahora' : 'Buscar ahora', cancel: 'Cerrar',
    body: `${head}<br><br>Última búsqueda: ${when(r.checked)}.${r.embedded && r.embedded !== r.running ? ` El ejecutable trae la ${ie(r.embedded)}.` : ''}${r.error ? `<br>${ie(r.error)}` : ''}
      <br><br><input type="checkbox" id="updAuto" ${r.mode === 'off' ? '' : 'checked'} style="width:auto;margin-right:.4rem"><b>Actualizar Atalaya automáticamente</b>
      <br>Baja la versión nueva, verifica su firma y la usa en el próximo arranque. Sus datos no se tocan. Si una versión nueva no llega a abrir, vuelve sola a la anterior.` });
  if (!ok) return;
  if (r.ready) { await ipost('api/update/restart'); flash('Reiniciando Atalaya con la versión nueva…'); return; }
  flash('Buscando actualizaciones…');
  openUpdate(await ipost('api/update/check'));
}
async function openUsers() {
  if (needPrivate('gestionar usuarios')) return;
  const r = await ipost('api/users/list');
  if (r.error) { flash(r.error); return; }
  uMode = { action: 'add' };
  renderUsers(r.users);
  if (!usersDlg.open) usersDlg.showModal();
}
function renderUsers(list) {
  const opt = (v, cur, l) => `<option value="${v}"${v === cur ? ' selected' : ''}>${l}</option>`;
  $('usersBody').innerHTML = `
    <p class="lead"><b>Dueño</b>: activa el modo privado, configura y gestiona usuarios. <b>Solo ver</b>: para el TV o para quien mira la pantalla sin ver nombres, dominios ni IPs.</p>
    <ul class="dlist ulist">${list.map(u => `<li>
      <span class="grow"><b>${ie(u.name)}</b>${u.me ? ' <span class="pill ok">usted</span>' : ''}<small>${u.sessions ? `${u.sessions} sesión(es) abierta(s)` : 'sin sesiones abiertas'}</small></span>
      <select data-urole="${ie(u.name)}" aria-label="Rol de ${ie(u.name)}"${u.me ? ' disabled' : ''}>${opt('owner', u.role, 'Dueño')}${opt('viewer', u.role, 'Solo ver')}</select>
      <button class="btn small ghost" type="button" data-upin="${ie(u.name)}">Cambiar PIN</button>
      ${u.me ? '<span class="uspacer"></span>' : `<button class="btn small ghost" type="button" data-udel="${ie(u.name)}">Borrar</button>`}
    </li>`).join('')}</ul>
    <form id="uform" class="uform" autocomplete="off">
      <h4>${uMode.action === 'pin' ? `Nuevo PIN para ${ie(uMode.name)}` : 'Agregar usuario'}</h4>
      ${uMode.action === 'pin' ? `<p class="lhelp">${uMode.name === hello.user ? 'Su sesión actual sigue abierta; las demás se cierran.' : 'Sus sesiones abiertas se cierran al instante.'}</p>` : `
      <div class="urow"><label>Nombre<input id="uname" type="text" maxlength="32" autocapitalize="none" spellcheck="false" placeholder="ej. tv-oficina" required></label>
        <label>Rol<select id="urole">${opt('viewer', 'viewer', 'Solo ver')}${opt('owner', '', 'Dueño')}</select></label></div>`}
      <div class="upins"><div><label id="upl">PIN de 6 dígitos</label><div class="pin-row" id="upin" role="group" aria-labelledby="upl"></div></div>
        <div><label id="upl2">Repita el PIN</label><div class="pin-row" id="upin2" role="group" aria-labelledby="upl2"></div></div></div>
      <p class="error" id="uerr" role="alert"></p>
      <div class="actions${uMode.action === 'pin' ? '' : ' one'}">${uMode.action === 'pin' ? '<button type="button" class="btn" id="ucancel">Cancelar</button>' : ''}
        <button class="btn primary" id="ugo">${uMode.action === 'pin' ? 'Guardar PIN' : 'Agregar usuario'}</button></div>
    </form>`;
  uPin = buildPin($('upin'), () => uPin2.focus());
  uPin2 = buildPin($('upin2'), () => $('ugo').focus());
  if (uMode.action === 'pin') uPin.focus();
}
async function uCall(action, body) {
  const r = await ipost('api/users/' + action, body);
  if (r.error) { const e = $('uerr'); if (e) e.textContent = r.error; else flash(r.error); return null; }
  return r;
}
$('usersBody').addEventListener('change', async e => {
  const s = e.target.closest('[data-urole]'); if (!s) return;
  const r = await uCall('role', { name: s.dataset.urole, role: s.value });
  if (r) { renderUsers(r.users); flash(`${s.dataset.urole} ahora es ${s.value === 'owner' ? 'dueño' : 'solo ver'}`); } else openUsers();
});
$('usersBody').addEventListener('click', async e => {
  const pinB = e.target.closest('[data-upin]'), delB = e.target.closest('[data-udel]');
  if (e.target.id === 'ucancel') { uMode = { action: 'add' }; return openUsers(); }
  if (pinB) { uMode = { action: 'pin', name: pinB.dataset.upin }; const r = await ipost('api/users/list'); if (!r.error) renderUsers(r.users); return; }
  if (delB) {
    if (!(await ask({ title: `Borrar a ${delB.dataset.udel}`, danger: true, icon: 'lock', ok: 'Borrar usuario', body: 'Sus pantallas se cierran al instante y ya no podrá entrar.' }))) return;
    const r = await uCall('del', { name: delB.dataset.udel });
    if (r) { renderUsers(r.users); flash(`${delB.dataset.udel} fue borrado`); }
  }
});
$('usersBody').addEventListener('submit', async e => {
  e.preventDefault();
  const err = $('uerr'); err.textContent = '';
  if (uPin.value().length !== 6) { err.textContent = 'Complete los 6 dígitos del PIN'; return uPin.focus(); }
  if (uPin.value() !== uPin2.value()) { err.textContent = 'Los PIN no coinciden'; uPin2.clear(); return uPin2.focus(); }
  const body = uMode.action === 'pin' ? { name: uMode.name, pin: uPin.value() } : { name: $('uname').value.trim(), role: $('urole').value, pin: uPin.value() };
  const r = await uCall(uMode.action, body);
  if (!r) { uPin.clear(); uPin2.clear(); return; }
  flash(uMode.action === 'pin' ? `PIN de ${body.name} cambiado` : `Usuario ${body.name} agregado`);
  uMode = { action: 'add' };
  renderUsers(r.users);
});

// alertas por Telegram: conectar el bot (token de @BotFather), enganchar el chat con /start <codigo> y elegir
// que avisa, con horario de silencio y resumen matutino. Solo un dueno con el modo privado activo.
const alertsDlg = $('alertsDlg');
alertsDlg.querySelector('.aclose').addEventListener('click', () => alertsDlg.close());
let alertsPoll = null;
async function openAlerts() {
  if (needPrivate('configurar las alertas')) return;
  const r = await ipost('api/alerts/state');
  if (r.error) { flash(r.error); return; }
  renderAlerts(r);
  if (!alertsDlg.open) alertsDlg.showModal();
}
function renderAlerts(st, code) {
  const b = $('alertsBody'); clearInterval(alertsPoll);
  // Telegram
  let tg;
  if (!st.connected) tg = `<ol class="asteps"><li>En Telegram, abra <b>@BotFather</b> y escríbale <code>/newbot</code>. Elija un nombre (por ejemplo «Atalaya de mi servidor»).</li>
      <li>Le da un <b>token</b> (<code>123456789:AAE...</code>). Péguelo aquí:</li></ol>
    <form id="atok" class="uform" data-form="tg"><label>Token del bot<input id="atokv" type="text" autocomplete="off" spellcheck="false" placeholder="123456789:AAE..."></label>
    <div class="actions one"><button class="btn primary">Conectar el bot</button></div></form>`;
  else {
    const chats = st.chats.map(c => `<li><span class="grow"><b>${ie(c.name)}</b></span><button class="btn small ghost" type="button" data-aunlink="${ie(c.id)}">Quitar</button></li>`).join('');
    const linking = code ? `<div class="alink"><p>Abra su bot <b>@${ie(code.bot)}</b> y envíele:</p><div class="copy"><pre class="cmd">/start ${ie(code.code)}</pre></div>
        <p class="dmuted">Esperando su mensaje… (el código vale 15 minutos)</p><p class="row"><a class="btn small" href="https://t.me/${encodeURIComponent(code.bot)}?start=${encodeURIComponent(code.code)}" target="_blank" rel="noopener">Abrir el bot en Telegram</a></p></div>` : '';
    tg = `<p>Bot <b>@${ie(st.bot || '')}</b>. ${chats ? '' : 'Todavía ningún chat: enganche el suyo.'}</p>${chats ? `<ul class="dlist">${chats}</ul>` : ''}
      ${linking || '<p class="row"><button class="btn small" type="button" id="alinkb">Enganchar un chat</button><button class="btn small ghost" type="button" id="adisc">Desconectar</button></p>'}`;
  }
  // Correo
  const E = st.email, P = st.presets;
  const presetOpts = cur => Object.entries(P).map(([k, v]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${ie(v.label)}</option>`).join('');
  const mailForm = x => `<form class="uform" data-form="mail">
      <div class="urow"><label>Proveedor<select id="mprov">${presetOpts(x.preset || 'gmail')}</select></label><label>Servidor<input id="mhost" value="${ie(x.host || P.gmail.host)}"></label><label>Puerto<input id="mport" type="number" value="${ie(x.port || 465)}"></label></div>
      <div class="urow"><label>Cifrado<select id="msec">${[['ssl', 'SSL (465)'], ['starttls', 'STARTTLS (587)'], ['none', 'Ninguno']].map(([v, l]) => `<option value="${v}"${v === (x.secure || 'ssl') ? ' selected' : ''}>${l}</option>`).join('')}</select></label><label>Usuario<input id="muser" autocomplete="off" value="${ie(x.user || '')}" placeholder="usted@gmail.com"></label><label>Contraseña<input id="mpass" type="password" autocomplete="new-password" placeholder="${x.hasPass ? '(guardada)' : 'contraseña de aplicación'}"></label></div>
      <p class="hint" id="mhelp">${ie(P[x.preset || 'gmail'].help)} ${P[x.preset || 'gmail'].helpUrl ? `<a href="${P[x.preset || 'gmail'].helpUrl}" target="_blank" rel="noopener">Crearla</a>` : ''}</p>
      <div class="urow"><label>Remitente<input id="mfrom" value="${ie(x.from || '')}" placeholder="(el mismo usuario)"></label><label style="grid-column: span 2">Enviar a (uno o varios, separados por coma)<input id="mto" value="${ie((x.to || []).join(', '))}" placeholder="usted@ejemplo.com, socio@ejemplo.com"></label></div>
      <div class="actions one"><button class="btn primary">Guardar y enviar una prueba</button></div></form>`;
  const mail = E && !code?.editMail ? `<p>Desde <b>${ie(E.from)}</b> por ${ie(E.host)} a <b>${ie((E.to || []).join(', '))}</b>.</p><p class="row"><button class="btn small" type="button" id="medit">Cambiar</button><button class="btn small ghost" type="button" id="moff">Quitar el correo</button></p>`
    : mailForm(E || {});
  const C = st.conf, cats = Object.entries(st.cats).map(([k, l]) => `<label class="check"><input type="checkbox" data-acat="${k}" ${C.cats[k] ? 'checked' : ''}><span>${ie(l)}</span></label>`).join('');
  const hours = sel => Array.from({ length: 24 }, (_, h) => `<option value="${h}"${h === sel ? ' selected' : ''}>${String(h).padStart(2, '0')}:00</option>`).join('');
  const any = (st.connected && st.chats.length) || E;
  b.innerHTML = `<p class="lead">Reciba lo importante aunque nadie mire la pantalla: puertas traseras, caídas, el servidor al límite. Por Telegram, por correo o por los dos.</p>
    <section class="achan"><h4>${px('phone')} Telegram</h4>${tg}</section>
    <section class="achan"><h4>${px('mail')} Correo</h4>${mail}</section>
    <p class="error" id="aerr"></p>
    ${any ? `<section><h4>Qué me avisa</h4><div class="acats">${cats}</div></section>
    <section><h4>Horario</h4><div class="urow"><label>Silencio desde<select id="aqf">${hours(C.quiet ? C.quiet.from : 23)}</select></label><label>hasta<select id="aqt">${hours(C.quiet ? C.quiet.to : 7)}</select></label><label>Resumen a las<select id="ash">${hours(C.summaryHour)}</select></label></div>
      <p class="hint">En el horario de silencio solo llega lo grave (seguridad, caídas y saturación). El mismo aviso no se repite en 30 minutos. Los mensajes no llevan IPs ni rutas: el sitio, el motivo y un enlace a su ficha.</p></section>
    <div class="actions"><button class="btn" type="button" id="atest">Enviar prueba</button><button class="btn primary" type="button" id="asave">Guardar</button></div>
    <p class="row"><button class="btn small ghost" type="button" id="asum">Enviar el resumen ahora</button></p>` : ''}`;
  const prov = $('mprov');
  if (prov) prov.addEventListener('change', () => { const x = P[prov.value]; $('mhost').value = x.host; $('mport').value = x.port; $('msec').value = x.secure; $('mhelp').innerHTML = `${ie(x.help)} ${x.helpUrl ? `<a href="${x.helpUrl}" target="_blank" rel="noopener">Crearla</a>` : ''}`; });
  if (code && code.code) alertsPoll = setInterval(async () => {
    const r = await ipost('api/alerts/check');
    if (r.error) { clearInterval(alertsPoll); const e = $('aerr'); if (e) e.textContent = r.error; return; }
    if (r.linked) { clearInterval(alertsPoll); flash(`Chat enganchado: ${r.chat.name}`); openAlerts(); }
  }, 3000);
}
$('alertsBody').addEventListener('submit', async e => {
  e.preventDefault();
  const form = e.target.dataset.form, btn = e.target.querySelector('button');
  if (form === 'mail') {
    btn.disabled = true; btn.textContent = 'Probando el envío…';
    const r = await ipost('api/alerts/email', { preset: $('mprov').value, host: $('mhost').value, port: +$('mport').value, secure: $('msec').value, user: $('muser').value, pass: $('mpass').value, from: $('mfrom').value || $('muser').value, to: $('mto').value });
    if (r.error) { $('aerr').textContent = r.error; btn.disabled = false; btn.textContent = 'Guardar y enviar una prueba'; return; }
    flash('Correo configurado: revise su bandeja'); return openAlerts();
  }
  const r = await ipost('api/alerts/token', { token: $('atokv').value });
  if (r.error) { $('aerr').textContent = r.error; return; }
  const st = await ipost('api/alerts/state'); renderAlerts(st, r);
});
$('alertsBody').addEventListener('click', async e => {
  const id = e.target.id, un = e.target.closest('[data-aunlink]');
  const err = m => { const x = $('aerr'); if (x) x.textContent = m || ''; };
  if (id === 'alinkb') { const r = await ipost('api/alerts/link'); if (r.error) return err(r.error); renderAlerts(await ipost('api/alerts/state'), r); }
  if (un) { if (!(await ask({ title: 'Quitar este chat', icon: 'warn', ok: 'Quitar', body: 'Deja de recibir las alertas de Atalaya.' }))) return; await ipost('api/alerts/unlink', { chat: un.dataset.aunlink }); openAlerts(); }
  if (id === 'asave' || id === 'atest') {
    const cats = {}; for (const c of $('alertsBody').querySelectorAll('[data-acat]')) cats[c.dataset.acat] = c.checked;
    const r = await ipost('api/alerts/conf', { cats, quiet: { from: +$('aqf').value, to: +$('aqt').value }, summaryHour: +$('ash').value });
    if (r.error) return err(r.error);
    if (id === 'atest') { const t = await ipost('api/alerts/test'); if (t.error) return err(t.error); flash('Prueba enviada: revise Telegram'); } else flash('Alertas guardadas');
  }
  if (id === 'medit') { const st = await ipost('api/alerts/state'); return renderAlerts(st, { editMail: true }); }
  if (id === 'moff') { if (!(await ask({ title: 'Quitar el correo', icon: 'warn', ok: 'Quitar', body: 'Atalaya deja de enviar alertas por correo y olvida la contraseña.' }))) return; await ipost('api/alerts/emailoff'); return openAlerts(); }
  if (id === 'asum') { const r = await ipost('api/alerts/summary'); if (r.error) return err(r.error); flash('Resumen enviado'); }
  if (id === 'adisc') { if (!(await ask({ title: 'Desconectar el bot', danger: true, ok: 'Desconectar', body: 'Atalaya deja de enviar alertas y olvida el token y los chats.' }))) return; await ipost('api/alerts/disconnect'); openAlerts(); }
});

// panel maestro de la nube (solo si en este servidor corre Atalaya Cloud): pase firmado de un solo uso
async function openMaestro() {
  if (needPrivate('abrir el panel maestro')) return;
  const w = window.open('', '_blank');
  const r = await ipost('api/maestro');
  if (r.error || !r.url) { if (w) w.close(); flash(r.error || 'No se pudo abrir el panel'); return; }
  if (w) { w.opener = null; w.location.href = r.url; } else location.href = r.url;
}

// ---------------------------------------------------------------- novedades (CHANGELOG)
const newsDlg = $('news');
const md = t => String(t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
const GROUP_ICON = { 'Añadido': px('star'), 'Corregido': px('workshop'), 'Cambiado': px('refresh'), 'Seguridad': px('lock'), 'Requiere acción': px('warn'), 'Eliminado': px('trash') };
async function openNews(since) {
  const r = await fetch('api/changelog').then(x => x.json()).catch(() => null);
  if (!r) return;
  const isNew = v => since && v.localeCompare(since, undefined, { numeric: true }) > 0;
  $('newsBody').innerHTML = r.releases.map((rel, i) => `<details class="rel${isNew(rel.version) ? ' fresh' : ''}" ${i === 0 || isNew(rel.version) ? 'open' : ''}>
    <summary><b>v${rel.version}</b><span class="dmuted">${rel.date}</span>${rel.version === r.version ? '<span class="pill ok">instalada</span>' : ''}${isNew(rel.version) ? '<span class="pill waiting">nueva</span>' : ''}</summary>
    ${rel.groups.map(g => `<h4>${GROUP_ICON[g.title] || '•'} ${md(g.title)}</h4><ul>${g.items.map(it => `<li>${md(it)}</li>`).join('')}</ul>`).join('')}
  </details>`).join('');
  if (!newsDlg.open) { newsDlg.showModal(); animate(newsDlg, { opacity: [0, 1], translateY: [16, 0], duration: 300, ease: 'outQuad' }); }
}
$('verChip').addEventListener('click', () => openNews(null));
newsDlg.querySelector('.nclose').addEventListener('click', () => newsDlg.close());
newsDlg.addEventListener('click', e => { if (e.target === newsDlg) newsDlg.close(); });

// ---------------------------------------------------------------- reloj
function clock() {
  const d = new Date();
  $('time').textContent = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false });
  $('date').textContent = d.toLocaleDateString('es-VE', { weekday: 'long', day: 'numeric', month: 'short' });
}
setInterval(clock, 1000); clock();

// ---------------------------------------------------------------- stream
function connect() {
  const es = new EventSource('api/stream');
  es.addEventListener('hello', e => {
    $('conn').hidden = true;
    const h = JSON.parse(e.data);
    // si el servidor se actualizo, esta pantalla (que puede llevar dias abierta) se recarga sola
    if (loadedVersion && h.version && h.version !== loadedVersion) {
      flash(`Atalaya se actualizó a la versión ${h.version}. Recargando…`);
      setTimeout(() => location.reload(), 2500);
      return;
    }
    loadedVersion = loadedVersion || h.version;
    applyMode(h);
    if (!chartsReady) { initCharts(h.history); chartsReady = true; }
  });
  // tema por defecto cambiado por un dueno: lo toman las pantallas que no eligieron otro
  es.addEventListener('theme', e => {
    const { id } = JSON.parse(e.data);
    tm.serverDefault = id;
    if (!tm.localChoice() && !new URLSearchParams(location.search).get('theme') && document.body.dataset.theme !== id) switchTheme(id);
  });
  es.addEventListener('mode', e => {
    const h = JSON.parse(e.data);
    const changed = !hello || h.priv !== hello.priv;
    applyMode(h);
    if (changed) { drawer.close(); clearTicker(); if (!h.priv) clearFavicons(); } // la cinta puede tener texto privado
    if (changed) flash(h.priv ? 'Modo privado activado' : 'Modo público: los detalles quedaron ocultos');
  });
  es.addEventListener('state', e => {
    state = JSON.parse(e.data);
    // enlace directo (?go=site:abc, desde una alerta de Telegram): abre esa ficha con el primer estado
    const go = new URLSearchParams(location.search).get('go');
    if (go && !window.__went && /^[a-z]+:[\w:-]+$/.test(go)) { window.__went = true; const [k, ...r] = go.split(':'); setTimeout(() => openDetail(k, r.join(':')), 600); history.replaceState(null, '', location.pathname); }
    if (window.atalaya) window.atalaya.state = state;
    tourAlEntrar();
    withFavicons(state.apps); withFavicons(state.sites);
    renderState(state);
    tm.update(state);
    comm.setWatch([...state.sites.filter(x => x.watch).map(x => ({ kind: 'site', id: x.id, ...x.watch })), ...state.apps.filter(x => x.watch).map(x => ({ kind: 'app', id: x.id, ...x.watch })),
      ...state.sites.filter(x => x.php && !x.watch && !x.phpbad).map(x => ({ kind: 'site', id: x.id, reason: 'php', max: x.php.max, n: x.php.n })),
      ...state.sites.filter(x => x.phpbad && !x.watch).map(x => ({ kind: 'site', id: x.id, reason: 'phpbad', n: x.phpbad.n }))]);
    comm.setSaturation(state.saturation);
  });
  es.addEventListener('ev', e => {
    const ev = JSON.parse(e.data);
    comm.onEvent(ev);
    director.consider(ev);
    if (world) world.onEvent(ev, state?.priv);
    if (state) tickerEvent(ev, state.accounts, state.priv);
  });
  es.onerror = async () => {
    $('conn').hidden = false;
    // si la sesion caduco, al login
    const r = await fetch('api/me').catch(() => null);
    if (r && r.status === 401) { es.close(); location.href = 'login'; }
  };
}

// ---------------------------------------------------------------- telefonos y tablets
// Con pantalla chica el HUD se reacomoda (en CSS, body.compact): el mundo ocupa el centro y los paneles
// (agentes, metricas y novedades) se abren como hojas desde la barra de pestanas de abajo.
const compactMQ = matchMedia('(max-width: 1100px), (max-height: 560px)');
function openSheet(id) {
  document.body.dataset.sheet = id || '';
  document.querySelectorAll('#tabs [data-sheet]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.sheet === (id || ''))));
  if (id === 'right') rethemeCharts(); // las graficas se miden al abrirse la hoja
}
function applyCompact() {
  document.body.classList.toggle('compact', compactMQ.matches);
  if (!compactMQ.matches) openSheet('');
  if (world) requestAnimationFrame(() => world.setInsets(insets()));
}
compactMQ.addEventListener('change', applyCompact);
$('tabs').addEventListener('click', e => { const b = e.target.closest('[data-sheet]'); if (b) openSheet(document.body.dataset.sheet === b.dataset.sheet ? '' : b.dataset.sheet); });
$('sheetBack').addEventListener('click', () => openSheet(''));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.dataset.sheet) openSheet(''); });
// al tocar algo dentro de una hoja se abre su detalle: la hoja se cierra para dejarle lugar
document.addEventListener('click', e => { if (document.body.classList.contains('compact') && document.body.dataset.sheet && e.target.closest('#left [data-go], #right [data-go], #ticker [data-go], #left .agent, #tall')) setTimeout(() => openSheet(''), 0); }, true);
// contadores en las pestanas
const mirror = (from, to) => new MutationObserver(() => { $(to).textContent = $(from).textContent === '0' ? '' : $(from).textContent; }).observe($(from), { childList: true, characterData: true, subtree: true });
mirror('agentCount', 'tabAgents'); mirror('tcount', 'tabEvents');
applyCompact();

(async () => {
  initKpis();
  await document.fonts.ready.catch(() => { });
  const th = await fetch('api/themes').then(r => r.ok ? r.json() : null).catch(() => null);
  if (th) tm.serverDefault = th.current;
  await switchTheme(tm.preferred());
  addEventListener('resize', () => world && world.setInsets(insets()));
  animate(['#top', '#left', '#right', '#ticker'], { opacity: [0, 1], duration: 800, ease: 'outQuad' });
  connect();
})();
