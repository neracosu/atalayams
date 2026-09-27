'use strict';
// Pruebas de deteccion de plataforma contra servidores simulados (test/fixtures/<plataforma>).
// Uso: node test/platforms.test.js
const { execFileSync } = require('child_process');
const path = require('path');
const assert = require('assert');

const ROOT = path.resolve(__dirname, '..');
// corre la deteccion en un proceso aparte con la raiz simulada (fsx la lee al cargar)
function probe(fixture) {
  const code = `
    const platform = require('./server/platform');
    const { LogsCollector } = require('./server/collectors/logs');
    const cfg = { stateDir: '/tmp/atalaya-test', logs: {}, accounts: {} };
    const det = platform.detect(cfg);
    const L = new LogsCollector(cfg, { emit() {} }, { apps: [] });
    L.platform = det; L.loadDomains();
    console.log(JSON.stringify({
      summary: platform.summary(cfg),
      accounts: det.panel ? det.panel.accounts() : [],
      groups: [...L.groups.values()].map(g => ({ account: g.account, domain: g.domain, domains: g.domainList, type: g.type, wp: g.wpVersion || '', port: g.proxyPort || null })),
      logs: [...L.logMap.entries()],
    }));`;
  return JSON.parse(execFileSync(process.execPath, ['-e', code], { cwd: ROOT, env: { ...process.env, ATALAYA_FSROOT: path.join(__dirname, 'fixtures', fixture) }, encoding: 'utf8' }));
}
const find = (r, d) => r.groups.find(g => g.domains.includes(d));

const tests = {
  plesk(r) {
    assert.strictEqual(r.summary.panelId, 'plesk');
    assert.deepStrictEqual(r.accounts.map(a => a.id).sort(), ['blogger', 'tiendauser']);
    assert.strictEqual(r.accounts.find(a => a.id === 'tiendauser').main, 'tienda.com');
    assert.strictEqual(find(r, 'tienda.com').type, 'wordpress');
    assert.strictEqual(find(r, 'tienda.com').wp, '6.9.1');
    assert.ok(find(r, 'tienda.com').domains.includes('tienda.com'));
    assert.strictEqual(find(r, 'api.tienda.com').type, 'proxy');
    assert.strictEqual(find(r, 'api.tienda.com').port, 3000);
    assert.strictEqual(find(r, 'miblog.net').type, 'static');
    assert.strictEqual(r.summary.auth, '/var/log/secure');
    assert.ok(r.summary.bans.some(b => b.startsWith('fail2ban')));
    assert.ok(r.summary.mail.startsWith('postfix'));
  },
  directadmin(r) {
    assert.strictEqual(r.summary.panelId, 'directadmin');
    assert.deepStrictEqual(r.accounts, [{ id: 'ana', home: '/home/ana', main: 'ana.dev' }]);
    const main = find(r, 'ana.dev');
    assert.strictEqual(main.type, 'php');
    assert.ok(main.domains.includes('ana.com.ve'), 'el dominio apuntado (pointer) es alias');
    assert.strictEqual(find(r, 'shop.ana.dev').type, 'static');
    assert.ok(r.logs.some(([f, d]) => f === '/var/log/httpd/domains/ana.dev.shop.log' && d === 'shop.ana.dev'));
    assert.ok(find(r, 'landing.io'), 'dominio sin carpeta tambien aparece');
    assert.ok(r.summary.mail.startsWith('exim'));
    assert.ok(r.summary.bans.some(b => b.startsWith('lfd')));
    assert.strictEqual(r.summary.pm2Accounts, 1);
  },
  cyberpanel(r) {
    assert.strictEqual(r.summary.panelId, 'cyberpanel');
    const g = find(r, 'misitio.com');
    assert.strictEqual(g.account, 'sitio1234');
    assert.strictEqual(g.type, 'php');
    assert.ok(g.domains.includes('www.misitio.com') || g.domains.length >= 1);
    assert.ok(r.logs.some(([f]) => f === '/home/misitio.com/logs/misitio.com.access_log'));
    assert.ok(r.summary.mail.startsWith('postfix'));
  },
  'none-nginx'(r) {
    assert.strictEqual(r.summary.panelId, 'none');
    assert.strictEqual(r.summary.web, 'nginx');
    const app = find(r, 'app.midominio.com');
    assert.strictEqual(app.account, 'dev');
    assert.strictEqual(app.type, 'proxy');
    assert.strictEqual(app.port, 8080);
    const def = find(r, 'midominio.com');
    assert.strictEqual(def.account, '_web', 'sitio de www-data va a "Sitios del servidor"');
    assert.strictEqual(def.type, 'static');
    assert.ok(r.logs.some(([f, d]) => f === '/var/log/nginx/access.log' && d === ''), 'log general como compartido');
    assert.strictEqual(r.summary.claudeAccounts, 1);
  },
  'none-apache'(r) {
    assert.strictEqual(r.summary.panelId, 'none');
    assert.strictEqual(r.summary.web, 'apache');
    const g = find(r, 'empresa.com');
    assert.strictEqual(g.type, 'php');
    assert.ok(g.domains.includes('www.empresa.com') || g.domain === 'empresa.com');
    assert.ok(r.logs.some(([f]) => f === '/var/log/httpd/empresa-access.log'));
    assert.strictEqual(r.summary.auth, '/var/log/secure');
    assert.strictEqual(r.summary.mail, null);
  },
};

let fail = 0;
for (const [name, check] of Object.entries(tests)) {
  try {
    const r = probe(name);
    check(r);
    console.log(`ok   ${name.padEnd(12)} ${r.summary.panel} · ${r.summary.accounts} cuentas · ${r.summary.sites} sitios · ${r.groups.map(g => g.domain + ' [' + g.type + ']').join(', ')}`);
  } catch (e) { fail++; console.log(`FALLA ${name}: ${e.message}`); }
}
process.exit(fail ? 1 : 0);
