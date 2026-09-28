'use strict';
// Alertas por Telegram y por correo (SMTP propio: Gmail, Outlook, el del hosting...): lo grave llega aunque nadie
// este mirando la pantalla. La configuracion vive en <stateDir>/alerts.json (600), no gasta conectores del plan.
// Telegram: El dueno crea un bot con
// @BotFather, pega el token en Atalaya y le escribe «/start <codigo>» al bot: asi Atalaya reconoce su chat (nadie
// mas puede engancharse). Cada tipo de aviso se enciende o apaga; el mismo aviso no se repite en 30 min, hay un
// tope por hora y un horario de silencio en el que solo pasa lo grave. Los mensajes no llevan IPs ni rutas: el
// sitio, el motivo corto y un enlace a la ficha. Cada manana, un resumen de las ultimas 24 horas.
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { readJSON, writeJSONAtomic } = require('./util');
const { sendMail, PRESETS } = require('./smtp');

const API = () => process.env.ATALAYA_TELEGRAM_API || 'https://api.telegram.org';
const CATS = {
  security: { label: 'Seguridad: puertas traseras, archivos expuestos, fuerza bruta', on: true, critical: true },
  jail: { label: 'Cárcel: IPs que bloqueó la defensa automática', on: true },
  down: { label: 'Caídas: servicios caídos y despliegues fallidos', on: true, critical: true },
  saturation: { label: 'Saturación: servidor al límite', on: true, critical: true },
  traffic: { label: 'Tráfico: scraping, escaneos y picos de visitas', on: false },
  requests: { label: 'Solicitudes de acceso a Atalaya que llegan a su nube', on: true, cloudOnly: true },
  aportes: { label: 'Aportes de la comunidad (.zip) que llegan a su nube', on: true, cloudOnly: true },
  summary: { label: 'Resumen de cada mañana', on: true },
};
const DEFAULTS = { cats: Object.fromEntries(Object.entries(CATS).map(([k, v]) => [k, v.on])), quiet: { from: 23, to: 7 }, summaryHour: 8, maxPerHour: 12 };
const esc = s => String(s == null ? '' : s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

function call(token, method, body) {
  return new Promise(resolve => {
    const data = JSON.stringify(body || {});
    const u = new URL(`${API()}/bot${token}/${method}`);
    const req = (u.protocol === 'http:' ? require('http') : https).request(u, { method: 'POST', timeout: 15000, headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, res => {
      let b = ''; res.setEncoding('utf8'); res.on('data', c => { b += c; }); res.on('end', () => { let j = null; try { j = JSON.parse(b); } catch { } resolve(j || { ok: false, description: 'Respuesta inválida de Telegram' }); });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, description: 'Telegram no respondió' }); });
    req.on('error', e => resolve({ ok: false, description: e.message }));
    req.end(data);
  });
}

class Alerts {
  constructor(cfg, bus, secrets, ctx = {}, opts = {}) {
    this.cfg = cfg; this.bus = bus; this.secrets = secrets; this.ctx = ctx;
    this.sent = new Map(); // clave -> ultima vez (el mismo aviso no se repite en 30 min)
    this.hour = []; // envios de la ultima hora (tope)
    this.log = []; // eventos de las ultimas 24 h para el resumen
    this.linkCode = null; // codigo de un solo uso para enganchar un chat
    this.now = opts.now || (() => Date.now());
    this.file = path.join(cfg.stateDir || '.', 'alerts.json');
    this.data = readJSON(this.file, null) || {};
    // antes Telegram se guardaba como conector: se muda al archivo propio (no gasta conectores del plan)
    const old = secrets && secrets.connectors().find(c => c.type === 'telegram');
    if (old && !this.data.telegram) { const { id, added, type, conf, ...t } = old; this.data.telegram = t; if (conf) this.data.conf = conf; this.save(); try { secrets.delConnector(old.id); } catch { } }
    this.localHour = opts.localHour || (t => new Date(t).getHours());
    bus.on('ev', e => { try { this.onEvent(e); } catch (err) { console.error('[alertas]', err.message); } });
    if (!opts.manual) setInterval(() => this.tick().catch(() => { }), 60000).unref();
  }

