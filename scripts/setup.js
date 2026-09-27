#!/usr/bin/env node
'use strict';
// Instalador de Atalaya: detecta la plataforma, genera config.json, base de paises, servicio systemd,
// hooks de Claude Code y primer usuario. Lo llama install.sh. Opciones:
//   --yes            acepta los valores por defecto sin preguntar
//   --no-hooks       no instala los hooks de Claude Code
//   --no-geo         no descarga la base de paises
//   --user=<nombre>  crea este usuario (el PIN se pide igual, oculto)
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');
const https = require('https');
const zlib = require('zlib');
const readline = require('readline');
const { execFileSync, spawnSync } = require('child_process');

const DIR = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const WEB = args.includes('--web'); // instalacion desde /get: el resto se configura en el asistente web
const YES = args.includes('--yes') || WEB;
const flag = n => args.includes('--' + n);
const opt = n => (args.find(a => a.startsWith(`--${n}=`)) || '').split('=')[1];
const c = { b: s => `\x1b[1m${s}\x1b[0m`, g: s => `\x1b[32m${s}\x1b[0m`, y: s => `\x1b[33m${s}\x1b[0m`, d: s => `\x1b[2m${s}\x1b[0m`, r: s => `\x1b[31m${s}\x1b[0m` };
const step = (n, t) => console.log(`\n${c.b(`[${n}/7]`)} ${c.b(t)}`);

function ask(q, def) {
  if (YES || !process.stdin.isTTY) return Promise.resolve(def);
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(res => rl.question(`${q} ${c.d(`[${def}]`)} `, a => { rl.close(); res(a.trim() || def); }));
}
const yes = async (q, def = true) => /^s|^y/i.test(await ask(q + (def ? ' (S/n)' : ' (s/N)'), def ? 's' : 'n'));

function portFree(port) {
  return new Promise(res => { const s = net.createServer().once('error', () => res(false)).once('listening', () => s.close(() => res(true))).listen(port, '127.0.0.1'); });
}
function download(url, dest) {
  return new Promise((resolve, reject) => {
    https.get(url, r => {
      if (r.statusCode !== 200) { r.resume(); return reject(new Error('HTTP ' + r.statusCode)); }
      const out = fs.createWriteStream(dest + '.tmp');
      r.pipe(zlib.createGunzip()).pipe(out).on('finish', () => { fs.renameSync(dest + '.tmp', dest); resolve(); }).on('error', reject);
    }).on('error', reject);
  });
}

