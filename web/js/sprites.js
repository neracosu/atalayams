// Pixel art definido como codigo: cada sprite es una matriz de caracteres
// que se pinta en un canvas y se convierte en textura de PixiJS (escalado nearest).
import { Texture, CanvasSource } from '../vendor/pixi.csp.mjs';
import { favImage } from './favicons.js';

import { ROBOT_FRAMES, INVADER, ENVELOPE, ICONS, SIGNS, ICON_COLORS, CAR_TOP, CAR_COLORS, PROBE_CAR, shade } from './pixeldata.js';
export { ROBOT_FRAMES, INVADER, ENVELOPE, ICONS, SIGNS };

// Version DOM (para el panel de detalle): canvas escalado sin suavizado
function paintCanvas(rows, colors, scale) {
  const h = rows.length, w = rows[0].length;
  const cv = document.createElement('canvas');
  cv.width = w * scale; cv.height = h * scale;
  const cx = cv.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = colors[rows[y][x]];
    if (c) { cx.fillStyle = c; cx.fillRect(x * scale, y * scale, scale, scale); }
  }
  return cv;
}
// favicon de un proyecto en el marco de un cartel: se achica a una grilla de 20x20 y se agranda sin suavizar
// (queda con aspecto pixel, como el resto de los carteles). Cartel de 10 px de lado = favicon de 20 px a resolucion 2.
function favCanvas(img, size) {
  const g = document.createElement('canvas'); g.width = g.height = 20;
  const gx = g.getContext('2d'); gx.imageSmoothingEnabled = true; gx.imageSmoothingQuality = 'high';
  gx.drawImage(img, 0, 0, 20, 20);
  if (size === 20) return g;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const cx = cv.getContext('2d'); cx.imageSmoothingEnabled = false; cx.drawImage(g, 0, 0, size, size);
  return cv;
}
const favOf = name => typeof name === 'string' && name.startsWith('fav:') ? favImage(name.slice(4)) : null;
export function signCanvas(name, scale = 4) {
  const img = favOf(name);
  if (img) return favCanvas(img, Math.max(20, 10 * scale));
  return paintCanvas(SIGNS[name] || SIGNS.web, ICON_COLORS, scale);
}
export function robotCanvas(color, scale = 4) {
  const colors = { o: '#050814', B: color, b: shade(color, -0.35), h: shade(color, 0.45), v: '#0b1020', e: '#e0f7ff', g: '#94a3b8', a: '#fbbf24' };
  return paintCanvas(ROBOT_FRAMES.idle[0], colors, scale);
}
export function iconCanvas(name, scale = 3) { return paintCanvas(ICONS[name] || ICONS.desk, ICON_COLORS, scale); }

function paint(rows, colors) {
  const h = rows.length, w = rows[0].length;
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const cx = cv.getContext('2d');
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = colors[rows[y][x]];
    if (!c) continue;
    cx.fillStyle = c; cx.fillRect(x, y, 1, 1);
  }
  const tex = Texture.from(cv);
  tex.source.scaleMode = 'nearest';
  return tex;
}

const cache = new Map();
export function robotTextures(color) {
  if (cache.has('r' + color)) return cache.get('r' + color);
  const colors = { o: '#050814', B: color, b: shade(color, -0.35), h: shade(color, 0.45), v: '#0b1020', e: '#e0f7ff', g: '#94a3b8', a: '#fbbf24' };
  const out = {};
  for (const [k, frames] of Object.entries(ROBOT_FRAMES)) out[k] = frames.map(f => paint(f, colors));
  cache.set('r' + color, out);
  return out;
}

export function monoTextures(frames, color) {
  const key = 'm' + color + frames[0].join('');
  if (!cache.has(key)) cache.set(key, frames.map(f => paint(f, { x: color })));
  return cache.get(key);
}

// auto de visita visto desde arriba, del color de la visita (cache por color)
export function carTexture(color) {
  const key = 'car' + color;
  if (!cache.has(key)) cache.set(key, paint(CAR_TOP, { ...CAR_COLORS, C: color, h: shade(color, 0.45), d: '#0b1020', r: '#ef4444' }));
  return cache.get(key);
}

// auto sospechoso de perfil (el preso de la carcel)
export function suspectTexture() {
  if (!cache.has('suspect')) cache.set('suspect', paint(PROBE_CAR[1], CAR_COLORS));
  return cache.get('suspect');
}

export function iconTexture(name) {
  const key = 'i' + name;
  if (!cache.has(key)) cache.set(key, paint(ICONS[name], ICON_COLORS));
  return cache.get(key);
}

export function signTexture(name) {
  const key = 's' + name;
  const img = !cache.has(key) && favOf(name);
  if (img) cache.set(key, new Texture({ source: new CanvasSource({ resource: favCanvas(img, 20), resolution: 2, scaleMode: 'nearest' }) }));
  if (!cache.has(key)) cache.set(key, paint(SIGNS[name] || SIGNS.web, ICON_COLORS));
  return cache.get(key);
}