  save() { try { fs.mkdirSync(path.dirname(this.file), { recursive: true }); writeJSONAtomic(this.file, this.data, 0o600); } catch (e) { console.error('[alertas]', e.message); } }
  conn() { return this.data.telegram || null; }
  email() { return this.data.email || null; }
  conf() { const c = this.data.conf || {}; return { ...DEFAULTS, ...c, cats: { ...DEFAULTS.cats, ...(c.cats || {}) } }; }
  saveConn(patch) { this.data.telegram = { chats: [], ...(this.data.telegram || {}), ...patch }; this.save(); }
  anyChannel() { const t = this.conn(), m = this.email(); return !!((t && t.token && (t.chats || []).length) || (m && m.host && (m.to || []).length)); }
  status() {
    const c = this.conn(), m = this.email();
    return { connected: !!(c && c.token), bot: c && c.bot || null, chats: (c && c.chats || []).map(x => ({ id: String(x.id), name: x.name })), conf: this.conf(), cats: Object.fromEntries(Object.entries(CATS).filter(([, v]) => !v.cloudOnly || this.requestsFile).map(([k, v]) => [k, v.label])), pending: !!this.linkCode,
      email: m ? { preset: m.preset, host: m.host, port: m.port, secure: m.secure, user: m.user, from: m.from, to: m.to, hasPass: !!m.pass } : null, presets: PRESETS };
  }

