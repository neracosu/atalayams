'use strict';
// Conector de Cloudflare (con la API simulada): proyectos de Pages y sus despliegues, Workers con sus corridas,
// el reloj que deja de correr sin dar error, las visitas de cada zona y un token al que le faltan permisos.
// Uso: node test/cfconnector.test.js
const assert = require('assert');
const { CloudflareConnector, cronEvery, deployState, verify } = require('../server/connectors/cloudflare');

const TOKEN = 'T'.repeat(40), ACC = 'a'.repeat(32), H = 3600000;
let now = Date.parse('2026-09-28T12:30:00Z');
const iso = t => new Date(t).toISOString();
const evs = [], bus = { emit: (_, e) => evs.push(e), on() { } };

// el mundo simulado
const world = {
  denied: new Set(), // partes sin permiso
  stage: { name: 'deploy', status: 'success' },
  depId: 'dep-1',
  runs: { 'torre-sondas': [0, 1, 2, 3].map(h => ({ h, requests: 12, errors: 0 })), 'respaldo': [{ h: 2, requests: 1, errors: 0 }], 'api-roto': [{ h: 1, requests: 40, errors: 30 }] },
};
const dep = (id, stage, env = 'production', msg = 'Arregla el carrito') => ({ id, url: `https://${id}.tienda.pages.dev`, environment: env, created_on: iso(now - 120000), modified_on: iso(now - 60000), latest_stage: stage,
  deployment_trigger: { type: 'ad_hoc', metadata: { branch: 'main', commit_message: msg } } });
const calls = [];
const fake = async (url, o = {}) => {
  const u = url.replace('https://api.cloudflare.com/client/v4', '');
  calls.push(`${o.method} ${u.split('?')[0]}`);
  const ok = (result, extra = {}) => ({ status: 200, json: async () => ({ success: true, result, ...extra }) });
  const no = () => ({ status: 403, json: async () => ({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }) });
  if ((o.headers || {}).Authorization !== 'Bearer ' + TOKEN) return no();
  if (u.startsWith('/accounts?')) return world.denied.has('accounts') ? no() : ok([{ id: ACC, name: 'GG Innovations' }]);
  if (u.startsWith(`/accounts/${ACC}/pages/projects?`)) return world.denied.has('pages') ? no() : ok([
    { id: 'p1', name: 'tienda', subdomain: 'tienda.pages.dev', domains: ['tienda.pages.dev', 'pedir.tienda.com'], source: { type: 'gitlab', config: { owner: 'gg', repo_name: 'tienda' } }, latest_deployment: dep(world.depId, world.stage) },
    { id: 'p2', name: 'panel', subdomain: 'panel.pages.dev', domains: ['panel.pages.dev'], source: { type: 'github', config: { owner: 'GG', repo_name: 'Panel' } }, latest_deployment: null },
  ], { result_info: { total_pages: 1 } });
  if (u.startsWith(`/accounts/${ACC}/pages/projects/tienda/deployments`)) return ok([dep(world.depId, world.stage), dep('dep-0', { name: 'deploy', status: 'success' }, 'preview', 'Prueba')]);
  if (u === `/accounts/${ACC}/workers/scripts`) return world.denied.has('workers') ? no() : ok([
    { id: 'torre-sondas', created_on: iso(now - 50 * 24 * H), modified_on: iso(now - 20 * 24 * H) },
    { id: 'respaldo', created_on: iso(now - 50 * 24 * H), modified_on: iso(now - 20 * 24 * H) },
    { id: 'api-roto', created_on: iso(now - 50 * 24 * H), modified_on: iso(now - 20 * 24 * H) },
    { id: 'tienda', created_on: iso(now - 50 * 24 * H), modified_on: iso(now - 20 * 24 * H) }, // las funciones del proyecto de Pages
  ]);
  if (/\/workers\/scripts\/[^/]+\/schedules$/.test(u)) { const n = u.split('/').slice(-2)[0]; return ok({ schedules: n === 'torre-sondas' ? [{ cron: '*/5 * * * *' }] : n === 'respaldo' ? [{ cron: '0 */6 * * *' }] : [] }); }
  if (u.startsWith('/zones?')) return world.denied.has('zones') ? no() : ok([{ id: 'z1', name: 'tienda.com' }, { id: 'z2', name: 'otra.com' }], { result_info: { total_pages: 1 } });
  if (u === '/graphql') {
    const q = JSON.parse(o.body).query;
    if (q.includes('workersInvocationsAdaptive')) {
      if (world.denied.has('runs')) return { status: 200, json: async () => ({ data: null, errors: [{ message: 'not authorized for that account' }] }) };
      const hour = Math.floor(now / H) * H, rows = [];
      for (const [n, list] of Object.entries(world.runs)) for (const r of list) rows.push({ sum: { requests: r.requests, errors: r.errors }, dimensions: { scriptName: n, datetimeHour: iso(hour - r.h * H) } });
      return { status: 200, json: async () => ({ data: { viewer: { accounts: [{ runs: rows }] } }, errors: null }) };
    }
    if (world.denied.has('traffic')) return { status: 200, json: async () => ({ data: null, errors: [{ message: 'zone does not have access to the path' }] }) };
    if (!q.includes('zoneTag: "z1"')) return { status: 200, json: async () => ({ data: { viewer: { zones: [{ horas: [], dias: [], detalle: [] }] } } }) };
    const hour = Math.floor(now / H) * H;
    return { status: 200, json: async () => ({ data: { viewer: { zones: [{
      horas: [3, 2, 1, 0].map(h => ({ dimensions: { datetime: iso(hour - h * H) }, sum: { requests: 600 * (h + 1), pageViews: 100 }, uniq: { uniques: 20 } })),
      dias: [2, 1, 0].map(d => ({ dimensions: { date: iso(now - d * 24 * H).slice(0, 10) }, sum: { requests: 9000, pageViews: 900 }, uniq: { uniques: 150 + d } })),
      detalle: [{ sum: { countryMap: [{ clientCountryName: 'US', requests: 50 }, { clientCountryName: 'VE', requests: 900 }], responseStatusMap: [{ edgeResponseStatus: 200, requests: 940 }, { edgeResponseStatus: 502, requests: 7 }] } }],
    }] } } }) };
  }
  return { status: 404, json: async () => ({ success: false, errors: [{ message: 'not found' }] }) };
};

