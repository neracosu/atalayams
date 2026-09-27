'use strict';
// Usuarios desde la pantalla (menu › Usuarios): lo mismo que `cli.js user`, solo para un dueño con el modo
// privado activo. Reglas: nadie se borra a si mismo, siempre queda al menos un dueño, y cambiar el PIN de
// alguien cierra sus sesiones (salvo la de quien cambia el suyo).
const ROLES = ['owner', 'viewer'];

function list(auth, me) {
  auth.syncUsers();
  return Object.entries(auth.users).map(([name, u]) => ({ name, role: u.role, updated: u.updated, sessions: auth.sessionsOf(name), me: name === me, pass: !!u.pass }))
    .sort((a, b) => (b.me - a.me) || a.name.localeCompare(b.name));
}

// action: add | pin | role | del. Devuelve { ok, users } o lanza un Error con el mensaje para la pantalla
function apply(auth, session, action, b) {
  auth.syncUsers();
  const name = String(b.name || '').trim().toLowerCase();
  const u = auth.userOf(name);
  const lastOwner = () => u && u.role === 'owner' && auth.owners().length <= 1;
  if (action === 'add') {
    if (u) throw new Error('Ya existe un usuario con ese nombre');
    const role = ROLES.includes(b.role) ? b.role : 'viewer';
    auth.setUser(name, String(b.pin || ''), role);
  } else if (action === 'pin') {
    if (!u) throw new Error('No existe ese usuario');
    auth.setUser(name, String(b.pin || ''), u.role);
    if (name === session.user) auth.keepSession(session);
  } else if (action === 'role') {
    if (!u) throw new Error('No existe ese usuario');
    if (!ROLES.includes(b.role)) throw new Error('Rol desconocido');
    if (b.role !== 'owner' && lastOwner()) throw new Error('Debe quedar al menos un dueño');
    if (name === session.user && b.role !== 'owner') throw new Error('No puede quitarse a usted mismo el rol de dueño');
    auth.setRole(name, b.role);
  } else if (action === 'del') {
    if (!u) throw new Error('No existe ese usuario');
    if (name === session.user) throw new Error('No puede borrarse a usted mismo');
    if (lastOwner()) throw new Error('Debe quedar al menos un dueño');
    auth.delUser(name);
  } else throw new Error('Acción desconocida');
  console.log(`[usuarios] ${session.user}: ${action} ${name}${b.role ? ' ' + b.role : ''}`);
  return { ok: true, users: list(auth, session.user) };
}

module.exports = { list, apply };
