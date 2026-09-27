#!/usr/bin/env node
'use strict';
// Creditos de la comunidad: colaboradores.json es la fuente (nombre, enlace, que aporto, fecha) y de ahi salen
// COLABORADORES.md, la seccion «Comunidad» del README y la lista del sitio (site/index.html, «Se busca Jugador 2»).
//   node scripts/colaboradores.js            regenera los tres
//   node scripts/colaboradores.js --check    falla si alguno quedo desactualizado (lo usan las pruebas)
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'colaboradores.json');
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mdEsc = s => String(s).replace(/([\\`*_[\]<>|])/g, '\\$1');
const safeLink = u => /^https?:\/\/[^\s"<>]+$/i.test(u || '') ? u : '';

function load() { try { return JSON.parse(fs.readFileSync(SRC, 'utf8')); } catch { return []; } }
// una persona puede aportar varias veces: se agrupa por nombre y se listan sus aportes
function people(list) {
  const by = new Map();
  for (const c of list) {
    const k = c.name.trim().toLowerCase();
    const p = by.get(k) || { name: c.name.trim(), link: '', what: [], first: c.date };
    if (safeLink(c.link)) p.link = c.link;
    p.what.push(c.what); if (c.date < p.first) p.first = c.date;
    by.set(k, p);
  }
  return [...by.values()].sort((a, b) => a.first.localeCompare(b.first));
}

function markdown(ps) {
  if (!ps.length) return '_Todavía no hay aportes publicados: el primer nombre de esta lista puede ser el suyo._\n';
  return ps.map(p => `- ${p.link ? `[${mdEsc(p.name)}](${p.link})` : `**${mdEsc(p.name)}**`}: ${p.what.map(mdEsc).join('; ')}`).join('\n') + '\n';
}
function html(ps) {
  if (!ps.length) return '<p class="credits-empty">Todavía no hay aportes publicados: el primer nombre de esta lista puede ser el suyo.</p>';
  return '<ul class="credits">' + ps.map(p => `<li>${p.link ? `<a href="${esc(p.link)}" target="_blank" rel="noopener nofollow">${esc(p.name)}</a>` : `<b>${esc(p.name)}</b>`}<span>${esc(p.what.join(' · '))}</span></li>`).join('') + '</ul>';
}
// reemplaza lo que hay entre las marcas <!-- comunidad:inicio --> y <!-- comunidad:fin -->
function between(text, block, file) {
  const re = /(<!-- comunidad:inicio -->)[\s\S]*?(<!-- comunidad:fin -->)/;
  if (!re.test(text)) throw new Error(`${file}: faltan las marcas <!-- comunidad:inicio --> y <!-- comunidad:fin -->`);
  return text.replace(re, `$1\n${block}\n$2`);
}

function outputs() {
  const ps = people(load());
  const md = markdown(ps);
  return {
    'COLABORADORES.md': `# Colaboradores\n\nGracias a quienes mejoraron Atalaya Monitor Server. Cada aporte se revisa antes de publicarse, llegue por\npull request o por [.zip sin Git](https://nube.neracosu.com/aportes) (cómo aportar: [neracosu.com/atalaya/aportar](https://neracosu.com/atalaya/aportar/)).\n\n${md}`,
    'README.md': between(fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8'), md.trimEnd(), 'README.md'),
    'site/index.html': between(fs.readFileSync(path.join(ROOT, 'site/index.html'), 'utf8'), '        ' + html(ps), 'site/index.html'),
  };
}

if (require.main === module) {
  const out = outputs(), check = process.argv.includes('--check');
  let stale = [];
  for (const [f, text] of Object.entries(out)) {
    const file = path.join(ROOT, f), cur = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (cur === text) continue;
    if (check) stale.push(f); else fs.writeFileSync(file, text);
  }
  if (check && stale.length) { console.error('Créditos desactualizados en: ' + stale.join(', ') + ' (corra node scripts/colaboradores.js)'); process.exit(1); }
  console.log(check ? 'créditos al día' : `créditos regenerados (${people(load()).length} persona(s))`);
}
module.exports = { load, people, markdown, html, outputs };
