'use strict';
// cPanel/WHM: cuentas en /var/cpanel/users, sitios en /var/cpanel/userdata, logs por dominio en domlogs.
const fx = require('../fsx');

const unq = v => String(v || '').replace(/^["']|["']$/g, '');
const DOMLOGS = ['/etc/apache2/logs/domlogs', '/usr/local/apache/domlogs'];

module.exports = {
  id: 'cpanel',
  label: 'cPanel/WHM',
  detect: () => fx.isDir('/var/cpanel/userdata') && fx.exists('/usr/local/cpanel'),

  domlogsDir() { return DOMLOGS.find(d => fx.isDir(d)) || DOMLOGS[0]; },

  accounts() {
    const pw = fx.passwd().byName;
    const out = [];
    for (const u of fx.ls('/var/cpanel/users')) {
      if (u === 'system' || u.startsWith('.') || !pw.has(u)) continue;
      const main = (fx.read(`/var/cpanel/userdata/${u}/main`).match(/^main_domain:\s*(\S+)/m) || [])[1] || '';
      out.push({ id: u, home: pw.get(u).home, main: unq(main) });
    }
    return out;
  },

  vhosts() {
    const logs = this.domlogsDir();
    const out = [];
    for (const user of fx.ls('/var/cpanel/userdata')) {
      if (user === 'nobody') continue;
      const dir = '/var/cpanel/userdata/' + user;
      for (const f of fx.ls(dir)) {
        if (f === 'main' || !f.includes('.') || /(_SSL|\.cache|\.yaml|\.json)$/.test(f)) continue;
        const t = fx.read(dir + '/' + f);
        const servername = unq((t.match(/^servername:\s*(\S+)/m) || [])[1]);
        const docroot = unq((t.match(/^documentroot:\s*(\S+)/m) || [])[1]);
        if (!servername || !docroot) continue;
        const aliases = ((t.match(/^serveralias:\s*(.+)$/m) || [])[1] || '').split(/\s+/).map(unq).filter(Boolean);
        out.push({ servername, aliases, docroot, account: user, logs: [`${logs}/${servername}`, `${logs}/${servername}-ssl_log`] });
      }
    }
    return out;
  },

  // rutas cuya fecha de modificacion cambia cuando se crea o borra una cuenta o un dominio
  watchPaths() {
    return ['/var/cpanel/users', '/var/cpanel/userdata', ...fx.ls('/var/cpanel/userdata').map(u => '/var/cpanel/userdata/' + u)];
  },

  extraLogs() { return { bans: [{ kind: 'cphulk', file: '/usr/local/cpanel/logs/cphulkd.log' }] }; },
  proxyHint: 'subdomain-htaccess',
};
