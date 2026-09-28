'use strict';
// Latidos: vigilancia de lo que corre solo (un cron, un respaldo, el programa instalado en el local de un cliente).
// El dueno crea un latido con un nombre y cada cuanto debe llegar; Atalaya le da una direccion secreta y su tarea
// la toca al terminar bien. Si deja de tocarla, Atalaya avisa. Es lo contrario de vigilar un sitio: aqui el silencio
// es la falla. Un respaldo que dejo de correr no da ningun error: simplemente calla.
//  - el token se muestra una sola vez y se guarda solo su sha256
//  - un latido nuevo no avisa atraso hasta que llega el primero: el dueno puede tardar en instalarlo
//  - se avisa una vez al atrasarse o fallar y una vez al volver, con cuanto duro el problema
//  - un cron de cada minuto no debe escribir el disco cada minuto: se guarda al cambiar de estado o una vez por minuto
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJSON, writeJSONAtomic } = require('./util');

const ACCOUNT = '_latidos';
const MIN = 60000, DAY = 86400000;
const MAX_EVERY = 44640, MAX_GRACE = 1440, KEEP = 100, SAVE_EVERY = MIN; // 44640 min = 31 dias
const PUBLIC_ID = /^_l(\d{1,6})$/; // un slug no puede empezar con guion bajo: el alias publico nunca choca con un id real
const SUBSTATE = { ok: 'al día', late: 'atrasado', failed: 'avisó que falló', new: 'esperando el primer latido', paused: 'en pausa' };
const STATUS = { ok: 'online', late: 'down', failed: 'down', new: 'degraded' };
const HINT_NEW = 'Todavía no llegó ningún latido: revise que la dirección esté bien pegada';
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex');
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const slug = s => String(s).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 31).replace(/-+$/, '') || 'latido';
const defaultGrace = every => Math.min(MAX_GRACE, Math.max(5, Math.round(every * 0.2)));

function cleanName(v) {
  const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) throw new Error('Escriba un nombre para el latido, por ejemplo «Respaldo de la tienda»');
  if (s.length > 60) throw new Error('El nombre es muy largo: use hasta 60 letras');
  return s;
}
function cleanEvery(v) {
  const n = Number(v);
  if (v == null || v === '' || !Number.isInteger(n) || n < 1 || n > MAX_EVERY) throw new Error('Indique cada cuánto debe llegar el latido: entre 1 minuto y 31 días (44640 minutos)');
  return n;
}
function cleanGrace(v) {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > MAX_GRACE) throw new Error('La tolerancia debe estar entre 1 minuto y 24 horas (1440 minutos)');
  return n;
}
const cleanNote = v => String(v == null ? '' : v).replace(/\s+/g, ' ').replace(/\p{C}/gu, '').trim().slice(0, 200); // \s incluye los saltos de linea de Unicode
const cleanMs = v => { const n = Number(v); return v != null && v !== '' && Number.isFinite(n) && n >= 0 ? Math.min(Math.round(n), 7 * DAY) : null; };

