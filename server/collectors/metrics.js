'use strict';
// Metricas detalladas para los paneles de cada indicador: CPU por nucleo y por modo, desglose de
// memoria, particiones e inodos, lectura/escritura de disco, interfaces de red y conexiones TCP.
const fs = require('fs');
const { readText, Ring } = require('../util');

const REAL_FS = new Set(['ext2', 'ext3', 'ext4', 'xfs', 'btrfs', 'zfs', 'f2fs', 'reiserfs', 'jfs', 'vfat', 'exfat', 'ntfs', 'ntfs3', 'nfs', 'nfs4', 'cifs', 'fuse.sshfs']);
const MODES = ['user', 'nice', 'system', 'idle', 'iowait', 'irq', 'softirq', 'steal'];
const TCP_STATES = { '01': 'establecidas', '0A': 'escuchando', '06': 'cerrando (TIME_WAIT)', '08': 'cerrando', '02': 'abriendo', '03': 'abriendo' };

class MetricsCollector {
  constructor(bus, cfg = {}) {
    this.prevCpu = null; this.prevDisk = null; this.prevNet = null; this.prevT = 0;
    this.cpu = { cores: [], modes: {} }; this.mem = {}; this.mounts = []; this.io = { read: 0, write: 0, devices: [] };
    this.ifaces = []; this.tcp = {}; this.procs = { running: 0, blocked: 0 };
    this.ioHistory = new Ring(300);
    // Atalaya Cloud no mira la maquina que la aloja; fuera de Linux no hay /proc que leer
    if (cfg.edition === 'cloud' || process.platform !== 'linux') return;
    bus.on('tick', () => this.tick());
    this.slow(); setInterval(() => this.slow(), 10000);
  }

  tick() {
    const now = Date.now(), dt = this.prevT ? (now - this.prevT) / 1000 : 0;
    this.prevT = now;
    // CPU: cada linea cpuN de /proc/stat
    const stat = readText('/proc/stat', '') || '';
    const cpus = {};
    for (const l of stat.split('\n')) {
      const m = l.match(/^(cpu\d*)\s+(.*)$/);
      if (m) cpus[m[1]] = m[2].trim().split(/\s+/).map(Number);
      const p = l.match(/^procs_(running|blocked)\s+(\d+)/);
      if (p) this.procs[p[1]] = Number(p[2]);
    }
    if (this.prevCpu) {
      const pct = (a, b) => { const d = a.map((v, i) => v - (b[i] || 0)); const tot = d.reduce((x, y) => x + y, 0) || 1; return { d, tot }; };
      this.cpu.cores = Object.keys(cpus).filter(k => k !== 'cpu').map(k => {
        const { d, tot } = pct(cpus[k], this.prevCpu[k] || []);
        return Math.round((1 - (d[3] + (d[4] || 0)) / tot) * 1000) / 10;
      });
      const { d, tot } = pct(cpus.cpu, this.prevCpu.cpu);
      this.cpu.modes = Object.fromEntries(MODES.map((m, i) => [m, Math.round((d[i] || 0) / tot * 1000) / 10]));
    }
    this.prevCpu = cpus;
    // memoria
    const mi = {};
    for (const l of (readText('/proc/meminfo', '') || '').split('\n')) { const m = l.match(/^(\w+):\s+(\d+)/); if (m) mi[m[1]] = Number(m[2]) * 1024; }
    this.mem = { total: mi.MemTotal, available: mi.MemAvailable, free: mi.MemFree, cached: (mi.Cached || 0) + (mi.SReclaimable || 0), buffers: mi.Buffers,
      shmem: mi.Shmem, swapTotal: mi.SwapTotal, swapUsed: (mi.SwapTotal || 0) - (mi.SwapFree || 0), dirty: mi.Dirty,
      apps: (mi.MemTotal || 0) - (mi.MemAvailable || 0) };
    // disco: sectores leidos y escritos por dispositivo fisico
    const disk = {};
    for (const l of (readText('/proc/diskstats', '') || '').split('\n')) {
      const f = l.trim().split(/\s+/);
      if (f.length < 14 || !/^(sd[a-z]+|vd[a-z]+|xvd[a-z]+|nvme\d+n\d+|mmcblk\d+)$/.test(f[2])) continue;
      disk[f[2]] = { r: Number(f[5]) * 512, w: Number(f[9]) * 512, busy: Number(f[12]) };
    }
    if (this.prevDisk && dt > 0) {
      this.io.devices = Object.entries(disk).map(([dev, x]) => {
        const p = this.prevDisk[dev] || x;
        return { dev, read: Math.max(0, (x.r - p.r) / dt), write: Math.max(0, (x.w - p.w) / dt), util: Math.min(100, Math.max(0, (x.busy - p.busy) / (dt * 10))) };
      });
      this.io.read = this.io.devices.reduce((n, x) => n + x.read, 0);
      this.io.write = this.io.devices.reduce((n, x) => n + x.write, 0);
      this.ioHistory.push({ t: now, read: this.io.read, write: this.io.write });
    }
    this.prevDisk = disk;
    // red por interfaz
    const net = {};
    for (const l of (readText('/proc/net/dev', '') || '').split('\n').slice(2)) {
      const [iface, rest] = l.split(':');
      if (!rest) continue;
      const f = rest.trim().split(/\s+/).map(Number);
      net[iface.trim()] = { rx: f[0], tx: f[8], rxErr: f[2], txErr: f[10] };
    }
    if (this.prevNet && dt > 0) {
      this.ifaces = Object.entries(net).filter(([n]) => n !== 'lo').map(([name, x]) => {
        const p = this.prevNet[name] || x;
        return { name, rx: Math.max(0, (x.rx - p.rx) / dt), tx: Math.max(0, (x.tx - p.tx) / dt), rxTotal: x.rx, txTotal: x.tx, errors: x.rxErr + x.txErr };
      }).sort((a, b) => (b.rx + b.tx) - (a.rx + a.tx));
    }
    this.prevNet = net;
  }

  // cada 10 s: particiones reales con espacio e inodos, y conexiones TCP por estado
  slow() {
    const seen = new Set(), out = [];
    for (const l of (readText('/proc/mounts', '') || '').split('\n')) {
      const [dev, mnt, type] = l.split(' ');
      if (!mnt || !REAL_FS.has(type) || seen.has(dev) || /^\/(snap|run|sys|proc)\b/.test(mnt)) continue;
      seen.add(dev);
      try {
        const s = fs.statfsSync(mnt.replace(/\\040/g, ' '));
        // mismo criterio que df: usado / (usado + disponible), descontando el espacio reservado a root
        const total = s.blocks * s.bsize, avail = s.bavail * s.bsize, used = total - s.bfree * s.bsize;
        out.push({ mount: mnt, type, total, used, avail, pct: used + avail ? used / (used + avail) * 100 : 0, inodes: s.files, inodesUsed: s.files - s.ffree, inodesPct: s.files ? (s.files - s.ffree) / s.files * 100 : 0 });
      } catch { /* sin permiso o desmontado */ }
    }
    this.mounts = out.sort((a, b) => b.total - a.total);
    const tcp = {};
    for (const f of ['/proc/net/tcp', '/proc/net/tcp6']) for (const l of (readText(f, '') || '').split('\n').slice(1)) {
      const st = (l.trim().split(/\s+/)[3] || '');
      if (!st) continue;
      const k = TCP_STATES[st] || 'otras';
      tcp[k] = (tcp[k] || 0) + 1;
    }
    this.tcp = tcp;
  }
}

module.exports = { MetricsCollector };
