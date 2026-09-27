// Elenco de la capa de efectos (commfx) para cada tema: quien patrulla un sitio vigilado, quien vuela a capturar
// lo malicioso y escolta a los bloqueados, quien llega a sondear, la fila de espera, el bicho (archivo malicioso)
// y el color de la capsula de cuarentena. Cada tema usa personajes de su propio mundo: en la villa no hay autos
// de policia ni en el acuario patrullas voladoras. Sin entrada, el elenco de la ciudad (autos, en pixeldata.js).
// Terminal no dibuja ninguno (none): alli lo cuenta el registro de texto.
// Cada cuadro es un arreglo de filas de caracteres; la paleta traduce cada caracter a un color ('.' = vacio).

// ------------------------------------------------------------------ villa: guardias, buho, ladron, ratas
const VP = { k: '#1b1410', s: '#e8b98a', a: '#aab2bc', A: '#6f7780', r: '#b53a2e', w: '#8b5a2b', y: '#e8c55a', b: '#6b4a2e', g: '#4a4a56', G: '#5d5d6a', e: '#ff4040', f: '#f4f1e8', o: '#8a6a3a', n: '#7a6a5a', t: '#e89aa0', B: '#8a6a3a' };
const GUARD = legs => ['..........a...', '.........aaa..', '....kkk...w...', '...kaaak..w...', '...kaaak..w...', '...kssk...w...', '..krrrrk..w...', '.kkrryrrkkw...', '..krrrrk..w...', '..kaaaak..w...', ...legs];
const THIEF = legs => ['....kkkk....', '...kggggk...', '..kggggggk..', '..kgkekekgk.', '..kggkkggk..', '.kgggggggggk', '.kgggBBgggk.', '.kgggBBgggk.', '..kggggggk..', ...legs];
const villa = {
  names: { police: 'Guardia', fly: 'Búho guardián', probe: 'Ladrón encapuchado', queue: 'Aldeano en fila', bug: 'Rata' },
  pal: VP,
  police: [GUARD(['..kb..bk..w...', '..kb..bk......', '..kk..kk......']), GUARD(['..kb.bk...w...', '.kb...bk......', '.kk...kk......'])],
  fly: [
    ['..k..........k..', '..kk........kk..', '...kbbbbbbbbk...', '..kbffbbbbffbk..', '..kbfkbyybkfbk..', '..kbbbbyybbbbk..', 'kkbbbbbbbbbbbbkk', 'kbbbbffffffbbbbk', '.kkbbffffffbbkk.', '...kbbbbbbbbk...', '....ky....yk....', '....kk....kk....'],
    ['................', '................', '...kbbbbbbbbk...', '..kbffbbbbffbk..', '..kbfkbyybkfbk..', '..kbbbbyybbbbk..', '..kbbbbbbbbbbk..', '.kbbbffffffbbbk.', 'kbbbbffffffbbbbk', 'kk.kbbbbbbbbk.kk', '....ky....yk....', '....kk....kk....']],
  probe: [THIEF(['..kgg..ggk..', '..kkk..kkk..']), THIEF(['..kgg.ggk...', '.kkk...kkk..'])],
  queue: [['...kkkk...', '..kssssk..', '..kskksk..', '..kssssk..', '...kkkk...', '..kooook..', '.kooooook.', '..kooook..', '..kb..bk..', '..kk..kk..']],
  bug: [
    ['.......kfk..', '..kkkkknnnk.', '.knnnnnnnenk', 'knnnnnnnnnnk', 'tknnnnnnnnk.', 't.kk.kk.kk..'],
    ['.......kfk..', '..kkkkknnnk.', '.knnnnnnnenk', 'knnnnnnnnnnk', 'tknnnnnnnnk.', '.t.kk.kk.kk.']],
  capsule: { fill: 'rgba(139, 90, 43, .38)', stroke: '#8b5a2b', lid: '#aab2bc', label: '#f5d76e' },
};

