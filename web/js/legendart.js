// Arte pixel de la leyenda, tema por tema: cada elemento se explica con un dibujo de su propio mundo (el preso a
// rayas de la villa, el espectro de la mazmorra, el cofre del acuario...) y no con un icono generico.
// En theme.json, un elemento de la leyenda usa "art": "<clave>" (de este archivo, para el tema activo) o
// "art": { "rows": [...], "pal": {...} } (arte propio, para los temas del kit), o "sprite": "police" | "fly" |
// "probe" | "queue" | "bug" (el elenco de la capa de efectos, web/js/fxskins.js).

const V = { k: '#1b1410', s: '#e8b98a', w: '#f4f1e8', d: '#2a2a33', b: '#8b5a2b', B: '#6b4a2e', a: '#aab2bc', A: '#6f7780', r: '#b53a2e', y: '#e8c55a', g: '#9aa0a8', G: '#c8b060', h: '#d0a040', f: '#3b6fb5', p: '#b69cf0' };
const villa = {
  prisoner: { pal: V, rows: ['...kkkk...', '..kssssk..', '..kskksk..', '..kssssk..', '...kkkk...', '..kwdwdk..', '.kwdwdwdk.', '.kdwdwdwk.', '..kwdwdk..', '..kd..dk..', '..kk..kk..'] },
  barrel: { pal: V, rows: ['..kkkkkk..', '.kbbbbbbk.', 'kaaaaaaaak', 'kbbbbbbbbk', 'kbBbbbbBbk', 'kaaaaaaaak', 'kbbbbbbbbk', 'kbBbbbbBbk', 'kaaaaaaaak', '.kbbbbbbk.', '..kkkkkk..'] },
  pigeon: { pal: V, rows: ['......kkk...', '.....kwwwk..', '.....kwkwyk.', '..kkkwwwwk..', '.kwwwwwwwk..', 'kwgwgwwwwk..', '.kwwwwwwk...', '..kkykyk....', '....k.k.....'] },
  barn: { pal: V, rows: ['.....kk.....', '....krrk....', '...krrrrk...', '..krrrrrrk..', '.krrrrrrrrk.', 'krrrkkkkrrrk', '.krrkGGkrrk.', '.krrkGGkrrk.', '.krrkGGkrrk.', '.kkkkkkkkkk.', 'ffffffffffff'] },
};

const O = { k: '#1a1a22', s: '#e8b890', o: '#e07a2a', O: '#b0561a', a: '#c4c8d0', A: '#8a909a', d: '#5a606a', w: '#f4efe0', b: '#9a7a5a', B: '#6a4a30', c: '#c89a5a', r: '#d0342a', p: '#8a6fc8' };
const oficina = {
  detainee: { pal: O, rows: ['...kkkk...', '..kssssk..', '..kskksk..', '..kssssk..', '...kkkk...', '..koooOk..', '.kooooOOk.', '.kooooOOk.', '..kooOOk..', '..ko..Ok..', '..kk..kk..'] },
  box: { pal: O, rows: ['kkkkkkkkkkk', 'kccccrccccck', 'kccccrccccck', 'krrrrrrrrrrk', 'kccccrccccck', 'kccccrccccck', 'kccccrccccck', 'kkkkkkkkkkkk'] },
  pigeonholes: { pal: O, rows: ['kkkkkkkkkkkk', 'kbBwBbBbBwBk', 'kbBwBbBwBbBk', 'kkkkkkkkkkkk', 'kbBbBwBbBwBk', 'kbBbBwBbBbBk', 'kkkkkkkkkkkk', 'kbBwBbBwBbBk', 'kbBwBbBwBbBk', 'kkkkkkkkkkkk'] },
  cabinet: { pal: O, rows: ['kkkkkkkkk', 'kaaaaaaak', 'kaaAAAaak', 'kaaaaaaak', 'kdddddddk', 'kaaaaaaak', 'kaaAAAaak', 'kaaaaaaak', 'kdddddddk', 'kaaaaaaak', 'kaaAAAaak', 'kkkkkkkkk'] },
};

