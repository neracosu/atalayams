#!/usr/bin/env node
'use strict';
// Gestion de usuarios de Atalaya. El PIN se pide por teclado (oculto), nunca por argumento.
const path = require('path');
const { readJSON } = require('./server/util');
const { Auth } = require('./server/auth');

const cfg = readJSON(process.env.ATALAYA_CONFIG || path.join(__dirname, 'config.json'));
const auth = new Auth(cfg);
const [cmd, sub, name, ...rest] = process.argv.slice(2);
const role = rest.includes('--viewer') ? 'viewer' : 'owner';

function askHidden(q) {
  return new Promise(resolve => {
    const stdin = process.stdin;
    process.stdout.write(q);
    if (!stdin.isTTY) { // PIN por tuberia: echo 123456 | node cli.js ...
      let d = ''; stdin.on('data', c => d += c).on('end', () => resolve(d.trim()));
      return;
    }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let pin = '';
    const onData = ch => {
      if (ch === '\r' || ch === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); process.stdout.write('\n'); resolve(pin); }
      else if (ch === '\u0003') process.exit(1);
      else if (ch === '\u007f') { if (pin) { pin = pin.slice(0, -1); process.stdout.write('\b \b'); } }
      else { pin += ch; process.stdout.write('•'); }
    };
    stdin.on('data', onData);
  });
}

// pregunta visible (nombres, ids); los secretos usan askHidden
function ask(q) {
  return new Promise(resolve => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout });
    rl.question(q, a => { rl.close(); resolve(a.trim()); });
  });
}

async function connectorCmd() {
  const { Secrets } = require('./server/secrets');
  const sec = new Secrets(cfg);
  if (sub === 'list') {
    const list = sec.connectors();
    if (!list.length) console.log('Sin conectores. Agregue uno con: node cli.js connector add vercel|supabase|github');
    for (const c of list) console.log(`${c.id.padEnd(16)} ${c.type.padEnd(9)} ${c.type === 'vercel' ? (c.teamId ? 'equipo ' + c.teamId : 'cuenta personal') + (c.drainSecret ? ' · drain configurado' : '') : (c.projects || []).map(p => p.ref).join(', ')}`);
    return;
  }
  if (sub === 'del' && name) { sec.delConnector(name); console.log(`Conector ${name} eliminado.`); return; }
  if (sub === 'add' && (name === 'vercel' || name === 'supabase' || name === 'github')) {
    const id = (await ask('Nombre corto para este conector (ej. personal, cliente-x): ')).toLowerCase();
    if (name === 'github') {
      console.log('Cree un token "fine-grained" en https://github.com/settings/personal-access-tokens con acceso a sus repos y');
      console.log('permisos SOLO de lectura: Metadata, Contents y (opcional) Dependabot alerts.');
      const token = await askHidden('Token de GitHub: ');
      sec.addConnector(id, { type: 'github', name: id, token });
      console.log(`\nConector ${id} guardado. Los repos aparecen en el mapa de proyectos en un minuto.`);
    } else if (name === 'vercel') {
      console.log('Cree un token en https://vercel.com/account/tokens (alcance: el equipo a monitorear).');
      const token = await askHidden('Token de Vercel: ');
      const teamId = await ask('ID del equipo (team_...), o Enter si es su cuenta personal: ');
      const drain = (await ask('¿Va a configurar un Drain para ver las visitas en vivo? Requiere plan Pro (s/N): ')).toLowerCase().startsWith('s');
      const drainSecret = drain ? await askHidden('Secreto de verificación del Drain (Vercel lo genera al crearlo): ') : '';
      sec.addConnector(id, { type: 'vercel', name: id, token, teamId: teamId || undefined, drainSecret: drainSecret || undefined });
      const base = cfg.publicUrl || 'https://SU-ATALAYA';
      console.log(`\nConector ${id} guardado. Atalaya lo toma en unos segundos, sin reiniciar.`);
      if (drain) console.log(`En Vercel > Team Settings > Drains > Add Drain > Logs > Custom Endpoint use:\n  URL:     ${base}/api/drains/vercel/${id}\n  Formato: JSON o NDJSON · Fuentes: static, lambda, edge, external · Entornos: production (y preview si quiere)`);
    } else {
      console.log('Por cada proyecto: su "Project ref" (Settings > General) y una Secret key (Settings > API Keys, sb_secret_...).');
      const projects = [];
      for (;;) {
        const ref = await ask(`Project ref #${projects.length + 1} (Enter para terminar): `);
        if (!ref) break;
        const pname = await ask('  Nombre para mostrar (Enter = el ref): ');
        const serviceKey = await askHidden('  Secret key: ');
        projects.push({ ref, name: pname || ref, serviceKey });
      }
      if (!projects.length) throw new Error('Se necesita al menos un proyecto');
      const mgmtToken = await askHidden('Token de gestión (opcional, para ver si un proyecto está pausado; Enter para omitir): ');
      sec.addConnector(id, { type: 'supabase', name: id, projects, mgmtToken: mgmtToken || undefined });
      console.log(`\nConector ${id} guardado con ${projects.length} proyecto(s). Atalaya lo toma en unos segundos.`);
    }
    return;
  }
  console.log('Uso: node cli.js connector add vercel|supabase|github · connector list · connector del <nombre>');
}