// ------------------------------------------------------------------ oficina: guardia, dron, intruso, aviones
const OP = { k: '#1a1a22', s: '#e8b890', u: '#23324a', y: '#e8c55a', p: '#2e3440', g: '#9aa3ad', d: '#3a414c', r: '#ff5a4a', w: '#dff4ff', x: '#2a2a33', e: '#ff4040', b: '#6b3a1a', l: '#a0622a' };
const SEC = legs => ['...kkkkk....', '..kuuuuuk...', '..kkkkkkkk..', '...kssssk...', '...kskskk...', '...kssssk...', '..kuuuuuuk..', '.kuuuyuuuuk.', '.kuuuuuuuuk.', '.ks.uuuu.sk.', ...legs];
const HOOD = legs => ['....kkkk....', '...kxxxxk...', '..kxxxxxxk..', '..kxkekekxk.', '..kxxkkxxk..', '.kxxxxxxxxxk', '.kxxxxxxxxk.', '.kxxxxxxxxk.', '..kxxxxxxk..', ...legs];
const oficina = {
  names: { police: 'Guardia de seguridad', fly: 'Dron de seguridad', probe: 'Intruso de capucha', queue: 'Avión de papel en espera', bug: 'Cucaracha' },
  pal: OP,
  police: [SEC(['...kpppk....', '...kp.pk....', '...kk.kk....']), SEC(['...kpppk....', '..kp..pk....', '..kk..kk....'])],
  fly: [
    ['kgggk......kgggk', '..k..........k..', '..kkkkkkkkkkkk..', '..kdddrddddddk..', '..kdddddddwddk..', '...kkkkkkkkkk...', '......k..k......'],
    ['.kgk........kgk.', '..k..........k..', '..kkkkkkkkkkkk..', '..kddddddddddk..', '..kdddddddwddk..', '...kkkkkkkkkk...', '......k..k......']],
  probe: [HOOD(['..kxx..xxk..', '..kkk..kkk..']), HOOD(['..kxx.xxk...', '.kkk...kkk..'])],
  queue: [['g.......', 'gggg....', 'gggggggg', '.gggg...', '..g.....']],
  bug: [
    ['.k........k.', '..k......k..', '..kbbbbbbk..', 'kkbllbbllbkk', '.kbbbbbbbbk.', 'kkbbbbbbbbkk', '..kbbbbbbk..', '.k..k..k..k.'],
    ['.k........k.', '..k......k..', '..kbbbbbbk..', '.kbllbbllbk.', 'kkbbbbbbbbkk', '.kbbbbbbbbk.', '..kbbbbbbk..', 'k..k....k..k']],
  capsule: { fill: 'rgba(200, 154, 90, .35)', stroke: '#c89a5a', lid: '#d0342a', label: '#f0a040' },
};

// ------------------------------------------------------------------ castillo: centinela, gargola, espectro, murcielagos
const CP = { k: '#0a0610', s: '#6a6078', S: '#4a4458', e: '#ff3b3b', y: '#d8b24a', w: '#d8e0f0', f: '#ff8a2a', F: '#ffe08a', c: '#b0203a', b: '#6a4a2a' };
const SENT = legs => ['.....F......', '.....f......', '....kkkk....', '...kssssk.b.', '...kskkssk.b', '...kssssk..b', '..kccccccckb', '.kcccyccccckb', '..kccccccck.', '..kSSSSSSk..', ...legs];
const castillo = {
  names: { police: 'Centinela', fly: 'Gárgola', probe: 'Espectro', queue: 'Murciélago en espera', bug: 'Araña' },
  pal: CP,
  police: [SENT(['..kS...Sk...', '..kS...Sk...', '..kk...kk...']), SENT(['..kS..Sk....', '.kS....Sk...', '.kk....kk...'])],
  fly: [
    ['k..............k', 'kk....kkkk....kk', 'ksk..kssssk..ksk', 'kssk.kseesk.kssk', 'ksssskssssksssk.', '.kssssssssssssk.', '..kksssssssskk..', '....kssssssk....', '....ks.kk.sk....', '...kk......kk...'],
    ['................', '......kkkk......', '.....kssssk.....', 'kk...kseesk...kk', 'kssskssssssksssk', '.kssssssssssssk.', '..kksssssssskk..', '....kssssssk....', '....ks.kk.sk....', '...kk......kk...']],
  probe: [
    ['...wwww...', '..wwwwww..', '.wwwwwwww.', '.wkkwwkkw.', '.wkkwwkkw.', '.wwwwwwww.', '.wwwkkwww.', '.wwwwwwww.', '.wwwwwwww.', '.w.ww.ww.w', 'w..w..w..w'],
    ['...wwww...', '..wwwwww..', '.wwwwwwww.', '.wkkwwkkw.', '.wkkwwkkw.', '.wwwwwwww.', '.wwwkkwww.', '.wwwwwwww.', '.wwwwwwww.', 'w.ww.ww.w.', '.w..w..w..']],
  queue: [['k.......k', 'kk.kkk.kk', '.kkkekkk.', '..kkkkk..', '...k.k...'], ['.........', '...kkk...', '.kkkekkk.', 'kk.kkk.kk', 'k..k.k..k']],
  bug: [
    ['k.k.....k.k', '.k.k...k.k.', '..kkkkkkk..', 'kkkekkkekkk', '..kkkkkkk..', '.k.kkkkk.k.', 'k.k..k..k.k', '..k.....k..'],
    ['.k.k...k.k.', 'k.k.....k.k', '..kkkkkkk..', 'kkkekkkekkk', '..kkkkkkk..', 'k.k.kkk.k.k', '.k...k...k.', 'k.........k']],
  capsule: { fill: 'rgba(90, 58, 34, .45)', stroke: '#d8b24a', lid: '#9a9aa8', label: '#e8dcb8' },
};

