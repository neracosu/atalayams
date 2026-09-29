// Lo que permite el plan de esta pantalla. Solo Atalaya Cloud manda limites (hello.limits, solo cifras); en las
// demas ediciones no hay tope y todo esta permitido.
const CONECTA = ['connectors', 'agents', 'remotes'];

// si el plan admite al menos uno de `k` ('connectors', 'agents', 'remotes', 'sites', 'beats')
export function permite(h, k) {
  const L = h && h.limits;
  return !L || L[k] == null || Number(L[k]) > 0;
}
// un plan que solo vigila sitios por su dominio: sin conectores de nube, hostings ni laptops. A esa pantalla no
// se le pide conectar GitHub ni Vercel, ni se le muestran agentes que no puede tener.
export function soloSitios(h) {
  return !!(h && h.limits) && !CONECTA.some(k => permite(h, k));
}