const C = { k: '#0a0610', w: '#d8e0f0', s: '#5a5068', b: '#1a100a', B: '#5a3a22', y: '#d8b24a', c: '#9a9aa8', r: '#b0203a', R: '#2a5ab0', g: '#3a9a5a', v: '#8a3ab0', e: '#d8b24a' };
const castillo = {
  specter: { pal: C, rows: ['s.s.wwww.s.s', 's.swwwwwws.s', 's.wkkwwkkw.s', 's.wkkwwkkw.s', 's.wwwwwwww.s', 's.wwwkkwww.s', 's.wwwwwwww.s', 's.wwwwwwww.s', 's.w.ww.ww.ws', 'sssssssssss'] },
  coffin: { pal: C, rows: ['..bbbbb..', '.bBBBBBb.', 'bBBByBBBb', 'cccccccccc', 'bBBByBBBb', 'bByyyyyBb', 'bBBByBBBb', 'cccccccccc', '.bBBBBBb.', '.bBBBBBb.', '..bbbbb..'] },
  raven: { pal: { ...C, k: '#4a3f5c' }, rows: ['.......kk...', '......kkkey.', '.kk..kkkkk..', 'kkkkkkkkkk..', '.kkkkkkkk...', '..kkkkkkk...', '...kkkkk....', '....k.k.....'] },
  grimoires: { pal: C, rows: ['bbbbbbbbbbbb', 'bkrkRkykgkvb', 'bkrkRkykgkvb', 'bkrkRkykgkvb', 'bBBBBBBBBBBb', 'bkykgkrkRkkb', 'bkykgkrkRkkb', 'bkykgkrkRkkb', 'bBBBBBBBBBBb', 'bbbbbbbbbbbb'] },
};

const R = { k: '#120f0d', v: '#8a4fd0', V: '#5a2f86', r: '#ff3b2e', s: '#9aa0a8', w: '#8b5a2b', y: '#e8c55a', Y: '#b8912e', R: '#b53a2e', d: '#3b3346' };
const raid = {
  minion: { pal: R, rows: ['...kkkk...', '..kvvvvk..', '.kvrvvrvk.', '.kvvvvvvk.', '..kvkkvk..', '.kkvvvvkk.', 'kvkvvvvkvk', '..kvvvvk..', '..kv..vk..', '..kk..kk..'] },
  cursed: { pal: R, rows: ['.kkkkkkkkkk.', 'kvvvvvvvvvvk', 'kvsvvvvvvsvk', 'kkkkkkkkkkkk', 'kwwwssswwwwk', 'kwwsyysswwwk', 'kwwwssswwwwk', 'kssssssssssk', 'kkkkkkkkkkkk'] },
  mailbox: { pal: R, rows: ['..kkkkkkkk..', '.kRRRRRRRRk.', 'kRRRRRRRRRRk', 'kRRkkkkkkRRk', 'kRRRRRRRRRRk', 'kRRRRRyRRRRk', 'kkkkkkkkkkkk', '....kwwk....', '....kwwk....', '...kkwwkk...'] },
  bank: { pal: R, rows: ['...yYyyYy...', '.yYyyYyyYyy.', 'kkkkkkkkkkkk', 'kwwwwwwwwwwk', 'kwYwwwwwwYwk', 'kkkkkyykkkkk', 'kwwwwyywwwwk', 'kwYwwwwwwYwk', 'kkkkkkkkkkkk'] },
};

const A = { k: '#081620', p: '#e07ad8', P: '#b04aa8', g: '#bfe9ff', r: '#d0342a', d: '#3a1450', w: '#f4f1e8', v: '#b69cf0', o: '#ff9a4d', b: '#7a4a22', y: '#d8b24a', Y: '#ffd24a' };
const acuario = {
  jelly: { pal: A, rows: ['...pppppp...', '..pppppppp..', '.pppPppPppp.', '.pppppppppp.', 'pppppppppppp', '.P.P.PP.P.P.', '.P.P.P..P.P.', 'P..P.P..P..P', '.P..P....P..'] },
  jar: { pal: A, rows: ['.rrrrrr.', 'rrrrrrrr', '.gggggg.', 'gg.gg.gg', 'g.dddd.g', 'g.dddd.g', 'gg.gg.gg', 'g......g', '.gggggg.'] },
  capsule: { pal: A, rows: ['....wwww....', '..wwwwwwww..', '.wwwwwwwwww.', 'wwwwwwwwwwww', 'vvvvvvvvvvvv', 'vvvvvvvvvvvv', '.vvvvvvvvvv.', '..vvvvvvvv..', '....vvvv....'] },
  chest: { pal: A, rows: ['..YYYYYYYY..', '.YyYyYyYyYY.', 'kbbbbbbbbbbk', 'kyyyyyyyyyyk', 'kbbbbkkbbbbk', 'kbbbbyybbbbk', 'kbbbbbbbbbbk', 'kkkkkkkkkkkk'] },
};

