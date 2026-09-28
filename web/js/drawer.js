// Panel de detalle: se abre al tocar un servicio, agente, distrito, la torre o un evento.
// Los datos vienen de /api/detail y ya llegan filtrados por el modo publico/privado.
import { animate } from '../vendor/anime.esm.min.js';
import { withFavicons } from './favicons.js';
import { px } from './pixicons.js';
import uPlot from '../vendor/uPlot.esm.js';
import { signCanvas, robotCanvas, iconCanvas } from './sprites.js';
import { ask } from './ask.js';
import { forEdition } from './accounts.js';
import { esc, fmtBytes, fmtNum, ago } from './hud.js';

// version de las definiciones (que se detecta y como resolverlo), que se actualizan solas como un antivirus
function defsLine(st) {
  const d = st && st.defs;
  if (!d) return '';
  const when = d.checkedAt ? `revisadas a las ${new Date(d.checkedAt).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false })}` : 'se revisan una vez al día';
  return `<p class="dmuted small defsline">${px('shield')} Definiciones <b>${esc(d.version)}</b> · ${d.source === 'actualizadas' ? 'actualizadas' : 'integradas'} · ${d.auto ? when : 'actualización automática apagada'}${d.error ? ' · <span class="warn">no se pudo revisar</span>' : ''}</p>`;
}

const STATE_LABEL = { working: 'Trabajando', thinking: 'Pensando', waiting: 'Lo espera', idle: 'En pausa' };
const STATUS_LABEL = { online: 'En línea', degraded: 'Parcial', down: 'Caído' };
const WAIT_LABEL = { permission: 'Espera su permiso', question: 'Le hizo una pregunta', idle: 'Espera su respuesta' };
const hhmm = t => new Date(t).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dur = s => { s = Math.round(s || 0); const d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : m ? `${m} min` : `${s} s`; };
// pais: etiqueta pixel con el codigo ISO (VE, US...), sin emojis
export const flag = cc => `<span class="cc">${cc && /^[A-Z]{2}$/.test(cc) ? cc : '??'}</span>`;
const regionName = (() => { try { const dn = new Intl.DisplayNames(['es'], { type: 'region' }); return cc => { try { return dn.of(cc); } catch { return cc; } }; } catch { return cc => cc; } })();
const countryName = cc => cc && cc !== '??' ? regionName(cc) : 'Desconocido';
// barras horizontales para rankings (paises, paginas, navegadores...)
function bars(list, fmtKey, total) {
  if (!list || !list.length) return '<li class="dmuted">Sin datos en la última hora.</li>';
  const max = Math.max(...list.map(x => x.n));
  return list.map(x => `<li class="bar"><span class="grow">${fmtKey(x.key)}</span><span class="bw"><i style="width:${Math.round(x.n / max * 100)}%"></i></span>
    <span class="mono">${x.n}${total ? ` <span class="dmuted">${Math.round(x.n / total * 100)}%</span>` : ''}</span></li>`).join('');
}
const TYPE_LABEL = { wordpress: 'WordPress', php: 'PHP', static: 'Estático', proxy: 'Proxy', wip: 'En construcción' };
const stat = (k, v, cls = '') => `<div class="dstat ${cls}"><span>${k}</span><b>${v}</b></div>`;
const statusCls = st => st === 'online' ? 'ok' : st === 'degraded' ? 'warn' : 'bad';
const httpCls = c => c >= 500 ? 'bad' : c >= 400 ? 'warn' : 'ok';

