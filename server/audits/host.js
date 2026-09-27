'use strict';
// Revisiones del servidor, en solo lectura y en lenguaje simple: respaldos, actualizaciones, cola de correo,
// tareas cron y puertos abiertos. Cada revision devuelve su estado (ok, warn, bad, unknown), un resumen y
// hallazgos con su "como arreglarlo".
//  - las livianas (leer archivos de configuracion, contar archivos, /proc) corren solas cada 15 min
//  - la de actualizaciones consulta al gestor de paquetes (sin red, con su cache): solo a pedido
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { readJSON, writeJSONAtomic } = require('../util');
const { cronRows } = require('../agents');

const DAY = 86400000;
const exists = p => { try { fs.accessSync(p); return true; } catch { return false; } };
const read = (p, max = 1 << 20) => { try { const b = fs.readFileSync(p); return b.slice(0, max).toString('utf8'); } catch { return null; } };
const ls = p => { try { return fs.readdirSync(p); } catch { return []; } };
const stat = p => { try { return fs.statSync(p); } catch { return null; } };
const worst = list => list.reduce((w, f) => (RANK[f.sev] > RANK[w] ? f.sev : w), 'ok');
const RANK = { ok: 0, unknown: 1, warn: 2, bad: 3 };
function run(cmd, args, timeout = 120000) {
  return new Promise(res => execFile('nice', ['-n', '19', cmd, ...args], { timeout, maxBuffer: 8 << 20 }, (err, out, errOut) => res({ code: err ? (err.code ?? 1) : 0, out: String(out || ''), err: String(errOut || '') })));
}
// "key: value" de los archivos de configuracion de cPanel
function kv(text) { const o = {}; for (const l of String(text || '').split('\n')) { const m = /^\s*([A-Za-z0-9_]+)\s*[:=]\s*'?([^']*)'?\s*$/.exec(l); if (m) o[m[1]] = m[2].trim(); } return o; }