const X = { k: '#0b0d09', r: '#ef4444', R: '#ff8a8a', g: '#4ade80', G: '#2f7a4a', s: '#5d6e48', d: '#2b2a1a', y: '#fbbf24', c: '#22d3ee', C: '#1b2214' };
const ops = {
  hostile: { pal: X, rows: ['r.r.r.r.r.r.', '.....kk.....', 'r...krrk...r', '...krrrrk...', 'r..krrrrk..r', '..krrkkrrk..', 'r.krrkkrrk.r', '.krrrrrrrrk.', 'krrrkkrrrrrk', 'kkkkkkkkkkkk', 'r.r.r.r.r.r.'] },
  container: { pal: X, rows: ['kkkkkkkkkkkk', 'kddddddddddk', 'kddddddddddk', 'kyyyyyyyyyyk', 'kykykykykykk', 'kddddddddddk', 'kddddddddddk', 'kkkkkkkkkkkk'] },
  antenna: { pal: X, rows: ['.....g......', '...ssss.....', '..s....s....', '.s..g...s...', '.s.......s..', '..s.....s...', '...sssss....', '.....s......', '.....s......', '.....s......', '....sss.....', '...sssss....'] },
  depot: { pal: X, rows: ['..cccccc..', '.cCCCCCCc.', 'cCCCCCCCCc', 'cccccccccc', 'cCCCCCCCCc', 'cCCCCCCCCc', 'cCCCCCCCCc', 'cCCCCCCCCc', 'cCCCCCCCCc', '.cccccccc.'] },
};

const P = { k: '#000000', r: '#ff004d', l: '#c2c3c7', w: '#fff1e8', p: '#7e2553', y: '#ffec27', B: '#ab5236', P: '#ffccaa', b: '#29adff', g: '#5f574f', n: '#1d2b53' };
const planta = {
  drone: { pal: P, rows: ['l.l.l.l.l.l.', 'kllk....kllk', '..k......k..', '..kkkkkkkk..', '..krrrrrrk..', '..krrwrrrk..', '...kkkkkk...', 'l.l.l.l.l.l.'] },
  barrel: { pal: P, rows: ['.pppppp.', 'pppppppp', 'pppppppp', 'yyyyyyyy', 'yyyyyyyy', 'pppppppp', 'pppppppp', 'pppppppp', '.pppppp.'] },
  parcel: { pal: P, rows: ['.....k.....', '.....k.....', 'kkkkkkkkkkk', 'kPPPPPPPPPk', 'kPPPPPPPPPk', 'kbbbbbbbbbk', 'kPPPPPPPPPk', 'kPPPPPPPPPk', 'kkkkkkkkkkk'] },
  tank: { pal: P, rows: ['...gggg...', '..gggggg..', '.l......l.', '.l......l.', '.l......l.', '.lbbbbbbl.', '.lbbbbbbl.', '.lbbbbbbl.', '.lbbbbbbl.', '.gggggggg.'] },
};

// la ciudad y la ciudad 3D: carcel, capsula, oficina de correos y silos
const Y = { k: '#0b1020', g: '#64748b', G: '#94a3b8', o: '#fb923c', c: '#4ade80', C: '#bbf7d0', r: '#ef4444', w: '#f8fafc', b: '#2563eb', y: '#fbbf24', s: '#cbd5e1', S: '#475569', t: '#22d3ee' };
const ciudad = {
  jail: { pal: Y, rows: ['kkkkkkkkkkkk', 'kgGgGgGgGgGk', 'kg.g.g.g.g.k', 'kg.g.g.g.g.k', 'kg.gogog.g.k', 'kg.g.g.g.g.k', 'kg.g.g.g.g.k', 'kgGgGgGgGgGk', 'kkkkkkkkkkkk'] },
  capsule: { pal: Y, rows: ['....CC....', '..cccccc..', '.c......c.', 'c..r..r..c', 'c.rrrrrr.c', 'c..rrrr..c', 'c.r.rr.r.c', '.c......c.', '..cccccc..'] },
  post: { pal: Y, rows: ['.....r......', '.....rr.....', '.....r......', '..kkkkkkkk..', '.kbbbbbbbbk.', 'kbbbbbbbbbbk', 'kwwkwwwwkwwk', 'kwwkwyywkwwk', 'kwwwwyywwwwk', 'kkkkkkkkkkkk'] },
  silo: { pal: Y, rows: ['..ssssss..', '.sSSSSSSs.', 'ssssssssss', 'sStttttttS', 'sStttttttS', 'sStttttttS', 'sStttttttS', 'sStttttttS', 'ssssssssss', 'S........S'] },
};

