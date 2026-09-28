'use strict';
// Revision web diaria (con visitas simuladas): un sitio publico debe poder encontrarse (portada con texto, robots.txt
// que no cierre la puerta a los buscadores ni a las IA, sitemap) y uno privado no debe poder indexarse. Lo que no se
// pudo medir no es una falta; las graves avisan una vez al aparecer y una al arreglarse. Uso: node test/webrules.test.js
const assert = require('assert');
const fs = require('fs'), os = require('os'), path = require('path');
const { EventEmitter } = require('events');
const { WebSites, ACCOUNT } = require('../server/websites');
const { WebRules, kindOf, parseRobots, robotsInfo, noindex } = require('../server/audits/webrules');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-reglas-'));
const bus = new EventEmitter();
const evs = [];
bus.on('ev', e => { if (e.kind === 'webrule') evs.push(e); });
// lo que responde cada direccion; una funcion permite cambiarlo entre visitas
const web = {}, seen = [];
let now = Date.parse('2026-09-28T12:00:00Z');
const visit = async url => { seen.push(url); const r = web[url]; return typeof r === 'function' ? r() : r || { status: 0, ms: 5, error: 'el dominio no resuelve' }; };
web['https://www.gstatic.com/generate_204'] = { status: 204, ms: 3, body: '' };

const LOREM = 'Vendemos café de especialidad tostado en Caracas y lo llevamos a su casa en menos de un día. '.repeat(5);
const GOOD = `<!doctype html><html lang="es"><head><title>La tienda del café</title><meta name="description" content="Café de especialidad a domicilio">
<script type="application/ld+json">{"@type":"Store","name":"La tienda"}</script></head><body><h1>La tienda del café</h1><p>${LOREM}</p></body></html>`;
const SPA = '<!DOCTYPE html><html><head><title>App</title></head><body><div id="root"></div><script>' + 'var contenido = "texto que solo ve el navegador"; '.repeat(40) + '</script></body></html>';
const html = (body, headers) => ({ status: 200, ms: 50, body, headers: { 'content-type': 'text/html; charset=utf-8', ...(headers || {}) } });
const txt = body => ({ status: 200, ms: 20, body, headers: { 'content-type': 'text/plain' } });
const gone = () => ({ status: 404, ms: 20, body: 'Not found', headers: { 'content-type': 'text/plain' } });
const ROBOTS_OK = 'User-agent: *\nAllow: /\n\nSitemap: https://tienda.com/sitemap.xml\n';
const SITEMAP = '<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://tienda.com/</loc></url></urlset>';
// lo que Cloudflare escribe cuando enciende el bloqueo de robots de IA, seguido del robots.txt del dueno
const ROBOTS_CF = `# As a condition of accessing this website, you agree to abide by the following content signals:
# BEGIN Cloudflare Managed content

User-agent: *
Content-Signal: search=yes,ai-train=no
Allow: /

User-agent: Amazonbot
Disallow: /

User-agent: Applebot-Extended
Disallow: /

User-agent: Bytespider
Disallow: /

User-agent: CCBot
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Google-Extended
Disallow: /

User-agent: GPTBot
Disallow: /

User-agent: meta-externalagent
Disallow: /

# END Cloudflare Managed Content

User-agent: *
Allow: /
Sitemap: https://tienda.com/sitemap.xml
`;
// un sitio publico completo y sano
const healthy = d => {
  web[`https://${d}/`] = html(GOOD); web[`https://${d}/robots.txt`] = txt(ROBOTS_OK); web[`https://${d}/sitemap.xml`] = { status: 200, ms: 20, body: SITEMAP, headers: { 'content-type': 'application/xml' } };
  web[`https://${d}/llms.txt`] = txt('# La tienda\n\n> Café de especialidad a domicilio\n'); web[`https://${d}/no-existe-atalaya-zz9`] = gone();
};
const ids = r => r.findings.map(f => f.id).sort();
const bad = r => r.findings.filter(f => f.level === 'bad').map(f => f.id).sort();

