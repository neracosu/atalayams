'use strict';
// Sesiones de Claude Code: lee los transcripts .jsonl de cada cuenta y deduce el estado
const fs = require('fs');
const path = require('path');
const { listDir, statSafe, Tailer, readTailLines, readJSON, writeJSONAtomic } = require('../util');
// herramientas que tocan un archivo, para el haz del agente al proyecto: lectura o edicion
const FILE_TOOLS = { Read: 'read', Edit: 'edit', Write: 'edit', MultiEdit: 'edit', NotebookEdit: 'edit' };

// herramienta -> estacion del mundo
const STATIONS = {
  Read: 'library', Grep: 'library', Glob: 'library', LS: 'library', NotebookRead: 'library',
  Edit: 'workshop', Write: 'workshop', MultiEdit: 'workshop', NotebookEdit: 'workshop',
  Bash: 'terminal', BashOutput: 'terminal', KillShell: 'terminal', Monitor: 'terminal', TaskStop: 'terminal',
  WebFetch: 'antenna', WebSearch: 'antenna',
  Agent: 'portal', Task: 'portal', SendMessage: 'portal', Workflow: 'portal',
  AskUserQuestion: 'waiting', ExitPlanMode: 'waiting',
};
function stationFor(tool) {
  if (STATIONS[tool]) return STATIONS[tool];
  if (tool.startsWith('mcp__')) return 'antenna';
  return 'desk';
}

