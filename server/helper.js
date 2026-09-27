#!/usr/bin/env node
'use strict';
// Ayudante privilegiado de Atalaya. Lo lanza systemd (atalaya-helper.path) cuando el panel deja un
// pedido en <stateDir>/requests/. Solo ejecuta acciones de una lista cerrada, valida cada parametro y
// deja el resultado en <stateDir>/results/<id>.json. El panel web nunca corre con permisos de root.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const settings = require('./settings');

const ROOT = path.resolve(__dirname, '..');
const cfg = settings.load(ROOT);
const REQ = path.join(cfg.stateDir, 'requests'), RES = path.join(cfg.stateDir, 'results');
const DOMAIN = /^(?=.{3,253}$)(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+$/;
const SUB = /^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?$/;

const run = (cmd, args) => execFileSync(cmd, args, { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });

// un archivo dentro de la carpeta de cuarentena (y nada fuera de ella)
function qCheck(qpath) {
  const base = path.join(cfg.stateDir, 'cuarentena') + '/', q = String(qpath || '');
  if (!q.startsWith(base) || q.includes('/../') || q.endsWith('.origen.json') || !fs.existsSync(q + '.origen.json')) throw new Error('Archivo de cuarentena no válido');
  return q;
}

// tabla propia de Atalaya en nftables: dos conjuntos con vencimiento y una cadena que descarta lo que
// venga de ellos antes que el resto del firewall. Se crea una sola vez (despues de un reinicio, de nuevo).
function nftEnsure() {
  try { run('nft', ['list', 'table', 'inet', 'atalaya']); return; } catch { }
  execFileSync('nft', ['-f', '-'], { input: `table inet atalaya {
  set block4 { type ipv4_addr; flags timeout; }
  set block6 { type ipv6_addr; flags timeout; }
  chain input { type filter hook input priority -10; policy accept; ip saddr @block4 drop; ip6 saddr @block6 drop; }
}
`, encoding: 'utf8', timeout: 20000, stdio: ['pipe', 'pipe', 'pipe'] });
}

const ACTIONS = {
  // instala o quita los hooks de Claude Code en las cuentas detectadas
  'install-hooks': () => run(process.execPath, [path.join(ROOT, 'hooks/install.js')]),
  'uninstall-hooks': () => run(process.execPath, [path.join(ROOT, 'hooks/install.js'), '--uninstall']),

  // actividad de bases: usuario de MySQL/MariaDB con el unico permiso PROCESS (ver que consultas corren, sin
  // leer ningun dato) y como mucho 2 conexiones. El SQL va por stdin (la clave nunca aparece en `ps`) y la
  // credencial queda en <stateDir>/mysql-monitor.cnf (600, solo root), fuera de todo docroot.
  // el servicio corre sin HOME: mysql no encontraria /root/.my.cnf (cPanel); sin ese archivo entra por socket
  'mysql-monitor': () => {
    const pass = require('crypto').randomBytes(24).toString('base64url');
    const sql = `CREATE USER IF NOT EXISTS 'atalaya_monitor'@'localhost' IDENTIFIED BY '${pass}';
ALTER USER 'atalaya_monitor'@'localhost' IDENTIFIED BY '${pass}' WITH MAX_USER_CONNECTIONS 2;
REVOKE ALL PRIVILEGES, GRANT OPTION FROM 'atalaya_monitor'@'localhost';
GRANT PROCESS ON *.* TO 'atalaya_monitor'@'localhost';
FLUSH PRIVILEGES;
SELECT @@socket;`;
    const out = execFileSync('mysql', ['-N', '-B'], { input: sql, encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: '/root' } }).trim();
    const socket = out.split('\n').pop().trim();
    const file = path.join(cfg.stateDir, 'mysql-monitor.cnf');
    fs.writeFileSync(file + '.tmp', `[client]\nuser=atalaya_monitor\npassword=${pass}\n${socket.startsWith('/') ? `socket=${socket}\n` : 'host=127.0.0.1\n'}`, { mode: 0o600 });
    fs.renameSync(file + '.tmp', file);
    return 'Usuario atalaya_monitor listo (solo PROCESS, 2 conexiones).';
  },
  'mysql-monitor-off': () => {
    execFileSync('mysql', ['-N', '-B'], { input: "DROP USER IF EXISTS 'atalaya_monitor'@'localhost';", encoding: 'utf8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, HOME: '/root' } });
    fs.rmSync(path.join(cfg.stateDir, 'mysql-monitor.cnf'), { force: true });
    return 'Usuario atalaya_monitor borrado.';
  },

  // defensa: bloqueo TEMPORAL de una IP en una tabla propia de nftables (inet atalaya), aparte de iptables,
  // fail2ban y cPHulk. Cada IP lleva su vencimiento: nftables la suelta sola. Nunca redes privadas, el propio
  // servidor ni Cloudflare (server/blocksafe.js, revisado tambien aqui).
  'block-ip': ({ ip, hours }) => {
    const { unsafe } = require('./blocksafe');
    const why = unsafe(ip); if (why) throw new Error(why);
    const h = Math.max(1, Math.min(168, Math.round(Number(hours) || 24)));
    nftEnsure();
    const set = require('net').isIP(ip) === 6 ? 'block6' : 'block4';
    try { run('nft', ['delete', 'element', 'inet', 'atalaya', set, `{ ${ip} }`]); } catch { }
    run('nft', ['add', 'element', 'inet', 'atalaya', set, `{ ${ip} timeout ${h}h }`]);
    return `${ip} bloqueada por ${h} h`;
  },
  'unblock-ip': ({ ip }) => {
    if (!require('net').isIP(String(ip || ''))) throw new Error('IP invalida');
    const set = require('net').isIP(ip) === 6 ? 'block6' : 'block4';
    try { run('nft', ['delete', 'element', 'inet', 'atalaya', set, `{ ${ip} }`]); } catch { }
    return `${ip} desbloqueada`;
  },
  // cuarentena de un archivo PHP sospechoso: se mueve fuera del docroot (deja de funcionar) sin borrarlo; se
  // puede restaurar. Solo archivos .php dentro de /home/<cuenta>/public_html (o un docroot de la cuenta).
  'quarantine-php': ({ path: p, by }) => {
    p = String(p || '');
    const real = fs.realpathSync(p);
    if (real !== p || !/^\/home\/[a-z0-9_]{1,32}\/[^\0]+\.(php\d?|phtml|phar)$/i.test(p) || p.includes('/../')) throw new Error('Ruta no permitida');
    const st = fs.lstatSync(p); if (!st.isFile()) throw new Error('No es un archivo');
    const dst = path.join(cfg.stateDir, 'cuarentena', new Date().toISOString().replace(/[:.]/g, '-') + p);
    fs.mkdirSync(path.dirname(dst), { recursive: true, mode: 0o700 });
    fs.renameSync(p, dst);
    fs.chmodSync(dst, 0o000);
    fs.writeFileSync(dst + '.origen.json', JSON.stringify({ path: p, uid: st.uid, gid: st.gid, mode: st.mode & 0o7777, at: new Date().toISOString(), by: String(by || '').slice(0, 40) || null }), { mode: 0o600 });
    return dst;
  },
  // borrar para siempre un archivo en cuarentena, o restaurarlo a su lugar (con su dueno y permisos originales)
  'quarantine-delete': ({ qpath }) => {
    const q = qCheck(qpath);
    fs.rmSync(q, { force: true }); fs.rmSync(q + '.origen.json', { force: true });
    return 'borrado';
  },
  'quarantine-restore': ({ qpath }) => {
    const q = qCheck(qpath), o = JSON.parse(fs.readFileSync(q + '.origen.json', 'utf8'));
    if (!/^\/home\/[a-z0-9_]{1,32}\/[^\0]+$/i.test(o.path) || o.path.includes('/../')) throw new Error('Ruta de origen no permitida');
    if (fs.existsSync(o.path)) throw new Error('Ya hay un archivo en ese lugar: no se pisa');
    fs.mkdirSync(path.dirname(o.path), { recursive: true });
    fs.renameSync(q, o.path);
    fs.chownSync(o.path, o.uid, o.gid); fs.chmodSync(o.path, o.mode || 0o644);
    fs.rmSync(q + '.origen.json', { force: true });
    return o.path;
  },
  // liberar un bloqueo MANUAL del firewall (regla DROP de iptables) y guardar el cambio para el proximo arranque
  'unblock-manual': ({ ip }) => {
    ip = String(ip || '');
    if (!require('net').isIP(ip)) throw new Error('IP invalida');
    const v6 = require('net').isIP(ip) === 6;
    const rules = run(v6 ? 'ip6tables' : 'iptables', ['-S', 'INPUT']);
    const re = new RegExp(`^-A INPUT -s ${ip.replace(/[.:]/g, m => '\\' + m)}(/(32|128))? -j DROP$`, 'm');
    if (!re.test(rules)) throw new Error('Esa IP no tiene un bloqueo manual en el firewall');
    run(v6 ? 'ip6tables' : 'iptables', ['-D', 'INPUT', '-s', ip, '-j', 'DROP']);
    try { run('netfilter-persistent', ['save']); } catch { }
    return `${ip} liberada del firewall`;
  },
  // lo que nftables tiene bloqueado ahora (con cuanto le queda a cada una)
  'block-list': () => {
    let out = [];
    try {
      for (const set of ['block4', 'block6']) {
        const j = JSON.parse(run('nft', ['-j', 'list', 'set', 'inet', 'atalaya', set]));
        const el = ((j.nftables || []).find(x => x.set) || {}).set;
        for (const e of (el && el.elem) || []) { const x = e.elem || e; out.push({ ip: x.val || x, expires: x.expires || null }); }
      }
    } catch { out = []; }
    return JSON.stringify(out);
  },

  // cPanel: crea sub.dominio en la cuenta duena del dominio, pone el proxy a Atalaya y pide SSL
  'cpanel-publish': ({ sub, domain }) => {
    sub = String(sub || '').toLowerCase(); domain = String(domain || '').toLowerCase();
    if (!SUB.test(sub) || !DOMAIN.test(domain)) throw new Error('Subdominio o dominio invalido');
    if (!fs.existsSync('/usr/local/cpanel/bin/uapi')) throw new Error('Este servidor no tiene cPanel');
    // dueno del dominio segun cPanel (/etc/userdomains: "dominio: cuenta")
    const line = fs.readFileSync('/etc/userdomains', 'utf8').split('\n').find(l => l.split(':')[0].trim() === domain);
    const account = line ? line.split(':')[1].trim() : '';
    if (!account || account === 'nobody' || !/^[a-z0-9_]{1,32}$/.test(account)) throw new Error('El dominio no pertenece a ninguna cuenta de cPanel');
    const fqdn = `${sub}.${domain}`;
    const home = (fs.readFileSync('/etc/passwd', 'utf8').split('\n').find(l => l.startsWith(account + ':')) || '').split(':')[5];
    if (!home) throw new Error('No se encontro la carpeta de la cuenta');
    const dir = `${home}/public_html/${fqdn}`;
    let out = '';
    if (!fs.existsSync(`/var/cpanel/userdata/${account}/${fqdn}`)) {
      out += run('/usr/local/cpanel/bin/uapi', [`--user=${account}`, 'SubDomain', 'addsubdomain', `domain=${sub}`, `rootdomain=${domain}`, `dir=public_html/${fqdn}`, '--output=json']);
      const r = JSON.parse(out);
      if (!r.result || r.result.status !== 1) throw new Error('cPanel no creo el subdominio: ' + ((r.result && r.result.errors) || []).join(' '));
    }
    fs.mkdirSync(dir, { recursive: true });
    const tpl = fs.readFileSync(path.join(ROOT, 'deploy/proxy/cpanel-htaccess'), 'utf8').replace(/127\.0\.0\.1:3950/g, `127.0.0.1:${cfg.port}`);
    const ht = path.join(dir, '.htaccess');
    if (fs.existsSync(ht) && !fs.readFileSync(ht, 'utf8').includes('127.0.0.1:' + cfg.port)) fs.copyFileSync(ht, ht + '.atalaya-bak');
    fs.writeFileSync(ht, tpl, { mode: 0o644 });
    const st = fs.statSync(home);
    fs.chownSync(ht, st.uid, st.gid);
    // SSL de AutoSSL en segundo plano (tarda); el sitio ya responde por http mientras tanto
    try { require('child_process').spawn('/usr/local/cpanel/bin/autossl_check', [`--user=${account}`], { detached: true, stdio: 'ignore' }).unref(); } catch { }
    settings.save(cfg, { publicUrl: `https://${fqdn}` });
    return `Publicado en https://${fqdn} (cuenta ${account}). El certificado SSL puede tardar unos minutos.`;
  },
};

function main() {
  fs.mkdirSync(RES, { recursive: true, mode: 0o700 });
  let files = [];
  try { files = fs.readdirSync(REQ).filter(f => f.endsWith('.json')); } catch { return; }
  for (const f of files) {
    const file = path.join(REQ, f);
    let req = {}, result;
    try {
      const st = fs.lstatSync(file);
      if (!st.isFile() || st.uid !== 0) throw new Error('Pedido rechazado: archivo de origen no confiable');
      req = JSON.parse(fs.readFileSync(file, 'utf8'));
      const fn = Object.prototype.hasOwnProperty.call(ACTIONS, req.action) ? ACTIONS[req.action] : null;
      if (!fn || !/^[a-z0-9-]{8,40}$/.test(String(req.id))) throw new Error('Accion no permitida');
      console.log(`[ayudante] ${req.action} pedido por ${req.by || '?'}`);
      result = { id: req.id, action: req.action, ok: true, output: String(fn(req.params || {}) || '').slice(-4000) };
    } catch (e) {
      result = { id: req.id || f.replace(/\.json$/, ''), action: req.action, ok: false, error: String((e.stderr && e.stderr.toString()) || e.message).slice(-2000) };
      console.error(`[ayudante] ${req.action || f}: ${result.error}`);
    }
    result.at = new Date().toISOString();
    try { fs.writeFileSync(path.join(RES, String(result.id).replace(/[^a-z0-9-]/gi, '') + '.json'), JSON.stringify(result), { mode: 0o600 }); } catch { }
    try { fs.unlinkSync(file); } catch { }
  }
}

main();