// ------------------------------------------------------------------ raid: paladin, dragoncito, esbirro, slime
const RP = { k: '#120f0d', y: '#e8c55a', Y: '#b8912e', a: '#c7ccd4', z: '#e2b48c', v: '#8a4fd0', V: '#5a2f86', r: '#ff3b2e', g: '#5fbf4a', G: '#3a8a2a', w: '#f4f1e8', s: '#9aa0a8', d: '#3b3346' };
const PAL = legs => ['......kkkk......', '.....kaaaak.....', '.....kzzzzk.aa..', '.....kzkzkk.aa..', '......kzzk...w..', '....kkyyyykk.w..', '...kyyyyyyyyk.w.', '...kyyYYYYyyk.w.', '...kzyyyyyyzkw..', '....kyyyyyyk....', '....kYYYYYYk....', ...legs];
const raid = {
  names: { police: 'Paladín', fly: 'Dragoncito', probe: 'Esbirro', queue: 'Héroe en fila', bug: 'Slime' },
  pal: RP,
  police: [PAL(['....kyyk.kyyk...', '....kkk..kkk....']), PAL(['...kyyk...kyyk..', '...kkk....kkk...'])],
  fly: [
    ['.k............k.', 'kyk..........kyk', 'kyyk..kkkk..kyyk', '.kyyykyyyykyyyk.', '..kyyyyyyyyyyk..', '...kyyykyyyyk...', '...kyyyyyyrkk...', '....kyyyyyk.....', '.....kk.kk......'],
    ['................', '......kkkk......', '.....kyyyyk.....', 'kkyyykyyyykyyykk', '..kyyyyyyyyyyk..', '...kyyykyyyyk...', '...kyyyyyyrkk...', '....kyyyyyk.....', '.....kk.kk......']],
  probe: [
    ['...kkkk...', '..kvvvvk..', '.kvrvvrvk.', '.kvvvvvvk.', '..kvkkvk..', '.kkvvvvkk.', 'kvkvvvvkvk', '..kvvvvk..', '..kv..vk..', '..kk..kk..'],
    ['...kkkk...', '..kvvvvk..', '.kvrvvrvk.', '.kvvvvvvk.', '..kvkkvk..', 'kkkvvvvkkk', '..kvvvvk..', '..kvvvvk..', '.kv....vk.', '.kk....kk.']],
  queue: [['....kkkk....', '...kssssk...', '...kzzzzk...', '..kkssssskk.', '..ksssssssk.', '...kssssk...', '...ks..sk...', '...kk..kk...']],
  bug: [
    ['....kkkk....', '..kkggggkk..', '.kggwggwggk.', '.kggkggkggk.', 'kggggggggggk', 'kgGgggggGggk', 'kkkkkkkkkkkk'],
    ['............', '...kkkkkk...', '.kkggwwggkk.', 'kggggkkggggk', 'kgggggggggggk', 'kgGgggggGgggk', 'kkkkkkkkkkkkk']],
  capsule: { fill: 'rgba(138, 79, 208, .3)', stroke: '#b04aff', lid: '#e8c55a', label: '#e8c55a' },
};

