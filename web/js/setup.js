// Asistente de configuracion: primera instalacion (con codigo de un solo uso) o reconfiguracion de un dueno
import { animate } from '../vendor/anime.esm.min.js';
import { px } from './pixicons.js';

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
async function api(path, body) {
  const r = await fetch(path, body === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Error ' + r.status); e.status = r.status; throw e; }
  return j;
}
const wait = ms => new Promise(r => setTimeout(r, ms));

let mode = null, st = null, idx = 0, steps = [];
const card = $('card');

const STEP = {
  code: { title: 'Código', render: renderCode },
  welcome: { title: 'Bienvenida', render: renderWelcome },
  cloud: { title: 'Bienvenida', render: renderCloud },
  equipo: { title: 'Bienvenida', render: renderEquipo },
  owner: { title: 'Su usuario', render: renderOwner },
  identity: { title: 'Nombre y dirección', render: renderIdentity },
  publish: { title: 'Publicar', render: renderPublish },
  account: { title: 'Esta cuenta', render: renderAccount },
  extras: { title: 'Extras', render: renderExtras },
  done: { title: 'Listo', render: renderDone },
};

function drawSteps() {
  $('steps').innerHTML = steps.map((k, i) => `<li class="${i < idx ? 'done' : i === idx ? 'cur' : ''}">${i + 1}. ${STEP[k].title}</li>`).join('');
}
async function go(i) {
  idx = Math.max(0, Math.min(i, steps.length - 1));
  drawSteps();
  card.innerHTML = '';
  await STEP[steps[idx]].render();
  animate(card, { opacity: [0, 1], translateY: [10, 0], duration: 350, ease: 'outQuad' });
  const f = card.querySelector('input, select, button.primary'); if (f) f.focus();
}
const next = () => go(idx + 1);
const back = () => go(idx - 1);
const nav = (label = 'Continuar', showBack = true) => `<div class="row end">${showBack && idx > 0 ? '<button class="btn ghost" data-back>Atrás</button>' : ''}<button class="btn primary" data-next>${label}</button></div>`;
function bindNav(onNext) {
  card.querySelector('[data-back]')?.addEventListener('click', back);
  card.querySelector('[data-next]')?.addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true;
    try { if (onNext) await onNext(); next(); } catch (ex) { showMsg(ex.message, 'bad'); } finally { b.disabled = false; }
  });
}
function showMsg(text, kind = 'info', where = card) {
  let m = where.querySelector(':scope > .msg.flash');
  if (!m) { m = document.createElement('p'); m.className = 'msg flash'; where.insertBefore(m, where.querySelector('.row.end')); }
  m.className = `msg flash ${kind}`; m.textContent = text;
}
function copyBlock(text) {
  return `<div class="copy"><pre class="cmd">${esc(text)}</pre><button class="btn small" data-copy="${esc(text)}">Copiar</button></div>`;
}
card.addEventListener('click', e => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  navigator.clipboard?.writeText(b.dataset.copy).then(() => { b.textContent = 'Copiado ✓'; setTimeout(() => { b.textContent = 'Copiar'; }, 1800); });
});

// ---------------------------------------------------------------- pasos
async function renderCode() {
  card.innerHTML = `<h2>Bienvenido a Atalaya</h2>
    <p class="lead">Para confirmar que usted administra este servidor, ingrese el <b>código de configuración</b> que mostró el instalador.</p>
    <p class="hint">¿No lo tiene a mano? En el servidor ejecute: <code>cat /var/lib/atalaya/setup-token</code></p>
    <div class="field"><label for="code">Código</label><input id="code" type="text" class="codein" placeholder="XXXXX-XXXXX" maxlength="11" autocomplete="off" spellcheck="false"></div>
    ${nav('Verificar', false)}`;
  bindNav(async () => { await api('api/setup/verify', { code: $('code').value }); st = await api('api/setup/state'); });
  $('code').addEventListener('keydown', e => { if (e.key === 'Enter') card.querySelector('[data-next]').click(); });
  const h = (location.hash.match(/codigo=([0-9A-F-]{11})/i) || [])[1];
  if (h) { $('code').value = h.toUpperCase(); history.replaceState(null, '', location.pathname); card.querySelector('[data-next]').click(); }
}

