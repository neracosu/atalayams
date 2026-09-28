// Fichas flotantes al pasar el mouse y leyenda de iconos.
// Todo elemento con data-tip (HTML) o con .tip (objeto del mundo) explica que es.
import { animate } from '../vendor/anime.esm.min.js';
import { px } from './pixicons.js';
import { signCanvas, robotCanvas, iconCanvas } from './sprites.js';
import { esc } from './hud.js';
import { SKINS, BASE_NAMES } from './fxskins.js';
import { ART } from './legendart.js';
import { POLICE_CAR, FLY_POLICE, PROBE_CAR, CAR_COLORS, BUG, paintCanvas } from './pixeldata.js';

const tip = document.getElementById('tip');
let timer = null, visible = false, lastXY = { x: 0, y: 0 };

function place(x, y) {
  lastXY = { x, y };
  const r = tip.getBoundingClientRect();
  let nx = x + 18, ny = y + 18;
  if (nx + r.width > innerWidth - 8) nx = x - r.width - 18;
  if (ny + r.height > innerHeight - 8) ny = y - r.height - 18;
  tip.style.transform = `translate(${Math.max(8, nx)}px, ${Math.max(8, ny)}px)`;
}

// t = { title, body, meta, hint } | string
export function showTip(t, x, y) {
  if (!t) return hideTip();
  const d = typeof t === 'string' ? { body: t } : t;
  const html = `${d.title ? `<b>${esc(d.title)}</b>` : ''}${d.body ? `<p>${d.body}</p>` : ''}${d.meta ? `<p class="tmeta">${d.meta}</p>` : ''}${d.hint ? `<p class="thint">${esc(d.hint)}</p>` : ''}`;
  clearTimeout(timer);
  const go = () => {
    tip.innerHTML = html;
    tip.hidden = false;
    place(x, y);
    if (!visible) { visible = true; animate(tip, { opacity: [0, 1], scale: [0.96, 1], duration: 160, ease: 'outQuad' }); }
  };
  visible ? go() : (timer = setTimeout(go, 220)); // pequena espera: no parpadea al cruzar cosas
}
export function moveTip(x, y) { if (visible) place(x, y); else lastXY = { x, y }; }
export function hideTip() {
  clearTimeout(timer);
  if (!visible) return;
  visible = false;
  tip.hidden = true;
}

// fichas del HTML: cualquier elemento con data-tip="Titulo|Explicacion"
document.addEventListener('mouseover', e => {
  const el = e.target.closest('[data-tip]');
  if (!el) return;
  worldTip = false;
  const [title, body, hint] = el.dataset.tip.split('|');
  showTip({ title, body: body ? esc(body) : '', hint }, e.clientX, e.clientY);
});
document.addEventListener('mouseout', e => {
  const el = e.target.closest('[data-tip]');
  if (el && !el.contains(e.relatedTarget)) hideTip();
});
// las fichas del mundo (edificios, autos) se cierran apenas el mouse pasa a un panel encima del mapa: si no,
// quedaban pegadas sobre la ficha lateral o el HUD
let worldTip = false, overWorld = true;
export function showWorldTip(t, x, y) { if (!overWorld) return; worldTip = true; showTip(t, x, y); }
document.addEventListener('mousemove', e => {
  overWorld = !!(e.target && e.target.closest && e.target.closest('#world'));
  if (worldTip && !overWorld) { worldTip = false; hideTip(); return; }
  moveTip(e.clientX, e.clientY);
});

// ---------------------------------------------------------------- textos del mundo
export const STATION_TIPS = {
  library: ['Biblioteca', 'Aquí el agente <b>lee y busca</b> en el código: Read, Grep, Glob.'],
  workshop: ['Escritorio de edición', 'Aquí el agente <b>edita o escribe</b> archivos: Edit, Write.'],
  terminal: ['Terminal', 'Aquí el agente <b>ejecuta comandos</b> en el servidor: Bash.'],
  antenna: ['Globo · internet', 'Aquí el agente <b>consulta la web</b> o servicios externos: WebFetch, WebSearch, MCP.'],
  portal: ['Portal', 'Por aquí el agente <b>lanza subagentes</b> y los coordina. Los robots pequeños nacen aquí.'],
  desk: ['Escritorio', 'Aquí el agente <b>planifica</b>, organiza tareas o <b>descansa</b> cuando termina su turno.'],
};

