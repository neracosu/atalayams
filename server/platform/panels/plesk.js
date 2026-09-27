'use strict';
// Plesk: cada dominio tiene /var/www/vhosts/system/<dominio>/conf/httpd.conf y sus logs al lado.
// La cuenta es el usuario de sistema de la suscripcion (SuexecUserGroup o dueno de la carpeta).
const fx = require('../fsx');
const { parseApache, mergeSites } = require('../webconf');

const SYS = '/var/www/vhosts/system';

module.exports = {
  id: 'plesk',
  label: 'Plesk',
  detect: () => fx.isDir(SYS) && (fx.exists('/usr/local/psa') || fx.exists('/opt/psa')),

  vhosts() {
    const out = [];
    for (const d of fx.ls(SYS)) {
      const conf = ['httpd.conf', 'last_httpd.conf'].map(f => `${SYS}/${d}/conf/${f}`).find(f => fx.exists(f));
      const sites = conf ? mergeSites(parseApache(fx.read(conf))) : [];
      const site = sites.find(s => s.servername === d) || sites[0] || { servername: d, aliases: [], docroot: `/var/www/vhosts/${d}/httpdocs`, logs: [] };
      const logDir = `${SYS}/${d}/logs`;
      const logs = [...new Set([...site.logs, ...['access_log', 'access_ssl_log', 'proxy_access_log', 'proxy_access_ssl_log'].map(f => `${logDir}/${f}`)])].filter(f => fx.exists(f));
      const account = site.user || fx.owner(site.docroot) || fx.owner(`/var/www/vhosts/${d}`) || 'psaserv';
      out.push({ servername: site.servername || d, aliases: site.aliases, docroot: site.docroot, account, logs, proxyPort: site.proxyPort });
    }
    return out;
  },

  // una cuenta por usuario de suscripcion; su dominio principal es el que usa <home>/httpdocs
  accounts() {
    const pw = fx.passwd().byName;
    const by = new Map();
    for (const v of this.vhosts()) {
      const u = pw.get(v.account);
      if (!u) continue;
      const a = by.get(v.account) || { id: v.account, home: u.home, main: '' };
      if (v.docroot === u.home + '/httpdocs' || (!a.main && v.docroot.startsWith(u.home + '/'))) a.main = v.servername;
      by.set(v.account, a);
    }
    return [...by.values()];
  },

  watchPaths: () => [SYS, '/var/www/vhosts'],
  extraLogs: () => ({}),
  proxyHint: 'plesk',
};