// ------------------------------------------------------------------ acuario: caballito, tortuga, tiburon, erizo
const AP = { k: '#081620', y: '#ffd23f', o: '#ff8a3d', g: '#3f9a4a', G: '#2e6a3a', s: '#8a9aa0', S: '#5d6c72', w: '#f4f1e8', r: '#ff4d5e', b: '#7be0ff' };
const acuario = {
  names: { police: 'Caballito de mar', fly: 'Tortuga marina', probe: 'Tiburón', queue: 'Pez en espera', bug: 'Erizo' },
  pal: AP,
  police: [
    ['...kkk....', '..kyyyk...', '.kykyyykk.', 'kyyyyyyyyk', '..kyyyk...', '..kyyyyk..', '...kyyyko.', '...kyyyk..', '..kyyyk...', '..kyyk....', '...kyk.kk.', '....kykyk.', '.....kkk..'],
    ['...kkk....', '..kyyyk...', '.kykyyykk.', 'kyyyyyyyyk', '..kyyyk...', '..kyyyyko.', '...kyyyk..', '...kyyyk..', '..kyyyk...', '..kyyk....', '...kyk.kk.', '....kykyk.', '.....kkk..']],
  fly: [
    ['......kkkkk.......', '....kkGGGGGkk.....', '..kkGGgGGgGGGk.kk.', '.kgkGGGGGGGGGkkggk', 'kggkGGgGGgGGGkgwgk', '.kgkkGGGGGGGkk.kkk', '..kk.kkkkkkk......', '...kgk....kgk.....', '....k......k......'],
    ['......kkkkk.......', '....kkGGGGGkk.....', '..kkGGgGGgGGGk.kk.', '..kkGGGGGGGGGkkggk', '.kgkGGgGGgGGGkgwgk', 'kggkkGGGGGGGkk.kkk', '.kgk.kkkkkkk......', '..kk.kgk..kgk.....', '......k....k......']],
  probe: [
    ['.........k........', '........kSk.......', '.kk....kSSSkkkkk..', 'kSSk..kSSSSSSSSSk.', '.kSSkkSsssssssswSk', 'kSSk..kssssssssssk', '.kk....kkkkkkkkkk.'],
    ['.........k........', '........kSk.......', '..kk...kSSSkkkkk..', '.kSSk.kSSSSSSSSSk.', 'kSSSkkSsssssssswSk', '.kSSk.kssssssssssk', '..kk...kkkkkkkkkk.']],
  queue: [['..ssss..s', '.ssssssss', 'sskssssss', '.ssssssss', '..ssss..s']],
  bug: [
    ['k...k...k.', '.k.rrr.k..', '..rrrrrr..', 'krrwrrwrrk', '.rrrrrrrr.', 'krrrrrrrrk', '..rrrrrr..', '.k.rrr.k..', 'k...k...k.'],
    ['..k...k...', 'k..rrr..k.', '.krrrrrrk.', '.rrwrrwrr.', 'krrrrrrrrk', '.rrrrrrrr.', '.krrrrrrk.', 'k..rrr..k.', '..k...k...']],
  capsule: { fill: 'rgba(123, 224, 255, .2)', stroke: '#bfe9ff', lid: '#d0342a', label: '#a6e3c8' },
};

