// Administrador de temas. Un tema es una carpeta web/themes/<id>/ con:
//   theme.json  nombre, autor, licencia, paleta con significado, layout del HUD, regla de oro y creditos
//   world.js    exporta por defecto la clase del mundo (misma interfaz que web/js/world.js)
//   theme.css   (opcional) como se ve y se acomoda el HUD; todo bajo body[data-theme="<id>"]
// Cambia en caliente: destruye el mundo anterior, monta el nuevo y le reproduce el ultimo estado.

const LOCAL_KEY = 'atalaya_theme';

export class ThemeManager {
  constructor(el, wire) {
    this.el = el;          // contenedor del mundo
    this.wire = wire;      // (world) => conecta callbacks y devuelve nada
    this.world = null;
    this.manifest = null;
    this.serverDefault = 'ciudad';
    this.lastState = null;
  }

  // tema elegido para esta pantalla: ?theme= > eleccion local > el del servidor
  preferred() {
    const q = new URLSearchParams(location.search).get('theme');
    if (q && /^[a-z0-9-]{1,31}$/.test(q)) return q;
    try { const l = localStorage.getItem(LOCAL_KEY); if (l) return l; } catch { }
    return this.serverDefault;
  }
  localChoice() { try { return localStorage.getItem(LOCAL_KEY); } catch { return null; } }
  setLocal(id) { try { if (id) localStorage.setItem(LOCAL_KEY, id); else localStorage.removeItem(LOCAL_KEY); } catch { } }

  async load(id) {
    let m = await fetch(`themes/${id}/theme.json`, { cache: 'no-cache' }).then(r => r.ok ? r.json() : null).catch(() => null);
    if (!m || !m.world) { if (id !== 'ciudad') return this.load('ciudad'); throw new Error('Tema base no disponible'); }
    const mod = await import(`../themes/${id}/${m.world}`);
    const World = mod.default;
    // estilos del tema (el anterior se quita)
    document.getElementById('themeCss')?.remove();
    if (m.css) {
      const link = Object.assign(document.createElement('link'), { id: 'themeCss', rel: 'stylesheet', href: `themes/${id}/${m.css}` });
      const ready = new Promise(r => { link.onload = r; link.onerror = r; });
      document.head.appendChild(link);
      await ready;
    }
    document.body.dataset.theme = id;
    document.body.dataset.layout = (m.hud && m.hud.layout) || 'clasico';
    const pal = m.palette || {};
    for (const k of ['ok', 'warn', 'crit', 'hostile', 'friendly', 'accent', 'bg', 'ink']) {
      if (pal[k]) document.body.style.setProperty('--t-' + k, pal[k]); else document.body.style.removeProperty('--t-' + k);
    }
    await document.fonts.ready.catch(() => { });
    // mundo nuevo
    if (this.world) { try { this.world.destroy(); } catch (e) { console.warn('[tema] al destruir', e); } }
    this.el.innerHTML = '';
    const w = new World(this.el, { manifest: m });
    this.world = w;
    this.manifest = m;
    this.wire(w);
    await w.init();
    if (this.lastState) w.update(this.lastState);
    return m;
  }

  update(state) { this.lastState = state; if (this.world) this.world.update(state); }
}
