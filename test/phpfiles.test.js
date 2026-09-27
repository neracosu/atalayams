'use strict';
// Archivos PHP nuevos: el primer recorrido toma la foto y reporta solo lo sospechoso que ya estaba; despues cada
// .php nuevo se evalua (subidas, nombre aleatorio, carpeta oculta, firmas de webshell); una actualizacion masiva
// no alarma; lo revisado deja de aparecer; en publico sin rutas.
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { PhpFilesAudit } = require('../server/audits/phpfiles');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atalaya-php-'));
const root = path.join(tmp, 'public_html');
const w = (rel, txt) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, txt); return p; };
const b64 = Buffer.from('x'.repeat(3000)).toString('base64');
w('index.php', '<?php require "wp-blog-header.php";');
w('wp-content/plugins/elementor/icon.php', `<?php $icon = "${b64}"; echo $icon;`); // base64 sin ejecutar: legitimo
const mal = w('assets/js/data/Xq7Lm2pa9Z.php', `<?php $zz = "${b64}"; eval(base64_decode(base64_decode($zz)));`);
w('wp-content/uploads/index.php', '<?php // Silence is golden');

(async () => {
  const bus = new EventEmitter(); const evs = []; bus.on('ev', e => evs.push(e));
  const A = new PhpFilesAudit({ stateDir: tmp, edition: 'vps' }, null, bus, { manual: true, roots: [{ docroot: root, site: 's1', account: 'ana', domain: 'ana.com' }] });
  await A.scan();
  assert.strictEqual(A.suspects().length, 1, 'el primer recorrido reporta solo lo sospechoso que ya estaba');
  assert.ok(A.suspects()[0].path === mal && A.suspects()[0].existing && /decodifica y ejecuta/.test(A.suspects()[0].why.join()));
  assert.deepStrictEqual(evs.map(e => [e.kind, e.site]), [['phpfile', 's1']]);
  console.log('ok   php nuevos: la foto inicial reporta el malware que ya estaba y nada más');

  w('contacto.php', '<?php mail("a@b.c", "x", "y");');
  w('wp-content/uploads/2026/09/shell.php', '<?php echo 1;');
  w('.thumb/x.php', '<?php echo 1;');
  w('a8f3k2p.php', '<?php echo 1;');
  for (let i = 0; i < 20; i++) w(`wp-content/plugins/woo/includes/f${i}.php`, '<?php // parte de una actualizacion');
  await A.scan();
  const by = f => A.found.find(r => r.path.endsWith(f));
  assert.strictEqual(by('contacto.php').sev, 'info');
  assert.strictEqual(by('shell.php').sev, 'bad', 'PHP en uploads');
  assert.strictEqual(by('.thumb/x.php').sev, 'bad', 'carpeta oculta');
  assert.strictEqual(by('a8f3k2p.php').sev, 'warn', 'nombre aleatorio');
  assert.ok(by('f3.php').bulk && by('f3.php').sev === 'info', 'una actualización masiva no alarma');
  assert.strictEqual(A.siteState('s1').n, 3);
  console.log('ok   php nuevos: subidas, carpeta oculta y nombre aleatorio; una actualización masiva no alarma');

  // un subdominio dentro del docroot del sitio padre: sus archivos son del subdominio
  w('sub.ana.com/wp-content/uploads/bad.php', '<?php echo 1;');
  A.roots.push({ docroot: path.join(root, 'sub.ana.com'), site: 's2', account: 'ana', domain: 'sub.ana.com' });
  await A.scan();
  assert.strictEqual(by('sub.ana.com/wp-content/uploads/bad.php').site, 's2', 'el archivo es del subdominio, no del sitio padre');
  A.acknowledge(by('sub.ana.com/wp-content/uploads/bad.php').path);
  // quien lo pidio: de los registros de Apache (actuales y archivados .gz) y en vivo
  const logs = path.join(tmp, 'logs'); fs.mkdirSync(logs, { recursive: true });
  const M = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], d = new Date();
  fs.writeFileSync(path.join(logs, `ana.com-ssl_log-${M[d.getMonth()]}-${d.getFullYear()}.gz`), require('zlib').gzipSync(Buffer.from(
    '203.0.113.77 - - [19/Sep/2026:01:29:01 -0700] "GET /assets/js/data/Xq7Lm2pa9Z.php HTTP/1.1" 404 - "-" "Mozilla/5.0"\n8.8.8.8 - - [19/Sep/2026:01:30:00 -0700] "GET / HTTP/1.1" 200 10 "-" "x"\n')));
  A.logDirs = () => [logs];
  const who = A.whoRequested(A.suspects().find(r => r.path === mal));
  assert.deepStrictEqual(who.map(h => [h.ip, h.status]), [['203.0.113.77', 404]], 'encuentra quién pidió la puerta trasera en los registros archivados');
  const hitEvs = []; bus.on('ev', e => { if (e.kind === 'phpfile' && e.action === 'hit') hitEvs.push(e); });
  bus.emit('ev', { kind: 'http', path: '/assets/js/data/Xq7Lm2pa9Z.php?x=1', ip: '45.9.9.9', status: 200, at: Date.now() });
  bus.emit('ev', { kind: 'http', path: '/assets/js/data/otro.php', ip: '45.9.9.9', status: 404, at: Date.now() });
  assert.deepStrictEqual(hitEvs.map(e => [e.ip, e.status, e.site]), [['45.9.9.9', 200, 's1']], 'en vivo: solo la ruta del archivo sospechoso');
  assert.strictEqual(A.whoRequested(A.suspects().find(r => r.path === mal))[0].ip, '45.9.9.9', 'lo visto en vivo se suma a la lista');
  console.log('ok   php nuevos: quién pidió el archivo sospechoso, en los registros archivados y en vivo');

  A.acknowledge(by('.thumb/x.php').path);
  A.quarantined(mal, { by: 'neri', qpath: '/x/q' });
  const j = A.jailedList().find(x => x.path === mal);
  assert.ok(j && j.by === 'neri' && /decodifica y ejecuta/.test(j.why.join()) && j.size > 0 && j.hits.length, 'la cuarentena guarda su historia: qué era, quién, tamaño y quién lo buscó');
  // un archivo en cuarentena de antes (solo con su .origen.json): se reconstruye del archivo guardado
  const qd = path.join(tmp, 'cuarentena', '2026-09-26T00-00-00Z', 'x'); fs.mkdirSync(qd, { recursive: true });
  const qf = path.join(qd, 'viejo.php'); fs.writeFileSync(qf, `<?php $a = "${b64}"; eval(base64_decode($a));`);
  fs.writeFileSync(qf + '.origen.json', JSON.stringify({ path: path.join(root, 'viejo.php'), at: '2026-09-26T23:57:21.960Z' }));
  A.qdir = path.join(tmp, 'cuarentena'); A.loadQuarantine();
  const v = A.jailed.find(x => x.path.endsWith('viejo.php'));
  assert.ok(v && v.rebuilt && v.qpath === qf && /decodifica y ejecuta/.test(v.why.join()) && v.site === 's1', 'reconstruido: qué era, dónde y de qué sitio');
  A.unjail(v.path, true);
  assert.ok(!A.jailed.some(x => x.path === v.path) && A.ack.has(v.path), 'restaurado: sale de la lista y queda como revisado');
  console.log('ok   php nuevos: historia de la cuarentena, reconstruida para los de antes; restaurar queda revisado');
  assert.strictEqual(A.suspects().length, 1, 'revisado y en cuarentena dejan de aparecer');
  const sec = A.section();
  assert.ok(sec.status === 'bad' && sec.findings[0].names[0] === 'ana.com');
  const { makePrivacy } = require('../server/privacy');
  const P = makePrivacy({ accounts: { ana: { label: 'ana', publicLabel: 'Distrito Norte' } }, public: {}, apps: {}, sites: {}, stateDir: tmp });
  const pub = P.event(evs[0], false);
  assert.ok(pub.site && !pub.path && !pub.name, JSON.stringify(pub));
  console.log('ok   php nuevos: revisado y cuarentena salen de la lista; en modo público sin rutas');
  fs.rmSync(tmp, { recursive: true, force: true });
})().catch(e => { console.error(e); process.exit(1); });
