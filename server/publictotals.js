'use strict';
// Totales publicos de anoche: una vez al dia, pasadas las 06:00 de Venezuela, se escribe
// <stateDir>/publico/anoche.json con lo que paso el dia anterior en este servidor (medianoche a medianoche,
// hora de Venezuela, UTC-4 todo el ano):
//   { "fecha": "2026-09-27", "intentos": 1800, "robots": 420, "visitas": 12000 }
// Lo lee un juego web publico como archivo estatico (lo sirve Apache): nunca le pregunta nada a Atalaya.
// Solo totales, redondeados a dos cifras significativas, sin desglose, sin sitios, dominios, IPs ni nombre de
// la maquina. Si una fuente no tiene datos del dia completo, no se escribe nada: mejor ningun archivo que
// cifras inventadas. Apagado por defecto (publicTotals.on en config.json) y solo en la edicion VPS.
//  - intentos: contrasenas equivocadas por SSH (los mismos intentos que cuenta el colector de logs, que ya junta
//    «Invalid user» y «Failed password» en uno) mas las de cPanel, WHM y webmail (login_log, como la revision
//    de accesos; sin los escaneres que tocan el panel sin usuario)
//  - robots: IPs distintas que se quedaron sin nada: sondeos a rutas vulnerables rechazados (defensa web),
//    bloqueos del cortafuegos (cPHulk, CSF, fail2ban) y presos de la carcel de Atalaya
//  - visitas: paginas vistas por personas (la analitica: sin robots ni recursos), repartidas por su hora real
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { readJSON, writeJSONAtomic } = require('./util');
const { dayOf } = require('./analytics');
const { parseFailed, tail, firstTime } = require('./audits/logins');

const MIN = 60000, DAY = 86400000;
const VE = -4 * 3600000; // Venezuela: UTC-4, sin horario de verano
const HOUR_OUT = 6; // se publica pasadas las 06:00 de Venezuela
const GAP = 15 * MIN; // un corte mas largo que esto deja el dia incompleto
const MAX_IPS = 100000; // tope de IPs distintas por dia (en huellas cortas)

// fecha de Venezuela (AAAA-MM-DD) de un momento, y el comienzo de un dia de Venezuela
const dateVE = t => new Date(t + VE).toISOString().slice(0, 10);
const startVE = fecha => Date.parse(fecha + 'T00:00:00Z') - VE;
const yesterdayVE = now => dateVE(startVE(dateVE(now)) - 1);
// dos cifras significativas: 1847 -> 1800, 12345 -> 12000, 47 -> 47
function round2(n) {
  n = Math.round(Number(n) || 0);
  if (n < 100) return Math.max(0, n);
  const p = 10 ** (Math.floor(Math.log10(n)) - 1);
  return Math.round(n / p) * p;
}

class PublicTotals {
  // opts: analytics (visitas), logins (revision de accesos: carpeta del login_log), webdef (sondeos rechazados),
  // sshLog (registro de accesos SSH que lee el colector de logs)
  constructor(cfg, bus, opts = {}) {
    this.cfg = cfg; this.bus = bus;
    this.analytics = opts.analytics || null; this.logins = opts.logins || null; this.webdef = opts.webdef || null;
    this.sshLog = opts.sshLog || null;
    const pt = cfg.publicTotals || {};
    this.dir = pt.dir || path.join(cfg.stateDir, 'publico');
    this.out = path.join(this.dir, 'anoche.json');
    this.file = path.join(cfg.stateDir, 'anoche-cuentas.json'); // lo contado, privado (600)
    const st = readJSON(this.file, null) || {};
    this.salt = st.salt || crypto.randomBytes(8).toString('hex');
    this.pulse = st.pulse || 0; // ultima vez que se estaba contando
    this.done = st.done || null; // ultima fecha ya resuelta (escrita o descartada)
    this.days = {}; // fecha -> { since, cut, ssh, ips: Set }
    for (const [f, d] of Object.entries(st.days || {})) this.days[f] = { since: d.since, cut: !!d.cut, ssh: d.ssh || 0, ips: new Set(d.ips || []) };
    this.dirty = false; this.savedAt = 0;
  }
  available() { return (this.cfg.edition || 'vps') === 'vps' && !!(this.cfg.publicTotals && this.cfg.publicTotals.on === true); }

  start() {
    if (!this.available()) return false;
    this.listen();
    const loop = () => { try { this.tick(); this.run(); } catch (err) { console.error('[anoche]', err.message); } };
    loop();
    this.timer = setInterval(loop, MIN); this.timer.unref && this.timer.unref();
    return true;
  }
  // lo que se cuenta de los eventos: intentos por SSH, bloqueos del cortafuegos y de la carcel, sondeos rechazados
  listen() {
    this.bus.on('ev', e => {
      try {
        if (e.kind === 'attack' && e.service === 'ssh' && !e.late) this.attempt(Date.now());
        else if ((e.kind === 'block' || (e.kind === 'defense' && e.action === 'block')) && e.ip) this.robot(e.ip, Date.now());
      } catch (err) { console.error('[anoche]', err.message); }
    });
    if (this.webdef) this.webdef.onRefused = (ip, t) => { if (ip) this.robot(ip, t); };
  }