// ------------------------------------------------------------------ respaldos
function backups() {
  const f = [], items = [];
  const cp = read('/var/cpanel/backups/config');
  if (cp != null) {
    const c = kv(cp);
    const on = /^(yes|1)$/i.test(c.BACKUPENABLE || '');
    if (!on) f.push({ sev: 'bad', title: 'Los respaldos de cPanel están apagados', detail: 'WHM no está haciendo copias de las cuentas.', fix: 'En WHM › Backup › Backup Configuration active «Enable Backups» y elija días y retención.' });
    const dir = c.BACKUPDIR || '/backup';
    // cada respaldo diario es una carpeta con su fecha (tambien las hay semanales y mensuales)
    const dates = [];
    for (const sub of ['', 'weekly', 'monthly']) for (const d of ls(path.join(dir, sub))) if (/^\d{4}-\d\d-\d\d$/.test(d)) dates.push({ d, kind: sub || 'diario', path: path.join(dir, sub, d) });
    dates.sort((a, b) => a.d.localeCompare(b.d));
    const last = dates[dates.length - 1];
    const days = String(c.BACKUPDAYS || '').split(',').filter(Boolean).length || 7;
    const expectGap = Math.ceil(7 / days) + 1; // dias entre respaldos segun la configuracion, con un dia de margen
    if (on && !last) f.push({ sev: 'bad', title: 'No hay ningún respaldo en disco', detail: `La carpeta ${dir} no tiene copias.`, fix: 'Revise en WHM › Backup si los respaldos fallan (Backup Restoration muestra los que existen) y el registro en /usr/local/cpanel/logs/cpbackup.' });
    if (last) {
      const age = (Date.now() - new Date(last.d + 'T12:00:00').getTime()) / DAY;
      const accounts = ls(path.join(last.path, 'accounts')).length;
      items.push({ label: 'Último respaldo', value: last.d, sub: `${last.kind} · ${accounts} cuenta${accounts === 1 ? '' : 's'}` });
      items.push({ label: 'Copias guardadas', value: String(dates.length), sub: `retención ${c.BACKUP_DAILY_RETENTION || '?'} diarias` });
      if (age > expectGap + 3) f.push({ sev: 'bad', title: `El último respaldo tiene ${Math.floor(age)} días`, detail: 'Los respaldos dejaron de hacerse.', fix: 'Revise el registro de la última corrida en /usr/local/cpanel/logs/cpbackup y el espacio libre del disco.' });
      else if (age > expectGap) f.push({ sev: 'warn', title: `El último respaldo tiene ${Math.floor(age)} días`, detail: `Con la configuración actual debería haber uno cada ${expectGap - 1} día(s).`, fix: 'Revise que la última corrida haya terminado bien (/usr/local/cpanel/logs/cpbackup).' });
      const cfgAccts = Object.keys(kv(read('/etc/trueuserdomains') || '')).length;
      if (on && accounts === 0) f.push({ sev: 'warn', title: 'El último respaldo no tiene cuentas', detail: 'Se respalda el sistema pero ninguna cuenta.', fix: 'En WHM › Backup › Backup User Selection active las cuentas.' });
      void cfgAccts;
    }
    // destinos externos: si solo hay copia local, un fallo del disco se lleva todo
    const remote = ls('/var/cpanel/backups').filter(x => x.endsWith('.backup_destination'));
    const sameDisk = stat(dir) && stat('/home') && stat(dir).dev === stat('/home').dev;
    if (on && !remote.length) f.push({ sev: sameDisk ? 'bad' : 'warn', title: sameDisk ? 'Los respaldos están en el mismo disco que los sitios' : 'Los respaldos solo se guardan en este servidor', detail: 'Si el disco o el servidor fallan, se pierden los sitios y sus copias a la vez.', fix: 'En WHM › Backup › Backup Configuration › Additional Destinations agregue un destino externo (S3, Backblaze, Google Drive, SFTP a otro servidor).' });
    else if (remote.length) items.push({ label: 'Destinos externos', value: String(remote.length), sub: 'además de la copia local' });
  }
  if (exists('/usr/local/jetapps/etc/jetbackup5') || exists('/usr/local/jetapps/etc/jetbackup')) items.push({ label: 'JetBackup', value: 'instalado', sub: 'revise sus trabajos en su panel' });
  if (cp == null && !items.length) f.push({ sev: 'warn', title: 'No encontré respaldos conocidos', detail: 'No hay respaldos de cPanel ni JetBackup en este servidor.', fix: 'Configure copias automáticas (del panel, del proveedor del VPS o con una herramienta como restic o borg) hacia otro lugar.' });
  return { id: 'backups', title: 'Respaldos', icon: 'db', items, findings: f, status: worst(f) };
}

