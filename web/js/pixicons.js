// Iconos pixel para la interfaz (panel, cinta, dialogos): nada de emojis. Cada icono es una grilla de
// letras (una por color) que se convierte en un SVG en linea con bordes nitidos. Reutiliza los letreros
// y las estaciones del mundo (pixeldata.js, sin PixiJS) y agrega los que la interfaz necesita.
import { SIGNS, ICONS, INVADER, ENVELOPE } from './pixeldata.js';

const PAL = { r: '#f87171', R: '#dc2626', o: '#fb923c', y: '#fbbf24', g: '#4ade80', G: '#16a34a', c: '#22d3ee', b: '#60a5fa', p: '#c084fc',
  w: '#f8fafc', k: '#cbd5e1', s: '#94a3b8', d: '#1e293b' };

const OWN = {
  ok: ['..........', '.........g', '........gg', '.......gg.', 'g.....gg..', 'gg...gg...', '.gg.gg....', '..ggg.....', '...g......', '..........'],
  warn: ['....yy....', '...yyyy...', '...yddy...', '..yyddyy..', '..yyddyy..', '.yyyddyyy.', '.yyyyyyyy.', 'yyyyddyyyy', 'yyyyyyyyyy', '..........'],
  bad: ['..RRRRRR..', '.RRRRRRRR.', 'RRRRRRRRRR', 'RRRRRRRRRR', 'RwwwwwwwwR', 'RwwwwwwwwR', 'RRRRRRRRRR', 'RRRRRRRRRR', '.RRRRRRRR.', '..RRRRRR..'],
  info: ['...bbbb...', '.bbbwwbbb.', '.bbbwwbbb.', 'bbbbbbbbbb', 'bbbwwwbbbb', 'bbbbwwbbbb', 'bbbbwwbbbb', '.bbbwwbbb.', '.bbwwwwbb.', '...bbbb...'],
  unknown: ['..sssss...', '.ss...ss..', '......ss..', '.....ss...', '....ss....', '....ss....', '..........', '....ss....', '....ss....', '..........'],
  shield: ['.bbbbbbbb.', 'bbwwwwwwbb', 'bwwbbbbwwb', 'bwbbbbbbwb', 'bwbbbbbbwb', '.bwbbbbwb.', '.bwbbbbwb.', '..bwbbwb..', '...bwwb...', '....bb....'],
  key: ['..yyy.....', '.y...y....', '.y...y....', '.y...y....', '..yyyy....', '....yy....', '....yyyy..', '....yy....', '....yyy...', '....yy....'],
  rocket: ['....ww....', '...wwww...', '...wbbw...', '...wbbw...', '...wwww...', '..rwwwwr..', '.rrwwwwrr.', '.r.wwww.r.', '....oo....', '....yy....'],
  fire: ['....r.....', '...rr.....', '...rro....', '..rroo.r..', '..rooor...', '.rrooyorr.', '.rooyyyor.', '.rooyyyor.', '..rooyor..', '...rrrr...'],
  boom: ['r...y...r.', '.r..y..r..', '..rryrr...', '...yyy....', 'yyyywyyyy.', '...yyy....', '..rryrr...', '.r..y..r..', 'r...y...r.', '..........'],
  trash: ['...kkkk...', 'kkkkkkkkkk', '..........', '.kkkkkkkk.', '.k.k..k.k.', '.k.k..k.k.', '.k.k..k.k.', '.k.k..k.k.', '.k.k..k.k.', '..kkkkkk..'],
  refresh: ['...cccc...', '.cc....c.c', '.c......cc', 'c......ccc', 'c.........', '.........c', 'ccc......c', 'cc......c.', 'c.c....cc.', '...cccc...'],
  bot: ['....k.....', '..kkkkkk..', '.kwwwwwwk.', '.kwcwwcwk.', '.kwwwwwwk.', '.kwkkkkwk.', '..kkkkkk..', '.kkkkkkkk.', 'kk.kkkk.kk', '...k..k...'],
  ask: ['.yyyyyyyy.', 'yyyddddyyy', 'yydyyyydyy', 'yyyyyyddyy', 'yyyyyddyyy', 'yyyyyyyyyy', '.yyyyddyy.', '..y.......', '.y........', '..........'],
  exit: ['kkkkkk....', 'k....k....', 'k....k..c.', 'k....k.cc.', 'k...yccccc', 'k....k.cc.', 'k....k..c.', 'k....k....', 'kkkkkk....', '..........'],
  squeeze: ['...kk.....', '..kkkk....', '.kkkkkk...', '...kk.....', 'cccccccccc', 'cccccccccc', '...kk.....', '.kkkkkk...', '..kkkk....', '...kk.....'],
  siren: ['....rr....', '...rrrr...', '..rrwrrr..', '..rwwrrr..', '..rrrrrr..', '.kkkkkkkk.', '.kkkkkkkk.', '..........', 'r........r', '.r......r.'],
  city: ['......kk..', '..kk..kk..', '..kk.kkkk.', '.kkkkkyykk', '.kyykkkkkk', '.kkkkkyykk', '.kyykkkkkk', '.kkkkkyykk', '.kyykkkkkk', 'kkkkkkkkkk'],
  ruin: ['..........', '..........', '.....s....', '.s..sss...', '.ss.s.s...', '.sssssss..', '.s.ss..s..', '.sssssssss', 'ssssssssss', 'kkkkkkkkkk'],
  bolt: ['.....yy...', '....yy....', '...yy.....', '..yyyyyy..', '.....yy...', '....yy....', '...yy.....', '..yy......', '.yy.......', '..........'],
  folder: ['..........', '.oooo.....', 'oooooooooo', 'oyyyyyyyyo', 'oyyyyyyyyo', 'oyyyyyyyyo', 'oyyyyyyyyo', 'oyyyyyyyyo', 'oooooooooo', '..........'],
  phone: ['..kkkkkk..', '..kddddk..', '..kdccdk..', '..kdccdk..', '..kddddk..', '..kddddk..', '..kddddk..', '..kkkkkk..', '..kkwwkk..', '..kkkkkk..'],
  laptop: ['..........', '.kkkkkkkk.', '.kcccccck.', '.kcccccck.', '.kcccccck.', '.kkkkkkkk.', 'kkkkkkkkkk', '.kkkkkkkk.', '..........', '..........'],
  cloud: ['..........', '..........', '...www....', '..wwwww...', '.wwwwwwww.', 'wwwwwwwwww', 'wwwwwwwwww', '.wwwwwwww.', '..........', '..........'],
  house: ['....rr....', '...rrrr...', '..rrrrrr..', '.rrrrrrrr.', 'rrrrrrrrrr', '.kkkkkkkk.', '.kbbkkddk.', '.kbbkkddk.', '.kkkkkddk.', '.kkkkkddk.'],
  triangle: ['....ww....', '....ww....', '...wwww...', '...wwww...', '..wwwwww..', '..wwwwww..', '.wwwwwwww.', '.wwwwwwww.', 'wwwwwwwwww', '..........'],
  branch: ['.p........', 'ppp.....p.', '.p.....ppp', '.p......p.', '.p.....p..', '.p....p...', '.p..pp....', '.ppp......', 'ppp.......', '.p........'],
  star: ['....yy....', '....yy....', '...yyyy...', 'yyyyyyyyyy', '.yyyyyyyy.', '..yyyyyy..', '..yyyyyy..', '.yyy..yyy.', '.yy....yy.', '..........'],
  lock: ['...kkkk...', '..k....k..', '..k....k..', '.yyyyyyyy.', '.yyyyyyyy.', '.yyyddyyy.', '.yyyddyyy.', '.yyyyyyyy.', '.yyyyyyyy.', '..........'],
  pin: ['...rrrr...', '..rrrrrr..', '..rrwrrr..', '..rrrrrr..', '...rrrr...', '....kk....', '....kk....', '....kk....', '....k.....', '..........'],
  camera: ['..........', '.kk.kk....', 'kkkkkkk.k.', 'kddddkkkk.', 'kdccdkkkk.', 'kdccdkkkk.', 'kddddkkkk.', 'kkkkkkk.k.', '..........', '..........'],
  move: ['....k.....', '...kkk....', '....k.....', '.k..k..k..', 'kkkkkkkkk.', '.k..k..k..', '....k.....', '...kkk....', '....k.....', '..........'],
  search: ['..kkkk....', '.k....k...', 'k..ww..k..', 'k.w....k..', 'k......k..', '.k....k...', '..kkkkkk..', '.......kk.', '........kk', '.........k'],
  thumb: ['....g.....', '...gg.....', '...gg.....', '..ggggggg.', 'gggggggggg', 'gg.ggggggg', 'gg.gggggg.', 'gg.gggggg.', 'gg..ggggg.', '..........'],
  brain: ['..pppppp..', '.ppwppwpp.', 'pppppppppp', 'ppwppppwpp', 'pppppppppp', 'pppwppwppp', '.pppppppp.', '..pp..pp..', '...pppp...', '..........'],
  mailIn: ['..........', 'wwwwwwwwww', 'wkwwwwwwkw', 'wwkwwwwkww', 'wwwkwwkwww', 'wwwwkkwwww', 'wwwwwwwwww', 'wwwwwwwwww', '....pp....', '...pppp...'],
  mailOut: ['...yyyy...', '....yy....', 'wwwwwwwwww', 'wkwwwwwwkw', 'wwkwwwwkww', 'wwwkwwkwww', 'wwwwkkwwww', 'wwwwwwwwww', 'wwwwwwwwww', '..........'],
  mailBad: ['..........', 'rrrrrrrrrr', 'rwrrrrrrwr', 'rrwrrrrwrr', 'rrrwrrwrrr', 'rrrrwwrrrr', 'rrrrrrrrrr', 'rrrrrrrrrr', 'rrrrrrrrrr', '..........'],
  scroll: ['.kkkkkkk..', 'kwwwwwwwk.', '.kwsssswk.', '.kwwwwwwk.', '.kwsssswk.', '.kwwwwwwk.', '.kwssswwk.', '.kwwwwwwkk', '.kkkkkkkkw', '..........'],
  dotG: ['..........', '..........', '...gggg...', '..gggggg..', '..gggggg..', '..gggggg..', '..gggggg..', '...gggg...', '..........', '..........'],
  dotY: ['..........', '..........', '...yyyy...', '..yyyyyy..', '..yyyyyy..', '..yyyyyy..', '..yyyyyy..', '...yyyy...', '..........', '..........'],
  dotR: ['..........', '..........', '...rrrr...', '..rrrrrr..', '..rrrrrr..', '..rrrrrr..', '..rrrrrr..', '...rrrr...', '..........', '..........'],
  dotS: ['..........', '..........', '...ssss...', '..ssssss..', '..ssssss..', '..ssssss..', '..ssssss..', '...ssss...', '..........', '..........'],
  plug: ['..k....k..', '..k....k..', '.kkkkkkkk.', '.kccccccK.', '.kccccccK.', '..kccccK..', '...kkkk...', '....kk....', '....kk....', '....kk....'],
};

const mono = (rows, ch) => rows.map(r => r.replace(/x/g, ch));
const ALL = {
  ...Object.fromEntries(Object.entries(SIGNS)), ...Object.fromEntries(Object.entries(ICONS)), ...OWN,
  invader: mono(INVADER[0], 'r'), mail: mono(ENVELOPE, 'w'),
};

const cache = new Map();
export function pxSrc(name) {
  if (cache.has(name)) return cache.get(name);
  const rows = ALL[name] || OWN.unknown;
  const h = rows.length, w = Math.max(...rows.map(r => r.length));
  let rects = '';
  rows.forEach((row, y) => [...row].forEach((ch, x) => { const c = PAL[ch] || (ch === 'K' ? PAL.k : null); if (c) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${c}"/>`; }));
  const src = 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" shape-rendering="crispEdges">${rects}</svg>`);
  cache.set(name, src);
  return src;
}
// <img> listo para meter en HTML (alt vacio: el texto de al lado ya dice lo que es)
export function px(name, cls = '') { return `<img class="px${cls ? ' ' + cls : ''}" src="${pxSrc(name)}" alt="" aria-hidden="true">`; }
export const PX_NAMES = Object.keys(ALL);