(async () => {
  // piezas sueltas: publico o privado, grupos del robots.txt y noindex
  assert.strictEqual(kindOf({ domain: 'tienda.com', expect: 0 }), 'public');
  assert.strictEqual(kindOf({ domain: 'api.tienda.com', expect: 401 }), 'private');
  assert.strictEqual(kindOf({ domain: 'api.tienda.com', expect: 403 }), 'private');
  for (const d of ['tienda.pages.dev', 'tienda.vercel.app', 'tienda.netlify.app', 'tienda.workers.dev']) assert.strictEqual(kindOf({ domain: d }), 'private', d);
  assert.strictEqual(kindOf({ domain: 'tienda.pages.dev', index: true }), 'public', 'lo que el dueno declara manda');
  assert.strictEqual(kindOf({ domain: 'tienda.com', index: false }), 'private');
  assert.strictEqual(parseRobots('User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nDisallow:\n').length, 2, 'dos nombres seguidos son un solo grupo');
  assert.deepStrictEqual(robotsInfo('User-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: *\nDisallow:\n'), { ai: ['GPTBot', 'CCBot'], all: false, cloudflare: false });
  assert.deepStrictEqual(robotsInfo('user-agent: gptbot # el de OpenAI\ndisallow: /privado\n').ai, [], 'cerrar una carpeta no es cerrar el sitio');
  assert.deepStrictEqual(robotsInfo('User-agent: *\nDisallow: /\n'), { ai: [], all: true, cloudflare: false });
  assert.strictEqual(noindex({ body: '<meta content="NOINDEX, nofollow" name=\'robots\'>' }), true, 'el orden de los atributos no importa');
  assert.strictEqual(noindex({ body: '<meta name="robots" content="index, follow"><!-- <meta name="robots" content="noindex"> -->' }), false);
  assert.strictEqual(noindex({ body: '', headers: { 'X-Robots-Tag': 'noindex' } }), true);

  const W = new WebSites({ stateDir: dir }, bus, { visit, retryMs: 0, now: () => now });
  const R = new WebRules({ stateDir: dir }, W, bus, { visit, retryMs: 0, now: () => now });
  const gid = d => ACCOUNT + ':' + d;
  assert.strictEqual(R.section(), null, 'sin revisiones no hay seccion');

  // publico y sano: ninguna falta, ningun aviso
  healthy('tienda.com');
  W.add({ domain: 'tienda.com' });
  seen.length = 0;
  let r = await R.check('tienda-com');
  assert.deepStrictEqual(r, { at: now, kind: 'public', findings: [], unmeasured: [], checked: 5 });
  assert.deepStrictEqual(seen, ['https://tienda.com/', 'https://tienda.com/robots.txt', 'https://tienda.com/sitemap.xml', 'https://tienda.com/llms.txt', 'https://tienda.com/no-existe-atalaya-zz9']);
  assert.strictEqual(evs.length, 0);
  assert.deepStrictEqual(R.of(gid('tienda.com')), r);
  assert.strictEqual(R.of(gid('otro.com')), null);
  assert.strictEqual((fs.statSync(path.join(dir, 'webrules.json')).mode & 0o777), 0o600);

  // Cloudflare enciende el bloqueo de IA: falta grave que nombra a los rastreadores y dice donde se apaga; un solo aviso
  web['https://tienda.com/robots.txt'] = txt(ROBOTS_CF);
  now += 86400000; r = await R.check('tienda-com');
  assert.deepStrictEqual(ids(r), ['ai']);
  const ai = r.findings[0];
  assert.strictEqual(ai.level, 'bad');
  for (const b of ['GPTBot', 'ClaudeBot', 'CCBot', 'Google-Extended', 'Applebot-Extended', 'Bytespider', 'meta-externalagent', 'Amazonbot']) assert.ok(ai.text.includes(b), b);
  assert.ok(!ai.text.includes('PerplexityBot'), 'solo los que de verdad estan bloqueados');
  assert.match(ai.fix, /Cloudflare lo enciende solo: Security › Settings › Bot traffic › desactive el bloqueo de robots de IA/);
  now += 86400000; await R.check('tienda-com');
  assert.deepStrictEqual(evs.map(e => e.action + ':' + e.rule), ['found:ai'], 'un solo aviso aunque siga igual');
  assert.deepStrictEqual({ ...evs[0], text: null }, { kind: 'webrule', action: 'found', account: ACCOUNT, site: gid('tienda.com'), domain: 'tienda.com', rule: 'ai', text: null });
  assert.strictEqual(evs[0].text, ai.text);

  // no pude medir no es esta roto: el robots.txt no responde -> sin medir, sin falta `robots`, y la falta que ya
  // habia se conserva sin anunciar un arreglo que nadie hizo
  evs.length = 0; seen.length = 0;
  web['https://tienda.com/robots.txt'] = { status: 0, ms: 20000, error: 'no respondió en 20 s' };
  now += 86400000; r = await R.check('tienda-com');
  assert.strictEqual(seen.filter(u => u === 'https://tienda.com/robots.txt').length, 2, 'se reintenta una vez');
  assert.deepStrictEqual(r.unmeasured, ['robots.txt']);
  assert.ok(!ids(r).includes('robots'));
  assert.deepStrictEqual(ids(r), ['ai']);
  assert.strictEqual(r.checked, 4);
  assert.strictEqual(evs.length, 0);
  // un tropiezo que se arregla en el segundo intento si es una medida
  let n = 0;
  web['https://tienda.com/robots.txt'] = () => (++n === 1 ? { status: 0, ms: 9, error: 'cortó la conexión' } : txt(ROBOTS_CF));
  now += 86400000; r = await R.check('tienda-com');
  assert.deepStrictEqual(r.unmeasured, []); assert.strictEqual(evs.length, 0);
  // un cortafuegos que rechaza la visita tampoco es un archivo ausente
  web['https://tienda.com/robots.txt'] = { status: 403, ms: 9, body: '<html>Access denied</html>' };
  now += 86400000; r = await R.check('tienda-com');
  assert.deepStrictEqual(r.unmeasured, ['robots.txt']); assert.strictEqual(evs.length, 0);

  // lo apagan: un aviso de arreglado, una sola vez
  web['https://tienda.com/robots.txt'] = txt(ROBOTS_OK);
  now += 86400000; r = await R.check('tienda-com');
  now += 86400000; await R.check('tienda-com');
  assert.deepStrictEqual(r.findings, []);
  assert.deepStrictEqual(evs.map(e => e.action + ':' + e.rule), ['fixed:ai']);

  // nombrar a GPTBot para dejarlo pasar no es bloquearlo
  evs.length = 0;
  web['https://tienda.com/robots.txt'] = txt('User-agent: GPTBot\nAllow: /\n\nUser-agent: ClaudeBot\nDisallow:\n\nUser-agent: PerplexityBot\nDisallow: /\nAllow: /\n\nUser-agent: *\nDisallow: /admin\n');
  now += 86400000; r = await R.check('tienda-com');
  assert.deepStrictEqual(r.findings, []); assert.strictEqual(evs.length, 0);

  // sin un fallo de red en todo el sitio: nada se mide, nada se acusa
  for (const u of Object.keys(web).filter(x => x.startsWith('https://tienda.com/'))) delete web[u];
  now += 86400000; r = await R.check('tienda-com');
  assert.deepStrictEqual(r.findings, []); assert.strictEqual(r.checked, 0); assert.strictEqual(r.unmeasured.length, 5); assert.strictEqual(evs.length, 0);
  healthy('tienda.com');

  // sitio de una sola pagina: responde su portada (HTML, 200) a cualquier direccion. Eso no es un robots.txt
  for (const p of ['/', '/robots.txt', '/sitemap.xml', '/llms.txt', '/no-existe-atalaya-zz9']) web['https://app.com' + p] = html(SPA);
  W.add({ domain: 'app.com' });
  now += 86400000; r = await R.check('app-com');
  assert.deepStrictEqual(ids(r), ['description', 'empty', 'h1', 'jsonld', 'llms', 'robots', 'sitemap', 'soft404']);
  assert.deepStrictEqual(bad(r), ['empty', 'robots']);
  assert.strictEqual(r.findings.find(f => f.id === 'soft404').level, 'warn');
  assert.match(r.findings.find(f => f.id === 'soft404').text, /Responde 200 a una dirección que no existe/);
  // portada vacia: solo el contenedor y un script largo
  assert.match(r.findings.find(f => f.id === 'empty').text, /^Entrega la página vacía a los buscadores y a las IA \(\d+ caracteres de texto\)$/);
  assert.ok(SPA.length > 1000 && Number(/\((\d+)/.exec(r.findings.find(f => f.id === 'empty').text)[1]) < 300, 'el codigo no cuenta como texto');
  assert.deepStrictEqual(r.findings.map(f => f.level), [...r.findings.map(f => f.level)].sort((a, b) => 'bwi'.indexOf(a[0]) - 'bwi'.indexOf(b[0])), 'las graves primero');
  assert.deepStrictEqual(evs.map(e => e.action + ':' + e.rule).sort(), ['found:empty', 'found:robots'], 'la primera revision avisa de las graves; los avisos y mejoras nunca');

  // portada con noindex (en la pagina o en la cabecera) y robots.txt cerrado para todos
  evs.length = 0;
  healthy('blog.com');
  web['https://blog.com/'] = html(GOOD.replace('<title>', '<meta name="robots" content="noindex,follow"><title>'));
  web['https://blog.com/robots.txt'] = txt('User-agent: *\nDisallow: /\n');
  W.add({ domain: 'blog.com' });
  now += 86400000; r = await R.check('blog-com');
  assert.deepStrictEqual(ids(r), ['all', 'noindex']);
  assert.match(r.findings.find(f => f.id === 'noindex').text, /Dejó de indexarse: va a desaparecer de Google/);
  web['https://blog.com/'] = html(GOOD, { 'x-robots-tag': 'noindex' });
  web['https://blog.com/robots.txt'] = txt(ROBOTS_OK);
  now += 86400000; r = await R.check('blog-com');
  assert.deepStrictEqual(ids(r), ['noindex']);
  assert.deepStrictEqual(evs.map(e => e.action + ':' + e.rule).sort(), ['fixed:all', 'found:all', 'found:noindex']);

  // espejo tecnico indexable, y el mismo ya cerrado con la cabecera
  evs.length = 0; seen.length = 0;
  web['https://tienda.pages.dev/'] = html(GOOD);
  W.add({ domain: 'tienda.pages.dev' });
  await new Promise(f => setTimeout(f, 20)); seen.length = 0; // la primera medida que dispara el alta
  now += 86400000; r = await R.check('tienda-pages-dev');
  assert.strictEqual(r.kind, 'private');
  assert.deepStrictEqual(seen, ['https://tienda.pages.dev/'], 'a un sitio privado se le hace una sola peticion');
  assert.deepStrictEqual(ids(r), ['indexable']);
  assert.match(r.findings[0].text, /Se puede indexar: cualquiera lo encuentra en Google/);
  assert.strictEqual(r.findings[0].level, 'bad');
  web['https://tienda.pages.dev/'] = html(GOOD, { 'x-robots-tag': 'noindex' });
  now += 86400000; r = await R.check('tienda-pages-dev');
  assert.deepStrictEqual(r.findings, []);
  assert.deepStrictEqual(evs.map(e => e.action + ':' + e.rule), ['found:indexable', 'fixed:indexable']);
  // tampoco hay falta si pide llave, si no existe, si no resuelve o si redirige al dominio principal
  evs.length = 0;
  for (const resp of [{ status: 401, ms: 5, body: '' }, { status: 403, ms: 5, body: '' }, gone(), { status: 0, ms: 5, error: 'el dominio no resuelve' }, { ...html(GOOD), url: 'https://www.tienda.com/' }]) {
    web['https://tienda.pages.dev/'] = resp;
    now += 86400000; r = await R.check('tienda-pages-dev');
    assert.deepStrictEqual(r.findings, [], String(resp.status));
  }
  assert.strictEqual(evs.length, 0);
  // una puerta que exige llave y de pronto abre sin ella
  web['https://api.tienda.com/panel'] = { status: 401, ms: 5, body: '' };
  W.add({ domain: 'api.tienda.com/panel', expect: 401 });
  now += 86400000; r = await R.check('api-tienda-com');
  assert.deepStrictEqual([r.kind, r.findings.length], ['private', 0]);
  web['https://api.tienda.com/panel'] = html(GOOD);
  now += 86400000; r = await R.check('api-tienda-com');
  assert.deepStrictEqual(ids(r), ['indexable']);

  // todos, de a uno; y un sitio que no existe no rompe nada
  assert.strictEqual(await R.check('no-existe'), null);
  evs.length = 0;
  now += 86400000;
  const all = await R.checkAll();
  assert.deepStrictEqual(Object.keys(all).sort(), W.ids().map(id => W.groupId(id)).sort());
  assert.ok(Object.values(all).every(x => x.at === now));
  assert.strictEqual(evs.length, 0, 'repetir la revision no repite los avisos');

  // la seccion de «Salud del servidor»: la misma forma que las demas revisiones
  const s = R.section();
  assert.deepStrictEqual(Object.keys(s), ['id', 'title', 'icon', 'status', 'findings', 'items']);
  assert.strictEqual(s.id, 'webrules'); assert.strictEqual(s.status, 'bad');
  assert.ok(s.findings.length >= 5);
  for (const f of s.findings) {
    assert.deepStrictEqual(Object.keys(f), ['sev', 'title', 'detail', 'fix', 'names']);
    assert.ok(['bad', 'warn', 'info'].includes(f.sev)); assert.ok(f.title && f.detail && f.fix && Array.isArray(f.names));
  }
  assert.ok(s.findings.some(f => f.sev === 'bad' && /^api\.tienda\.com: Se puede indexar/.test(f.title)));
  assert.ok(s.findings.some(f => f.sev === 'info' && /^app\.com: 3 mejoras opcionales/.test(f.title)), 'las mejoras opcionales van juntas por sitio');
  for (const i of s.items) assert.ok(typeof i.label === 'string' && typeof i.value === 'string');
  assert.strictEqual(s.items[0].value, '5');

  // sobrevive a un reinicio
  const R2 = new WebRules({ stateDir: dir }, W, bus, { visit, retryMs: 0 });
  assert.deepStrictEqual(R2.of(gid('app.com')), R.of(gid('app.com')));
  assert.deepStrictEqual(R2.section().findings.length, s.findings.length);
  // lo que se deja de vigilar se olvida
  W.remove('blog-com');
  assert.strictEqual(R.of(gid('blog.com')), null);
  await R.checkAll();
  assert.strictEqual(R.results[gid('blog.com')], undefined);

  // ningun texto con emojis
  web['https://tienda.com/robots.txt'] = txt(ROBOTS_CF);
  web['https://tienda.com/robots.txt'].status = 200;
  await R.check('tienda-com');
  const texts = [];
  for (const x of Object.values(R.results)) for (const f of x.findings) texts.push(f.text, f.fix);
  const sec = R.section();
  for (const f of sec.findings) texts.push(f.title, f.detail, f.fix);
  for (const i of sec.items) texts.push(i.label, i.value, i.sub || '');
  for (const e of evs) texts.push(e.text);
  texts.push(sec.title);
  assert.ok(texts.length > 30);
  for (const t of texts) assert.ok(!/\p{Extended_Pictographic}/u.test(t), 'sin emojis: ' + t);
  for (const f of [path.join(__dirname, '../server/audits/webrules.js'), __filename]) assert.ok(!/\p{Extended_Pictographic}/u.test(fs.readFileSync(f, 'utf8')), 'sin emojis en ' + path.basename(f));

  fs.rmSync(dir, { recursive: true, force: true });
  console.log('webrules.test.js OK');
})().catch(e => { console.error(e); process.exit(1); });
