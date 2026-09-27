'use strict';
// Deteccion de la plataforma: panel (cuentas, sitios, logs de visitas), seguridad, correo y base de paises.
// Todo es de solo lectura. config.json puede forzar cualquier pieza (platform.panel, logs.*, geoipPath).
const fx = require('./fsx');

const PANELS = ['cpanel', 'plesk', 'directadmin', 'cyberpanel', 'none'].map(id => require('./panels/' + id));
const first = list => list.find(f => fx.exists(f)) || null;

function detectPanel(cfg = {}) {
  const want = cfg.platform && cfg.platform.panel;
  if (want && want !== 'auto') return PANELS.find(p => p.id === want) || null;
  return PANELS.find(p => p.detect()) || null;
}

function cloudGeo(cfg) {
  return cfg.geoipPath || first([(cfg.stateDir || '.') + '/dbip-country-lite.mmdb', '/var/lib/atalaya-cloud/dbip-country-lite.mmdb', '/usr/share/GeoIP/GeoLite2-Country.mmdb', '/var/lib/GeoIP/GeoLite2-Country.mmdb']);
}

function detect(cfg = {}) {
  // Atalaya Cloud: nada de la maquina que aloja (ni logs, ni panel); solo la base de paises para las visitas de Vercel
  if (cfg.edition === 'cloud' || cfg.edition === 'equipo') return { panel: null, auth: null, bans: [], mail: null, geo: cloudGeo(cfg), web: null };
  const L = cfg.logs || {};
  const panel = detectPanel(cfg);
  const auth = L.authLog || first(['/var/log/auth.log', '/var/log/secure']);
  const bans = [...((panel && panel.extraLogs().bans) || []).filter(b => fx.exists(b.file))];
  if (fx.exists('/var/log/fail2ban.log')) bans.push({ kind: 'fail2ban', file: '/var/log/fail2ban.log' });
  if (fx.exists('/var/log/lfd.log')) bans.push({ kind: 'lfd', file: '/var/log/lfd.log' });
  let mail = null;
  const exim = L.eximLog || first(['/var/log/exim_mainlog', '/var/log/exim/mainlog', '/var/log/exim4/mainlog']);
  if (exim) mail = { kind: 'exim', file: exim };
  else { const pf = first(['/var/log/mail.log', '/var/log/maillog']); if (pf) mail = { kind: 'postfix', file: pf }; }
  const imunify = fx.ls('/var/imunify360/files/geo').sort().reverse().map(d => `/var/imunify360/files/geo/${d}/GeoLite2-Country.mmdb`);
  const geo = cfg.geoipPath || first([...imunify, '/usr/share/GeoIP/GeoLite2-Country.mmdb', '/var/lib/GeoIP/GeoLite2-Country.mmdb',
    '/usr/local/share/GeoIP/GeoLite2-Country.mmdb', (cfg.stateDir || '/var/lib/atalaya') + '/dbip-country-lite.mmdb']);
  const web = fx.isDir('/usr/local/lsws') ? 'openlitespeed' : fx.isDir('/etc/nginx') && !fx.isDir('/etc/apache2') && !fx.isDir('/etc/httpd') ? 'nginx'
    : fx.isDir('/etc/apache2') || fx.isDir('/etc/httpd') ? (fx.isDir('/etc/nginx') ? 'apache+nginx' : 'apache') : fx.isDir('/etc/nginx') ? 'nginx' : null;
  return { panel, auth, bans, mail, geo, web };
}

// resumen legible para el instalador y para `node server/platform`
function summary(cfg = {}) {
  const d = detect(cfg);
  // en la nube la maquina que aloja no es del cliente: no se cuenta nada de ella
  if (cfg.edition === 'cloud' || cfg.edition === 'equipo') return { panel: 'ninguno', panelId: null, web: 'no aplica', accounts: 0, sites: 0, sitesWithLogs: 0, pm2Accounts: 0, claudeAccounts: 0,
    auth: null, bans: [], mail: null, geo: d.geo, proxyHint: null };
  const vh = d.panel ? d.panel.vhosts() : [];
  const acc = d.panel ? d.panel.accounts() : [];
  const withLogs = vh.filter(v => (v.logs && v.logs.length) || v.sharedLog).length;
  const pm2 = [...acc.map(a => a.home), '/root'].filter(h => fx.isDir(h + '/.pm2')).length;
  const claude = [...acc.map(a => a.home), '/root'].filter(h => fx.isDir(h + '/.claude')).length;
  return {
    panel: d.panel ? d.panel.label : 'ninguno', panelId: d.panel ? d.panel.id : null, web: d.web || 'no detectado',
    accounts: acc.length, sites: vh.length, sitesWithLogs: withLogs, pm2Accounts: pm2, claudeAccounts: claude,
    auth: d.auth, bans: d.bans.map(b => `${b.kind} (${b.file})`), mail: d.mail ? `${d.mail.kind} (${d.mail.file})` : null,
    geo: d.geo, proxyHint: d.panel ? d.panel.proxyHint : null,
  };
}

module.exports = { detect, detectPanel, summary, PANELS };

if (require.main === module) {
  const s = summary(JSON.parse(fx.read(require('path').resolve(__dirname, '../../config.json'), '{}') || '{}'));
  const row = (k, v) => console.log(`  ${k.padEnd(22)} ${v == null || v === '' ? '—' : Array.isArray(v) ? (v.length ? v.join(', ') : '—') : v}`);
  console.log('Atalaya · deteccion de plataforma' + (fx.ROOT ? ` (raiz simulada: ${fx.ROOT})` : ''));
  row('Panel', s.panel); row('Servidor web', s.web); row('Cuentas', s.accounts); row('Sitios', `${s.sites} (${s.sitesWithLogs} con log de visitas)`);
  row('Cuentas con PM2', s.pm2Accounts); row('Cuentas con Claude Code', s.claudeAccounts); row('Accesos SSH', s.auth);
  row('Bloqueos', s.bans); row('Correo', s.mail); row('Base de paises', s.geo);
}
