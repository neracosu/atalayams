'use strict';
// Metricas del sistema (/proc), procesos PM2 por cuenta y procesos de Claude Code
const fs = require('fs');
const path = require('path');
const { readText, readJSON, listDir, Ring, loadPasswd } = require('../util');

const CLK_TCK = 100;
const PAGE = 4096;

class HostCollector {
  constructor(cfg, bus) {
    this.cfg = cfg;
    this.bus = bus;
    this.prevCpu = null;
    this.prevNet = null;
    this.prevProc = new Map(); // pid -> ticks
    this.prevTs = Date.now();
    this.history = new Ring(300); // 10 min a 2 s
    this.system = null;
    this.apps = []; // apps PM2
    this.appPids = new Map(); // key cuenta/nombre-id -> pid, para detectar reinicios
    this.claudeProcs = {}; // usuario -> cantidad
    this.topProcs = [];
    this.dumps = new Map(); // usuario -> { ts, byName }
    this.passwd = cfg.edition === 'cloud' ? new Map() : loadPasswd();
    this.accountsHome = cfg.edition === 'cloud' || cfg.edition === 'equipo' ? [] : this.findAccounts();
    // fuera de Linux (Atalaya Equipo en macOS o Windows) no se sabe cuantos procesos claude hay
    this.lite = cfg.edition === 'equipo' && (process.platform !== 'linux' || process.env.ATALAYA_FORCE_LITE === '1');
    this.claudeProcsKnown = !this.lite; // lo reemplaza el registro de cuentas (index.js)
  }

  findAccounts() {
    // cuentas con daemon PM2 o carpeta .claude
    const out = [];
    for (const u of listDir('/home')) {
      const home = '/home/' + u;
      if (fs.existsSync(home + '/.pm2') || fs.existsSync(home + '/.claude')) out.push({ user: u, home });
    }
    return out;
  }

  start() {
    this.tick();
    this.timer = setInterval(() => this.tick(), 2000);
  }

  readCpu() {
    const line = (readText('/proc/stat', '') || '').split('\n')[0].trim().split(/\s+/).slice(1).map(Number);
    const idle = line[3] + (line[4] || 0);
    const total = line.reduce((a, b) => a + b, 0);
    return { idle, total };
  }

  readMem() {
    const m = {};
    for (const l of (readText('/proc/meminfo', '') || '').split('\n')) {
      const mm = l.match(/^(\w+):\s+(\d+)/);
      if (mm) m[mm[1]] = Number(mm[2]) * 1024;
    }
    return m;
  }

  readNet() {
    let rx = 0, tx = 0;
    for (const l of (readText('/proc/net/dev', '') || '').split('\n').slice(2)) {
      const [iface, rest] = l.split(':');
      if (!rest || iface.trim() === 'lo') continue;
      const f = rest.trim().split(/\s+/).map(Number);
      rx += f[0]; tx += f[8];
    }
    return { rx, tx };
  }

  readDisk() {
    try {
      const s = fs.statfsSync('/');
      // mismo criterio que df (y que el panel de Disco)
      const total = s.blocks * s.bsize, used = total - s.bfree * s.bsize, avail = s.bavail * s.bsize;
      return { total, used, avail, pct: used + avail ? used / (used + avail) * 100 : 0 };
    } catch { return null; }
  }

