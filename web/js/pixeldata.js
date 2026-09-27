// Pixel art de Atalaya como datos puros (sin PixiJS): lo usan sprites.js, la pantalla y el portal de Atalaya Cloud.
// Cada sprite es una matriz de caracteres; cada caracter es un color de la paleta.

// ---- robot 14x17: cuerpo, cabeza con visor, antena ----
const HEAD = [
  '......a.......',
  '......g.......',
  '...oooooooo...',
  '..oBBBBBBBBo..',
  '..oBvvvvvvBo..',
  '..oBveevveBo..',
  '..oBvvvvvvBo..',
  '..obBBBBBBbo..',
  '...oooooooo...',
];
const HEAD_BLINK = HEAD.map((r, i) => i === 5 ? '..oBvvvvvvBo..' : r);
const BODY = [
  '..oBBhhhhBBo..',
  '.goBBhBBhBBog.',
  '.goBBBBBBBBog.',
  '..obbbbbbbbo..',
  '...oooooooo...',
];
const BODY_WORK_A = [
  '..oBBhhhhBBo..',
  '..oBBhBBhBBogg',
  '.goBBBBBBBBo..',
  '..obbbbbbbbo..',
  '...oooooooo...',
];
const BODY_WORK_B = [
  '..oBBhhhhBBo..',
  'ggoBBhBBhBBo..',
  '..oBBBBBBBBog.',
  '..obbbbbbbbo..',
  '...oooooooo...',
];
const BODY_WAVE = [
  '..oBBhhhhBBo.g',
  '.goBBhBBhBBog.',
  '..oBBBBBBBBo..',
  '..obbbbbbbbo..',
  '...oooooooo...',
];
const LEGS = ['...og....go...', '...oo....oo...', '..............'];
const LEGS_W1 = ['...og.....go..', '..oo......oo..', '..............'];
const LEGS_W2 = ['..og....go....', '..oo....oo....', '..............'];
const LEGS_SIT = ['..oggggggggo..', '..............', '..............'];

export const ROBOT_FRAMES = {
  idle: [[...HEAD, ...BODY, ...LEGS], [...HEAD_BLINK, ...BODY, ...LEGS]],
  walk: [[...HEAD, ...BODY, ...LEGS_W1], [...HEAD, ...BODY, ...LEGS_W2]],
  work: [[...HEAD, ...BODY_WORK_A, ...LEGS], [...HEAD, ...BODY_WORK_B, ...LEGS]],
  wave: [[...HEAD, ...BODY_WAVE, ...LEGS], [...HEAD, ...BODY, ...LEGS]],
  sit: [[...HEAD, ...BODY, ...LEGS_SIT], [...HEAD_BLINK, ...BODY, ...LEGS_SIT]],
};

// ---- invasor 11x8 (ataques SSH) ----
export const INVADER = [
  ['..x.....x..', '...x...x...', '..xxxxxxx..', '.xx.xxx.xx.', 'xxxxxxxxxxx', 'x.xxxxxxx.x', 'x.x.....x.x', '...xx.xx...'],
  ['..x.....x..', 'x..x...x..x', 'x.xxxxxxx.x', 'xxx.xxx.xxx', 'xxxxxxxxxxx', '.xxxxxxxxx.', '..x.....x..', '.x.......x.'],
];

// ---- sobre 9x7 (correo) ----
export const ENVELOPE = ['xxxxxxxxx', 'xx.....xx', 'x.x...x.x', 'x..x.x..x', 'x...x...x', 'x.......x', 'xxxxxxxxx'];

