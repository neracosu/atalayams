'use strict';
// Proyeccion publica/privada de todo lo que sale hacia el navegador.
// En modo publico los detalles NUNCA salen del servidor.
const crypto = require('crypto');

const salt = crypto.randomBytes(8).toString('hex');
const alias = s => s == null ? null : crypto.createHash('sha1').update(salt + s).digest('hex').slice(0, 10);

// Aun en modo privado se tapan secretos evidentes
const SECRET_RES = [
  [/\b(sk-[A-Za-z0-9_-]{12,}|sk_live_\w{8,}|ghp_\w{20,}|gh[ousr]_\w{20,}|xox[abpr]-[\w-]{10,}|AKIA[0-9A-Z]{16}|AIza[\w-]{30,})/g, '•••'],
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, '•••jwt'],
  [/(\bBearer\s+)\S+/gi, '$1•••'],
  [/((?:pass(?:word|wd)?|pwd|secret|token|api[_-]?key|auth(?:orization)?|bearer)["']?\s*[=:]\s*["']?)[^\s"'&]+/gi, '$1•••'],
  [/(\b(?:mysql|mysqldump|mariadb|mariadb-dump)\b[^|;&]*?\s-p)(?!\s)\S+/g, '$1•••'],
  [/(\/\/[^/\s:@]+:)[^@\s]+@/g, '$1•••@'],
  [/\b[A-Fa-f0-9]{32,}\b/g, '•••'],
  [/\b(?=[\w+-]*\d)(?=[\w+-]*[a-z])(?=[\w+-]*[A-Z])[\w+-]{32,}={0,2}/g, '•••'],
];
function scrub(s) {
  if (typeof s !== 'string') return s;
  let out = s;
  for (const [re, rep] of SECRET_RES) out = out.replace(re, rep);
  return out;
}

// titulos de las revisiones de proyectos sin nombres (modo publico)
const GENERIC_CHECK = {
  repo: { ok: 'Código en un repositorio', any: 'Sin repositorio conocido' }, public: { any: 'Repositorio público' },
  secrets: { ok: 'Sin secretos en el repo', any: 'Archivos con secretos en el repo' }, gitignore: { ok: '.gitignore correcto', any: '.gitignore incompleto' },
  deps: { ok: 'Dependencias sin alertas', unknown: 'Dependencias sin revisar', any: 'Dependencias con fallas de seguridad' },
  lockfile: { any: 'Sin lockfile' }, ci: { ok: 'Tiene CI', any: 'Sin CI' }, deploy: { ok: 'En línea', any: 'Despliegue o servicio con fallas' },
  ssl: { ok: 'Certificados válidos', unknown: 'Certificados sin revisar', any: 'Certificado por vencer o inválido' },
  uptime: { ok: 'Responde bien', any: 'Responde mal o lento' }, domain: { ok: 'Dominio al día', any: 'Dominio por vencer o vencido' },
  stale: { any: 'Sin cambios hace tiempo' },
};

const STATION_LABEL = {
  library: 'Leyendo', workshop: 'Editando', terminal: 'Terminal', antenna: 'Consultando la web',
  portal: 'Coordinando subagentes', waiting: 'Esperando respuesta', desk: 'Organizando',
};