  // cada minuto: el dia de hoy queda anotado y se ve si hubo un corte (Atalaya detenida o el equipo dormido)
  tick(now = Date.now()) {
    if (this.pulse && now - this.pulse > GAP) { const d = this.days[dateVE(this.pulse)]; if (d) d.cut = true; }
    const f = dateVE(now);
    if (!this.days[f]) this.days[f] = { since: now, cut: false, ssh: 0, ips: new Set() };
    this.pulse = now; this.dirty = true;
    // solo quedan los ultimos dias
    const keep = dateVE(now - 3 * DAY);
    for (const k of Object.keys(this.days)) if (k < keep) delete this.days[k];
    if (now - this.savedAt >= 5 * MIN) this.flush(now);
  }
  day(t) { return this.days[dateVE(t)] || null; } // lo que llega de un dia que no se estaba contando no se anota
  attempt(t) { const d = this.day(t); if (d) { d.ssh++; this.dirty = true; } }
  robot(ip, t) {
    const d = this.day(t); if (!d || d.ips.size >= MAX_IPS) return;
    // huella corta de la IP (no se guardan IPs): la misma IP cuenta una vez por dia, aunque se relean los logs
    const h = crypto.createHash('sha1').update(this.salt + '|' + ip).digest('base64').slice(0, 10);
    if (!d.ips.has(h)) { d.ips.add(h); this.dirty = true; }
  }
  // el dia se conto entero: empezo a contarse en sus primeros minutos y no hubo cortes
  complete(fecha) { const d = this.days[fecha]; return !!(d && !d.cut && d.since - startVE(fecha) <= GAP); }

  flush(now = Date.now()) {
    if (!this.dirty) return;
    const days = {};
    for (const [f, d] of Object.entries(this.days)) days[f] = { since: d.since, cut: d.cut, ssh: d.ssh, ips: [...d.ips] };
    try { writeJSONAtomic(this.file, { salt: this.salt, pulse: this.pulse, done: this.done, days }, 0o600); this.dirty = false; this.savedAt = now; } catch (e) { console.error('[anoche]', e.message); }
  }

  // contrasenas equivocadas en cPanel, WHM y webmail de un dia. undefined: no hay panel; null: lo leido no
  // alcanza a cubrir el dia (registro rotado o cortado)
  panelFails(fecha) {
    const L = this.logins; if (!L || !L.dir) return undefined;
    const file = path.join(L.dir, 'login_log');
    if (!fs.existsSync(file)) return undefined;
    const txt = tail(file, 8 << 20); if (txt == null) return null;
    const a = startVE(fecha), b = a + DAY, first = firstTime(txt);
    if (first == null || first > a) return null;
    return parseFailed(txt, a).filter(f => f.t < b).length;
  }
  // paginas vistas por personas de un dia de Venezuela, sumando las de todos los sitios. La analitica guarda cada
  // dia en la hora local del servidor, con las paginas por hora: cada hora se ubica en su dia de Venezuela
  visits(fecha) {
    const A = this.analytics; if (!A) return null;
    const a = startVE(fecha), b = a + DAY;
    const keys = new Set(Object.values(A.index || {}));
    for (const id of A.months.keys()) keys.add(id.slice(0, id.lastIndexOf('|')));
    const locals = new Set([dayOf(a), dayOf(b - 1)]);
    let pv = 0, seen = false;
    for (const key of keys) for (const L of locals) {
      const d = A.month(key, L.slice(0, 7)).days[L]; if (!d) continue;
      seen = true;
      const [y, m, dd] = L.split('-').map(Number);
      (d.hours || []).forEach((n, h) => { const t = new Date(y, m - 1, dd, h, 30).getTime(); if (t >= a && t < b) pv += n || 0; });
    }
    return seen ? pv : null;
  }

  // los totales de un dia, o { skip: motivo } si falta algo
  totals(fecha) {
    if (!this.complete(fecha)) return { skip: 'el dia no se conto completo (Atalaya se encendio tarde o estuvo detenida)' };
    const d = this.days[fecha];
    const ssh = this.sshLog && fs.existsSync(this.sshLog) ? d.ssh : undefined;
    const panel = this.panelFails(fecha);
    if (panel === null) return { skip: 'el registro de accesos del panel no cubre el dia' };
    if (ssh === undefined && panel === undefined) return { skip: 'no hay registro de accesos (SSH ni panel)' };
    const intentos = (ssh || 0) + (panel || 0), robots = d.ips.size, visitas = this.visits(fecha);
    // en un servidor publicado un cero no es una noche tranquila: es una fuente que no se esta leyendo
    if (!intentos) return { skip: 'sin intentos de acceso' };
    if (!robots) return { skip: 'sin robots frenados' };
    if (!visitas) return { skip: 'sin visitas en la analitica' };
    return { fecha, intentos: round2(intentos), robots: round2(robots), visitas: round2(visitas) };
  }

  // pasadas las 06:00 de Venezuela, una vez por dia
  run(now = Date.now()) {
    if (!this.available()) return null;
    if (new Date(now + VE).getUTCHours() < HOUR_OUT) return null;
    const fecha = yesterdayVE(now);
    if (this.done === fecha) return null;
    const r = this.totals(fecha);
    this.done = fecha; this.dirty = true;
    if (r.skip) { console.log(`[anoche] ${fecha}: no se escribe, ${r.skip}`); this.flush(now); return r; }
    this.write(r);
    this.flush(now);
    return r;
  }
  // escritura atomica (archivo temporal en la misma carpeta y rename): Apache nunca ve un archivo a medias
  write(r) {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o755 });
    fs.chmodSync(this.dir, 0o755);
    const tmp = path.join(this.dir, '.anoche.json.' + process.pid + '.tmp');
    fs.writeFileSync(tmp, JSON.stringify({ fecha: r.fecha, intentos: r.intentos, robots: r.robots, visitas: r.visitas }) + '\n', { mode: 0o644 });
    fs.chmodSync(tmp, 0o644); // la mascara del proceso no decide los permisos
    fs.renameSync(tmp, this.out);
  }
}

module.exports = { PublicTotals, round2, dateVE, startVE, yesterdayVE };
