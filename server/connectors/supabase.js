'use strict';
// Supabase: cada proyecto es un edificio (torre de base de datos) con CPU, memoria, disco, conexiones y
// reinicios desde la Metrics API (formato Prometheus, cada minuto). Con un token de gestion opcional
// tambien se lee el estado del proyecto (activo, pausado, iniciando) y su region.
const https = require('https');

const HOST = process.env.ATALAYA_SUPABASE_HOST || null; // pruebas: http://127.0.0.1:puerto
const MGMT = process.env.ATALAYA_SUPABASE_API || 'https://api.supabase.com';

function request(url, headers) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? require('http') : https;
    const req = mod.request(u, { method: 'GET', timeout: 15000, headers: { 'User-Agent': 'Atalaya', ...headers } }, res => {
      let d = ''; res.setEncoding('utf8');
      res.on('data', c => { d += c; if (d.length > 32 << 20) req.destroy(); });
      res.on('end', () => res.statusCode === 200 ? resolve(d) : reject(new Error(`Supabase ${res.statusCode}`)));
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject); req.end();
  });
}

// texto Prometheus -> [{ name, labels, value }]
function parseProm(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    if (!line || line[0] === '#') continue;
    const m = line.match(/^([a-zA-Z_:][\w:]*)(?:\{(.*)\})?\s+(\S+)/);
    if (!m) continue;
    const labels = {};
    if (m[2]) for (const x of m[2].matchAll(/(\w+)="((?:[^"\\]|\\.)*)"/g)) labels[x[1]] = x[2];
    const v = Number(m[3]);
    if (!Number.isNaN(v)) out.push({ name: m[1], labels, value: v });
  }
  return out;
}
// por donde envia correo un proyecto, segun su configuracion de Auth (solo con el token de gestion de la cuenta).
// De la respuesta se toma una lista cerrada: nunca el usuario ni la contrasena del SMTP
const PROVIDERS = [[/mailtrap/, 'Mailtrap'], [/resend/, 'Resend'], [/sendgrid/, 'SendGrid'], [/amazonaws|\bses\b/, 'Amazon SES'], [/postmark/, 'Postmark'], [/brevo|sendinblue/, 'Brevo'], [/mailgun/, 'Mailgun'],
  [/mailersend/, 'MailerSend'], [/zoho/, 'Zoho'], [/gmail|google/, 'Gmail'], [/office365|outlook/, 'Outlook'], [/sparkpost/, 'SparkPost'], [/mailjet/, 'Mailjet']];
function mailOf(c) {
  if (!c || typeof c !== 'object') return null;
  const host = String(c.smtp_host || '').trim().toLowerCase().slice(0, 120), custom = !!host;
  const provider = custom ? (PROVIDERS.find(([re]) => re.test(host)) || [null, 'Servidor propio'])[1] : 'Correo de prueba de Supabase';
  // el buzon de pruebas de Mailtrap atrapa los correos: no le llegan a nadie
  const sandbox = /sandbox\.smtp\.mailtrap|smtp\.mailtrap\.io$/.test(host) && !/live\.smtp\.mailtrap/.test(host);
  const findings = [];
  if (!custom) findings.push({ level: 'warn', text: 'Envía con el correo de prueba de Supabase', fix: 'Ese correo es solo para probar: permite muy pocos envíos por hora y solo a los miembros de su equipo. En Supabase › Authentication › Emails › SMTP Settings conecte un servicio propio (Resend, Mailtrap, SES...).' });
  if (sandbox) findings.push({ level: 'bad', text: 'El correo va al buzón de pruebas de Mailtrap: no le llega a nadie', fix: 'El buzón de pruebas atrapa los correos para revisarlos. Para que lleguen a sus usuarios, en Supabase › Authentication › Emails › SMTP Settings use el servidor de envío de Mailtrap (live.smtp.mailtrap.io) con su dominio verificado.' });
  if (c.mailer_autoconfirm === true) findings.push({ level: 'info', text: 'Las cuentas nuevas no confirman su correo', fix: 'Cualquiera puede registrarse con un correo que no es suyo. Si no lo necesita así, en Supabase › Authentication › Sign In / Providers › Email active «Confirm email».' });
  const num = v => (Number.isFinite(Number(v)) && v != null && v !== '' ? Number(v) : null);
  return { custom, provider, sandbox, host: custom ? host : '', port: custom ? num(c.smtp_port) : null, sender: String(c.smtp_admin_email || '').trim().slice(0, 120), senderName: String(c.smtp_sender_name || '').trim().slice(0, 80),
    perHour: num(c.rate_limit_email_sent), everySecs: num(c.smtp_max_frequency), confirm: c.mailer_autoconfirm === false, enabled: c.external_email_enabled !== false, findings };
}