async function main() {
  if (process.getuid && process.getuid() !== 0) { console.error(c.r('Ejecute el instalador como root (sudo).')); process.exit(1); }
  console.log(c.b('\nAtalaya · instalador') + c.d(`  (${DIR})`));

  // 1. deteccion
  step(1, 'Detectando la plataforma');
  const cfgPath = path.join(DIR, 'config.json');
  const existing = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : null;
  const platform = require('../server/platform');
  const s = platform.summary(existing || {});
  const row = (k, v) => console.log(`  ${k.padEnd(24)} ${v == null || v === '' || (Array.isArray(v) && !v.length) ? c.d('—') : Array.isArray(v) ? v.join(', ') : v}`);
  row('Panel', s.panel); row('Servidor web', s.web); row('Cuentas', s.accounts); row('Sitios', `${s.sites} (${s.sitesWithLogs} con log de visitas)`);
  row('Cuentas con PM2', s.pm2Accounts); row('Cuentas con Claude Code', s.claudeAccounts); row('Accesos SSH', s.auth);
  row('Bloqueos', s.bans); row('Correo', s.mail); row('Base de países', s.geo);
  if (!s.panelId) console.log(c.y('  No se detectó panel ni servidor web: Atalaya mostrará el sistema, procesos y agentes, sin sitios.'));

  // 2. configuracion
  step(2, 'Configuración');
  let cfg = existing;
  if (cfg) console.log(`  Se conserva ${c.b('config.json')} existente.`);
  else {
    let port = 3950;
    while (!(await portFree(port)) && port < 3999) port++;
    cfg = {
      title: 'Atalaya', subtitle: `${os.hostname()} · ${s.panel}`, host: '127.0.0.1', port: Number(await ask('  Puerto local de Atalaya:', port)),
      publicUrl: await ask('  URL pública con la que la abrirá (ej. https://atalaya.su-dominio.com), o Enter si aún no la tiene:', ''),
      stateDir: '/var/lib/atalaya', trustProxy: true, sessionDays: 30, privateOptions: [15, 60, 240, 0],
      public: { showAccountNames: false, showAppNames: false }, accounts: {}, apps: {}, sites: {},
      claude: { idleMinutes: 8, goneMinutes: 45, subagentGoneSeconds: 150 }, logs: {}, platform: { panel: 'auto' },
    };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    console.log(`  Creado ${c.b('config.json')} (puerto ${cfg.port}). Las cuentas y sitios se detectan solos; ahí puede ponerles etiquetas.`);
  }
  fs.mkdirSync(cfg.stateDir, { recursive: true, mode: 0o700 });

  // 3. base de paises
  step(3, 'Base de países de las visitas');
  if (s.geo) console.log(`  Se usará ${s.geo}.`);
  else if (flag('no-geo')) console.log('  Omitido (--no-geo): las visitas no mostrarán país.');
  else if (await yes('  No hay base de países. ¿Descargar la gratuita de DB-IP (CC-BY 4.0, ~8 MB)?')) {
    const dest = path.join(cfg.stateDir, 'dbip-country-lite.mmdb');
    const d = new Date();
    const months = [0, 1].map(k => { const x = new Date(d.getFullYear(), d.getMonth() - k, 1); return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`; });
    let ok = false;
    for (const m of months) {
      try { await download(`https://download.db-ip.com/free/dbip-country-lite-${m}.mmdb.gz`, dest); ok = true; console.log(c.g(`  Descargada (${m}) en ${dest}.`)); break; }
      catch (e) { console.log(c.d(`  ${m}: ${e.message}`)); }
    }
    if (!ok) console.log(c.y('  No se pudo descargar; puede reintentar luego con ./install.sh.'));
  }

  // 4. servicio
  step(4, 'Servicio systemd');
  const node = process.env.ATALAYA_NODE || process.execPath; // la ruta que se usa, no la del enlace resuelto
  const unit = fs.readFileSync(path.join(DIR, 'deploy/atalaya.service.tpl'), 'utf8')
    .replaceAll('{{NODE}}', node).replaceAll('{{DIR}}', DIR).replaceAll('{{STATE}}', cfg.stateDir);
  const unitPath = '/etc/systemd/system/atalaya.service';
  const prev = fs.existsSync(unitPath) ? fs.readFileSync(unitPath, 'utf8') : null;
  if (prev !== unit) {
    if (prev) fs.copyFileSync(unitPath, unitPath + '.bak');
    fs.writeFileSync(unitPath, unit);
  }
  execFileSync('systemctl', ['daemon-reload']);
  execFileSync('systemctl', ['enable', '--now', 'atalaya'], { stdio: 'ignore' });
  if (prev) execFileSync('systemctl', ['restart', 'atalaya']);
  console.log(c.g(`  atalaya.service activo (${node}). Solo puede leer: su única capacidad es CAP_DAC_READ_SEARCH.`));
  // ayudante: ejecuta solo las acciones permitidas que pide el asistente web (hooks, publicar en cPanel)
  for (const u of ['atalaya-helper.path', 'atalaya-helper.service']) {
    const t = fs.readFileSync(path.join(DIR, `deploy/${u}.tpl`), 'utf8').replaceAll('{{NODE}}', node).replaceAll('{{DIR}}', DIR).replaceAll('{{STATE}}', cfg.stateDir);
    fs.writeFileSync('/etc/systemd/system/' + u, t);
  }
  execFileSync('systemctl', ['daemon-reload']);
  execFileSync('systemctl', ['enable', '--now', 'atalaya-helper.path'], { stdio: 'ignore' });
  console.log(c.g('  Ayudante del asistente web activo (atalaya-helper.path).'));

  // 5. hooks de Claude Code
  step(5, 'Hooks de Claude Code');
  if (!s.claudeAccounts) console.log(c.d('  No hay cuentas con Claude Code; puede instalarlos más adelante con: node hooks/install.js'));
  else if (flag('no-hooks') || WEB) console.log('  Se pueden instalar desde el asistente web (paso Extras).');
  else if (await yes(`  ¿Instalar los hooks en las ${s.claudeAccounts} cuentas con Claude Code? (solo agrega hooks, con respaldo)`)) {
    spawnSync(process.execPath, [path.join(DIR, 'hooks/install.js')], { stdio: 'inherit' });
  }

  // 6. primer usuario
  step(6, 'Usuarios');
  const users = (() => { try { return JSON.parse(fs.readFileSync(path.join(cfg.stateDir, 'users.json'), 'utf8')); } catch { return {}; } })();
  if (Object.keys(users).length) console.log(`  Ya hay ${Object.keys(users).length} usuario(s): ${Object.keys(users).join(', ')}.`);
  else if (WEB) console.log('  El primer usuario se crea en el asistente web.');
  else {
    const name = opt('user') || await ask('  Nombre del primer usuario (dueño, puede activar el modo privado):', 'admin');
    spawnSync(process.execPath, [path.join(DIR, 'cli.js'), 'user', 'add', name], { stdio: 'inherit' });
  }

  // 7. publicacion
  step(7, 'Publicarlo detrás de su servidor web');
  let okLocal = false;
  for (let i = 0; i < 10 && !okLocal; i++) {
    okLocal = await new Promise(res => require('http').get(`http://127.0.0.1:${cfg.port}/login`, r => { r.resume(); res(r.statusCode === 200); }).on('error', () => res(false)));
    if (!okLocal) await new Promise(r => setTimeout(r, 600));
  }
  console.log(okLocal ? c.g(`  Responde en http://127.0.0.1:${cfg.port}`) : c.r('  El servicio no responde todavía: revise `journalctl -u atalaya -n 50`.'));
  // cPanel: publicar ya en un subdominio (--domain=su-dominio.com), para abrir el asistente por HTTPS
  const dom = opt('domain');
  if (dom && s.panelId === 'cpanel') {
    const reqDir = path.join(cfg.stateDir, 'requests'); fs.mkdirSync(reqDir, { recursive: true, mode: 0o700 });
    const id = require('crypto').randomBytes(9).toString('hex');
    fs.writeFileSync(path.join(reqDir, id + '.json'), JSON.stringify({ id, action: 'cpanel-publish', params: { sub: opt('sub') || 'atalaya', domain: dom }, by: 'instalador' }), { mode: 0o600 });
    spawnSync(node, [path.join(DIR, 'server/helper.js')], { stdio: 'inherit' });
    const res = (() => { try { return JSON.parse(fs.readFileSync(path.join(cfg.stateDir, 'results', id + '.json'), 'utf8')); } catch { return null; } })();
    console.log(res && res.ok ? c.g('  ' + res.output) : c.r('  No se pudo publicar: ' + (res ? res.error : 'sin respuesta')));
    if (res && res.ok) cfg.publicUrl = (res.output.match(/https:\/\/\S+/) || [])[0] || cfg.publicUrl;
  }
  const code = (() => { try { return fs.readFileSync(path.join(cfg.stateDir, 'setup-token'), 'utf8').trim(); } catch { return null; } })();
  if (code) {
    let ip = ''; try { ip = execFileSync('hostname', ['-I'], { encoding: 'utf8' }).trim().split(/\s+/)[0]; } catch { }
    console.log('\n' + c.b('  Abra el asistente web para terminar la configuración:'));
    if (cfg.publicUrl) console.log(`    ${c.b(cfg.publicUrl.replace(/\/$/, '') + '/setup')}`);
    if (ip) console.log(`    ${c.b(`http://${ip}:3951/setup`)} ${c.d('(temporal: se cierra solo al crear el primer usuario; si no abre, habilite el puerto 3951 en el firewall o use: ssh -L 3950:127.0.0.1:3950 root@' + ip + ' y abra http://localhost:3950/setup)')}`);
    console.log(`  Código de configuración: ${c.b(code)}`);
  }
  const hint = { 'subdomain-htaccess': ['cpanel-htaccess', 'cree un subdominio (ej. atalaya.su-dominio) y ponga este .htaccess en su carpeta'],
    plesk: ['plesk-nginx.conf', 'cree un subdominio y pegue esto en "Directivas adicionales de nginx"'],
    directadmin: ['directadmin.conf', 'cree un subdominio y agregue el proxy en Custom HTTPD Configurations'],
    openlitespeed: ['openlitespeed.conf', 'cree un sitio y agregue esto en su vHost Conf'],
    nginx: ['nginx.conf', 'agregue este server en /etc/nginx/sites-enabled/ y recargue nginx'],
    apache: ['apache.conf', 'agregue este VirtualHost y recargue Apache'] }[s.proxyHint] || ['nginx.conf', 'use el ejemplo de nginx o apache'];
  console.log(`  Para verlo desde fuera ${hint[1]}:`);
  console.log(`    ${c.b(path.join(DIR, 'deploy/proxy', hint[0]))}`);
  if (cfg.port !== 3950) console.log(c.y(`  (cambie 3950 por ${cfg.port} en ese archivo)`));
  console.log(`\n${c.g('Listo.')} Diagnóstico en cualquier momento: ${c.b('node ' + path.join(DIR, 'server/platform'))}\n`);
}

main().catch(e => { console.error(c.r('Error: ' + e.message)); process.exit(1); });