// ---------------------------------------------------------------- leyenda
const dlg = document.getElementById('legend');
function row(icon, title, text) {
  return `<div class="lrow"><div class="lico">${icon}</div><div><b>${title}</b><p>${text}</p></div></div>`;
}
function dot(color, glow = true) { return `<span class="ldot" style="background:${color};${glow ? `box-shadow:0 0 10px ${color}` : ''}"></span>`; }

// leyenda: la del tema activo (theme.json > legend) o la de la Ciudad
const USO = `<section><h4>Cómo usarlo</h4>
        <p class="lhelp"><b>Arrastre</b> para moverse · <b>rueda</b> o pellizco para acercar · <b>clic</b> en cualquier cosa para ver su detalle · <b>doble clic</b> vuelve a la vista general.<br>
        Teclas: <kbd>D</kbd> director · <kbd>T</kbd> tema · <kbd>P</kbd> modo privado · <kbd>L</kbd> modo público · <kbd>F</kbd> pantalla completa · <kbd>?</kbd> esta leyenda · <kbd>V</kbd> visita guiada · <kbd>Esc</kbd> cerrar.</p>
      </section>`;
// arte del tema para la leyenda: dibujos de su propio mundo (legendart.js) o su elenco (fxskins.js)
const norm = f => { const w = Math.max(...f.map(r => r.length)); return f.map(r => r.padEnd(w, '.')); };
function artOf(theme, a) { return typeof a === 'string' ? (ART[theme] || {})[a] : a && a.rows ? a : null; }
function spriteOf(theme, key) {
  const S = SKINS[theme];
  if (S && !S.none && S[key]) return { rows: S[key][0], pal: S.pal };
  const base = { police: [POLICE_CAR[0], CAR_COLORS], fly: [FLY_POLICE[0], CAR_COLORS], probe: [PROBE_CAR[0], CAR_COLORS], queue: [PROBE_CAR[0].map(r => r.replace(/[Rr]/g, '.')), { ...CAR_COLORS, g: '#64748b', d: '#334155' }], bug: [BUG[0], { k: '#111827', r: '#ef4444', w: '#fde68a' }] }[key];
  return base ? { rows: base[0], pal: base[1] } : null;
}
// lienzo pixel del tamano justo para el hueco del icono (51 px de ancho, repartido si son varios)
function pixelCanvas(a, n = 1) {
  const rows = norm(a.rows), w = rows[0].length, h = rows.length;
  const k = Math.max(1, Math.min(4, Math.floor(Math.min(48 / n / w, 36 / h))));
  const cv = paintCanvas(rows, a.pal, k); cv.className = 'lart';
  return cv;
}
function iconHtml(it) {
  if (it.art || it.sprite) {
    const list = [].concat(it.art || []).map(a => ({ art: a })).concat([].concat(it.sprite || []).map(k => ({ sprite: k })));
    return list.map((x, i) => `<i data-art="${esc(typeof x.art === 'object' ? JSON.stringify(x.art) : x.art || '')}" data-sprite="${esc(x.sprite || '')}" data-n="${list.length}"></i>`).join('');
  }
  if (it.glyph) return `<span class="lglyph">${esc(it.glyph)}</span>`; // temas de solo texto (Terminal)
  return it.icon ? `<span class="linv">${px(it.icon, 'big')}</span>` : it.color ? dot(it.color, it.solid !== false) : '';
}
// los que vigilan: el elenco del tema (patrullas, captura, sondeos, fila y archivo malicioso), con sus nombres
function castSection(theme) {
  const S = SKINS[theme];
  if (S && S.none) return '';
  const N = (S && S.names) || BASE_NAMES;
  const T = {
    police: 'Vigila un sitio que están escaneando o raspando: se queda a su lado hasta que pasa la amenaza.',
    fly: 'Sale del servidor y vuela a capturar: lleva a la cárcel la IP bloqueada y, en una cápsula, el archivo malicioso. Si una IP sale libre, la acompaña a la salida.',
    probe: 'Un robot que llega a sondear una ruta vulnerable (/.env, /.git, wp-login…). Si rebota, muestra su código; si la ruta respondió, el sitio queda marcado <b>EXPUESTO</b>.',
    queue: 'Fila de espera junto a un sitio con un pico de visitas.',
    bug: 'Un archivo PHP sospechoso en un sitio. Cuando se captura, viaja a la cuarentena en una cápsula.',
  };
  return `<section><h4>Los que vigilan</h4>${Object.keys(T).map(k => row(`<i data-sprite="${k}" data-n="1"></i>`, esc(N[k]), T[k])).join('')}</section>`;
}
function hydrate(body, theme) {
  body.querySelectorAll('i[data-art], i[data-sprite]').forEach(el => {
    let a = null;
    if (el.dataset.sprite) a = spriteOf(theme, el.dataset.sprite);
    else if (el.dataset.art) { try { a = el.dataset.art.startsWith('{') ? JSON.parse(el.dataset.art) : artOf(theme, el.dataset.art); } catch { a = null; } }
    if (a) el.replaceWith(pixelCanvas(a, +el.dataset.n || 1)); else el.remove();
  });
}
function themeLegend(m) {
  return m.legend.map(sec => `<section><h4>${esc(sec.title)}</h4>${(sec.items || []).map(it =>
    row(iconHtml(it), esc(it.title), esc(it.text))).join('')}</section>`).join('') + castSection(m.id) + USO;
}
export function openLegend(manifest) {
  const id = manifest && manifest.legend ? manifest.id : 'ciudad';
  if (dlg.dataset.built !== id) {
    const first = !dlg.dataset.built;
    dlg.dataset.built = id;
    const body = dlg.querySelector('.lbody');
    dlg.querySelector('header h3').textContent = manifest && manifest.legend ? `Leyenda · ${manifest.name}` : 'Leyenda de Atalaya';
    if (manifest && manifest.legend) { body.innerHTML = themeLegend(manifest); hydrate(body, id); }
    else body.innerHTML = `
      <section><h4>El mundo</h4>
        ${row('<i data-c="robot"></i>', 'Robot = una sesión de Claude Code', 'Cada agente que está trabajando en el servidor. Los robots pequeños son sus subagentes. Encima llevan <b>…</b> si piensan, <b>!</b> si lo esperan a usted y <b>z</b> si están en pausa. Un halo ámbar significa que <b>espera su permiso</b>.')}
        ${row('<span class="lbld"></span>', 'Edificio = un servicio', 'Cada app que corre en PM2. <b>Altura</b>: memoria que usa. <b>Techo naranja</b>: CPU alta. <b>Ventanas encendidas</b>: visitas en este momento. Un destello blanco es un reinicio.')}
        ${row(`${dot('#22c55e')}${dot('#f59e0b')}${dot('#ef4444')}`, 'Luz del techo', 'Verde: en línea. Ámbar: le falta alguna instancia. Roja parpadeando: caído.')}
        ${row('<span class="lplate"></span>', 'Distrito = una cuenta cPanel', 'Cada cuenta tiene su color y su parcela. Abajo, sus seis estaciones de trabajo para los agentes.')}
        ${row('<i data-c="tower"></i>', 'Torre de control', 'El servidor mismo: su servidor web recibe todo el tráfico y lo reparte por las calles a cada distrito. Su escudo se enciende cuando repele un ataque. Si un <b>servicio clave</b> (base de datos, correo, SSH…) falla, la torre parpadea en rojo y lo anuncia.')}
        ${row('<i data-s="box"></i>', 'Distritos especiales', '<b>Servicios del sistema</b>: apps que corren como servicio de systemd. <b>Contenedores</b>: contenedores Docker o Podman. <b>Sitios del servidor</b>: sitios que no pertenecen a ninguna cuenta.')}
      </section>
      <section><h4>Estaciones de los agentes</h4>
        ${Object.entries(STATION_TIPS).map(([k, [t, x]]) => row(`<i data-i="${k}"></i>`, t, x)).join('')}
      </section>
      <section><h4>Lo que se mueve</h4>
        ${row('<i data-c="tower"></i>', 'Autopista y peaje', 'Por la autopista llegan las visitas desde Internet. El <b>peaje</b> es el firewall: la barrera se levanta para las visitas y los ataques revientan contra ella. Clic en la caseta: la defensa.')}
        ${row(dot('#67e8f9'), 'Auto cian', 'Una visita real: baja por la autopista, pasa el peaje y la torre, y sigue la calle hasta el edificio que la atiende.')}
        ${row(dot('#64748b', false), 'Auto gris', 'Un robot o rastreador (Google, bots de IA, monitores).')}
        ${row(`${dot('#f59e0b')}${dot('#ef4444')}`, 'Auto ámbar / rojo', 'Ámbar: error del visitante (4xx, p. ej. página no encontrada). Rojo: <b>error del servidor</b> (5xx) y chispa en el edificio.')}
        ${row(`<span class="linv">${px('invader', 'big')}</span>`, 'Invasor', 'Un intento de entrar por SSH con clave equivocada. Baja por la autopista y revienta contra la barrera del peaje. Si cPHulk bloquea la IP, aparece el aviso “IP bloqueada”.')}
        ${row(`<span class="linv">${px('invader', 'big')}</span>`, 'Auto con sirena', 'Un robot buscando una ruta vulnerable en un sitio (/.env, /.git, wp-login.php, phpmyadmin, webshells). Rebota con su código (404, 403); si la ruta respondió, el edificio queda en rojo con el cartel <b>EXPUESTO</b>. Detalle en Defensa › Defensa web.')}
        ${row(dot('#4ade80'), 'Cometa verde', 'Un acceso SSH correcto.')}
        ${row(`<span class="linv">${px('mail', 'big')}</span>`, 'Sobre', 'Correo: amarillo sale, violeta entra, rojo rebotó.')}
      </section>
      <section><h4>Defensa, correo y bases</h4>
        ${row('<i data-art="jail" data-n="1"></i>', 'Cárcel', 'Las IPs <b>bloqueadas</b>: las que se bloquearon a mano en el firewall y las que atrapó la defensa de Atalaya. La patrulla voladora las trae escoltadas. Clic: cada una, con su motivo y cuándo sale.')}
        ${row('<i data-art="capsule" data-n="1"></i>', 'Cápsula de cuarentena', 'Un archivo PHP malicioso atrapado: la patrulla lo encierra en una cápsula y lo lleva a la cárcel. No puede hacer daño y se puede restaurar.')}
        ${row('<i data-art="post" data-n="1"></i>', 'Oficina de correos', 'Por aquí pasa el correo del servidor: los sobres salen, llegan o rebotan con su motivo. Si la cola se atasca, las cartas se apilan en la puerta.')}
        ${row('<i data-art="silo" data-n="1"></i>', 'Silos y tuberías', 'Las bases de datos de cada distrito: más altos cuanto más pesan, rojos al límite. Las tuberías llegan a los edificios que las usan y los pulsos corren con cada consulta.')}
      </section>
      <section><h4>Cuando algo aprieta</h4>
        ${row(dot('#ef4444'), 'Torre en rojo y fila', 'Con el servidor al límite, la torre de control se pone roja y los autos hacen fila antes de entrar a la ciudad.')}
        ${row(dot('#fbbf24'), 'Línea de cuota', 'Bajo el nombre de un distrito, en ámbar o rojo, cuando la cuenta se acerca al límite de su disco o sus inodos.')}
      </section>
      ${castSection('ciudad')}
      <section><h4>Qué es cada servicio</h4>
        <div class="lsigns">${['shop', 'hotel', 'calendar', 'card', 'chat', 'support', 'gear', 'clock', 'mail', 'chart', 'trophy', 'dice', 'game', 'heart', 'ship', 'bowling', 'glass', 'web', 'wp', 'php', 'page', 'wip', 'db', 'cache', 'box']
          .map(k => `<span class="lsign"><i data-s="${k}"></i>${{ shop: 'Tienda', hotel: 'Hotel', calendar: 'Reservas', card: 'Pagos', chat: 'Mensajería', support: 'Mesa de ayuda', gear: 'Automatización', clock: 'Tarea programada', mail: 'Correo', chart: 'Prospección', trophy: 'Deportes', dice: 'Apuestas', game: 'Juego', heart: 'Salud', ship: 'Logística', bowling: 'Bowling', glass: 'Bar', web: 'Web / API', wp: 'WordPress', php: 'PHP', page: 'Sitio estático', wip: 'En construcción', db: 'Base de datos', cache: 'Caché', box: 'Contenedor' }[k]}</span>`).join('')}</div>
      </section>
      ${USO}`;
    if (!(manifest && manifest.legend)) hydrate(body, 'ciudad');
    body.querySelectorAll('[data-i]').forEach(el => el.replaceWith(iconCanvas(el.dataset.i, 3)));
    body.querySelectorAll('[data-s]').forEach(el => el.replaceWith(signCanvas(el.dataset.s, 3)));
    body.querySelectorAll('[data-c="robot"]').forEach(el => el.replaceWith(robotCanvas('#22d3ee', 3)));
    body.querySelectorAll('[data-c="tower"]').forEach(el => el.replaceWith(iconCanvas('terminal', 3)));
    if (first) {
      dlg.querySelector('.lclose').addEventListener('click', () => dlg.close());
      dlg.addEventListener('click', e => { if (e.target === dlg) dlg.close(); });
    }
  }
  if (!dlg.open) { dlg.showModal(); animate(dlg, { opacity: [0, 1], translateY: [16, 0], duration: 300, ease: 'outQuad' }); }
}
