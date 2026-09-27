// Piezas comunes de los temas, en 2D (PixiJS) o 3D (three.js): agrupar por cuenta, repartir grupos en filas
// para que se vean lo mas grandes posible y armar la lista de las placas que nombran cada proyecto.
// cuentas con lo que tienen (servicios primero, luego sitios), de la mas grande a la mas chica; sin 'root'
export function groupsOf(state) {
  const by = {};
  for (const a of state.apps) (by[a.account] = by[a.account] || []).push({ ...a, _k: 'app' });
  for (const x of state.sites || []) (by[x.account] = by[x.account] || []).push({ ...x, _k: 'site' });
  return state.accounts.filter(a => a.id !== 'root' && (by[a.id] || []).length)
    .map(a => ({ a, items: by[a.id].sort((x, y) => (x._k === y._k ? 0 : x._k === 'app' ? -1 : 1)) }))
    .sort((x, y) => y.items.length - x.items.length);
}
// huella de la distribucion: si no cambia, no hace falta rearmar el mundo
export function layoutKeyOf(state) {
  return groupsOf(state).map(g => g.a.id + ':' + g.a.label + ':' + (g.a.cpanel || '') + ':' + g.items.map(x => x.id + x.name + (x.icon || '')).join(',')).join('|');
}
// reparte grupos en 1 a 4 filas y se queda con la que deja todo mas grande en pantalla.
// w(g) y h(g) en unidades del mundo; gap entre grupos; aspect = ancho/alto del area libre;
// lead = ancho reservado al inicio de la primera fila; extraH = alto fijo que ocupa otra cosa (ej. el jefe)
export function packRows(list, { w, h, gap = 1.5, aspect = 1.7, lead = 0, extraH = 0 }) {
  let best = null;
  for (let n = 1; n <= Math.min(4, Math.max(1, list.length)); n++) {
    const target = (list.reduce((k, g) => k + w(g) + gap, lead)) / n;
    const rows = [[]]; let used = lead;
    for (const g of list) { if (used + w(g) / 2 > target && rows[rows.length - 1].length && rows.length < n) { rows.push([]); used = 0; } rows[rows.length - 1].push(g); used += w(g) + gap; }
    const widths = rows.map((r, i) => r.reduce((k, g) => k + w(g), 0) + (r.length - 1) * gap + (i === 0 ? lead : 0));
    const heights = rows.map(r => Math.max(...r.map(h)));
    const W = Math.max(...widths), H = heights.reduce((k, x) => k + x, 0);
    const score = Math.min(aspect / W, 1 / (H + extraH));
    if (!best || score > best.score) best = { rows, widths, heights, W, H, score };
  }
  return best;
}
// lista de una placa: cada proyecto con su dibujo pixel y su nombre; un clic lo abre
const iconCache = new Map();
export function iconURL(key, paint) { if (!iconCache.has(key)) iconCache.set(key, paint().toDataURL()); return iconCache.get(key); }
export function plaqueList(items, iconOf, isDown = it => it.status === 'down') {
  const e = v => String(v).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return items.map(it => `<span data-go="${it._k === 'site' ? 'site' : 'app'}:${e(it.id)}"${isDown(it) ? ' class="down"' : ''}><img alt="" src="${iconOf(it)}"><em>${e(it.name)}</em></span>`).join('');
}
// salud del servidor en una linea, para ponerla junto al servidor del mundo (torre, castillo, base...)
export function healthLine(state) {
  const h = (state && state.health) || [];
  if (!h.length) return null;
  const bad = h.reduce((n, x) => n + x.bad, 0), warn = h.reduce((n, x) => n + x.warn, 0);
  const sev = bad ? 'bad' : warn ? 'warn' : 'ok';
  const text = bad ? `Salud: ${bad} grave${bad === 1 ? '' : 's'}${warn ? ` · ${warn} para revisar` : ''}` : warn ? `Salud: ${warn} para revisar` : 'Salud: en orden';
  return { text, sev, color: { bad: '#ff5a4a', warn: '#f5b83d', ok: '#4ade80' }[sev] };
}