async function renderWelcome() {
  const p = st.platform;
  const det = (k, v, ok = true) => `<div class="det ${v ? (ok ? 'ok' : '') : 'no'}"><span>${k}</span><b>${esc(v || 'no detectado')}</b></div>`;
  card.innerHTML = `<h2>${mode.setupMode ? 'Esto es lo que encontré en su servidor' : 'Asistente de configuración'}</h2>
    <p class="lead">Atalaya detecta solo su entorno. ${mode.setupMode ? 'No necesita cambiar nada: en unos pasos queda funcionando.' : 'Puede ajustar la configuración o agregar conexiones.'}</p>
    <div class="detect">
      ${det('Panel', p.panel)}${det('Servidor web', p.web)}${det('Cuentas', String(p.accounts))}${det('Sitios', `${p.sites} (${p.sitesWithLogs} con visitas)`)}
      ${det('Procesos PM2', p.pm2Accounts ? `${p.pm2Accounts} cuenta(s)` : '')}${det('Claude Code', p.claudeAccounts ? `${p.claudeAccounts} cuenta(s)` : '')}
      ${det('Accesos SSH', p.auth)}${det('Bloqueos', (p.bans || []).map(b => b.split(' ')[0]).join(', '))}${det('Correo', p.mail && p.mail.split(' ')[0])}${det('Países', st.geo ? 'base disponible' : '')}
    </div>
    ${!p.panelId ? '<p class="msg info">No hay panel ni servidor web: igual verá el sistema, procesos y agentes. Si usa Vercel o Supabase, los conecta en el paso "Extras".</p>' : ''}
    ${nav('Empezar')}`;
  bindNav();
}

// Atalaya Cloud: no hay servidor que detectar; se explica que se conecta y cuanto permite el plan
async function renderCloud() {
  const L = st.limits || {};
  const lim = (n, what) => n == null ? `${what} sin tope` : `hasta ${n} ${what}`;
  card.innerHTML = `<h2>Su pantalla en Atalaya Cloud</h2>
    <p class="lead">Aquí no hay un servidor que vigilar: su pantalla muestra lo que usted le conecte. Todo es de solo lectura.</p>
    <div class="detect">
      <div class="det ok"><span>${px('cloud')} Nube</span><b>Vercel, Supabase y GitHub</b></div>
      <div class="det ok"><span>${px('house')} Hostings</span><b>agente por cron</b></div>
      <div class="det ok"><span>${px('wp')} WordPress</span><b>plugin</b></div>
      <div class="det ok"><span>${px('laptop')} Claude Code</span><b>en sus laptops</b></div>
    </div>
    <p class="msg info">Su plan permite ${lim(L.connectors, 'conectores de nube')}, ${lim(L.agents, 'hostings o sitios WordPress')} y ${lim(L.remotes, 'laptops')}.</p>
    <p class="hint">Dirección de su pantalla: <b>${esc(st.settings.publicUrl)}</b></p>
    ${nav('Empezar')}`;
  bindNav();
}

// Atalaya Equipo (el ejecutable en la computadora de la persona)
async function renderEquipo() {
  card.innerHTML = `<h2>Atalaya en este equipo</h2>
    <p class="lead">Atalaya corre en su computadora y solo se abre desde ella. Ya está mirando:</p>
    <div class="detect">
      <div class="det ok"><span>${px('laptop')} Este equipo</span><b>CPU, memoria y disco</b></div>
      <div class="det ok"><span>${px('bot')} Claude Code</span><b>sus sesiones, en vivo</b></div>
    </div>
    <p class="msg info">En <b>Extras</b> puede sumar Vercel, Supabase y GitHub. Los hostings y sitios WordPress necesitan una dirección pública para enviar sus datos: para eso están Atalaya Cloud y Atalaya VPS.</p>
    ${nav('Empezar')}`;
  bindNav();
}

