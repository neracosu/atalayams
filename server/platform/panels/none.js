'use strict';
// Sin panel: se leen los sitios de Nginx y Apache. La cuenta es el dueno de la carpeta del sitio;
// si es un usuario de sistema (root, www-data...) el sitio va al distrito "_web" (Sitios del servidor).
const fx = require('../fsx');
const { parseApache, parseNginx, mergeSites } = require('../webconf');

const NGINX = ['/etc/nginx/sites-enabled/*', '/etc/nginx/conf.d/*.conf'];
const APACHE = ['/etc/apache2/sites-enabled/*', '/etc/httpd/conf.d/*.conf', '/etc/httpd/sites-enabled/*'];
const DEFAULT_LOGS = { nginx: '/var/log/nginx/access.log', apache: ['/var/log/apache2/access.log', '/var/log/httpd/access_log'] };

function webServer() {
  if (fx.isDir('/etc/nginx')) return 'nginx';
  if (fx.isDir('/etc/apache2') || fx.isDir('/etc/httpd')) return 'apache';
  return null;
}

function accountFor(docroot) {
  const o = docroot ? fx.owner(docroot) : null;
  const u = o ? fx.passwd().byName.get(o) : null;
  return u && u.uid >= 1000 ? o : '_web';
}

module.exports = {
  id: 'none',
  label: 'Sin panel',
  detect: () => !!webServer(),
  webServer,

  vhosts() {
    const ng = NGINX.flatMap(p => fx.glob(p)).flatMap(f => parseNginx(fx.read(f)));
    const ap = APACHE.flatMap(p => fx.glob(p)).flatMap(f => parseApache(fx.read(f)));
    const all = mergeSites([...ng, ...ap]);
    const ws = webServer();
    const def = ws === 'nginx' ? [DEFAULT_LOGS.nginx] : DEFAULT_LOGS.apache;
    return all.map(v => ({
      servername: v.servername, aliases: v.aliases, docroot: v.docroot || '', account: accountFor(v.docroot),
      // sin log propio se usa el general del servidor web (no se puede saber a que sitio pertenece cada linea)
      logs: v.logs.length ? v.logs : [], sharedLog: v.logs.length ? null : def.find(f => fx.exists(f)) || null,
      proxyPort: v.proxyPort,
    }));
  },

  accounts() {
    const pw = fx.passwd().byName;
    const by = new Map();
    for (const v of this.vhosts()) {
      if (by.has(v.account)) continue;
      if (v.account === '_web') by.set('_web', { id: '_web', home: '/var/www', main: '', label: 'Sitios del servidor' });
      else if (pw.has(v.account)) by.set(v.account, { id: v.account, home: pw.get(v.account).home, main: v.servername });
    }
    return [...by.values()];
  },

  watchPaths: () => ['/etc/nginx/sites-enabled', '/etc/nginx/conf.d', '/etc/apache2/sites-enabled', '/etc/httpd/conf.d'],
  extraLogs: () => ({}),
  get proxyHint() { return webServer() === 'nginx' ? 'nginx' : 'apache'; },
};