class Heartbeats {
  constructor(cfg, bus, opts = {}) {
    this.cfg = cfg; this.bus = bus;
    this.file = path.join(cfg.stateDir || '.', 'heartbeats.json');
    this.now = opts.now || (() => Date.now());
    const d = readJSON(this.file, null) || {};
    this.beats = d.beats && typeof d.beats === 'object' ? d.beats : {}; // id -> latido (ver create)
    this.seq = Number(d.seq) || 0;
    this.account = ACCOUNT;
    this.onChange = null; // lo asigna index.js (rearmar el mapa al crear o quitar)
    this.dirty = false; this.saved = 0;
  }
  start() {
    // los latidos que vencieron mientras Atalaya estaba apagada no pudieron llegar: se les da un plazo nuevo desde el
    // arranque en vez de acusarlos. Los que ya estaban atrasados antes de apagarse siguen atrasados
    const t = this.now();
    let n = 0;
    for (const b of Object.values(this.beats)) if (!b.paused && b.state === 'ok' && t > this.base(b) + (b.every + b.grace) * MIN) { b.resumed = t; n++; }
    if (n) this.save();
    this.timer = setInterval(() => { try { this.check(); } catch (e) { console.error('[latidos]', e.message); } }, MIN);
    this.timer.unref();
  }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null; this.flush(); }
  save() {
    try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeJSONAtomic(this.file, { seq: this.seq, beats: this.beats }, 0o600); this.dirty = false; this.saved = this.now(); }
    catch (e) { console.error('[latidos]', e.message); }
  }
  // lo que no cambia el estado se guarda como mucho una vez por minuto
  lazySave() { if (this.now() - this.saved >= SAVE_EVERY) this.save(); else this.dirty = true; }
  flush() { if (this.dirty) this.save(); }

  // por fecha de creacion; el numero de orden desempata los creados en el mismo instante
  ids() { return Object.keys(this.beats).sort((a, b) => (this.beats[a].created - this.beats[b].created) || ((this.beats[a].n || 0) - (this.beats[b].n || 0))); }
  get(id) { id = String(id == null ? '' : id); return has(this.beats, id) ? this.beats[id] : null; }
  need(id) { const b = this.get(id); if (!b) throw new Error('No existe ese latido'); return b; }
  publicId(id) { const i = this.ids().indexOf(id); return i < 0 ? null : '_l' + (i + 1); }
  // en publico solo se acepta el alias: el nombre real no debe poder confirmarse probando
  resolve(id, priv) {
    id = String(id == null ? '' : id);
    const m = PUBLIC_ID.exec(id);
    if (m) return this.ids()[Number(m[1]) - 1] || null;
    return priv && this.get(id) ? id : null;
  }
  emit(b, id, action, extra) { this.bus.emit('ev', { kind: 'beat', action, account: ACCOUNT, app: id, name: b.name, since: b.last || 0, every: b.every, ...extra }); }
  // desde cuando se cuenta el plazo: el ultimo latido, o el momento en que se quito la pausa o se cambio el plazo
  base(b) { return Math.max(b.last || 0, b.resumed || 0); }

  create(input = {}) {
    const name = cleanName(input.name), every = cleanEvery(input.every);
    const grace = input.grace == null || input.grace === '' ? defaultGrace(every) : cleanGrace(input.grace);
    const max = this.cfg.limits && this.cfg.limits.beats;
    if (max != null && Object.keys(this.beats).length >= max) throw new Error(`Su plan permite hasta ${max} latidos. Quite uno o pida un plan mayor.`);
    const root = slug(name);
    let id = root;
    for (let i = 2; has(this.beats, id); i++) id = root.slice(0, 31 - String(i).length - 1).replace(/-+$/, '') + '-' + i;
    const token = crypto.randomBytes(32).toString('base64url'), t = this.now();
    this.beats[id] = { n: ++this.seq, name, every, grace, sha: sha(token), created: t, paused: false, last: 0, lastStatus: null, lastMs: null, lastNote: '', state: 'new', since: t, log: [] };
    this.save();
    if (this.onChange) this.onChange();
    return { id, name, every, grace, token };
  }
  // token nuevo (ej. la direccion quedo a la vista en un repositorio): el anterior deja de valer en el acto
  retoken(id) {
    const b = this.need(id), token = crypto.randomBytes(32).toString('base64url');
    b.sha = sha(token);
    this.save();
    return { id: String(id), token };
  }
  update(id, input = {}) {
    const b = this.need(id), t = this.now();
    const name = input.name != null ? cleanName(input.name) : b.name;
    const every = input.every != null ? cleanEvery(input.every) : b.every;
    const grace = input.grace != null && input.grace !== '' ? cleanGrace(input.grace) : b.grace;
    const paused = input.paused != null ? !!input.paused : !!b.paused;
    // al quitar la pausa o cambiar el plazo, el plazo se cuenta desde ahora: lo que no llego mientras tanto no es un atraso
    if ((b.paused && !paused) || every !== b.every || grace !== b.grace) b.resumed = t;
    Object.assign(b, { name, every, grace, paused });
    this.save();
    if (this.onChange) this.onChange();
    return this.row(String(id), true);
  }
  remove(id) {
    this.need(id);
    delete this.beats[String(id)];
    this.save();
    if (this.onChange) this.onChange();
  }

  // token -> id. Se recorren todos los latidos siempre y se compara en tiempo constante: lo que tarda la respuesta
  // no dice si el token existe ni de cual latido es
  find(token) {
    if (typeof token !== 'string' || token.length < 16 || token.length > 128) token = '';
    const h = Buffer.from(sha(token), 'hex');
    let hit = null, any = false;
    for (const id of Object.keys(this.beats)) {
      const s = Buffer.from(String(this.beats[id].sha || ''), 'hex');
      const same = crypto.timingSafeEqual(s.length === 32 ? s : Buffer.alloc(32), h) && s.length === 32;
      any = true;
      if (same && hit === null && token) hit = id;
    }
    if (!any) crypto.timingSafeEqual(Buffer.alloc(32), h);
    return hit;
  }

  // llega un latido
  beat(token, info = {}) {
    const id = this.find(token);
    if (!id) return null;
    const b = this.beats[id], t = this.now(), i = info || {};
    const ok = !(i.status === 'fail' || i.status === 'fallo');
    const ms = cleanMs(i.ms), was = b.state, since = b.since, bad = was === 'late' || was === 'failed';
    if (!Array.isArray(b.log)) b.log = [];
    b.log.push([t, ok ? 1 : 0, ms || 0]); if (b.log.length > KEEP) b.log.splice(0, b.log.length - KEEP);
    Object.assign(b, { last: t, lastStatus: ok ? 'ok' : 'fail', lastMs: ms, lastNote: cleanNote(i.note) });
    const to = ok ? 'ok' : 'failed';
    if (to !== was) {
      b.state = to;
      // una racha mala (atrasado y luego fallo) conserva su inicio: asi «estuvo X con problemas» cuenta todo
      if (!(to === 'failed' && bad)) b.since = t;
      // en pausa se anota el latido pero no se avisa
      if (!b.paused) {
        if (was === 'new') this.emit(b, id, 'first', { status: b.lastStatus });
        if (to === 'failed') this.emit(b, id, 'failed', { note: b.lastNote });
        else if (bad) this.emit(b, id, 'back', { downFor: Math.max(0, t - since) });
      }
      this.save();
    } else this.lazySave();
    return { ok: true, id };
  }

  // marca los atrasados y avisa (una sola vez: el que ya esta atrasado no se vuelve a marcar)
  check() {
    const t = this.now(), changes = [];
    for (const id of this.ids()) {
      const b = this.beats[id];
      if (b.paused || b.state !== 'ok') continue;
      const due = this.base(b) + (b.every + b.grace) * MIN;
      if (t <= due) continue;
      b.state = 'late'; b.since = due;
      changes.push({ id, from: 'ok', to: 'late', since: b.last });
      this.emit(b, id, 'late');
    }
    if (changes.length) this.save(); else this.flush();
    return changes;
  }

  // ------------------------------------------------------------------ para el mapa
  virtual() { return Object.keys(this.beats).length ? [{ id: ACCOUNT, label: 'Latidos', publicLabel: 'Latidos' }] : []; }
  substate(b) { return b.paused ? SUBSTATE.paused : SUBSTATE[b.state] || SUBSTATE.new; }
  // un edificio por latido. El nombre del edificio es el id (privacy.js le pone alias); la etiqueta real solo en privado
  apps(priv = true) {
    const t = this.now();
    return this.ids().map((id, i) => {
      const b = this.beats[id], status = b.paused ? 'degraded' : STATUS[b.state] || 'degraded';
      return { account: ACCOUNT, name: id, source: 'beat', status, substate: this.substate(b), instances: 1, online: status === 'down' ? 0 : 1, cpu: 0, mem: 0,
        uptime: b.state === 'ok' && !b.paused ? Math.max(0, (t - b.since) / 1000) : 0, restartsTotal: 0,
        beat: { label: priv ? b.name : 'Latido ' + (i + 1), every: b.every, grace: b.grace, last: b.last || 0, state: b.state, paused: !!b.paused } };
    });
  }

  // ------------------------------------------------------------------ para la interfaz
  next(b) { return b.paused || !b.last ? null : this.base(b) + b.every * MIN; }
  row(id, priv) {
    const b = this.beats[id], pos = this.ids().indexOf(id) + 1;
    const out = { id: priv ? id : '_l' + pos, name: priv ? b.name : 'Latido ' + pos, every: b.every, grace: b.grace, paused: !!b.paused, state: b.state, substate: this.substate(b),
      status: b.paused ? 'degraded' : STATUS[b.state] || 'degraded', since: b.since || null, created: b.created, last: b.last || null, lastStatus: b.lastStatus || null, lastMs: b.lastMs == null ? null : b.lastMs, next: this.next(b) };
    if (priv) out.lastNote = b.lastNote || '';
    return out;
  }
  list(priv) { return this.ids().map(id => this.row(id, priv)); }
  info(id, priv) {
    id = this.resolve(id, priv); if (!id) return null;
    const b = this.beats[id], log = Array.isArray(b.log) ? b.log : [], t = this.now(), limit = (b.every + b.grace) * MIN;
    // a tiempo: llego con «todo bien» y dentro del plazo contado desde el anterior (o desde que se quito la pausa)
    const series = log.map((x, i) => {
      const from = i ? (b.resumed && b.resumed > log[i - 1][0] && b.resumed <= x[0] ? b.resumed : log[i - 1][0]) : 0;
      return { t: x[0], ok: !!x[1], ms: x[2] || 0, onTime: !!x[1] && (!i || x[0] - from <= limit) };
    });
    const good = series.filter(x => x.onTime).length, ms = series.filter(x => x.ok && x.ms).map(x => x.ms);
    return { ...this.row(id, priv), beats: log.length, onTime: good, fails: series.filter(x => !x.ok).length, pct: log.length ? Math.round(good / log.length * 1000) / 10 : null,
      avgMs: ms.length ? Math.round(ms.reduce((a, c) => a + c, 0) / ms.length) : null, deadline: b.paused || !b.last ? null : this.base(b) + limit,
      note: b.state === 'new' && !b.paused && t - b.created >= DAY ? HINT_NEW : null, series };
  }
}