export class Drawer {
  constructor(el, { onNavigate, onClose }) {
    this.el = el;
    this.onNavigate = onNavigate;
    this.onClose = onClose;
    this.head = el.querySelector('.dhead');
    this.body = el.querySelector('.dbody');
    el.querySelector('.dclose').addEventListener('click', () => this.close());
    // enlaces internos: data-go="kind:id"
    el.addEventListener('click', async e => {
      const dir = e.target.closest('[data-dir]');
      if (dir) { this.params = { ...(this.params || {}), path: dir.dataset.dir }; this.load(); this.body.scrollTo({ top: this.body.querySelector('.crumbs')?.offsetTop - 80 || 0, behavior: 'smooth' }); return; }
      if (e.target.closest('[data-analyze]')) {
        const b = e.target.closest('[data-analyze]'); b.disabled = true;
        const r = await fetch('api/disk/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: '{}' }).then(x => x.json()).catch(() => ({}));
        if (r.error) { b.insertAdjacentHTML('afterend', `<span class="dmuted"> ${esc(r.error)}</span>`); b.disabled = false; } else this.load();
        return;
      }
      const ag = e.target.closest('[data-agent-du]');
      if (ag) {
        ag.disabled = true;
        const r = await fetch('api/agents/request', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: JSON.stringify({ id: ag.dataset.agentDu, what: 'du' }) }).then(x => x.json()).catch(() => ({}));
        if (r.error) { ag.insertAdjacentHTML('afterend', `<span class="dmuted"> ${esc(r.error)}</span>`); ag.disabled = false; } else this.load();
        return;
      }
      const pa = e.target.closest('[data-proj]');
      if (pa) {
        const act = pa.dataset.proj, body = { id: pa.dataset.id };
        if (act === 'merge') { body.into = this.body.querySelector('#projInto')?.value; if (!body.into) return; }
        if (act === 'rename') { const n = await ask({ title: 'Cambiar el nombre del proyecto', icon: 'folder', ok: 'Guardar', input: { label: 'Nuevo nombre', value: pa.dataset.name || '' } }); if (n == null || !n) return; body.name = n; }
        if (act === 'hide' && !(await ask({ title: 'Ocultar este proyecto del mapa', body: 'Deja de verse en el mapa y en la lista de proyectos. Se puede volver a mostrar editando <code>settings.json</code>.', ok: 'Ocultar', icon: 'folder' }))) return;
        pa.disabled = true;
        const r = await fetch('api/projects/' + act, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: JSON.stringify(body) }).then(x => x.json()).catch(() => ({}));
        if (r.error) { pa.insertAdjacentHTML('afterend', `<span class="dmuted"> ${esc(r.error)}</span>`); pa.disabled = false; return; }
        if (act === 'hide' || act === 'merge') { this.onNavigate('projects', 'all'); return; }
        this.load();
        return;
      }
      const up = e.target.closest('[data-audit-updates]');
      if (up) {
        up.disabled = true;
        const r = await fetch('api/audit/updates', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: '{}' }).then(x => x.json()).catch(() => ({}));
        if (r.error) { up.insertAdjacentHTML('afterend', `<span class="dmuted"> ${esc(r.error)}</span>`); up.disabled = false; } else { up.textContent = 'Revisando…'; setTimeout(() => this.load(), 12000); }
        return;
      }
      // activar o apagar la actividad de bases: el ayudante crea o borra el usuario de solo PROCESS
      // defensa: bloquear, desbloquear y ajustes
      const pq = e.target.closest('[data-php-q], [data-php-ack]');
      if (pq) {
        const q = !!pq.dataset.phpQ, file = pq.dataset.phpQ || pq.dataset.phpAck;
        if (!(await ask(q ? { title: 'Poner en cuarentena', danger: true, icon: 'bad', ok: 'Sacar del sitio', body: `<code>${esc(file.replace(/^\/home\/[^/]+\//, '~/'))}</code> sale del sitio y deja de funcionar. Se guarda aparte, sin borrarse, por si hiciera falta recuperarlo.` }
          : { title: 'Marcar como revisado', icon: 'ok', ok: 'Es mío, está bien', body: 'Deja de aparecer como sospechoso. Úselo solo si sabe de dónde salió este archivo.' }))) return;
        pq.disabled = true;
        const r = await fetch(q ? 'api/phpfiles/quarantine' : 'api/phpfiles/ack', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: JSON.stringify({ path: file }) }).then(x => x.json()).catch(() => ({ error: 'Sin conexión' }));
        if (r.error) { pq.insertAdjacentHTML('afterend', `<span class="dmuted"> ${esc(r.error)}</span>`); pq.disabled = false; return; }
        if (q) { this.close(); return; } // la ficha se cierra: la patrulla se lleva la capsula a la vista
        this.load();
        return;
      }
      const qa = e.target.closest('[data-qdel], [data-qres]');
      if (qa) {
        const del = !!qa.dataset.qdel, file = qa.dataset.qdel || qa.dataset.qres, short = file.replace(/^\/home\/[^/]+\//, '~/');
        if (!(await ask(del ? { title: 'Borrar para siempre', danger: true, icon: 'bad', ok: 'Borrar', body: `<code>${esc(short)}</code> se borra definitivamente. No se puede deshacer.`, input: { label: 'Escriba BORRAR para confirmar', match: 'BORRAR' } }
          : { title: 'Restaurar el archivo', icon: 'warn', ok: 'Restaurar', body: `<code>${esc(short)}</code> vuelve a su lugar en el sitio y podrá ejecutarse de nuevo. Úselo solo si está seguro de que no era malware.` }))) return;
        qa.disabled = true;
        const r = await fetch(del ? 'api/phpfiles/qdelete' : 'api/phpfiles/qrestore', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: JSON.stringify({ path: file }) }).then(x => x.json()).catch(() => ({ error: 'Sin conexión' }));
        if (r.error) { qa.insertAdjacentHTML('afterend', `<span class="dmuted"> ${esc(r.error)}</span>`); qa.disabled = false; return; }
        this.load();
        return;
      }
      const rel = e.target.closest('[data-release-ip]');
      if (rel) {
        const perm = rel.dataset.perm === '1';
        if (!(await ask({ title: `Liberar ${rel.dataset.releaseIp}`, icon: 'jail', ok: 'Liberar', body: perm ? 'Se quita su bloqueo <b>permanente</b> del firewall y podrá volver a entrar a todos los sitios del servidor.' : 'Sale de la cárcel antes de que venza su bloqueo y podrá volver a entrar a todos los sitios.' }))) return;
        rel.disabled = true; rel.textContent = 'Liberando…';
        const r = await fetch('api/defense/release', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: JSON.stringify({ ip: rel.dataset.releaseIp }) }).then(x => x.json()).catch(() => ({ error: 'Sin conexión' }));
        if (r.error) { rel.insertAdjacentHTML('afterend', `<span class="dmuted"> ${esc(r.error)}</span>`); rel.disabled = false; rel.textContent = 'Liberar'; return; }
        this.load();
        return;
      }
      const bl = e.target.closest('[data-block-ip], [data-unblock-ip], [data-def-save]');
      if (bl) {
        e.preventDefault();
        const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: JSON.stringify(b) }).then(x => x.json()).catch(() => ({ error: 'Sin conexión' }));
        let r;
        if (bl.dataset.blockIp) {
          if (!(await ask({ title: `Bloquear ${bl.dataset.blockIp}`, danger: true, icon: 'jail', ok: 'Bloquear y llevar a la cárcel', body: 'No podrá entrar a <b>ningún sitio</b> del servidor hasta que venza el bloqueo; después sale sola. Puede liberarla antes desde la cárcel.' }))) return;
          bl.disabled = true; bl.textContent = 'Bloqueando…'; r = await post('api/defense/block', { ip: bl.dataset.blockIp, reason: bl.dataset.reason || undefined });
        } else if (bl.dataset.unblockIp) { bl.disabled = true; r = await post('api/defense/unblock', { ip: bl.dataset.unblockIp }); }
        else {
          const box = bl.closest('.defbox');
          r = await post('api/defense/settings', { auto: box.querySelector('[name=auto]').checked, hours: +box.querySelector('[name=hours]').value,
            allow: box.querySelector('[name=allow]').value.split(/[\s,]+/).filter(Boolean) });
        }
        if (r.error) { bl.insertAdjacentHTML('afterend', `<span class="dmuted"> ${esc(r.error)}</span>`); bl.disabled = false; return; }
        this.load();
        return;
      }
      const dm = e.target.closest('[data-dbmon]');
      if (dm) {
        e.preventDefault();
        const on = dm.dataset.dbmon === 'on';
        if (!on && !(await ask({ title: 'Apagar la actividad de las bases', icon: 'db', ok: 'Apagar', body: 'Se borra el usuario de monitoreo de MySQL y la ficha deja de mostrar conexiones y consultas. Se puede volver a activar cuando quiera.' }))) return;
        dm.disabled = true; dm.textContent = on ? 'Activando…' : 'Apagando…';
        const post = (u, b) => fetch(u, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: JSON.stringify(b) }).then(x => x.json()).catch(() => ({ error: 'Sin conexión' }));
        const r = await post('api/setup/action', { action: on ? 'mysql-monitor' : 'mysql-monitor-off' });
        let res = r.error ? r : null;
        for (let i = 0; !res && i < 40; i++) {
          await new Promise(k => setTimeout(k, 1500));
          const x = await fetch('api/setup/result?id=' + encodeURIComponent(r.id)).then(y => y.json()).catch(() => ({}));
          if (!x.pending) res = x;
        }
        if (!res || res.error || res.ok === false) { dm.insertAdjacentHTML('afterend', `<span class="dmuted"> ${esc((res && res.error) || 'El ayudante no respondió')}</span>`); dm.disabled = false; dm.textContent = on ? 'Activar' : 'Apagar'; return; }
        setTimeout(() => this.load(), on ? 6000 : 500);
        return;
      }
      const au = e.target.closest('[data-audit-db]');
      if (au) {
        au.disabled = true;
        const r = await fetch('api/audit/db', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: JSON.stringify({ name: au.dataset.auditDb }) }).then(x => x.json()).catch(() => ({}));
        if (r.error) { au.insertAdjacentHTML('afterend', `<span class="dmuted"> ${esc(r.error)}</span>`); au.disabled = false; } else this.load();
        return;
      }
      const cfb = e.target.closest('[data-cf]');
      if (cfb && (cfb.tagName === 'BUTTON' || e.type === 'click')) {
        const act = cfb.dataset.cf, box = cfb.closest('.cfbox'), out = box.querySelector('.cf-out');
        if (act === 'disconnect' && !(await ask({ title: 'Desconectar Cloudflare', icon: 'web', ok: 'Desconectar', body: 'Las IPs que se bloqueen desde ahora ya no se bloquean allá. Las reglas que ya creó siguen en Cloudflare hasta que salgan de la cárcel o las borre a mano.' }))) return;
        const body = act === 'connect' ? { token: box.querySelector('[name=cftoken]').value } : act === 'on' ? { on: cfb.checked } : {};
        if (cfb.tagName === 'BUTTON') cfb.disabled = true;
        out.textContent = act === 'connect' ? 'Verificando el token…' : '';
        const r = await fetch('api/cloudflare/' + act, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: JSON.stringify(body) }).then(x => x.json()).catch(() => ({ error: 'Sin conexión' }));
        if (cfb.tagName === 'BUTTON') cfb.disabled = false;
        if (r.error) { out.className = 'cf-out bad'; out.textContent = r.error; return; }
        this.load(); return;
      }
      const cp = e.target.closest('[data-copy]');
      if (cp) { navigator.clipboard?.writeText(cp.dataset.copy).then(() => { cp.textContent = 'Copiado'; setTimeout(() => { cp.textContent = 'Copiar'; }, 1800); }); return; }
      // informe mensual por correo: guardar destinatarios o enviarlo ya
      const rp = e.target.closest('[data-report]');
      if (rp) {
        const box = rp.closest('.anarep'), out = box.querySelector('.anarep-out'), to = box.querySelector('input[type=email], input[type=text]').value.trim();
        const act = rp.dataset.report, active = box.querySelector('input[type=checkbox]').checked;
        rp.disabled = true; out.className = 'anarep-out dmuted'; out.textContent = act === 'send' ? 'Enviando…' : 'Guardando…';
        const r = await fetch('api/reports/' + (act === 'send' ? 'send' : 'save'), { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: JSON.stringify({ id: box.dataset.id, to, active }) }).then(x => x.json()).catch(() => ({ error: 'Sin conexión' }));
        rp.disabled = false;
        out.className = 'anarep-out ' + (r.error ? 'bad' : 'good');
        out.textContent = r.error ? r.error : act === 'send' ? `Enviado a ${r.to.join(', ')}.` : r.monthly.to.length ? `Guardado: ${r.monthly.active ? 'el día 1 de cada mes' : 'en pausa'}, a ${r.monthly.to.join(', ')}.` : 'Sin destinatarios: el informe queda apagado.';
        return;
      }
      const ar = e.target.closest('[data-ana-range]');
      if (ar) { this.anaRange = +ar.dataset.anaRange; this.body.querySelectorAll('[data-ana-range]').forEach(b => b.classList.toggle('on', b === ar)); this.load(); return; }
      const a = e.target.closest('[data-go]');
      if (!a) return;
      const [kind, ...rest] = a.dataset.go.split(':');
      this.onNavigate(kind, rest.join(':'));
    });
  }

  get isOpen() { return !this.el.hidden; }

  open(kind, id) {
    const same = this.isOpen && this.kind === kind && this.id === id;
    this.kind = kind; this.id = id;
    if (!same) { this.charts = null; this.headKey = null; this.params = {}; this.body.innerHTML = '<p class="dmuted">Cargando…</p>'; this.head.innerHTML = ''; }
    if (!this.isOpen) {
      this.el.hidden = false;
      animate(this.el, { opacity: [0, 1], translateX: [40, 0], duration: 350, ease: 'outExpo' });
    }
    clearInterval(this.timer);
    this.load();
    this.timer = setInterval(() => this.load(), kind === 'analytics' ? 60000 : 2500); // la analitica cambia despacio
  }

  close() {
    if (!this.isOpen) return;
    clearInterval(this.timer);
    animate(this.el, { opacity: 0, translateX: 40, duration: 250, ease: 'inQuad', onComplete: () => { this.el.hidden = true; } });
    this.kind = this.id = null;
    if (this.onClose) this.onClose();
  }

  async load() {
    const kind = this.kind, id = this.id;
    if (kind === 'events') { if (this.eventsProvider) this.renderEvents(this.eventsProvider()); return; }
    let d;
    try {
      const extra = (this.params && this.params.path ? `&path=${encodeURIComponent(this.params.path)}` : '') + (kind === 'analytics' ? `&range=${this.anaRange || 30}` : '');
      const r = await fetch(`api/detail?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}${extra}`);
      if (r.status === 401) { location.href = 'login'; return; }
      d = r.ok ? await r.json() : null;
      if (d) { withFavicons([d]); withFavicons(d.apps); withFavicons(d.sites); } // favicons reales (solo llegan en privado)
    } catch (e) { console.error('[detalle]', e); if (kind === this.kind && id === this.id) this.body.innerHTML = '<p class="dmuted">No se pudo cargar el detalle. Se reintenta solo en unos segundos.</p>'; return; }
    if (kind !== this.kind || id !== this.id) return; // ya se abrio otra cosa
    if (!d) {
      clearInterval(this.timer);
      this.body.innerHTML = '<p class="dmuted">Este elemento ya no existe (la sesión terminó o el servicio se retiró).</p>';
      return;
    }
    try { this.render(d); } catch (e) { console.error('[detalle]', kind, e); if (window.atalayaReport) window.atalayaReport(e.message, 'ficha ' + kind); this.body.innerHTML = '<p class="dmuted">No se pudo mostrar este detalle.</p>'; }
  }

  // cabecera con icono pixel; el canvas solo se regenera si cambia
  setHead(key, canvas, title, sub, badge) {
    if (this.headKey !== key) {
      this.headKey = key;
      this.head.innerHTML = '<div class="dicon"></div><div class="dtitles"><h3></h3><p></p></div><div class="dbadge"></div>';
      this.head.querySelector('.dicon').appendChild(canvas);
    }
    this.head.querySelector('h3').textContent = title;
    this.head.querySelector('p').innerHTML = sub;
    this.head.querySelector('.dbadge').innerHTML = badge || '';
  }

  // estructura: graficas persistentes + contenido que se reemplaza en cada refresco
  frame(chartsSpec) {
    if (this.charts) return;
    this.body.innerHTML = `<div class="dcontent"></div>${chartsSpec.map((c, i) => `<section class="dsec"><h4>${c.title}</h4><div class="dchart" id="dch${i}"></div></section>`).join('')}<div class="dcontent2"></div>`;
    this.charts = chartsSpec.map((c, i) => {
      const host = this.body.querySelector('#dch' + i);
      return new uPlot({
        width: host.clientWidth || 300, height: 110, legend: { show: false }, cursor: { points: { size: 7 }, drag: { x: false, y: false } },
        scales: { x: { time: true }, y: { range: c.range || ((u, mn, mx) => [0, Math.max(c.min || 1, (mx || 0) * 1.2)]) } },
        axes: [
          { stroke: '#6b7a93', grid: { show: false }, ticks: { show: false }, font: '10px ui-monospace', size: 20, space: 60,
            values: (u, v) => v.map(x => new Date(x * 1000).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false })) },
          { stroke: '#6b7a93', grid: { stroke: 'rgba(148,163,184,.08)' }, ticks: { show: false }, font: '10px ui-monospace', size: 42, space: 28, values: c.fmt ? (u, v) => v.map(c.fmt) : undefined },
        ],
        series: [{}, ...c.series],
      }, [[], ...c.series.map(() => [])], host);
    });
  }
  setChart(i, rows, fields) {
    if (!this.charts || !this.charts[i]) return;
    this.charts[i].setData([rows.map(r => r.t / 1000), ...fields.map(f => rows.map(r => f(r)))]);
  }
  content(html, html2 = '') {
    const c = this.body.querySelector('.dcontent');
    if (c) c.innerHTML = html; else this.body.innerHTML = html;
    const c2 = this.body.querySelector('.dcontent2');
    if (c2) c2.innerHTML = html2;
  }

  // historial de la cinta (vive en el navegador; se vacia al cambiar de modo)
  renderEvents(list) {
    this.eventsFilter = this.eventsFilter || 'todos';
    const cats = [['todos', 'Todos'], ['agentes', 'Agentes'], ['seguridad', 'Seguridad'], ['servicios', 'Servicios'], ['sitios', 'Sitios'], ['correo', 'Correo']];
    const n = c => c === 'todos' ? list.length : list.filter(e => e.cat === c).length;
    const cv = document.createElement('div'); cv.className = 'dswatch'; cv.innerHTML = px('scroll', 'big');
    this.setHead('events', cv, 'Novedades recientes', `${list.length} evento${list.length === 1 ? '' : 's'} desde que abrió esta pantalla`, '');
    const shown = list.filter(e => this.eventsFilter === 'todos' || e.cat === this.eventsFilter);
    this.content(`<div class="chips">${cats.map(([k, l]) => `<button class="chipbtn ${this.eventsFilter === k ? 'on' : ''}" data-cat="${k}">${l} <b>${n(k)}</b></button>`).join('')}</div>
      <ul class="dlist">${shown.map(e => `<li class="${e.go ? 'link' : ''}" ${e.go ? `data-go="${esc(e.go)}"` : ''}><time>${hhmm(e.t)}</time><span>${px(e.ic)}</span>
        <span class="grow" style="white-space:normal">${e.tag ? `<b style="color:${esc(e.color || 'inherit')}">${esc(e.tag)}</b> · ` : ''}${esc(e.text)}</span></li>`).join('') || '<li class="dmuted">Todavía no hay novedades de este tipo.</li>'}</ul>`);
    this.body.querySelectorAll('[data-cat]').forEach(b => b.addEventListener('click', () => { this.eventsFilter = b.dataset.cat; this.renderEvents(list); }));
  }

  // panel de un indicador de la barra superior
  renderMetric(d) {
    const T = { procs: ['Procesos', 'terminal'], cpu: ['CPU', 'terminal'], mem: ['Memoria', 'library'], disk: ['Disco', 'desk'], load: ['Carga del servidor', 'workshop'], net: ['Red', 'antenna'], req: ['Visitas', 'portal'], err: ['Errores 5xx', 'terminal'] }[d.id] || ['Detalle', 'desk'];
    const s = d.system || {};
    const pctBar = (label, v, total, extra = '') => `<li class="bar"><span class="grow">${label}${extra}</span><span class="bw"><i style="width:${Math.min(100, total ? v / total * 100 : v).toFixed(1)}%;${(total ? v / total * 100 : v) > 85 ? 'background:#f87171' : ''}"></i></span><span class="mono">${total ? fmtBytes(v) : v.toFixed(1) + '%'}</span></li>`;
    const procs = list => `<ul class="dlist">${(list || []).map(p => `<li><span class="mono grow">${esc(p.comm)} <span class="dmuted">×${p.n}</span></span><span class="mono">${p.cpu.toFixed(1)}%</span><span class="mono dmuted">${fmtBytes(p.mem)}</span></li>`).join('')}</ul>`;
    const line = (title, series, fmt, range, min) => ({ title, series: series.map(([stroke, fill]) => ({ stroke, width: 2, fill, points: { show: false } })), fmt, range, min });
    switch (d.id) {
      case 'procs': {
        this.setHead('metric:procs', iconCanvas(T[1], 4), 'Procesos', `${fmtNum(d.procs || 0)} procesos · ${d.cores || '?'} núcleos`, '');
        this.content(`<section class="dsec"><h4>Los que más CPU usan</h4>${procs(d.top)}</section>
          <section class="dsec"><h4>Los que más memoria usan</h4>${procs(d.topMem)}</section>
          <p class="hint">Agrupados por programa (×N = cuántos procesos de ese programa). Para ver la CPU por núcleo: <a data-go="metric:cpu">CPU</a> · memoria: <a data-go="metric:mem">Memoria</a>.</p>`);
        return;
      }
      case 'cpu': {
        this.setHead('metric:cpu', iconCanvas(T[1], 4), 'CPU', `${s.cores} núcleos · carga ${s.load ? s.load[0].toFixed(2) : '–'}`, `<span class="pill ${s.cpu > 90 ? 'bad' : s.cpu > 70 ? 'warn' : 'ok'}">${(s.cpu || 0).toFixed(0)}%</span>`);
        this.frame([line('Uso total · 10 min', [['#22d3ee', 'rgba(34,211,238,.1)']], v => v + '%', [0, 100])]);
        this.setChart(0, d.hist, [r => r.v]);
        const M = { user: 'Programas (usuario)', system: 'Sistema (kernel)', iowait: 'Esperando al disco', steal: 'Robado por el hipervisor', softirq: 'Interrupciones', nice: 'Baja prioridad', irq: 'Interrupciones (hw)' };
        this.content(`<section class="dsec"><h4>En qué se va la CPU</h4><ul class="dlist">${Object.entries(M).map(([k, l]) => pctBar(l, d.modes[k] || 0, 0)).join('')}</ul>
          <p class="hint">${(d.modes.iowait || 0) > 10 ? px('warn') + ' Mucha espera de disco: el cuello de botella es el disco, no la CPU. ' : ''}${(d.modes.steal || 0) > 5 ? px('warn') + ' El proveedor está quitando CPU a esta máquina (steal): otras máquinas del mismo servidor físico la usan.' : ''}</p></section>`,
          `<section class="dsec"><h4>Cada núcleo</h4><div class="cores">${(d.cores || []).map((v, i) => `<div class="core" title="Núcleo ${i}: ${v}%"><i style="height:${v}%;${v > 85 ? 'background:#f87171' : ''}"></i><span>${i}</span></div>`).join('')}</div></section>
          <section class="dsec"><h4>Procesos que más CPU usan</h4>${procs(d.top)}</section>`);
        return;
      }
      case 'mem': {
        const m = d.mem;
        this.setHead('metric:mem', iconCanvas(T[1], 4), 'Memoria', `${fmtBytes(m.total)} en total`, `<span class="pill ${s.mem?.pct > 92 ? 'bad' : s.mem?.pct > 80 ? 'warn' : 'ok'}">${(s.mem?.pct || 0).toFixed(0)}%</span>`);
        this.frame([line('Uso · 10 min', [['#a78bfa', 'rgba(167,139,250,.12)']], v => v + '%', [0, 100])]);
        this.setChart(0, d.hist, [r => r.v]);
        this.content(`<section class="dsec"><h4>Cómo se reparte</h4><ul class="dlist">
            ${pctBar('Programas en uso', m.apps, m.total)}${pctBar('Caché de archivos (se libera sola)', m.cached, m.total)}${pctBar('Búferes', m.buffers, m.total)}
            ${pctBar('Compartida (tmpfs, shm)', m.shmem, m.total)}${pctBar('Libre', m.free, m.total)}</ul>
          <p class="hint">"Disponible" = libre + caché que se puede soltar: <b>${fmtBytes(m.available)}</b>. Es normal que Linux use la memoria libre como caché.</p></section>
          <section class="dsec"><h4>Swap</h4><ul class="dlist">${m.swapTotal ? pctBar('Swap en uso', m.swapUsed, m.swapTotal) : '<li class="dmuted">Sin swap configurada.</li>'}</ul>
          ${m.swapTotal && m.swapUsed / m.swapTotal > .5 ? '<p class="hint">' + px('warn') + ' Mucha swap en uso: al servidor le está faltando memoria.</p>' : ''}</section>`,
          `<section class="dsec"><h4>Procesos que más memoria ocupan</h4>${procs(d.top)}</section>`);
        return;
      }
      case 'disk': {
        const main = d.mounts.find(x => x.mount === '/') || d.mounts[0] || {};
        this.setHead('metric:disk', iconCanvas(T[1], 4), 'Disco', `${d.mounts.length} partición(es) · ${fmtBytes(main.avail || 0)} libres en ${esc(main.mount || '/')}`, `<span class="pill ${main.pct > 90 ? 'bad' : main.pct > 80 ? 'warn' : 'ok'}">${(main.pct || 0).toFixed(0)}%</span>`);
        this.frame([line('Lectura y escritura · 10 min', [['#34d399', 'rgba(52,211,153,.1)'], ['#fbbf24', null]], v => fmtBytes(v) + '/s')]);
        this.setChart(0, d.hist, [r => r.read, r => r.write]);
        this.content(`<section class="dsec"><h4>Particiones</h4><ul class="dlist">${d.mounts.map(x => `<li class="bar"><span class="grow"><b class="mono">${esc(x.mount)}</b> <span class="dmuted">${esc(x.type)} · ${fmtBytes(x.avail)} libres de ${fmtBytes(x.total)}${x.inodesPct > 70 ? ` · ${px('warn')} inodos ${x.inodesPct.toFixed(0)}%` : ''}</span></span>
            <span class="bw"><i style="width:${x.pct.toFixed(1)}%;${x.pct > 85 ? 'background:#f87171' : ''}"></i></span><span class="mono">${x.pct.toFixed(0)}%</span></li>`).join('')}</ul></section>
          <p class="hint">Verde: lectura · ámbar: escritura. Los inodos son la cantidad de archivos; si se agotan, el disco "se llena" aunque quede espacio.</p>`,
          `${this.diskMapHtml(d.map)}<section class="dsec"><h4>Dispositivos ahora</h4><ul class="dlist">${d.io.devices.map(x => `<li><span class="mono grow">${esc(x.dev)}</span><span class="mono">↓ ${fmtBytes(x.read)}/s</span><span class="mono">↑ ${fmtBytes(x.write)}/s</span><span class="mono dmuted">ocupado ${x.util.toFixed(0)}%</span></li>`).join('') || '<li class="dmuted">Sin datos todavía.</li>'}</ul></section>`);
        return;
      }
      case 'load': {
        const L = d.load || [0, 0, 0], c = d.cores || 1;
        this.setHead('metric:load', iconCanvas(T[1], 4), 'Carga del servidor', `${c} núcleos: por debajo de ${c} va holgado`, `<span class="pill ${L[0] > c * 1.5 ? 'bad' : L[0] > c ? 'warn' : 'ok'}">${L[0].toFixed(2)}</span>`);
        this.frame([line('Carga · 10 min', [['#fbbf24', 'rgba(251,191,36,.1)']], v => v.toFixed(1), null, c)]);
        this.setChart(0, d.hist, [r => r.v]);
        this.content(`<div class="dstats">${stat('Último minuto', L[0].toFixed(2), L[0] > c ? 'warn' : '')}${stat('5 minutos', L[1].toFixed(2))}${stat('15 minutos', L[2].toFixed(2))}
            ${stat('Procesos corriendo', d.procs.running)}${stat('Esperando disco o red', d.procs.blocked, d.procs.blocked > c ? 'warn' : '')}${stat('Núcleos', c)}</div>
          <p class="hint">La carga cuenta procesos que quieren CPU (o esperan el disco). ${L[0] > L[2] ? 'Está <b>subiendo</b> respecto a los últimos 15 minutos.' : 'Está <b>bajando o estable</b> respecto a los últimos 15 minutos.'}</p>`,
          `<section class="dsec"><h4>Procesos que más CPU usan</h4>${procs(d.top)}</section>`);
        return;
      }
      case 'net': {
        const tot = d.ifaces.reduce((a, x) => ({ rx: a.rx + x.rx, tx: a.tx + x.tx }), { rx: 0, tx: 0 });
        this.setHead('metric:net', iconCanvas(T[1], 4), 'Red', `↓ ${fmtBytes(tot.rx)}/s · ↑ ${fmtBytes(tot.tx)}/s`, '');
        this.frame([line('Entrada y salida · 10 min', [['#22d3ee', 'rgba(34,211,238,.1)'], ['#f472b6', null]], v => fmtBytes(v) + '/s')]);
        this.setChart(0, d.hist, [r => r.rx, r => r.tx]);
        this.content(`<section class="dsec"><h4>Interfaces</h4><ul class="dlist">${d.ifaces.map(x => `<li><span class="mono grow">${esc(x.name)}</span><span class="mono">↓ ${fmtBytes(x.rx)}/s</span><span class="mono">↑ ${fmtBytes(x.tx)}/s</span><span class="dmuted mono">total ↓ ${fmtBytes(x.rxTotal)} ↑ ${fmtBytes(x.txTotal)}</span></li>`).join('')}</ul>
          <p class="hint">Cian: lo que entra · rosado: lo que sale.</p></section>`,
          `<section class="dsec"><h4>Conexiones TCP</h4><div class="dstats">${Object.entries(d.tcp).sort((a, b) => b[1] - a[1]).map(([k, v]) => stat(k, fmtNum(v))).join('')}</div></section>`);
        return;
      }
      case 'req': case 'err': {
        const isErr = d.id === 'err';
        this.setHead('metric:' + d.id, iconCanvas(T[1], 4), T[0], isErr ? 'Veces que un sitio falló al responder' : 'Peticiones a todos los sitios', `<span class="pill ${isErr ? (d.errMin ? 'bad' : 'ok') : 'ok'}">${fmtNum(isErr ? d.errMin : d.reqMin)}/min</span>`);
        this.frame([line(isErr ? 'Errores cada 10 s' : 'Visitas cada 10 s', [[isErr ? '#ef4444' : '#67e8f9', isErr ? 'rgba(239,68,68,.1)' : 'rgba(103,232,249,.08)']], null, null, 2)]);
        this.setChart(0, d.hist, [r => isErr ? r.err : r.req]);
        const link = x => x.go ? `<a data-go="${esc(x.go)}">${esc(x.name)}</a>` : esc(x.name);
        if (!isErr) {
          const total = d.countries.reduce((n, x) => n + x.n, 0);
          const K = { escritorio: px('laptop') + ' Personas en computadora', movil: px('phone') + ' Personas en celular', 'bot:search': px('search') + ' Buscadores', 'bot:ai': px('brain') + ' Bots de IA',
            'bot:seo': px('chart') + ' Bots de SEO', 'bot:social': px('chat') + ' Redes sociales', 'bot:monitor': px('antenna') + ' Monitores', 'bot:script': px('gear') + ' Scripts', 'bot:other': px('bot') + ' Otros bots', 'bot:system': px('workshop') + ' Sistema' };
          this.content(`<section class="dsec"><h4>Qué recibe más visitas (último minuto)</h4><ul class="dlist">${d.top.length ? bars(d.top.map(x => ({ key: x, n: x.n })), x => `${link(x)}${x.kind && x.kind !== x.name ? ` <span class="dmuted">· ${esc(x.kind)}</span>` : ''}`) : '<li class="dmuted">Sin visitas en el último minuto.</li>'}</ul></section>`,
            `<section class="dsec"><h4>Quién visita · última hora</h4><ul class="dlist">${bars(d.kinds, k => K[k] || esc(k), d.kinds.reduce((n, x) => n + x.n, 0))}</ul></section>
            <section class="dsec"><h4>Desde dónde · última hora</h4><ul class="dlist">${bars(d.countries, k => `${flag(k)} ${esc(countryName(k))}`, total)}</ul></section>`);
        } else {
          this.content(`<section class="dsec"><h4>Qué sitios fallan</h4><ul class="dlist">${d.bySite.length ? bars(d.bySite.map(x => ({ key: x, n: x.n })), x => `${link(x)}${x.kind && x.kind !== x.name ? ` <span class="dmuted">· ${esc(x.kind)}</span>` : ''}`) : '<li class="dmuted">' + px('ok') + ' Ningún error 5xx reciente.</li>'}</ul>
            <p class="hint">Un 5xx es una falla del servidor al responder (la aplicación se cayó, tardó demasiado o tiró una excepción). Los 4xx, como "página no encontrada", no cuentan aquí.</p></section>`,
            `<section class="dsec"><h4>Últimos errores</h4><ul class="dlist">${d.recent.map(e => `<li class="visit"><time>${hhmm(e.t)}</time><span class="flag">${flag(e.cc)}</span><span class="code bad">${e.status}</span>
              <span class="grow">${link(e)}${e.path ? `<br><span class="mono dmuted">${esc(e.method || '')} ${esc(e.domain || '')}${esc(e.path)}</span>` : ''}</span></li>`).join('') || '<li class="dmuted">Sin errores registrados desde que Atalaya arrancó.</li>'}</ul></section>`);
        }
        return;
      }
    }
  }

  // "que ocupa el espacio": categorias, arbol navegable, lo que crecio y archivos grandes
  diskMapHtml(m) {
    if (!m) return '';
    const st = m.status;
    const when = st.finishedAt ? `Último análisis ${ago(Date.now() - st.finishedAt)} atrás (${Math.round((st.durationMs || 0) / 1000)} s${st.by ? ', ' + esc(st.by) : ''})` : 'Todavía no se analizó el disco.';
    const head = `<section class="dsec"><h4>¿Qué ocupa el espacio?</h4>
      <div class="row dmrow"><span class="grow dmuted">${st.running ? `⏳ Analizando ${esc(st.running.mount)}… (prioridad mínima: no afecta a los sitios)` : when}</span>
      ${st.running ? '' : '<button class="btn small" data-analyze>Analizar ahora</button>'}</div>
      <p class="hint">Es una tarea pesada: corre solo cuando la pide un dueño, de a una por vez y con la prioridad más baja. Se listan carpetas y archivos de ${esc(st.threshold)} o más.</p></section>`;
    const cats = m.categories.length ? `<section class="dsec"><h4>Por tipo</h4><ul class="dlist">${m.categories.map(c => `<li class="catrow">
        <span class="grow"><b>${esc(c.label)}</b> <span class="dmuted">· ${c.n} carpeta${c.n === 1 ? '' : 's'}</span>${c.id === 'db' ? ' · <a data-go="databases:all">auditar bases</a>' : ''}<br><span class="dmuted">${esc(c.tip)}</span>
        ${c.paths ? `<br>${c.paths.map(x => `<a class="mono" data-dir="${esc(x.path)}">${esc(x.path)}</a> <span class="dmuted">${fmtBytes(x.size)}</span>`).join(' · ')}` : ''}</span>
        <span class="mono"><b>${fmtBytes(c.size)}</b></span></li>`).join('')}</ul></section>` : '';
    if (!m.tree) return head + cats + (st.finishedAt ? '<p class="dmuted">Active el modo privado para ver las carpetas y archivos concretos.</p>' : '');
    const t = m.tree;
    const crumbs = t.dir === '/' ? ['/'] : ['/', ...t.dir.split('/').filter(Boolean).map((_, i, a) => '/' + a.slice(0, i + 1).join('/'))];
    const tree = `<section class="dsec"><h4>Explorar</h4>
      <div class="crumbs">${crumbs.map((c, i) => `<a data-dir="${esc(c)}">${i === 0 ? '/' : esc(c.split('/').pop())}</a>`).join('<span>›</span>')}
        <span class="dmuted mono">· ${fmtBytes(t.size)}${t.prevSize != null && Math.abs(t.size - t.prevSize) > 50 * 1048576 ? ` (${t.size > t.prevSize ? '+' : ''}${fmtBytes(t.size - t.prevSize)} desde el anterior)` : ''}</span></div>
      <ul class="dlist">${t.children.map(x => `<li class="bar ${x.more ? 'link' : ''}" ${x.more ? `data-dir="${esc(x.path)}"` : ''}>
          <span class="grow">${px(x.file ? 'page' : 'folder')} <span class="mono">${esc(x.name)}</span></span>
          <span class="bw"><i style="width:${(x.size / t.size * 100).toFixed(1)}%"></i></span><span class="mono">${fmtBytes(x.size)}</span><span class="dmuted mono pct">${(x.size / t.size * 100).toFixed(0)}%</span></li>`).join('')}
        ${t.rest > 0 ? `<li><span class="grow dmuted">Otros (cada uno menor que el umbral)</span><span class="mono dmuted">${fmtBytes(t.rest)}</span></li>` : ''}</ul></section>`;
    const growth = m.growth && m.growth.length ? `<section class="dsec"><h4>Qué cambió desde el análisis anterior</h4><ul class="dlist">${m.growth.map(g => `<li class="link" data-dir="${esc(g.path)}">
        <span class="grow mono">${esc(g.path)}</span><span class="mono ${g.delta > 0 ? 'upd' : 'dnd'}">${g.delta > 0 ? '▲ +' : '▼ '}${fmtBytes(Math.abs(g.delta))}</span><span class="mono dmuted">${fmtBytes(g.size)}</span></li>`).join('')}</ul></section>` : '';
    const files = m.files && m.files.length ? `<section class="dsec"><h4>Archivos más grandes</h4><ul class="dlist">${m.files.map(f => `<li>
        <span class="grow mono" title="${esc(f.path)}">${esc(f.path)}</span><span class="dmuted">${f.mtime ? new Date(f.mtime).toLocaleDateString('es-VE') : ''}</span><span class="mono"><b>${fmtBytes(f.size)}</b></span></li>`).join('')}</ul></section>` : '';
    return head + cats + growth + tree + files;
  }

  render(d) {
    switch (d.kind) {
      case 'metric': return this.renderMetric(d);
      case 'app': this.renderApp(d); return this.probesLine(d);
      case 'site': this.renderSite(d); return this.probesLine(d);
      case 'session': return this.renderSession(d);
      case 'district': return this.renderDistrict(d);
      case 'system': return this.renderSystem(d);
      case 'security': return this.renderSecurity(d);
      case 'webdef': return this.renderWebdef(d);
      case 'jail': return this.renderJail(d);
      case 'prisoner': return this.renderPrisoner(d);
      case 'analytics': return this.renderAnalytics(d);
      case 'mail': return this.renderMail(d);
      case 'databases': return this.renderDatabases(d);
      case 'database': return this.renderDatabase(d);
      case 'projects': return this.renderProjects(d);
      case 'audit': return this.renderAudit(d);
      case 'project': return this.renderProject(d);
    }
  }

  // bloque comun de trafico: resumen de la hora, rankings y ultimas visitas
  trafficHtml(d) {
    const st = d.stats;
    const priv = !!(st && st.paths);
    // personas (sin robots) en los ultimos 5 minutos y hoy, contadas en vivo
    const live = d.visitorsNow != null ? `<div class="dstats">${stat('Visitantes ahora', fmtNum(d.visitorsNow), d.visitorsNow ? 'ok' : '')}${stat('Visitas de hoy', fmtNum(d.today ? d.today.visits : 0))}${stat('Visitantes de hoy', fmtNum(d.today ? d.today.visitors : 0))}</div>` : '';
    const hour = live + (st ? `<div class="dstats">${stat('Visitas · última hora', fmtNum(st.total))}${stat('Robots', st.total ? Math.round(st.bots / st.total * 100) + '%' : '–')}${stat('Errores 5xx', st.errors, st.errors ? 'bad' : '')}</div>` : '');
    const rank = st ? `
      <section class="dsec"><h4>Países · última hora</h4><ul class="dlist">${bars(st.countries, k => `${flag(k)} ${esc(countryName(k))}`, st.total)}</ul></section>
      <section class="dsec"><h4>Navegadores y robots</h4><ul class="dlist">${bars(st.agents, k => esc(k), st.total)}</ul></section>
      ${priv ? `<section class="dsec"><h4>Páginas más pedidas</h4><ul class="dlist">${bars(st.paths, k => `<span class="mono">${esc(k)}</span>`)}</ul></section>
      <section class="dsec"><h4>De dónde llegan (referer)</h4><ul class="dlist">${bars(st.refs, k => esc(k))}</ul></section>
      ${st.domains && st.domains.length > 1 ? `<section class="dsec"><h4>Visitas por dominio</h4><ul class="dlist">${bars(st.domains, k => esc(k))}</ul></section>` : ''}` : ''}` : '';
    const recent = d.recent.length ? d.recent.map(r => `<li class="visit"><time>${hhmm(r.t)}</time><span class="flag" title="${esc(countryName(r.cc))}">${flag(r.cc)}</span>
        <span class="code ${httpCls(r.status)}">${r.status}</span><span class="mono">${esc(r.method)}</span>
        <span class="grow">${r.path ? `<span class="mono">${esc(r.path)}</span>` : esc(r.ua || (r.bot ? 'Robot' : 'Visita'))}${r.domain ? `<br><span class="dmuted">${esc(r.domain)}${r.ref ? ' · desde ' + esc(r.ref.replace(/^https?:\/\//, '').slice(0, 60)) : ''}</span>` : ''}</span>
        <span class="vua">${px(r.bot ? 'bot' : r.mobile ? 'phone' : 'laptop')} ${esc(r.ua || '')}${r.ip ? `<br><span class="mono dmuted">${esc(r.ip)}</span>` : ''}</span></li>`).join('')
      : '<li class="dmuted">Sin visitas desde que se abrió este panel o se reinició Atalaya.</li>';
    return { hour: cfWarn(d) + anaCard(d) + hour, rank, recent: `<section class="dsec"><h4>Últimas visitas</h4><ul class="dlist">${recent}</ul></section>` };
  }

  // analitica completa de un sitio o app: periodo, cifras con comparacion, grafica por dia y de donde llegan
  renderAnalytics(d) {
    // lo que mide el script opcional: tiempo real, rebote real, lectura y conversiones; si no esta, como instalarlo
    const anaScript = d => {
      const J = d.js, KIND = { whatsapp: 'WhatsApp', llamada: 'Llamadas', correo: 'Correos', formulario: 'Formularios enviados', descarga: 'Descargas', externo: 'Enlaces a otros sitios', propio: 'Eventos propios' };
      const mmss = s => s == null ? '–' : s < 60 ? s + ' s' : Math.floor(s / 60) + ' min ' + String(s % 60).padStart(2, '0') + ' s';
      if (J) return `<section class="dsec"><h4>${px('bolt')} Lo que hacen en la página</h4>
        <div class="anakpi"><div><span>Tiempo en la página</span><b>${mmss(J.avgSecs)}</b></div><div><span>Rebote real</span><b>${J.bounce == null ? '–' : Math.round(J.bounce * 100) + '%'}</b></div>
        <div><span>Cuánto leen</span><b>${J.scroll == null ? '–' : J.scroll + '%'}</b></div><div><span>Conversiones</span><b>${fmtNum(J.conv)}</b></div></div>
        <p class="hint">Del script de Atalaya: tiempo con la página a la vista; rebote real = entró y se fue en menos de 10 segundos sin tocar nada.</p>
        ${J.convKinds.length ? `<h5 class="anasub">Conversiones</h5><ul class="dlist">${bars(J.convKinds.map(x => ({ key: x.name, n: x.n })), k => esc(KIND[k] || k), J.conv)}</ul>` : ''}
        ${!d.private && J.convPages.length ? `<h5 class="anasub">Dónde convierten</h5><ul class="dlist">${bars(J.convPages.map(x => ({ key: x.name, n: x.n })), k => `<span class="mono">${esc(k)}</span>`)}</ul>` : ''}
        ${!d.private && J.times.length ? `<h5 class="anasub">Tiempo por página</h5><ul class="dlist">${J.times.map(x => `<li><span class="mono">${esc(x.name)}</span><b>${mmss(x.secs)}</b></li>`).join('')}</ul>` : ''}</section>`;
      if (d.private || !d.siteToken) return '';
      const snippet = `<script defer src="${new URL('a.js', location.href).href}" data-site="${d.siteToken}"></script>`;
      return `<section class="dsec"><h4>${px('bolt')} Mida más: tiempo real, rebote real y conversiones</h4>
        <p class="hint">Opcional. Pegue esta línea en el sitio (antes de &lt;/head&gt;) y la analítica suma el tiempo que la página estuvo a la vista, cuánto leen, el rebote real y las conversiones: clics en WhatsApp, llamadas, correos, formularios, descargas y enlaces externos. Sin cookies ni aviso de cookies: no guarda nada en el navegador ni datos de sus visitantes.</p>
        <div class="copy"><pre class="cmd">${esc(snippet)}</pre><button class="btn small" data-copy="${esc(snippet)}">Copiar</button></div>
        <p class="hint">Para contar algo propio (una compra, una reserva): <span class="mono">atalaya('event', 'compra')</span>. En WordPress, péguela con un plugin de código para la cabecera o en el tema.</p></section>`;
    };
    // el informe mensual (solo en privado): a quien le llega, si esta activo y un envio de prueba
    const anaReport = d => { const M = d.monthly, id = d.id;
      return `<section class="dsec anarep" data-id="${esc(id)}"><h4>${px('mail')} Informe mensual por correo</h4>
        <p class="hint">El día 1 de cada mes, sus clientes reciben el mes anterior de este sitio: un resumen en palabras, visitantes, de dónde llegan, sus páginas, países y dispositivos, comparado con el mes previo.${M.lastSent ? ` Último enviado: ${esc(M.lastSent)}.` : ''}</p>
        ${M.mail ? '' : '<p class="dmuted">Para enviarlo, primero conecte un correo en menú › Alertas: el informe sale desde ahí.</p>'}
        <p class="row"><input type="text" inputmode="email" placeholder="cliente@ejemplo.com, otro@ejemplo.com" value="${esc(M.to.join(', '))}" aria-label="Correos que reciben el informe" style="flex:1 1 16rem;min-width:0"></p>
        <p class="row"><label><input type="checkbox" ${M.active || !M.to.length ? 'checked' : ''}> Enviar cada mes</label></p>
        <p class="row"><button class="btn small" data-report="save">Guardar</button><button class="btn small ghost" data-report="send" ${M.mail ? '' : 'disabled'}>Enviar el de ${esc(M.monthLabel)} ahora</button></p>
        <p class="anarep-out dmuted" role="status"></p></section>`; };
    this.setHead('analytics:' + d.id, iconCanvas('chart', 4), 'Analítica', `${esc(d.name || '')}${d.go ? ` · <a data-go="${esc(d.go)}">volver a la ficha</a>` : ''}`, '');
    const T = d.totals, P = d.prev, range = d.range;
    const RANGES = [[1, 'Hoy'], [7, '7 días'], [30, '30 días'], [90, '90 días'], [365, '12 meses']];
    const delta = (a, b, inverse) => {
      if (b == null || a == null || !d.comparable) return '';
      if (!b) return a ? '<small class="up">nuevo</small>' : '';
      const p = Math.round((a - b) / b * 100); if (!p) return '<small class="dmuted">igual</small>';
      const good = inverse ? p < 0 : p > 0;
      return `<small class="${good ? 'up' : 'down'}">${p > 0 ? '+' : ''}${p}%</small>`;
    };
    const pct = x => x == null ? '–' : Math.round(x * 100) + '%';
    const vs = range === 1 ? 'que ayer' : `que los ${range} días anteriores`;
    const kpis = `<div class="anakpi">
      <div><span>Visitantes</span><b>${fmtNum(T.visitors)}</b>${delta(T.visitors, P.visitors)}</div>
      <div><span>Páginas vistas</span><b>${fmtNum(T.pv)}</b>${delta(T.pv, P.pv)}</div>
      <div><span>Páginas por visita</span><b>${T.pagesPerVisit == null ? '–' : T.pagesPerVisit.toFixed(1)}</b>${delta(T.pagesPerVisit, P.pagesPerVisit)}</div>
      <div><span>Rebote</span><b>${pct(T.bounce)}</b>${delta(T.bounce, P.bounce, true)}</div></div>
      <p class="hint">${d.comparable ? `Comparado con ${vs}.` : range === 1 ? `Hoy hasta las ${new Date().toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false })}.` : `Sin comparación todavía: Atalaya empezó a medir ${d.since ? 'el ' + new Date(d.since + 'T12:00:00').toLocaleDateString('es-VE', { day: 'numeric', month: 'short' }) : 'hoy'}.`} Robots aparte: ${fmtNum(T.bots)} peticiones${T.hits ? ` (${Math.round(T.bots / T.hits * 100)}% del total)` : ''}.</p>`;
    const tabs = `<div class="anatabs" role="tablist">${RANGES.map(([n, l]) => `<button class="${n === range ? 'on' : ''}" data-ana-range="${n}">${l}</button>`).join('')}</div>`;
    const list = (arr, fmt, total, empty) => arr && arr.length ? `<ul class="dlist">${bars(arr.map(x => ({ key: x.name, n: x.n })), fmt, total)}</ul>` : `<p class="dmuted">${empty || 'Sin datos en este período.'}</p>`;
    const SRC = { search: 'Buscadores', social: 'Redes sociales', ai: 'Asistentes de IA', referral: 'Otros sitios', direct: 'Directo o sin referencia' };
    const srcTotal = d.sources.reduce((a, x) => a + x.n, 0);
    const devTotal = d.dev.reduce((a, x) => a + x.n, 0);
    const maxH = Math.max(1, ...T.hours);
    const hours = `<div class="anahours">${T.hours.map((n, h) => `<i style="height:${Math.max(2, Math.round(n / maxH * 100))}%" title="${h}:00 · ${fmtNum(n)} páginas"></i>`).join('')}</div><div class="anahlab"><span>0 h</span><span>6 h</span><span>12 h</span><span>18 h</span><span>23 h</span></div>`;
    const priv = !d.private;
    this.content(`${tabs}${kpis}<section class="dsec"><h4>Visitantes por ${range === 1 ? 'hora' : 'día'}</h4>${range === 1 ? hours : anaChart(d.series)}</section>
      <section class="dsec"><h4>De dónde llegan</h4>${list(d.sources, k => esc(SRC[k] || k), srcTotal)}
        ${d.search.length ? `<h5 class="anasub">Buscadores</h5>${list(d.search, k => esc(k))}` : ''}
        ${d.social.length ? `<h5 class="anasub">Redes sociales</h5>${list(d.social, k => esc(k))}` : ''}
        ${priv && d.refs.length ? `<h5 class="anasub">Sitios que lo enlazan</h5>${list(d.refs, k => `<span class="mono">${esc(k)}</span>`)}` : ''}</section>
      ${priv ? `<section class="dsec"><h4>Páginas más vistas</h4>${list(d.pages, k => `<span class="mono">${esc(k)}</span>`, T.pv)}</section>
      <section class="dsec"><h4>Páginas de entrada</h4><p class="hint">La primera página que ve cada visitante: por donde lo encuentran.</p>${list(d.entries, k => `<span class="mono">${esc(k)}</span>`, T.visitors)}</section>
      ${d.campaigns.length ? `<section class="dsec"><h4>Campañas (utm)</h4>${list(d.campaigns, k => esc(k), T.visitors)}</section>` : ''}` : ''}
      <section class="dsec"><h4>Países</h4>${list(d.cc, k => `${flag(k)} ${esc(countryName(k))}`, T.visitors)}</section>
      <section class="dsec"><h4>Dispositivos</h4>${list(d.dev, k => `${px(k === 'movil' ? 'phone' : 'laptop')} ${k === 'movil' ? 'Celular o tableta' : 'Computadora'}`, devTotal)}
        <h5 class="anasub">Navegadores</h5>${list(d.browsers, k => esc(k), T.visitors)}<h5 class="anasub">Sistemas</h5>${list(d.os, k => esc(k), T.visitors)}</section>
      ${range > 1 ? `<section class="dsec"><h4>A qué hora llegan</h4>${hours}</section>` : ''}
      ${priv && d.notFound.length ? `<section class="dsec"><h4>Páginas que no existen</h4><p class="hint">Personas (no robots) que llegaron a un error 404: enlaces rotos o páginas que se movieron. Una redirección las recupera.</p>${list(d.notFound, k => `<span class="mono">${esc(k)}</span>`)}</section>` : ''}
      ${d.botNames.length ? `<section class="dsec"><h4>Robots que más la visitan</h4>${list(d.botNames, k => esc(k))}</section>` : ''}
      ${d.private ? '<p class="dmuted">Active el modo privado para ver las páginas, los sitios que la enlazan, las campañas y los errores 404.</p>' : ''}
      ${d.cfOnly ? cfWarn(d) : ''}
      ${anaScript(d)}
      ${d.monthly ? anaReport(d) : ''}
      <p class="hint">${d.since ? `Se mide desde el ${new Date(d.since + 'T12:00:00').toLocaleDateString('es-VE', { day: 'numeric', month: 'long', year: 'numeric' })}. ` : ''}Sin cookies ni código en el sitio: sale de los registros del servidor, por eso cuenta también a quien usa bloqueador de anuncios. Un visitante es la misma IP y navegador en el día; rebote, quien vio una sola página.</p>`);
  }

  renderApp(d) {
    const SRC = { pm2: 'Proceso PM2', systemd: 'Servicio systemd', docker: 'Contenedor Docker', vercel: 'Proyecto Vercel', supabase: 'Proyecto Supabase', cloudflare: d.cfKind === 'worker' ? 'Worker de Cloudflare' : 'Proyecto de Cloudflare Pages', beat: 'Latido' };
    this.setHead('app:' + d.id + d.icon, signCanvas(d.icon, 4), d.name || d.category,
      `${esc(d.name !== d.category ? d.category : '')}${d.name !== d.category && d.category ? ' · ' : ''}${SRC[d.source] || ''} · <a data-go="district:${esc(d.account)}">${esc(d.accountLabel)}</a>`,
      `<span class="pill ${statusCls(d.status)}">${STATUS_LABEL[d.status] || d.status}</span>`);
    // en Cloudflare no hay CPU ni memoria que medir: la ficha va sin graficas
    this.frame(d.source === 'cloudflare' || d.source === 'beat' ? [] : [
      { title: 'CPU · 10 min', series: [{ stroke: '#22d3ee', width: 2, fill: 'rgba(34,211,238,.1)', points: { show: false } }], min: 5, fmt: v => v + '%' },
      { title: 'Memoria · 10 min', series: [{ stroke: '#a78bfa', width: 2, fill: 'rgba(167,139,250,.1)', points: { show: false } }], min: 1, fmt: v => fmtBytes(v * 1048576) },
      { title: 'Visitas cada 10 s', series: [{ stroke: '#67e8f9', width: 2, points: { show: false } }, { stroke: '#ef4444', width: 2, points: { show: false } }], min: 2 },
    ]);
    this.setChart(0, d.hist, [r => r.cpu]);
    this.setChart(1, d.hist, [r => Math.round(r.mem / 1048576)]);
    this.setChart(2, d.req, [r => r.req, r => r.err]);
    const priv = d.port !== undefined || d.domains;
    const top = d.source === 'cloudflare' || d.source === 'beat' ? '' : `<div class="dstats">
        ${stat('CPU', d.cpu.toFixed(1) + '%')}${stat('Memoria', fmtBytes(d.mem))}${stat('Visitas / min', fmtNum(d.reqMin))}
        ${stat('Instancias', `${d.online}/${d.instances}`, d.online < d.instances ? 'bad' : '')}${stat('En línea hace', d.uptime ? dur(d.uptime) : '–')}
        ${stat('Reinicios vistos', d.restarts, d.restarts ? 'warn' : '')}
      </div>
      ${priv ? `<section class="dsec"><h4>Ficha técnica</h4><dl class="dkv">
        ${d.source === 'systemd' ? `<dt>Unidad</dt><dd class="mono">${esc(d.unit)}${d.substate ? ` · ${esc(d.substate)}` : ''}</dd>
          <dt>Usuario</dt><dd>${esc(d.user || 'root')}</dd>${d.description ? `<dt>Descripción</dt><dd>${esc(d.description)}</dd>` : ''}
          <dt>Comando</dt><dd class="mono">${esc(d.exec || '')}</dd><dt>Reinicios</dt><dd>${esc(d.restartsTotal ?? 0)} desde que arrancó systemd</dd>` : ''}
        ${d.source === 'docker' ? `<dt>Imagen</dt><dd class="mono">${esc(d.image)}</dd><dt>Contenedor</dt><dd class="mono">${esc(d.containerId)} · ${esc(d.substate)}</dd>
          ${d.compose ? `<dt>Compose</dt><dd>${esc(d.compose)}${d.service ? ' · ' + esc(d.service) : ''}</dd>` : ''}
          ${d.ports && d.ports.length ? `<dt>Puertos</dt><dd>${d.ports.map(x => `<span class="chip">${esc(x)}</span>`).join(' ')}</dd>` : ''}
          <dt>Reinicios</dt><dd>${esc(d.restartsTotal ?? 0)}</dd>` : ''}
        ${d.pm2 ? `<dt>Proceso PM2</dt><dd>${esc(d.pm2)}${d.mode ? ' · ' + esc(d.mode.replace('_mode', '')) : ''}</dd>` : ''}
        ${d.port ? `<dt>Puerto</dt><dd>${esc(d.port)}</dd>` : ''}
        ${d.cwd ? `<dt>Carpeta</dt><dd class="mono">${esc(d.cwd)}</dd>` : ''}
        ${d.domains?.length ? `<dt>Dominios</dt><dd>${d.domains.map(x => `<span class="chip">${esc(x)}</span>`).join(' ')}</dd>` : ''}
      </dl></section>` : `${d.image ? `<p class="dmuted">Imagen: <span class="mono">${esc(d.image)}</span></p>` : ''}<p class="dmuted">Active el modo privado para ver el proyecto, sus dominios, carpeta, puerto y las IPs y páginas de cada visita.</p>`}`;
    // Vercel: despliegues recientes; Supabase: salud de la base de datos
    const DEP = { READY: ['ok', 'listo'], ERROR: ['bad', 'falló'], CANCELED: ['off', 'cancelado'], BUILDING: ['waiting', 'construyendo'], QUEUED: ['waiting', 'en cola'], INITIALIZING: ['waiting', 'iniciando'] };
    const cloud = d.source === 'cloudflare' ? cfHtml(d, DEP) : d.source === 'vercel' ? `<section class="dsec"><h4>Despliegues recientes</h4><ul class="dlist">${(d.deployments || []).map(x => `<li>
        <time>${hhmm(x.created)}</time><span class="pill ${(DEP[x.state] || ['off'])[0]}">${(DEP[x.state] || ['', x.state])[1]}</span><span class="chip">${x.target === 'production' ? 'producción' : 'preview'}</span>
        <span class="grow">${x.commit ? esc(x.commit) : ''}${x.branch ? ` <span class="dmuted mono">${esc(x.branch)}</span>` : ''}${x.creator ? ` <span class="dmuted">· ${esc(x.creator)}</span>` : ''}</span></li>`).join('') || '<li class="dmuted">Sin despliegues todavía.</li>'}</ul></section>
      ${d.framework ? `<p class="dmuted">Framework: ${esc(d.framework)}${d.domains && d.domains.length ? ' · ' + d.domains.map(x => `<span class="chip">${esc(x)}</span>`).join(' ') : ''}</p>` : ''}`
      : d.source === 'supabase' ? `<div class="dstats">${stat('Disco', d.disk ? `${d.disk.pct.toFixed(0)}% de ${fmtBytes(d.disk.total)}` : '–', d.disk && d.disk.pct > 85 ? 'warn' : '')}
        ${stat('Memoria total', d.memTotal ? fmtBytes(d.memTotal) : '–')}${stat('Conexiones (pooler)', d.pooler ?? '–')}${stat('Conexiones a Postgres', d.dbConns ?? '–')}
        ${stat('Tamaño de la base', d.dbSize ? fmtBytes(d.dbSize) : '–')}${stat('Reinicios de Postgres', d.restartsTotal ?? 0, d.restartsTotal ? 'warn' : '')}</div>
        <p class="dmuted">${d.metrics ? `${d.metrics} métricas · última lectura ${d.lastScrape ? ago(Date.now() - d.lastScrape) : '–'}` : 'Sin métricas todavía (se leen cada minuto).'}${d.region ? ' · región ' + esc(d.region) : ''}${d.ref ? ` · <span class="mono">${esc(d.ref)}</span>` : ''}</p>` + sbMail(d) : '';
    const tr = this.trafficHtml(d);
    const events = d.events.length ? d.events.slice().reverse().map(e => `<li><time>${hhmm(e.t)}</time><span>${e.action === 'down' ? px('fire') + ' Se cayó' : px('refresh') + ' Se reinició'}</span></li>`).join('')
      : '<li class="dmuted">Sin reinicios ni caídas desde que Atalaya lo vigila.</li>';
    if (d.source === 'beat') return this.content(beatHtml(d));
    if (d.source === 'cloudflare') return this.content(top + cloud);
    this.content(top + cloud + tr.hour, `${tr.rank}${tr.recent}
      <section class="dsec"><h4>Reinicios y caídas</h4><ul class="dlist">${events}</ul></section>`);
  }

  renderSite(d) {
    const priv = !!d.domains;
    this.setHead('site:' + d.id + d.icon, signCanvas(d.icon, 4), d.name || d.category,
      `${esc(d.category)} · <a data-go="district:${esc(d.account)}">${esc(d.accountLabel)}</a>`,
      d.avail ? `<span class="pill ${d.avail.ok === false ? 'bad' : d.avail.ok ? 'ok' : 'waiting'}">${d.avail.ok === false ? 'no responde' : d.avail.ok ? 'responde' : 'midiendo'}</span>` : `<span class="pill ok">${esc(TYPE_LABEL[d.type] || d.type)}</span>`);
    this.frame([{ title: 'Visitas cada 10 s', series: [{ stroke: '#67e8f9', width: 2, points: { show: false } }, { stroke: '#ef4444', width: 2, points: { show: false } }], min: 2 }]);
    this.setChart(0, d.req, [r => r.req, r => r.err]);
    const tr = this.trafficHtml(d);
    const ficha = priv ? `<section class="dsec"><h4>Ficha técnica</h4><dl class="dkv">
        <dt>Tipo</dt><dd>${esc(TYPE_LABEL[d.type] || d.type)}${d.wpVersion ? ` · WordPress ${esc(d.wpVersion)}` : ''}${d.proxyPort ? ` · puerto ${esc(d.proxyPort)}` : ''}</dd>
        ${d.docroot ? `<dt>Carpeta</dt><dd class="mono">${esc(d.docroot)}</dd>` : ''}${d.avail ? `<dt>Se visita</dt><dd class="mono">${esc(d.avail.url)}</dd>` : ''}
        <dt>Dominios</dt><dd>${d.domains.map(x => `<span class="chip">${esc(x)}</span>`).join(' ')}</dd>
        <dt>Última visita</dt><dd>${d.lastSeen ? new Date(d.lastSeen).toLocaleString('es-VE', { hour12: false }) : '–'}</dd>
      </dl></section>` : `<p class="dmuted">Active el modo privado para ver sus dominios, carpeta y las IPs y páginas de cada visita.</p>`;
    this.content(`<div class="dstats">${stat('Visitas / min', fmtNum(d.reqMin))}${stat('Tipo', esc(TYPE_LABEL[d.type] || d.type))}${stat('Última visita', d.lastSeen ? ago(Date.now() - d.lastSeen) : '–')}</div>${tr.hour}${ficha}`,
      `${tr.rank}${tr.recent}`);
  }

  renderSession(d) {
    const priv = d.title !== undefined;
    const title = priv && d.title ? d.title : `Agente · ${d.accountLabel}`;
    this.setHead('session:' + d.id, robotCanvas(d.color, 4), title,
      `${d.target ? `<a data-go="${esc(d.target.go)}"><b>${esc(d.target.name)}</b></a> · ` : ''}cuenta <a data-go="district:${esc(d.account)}">${esc(d.accountLabel)}</a>${priv && d.project ? ` · <span class="mono">${esc(d.project)}</span>` : ''}${d.model ? ' · ' + esc(d.model) : ''}`,
      `<span class="pill ${d.state}">${STATE_LABEL[d.state] || d.state}</span>`);
    const wait = d.waitKind ? `<div class="dwait">${px('ask')} ${WAIT_LABEL[d.waitKind] || 'Lo espera'} desde hace ${ago(Date.now() - d.waitSince)}${priv && d.tool ? ` · <b>${esc(d.tool)}</b>` : ''}${priv && d.detail ? `: ${esc(d.detail)}` : ''}${priv && d.waitMessage ? `<br><span class="dmuted">${esc(d.waitMessage)}</span>` : ''}</div>` : '';
    const now = d.state === 'idle' ? `Sin actividad hace ${ago(Date.now() - d.lastActivity)}` : (priv && d.detail ? `<b>${esc(d.tool || '')}</b> ${esc(d.detail)}` : esc(d.activity));
    const subs = d.subagents.length ? `<section class="dsec"><h4>Subagentes (${d.subagents.length})</h4><ul class="dlist">${d.subagents.map(x =>
      `<li><span class="pill ${x.state}">${STATE_LABEL[x.state] || x.state}</span><span class="grow">${esc(priv ? (x.title || x.agentType || 'subagente') : x.activity)}</span><span class="dmuted mono">${fmtNum(x.tokensOut)} tk</span></li>`).join('')}</ul></section>` : '';
    const ACT = { tool: null, prompt: px('chat'), permission: px('ask'), approved: px('thumb'), done: px('ok'), error: px('warn'), spawn: px('portal'), despawn: px('portal'), start: px('bot'), compact: px('squeeze') };
    const line = e => {
      switch (e.action) {
        case 'tool': return priv && e.tool ? `<b>${esc(e.tool)}</b> ${esc(e.detail || '')}` : esc(e.activity);
        case 'prompt': return priv && e.text ? `Instrucción: ${esc(e.text)}` : 'Recibió una instrucción';
        case 'permission': return (WAIT_LABEL[e.waitKind] || 'Pidió permiso') + (priv && e.tool ? ` · ${esc(e.tool)}` : '');
        case 'approved': return 'Permiso concedido';
        case 'done': return 'Terminó su turno';
        case 'error': return 'Falló una herramienta' + (priv && e.tool ? ` (${esc(e.tool)})` : '');
        case 'spawn': return 'Creó un subagente' + (priv && e.detail ? `: ${esc(e.detail)}` : '');
        case 'despawn': return 'Un subagente terminó';
        case 'compact': return 'Compactó su memoria';
        case 'start': return 'Se conectó';
        default: return esc(e.action);
      }
    };
    const tl = d.timeline.length ? d.timeline.map(e => `<li class="${e.sub ? 'sub' : ''}"><time>${hhmm(e.t)}</time>
        <span class="tic">${e.action === 'tool' && e.station ? '' : (ACT[e.action] || '•')}</span><span class="grow">${e.sub ? '↳ ' : ''}${line(e)}</span></li>`).join('')
      : '<li class="dmuted">Todavía no hay acciones registradas: aparecen a medida que el agente trabaja.</li>';
    this.content(`${wait}<div class="dstats">
        ${stat('Tokens generados', fmtNum(d.tokensOut))}${stat('Herramientas', d.tools)}${stat('Errores', d.errors, d.errors ? 'warn' : '')}
        ${stat('Activo desde', hhmm(d.since))}${stat('Conexión', d.hooks ? px('bolt') + ' Hooks' : 'Transcript')}${priv && d.permMode ? stat('Permisos', esc(d.permMode)) : stat('Estación', esc(d.activity || '–'))}
      </div>
      <section class="dsec"><h4>Ahora</h4><p class="dnow">${now}</p>${priv && d.lastPrompt ? `<p class="dmuted">Última instrucción: ${esc(d.lastPrompt)}</p>` : ''}</section>
      ${subs}
      <section class="dsec"><h4>Línea de tiempo</h4><ul class="dlist tl">${tl}</ul></section>`);
    // iconos de estacion en la linea de tiempo
    this.body.querySelectorAll('.tl li').forEach((li, i) => {
      const e = d.timeline[i];
      if (e && e.action === 'tool' && e.station) { const cv = iconCanvas(e.station === 'waiting' ? 'desk' : e.station, 2); li.querySelector('.tic').appendChild(cv); }
    });
  }

  renderDistrict(d) {
    const sw = document.createElement('div'); sw.className = 'dswatch'; sw.style.background = d.color;
    const h = d.hosting;
    const sub = h ? (h.kind === 'wordpress' ? `Sitio WordPress${h.wp ? ' ' + esc(h.wp.version) : ''}${h.user ? ` · <span class="mono">${esc(h.user)}</span>` : ''}`
        : h.user ? `Hosting compartido · <span class="mono">${esc(h.user)}@${esc(h.host)}</span>${d.main ? ` · <span class="mono">${esc(d.main)}</span>` : ''}` : 'Hosting compartido')
      : d.cpanel ? `cPanel <b>${esc(d.cpanel)}</b> · <span class="mono">${esc(d.main)}</span>` : `${d.apps.length} servicios · ${d.sites.length} sitios`;
    this.setHead('district:' + d.id, sw, d.label, sub, '');
    if (h) return this.renderHosting(d, h);
    const apps = d.apps.map(a => `<li class="link" data-go="app:${esc(a.id)}"><span class="sico" data-icon="${esc(a.icon)}"></span>
        <span class="grow"><b>${esc(a.name)}</b>${a.name !== a.category && a.category ? ` <span class="dmuted">· ${esc(a.category)}</span>` : ''}${a.domains?.length ? `<br><span class="dmuted mono">${a.domains.map(esc).join(' · ')}</span>` : ''}</span>
        <span class="pill ${statusCls(a.status)}">${STATUS_LABEL[a.status]}</span>${a.source === 'cloudflare' || a.source === 'beat' ? '' : `<span class="mono dmuted">${a.cpu.toFixed(1)}% · ${fmtBytes(a.mem)}</span>`}</li>`).join('');
    const ses = d.sessions.length ? d.sessions.map(x => `<li class="link" data-go="session:${esc(x.id)}"><span class="pill ${x.state}">${STATE_LABEL[x.state]}</span>
        <span class="grow">${esc(x.title || 'Agente de Claude')}</span><span class="dmuted">${esc(x.activity)}</span></li>`).join('') : '<li class="dmuted">Sin agentes en este distrito.</li>';
    const sites = d.sites.length ? d.sites.map(x => `<li class="link" data-go="site:${esc(x.id)}"><span class="sico" data-icon="${esc(x.icon)}"></span>
        <span class="grow"><b>${esc(x.name)}</b>${x.name !== x.category ? ` <span class="dmuted">· ${esc(x.category)}</span>` : ''}${x.domains?.length > 1 ? `<br><span class="dmuted mono">${x.domains.slice(1).map(esc).join(' · ')}</span>` : ''}</span>
        <span class="mono dmuted">${fmtNum(x.reqMin)}/min</span></li>`).join('') : '<li class="dmuted">Sin sitios propios.</li>';
    const CH = { added: [px('wip'), 'Nuevo dominio'], removed: [px('trash'), 'Dominio eliminado'], changed: [px('refresh'), 'Cambió'] };
    const changes = d.changes && d.changes.length ? `<section class="dsec"><h4>Cambios recientes</h4><ul class="dlist">${d.changes.map(c => `<li><time>${hhmm(c.t)}</time><span>${CH[c.action][0]}</span><span class="grow">${CH[c.action][1]}${c.domain ? `: <b class="mono">${esc(c.domain)}</b> <span class="dmuted">${esc(c.what || '')}</span>` : ''}</span></li>`).join('')}</ul></section>` : '';
    // cuota de la cuenta: disco, inodos y ancho de banda del mes (con barra si tiene limite)
    const Q = d.quotas, qrow = (label, x, fmt) => x ? `<li class="${x.limit ? 'bar' : ''}"><span class="grow">${label}</span>${x.limit ? `<span class="bw"><i style="width:${Math.min(100, x.pct * 100).toFixed(1)}%;${x.pct >= 0.85 ? 'background:#f87171' : ''}"></i></span>` : ''}<span class="mono">${fmt(x.used)}${x.limit ? ` / ${fmt(x.limit)}` : ' <span class="dmuted">sin límite</span>'}</span></li>` : '';
    const quotaSec = Q ? `<section class="dsec"><h4>${px('folder')} Cuota de la cuenta</h4><ul class="dlist">${qrow('Disco', Q.disk, fmtBytes)}${qrow('Archivos (inodos)', Q.inodes, n => fmtNum(n))}${qrow('Ancho de banda este mes', Q.bw, fmtBytes)}</ul></section>` : '';
    this.content(`<div class="dstats">${String(d.id || '') === '_sitios' ? '' : stat(d.cloudflare ? 'Proyectos' : String(d.id || '').startsWith('_latidos') ? 'Latidos' : String(d.id || '').startsWith('_supa') ? 'Bases' : String(d.id || '').startsWith('_') ? 'Proyectos' : 'Servicios PM2', d.apps.length)}${d.sites.length || !String(d.id || '').startsWith('_') ? stat('Sitios', d.sites.length) : ''}${stat('Visitas / min', fmtNum(d.reqMin))}</div>${quotaSec}
      ${changes}
      ${d.apps.length || !String(d.id || '').startsWith('_') ? `<section class="dsec"><h4>${d.cloudflare ? 'Proyectos y Workers' : String(d.id || '').startsWith('_latidos') ? 'Latidos' : String(d.id || '').startsWith('_supa') ? 'Bases de datos' : 'Servicios (PM2)'}</h4><ul class="dlist">${apps}</ul></section>` : ''}
      ${d.sites.length || !String(d.id || '').startsWith('_') ? `<section class="dsec"><h4>Sitios web</h4><ul class="dlist">${sites}</ul></section>` : ''}
      <section class="dsec"><h4>Agentes de Claude</h4><ul class="dlist">${ses}</ul></section>
      ${d.cloudflare ? cfDistrict(d.cloudflare) : ''}
      ${d.dbs && d.dbs.length ? `<section class="dsec"><h4>Bases de datos</h4><ul class="dlist">${d.dbs.map(dbRow).join('')}</ul>
        ${d.dbCount > d.dbs.length ? `<p class="dlinks"><a data-go="databases:${esc(d.id)}">Ver las ${d.dbCount} bases</a></p>` : ''}</section>` : ''}`);
    this.body.querySelectorAll('.sico').forEach(el => el.appendChild(signCanvas(el.dataset.icon, 2)));
  }

  // distrito de un hosting compartido (datos que envia el agente por cron)
  renderHosting(d, h) {
    const priv = !!h.user;
    const LV = { warn: px('warn'), info: px('info'), ok: px('ok') };
    const when = t => t ? 'hace ' + ago(Date.now() - t) : '—';
    const quota = h.quota ? (h.quota.limitMB ? `${fmtBytes(h.quota.usedMB * 1048576)} / ${fmtBytes(h.quota.limitMB * 1048576)}` : fmtBytes(h.quota.usedMB * 1048576) + ' (sin límite)') : h.disk ? fmtBytes(h.disk.used) : '–';
    const sites = d.sites.length ? d.sites.map(x => `<li class="link" data-go="site:${esc(x.id)}"><span class="sico" data-icon="${esc(x.icon)}"></span>
        <span class="grow"><b>${esc(x.name)}</b>${x.name !== x.category ? ` <span class="dmuted">· ${esc(x.category)}</span>` : ''}</span><span class="mono dmuted">${fmtNum(x.reqMin)}/min</span></li>`).join('') : '<li class="dmuted">Todavía sin sitios (llegan con el primer envío completo).</li>';
    const findings = h.findings.length ? `<section class="dsec"><h4>Para revisar</h4><ul class="dlist">${h.findings.map(f => `<li><span>${LV[f.level] || ''}</span><span class="grow">${esc(f.text)}</span></li>`).join('')}</ul></section>` : '';
    const usage = h.usage && h.usage.length ? `<section class="dsec"><h4>Uso de recursos (según el panel)</h4><ul class="dlist">${h.usage.map(u => `<li class="bar"><span class="grow">${esc(u.label)}</span>
        ${u.max ? `<span class="bw"><i style="width:${Math.min(100, u.usage / u.max * 100).toFixed(1)}%"></i></span>` : ''}<span class="mono">${u.bytes ? fmtBytes(u.usage) : fmtNum(u.usage)}${u.max ? ' / ' + (u.bytes ? fmtBytes(u.max) : fmtNum(u.max)) : ''}</span></li>`).join('')}</ul></section>` : '';
    const w = h.wp;
    const wpSec = w ? `<section class="dsec"><h4>WordPress</h4><div class="dstats">${stat('Versión', esc(w.version) + (w.coreUpdate ? ` → ${esc(w.coreUpdate)}` : ''), w.coreUpdate ? 'warn' : '')}
        ${stat('PHP', esc(w.php || '–'), w.phpStatus && w.phpStatus.level !== 'ok' ? w.phpStatus.level : '')}${stat('Plugins', `${w.pluginsActive}/${w.plugins} activos`)}
        ${stat('Por actualizar', w.pluginUpdates + w.themeUpdates, w.pluginUpdates + w.themeUpdates ? 'warn' : '')}${stat('Base', w.dbSize ? fmtBytes(w.dbSize) : '–')}${stat('Usuarios', `${w.users} · ${w.admins} admin`)}</div>
        ${w.woocommerce ? `<p class="hint">WooCommerce ${esc(w.woocommerce)}</p>` : ''}
        ${w.pluginList ? `<ul class="dlist">${w.pluginList.map(p => `<li><span class="grow">${esc(p.name)} <span class="dmuted mono">${esc(p.version)}</span>${p.auto ? ' <span class="dmuted">· auto</span>' : ''}</span>
          ${p.update ? `<span class="pill warn">→ ${esc(p.update)}</span>` : ''}<span class="pill ${p.active ? 'ok' : 'off'}">${p.active ? 'activo' : 'inactivo'}</span></li>`).join('')}</ul>` : ''}
        ${w.themeList ? `<p class="hint">Temas: ${w.themeList.map(t => `${esc(t.name)} ${esc(t.version)}${t.active ? ' (activo)' : ''}${t.update ? ` → ${esc(t.update)}` : ''}`).join(' · ')}</p>` : ''}</section>` : '';
    let detail = '';
    if (priv) {
      const ssl = h.ssl.length ? `<section class="dsec"><h4>Certificados SSL</h4><ul class="dlist">${h.ssl.map(c => { const days = c.expires ? Math.ceil((c.expires - Date.now()) / 86400000) : null;
        return `<li><span class="pill ${days == null ? 'off' : days < 0 ? 'bad' : days < 14 ? 'warn' : 'ok'}">${days == null ? '¿?' : days < 0 ? 'vencido' : days + ' días'}</span><span class="grow mono">${esc(c.domain)}</span><span class="dmuted">${esc(c.issuer)}${c.selfSigned ? ' · autofirmado' : ''}</span></li>`; }).join('')}</ul></section>` : '';
      const dbs = h.dbs.length ? `<section class="dsec"><h4>Bases de datos · ${fmtBytes(h.dbSize)}</h4><ul class="dlist">${h.dbs.map(x => `<li><span class="grow mono">${esc(x.name)}</span><span class="dmuted">${x.users} usuario${x.users === 1 ? '' : 's'}</span><span class="mono">${fmtBytes(x.size)}</span></li>`).join('')}</ul></section>` : '';
      const errs = h.errlogs.length ? `<section class="dsec"><h4>Errores de PHP (error_log)</h4><ul class="dlist">${h.errlogs.map(e => `<li class="col"><span class="grow"><span class="mono">${esc(e.file)}</span> <span class="dmuted">· ${fmtBytes(e.size)} · ${e.lastHour} líneas en la última hora · modificado ${when(e.mtime)}</span>
          ${e.recent.length ? `<pre class="errtail">${e.recent.map(r => esc(r.text)).join('\n')}</pre>` : ''}</span></li>`).join('')}</ul></section>` : '';
      const cron = h.cron.length ? `<section class="dsec"><h4>Tareas cron</h4><ul class="dlist">${h.cron.map(c => `<li><span class="mono dmuted">${esc(c.schedule)}</span><span class="grow mono">${esc(c.command)}</span></li>`).join('')}</ul><p class="hint">Los tokens y contraseñas se tapan antes de guardarse.</p></section>` : '';
      const mail = h.mail.length ? `<section class="dsec"><h4>Buzones de correo · ${fmtBytes(h.mailSize)}</h4><ul class="dlist">${h.mail.map(m => `<li><span class="grow mono">${esc(m.email)}</span><span class="mono">${fmtBytes(m.used)}${m.quota ? ' / ' + fmtBytes(m.quota) : ''}</span></li>`).join('')}</ul></section>` : '';
      const max = h.du && h.du.rows.length ? h.du.rows[0].size : 1;
      const du = `<section class="dsec"><h4>¿Qué ocupa el espacio?</h4><div class="row dmrow"><span class="grow dmuted">${h.duPending ? '⏳ Pedido: el agente lo calcula en su próximo envío (1–2 minutos).' : h.du ? `Último análisis ${when(h.du.at)}` : 'Todavía no se analizó.'}</span>
          ${h.duPending ? '' : `<button class="btn small" data-agent-du="${esc(h.id)}">Analizar ahora</button>`}</div>
        ${h.du ? `<ul class="dlist">${h.du.rows.slice(1, 40).map(x => `<li class="bar"><span class="grow mono">${esc(x.path)}</span><span class="bw"><i style="width:${(x.size / max * 100).toFixed(1)}%"></i></span><span class="mono">${fmtBytes(x.size)}</span></li>`).join('')}</ul>` : ''}</section>`;
      detail = findings + wpSec + ssl + errs + dbs + du + mail + cron + usage;
    } else detail = findings + wpSec + usage + '<p class="dmuted">Active el modo privado para ver dominios, plugins, certificados, errores, bases, correo y tareas cron.</p>';
    this.content(`<div class="dstats">${stat('Agente', h.stale ? 'sin señal' : 'en línea', h.stale ? 'bad' : '')}${stat('Último envío', when(h.lastPush))}${stat('Visitas / min', fmtNum(d.reqMin))}
        ${stat('Disco', quota)}${stat('Bases', h.dbCount ? `${h.dbCount} · ${fmtBytes(h.dbSize)}` : '–')}${stat('Correo', h.mailCount ? `${h.mailCount} · ${fmtBytes(h.mailSize)}` : '–')}
        ${stat('SSL por vencer', h.sslSoon, h.sslSoon ? 'warn' : '')}${stat('Errores PHP / h', fmtNum(h.errLastHour), h.errLastHour > 20 ? 'warn' : '')}${stat('Tareas cron', h.cronCount)}</div>
      <section class="dsec"><h4>Sitios</h4><ul class="dlist">${sites}</ul></section>${detail}`);
    this.body.querySelectorAll('.sico').forEach(el => el.appendChild(signCanvas(el.dataset.icon, 2)));
  }

  renderSystem(d) {
    const s = d.system;
    this.setHead('system', iconCanvas('terminal', 4), forEdition('Torre de control'), d.host ? esc(d.host) : document.body.classList.contains('ed-cloud') ? 'Todo lo que tiene conectado' : forEdition('El servidor completo'), d.health ? this.healthPill(d.health) : '');
    // en Atalaya Cloud no hay un servidor propio que medir: la ficha muestra lo conectado, sin cifras en cero
    const cloud = document.body.classList.contains('ed-cloud');
    this.frame(cloud ? [] : [{ title: 'CPU y memoria · 10 min', range: [0, 100], fmt: v => v + '%',
      series: [{ stroke: '#22d3ee', width: 2, fill: 'rgba(34,211,238,.1)', points: { show: false } }, { stroke: '#a78bfa', width: 2, points: { show: false } }] }]);
    this.setChart(0, d.hist, [r => r.cpu, r => r.mem]);
    const top = d.top.map(p => `<li><span class="mono grow">${esc(p.comm)} <span class="dmuted">×${p.n}</span></span><span class="mono">${p.cpu.toFixed(1)}%</span><span class="mono dmuted">${fmtBytes(p.mem)}</span></li>`).join('');
    const health = d.health ? `<section class="dsec hsec"><h4>${px('shield')} Salud del servidor ${this.healthPill(d.health)}</h4>${this.healthHtml(d.health, true)}</section>` : '';
    this.content(`${health}<div class="dstats">
        ${cloud ? '' : `${stat('CPU', s.cpu.toFixed(0) + '%')}${stat('Núcleos', s.cores)}${stat('Carga 1/5/15', s.load.map(x => x.toFixed(2)).join(' · '))}
        ${stat('Memoria', `${fmtBytes(s.mem.used)} / ${fmtBytes(s.mem.total)}`)}${stat('Swap', fmtBytes(s.swap.used))}${stat('Disco', s.disk ? `${fmtBytes(s.disk.used)} / ${fmtBytes(s.disk.total)}` : '–', s.disk?.pct > 85 ? 'warn' : '')}
        ${stat('Red ↓ / ↑', `${fmtBytes(s.net.rx)}/s · ${fmtBytes(s.net.tx)}/s`)}${stat('Encendido hace', dur(s.uptime))}${stat('Procesos', s.procs)}`}
        ${stat(cloud ? 'Proyectos' : 'Servicios', d.appsDown ? `${d.appsDown} mal de ${d.apps}` : d.apps, d.appsDown ? 'bad' : '')}${stat('Agentes Claude', d.sessions)}
      </div>
      ${d.connectors && d.connectors.length ? `<section class="dsec"><h4>Conectores de nube</h4>${d.connectors.some(c => !c.ok || (c.warn || []).length) ? '<p class="dmuted">Hay conectores con problemas. Se arreglan en menú › <a href="setup#conectar"><b>Conectar o arreglar proyectos</b></a>.</p>' : ''}<ul class="dlist">${d.connectors.map(c => `<li>
        <span class="pill ${c.ok ? 'ok' : 'bad'}">${c.ok ? 'conectado' : 'error'}</span><span class="grow"><b>${esc(c.label)}</b> · ${c.projects} proyecto${c.projects === 1 ? '' : 's'}</span>
        <span class="dmuted">${c.lastOk ? 'leído hace ' + ago(Date.now() - c.lastOk) : 'sin lectura'}${c.type === 'vercel' ? (c.drainAt ? ` · visitas hace ${ago(Date.now() - c.drainAt)}` : ' · sin Drain') : ''}</span></li>${c.error || (c.warn || []).length ? `<li class="sub wrap"><span class="dmuted">${[c.error, ...(c.warn || [])].filter(Boolean).map(w => px('warn') + ' ' + esc(w)).join('<br>')}</span></li>` : ''}`).join('')}</ul></section>` : ''}
      ${d.keys && d.keys.length ? `<section class="dsec"><h4>Servicios clave</h4><div class="keys">${d.keys.map(k => `<span class="keysvc ${k.state === 'active' ? 'ok' : k.state === 'failed' ? 'bad' : 'off'}" title="${esc(k.unit)} · ${esc(k.substate || k.state)}">${esc(k.label)}<b>${k.state === 'active' ? 'activo' : k.state === 'failed' ? 'FALLÓ' : k.state === 'inactive' ? 'detenido' : esc(k.state)}</b></span>`).join('')}</div></section>` : ''}`, `<section class="dsec"><h4>Visitantes por país · última hora</h4><ul class="dlist">${bars(d.countries, k => `${flag(k)} ${esc(countryName(k))}`, d.countries.reduce((n, x) => n + x.n, 0))}</ul></section>
      ${cloud ? '' : `<section class="dsec"><h4>Procesos que más consumen</h4><ul class="dlist">${top}</ul></section>`}
      <p class="dlinks"><a data-go="security:all">${px('shield')} Ver defensa</a> · <a data-go="webdef:all">${px('invader')} Defensa web</a> · <a data-go="mail:all">${px('mail')} Ver correo</a> · <a data-go="databases:all">${px('db')} Bases de datos</a></p>`);
  }

  // al final de la ficha de un sitio o app: cuantos robots lo sondearon y si quedo algo expuesto
  probesLine(d) {
    const body = this.body.querySelector('.dcontent') || this.body; // se reemplaza en cada refresco: no se duplica
    // en vigilancia: que pasa, desde cuando y que hacer (arriba de todo)
    const w = d.watch;
    if (w) {
      const since = ago(Date.now() - w.since);
      const T = {
        exposed: ['bad', 'bad', `Una ruta sensible respondió${w.path ? `: <code>${esc(w.path)}</code>` : ''}`, 'Alguien encontró algo. Corrija la causa (niegue la ruta para todos los nombres del sitio o saque el archivo del docroot), cambie las claves que pudiera contener y bloquee la IP que lo encontró.'],
        bruteforce: ['bad', 'key', `Fuerza bruta: ${fmtNum(w.n)} intentos de entrar al login en 10 min${w.topIp ? ` (${esc(w.topIp)})` : ''}`, 'Una IP prueba contraseñas. Bloquéela, use contraseñas largas, doble factor y, en WordPress, limite los intentos o cierre xmlrpc.php.'],
        multi: ['bad', 'siren', `La misma IP sondea ${fmtNum(w.n)} de sus sitios${w.topIp ? ` (${esc(w.topIp)})` : ''}`, 'Un robot recorre el servidor completo. Bloquearlo una vez lo frena en todos los sitios.'],
        scan: ['bad', 'siren', `Escaneo en curso: ${fmtNum(w.n)} sondeos a rutas sensibles en 15 min`, 'Robots probando .env, phpinfo, paneles y archivos de configuración. Mire abajo en Defensa web si alguno respondió; si todos dan 404, no encontraron nada.'],
        scraping: ['bad', 'siren', `Scraping: una sola IP hizo ${fmtNum(w.n)} pedidos en 5 min${w.topIp ? ` (${esc(w.topIp)})` : ''}`, 'Una sola dirección se lleva el sitio página por página o lo satura. Si no es un servicio suyo, bloquee la IP en el firewall (o en cPHulk / CSF) y considere límites de velocidad.'],
        surge: ['warn', 'fire', `Pico de visitas: ${fmtNum(w.n)} por minuto (lo normal es ${fmtNum(w.base || 0)}) desde ${fmtNum(w.ips)} IPs`, 'Puede ser que se hizo viral (llegan de muchos países, con referer de redes o buscadores) o un ataque distribuido (muchas IPs, mismas páginas, sin referer). Compare países, referer y páginas más pedidas en esta ficha.'],
      }[w.reason];
      const blockBtn = w.topIp && w.blockable && w.reason !== 'surge' ? `<p class="row"><button class="btn small danger" data-block-ip="${esc(w.topIp)}">Bloquear esta IP (${esc(w.topIp)})</button><span class="dmuted">se levanta sola al vencer</span></p>` : '';
      if (T) body.insertAdjacentHTML('afterbegin', `<section class="dsec"><div class="afind ${T[0]}"><h5>${px(T[1])} ${T[2]}</h5><p class="dmuted">Desde hace ${since}.</p><p class="fix">${T[3]}</p>${blockBtn}</div></section>`);
    }
    // archivos PHP sospechosos (posibles puertas traseras), arriba de todo
    if (d.phpSus && d.phpSus.length) {
      const rows = d.phpSus.map(x => `<div class="afind bad"><h5>${px('bad')} ${x.short ? `<code>${esc(x.short)}</code>` : 'Archivo PHP sospechoso'}</h5>
        <p>${x.why.map(esc).join(' · ')}</p>
        <p class="dmuted">${fmtBytes(x.size)} · modificado el ${new Date(x.mtime).toLocaleDateString('es-VE')}${x.existing ? ' · ya estaba cuando Atalaya empezó a vigilar' : ` · apareció hace ${ago(Date.now() - x.at)}`}</p>
        ${x.hits && x.hits.length ? `<p><b>Quién lo buscó</b> <span class="dmuted">(pedir la ruta exacta de un archivo así delata a quien lo puso)</span></p><ul class="dlist">${x.hits.map(h => `<li class="link" data-go="prisoner:${esc(h.ip)}"><span class="grow"><span class="mono">${esc(h.ip)}</span> <span class="dmuted">· ${new Date(h.t).toLocaleString('es-VE', { hour12: false, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · respuesta ${h.status}${h.status === 200 ? ' (<b>lo ejecutó</b>)' : ''}</span></span>
            ${h.jailed ? '<span class="pill ok">en la cárcel</span>' : h.blockable ? `<button class="btn small danger" data-block-ip="${esc(h.ip)}" data-reason="phpfile">Llevar a la cárcel</button>` : ''}</li>`).join('')}</ul>`
          : x.hitCount ? `<p class="dmuted">${x.hitCount} petición(es) a este archivo en los registros.</p>` : '<p class="dmuted">Nadie lo pidió en los registros de este mes y el anterior.</p>'}
        ${x.path ? `<p class="row"><button class="btn small danger" data-php-q="${esc(x.path)}">Poner en cuarentena</button><button class="btn small ghost" data-php-ack="${esc(x.path)}">Marcar como revisado</button></p>` : ''}</div>`).join('');
      body.insertAdjacentHTML('afterbegin', `<section class="dsec"><h4>Archivos PHP sospechosos</h4>${rows}
        <p class="hint">Cuarentena: el archivo sale del sitio (deja de funcionar) y se guarda aparte, sin borrarse. Si no lo subió usted, cambie además las contraseñas de cPanel, FTP y WordPress y actualice plugins y temas.</p>${d.phpSus.some(x => x.path) ? '' : '<p class="dmuted">Active el modo privado para ver las rutas y actuar.</p>'}</section>`);
    }
    // certificado SSL: aviso arriba si vence pronto o es autofirmado; si no, una linea con su fecha
    if (d.cert) {
      const c = d.cert, when = new Date(c.until).toLocaleDateString('es-VE', { day: 'numeric', month: 'long', year: 'numeric' });
      const who = c.domain ? ` de <b>${esc(c.domain)}</b>` : '';
      if (c.level !== 'ok') {
        const title = c.days < 0 ? `El certificado SSL${who} venció hace ${-c.days} día${c.days === -1 ? '' : 's'}` : c.days <= 20 ? `El certificado SSL${who} vence en ${c.days} día${c.days === 1 ? '' : 's'}` : `El certificado SSL${who} es autofirmado`;
        const fix = c.self && c.days > 20 ? 'Los navegadores lo marcan como inseguro, salvo que el dominio pase por Cloudflare en modo Full. Active AutoSSL para la cuenta en WHM › SSL/TLS › Manage AutoSSL.'
          : 'La renovación automática suele hacerse unos 30 días antes: está fallando. En WHM › SSL/TLS › Manage AutoSSL › Logs vea el motivo (lo usual: el dominio ya no apunta aquí o Cloudflare bloquea la validación) y pulse «Run AutoSSL» para la cuenta.';
        body.insertAdjacentHTML('afterbegin', `<section class="dsec"><div class="afind ${c.level}"><h5>${px(c.level)} ${title}</h5><p class="dmuted">Emitido por ${esc(c.issuer)} · vence el ${when}</p><p class="fix">${fix}</p></div></section>`);
      } else body.insertAdjacentHTML('beforeend', `<section class="dsec"><h4>Certificado SSL</h4><p class="dmuted">${esc(c.issuer)} · vence el ${when} (en ${c.days} días)${c.n > 1 ? ` · el más próximo de sus ${c.n} dominios` : ''}. Se renueva solo.</p></section>`);
    }
    // revision web diaria del sitio vigilado: lo grave arriba, con como empezar a arreglarlo
    if (d.avail) {
      const R = d.webrules, LV = { bad: 'bad', warn: 'warn', info: 'info' };
      const rows = R ? R.findings.map(f => `<div class="afind ${LV[f.level] || 'info'}"><h5>${px(f.level === 'bad' ? 'bad' : f.level === 'warn' ? 'warn' : 'info')} ${esc(f.text)}</h5>${f.fix ? `<p class="fix">${esc(f.fix)}</p>` : ''}</div>`).join('') : '';
      body.insertAdjacentHTML(R && R.findings.some(f => f.level === 'bad') ? 'afterbegin' : 'beforeend', `<section class="dsec"><h4>${px('search')} Revisión web diaria</h4>
        ${!R ? '<p class="dmuted">Todavía no se hizo la primera revisión: sale a los pocos minutos de agregar el sitio.</p>'
          : `<p class="dmuted">${R.kind === 'private' ? 'Se revisa como <b>sitio privado</b>: no debe aparecer en buscadores.' : 'Se revisa como <b>sitio público</b>: debe poder leerlo un buscador o una IA.'} Última revisión ${ago(Date.now() - R.at)} atrás.</p>
            ${rows || `<p>${px('ok')} Sin faltas.</p>`}
            ${R.unmeasured && R.unmeasured.length ? `<p class="dmuted">${px('warn')} No se pudo medir: ${R.unmeasured.map(esc).join(', ')}. Eso no dice nada del sitio.</p>` : ''}`}
        ${d.avail.url ? `<p class="row"><button class="btn small ghost" data-web-review="${esc(d.avail.id)}">Revisar ahora</button></p>` : ''}</section>`);
      const rb = body.querySelector('[data-web-review]');
      if (rb) rb.addEventListener('click', async () => { rb.disabled = true; rb.textContent = 'Revisando…'; await fetch('api/websites/review', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' }, body: JSON.stringify({ id: rb.dataset.webReview }) }).catch(() => { }); this.load && this.load(this.kind, this.id); });
    }
    // sitio vigilado por su dominio: como responde ahora, como le fue en 24 horas y la linea para contar sus visitas
    if (d.avail) {
      const u = d.avail, EXP = { 0: 'que abra bien (2xx)', 200: '200 (página normal)', 204: '204 (sin contenido)', 401: '401 (puerta que exige llave)', 403: '403 (prohibido)', 404: '404 (no existe)' };
      const maxMs = Math.max(1, ...u.series.map(x => x.ms));
      const bars = u.series.length ? `<div class="anahours upbars">${u.series.map(x => `<i class="${x.ok ? '' : 'bad'}" style="height:${x.ok ? Math.max(6, Math.round(x.ms / maxMs * 100)) : 100}%" title="${new Date(x.t).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', hour12: false })} · ${x.ok ? x.ms + ' ms' : 'falló'}"></i>`).join('')}</div>` : '';
      const head = u.ok === false ? `<div class="afind bad"><h5>${px('siren')} No responde bien: ${esc(u.why || 'sin respuesta')}</h5><p class="dmuted">Desde hace ${ago(Date.now() - u.since)}. Atalaya lo probó dos veces antes de avisar.</p>
          <p class="fix">Ábralo en su navegador. Si tampoco le abre, revise el último despliegue y el estado de su proveedor. Si a usted sí le abre, puede que la frase o la respuesta esperada ya no correspondan: quite el sitio y cámbielo en menú › Vigilar sitios y latidos › Cambiar.</p></div>`
        : u.ok ? `<p>${px('ok')} <b>Responde bien</b>${u.ms ? ` en ${fmtNum(u.ms)} ms` : ''}${u.since ? ` · sin caídas desde hace ${ago(Date.now() - u.since)}` : ''}</p>` : `<p class="dmuted">${px('clock')} Todavía no se midió: la primera visita sale en unos segundos.</p>`;
      const snippet = d.siteToken ? `<script defer src="${new URL('a.js', location.href).href}" data-site="${d.siteToken}"></script>` : '';
      body.insertAdjacentHTML('afterbegin', `<section class="dsec"><h4>Disponibilidad</h4>${head}
        ${u.note ? `<p class="dmuted">${px('warn')} La última medida no se pudo hacer: ${esc(u.note)}. Eso no dice nada del sitio.</p>` : ''}
        ${u.checks ? `<div class="anakpi"><div><span>Disponible en 24 h</span><b>${u.pct == null ? '–' : String(u.pct).replace('.', ',') + '%'}</b></div><div><span>Tiempo de respuesta</span><b>${u.avgMs == null ? '–' : fmtNum(u.avgMs) + ' ms'}</b></div><div><span>Medidas</span><b>${fmtNum(u.checks)}</b></div></div>${bars}` : ''}
        <p class="hint">Atalaya lo visita cada 5 minutos desde afuera, como un visitante. Espera ${esc(EXP[u.expect] || u.expect)}${u.hasPhrase ? (u.phrase ? ` y la frase «${esc(u.phrase)}»` : ' y una frase en la página') : ''}. Avisa una vez al caer y una vez al volver.</p>
        ${snippet && !(d.analytics && d.analytics.pv) ? `<h5 class="anasub">${px('bolt')} Para ver sus visitas</h5><p class="hint">De este sitio Atalaya no tiene los registros del servidor. Pegue esta línea antes de &lt;/head&gt; y empezará a ver visitantes, países, páginas y de dónde llegan. Sin cookies.</p>
          <div class="copy"><pre class="cmd">${esc(snippet)}</pre><button class="btn small" data-copy="${esc(snippet)}">Copiar</button></div>` : ''}</section>`);
    }
    if (d.secHistory && d.secHistory.length) {
      const EV = { watch: { start: 'Vigilancia', end: 'Fin de la vigilancia' }, defense: { block: 'IP a la cárcel', unblock: 'IP liberada', expire: 'Venció un bloqueo' }, phpfile: { hit: 'Buscaron la puerta trasera', suspect: 'Puerta trasera detectada', quarantine: 'Puerta trasera en cuarentena' }, probe: { undefined: 'Ruta expuesta' } };
      const dt = t => new Date(t).toLocaleString('es-VE', { hour12: false, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
      body.insertAdjacentHTML('beforeend', `<section class="dsec"><h4>Historial de seguridad</h4><ul class="dlist">${d.secHistory.map(e => `<li class="${e.ip ? 'link' : ''}" ${e.ip ? `data-go="prisoner:${esc(e.ip)}"` : ''}><span class="grow"><b>${esc((EV[e.kind] || {})[e.action] || e.kind)}</b>${e.reason ? ` · ${esc(e.reason)}` : ''}${e.ip ? ` · <span class="mono">${esc(e.ip)}</span>` : ''}${e.path ? `<br><code>${esc(e.path)}</code>` : ''}</span><span class="mono dmuted">${dt(e.t)}</span></li>`).join('')}</ul></section>`);
    }
    if (!d.probes || !d.probes.n) return;
    body.insertAdjacentHTML('beforeend', `<section class="dsec"><h4>Defensa web</h4><p class="${d.probes.exposed ? 'afind bad' : 'dmuted'}">${px(d.probes.exposed ? 'bad' : 'invader')}
      ${fmtNum(d.probes.n)} sondeo(s) de robots en 24 h${d.probes.exposed ? ` · <b>${d.probes.exposed} archivo(s) expuesto(s)</b>` : ''} · <a data-go="webdef:${esc(d.id)}">Ver qué buscan</a></p></section>`);
  }

  // defensa web: robots que buscan rutas vulnerables; lo grave arriba (archivos expuestos) con su arreglo
  renderWebdef(d) {
    this.setHead('webdef', iconCanvas('portal', 4), 'Defensa web', d.id === 'all' ? 'Robots buscando rutas vulnerables en sus sitios' : 'Rutas vulnerables buscadas en este sitio', '');
    const FAMPX = { secrets: 'key', shells: 'bad', panels: 'gear', exploits: 'invader', wordpress: 'wp' };
    const exp = d.exposed.length ? `<section class="dsec"><h4>Para atender</h4>${d.exposed.map(x => `<div class="afind ${x.sev}">
        <h5>${px(FAMPX[x.fam] || 'warn')} ${esc(x.why)}</h5>
        <p>${esc(x.site)} <span class="dmuted">· ${esc(x.account)}</span>${x.path ? ` · <code>${esc(x.path)}</code>` : ''} <span class="dmuted">· ${fmtNum(x.n)} vez(ces), la última a las ${hhmm(x.last)}</span></p>
        ${x.fix ? `<p class="fix">${esc(x.fix)}</p>` : ''}</div>`).join('')}</section>`
      : `<section class="dsec"><p class="dmuted">${px('ok')} Ningún archivo sensible respondió: los sondeos no encontraron nada.</p></section>`;
    const fams = d.families.length ? `<section class="dsec"><h4>Qué buscan</h4><ul class="dlist">${d.families.map(f => `<li>${px(FAMPX[f.fam] || 'warn')}<span class="grow">${esc(f.label)}</span><b>${fmtNum(f.n)}</b></li>`).join('')}</ul></section>` : '';
    const sites = d.sites.length ? `<section class="dsec"><h4>Sitios más buscados</h4><ul class="dlist">${d.sites.map(s => `<li class="${s.go ? 'link' : ''}" ${s.go ? `data-go="${esc(s.go)}"` : ''}><span class="grow">${esc(s.name)} <span class="dmuted">· ${esc(s.account)}</span></span><b>${fmtNum(s.n)}</b></li>`).join('')}</ul></section>` : '';
    const cc = d.countries.length ? `<section class="dsec"><h4>Desde dónde</h4><div class="chips">${d.countries.map(c => `<span class="chip">${esc(c.cc)} <b>${fmtNum(c.n)}</b></span>`).join('')}</div></section>` : '';
    const paths = d.paths && d.paths.length ? `<section class="dsec"><h4>Rutas más pedidas</h4><ul class="dlist">${d.paths.map(p => `<li><code class="grow">${esc(p.path)}</code><span class="dmuted">${p.status || ''}</span><b>${fmtNum(p.n)}</b></li>`).join('')}</ul></section>` : '';
    const ips = d.ips && d.ips.length ? `<section class="dsec"><h4>Quién más insiste</h4><ul class="dlist">${d.ips.map(i => `<li><span class="grow mono">${esc(i.ip)}</span><span class="dmuted">${esc(i.country || i.cc || '')}</span><b>${fmtNum(i.n)}</b></li>`).join('')}</ul></section>` : '';
    this.content(`<div class="dstats">${stat('Última hora', fmtNum(d.hour))}${stat('Últimas 24 h', fmtNum(d.day))}${stat('Expuestos', fmtNum(d.exposed.filter(x => x.sev === 'bad').length), d.exposed.some(x => x.sev === 'bad') ? 'bad' : '')}</div>
      ${exp}${fams}${sites}${paths}${ips}${cc}
      ${d.priv ? '' : '<p class="dmuted small">En modo privado se ven las rutas, las IPs y qué archivo quedó expuesto.</p>'}
      ${defenseSection(d.defense, d.priv)}
      ${defsLine(window.atalaya && window.atalaya.state)}
      <p class="dmuted small">Atalaya solo bloquea cuando usted lo pide o enciende la defensa automática, y siempre por un tiempo. Cuando una ruta de secretos o de webshell responde, la vuelve a pedir una vez para confirmar si de verdad expone algo; nunca guarda su contenido.</p>`);
  }

  // la carcel: bloqueos manuales del firewall (permanentes) y de la defensa de Atalaya (con vencimiento)
  renderJail(d) {
    this.setHead('jail:all', iconCanvas('jail', 4), 'Cárcel', 'IPs bloqueadas a mano y por la defensa de Atalaya', '');
    if (!d.available) return this.content('<p class="dmuted">La cárcel necesita la edición VPS con el ayudante de Atalaya.</p>');
    const now = Date.now();
    const perm = d.items.filter(x => x.permanent), temp = d.items.filter(x => !x.permanent);
    const row = x => `<li class="${x.ip ? 'link' : ''}" ${x.ip ? `data-go="prisoner:${esc(x.ip)}"` : ''}><span class="cell">${px(x.permanent ? 'lock' : 'shield')}</span><span class="grow">${x.ip ? `<span class="mono">${esc(x.ip)}</span> <span class="dmuted">· ver expediente</span><br>` : ''}
        <span class="${x.ip ? 'dmuted' : ''}">${esc(x.why)}${x.site ? ` · ${esc(x.site)}` : ''}</span><br>
        <span class="dmuted">${x.permanent ? 'permanente · firewall' : `${x.by === 'auto' ? 'defensa automática' : 'por ' + esc(x.by)} · sale en ${ago(x.until - now + 60000).replace(/^hace /, '')}`}</span></span>
        ${d.priv && x.ip ? `<button class="btn small ghost" data-release-ip="${esc(x.ip)}" data-perm="${x.permanent ? 1 : 0}">Liberar</button>` : ''}</li>`;
    // archivos en cuarentena: donde estaban, que eran, cuando, quien y quien los busco
    const dt = t => t ? new Date(t).toLocaleString('es-VE', { hour12: false, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
    const files = (d.files || []).map(f => `<div class="qfile"><h5>${px('bad')} ${f.short ? `<code>${esc(f.short)}</code>` : 'Archivo PHP sospechoso'}</h5>
        <p>${f.site ? `Estaba en ${f.go ? `<a data-go="${esc(f.go)}">${esc(f.site)}</a>` : esc(f.site)}. ` : ''}${f.why.length ? `<b>Por qué:</b> ${f.why.map(esc).join(' · ')}` : ''}</p>
        <ul class="dlist qhist">
          ${f.mtime ? `<li><span class="grow">Creado o modificado por última vez</span><span class="mono">${dt(f.mtime)}</span></li>` : ''}
          <li><span class="grow">Detectado por Atalaya</span><span class="mono">${f.foundAt ? dt(f.foundAt) : f.existing || f.rebuilt ? 'en la primera revisión' : '–'}</span></li>
          <li><span class="grow">Puesto en cuarentena${f.by ? ` por ${esc(f.by)}` : ''}</span><span class="mono">${dt(f.at)}</span></li>
          ${f.size ? `<li><span class="grow">Tamaño</span><span class="mono">${fmtBytes(f.size)}</span></li>` : ''}
        </ul>
        ${f.hits.length ? `<p><b>Quién lo buscó</b></p><ul class="dlist">${f.hits.map(h => `<li class="${h.ip ? 'link' : ''}" ${h.ip ? `data-go="prisoner:${esc(h.ip)}"` : ''}><span class="grow">${h.ip ? `<span class="mono">${esc(h.ip)}</span> · ` : ''}<span class="dmuted">${dt(h.t)} · respuesta ${h.status}${h.status === 200 ? ' (lo ejecutó)' : ''}</span></span>${h.jailed ? '<span class="pill ok">en la cárcel</span>' : ''}</li>`).join('')}</ul>` : '<p class="dmuted">Nadie lo pidió en los registros disponibles.</p>'}
        ${f.canAct ? `<p class="row"><button class="btn small danger" data-qdel="${esc(f.path)}">Borrar para siempre</button><button class="btn small ghost" data-qres="${esc(f.path)}">Restaurar</button></p>` : ''}</div>`).join('');
    this.content(`<div class="dstats">${stat('Presos', fmtNum(d.items.length))}${stat('Del firewall (permanentes)', fmtNum(perm.length))}${stat('De Atalaya (temporales)', fmtNum(temp.length))}${stat('Archivos en cuarentena', fmtNum((d.files || []).length))}</div>
      ${files ? `<section class="dsec" id="qsec"><h4>Archivos en cuarentena</h4>${files}<p class="hint">Fuera del sitio y sin permisos: ya no pueden ejecutarse. Borrar para siempre cuando esté claro que era malware; restaurar solo si fue un falso positivo (vuelve a su lugar con su dueño y permisos, y queda como revisado).</p></section>` : ''}
      ${temp.length ? `<section class="dsec"><h4>Defensa de Atalaya</h4><ul class="dlist jail">${temp.map(row).join('')}</ul></section>` : ''}
      ${perm.length ? `<section class="dsec"><h4>Bloqueos manuales del firewall</h4><ul class="dlist jail">${perm.map(row).join('')}</ul></section>` : ''}
      ${d.items.length ? '' : '<p class="dmuted">La cárcel está vacía.</p>'}
      <p class="hint">Aquí no entran los miles de intentos de SSH que frenan fail2ban y cPHulk: esos se ven en Defensa. Defensa automática: <b>${d.auto ? 'encendida' : 'apagada'}</b> · <a data-go="webdef:all">ajustes</a>.</p>
      ${d.priv ? '' : '<p class="dmuted">Active el modo privado para ver las IPs y liberarlas.</p>'}`);
  }

  // expediente de un preso (o de cualquier IP): quien es, historial de bloqueos, que hizo y sus ultimas peticiones
  renderPrisoner(d) {
    const cv = document.createElement('div'); cv.className = 'dswatch'; cv.innerHTML = px(d.inJail ? 'jail' : 'shield', 'big');
    if (d.private) { this.setHead('prisoner', cv, 'Expediente', 'Solo en modo privado', ''); return this.content('<p class="dmuted">Active el modo privado para ver el expediente de una IP.</p>'); }
    const dt = t => t ? new Date(t).toLocaleString('es-VE', { hour12: false, day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '–';
    const where = x => x.name ? (x.go ? `<a data-go="${esc(x.go)}">${esc(x.name)}</a>` : esc(x.name)) : '';
    const J = d.inJail;
    this.setHead('prisoner:' + d.id, cv, d.id, `${d.geo ? esc(d.geo.name || d.geo.cc) : 'País desconocido'}${d.reqs.ua ? ` · ${esc(d.reqs.ua.slice(0, 60))}` : ''}`,
      J ? `<span class="pill bad">${J.permanent ? 'presa (permanente)' : 'presa'}</span>` : '<span class="pill ok">suelta</span>');
    const EV = { watch: { start: 'Puso un sitio en vigilancia', end: 'Terminó la vigilancia' }, defense: { block: 'Entró a la cárcel', unblock: 'Salió de la cárcel (liberada)', expire: 'Salió de la cárcel (venció)' },
      phpfile: { hit: 'Pidió una puerta trasera', suspect: 'Puerta trasera detectada', quarantine: 'Puerta trasera en cuarentena' }, probe: { undefined: 'Encontró una ruta expuesta' },
      login: { new: 'Entró a un panel desde una IP nueva', guessed: 'Entró a un panel después de fallar la contraseña' } };
    const ev = d.events.map(e => `<li><span class="grow"><b>${esc((EV[e.kind] || {})[e.action] || e.kind)}</b>${e.reason ? ` · ${esc(e.reason)}` : ''}${e.name ? ` · ${where(e)}` : ''}${e.path ? `<br><code>${esc(e.path)}</code>` : ''}${e.status ? ` <span class="dmuted">(respuesta ${e.status})</span>` : ''}</span><span class="mono dmuted">${dt(e.t)}</span></li>`).join('');
    const rec = d.records.map(r => `<li><span class="grow"><b>${esc(r.why)}</b>${r.name ? ` · ${where(r)}` : ''}<br><span class="dmuted">${r.by === 'auto' ? 'defensa automática' : 'por ' + esc(r.by)} · ${r.status === 'active' ? `sale ${dt(r.until)}` : r.status === 'lifted' ? `liberada ${dt(r.liftedAt)}` : `venció ${dt(r.until)}`}</span></span><span class="mono dmuted">${dt(r.at)}</span></li>`).join('');
    const R = d.reqs;
    this.content(`<div class="dstats">${stat('Peticiones vistas', fmtNum(R.total))}${stat('Sitios que tocó', fmtNum(d.sites.length))}${stat('Primera vez', R.first ? dt(R.first) : '–')}${stat('Última vez', R.last ? dt(R.last) : '–')}</div>
      ${J ? `<section class="dsec"><div class="afind bad"><h5>${px('jail')} En la cárcel</h5><p>${esc(J.why || '')}</p><p class="dmuted">${J.permanent ? 'Bloqueo permanente en el firewall' : `Desde ${dt(J.at)} · sale ${dt(J.until)}`}</p><p class="row"><button class="btn small ghost" data-release-ip="${esc(d.id)}" data-perm="${J.permanent ? 1 : 0}">Liberar</button></p></div></section>`
        : d.blockable ? `<section class="dsec"><p class="row"><button class="btn small danger" data-block-ip="${esc(d.id)}">Llevar a la cárcel</button></p></section>` : ''}
      ${rec ? `<section class="dsec"><h4>Historial de bloqueos</h4><ul class="dlist">${rec}</ul></section>` : ''}
      ${d.php.length ? `<section class="dsec"><h4>Puertas traseras que buscó</h4><ul class="dlist">${d.php.map(x => `<li><span class="grow"><code>${esc(x.path)}</code>${x.name ? `<br>${where(x)}` : ''}</span>${x.quarantined ? '<span class="pill ok">en cuarentena</span>' : '<span class="pill bad">sigue ahí</span>'}</li>`).join('')}</ul></section>` : ''}
      ${d.panel ? `<section class="dsec"><h4>Paneles de control</h4>${d.panel.failed ? `<p><b>${fmtNum(d.panel.failed)} contraseña${d.panel.failed === 1 ? '' : 's'} equivocada${d.panel.failed === 1 ? '' : 's'}</b> en ${esc(d.panel.svcs.join(', '))} esta semana, como ${d.panel.users.map(u => `<b>${esc(u)}</b>`).join(', ')}<span class="dmuted"> · la última ${dt(d.panel.last)}</span></p>` : ''}
        ${d.panel.logins.length ? `<p><b>Entró</b> a los paneles:</p><ul class="dlist">${d.panel.logins.map(l => `<li><span class="grow">${esc(l.svc)} como <b>${esc(l.user)}</b></span><span class="mono dmuted">${dt(l.t)}</span></li>`).join('')}</ul>` : ''}</section>` : ''}
      ${d.sites.length ? `<section class="dsec"><h4>Sitios donde la vio la defensa web</h4><ul class="dlist">${d.sites.map(x => `<li><span class="grow">${where(x)}</span><span class="mono">${fmtNum(x.n)} sondeo(s)</span><span class="mono dmuted">${dt(x.t)}</span></li>`).join('')}</ul></section>` : ''}
      ${ev ? `<section class="dsec"><h4>Historial de seguridad</h4><ul class="dlist">${ev}</ul></section>` : ''}
      ${R.topPaths.length ? `<section class="dsec"><h4>Lo que más pidió</h4><ul class="dlist">${R.topPaths.map(x => `<li><code class="grow">${esc(x.path)}</code><span class="dmuted">${x.status}</span><b>${fmtNum(x.n)}</b></li>`).join('')}</ul></section>` : ''}
      ${R.recent.length ? `<section class="dsec"><h4>Sus últimas peticiones</h4><ul class="dlist">${R.recent.map(x => `<li><span class="grow"><span class="mono dmuted">${dt(x.t)}</span> · ${esc(x.domain)}<br><code>${esc(x.method)} ${esc(x.path)}</code></span><span class="mono ${x.status >= 400 ? 'dmuted' : ''}">${x.status}</span></li>`).join('')}</ul></section>`
        : '<p class="dmuted">No aparece en los registros de Apache recientes (si está presa, el firewall ya no la deja llegar).</p>'}
      <p class="hint">El historial crece con el tiempo: Atalaya anota cada episodio de seguridad desde esta versión. Las peticiones salen del final de los registros de cada sitio.</p>`);
  }

  renderSecurity(d) {
    this.setHead('security', iconCanvas('portal', 4), 'Defensa del servidor', 'SSH, cPHulk y accesos', '');
    const c = d.counts;
    const KIND = { attack: [px('invader'), 'Intento fallido'], block: [px('shield'), 'IP bloqueada'], login: [px('key'), 'Acceso correcto'] };
    const top = d.top.length ? d.top.map((x, i) => `<li><span class="flag" title="${esc(x.country || '')}">${flag(x.cc)}</span><span class="grow">${x.ip ? `<b class="mono">${esc(x.ip)}</b>${x.users?.length ? ` <span class="dmuted">probó: ${x.users.map(esc).join(', ')}</span>` : ''}` : `Atacante #${i + 1}`}</span>
        <span class="mono">${fmtNum(x.n)}</span>${x.blocked ? '<span class="pill bad">bloqueada</span>' : ''}</li>`).join('') : '<li class="dmuted">Sin atacantes registrados desde que Atalaya arrancó.</li>';
    const rec = d.recent.length ? d.recent.map(e => `<li><time>${hhmm(e.t)}</time><span>${KIND[e.kind][0]}</span><span class="flag" title="${esc(e.country || '')}">${flag(e.cc)}</span><span class="grow">${KIND[e.kind][1]} · ${esc(e.service || '')}${e.user ? ` · <span class="mono">${esc(e.user)}</span>` : ''}</span>${e.ip ? `<span class="mono dmuted">${esc(e.ip)}</span>` : ''}</li>`).join('')
      : '<li class="dmuted">Sin eventos todavía.</li>';
    this.content(`<div class="dstats">${stat('Intentos fallidos', fmtNum(c.failed), c.failed ? 'warn' : '')}${stat('IPs bloqueadas', fmtNum(c.blocked))}${stat('Accesos correctos', fmtNum(c.logins))}</div>
      <section class="dsec"><h4>Quién más insiste</h4><ul class="dlist">${top}</ul></section>
      <section class="dsec"><h4>Últimos eventos</h4><ul class="dlist">${rec}</ul></section>`);
  }

  renderMail(d) {
    const cv = document.createElement('div'); cv.className = 'dswatch'; cv.innerHTML = px('mail', 'big');
    this.setHead('mail', cv, 'Correo', 'Exim · entregas y rebotes', '');
    const DIR = { out: px('mailOut') + ' Enviado', in: px('mailIn') + ' Recibido', bounce: px('mailBad') + ' Rebotó' };
    const WHY = { auth: 'Sin SPF/DKIM/DMARC', nouser: 'No existe el destinatario', full: 'Buzón lleno', spam: 'Spam o reputación', domain: 'Dominio inexistente', rate: 'Demasiados envíos', other: 'Otro motivo' };
    // cada movimiento: hora, que paso, de que cuenta y, si reboto, por que (en privado: de quien, a quien y el codigo)
    const rec = d.recent.length ? d.recent.map(e => `<li class="mailrow"><time>${hhmm(e.t)}</time><div class="grow">
        <div>${DIR[e.dir]} <span class="dmuted">· ${esc(e.account)}</span>${e.dir === 'bounce' && e.cat ? ` <span class="pill ${e.cat === 'full' || e.cat === 'nouser' ? 'warn' : 'bad'}">${esc(WHY[e.cat] || e.why || '')}</span>` : ''}</div>
        ${d.priv && (e.from || e.to) ? `<div class="mfield"><span>De</span><b class="mono">${esc(e.from || '(sin remitente: aviso del sistema)')}</b></div><div class="mfield"><span>Para</span><b class="mono">${esc(e.to || '')}</b></div>` : ''}
        ${d.priv && e.reason && e.dir === 'bounce' ? `<div class="mwhy">${e.code ? `<b class="mono">${esc(e.code)}</b> ` : ''}${esc(e.reason)}</div>` : ''}</div></li>`).join('')
      : '<li class="dmuted">Sin movimiento de correo desde que Atalaya arrancó.</li>';
    const reasons = (d.reasons || []).length ? `<section class="dsec"><h4>Por qué rebota</h4>${d.reasons.map(r => `<div class="afind ${r.cat === 'full' || r.cat === 'nouser' ? 'warn' : 'bad'}">
        <h5>${esc(WHY[r.cat] || r.cat)} <span class="dmuted">· ${fmtNum(r.n)}</span></h5>${r.fix ? `<p class="fix">${esc(r.fix)}</p>` : ''}</div>`).join('')}</section>` : '';
    const accs = (d.byAccount || []).length ? `<section class="dsec"><h4>Por cuenta</h4><table class="dtable"><thead><tr><th>Cuenta</th><th>Enviados</th><th>Recibidos</th><th>Rebotes</th></tr></thead><tbody>
        ${d.byAccount.map(a => `<tr><td>${esc(a.account)}</td><td>${fmtNum(a.out)}</td><td>${fmtNum(a.in)}</td><td class="${a.bounce ? 'warn' : ''}">${fmtNum(a.bounce)}</td></tr>`).join('')}</tbody></table></section>` : '';
    this.content(`<div class="dstats">${stat('Enviados', fmtNum(d.counts.out))}${stat('Recibidos', fmtNum(d.counts.in))}${stat('Rebotes', fmtNum(d.counts.bounce), d.counts.bounce ? 'warn' : '')}</div>
      ${reasons}${accs}
      <section class="dsec"><h4>Últimos movimientos</h4><ul class="dlist">${rec}</ul>${d.priv ? '' : '<p class="dmuted small">En modo privado se ven remitente, destinatario y el mensaje del servidor que lo rechazó.</p>'}</section>${defsLine(window.atalaya && window.atalaya.state)}`);
  }

  // salud del servidor: una seccion por revision, con sus cifras y cada hallazgo con su "como arreglarlo".
  // compact (en la Torre de control): lo que esta en orden va en una sola linea
  healthHtml(h, compact) {
    if (!h) return '';
    const ST = { ok: ['ok', 'En orden'], warn: ['warn', 'Para revisar'], bad: ['bad', 'Grave'], unknown: ['off', 'Sin revisar'] };
    // una IP (accesos a los paneles): clic abre su expediente
    const when = t => t ? new Date(t).toLocaleString('es-VE', { hour12: false, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    const rowIp = r => `<li class="link" data-go="prisoner:${esc(r.ip)}"><span class="mono">${esc(r.ip)}</span> <span class="dmuted">${r.svc ? `${esc(r.svc)} como <b>${esc(r.user || '')}</b> · ${when(r.t)}` : `${fmtNum(r.n || 0)} intento${r.n === 1 ? '' : 's'}${r.users ? ` como ${esc(r.users.join(', '))}` : ''}${r.svcs ? ` en ${esc(r.svcs.join(', '))}` : ''} · ${when(r.t)}`}</span>${r.newIp ? ' <span class="pill warn">IP nueva</span>' : ''}</li>`;
    const sec = x => {
      const st = ST[x.status] || ST.unknown;
      const btn = x.canCheck ? `<button class="btn small" data-audit-updates="1" ${h.running ? 'disabled' : ''}>${h.running ? 'Revisando…' : 'Revisar actualizaciones'}</button>` : '';
      if (compact && x.status === 'ok') return `<div class="hline">${px(x.icon)} <b>${esc(x.title)}</b> <span class="pill ok">En orden</span> <span class="dmuted">${x.items.map(i => `${esc(i.label)}: ${esc(i.value)}`).join(' · ')}</span></div>`;
      const finds = h.priv ? x.findings.map(f => `<div class="afind ${f.sev}"><h5>${esc(f.title)}</h5><p>${esc(f.detail || '')}</p>${f.fix ? `<p class="fix">${esc(f.fix)}</p>` : ''}
          ${f.rows && f.rows.length ? `<ul>${f.rows.map(r => r.ip ? rowIp(r) : `<li>${r.port ? `puerto <b>${r.port}</b> ${esc(r.proc || '')}` : `<b>${esc(r.user || '')}</b> <span class="dmuted">${esc(r.schedule || '')}</span> <code>${esc(r.command || '')}</code>`}</li>`).join('')}</ul>` : ''}
          ${f.names && f.names.length ? `<p class="dmuted">${esc(f.names.slice(0, 20).join(', '))}${f.names.length > 20 ? '…' : ''}</p>` : ''}</div>`).join('')
        : (x.findings.length ? `<p class="dmuted">${x.findings.length} hallazgo${x.findings.length === 1 ? '' : 's'}. Active el modo privado para verlos con su «cómo arreglarlo».</p>` : '');
      return `<section class="dsec"><h4>${px(x.icon)} ${esc(x.title)} <span class="pill ${st[0]}">${st[1]}</span></h4>
        <div class="dstats">${x.items.map(i => stat(i.label, `${esc(i.value)}${i.sub ? `<br><small class="dmuted">${esc(i.sub)}</small>` : ''}`)).join('')}</div>
        ${finds || (x.status === 'ok' ? '<p class="dmuted">Nada para revisar.</p>' : '')}${btn ? `<div class="row dmrow">${btn}</div>` : ''}</section>`;
    };
    const rank = { bad: 0, warn: 1, unknown: 2, ok: 3 };
    const order = h.sections.slice().sort((a, b) => rank[a.status] - rank[b.status]);
    return order.map(sec).join('') + '<p class="hint">Atalaya solo mira: no cambia nada. Estas revisiones se repiten cada 15 minutos; las actualizaciones, solo cuando usted lo pide.</p>';
  }
  healthPill(h) {
    const all = h ? h.sections.flatMap(x => x.findings) : [];
    const bad = all.filter(f => f.sev === 'bad').length, warn = all.filter(f => f.sev === 'warn').length;
    return `<span class="pill ${bad ? 'bad' : warn ? 'warn' : 'ok'}">${bad ? bad + ' grave' + (bad === 1 ? '' : 's') : warn ? warn + ' para revisar' : 'en orden'}</span>`;
  }
  renderAudit(d) {
    // un chip de la salud abre solo su revision; «Salud del servidor» las abre todas
    const one = d.focus && d.sections.find(x => x.id === d.focus);
    const cv = document.createElement('div'); cv.className = 'dswatch'; cv.innerHTML = px(one ? one.icon : 'shield', 'big');
    if (one) {
      const h = { ...d, sections: [one] };
      this.setHead('audit:' + one.id, cv, one.title, `Revisado hace ${ago(Date.now() - d.t)} · parte de la Salud del servidor`, this.healthPill(h));
      this.content(this.healthHtml(h, false).replace(/<p class="hint">[\s\S]*$/, '') + '<p class="dlinks"><a data-go="audit:all">' + px('shield') + ' Ver toda la salud del servidor</a></p>');
      return;
    }
    this.setHead('audit:all', cv, 'Salud del servidor', `Revisado hace ${ago(Date.now() - d.t)} · solo lectura`, this.healthPill(d));
    this.content(this.healthHtml(d, false));
  }

  renderProjects(d) {
    const cv = document.createElement('div'); cv.className = 'dswatch'; cv.innerHTML = px('folder', 'big');
    this.setHead('projects', cv, 'Proyectos', 'Código, despliegues, dominios y bases, unidos por proyecto', '');
    const priv = d.projects.some(x => x.repo !== undefined);
    const f = this.params.filter || 'all';
    const FIL = { all: ['Todos', () => true], bad: ['Con problemas', x => x.bad || x.down], warn: ['Para revisar', x => !x.bad && !x.down && x.warn], ok: ['En orden', x => !x.bad && !x.down && !x.warn] };
    const list = d.projects.filter(FIL[f][1]);
    const gh = d.github.length ? d.github.map(g => `${px(g.ok ? 'dotG' : 'dotR')} ${esc(g.label || 'GitHub')} · ${g.repos} repos${g.error ? ` · ${esc(g.error)}` : ''}`).join(' · ') : '';
    this.content(`<div class="dstats">${stat('Proyectos', d.projects.length)}${stat('Puntaje promedio', d.avg ?? '–', d.avg != null ? (d.avg >= 85 ? '' : d.avg >= 60 ? 'warn' : 'bad') : '')}
        ${stat('Con problemas', d.projects.filter(FIL.bad[1]).length, d.projects.some(FIL.bad[1]) ? 'bad' : '')}${stat('Para revisar', d.projects.filter(FIL.warn[1]).length)}</div>
      <section class="dsec"><div class="row dmrow"><span class="grow dmuted">${d.job ? '' : 'Las revisiones que salen a Internet (certificados, respuesta, dominio y repo) corren solo a pedido.'}</span>
        ${priv && !d.job ? '<button class="btn small" data-proj="analyze" data-id="all">Analizar todos</button>' : ''}</div>${projJob(d.job)}
        ${gh ? `<p class="hint">${gh}</p>` : `<p class="hint">Conecte GitHub (menú ⋮ › Asistente › Extras) para unir cada proyecto con su código y revisar sus repos.</p>`}</section>
      <div class="chips">${Object.entries(FIL).map(([k, [l]]) => `<button class="chip ${k === f ? 'on' : ''}" data-filter="${k}">${l}</button>`).join('')}</div>
      <section class="dsec"><ul class="dlist">${list.map(x => `<li class="link" data-go="project:${esc(x.id)}"><span class="score s${scoreCls(x.score)}">${x.score}</span>
        <span class="grow"><b>${esc(x.name)}</b> <span class="dmuted">${x.kinds.map(k => KIND_ICON[k] || '').join(' ')}</span>
        ${x.repo || (x.domains && x.domains.length) ? `<br><span class="dmuted mono">${esc([x.repo, ...(x.domains || [])].filter(Boolean).join(' · '))}</span>` : ''}</span>
        <span class="dmuted">${x.bad ? `${px('bad')} ${x.bad}` : ''} ${x.warn ? `${px('warn')} ${x.warn}` : ''}</span><span class="dmuted">${x.activity ? ago(Date.now() - x.activity) : ''}</span></li>`).join('') || '<li class="dmuted">Nada en este filtro.</li>'}</ul></section>`);
    this.body.querySelectorAll('[data-filter]').forEach(b => b.addEventListener('click', () => { this.params.filter = b.dataset.filter; this.load(); }));
  }

  renderProject(d) {
    const sc = document.createElement('div'); sc.className = `dswatch score s${scoreCls(d.score)}`; sc.textContent = d.score;
    const priv = d.repoInfo !== undefined;
    this.setHead('project:' + d.id, sc, d.name, priv && d.repoInfo ? `<span class="mono">${esc(d.repoInfo.fullName)}</span>${d.repoInfo.private ? '' : ' · público'}${d.repoInfo.language ? ' · ' + esc(d.repoInfo.language) : ''}` : d.kinds.map(k => KIND_ICON[k]).join(' '), '');
    const order = { bad: 0, warn: 1, unknown: 2, info: 3, ok: 4 };
    const checks = d.checks.slice().sort((a, b) => order[a.level] - order[b.level]).map(c => `<li class="col"><span>${LEVEL_ICON[c.level]}</span><span class="grow"><b>${esc(c.title)}</b>${c.tip ? `<br><span class="dmuted">${esc(c.tip)}</span>` : ''}</span></li>`).join('');
    const parts = d.parts.map(p => `<li class="${p.go ? 'link' : ''}" ${p.go ? `data-go="${esc(p.go)}"` : ''}><span>${KIND_ICON[p.kind] || ''}</span>
        <span class="grow"><b>${esc(p.name || p.where)}</b> <span class="dmuted">· ${esc(p.where)}${p.account ? ' · ' + esc(p.account) : ''}${p.suggested ? ' · unido por nombre parecido' : ''}</span>
        ${p.remote ? `<br><span class="mono dmuted">${esc(p.remote.replace(/\/\/[^@/]+@/, '//'))}</span>` : ''}</span>
        ${p.status ? `<span class="pill ${p.status === 'online' ? 'ok' : p.status === 'down' ? 'bad' : 'warn'}">${STATUS_LABEL[p.status] || esc(p.status)}</span>` : ''}</li>`).join('');
    const a = d.audit;
    const doms = priv && d.allDomains.length ? `<section class="dsec"><h4>Dominios</h4><ul class="dlist">${d.allDomains.slice(0, 20).map(x => {
        const c = a && a.certs && a.certs[x], h = a && a.http && a.http[x];
        const days = c && c.expires ? Math.ceil((c.expires - Date.now()) / 86400000) : null;
        return `<li><span class="grow mono">${esc(x)}</span>${h ? `<span class="code ${h.status >= 500 || !h.status ? 'bad' : h.status >= 400 ? 'warn' : 'ok'}">${h.status || '—'}</span><span class="dmuted mono">${h.ms} ms</span>` : ''}
          ${c ? `<span class="pill ${!c.ok || days < 0 ? 'bad' : days < 14 ? 'warn' : 'ok'}">${!c.ok ? 'SSL inválido' : 'SSL ' + days + ' d'}</span>` : ''}</li>`; }).join('')}</ul>
        ${a && a.domains && Object.keys(a.domains).length ? `<p class="hint">Registro: ${Object.entries(a.domains).map(([k, v]) => `${esc(k)} ${v.expires ? 'vence el ' + new Date(v.expires).toLocaleDateString('es-VE') : '(el registro no publica la fecha)'}${v.registrar ? ' · ' + esc(v.registrar) : ''}`).join(' · ')}</p>` : ''}</section>` : '';
    const secrets = priv && a && a.repo && a.repo.secrets.length ? `<section class="dsec"><h4>Archivos con secretos en el repo</h4><ul class="dlist">${a.repo.secrets.map(x => `<li><span class="grow mono">${esc(x.path)}</span><span class="dmuted">${esc(x.what)}</span></li>`).join('')}</ul></section>` : '';
    const tools = priv ? `<section class="dsec"><h4>Organizar</h4><div class="row">
        <select id="projInto"><option value="">Unir con…</option>${d.others.map(o => `<option value="${esc(o.id)}">${esc(o.name)}</option>`).join('')}</select>
        <button class="btn small ghost" data-proj="merge" data-id="${esc(d.id)}">Unir</button>
        ${d.parts.some(p => p.suggested) || d.parts.length > 1 ? `<button class="btn small ghost" data-proj="split" data-id="${esc(d.id)}">Separar uniones</button>` : ''}
        <button class="btn small ghost" data-proj="rename" data-id="${esc(d.id)}" data-name="${esc(d.name)}">Renombrar</button>
        <button class="btn small ghost" data-proj="hide" data-id="${esc(d.id)}">Ocultar</button></div>
        <p class="hint">Atalaya une solo lo que comparte repositorio. Si dos piezas son del mismo proyecto y no se unieron, únalas aquí.</p></section>` : '';
    this.content(`<div class="dstats">${stat('Puntaje', d.score, scoreCls(d.score) === 'ok' ? '' : scoreCls(d.score))}${stat('Problemas', d.bad, d.bad ? 'bad' : '')}${stat('Para revisar', d.warn, d.warn ? 'warn' : '')}
        ${stat('Última actividad', d.activity ? 'hace ' + ago(Date.now() - d.activity) : '–')}</div>
      <section class="dsec"><div class="row dmrow"><span class="grow dmuted">${d.running ? '⏳ Revisando…' : d.audited ? `Última revisión hace ${ago(Date.now() - d.audited)}` : 'Todavía no se revisó.'}</span>
        ${priv && !d.job ? `<button class="btn small" data-proj="analyze" data-id="${esc(d.id)}">Analizar ahora</button>` : ''}</div>${d.job && !d.running ? projJob(d.job) : ''}
        ${a && a.repoError ? `<p class="msg bad">No se pudo revisar el repo: ${esc(a.repoError)}</p>` : ''}</section>
      <section class="dsec"><h4>Buenas prácticas</h4><ul class="dlist">${checks}</ul></section>
      <section class="dsec"><h4>Dónde vive</h4><ul class="dlist">${parts}</ul></section>
      ${doms}${secrets}${tools}${priv ? '' : '<p class="dmuted">Active el modo privado para ver nombres, repos, dominios y los consejos concretos.</p>'}`);
  }

  renderDatabases(d) {
    this.setHead('databases:' + (d.account || 'all'), signCanvas('db', 4), 'Bases de datos', d.accountLabel ? `Cuenta ${esc(d.accountLabel)}` : 'MySQL / MariaDB · todo el servidor', '');
    if (!d.available) return this.content('<p class="dmuted">No se encontró el directorio de datos de MySQL/MariaDB en este servidor.</p>');
    const shown = d.dbs.reduce((n, x) => n + x.size, 0);
    const max = d.dbs.reduce((n, x) => Math.max(n, x.size), 1);
    this.content(`${dbActivity(d.activity)}
      <div class="dstats">${stat('Bases', d.account ? d.dbs.length : d.count)}${stat('Espacio', fmtBytes(d.account ? shown : d.total))}${stat('La más grande', d.dbs[0] ? fmtBytes(d.dbs[0].size) : '–')}</div>
      ${jobLine(d.job)}
      <p class="hint">La lista se lee de los archivos del servidor de bases, sin conectarse ni ejecutar consultas. Toque una base para auditarla: tablas, qué sitio la usa, qué creció y hallazgos.</p>
      <section class="dsec"><ul class="dlist">${d.dbs.map(x => dbRow(x, max)).join('')}</ul></section>`);
  }

  renderDatabase(d) {
    this.setHead('database:' + d.id, signCanvas('db', 4), d.name,
      `${d.account ? `<a data-go="district:${esc(d.account)}">${esc(d.accountLabel)}</a> · ` : ''}${d.tables} tabla${d.tables === 1 ? '' : 's'} · ${fmtBytes(d.size)}`, '');
    const priv = !!d.findings;
    const when = d.audited ? `Última auditoría hace ${ago(Date.now() - d.audited)}` : 'Todavía no se auditó esta base.';
    const btn = d.running ? '' : priv ? `<button class="btn small" data-audit-db="${esc(d.name)}"${d.job ? ' disabled' : ''}>${d.audited ? 'Auditar de nuevo' : 'Analizar ahora'}</button>` : '';
    let head = `<div class="dstats">${stat('Tamaño', fmtBytes(d.size))}${stat('Tablas', d.tables)}${stat('Última escritura', d.lastWrite ? 'hace ' + ago(Date.now() - d.lastWrite) : '–')}</div>
      <section class="dsec"><div class="row dmrow"><span class="grow dmuted">${d.running ? '⏳ Auditando…' : when}</span>${btn}</div>
      ${d.job && !d.running ? jobLine(d.job) : ''}
      ${priv || d.audited ? '' : '<p class="dmuted">Active el modo privado para auditar la base y ver sus tablas.</p>'}</section>`;
    const act = d.activity && d.activity.available && d.activity.db;
    if (act) head += `<section class="dsec"><h4>Actividad ahora</h4><div class="dstats">${stat('Conexiones', act.conns)}${stat('Consultas en curso', act.active)}${stat('Ocupada', act.busy + '%', act.busy >= 50 ? 'warn' : '')}</div>
      ${dbQuery(act.longest, 'La más larga ahora')}${act.peak && (!act.longest || act.peak.time > act.longest.time) ? dbQuery(act.peak, `La más lenta de la última hora (hace ${ago(Date.now() - act.peak.at)})`) : ''}
      <p class="hint">«Ocupada»: en qué parte de los últimos 15 minutos tuvo al menos una consulta corriendo (una muestra cada 5 s).</p></section>`;
    else if (d.activity && d.activity.available) head += '<section class="dsec"><p class="dmuted">Sin conexiones ni consultas en los últimos 15 minutos.</p></section>';
    if (!d.audited) return this.content(head);
    const LV = { warn: px('warn'), info: px('info'), ok: px('ok') };
    if (!priv) {
      const c = d.findingCounts;
      return this.content(head + `<section class="dsec"><h4>Resultado</h4><ul class="dlist">
        <li><span class="grow">${d.inUse ? 'Un sitio o app de la cuenta la usa' : 'Ningún archivo de configuración la menciona'}</span></li>
        <li><span class="grow">Hallazgos: ${c.warn || 0} ${px('warn')} · ${c.info || 0} ${px('info')}</span></li>
        <li><span class="grow">Motores: ${d.engines.map(e => `${esc(e.key)} ×${e.n}`).join(' · ')}</span></li></ul>
        <p class="dmuted">Active el modo privado para ver tablas, archivos y hallazgos concretos.</p></section>`);
    }
    const dg = d.prevAt ? d.auditSize - d.prevSize : 0;
    const growth = d.prevAt ? `<p class="dmuted">Comparado con la auditoría del ${new Date(d.prevAt).toLocaleDateString('es-VE')}: ${dg ? (dg > 0 ? '+' : '−') + fmtBytes(Math.abs(dg)) : 'sin cambios de tamaño'}.</p>` : '';
    const users = d.users.length ? d.users.map(u => `<li>${u.domain ? `<span class="grow"><b>${esc(u.domain)}</b>` : `<span class="grow">${u.project ? `Proyecto <b>${esc(u.project)}</b>` : 'App'}`}<br><span class="mono dmuted">${esc(u.file)}</span></span></li>`).join('')
      : '<li class="dmuted">Ningún archivo de configuración de la cuenta menciona esta base.</li>';
    const tmax = d.tables.reduce((n, t) => Math.max(n, t.size), 1);
    const tables = d.tables.map(t => `<li class="bar"><span class="grow mono">${esc(t.name)} <span class="dmuted">${esc(t.engine)}</span></span>
        <span class="bw"><i style="width:${(t.size / tmax * 100).toFixed(1)}%"></i></span><span class="mono">${fmtBytes(t.size)}</span>
        <span class="mono pct ${t.delta > 0 ? 'upd' : t.delta < 0 ? 'dnd' : 'dmuted'}">${t.delta ? (t.delta > 0 ? '+' : '−') + fmtBytes(Math.abs(t.delta)) : ''}</span></li>`).join('');
    this.content(head + `<section class="dsec"><h4>Hallazgos</h4><ul class="dlist">${d.findings.map(f => `<li><span>${LV[f.level] || ''}</span><span class="grow">${esc(f.text)}</span></li>`).join('')}</ul>${growth}</section>
      <section class="dsec"><h4>¿Quién la usa?</h4><ul class="dlist">${users}</ul><p class="hint">Se buscó el nombre de la base en los archivos de configuración de la cuenta (.env, wp-config.php, config.php…). Nunca se muestra su contenido.</p></section>
      <section class="dsec"><h4>Tablas por tamaño${d.tableCount > d.tables.length ? ` · las ${d.tables.length} más grandes de ${d.tableCount}` : ''}</h4><ul class="dlist">${tables}</ul></section>`);
  }
}

const KIND_ICON = { cloudflare: px('cloud'), vercel: px('triangle'), supabase: px('bolt'), app: px('gear'), site: px('web'), hosting: px('house'), repo: px('box') };
const LEVEL_ICON = { ok: px('ok'), info: px('info'), warn: px('warn'), bad: px('bad'), unknown: px('unknown') };
const scoreCls = s => s >= 85 ? 'ok' : s >= 60 ? 'warn' : 'bad';
function projJob(j) { return j ? `<p class="dmuted">⏳ En curso: ${esc(j.label)} (hace ${ago(Date.now() - j.startedAt)}).</p>` : ''; }

// defensa de Atalaya: bloqueos (activos e historial) y la defensa automatica
function defenseSection(D, priv) {
  if (!D || !D.available) return '';
  const now = Date.now();
  const rows = D.records.slice(0, 15).map(r => {
    const on = r.status === 'active' && r.until > now;
    const left = on ? `vence en ${ago(r.until - now + 60000).replace(/^hace /, '')}` : r.status === 'lifted' ? 'desbloqueada' : 'venció';
    return `<li><span class="grow">${priv && r.ip ? `<span class="mono">${esc(r.ip)}</span> · ` : ''}${esc(r.why)}${r.site ? ` · ${esc(r.site)}` : ''}<br>
      <span class="dmuted">${r.by === 'auto' ? 'automático' : 'por ' + esc(r.by)} · ${new Date(r.at).toLocaleString('es-VE', { hour12: false, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${left}</span></span>
      ${on && priv && r.ip ? `<button class="btn small ghost" data-unblock-ip="${esc(r.ip)}">Desbloquear</button>` : on ? '<span class="pill bad">activo</span>' : ''}</li>`;
  }).join('');
  const conf = priv ? `<div class="defbox">
      <label class="check"><input type="checkbox" name="auto" ${D.auto ? 'checked' : ''}><span><b>Defensa automática</b><small>Bloquea sola a quien encontró una ruta expuesta, hace fuerza bruta, scraping o sondea varios sitios; y si MySQL o la carga llegan al límite, a quienes atacan en ese momento. Nunca a Cloudflare, redes privadas, este servidor, usuarios de Atalaya ni la lista blanca.</small></span></label>
      <div class="row"><label>Duración <select name="hours">${[1, 6, 24, 72, 168].map(h => `<option value="${h}"${h === D.hours ? ' selected' : ''}>${h < 24 ? h + ' h' : h / 24 + ' día' + (h > 24 ? 's' : '')}</option>`).join('')}</select></label></div>
      <label class="stack">IPs que nunca se bloquean (una por línea)<textarea name="allow" rows="2" spellcheck="false">${esc((D.allow || []).join('\n'))}</textarea></label>
      <p class="row"><button class="btn small" data-def-save>Guardar</button></p></div>` : `<p class="dmuted">Defensa automática: <b>${D.auto ? 'encendida' : 'apagada'}</b>.</p>`;
  // Cloudflare: la carcel tambien alla (conexion con un token) y el aviso de los sitios sin la IP real
  const C = D.cloudflare;
  const cf = !C ? '' : `<div class="defbox cfbox"><p><b>${px('web')} Bloquear también en Cloudflare</b></p>
      ${D.cfSites ? `<p class="cfwarn">${D.cfSites} sitio(s) llegan desde Cloudflare sin la IP real de sus visitantes: el firewall de este servidor no frena a sus atacantes. Conectar Cloudflare lo resuelve.</p>` : ''}
      ${C.connected ? `<p class="dmuted">Conectado: ${esc(C.zones.join(', '))}. ${C.rules ? `${C.rules} regla(s) de bloqueo activas allá.` : 'Sin reglas activas ahora.'}${C.lastError ? ` <span class="bad">Último error: ${esc(C.lastError)}</span>` : ''}</p>
        ${priv ? `<label class="check"><input type="checkbox" name="cfon" ${C.on ? 'checked' : ''} data-cf="on"><span><b>Llevar la cárcel a Cloudflare</b><small>Cada IP bloqueada se bloquea también en la zona de su sitio; al salir de la cárcel, la regla se borra.</small></span></label>
        <p class="row"><button class="btn small ghost" data-cf="disconnect">Desconectar</button></p>` : ''}`
      : priv ? `<p class="hint">Si sus sitios están detrás de Cloudflare, sus atacantes siguen entrando por sus nodos aunque estén en la cárcel. Cree un token en Cloudflare (Mi perfil › Tokens de API › Crear token) con <b>Zone › Zone › Read</b> y <b>Zone › Firewall Services › Edit</b> sobre sus dominios, y péguelo aquí.</p>
        <p class="row"><input type="password" name="cftoken" placeholder="Token de API de Cloudflare" autocomplete="off" spellcheck="false" style="flex:1 1 16rem;min-width:0"><button class="btn small" data-cf="connect">Conectar</button></p>` : '<p class="dmuted">Sin conectar.</p>'}
      <p class="cf-out dmuted" role="status"></p></div>`;
  return `<section class="dsec"><h4>${px('shield')} Defensa de Atalaya ${D.active ? `<span class="pill bad">${D.active} bloqueo(s) activo(s)</span>` : ''}</h4>
    ${conf}${cf}${rows ? `<ul class="dlist">${rows}</ul>` : '<p class="dmuted">Todavía no hay bloqueos.</p>'}<p class="dlinks"><a data-go="jail:all">${px('jail')} Ver la cárcel</a></p></section>`;
}

// actividad de las bases: lo que importa (conexiones contra el maximo, consultas por segundo) y las bases mas
// ocupadas; el texto de las consultas solo en privado y sin valores
function dbQuery(q, label) {
  if (!q) return '';
  return `<div class="dbq"><span class="dmuted">${esc(label)}: <b class="${q.time >= 10 ? 'bad' : q.time >= 3 ? 'warn' : ''}">${q.time} s</b>${q.state ? ` · ${esc(q.state)}` : ''}</span>${q.query ? `<code>${esc(q.query)}</code>` : ''}</div>`;
}
// tarjeta de analitica en la ficha de un sitio o app: visitantes de 7 dias, comparacion y barras por dia
// detras de Cloudflare sin la IP real: que se ve mal y como arreglarlo
function cfWarn(d) {
  if (!d.cfOnly) return '';
  const ed = document.body.classList.contains('ed-hosting') ? 'hosting' : 'vps';
  return `<section class="dsec"><div class="afind warn"><h5>${px('warn')} Este sitio llega desde Cloudflare sin la IP real</h5>
    <p>El servidor recibe la dirección de los nodos de Cloudflare, no la de sus visitantes. Por eso la analítica cuenta menos visitantes y países equivocados, y la defensa no puede frenar a los atacantes de este sitio con el firewall.</p>
    <p class="dmuted">${ed === 'hosting' ? 'Pídale a su proveedor de hosting que active <b>mod_remoteip</b> con la cabecera <b>CF-Connecting-IP</b> para su cuenta.' : 'En WHM › EasyApache 4, active <b>mod_remoteip</b> y configure <span class="mono">RemoteIPHeader CF-Connecting-IP</span> con los rangos de Cloudflare como proxies de confianza (o instale el plugin de Cloudflare para cPanel, que lo hace solo). En otros servidores, lo mismo en la configuración de Apache o Nginx (real_ip_header).'} Para bloquear igual a los atacantes, <a data-go="webdef:all">conecte Cloudflare en la defensa</a>.</p></div></section>`;
}
function anaCard(d) {
  const a = d.analytics; if (!a) return '';
  const p = a.prevVisitors ? Math.round((a.visitors - a.prevVisitors) / a.prevVisitors * 100) : null;
  const max = Math.max(1, ...a.series);
  const go = `analytics:${d.kind}:${d.id}`;
  return `<section class="dsec anacard link" data-go="${esc(go)}"><h4>${px('chart')} Analítica · 7 días</h4>
    <div class="anarow"><div><b>${fmtNum(a.visitors)}</b> visitantes${p != null && p ? ` <small class="${p > 0 ? 'up' : 'down'}">${p > 0 ? '+' : ''}${p}%</small>` : ''}<br><span class="dmuted">${fmtNum(a.pv)} páginas vistas${a.bounce != null ? ` · rebote ${Math.round(a.bounce * 100)}%` : ''}</span></div>
    <div class="anamini">${a.series.map(n => `<i style="height:${Math.max(3, Math.round(n / max * 100))}%"></i>`).join('')}</div></div>
    <p class="row"><button class="btn small" data-go="${esc(go)}">Ver analítica completa</button>${!a.since ? '<span class="dmuted">empieza a medir desde hoy</span>' : ''}</p></section>`;
}
// grafica por dia: barras de visitantes y linea de paginas vistas, en SVG nitido que se adapta al ancho
function anaChart(series) {
  if (!series.length) return '';
  const W = 600, H = 150, pad = 18, n = series.length;
  const maxV = Math.max(1, ...series.map(x => x.visitors)), maxP = Math.max(1, ...series.map(x => x.pv));
  const bw = (W - pad) / n;
  const bars = series.map((x, i) => { const h = Math.round(x.visitors / maxV * (H - 30)); return `<rect x="${(pad + i * bw + bw * 0.15).toFixed(1)}" y="${H - 16 - h}" width="${Math.max(1, bw * 0.7).toFixed(1)}" height="${h}" rx="1"><title>${x.date}: ${x.visitors} visitantes · ${x.pv} páginas</title></rect>`; }).join('');
  const line = series.map((x, i) => `${(pad + i * bw + bw / 2).toFixed(1)},${(H - 16 - x.pv / maxP * (H - 30)).toFixed(1)}`).join(' ');
  const lab = i => { const d = new Date(series[i].date + 'T12:00:00'); return d.toLocaleDateString('es-VE', n > 60 ? { month: 'short' } : { day: 'numeric', month: 'short' }); };
  const ticks = [0, Math.floor(n / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i).map(i => `<text x="${(pad + i * bw + bw / 2).toFixed(1)}" y="${H - 3}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${lab(i)}</text>`).join('');
  return `<svg class="anachart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Visitantes por día">
    <text x="0" y="10" class="ymax">${fmtNum(maxV)}</text><g class="vb">${bars}</g>${n > 1 ? `<polyline class="pvl" points="${line}"/>` : ''}${ticks}</svg>
    <p class="analeg"><span class="k1"></span> visitantes <span class="k2"></span> páginas vistas</p>`;
}
function spark(hist, key, max) {
  if (!hist || hist.length < 2) return '';
  const w = 240, h = 34, m = Math.max(max || 0, ...hist.map(x => x[key]), 1);
  const pts = hist.map((x, i) => `${(i / (hist.length - 1) * w).toFixed(1)},${(h - x[key] / m * (h - 2) - 1).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts}"/></svg>`;
}
function dbActivity(a) {
  if (!a) return '';
  if (!a.available) return a.canEnable ? `<section class="dsec dbact off"><h4>${px('db')} Actividad de las bases</h4>
      <p class="lhelp">Vea qué base está trabajando ahora, qué consultas tardan y qué tan cerca está el servidor de quedarse sin conexiones.
        Se crea un usuario de MySQL con un único permiso (<b>PROCESS</b>: ver las consultas en curso), que no puede leer ni cambiar datos.</p>
      <button class="btn small" data-dbmon="on">Activar</button></section>` : '';
  if (a.error && !a.lastOk) return `<section class="dsec"><h4>Actividad de las bases</h4><p class="msg bad">${esc(a.error)}</p>${a.priv ? '<button class="btn small ghost" data-dbmon="on">Activar de nuevo</button>' : ''}</section>`;
  const pct = a.max ? a.conns / a.max : 0, peak = a.max ? a.maxUsed / a.max : 0;
  const cls = pct >= 0.8 ? 'bad' : pct >= 0.6 || peak >= 0.9 ? 'warn' : '';
  const rows = a.dbs.map(x => `<li class="bar link" data-go="database:${esc(x.id)}"><span class="grow"><span class="mono">${esc(x.name)}</span>${x.accountLabel ? ` <span class="dmuted">· ${esc(x.accountLabel)}</span>` : ''}
      <br><span class="dmuted">${x.conns} conexión(es)${x.active ? ` · <b>${x.active} en curso</b>` : ''}${x.longest && x.longest.time >= 1 ? ` · la más larga ${x.longest.time} s` : ''}</span></span>
      <span class="bw" title="Ocupada el ${x.busy}% de los últimos 15 min"><i style="width:${Math.max(x.busy, x.active ? 4 : 0)}%"></i></span><span class="mono pct">${x.busy}%</span></li>`).join('');
  return `<section class="dsec dbact"><h4>${px('db')} Actividad ahora</h4>
    <div class="dstats">${stat('Conexiones', `${a.conns} / ${a.max}`, cls)}${stat('Consultas por segundo', a.rates ? a.rates.qps : '…')}${stat('En curso', a.running)}${stat('Pico histórico', `${a.maxUsed} / ${a.max}`, peak >= 0.9 ? 'warn' : '')}</div>
    <div class="connbar ${cls}" title="Conexiones abiertas contra el máximo"><i style="width:${Math.min(100, pct * 100).toFixed(1)}%"></i><s style="left:${Math.min(100, peak * 100).toFixed(1)}%"></s></div>
    ${a.history.length > 1 ? `<div class="sparks"><div><span class="dmuted">Conexiones · 1 h</span>${spark(a.history, 'conns', a.max)}</div><div><span class="dmuted">Consultas/s · 1 h</span>${spark(a.history, 'qps')}</div></div>` : ''}
    ${a.rates ? `<p class="dmuted">Por segundo: ${a.rates.select} lecturas · ${a.rates.insert} altas · ${a.rates.update} cambios · ${a.rates.delete} borrados${a.rates.slow ? ` · <b>${a.rates.slow} lenta(s)</b> en 30 s` : ''}</p>` : ''}
    ${a.refused ? `<p class="msg bad">${a.refused} conexión(es) rechazadas por falta de lugar desde el último arranque de MySQL.</p>` : ''}
    ${rows ? `<ul class="dlist">${rows}</ul>` : '<p class="dmuted">Ninguna base con conexiones en los últimos 15 minutos.</p>'}
    ${a.noDbConns ? `<p class="dmuted">${a.noDbConns} conexión(es) sin base elegida (paneles, respaldos o el propio servidor).</p>` : ''}
    <p class="hint">Una muestra cada 5 s con un usuario de MySQL que solo ve las consultas en curso. Toque una base para ver su consulta más larga${a.dbs.some(x => x.longest && x.longest.query) ? ' (sin sus valores)' : ' (en modo privado)'}.
      ${a.priv ? '<a href="#" data-dbmon="off" class="dmuted">Apagar</a>' : ''}</p></section>`;
}

// fila de una base en listas (distrito y panel de bases)
function dbRow(x, max) {
  return `<li class="link${max ? ' bar' : ''}" data-go="database:${esc(x.id)}"><span class="grow"><span class="mono">${esc(x.name)}</span>${x.shadow ? ' <span class="dmuted">· shadow</span>' : ''}
    ${x.accountLabel ? `<br><span class="dmuted">${esc(x.accountLabel)} · ${x.tables} tablas · escrita hace ${ago(Date.now() - x.lastWrite)}</span>` : `<br><span class="dmuted">${x.tables} tablas</span>`}</span>
    ${max ? `<span class="bw"><i style="width:${(x.size / max * 100).toFixed(1)}%"></i></span>` : ''}<span class="mono">${fmtBytes(x.size)}</span></li>`;
}
function jobLine(j) { return j ? `<p class="dmuted">⏳ En curso: ${esc(j.label)} (hace ${ago(Date.now() - j.startedAt)}). Los análisis corren de a uno para no cargar el servidor.</p>` : ''; }

// Cloudflare: visitas de la zona (totales de Cloudflare), despliegues de Pages y corridas de un Worker
function cfTraffic(t, title) {
  if (!t || !t.day) return '';
  const days = t.days || [], maxD = Math.max(1, ...days.map(x => x.visitors));
  const week = days.length ? `<div class="anahours">${days.map(x => `<i style="height:${Math.max(3, Math.round(x.visitors / maxD * 100))}%" title="${esc(x.date)} · ${fmtNum(x.visitors)} visitantes"></i>`).join('')}</div><p class="hint">Visitantes por día, última semana.</p>` : '';
  const total = (t.countries || []).reduce((n, x) => n + x.n, 0);
  return `<section class="dsec"><h4>${px('chart')} ${title}</h4>
    <div class="anakpi"><div><span>Visitantes · 24 h</span><b>${fmtNum(t.day.visitors)}</b></div><div><span>Páginas vistas</span><b>${fmtNum(t.day.pages)}</b></div>
      <div><span>Peticiones</span><b>${fmtNum(t.day.requests)}</b></div><div><span>Errores 5xx hoy</span><b class="${t.day.err5xx ? 'bad' : ''}">${fmtNum(t.day.err5xx)}</b></div></div>
    ${week}
    ${t.countries && t.countries.length ? `<h5 class="anasub">Países de hoy</h5><ul class="dlist">${bars(t.countries, k => `${flag(k)} ${esc(countryName(k))}`, total)}</ul>` : ''}
    <p class="hint">Son las cifras de Cloudflare para todo el dominio${t.zone ? ` <span class="mono">${esc(t.zone)}</span>` : ''}: incluyen robots y llegan con hasta una hora de atraso. Para páginas, origen y conversiones pegue el script de un <a data-go="district:_sitios">sitio vigilado</a>.</p></section>`;
}
function cfHtml(d, DEP) {
  const priv = !!d.domains;
  if (d.cfKind === 'worker') {
    const every = d.every ? (d.every < 3600000 ? `cada ${Math.round(d.every / 60000)} min` : d.every < 86400000 ? `cada ${Math.round(d.every / 3600000)} h` : 'una vez al día o menos') : '';
    const rate = d.runs ? Math.round(d.runErrors / d.runs * 100) : 0;
    return `${d.silent ? `<section class="dsec"><div class="afind bad"><h5>${px('siren')} Su reloj dejó de correr</h5>
        <p class="dmuted">Debería correr ${every} y ${d.lastRun ? 'la última vez fue hace ' + ago(Date.now() - d.lastRun) : 'no ha corrido en las últimas 48 horas'}.</p>
        <p class="fix">Cloudflare no avisa cuando un reloj deja de dispararse: no hay error, solo silencio. En el panel de Cloudflare abra Workers y Pages › este Worker › Settings › Triggers y revise que el reloj siga ahí; volver a desplegarlo suele reactivarlo. Recuerde que el plan gratis permite 5 relojes por cuenta.</p></div></section>` : ''}
      <div class="dstats">${stat('Corridas · 24 h', fmtNum(d.runs || 0))}${stat('Con error', fmtNum(d.runErrors || 0) + (d.runs ? ` (${rate}%)` : ''), rate > 50 ? 'bad' : rate > 5 ? 'warn' : '')}
        ${stat('Última corrida', d.lastRun ? 'hace ' + ago(Date.now() - d.lastRun) : '–')}${d.hasCron ? stat('Reloj', every || 'sí') : ''}</div>
      ${priv && d.crons && d.crons.length ? `<p class="dmuted">Relojes: ${d.crons.map(c => `<span class="chip mono">${esc(c)}</span>`).join(' ')}</p>` : ''}
      <p class="hint">Las corridas se leen de Cloudflare cada 5 minutos y se conocen por hora.</p>`;
  }
  return `<section class="dsec"><h4>Despliegues recientes</h4><ul class="dlist">${(d.deployments || []).map(x => `<li class="dep">
      <time>${hhmm(x.created)}</time><span class="pill ${(DEP[x.state] || ['off'])[0]}">${(DEP[x.state] || ['', x.state])[1]}</span><span class="chip">${x.target === 'production' ? 'producción' : 'preview'}</span>
      <span class="grow">${x.commit ? esc(x.commit) : ''}${x.branch ? ` <span class="dmuted mono">${esc(x.branch)}</span>` : ''}${x.creator ? ` <span class="dmuted">· ${esc(x.creator)}</span>` : ''}</span></li>`).join('') || '<li class="dmuted">Sin despliegues todavía.</li>'}</ul></section>
    ${priv && d.domains.length ? `<p class="dmuted">${d.domains.map(x => `<span class="chip">${esc(x)}</span>`).join(' ')}${d.repoHost ? ` · código en ${esc(d.repoHost === 'gitlab' ? 'GitLab' : d.repoHost === 'github' ? 'GitHub' : d.repoHost)}` : ''}</p>` : ''}
    ${cfTraffic(d.traffic, 'Visitas según Cloudflare')}`.replace(/^/, d.status === 'down' ? `<section class="dsec"><div class="afind bad"><h5>${px('siren')} Falló el último despliegue a producción</h5><p class="fix">El sitio sigue sirviendo la versión anterior. En Cloudflare abra Workers y Pages › este proyecto › Deployments y mire el registro del despliegue fallido: casi siempre es un error al compilar. Corríjalo y vuelva a desplegar.</p></div></section>` : '');
}
function cfDistrict(c) {
  return `<section class="dsec"><h4>${px('cloud')} Cuenta de Cloudflare</h4>
    <div class="dstats">${stat('Proyectos de Pages', c.pages)}${stat('Workers', c.workers)}${stat('Dominios', c.zones)}</div>
    ${(c.warn || []).map(w => `<p class="dmuted">${px('warn')} ${esc(w)}</p>`).join('')}</section>
    ${(c.traffic || []).map(t => cfTraffic(t, t.zone ? `Visitas de ${esc(t.zone)}` : 'Visitas de un dominio')).join('')}`;
}

// latido: un cron, un respaldo o un programa que avisa al terminar
function beatHtml(d) {
  const b = d.beat; if (!b) return '<p class="dmuted">Sin datos de este latido.</p>';
  const mins = n => n < 60 ? `${n} min` : n < 1440 ? `${Math.round(n / 60 * 10) / 10} h`.replace('.', ',') : n === 1440 ? '1 día' : `${Math.round(n / 1440 * 10) / 10} días`.replace('.', ',');
  const head = b.paused ? `<p class="dmuted">${px('clock')} En pausa: no se revisa ni avisa.</p>`
    : b.state === 'late' ? `<div class="afind bad"><h5>${px('siren')} No dio señal a tiempo</h5><p class="dmuted">Debía avisar cada ${mins(b.every)} (con ${mins(b.grace)} de tolerancia) y ${b.last ? 'la última señal fue hace ' + ago(Date.now() - b.last) : 'no llegó ninguna'}.</p>
        <p class="fix">Revise que la tarea siga programada y que haya terminado bien: la señal solo se envía cuando el comando termina sin error. Si cambió la dirección o el servidor, vuelva a pegarla.</p></div>`
    : b.state === 'failed' ? `<div class="afind bad"><h5>${px('siren')} Avisó que falló</h5><p class="dmuted">Hace ${ago(Date.now() - b.last)}${b.lastNote ? ` · «${esc(b.lastNote)}»` : ''}.</p><p class="fix">La tarea corrió pero reportó un error. Revise su registro en el equipo donde corre.</p></div>`
    : b.state === 'new' ? `<p class="dmuted">${px('clock')} Esperando la primera señal.${b.note ? ' ' + esc(b.note) + '.' : ''}</p>`
    : `<p>${px('ok')} <b>Al día</b> · última señal hace ${ago(Date.now() - b.last)}</p>`;
  const S = b.series || [], maxMs = Math.max(1, ...S.map(x => x.ms || 0));
  const bars = S.length ? `<div class="anahours upbars">${S.slice(-96).map(x => `<i class="${x.ok && x.onTime ? '' : 'bad'}" style="height:${x.ok ? Math.max(12, Math.round((x.ms || 0) / maxMs * 100)) : 100}%" title="${new Date(x.t).toLocaleString('es-VE', { hour12: false, day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })} · ${x.ok ? (x.onTime ? 'a tiempo' : 'tarde') : 'falló'}"></i>`).join('')}</div>` : '';
  return `<section class="dsec"><h4>${px('clock')} Latido</h4>${head}
    <div class="dstats">${stat('Debe avisar', b.every === 1440 ? 'cada día' : 'cada ' + mins(b.every))}${stat('Tolerancia', mins(b.grace))}${stat('Próxima señal', b.next ? (b.next > Date.now() ? 'en ' + ago(b.next - Date.now()) : 'ya debía llegar') : '–', b.next && b.next < Date.now() ? 'warn' : '')}
      ${stat('A tiempo', b.pct == null ? '–' : String(b.pct).replace('.', ',') + '%')}${stat('Señales', fmtNum(b.beats || 0))}${stat('Con fallo', fmtNum(b.fails || 0), b.fails ? 'warn' : '')}</div>
    ${bars}
    <p class="hint">Un latido es una dirección secreta que su tarea toca al terminar bien. Si deja de tocarla, Atalaya avisa. Para cambiarlo o ver la dirección: menú › Vigilar sitios y latidos.</p></section>`;
}

// Supabase: por donde envia correo el proyecto (sale de su configuracion, con el token de la cuenta)
function sbMail(d) {
  const m = d.mail;
  if (!m) return `<section class="dsec"><h4>${px('mail')} Correo del proyecto</h4><p class="dmuted">Para ver por dónde envía correo este proyecto, conéctelo con el token de su cuenta de Supabase: menú › Conectar o arreglar proyectos › Supabase.</p></section>`;
  if (m.error) return `<section class="dsec"><h4>${px('mail')} Correo del proyecto</h4><p class="dmuted">${px('warn')} ${esc(m.error)}.</p></section>`;
  const rows = (m.findings || []).map(f => `<div class="afind ${f.level === 'bad' ? 'bad' : f.level === 'warn' ? 'warn' : 'info'}"><h5>${px(f.level === 'bad' ? 'bad' : f.level === 'warn' ? 'warn' : 'info')} ${esc(f.text)}</h5><p class="fix">${esc(f.fix)}</p></div>`).join('');
  return `<section class="dsec"><h4>${px('mail')} Correo del proyecto</h4>${rows}
    <div class="dstats">${stat('Envía por', esc(m.provider), m.sandbox ? 'bad' : m.custom ? '' : 'warn')}${stat('Tope por hora', m.perHour == null ? '–' : fmtNum(m.perHour))}${stat('Confirma el correo', m.confirm ? 'sí' : 'no', m.confirm ? '' : 'warn')}</div>
    ${m.host !== undefined ? `<dl class="dkv">${m.host ? `<dt>Servidor</dt><dd class="mono">${esc(m.host)}${m.port ? ':' + esc(m.port) : ''}</dd>` : ''}${m.sender ? `<dt>Remitente</dt><dd>${m.senderName ? esc(m.senderName) + ' · ' : ''}<span class="mono">${esc(m.sender)}</span></dd>` : ''}${m.everySecs != null ? `<dt>Entre correos a la misma persona</dt><dd>${esc(m.everySecs)} s</dd>` : ''}</dl>` : ''}
    <p class="hint">Son los correos que envía Supabase Auth: confirmar la cuenta, recuperar la clave, enlaces de acceso. Sale de la configuración del proyecto; Atalaya no lee el usuario ni la contraseña del servidor de correo.</p></section>`;
}