function shortPath(p, cwd) {
  if (!p) return '';
  if (cwd && (p.startsWith(cwd + '/') || p.startsWith(cwd + '\\'))) return p.slice(cwd.length + 1); // Windows usa \
  return p.replace(/^\/home\/[^/]+\//, '~/');
}

// Resumen legible de lo que hace la herramienta (solo modo privado)
function describe(name, input = {}, cwd) {
  switch (name) {
    case 'Bash': return input.description || String(input.command || '').slice(0, 140);
    case 'Read': case 'Edit': case 'Write': case 'MultiEdit': case 'NotebookEdit':
      return shortPath(input.file_path || input.notebook_path, cwd);
    case 'Grep': return 'grep ' + String(input.pattern || '').slice(0, 80);
    case 'Glob': return String(input.pattern || '');
    case 'WebFetch': try { return new URL(input.url).hostname; } catch { return 'web'; }
    case 'WebSearch': return String(input.query || '').slice(0, 100);
    case 'Agent': case 'Task': return input.description || 'subagente';
    case 'Skill': return 'skill ' + (input.skill || '');
    case 'TodoWrite': return 'actualiza tareas';
    default:
      if (name.startsWith('mcp__')) return name.slice(5).replace('__', ' · ');
      return name;
  }
}

// Trozo literal del comando para reconocerlo en /proc/<pid>/cmdline. Claude lo envuelve en
// comillas y escapa caracteres especiales, asi que se toma el tramo "limpio" mas largo.
function bashNeedle(cmd) {
  const parts = String(cmd || '').split(/['"\\$`\n]/).map(x => x.trim()).filter(x => x.length >= 6);
  if (!parts.length) return null;
  return parts.sort((a, b) => b.length - a.length)[0].slice(0, 60);
}

class Agent {
  constructor(o) {
    Object.assign(this, {
      state: 'idle', station: 'desk', tool: null, detail: '', title: '', lastPrompt: '',
      model: '', permMode: '', tokensOut: 0, tools: 0, errors: 0, cwd: '', since: Date.now(),
      lastActivity: 0, pendingSince: 0, subagents: new Map(), waits: new Map(), hookWait: null, doneSubs: new Map(),
    }, o);
  }
}

class ClaudeCollector {
  constructor(cfg, bus, host) {
    this.cfg = cfg;
    this.bus = bus;
    this.host = host;
    this.sessions = new Map(); // ruta jsonl -> Agent
    this.tailers = new Map(); // ruta -> Tailer
    // ruta -> tamano del transcript al cerrarse (SessionEnd); persiste entre reinicios
    this.endedFile = cfg.stateDir + '/ended.json';
    const saved = readJSON(this.endedFile, {}) || {};
    this.ended = new Map(Object.entries(saved).filter(([, v]) => Date.now() - v.at < 86400000).map(([k, v]) => [k, v.size]));
    this.endedAt = new Map(Object.entries(saved).map(([k, v]) => [k, v.at]));
    this.homes = [{ user: 'root', home: '/root' }, ...host.accountsHome]; // lo actualiza el registro de cuentas
  }

  // Un transcript solo se lee si es un archivo normal (no enlace) y su dueno es la cuenta:
  // nadie puede hacer que el servicio (que puede leerlo todo) lea un archivo ajeno.
  uidOf(user) {
    if (!this.uids) this.uids = new Map();
    if (!this.uids.has(user)) this.uids.set(user, this.host.uidOf(user));
    return this.uids.get(user);
  }
  guardFor(user) { const uid = this.uidOf(user); return st => st.isFile() && !st.isSymbolicLink() && st.uid === uid; }
  safeStat(user, file) {
    let st; try { st = fs.lstatSync(file); } catch { return null; }
    return this.guardFor(user)(st) ? st : null;
  }
  countFor(user) { let n = 0; for (const s of this.sessions.values()) if (s.user === user) n++; return n; }

  start() {
    this.scan(true);
    setInterval(() => this.scan(false), 3000);
    setInterval(() => this.pollAll(), 1000);
    setInterval(() => this.expire(), 5000);
    setInterval(() => this.checkApprovals(), 1500);
  }

  scan(initial) {
    const goneMs = this.cfg.claude.goneMinutes * 60000;
    const now = Date.now();
    for (const { user, home } of this.homes) {
      const base = path.join(home, '.claude', 'projects'); // path.join: tambien \\wsl.localhost\<distro>\home\<usuario> en Windows
      for (const proj of listDir(base)) {
        const pdir = path.join(base, proj);
        for (const f of listDir(pdir)) {
          if (!f.endsWith('.jsonl')) continue;
          const file = path.join(pdir, f);
          if (this.sessions.has(file)) { this.scanSubagents(this.sessions.get(file), file, initial); continue; }
          const st = this.safeStat(user, file);
          if (!st || now - st.mtimeMs > goneMs) continue;
          // cerrada por SessionEnd: solo vuelve si el transcript crece despues (sesion reanudada)
          const ended = this.ended.get(file);
          if (ended != null && st.size <= ended) continue;
          if (ended != null) { this.ended.delete(file); this.saveEnded(); }
          this.track(user, file, st, initial);
        }
      }
    }
  }

  track(user, file, st, initial) {
    const id = path.basename(file, '.jsonl');
    if (!st) { // transcript todavia no creado: se lee desde el inicio cuando aparezca
      const s = new Agent({ id, user, file, lastActivity: Date.now(), since: Date.now(), kind: 'session', state: 'thinking' });
      this.sessions.set(file, s);
      this.tailers.set(file, new Tailer(file, l => this.apply(s, l, true), { fromEnd: false, guard: this.guardFor(user) }));
      if (!initial) this.bus.emit('ev', { kind: 'claude', action: 'start', account: user, sid: id });
      return s;
    }
    const s = new Agent({ id, user, file, lastActivity: st.mtimeMs, since: st.mtimeMs, kind: 'session' });
    // reconstruye el estado con la cola del archivo, sin emitir eventos
    const { lines } = readTailLines(file, 512 * 1024);
    for (const l of lines) this.apply(s, l, false);
    s.lastActivity = st.mtimeMs;
    if (Date.now() - st.mtimeMs > this.cfg.claude.idleMinutes * 60000) this.setState(s, 'idle', 'desk');
    this.sessions.set(file, s);
    const t = new Tailer(file, l => this.apply(s, l, true), { fromEnd: true, guard: this.guardFor(user) });
    t.pos = st.size; t.ino = st.ino; t.fromEnd = false;
    this.tailers.set(file, t);
    this.scanSubagents(s, file, true);
    if (!initial) this.bus.emit('ev', { kind: 'claude', action: 'start', account: user, sid: id });
    return s;
  }

  scanSubagents(s, file, initial) {
    const dir = file.slice(0, -6) + '/subagents';
    const now = Date.now();
    for (const f of listDir(dir)) {
      if (!f.endsWith('.jsonl')) continue;
      const sf = dir + '/' + f;
      if (this.tailers.has(sf)) continue;
      const st = this.safeStat(s.user, sf);
      if (!st || now - st.mtimeMs > this.cfg.claude.subagentGoneSeconds * 1000) continue;
      // un subagente que ya termino solo vuelve si su transcript crece
      const done = s.doneSubs.get(sf);
      if (done != null && st.size <= done) continue;
      s.doneSubs.delete(sf);
      const meta = readJSON(sf.replace(/\.jsonl$/, '.meta.json'), {}) || {};
      const a = new Agent({ id: path.basename(f, '.jsonl'), user: s.user, kind: 'subagent', parent: s,
        title: meta.description || '', agentType: meta.agentType || '', toolUseId: meta.toolUseId, lastActivity: st.mtimeMs, cwd: s.cwd });
      const { lines } = readTailLines(sf, 128 * 1024);
      for (const l of lines) this.apply(a, l, false);
      s.subagents.set(sf, a);
      const t = new Tailer(sf, l => this.apply(a, l, true), { fromEnd: true, guard: this.guardFor(s.user) });
      t.pos = st.size; t.ino = st.ino; t.fromEnd = false;
      this.tailers.set(sf, t);
      if (!initial) this.bus.emit('ev', { kind: 'claude', action: 'spawn', account: s.user, sid: s.id, agent: a.id, detail: a.title });
    }
  }

  pollAll() {
    for (const t of this.tailers.values()) t.poll().catch(() => {});
  }

  setState(a, state, station) {
    a.state = state;
    if (station) a.station = station;
  }

  apply(a, line, live) {
    let o;
    try { o = JSON.parse(line); } catch { return; }
    const ts = o.timestamp ? Date.parse(o.timestamp) : Date.now();
    if (o.cwd && !a.cwd) a.cwd = o.cwd;
    if (o.cwd) a.cwd = o.cwd;
    switch (o.type) {
      case 'ai-title': a.title = a.kind === 'session' ? o.aiTitle : a.title; return;
      case 'last-prompt': a.lastPrompt = o.lastPrompt || a.lastPrompt; return;
      case 'permission-mode': a.permMode = o.permissionMode; return;
      case 'system':
        if (o.subtype === 'turn_duration') {
          if (a.waits) { a.waits.clear(); a.hookWait = null; }
          this.setState(a, 'idle', 'desk');
          a.tool = null; a.pendingSince = 0;
          if (live) this.bus.emit('ev', { kind: 'claude', action: 'done', account: a.user, sid: this.sid(a), agent: this.aid(a) });
        }
        return;
      case 'user': {
        a.lastActivity = Math.max(a.lastActivity, ts);
        const c = o.message && o.message.content;
        if (typeof c === 'string') {
          if (o.isMeta || c.startsWith('<')) return;
          if (a.waits) { a.waits.clear(); a.hookWait = null; }
          this.setState(a, 'thinking', 'desk');
          a.lastPrompt = c.slice(0, 200);
          if (live && a.kind === 'session') this.bus.emit('ev', { kind: 'claude', action: 'prompt', account: a.user, sid: a.id, text: a.lastPrompt });
        } else if (Array.isArray(c)) {
          for (const b of c) {
            if (b.type !== 'tool_result') continue;
            a.pendingSince = 0;
            if (a.waits && a.waits.delete(b.tool_use_id)) this.refreshWait(a, 'thinking');
            if (b.is_error) { a.errors++; if (live) this.bus.emit('ev', { kind: 'claude', action: 'error', account: a.user, sid: this.sid(a), agent: this.aid(a), tool: a.tool }); }
            // resultado de un subagente en primer plano: termina
            for (const [sf, sub] of a.subagents || []) if (sub.toolUseId === b.tool_use_id) sub.finished = true;
          }
          if (a.state !== 'idle' && !a.hookWait) this.setState(a, 'thinking');
        }
        return;
      }
      case 'assistant': {
        a.lastActivity = Math.max(a.lastActivity, ts);
        const m = o.message || {};
        if (m.model && !m.model.startsWith('<')) a.model = m.model;
        if (m.usage && m.usage.output_tokens) a.tokensOut += m.usage.output_tokens;
        for (const b of m.content || []) {
          if (b.type === 'tool_use') {
            const station = stationFor(b.name);
            a.tool = b.name; a.tools++;
            a.detail = describe(b.name, b.input, a.cwd);
            a.pendingSince = ts;
            if (!a.hookWait) this.setState(a, station === 'waiting' ? 'waiting' : 'working', station);
            if (live) this.bus.emit('ev', { kind: 'claude', action: 'tool', account: a.user, sid: this.sid(a), agent: this.aid(a), tool: b.name, station, detail: a.detail });
            if (live) this.linkEvents(a, b);
          } else if (b.type === 'text' || b.type === 'thinking') {
            if (!a.pendingSince && !a.hookWait) this.setState(a, 'thinking');
          }
        }
        return;
      }
    }
  }

  // Esperas activas de una sesion: Map clave -> { kind, tool, toolUseId, needle, message, since }.
  // La clave es el tool_use_id cuando existe, para que terminar OTRA herramienta no borre esta espera.
  refreshWait(s, fallbackState = 'working') {
    const first = s.waits.size ? [...s.waits.values()].sort((a, b) => a.since - b.since)[0] : null;
    s.hookWait = first;
    if (first) {
      if (first.tool) s.tool = first.tool;
      if (first.detail) s.detail = first.detail;
      this.setState(s, 'waiting', 'desk');
    } else if (s.state === 'waiting') this.setState(s, fallbackState);
  }
  clearWait(s, key, fallbackState) { if (s.waits.delete(key)) this.refreshWait(s, fallbackState); }
  clearWaits(s, pred, fallbackState) {
    let n = 0;
    for (const [k, w] of s.waits) if (pred(w, k)) { s.waits.delete(k); n++; }
    if (n) this.refreshWait(s, fallbackState);
  }

  // Bash aprobado: el comando pendiente aparece como proceso del usuario (cmdline es legible sin ptrace)
  checkApprovals() {
    const pending = [];
    for (const s of this.sessions.values()) for (const [k, w] of s.waits) if (w.needle) pending.push({ s, k, w });
    if (!pending.length) return;
    const uids = new Set(pending.map(p => this.host.uidOf(p.s.user)));
    const cmds = this.host.cmdlinesOf(uids);
    for (const { s, k, w } of pending) {
      const uid = this.host.uidOf(s.user);
      if (cmds.some(c => c.uid === uid && c.start >= w.startTicks && c.cmd.includes(w.needle))) {
        this.clearWait(s, k, 'working');
        this.bus.emit('ev', { kind: 'claude', action: 'approved', account: s.user, sid: s.id, tool: w.tool });
      }
    }
  }

  // Eventos de hooks de Claude Code: mas rapidos y precisos que el transcript.
  // ev: payload del hook; user: cuenta deducida de transcript_path en el servidor.
  // Hooks de un equipo remoto (laptop) por HTTPS: no hay transcript que leer, todo sale de los hooks.
  onRemoteHook(ev, machine) {
    const account = '_dev-' + machine;
    if (!/^[0-9a-f-]{36}$/i.test(String(ev.session_id || ''))) return;
    const key = `remote:${machine}:${ev.session_id}`;
    if (!this.sessions.has(key)) {
      if (ev.hook_event_name === 'SessionEnd' || this.countFor(account) >= 20) return;
      if (this.ended.has(key) && ev.hook_event_name !== 'SessionStart' && ev.hook_event_name !== 'UserPromptSubmit') return;
      this.ended.delete(key);
      const s = new Agent({ id: ev.session_id, user: account, file: key, kind: 'session', remote: true, machine,
        lastActivity: Date.now(), since: Date.now(), state: 'thinking', cwd: ev.cwd || '' });
      this.sessions.set(key, s);
      this.bus.emit('ev', { kind: 'claude', action: 'start', account, sid: s.id });
    }
    this.onHook({ ...ev, transcript_path: key }, account);
  }

  onHook(ev, user) {
    const file = ev.transcript_path;
    const name = ev.hook_event_name;
    let s = this.sessions.get(file);
    if (!s && name === 'SessionEnd') return;
    if (!s && String(file).startsWith('remote:')) return;
    if (!s) {
      // un hook atrasado (llegan en paralelo) no debe resucitar una sesion ya cerrada
      const ended = this.ended.get(file);
      if (ended != null && name !== 'SessionStart') {
        const st = this.safeStat(user, file);
        if (!st || st.size <= ended) return;
      }
      // tope por cuenta: un emisor no puede inflar la pantalla con sesiones inventadas
      if (this.countFor(user) >= 40) return;
      let exists = true; try { fs.lstatSync(file); } catch { exists = false; }
      const st = this.safeStat(user, file);
      if (exists && !st) return; // existe pero es enlace o de otro dueno
      if (ended != null) { this.ended.delete(file); this.saveEnded(); }
      s = this.track(user, file, st, false);
    }
    s.hooks = true;
    s.lastActivity = Date.now();
    if (ev.cwd) s.cwd = ev.cwd;
    if (ev.permission_mode) s.permMode = ev.permission_mode;
    const emit = (action, extra = {}) => this.bus.emit('ev', { kind: 'claude', action, account: s.user, sid: s.id, ...extra });
    const wait = (key, kind, tool, input, message) => {
      const had = s.waits.size > 0;
      const prev = s.waits.get(key);
      const detail = tool ? describe(tool, input || {}, s.cwd) : '';
      s.waits.set(key, { kind, tool, detail, message: message || '', since: prev ? prev.since : Date.now(),
        needle: tool === 'Bash' ? bashNeedle(input && input.command) : null, startTicks: this.host.nowTicks() });
      this.refreshWait(s);
      if (!had) emit('permission', { tool, detail: kind === 'idle' ? message : detail, waitKind: kind });
    };
    const toolKey = () => ev.tool_use_id || 'tool:' + (ev.tool_name || '?');
    // actividad del agente que demuestra que ya no espera respuesta del usuario
    const notToolWait = w => !w.tool || w.kind !== 'permission';
    switch (name) {
      case 'SessionStart':
        if (ev.source === 'compact') emit('compact');
        return;
      case 'SessionEnd':
        this.drop(file, s, ev.reason);
        return;
      case 'UserPromptSubmit':
        s.waits.clear(); this.refreshWait(s); this.setState(s, 'thinking', 'desk');
        if (s.remote && ev.prompt) { s.lastPrompt = String(ev.prompt).slice(0, 200); emit('prompt', { text: s.lastPrompt }); }
        return;
      case 'PermissionRequest':
        wait(toolKey(), 'permission', ev.tool_name, ev.tool_input);
        return;
      case 'PermissionDenied':
        this.clearWait(s, toolKey(), 'thinking');
        return;
      case 'Notification': {
        const t = ev.notification_type || '';
        const msg = String(ev.message || '').slice(0, 200);
        // el aviso generico solo cuenta si no hay ya un PermissionRequest registrado
        if (t === 'permission_prompt' || /permission/i.test(msg)) { if (!s.waits.size) wait('notif:permission', 'permission', null, null, msg); }
        else if (t === 'idle_prompt') { if (s.state === 'idle' || s.state === 'waiting') wait('notif:idle', 'idle', null, null, msg); }
        else if (t === 'elicitation_dialog') wait('notif:question', 'question', null, null, msg);
        return;
      }
      case 'PreToolUse':
        if (s.remote && ev.tool_name && !s.waits.size) {
          const station = stationFor(ev.tool_name);
          s.tool = ev.tool_name; s.tools++; s.detail = describe(ev.tool_name, ev.tool_input || {}, s.cwd);
          this.setState(s, station === 'waiting' ? 'waiting' : 'working', station);
          emit('tool', { tool: ev.tool_name, station, detail: s.detail });
        }
        if (ev.tool_name === 'AskUserQuestion' || ev.tool_name === 'ExitPlanMode') wait(toolKey(), 'question', ev.tool_name, ev.tool_input);
        return;
      case 'PostToolUse': case 'PostToolUseFailure':
        if (s.remote && name === 'PostToolUseFailure') { s.errors++; emit('error', { tool: ev.tool_name }); }
        // solo se libera la espera de ESA herramienta; los avisos genericos caen con cualquier actividad
        this.clearWaits(s, (w, k) => k === toolKey() || (!ev.tool_use_id && w.tool === ev.tool_name) || k.startsWith('notif:'), 'working');
        return;
      case 'Stop':
        s.waits.clear(); this.refreshWait(s, 'idle'); this.setState(s, 'idle', 'desk'); s.tool = null; s.pendingSince = 0;
        return;
      case 'SubagentStart': case 'SubagentStop': {
        const aid = String(ev.agent_id || '').replace(/^agent-/, '');
        if (!aid) return;
        // la ruta se calcula aqui; nunca se usa la que manda el cliente
        if (!/^[a-z0-9]{6,40}$/i.test(aid)) return;
        const sf = s.remote ? `${file}:agent-${aid}` : file.slice(0, -6) + '/subagents/agent-' + aid + '.jsonl';
        let a = s.subagents.get(sf);
        if (name === 'SubagentStart' && !a && s.subagents.size < 30) {
          a = new Agent({ id: 'agent-' + aid, user: s.user, kind: 'subagent', parent: s, agentType: ev.agent_type || '',
            title: ev.agent_type || 'subagente', lastActivity: Date.now(), cwd: s.cwd, state: 'thinking' });
          s.subagents.set(sf, a);
          if (!s.remote) this.tailers.set(sf, new Tailer(sf, l => this.apply(a, l, true), { fromEnd: false, guard: this.guardFor(s.user) }));
          emit('spawn', { agent: a.id, detail: a.title });
          this.clearWaits(s, w => w.tool === 'Agent' || w.tool === 'Task', 'working');
        } else if (name === 'SubagentStop' && a) a.finished = true;
        return;
      }
    }
  }

  drop(file, s, reason) {
    {
      // tambien las retiradas por inactividad: si no, el escaner las vuelve a traer a los 3 s
      const st = statSafe(file);
      this.ended.set(file, st ? st.size : 0); this.endedAt.set(file, Date.now());
      this.saveEnded();
    }
    this.sessions.delete(file); this.tailers.delete(file);
    for (const sf of s.subagents.keys()) this.tailers.delete(sf);
    this.bus.emit('ev', { kind: 'claude', action: 'end', account: s.user, sid: s.id, reason });
  }

  saveEnded() {
    clearTimeout(this.endedTimer);
    this.endedTimer = setTimeout(() => {
      const out = {};
      for (const [k, size] of this.ended) { const at = this.endedAt.get(k) || Date.now(); if (Date.now() - at < 86400000) out[k] = { size, at }; }
      try { writeJSONAtomic(this.endedFile, out); } catch (e) { console.error('[claude] no se pudo guardar ended.json', e.message); }
    }, 1000);
  }

  // Comunicacion para las animaciones: que proyecto toca el agente (lee o edita un archivo de una app o un
  // sitio) y a quien le escribe con SendMessage (un subagente de la misma sesion o la sesion principal).
  linkEvents(a, b) {
    const input = b.input || {};
    const base = { kind: 'claude', account: a.user, sid: this.sid(a), agent: this.aid(a) };
    if (FILE_TOOLS[b.name] && this.projectOf) {
      let file = String(input.file_path || input.notebook_path || '');
      if (file && !path.isAbsolute(file) && a.cwd) file = path.join(a.cwd, file);
      const target = file && this.projectOf(path.normalize(file));
      if (target) {
        // una animacion por agente y proyecto cada 2 s: una racha de ediciones no inunda la pantalla
        const k = (base.agent || base.sid) + '>' + (target.app || target.site);
        const now = Date.now();
        if (!this.lastTouch) this.lastTouch = new Map();
        if (now - (this.lastTouch.get(k) || 0) > 2000) {
          this.lastTouch.set(k, now);
          if (this.lastTouch.size > 500) this.lastTouch.clear();
          this.bus.emit('ev', { ...base, action: 'touch', mode: FILE_TOOLS[b.name], target });
        }
      }
    }
    if (b.name === 'SendMessage') {
      const to = String(input.to || input.recipient || '').toLowerCase();
      const s = a.kind === 'subagent' ? a.parent : a;
      let dest = null;
      for (const x of s.subagents.values()) {
        if (x === a) continue;
        if (to && [x.id, x.title, x.agentType].some(v => v && String(v).toLowerCase() === to)) { dest = x.id; break; }
      }
      // un subagente que no le escribe a un hermano conocido le escribe a la sesion principal
      if (!dest && a.kind === 'subagent') dest = '';
      this.bus.emit('ev', { ...base, action: 'message', to: dest });
    }
  }

  sid(a) { return a.kind === 'subagent' ? a.parent.id : a.id; }
  // mas sesiones en pantalla que procesos claude vivos en la cuenta: las que sobran se cerraron sin avisar
  // (terminal cerrada, SessionEnd perdido). Se retiran las mas quietas, con 2 min sin actividad y sin esperar
  // al usuario. El servicio no puede ver la carpeta de cada proceso, por eso se cuenta por cuenta.
  dropExtras(now) {
    if (this.host.claudeProcsKnown === false) return;
    const byUser = new Map();
    for (const [file, s] of this.sessions) if (!s.remote) { if (!byUser.has(s.user)) byUser.set(s.user, []); byUser.get(s.user).push([file, s]); }
    for (const [user, list] of byUser) {
      const extra = list.length - (this.host.claudeProcs[user] || 0);
      if (extra <= 0) continue;
      list.sort((a, b) => a[1].lastActivity - b[1].lastActivity).slice(0, extra)
        .filter(([, s]) => now - s.lastActivity > 120000 && !s.hookWait && s.state !== 'working')
        .forEach(([file, s]) => this.drop(file, s, 'closed'));
    }
  }

  aid(a) { return a.kind === 'subagent' ? a.id : null; }

  expire() {
    const now = Date.now();
    this.dropExtras(now);
    const idleMs = this.cfg.claude.idleMinutes * 60000;
    const goneMs = this.cfg.claude.goneMinutes * 60000;
    const subMs = this.cfg.claude.subagentGoneSeconds * 1000;
    for (const [file, s] of this.sessions) {
      const quiet = now - s.lastActivity;
      // sin proceso claude vivo en esa cuenta: se duerme antes
      const procs = this.host.claudeProcs[s.user] || 0;
      if (quiet > goneMs || (!s.remote && this.host.claudeProcsKnown !== false && procs === 0 && quiet > 120000)) {
        this.drop(file, s, 'timeout');
        continue;
      }
      if (s.state !== 'idle' && !s.hookWait && quiet > idleMs) this.setState(s, 'idle', 'desk');
      // herramienta pendiente mucho rato en modo con permisos: probablemente espera al usuario
      if (!s.hooks && s.state === 'working' && s.pendingSince && !['auto', 'bypassPermissions', 'acceptEdits'].includes(s.permMode)
          && !['Bash', 'Agent', 'Task', 'Monitor', 'Workflow'].includes(s.tool) && now - s.pendingSince > 20000) {
        this.setState(s, 'waiting');
      }
      for (const [sf, a] of s.subagents) {
        if (a.finished || now - a.lastActivity > subMs) {
          const st = statSafe(sf);
          s.doneSubs.set(sf, st ? st.size : 0);
          s.subagents.delete(sf); this.tailers.delete(sf);
          this.bus.emit('ev', { kind: 'claude', action: 'despawn', account: s.user, sid: s.id, agent: a.id });
        }
      }
    }
  }

  list() {
    const out = [];
    for (const s of this.sessions.values()) {
      out.push({
        id: s.id, account: s.user, state: s.state, station: s.station, tool: s.tool, detail: s.detail,
        title: s.title, lastPrompt: s.lastPrompt, model: s.model, permMode: s.permMode, tokensOut: s.tokensOut,
        tools: s.tools, errors: s.errors, cwd: s.cwd, since: s.since, lastActivity: s.lastActivity, remote: !!s.remote, machine: s.machine || '',
        hooks: !!s.hooks, waitKind: s.hookWait ? s.hookWait.kind : null, waitSince: s.hookWait ? s.hookWait.since : null,
        waitMessage: s.hookWait ? s.hookWait.message : '',
        subagents: [...s.subagents.values()].map(a => ({ id: a.id, state: a.state, station: a.station, tool: a.tool,
          detail: a.detail, title: a.title, agentType: a.agentType, tokensOut: a.tokensOut, tools: a.tools })),
      });
    }
    return out.sort((a, b) => a.since - b.since);
  }
}

module.exports = { ClaudeCollector, Agent };