async function renderOwner() {
  card.innerHTML = `<h2>Su usuario</h2>
    <p class="lead">Con este usuario y un <b>PIN de 6 dígitos</b> entrará a la pantalla. Será el <b>dueño</b>: el único que puede activar el modo privado.</p>
    <div class="grid2">
      <div class="field"><label for="u">Usuario</label><input id="u" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="ej. neri"></div>
      <div></div>
      <div class="field"><label for="p1">PIN (6 dígitos)</label><input id="p1" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
      <div class="field"><label for="p2">Repita el PIN</label><input id="p2" type="password" inputmode="numeric" maxlength="6" autocomplete="new-password"></div>
    </div>
    <p class="hint">Evite PIN obvios (111111, 123456). Podrá crear más usuarios luego, incluso de "solo ver" para un TV en la oficina.</p>
    ${nav('Crear usuario')}`;
  bindNav(async () => {
    const u = $('u').value.trim(), a = $('p1').value, b = $('p2').value;
    if (!/^\d{6}$/.test(a)) throw new Error('El PIN debe tener exactamente 6 dígitos');
    if (a !== b) throw new Error('Los PIN no coinciden');
    await api('api/setup/owner', { user: u, pin: a });
    mode.owner = true;
  });
}

async function renderIdentity() {
  const s = st.settings;
  card.innerHTML = `<h2>Nombre y dirección</h2>
    <div class="grid2">
      <div class="field"><label for="t">Nombre en pantalla</label><input id="t" type="text" value="${esc(s.title || 'Atalaya')}" maxlength="40"></div>
      <div class="field"><label for="sub">Subtítulo (solo modo privado)</label><input id="sub" type="text" value="${esc(s.subtitle || '')}" maxlength="80" placeholder="ej. Servidor principal"></div>
    </div>
    ${mode.edition === 'cloud' ? `<p class="hint">Dirección: <b>${esc(s.publicUrl)}</b> (la da Atalaya Cloud).</p><input id="url" type="hidden" value="">` : mode.edition === 'equipo' ? `<p class="hint">Se abre en <b>${esc(location.origin)}</b>, solo desde este equipo.</p><input id="url" type="hidden" value="">` : `<div class="field"><label for="url">Dirección pública (URL)</label><input id="url" type="url" value="${esc(s.publicUrl || '')}" placeholder="https://atalaya.su-dominio.com"></div>
    <p class="hint">Es la dirección con la que la abrirá desde el TV o el celular. Si todavía no la tiene, el paso siguiente la crea (en cPanel) o le explica cómo.</p>`}
    <label class="check"><input type="checkbox" id="pa" ${s.public?.showAccountNames ? 'checked' : ''}><span><b>Mostrar nombres de cuentas en modo público</b><small>Si la pantalla estará donde otros la vean, déjelo apagado.</small></span></label>
    <label class="check"><input type="checkbox" id="pp" ${s.public?.showAppNames ? 'checked' : ''}><span><b>Mostrar nombres de proyectos en modo público</b><small>Apagado: en público se ven categorías ("Tienda online") en vez de nombres.</small></span></label>
    <label class="check"><input type="checkbox" id="pr" ${s.promo !== false ? 'checked' : ''}><span><b>Mostrar «¿Qué es esto?» en la pantalla de acceso</b><small>Un enlace discreto a la página de Atalaya Monitor Server para quien llegue a su dirección sin usuario, con la versión, la edad del proyecto y la invitación a colaborar.</small></span></label>
    ${nav('Guardar y continuar')}`;
  bindNav(async () => {
    await api('api/setup/settings', { title: $('t').value, subtitle: $('sub').value, publicUrl: $('url').value, public: { showAccountNames: $('pa').checked, showAppNames: $('pp').checked }, promo: $('pr').checked });
    st = await api('api/setup/state');
  });
}

async function helperAction(action, params, statusEl) {
  statusEl.className = 'st run'; statusEl.textContent = 'trabajando…';
  const { id } = await api('api/setup/action', { action, params });
  for (let i = 0; i < 90; i++) {
    await wait(1500);
    const r = await api('api/setup/result?id=' + id);
    if (r.pending) continue;
    if (!r.ok) throw new Error(r.error || 'Falló');
    statusEl.className = 'st ok'; statusEl.textContent = 'listo';
    return r.output;
  }
  throw new Error('El ayudante no respondió. ¿Está instalado? Ejecute de nuevo ./install.sh');
}