// categoria aproximada para apps nuevas que aun no estan en config.json
function guessApp(name, image = '') {
  const n = (String(name) + ' ' + String(image)).toLowerCase();
  const rules = [[/postgres|mysql|mariadb|mongo|clickhouse|cockroach|timescale|pgbouncer/, 'Base de datos', 'db'], [/redis|valkey|memcache|keydb|dragonfly/, 'Caché', 'cache'],
    [/nginx|traefik|caddy|haproxy|envoy|litespeed/, 'Proxy web', 'web'], [/grafana|prometheus|loki|uptime-kuma|netdata|metabase/, 'Monitoreo', 'chart'],
    [/n8n|node-red|airflow|temporal/, 'Automatizaciones', 'gear'], [/minio|seaweed|garage/, 'Almacenamiento', 'box'], [/rabbit|kafka|nats|mosquitto|bull/, 'Colas de mensajes', 'gear'],
    [/cron|schedul/, 'Tarea programada', 'clock'], [/mail|email|smtp/, 'Correo', 'mail'], [/worker|queue|jobs?\b/, 'Procesos en cola', 'gear'],
    [/pay|pago|billing/, 'Pagos', 'card'], [/shop|store|tienda/, 'Tienda online', 'shop'], [/hotel|pms/, 'Sistema hotelero', 'hotel'],
    [/(^|[-_.\s])(bot|wa)([-_.\s]|$)|whatsapp|telegram|chat/, 'Mensajería', 'chat'], [/wordpress/, 'Sitio WordPress', 'wp'],
    [/(^|[-_.\s])api([-_.\s]|$)|gateway/, 'API', 'web']];
  for (const [re, label, icon] of rules) if (re.test(n)) return { label, icon };
  return { label: '', icon: null };
}
// icono pixel para lo que no tiene uno conocido: se elige "al azar" pero fijo para cada proyecto (sale de su id,
// que ya es un alias en modo publico), de una lista de carteles que no dicen nada del tipo de proyecto
const ICON_POOL = ['trophy', 'shop', 'hotel', 'ship', 'chart', 'dice', 'gear', 'heart', 'game', 'calendar', 'bowling', 'clock', 'support', 'chat', 'card', 'mail', 'glass', 'db', 'cache', 'box', 'web'];
function pickIcon(seed) { let h = 2166136261; for (const c of String(seed)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return ICON_POOL[(h >>> 0) % ICON_POOL.length]; }

function makePrivacy(cfg) {
  const acc = id => cfg.accounts[id] || { label: id, publicLabel: id, color: '#94a3b8' };
  const accLabel = (id, priv) => id == null ? null : (priv || cfg.public.showAccountNames ? acc(id).label : acc(id).publicLabel);
  const accId = (id, priv) => id == null ? null : (priv || id === 'root' ? id : 'd' + alias('acct:' + id).slice(0, 8));
  // en publico solo se aceptan alias: el nombre real no debe poder confirmarse probando
  const findAccount = (id, priv) => Object.keys(cfg.accounts).find(a => accId(a, priv) === id) || null;

  // indice estable de app por cuenta para "Servicio N"
  const appIdx = new Map();
  function appAlias(account, name) {
    const k = account + '/' + name;
    if (!appIdx.has(k)) {
      const n = [...appIdx.keys()].filter(x => x.startsWith(account + '/')).length + 1;
      appIdx.set(k, 'Servicio ' + n);
    }
    return appIdx.get(k);
  }
  // catalogo de config.json: que es cada app (etiqueta e icono), visible en ambos modos
  const FRAMEWORK = { nextjs: 'App Next.js', vite: 'App Vite', remix: 'App Remix', astro: 'Sitio Astro', sveltekit: 'App SvelteKit', 'sveltekit-1': 'App SvelteKit',
    nuxtjs: 'App Nuxt', gatsby: 'Sitio Gatsby', 'create-react-app': 'App React', angular: 'App Angular', vue: 'App Vue', hugo: 'Sitio Hugo', docusaurus: 'Documentación' };
  const appInfo = (account, name, image, framework) => (cfg.apps || {})[account + '/' + name]
    || (framework !== undefined ? { label: FRAMEWORK[framework] || 'Proyecto Vercel', icon: null } : guessApp(name, image));
  const appName = (account, name, priv, image, framework) => name == null ? null
    : (priv || cfg.public.showAppNames ? name : (appInfo(account, name, image, framework).label || appAlias(account, name)));

  // sondeos web de un sitio o app en 24 h y si tiene algo expuesto (para su ficha)
  function probesOf(ctx, key) {
    const s = ctx.webdef && ctx.webdef.sites.get(key);
    if (!s) return null;
    const exposed = [...ctx.webdef.exposed.values()].filter(x => (x.app ? 'app:' + x.account + '/' + x.app : 'site:' + x.site) === key && x.verdict === 'exposed').length;
    return { n: s.hits.length, exposed };
  }

  // que hacer en cada caso: de las definiciones (se actualizan solas)
  const rulesOf = ctx => (ctx.defs ? ctx.defs.rules : require('./defs').DEFAULT);

  function agent(a, priv, account) {
    const base = {
      id: priv ? a.id : alias(a.id), state: a.state, station: a.station, activity: STATION_LABEL[a.station] || '',
      tokensOut: a.tokensOut, tools: a.tools, errors: a.errors, since: a.since, lastActivity: a.lastActivity,
      model: a.model ? a.model.replace(/^claude-/, '').replace(/-\d{8}$/, '') : '',
      hooks: !!a.hooks, waitKind: a.waitKind || null, waitSince: a.waitSince || null, remote: !!a.remote,
    };
    if (priv) Object.assign(base, {
      tool: a.tool, detail: scrub(a.detail), title: scrub(a.title), lastPrompt: scrub(a.lastPrompt),
      permMode: a.permMode, waitMessage: scrub(a.waitMessage || ''), project: a.cwd ? a.cwd.replace(/^\/home\/[^/]+\/?/, '~/').replace(/^\/root\/?/, '/root/') : '',
      agentType: a.agentType,
    });
    return base;
  }

  const siteId = g => alias('site:' + g.id);
  const tildeP = p => p ? String(p).replace(/^\/home\/[^/]+\//, '~/') : null;
  // silos de datos (mapa): por cuenta, sus bases MySQL con su actividad y las tuberias a los sitios que las usan;
  // y los proyectos de Supabase unidos a su app. Solo cantidades y alias: nada de nombres de bases ni consultas.
  function silosOf(ctx, priv) {
    const A = ctx.dbAudit, X = ctx.dbActivity;
    const act = X && X.available() ? X.snapshot() : null;
    const byDb = new Map((act ? act.dbs : []).map(x => [x.db, x]));
    const by = new Map();
    if (A && A.available()) for (const d of A.cached()) {
      if (d.system || !d.account) continue;
      const x = by.get(d.account) || { account: accId(d.account, priv), size: 0, n: 0, conns: 0, active: 0, busy: 0, slow: false, links: [] };
      x.size += d.size; x.n++;
      const a = byDb.get(d.name);
      if (a) {
        x.conns += a.conns; x.active += a.active; x.busy = Math.max(x.busy, a.busy);
        if (a.peak && a.peak.time >= 10) x.slow = true;
        const p = X.projectOf(d.name);
        if (p && (p.app || p.site)) x.links.push({ kind: p.app ? 'app' : 'site', id: p.app ? alias(p.account + '/' + p.app) : alias('site:' + p.site), active: a.active, busy: a.busy });
      }
      by.set(d.account, x);
    }
    for (const x of by.values()) x.sleep = Math.max(0, x.conns - x.active);
    // Supabase unido a la app de su mismo proyecto (el mapa de proyectos ya los junta)
    const sb = [];
    if (ctx.projects) for (const pr of ctx.projects.build()) {
      const s = pr.parts.find(q => q.kind === 'supabase' && q.app), o = pr.parts.find(q => q.kind !== 'supabase' && q.app);
      if (s && o) sb.push({ from: alias(s.app.account + '/' + s.app.name), to: alias(o.app.account + '/' + o.app.name) });
    }
    return { list: [...by.values()], hot: act && act.max ? Math.round(act.conns / act.max * 100) / 100 : 0, sb };
  }
  // vigilancia (escaneo, scraping o pico de visitas): motivo y cantidades; la IP principal solo en privado
  function watchOf(ctx, key, priv) {
    const w = ctx.watch && ctx.watch.of(key);
    if (!w) return undefined;
    const { topIp, path, ...pub } = w;
    // se puede bloquear solo si la defensa lo permite (nunca 127.0.0.1, Cloudflare, el servidor ni usuarios)
    return priv ? { ...w, blockable: !!(topIp && ctx.defense && ctx.defense.available() && !ctx.defense.why(topIp) && !ctx.defense.isBlocked(topIp)) } : pub;
  }
  // proyecto donde trabaja una sesion: la app de PM2 o el sitio cuya carpeta contiene su cwd (gana la mas larga)
  function sessionTarget(ctx, s, priv) {
    const t = s.cwd && !s.remote && ctx.claude.projectOf ? ctx.claude.projectOf(s.cwd) : null;
    if (!t) return null;
    if (t.app) return { kind: 'app', go: 'app:' + alias(t.account + '/' + t.app), name: appName(t.account, t.app, priv) };
    const g = ctx.logs.sites.find(x => x.id === t.site);
    return g ? { kind: 'site', go: 'site:' + siteId(g), name: priv ? g.domain : ctx.logs.siteLabel(g) } : null;
  }
  // dominio de una app: el sitio que la sirve (proxy o carpeta) o su primer dominio en Vercel
  function appDomain(ctx, a) {
    for (const g of ctx.logs.groups ? ctx.logs.groups.values() : []) if (g.app === a.name && g.account === a.account) return g.domain;
    return (a.domains && a.domains[0]) || null;
  }
  function siteSummary(ctx, g, priv) {
    const { logs } = ctx;
    return {
      id: siteId(g), account: accId(g.account, priv), type: g.type,
      name: priv ? g.domain : logs.siteLabel(g), kind: logs.siteLabel(g), icon: logs.siteIcon(g) || pickIcon(siteId(g)),
      watch: watchOf(ctx, 'site:' + g.id, priv),
      php: ctx.saturation ? ctx.saturation.siteState(g.id) || undefined : undefined,
      phpbad: ctx.phpFiles ? ctx.phpFiles.siteState(g.id) || undefined : undefined,
      // favicon real del sitio: solo en privado (delata la marca)
      favicon: priv && ctx.favicons ? ctx.favicons.ready(g.domain) || undefined : undefined,
      reqMin: logs.lastMinute.perSite[g.id] || 0, status: ctx.websites && ctx.websites.isDown(g.id) ? 'down' : 'online', lastSeen: g.lastSeen,
    };
  }
  // estadisticas de la ultima hora de una entidad (app o sitio)
  function hourStats(roll, priv) {
    if (!roll) return null;
    const top = (f, k) => roll.top(f, k).map(([key, n]) => ({ key, n }));
    const req = new Map(roll.top('req', 5));
    return {
      total: req.get('all') || 0, bots: req.get('bot') || 0, errors: req.get('err') || 0,
      countries: top('cc', 10), agents: top('ua', 8), bots_: top('botname', 8), devices: top('dev', 3), status: top('status', 5),
      ...(priv ? { paths: top('path', 10).map(x => ({ ...x, key: scrub(x.key) })), refs: top('ref', 8), domains: top('dom', 10) } : {}),
    };
  }
  const visit = (r, priv) => priv
    ? { t: r.t, method: r.method, path: scrub(r.path), status: r.status, ip: r.ip, bot: r.bot, domain: r.domain, cc: r.cc, country: r.country,
        ua: r.ua, uaKind: r.uaKind, mobile: r.mobile, ref: scrub(r.ref || ''), bytes: r.bytes }
    : { t: r.t, method: r.method, status: r.status, bot: r.bot, cc: r.cc, country: r.country, ua: r.ua, uaKind: r.uaKind, mobile: r.mobile };

  function state(ctx, priv) {
    const { host, claude, logs } = ctx;
    const accounts = Object.entries(cfg.accounts).map(([id, a]) => ({
      id: accId(id, priv), label: accLabel(id, priv), color: a.color,
      ...(priv && id !== 'root' && !id.startsWith('_') ? { cpanel: id, main: logs.mainDomain.get(id) || '', panel: logs.platform && logs.platform.panel ? logs.platform.panel.label.split('/')[0] : '' } : {}),
      sites: logs.sites.filter(g => g.account === id).length,
      claudeProcs: host.claudeProcs[id] || 0,
      reqMin: logs.lastMinute.perAccount[id] || 0,
      quota: ctx.quotas && ctx.quotas.available() && id !== 'root' ? ctx.quotas.alert(id) || undefined : undefined,
    }));
    return {
      priv,
      system: host.system,
      top: host.topProcs,
      accounts,
      apps: host.apps.map(a => ({
        id: alias(a.account + '/' + a.name), account: accId(a.account, priv), name: (priv && a.source === 'beat' && a.beat && a.beat.label) || appName(a.account, a.name, priv, a.image, a.source === 'vercel' ? a.framework || '' : undefined), source: a.source,
        kind: appInfo(a.account, a.name, a.image, a.source === 'vercel' ? a.framework || '' : undefined).label || '', icon: appInfo(a.account, a.name, a.image, a.source === 'vercel' ? a.framework || '' : undefined).icon || pickIcon(alias(a.account + '/' + a.name)),
        favicon: priv && ctx.favicons ? ctx.favicons.ready(appDomain(ctx, a)) || undefined : undefined,
        status: a.status, instances: a.instances, online: a.online, cpu: Math.round(a.cpu * 10) / 10, mem: a.mem,
        reqMin: logs.lastMinute.perApp[a.account + '/' + a.name] || a.cfReqMin || 0,
        port: priv ? a.port : undefined,
        watch: watchOf(ctx, 'app:' + a.account + '/' + a.name, priv),
        sb: a.source === 'supabase' ? { size: a.dbSize || 0, conns: a.dbConns != null ? a.dbConns : a.pooler, disk: a.disk ? Math.round(a.disk.pct) : null } : undefined,
      })),
      sites: logs.sites.map(g => siteSummary(ctx, g, priv)),
      sessions: claude.list().map(s => ({ ...agent(s, priv), account: accId(s.account, priv), target: sessionTarget(ctx, s, priv), subagents: s.subagents.map(x => agent(x, priv)) })),
      saturation: ctx.saturation && ctx.saturation.available() ? ctx.saturation.state() : null,
      silos: silosOf(ctx, priv),
      // la carcel: cuantos presos hay (para dibujarlos) y cuantos son de Atalaya o del firewall
      jail: ctx.defense && ctx.defense.available() ? (l => ({ n: l.length, atalaya: l.filter(r => !r.permanent).length, quarantine: ctx.phpFiles ? ctx.phpFiles.jailed.length : 0 })) (ctx.defense.jail()) : null,
      traffic: logs.slidingMinute(),
      trafficPoint: logs.history.a[logs.history.a.length - 1] || null,
      keys: (ctx.services ? ctx.services.keys : []).map(k => ({ label: k.label, state: k.state })),
      security: logs.security,
      webdef: ctx.webdef ? ctx.webdef.summary() : null,
      defs: ctx.defs ? ctx.defs.info() : null,
      mail: logs.mail,
      // correos esperando en la cola (de la revision de la cola): la oficina de correos muestra la pila
      mailQueue: (() => { const sec = ctx.hostAudit && ctx.hostAudit.result && ctx.hostAudit.result.sections.find(x => x.id === 'mail'); const it = sec && sec.items.find(i => /en cola/.test(i.label)); return it ? Number(it.value) || 0 : null; })(),
      // salud del servidor: estado de cada revision (sin detalles: esos van en la ficha)
      health: ctx.hostAudit && ctx.hostAudit.result ? ctx.hostAudit.result.sections.map(s => ({ id: s.id, title: s.title, icon: s.icon, status: s.status,
        bad: s.findings.filter(f => f.sev === 'bad').length, warn: s.findings.filter(f => f.sev === 'warn').length })) : [],
    };
  }

  function event(e, priv) {
    const out = { kind: e.kind, t: Date.now() };
    const account = e.account;
    const acct = accId(account, priv);
    switch (e.kind) {
      case 'http':
        Object.assign(out, { account: acct, app: e.app ? alias(account + '/' + e.app) : null, site: e.site ? alias('site:' + e.site) : null,
          status: e.status, bot: e.bot, method: e.method, cc: e.cc, country: e.country, ua: e.ua ? e.ua.name : '' });
        if (e.via) Object.assign(out, { via: e.via, region: e.region, cache: e.cache });
        if (priv) Object.assign(out, { domain: e.domain, path: scrub(e.path), ip: e.ip, appName: e.app, refHost: e.refHost });
        else out.label = accLabel(account, false);
        break;
      case 'claude':
        Object.assign(out, { action: e.action, account: acct, sid: priv ? e.sid : alias(e.sid), agent: e.agent ? (priv ? e.agent : alias(e.agent)) : null,
          station: e.station, activity: STATION_LABEL[e.station] || '', label: accLabel(account, priv) });
        if (e.waitKind) out.waitKind = e.waitKind;
        // animaciones de comunicacion: mismos ids que el estado (apps y sitios con alias en ambos modos)
        if (e.action === 'touch' && e.target) Object.assign(out, { mode: e.mode, app: e.target.app ? alias(e.target.account + '/' + e.target.app) : null, site: e.target.site ? alias('site:' + e.target.site) : null });
        if (e.action === 'message') out.to = e.to == null ? null : e.to === '' ? '' : (priv ? e.to : alias(e.to));
        if (priv) Object.assign(out, { tool: e.tool, detail: scrub(e.detail), text: scrub(e.text) });
        break;
      case 'phpfile':
        // archivo PHP sospechoso (o alguien lo pidio): el sitio con alias y el motivo; ruta e IP solo en privado
        Object.assign(out, { action: e.action, account: acct, label: accLabel(account, priv), site: e.site ? alias('site:' + e.site) : null, why: e.why, name: priv ? e.domain : null, status: e.status || null });
        if (priv) Object.assign(out, { path: e.path, ip: e.ip || null });
        break;
      case 'saturation':
        // servidor al limite o de vuelta a la normalidad: las causas son genericas (sin nombres), valen en publico
        Object.assign(out, { action: e.action, causes: e.causes || [] });
        break;
      case 'defense': {
        // bloqueo, desbloqueo o vencimiento: motivo y sitio con alias; la IP solo en privado
        Object.assign(out, { action: e.action, reason: e.reason, by: e.by === 'auto' ? 'auto' : 'manual', hours: e.hours, account: acct, label: accLabel(account, priv),
          app: e.app ? alias(account + '/' + e.app) : null, site: e.site ? alias('site:' + e.site) : null, name: e.app ? appName(account, e.app, priv) : priv ? e.domain : null });
        if (priv) out.ip = e.ip;
        break;
      }
      case 'watch': {
        // un sitio entra o sale de vigilancia: motivo y cantidades en publico; dominio e IP solo en privado
        Object.assign(out, { action: e.action, reason: e.reason, n: e.n, ips: e.ips, account: acct, label: accLabel(account, priv),
          app: e.app ? alias(account + '/' + e.app) : null, site: e.site ? alias('site:' + e.site) : null,
          name: e.app ? appName(account, e.app, priv) : priv ? e.domain : null });
        if (priv) Object.assign(out, { domain: e.domain, ip: e.ip, path: e.path });
        break;
      }
      case 'db': {
        // consulta lenta: en publico la base va con alias y sin consulta; el edificio con el mismo alias que el estado
        const t = e.target;
        Object.assign(out, { action: e.action, account: acct, label: accLabel(account, priv), secs: e.secs,
          db: priv ? e.db : 'b' + alias('db:' + e.db).slice(0, 8),
          app: t && t.app ? alias(t.account + '/' + t.app) : null, site: t && t.site ? alias('site:' + t.site) : null });
        if (priv) out.query = e.query;
        break;
      }
      case 'pm2':
        Object.assign(out, { action: e.action, account: acct, app: alias(account + '/' + e.app), appName: appName(account, e.app, priv), label: accLabel(account, priv) });
        break;
      case 'attack': case 'block': case 'login':
        Object.assign(out, { service: e.service, reason: e.reason });
        if (priv) Object.assign(out, { ip: e.ip, user: e.user, method: e.method });
        break;
      case 'probe':
        // en publico: familia y resultado, y los mismos alias de app o sitio que el estado (para ubicarlo)
        Object.assign(out, { account: acct, app: e.app ? alias(account + '/' + e.app) : null, site: e.site ? alias('site:' + e.site) : null,
          fam: e.fam, status: e.status, blocked: !!e.blocked, exposed: !!e.exposed, confirmed: !!e.confirmed, cc: e.cc || null, country: e.country || null, label: accLabel(account, priv) });
        if (priv) Object.assign(out, { path: e.path, ip: e.ip });
        break;
      case 'mail':
        // la cuenta (con alias en publico) para que el sobre salga de su distrito o llegue a el
        Object.assign(out, { dir: e.dir, account: acct, label: e.account ? accLabel(e.account, priv) : 'Servidor', cat: e.cat || null, why: e.why || null });
        break;
      case 'domain':
        Object.assign(out, { action: e.action, account: acct, label: accLabel(account, priv), typeLabel: e.typeLabel });
        if (priv) Object.assign(out, { domain: e.domain, what: e.what });
        break;
      case 'deploy':
        Object.assign(out, { action: e.action, account: acct, app: alias(account + '/' + e.app), appName: appName(account, e.app, priv), target: e.target, label: accLabel(account, priv) });
        if (priv) Object.assign(out, { url: e.url, branch: e.branch, commit: scrub(String(e.commit || '').split('\n')[0].slice(0, 120)), creator: e.creator });
        break;
      case 'keysvc':
        Object.assign(out, { action: e.action, label: e.label });
        break;
      case 'cron':
        // un Worker con reloj dejo de correr (o volvio)
        Object.assign(out, { action: e.action, account: acct, app: alias(account + '/' + e.app), appName: appName(account, e.app, priv), label: accLabel(account, priv), since: e.since || 0 });
        break;
      case 'beat':
        // un latido se atraso, aviso que fallo, volvio o llego por primera vez; el nombre y la nota solo en privado
        Object.assign(out, { action: e.action, account: acct, app: alias(account + '/' + e.app), appName: priv ? e.name : appName(account, e.app, false), label: accLabel(account, priv), downFor: e.downFor || 0 });
        if (priv && e.note) out.note = e.note;
        break;
      case 'webrule':
        // la revision diaria encontro (o ya no encuentra) una falta grave en un sitio vigilado
        Object.assign(out, { action: e.action, account: acct, label: accLabel(account, priv), site: alias('site:' + e.site), rule: e.rule, text: e.text, name: priv ? e.domain : null });
        break;
      case 'uptime':
        // un sitio vigilado deja de responder o vuelve: en publico el alias y el motivo; el dominio solo en privado
        Object.assign(out, { action: e.action, account: acct, label: accLabel(account, priv), site: alias('site:' + e.site), why: e.why || null, downFor: e.downFor || 0, name: priv ? e.domain : null });
        break;
      case 'account':
        // una cuenta dada de baja ya no esta en cfg.accounts: las etiquetas vienen en el evento
        Object.assign(out, { action: e.action, account: acct,
          // al aparecer o irse la cuenta puede no estar en la configuracion: las etiquetas vienen en el evento
          label: e.privLabel || e.publicLabel ? (priv ? e.privLabel : e.publicLabel || 'Distrito') : accLabel(account, priv) });
        break;
      default: return null;
    }
    return out;
  }

  // salud del servidor. En publico: estado, cifras y cuantos hallazgos hay; en privado, cada hallazgo y sus filas
  function healthOut(ctx, priv) {
    const r = ctx.hostAudit && ctx.hostAudit.get();
    if (!r) return null;
    const busy = ctx.jobs && ctx.jobs.busy();
    return { t: r.t, running: !!(busy && busy.name === 'updates'), priv,
      sections: r.sections.map(s => ({ id: s.id, title: s.title, icon: s.icon, status: s.status, canCheck: !!s.canCheck, items: s.items,
        findings: priv ? s.findings.map(f => ({ sev: f.sev, title: f.title, detail: f.detail, fix: f.fix, names: f.names,
          rows: (f.rows || []).slice(0, 40).map(x => ({ user: x.user, schedule: x.schedule, command: x.command && scrub(x.command), port: x.port, name: x.name, proc: x.proc, ip: x.ip, n: x.n, t: x.t || x.last, svc: x.svc, svcs: x.svcs, users: x.users, newIp: x.newIp })) }))
          : s.findings.filter(f => f.sev !== 'info').map(f => ({ sev: f.sev })) })) };
  }

  // Detalle de una entidad para el panel lateral. Todo pasa por la misma regla publico/privado.
  function detail(ctx, kind, id, priv, opts = {}) {
    const { host, claude, logs, history } = ctx;
    const tilde = p => p ? p.replace(/^\/home\/[^/]+\/?/, '~/').replace(/^\/root\/?/, '/root/') : '';
    const fw = a => a.source === 'vercel' ? a.framework || '' : undefined;
    const appSummary = a => ({ id: alias(a.account + '/' + a.name), name: (priv && a.source === 'beat' && a.beat && a.beat.label) || appName(a.account, a.name, priv, a.image, fw(a)), category: a.source === 'beat' ? '' : appInfo(a.account, a.name, a.image, fw(a)).label || '',
      icon: appInfo(a.account, a.name, a.image, fw(a)).icon || pickIcon(alias(a.account + '/' + a.name)), favicon: priv && ctx.favicons ? ctx.favicons.ready(appDomain(ctx, a)) || undefined : undefined, source: a.source, cfKind: a.cfKind, status: a.status, cpu: Math.round(a.cpu * 10) / 10, mem: a.mem,
      reqMin: logs.lastMinute.perApp[a.account + '/' + a.name] || a.cfReqMin || 0 });
    const sessSummary = x => ({ id: priv ? x.id : alias(x.id), title: priv ? scrub(x.title) : '', state: x.state,
      activity: STATION_LABEL[x.station] || '', waitKind: x.waitKind || null });
    const dbId = (d, p) => p ? d.name : 'b' + alias('db:' + d.name).slice(0, 8);
    const dbSummary = (d, p) => ({ id: dbId(d, p), name: p ? d.name : 'Base ' + alias('db:' + d.name).slice(0, 4).toUpperCase(), size: d.size, tables: d.tables,
      lastWrite: d.lastWrite, shadow: d.shadow, account: accId(d.account, p), accountLabel: d.account ? accLabel(d.account, p) : null });

    if (kind === 'app') {
      const a = host.apps.find(x => alias(x.account + '/' + x.name) === id);
      if (!a) return null;
      const k = a.account + '/' + a.name;
      const events = (history.appEvents.get(k)?.toArray() || []);
      const out = {
        kind, ...appSummary(a), account: accId(a.account, priv), accountLabel: accLabel(a.account, priv), color: acc(a.account).color,
        instances: a.instances, online: a.online, uptime: a.uptime, restarts: events.filter(e => e.action === 'restart').length,
        hist: history.appHist.get(k)?.toArray() || [], req: history.appReq.get(k)?.toArray() || [], events,
        recent: (history.appRecent.get(k)?.toArray() || []).slice(-30).reverse().map(r => visit(r, priv)),
        stats: hourStats(history.rolls.get(k), priv),
        visitorsNow: history.visitorsNow(k), today: history.todayOf(k),
      };
      Object.assign(out, { source: a.source || 'pm2', substate: a.substate || '', restartsTotal: a.restartsTotal });
      if (priv && a.source === 'systemd') Object.assign(out, { unit: a.unit, user: a.user, exec: scrub(a.exec || ''), description: a.description });
      if (priv && a.source === 'docker') Object.assign(out, { containerId: a.id, image: a.image, compose: a.compose, service: a.service, ports: a.ports });
      if (a.source === 'vercel') Object.assign(out, { framework: a.framework,
        deployments: (a.deployments || []).map(d => ({ state: d.state, target: d.target, created: d.created, ready: d.ready,
          ...(priv ? { url: d.url, branch: d.branch, commit: scrub(String(d.commit || '').split('\n')[0].slice(0, 120)), creator: d.creator } : {}) })),
        ...(priv ? { domains: a.domains } : {}) });
      // Cloudflare: despliegues de Pages, corridas de cada Worker y las visitas de la zona (totales, sin IPs ni paginas)
      if (a.source === 'cloudflare') Object.assign(out, { cfKind: a.cfKind,
        deployments: (a.deployments || []).map(d => ({ state: d.state, target: d.target, created: d.created, ready: d.ready,
          ...(priv ? { url: d.url, branch: d.branch, commit: scrub(String(d.commit || '').split('\n')[0].slice(0, 120)), creator: d.creator } : {}) })),
        traffic: a.traffic ? { day: a.traffic.day, hours: a.traffic.hours, days: a.traffic.days, countries: a.traffic.countries, at: a.traffic.at, ...(priv ? { zone: a.zone } : {}) } : null,
        ...(a.cfKind === 'worker' ? { runs: a.runs, runErrors: a.runErrors, lastRun: a.lastRun, silent: a.silent, every: a.every, hasCron: !!(a.crons && a.crons.length), ...(priv ? { crons: a.crons } : {}) } : {}),
        ...(priv ? { domains: a.domains, repoHost: a.repoHost } : {}) });
      // latido: cada cuanto debe llegar, cuando llego el ultimo y como le fue; el nombre y la nota solo en privado
      if (a.source === 'beat' && ctx.beats) out.beat = ctx.beats.info(a.name, true) && (({ id, name, lastNote, ...pub }) => priv ? { id, name, lastNote, ...pub } : pub)(ctx.beats.info(a.name, true));
      // el correo del proyecto: en publico solo el proveedor y los avisos; el servidor y el remitente, en privado
      if (a.source === 'supabase' && a.mail) out.mail = a.mail.error ? { error: a.mail.error } : { custom: a.mail.custom, provider: a.mail.provider, sandbox: a.mail.sandbox, perHour: a.mail.perHour, everySecs: a.mail.everySecs, confirm: a.mail.confirm, findings: a.mail.findings, at: a.mail.at,
        ...(priv ? { host: a.mail.host, port: a.mail.port, sender: a.mail.sender, senderName: a.mail.senderName } : {}) };
      if (a.source === 'supabase') Object.assign(out, { memTotal: a.memTotal, disk: a.disk, pooler: a.pooler, dbConns: a.dbConns, dbSize: a.dbSize,
        authReq: a.authReq, metrics: a.metrics, lastScrape: a.lastScrape, ...(priv ? { ref: a.ref, region: a.region } : {}) });
      if (!priv && a.source === 'docker') out.image = String(a.image || '').split('/').pop().split(':')[0]; // solo el nombre de la imagen
      if (priv) {
        out.port = a.port; out.cwd = tilde(a.cwd); out.pm2 = a.source === 'pm2' || !a.source ? a.name : ''; out.mode = a.mode;
        // dominios de los grupos (carpetas) que sirve esta app
        const doms = [];
        for (const g of logs.groups.values()) if (g.account === a.account && g.app === a.name) doms.push(...g.domainList);
        out.domains = [...new Set([...doms, ...(a.source === 'cloudflare' ? a.domains || [] : [])])].slice(0, 12);
      }
      out.probes = probesOf(ctx, 'app:' + a.account + '/' + a.name);
      out.watch = watchOf(ctx, 'app:' + a.account + '/' + a.name, priv);
      if (ctx.analytics && logs.groups && [...logs.groups.values()].some(g => g.account === a.account && g.app === a.name)) { out.analytics = ctx.analytics.summary(k); out.cfOnly = ctx.analytics.cfOnly(k); }
      return out;
    }

    // revisiones del servidor. En publico: estado, cifras y cuantos hallazgos hay; en privado, cada hallazgo y sus filas
    if (kind === 'audit') { const h = healthOut(ctx, priv); return h && { kind, focus: id && id !== 'all' ? id : null, ...h }; }
    if (kind === 'site') {
      const g = logs.sites.find(x => siteId(x) === id);
      if (!g) return null;
      const k = 'site:' + g.id;
      const out = {
        // kind va despues: siteSummary trae su etiqueta en kind
        ...siteSummary(ctx, g, priv), kind, category: logs.siteLabel(g), accountLabel: accLabel(g.account, priv), color: acc(g.account).color,
        req: history.appReq.get(k)?.toArray() || [],
        recent: (history.appRecent.get(k)?.toArray() || []).slice(-30).reverse().map(r => visit(r, priv)),
        stats: hourStats(history.rolls.get(k), priv),
        visitorsNow: history.visitorsNow(k), today: history.todayOf(k), live: !!(logs.liveOn && logs.liveOn()),
      };
      if (priv) Object.assign(out, { domains: g.domainList, docroot: tilde(g.docroot), wpVersion: g.wpVersion || '', proxyPort: g.proxyPort || null });
      out.probes = probesOf(ctx, 'site:' + g.id);
      // sitio vigilado por su dominio: como responde ahora y en 24 horas, y la linea del script para contar sus visitas
      const up = ctx.websites && ctx.websites.info(g.id, priv);
      if (up) { out.webrules = ctx.webrules ? ctx.webrules.of(g.id) : null;
        out.avail = up; // «uptime» ya es el tiempo en linea de las apps
        if (priv && ctx.analytics) out.siteToken = ctx.analytics.siteToken('site:' + g.id); }
      if (ctx.analytics) { out.analytics = ctx.analytics.summary('site:' + g.id); out.cfOnly = ctx.analytics.cfOnly('site:' + g.id); }
      out.watch = watchOf(ctx, 'site:' + g.id, priv);
      // certificado SSL: el mas proximo a vencer de sus dominios (el nombre del dominio solo en privado)
      if (ctx.svcAudit && ctx.svcAudit.data) {
        const certs = (g.domainList || [g.domain]).filter(Boolean).map(d => ctx.svcAudit.certOf(d)).filter(Boolean).sort((a, b) => a.until - b.until);
        const c = certs[0];
        if (c) out.cert = { until: c.until, days: c.days, issuer: c.issuer, self: c.self, covers: c.covers, domain: priv ? c.domain : null, n: certs.length, level: c.days < 0 ? 'bad' : c.days <= 7 ? 'bad' : c.days <= 20 || c.self ? 'warn' : 'ok' };
      }
      out.secHistory = ctx.seclog ? ctx.seclog.ofSite(g.id, 25).map(e => ({ t: e.t, kind: e.kind, action: e.action, reason: e.reason, by: e.by, why: e.why, status: e.status, ip: priv ? e.ip : null, path: priv ? tildeP(e.path) : null })) : [];
      // archivos PHP sospechosos de este sitio: la ruta solo en privado
      out.phpSus = ctx.phpFiles ? ctx.phpFiles.suspects().filter(r => r.site === g.id).map(r => {
        // quien lo pidio: en privado cada IP con si se puede llevar a la carcel; en publico solo cuantos
        const hits = ctx.phpFiles.whoRequested(r);
        const D = ctx.defense, jailed = D ? new Set(D.jail().map(x => x.ip)) : new Set();
        return { path: priv ? r.path : null, short: priv ? tilde(r.path) : null, why: r.why, size: r.size, mtime: r.mtime, at: r.at, existing: !!r.existing,
          hitCount: hits.length, hits: priv ? hits.slice(0, 12).map(h => ({ ip: h.ip, t: h.t, status: h.status, jailed: jailed.has(h.ip), blockable: !!(D && D.available() && !jailed.has(h.ip) && !D.why(h.ip)) })) : undefined };
      }) : [];
      return out;
    }

    if (kind === 'session') {
      const x = claude.list().find(q => (priv ? q.id : alias(q.id)) === id);
      if (!x) return null;
      const logFor = [...history.agentLog.entries()].filter(([k]) => k === x.id || k.startsWith(x.id + '/'))
        .flatMap(([k, r]) => r.toArray().map(e => ({ ...e, sub: k !== x.id }))).sort((p, q) => q.t - p.t).slice(0, 40);
      return {
        kind, ...agent(x, priv), account: accId(x.account, priv), accountLabel: accLabel(x.account, priv), color: acc(x.account).color, target: sessionTarget(ctx, x, priv),
        subagents: x.subagents.map(q => agent(q, priv)),
        timeline: logFor.map(e => ({ t: e.t, action: e.action, station: e.station, activity: STATION_LABEL[e.station] || '', sub: e.sub, waitKind: e.waitKind,
          ...(priv ? { tool: e.tool, detail: scrub(e.detail), text: scrub(e.text) } : {}) })),
      };
    }

    if (kind === 'district') {
      const a = findAccount(id, priv);
      if (!a) return null;
      return {
        kind, id: accId(a, priv), label: accLabel(a, priv), color: acc(a).color, claudeProcs: host.claudeProcs[a] || 0,
        quotas: ctx.quotas && ctx.quotas.available() ? ctx.quotas.read()[a] || null : null,
        reqMin: logs.lastMinute.perAccount[a] || 0,
        apps: host.apps.filter(x => x.account === a).map(x => ({ ...appSummary(x),
          ...(priv ? { domains: [...logs.groups.values()].filter(g => g.account === a && g.app === x.name).flatMap(g => g.domainList).slice(0, 4) } : {}) })),
        sites: logs.sites.filter(g => g.account === a).map(g => ({ ...siteSummary(ctx, g, priv), category: logs.siteLabel(g), ...(priv ? { domains: g.domainList.slice(0, 4) } : {}) })),
        ...(priv && a !== 'root' && !a.startsWith('_') ? { cpanel: a, main: logs.mainDomain.get(a) || '' } : {}),
        ...(ctx.connectors && a.startsWith('_cf-') && ctx.connectors.byAccount(a) ? { cloudflare: (c => ({ pages: c.info().pages, workers: c.info().workers, zones: c.info().zones, warn: c.info().warn, lastOk: c.lastOk, live: c.info().live, merged: priv ? c.info().merged : [],
          traffic: c.trafficOf().map(t => ({ zone: priv ? t.zone : null, day: t.day, days: t.days, countries: t.countries })) }))(ctx.connectors.byAccount(a)) } : {}),
        ...(ctx.agents && a.startsWith('_host-') ? { hosting: ctx.agents.info(a, priv), ...(priv ? { main: logs.mainDomain.get(a) || '' } : {}) } : {}),
        changes: logs.changes.toArray().filter(c => c.account === a).slice(-15).reverse()
          .map(c => ({ t: c.t, action: c.action, ...(priv ? { domain: c.domain, what: c.what } : {}) })),
        sessions: claude.list().filter(x => x.account === a).map(sessSummary),
        dbs: ctx.dbAudit && ctx.dbAudit.available() ? ctx.dbAudit.cached().filter(d => d.account === a && !d.system).slice(0, 8).map(d => dbSummary(d, priv)) : [],
        dbCount: ctx.dbAudit && ctx.dbAudit.available() ? ctx.dbAudit.cached().filter(d => d.account === a && !d.system).length : 0,
      };
    }

    if (kind === 'system') {
      return {
        kind, system: host.system, top: host.topProcs, hist: host.history.toArray(), health: healthOut(ctx, priv),
        apps: host.apps.length, appsDown: host.apps.filter(a => a.status !== 'online').length,
        sessions: claude.list().length, host: priv ? cfg.subtitle : '',
        keys: ctx.services ? ctx.services.keys : [],
        connectors: (ctx.connectors ? ctx.connectors.infos() : []).map(c => ({ type: c.type, ok: !c.error, lastOk: c.lastOk, drainAt: c.drainAt || 0, projects: c.projects, warn: c.warn || [],
          ...(priv ? { label: c.label, error: c.error } : { label: { vercel: 'Vercel', supabase: 'Supabase', github: 'GitHub', cloudflare: 'Cloudflare' }[c.type] || 'Nube' }) })),
        countries: history.global.top('cc', 12).map(([key, n]) => ({ key, n })), kinds: history.global.top('kind', 8).map(([key, n]) => ({ key, n })),
      };
    }

    if (kind === 'security') {
      return {
        kind, counts: logs.security,
        recent: history.security.toArray().slice(-30).reverse().map(e => ({ t: e.t, kind: e.kind, service: e.service, reason: e.reason, cc: e.cc, country: e.country,
          ...(priv ? { ip: e.ip, user: e.user, method: e.method } : {}) })),
        top: history.topIps(8).map(([ip, v]) => ({ n: v.n, blocked: v.blocked, last: v.last, cc: v.cc, country: v.country, ...(priv ? { ip, users: v.users } : {}) })),
      };
    }

    // panel de cada indicador de la barra superior
    if (kind === 'metric') {
      const m = ctx.metrics, sys = host.system || {};
      const hist = host.history.toArray();
      const siteOf = id => logs.sites.find(g => g.id === id);
      const who = (account, app, site) => {
        if (app) return { name: appName(account, app, priv), kind: appInfo(account, app).label || '', go: 'app:' + alias(account + '/' + app) };
        const g = site && siteOf(site);
        if (g) return { name: priv ? g.domain : logs.siteLabel(g), kind: logs.siteLabel(g), go: 'site:' + alias('site:' + g.id) };
        return { name: priv ? '(sin asignar)' : 'Otro', kind: '', go: null };
      };
      const base = { kind, id, system: sys };
      switch (id) {
        case 'cpu': return { ...base, cores: m.cpu.cores, modes: m.cpu.modes, top: host.topProcs, hist: hist.map(h => ({ t: h.t, v: h.cpu })) };
        case 'procs': return { ...base, top: host.topProcs, topMem: host.topMem, procs: sys && sys.procs, cores: sys && sys.cores };
        case 'mem': return { ...base, mem: m.mem, top: host.topMem, hist: hist.map(h => ({ t: h.t, v: h.mem })) };
        case 'disk': {
          const dm = ctx.diskmap;
          const map = { status: dm.status(), categories: dm.categories().map(c => ({ id: c.id, label: c.label, size: c.size, n: c.n, tip: c.tip, ...(priv ? { paths: c.paths } : {}) })) };
          if (priv) {
            // arbol navegable: la carpeta pedida (solo rutas absolutas normalizadas) o la raiz
            const want = String(opts.path || '/');
            const dir = want.startsWith('/') && !want.includes('..') ? (want.length > 1 ? want.replace(/\/+$/, '') : '/') : '/';
            map.tree = dm.children(dir) || dm.children('/');
            map.files = dm.data ? dm.data.files.slice(0, 20) : [];
            map.growth = dm.growth();
          }
          return { ...base, mounts: m.mounts, io: m.io, hist: m.ioHistory.toArray(), map };
        }
        case 'load': return { ...base, load: sys.load, cores: sys.cores, procs: m.procs, top: host.topProcs, hist: hist.map(h => ({ t: h.t, v: h.load })) };
        case 'rx': case 'tx': case 'net': return { ...base, id: 'net', ifaces: m.ifaces, tcp: m.tcp, hist: hist.map(h => ({ t: h.t, rx: h.rx, tx: h.tx })) };
        case 'req': {
          const per = [];
          for (const [k, n] of Object.entries(logs.lastMinute.perApp)) { const i = k.indexOf('/'); per.push({ ...who(k.slice(0, i), k.slice(i + 1), null), n }); }
          for (const [k, n] of Object.entries(logs.lastMinute.perSite)) per.push({ ...who(null, null, k), n });
          return { ...base, reqMin: logs.slidingMinute().reqMin, top: per.sort((a, b) => b.n - a.n).slice(0, 12),
            countries: history.global.top('cc', 10).map(([key, n]) => ({ key, n })), kinds: history.global.top('kind', 8).map(([key, n]) => ({ key, n })),
            hist: logs.history.toArray() };
        }
        case 'err': {
          const recent = history.errors.toArray().slice(-30).reverse().map(e => ({ t: e.t, status: e.status, method: e.method, cc: e.cc, ...who(e.account, e.app, e.site),
            ...(priv ? { domain: e.domain, path: scrub(e.path || '') } : {}) }));
          const by = new Map();
          for (const e of recent) { const k = e.name; by.set(k, { name: k, kind: e.kind, go: e.go, n: (by.get(k)?.n || 0) + 1 }); }
          return { ...base, errMin: logs.slidingMinute().errMin, recent, bySite: [...by.values()].sort((a, b) => b.n - a.n), hist: logs.history.toArray() };
        }
      }
      return null;
    }

    // defensa web: global ('all') o de un sitio (id de app o de sitio). En publico, cuentas y familias; en
    // privado, rutas, IPs y cada archivo expuesto con su veredicto.
    // expediente de un preso (o de cualquier IP): solo en privado, porque todo gira alrededor de la IP
    // analitica de un sitio o app (id: el mismo de su ficha). En publico: cifras, paises, dispositivos y tipos de
    // origen; las paginas, los sitios que enlazan y las campanas solo en privado
    if (kind === 'analytics') {
      if (!ctx.analytics) return null;
      const [ek, ...rest] = String(id || '').split(':'), eid = rest.join(':');
      let key = null, name = null, go = null;
      if (ek === 'site') { const g = logs.sites.find(x => siteId(x) === eid); if (g) { key = 'site:' + g.id; name = siteSummary(ctx, g, priv).name; go = 'site:' + eid; } }
      else if (ek === 'app') { const a = host.apps.find(x => alias(x.account + '/' + x.name) === eid); if (a) { key = a.account + '/' + a.name; name = appName(a.account, a.name, priv, a.image, fw(a)); go = 'app:' + eid; } }
      if (!key) return null;
      const r = ctx.analytics.report(key, opts.range || 30);
      const out = { kind, id, name, go, ...r, cfOnly: ctx.analytics.cfOnly(key) };
      if (priv && ctx.reports) out.monthly = ctx.reports.info(key); // informe mensual por correo (solo en privado)
      if (priv) out.siteToken = ctx.analytics.siteToken(key); // para la linea del script (a.js)
      if (!priv) Object.assign(out, { pages: [], entries: [], refs: [], campaigns: [], notFound: [], private: true });
      return out;
    }
    if (kind === 'prisoner') {
      if (!priv) return { kind, id: null, private: true };
      if (!ctx.defense || !require('net').isIP(String(id || ''))) return null;
      const D = ctx.defense.dossier(String(id)), L = ctx.defense.summary().label;
      const siteOf = (siteId, domain) => { const g = siteId && logs.sites.find(x => x.id === siteId); return { name: g ? g.domain : domain || null, go: g ? 'site:' + alias('site:' + g.id) : null }; };
      return { kind, id: D.ip, geo: D.geo, blockable: !D.why && !D.inJail,
        inJail: D.inJail ? { permanent: !!D.inJail.permanent, why: D.inJail.why || L[D.inJail.reason] || D.inJail.reason, at: D.inJail.at, until: D.inJail.until || null, by: D.inJail.by } : null,
        records: D.records.map(r => ({ at: r.at, until: r.until, status: r.status, why: L[r.reason] || r.reason, by: r.by, liftedAt: r.liftedAt || null, ...siteOf(r.site, r.domain) })),
        sites: D.sites.map(s => ({ n: s.n, t: s.t, ...siteOf(s.site, s.domain) })),
        php: D.php.map(x => ({ path: tildeP(x.path), quarantined: x.quarantined, ...siteOf(x.site, x.domain) })),
        events: D.events.map(e => ({ t: e.t, kind: e.kind, action: e.action, reason: e.reason, by: e.by, why: e.why, status: e.status, path: tildeP(e.path), ...siteOf(e.site, e.domain) })),
        reqs: D.reqs, panel: ctx.logins ? ctx.logins.ofIp(D.ip) : null };
    }
    // la carcel: cada preso con su motivo y el sitio que ataco; la IP y el motivo escrito a mano solo en privado
    if (kind === 'jail') {
      if (!ctx.defense || !ctx.defense.available()) return { kind, available: false, items: [] };
      const name = r => r.app ? appName(r.account, r.app, priv) : (() => { const g = r.site && logs.sites.find(x => x.id === r.site); return g ? (priv ? g.domain : logs.siteLabel(g)) : null; })();
      const items = ctx.defense.jail().map(r => ({ ip: priv ? r.ip : null, permanent: !!r.permanent, reason: r.reason,
        why: r.permanent ? (priv ? r.why : 'Bloqueo manual en el firewall') : r.why, by: r.by === 'auto' ? 'auto' : r.permanent ? 'firewall' : priv ? r.by : 'dueño',
        at: r.at || null, until: r.until || null, site: r.app || r.site ? name(r) : null }));
      // archivos en cuarentena con su historia (ruta, quien lo puso e IPs solo en privado)
      const tl = p => p ? p.replace(/^\/home\/[^/]+\//, '~/') : null;
      const jailedIps = new Set(ctx.defense.jail().map(x => x.ip));
      const files = ctx.phpFiles ? ctx.phpFiles.jailedList().map(j => {
        const g = j.site && logs.sites.find(x => x.id === j.site);
        return { path: priv ? j.path : null, short: priv ? tl(j.path) : null, site: g ? (priv ? g.domain : logs.siteLabel(g)) : priv ? j.domain : null, go: g ? 'site:' + alias('site:' + g.id) : null,
          why: j.why || [], size: j.size, mtime: j.mtime, foundAt: j.foundAt, at: j.at, by: priv ? j.by : null, existing: !!j.existing, rebuilt: !!j.rebuilt, canAct: priv && !!j.qpath,
          hits: (j.hits || []).slice(0, 8).map(h => ({ ip: priv ? h.ip : null, t: h.t, status: h.status, jailed: jailedIps.has(h.ip) })) };
      }) : [];
      return { kind, available: true, priv, items, files, auto: ctx.defense.conf.auto };
    }
    if (kind === 'webdef') {
      const W = ctx.webdef;
      if (!W) return null;
      const LABEL = Object.fromEntries(rulesOf(ctx).webFamilies.map(([f, n]) => [f, n]));
      const since = Date.now() - 3600000;
      const sid = s => s.app ? alias(s.account + '/' + s.app) : s.site ? alias('site:' + s.site) : null;
      const name = s => s.app ? appName(s.account, s.app, priv) : (() => { const g = s.site && logs.sites.find(x => x.id === s.site); return g ? (priv ? g.domain : logs.siteLabel(g)) : (priv ? s.domain : 'Sitio'); })();
      const list = [...W.sites.values()].filter(s => id === 'all' || sid(s) === id);
      const fams = {}, cc = new Map(), ips = new Map(), paths = new Map();
      let hour = 0, day = 0;
      for (const s of list) {
        for (const h of s.hits) { day++; if (h.t > since) hour++; }
        for (const [f, n] of Object.entries(s.fam)) fams[f] = (fams[f] || 0) + n;
        for (const [c, n] of s.cc) cc.set(c, (cc.get(c) || 0) + n);
        for (const [ip, v] of s.ips) { const x = ips.get(ip) || { n: 0, cc: v.cc, country: v.country }; x.n += v.n; ips.set(ip, x); }
        for (const [p, v] of s.paths) { const x = paths.get(p) || { n: 0, fam: v.fam, status: v.status }; x.n += v.n; paths.set(p, x); }
      }
      const VERDICT = { exposed: 'Expuesto: el archivo está a la vista', possible: 'Posible: responde 200 y no parece una página', pending: 'Verificando…',
        catchall: 'No expuesto: el sitio responde lo mismo a cualquier ruta', closed: 'Ya no responde', unknown: 'No se pudo verificar', panel: 'Panel de base de datos abierto a Internet',
        gitdump: 'Están descargando un repositorio .git objeto por objeto: ya tienen su índice' };
      const exp = [...W.exposed.values()].filter(x => (id === 'all' || sid(x) === id) && x.verdict !== 'closed' && x.verdict !== 'catchall');
      // alguien pide objetos de un .git por su hash exacto: ya tiene el indice del repositorio (de una exposicion anterior)
      for (const s of list) if ((s.gitDump || 0) >= 20) exp.push({ account: s.account, app: s.app, site: s.site, domain: s.domain, path: '/.git/objects/…', fam: 'secrets', verdict: 'gitdump', n: s.gitDump, last: Math.max(...s.hits.map(h => h.t)) });
      // defensa: bloqueos de Atalaya y la automatica (IPs y lista blanca solo en privado)
      const D = ctx.defense ? ctx.defense.summary() : null;
      const defense = D ? { available: D.available, auto: D.auto, hours: D.hours, active: D.active, allow: priv ? D.allow : undefined,
        records: D.records.map(r => ({ ip: priv ? r.ip : null, reason: r.reason, why: D.label[r.reason] || r.reason, by: r.by === 'auto' ? 'auto' : priv ? r.by : 'dueño',
          at: r.at, until: r.until, status: r.status, hours: r.hours, site: r.app || r.site ? name(r) : null, account: r.account ? accLabel(r.account, priv) : null })),
        // Cloudflare: el bloqueo tambien alla (estado de la conexion) y los sitios que llegan sin la IP real
        cloudflare: ctx.cloudflare ? (c => ({ ...c, zones: priv ? c.zones : c.zones.length ? [`${c.zones.length} zona(s)`] : [] }))(ctx.cloudflare.status()) : null,
        cfSites: ctx.analytics ? ctx.analytics.cfSites().length : 0 } : null;
      return { kind, id, priv, hour, day, defense,
        families: Object.entries(fams).sort((a, b) => b[1] - a[1]).map(([f, n]) => ({ fam: f, label: LABEL[f], n })),
        countries: [...cc].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([c, n]) => ({ cc: c, n })),
        sites: id === 'all' ? list.map(s => ({ go: s.app ? 'app:' + sid(s) : s.site ? 'site:' + sid(s) : null, name: name(s), account: accLabel(s.account, priv), n: s.hits.length,
          hour: s.hits.filter(h => h.t > since).length })).sort((a, b) => b.n - a.n).slice(0, 15) : [],
        exposed: exp.map(x => ({ fam: x.fam, verdict: x.verdict, why: VERDICT[x.verdict] || '', fix: rulesOf(ctx).webFix[x.verdict === 'panel' ? 'panel' : x.verdict === 'gitdump' ? 'gitdump' : x.fam] || '', n: x.n, last: x.last, site: name(x), account: accLabel(x.account, priv),
          sev: x.verdict === 'exposed' || x.verdict === 'gitdump' ? 'bad' : 'warn', ...(priv ? { path: x.path, domain: x.domain } : {}) })),
        ...(priv ? {
          paths: [...paths].sort((a, b) => b[1].n - a[1].n).slice(0, 15).map(([p, v]) => ({ path: p, n: v.n, fam: v.fam, status: v.status })),
          ips: [...ips].sort((a, b) => b[1].n - a[1].n).slice(0, 10).map(([ip, v]) => ({ ip, n: v.n, cc: v.cc, country: v.country })),
        } : {}) };
    }

    // correo: cada movimiento con su cuenta y, en privado, remitente, destinatario y motivo del rebote.
    // En publico solo la cuenta (con su nombre publico) y el tipo de motivo.
    if (kind === 'mail') {
      const who = a => a ? accLabel(a, priv) : 'Servidor (correo del sistema)';
      const byAcc = Object.entries(logs.mail.byAccount || {}).map(([a, v]) => ({ account: who(a), out: v.out, in: v.in, bounce: v.bounce,
        reasons: Object.entries(v.reasons).sort((x, y) => y[1] - x[1]).map(([cat, n]) => ({ cat, n })) })).sort((x, y) => (y.bounce - x.bounce) || (y.out + y.in - x.out - x.in));
      const reasons = {};
      for (const v of Object.values(logs.mail.byAccount || {})) for (const [c, n] of Object.entries(v.reasons)) reasons[c] = (reasons[c] || 0) + n;
      return { kind, priv, counts: { out: logs.mail.out, in: logs.mail.in, bounce: logs.mail.bounce }, byAccount: byAcc,
        reasons: Object.entries(reasons).sort((x, y) => y[1] - x[1]).map(([cat, n]) => ({ cat, n, fix: rulesOf(ctx).mailFix[cat] || '' })),
        recent: history.mail.toArray().slice(-40).reverse().map(e => ({ t: e.t, dir: e.dir, account: who(e.account), cat: e.cat || null, why: e.why || null,
          ...(priv ? { from: e.from || '', to: e.to || '', code: e.code || '', reason: scrub(e.reason || '') } : {}) })) };
    }

    // mapa de proyectos: en publico, sin nombres, repos, dominios ni rutas (solo tipo, estado y puntaje)
    if (kind === 'projects' || kind === 'project') {
      const P = ctx.projects;
      if (!P) return null;
      const list = P.build();
      const busy = ctx.jobs && ctx.jobs.busy();
      const job = busy ? { label: priv ? busy.label : 'un análisis', startedAt: busy.startedAt, name: busy.name } : null;
      const pname = pr => priv ? pr.name : 'Proyecto ' + pr.id.slice(0, 4).toUpperCase();
      const WHERE = { vercel: 'Vercel', cloudflare: 'Cloudflare', supabase: 'Supabase', app: 'Servidor', site: 'Servidor', hosting: 'Hosting', repo: 'GitHub' };
      const partOut = x => {
        const o = { kind: x.kind, where: WHERE[x.kind], status: x.status || null, type: x.type || null, suggested: false };
        if (x.app && x.kind !== 'supabase' && x.kind !== 'vercel') o.go = 'app:' + alias(x.app.account + '/' + x.app.name);
        if (x.app && (x.kind === 'vercel' || x.kind === 'supabase' || x.kind === 'cloudflare')) o.go = 'app:' + alias(x.app.account + '/' + x.app.name);
        if (x.site) o.go = 'site:' + siteId(x.site);
        if (priv) Object.assign(o, { name: x.name, account: x.where ? accLabel(x.where, true) : (x.app ? accLabel(x.app.account, true) : null), remote: x.remote || null });
        return o;
      };
      const summary = pr => ({ id: pr.id, name: pname(pr), score: pr.score, activity: pr.activity,
        kinds: [...new Set(pr.parts.map(x => x.kind))], down: pr.parts.some(x => x.status === 'down'),
        bad: pr.checks.filter(c => c.level === 'bad').length, warn: pr.checks.filter(c => c.level === 'warn').length,
        audited: pr.audit ? pr.audit.at : null, ...(priv ? { repo: pr.repoInfo ? pr.repoInfo.fullName : pr.repo, domains: pr.domains.slice(0, 3) } : {}) });
      if (kind === 'projects') {
        const gh = P.github();
        return { kind, job, github: gh.map(g => ({ ok: !g.error, repos: g.repos.size, ...(priv ? { label: g.label, error: g.error } : {}) })),
          avg: list.length ? Math.round(list.reduce((n, x) => n + x.score, 0) / list.length) : null, projects: list.map(summary) };
      }
      const pr = list.find(x => x.id === id);
      if (!pr) return null;
      const out = { kind, ...summary(pr), job, running: !!(busy && busy.name === 'proyectos'), parts: pr.parts.map(x => ({ ...partOut(x), suggested: pr.suggested.includes(x.key) })),
        checks: pr.checks.map(c => priv ? c : { id: c.id, level: c.level, title: GENERIC_CHECK[c.id] ? GENERIC_CHECK[c.id][c.level] || GENERIC_CHECK[c.id].any : 'Revisión', tip: '' }) };
      if (priv) Object.assign(out, {
        repoInfo: pr.repoInfo ? { fullName: pr.repoInfo.fullName, private: pr.repoInfo.private, archived: pr.repoInfo.archived, pushedAt: pr.repoInfo.pushedAt,
          language: pr.repoInfo.language, url: pr.repoInfo.url, description: pr.repoInfo.description, defaultBranch: pr.repoInfo.defaultBranch } : null,
        allDomains: pr.domains, others: list.filter(x => x !== pr).map(x => ({ id: x.id, name: x.name })).sort((a, b) => a.name.localeCompare(b.name)),
        audit: pr.audit ? { at: pr.audit.at, certs: pr.audit.certs, http: pr.audit.http, domains: pr.audit.domains, repoError: pr.audit.repoError,
          repo: pr.audit.repo ? { files: pr.audit.repo.files, secrets: pr.audit.repo.secrets, ci: pr.audit.repo.ci, alerts: pr.audit.repo.alerts } : null } : null });
      return out;
    }

    // bases de datos: la lista es liviana; la auditoria de cada una corre solo a pedido
    // actividad de las bases (si el usuario de monitoreo esta activo): lo mismo para el panel y para cada base
    const activityOf = (filter, one) => {
      const X = ctx.dbActivity;
      if (!X || !X.available()) return { available: false, canEnable: priv && (cfg.edition || 'vps') === 'vps' && require('fs').existsSync('/etc/systemd/system/atalaya-helper.path') };
      const s = X.snapshot();
      const row = d => ({ id: dbId({ name: d.db }, priv), name: priv ? d.db : 'Base ' + alias('db:' + d.db).slice(0, 4).toUpperCase(),
        accountLabel: d.account ? accLabel(d.account, priv) : null, conns: d.conns, active: d.active, busy: d.busy,
        longest: d.longest ? { time: d.longest.time, ...(priv ? { query: d.longest.query, state: d.longest.state } : {}) } : null,
        peak: d.peak ? { time: d.peak.time, at: d.peak.at, ...(priv ? { query: d.peak.query } : {}) } : null });
      if (one) { const d = s.dbs.find(x => x.db === one); return { available: true, error: s.error, db: d ? row(d) : null }; }
      const r = s.rates;
      return { available: true, priv, error: s.error, lastOk: s.lastOk, conns: s.conns, max: s.max, maxUsed: s.maxUsed, running: s.running, refused: s.refusedTotal,
        rates: r ? { qps: +r.qps.toFixed(1), select: +r.select.toFixed(1), insert: +r.insert.toFixed(2), update: +r.update.toFixed(2), delete: +r.delete.toFixed(2), slow: r.slow } : null,
        history: s.history.map(h => ({ t: h.t, conns: h.conns, qps: h.qps })), noDbConns: s.noDbConns,
        dbs: s.dbs.filter(d => !filter || d.account === filter).slice(0, 15).map(row) };
    };
    if (kind === 'databases' || kind === 'database') {
      const A = ctx.dbAudit;
      if (!A || !A.available()) return { kind, available: false, dbs: [] };
      const all = A.cached().filter(d => !d.system);
      const busy = ctx.jobs && ctx.jobs.busy();
      const job = busy ? { label: priv ? busy.label : 'un análisis', startedAt: busy.startedAt } : null;
      if (kind === 'databases') {
        const filter = id && id !== 'all' ? findAccount(id, priv) : null;
        return { kind, available: true, job, account: filter ? accId(filter, priv) : null, accountLabel: filter ? accLabel(filter, priv) : null,
          total: all.reduce((n, d) => n + d.size, 0), count: all.length, activity: activityOf(filter),
          dbs: all.filter(d => !filter || d.account === filter).map(d => dbSummary(d, priv)) };
      }
      const d = all.find(x => dbId(x, priv) === id);
      if (!d) return null;
      const r = A.lastResult(d.dirName);
      const out = { kind, ...dbSummary(d, priv), color: d.account ? acc(d.account).color : '#94a3b8', job,
        running: !!(busy && busy.name === 'db:' + d.dirName), audited: r ? r.at : null, activity: activityOf(null, d.name) };
      if (!r) return out;
      const counts = { warn: 0, info: 0, ok: 0 };
      for (const f of r.findings) counts[f.level] = (counts[f.level] || 0) + 1;
      out.findingCounts = counts;
      out.prevAt = r.prevAt; out.prevSize = r.prevSize; out.auditSize = r.size;
      if (priv) {
        out.findings = r.findings; out.users = r.users;
        out.tables = r.tables.slice(0, 40).map(t => ({ name: t.name, size: t.size, engine: t.engine, mtime: t.mtime, delta: t.delta }));
        out.tableCount = r.tables.length;
      } else {
        out.engines = Object.entries(r.tables.reduce((m, t) => (m[t.engine || '?'] = (m[t.engine || '?'] || 0) + 1, m), {})).map(([k, n]) => ({ key: k, n }));
        out.inUse = r.users.length > 0;
      }
      return out;
    }
    return null;
  }

  // de la ficha (site:<alias> o app:<alias>) a la clave de la analitica, con su nombre y dominio reales
  // (para el informe mensual, que solo configura el dueno)
  function analyticsTarget(ctx, id) {
    const { host, logs } = ctx;
    const [ek, ...rest] = String(id || '').split(':'), eid = rest.join(':');
    if (ek === 'site') { const g = logs.sites.find(x => siteId(x) === eid); return g ? { key: 'site:' + g.id, name: g.domain, domain: g.domain, id: 'site:' + eid } : null; }
    if (ek === 'app') { const a = host.apps.find(x => alias(x.account + '/' + x.name) === eid); if (!a) return null; const d = appDomain(ctx, a); return { key: a.account + '/' + a.name, name: d || a.name, domain: d || null, id: 'app:' + eid }; }
    return null;
  }

  // enlace directo a la ficha del sitio o app de un evento (mismo alias que usa la pantalla)
  // los avisos que solo traen dominio (certificados) buscan su sitio por el dominio
  const goOf = (e, ctx) => {
    if (e.app && e.account) return 'app:' + alias(e.account + '/' + e.app);
    if (e.site) return 'site:' + alias('site:' + e.site);
    const d = String(e.domain || '').toLowerCase().replace(/^www\./, '');
    const g = d && ctx && ctx.logs && ctx.logs.sites.find(x => String(x.domain || '').toLowerCase().replace(/^www\./, '') === d);
    return g ? 'site:' + siteId(g) : null;
  };
  return { state, event, detail, scrub, goOf, analyticsTarget };
}

module.exports = { makePrivacy, scrub };
