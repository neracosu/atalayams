'use strict';
// Conector de Cloudflare (con la API simulada): proyectos de Pages y sus despliegues, Workers con sus corridas,
// el reloj que deja de correr sin dar error, las visitas de cada zona y un token al que le faltan permisos.
// Uso: node test/cfconnector.test.js
const assert = require('assert');
const { CloudflareConnector, cronEvery, deployState, verify } = require('../server/connectors/cloudflare');

const TOKEN = 'T'.repeat(40), TOKEN2 = 'V'.repeat(40), ACC = 'a'.repeat(32), H = 3600000;
let now = Date.parse('2026-09-28T12:30:00Z');
const iso = t => new Date(t).toISOString();
const evs = [], bus = { emit: (_, e) => evs.push(e), on() { } };

// el mundo simulado
const world = {
  denied: new Set(), // partes sin permiso
  denied2: new Set(['accounts', 'pages', 'workers', 'runs']), // el segundo token de la misma cuenta: solo zonas y visitas
  live: [], // pedidos por minuto y por dominio: { m: minutos atras, host, status, cc, count }
  stage: { name: 'deploy', status: 'success' },
  depId: 'dep-1',
  runs: { 'torre-sondas': [0, 1, 2, 3].map(h => ({ h, requests: 12, errors: 0 })), 'respaldo': [{ h: 2, requests: 1, errors: 0 }], 'api-roto': [{ h: 1, requests: 40, errors: 30 }] },
};
const dep = (id, stage, env = 'production', msg = 'Arregla el carrito') => ({ id, url: `https://${id}.tienda.pages.dev`, environment: env, created_on: iso(now - 120000), modified_on: iso(now - 60000), latest_stage: stage,
  deployment_trigger: { type: 'ad_hoc', metadata: { branch: 'main', commit_message: msg } } });
