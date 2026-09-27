'use strict';
// GitHub: los repositorios de la cuenta (con token de solo lectura) para unir cada proyecto con su codigo.
// No crea edificios: alimenta el mapa de proyectos. La revision de un repo (archivos de secretos subidos,
// .gitignore, CI, alertas de dependencias) corre solo a pedido.
const https = require('https');

const API = process.env.ATALAYA_GITHUB_API || 'https://api.github.com';

function get(url, token, { raw = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === 'http:' ? require('http') : https;
    const req = mod.request(u, { method: 'GET', timeout: 15000, headers: { Authorization: 'Bearer ' + token, 'User-Agent': 'Atalaya',
      Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } }, res => {
      let d = ''; res.setEncoding('utf8');
      res.on('data', c => { d += c; if (d.length > 32 << 20) req.destroy(); });
      res.on('end', () => {
        if (res.statusCode !== 200) { const e = new Error(`GitHub ${res.statusCode}: ${d.slice(0, 120)}`); e.status = res.statusCode; return reject(e); }
        if (raw) return resolve(d);
        try { resolve(JSON.parse(d)); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject); req.end();
  });
}

// archivos que no deberian estar en un repositorio
const SECRET_FILES = [
  [/(^|\/)\.env(\.(local|production|prod|development|dev|staging))?$/i, 'archivo .env con variables de entorno'],
  [/(^|\/)(id_rsa|id_ed25519|id_ecdsa)$/, 'llave SSH privada'],
  [/\.(pem|key|p12|pfx|keystore|jks)$/i, 'llave o certificado privado'],
  [/(^|\/)(credentials|service-account|serviceAccountKey|firebase-adminsdk[^/]*)\.json$/i, 'credenciales de una cuenta de servicio'],
  [/(^|\/)\.npmrc$|(^|\/)\.pypirc$|(^|\/)\.netrc$/, 'archivo con tokens de publicación'],
  [/(^|\/)(wp-config\.php|secrets?\.(php|json|ya?ml))$/i, 'configuración con contraseñas'],
  [/\.(sql|sqlite|sqlite3|db|dump)(\.gz)?$/i, 'volcado o archivo de base de datos'],
];
const LOCKFILES = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|composer\.lock|poetry\.lock|Pipfile\.lock|Gemfile\.lock|go\.sum|Cargo\.lock)$/;

class GithubConnector {
  // conn: { id, name, token }
  constructor(conn) {
    this.conn = conn;
    this.account = null; // no es un distrito
    this.label = 'GitHub · ' + (conn.name || conn.id);
    this.apps = [];
    this.repos = new Map(); // full_name (minusculas) -> repo
    this.login = '';
    this.error = null; this.lastOk = 0; this.timers = [];
  }

  start() {
    const run = async () => { try { await this.poll(); this.error = null; this.lastOk = Date.now(); } catch (e) { this.error = e.message; } };
    run();
    this.timers.push(setInterval(run, 15 * 60000));
  }
  stop() { for (const t of this.timers) clearInterval(t); this.timers = []; }

  async poll() {
    if (!this.login) { try { this.login = (await get(`${API}/user`, this.conn.token)).login || ''; } catch { } }
    const out = new Map();
    for (let page = 1; page <= 10; page++) {
      const list = await get(`${API}/user/repos?per_page=100&page=${page}&sort=pushed&affiliation=owner,collaborator,organization_member`, this.conn.token);
      for (const r of list) out.set(r.full_name.toLowerCase(), {
        fullName: r.full_name, private: !!r.private, archived: !!r.archived, fork: !!r.fork, pushedAt: Date.parse(r.pushed_at) || 0,
        defaultBranch: r.default_branch, language: r.language || '', homepage: r.homepage || '', url: r.html_url, description: r.description || '',
      });
      if (list.length < 100) break;
    }
    this.repos = out;
  }

  // revision de un repo a pedido (3 a 5 llamadas a la API)
  async audit(fullName) {
    const r = this.repos.get(String(fullName).toLowerCase());
    if (!r) throw new Error('Ese repositorio no está en la cuenta de GitHub conectada');
    const base = `${API}/repos/${r.fullName}`;
    const tree = await get(`${base}/git/trees/${encodeURIComponent(r.defaultBranch)}?recursive=1`, this.conn.token);
    const paths = (tree.tree || []).filter(x => x.type === 'blob').map(x => x.path).filter(p => !/(^|\/)(node_modules|vendor)\//.test(p));
    const secrets = [];
    for (const p of paths) {
      if (/\.(example|sample|template|dist)$|\.env\.example/i.test(p) || /(^|\/)(test|tests|__tests__|fixtures|docs?)\//i.test(p)) continue;
      const hit = SECRET_FILES.find(([re]) => re.test(p));
      if (hit) secrets.push({ path: p, what: hit[1] });
      if (secrets.length >= 20) break;
    }
    let gitignore = null;
    try { gitignore = await get(`${base}/contents/.gitignore`, this.conn.token, { raw: true }); } catch { }
    let alerts = null;
    try {
      const a = await get(`${base}/dependabot/alerts?state=open&per_page=100`, this.conn.token);
      alerts = { total: a.length, critical: a.filter(x => x.security_advisory && x.security_advisory.severity === 'critical').length,
        high: a.filter(x => x.security_advisory && x.security_advisory.severity === 'high').length };
    } catch (e) { alerts = null; /* sin permiso o sin Dependabot: se muestra como "no se pudo saber" */ }
    return {
      at: Date.now(), fullName: r.fullName, files: paths.length, truncated: !!tree.truncated, secrets,
      envIgnored: gitignore == null ? null : /(^|\n)\s*\/?\.env(\*|\.\*|\.local)?\s*(\n|$)|(^|\n)\s*\*\.env\s*(\n|$)/.test(gitignore),
      hasGitignore: gitignore != null,
      ci: paths.some(p => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p)) || paths.some(p => /^(\.gitlab-ci\.yml|\.circleci\/)/.test(p)),
      lockfile: paths.some(p => LOCKFILES.test(p)), packageJson: paths.includes('package.json'),
      readme: paths.some(p => /^readme(\.\w+)?$/i.test(p)), dependabot: paths.some(p => /^\.github\/dependabot\.ya?ml$/.test(p)), alerts,
    };
  }

  info() { return { id: this.conn.id, type: 'github', label: this.label, account: null, error: this.error, lastOk: this.lastOk, projects: this.repos.size }; }
}

module.exports = { GithubConnector, SECRET_FILES };
