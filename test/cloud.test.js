'use strict';
// Conectores de nube con APIs simuladas: Vercel (proyectos, despliegues, Drains firmados), Supabase
// (Metrics API y estado de gestion) y Claude Code remoto (hooks por HTTPS). Uso: node test/cloud.test.js
const assert = require('assert');
const http = require('http');
const crypto = require('crypto');
const os = require('os');
const fs = require('fs');
const path = require('path');

const listen = handler => new Promise(r => { const s = http.createServer(handler).listen(0, '127.0.0.1', () => r(s)); });
const bus = () => { const ev = []; return { ev, emit: (_, e) => ev.push(e), on() {} }; };

(async () => {
  // ---------------- Vercel
  let depState = 'BUILDING';
  const vapi = await listen((req, res) => {
    assert.strictEqual(req.headers.authorization, 'Bearer tok-123');
    const u = new URL(req.url, 'http://x');
    assert.strictEqual(u.searchParams.get('teamId'), 'team_abc');
    if (u.pathname === '/v9/projects') return res.end(JSON.stringify({ projects: [{ id: 'prj_1', name: 'tienda-web', framework: 'nextjs' }] }));
    if (u.pathname === '/v6/deployments') return res.end(JSON.stringify({ deployments: [
      { uid: 'dpl_2', name: 'tienda-web', projectId: 'prj_1', url: 'tienda-web-x.vercel.app', state: depState, target: 'production', created: Date.now() - 1000, meta: { githubCommitMessage: 'Arregla el carrito', githubCommitRef: 'main' }, creator: { username: 'ana' } },
      { uid: 'dpl_1', name: 'tienda-web', projectId: 'prj_1', url: 'tienda-web-y.vercel.app', state: 'READY', target: 'production', created: Date.now() - 86400000, ready: Date.now() - 86000000 },
    ] }));
    if (u.pathname === '/v9/projects/prj_1/domains') return res.end(JSON.stringify({ domains: [{ name: 'tienda.com' }, { name: 'www.tienda.com' }] }));
    res.statusCode = 404; res.end('{}');
  });
  process.env.ATALAYA_VERCEL_API = `http://127.0.0.1:${vapi.address().port}`;
  delete require.cache[require.resolve('../server/connectors/vercel')];
  const { VercelConnector } = require('../server/connectors/vercel');
  const vb = bus();
  const geo = { country: ip => ip === '186.24.0.1' ? { cc: 'VE', name: 'Venezuela' } : null };
  const V = new VercelConnector({ id: 'personal', token: 'tok-123', teamId: 'team_abc', drainSecret: 's3cret' }, vb, geo);
  await V.pollProjects(); await V.pollDeployments(); await V.pollDomains(); V.lastOk = Date.now(); V.build();
  let app = V.apps[0];
  assert.strictEqual(app.name, 'tienda-web'); assert.strictEqual(app.account, '_vercel-personal');
  assert.strictEqual(app.status, 'degraded', 'desplegando'); assert.deepStrictEqual(app.domains, ['tienda.com', 'www.tienda.com']);
  depState = 'READY'; await V.pollDeployments(); V.build();
  assert.strictEqual(V.apps[0].status, 'online');
  assert.ok(vb.ev.some(e => e.kind === 'deploy' && e.action === 'ready' && e.target === 'production' && e.commit === 'Arregla el carrito'), 'BUILDING -> READY emite desplegado');
  depState = 'ERROR'; await V.pollDeployments(); V.build();
  assert.strictEqual(V.apps[0].status, 'down');
  assert.ok(vb.ev.some(e => e.kind === 'deploy' && e.action === 'error'));
  // Drain: NDJSON firmado, dos lineas del mismo request (se cuenta una), una linea de build (se ignora)
  const line = (id, extra = {}) => JSON.stringify({ id, deploymentId: 'dpl_2', source: 'lambda', host: 'tienda.com', timestamp: Date.now(), projectId: 'prj_1', level: 'info', requestId: 'req-1',
    proxy: { timestamp: Date.now(), method: 'GET', host: 'tienda.com', path: '/carrito?x=1', userAgent: ['Mozilla/5.0 (iPhone) Mobile Safari'], region: 'gru1', statusCode: 200, clientIp: '186.24.0.1', referer: 'https://www.google.com/', vercelCache: 'MISS' }, ...extra });
  const body = Buffer.from([line('a'), line('b'), JSON.stringify({ id: 'c', source: 'build', projectId: 'prj_1', message: 'Build ok', level: 'info', deploymentId: 'dpl_2', host: 'x', timestamp: 1 })].join('\n'));
  const sig = crypto.createHmac('sha1', 's3cret').update(body).digest('hex');
  assert.strictEqual(V.drain(body, { 'x-vercel-signature': 'mal' }).status, 403, 'firma equivocada: rechazada');
  const before = vb.ev.length;
  const r = V.drain(body, { 'x-vercel-signature': sig });
  assert.strictEqual(r.status, 200); assert.strictEqual(r.n, 1, 'mismo requestId: una sola visita');
  const visit = vb.ev.slice(before).find(e => e.kind === 'http');
  assert.strictEqual(visit.app, 'tienda-web'); assert.strictEqual(visit.cc, 'VE'); assert.strictEqual(visit.refHost, 'google.com'); assert.ok(visit.ua.mobile);
  const arr = Buffer.from(JSON.stringify([JSON.parse(line('d', { requestId: 'req-2' }))]));
  assert.strictEqual(V.drain(arr, { 'x-vercel-signature': crypto.createHmac('sha1', 's3cret').update(arr).digest('hex') }).n, 1, 'formato JSON (arreglo) tambien');
  V.stop(); vapi.close();
  console.log('ok   vercel: proyectos, dominios, despliegues (construyendo, listo, fallo) y Drains firmados');

  // ---------------- Supabase
  let cpu = { idle: 1000, user: 100 }, restarts = 0, status = 'ACTIVE_HEALTHY';
  const sapi = await listen((req, res) => {
    if (req.url === '/v1/projects') { assert.strictEqual(req.headers.authorization, 'Bearer mgmt'); return res.end(JSON.stringify([{ id: 'abcref', name: 'tienda-db', region: 'us-east-1', status }])); }
    // con el token de gestion tambien se lee por donde envia correo el proyecto
    if (/^\/v1\/projects\/[a-z0-9]+\/config\/auth$/.test(req.url)) { assert.strictEqual(req.headers.authorization, 'Bearer mgmt'); return res.end(JSON.stringify({ smtp_host: 'smtp.resend.com', smtp_pass: 'NO', smtp_admin_email: 'a@tienda.com', rate_limit_email_sent: 50 })); }
    assert.strictEqual(req.headers.authorization, 'Basic ' + Buffer.from('service_role:sb_secret_x').toString('base64'));
    res.end(`# HELP node_cpu_seconds_total x
node_cpu_seconds_total{cpu="0",mode="idle",service_type="db"} ${cpu.idle}
node_cpu_seconds_total{cpu="0",mode="user",service_type="db"} ${cpu.user}
node_memory_MemTotal_bytes 2147483648
node_memory_MemAvailable_bytes 1073741824
node_filesystem_size_bytes{device="nvme",fstype="ext4",mountpoint="/"} 10737418240
node_filesystem_avail_bytes{device="nvme",fstype="ext4",mountpoint="/"} 8589934592
postgresql_restarts_total{service_type="db"} ${restarts}
supavisor_connections_active{mode="transaction",db_name="postgres"} 7
supavisor_connections_active{mode="session",db_name="postgres"} 2
`);
  });
  process.env.ATALAYA_SUPABASE_HOST = `http://127.0.0.1:${sapi.address().port}`;
  process.env.ATALAYA_SUPABASE_API = process.env.ATALAYA_SUPABASE_HOST;
  delete require.cache[require.resolve('../server/connectors/supabase')];
  const { SupabaseConnector, parseProm } = require('../server/connectors/supabase');
  assert.strictEqual(parseProm('a{b="c,d"} 2\n# x\nz 3').length, 2);
  const sb = bus();
  const S = new SupabaseConnector({ id: 'prod', projects: [{ ref: 'abcref', name: 'tienda-db', serviceKey: 'sb_secret_x' }], mgmtToken: 'mgmt' }, sb);
  await S.poll(); S.build();
  cpu = { idle: 1060, user: 140 }; restarts = 1;
  await S.poll(); S.build();
  let db = S.apps[0];
  assert.strictEqual(db.name, 'tienda-db'); assert.strictEqual(db.status, 'online');
  assert.strictEqual(db.cpu, 40, '40 s de usuario sobre 100 s totales'); assert.strictEqual(db.mem, 1073741824);
  assert.strictEqual(Math.round(db.disk.pct), 20); assert.strictEqual(db.pooler, 9); assert.strictEqual(db.region, 'us-east-1');
  assert.ok(sb.ev.some(e => e.action === 'restart'), 'reinicio de Postgres');
  status = 'INACTIVE'; await S.poll(); S.build();
  assert.strictEqual(S.apps[0].status, 'down'); assert.strictEqual(S.apps[0].substate, 'pausado');
  sapi.close();
  console.log('ok   supabase: CPU, memoria, disco, pooler, reinicios y proyecto pausado');

  // ---------------- Claude Code remoto
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-cloud-'));
  const { Secrets } = require('../server/secrets');
  const sec = new Secrets({ stateDir: tmp });
  const token = sec.addRemote('laptop-ana');
  assert.strictEqual(sec.checkRemote('laptop-ana:' + token), 'laptop-ana');
  assert.strictEqual(sec.checkRemote('laptop-ana:' + token.slice(0, -1) + 'x'), null);
  assert.strictEqual(sec.checkRemote('otra:' + token), null);
  const { ClaudeCollector } = require('../server/collectors/claude');
  const cb = bus();
  const C = new ClaudeCollector({ stateDir: tmp, claude: { idleMinutes: 8, goneMinutes: 45, subagentGoneSeconds: 150 } }, cb, { accountsHome: [], uidOf: () => 1000, nowTicks: () => 0, claudeProcs: {} });
  const sid = '11111111-2222-4333-8444-555555555555';
  const H = (name, extra = {}) => C.onRemoteHook({ hook_event_name: name, session_id: sid, cwd: '/Users/ana/tienda', ...extra }, 'laptop-ana');
  H('SessionStart', { source: 'startup' });
  H('UserPromptSubmit', { prompt: 'agrega el boton de pagar' });
  H('PreToolUse', { tool_name: 'Edit', tool_input: { file_path: '/Users/ana/tienda/app/page.tsx' }, tool_use_id: 't1' });
  let s = C.list()[0];
  assert.strictEqual(s.account, '_dev-laptop-ana'); assert.strictEqual(s.state, 'working'); assert.strictEqual(s.station, 'workshop'); assert.strictEqual(s.detail, 'app/page.tsx'); assert.ok(s.remote);
  H('PermissionRequest', { tool_name: 'Bash', tool_input: { command: 'npm run deploy' }, tool_use_id: 't2' });
  assert.strictEqual(C.list()[0].state, 'waiting');
  H('PostToolUse', { tool_name: 'Bash', tool_use_id: 't2' });
  H('Stop'); assert.strictEqual(C.list()[0].state, 'idle');
  // termino y la sesion quedo abierta: en una laptop eso no es un pendiente
  const quiet = cb.ev.length;
  H('Notification', { notification_type: 'idle_prompt', message: 'Claude is waiting for your input' });
  assert.strictEqual(C.list()[0].state, 'idle'); assert.ok(!C.list()[0].waitKind); assert.strictEqual(cb.ev.length, quiet, 'ni aviso ni globo');
  // una pregunta si frena a Claude: esa se avisa
  H('Notification', { notification_type: 'elicitation_dialog', message: 'pregunta' });
  assert.strictEqual(C.list()[0].state, 'waiting'); assert.strictEqual(C.list()[0].waitKind, 'question');
  H('UserPromptSubmit', {}); H('Stop'); assert.strictEqual(C.list()[0].state, 'idle');
  H('SessionEnd', { reason: 'other' }); assert.strictEqual(C.list().length, 0);
  H('PostToolUse', { tool_name: 'Read', tool_use_id: 't9' }); assert.strictEqual(C.list().length, 0, 'hook atrasado no resucita');
  assert.ok(cb.ev.some(e => e.action === 'prompt' && e.text === 'agrega el boton de pagar'));
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('ok   claude remoto: token por equipo, herramientas, permisos, fin de sesion');
  process.exit(0);
})().catch(e => { console.log('FALLA nube: ' + e.message); console.log(e.stack.split('\n').slice(1, 3).join('\n')); process.exit(1); });
