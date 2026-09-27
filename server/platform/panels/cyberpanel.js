'use strict';
// CyberPanel (OpenLiteSpeed): /usr/local/lsws/conf/vhosts/<sitio>/vhost.conf; alias en httpd_config.conf
// ("map <sitio> dominio1, dominio2"); carpeta /home/<sitio>/public_html y logs en /home/<sitio>/logs.
const fx = require('../fsx');

const VH = '/usr/local/lsws/conf/vhosts';

function maps() {
  const m = new Map();
  for (const line of fx.read('/usr/local/lsws/conf/httpd_config.conf').split('\n')) {
    const x = line.trim().match(/^map\s+(\S+)\s+(.+)$/);
    if (x) m.set(x[1], [...(m.get(x[1]) || []), ...x[2].split(',').map(s => s.trim()).filter(Boolean)]);
  }
  return m;
}

module.exports = {
  id: 'cyberpanel',
  label: 'CyberPanel',
  detect: () => fx.exists('/usr/local/CyberCP') && fx.isDir(VH),

  vhosts() {
    const mp = maps();
    const out = [];
    for (const name of fx.ls(VH)) {
      if (name === 'Example') continue;
      const conf = fx.read(`${VH}/${name}/vhost.conf`);
      const vhRoot = (conf.match(/^\s*vhRoot\s+(\S+)/m) || [])[1] || `/home/${name}`;
      const docroot = ((conf.match(/^\s*docRoot\s+(\S+)/m) || [])[1] || '$VH_ROOT/public_html').replace('$VH_ROOT', vhRoot.replace(/\/$/, ''));
      const names = [...new Set([name, ...(mp.get(name) || [])])].filter(n => n !== '*');
      const logs = [`${vhRoot}/logs/${name}.access_log`].filter(f => fx.exists(f));
      const account = fx.owner(docroot) || fx.owner(vhRoot) || name;
      const proxy = (conf.match(/address\s+(?:https?:\/\/)?(?:127\.0\.0\.1|localhost):(\d{2,5})/) || [])[1];
      out.push({ servername: name, aliases: names.slice(1), docroot, account, logs, proxyPort: proxy ? Number(proxy) : null });
    }
    return out;
  },

  accounts() {
    const pw = fx.passwd().byName;
    const by = new Map();
    for (const v of this.vhosts()) {
      if (!pw.has(v.account)) continue;
      const a = by.get(v.account) || { id: v.account, home: pw.get(v.account).home, main: v.servername };
      if (v.docroot.startsWith(`/home/${v.servername}/`)) a.main = v.servername;
      by.set(v.account, a);
    }
    return [...by.values()];
  },

  watchPaths: () => [VH, '/usr/local/lsws/conf/httpd_config.conf'],
  extraLogs: () => ({}),
  proxyHint: 'openlitespeed',
};