  // correo: se guarda solo si la prueba sale bien (asi no queda un canal roto)
  async setEmail(o) {
    const cur = this.email() || {};
    const m = { preset: String(o.preset || 'custom'), host: String(o.host || '').trim(), port: +o.port || 587, secure: ['ssl', 'starttls', 'none'].includes(o.secure) ? o.secure : 'starttls',
      user: String(o.user || '').trim(), pass: o.pass ? String(o.pass) : cur.pass || '', from: String(o.from || o.user || '').trim(),
      to: String(o.to || '').split(/[,;\s]+/).map(x => x.trim()).filter(x => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x)).slice(0, 10) };
    if (!m.host || !/^[a-z0-9.-]+$/i.test(m.host)) throw new Error('Servidor SMTP inválido');
    if (!m.to.length) throw new Error('Escriba al menos un correo de destino válido');
    if (!/^[^@\s]+@[^@\s]+$/.test(m.from)) throw new Error('El remitente debe ser un correo');
    await sendMail({ ...m, fromName: `Atalaya · ${this.cfg.title || 'servidor'}` }, { to: m.to, ...this.mailOf(`<b>Atalaya conectada por correo</b>\nDesde ahora le aviso por aquí lo importante de <b>${esc(this.cfg.title || 'su servidor')}</b>.`, this.link(null)) });
    this.data.email = m; this.save();
    console.log(`[alertas] correo configurado: ${m.host} -> ${m.to.length} destinatario(s)`);
    return { ok: true };
  }
  removeEmail() { delete this.data.email; this.save(); }

  // el mismo texto de Telegram, como correo: asunto = primera linea sin etiquetas; cuerpo HTML sobrio con el enlace
  mailOf(text, url) {
    const plain = t => t.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
    const lines = text.split('\n'), subject = plain(lines[0]).slice(0, 140);
    const body = lines.map((l, i) => `<p style="margin:0 0 10px;${i ? 'color:#334155' : 'font-size:17px;color:#0f172a'}">${l}</p>`).join('');
    const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;padding:22px;border:1px solid #e2e8f0;border-radius:12px">
      <div style="font:700 12px/1 ui-monospace,monospace;letter-spacing:.18em;color:#0891b2;margin-bottom:14px">ATALAYA · ${esc(this.cfg.title || '')}</div>${body}
      ${url ? `<p style="margin:18px 0 0"><a href="${esc(url)}" style="display:inline-block;background:#0891b2;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px;font-weight:600">Abrir en Atalaya</a></p>` : ''}
      <p style="margin:18px 0 0;color:#94a3b8;font-size:12px">Alerta de Atalaya Monitor Server. Cambie qué le avisa en menú › Alertas.</p></div>`;
    return { subject: `[Atalaya] ${subject}`, html, text: plain(text) + (url ? `\n\nAbrir en Atalaya: ${url}` : '') };
  }

  // 1) token: se valida con getMe y se guarda; 2) codigo para enganchar un chat
  async setToken(token) {
    token = String(token || '').trim();
    if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) throw new Error('Ese no parece un token de bot (se ve como 123456789:AAE...). Cópielo completo desde @BotFather.');
    const r = await call(token, 'getMe');
    if (!r.ok) throw new Error('Telegram no aceptó el token: ' + (r.description || 'error'));
    this.saveConn({ token, bot: r.result.username, chats: (this.conn() && this.conn().chats) || [] });
    return this.startLink();
  }
  startLink() {
    if (!this.conn() || !this.conn().token) throw new Error('Primero pegue el token del bot');
    this.linkCode = { code: crypto.randomBytes(3).toString('hex').toUpperCase(), until: this.now() + 15 * 60000 };
    return { code: this.linkCode.code, bot: this.conn().bot };
  }
  // busca en los mensajes del bot el «/start <codigo>» y engancha ese chat
  async checkLink() {
    const c = this.conn(); if (!c || !c.token) throw new Error('Primero pegue el token del bot');
    if (!this.linkCode || this.linkCode.until < this.now()) throw new Error('El código venció: pida uno nuevo');
    const r = await call(c.token, 'getUpdates', { timeout: 0, allowed_updates: ['message'] });
    if (!r.ok) throw new Error(r.description || 'No se pudo leer el bot');
    const want = this.linkCode.code;
    const m = (r.result || []).map(u => u.message).filter(Boolean).reverse().find(x => new RegExp(`^/start\\s+${want}\\b`, 'i').test(String(x.text || '').trim()));
    if (r.result && r.result.length) call(c.token, 'getUpdates', { offset: r.result[r.result.length - 1].update_id + 1, timeout: 0 }); // marca leidos
    if (!m) return { linked: false };
    const chat = { id: m.chat.id, name: m.chat.title || [m.chat.first_name, m.chat.last_name].filter(Boolean).join(' ') || m.chat.username || 'chat' };
    const chats = (c.chats || []).filter(x => String(x.id) !== String(chat.id)).concat(chat);
    this.saveConn({ chats });
    this.linkCode = null;
    await this.send(`<b>Atalaya conectada</b>\nDesde ahora le aviso por aquí lo importante de <b>${esc(this.cfg.title || 'su servidor')}</b>.`, { chats: [chat], force: true });
    console.log(`[alertas] chat de Telegram enganchado: ${chat.name}`);
    return { linked: true, chat: { id: String(chat.id), name: chat.name } };
  }
  unlink(chatId) { const c = this.conn(); if (!c) return; this.saveConn({ chats: (c.chats || []).filter(x => String(x.id) !== String(chatId)) }); }
  disconnect() { delete this.data.telegram; this.save(); this.linkCode = null; }
  setConf(patch) {
    const cur = this.conf(), cats = { ...cur.cats };
    for (const k of Object.keys(CATS)) if (patch.cats && typeof patch.cats[k] === 'boolean') cats[k] = patch.cats[k];
    const quiet = patch.quiet === null ? null : patch.quiet ? { from: Math.max(0, Math.min(23, +patch.quiet.from || 0)), to: Math.max(0, Math.min(23, +patch.quiet.to || 0)) } : cur.quiet;
    const summaryHour = patch.summaryHour != null ? Math.max(0, Math.min(23, +patch.summaryHour || 0)) : cur.summaryHour;
    this.data.conf = { cats, quiet, summaryHour, maxPerHour: cur.maxPerHour }; this.save();
    return this.conf();
  }

  quietNow(t = this.now()) {
    const q = this.conf().quiet; if (!q) return false;
    const h = this.localHour(t);
    return q.from <= q.to ? h >= q.from && h < q.to : h >= q.from || h < q.to;
  }
  link(go) { const u = (this.cfg.publicUrl || '').replace(/\/$/, ''); return u && go ? `${u}/?go=${encodeURIComponent(go)}` : u; }

  async send(text, o = {}) {
    const c = this.conn(), m = this.email();
    const tg = o.channel !== 'email' && c && c.token && (o.chats || c.chats || []).length, em = o.channel !== 'telegram' && !o.chats && m && m.host && (m.to || []).length;
    if (!tg && !em) return false;
    const chats = tg ? o.chats || c.chats : [];
    const now = this.now();
    if (!o.force) {
      this.hour = this.hour.filter(t => now - t < 3600000);
      if (this.hour.length >= (this.conf().maxPerHour || 12)) return false;
      this.hour.push(now);
    }
    let ok = true;
    if (em) {
      const url = (text.match(/<a href="([^"]+)">/) || [])[1] || null;
      try { await sendMail({ ...m, fromName: `Atalaya · ${this.cfg.title || 'servidor'}` }, { to: m.to, ...this.mailOf(text.replace(/\n?<a href="[^"]+">[^<]*<\/a>/g, ''), url) }); }
      catch (e) { ok = false; console.log(`[alertas] el correo no salió: ${e.message}`); }
    }
    for (const ch of chats) { const r = await call(c.token, 'sendMessage', { chat_id: ch.id, text, parse_mode: 'HTML', disable_web_page_preview: true }); if (!r.ok) { ok = false; console.log(`[alertas] Telegram rechazó el mensaje: ${r.description}`); } }
    return ok;
  }

  // evento -> aviso { cat, key, text, go } (o nada)
  alertOf(e) {
    const site = e.name || e.domain || (e.label ? 'la cuenta ' + e.label : 'un sitio');
    const go = e.site ? 'site:' + e.site : e.app ? 'app:' + e.app : null;
    if (e.kind === 'phpfile' && e.action === 'suspect') return { cat: 'security', key: 'php:' + (e.path || site), text: `[SEGURIDAD] <b>Posible puerta trasera</b> en <b>${esc(e.domain || site)}</b>\n${esc(e.why || '')}`, go: 'site-by-domain' };
    if (e.kind === 'phpfile' && e.action === 'hit') return { cat: 'security', key: 'phphit:' + (e.path || site), text: `[SEGURIDAD] <b>Alguien buscó la puerta trasera</b> de <b>${esc(e.domain || site)}</b> (respuesta ${e.status || '?'})`, go: 'site-by-domain' };
    if (e.kind === 'watch' && e.action === 'start') {
      const T = { exposed: ['security', '[SEGURIDAD]', 'Archivo expuesto'], bruteforce: ['security', '[SEGURIDAD]', 'Fuerza bruta al login'], scraping: ['traffic', '[TRÁFICO]', 'Scraping'], multi: ['traffic', '[TRÁFICO]', 'La misma IP sondea varios sitios'], scan: ['traffic', '[TRÁFICO]', 'Escaneo'], surge: ['traffic', '[TRÁFICO]', 'Pico de visitas'] }[e.reason];
      if (!T) return null;
      return { cat: T[0], key: `watch:${e.reason}:${e.domain || site}`, text: `${T[1]} <b>${T[2]}</b> en <b>${esc(e.domain || site)}</b>${e.n ? ` (${e.n})` : ''}`, go: 'site-by-domain' };
    }
    if (e.kind === 'defense' && e.action === 'block' && e.by === 'auto') return { cat: 'jail', key: 'jail:' + e.ip, text: `[CÁRCEL] <b>IP a la cárcel</b> por la defensa automática${e.domain ? ` (${esc(e.domain)})` : ''}: ${esc(e.reason || '')}`, go: 'jail:all' };
    if (e.kind === 'pm2' && e.action === 'down') return { cat: 'down', key: 'down:' + e.app, text: `[CAÍDA] <b>Se detuvo ${esc(e.appName || e.app)}</b>`, go };
    if (e.kind === 'keysvc' && e.action === 'down') return { cat: 'down', key: 'key:' + e.label, text: `[CAÍDA] <b>Falló ${esc(e.label)}</b> en el servidor`, go: 'system:root' };
    if (e.kind === 'keysvc' && e.action === 'up') return { cat: 'down', key: 'keyup:' + e.label, text: `[BIEN] ${esc(e.label)} volvió a funcionar`, go: 'system:root' };
    if (e.kind === 'uptime') {
      const mins = Math.max(1, Math.round((e.downFor || 0) / 60000));
      return e.action === 'down' ? { cat: 'down', key: 'uptime:' + e.domain, text: `[CAÍDA] <b>${esc(e.domain)}</b> no responde bien: ${esc(e.why || 'sin respuesta')}`, go: 'site-by-domain' }
        : { cat: 'down', key: 'uptimeok:' + e.domain, text: `[BIEN] <b>${esc(e.domain)}</b> volvió a responder${e.downFor ? ` (estuvo caído ${mins >= 120 ? Math.round(mins / 60) + ' h' : mins + ' min'})` : ''}`, go: 'site-by-domain' };
    }
    if (e.kind === 'deploy' && e.action === 'error') return { cat: 'down', key: 'deploy:' + e.app, text: `[CAÍDA] <b>Falló el despliegue</b> de ${esc(e.appName || e.app)}`, go };
    if (e.kind === 'login') {
      const who = `<b>${esc(e.user || '?')}</b> entró a ${esc(e.service || 'el panel')} desde una IP nueva (${esc(e.ip || '?')})`;
      return e.action === 'guessed' ? { cat: 'security', key: 'login:' + e.ip, text: `[SEGURIDAD] ${who} que venía fallando la contraseña (${e.n} intentos). Si no fue usted, cambie la contraseña ya.`, go: 'prisoner:' + e.ip }
        : { cat: 'security', key: 'login:' + e.ip, text: `[ACCESO] ${who}. Si no fue usted, cambie la contraseña.`, go: 'prisoner:' + e.ip };
    }
    if (e.kind === 'cert') {
      const what = e.service ? `El certificado de ${esc(e.service)}` : `El certificado de <b>${esc(e.domain || '?')}</b>`;
      const when = e.action === 'expired' ? `venció hace ${-e.days} día(s)` : `vence en ${e.days} día(s) y no se ha renovado`;
      return { cat: 'down', key: `cert:${e.service || e.domain}:${e.action}`, text: `[CERTIFICADO] ${what} ${when}`, go: e.service ? 'system:root' : 'site-by-domain' };
    }
    if (e.kind === 'saturation') return e.action === 'start' ? { cat: 'saturation', key: 'sat', text: `[SATURACIÓN] <b>Servidor al límite</b>: ${esc((e.causes || []).join(', '))}`, go: 'system:root' }
      : { cat: 'saturation', key: 'satend', text: '[BIEN] El servidor volvió a tener margen', go: 'system:root' };
    return null;
  }

  onEvent(e) {
    // todo suma al resumen de la manana
    if (['watch', 'defense', 'phpfile', 'pm2', 'deploy', 'saturation', 'keysvc', 'mail', 'db', 'uptime'].includes(e.kind) && !e.late) {
      this.log.push({ t: this.now(), kind: e.kind, action: e.action, reason: e.reason, by: e.by, dir: e.dir, domain: e.domain });
      if (this.log.length > 5000) this.log.shift();
    }
    if (!this.anyChannel() || e.late) return;
    const a = this.alertOf(e); if (!a) return;
    const conf = this.conf();
    if (!conf.cats[a.cat]) return;
    if (this.quietNow() && !CATS[a.cat].critical) return;
    const now = this.now(), last = this.sent.get(a.key) || 0;
    if (now - last < 30 * 60000) return;
    this.sent.set(a.key, now);
    for (const [k, t] of this.sent) if (now - t > 6 * 3600000) this.sent.delete(k);
    const go = a.go === 'site-by-domain' ? this.goOfDomain(e) : a.go;
    const url = this.link(go);
    this.send(a.text + (url ? `\n<a href="${esc(url)}">Abrir en Atalaya</a>` : '')).catch(() => { });
  }
  // Atalaya Cloud en este mismo servidor: cada solicitud de acceso nueva (nube.neracosu.com/solicitud) llega como
  // aviso. Se lee el archivo de la nube cada minuto; las que ya estaban al arrancar no avisan.
  watchRequests(file) {
    this.requestsFile = file;
    const read = () => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) || []; } catch { return []; } };
    const seen = new Set(read().map(r => r.id));
    const KIND = { cloud: 'una pantalla en la nube', vps: 'instalarlo en un VPS', hosting: 'instalarlo en un hosting', equipo: 'Atalaya para su computadora' };
    const check = () => {
      for (const r of read().filter(x => !seen.has(x.id)).reverse()) {
        seen.add(r.id);
        if (r.state !== 'nueva' || !this.anyChannel() || !this.conf().cats.requests) continue;
        this.send(`[SOLICITUD] <b>${esc(r.name)}</b> pide ${esc(KIND[r.kind] || r.kind)}\nContacto por ${r.channel === 'email' ? 'correo' : 'WhatsApp'}${r.what ? `: «${esc(String(r.what).slice(0, 200))}»` : ''}\nRespóndala desde menú › Panel maestro de la nube › Solicitudes.`).catch(() => { });
      }
    };
    setInterval(check, 60000).unref();
    return check;
  }

  // aportes de la comunidad por .zip (<nube>/aportes/<id>/meta.json): cada uno nuevo llega como aviso
  watchAportes(dir) {
    this.requestsFile = this.requestsFile || dir;
    const read = () => { let ids = []; try { ids = fs.readdirSync(dir).filter(x => /^[0-9a-f]{10}$/.test(x)); } catch { } return ids; };
    const seen = new Set(read());
    const check = () => {
      for (const id of read().filter(x => !seen.has(x))) {
        seen.add(id);
        let m = null; try { m = JSON.parse(fs.readFileSync(path.join(dir, id, 'meta.json'), 'utf8')); } catch { continue; }
        if (!this.anyChannel() || !this.conf().cats.aportes) continue;
        this.send(`[APORTE] <b>${esc(m.name)}</b> envió ${m.first ? 'su <b>primer aporte</b>' : 'un aporte'} (${m.files} archivos)\n«${esc(String(m.what || '').slice(0, 200))}»\nRevíselo en menú › Panel maestro de la nube › Aportes.`).catch(() => { });
      }
    };
    setInterval(check, 60000).unref();
    return check;
  }

  // la ficha de un sitio por su alias (lo resuelve la privacidad del servidor si esta disponible)
  goOfDomain(e) { return this.ctx.goOf ? this.ctx.goOf(e) : null; }

  // resumen de las ultimas 24 horas (y cada manana a la hora elegida)
  summary(now = this.now()) {
    const L = this.log.filter(x => now - x.t < 86400000), n = f => L.filter(f).length;
    const lines = [];
    const jail = n(x => x.kind === 'defense' && x.action === 'block'), watch = n(x => x.kind === 'watch' && x.action === 'start');
    const php = n(x => x.kind === 'phpfile' && x.action === 'suspect'), down = n(x => (x.kind === 'pm2' || x.kind === 'keysvc' || x.kind === 'uptime') && x.action === 'down');
    const bounce = n(x => x.kind === 'mail' && x.dir === 'bounce'), sat = n(x => x.kind === 'saturation' && x.action === 'start');
    if (php) lines.push(`- ${php} posible(s) puerta(s) trasera(s)`);
    if (down) lines.push(`- ${down} caída(s) de servicios`);
    if (sat) lines.push(`- ${sat} vez(ces) al límite`);
    if (jail) lines.push(`- ${jail} IP(s) a la cárcel`);
    if (watch) lines.push(`- ${watch} sitio(s) en vigilancia`);
    if (bounce) lines.push(`- ${bounce} correo(s) rebotado(s)`);
    const health = this.ctx.healthLine ? this.ctx.healthLine() : '';
    return `<b>Resumen de las últimas 24 h</b> · ${esc(this.cfg.title || 'Atalaya')}\n${lines.length ? lines.join('\n') : 'Nada fuera de lo normal.'}${health ? `\n${esc(health)}` : ''}`;
  }
  async tick(now = this.now()) {
    const conf = this.conf(); if (!conf.cats.summary || !this.anyChannel()) return;
    const d = new Date(now), key = d.toDateString();
    if (this.localHour(now) === conf.summaryHour && this.lastSummary !== key) {
      this.lastSummary = key;
      const url = this.link(null);
      await this.send(this.summary(now) + (url ? `\n<a href="${esc(url)}">Abrir Atalaya</a>` : ''), { force: true });
    }
  }
}

module.exports = { Alerts, CATS, call };
