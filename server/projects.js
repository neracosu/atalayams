'use strict';
// Mapa de proyectos: une lo que esta disperso (repo de GitHub, proyecto de Vercel, app o sitio del VPS,
// sitio de un hosting, base de Supabase) en una ficha por proyecto, con un puntaje de buenas practicas.
//  - la union es automatica: por repositorio (remoto git de la carpeta, o el repo vinculado en Vercel)
//    y, como sugerencia, por nombre parecido (ej. la base "tienda-db" con el proyecto "tienda")
//  - el dueno puede unir o separar a mano (settings.projects.merges)
//  - las revisiones que salen a Internet (certificado, respuesta, dominio, repo) corren solo a pedido
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJSON, writeJSONAtomic } = require('./util');
const web = require('./audits/web');

const PLATFORM_DOMAINS = /\.(vercel\.app|netlify\.app|github\.io|supabase\.co|pages\.dev|herokuapp\.com|onrender\.com|railway\.app|fly\.dev|workers\.dev)$/i;
const DAY = 86400000;
const WEIGHT = { ok: 1, info: 0.85, warn: 0.5, bad: 0 };

// "git@github.com:Ana/Tienda.git" | "https://github.com/ana/tienda" -> "ana/tienda" (solo GitHub)
// (acepta alias SSH de deploy keys que contengan "github", ej. git@github-atalaya:ana/repo.git)
function githubRepo(url) {
  const u = String(url || '').trim();
  const m = u.match(/^(?:ssh:\/\/)?[\w.-]+@([\w.-]*github[\w.-]*)[:/]+([\w.-]+)\/([\w.-]+?)(\.git)?\/?$/i)
    || u.match(/^https?:\/\/(?:[^@/]+@)?(github\.com)\/([\w.-]+)\/([\w.-]+?)(\.git)?\/?$/i);
  return m ? `${m[2]}/${m[3]}`.toLowerCase() : null;
}
// remoto "origin" de una carpeta (o de hasta 2 carpetas arriba, sin salir del home)
// stop: carpetas donde no se sigue subiendo (ej. el docroot de otro sitio: un subdominio dentro de public_html no es
// parte del repo del dominio principal)
function gitRemoteOf(dir, stop = null) {
  if (!dir) return null;
  let d = path.resolve(dir);
  for (let i = 0; i < 3 && d.length > 1; i++) {
    if (i > 0 && stop && stop.has(d)) break;
    let t = null; try { t = fs.readFileSync(path.join(d, '.git', 'config'), 'utf8'); } catch { }
    if (t) {
      const sec = t.split(/\n(?=\[)/).find(x => /^\[remote "origin"\]/.test(x)) || t;
      const m = sec.match(/^\s*url\s*=\s*(.+)$/m);
      return m ? m[1].trim() : null;
    }
    if (/^\/home\d*\/[^/]+$|^\/root$|^\/(opt|srv|var\/www)$/.test(d)) break;
    d = path.dirname(d);
  }
  return null;
}
const norm = s => String(s || '').toLowerCase().replace(/^.*\//, '').replace(/[-_. ](db|database|prod|production|app|api|web|site|backend|frontend)$/g, '').replace(/[^a-z0-9]/g, '');

class Projects {
  constructor(cfg, ctx) {
    this.cfg = cfg; this.ctx = ctx;
    this.dir = path.join(cfg.stateDir, 'projects');
    this.cache = null; this.cacheAt = 0;
    this.remoteCache = new Map(); // carpeta -> { at, remote }
  }

  remote(dir, stop) {
    const c = this.remoteCache.get(dir);
    if (c && Date.now() - c.at < 5 * 60000) return c.remote;
    const r = gitRemoteOf(dir, stop);
    this.remoteCache.set(dir, { at: Date.now(), remote: r });
    return r;
  }

  github() { const c = this.ctx.connectors; return c && c.ofType ? c.ofType('github') : []; }
  repoInfo(full) { for (const g of this.github()) { const r = g.repos.get(full); if (r) return { ...r, via: g }; } return null; }

  // piezas sueltas de todas las fuentes
  pieces() {
    const { host, logs, agents } = this.ctx;
    const out = [];
    for (const a of host.apps) {
      if (a.source === 'vercel') out.push({ key: `vercel:${a.account}/${a.name}`, kind: 'vercel', name: a.name, repo: a.repo ? a.repo.toLowerCase() : null, app: a,
        domains: a.domains || [], status: a.status, activity: Math.max(0, ...(a.deployments || []).map(d => d.created || 0)) });
      else if (a.source === 'supabase') out.push({ key: `supa:${a.ref}`, kind: 'supabase', name: a.name, app: a, status: a.status, db: true, domains: [] });
      else {
        const doms = [...logs.groups.values()].filter(g => g.account === a.account && g.app === a.name).flatMap(g => g.domainList);
        const url = a.cwd ? this.remote(a.cwd) : null;
        out.push({ key: `app:${a.account}/${a.name}`, kind: 'app', name: a.name, repo: githubRepo(url), remote: url, app: a, domains: [...new Set(doms)],
          status: a.status, where: a.account });
      }
    }
    const roots = new Set([...logs.groups.values()].filter(g => g.docroot && !g.remote).map(g => path.resolve(g.docroot)));
    for (const g of logs.sites) {
      const url = !g.remote && g.docroot ? this.remote(g.docroot, roots) : null;
      out.push({ key: `site:${g.id}`, kind: g.remote ? 'hosting' : 'site', name: g.domain, repo: githubRepo(url), remote: url, site: g, domains: g.domainList,
        status: 'online', activity: g.lastSeen || 0, where: g.account, type: g.type });
    }
    // repos de GitHub sin nada desplegado que se sepa: tambien son proyectos (quizas abandonados)
    for (const gh of this.github()) for (const [full, r] of gh.repos) if (!r.fork) out.push({ key: `repo:${full}`, kind: 'repo', name: r.fullName.split('/')[1], repo: full, domains: [], activity: r.pushedAt });
    return out;
  }

  // agrupa piezas en proyectos (union por repo, uniones manuales y bases por nombre)
  build() {
    if (this.cache && Date.now() - this.cacheAt < 10000) return this.cache;
    const ps = this.pieces();
    const parent = new Map(ps.map(p => [p.key, p.key]));
    const find = k => { while (parent.get(k) !== k) { parent.set(k, parent.get(parent.get(k))); k = parent.get(k); } return k; };
    const union = (a, b) => { if (parent.has(a) && parent.has(b)) parent.set(find(a), find(b)); };
    const byRepo = new Map();
    for (const p of ps) if (p.repo) { if (byRepo.has(p.repo)) union(p.key, byRepo.get(p.repo)); else byRepo.set(p.repo, p.key); }
    const conf = this.cfg.projects || {};
    for (const [a, b] of conf.merges || []) union(a, b);
    const split = new Set(conf.splits || []);
    // bases de datos sin repo: se sugieren unidas al proyecto de nombre parecido
    const suggested = new Set();
    for (const p of ps.filter(x => x.db && !split.has(x.key))) {
      if (find(p.key) !== p.key) continue;
      const n = norm(p.name);
      const hit = n.length >= 3 && ps.find(q => q !== p && !q.db && (norm(q.name) === n || (q.repo && norm(q.repo) === n)));
      if (hit) { union(p.key, hit.key); suggested.add(p.key); }
    }
    const groups = new Map();
    for (const p of ps) { const r = find(p.key); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(p); }
    const hidden = new Set(conf.hidden || []);
    const out = [];
    for (const parts of groups.values()) {
      const repo = (parts.find(p => p.repo) || {}).repo || null;
      // un repo solo, sin nada desplegado, archivado: no ensucia el mapa
      const ri = repo ? this.repoInfo(repo) : null;
      if (parts.every(p => p.kind === 'repo') && ri && ri.archived) continue;
      const key = repo ? 'repo:' + repo : parts.map(p => p.key).sort()[0];
      if (hidden.has(key)) continue;
      const named = (conf.names || {})[key];
      const main = parts.find(p => p.kind === 'vercel') || parts.find(p => p.kind === 'app') || parts.find(p => p.kind === 'site' || p.kind === 'hosting') || parts[0];
      const name = named || (ri ? ri.fullName.split('/')[1] : main.name);
      const domains = [...new Set(parts.flatMap(p => p.domains || []))].filter(d => !d.startsWith('*.'));
      const activity = Math.max(0, ri ? ri.pushedAt : 0, ...parts.map(p => p.activity || 0));
      const pr = { key, id: sha(key), name, repo, repoInfo: ri, parts: parts.filter(p => p.kind !== 'repo' || parts.length === 1), domains, activity,
        suggested: parts.filter(p => suggested.has(p.key)).map(p => p.key) };
      pr.audit = readJSON(this.file(key), null);
      pr.checks = this.checks(pr);
      pr.score = score(pr.checks);
      out.push(pr);
    }
    out.sort((a, b) => a.score - b.score || b.activity - a.activity);
    this.cache = out; this.cacheAt = Date.now();
    return out;
  }
  invalidate() { this.cache = null; }
  file(key) { return path.join(this.dir, sha(key) + '.json'); }
  byId(id) { return this.build().find(p => p.id === id) || null; }

  // puntaje de buenas practicas: cada revision dice su estado y como mejorarlo
  checks(pr) {
    const c = [];
    const add = (id, level, title, tip = '') => c.push({ id, level, title, tip });
    const a = pr.audit || {};
    const gh = a.repo || null;
    const deployed = pr.parts.filter(p => p.kind !== 'repo');
    const isWp = pr.parts.some(p => p.type === 'wordpress');
    const now = Date.now();
    // codigo
    if (pr.repo) add('repo', 'ok', 'El código está en un repositorio' + (pr.repoInfo ? '' : ' (no está en la cuenta de GitHub conectada)'));
    else if (isWp) add('repo', 'info', 'Sitio WordPress sin repositorio', 'En WordPress lo importante es el respaldo: base de datos + wp-content. Verifique que su hosting lo haga a diario y guarde una copia fuera del servidor.');
    else if (deployed.length) add('repo', 'warn', 'Sin repositorio conocido', 'Si se pierde el servidor o la cuenta, se pierde el código. Súbalo a un repositorio privado de GitHub y conéctelo a Atalaya.');
    if (pr.repoInfo && !pr.repoInfo.private) add('public', gh && gh.secrets.length ? 'bad' : 'info', 'Repositorio público', gh && gh.secrets.length ? 'Es público y tiene archivos con secretos: cualquiera los puede leer. Cambie esas claves ya.' : 'Cualquiera puede leer el código. Asegúrese de que no tenga claves ni datos de clientes.');
    if (gh) {
      if (gh.secrets.length) add('secrets', 'bad', `${gh.secrets.length} archivo(s) con secretos en el repo`, `Por ejemplo ${gh.secrets.slice(0, 3).map(s => s.path).join(', ')}. Bórrelos del repo, agréguelos a .gitignore y cambie esas claves: aunque los borre, quedan en el historial.`);
      else add('secrets', 'ok', 'Sin archivos de secretos en el repo');
      if (gh.packageJson || gh.hasGitignore) {
        if (gh.envIgnored === false) add('gitignore', 'warn', '.gitignore no excluye los .env', 'Agregue la línea ".env*" (y "!.env.example") a .gitignore para no subir claves por accidente.');
        else if (gh.envIgnored == null && gh.packageJson) add('gitignore', 'warn', 'El repo no tiene .gitignore', 'Cree uno que excluya .env*, node_modules y las carpetas de compilación.');
        else if (gh.envIgnored) add('gitignore', 'ok', '.gitignore excluye los .env');
      }
      if (gh.alerts) {
        const bad = gh.alerts.critical + gh.alerts.high;
        add('deps', bad ? 'bad' : gh.alerts.total ? 'warn' : 'ok', gh.alerts.total ? `${gh.alerts.total} dependencia(s) con fallas de seguridad${bad ? ` (${bad} graves)` : ''}` : 'Dependencias sin alertas de seguridad',
          gh.alerts.total ? 'En GitHub › Security › Dependabot verá cuáles son; normalmente se arreglan actualizando el paquete.' : '');
      } else add('deps', 'unknown', 'No se pudo revisar las dependencias', 'Dé al token el permiso "Dependabot alerts: lectura" y active Dependabot en el repo.');
      if (gh.packageJson && !gh.lockfile) add('lockfile', 'info', 'Sin archivo de versiones fijas (lockfile)', 'Suba package-lock.json (o el de su gestor) para que cada despliegue use exactamente las mismas versiones.');
      add('ci', gh.ci ? 'ok' : 'info', gh.ci ? 'Tiene pruebas o despliegue automático (CI)' : 'Sin CI', gh.ci ? '' : 'Un flujo de GitHub Actions que corra las pruebas antes de publicar evita subir algo roto.');
    }
    // despliegue
    const down = deployed.filter(p => p.status === 'down');
    if (down.length) add('deploy', 'bad', down.map(p => p.kind === 'vercel' ? 'Falló el último despliegue en Vercel' : p.kind === 'supabase' ? 'La base de Supabase no responde o está pausada' : 'El servicio está caído').join(' · '), 'Ábralo en Atalaya para ver el detalle y el último cambio.');
    else if (deployed.some(p => p.kind === 'vercel' || p.kind === 'app')) add('deploy', 'ok', 'Desplegado y en línea');
    // certificados: los que conoce un agente de hosting sirven sin revision
    const certs = { ...(a.certs || {}) };
    if (this.ctx.agents) for (const p of pr.parts.filter(x => x.kind === 'hosting')) {
      const id = this.ctx.agents.idOf(p.site.account);
      for (const s of id ? this.ctx.agents.get(id).ssl : []) if (pr.domains.includes(s.domain) && !certs[s.domain]) certs[s.domain] = { ok: !s.selfSigned, expires: s.expires, issuer: s.issuer, at: now };
    }
    const cl = Object.entries(certs);
    if (cl.length) {
      const bad = cl.filter(([, x]) => !x.ok || (x.expires && x.expires < now)), soon = cl.filter(([, x]) => x.ok && x.expires && x.expires - now < 14 * DAY && x.expires > now);
      if (bad.length) add('ssl', 'bad', `Certificado inválido o vencido: ${bad.map(([d]) => d).join(', ')}`, 'Los visitantes ven una advertencia de "sitio no seguro". Renueve o reemita el certificado (AutoSSL, Let\'s Encrypt o el panel de su proveedor).');
      else if (soon.length) add('ssl', 'warn', `Certificado por vencer: ${soon.map(([d, x]) => `${d} (${Math.ceil((x.expires - now) / DAY)} días)`).join(', ')}`, 'Si es automático (Let\'s Encrypt/AutoSSL) debería renovarse solo; si no, renuévelo antes de la fecha.');
      else add('ssl', 'ok', 'Certificados SSL válidos');
    } else if (pr.domains.length) add('ssl', 'unknown', 'Certificados sin revisar', 'Pulse "Analizar ahora".');
    // respuesta del sitio
    const hc = Object.entries(a.http || {});
    if (hc.length) {
      const dead = hc.filter(([, x]) => !x.status || x.status >= 500), slow = hc.filter(([, x]) => x.status && x.status < 500 && x.ms > 3000);
      if (dead.length) add('uptime', 'bad', `No responde bien: ${dead.map(([d, x]) => `${d} (${x.status || x.error})`).join(', ')}`, 'Revise el servidor o el último despliegue.');
      else if (slow.length) add('uptime', 'warn', `Lento: ${slow.map(([d, x]) => `${d} (${(x.ms / 1000).toFixed(1)} s)`).join(', ')}`, 'Más de 3 segundos en responder espanta visitas. Revise caché, imágenes pesadas o consultas lentas.');
      else add('uptime', 'ok', 'Los sitios responden bien');
    }
    // vencimiento de dominios
    const dx = Object.entries(a.domains || {}).filter(([, x]) => x.expires);
    if (dx.length) {
      const exp = dx.filter(([, x]) => x.expires < now), soon = dx.filter(([, x]) => x.expires >= now && x.expires - now < 30 * DAY);
      if (exp.length) add('domain', 'bad', `Dominio vencido: ${exp.map(([d]) => d).join(', ')}`, 'Renuévelo en su registrador cuanto antes: después de unos días se puede perder para siempre.');
      else if (soon.length) add('domain', 'warn', `Dominio por vencer: ${soon.map(([d, x]) => `${d} (${Math.ceil((x.expires - now) / DAY)} días)`).join(', ')}`, 'Active la renovación automática en su registrador y revise que la tarjeta esté vigente.');
      else add('domain', 'ok', `Dominio${dx.length > 1 ? 's' : ''} al día (vence${dx.length > 1 ? 'n' : ''} ${dx.map(([d, x]) => `${d}: ${new Date(x.expires).toLocaleDateString('es-VE')}`).join(', ')})`);
    }
    // abandono
    if (pr.repoInfo && pr.repoInfo.pushedAt && now - pr.repoInfo.pushedAt > 180 * DAY && deployed.length) {
      const months = Math.floor((now - pr.repoInfo.pushedAt) / (30 * DAY));
      const idle = deployed.every(p => !p.activity || now - p.activity > 30 * DAY);
      add('stale', idle ? 'warn' : 'info', `Sin cambios hace ${months} meses${idle ? ' y sin actividad reciente' : ''}`, idle ? '¿Sigue en uso? Si no, apáguelo: deja de costar y de exponer código viejo con fallas conocidas.' : 'Mantenga las dependencias al día aunque no haya cambios de funciones.');
    }
    if (!deployed.length && pr.repoInfo && now - pr.repoInfo.pushedAt > 365 * DAY) add('stale', 'info', 'Repo sin despliegue ni cambios hace más de un año', 'Si ya no lo usa, archívelo en GitHub (Settings › Archive) para tener el inventario limpio.');
    return c;
  }

  // revision a pedido de un proyecto: certificados, respuesta y dominio de sus dominios, y su repo
  async analyze(id) {
    const pr = this.byId(id);
    if (!pr) throw new Error('No existe ese proyecto');
    const doms = pr.domains.filter(d => !d.startsWith('*') && !/^(www|mail|cpanel|webmail|webdisk|autodiscover|cpcalendars|cpcontacts)\./.test(d)).slice(0, 6);
    const certs = {}, http = {}, domains = {};
    for (const d of doms) { certs[d] = { ...(await web.certOf(d)), at: Date.now() }; http[d] = await web.httpCheck(d); }
    for (const r of [...new Set(doms.filter(d => !PLATFORM_DOMAINS.test(d)).map(web.registrable))].slice(0, 3)) domains[r] = await web.domainExpiry(r);
    let repo = null, repoError = null;
    if (pr.repoInfo) { try { repo = await pr.repoInfo.via.audit(pr.repo); } catch (e) { repoError = e.message; } }
    const result = { at: Date.now(), certs, http, domains, repo, repoError };
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    writeJSONAtomic(this.file(pr.key), result, 0o600);
    this.invalidate();
    return result;
  }
}

function sha(s) { return crypto.createHash('sha1').update(String(s)).digest('hex').slice(0, 12); }
function score(checks) {
  const known = checks.filter(c => c.level in WEIGHT);
  if (!known.length) return 100;
  return Math.round(known.reduce((n, c) => n + WEIGHT[c.level], 0) / known.length * 100);
}

module.exports = { Projects, githubRepo, gitRemoteOf, score, norm };