const calls = [];
const used = [];
const fake = async (url, o = {}) => {
  const u = url.replace('https://api.cloudflare.com/client/v4', '');
  calls.push(`${o.method} ${u.split('?')[0]}`);
  const ok = (result, extra = {}) => ({ status: 200, json: async () => ({ success: true, result, ...extra }) });
  const no = () => ({ status: 403, json: async () => ({ success: false, errors: [{ code: 10000, message: 'Authentication error' }] }) });
  const tok = String((o.headers || {}).Authorization || '').replace('Bearer ', '');
  if (tok === 'G'.repeat(37)) return { status: 400, json: async () => ({ success: false, errors: [{ code: 6003, message: 'Invalid request headers' }] }) };
  if (tok !== TOKEN && tok !== TOKEN2) return no();
  const denied = tok === TOKEN2 ? world.denied2 : world.denied;
  used.push(tok === TOKEN2 ? 2 : 1);
  if (u.startsWith('/accounts?')) return denied.has('accounts') ? no() : ok([{ id: ACC, name: 'Tienda Ejemplo' }]);
  if (u.startsWith(`/accounts/${ACC}/pages/projects?`)) return denied.has('pages') ? no() : ok([
    { id: 'p1', name: 'tienda', subdomain: 'tienda.pages.dev', domains: ['tienda.pages.dev', 'pedir.tienda.com'], source: { type: 'gitlab', config: { owner: 'gg', repo_name: 'tienda' } }, latest_deployment: dep(world.depId, world.stage) },
    { id: 'p2', name: 'panel', subdomain: 'panel.pages.dev', domains: ['panel.pages.dev'], source: { type: 'github', config: { owner: 'GG', repo_name: 'Panel' } }, latest_deployment: null },
  ], { result_info: { total_pages: 1 } });
  if (u.startsWith(`/accounts/${ACC}/pages/projects/tienda/deployments`)) return ok([dep(world.depId, world.stage), dep('dep-0', { name: 'deploy', status: 'success' }, 'preview', 'Prueba')]);
  if (u === `/accounts/${ACC}/workers/scripts`) return denied.has('workers') ? no() : ok([
    { id: 'torre-sondas', created_on: iso(now - 50 * 24 * H), modified_on: iso(now - 20 * 24 * H) },
    { id: 'respaldo', created_on: iso(now - 50 * 24 * H), modified_on: iso(now - 20 * 24 * H) },
    { id: 'api-roto', created_on: iso(now - 50 * 24 * H), modified_on: iso(now - 20 * 24 * H) },
    { id: 'tienda', created_on: iso(now - 50 * 24 * H), modified_on: iso(now - 20 * 24 * H) }, // las funciones del proyecto de Pages
  ]);
  if (/\/workers\/scripts\/[^/]+\/schedules$/.test(u)) { const n = u.split('/').slice(-2)[0]; return ok({ schedules: n === 'torre-sondas' ? [{ cron: '*/5 * * * *' }] : n === 'respaldo' ? [{ cron: '0 */6 * * *' }] : [] }); }
  if (u === `/accounts/${ACC}/workers/domains`) return denied.has('workers') ? no() : ok([{ hostname: 'api.tienda.com', service: 'api-roto' }]);
  if (u === '/zones/z1/workers/routes') return denied.has('workers') ? no() : ok([{ pattern: '*.tienda.com/*', script: 'torre-sondas' }]);
  if (u.startsWith('/zones?')) return denied.has('zones') ? no() : ok([{ id: 'z1', name: 'tienda.com' }, { id: 'z2', name: 'otra.com' }], { result_info: { total_pages: 1 } });
  if (u === '/graphql') {
    const q = JSON.parse(o.body).query;
    if (q.includes('workersInvocationsAdaptive')) {
      if (denied.has('runs')) return { status: 200, json: async () => ({ data: null, errors: [{ message: 'not authorized for that account' }] }) };
      const hour = Math.floor(now / H) * H, rows = [];
      for (const [n, list] of Object.entries(world.runs)) for (const r of list) rows.push({ sum: { requests: r.requests, errors: r.errors }, dimensions: { scriptName: n, datetimeHour: iso(hour - r.h * H) } });
      return { status: 200, json: async () => ({ data: { viewer: { accounts: [{ runs: rows }] } }, errors: null }) };
    }
    if (q.includes('errores: httpRequestsAdaptiveGroups')) {
      if (denied.has('traffic') || world.sinDetalle) return { status: 200, json: async () => ({ data: null, errors: [{ message: 'not authorized' }] }) };
      const from = Date.parse(/datetime_geq: "([^"]+)"/.exec(q)[1]), to = Date.parse(/datetime_lt: "([^"]+)"/.exec(q)[1]), top = Math.floor((now - 90000) / 60000) * 60000;
      const rows = !q.includes('zoneTag: "z1"') ? [] : world.live.filter(r => r.status >= 500).map(r => ({ t: top - r.m * 60000, r })).filter(x => x.t >= from && x.t < to)
        .map(({ t, r }) => ({ count: r.count, dimensions: { datetimeMinute: iso(t), clientRequestHTTPHost: r.host, clientRequestPath: r.path || '/api/pagar', clientRequestHTTPMethodName: 'POST', edgeResponseStatus: r.status, originResponseStatus: r.origin || 0 } }));
      return { status: 200, json: async () => ({ data: { viewer: { zones: [{ errores: rows }] } }, errors: null }) };
    }
    if (q.includes('httpRequestsAdaptiveGroups')) {
      if (denied.has('traffic')) return { status: 200, json: async () => ({ data: null, errors: [{ message: 'not authorized' }] }) };
      const from = Date.parse(/datetime_geq: "([^"]+)"/.exec(q)[1]), to = Date.parse(/datetime_lt: "([^"]+)"/.exec(q)[1]), top = Math.floor((now - 90000) / 60000) * 60000;
      const rows = !q.includes('zoneTag: "z1"') ? [] : world.live.map(r => ({ t: top - r.m * 60000, r })).filter(x => x.t >= from && x.t < to)
        .map(({ t, r }) => ({ count: r.count, dimensions: { datetimeMinute: iso(t), clientRequestHTTPHost: r.host, edgeResponseStatus: r.status || 200, clientCountryName: r.cc || 'VE' } }));
      return { status: 200, json: async () => ({ data: { viewer: { zones: [{ vivo: rows }] } }, errors: null }) };
    }
    if (denied.has('traffic')) return { status: 200, json: async () => ({ data: null, errors: [{ message: 'zone does not have access to the path' }] }) };
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
  assert.deepStrictEqual(await verify(TOKEN, null, fake), { accountId: ACC, accountName: 'Tienda Ejemplo', accounts: 1 });

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

  // visitas en vivo: los pedidos de cada dominio en el ultimo minuto cerrado se reparten sobre su edificio
  world.denied = new Set();
  world.live = [{ m: 0, host: 'pedir.tienda.com', count: 6, cc: 'VE' }, { m: 0, host: 'pedir.tienda.com', count: 2, status: 502, cc: 'US' }, { m: 0, host: 'api.tienda.com', count: 3 },
    { m: 0, host: 'sondas.tienda.com', count: 1 }, { m: 0, host: 'tienda.com', count: 4 }, { m: 5, host: 'pedir.tienda.com', count: 900 }];
  const liveOf = async (conn, more = {}) => {
    const out = [], c = new CloudflareConnector({ id: 'empresa', name: 'empresa', token: TOKEN, ...conn }, { emit: (_, e) => { if (e.kind === 'http') out.push(e); } }, { fetch: fake, now: () => now, defer: fn => fn(), ...more });
    c.part = async (n, fn) => { try { await fn(); delete c.warn[n]; } catch (e) { c.warn[n] = e.denied ? 'sin permiso: ' + n : e.message; if (n === 'live') c.liveOk = false; } c.build(); };
    await round(c); await c.pollHosts(); await c.part('live', () => c.pollLive());
    return { c, out };
  };
  const L = await liveOf({});
  assert.ok(L.out.every(e => e.kind === 'http' && e.via === 'cloudflare' && e.live && e.account === '_cf-empresa' && e.ip === null), 'son visitas que se dibujan y se cuentan, sin IP y fuera de la analítica');
  const perApp = list => list.reduce((m, e) => (m[e.app || '-'] = (m[e.app || '-'] || 0) + e.n, m), {});
  assert.deepStrictEqual(perApp(L.out), { tienda: 8, 'api-roto': 3, 'torre-sondas': 1, '-': 4 }, 'cada dominio va a su proyecto de Pages, al Worker de ese dominio o al de la ruta; el que no es de nadie no se dibuja');
  assert.strictEqual(L.out.length, 15, 'con poco tráfico, una visita dibujada por cada pedido; los dos errores van juntos en un aviso; el minuto viejo no entra');
  // el error dice donde fue: la ruta, el metodo, el codigo y si el origen llego a responder
  const bad = L.out.filter(e => e.status >= 500);
  assert.deepStrictEqual(bad.map(e => [e.app, e.domain, e.method, e.path, e.status, e.origin, e.n]), [['tienda', 'pedir.tienda.com', 'POST', '/api/pagar', 502, 0, 2]]);
  assert.deepStrictEqual(L.c.apps.find(a => a.name === 'tienda').errors.codes, [{ status: 502, origin: 0, n: 2 }]);
  assert.strictEqual(L.c.apps.find(a => a.name === 'tienda').errors.list[0].path, '/api/pagar');
  assert.strictEqual(L.c.apps.find(a => a.name === 'panel').errors, null, 'un proyecto sin errores no muestra la sección');
  assert.strictEqual(L.c.apps.find(a => a.name === 'tienda').cfReqMin, 8, 'las visitas por minuto son las de ese proyecto, no las de toda la zona');
  assert.strictEqual(L.c.apps.find(a => a.name === 'panel').cfReqMin, 0);
  assert.strictEqual(L.c.info().live, true);
  // el mismo minuto no se reparte dos veces
  L.out.length = 0; await L.c.part('live', () => L.c.pollLive());
  assert.strictEqual(L.out.length, 0);
  // pasa un minuto: llega el siguiente
  now += 60000; world.live = [{ m: 0, host: 'pedir.tienda.com', count: 5 }];
  await L.c.part('live', () => L.c.pollLive());
  assert.deepStrictEqual(perApp(L.out), { tienda: 5 });
  // mucho tráfico: se dibujan pocas y cada una vale por varias, sin perder la cuenta
  now += 60000; world.live = [{ m: 0, host: 'pedir.tienda.com', count: 4000, cc: 'VE' }, { m: 0, host: 'pedir.tienda.com', count: 400, status: 503, cc: 'CO' }, { m: 0, host: 'api.tienda.com', count: 100 }];
  L.out.length = 0; await L.c.part('live', () => L.c.pollLive());
  assert.ok(L.out.length <= 48, 'a lo sumo unas 45 visitas dibujadas por zona y minuto: ' + L.out.length);
  assert.deepStrictEqual(perApp(L.out), { tienda: 4400, 'api-roto': 100 });
  assert.deepStrictEqual(L.out.filter(e => e.status === 503).map(e => e.n), [400], 'los errores de una misma ruta, en un solo aviso con su cuenta');
  assert.deepStrictEqual(L.c.apps.find(a => a.name === 'tienda').errors.codes, [{ status: 503, origin: 0, n: 400 }, { status: 502, origin: 0, n: 2 }], 'se acumulan, lo más frecuente primero');
  assert.strictEqual(L.c.apps.find(a => a.name === 'tienda').errors.total, 402);
  // el mismo minuto leído dos veces no cuenta doble
  assert.strictEqual(await L.c.pollErrors({ id: 'z1' }, now - 10 * 60000, now, false), 0);
  // al conectar se leen las últimas horas para que la ficha tenga qué mostrar, sin avisar de cada error viejo
  world.live = [{ m: 0, host: 'pedir.tienda.com', count: 3 }, { m: 90, host: 'pedir.tienda.com', count: 5, status: 504, path: '/api/pedidos' }];
  const B = await liveOf({});
  assert.strictEqual(B.out.filter(e => e.status >= 500).length, 0); assert.strictEqual(B.c.apps.find(a => a.name === 'tienda').errors.total, 5);
  assert.strictEqual(B.c.apps.find(a => a.name === 'tienda').errors.hour, 0, 'fue hace hora y media: no es de ahora');
  // si Cloudflare no entrega el detalle, el error igual se ve, como una visita en rojo
  world.sinDetalle = true; world.live = [{ m: 0, host: 'pedir.tienda.com', count: 2, status: 500 }];
  const D = await liveOf({});
  assert.deepStrictEqual(D.out.map(e => [e.status, e.path]), [[500, ''], [500, '']]); world.sinDetalle = false;
  world.live = [{ m: 0, host: 'pedir.tienda.com', count: 4000, cc: 'VE' }, { m: 0, host: 'pedir.tienda.com', count: 400, status: 503, cc: 'CO' }, { m: 0, host: 'api.tienda.com', count: 100 }];
  // sin el permiso de visitas no hay movimiento y queda un solo aviso
  world.denied = new Set(['traffic']);
  const S = await liveOf({});
  assert.strictEqual(S.out.length, 0); assert.strictEqual(S.c.info().live, false);
  assert.strictEqual(S.c.apps.find(a => a.name === 'tienda').cfReqMin, 0);

  // la misma cuenta con dos tokens: el primero lee los proyectos y el segundo, las visitas. Un solo distrito
  now += 60000; world.live = [{ m: 0, host: 'pedir.tienda.com', count: 7 }];
  const M = await liveOf({ more: [TOKEN2], merged: ['trafico'] });
  assert.deepStrictEqual(M.c.apps.map(a => a.name), ['api-roto', 'panel', 'respaldo', 'tienda', 'torre-sondas']);
  assert.deepStrictEqual(perApp(M.out), { tienda: 7 }, 'las visitas llegan con el segundo token');
  assert.deepStrictEqual(M.c.warn, {}, 'entre los dos tokens no falta ningún permiso');
  assert.strictEqual(M.c.apps.find(a => a.name === 'tienda').traffic.day.visitors, 80);
  assert.deepStrictEqual(M.c.info().merged, ['trafico']);
  used.length = 0; now += 60000; await M.c.part('live', () => M.c.pollLive());
  assert.deepStrictEqual(used, [2, 2], 'ya sabe qué token sirve para las visitas de cada zona: no vuelve a probar el otro');
  world.denied = new Set();

  // las cuentas repetidas se juntan al cargar, sin tocar lo guardado: manda la que se conectó primero
  const { Connectors } = require('../server/connectors');
  const saved = [{ id: 'trafico', type: 'cloudflare', name: 'Tráfico', token: TOKEN2, accountId: ACC, added: '2026-09-28T03:36:00Z' }, { id: 'tienda', type: 'cloudflare', name: 'Tienda', token: TOKEN, accountId: ACC, added: '2026-09-27T22:23:00Z' },
    { id: 'otra', type: 'cloudflare', name: 'Otra', token: TOKEN, accountId: 'b'.repeat(32), added: '2026-09-28T01:00:00Z' }, { id: 'gh', type: 'github', name: 'gh', token: 'x' }];
  const K = new Connectors({}, bus, { connectors: () => saved, sync() { } });
  const W = K.wanted ? (K.mergedInto = new Map(), K.wanted()) : null;
  assert.deepStrictEqual([...W.keys()].sort(), ['gh', 'tienda', 'otra']);
  assert.deepStrictEqual(W.get('tienda').more, [TOKEN2]); assert.deepStrictEqual(W.get('tienda').merged, ['Tráfico']);
  assert.deepStrictEqual(W.get('otra').more, []);
  assert.strictEqual(saved[1].more, undefined, 'lo guardado no se toca');
  assert.deepStrictEqual(K.sameAccount('cloudflare', ACC, 'nuevo'), { id: 'trafico', name: 'Tráfico' });
  assert.strictEqual(K.sameAccount('cloudflare', ACC.replace('a', 'c'), 'nuevo'), null);

  // en público, varias cuentas del mismo servicio se numeran por orden de conexión; una sola no lleva número
  process.env.ATALAYA_CF_API = 'http://127.0.0.1:9'; // los conectores arrancan de verdad: que no salgan a la red
  const V = new Connectors({}, bus, { connectors: () => saved.filter(c => c.type === 'cloudflare'), sync() { } });
  V.reconcile();
  assert.deepStrictEqual(V.virtual().map(v => `${v.id}=${v.publicLabel}`), ['_cf-tienda=Cloudflare 1', '_cf-otra=Cloudflare 2']);
  assert.deepStrictEqual(V.virtual().map(v => v.label), ['Cloudflare · Tienda', 'Cloudflare · Otra'], 'en privado, el nombre que la persona le puso');
  for (const x of V.list.values()) x.inst.stop();
  V.list.delete('otra');
  assert.deepStrictEqual(V.virtual().map(v => v.publicLabel), ['Cloudflare']);

  // lo que no es un token de API (la Global API Key, por ejemplo) se explica en palabras
  await assert.rejects(verify('G'.repeat(37), null, fake), /no reconoció eso como un token de API/);

  // solo lectura: ni una sola llamada que cambie algo (GraphQL es una consulta por POST)
  assert.ok(calls.every(c => c.startsWith('GET ') || c === 'POST /graphql'), 'el conector nunca escribe en Cloudflare');
  console.log('cfconnector.test.js OK');
})().catch(e => { console.error(e); process.exit(1); });
