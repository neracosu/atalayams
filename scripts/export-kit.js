#!/usr/bin/env node
'use strict';
// Exporta el kit de temas a una carpeta (el clon del repositorio atalaya-temas): la interfaz actual,
// el simulador con su grabacion, la guia y la revision de temas. Los temas que el kit ya tenga y que
// Atalaya no traiga (los de la comunidad) se conservan.
// Uso: node scripts/export-kit.js <carpeta-del-kit>
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '..');
const out = process.argv[2];
if (!out) { console.log('Uso: node scripts/export-kit.js <carpeta-del-kit>'); process.exit(1); }
const own = new Set(fs.readdirSync(path.join(ROOT, 'web/themes')));
// conservar temas de la comunidad
const keep = fs.existsSync(path.join(out, 'web/themes')) ? fs.readdirSync(path.join(out, 'web/themes')).filter(t => !own.has(t)) : [];
const tmpKeep = path.join(require('os').tmpdir(), 'atalaya-kit-keep-' + process.pid);
fs.mkdirSync(tmpKeep, { recursive: true });
for (const t of keep) fs.cpSync(path.join(out, 'web/themes', t), path.join(tmpKeep, t), { recursive: true });
// limpiar todo menos .git
for (const f of fs.existsSync(out) ? fs.readdirSync(out) : []) if (f !== '.git') fs.rmSync(path.join(out, f), { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const skip = /^(setup\.html|login\.html|js\/(setup|login)\.js|css\/(setup|login)\.css)$/;
fs.cpSync(path.join(ROOT, 'web'), path.join(out, 'web'), { recursive: true, filter: src => !skip.test(path.relative(path.join(ROOT, 'web'), src).split(path.sep).join('/')) });
for (const t of keep) fs.cpSync(path.join(tmpKeep, t), path.join(out, 'web/themes', t), { recursive: true });
fs.rmSync(tmpKeep, { recursive: true, force: true });
fs.cpSync(path.join(ROOT, 'kit'), out, { recursive: true });
fs.mkdirSync(path.join(out, 'docs'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'docs/TEMAS.md'), path.join(out, 'docs/TEMAS.md'));
// imagenes del README del kit: banner, capturas de cada tema y la vigilancia
fs.mkdirSync(path.join(out, 'docs/img'), { recursive: true });
for (const f of fs.readdirSync(path.join(ROOT, 'docs'))) if (/^(banner\.svg|theme-[a-z0-9]+\.webp|vigilancia\.webp)$/.test(f)) fs.copyFileSync(path.join(ROOT, 'docs', f), path.join(out, 'docs/img', f));
fs.cpSync(path.join(ROOT, 'docs/icons'), path.join(out, 'docs/img/icons'), { recursive: true });
fs.mkdirSync(path.join(out, 'test'), { recursive: true });
fs.copyFileSync(path.join(ROOT, 'test/themes.test.js'), path.join(out, 'test/themes.test.js'));
fs.cpSync(path.join(ROOT, 'licenses'), path.join(out, 'licenses'), { recursive: true });
const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
// el README lleva la version de la interfaz incluida
const readme = path.join(out, 'README.md');
fs.writeFileSync(readme, fs.readFileSync(readme, 'utf8').replace(/\{\{VERSION\}\}/g, version));
fs.writeFileSync(path.join(out, 'package.json'), JSON.stringify({ name: 'atalaya-temas', private: true, description: 'Kit para diseñar temas de Atalaya', atalaya: version,
  scripts: { start: 'node sim/server.js', check: 'node test/themes.test.js' }, engines: { node: '>=20' } }, null, 2) + '\n');
console.log(`kit exportado a ${out} (interfaz de Atalaya ${version}${keep.length ? `; temas de la comunidad conservados: ${keep.join(', ')}` : ''})`);
