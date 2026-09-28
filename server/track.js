'use strict';
// Seguimiento de uso (solo en Atalaya Cloud): que hace cada pantalla y donde tropieza, para acompanar a quien la
// prueba y corregir lo que falle. Se anota la accion, su resultado y el mensaje de error; nunca lo que la persona
// escribe (llaves, tokens, PIN) ni los datos de sus proyectos. Vive en <stateDir>/seguimiento.jsonl (600) y se
// parte al pasar de 1 MB. El registro de la nube lo avisa en su pagina.
const fs = require('fs');
const path = require('path');

const MAX = 1 << 20;
// lo que envian las maquinas (agentes, hooks, visitas) no es uso de la persona
const SKIP = /^\/api\/(clienterror$|beacon|agent\/|hook\/|drains\/|stream|me$|acceso$|themes$|changelog$|favicon\/|setup\/(mode|state|result)$)/;
const clean = s => String(s == null ? '' : s).replace(/[\r\n]+/g, ' ').replace(/(eyJ[\w-]{10,}\.[\w-]+\.[\w-]+|sb_secret_[\w-]+|gh[pousr]_\w{20,}|github_pat_\w+|\b[A-Za-z0-9_-]{36,}\b)/g, '•••').slice(0, 300);

class Track {
  constructor(cfg, opts = {}) {
    this.on = opts.on != null ? opts.on : cfg.edition === 'cloud';
    this.file = path.join(cfg.stateDir || '.', 'seguimiento.jsonl');
    this.now = opts.now || (() => Date.now());
    this.last = new Map(); // clave -> ultima vez (lo que se repite no llena el registro)
    this.clientErrs = [];
  }
  add(kind, data = {}, every = 0) {
    if (!this.on) return false;
    const t = this.now(), key = kind + '|' + (data.what || '') + '|' + (data.error || '');
    if (every && t - (this.last.get(key) || 0) < every) return false;
    this.last.set(key, t); if (this.last.size > 500) this.last.delete(this.last.keys().next().value);
    const row = { t, kind }; for (const [k, v] of Object.entries(data)) if (v != null && v !== '') row[k] = typeof v === 'string' ? clean(v) : v;
    try {
      try { if (fs.statSync(this.file).size > MAX) fs.renameSync(this.file, this.file + '.1'); } catch { }
      fs.appendFileSync(this.file, JSON.stringify(row) + '\n', { mode: 0o600 });
    } catch (e) { console.error('[seguimiento]', e.message); }
    return true;
  }
  // una peticion terminada: acciones (POST) y fichas abiertas; los errores siempre
  request(req, res, p, url, session) {
    if (!this.on || SKIP.test(p) || !p.startsWith('/api/') && p !== '/setup') return;
    res.on('finish', () => {
      const bad = res.statusCode >= 400, user = session ? session.user : undefined;
      if (p === '/api/detail') { if (bad) return; return this.add('ficha', { what: String(url.searchParams.get('kind') || '').slice(0, 30), user }, 10 * 60000); }
      if (p === '/setup') return this.add('asistente', { what: 'abrió el asistente', user }, 10 * 60000);
      if (req.method !== 'POST') { if (bad && res.statusCode !== 401) this.add('error', { what: p, status: res.statusCode, error: res.atalayaError, user }, 60000); return; }
      // sin sesion solo interesa el acceso fallido (el resto es ruido de robots)
      if (!session && p !== '/api/login') return;
      this.add(bad ? 'error' : 'accion', { what: p.replace(/^\/api\//, ''), status: bad ? res.statusCode : undefined, error: bad ? res.atalayaError : undefined, detail: res.atalayaNote, user }, bad ? 0 : 2000);
    });
  }
  // un error de la pantalla (JavaScript) que el navegador reporta; con tope por hora
  client(body, session) {
    const t = this.now();
    this.clientErrs = this.clientErrs.filter(x => t - x < 3600000);
    if (this.clientErrs.length >= 30) return false;
    this.clientErrs.push(t);
    return this.add('pantalla', { error: body.msg, what: String(body.where || '').slice(0, 80), theme: String(body.theme || '').slice(0, 20), view: String(body.view || '').slice(0, 20), user: session ? session.user : undefined }, 5 * 60000);
  }
  // los conectores que fallan o a los que les falta un permiso (una vez por cada cambio)
  connectors(infos) {
    for (const c of infos || []) {
      const msg = c.error || (c.warn || []).join(' · ') || '', key = 'c:' + c.id;
      if (this.last.get(key) === msg) continue;
      const had = this.last.has(key); this.last.set(key, msg);
      if (msg) this.add('conector', { what: c.type + ' ' + c.id, error: msg });
      else if (had) this.add('conector', { what: c.type + ' ' + c.id, detail: 'volvió a leer bien' });
      else this.add('conector', { what: c.type + ' ' + c.id, detail: 'conectado' + (c.projects != null ? `: ${c.projects} proyecto(s)` : '') });
    }
  }
}

// ultimas filas de un registro (para el panel maestro)
function tail(file, n = 200) {
  const rows = [];
  for (const f of [file + '.1', file]) { try { for (const l of fs.readFileSync(f, 'utf8').split('\n')) if (l) { try { rows.push(JSON.parse(l)); } catch { } } } catch { } }
  return rows.slice(-n);
}

module.exports = { Track, tail, clean };