// ---- autos ----
// de perfil 20x10, mirando a la derecha. Patrulla: blanca con franja azul y barra de luces (R/B alternan).
// Auto sospechoso (sondeos): oscuro, con una sirena roja que parpadea (R).
const CAR_SIDE = (roof, body, stripe) => [
  roof,
  `......${body.repeat(8)}......`,
  `.....${body}ddd${body}${body}ddd${body}.....`,
  `...${body.repeat(3)}ddd${body}${body}ddd${body.repeat(4)}..`,
  `..k${body.repeat(15)}k.`,
  `.k${body}${body}${stripe.repeat(12)}${body}${body}${body}k`,
  `.k${body.repeat(16)}yk`,
  '..kkttkkkkkkkkttkk..',
  '...tsst......tsst...',
  '....tt........tt....',
];
export const POLICE_CAR = [CAR_SIDE('........RRBB........', 'w', 'b'), CAR_SIDE('........BBRR........', 'w', 'b')];
// patrulla voladora: la misma carroceria, sin ruedas, con dos propulsores cuya llama titila (o = llama, c = nucleo)
const FLY = (car, flame) => [...car.slice(0, 7), '..kkkkkkkkkkkkkkkk..', ...flame];
export const FLY_POLICE = [
  FLY(POLICE_CAR[0], ['...kcck......kcck...', '....oo........oo....', '.....o........o.....']),
  FLY(POLICE_CAR[1], ['...kcck......kcck...', '....oo........oo....', '....................']),
];
export const PROBE_CAR = [CAR_SIDE('.........R..........', 'g', 'g'), CAR_SIDE('.........r..........', 'g', 'g')];
// bicho 11x9 (archivo PHP sospechoso): escarabajo rojo con patas que se mueven (2 cuadros)
export const BUG = [
  ['.k.......k.', '..k.....k..', '..rrrrrrr..', 'krrwrrrwrrk', '.rrrrrrrrr.', 'krrrrrrrrrk', '.rrrrrrrrr.', 'k.rrrrrrr.k', '...r...r...'],
  ['.k.......k.', '..k.....k..', '..rrrrrrr..', '.rrwrrrwrr.', 'krrrrrrrrrk', '.rrrrrrrrr.', 'krrrrrrrrrk', '..rrrrrrr..', '..r.....r..'],
];
export const CAR_COLORS = { k: '#0b1020', w: '#f8fafc', b: '#2563eb', g: '#334155', d: '#1e3a5f', t: '#020617', s: '#94a3b8', y: '#fef3c7',
  R: '#ef4444', B: '#3b82f6', r: '#7f1d1d', o: '#fb923c', c: '#a5f3fc' };
// visto desde arriba 8x14 (autopista): C = color de la visita, frente hacia abajo
export const CAR_TOP = [
  '.rCCCCr.', 'tCCCCCCt', 'tCddddCt', '.CddddC.', '.CCCCCC.', '.ChCCCC.', '.CCCCCC.',
  '.CCCCCC.', '.CddddC.', 'tCddddCt', 'tCCCCCCt', '.CCCCCC.', '.yCCCCy.', '..CCCC..',
];