const sum = (rows, name, f = () => true) => rows.filter(r => r.name === name && f(r.labels)).reduce((n, r) => n + r.value, 0);
const has = (rows, name) => rows.some(r => r.name === name);

class SupabaseConnector {
  // conn: { id, name, projects: [{ ref, name, serviceKey }], mgmtToken }
  constructor(conn, bus) {
    this.conn = conn; this.bus = bus;
    this.account = '_supa-' + conn.id;
    this.label = 'Supabase · ' + (conn.name || conn.id);
    this.apps = [];
    this.prev = new Map(); // ref -> { cpuTotal, cpuIdle, restarts, t }
    this.meta = new Map(); // ref -> { status, region, name }
    this.data = new Map();
    this.mail = new Map(); // ref -> por donde envia correo (solo con el token de la cuenta)
    this.error = null; this.lastOk = 0; this.timers = [];
  }

  start() {
    const tick = () => this.poll().catch(e => { this.error = e.message; }).then(() => this.build());
    tick();
    this.timers.push(setInterval(tick, 60000));
  }
  stop() { for (const t of this.timers) clearInterval(t); this.timers = []; }

  async poll() {
    if (this.conn.mgmtToken) {
      try {
        const list = JSON.parse(await request(`${MGMT}/v1/projects`, { Authorization: 'Bearer ' + this.conn.mgmtToken }));
        for (const p of list) this.meta.set(p.id || p.ref, { status: p.status, region: p.region, name: p.name });
      } catch (e) { this.error = e.message; }
      // el correo de cada proyecto: cambia poco, se relee cada 30 minutos
      if (!this.mailAt || Date.now() - this.mailAt > 30 * 60000) {
        this.mailAt = Date.now();
        for (const p of this.conn.projects || []) {
          try { this.mail.set(p.ref, { ...mailOf(JSON.parse(await request(`${MGMT}/v1/projects/${p.ref}/config/auth`, { Authorization: 'Bearer ' + this.conn.mgmtToken }))), at: Date.now() }); }
          catch (e) { if (!this.mail.has(p.ref)) this.mail.set(p.ref, { error: / 40[13]$/.test(e.message) ? 'El token de la cuenta no puede leer la configuración de este proyecto' : e.message, at: Date.now() }); }
        }
      }
    }
    let okAny = false;
    for (const p of this.conn.projects || []) {
      const base = HOST || `https://${p.ref}.supabase.co`;
      try {
        const txt = await request(`${base}/customer/v1/privileged/metrics`, { Authorization: 'Basic ' + Buffer.from('service_role:' + p.serviceKey).toString('base64') });
        this.data.set(p.ref, { t: Date.now(), rows: parseProm(txt), ok: true });
        okAny = true;
      } catch (e) {
        const prevData = this.data.get(p.ref);
        this.data.set(p.ref, { ...(prevData || {}), ok: false, err: e.message });
      }
    }
    if (okAny) { this.error = null; this.lastOk = Date.now(); }
  }

  build() {
    this.apps = (this.conn.projects || []).map(p => {
      const d = this.data.get(p.ref) || {};
      const rows = d.rows || [];
      const meta = this.meta.get(p.ref) || {};
      const cpuTotal = sum(rows, 'node_cpu_seconds_total'), cpuIdle = sum(rows, 'node_cpu_seconds_total', l => l.mode === 'idle' || l.mode === 'iowait');
      const pr = this.prev.get(p.ref);
      const cpu = pr && cpuTotal > pr.cpuTotal ? Math.max(0, (1 - (cpuIdle - pr.cpuIdle) / (cpuTotal - pr.cpuTotal)) * 100) : 0;
      const memTotal = sum(rows, 'node_memory_MemTotal_bytes'), memAvail = sum(rows, 'node_memory_MemAvailable_bytes');
      const root = l => l.mountpoint === '/' || l.mountpoint === '/data';
      const diskSize = sum(rows, 'node_filesystem_size_bytes', root), diskAvail = sum(rows, 'node_filesystem_avail_bytes', root);
      const restarts = sum(rows, 'postgresql_restarts_total');
      if (pr && restarts > pr.restarts) this.bus.emit('ev', { kind: 'pm2', account: this.account, app: p.name || p.ref, action: 'restart', source: 'supabase' });
      if (rows.length) this.prev.set(p.ref, { cpuTotal, cpuIdle, restarts, t: d.t });
      const paused = /INACTIVE|PAUSED/i.test(meta.status || '');
      const status = paused ? 'down' : !d.ok ? (d.rows ? 'degraded' : 'down') : /COMING_UP|RESTORING|UPGRADING/i.test(meta.status || '') ? 'degraded' : 'online';
      return {
        account: this.account, name: p.name || meta.name || p.ref, source: 'supabase', image: 'postgres', status,
        substate: paused ? 'pausado' : meta.status ? meta.status.toLowerCase().replace(/_/g, ' ') : d.ok ? 'activo' : (d.err || 'sin datos'),
        instances: 1, online: status === 'online' ? 1 : 0, cpu: Math.round(cpu * 10) / 10, mem: memTotal ? memTotal - memAvail : 0, uptime: 0,
        restartsTotal: restarts, ref: p.ref, region: meta.region || '',
        memTotal, disk: diskSize ? { used: diskSize - diskAvail, total: diskSize, pct: (diskSize - diskAvail) / diskSize * 100 } : null,
        pooler: has(rows, 'supavisor_connections_active') ? sum(rows, 'supavisor_connections_active') : null,
        dbConns: has(rows, 'pg_stat_database_numbackends') ? sum(rows, 'pg_stat_database_numbackends') : null,
        dbSize: has(rows, 'pg_database_size_bytes') ? sum(rows, 'pg_database_size_bytes') : null,
        authReq: has(rows, 'http_server_duration_milliseconds_count') ? sum(rows, 'http_server_duration_milliseconds_count', l => l.service_type === 'gotrue') : null,
        metrics: rows.length, lastScrape: d.t || 0, mail: this.mail.get(p.ref) || null,
      };
    });
  }

