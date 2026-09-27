'use strict';
// Comunicacion entre agentes: el haz al proyecto que se lee o edita (con su limite de 2 s), los mensajes
// de SendMessage y que en modo publico viajen con los mismos alias que el estado.
const assert = require('assert');
const { EventEmitter } = require('events');
const { ClaudeCollector, Agent } = require('../server/collectors/claude');
const { makePrivacy } = require('../server/privacy');

const bus = new EventEmitter();
const evs = [];
bus.on('ev', e => evs.push(e));
const host = { accountsHome: [], claudeProcs: {}, uidOf: () => 0, apps: [] };
const c = new ClaudeCollector({ claude: { idleMinutes: 8, goneMinutes: 45, subagentGoneSeconds: 150 }, accounts: {} }, bus, host);
// la tienda es una app de PM2 en ~/tienda; el blog, un sitio con su docroot
c.projectOf = f => f.startsWith('/home/ana/tienda/') ? { account: 'ana', app: 'tienda' } : f.startsWith('/home/ana/public_html/blog/') ? { account: 'ana', site: 'ana:/home/ana/public_html/blog' } : null;
const s = new Agent({ id: 's1', user: 'ana', kind: 'session', cwd: '/home/ana/tienda' });
const sub = new Agent({ id: 'a7', user: 'ana', kind: 'subagent', parent: s, title: 'revisor', agentType: 'code-reviewer' });
s.subagents.set('/x/a7.jsonl', sub);
const helper = new Agent({ id: 'a8', user: 'ana', kind: 'subagent', parent: s, title: 'pruebas', agentType: 'tester' });
s.subagents.set('/x/a8.jsonl', helper);
const tool = (a, name, input) => c.apply(a, JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(), message: { content: [{ type: 'tool_use', name, input }] } }), true);

tool(s, 'Edit', { file_path: 'src/checkout.js' }); // relativa a la carpeta de la sesion
tool(s, 'Edit', { file_path: '/home/ana/tienda/src/cart.js' }); // mismo proyecto antes de 2 s: no repite
tool(s, 'Read', { file_path: '/home/ana/public_html/blog/wp-config.php' });
tool(s, 'Read', { file_path: '/etc/hosts' }); // fuera de todo proyecto
const touch = evs.filter(e => e.action === 'touch');
assert.strictEqual(touch.length, 2, JSON.stringify(touch));
assert.deepStrictEqual([touch[0].mode, touch[0].target.app], ['edit', 'tienda']);
assert.deepStrictEqual([touch[1].mode, touch[1].target.site], ['read', 'ana:/home/ana/public_html/blog']);
console.log('ok   comunicacion: el haz va a la app o al sitio del archivo, una vez cada 2 s por proyecto');

tool(sub, 'SendMessage', { to: 'tester', message: 'corre las pruebas' });
tool(sub, 'SendMessage', { to: 'main', message: 'listo' });
tool(s, 'SendMessage', { to: 'code-reviewer', message: 'mira esto' });
const msg = evs.filter(e => e.action === 'message');
assert.deepStrictEqual(msg.map(e => [e.agent, e.to]), [['a7', 'a8'], ['a7', ''], [null, 'a7']]);
console.log('ok   comunicacion: SendMessage entre hermanos, a la sesion principal y de la sesion a un subagente');

// en publico: ids con alias, iguales a los del estado; sin nombres ni rutas
const P = makePrivacy({ accounts: { ana: { label: 'ana', publicLabel: 'Distrito Norte' } }, public: {}, apps: {}, sites: {}, stateDir: require('os').tmpdir() });
const pub = P.event(touch[0], false), pubSite = P.event(touch[1], false), pubMsg = P.event(msg[0], false);
assert.ok(pub.app && /^[0-9a-f]{10}$/.test(pub.app) && !JSON.stringify(pub).includes('tienda'), JSON.stringify(pub));
assert.ok(pubSite.site && !JSON.stringify(pubSite).includes('blog'), JSON.stringify(pubSite));
assert.ok(pubMsg.to && pubMsg.to !== 'a8' && pubMsg.agent !== 'a7', JSON.stringify(pubMsg));
assert.strictEqual(P.event(msg[1], false).to, '', 'a la sesion principal se mantiene vacio');
console.log('ok   comunicacion: en modo publico viajan alias, sin nombres ni rutas');

// ---- sesiones cerradas sin aviso: mas sesiones que procesos claude en la cuenta
{
  const now = Date.now();
  const mk = (id, ago, state = 'idle') => { const a = new Agent({ id, user: 'ana', kind: 'session' }); a.lastActivity = now - ago; a.state = state; c.sessions.set('/p/' + id + '.jsonl', a); return a; };
  c.sessions.clear(); c.saveEnded = () => { };
  mk('vieja', 10 * 60000); mk('reciente', 30000); mk('trabajando', 5 * 60000, 'working');
  host.claudeProcs = { ana: 2 }; host.claudeProcsKnown = true;
  evs.length = 0;
  c.dropExtras(now);
  assert.deepStrictEqual([...c.sessions.values()].map(x => x.id).sort(), ['reciente', 'trabajando'], 'sobra una: se va la mas quieta');
  assert.deepStrictEqual(evs.map(e => [e.action, e.sid, e.reason]), [['end', 'vieja', 'closed']], 'avisa el cierre (la pantalla hace el haz de salida)');
  host.claudeProcs = { ana: 0 };
  c.dropExtras(now);
  assert.deepStrictEqual([...c.sessions.values()].map(x => x.id), ['reciente', 'trabajando'], 'con menos de 2 min o trabajando no se retira todavía');
  host.claudeProcsKnown = false; host.claudeProcs = {};
  c.sessions.clear();
  mk('sin-datos', 10 * 60000); c.dropExtras(now);
  assert.strictEqual(c.sessions.size, 1, 'sin lista de procesos no se adivina');
  // en modo publico el cierre viaja con el mismo alias que la sesion
  const pe = P.event({ kind: 'claude', action: 'end', account: 'ana', sid: 's1', reason: 'closed' }, false);
  assert.ok(pe && pe.action === 'end' && pe.sid && !JSON.stringify(pe).includes('ana'), JSON.stringify(pe));
  console.log('ok   sesiones cerradas sin aviso: se retiran las que sobran, con su aviso de cierre');
}
