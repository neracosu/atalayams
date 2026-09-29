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
      assert.ok(Object.keys(p.solo).every(k => ['ediciones', 'rol', 'modo', 'plan'].includes(k)), donde);
      if (p.solo.plan) assert.ok(['completo', 'sitios'].includes(p.solo.plan), donde);
      if (p.solo.ediciones) assert.ok(p.solo.ediciones.every(e => ['vps', 'hosting', 'cloud', 'equipo'].includes(e)), donde);
      if (p.solo.rol) assert.ok(['owner', 'viewer'].includes(p.solo.rol), donde);
    }
  }
  // un ancla puesta en la pagina y que ningun paso usa es un paso que se borro a medias
  const puestas = [...html.matchAll(/data-tour="([a-z-]+)"/g)].map(m => m[1]);
  assert.deepStrictEqual(puestas.filter(a => !usados.has(a)), [], 'anclas sin paso');
  // cada rol termina el recorrido con su paso del menu
  for (const rol of ['owner', 'viewer']) for (const plan of ['completo', 'sitios']) {
    assert.ok(PASOS.some(p => (p.en || {}).dom === '[data-tour="menu"]' && (!p.solo || ((!p.solo.rol || p.solo.rol === rol) && (!p.solo.plan || p.solo.plan === plan)))), `paso del menú para ${rol} (plan ${plan})`);
  }
  // un plan que solo vigila sitios no ve pasos de agentes ni de conectar proyectos
  const deSitios = PASOS.filter(p => !p.solo || !p.solo.plan || p.solo.plan === 'sitios');
  assert.ok(!deSitios.some(p => ((p.en || {}).dom || '').includes('agentes')), 'sin el panel de agentes en un plan de sitios');
  assert.ok(!deSitios.some(p => /GitHub|Vercel|Claude Code/.test(p.titulo + p.texto)), 'sin ofrecer conectores en un plan de sitios');
  assert.ok(/s\.plan && s\.plan !== \(soloSitios\(h\)/.test(motor), 'el motor filtra por plan');

  // la visita se puede lanzar desde el menu, y el motor nunca usa los cuadros del navegador
  assert.ok(html.includes('data-act="tour"'), 'botón «Visita guiada» en el menú');
  assert.ok(/class="brand"[\s\S]{0,700}data-tour-abrir/.test(html), 'enlace «Visita guiada» arriba, bajo la versión');
  assert.ok(/id="legend"[\s\S]{0,200}data-tour-abrir/.test(html), 'botón «Visita guiada» en la leyenda');
  assert.ok(/k === 'v'\) tour\.abrir/.test(fs.readFileSync(path.join(WEB, 'js/main.js'), 'utf8')), 'tecla V');
  assert.ok(!/\b(alert|confirm|prompt)\(/.test(motor));
  assert.ok(!EMOJI.test(motor));
  // lo que permite el plan: solo la nube manda limites; un plan sin conectores, hostings ni laptops es «de sitios»
  const planSrc = fs.readFileSync(path.join(WEB, 'js/plan.js'), 'utf8');
  const { permite, soloSitios } = await import('data:text/javascript;base64,' + Buffer.from(planSrc).toString('base64'));
  const sitios = { limits: { connectors: 0, remotes: 0, agents: 0, sites: 1, beats: 0 } }, gratis = { limits: { connectors: 2, remotes: 1, agents: 2, sites: 3, beats: 3 } };
  assert.ok(soloSitios(sitios) && !soloSitios(gratis) && !soloSitios({ limits: null }) && !soloSitios(null) && !soloSitios({ limits: {} }));
  assert.ok(!permite(sitios, 'connectors') && permite(sitios, 'sites') && permite(gratis, 'connectors') && permite({}, 'connectors'));
  assert.ok(!soloSitios({ limits: { connectors: 0, agents: 0, remotes: 1 } }), 'con laptops no es solo de sitios');
  // un plan de sitios no muestra el panel ni la pestana de agentes, y su hoja no se abre
  const css = fs.readFileSync(path.join(WEB, 'css/app.css'), 'utf8'), mainJs = fs.readFileSync(path.join(WEB, 'js/main.js'), 'utf8');
  assert.ok(/body\.solo-sitios\.solo-sitios #left, html body\.solo-sitios #tabs \[data-sheet="left"\] \{ display: none !important; \}/.test(css), 'app.css esconde agentes en planes de sitios');
  assert.ok(/classList\.toggle\('solo-sitios', sitios\)/.test(mainJs) && /id === 'left' && document\.body\.classList\.contains\('solo-sitios'\)/.test(mainJs), 'main.js marca el plan y no abre la hoja de agentes');
  console.log(`tour.test.js OK (${PASOS.length} pasos, versión ${VERSION})`);
})().catch(e => { console.error(e); process.exit(1); });
