// Favicons reales de los proyectos (solo en modo privado: el servidor los sirve desde su propio disco).
// El estado trae it.favicon = clave; cuando la imagen esta cargada, it.icon pasa a 'fav:<clave>' y todos los
// carteles (sprites.js) la dibujan en su marco. Mientras tanto, y si no tiene, se ve su cartel pixel.
const imgs = new Map(); // clave -> HTMLImageElement cargada | 'loading' | 'fail'
let onNew = () => { };
export function onFaviconLoaded(fn) { onNew = fn; }
export function favImage(key) { const v = imgs.get(key); return v && typeof v === 'object' ? v : null; }
function load(key) {
  if (imgs.has(key) || !/^[0-9a-f]{16}$/.test(key)) return;
  imgs.set(key, 'loading');
  const im = new Image();
  im.decoding = 'async';
  im.onload = () => { imgs.set(key, im.naturalWidth ? im : 'fail'); onNew(key); };
  im.onerror = () => imgs.set(key, 'fail');
  im.src = 'api/favicon/' + key;
}
// cambia el icono de cada item por su favicon si ya esta listo (y pide los que faltan)
export function withFavicons(list) {
  if (!Array.isArray(list)) return list; // en algunas fichas 'apps' o 'sites' es una cantidad, no una lista
  for (const it of list) {
    if (!it || !it.favicon) continue;
    if (favImage(it.favicon)) it.icon = 'fav:' + it.favicon; else load(it.favicon);
  }
  return list;
}
// al pasar a publico se olvidan las imagenes cargadas (los carteles vuelven a los pixel)
export function clearFavicons() { imgs.clear(); }