  // Recorre /proc una sola vez: arbol de procesos, CPU por pid, procesos claude
  scanProcs(dt) {
    const procs = new Map();
    for (const d of listDir('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      const raw = readText('/proc/' + d + '/stat');
      if (!raw) continue;
      const r = raw.lastIndexOf(')');
      const comm = raw.slice(raw.indexOf('(') + 1, r);
      const f = raw.slice(r + 2).split(' ');
      const pid = Number(d);
      const ticks = Number(f[11]) + Number(f[12]);
      const rss = Number(f[21]) * PAGE;
      const ppid = Number(f[1]);
      const prev = this.prevProc.get(pid);
      const cpu = prev != null && dt > 0 ? Math.max(0, (ticks - prev) / CLK_TCK / dt * 100) : 0;
      let uid = null;
      try { uid = fs.statSync('/proc/' + d).uid; } catch { /* proceso termino */ }
      procs.set(pid, { pid, ppid, comm, ticks, rss, cpu, uid, start: Number(f[19]) || 0, kids: [] });
    }
    for (const p of procs.values()) { const par = procs.get(p.ppid); if (par) par.kids.push(p); }
    this.prevProc = new Map([...procs.values()].map(p => [p.pid, p.ticks]));
    return procs;
  }

  treeTotals(p) {
    let cpu = 0, rss = 0, n = 0;
    const stack = [p];
    while (stack.length) { const x = stack.pop(); cpu += x.cpu; rss += x.rss; n++; stack.push(...x.kids); }
    return { cpu, rss, n };
  }

  loadDump(user, home) {
    const cached = this.dumps.get(user);
    if (cached && Date.now() - cached.ts < 30000) return cached.byName;
    const byName = new Map();
    const dump = readJSON(home + '/.pm2/dump.pm2', []) || [];
    for (const a of dump) {
      let port = a.env && a.env.PORT ? Number(a.env.PORT) : null;
      const args = Array.isArray(a.args) ? a.args : String(a.args || '').split(' ');
      const pi = args.findIndex(x => x === '-p' || x === '--port');
      if (!port && pi >= 0) port = Number(args[pi + 1]) || null;
      byName.set(a.name, { cwd: a.pm_cwd, port, mode: a.exec_mode });
    }
    this.dumps.set(user, { ts: Date.now(), byName });
    return byName;
  }

  uidOf(user) {
    // en el equipo, los archivos son de quien corre Atalaya (en Windows fs.stat da uid 0)
    if (this.cfg.edition === 'equipo') return process.getuid ? process.getuid() : 0;
    for (const [uid, u] of this.passwd) if (u.name === user) return uid;
    return null;
  }
  // "ahora" en la misma unidad que el starttime de /proc/<pid>/stat (ticks desde el arranque)
  nowTicks() {
    return Math.floor(Number((readText('/proc/uptime', '0') || '0').split(' ')[0]) * CLK_TCK);
  }
  // procesos de ciertos uid con su linea de comando y momento de inicio
  cmdlinesOf(uids) {
    const out = [];
    for (const d of listDir('/proc')) {
      if (!/^\d+$/.test(d)) continue;
      let uid;
      try { uid = fs.statSync('/proc/' + d).uid; } catch { continue; }
      if (!uids.has(uid)) continue;
      const cmd = (readText('/proc/' + d + '/cmdline', '') || '').replace(/\0/g, ' ');
      if (!cmd) continue;
      const raw = readText('/proc/' + d + '/stat', '') || '';
      const start = Number(raw.slice(raw.lastIndexOf(')') + 2).split(' ')[19]) || 0;
      out.push({ uid, cmd, start });
    }
    return out;
  }

  collectApps(procs) {
    const apps = [];
    for (const { user, home } of this.accountsHome) {
      const pidDir = home + '/.pm2/pids';
      const dump = this.loadDump(user, home);
      const groups = new Map();
      for (const f of listDir(pidDir)) {
        const m = f.match(/^(.+)-(\d+)\.pid$/);
        if (!m) continue;
        const [, name, id] = m;
        if (name.startsWith('pm2-')) continue; // modulos internos de PM2
        const pid = Number(readText(pidDir + '/' + f, '').trim());
        const p = procs.get(pid);
        const key = user + '/' + name + '-' + id;
        const prevPid = this.appPids.get(key);
        if (p && prevPid && prevPid !== pid) this.bus.emit('ev', { kind: 'pm2', account: user, app: name, action: 'restart' });
        if (!p && prevPid && procs.size) this.bus.emit('ev', { kind: 'pm2', account: user, app: name, action: 'down' });
        if (p) this.appPids.set(key, pid); else this.appPids.delete(key);
        const g = groups.get(name) || { account: user, name, instances: 0, online: 0, cpu: 0, mem: 0, uptime: 0, ...(dump.get(name) || {}) };
        g.instances++;
        if (p) {
          const t = this.treeTotals(p);
          g.online++; g.cpu += t.cpu; g.mem += t.rss;
          g.startTicks = g.startTicks ? Math.min(g.startTicks, p.start) : p.start; // la instancia mas antigua
        }
        groups.set(name, g);
      }
      // apps del dump que no tienen pid file: detenidas
      for (const [name, d] of dump) {
        if (!name.startsWith('pm2-') && !groups.has(name)) groups.set(name, { account: user, name, instances: 1, online: 0, cpu: 0, mem: 0, ...d });
      }
      apps.push(...[...groups.values()].sort((a, b) => a.name.localeCompare(b.name)));
    }
    const now = this.nowTicks();
    return apps.map(a => ({ ...a, status: a.online === 0 ? 'down' : a.online < a.instances ? 'degraded' : 'online',
      uptime: a.startTicks ? Math.max(0, (now - a.startTicks) / CLK_TCK) : 0 }));
  }

  // Atalaya Cloud: la maquina que aloja la pantalla no es del cliente; no se lee /proc ni el disco
  cloudTick(now) {
    this.apps = [];
    for (const x of this.extra || []) this.apps.push(...x.apps);
    this.system = { ts: now, cloud: true, cores: 0, uptime: 0, load: [0, 0, 0], cpu: 0, mem: { total: 0, used: 0, pct: 0 }, swap: { total: 0, used: 0 },
      disk: null, net: { rx: 0, tx: 0 }, procs: 0 };
    this.history.push({ t: now, cpu: 0, mem: 0, rx: 0, tx: 0, load: 0 });
    this.bus.emit('tick');
  }

  // Atalaya Equipo en macOS o Windows: no hay /proc; lo basico sale del modulo os (sin red ni procesos)
  osTick(now) {
    const os = require('os');
    const t = os.cpus().reduce((a, c) => { const v = c.times; a.idle += v.idle; a.total += v.user + v.nice + v.sys + v.idle + v.irq; return a; }, { idle: 0, total: 0 });
    let cpu = 0;
    if (this.prevCpu) { const dT = t.total - this.prevCpu.total, dI = t.idle - this.prevCpu.idle; cpu = dT > 0 ? (1 - dI / dT) * 100 : 0; }
    this.prevCpu = t;
    const total = os.totalmem(), used = total - os.freemem();
    let disk = null;
    try { const s = fs.statfsSync(os.homedir()); const tot = s.blocks * s.bsize, av = s.bavail * s.bsize; disk = { total: tot, used: tot - s.bfree * s.bsize, avail: av, pct: tot ? (tot - s.bfree * s.bsize) / tot * 100 : 0 }; } catch { }
    this.apps = [];
    for (const x of this.extra || []) this.apps.push(...x.apps);
    this.system = { ts: now, lite: true, cores: os.cpus().length, uptime: os.uptime(), load: os.loadavg(), cpu: Math.round(cpu * 10) / 10,
      mem: { total, used, pct: used / total * 100 }, swap: { total: 0, used: 0 }, disk, net: { rx: 0, tx: 0 }, procs: 0 };
    this.history.push({ t: now, cpu: this.system.cpu, mem: Math.round(this.system.mem.pct * 10) / 10, rx: 0, tx: 0, load: this.system.load[0] });
    this.bus.emit('tick');
  }

  tick() {
    const now = Date.now();
    if (this.cfg.edition === 'cloud') return this.cloudTick(now);
    if (this.lite) return this.osTick(now);
    const dt = (now - this.prevTs) / 1000;
    this.prevTs = now;

    const c = this.readCpu();
    let cpu = 0;
    if (this.prevCpu) {
      const dT = c.total - this.prevCpu.total, dI = c.idle - this.prevCpu.idle;
      cpu = dT > 0 ? (1 - dI / dT) * 100 : 0;
    }
    this.prevCpu = c;

    const n = this.readNet();
    let rxRate = 0, txRate = 0;
    if (this.prevNet && dt > 0) { rxRate = (n.rx - this.prevNet.rx) / dt; txRate = (n.tx - this.prevNet.tx) / dt; }
    this.prevNet = n;

    const m = this.readMem();
    const load = (readText('/proc/loadavg', '0 0 0') || '0 0 0').split(' ').slice(0, 3).map(Number);
    const uptime = Number((readText('/proc/uptime', '0') || '0').split(' ')[0]);
    const cores = (readText('/proc/cpuinfo', '') || '').split('\n').filter(l => l.startsWith('processor')).length || 1;

    const procs = this.scanProcs(dt);
    // PM2 + fuentes extra (servicios de systemd, contenedores Docker)
    this.apps = this.collectApps(procs).map(a => ({ ...a, source: 'pm2' }));
    for (const x of this.extra || []) this.apps.push(...x.apps);

    // procesos claude por usuario (comm = claude)
    const claude = {};
    for (const p of procs.values()) {
      if (p.comm !== 'claude') continue;
      const u = this.passwd.get(p.uid);
      const name = u ? u.name : String(p.uid);
      claude[name] = (claude[name] || 0) + 1;
    }
    this.claudeProcs = claude;

    // top por nombre de comando (agrupado)
    const byComm = new Map();
    for (const p of procs.values()) {
      // nombre limpio: sin rutas ni argumentos (ej. "node /home/x/app" -> "node", "PM2 v6: God" -> "PM2")
      const k = p.comm.split(/[\s:]/)[0].replace(/^.*\//, '') || p.comm;
      const e = byComm.get(k) || { comm: k, cpu: 0, mem: 0, n: 0 };
      e.cpu += p.cpu; e.mem += p.rss; e.n++;
      byComm.set(k, e);
    }
    this.topProcs = [...byComm.values()].sort((a, b) => b.cpu - a.cpu).slice(0, 8)
      .map(e => ({ ...e, cpu: Math.round(e.cpu * 10) / 10 }));
    this.topMem = [...byComm.values()].sort((a, b) => b.mem - a.mem).slice(0, 8)
      .map(e => ({ ...e, cpu: Math.round(e.cpu * 10) / 10 }));

    const memUsed = m.MemTotal - m.MemAvailable;
    this.system = {
      ts: now, cores, uptime, load,
      cpu: Math.round(cpu * 10) / 10,
      mem: { total: m.MemTotal, used: memUsed, pct: memUsed / m.MemTotal * 100 },
      swap: { total: m.SwapTotal, used: m.SwapTotal - m.SwapFree },
      disk: this.readDisk(),
      net: { rx: rxRate, tx: txRate },
      procs: procs.size,
    };
    this.history.push({ t: now, cpu: this.system.cpu, mem: Math.round(this.system.mem.pct * 10) / 10, rx: rxRate, tx: txRate, load: load[0] });
    this.bus.emit('tick');
  }
}

module.exports = { HostCollector };