// ------------------------------------------------------------------ ops: blindado, dron, marcador hostil, virus
const XP = { k: '#0b0d09', g: '#4ade80', G: '#2f7a4a', d: '#1b2214', a: '#8dffa0', r: '#ef4444', R: '#ff8a8a', s: '#5d6e48', w: '#e6f4d8' };
const ops = {
  names: { police: 'Blindado', fly: 'Dron', probe: 'Marcador hostil', queue: 'Contacto en espera', bug: 'Virus' },
  pal: XP,
  police: [
    ['......kkkkkk........', '.....kggggGk....a...', '..kkkkggggggkkkkakk.', '.kggggggggggggggggk.', 'kgggaggggggggggggggk', 'kgggggggggggggggggk.', '.kkkkkkkkkkkkkkkkk..', '..kdk.kdk.kdk.kdk...', '...k...k...k...k....'],
    ['......kkkkkk........', '.....kggggGk....a...', '..kkkkggggggkkkkakk.', '.kggggggggggggggggk.', 'kggggggggggggggggggk', 'kgggggggggggggggggk.', '.kkkkkkkkkkkkkkkkk..', '...kdk.kdk.kdk.kdk..', '....k...k...k...k...']],
  fly: [
    ['kgggk......kgggk', '..k..........k..', '..kkkkkkkkkkkkk.', '..kdddaddddddk..', '..kdddddddwddk..', '...kkkkkkkkkk...', '......k..k......'],
    ['.kgk........kgk.', '..k..........k..', '..kkkkkkkkkkkkk.', '..kddddddddddk..', '..kdddddddwddk..', '...kkkkkkkkkk...', '......k..k......']],
  probe: [
    ['.....kk.....', '....krrk....', '...krrrrk...', '...krrrrk...', '..krrkkrrk..', '..krrkkrrk..', '.krrrrrrrrk.', '.krrrkkrrrk.', 'krrrrrrrrrrk', 'kkkkkkkkkkkk'],
    ['.....kk.....', '....kRRk....', '...kRRRRk...', '...kRRRRk...', '..kRRkkRRk..', '..kRRkkRRk..', '.kRRRRRRRRk.', '.kRRRkkRRRk.', 'kRRRRRRRRRRk', 'kkkkkkkkkkkk']],
  queue: [['...s...', '..sss..', '.sssss.', 'sssssss', '.sssss.', '..sss..', '...s...']],
  bug: [
    ['r.......r.', '.r.....r..', '..r...r...', '...rrr....', '..rrRrr...', '...rrr....', '..r...r...', '.r.....r..', 'r.......r.'],
    ['..r...r...', '..r...r...', '..r...r...', '...rrr....', 'rrrrRrrrr.', '...rrr....', '..r...r...', '..r...r...', '..r...r...']],
  capsule: { fill: 'rgba(74, 222, 128, .12)', stroke: '#4ade80', lid: '#fbbf24', label: '#4ade80' },
};

// ------------------------------------------------------------------ planta: montacargas, dron amigo, dron hostil, cajas
const PP = { k: '#000000', y: '#ffec27', o: '#ffa300', r: '#ff004d', g: '#5f574f', l: '#c2c3c7', b: '#29adff', w: '#fff1e8', n: '#1d2b53', p: '#7e2553', B: '#ab5236', P: '#ffccaa' };
const LIFT = wheels => ['..k...............', '..k..kkkkk........', '..k.kllllk........', '..k.kl..lk........', '..kkklllllkkkkk...', '..kyyyyyyyyyyyyk..', 'kkkyyyyyyyyyyyyyk.', 'k..kyyyyyyyyyyyk..', 'k..kkkkkkkkkkkkk..', ...wheels];
const DRONE = (body, lamp) => [['kllk......kllk', '..k........k..', '..kkkkkkkkkk..', `..k${body}${body}${body}${lamp}${body}${body}${body}${body}k..`, `..k${body}${body}${body}${body}${body}${body}w${body}k..`, '...kkkkkkkk...'], ['.klk......klk.', '..k........k..', '..kkkkkkkkkk..', `..k${body.repeat(8)}k..`, `..k${body}${body}${body}${body}${body}${body}w${body}k..`, '...kkkkkkkk...']];
const planta = {
  names: { police: 'Montacargas', fly: 'Dron de la planta', probe: 'Dron hostil', queue: 'Caja en fila', bug: 'Bicho oxidado' },
  pal: PP,
  police: [LIFT(['kkk.kgk.....kgk...', '.....k.......k....']), LIFT(['kkk.kgk.....kgk...', '....k.k.....k.k...'])],
  fly: DRONE('b', 'y'),
  probe: DRONE('r', 'w'),
  queue: [['kkkkkkkk', 'kBBBBBBk', 'kBPBBPBk', 'kBBBBBBk', 'kBBBBBBk', 'kkkkkkkk']],
  bug: [
    ['.k......k.', '..kkkkkk..', '.krrrrrrk.', 'krwrrrrwrk', 'krrrrrrrrk', '.krrrrrrk.', 'k.k....k.k'],
    ['k........k', '..kkkkkk..', '.krrrrrrk.', 'krwrrrrwrk', 'krrrrrrrrk', '.krrrrrrk.', '.k.k..k.k.']],
  capsule: { fill: 'rgba(126, 37, 83, .38)', stroke: '#ff77a8', lid: '#ffec27', label: '#ffa300' },
};

// los nombres del elenco de la ciudad (los autos de pixeldata.js)
export const BASE_NAMES = { police: 'Patrulla', fly: 'Patrulla voladora', probe: 'Auto sospechoso', queue: 'Auto en fila', bug: 'Escarabajo' };

export const SKINS = { villa, oficina, castillo, raid, acuario, ops, planta, terminal: { none: true } };