  info() {
    const n = (this.conn.projects || []).length;
    // lo grave del correo de cada proyecto sube como aviso del conector
    const warn = (this.conn.projects || []).flatMap(p => ((this.mail.get(p.ref) || {}).findings || []).filter(f => f.level === 'bad').map(f => `${p.name || p.ref}: ${f.text}`));
    return { id: this.conn.id, type: 'supabase', label: this.label, account: this.account, error: n ? this.error : 'No tiene ningún proyecto: conéctelo de nuevo desde el asistente', lastOk: this.lastOk, projects: n, warn, byAccount: !!this.conn.mgmtToken };
  }
}

// el codigo del proyecto, venga como venga: «abcd...», «https://abcd....supabase.co» o la direccion del panel
function refOf(v) {
  const t = String(v || '').trim().toLowerCase();
  // tambien sale de la cadena de conexion de Postgres (db.<codigo>.supabase.co o postgres.<codigo>@...pooler.supabase.com)
  const m = /^(?:https?:\/\/)?([a-z0-9]{8,40})\.supabase\.(?:co|in|net)\b/.exec(t) || /supabase\.com\/dashboard\/project\/([a-z0-9]{8,40})/.exec(t)
    || /(?:@|\/\/|^)db\.([a-z0-9]{8,40})\.supabase\.(?:co|in|net)\b/.exec(t) || /\/\/postgres\.([a-z0-9]{8,40}):[^@]*@[a-z0-9.-]+\.pooler\.supabase\.com/.exec(t) || /^([a-z0-9]{8,40})$/.exec(t)
    // el ID copiado con algo alrededor («Project ID: abcd…», comillas, un punto final): son 20 letras seguidas
    || /(?:^|[^a-z0-9])([a-z]{20})(?:[^a-z0-9]|$)/.exec(t);
  return m ? m[1] : null;
}
// que clase de llave es, sin probarla: la publica (anon o publishable) no sirve para leer la salud de la base
function keyKind(k) {
  const t = String(k || '').trim();
  if (/^sb_secret_/.test(t)) return 'secret';
  if (/^sb_publishable_/.test(t)) return 'public';
  const p = t.split('.');
  if (p.length === 3 && t.startsWith('eyJ')) { try { const j = JSON.parse(Buffer.from(p[1], 'base64url').toString('utf8')); return j.role === 'service_role' ? 'secret' : j.role === 'anon' ? 'public' : 'unknown'; } catch { return 'unknown'; } }
  return t ? 'unknown' : 'none';
}
// con el token de la cuenta: todos sus proyectos, y de cada uno su llave secreta, sin pedirlas una por una.
// Devuelve [{ ref, name, status, serviceKey?, error? }]; las llaves no salen del servidor
async function discover(mgmtToken) {
  const tok = String(mgmtToken || '').trim();
  if (!/^sbp_[A-Za-z0-9_]{20,}$/.test(tok) && !/^[A-Za-z0-9._-]{30,}$/.test(tok)) throw new Error('Ese no parece un token de cuenta de Supabase. Se crea en supabase.com › su cuenta › Access Tokens y empieza con sbp_');
  if (keyKind(tok) !== 'unknown') throw new Error('Esa es la llave de un proyecto, no el token de su cuenta. El token se crea en supabase.com › su cuenta › Access Tokens y empieza con sbp_');
  let list;
  try { list = JSON.parse(await request(`${MGMT}/v1/projects`, { Authorization: 'Bearer ' + tok })); }
  catch (e) { throw new Error(/ 40[13]$/.test(e.message) ? 'Supabase rechazó el token de la cuenta. Revise que esté completo y que no haya vencido.' : 'No se pudo leer su cuenta de Supabase: ' + e.message); }
  if (!Array.isArray(list)) throw new Error('Supabase respondió algo inesperado');
  const out = [];
  for (const p of list.slice(0, 40)) {
    const ref = refOf(p.id || p.ref), row = { ref, name: String(p.name || ref).slice(0, 60), status: String(p.status || '') };
    if (!ref) continue;
    if (/INACTIVE|PAUSED|REMOVED/i.test(row.status)) { out.push({ ...row, error: 'Está pausado: reactívelo en Supabase y vuelva a buscar' }); continue; }
    try {
      const keys = JSON.parse(await request(`${MGMT}/v1/projects/${ref}/api-keys?reveal=true`, { Authorization: 'Bearer ' + tok }));
      const k = (Array.isArray(keys) ? keys : []).filter(x => x && typeof x.api_key === 'string' && keyKind(x.api_key) === 'secret').sort((a, b) => (/^sb_secret_/.test(b.api_key) ? 1 : 0) - (/^sb_secret_/.test(a.api_key) ? 1 : 0))[0];
      if (!k) throw new Error('Supabase no entregó la llave secreta de este proyecto. Conéctelo con su llave, proyecto por proyecto');
      const v = await verify({ ref, serviceKey: k.api_key, name: row.name });
      out.push({ ...row, serviceKey: v.serviceKey });
    } catch (e) { out.push({ ...row, error: / 40[13]$/.test(e.message) ? 'El token no puede leer las llaves de este proyecto' : e.message }); }
  }
  return out;
}