// ------------------------------------------------------------------ actualizaciones (liviano: nucleo y cPanel)
function versionCmp(a, b) { const x = a.split(/[.-]/).map(Number), y = b.split(/[.-]/).map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; }
function kernelCheck(f, items) {
  const running = (read('/proc/sys/kernel/osrelease') || '').trim();
  const installed = ls('/boot').filter(x => x.startsWith('vmlinuz-')).map(x => x.slice(8)).filter(v => /^\d/.test(v)).sort(versionCmp);
  const newest = installed[installed.length - 1];
  if (running) items.push({ label: 'Núcleo en uso', value: running.split('-').slice(0, 2).join('-') });
  if (exists('/var/run/reboot-required') || (newest && running && versionCmp(newest, running) > 0 && !running.startsWith(newest)))
    f.push({ sev: 'warn', title: 'Hay un reinicio pendiente', detail: `Se instaló un núcleo nuevo (${newest || 'actualizado'}) pero el servidor sigue con ${running}: los arreglos de seguridad del núcleo no se aplican hasta reiniciar.`, fix: 'Programe un reinicio del servidor en un horario de poco tráfico.' });
}
function cpanelUpdates(f, items) {
  const c = kv(read('/etc/cpupdate.conf'));
  if (!Object.keys(c).length) return;
  const ver = (read('/usr/local/cpanel/version') || '').trim();
  if (ver) items.push({ label: 'cPanel', value: ver, sub: `canal ${String(c.CPANEL || '').toLowerCase()}` });
  if (/never|manual/i.test(c.UPDATES || '')) f.push({ sev: 'warn', title: 'cPanel no se actualiza solo', detail: `Las actualizaciones están en «${c.UPDATES}».`, fix: 'En WHM › Update Preferences elija actualizaciones automáticas.' });
  if (/never/i.test(c.RPMUP || '') || /never/i.test(c.SECURITY_UPDATES || '')) f.push({ sev: 'warn', title: 'Los paquetes del sistema no se actualizan solos', detail: 'WHM no instala las actualizaciones del sistema operativo.', fix: 'En WHM › Update Preferences active las actualizaciones del sistema.' });
}
// pesado: paquetes pendientes segun la cache del gestor (sin red)
async function packages() {
  if (exists('/usr/bin/apt-get')) {
    const r = await run('apt-get', ['-s', '-o', 'Debug::NoLocking=1', '-o', 'Dir::Cache::pkgcache=', '-o', 'Dir::Cache::srcpkgcache=', 'upgrade']);
    const lines = r.out.split('\n').filter(l => l.startsWith('Inst '));
    const lists = ls('/var/lib/apt/lists').map(x => stat(path.join('/var/lib/apt/lists', x))).filter(Boolean);
    const fresh = lists.length ? Math.max(...lists.map(s => s.mtimeMs)) : 0;
    return { tool: 'apt', pending: lines.length, security: lines.filter(l => /-security/.test(l)).length, names: lines.slice(0, 30).map(l => l.split(' ')[1]), listsAt: fresh, ok: r.code === 0 };
  }
  if (exists('/usr/bin/dnf') || exists('/usr/bin/yum')) {
    const tool = exists('/usr/bin/dnf') ? 'dnf' : 'yum';
    const r = await run(tool, ['-C', '-q', 'check-update']);
    const lines = r.out.split('\n').filter(l => /^\S+\.\S+\s+\S+\s+\S+/.test(l) && !/^Obsoleting/.test(l));
    const s = await run(tool, ['-C', '-q', 'updateinfo', 'list', '--security']);
    return { tool, pending: lines.length, security: s.out.split('\n').filter(l => l.trim()).length, names: lines.slice(0, 30).map(l => l.split(/\s+/)[0]), ok: r.code === 0 || r.code === 100 };
  }
  return null;
}
function updates(pk) {
  const f = [], items = [];
  kernelCheck(f, items);
  cpanelUpdates(f, items);
  if (pk) {
    items.push({ label: 'Paquetes por actualizar', value: String(pk.pending), sub: `${pk.security} de seguridad · revisado hace ${ago(pk.t)}` });
    if (pk.security > 0) f.push({ sev: pk.security > 20 ? 'bad' : 'warn', title: `${pk.security} ${pk.security === 1 ? 'actualización' : 'actualizaciones'} de seguridad pendiente${pk.security === 1 ? '' : 's'}`, detail: `De ${pk.pending} paquetes por actualizar (según la última lista de ${pk.tool}).`, fix: pk.tool === 'apt' ? 'Aplíquelas con «apt update && apt upgrade» (o espere a la actualización automática de WHM si está activa).' : `Aplíquelas con «${pk.tool} upgrade --security».`, names: pk.names });
    else if (pk.pending > 50) f.push({ sev: 'warn', title: `${pk.pending} paquetes por actualizar`, detail: 'Ninguno es de seguridad, pero se están acumulando.', fix: 'Actualice en una ventana de mantenimiento.', names: pk.names });
  } else items.push({ label: 'Paquetes por actualizar', value: 'sin revisar', sub: 'use «Revisar actualizaciones»' });
  return { id: 'updates', title: 'Actualizaciones', icon: 'refresh', items, findings: f, status: pk ? worst(f) : (f.length ? worst(f) : 'unknown'), canCheck: true };
}
const ago = t => { const m = Math.round((Date.now() - (t || 0)) / 60000); return m < 60 ? `${m} min` : m < 2880 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`; };

// ------------------------------------------------------------------ cola de correo
function mailQueue() {
  const f = [], items = [];
  let n = 0, frozen = 0, oldest = 0, tool = null;
  if (exists('/var/spool/exim/input')) {
    tool = 'Exim';
    let read_ = 0;
    const walk = d => { for (const x of ls(d)) { const p = path.join(d, x), s = stat(p); if (!s) continue; if (s.isDirectory()) walk(p); else if (x.endsWith('-H')) { n++; oldest = oldest ? Math.min(oldest, s.mtimeMs) : s.mtimeMs; if (read_ < 3000) { read_++; const h = read(p, 4096); if (h && /\n-frozen \d+/.test(h)) frozen++; } } } };
    walk('/var/spool/exim/input');
  } else if (exists('/var/spool/postfix')) {
    tool = 'Postfix';
    for (const q of ['active', 'deferred', 'hold', 'incoming']) {
      const walk = d => { for (const x of ls(d)) { const p = path.join(d, x), s = stat(p); if (!s) continue; if (s.isDirectory()) walk(p); else { n++; oldest = oldest ? Math.min(oldest, s.mtimeMs) : s.mtimeMs; if (q === 'hold') frozen++; } } };
      walk(path.join('/var/spool/postfix', q));
    }
  }
  if (!tool) return { id: 'mail', title: 'Cola de correo', icon: 'mail', items: [{ label: 'Servidor de correo', value: 'no encontrado' }], findings: [], status: 'ok' };
  items.push({ label: 'Mensajes en cola', value: String(n), sub: tool });
  if (frozen) items.push({ label: tool === 'Exim' ? 'Congelados' : 'Retenidos', value: String(frozen) });
  if (oldest) items.push({ label: 'El más viejo', value: ago(oldest) });
  if (n > 1000) f.push({ sev: 'bad', title: `${n} mensajes esperando en la cola`, detail: 'Suele ser spam saliente (una cuenta o formulario comprometido) o un destino que rechaza el correo.', fix: 'En WHM › Mail Queue Manager vea de qué cuenta salen; si es spam, cambie la contraseña de esa cuenta y revise sus formularios.' });
  else if (n > 100) f.push({ sev: 'warn', title: `${n} mensajes esperando en la cola`, detail: 'Más de lo normal: hay correos que no logran salir.', fix: 'En WHM › Mail Queue Manager revise a qué destinos van y por qué se demoran.' });
  if (frozen > 20) f.push({ sev: 'warn', title: `${frozen} mensajes congelados`, detail: 'Son rebotes que no se pudieron entregar; ocupan espacio y suelen venir de spam.', fix: 'Se pueden borrar desde WHM › Mail Queue Manager (o «exiqgrep -z -i | xargs exim -Mrm»).' });
  if (oldest && Date.now() - oldest > 3 * DAY && n > 20) f.push({ sev: 'warn', title: `Hay mensajes en cola desde hace ${ago(oldest)}`, detail: 'El servidor sigue reintentando correos que no salen.', fix: 'Revise el destino en el Mail Queue Manager; si no son válidos, bórrelos.' });
  return { id: 'mail', title: 'Cola de correo', icon: 'mail', items, findings: f, status: worst(f) };
}

// ------------------------------------------------------------------ tareas cron
// correos que cron mando con la salida de una tarea (del registro de Exim, ultimos 7 dias)
function cronMails(file = '/var/log/exim_mainlog', now = Date.now()) {
  let txt = '';
  try { const st = fs.statSync(file); const fd = fs.openSync(file, 'r'); const len = Math.min(st.size, 20 * 1024 * 1024); const b = Buffer.alloc(len); fs.readSync(fd, b, 0, len, st.size - len); fs.closeSync(fd); txt = b.toString('latin1'); } catch { return []; }
  const by = new Map();
  for (const l of txt.split('\n')) {
    const m = l.match(/^(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}) \S+ <= \S+ U=(\S+) P=local .*?T="Cron <([^@>]+)@[^>]*> ((?:[^"\\]|\\.)*)"/);
    if (!m) continue;
    const t = Date.parse(m[1].replace(' ', 'T')); if (now - t > 7 * 86400000) continue;
    const k = m[3] + '|' + m[4];
    const x = by.get(k) || { user: m[3], command: m[4].slice(0, 200), n: 0, last: 0 };
    x.n++; x.last = Math.max(x.last, t); by.set(k, x);
  }
  return [...by.values()].filter(x => x.n >= 2).sort((a, b) => b.n - a.n);
}

function crons() {
  const f = [], rows = [];
  const dirs = ['/var/spool/cron/crontabs', '/var/spool/cron'];
  for (const d of dirs) for (const user of ls(d)) {
    const p = path.join(d, user), s = stat(p);
    if (!s || !s.isFile()) continue;
    for (const r of cronRows(read(p) || '')) rows.push({ user, ...r });
  }
  // un secreto leido de un archivo en el momento ($(grep ...), | cut) es la practica correcta: no se marca
  const secrets = rows.filter(r => r.secret && !/\$\(|`|\|\s*cut\b|\bgrep\s+\S*SECRET/.test(r.command)), pub = rows.filter(r => r.logInDocroot), everyMin = rows.filter(r => /^\*\s+\*\s+\*\s+\*\s+\*$/.test(r.schedule));
  // archivo que ya no existe: la primera ruta absoluta de un script en el comando
  const missing = rows.filter(r => { const m = /(\/(?:home|var|opt|usr|root)\/[^\s;|&>'"]+\.(?:php|sh|py|js|pl|rb))/.exec(r.command); return m && !m[1].includes('•') && !exists(m[1]); });
  if (secrets.length) f.push({ sev: 'bad', title: `${secrets.length} tarea${secrets.length === 1 ? '' : 's'} cron con contraseñas o tokens a la vista`, detail: 'Cualquier usuario del servidor puede verlos en la lista de procesos mientras corre la tarea.', fix: 'Guarde el secreto en un archivo con permisos 600 (o en variables del propio script) y léalo desde ahí.', rows: secrets });
  if (pub.length) f.push({ sev: 'warn', title: `${pub.length} tarea${pub.length === 1 ? '' : 's'} cron escribe${pub.length === 1 ? '' : 'n'} su registro dentro de public_html`, detail: 'Ese archivo se puede descargar desde la web y puede mostrar datos internos.', fix: 'Mueva el registro fuera de public_html (por ejemplo a ~/logs/).', rows: pub });
  if (missing.length) f.push({ sev: 'warn', title: `${missing.length} tarea${missing.length === 1 ? '' : 's'} cron apunta${missing.length === 1 ? '' : 'n'} a un archivo que ya no existe`, detail: 'Falla cada vez que corre (y puede estar mandando un correo de error cada vez).', fix: 'Bórrela en cPanel › Cron Jobs o corrija la ruta.', rows: missing });
  // tareas que producen salida: cron la manda por correo («Cron <usuario@host> comando») y queda en el registro de
  // Exim; si pasa varias veces en la semana casi siempre es un error que se repite en cada ejecucion
  const noisy = cronMails();
  if (noisy.length) f.push({ sev: 'warn', title: `${noisy.length} tarea${noisy.length === 1 ? '' : 's'} cron produce${noisy.length === 1 ? '' : 'n'} salida seguido (posible error)`,
    detail: noisy.slice(0, 5).map(x => `${x.user}: ${x.n} vez(ces) en 7 días, la última el ${new Date(x.last).toLocaleDateString('es-VE')}`).join(' · '),
    fix: 'Esa salida suele ser un error que se repite en cada ejecución. Ejecute el comando a mano (o mire el correo de ese usuario) para verlo; si la salida es normal, mándela a un archivo de registro fuera de public_html o a /dev/null.',
    rows: noisy.map(x => ({ user: x.user, schedule: `${x.n} veces en 7 días`, command: x.command })) });
  const users = new Set(rows.map(r => r.user)).size;
  return { id: 'cron', title: 'Tareas cron', icon: 'clock', items: [{ label: 'Tareas', value: String(rows.length), sub: `${users} usuario${users === 1 ? '' : 's'}` }, { label: 'Cada minuto', value: String(everyMin.length) }], findings: f, status: worst(f), rows };
}

// ------------------------------------------------------------------ puertos
const KNOWN = { 21: 'FTP', 22: 'SSH', 25: 'SMTP', 26: 'SMTP', 53: 'DNS', 80: 'HTTP', 110: 'POP3', 143: 'IMAP', 443: 'HTTPS', 465: 'SMTPS', 587: 'SMTP', 993: 'IMAPS', 995: 'POP3S',
  2077: 'WebDAV', 2078: 'WebDAV', 2079: 'CalDAV', 2080: 'CalDAV', 2082: 'cPanel', 2083: 'cPanel', 2086: 'WHM', 2087: 'WHM', 2095: 'Webmail', 2096: 'Webmail', 2091: 'cPanel', 2092: 'cPanel',
  3306: 'MySQL', 5432: 'PostgreSQL', 6379: 'Redis', 27017: 'MongoDB', 11211: 'Memcached', 9200: 'Elasticsearch', 5984: 'CouchDB', 2375: 'Docker (sin cifrar)', 2376: 'Docker', 8086: 'InfluxDB' };
const DANGEROUS = new Set([3306, 5432, 6379, 27017, 11211, 9200, 5984, 2375, 8086]);
function listening() {
  const out = new Map(); // puerto -> { port, public, inodes }
  for (const [file, v6] of [['/proc/net/tcp', false], ['/proc/net/tcp6', true]]) {
    for (const l of (read(file) || '').split('\n').slice(1)) {
      const c = l.trim().split(/\s+/);
      if (c[3] !== '0A') continue;
      const [addr, portHex] = c[1].split(':');
      const port = parseInt(portHex, 16);
      const loop = v6 ? /^0{24}01000000$|^0000000000000000FFFF00000100007F$/i.test(addr) : addr.endsWith('7F');
      const any = /^0+$/.test(addr);
      const e = out.get(port) || { port, public: false, local: false, inodes: [] };
      if (loop) e.local = true; else e.public = true;
      if (any) e.any = true;
      e.inodes.push(c[9]);
      out.set(port, e);
    }
  }
  return out;
}
// quien escucha cada puerto: /proc/<pid>/fd (solo los procesos que se pueden leer)
function owners(ports) {
  const want = new Map();
  for (const e of ports.values()) for (const i of e.inodes) want.set('socket:[' + i + ']', e);
  const t0 = Date.now();
  for (const pid of ls('/proc')) {
    if (!/^\d+$/.test(pid) || Date.now() - t0 > 1500) continue;
    for (const fd of ls(`/proc/${pid}/fd`)) {
      let l; try { l = fs.readlinkSync(`/proc/${pid}/fd/${fd}`); } catch { continue; }
      const e = want.get(l);
      if (e && !e.proc) e.proc = (read(`/proc/${pid}/comm`) || '').trim();
    }
  }
}
function firewallAllows(port) {
  const csf = read('/etc/csf/csf.conf');
  if (csf) { const m = /^TCP_IN\s*=\s*"([^"]*)"/m.exec(csf); if (m) return m[1].split(',').some(r => { const [a, b] = r.split(':').map(Number); return b ? port >= a && port <= b : port === a; }); }
  const ufw = kv(read('/etc/ufw/ufw.conf'));
  if (/yes/i.test(ufw.ENABLED || '')) { const rules = read('/etc/ufw/user.rules') || ''; return new RegExp(`--dport ${port}\\b[^\\n]*-j ufw-user-input|ACCEPT[^\\n]*--dport ${port}\\b`).test(rules) || new RegExp(`dport ${port}\\b`).test(rules); }
  return null; // no se sabe (sin firewall conocido o uno que no se puede leer, como Imunify360)
}
function ports() {
  const f = [], list = listening();
  owners(list);
  const rows = [...list.values()].sort((a, b) => a.port - b.port).map(e => ({ port: e.port, name: KNOWN[e.port] || '', proc: e.proc || '', public: e.public, fw: e.public ? firewallAllows(e.port) : null }));
  const exposed = rows.filter(r => r.public && DANGEROUS.has(r.port) && r.fw !== false);
  for (const r of exposed) f.push({ sev: r.fw === true ? 'bad' : 'warn', title: `${r.name} escucha en todas las direcciones (puerto ${r.port})`, detail: r.fw === true ? 'El firewall lo deja pasar: se puede intentar entrar desde internet.' : 'Si el firewall no lo bloquea, se puede intentar entrar desde internet.', fix: `Haga que ${r.name} escuche solo en 127.0.0.1 (bind-address o similar) o ciérrelo en el firewall.` });
  const apps = rows.filter(r => r.public && !KNOWN[r.port] && r.port >= 1024 && r.fw !== false && !/httpd|nginx|litespeed|cpsrvd|cpdavd|dovecot|exim|pure-ftpd|named|sshd|systemd|imunify|cphulkd|lfd/.test(r.proc));
  if (apps.length) f.push({ sev: 'warn', title: `${apps.length} ${apps.length === 1 ? 'aplicación' : 'aplicaciones'} escucha${apps.length === 1 ? '' : 'n'} en todas las direcciones`, detail: 'Se puede entrar directo a su puerto, sin pasar por Apache ni por el certificado SSL.', fix: 'Configure esas apps para escuchar en 127.0.0.1 (por ejemplo HOST=127.0.0.1) y publíquelas solo por el proxy.', rows: apps });
  const pub = rows.filter(r => r.public).length;
  return { id: 'ports', title: 'Puertos abiertos', icon: 'shield', items: [{ label: 'Abiertos a la red', value: String(pub) }, { label: 'Solo locales', value: String(rows.length - pub) }], findings: f, status: worst(f), rows };
}

// ------------------------------------------------------------------ conjunto
class HostAudit {
  constructor(cfg) {
    this.cfg = cfg;
    this.file = path.join(cfg.stateDir, 'audits', 'host.json');
    const saved = readJSON(this.file, null) || {};
    this.pk = saved.pk || null; // ultima revision de paquetes (pesada, a pedido)
    this.result = null;
  }
  available() { return (this.cfg.edition || 'vps') === 'vps'; }
  refresh() {
    if (!this.available()) return null;
    const secs = [];
    // secciones que aportan otros modulos (p. ej. archivos expuestos, que corre aparte una vez al dia)
    for (const fn of [backups, () => updates(this.pk), mailQueue, crons, ports, ...(this.extra || [])]) { try { const s = fn(); if (s) secs.push(s); } catch (e) { console.error('[revisiones]', e.message); } }
    this.result = { t: Date.now(), sections: secs };
    return this.result;
  }
  get() { if (!this.result || Date.now() - this.result.t > 15 * 60000) this.refresh(); return this.result; }
  start() { setTimeout(() => this.refresh(), 3000); setInterval(() => this.refresh(), 15 * 60000).unref(); }
  async checkPackages() {
    const pk = await packages();
    if (pk) { this.pk = { ...pk, t: Date.now() }; try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeJSONAtomic(this.file, { pk: this.pk }); } catch { } }
    this.refresh();
  }
  summary() {
    const r = this.get(); if (!r) return null;
    const all = r.sections.flatMap(s => s.findings);
    return { bad: all.filter(f => f.sev === 'bad').length, warn: all.filter(f => f.sev === 'warn').length, t: r.t };
  }
}

module.exports = { HostAudit, backups, mailQueue, crons, cronMails, ports, updates, kv, listening };