async function renderPublish() {
  const cp = st.platform.panelId === 'cpanel' && st.helper && st.cpanelDomains.length;
  card.innerHTML = `<h2>Publicar con su propio dominio</h2>
    ${st.settings.publicUrl ? `<p class="msg ok">Dirección actual: <b>${esc(st.settings.publicUrl)}</b></p>` : ''}
    ${cp ? `<p class="lead">Atalaya puede crear un <b>subdominio</b> en su cPanel, con su certificado SSL, y dejarlo apuntando aquí.</p>
      <div class="grid2">
        <div class="field"><label for="sd">Subdominio</label><input id="sd" type="text" value="atalaya" autocapitalize="none" spellcheck="false"></div>
        <div class="field"><label for="dm">Dominio</label><select id="dm">${st.cpanelDomains.map(d => `<option>${esc(d)}</option>`).join('')}</select></div>
      </div>
      <div class="extra"><h3>Crear <span id="fq" class="mono"></span><span class="st off" id="pst">pendiente</span></h3>
        <div class="row"><button class="btn" id="pub">Crear subdominio y publicar</button></div><div id="pout"></div></div>`
    : `<p class="lead">Agregue este bloque a su servidor web (${esc(st.platform.web)}) para verlo por HTTPS en su dominio:</p>
      ${copyBlock(st.proxySnippet || '')}
      <p class="hint">Archivo de ejemplo en el servidor: <code>deploy/proxy/${esc(st.proxyFile)}</code>. Después escriba la dirección en el paso anterior.</p>`}
    ${nav('Continuar')}`;
  bindNav();
  if (!cp) return;
  const upd = () => { $('fq').textContent = `${$('sd').value.trim()}.${$('dm').value}`; };
  $('sd').addEventListener('input', upd); $('dm').addEventListener('change', upd);
  const pref = (st.settings.publicUrl || '').replace(/^https?:\/\//, '');
  const main = st.cpanelDomains.find(d => pref.endsWith('.' + d)) || st.cpanelDomains[0];
  $('dm').value = main; upd();
  $('pub').addEventListener('click', async e => {
    e.currentTarget.disabled = true;
    try {
      const out = await helperAction('cpanel-publish', { sub: $('sd').value.trim(), domain: $('dm').value }, $('pst'));
      $('pout').innerHTML = `<p class="msg ok">${esc(out)}</p>`;
      st = await api('api/setup/state');
    } catch (ex) { $('pst').className = 'st bad'; $('pst').textContent = 'error'; $('pout').innerHTML = `<p class="msg bad">${esc(ex.message)}</p>`; }
    finally { e.currentTarget.disabled = false; }
  });
}

async function renderAccount() {
  const has = (st.agents || []).some(a => a === 'esta-cuenta');
  card.innerHTML = `<h2>Conectar esta cuenta</h2>
    <p class="lead">Atalaya Hosting ve la cuenta a través de un <b>agente</b>: una tarea cron que corre cada minuto, lee sus sitios, visitas, errores, cuota, bases,
      certificados y correo, y los envía a esta pantalla. No toca <code>public_html</code> ni cambia nada.</p>
    <div class="extra"><h3>${px('house')} Esta cuenta<span class="st ${has ? 'ok' : 'off'}" id="ast">${has ? 'conectada' : 'sin conectar'}</span></h3>
      <p class="hint">Crea la tarea cron <code>* * * * *</code> con el agente en <code>~/.atalaya</code>. Se puede quitar cuando quiera desde el menú ⋮ › Conectar un hosting compartido.</p>
      <div class="row"><button class="btn" id="agl">${has ? 'Reinstalar el agente' : 'Instalar el agente aquí'}</button></div><div id="agout"></div></div>
    <p class="hint">¿Tiene más hostings (de este u otro proveedor)? Conéctelos después desde el menú ⋮ › <b>Conectar un hosting compartido</b>: todos aparecen en esta misma pantalla.</p>
    ${nav('Continuar')}`;
  bindNav();
  $('agl').addEventListener('click', async e => {
    const b = e.currentTarget; b.disabled = true; $('ast').className = 'st run'; $('ast').textContent = 'instalando…';
    try { const r = await api('api/setup/agent-local', {}); $('ast').className = 'st ok'; $('ast').textContent = 'conectada'; $('agout').innerHTML = `<pre class="cmd">${esc(r.output)}</pre>`; b.remove(); }
    catch (ex) { $('ast').className = 'st off'; $('ast').textContent = 'falló'; $('agout').innerHTML = `<p class="msg bad">${esc(ex.message)}</p>`; b.disabled = false; }
  });
}

async function renderExtras() {
  const p = st.platform;
  card.innerHTML = `<h2>Extras (todo opcional)</h2>
    <p class="lead">Puede activarlos ahora o más tarde desde el menú ⋮ › Asistente.</p>
    ${mode.edition === 'cloud' ? `<p class="hint">¿Hostings o sitios WordPress? Se conectan desde la pantalla: menú › <b>Conectar un hosting compartido</b>.</p>` : mode.edition === 'equipo' ? '' : `<div class="extra"><h3>${px('web')} Países de las visitas<span class="st ${st.geo ? 'ok' : 'off'}" id="gst">${st.geo ? 'disponible' : 'sin base'}</span></h3>
      <p class="hint">Para mostrar la bandera de cada visita. ${st.geo ? 'Ya hay una base en el servidor.' : 'Se descarga la gratuita de DB-IP (~8 MB).'}</p>
      ${st.geo ? '' : '<div class="row"><button class="btn" id="geo">Descargar base de países</button></div>'}</div>`}
    ${mode.edition !== 'vps' ? '' : `<div class="extra"><h3>${px('bot')} Claude Code en este servidor<span class="st off" id="hst">${p.claudeAccounts ? p.claudeAccounts + ' cuenta(s)' : 'no detectado'}</span></h3>
      <p class="hint">Instala hooks para ver al instante cuándo un agente pide permiso. Solo agregan avisos; nunca bloquean a Claude.</p>
      ${p.claudeAccounts && st.helper ? '<div class="row"><button class="btn" id="hooks">Instalar hooks</button></div>' : ''}</div>`}
    ${mode.edition === 'vps' ? `<div class="extra"><h3>${px('search')} Buscadores de filtraciones (LeakIX)<span class="st ${st.connectors.some(c => c.type === 'leakix') ? 'ok' : 'off'}">${st.connectors.some(c => c.type === 'leakix') ? 'conectado' : 'sin conectar'}</span></h3>
      <p class="hint">Una vez al día revisa si la IP o los dominios de este servidor aparecen en leakix.net, el buscador público de filtraciones (.git, .env, paneles abiertos). Si aparecen, cualquiera puede verlo.</p>
      <details><summary>Conectar LeakIX</summary>
        <p class="hint">Cree una cuenta gratis en leakix.net y copie su clave en <b>Settings › API key</b>.</p>
        <div class="field"><label>Clave de la API</label><input type="password" id="lkkey" autocomplete="off"></div>
        <div class="row"><button class="btn" id="lkgo">Guardar</button></div><div id="lkout"></div></details></div>` : ''}
    <div class="extra"><h3>${px('branch')} GitHub<span class="st ${st.connectors.some(c => c.type === 'github') ? 'ok' : 'off'}">${st.connectors.filter(c => c.type === 'github').length || 'sin'} conector(es)</span></h3>
      <p class="hint">Une cada proyecto con su código y revisa sus repos: archivos con secretos subidos, .gitignore, CI y alertas de dependencias.</p>
      <details><summary>Conectar una cuenta de GitHub</summary>
        <p class="hint">Cree un token <b>fine-grained</b> en github.com › Settings › Developer settings › Personal access tokens, con acceso a sus repos y permisos
          <b>solo de lectura</b>: Metadata, Contents y (opcional) Dependabot alerts.</p>
        <div class="grid2"><div class="field"><label>Nombre</label><input type="text" id="gid" placeholder="Mi cuenta" maxlength="40"></div>
        <div class="field"><label>Token</label><input type="password" id="gtok" autocomplete="off" placeholder="github_pat_..."></div></div>
        <div class="row"><button class="btn" id="ggo">Guardar conector</button></div><div id="gout"></div></details></div>
    <div class="extra"><h3>${px('triangle')} Vercel<span class="st ${st.connectors.some(c => c.type === 'vercel') ? 'ok' : 'off'}">${st.connectors.filter(c => c.type === 'vercel').length || 'sin'} conector(es)</span></h3>
      <details><summary>Conectar una cuenta de Vercel</summary>
        <div class="grid2"><div class="field"><label>Nombre</label><input type="text" id="vid" placeholder="Mi empresa" maxlength="40"></div>
        <div class="field"><label>ID de equipo (opcional)</label><input type="text" id="vteam" placeholder="team_..."></div></div>
        <div class="field"><label>Token (vercel.com/account/tokens)</label><input type="password" id="vtok" autocomplete="off"></div>
        <div class="field"><label>Secreto del Drain (opcional, plan Pro)</label><input type="password" id="vsec" autocomplete="off"></div>
        <div class="row"><button class="btn" id="vgo">Guardar conector</button></div><div id="vout"></div></details></div>
    <div class="extra"><h3>${px('cloud')} Cloudflare<span class="st ${st.connectors.some(c => c.type === 'cloudflare') ? 'ok' : 'off'}">${st.connectors.filter(c => c.type === 'cloudflare').length || 'sin'} conector(es)</span></h3>
      <p class="hint">Sus proyectos de Pages y sus Workers como edificios, los despliegues, las visitas de cada dominio y un aviso si un reloj (cron) deja de correr.</p>
      <details><summary>Conectar una cuenta de Cloudflare</summary>
        <p class="hint">En dash.cloudflare.com › su perfil › <b>API Tokens</b> › Create Token › <b>Create Custom Token</b>, con estos permisos, todos <b>de solo lectura</b>:</p>
        <ul class="hint"><li>Account › <b>Cloudflare Pages</b>: Read</li><li>Account › <b>Workers Scripts</b>: Read</li><li>Account › <b>Account Analytics</b>: Read</li><li>Zone › <b>Zone</b>: Read</li><li>Zone › <b>Analytics</b>: Read</li></ul>
        <p class="hint">Si omite alguno, esa parte queda apagada y el resto funciona. Atalaya no puede cambiar nada en su cuenta con este token.</p>
        <div class="grid2"><div class="field"><label>Nombre</label><input type="text" id="cfid" placeholder="Mi empresa" maxlength="40"></div>
        <div class="field"><label>ID de la cuenta (opcional)</label><input type="text" id="cfacc" placeholder="32 caracteres, en Workers y Pages › Account ID"></div></div>
        <div class="field"><label>Token</label><input type="password" id="cftok" autocomplete="off"></div>
        <div class="row"><button class="btn" id="cfgo">Guardar conector</button></div><div id="cfout"></div></details></div>
    <div class="extra"><h3>${px('bolt')} Supabase<span class="st ${st.connectors.some(c => c.type === 'supabase') ? 'ok' : 'off'}">${st.connectors.filter(c => c.type === 'supabase').length || 'sin'} conector(es)</span></h3>
      <details><summary>Conectar un proyecto de Supabase</summary>
        <div class="grid2"><div class="field"><label>Nombre</label><input type="text" id="sid" placeholder="Base de la tienda" maxlength="40"></div>
        <div class="field"><label>Project ref</label><input type="text" id="sref" placeholder="abcdefghijklmnop"></div></div>
        <div class="grid2"><div class="field"><label>Nombre para mostrar</label><input type="text" id="sname" placeholder="Base de la tienda"></div>
        <div class="field"><label>Secret key (sb_secret_...)</label><input type="password" id="skey" autocomplete="off"></div></div>
        <div class="field"><label>Token de gestión (opcional: ver si está pausado)</label><input type="password" id="smg" autocomplete="off"></div>
        <div class="row"><button class="btn" id="sgo">Guardar conector</button></div><div id="sout"></div></details></div>
    <div class="extra"><h3>${px('laptop')} Claude Code en una laptop<span class="st ${st.remotes.length ? 'ok' : 'off'}">${st.remotes.length || 'sin'} equipo(s)</span></h3>
      <details><summary>Agregar un equipo</summary>
        <div class="row"><div class="field grow"><label>Nombre del equipo</label><input type="text" id="rname" placeholder="laptop-ana"></div><button class="btn" id="rgo" style="align-self:flex-end">Generar comando</button></div>
        <div id="rout"></div></details></div>
    ${nav('Continuar')}`;
  bindNav();
  const act = (id, fn) => $(id)?.addEventListener('click', async e => { const b = e.currentTarget; b.disabled = true; try { await fn(b); } catch (ex) { b.insertAdjacentHTML('afterend', `<p class="msg bad">${esc(ex.message)}</p>`); } finally { b.disabled = false; } });
  act('geo', async b => {
    $('gst').className = 'st run'; $('gst').textContent = 'descargando…'; b.disabled = true;
    const r = await api('api/setup/geo', {}).catch(e => ({ error: e.message }));
    if (!r || r.error) { $('gst').className = 'st off'; $('gst').textContent = 'no se pudo'; b.disabled = false; b.insertAdjacentHTML('afterend', `<p class="hint">${esc((r && r.error) || 'Sin conexión')}</p>`); return; }
    $('gst').className = 'st ok'; $('gst').textContent = 'disponible'; b.remove();
  });
  act('hooks', async b => { const out = await helperAction('install-hooks', {}, $('hst')); b.insertAdjacentHTML('afterend', `<pre class="cmd">${esc(out.trim().split('\n').slice(-8).join('\n'))}</pre>`); b.remove(); });
  act('vgo', async () => {
    const r = await api('api/setup/connector', { type: 'vercel', id: $('vid').value.trim(), token: $('vtok').value, teamId: $('vteam').value.trim(), drainSecret: $('vsec').value });
    $('vout').innerHTML = `<p class="msg ok">Conector guardado.${r.drainUrl ? ' Para ver las visitas en vivo, en Vercel › Team Settings › Drains › Add Drain › Logs › Custom Endpoint use:' : ''}</p>${r.drainUrl ? copyBlock(r.drainUrl) : ''}`;
  });
  act('lkgo', async () => {
    await api('api/setup/connector', { type: 'leakix', id: 'leakix', apiKey: $('lkkey').value.trim() });
    $('lkout').innerHTML = '<p class="msg ok">Guardado. La primera consulta tarda unos minutos; el resultado aparece en «Salud del servidor».</p>';
  });
  act('cfgo', async () => {
    const r = await api('api/setup/connector', { type: 'cloudflare', id: $('cfid').value.trim(), token: $('cftok').value.trim(), accountId: $('cfacc').value.trim() });
    $('cfout').innerHTML = `<p class="msg ok">Conector guardado${r.account ? ': cuenta «' + esc(r.account) + '»' : ''}. Sus proyectos aparecen en un minuto; las visitas y las corridas, en unos cinco.${r.accounts > 1 ? ' El token ve varias cuentas: se usa la primera. Para otra, agregue un conector con su ID de cuenta.' : ''}</p>`;
  });
  act('ggo', async () => {
    await api('api/setup/connector', { type: 'github', id: $('gid').value.trim(), token: $('gtok').value.trim() });
    $('gout').innerHTML = '<p class="msg ok">Conector guardado. Los proyectos aparecen en un minuto en el panel «Proyectos».</p>';
  });
  act('sgo', async () => {
    await api('api/setup/connector', { type: 'supabase', id: $('sid').value.trim(), mgmtToken: $('smg').value, projects: [{ ref: $('sref').value.trim(), name: $('sname').value.trim(), serviceKey: $('skey').value }] });
    $('sout').innerHTML = '<p class="msg ok">Conector guardado. Las métricas aparecen en un minuto.</p>';
  });
  act('rgo', async () => {
    const r = await api('api/setup/remote', { name: $('rname').value.trim() });
    $('rout').innerHTML = `<p class="msg info"><b>Windows:</b> abra <b>PowerShell</b> y pegue:</p>${copyBlock(r.commandWin)}<p class="msg info"><b>macOS, Linux o WSL:</b> abra una terminal y pegue:</p>${copyBlock(r.command)}<p class="hint">Use el del sistema donde abre Claude Code. Si lo usa dentro de WSL, el de Linux, en la terminal de WSL. Después abra una sesión nueva de Claude Code.</p><p class="hint">El comando incluye un token que se muestra solo esta vez.</p>`;
  });
}

async function renderDone() {
  card.innerHTML = `<p class="big">${px('star', 'huge')}</p><h2 style="text-align:center">¡Atalaya está listo!</h2>
    <p class="lead" style="text-align:center">${st.settings.publicUrl ? `Ábralo en el TV o el celular desde <b>${esc(st.settings.publicUrl)}</b>.` : 'Ya puede abrir la pantalla.'} Pulse <b>F</b> para pantalla completa y <b>?</b> para la leyenda.</p>
    <div class="row end"><button class="btn primary" data-finish>Abrir Atalaya</button></div>`;
  const temp = !!location.port && location.port !== '443' && location.port !== '80' && location.protocol === 'http:';
  if (temp && !st.settings.publicUrl) card.insertAdjacentHTML('beforeend', `<p class="msg info">Está usando la dirección temporal, que se cerrará al terminar. Sin una dirección pública (paso "Publicar"), podrá abrir Atalaya con un túnel SSH: <code>ssh -L 3950:127.0.0.1:3950 root@${esc(location.hostname)}</code> y luego <code>http://localhost:3950</code>.</p>`);
  card.querySelector('[data-finish]').addEventListener('click', async () => {
    try { await api('api/setup/finish', {}); } catch { }
    location.href = temp && st.settings.publicUrl ? st.settings.publicUrl : './';
  });
}

// ---------------------------------------------------------------- arranque
(async () => {
  mode = await api('api/setup/mode');
  $('wver').textContent = 'v' + mode.version;
  $('wsub').textContent = mode.setupMode ? 'Configuración inicial' : 'Asistente de configuración';
  try { st = await api('api/setup/state'); } catch { st = null; }
  // edicion Hosting: la direccion es la de la app Node del panel; en vez de publicar, se conecta la cuenta
  const pub = mode.edition === 'hosting' ? 'account' : 'publish';
  if (mode.edition === 'cloud') steps = ['cloud', 'identity', 'extras', 'done'];
  else if (mode.edition === 'equipo') steps = mode.setupMode ? [...(st ? [] : ['code']), 'equipo', 'owner', 'identity', 'extras', 'done'] : ['equipo', 'identity', 'extras', 'done'];
  else steps = mode.setupMode ? [...(st ? [] : ['code']), 'welcome', 'owner', 'identity', pub, 'extras', 'done'] : ['welcome', 'identity', pub, 'extras', 'done'];
  if (!mode.setupMode && !mode.owner) { location.href = 'login'; return; }
  go(0);
})();

// fondo de estrellas (igual que el acceso)
const cv = $('stars'), cx = cv.getContext('2d');
let stars = [];
function resize() { cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio; stars = Array.from({ length: 120 }, () => ({ x: Math.random() * cv.width, y: Math.random() * cv.height, r: Math.random() * 1.5 + .3, p: Math.random() * 6 })); }
function frame(t) { cx.clearRect(0, 0, cv.width, cv.height); for (const s of stars) { cx.globalAlpha = .2 + .4 * (0.5 + 0.5 * Math.sin(t / 900 + s.p)); cx.fillStyle = '#9fb4d9'; cx.fillRect(s.x, s.y, s.r * devicePixelRatio, s.r * devicePixelRatio); } requestAnimationFrame(frame); }
addEventListener('resize', resize); resize(); requestAnimationFrame(frame);