// ---- iconos de estaciones 12x12 ----
export const ICONS = {
  library: [ // libros
    '............', '.rr.bb.gg...', '.rr.bb.gg.yy', '.rr.bb.gg.yy', '.rw.bw.gw.yy', '.rr.bb.gg.yy',
    '.rr.bb.gg.yy', '.rr.bb.gg.yy', '.rr.bb.gg.yy', 'kkkkkkkkkkkk', 'k..........k', '............'],
  workshop: [ // hoja con renglones y un lapiz escribiendo (Editando)
    '..........rr', '.........rrr', 'wwwwwww.yyr.', 'w.....wyyy..', 'w.kkk.yyy...', 'w....yyyw...',
    'w.kk.yy.w...', 'w...s...w...', 'w.kkkkk.w...', 'w.......w...', 'w.kkk...w...', 'wwwwwwwww...'],
  terminal: [ // monitor con prompt
    '............', 'kkkkkkkkkkkk', 'k..........k', 'k.g........k', 'k..g.......k', 'k.g..ggg...k',
    'k..........k', 'k..........k', 'kkkkkkkkkkkk', '....kkkk....', '..kkkkkkkk..', '............'],
  antenna: [ // globo terraqueo con meridianos (Web: busca o lee en internet)
    '....kkkk....', '..kkbbbbkk..', '.kbgwbbwbbk.', '.kggwgbbwbk.', 'kbggwgbbwgbk', 'kwwwwwwwwwwk',
    'kbbwbbggwbbk', 'kbbwbgggwbbk', '.kbbwbggwbk.', '.kbbbwbwbbk.', '..kkbbbbkk..', '....kkkk....'],
  jail: [ // carcel: techo, rejas y dos ojos rojos detras (IPs bloqueadas por la defensa)
    '............', '.kkkkkkkkkk.', 'kkkkkkkkkkkk', 'ks.s.s.s.s.k', 'ks.s.s.s.s.k', 'ks.sr.rs.s.k',
    'ks.s.s.s.s.k', 'ks.s.s.s.s.k', 'kssssssssssk', 'kkkkkkkkkkkk', '............', '............'],
  portal: [ // portal de subagentes
    '....pppp....', '..pp....pp..', '.p..wwww..p.', '.p.w....w.p.', 'p.w......w.p', 'p.w......w.p',
    'p.w......w.p', 'p.w......w.p', '.p.w....w.p.', '.p..wwww..p.', '..pp....pp..', '....pppp....'],
  desk: [ // mesa con taza
    '............', '............', '.........yy.', '........y..y', '.........yy.', 'kkkkkkkkkkkk',
    'k..........k', '.k........k.', '.k........k.', '.k........k.', '.k........k.', '............'],
};
// ---- letreros de edificios 10x10, uno por categoria de servicio ----
export const SIGNS = {
  trophy:   ['yyyyyyyyyy', 'y.yyyyyy.y', 'y.yyyyyy.y', '.yyyyyyyy.', '..yyyyyy..', '...yyyy...', '....yy....', '....yy....', '..yyyyyy..', '..kkkkkk..'],
  shop:     ['...kkkk...', '..k....k..', '..k....k..', 'bbbbbbbbbb', 'bwbbbbbbbb', 'bbbbbbbbbb', 'bbbbbbbbbb', 'bbbbbbbbbb', 'bbbbbbbbbb', '.bbbbbbbb.'],
  hotel:    ['..........', 'k.........', 'k.ww......', 'k.wwrrrrrr', 'kkkkkkkkkk', 'krrrrrrrrk', 'kkkkkkkkkk', 'k........k', 'k........k', '..........'],
  ship:     ['....w.....', '....ww....', '....www...', '....wwww..', '....w.....', 'kkkkkkkkkk', '.kkkkkkkk.', '..kkkkkk..', 'bb.bb.bb.b', '.bb.bb.bb.'],
  chart:    ['..........', '........g.', '.......gg.', '....g..gg.', '...gg..gg.', '...gg.ggg.', '.g.gg.ggg.', '.g.ggggggg', '.ggggggggg', 'kkkkkkkkkk'],
  dice:     ['wwwwwwwwww', 'wkwwwwwwww', 'wwwwwwwwww', 'wwwwwwwwkw', 'wwwwkwwwww', 'wwwwwwwwww', 'wkwwwwwwww', 'wwwwwwwwww', 'wwwwwwwwkw', 'wwwwwwwwww'],
  gear:     ['....kk....', '.k.kkkk.k.', '..kkkkkk..', '.kkk..kkk.', 'kkk....kkk', 'kkk....kkk', '.kkk..kkk.', '..kkkkkk..', '.k.kkkk.k.', '....kk....'],
  heart:    ['..........', '.rr...rr..', 'rrrr.rrrr.', 'rwrrrrrrr.', 'rrrrrrrrr.', '.rrrrrrr..', '..rrrrr...', '...rrr....', '....r.....', '..........'],
  game:     ['..........', '..........', '.kkkkkkkk.', 'kkwkkkkrkk', 'kwwwkkrkrk', 'kkwkkkkrkk', 'kkkkkkkkkk', '.kk....kk.', '..........', '..........'],
  calendar: ['.k......k.', 'rrrrrrrrrr', 'rrrrrrrrrr', 'wwwwwwwwww', 'wkwkwkwkww', 'wwwwwwwwww', 'wkwkwrrkww', 'wwwwwrrwww', 'wkwkwkwkww', 'wwwwwwwwww'],
  bowling:  ['...ww.....', '..wwww....', '..wrrw....', '..wwww....', '...ww.....', '..wwww.kk.', '.wwwwwkkkk', '.wwwwwkkkk', '.wwwww.kk.', '..www.....'],
  clock:    ['...kkkk...', '.kkwwwwkk.', '.kwwwkwwk.', 'kwwwwkwwwk', 'kwwwwkwwwk', 'kwwwwkkkwk', 'kwwwwwwwwk', '.kwwwwwwk.', '.kkwwwwkk.', '...kkkk...'],
  support:  ['...kkkk...', '..k....k..', '.k......k.', '.k......k.', 'bb......bb', 'bb......bb', 'bb......bb', '.......k..', '.....kk...', '..........'],
  chat:     ['..........', '.gggggggg.', 'gggggggggg', 'ggwwgwwggg', 'gggggggggg', 'gggggggggg', '.gggggggg.', '.gg.......', '.g........', '..........'],
  card:     ['..........', 'yyyyyyyyyy', 'yyyyyyyyyy', 'kkkkkkkkkk', 'yyyyyyyyyy', 'ywwwyyyyyy', 'yyyyyyywwy', 'yyyyyyyyyy', '..........', '..........'],
  mail:     ['..........', 'wwwwwwwwww', 'wkwwwwwwkw', 'wwkwwwwkww', 'wwwkwwkwww', 'wwwwkkwwww', 'wwwwwwwwww', 'wwwwwwwwww', 'wwwwwwwwww', '..........'],
  glass:    ['yyyyyyy...', 'wwwwwww.k.', 'yyyyyyykk.', 'yyyyyyy.k.', 'yyyyyyy.k.', 'yyyyyyykk.', 'yyyyyyy...', 'yyyyyyy...', 'yyyyyyy...', '.yyyyy....'],
  wp:       ['...bbbb...', '.bbwwwwbb.', '.bwwwwwwb.', 'bwbwwwwbwb', 'bwbwbbwbwb', 'bwbwbbwbwb', 'bwwbwwbwwb', '.bwwwwwwb.', '.bbwwwwbb.', '...bbbb...'],
  php:      ['..........', '.pppppppp.', 'pppppppppp', 'pwpwpwwpwp', 'pwwwpwpwwp', 'pwppppwppp', 'pwppppwppp', 'pppppppppp', '.pppppppp.', '..........'],
  page:     ['.wwwwww...', '.wkkkkwww.', '.wwwwwwwww', '.wkkkkkkkw', '.wwwwwwwww', '.wkkkkkkkw', '.wwwwwwwww', '.wkkkkkkkw', '.wwwwwwwww', '.wwwwwwwww'],
  wip:      ['..........', 'yyyyyyyyyy', 'ykkyykkyyk', 'kkyykkyykk', 'yyyyyyyyyy', '.k......k.', '.k......k.', '.k......k.', 'kkk....kkk', '..........'],
  db:       ['..kkkkkk..', '.kwwwwwwk.', 'kkwwwwwwkk', 'kbkkkkkkbk', 'kbbbbbbbbk', 'kkbbbbbbkk', 'kbkkkkkkbk', 'kbbbbbbbbk', '.kbbbbbbk.', '..kkkkkk..'],
  cache:    ['.....yy...', '....yy....', '...yy.....', '..yyyyyy..', '.yyyyyyy..', '....yy....', '...yy.....', '..yy......', '.yy.......', '..........'],
  box:      ['..........', 'bbbbbbbbbb', 'bkbkbkbkbb', 'bkbkbkbkbb', 'bkbkbkbkbb', 'bkbkbkbkbb', 'bkbkbkbkbb', 'bbbbbbbbbb', '.k......k.', '..........'],
  web:      ['...bbbb...', '.bbwbbwbb.', '.bwbbbbwb.', 'bwwwwwwwwb', 'bbbwbbwbbb', 'bbbwbbwbbb', 'bwwwwwwwwb', '.bwbbbbwb.', '.bbwbbwbb.', '...bbbb...'],
};

export const ICON_COLORS = { r: '#f87171', b: '#60a5fa', g: '#4ade80', y: '#fbbf24', w: '#f8fafc', k: '#cbd5e1', s: '#94a3b8', p: '#c084fc' };

function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function shade(hex, f) {
  const [r, g, b] = hexToRgb(hex);
  const m = f < 0 ? 0 : 255, t = Math.abs(f);
  return `rgb(${Math.round(r + (m - r) * t)},${Math.round(g + (m - g) * t)},${Math.round(b + (m - b) * t)})`;
}

// pinta una matriz en un canvas sin suavizado
export function paintCanvas(rows, colors, scale = 1) {
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