// ------------------------------------------------------------------ el resto de cada mundo
Object.assign(villa, {
  castle: { pal: V, rows: ['k.k.k..k.k.k', 'kakak..kakak', 'kaaak..kaaak', 'kaaakkkkaaak', 'kaaaaaaaaaak', 'kaaaarraaaak', 'kaaarrrraaak', 'kaaarkkraaak', 'kaaakkkkaaak', 'kkkkkkkkkkkk'] },
  village: { pal: V, rows: ['kkkkkkkkkkkk', 'kgggrrrrgggk', 'kgg.r..r.ggk', 'kg..rrrr..gk', 'kg.kkk.kk.gk', 'kg.kbk.kbk.k', 'kg..........', 'kgggg..ggggk', 'kkkkk..kkkkk'] },
  stonehouse: { pal: V, rows: ['........kk..', '..kkkkkkgg..', '.krrrrrrrk..', 'krrrrrrrrrk.', 'kaaaaaaaaak.', 'kaykaaakyak.', 'kaaaaaaaaak.', 'kaaakbbkaaak', 'kkkkkbbkkkkk'] },
  hut: { pal: V, rows: ['.....kk.....', '....khhk....', '...khhhhk...', '..khhhhhhk..', '.khhhhhhhhk.', 'khhhhhhhhhhk', '.kbbbbbbbbk.', '.kbbkbbkbbk.', '.kbbkbbkbbk.', '.kkkkkkkkkk.'] },
  villager: { pal: V, rows: ['...kkkk...', '..kssssk..', '..kskksk..', '..kssssk..', '...kkkk...', '..kbbbbk..', '.kbbbbbbk.', '..kbbbbk..', '..kB..Bk..', '..kk..kk..'] },
  bird: { pal: V, rows: ['kk......kk', '.kk....kk.', '..kwwwwk..', '..kwkwwk..', '...kwwky..', '....kk....'] },
  slime: { pal: { ...V, n: '#5fbf4a', N: '#3a8a2a' }, rows: ['....kkkk....', '..kknnnnkk..', '.knnwnnwnnk.', '.knnknnknnk.', 'knnnnnnnnnnk', 'knNnnnnnNnnk', 'kkkkkkkkkkkk'] },
  mage: { pal: { ...V, m: '#6d47b3', M: '#4a2f80' }, rows: ['....k.......', '...kmk......', '..kmmmk.....', '.kmmmmmk..y.', 'kkkkkkkkk.w.', '..kssssk..w.', '..kskksk..w.', '.kmmmmmmk.w.', 'kmmmMmmmmkw.', 'kmmmMmmmmk..', '.kkkkkkkk...'] },
});
Object.assign(castillo, {
  tower: { pal: C, rows: ['.....r......', '.....kk.....', '....kssk....', '...kssssk...', '..kssssssk..', '..kswwwwsk..', '..kwykwywk..', '..kswwwwsk..', '..ksssssssk.', '..kssyyssk..', '..kssyyssk..', '..kkkkkkkk..'] },
  hall: { pal: C, rows: ['s.s.s.s.s.s.', 'ssssssssssss', 'skkkkkkkkkks', 'skkkkrrkkkks', 'skkkkrrkkkks', 'skkkkkrkkkks', 'skykkkkkkyks', 'sbbbbbbbbbbs', 'ssssssssssss'] },
  candle: { pal: { ...C, w: '#efe6d0', g: '#c8a040', G: '#8a6a28', f: '#ffb040' }, rows: ['..f...f...f..', '..w...w...w..', '..w...w...w..', '.gGg.gGg.gGg.', '..g...g...g..', '..ggggGgggg..', '......g......', '......G......', '.....gGg.....', '....ggGgg....'] },
  window: { pal: C, rows: ['...kkkkkk...', '..krRRrrRk..', '.krRRyyrRRk.', '.krkkkkkkrk.', '.kRRgkkgRRk.', '.kkkkkkkkkk.', '.kyyvkkvyyk.', '.kyyvkkvyyk.', '.kkkkkkkkkk.'] },
  gate: { pal: C, rows: ['ssssssssssss', 'ssskkkkkksss', 'sskbbbbbbkss', 'skbkbkbkbkbs', 'skbkbkbkbkbs', 'skbkbkbkbkbs', 'skbkbkbkbkbs', 'skbkbkbkbkbs'] },
  bat: { pal: { ...C, e: '#ff3b3b', k: '#1a1020', w: '#6a6078' }, rows: ['w.......w', 'ww.www.ww', '.wwwewww.', '..wwwww..', '...w.w...'] },
  hunter: { pal: { k: '#0a0610', h: '#e8d8a8', s: '#f0c8a0', e: '#1a1020', c: '#b0203a', t: '#3a2a4a', y: '#d8b24a', b: '#2a1a14', p: '#4a3a5a', f: '#ff8a2a' }, rows: ['....hhhh...f', '...hhhhhh..f', '...hsssssh.b', '...ssesses.b', '....ssss...b', '..cctttttc.b', '.ccttyytttcb', '.cctttttttc.', '.cc.tbbt.cc.', '.c..tttt..c.', '.c..pppp..c.', '....pp.pp...', '...bbb.bbb..'] },
});
Object.assign(oficina, {
  rack: { pal: { ...O, g: '#59e08a', G: '#1a3a24', x: '#2e3440', X: '#1a1e26' }, rows: ['kkkkkkkkk', 'kxxxxxxxk', 'kxgxGxgxk', 'kXXXXXXXk', 'kxGxgxgxk', 'kXXXXXXXk', 'kxgxgxGxk', 'kXXXXXXXk', 'kxgxGxgxk', 'kkkkkkkkk'] },
  room: { pal: { ...O, w: '#e2e5ec', W: '#c9cdd6', f: '#d8c8a8', c: '#4f9dff' }, rows: ['cccccccccccc', 'wwwwwwWWWWWW', 'wwbbwwWWWWWW', 'wwbbwwWWWWWW', 'wwwwwwWWWWWW', 'ffffffffffff', 'ffffffffffff', 'kkkkkkkkkkkk'] },
  worker: { pal: { ...O, t: '#4f7cc8', m: '#2e3440', S: '#7fc4f0', D: '#e9e2d0' }, rows: ['........kkkk', '..kkkk..kSSk', '.kkkkk..kSSk', '.ksssk...kk.', '.ksksk..kmm.', '.ksssk..kmm.', 'kttttttkDDDD', 'kttttttkDDDD', '..........D.'] },
  laptop: { pal: { ...O, S: '#dff4ff', m: '#8a909a' }, rows: ['..kkkkkkkk..', '..kSSSSSSk..', '..kSSSSSSk..', '..kSSSSSSk..', '..kkkkkkkk..', 'kmmmmmmmmmmk', 'kkkkkkkkkkkk'] },
  plane: { pal: { x: '#ffffff', k: '#9aa3ad' }, rows: ['x.......', 'xxxx....', 'xxxxxxxx', '.xxxx...', '..x.....'] },
  intruder: { pal: { k: '#111111', s: '#8a5a3a', x: '#2a2a33', e: '#ff4040' }, rows: ['...kkkk...', '..kxxxxk..', '..kxeexk..', '..kxsssk..', '...kkkk...', '..kxxxxk..', '.kxxxxxxk.', '..kxxxxk..', '..kx..xk..', '..kk..kk..'] },
  mate: { pal: { k: '#1a1a22', s: '#e8b890', h: '#6b3a1a', t: '#d97a3a', p: '#2e3440', m: '#8a909a', S: '#dff4ff' }, rows: ['...kkkk...', '..khhhhk..', '..kssssk..', '..kskksk..', '...kkkk...', '..kttttkmS', '.kttttttkm', '..kttttk..', '..kp..pk..', '..kk..kk..'] },
  envelope: { pal: { k: '#6a707a', x: '#f4efe0' }, rows: ['kkkkkkkkk', 'kxxxxxxxk', 'kkxxxxxkk', 'kxkkxkkxk', 'kxxxxxxxk', 'kkkkkkkkk'] },
});
Object.assign(raid, {
  guardian: { pal: { k: '#120f0d', a: '#c7ccd4', A: '#7d838c', y: '#e8c55a', z: '#e2b48c' }, rows: ['......kkkk......', '.....kaaaak.....', '.....kakkak.....', '.....kzzzzk.....', '......kkkk......', '...kkkaaaakk....', '..kyyykaaaaak...', '..kyAyykaaaak...', '..kyAAyykaazk...', '..kyAyykaaak....', '..kyyykaaaak....', '...kkkkAkAk.....', '....kaak.kaak...', '....kkk..kkk....'] },
  boss: { pal: { k: '#120f0d', v: '#6b3a9e', V: '#5a2f86', x: '#f4f1e8', r: '#ff3b2e' }, rows: ['kk........kk', 'kxk......kxk', 'kxk.kkkk.kxk', '.kkkvvvvkkk.', '...kvrvrvk..', '...kvvvvvk..', '...kxkxkxk..', '.kkkVVVVVkkk', 'kVVVVrrVVVVk', 'kVVVVVVVVVVk', '.kkVVVVVVkk.', '...kk..kk...'] },
  group: { pal: { k: '#120f0d', y: '#e8c55a', s: '#3a3530', r: '#b53a2e', b: '#4a6fe0', g: '#4f8a3a' }, rows: ['yyyyyyyyyyyy', 'y..........y', 'y.rk.bk.gk.y', 'y.rr.bb.gg.y', 'y.rr.bb.gg.y', 'y.kk.kk.kk.y', 'y..........y', 'yyyyyyyyyyyy'] },
  hero: { pal: { k: '#120f0d', C: '#b53a2e', c: '#7a261e', H: '#c7ccd4', z: '#e2b48c', a: '#c7ccd4', w: '#8b5a2b', y: '#e8c55a' }, rows: ['......kkkk...a..', '.....kHHHHk..a..', '.....kzzzzk..a..', '.....kzkzkk..a..', '......kzzk...a..', '....kkCCCCkk.a..', '...kCCCCCCCCkwy.', '...kCCccccCCk...', '...kzCCCCCCzk...', '....kCCCCCCk....', '....kcccccck....', '....kCCkkCCk....', '....kkk..kkk....'] },
  player: { pal: { k: '#120f0d', C: '#4a6fe0', c: '#2e45a0', H: '#4a6fe0', z: '#e2b48c', w: '#8b5a2b', b: '#4a8fe0', x: '#f4f1e8', y: '#e8c55a' }, rows: ['.......C.....x..', '......CC.....b..', '.....kHHHHk..w..', '.....kzzzzk..w..', '.....kzkzkk..w..', '....kkCCCCkk.w..', '...kCCCCCCCCkw..', '...kCCccccCCk...', '...kzCCCCCCzk...', '....kcccccck....', '..yyyyyyyyyyyy..'] },
});
Object.assign(acuario, {
  tank: { pal: { k: '#081620', w: '#cfeee4', b: '#1f7a90', s: '#d9c08c', g: '#3f9a4a', o: '#ff8a3d', c: '#8a6fc8' }, rows: ['wwwwwwwwwwww', 'wbbbbbbbbbbw', 'wbbbbobbbbbw', 'wbgbbbbbbbbw', 'wbgbbbbbbgbw', 'wbgbbbbbbgbw', 'wssssssssssw', 'wwwwwwwwwwww', 'cccccccccccc'] },
  filter: { pal: { k: '#1b2833', w: '#9fd9e6', b: '#3ddbd9', o: '#7be0ff', g: '#4ade80' }, rows: ['....kg....', '..kkkkkk..', '.wwwwwwwww', '.w.......w', '.w..o....w', '.wbbbbbbbw', '.wbbobbbbw', '.wbbbbbbbw', '.wwwwwwwww'] },
  fish: { pal: { k: '#081620', a: '#ff8a3d', b: '#ffd23f' }, rows: ['..aaaa..b', '.aaaaaabb', 'aakaaaabb', '.aaaaaabb', '..aaaa..b'] },
  deadfish: { pal: { k: '#081620', a: '#8a9aa0', b: '#6d7c82' }, rows: ['..aaaa..b', '.aaaaaabb', 'aakaaaabb', '.aaaaaabb', '..aaaa..b'].reverse() },
  food: { pal: { f: '#d9c08c', g: '#9aa7ad' }, rows: ['.f....f..', '...f.....', 'f.....f..', '..g..f...', '.....g..f'] },
  diver: { pal: { k: '#081620', y: '#c8a24a', v: '#a6e3c8', o: '#ffb347', g: '#9aa7ad' }, rows: ['...kkkk...', '..kyyyyk..', '.kyvvvvyk.', '.kyvvvvyk.', '..kyyyyk..', 'g.koooook.', 'gkoooooook', 'g.koooook.', '..ko..ok..', '..kk..kk..'] },
});
Object.assign(ops, {
  dome: { pal: X, rows: ['....gggg....', '..gg.g..gg..', '.g..g.g...g.', 'g..g...g...g', 'g.g.....g..g', 'gggggggggggg', '....kGGk....', '....kGGk....', '...kkkkkk...'] },
  sector: { pal: X, rows: ['g...........', '.g..........', '..g.........', '...g...s.s..', '....g.......', 'ggggggg.s...', '.....s......', '..s.........'] },
  column: { pal: X, rows: ['...kk...kk..', '..kggk..kyk.', '..kggk..kyk.', '..kggk..kyk.', '..kggk.krrk.', 'kkkggkkkrrkk', 'kGGggGGkrrkk', 'kkkkkkkkkkkk'] },
  drone: { pal: { ...X, w: '#e6f4d8' }, rows: ['.......', '...w...', '..www..', '.wwwww.', 'ww...ww'] },
  missile: { pal: X, rows: ['....r...', '...rrr..', '...rrr..', '...rrr..', '..rrrrr.', '..r.R.r.', '....R...', '...R.R..'] },
});
Object.assign(planta, {
  central: { pal: P, rows: ['.B..........', '.Bw.........', '.B.....ll...', '.B....l..l..', 'lllllll..l..', 'lllllll.bbl.', 'lllllllbbbl.', 'yyyyyyylbbl.', 'lllllll.ll..', 'kkkkkkkkkkkk'] },
  hall: { pal: { ...P, f: '#3d3d48' }, rows: ['gggggggggggg', 'gffffffffffg', 'gflfflfflffg', 'gffffffffffg', 'kkkkkkkkkkkk', 'gfyffffffffg', 'gfyflfflfffg', 'gggggggggggg'] },
  machine: { pal: { ...P, o: '#ffa300', i: '#00e436' }, rows: ['.......bb...', '.......bb...', '.i.....ll...', 'lllllllll...', 'lllolllll...', 'llooolllll..', 'lllolllll...', 'lllllllll...', 'kkkkkkkkkk..'] },
  press: { pal: { ...P, o: '#ffa300', v: '#83769c' }, rows: ['gggggggggg', 'g........g', 'g..oooo..g', 'g..oooo..g', 'g........g', 'g........g', 'vvvvvvvvvv', 'vvvvvvvvvv'] },
  piece: { pal: P, rows: ['.PPP..rrr.', 'PPPPPrrrrr', 'PPPPPrrrrr', 'PPPP.rrrr.', '..........', 'kkkkkkkkkk'] },
  robot: { pal: { ...P, c: '#29adff' }, rows: ['..BBBBBB..', '..BBBBBB..', '...kkkk...', '..kccccck.', '..kcwcwck.', '..kccccck.', '.klllllllk', '.klllllllk', '..kk..kk..'] },
});
Object.assign(ciudad, {
  tower: { pal: Y, rows: ['.....t......', '....ktk.....', '...kssk.....', '..kssssk....', '..ksttsk....', '..kssssk....', '..ksttsk....', '..kssssk....', '..ksttsk....', '.kkkkkkkk...'] },
});

export const ART = { villa, oficina, castillo, raid, acuario, ops, planta, ciudad, ciudad3d: ciudad };
