'use strict';
// visitas en cPanel: el registro de trafico cuenta en vivo; el log del dominio (que llega por tandas) solo
// aporta el detalle, en el tramo de su hora real, sin contar dos veces
const assert = require('assert');
const { EventEmitter } = require('events');
const { LogsCollector } = require('../server/collectors/logs');
const { History } = require('../server/history');

const bus = new EventEmitter();
const host = { apps: [] };
const logs = new LogsCollector({}, bus, host);
const hist = new History(bus, host);
hist.logs = logs;
const g = { id: 'ana:/home/ana/public_html', account: 'ana', app: null, domain: 'tienda.com' };
logs.domains = new Map([['tienda.com', g], ['www.tienda.com', g]]);
logs.groups = new Map([[g.id, g]]);
logs.sites = [g];
logs.boundAppsKey = '';
logs.bindApps = () => {};
logs.startedAt = Date.now() - 600000; // Atalaya arranco hace 10 min
const evs = []; bus.on('ev', e => evs.push(e));

// 1) visita en vivo por el registro de trafico
logs.onTraffic('2026-09-25 HTTP/1.1 TLSv1.3 www.tienda.com 900 5000 1.2.3.4 1.2.3.4');
assert.strictEqual(logs.minute.perSite[g.id], 1, 'cuenta en vivo');
assert.ok(evs[0].live && evs[0].site === g.id);
const k = 'site:' + g.id;
assert.strictEqual(hist.visitorsNow(k), 1, 'visitante en vivo');
assert.deepStrictEqual(hist.todayOf(k), { visits: 1, visitors: 1 });

// 2) la misma visita llega despues por el log del dominio: no se cuenta de nuevo, pero trae la pagina
const now = new Date(Date.now() - 30000);
const pad = n => String(n).padStart(2, '0');
const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const stamp = `${pad(now.getUTCDate())}/${M[now.getUTCMonth()]}/${now.getUTCFullYear()}:${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} +0000`;
logs.onAccess('tienda.com', `1.2.3.4 - - [${stamp}] "GET /ofertas HTTP/1.1" 200 512 "https://google.com/" "Mozilla/5.0 (Windows NT 10.0) Chrome/120"`);
assert.strictEqual(logs.minute.perSite[g.id], 1, 'no cuenta dos veces');
assert.ok(evs[1].late, 'marcada como detalle');
const top = hist.rolls.get(k).top('path', 5).map(x => x[0]);
assert.deepStrictEqual(top, ['/ofertas'], 'la pagina queda en el detalle');
assert.strictEqual(hist.rolls.get(k).top('req', 5).find(x => x[0] === 'all')[1], 1, 'total de la hora: una sola visita');

// 3) una linea de hace dos horas (lectura inicial) no suma a nada
logs.onAccess('tienda.com', '9.9.9.9 - - [01/Jan/2020:00:00:00 +0000] "GET /viejo HTTP/1.1" 200 1 "-" "Mozilla/5.0"');
assert.strictEqual(evs.length, 2);
console.log('ok   visitas: registro de trafico en vivo, detalle del log del dominio sin contar dos veces');
process.exit(0); // History deja temporizadores vivos
