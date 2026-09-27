'use strict';
// DirectAdmin: /usr/local/directadmin/data/users/<usuario>/ con user.conf, domains.list,
// domains/<dominio>.subdomains y .pointers; carpetas en /home/<usuario>/domains/<dominio>/public_html.
const fx = require('../fsx');

const USERS = '/usr/local/directadmin/data/users';
const LOGDIRS = ['/var/log/httpd/domains', '/var/log/nginx/domains', '/var/log/apache2/domains'];

function logsFor(name) {
  const out = [];
  for (const d of LOGDIRS) for (const f of [`${d}/${name}.log`, `${d}/${name}.ssl.log`]) if (fx.exists(f)) out.push(f);
  return out;
}

module.exports = {
  id: 'directadmin',
  label: 'DirectAdmin',
  detect: () => fx.isDir(USERS) && fx.exists('/usr/local/directadmin'),

  accounts() {
    const pw = fx.passwd().byName;
    return fx.ls(USERS).filter(u => pw.has(u)).map(u => {
      const main = (fx.read(`${USERS}/${u}/user.conf`).match(/^domain=(\S+)/m) || [])[1] || '';
      return { id: u, home: pw.get(u).home, main };
    });
  },

  vhosts() {
    const pw = fx.passwd().byName;
    const out = [];
    for (const u of fx.ls(USERS)) {
      const home = pw.has(u) ? pw.get(u).home : `/home/${u}`;
      const domains = fx.read(`${USERS}/${u}/domains.list`).split('\n').map(x => x.trim()).filter(Boolean);
      for (const d of domains) {
        const pointers = fx.read(`${USERS}/${u}/domains/${d}.pointers`).split('\n').map(x => x.split('=')[0].trim()).filter(Boolean);
        const root = `${home}/domains/${d}/public_html`;
        out.push({ servername: d, aliases: ['www.' + d, ...pointers], docroot: root, account: u, logs: logsFor(d) });
        for (const sub of fx.read(`${USERS}/${u}/domains/${d}.subdomains`).split('\n').map(x => x.trim()).filter(Boolean)) {
          out.push({ servername: `${sub}.${d}`, aliases: [], docroot: `${root}/${sub}`, account: u, logs: logsFor(`${d}.${sub}`) });
        }
      }
    }
    return out;
  },

  watchPaths() { return [USERS, ...fx.ls(USERS).map(u => `${USERS}/${u}`), ...fx.ls(USERS).map(u => `${USERS}/${u}/domains`)]; },
  extraLogs: () => ({}),
  proxyHint: 'directadmin',
};
