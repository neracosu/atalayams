'use strict';
// Visita guiada: el catalogo de pasos contra la interfaz. Un ancla renombrada no da ningun error en la pantalla
// (el paso simplemente se salta), asi que se vigila aqui.
// Uso: node test/tour.test.js
const assert = require('assert');
const fs = require('fs'), path = require('path');
const WEB = path.join(__dirname, '../web');

(async () => {
  const src = fs.readFileSync(path.join(WEB, 'js/tourpasos.js'), 'utf8');
  const { PASOS, VERSION } = await import('data:text/javascript;base64,' + Buffer.from(src).toString('base64'));
  const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
  const motor = fs.readFileSync(path.join(WEB, 'js/tour.js'), 'utf8');

  assert.ok(Number.isInteger(VERSION) && VERSION >= 1);
  assert.ok(PASOS.length >= 8, 'el recorrido base');
  assert.strictEqual(new Set(PASOS.map(p => p.id)).size, PASOS.length, 'cada paso con su id');
  assert.ok(!PASOS[0].en && !PASOS[PASOS.length - 1].en, 'abre y cierra con un paso centrado');

  const MUNDO = ['tower', 'proyecto', 'agente', 'gate', 'jail'];
  const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
  // tuteo: la visita trata de usted, como el resto de Atalaya
  // solo formas que no se confunden con la tercera persona («se abre su ficha» no es tuteo)
  const TUTEO = /\b(haz|elige|puedes|tienes|quieres|sabes|necesitas|tu (pantalla|servidor|cuenta|menú|mapa)|tus (proyectos|agentes|sitios|alertas))\b/i;
  const usados = new Set();
  for (const p of PASOS) {
    const donde = `paso «${p.id}»`;
    assert.ok(/^[a-z][a-z0-9-]*$/.test(p.id), donde);
    assert.ok(p.titulo && p.titulo.length <= 60, `${donde}: el título es una frase corta`);
    assert.ok(p.texto && p.texto.length <= 260, `${donde}: dos o tres líneas (${(p.texto || '').length})`);
    assert.ok(!p.nota || p.nota.length <= 140, `${donde}: la nota es breve`);
    for (const t of [p.titulo, p.texto, p.nota || '']) {
      assert.ok(!EMOJI.test(t), `${donde}: sin emojis`);
      assert.ok(!TUTEO.test(t.replace(/<[^>]+>/g, '')), `${donde}: de usted («${(TUTEO.exec(t) || [])[0]}»)`);
      assert.ok(!/<(?!\/?b>)/.test(t), `${donde}: solo se admite <b>`);
    }
    for (const d of [p.en, p.compacto].filter(Boolean)) {
      assert.ok(!!d.dom !== !!d.mundo, `${donde}: señala un elemento o algo del mapa, no las dos cosas`);
      if (d.mundo) assert.ok(MUNDO.includes(d.mundo), `${donde}: «${d.mundo}» no es algo que el mapa sepa ubicar`);
      if (d.dom) {
        const m = /^\[data-tour="([a-z-]+)"\]$/.exec(d.dom);
        if (m) { usados.add(m[1]); assert.ok(html.includes(`data-tour="${m[1]}"`), `${donde}: no existe el ancla data-tour="${m[1]}" en index.html`); }
        else { const s = /^#([a-zA-Z]+) \[data-sheet="([a-z]+)"\]$/.exec(d.dom); assert.ok(s && html.includes(`id="${s[1]}"`) && html.includes(`data-sheet="${s[2]}"`), `${donde}: selector que no se reconoce (${d.dom})`); }
      }
    }
    if (p.solo) {
      assert.ok(Object.keys(p.solo).every(k => ['ediciones', 'rol', 'modo'].includes(k)), donde);
      if (p.solo.ediciones) assert.ok(p.solo.ediciones.every(e => ['vps', 'hosting', 'cloud', 'equipo'].includes(e)), donde);
      if (p.solo.rol) assert.ok(['owner', 'viewer'].includes(p.solo.rol), donde);
    }
  }
  // un ancla puesta en la pagina y que ningun paso usa es un paso que se borro a medias
  const puestas = [...html.matchAll(/data-tour="([a-z-]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(puestas.filter(a => !usados.has(a)), [], 'anclas sin paso');
  // cada rol termina el recorrido con su paso del menu
  for (const rol of ['owner', 'viewer']) assert.ok(PASOS.some(p => (p.en || {}).dom === '[data-tour="menu"]' && (!p.solo || !p.solo.rol || p.solo.rol === rol)), 'paso del menú para ' + rol);

  // la visita se puede lanzar desde el menu, y el motor nunca usa los cuadros del navegador
  assert.ok(html.includes('data-act="tour"'), 'botón «Visita guiada» en el menú');
  assert.ok(!/\b(alert|confirm|prompt)\(/.test(motor));
  assert.ok(!EMOJI.test(motor));
  console.log(`tour.test.js OK (${PASOS.length} pasos, versión ${VERSION})`);
})().catch(e => { console.error(e); process.exit(1); });
