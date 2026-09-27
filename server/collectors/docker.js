'use strict';
// Contenedores Docker (o Podman con API compatible) como edificios del distrito "_docker".
// Lista por la API del socket local; CPU y memoria desde el cgroup del contenedor; reinicios con inspect.
const http = require('http');
const fx = require('../platform/fsx');

const SOCKETS = ['/var/run/docker.sock', '/run/docker.sock', '/run/podman/podman.sock'];

function api(socketPath, path) {
  return new Promise((resolve, reject) => {
    const req = http.request({ socketPath, path, method: 'GET', timeout: 4000, headers: { Host: 'docker' } }, res => {
      let d = ''; res.setEncoding('utf8');
      res.on('data', c => { d += c; if (d.length > 8 << 20) req.destroy(); });
      res.on('end', () => { if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode)); try { resolve(JSON.parse(d)); } catch (e) { reject(e); } });
    });
    req.on('timeout', () => req.destroy(new Error('timeout'))); req.on('error', reject); req.end();
  });
}

// cgroup v2 con driver systemd (docker-<id>.scope) o cgroupfs (/docker/<id>)
function cgroupStats(id) {
  for (const base of [`/sys/fs/cgroup/system.slice/docker-${id}.scope`, `/sys/fs/cgroup/docker/${id}`, `/sys/fs/cgroup/machine.slice/libpod-${id}.scope`]) {
    const mem = Number(fx.read(base + '/memory.current').trim());
    const usec = Number((fx.read(base + '/cpu.stat').match(/^usage_usec (\d+)/m) || [])[1]);
    if (mem || usec) return { mem: mem || 0, usec: usec || 0 };
  }
  return null;
}

const STATUS = s => s === 'running' ? 'online' : s === 'restarting' || s === 'paused' || s === 'created' ? 'degraded' : 'down';

class DockerCollector {
  constructor(cfg, bus) {
    this.cfg = cfg; this.bus = bus;
    this.apps = [];
    this.prev = new Map(); // id -> { usec, t, state, started, restarts }
    this.inspectAt = 0;
    this.socket = (cfg.docker && cfg.docker.socket) || SOCKETS.find(s => fx.exists(s)) || null;
  }

  start() {
    if (!this.socket) return;
    this.poll();
    setInterval(() => this.poll(), 5000);
  }

  async poll() {
    let list;
    try { list = await api(fx.P(this.socket), '/containers/json?all=1'); } catch { return; }
    const now = Date.now();
    // cada 30 s se piden reinicios y hora de arranque (inspect es mas caro)
    const deep = now - this.inspectAt > 30000;
    if (deep) this.inspectAt = now;
    const details = deep ? await Promise.all(list.map(c => api(fx.P(this.socket), `/containers/${c.Id}/json`).catch(() => null))) : [];
    this.apply(list, details, now);
  }

  apply(list, details = [], now = Date.now()) {
    const out = [];
    list.forEach((c, i) => {
      const id = c.Id;
      const name = String((c.Names && c.Names[0]) || id.slice(0, 12)).replace(/^\//, '');
      const d = details[i];
      const p = this.prev.get(id) || {};
      const cg = cgroupStats(id);
      const cpu = cg && p.usec != null && now > p.t ? Math.max(0, (cg.usec - p.usec) / ((now - p.t) * 1000) * 100) : 0;
      const started = d ? d.State && d.State.StartedAt : p.started;
      const restarts = d ? d.RestartCount || 0 : p.restarts || 0;
      if (p.state === 'running' && c.State !== 'running' && c.State !== 'restarting') this.bus.emit('ev', { kind: 'pm2', account: '_docker', app: name, action: 'down', source: 'docker' });
      else if (p.started && started && started !== p.started && c.State === 'running') this.bus.emit('ev', { kind: 'pm2', account: '_docker', app: name, action: 'restart', source: 'docker' });
      this.prev.set(id, { usec: cg ? cg.usec : p.usec, t: now, state: c.State, started, restarts });
      const labels = c.Labels || {};
      out.push({
        account: '_docker', name, source: 'docker', id: id.slice(0, 12), image: c.Image, status: STATUS(c.State), substate: c.Status || c.State,
        instances: 1, online: c.State === 'running' ? 1 : 0, cpu: Math.round(cpu * 10) / 10, mem: cg ? cg.mem : 0,
        uptime: started && c.State === 'running' ? Math.max(0, (now - Date.parse(started)) / 1000) : 0, restartsTotal: restarts,
        compose: labels['com.docker.compose.project'] || '', service: labels['com.docker.compose.service'] || '',
        ports: (c.Ports || []).filter(x => x.PublicPort).map(x => `${x.IP && x.IP !== '0.0.0.0' ? x.IP + ':' : ''}${x.PublicPort}→${x.PrivatePort}/${x.Type}`),
        port: ((c.Ports || []).find(x => x.PublicPort && (x.IP === '127.0.0.1' || x.IP === '0.0.0.0')) || {}).PublicPort || null,
      });
    });
    // se olvidan contenedores borrados
    for (const id of [...this.prev.keys()]) if (!list.some(c => c.Id === id)) this.prev.delete(id);
    this.apps = out;
  }
}

module.exports = { DockerCollector, cgroupStats };