const make = () => { const c = new CloudflareConnector({ id: 'empresa', name: 'empresa', token: TOKEN }, bus, { fetch: fake, now: () => now }); c.part = async (n, fn) => { try { await fn(); delete c.warn[n]; } catch (e) { c.warn[n] = e.denied ? 'sin permiso: ' + n : e.message; } c.build(); }; return c; };
const round = async c => { for (const [n, fn] of [['account', () => c.pollAccount()], ['pages', () => c.pollPages()], ['workers', () => c.pollWorkers()], ['runs', () => c.pollRuns()], ['zones', () => c.pollZones()], ['traffic', () => c.pollTraffic()]]) await c.part(n, fn); };

(async () => {
  // cada cuanto corre un reloj
  assert.strictEqual(cronEvery('*/5 * * * *'), 5 * 60000);
  assert.strictEqual(cronEvery('0 */6 * * *'), 6 * H);
  assert.strictEqual(cronEvery('10 4 * * *'), 24 * H);
  assert.strictEqual(cronEvery('30 * * * *'), H);
  assert.strictEqual(cronEvery('0 8 * * 1'), 7 * 24 * H);
  assert.strictEqual(deployState({ latest_stage: { name: 'build', status: 'success' } }), 'BUILDING', 'compilo pero todavia no se publico');
  assert.strictEqual(deployState({ latest_stage: { name: 'deploy', status: 'failure' } }), 'ERROR');

  // el token se prueba antes de guardarlo
  await assert.rejects(verify('corto', null, fake), /no parece un token/);
  await assert.rejects(verify('X'.repeat(40), null, fake), /rechazó el token/);
  assert.deepStrictEqual(await verify(TOKEN, null, fake), { accountId: ACC, accountName: 'GG Innovations', accounts: 1 });

  const C = make();
  await round(C);
  assert.strictEqual(C.account, '_cf-empresa');
  assert.deepStrictEqual(C.apps.map(a => `${a.name}:${a.cfKind}:${a.status}`), ['api-roto:worker:degraded', 'panel:pages:online', 'respaldo:worker:online', 'tienda:pages:online', 'torre-sondas:worker:online'],
    'un edificio por proyecto y por Worker; las funciones de un proyecto de Pages no se repiten');
  const tienda = () => C.apps.find(a => a.name === 'tienda'), app = n => C.apps.find(a => a.name === n);
  assert.deepStrictEqual(tienda().domains, ['tienda.pages.dev', 'pedir.tienda.com']);
  assert.strictEqual(tienda().repo, null, 'el repo de GitLab no se confunde con uno de GitHub'); assert.strictEqual(tienda().repoHost, 'gitlab');
  assert.strictEqual(app('panel').repo, 'GG/Panel');
  assert.strictEqual(tienda().deployments.length, 2); assert.strictEqual(tienda().deployments[0].commit, 'Arregla el carrito');
  assert.strictEqual(evs.length, 0, 'lo que ya estaba al conectar no es noticia');

  // visitas de la zona del dominio propio
  assert.strictEqual(tienda().zone, 'tienda.com');
  assert.deepStrictEqual(tienda().traffic.day, { visitors: 80, pages: 400, requests: 6000, err5xx: 7 });
  assert.strictEqual(tienda().cfReqMin, 20, 'visitas por minuto: la ultima hora completa entre 60');
  assert.deepStrictEqual(tienda().traffic.countries.map(c => c.key), ['VE', 'US']);
  assert.strictEqual(app('panel').traffic, null, 'un proyecto sin dominio propio no tiene zona');
  assert.deepStrictEqual(C.trafficOf().map(t => t.zone), ['tienda.com'], 'una zona sin datos no aparece');

  // despliegue nuevo: construyendo, y despues falla
  world.depId = 'dep-2'; world.stage = { name: 'build', status: 'active' };
  await C.part('pages', () => C.pollPages());
  assert.strictEqual(tienda().status, 'degraded');
  assert.deepStrictEqual(evs.map(e => `${e.kind}:${e.app}:${e.action}:${e.target}`), ['deploy:tienda:building:production']);
  world.stage = { name: 'deploy', status: 'failure' };
  await C.part('pages', () => C.pollPages());
  assert.strictEqual(tienda().status, 'down');
  assert.strictEqual(evs[1].action, 'error'); assert.strictEqual(evs[1].account, '_cf-empresa');
  await C.part('pages', () => C.pollPages());
  assert.strictEqual(evs.length, 2, 'el mismo estado no se repite');
  world.stage = { name: 'deploy', status: 'success' };
  await C.part('pages', () => C.pollPages());
  assert.strictEqual(tienda().status, 'online'); assert.strictEqual(evs[2].action, 'ready');

  // Workers: corridas y errores
  assert.strictEqual(app('torre-sondas').runs, 48); assert.strictEqual(app('torre-sondas').every, 5 * 60000);
  assert.strictEqual(app('api-roto').substate, 'falla más de la mitad de las veces');
  assert.strictEqual(app('respaldo').silent, false, 'corre cada 6 horas y corrio hace 2');

  // el reloj calla: Cloudflare deja de dispararlo, sin ningun error
  evs.length = 0;
  world.runs['torre-sondas'] = [5, 6, 7].map(h => ({ h, requests: 12, errors: 0 }));
  await C.part('runs', () => C.pollRuns());
  assert.strictEqual(app('torre-sondas').status, 'down'); assert.strictEqual(app('torre-sondas').substate, 'sus relojes no corren');
  assert.deepStrictEqual(evs.map(e => `${e.kind}:${e.app}:${e.action}`), ['cron:torre-sondas:silent']);
  await C.part('runs', () => C.pollRuns());
  assert.strictEqual(evs.length, 1, 'se avisa una vez');
  world.runs['torre-sondas'] = [0].map(h => ({ h, requests: 3, errors: 0 }));
  await C.part('runs', () => C.pollRuns());
  assert.deepStrictEqual(evs.map(e => e.action), ['silent', 'back']);
  assert.strictEqual(app('torre-sondas').status, 'online');
  // un Worker recien desplegado con reloj todavia no tiene corridas: no es un reloj callado
  const N = make(); await N.part('account', () => N.pollAccount()); await N.part('workers', () => N.pollWorkers());
  N.workers.get('respaldo').modified = now - H; world.runs.respaldo = [];
  evs.length = 0; await N.part('runs', () => N.pollRuns());
  assert.strictEqual(N.workers.get('respaldo').silent, false);
  // ya estaba callado al conectar: se avisa
  N.workers.get('respaldo').modified = now - 20 * 24 * H; N.workers.get('respaldo').checked = false;
  await N.part('runs', () => N.pollRuns());
  assert.ok(evs.some(e => e.kind === 'cron' && e.app === 'respaldo' && e.action === 'silent'));

  // token con permisos de menos: esa parte se apaga y el resto sigue
  world.denied = new Set(['workers', 'runs', 'traffic']);
  const P = make(); await round(P);
  assert.deepStrictEqual(P.apps.map(a => a.name), ['panel', 'tienda']);
  assert.deepStrictEqual(Object.keys(P.warn).sort(), ['traffic', 'workers']);
  assert.strictEqual(P.apps[1].traffic, null);
  assert.strictEqual(P.info().type, 'cloudflare'); assert.strictEqual(P.info().pages, 2);
  // sin permiso para listar cuentas pero con el ID escrito: funciona
  world.denied = new Set(['accounts']);
  const Q = new CloudflareConnector({ id: 'x', token: TOKEN, accountId: ACC }, bus, { fetch: fake, now: () => now });
  await Q.pollAccount(); await Q.pollPages(); Q.build();
  assert.strictEqual(Q.apps.length, 2);
  await assert.rejects(verify(TOKEN, null, fake), /rechazó el token/);

  // solo lectura: ni una sola llamada que cambie algo (GraphQL es una consulta por POST)
  assert.ok(calls.every(c => c.startsWith('GET ') || c === 'POST /graphql'), 'el conector nunca escribe en Cloudflare');
  console.log('cfconnector.test.js OK');
})().catch(e => { console.error(e); process.exit(1); });