// antes de guardar: el codigo debe ser valido y la llave debe poder leer la salud del proyecto
async function verify(input) {
  const ref = refOf(input.ref), typed = String(input.ref || '').trim();
  // el motivo exacto, segun la forma de lo que se pego (nunca se guarda ni se muestra lo pegado)
  if (!ref) throw new Error(!typed ? 'Falta el ID del proyecto. Está en Supabase › Project Settings › General › Project ID: son 20 letras, como abcdefghijklmnopqrst'
    : keyKind(typed) !== 'unknown' ? 'En «ID del proyecto» pegó una llave. Ahí va el ID (20 letras, en Project Settings › General); la llave va en el campo de abajo.'
    : /^[\w .áéíóúñ-]{1,60}$/i.test(typed) && !/\./.test(typed) ? 'Eso parece el nombre del proyecto, no su ID. El ID está en Supabase › Project Settings › General › Project ID: son 20 letras, como abcdefghijklmnopqrst'
    : 'No reconozco eso como un proyecto de Supabase. Pegue su ID (20 letras, en Supabase › Project Settings › General › Project ID) o su dirección https://<ID>.supabase.co');
  const key = String(input.serviceKey || '').trim(), kind = keyKind(key);
  if (kind === 'none') throw new Error('Falta la llave secreta del proyecto: en Supabase › Project Settings › API Keys, la «secret key» (sb_secret_…) o la «service_role».');
  if (kind === 'public') throw new Error('Esa es la llave pública (anon o publishable): con ella no se puede leer la salud de la base. Use la «secret key» (sb_secret_…) o la «service_role», en Supabase › Project Settings › API Keys.');
  try { await request(`${HOST || `https://${ref}.supabase.co`}/customer/v1/privileged/metrics`, { Authorization: 'Basic ' + Buffer.from('service_role:' + key).toString('base64') }); }
  catch (e) {
    if (/ 40[13]$/.test(e.message)) throw new Error('Supabase rechazó la llave para ese proyecto. Revise que sea la «secret key» o la «service_role» de ESE proyecto y que esté completa.');
    if (/ENOTFOUND|EAI_AGAIN/.test(e.message)) throw new Error('Ese proyecto no existe o su código está mal escrito: no se encontró ' + ref + '.supabase.co.');
    if (/ 5\d\d$|timeout/.test(e.message)) throw new Error('El proyecto no respondió (puede estar pausado). Reactívelo en Supabase y vuelva a intentar.');
    throw new Error('No se pudo leer el proyecto: ' + e.message);
  }
  return { ref, serviceKey: key, name: String(input.name || '').replace(/\s+/g, ' ').trim().slice(0, 60) || ref };
}

module.exports = { SupabaseConnector, parseProm, refOf, keyKind, verify, discover, mailOf };