async function remoteCmd() {
  const { Secrets } = require('./server/secrets');
  const sec = new Secrets(cfg);
  if (sub === 'list') { const r = sec.remotes(); console.log(r.length ? r.join('\n') : 'Sin equipos remotos.'); return; }
  if (sub === 'del' && name) { sec.delRemote(name); console.log(`Equipo ${name} eliminado: sus hooks se rechazan desde ya.`); return; }
  if (sub === 'add' && name) {
    const token = sec.addRemote(name.toLowerCase());
    const base = cfg.publicUrl || 'https://SU-ATALAYA';
    console.log(`Equipo ${name} registrado. En esa computadora (macOS, Linux o WSL, con Node.js) ejecute:\n`);
    console.log(`  curl -fsSL ${base}/install/remote-hook.sh | sh -s -- ${base} ${name.toLowerCase()}:${token}\n`);
    console.log('El token se muestra solo esta vez. Para revocarlo: node cli.js remote del ' + name.toLowerCase());
    return;
  }
  console.log('Uso: node cli.js remote add <equipo> · remote list · remote del <equipo>');
}

async function main() {
  if (cmd === 'connector') return connectorCmd();
  if (cmd === 'remote') return remoteCmd();
  if (cmd === 'user' && (sub === 'add' || sub === 'pin') && name) {
    const pin = await askHidden(`PIN de 6 dígitos para ${name}: `);
    if (process.stdin.isTTY) {
      const again = await askHidden('Repita el PIN: ');
      if (again !== pin) throw new Error('Los PIN no coinciden');
    }
    const prev = auth.userOf(name);
    auth.setUser(name, pin, sub === 'pin' && prev ? prev.role : role);
    console.log(`Usuario ${name} guardado (${auth.userOf(name).role}).${prev ? ' Sus sesiones abiertas se cerraron.' : ''}`);
  } else if (cmd === 'user' && sub === 'del' && name) {
    if (!auth.userOf(name)) throw new Error('No existe ese usuario');
    delete auth.users[name.toLowerCase()]; auth.saveUsers();
    console.log(`Usuario ${name} eliminado. Sus sesiones caducan al instante.`);
  } else if (cmd === 'user' && sub === 'list') {
    for (const [n, u] of Object.entries(auth.users)) console.log(`${n.padEnd(20)} ${u.role.padEnd(8)} ${u.updated}`);
  } else if (cmd === 'user' && sub === 'role' && name && ['owner', 'viewer'].includes(rest[0])) {
    auth.setRole(name, rest[0]);
    console.log(`Usuario ${name} ahora es ${rest[0]}. Se aplica al instante en sus pantallas.`);
  } else if (cmd === 'sessions' && sub === 'revoke') {
    // el servicio vigila este archivo: toda sesion creada antes de este momento queda anulada al instante
    const { writeJSONAtomic } = require('./server/util');
    writeJSONAtomic(auth.revokeFile, { before: Date.now(), at: new Date().toISOString() });
    console.log('Todas las sesiones quedaron revocadas. Las pantallas vuelven al login en segundos.');
  } else {
    console.log(`Uso:
  node cli.js user add <nombre> [--viewer]   crea usuario (owner por defecto; viewer = solo modo público)
  node cli.js user pin <nombre>              cambia el PIN (cierra sus sesiones abiertas)
  node cli.js user role <nombre> owner|viewer cambia el rol sin tocar el PIN
  node cli.js user del <nombre>              elimina usuario
  node cli.js user list
  node cli.js sessions revoke                cierra todas las sesiones
  node cli.js connector add vercel|supabase|github  conecta una cuenta de nube (pide los secretos ocultos)
  node cli.js connector list | del <nombre>
  node cli.js remote add <equipo>            Claude Code en una laptop: imprime el comando de instalacion
  node cli.js remote list | del <equipo>`);
  }
}
main().catch(e => { console.error('Error:', e.message); process.exit(1); });
