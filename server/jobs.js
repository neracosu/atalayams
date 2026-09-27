'use strict';
// Tareas pesadas (analisis de disco y los que vengan): se ejecutan SOLO a pedido, de a una por vez,
// para no saturar el servidor. Si ya hay una corriendo, la nueva se rechaza con un aviso claro.
class Jobs {
  constructor() { this.current = null; this.last = new Map(); }
  busy() { return this.current; }
  // fn debe devolver una promesa; name identifica la tarea ("disco", "ssl"...)
  run(name, label, by, fn) {
    if (this.current) return { ok: false, error: `Ya hay un análisis en curso (${this.current.label}). Espere a que termine.` };
    this.current = { name, label, by, startedAt: Date.now() };
    Promise.resolve().then(fn).catch(e => console.error(`[tarea ${name}]`, e.message))
      .finally(() => { this.last.set(name, { ...this.current, finishedAt: Date.now() }); this.current = null; });
    return { ok: true };
  }
}
module.exports = { Jobs };