// ejemplos listos para copiar: la direccion ya viene puesta
function snippets(url) {
  const u = String(url || '');
  return [
    { id: 'cron', title: 'Al final de una tarea programada (cron)', code: `# el latido sale solo si el comando termina bien\n0 3 * * * /ruta/a/su-respaldo.sh && curl -fsS -m 10 "${u}" > /dev/null` },
    { id: 'fallo', title: 'Avisar también cuando la tarea falla', code: `/ruta/a/su-tarea.sh && curl -fsS -m 10 "${u}" > /dev/null || curl -fsS -m 10 "${u}?estado=fallo" > /dev/null` },
    { id: 'node', title: 'Desde un programa en Node', code: `// al terminar bien el trabajo\nawait fetch('${u}', { signal: AbortSignal.timeout(10000) }).catch(() => { });\n\n// si el trabajo falla\nawait fetch('${u}?estado=fallo', { signal: AbortSignal.timeout(10000) }).catch(() => { });` },
    { id: 'worker', title: 'Desde un Worker de Cloudflare con reloj', code: `export default {\n  async scheduled(event, env, ctx) {\n    await hacerElTrabajo(env);\n    ctx.waitUntil(fetch('${u}'));\n  },\n};` },
    { id: 'powershell', title: 'En Windows (PowerShell o el Programador de tareas)', code: `# al final de su script, cuando todo salió bien\nInvoke-RestMethod -Uri "${u}" -TimeoutSec 10 | Out-Null\n\n# para avisar que falló\nInvoke-RestMethod -Uri "${u}?estado=fallo" -TimeoutSec 10 | Out-Null` },
  ];
}

module.exports = { Heartbeats, snippets, slug, defaultGrace, ACCOUNT, SUBSTATE };
