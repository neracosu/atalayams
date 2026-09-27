'use strict';
// Mapa de proyectos y conector de GitHub (API simulada): union por repo, alias SSH, sugerencias por
// nombre, uniones manuales, revisiones y puntaje.
// Uso: node test/projects.test.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-pr-'));
  // ---------------- remotos git
  const { githubRepo, gitRemoteOf, Projects, norm } = require('../server/projects');
  assert.strictEqual(githubRepo('git@github.com:Ana/Tienda.git'), 'ana/tienda');
  assert.strictEqual(githubRepo('git@github-atalaya:neracosu/atalaya-monitor.git'), 'neracosu/atalaya-monitor', 'alias SSH de deploy key');
  assert.strictEqual(githubRepo('https://x-token:abc@github.com/ana/api'), 'ana/api');
  assert.strictEqual(githubRepo('git@gitlab.com:ana/api.git'), null);
  const w = (p, t) => { fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true }); fs.writeFileSync(path.join(root, p), t); };
  w('home/ana/public_html/.git/config', '[core]\n[remote "origin"]\n\turl = git@github.com:ana/web-principal.git\n');
  w('home/ana/public_html/sub/index.html', 'x');
  w('home/ana/tienda/.git/config', '[remote "origin"]\n\turl = https://github.com/ana/tienda.git\n');
  fs.mkdirSync(path.join(root, 'home/ana/tienda/apps/api'), { recursive: true });
  assert.ok(/tienda/.test(gitRemoteOf(path.join(root, 'home/ana/tienda/apps/api'))), 'sube hasta el repo (monorepo)');
  assert.strictEqual(gitRemoteOf(path.join(root, 'home/ana/public_html/sub'), new Set([path.join(root, 'home/ana/public_html')])), null, 'un subdominio no hereda el repo del principal');
  assert.strictEqual(norm('tienda-db'), 'tienda');

  // ---------------- GitHub simulado
  const repoTree = { tree: [{ type: 'blob', path: 'package.json' }, { type: 'blob', path: '.env' }, { type: 'blob', path: '.env.example' }, { type: 'blob', path: 'src/a.js' },
    { type: 'blob', path: 'node_modules/x/.env' }, { type: 'blob', path: '.github/workflows/ci.yml' }] };
  const api = http.createServer((req, res) => {
    assert.strictEqual(req.headers.authorization, 'Bearer ghp_x');
    const u = new URL(req.url, 'http://x');
    const send = (code, body) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
    if (u.pathname === '/user') return send(200, { login: 'ana' });
    if (u.pathname === '/user/repos') return send(200, u.searchParams.get('page') === '1' ? [
      { full_name: 'ana/tienda', private: true, archived: false, fork: false, pushed_at: new Date().toISOString(), default_branch: 'main', html_url: 'https://github.com/ana/tienda' },
      { full_name: 'ana/viejo', private: false, archived: false, fork: false, pushed_at: '2023-01-01T00:00:00Z', default_branch: 'main' },
      { full_name: 'ana/archivado', private: true, archived: true, fork: false, pushed_at: '2022-01-01T00:00:00Z', default_branch: 'main' },
      { full_name: 'otro/fork', private: false, archived: false, fork: true, pushed_at: '2024-01-01T00:00:00Z', default_branch: 'main' }] : []);
    if (u.pathname === '/repos/ana/tienda/git/trees/main') return send(200, repoTree);
    if (u.pathname === '/repos/ana/tienda/contents/.gitignore') { res.writeHead(200); return res.end('node_modules\n'); }
    if (u.pathname === '/repos/ana/tienda/dependabot/alerts') return send(200, [{ security_advisory: { severity: 'high' } }, { security_advisory: { severity: 'low' } }]);
    send(404, { message: 'Not Found' });
  });
  await new Promise(r => api.listen(0, '127.0.0.1', r));
  process.env.ATALAYA_GITHUB_API = `http://127.0.0.1:${api.address().port}`;
  delete require.cache[require.resolve('../server/connectors/github')];
  const { GithubConnector } = require('../server/connectors/github');
  const gh = new GithubConnector({ id: 'p', token: 'ghp_x' });
  await gh.poll();
  assert.strictEqual(gh.repos.size, 4);
  const au = await gh.audit('ana/tienda');
  assert.deepStrictEqual(au.secrets.map(s => s.path), ['.env'], 'ni .env.example ni node_modules');
  assert.strictEqual(au.envIgnored, false);
  assert.ok(au.ci && au.packageJson && !au.lockfile);
  assert.deepStrictEqual(au.alerts, { total: 2, critical: 0, high: 1 });

  // ---------------- mapa de proyectos
  const cfg = { stateDir: root, projects: {} };
  const apps = [
    { account: 'ana', name: 'tienda-api', source: 'pm2', status: 'online', cwd: path.join(root, 'home/ana/tienda/apps/api') },
    { account: '_vercel-p', name: 'tienda-web', source: 'vercel', status: 'down', repo: 'Ana/Tienda', domains: ['tienda.com', 'tienda.vercel.app'], deployments: [{ created: Date.now() }] },
    { account: '_supa-p', name: 'tienda-db', source: 'supabase', status: 'online', ref: 'abc' },
    { account: '_supa-p', name: 'otra-cosa', source: 'supabase', status: 'online', ref: 'def' },
  ];
  const groups = new Map([['ana:pub', { id: 'ana:pub', account: 'ana', docroot: path.join(root, 'home/ana/public_html'), domain: 'ana.com', domainList: ['ana.com'], type: 'wordpress', lastSeen: Date.now() }]]);
  const ctx = { host: { apps }, logs: { groups, sites: [...groups.values()] }, connectors: { ofType: t => t === 'github' ? [gh] : [] } };
  const P = new Projects(cfg, ctx);
  let list = P.build();
  const tienda = list.find(p => p.repo === 'ana/tienda');
  assert.deepStrictEqual(tienda.parts.map(p => p.kind).sort(), ['app', 'supabase', 'vercel'], 'app del VPS + Vercel + base sugerida por nombre en un solo proyecto');
  assert.deepStrictEqual(tienda.suggested, ['supa:abc']);
  assert.ok(tienda.checks.some(c => c.id === 'deploy' && c.level === 'bad'), 'despliegue fallido');
  assert.ok(!list.some(p => p.repo === 'ana/archivado'), 'repos archivados sin despliegue no aparecen');
  assert.ok(!list.some(p => p.repo === 'otro/fork'), 'forks tampoco');
  assert.ok(list.some(p => p.name === 'otra-cosa'), 'base sin pareja: proyecto propio');
  const wp = list.find(p => p.name === 'ana.com');
  assert.strictEqual(wp.repo, 'ana/web-principal');
  // revision a pedido (sin red: se simulan las sondas)
  const webm = require('../server/audits/web');
  webm.certOf = async () => ({ ok: true, expires: Date.now() + 5 * 86400000, issuer: 'Let\'s Encrypt' });
  webm.httpCheck = async () => ({ status: 200, ms: 4500 });
  webm.domainExpiry = async () => ({ expires: Date.now() + 10 * 86400000, registrar: 'X' });
  await P.analyze(tienda.id);
  const t2 = P.build().find(p => p.id === tienda.id);
  const lv = id => t2.checks.find(c => c.id === id).level;
  assert.strictEqual(lv('secrets'), 'bad');
  assert.strictEqual(lv('gitignore'), 'warn');
  assert.strictEqual(lv('deps'), 'bad');
  assert.strictEqual(lv('ssl'), 'warn');
  assert.strictEqual(lv('uptime'), 'warn');
  assert.strictEqual(lv('domain'), 'warn');
  assert.strictEqual(lv('lockfile'), 'info');
  assert.ok(t2.score < 60, 'puntaje bajo con tantos problemas: ' + t2.score);
  assert.ok(!Object.keys(t2.audit.domains).some(d => /vercel\.app/.test(d)), 'no se consulta RDAP de dominios de plataforma');
  // repo viejo y publico sin despliegue
  const viejo = P.build().find(p => p.repo === 'ana/viejo');
  assert.ok(viejo.checks.some(c => c.id === 'stale') && viejo.checks.some(c => c.id === 'public'));
  // uniones manuales y separar sugerencias
  cfg.projects = { merges: [['site:ana:pub', 'repo:ana/viejo']], splits: ['supa:abc'] };
  P.invalidate(); list = P.build();
  const merged = list.find(p => p.parts.some(x => x.key === 'site:ana:pub'));
  assert.ok(merged && !list.some(p => p !== merged && p.parts.some(x => x.key === 'repo:ana/viejo')), 'union manual');
  assert.ok(list.find(p => p.repo === 'ana/tienda').parts.every(p => p.kind !== 'supabase'), 'separada la base sugerida');
  api.close();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('ok   proyectos: unión por repo y alias SSH, sugerencias, GitHub, revisiones y puntaje');
})().catch(e => { console.error(e); process.exit(1); });
