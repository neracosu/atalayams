// Visita guiada: un recorrido por la pantalla que senala cada cosa en su sitio y dice para que sirve.
// Motor propio, sin librerias. Los pasos son datos (tourpasos.js).
//
// Lo que tiene de particular:
//  - Atalaya es una sola pagina: no hay que navegar entre secciones.
//  - Medio recorrido senala cosas del MAPA, que es un dibujo y no elementos de la pagina. El tema dice donde
//    esta cada una (world.screenOf) y la camara se acerca (world.pick, sin abrir la ficha, como el director).
//    Como el mapa se mueve, esos pasos se vuelven a medir en cada cuadro.
//  - El recorte es una sombra gigante alrededor de un recuadro transparente: lo senalado se ve con su color real.
//  - Un paso sin a quien senalar se salta en silencio. Nunca falla ni imprime nada: una visita no puede tumbar
//    la pantalla.
import { PASOS, VERSION } from './tourpasos.js';
import { forEdition } from './accounts.js';
import { soloSitios } from './plan.js';

const VISTA = 'atalaya_visita_v' + VERSION; // 'completa' | 'salida' | 'ofrecida'
const CURSO = 'atalaya_visita_paso'; // para seguir donde iba si la pagina se recarga (una actualizacion)
const M = 8; // aire del recorte
const mem = (s, k, v) => { try { return v === undefined ? s.getItem(k) : v === null ? s.removeItem(k) : s.setItem(k, v); } catch { return null; } };
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const quieto = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const compacto = () => document.body.classList.contains('compact');

export class Tour {
  // host: { world(), state(), hello(), antes() } — antes() cierra fichas, hojas y menus antes de empezar
  constructor(host) {
    this.host = host; this.activo = false; this.i = 0;
    this.teclas = this.teclas.bind(this); this.medir = this.medir.bind(this);
  }

  // ------------------------------------------------------------------ que pasos le tocan a esta pantalla
  aplica(p) {
    const s = p.solo; if (!s) return true;
    const h = this.host.hello() || {};
    if (s.ediciones && !s.ediciones.includes(h.edition || 'vps')) return false;
    if (s.rol && s.rol !== (h.role || 'viewer')) return false;
    if (s.modo && s.modo !== (compacto() ? 'compacto' : 'amplio')) return false;
    if (s.plan && s.plan !== (soloSitios(h) ? 'sitios' : 'completo')) return false;
    return true;
  }
  destino(p) { return (compacto() && p.compacto) || p.en || null; }

  // a que cosa del mapa apunta el paso: { kind, id } que entienden pick y screenOf
  enMapa(que) {
    const st = this.host.state() || {};
    if (que === 'proyecto') {
      // el mas visitado que este en linea: es el que mas se mueve
      const l = [...(st.apps || []).map(x => ({ kind: 'app', id: x.id, n: x.reqMin || 0, ok: x.status === 'online' })), ...(st.sites || []).map(x => ({ kind: 'site', id: x.id, n: x.reqMin || 0, ok: x.status !== 'down' }))];
      return l.sort((a, b) => (b.ok - a.ok) || (b.n - a.n))[0] || null;
    }
    if (que === 'agente') { const s = (st.sessions || [])[0]; return s ? { kind: 'session', id: s.id } : null; }
    if (que === 'tower') return { kind: 'tower', id: 'root', cam: ['system', 'root'] };
    return { kind: que, id: 'all' };
  }

  // el rectangulo de lo senalado, o null si no esta a la vista
  caja(p) {
    const d = this.destino(p); if (!d) return null;
    if (d.dom) {
      const n = document.querySelector(d.dom);
      if (!n || !n.getClientRects().length) return null;
      const r = n.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return null;
      return { top: r.top, left: r.left, width: r.width, height: r.height };
    }
    const w = this.host.world(), t = this.enMapa(d.mundo);
    if (!w || !t || typeof w.screenOf !== 'function') return null;
    let pt = null; try { pt = w.screenOf(t.kind, t.id); } catch { pt = null; }
    if (!pt || !(pt.x > 0 && pt.y > 0 && pt.x < innerWidth && pt.y < innerHeight)) return null;
    const lado = compacto() ? 120 : 176;
    return { top: pt.y - lado * 0.56, left: pt.x - lado / 2, width: lado, height: lado, mapa: true };
  }
  // acerca la camara a lo que se va a senalar, sin abrir su ficha ni dejarlo seleccionado
  acercar(p) {
    const d = this.destino(p), w = this.host.world();
    if (!d || !d.mundo || !w || typeof w.pick !== 'function') return false;
    const t = this.enMapa(d.mundo); if (!t) return false;
    const [kind, id] = t.cam || [t.kind, t.id];
    if (!['app', 'site', 'session', 'district', 'system', 'security', 'jail'].includes(kind)) return false;
    const sel = w.onSelect, prev = w.selected;
    w.onSelect = () => { };
    try { w.pick(kind, id); } catch { } finally { w.onSelect = sel; w.selected = prev; }
    try { w.clearSelection && w.clearSelection(); } catch { }
    return true;
  }

  // ------------------------------------------------------------------ abrir y cerrar
  abrir(desde = 0) {
    if (this.activo) return;
    this.cerrarOferta();
    try { this.host.antes(); } catch { }
    this.activo = true;
    const w = this.host.world();
    this.director = !!(w && w.directorOn);
    try { if (w && this.director) w.setDirector(false); } catch { } // la camara no se va a otro lado a mitad de un paso
    this.velo = el('div', 'tour-velo'); this.foco = el('div', 'tour-foco'); this.carta = el('section', 'tour-carta');
    this.carta.setAttribute('role', 'dialog'); this.carta.setAttribute('aria-modal', 'true');
    document.body.append(this.velo, this.foco, this.carta);
    document.body.classList.add('tour-on');
    requestAnimationFrame(() => this.velo && this.velo.classList.add('ver'));
    document.addEventListener('keydown', this.teclas, true); // antes que los atajos de la pantalla (L, P, T, Esc...)
    addEventListener('resize', this.medir);
    this.pintar(this.buscar(Math.max(0, Math.min(desde, PASOS.length - 1)), 1, true));
  }
  salir(completa) {
    if (!this.activo) return;
    this.activo = false;
    mem(localStorage, VISTA, completa ? 'completa' : 'salida'); mem(sessionStorage, CURSO, null);
    cancelAnimationFrame(this.raf); clearTimeout(this.espera);
    document.removeEventListener('keydown', this.teclas, true);
    removeEventListener('resize', this.medir);
    for (const n of [this.velo, this.foco, this.carta]) n && n.remove();
    this.velo = this.foco = this.carta = null;
    document.body.classList.remove('tour-on');
    const w = this.host.world();
    try { if (w) { w.clearSelection && w.clearSelection(); w.resetView && w.resetView(); if (this.director) w.setDirector(true); w.navChanged && w.navChanged(); } } catch { }
  }
  teclas(e) {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Tab' || e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); return; } // los botones de la tarjeta
    e.stopPropagation(); e.preventDefault();
    if (e.key === 'Escape') this.salir(false);
    else if (e.key === 'ArrowRight') this.mover(1);
    else if (e.key === 'ArrowLeft') this.mover(-1);
  }

  // ------------------------------------------------------------------ recorrer
  // el primer paso desde n (en esa direccion) que le toca a esta pantalla. Los del mapa se resuelven al llegar
  buscar(n, dir, conMapa) {
    while (n >= 0 && n < PASOS.length) {
      const p = PASOS[n], d = this.destino(p);
      if (this.aplica(p) && (!d || (d.mundo ? conMapa && this.enMapa(d.mundo) : this.caja(p)))) return n;
      n += dir;
    }
    return n;
  }
  mover(dir) {
    const n = this.buscar(this.i + dir, dir, true);
    if (n >= PASOS.length) return this.salir(true);
    if (n < 0) return;
    this.dir = dir; this.pintar(n);
  }
  visibles() { return PASOS.filter(p => this.aplica(p)); }

  pintar(n) {
    if (!this.activo) return;
    if (n >= PASOS.length || n < 0) return this.salir(n >= PASOS.length);
    this.i = n; mem(sessionStorage, CURSO, String(n));
    cancelAnimationFrame(this.raf); clearTimeout(this.espera);
    const p = PASOS[n], vis = this.visibles(), pos = vis.indexOf(p) + 1, ultimo = pos === vis.length;
    const c = this.carta;
    c.innerHTML = '';
    c.setAttribute('aria-label', `Visita guiada, paso ${pos} de ${vis.length}`);
    c.append(el('div', 'tour-kicker', `<span>Visita guiada</span><b>${pos} / ${vis.length}</b>`), el('h3', 'tour-titulo', forEdition(p.titulo)), el('p', 'tour-texto', forEdition(p.texto)));
    if (p.nota) c.append(el('div', 'tour-nota', forEdition(p.nota)));
    const barra = el('div', 'tour-progreso', '<i></i>'); barra.firstChild.style.width = (pos / vis.length * 100) + '%';
    const pie = el('div', 'tour-pie'), botones = el('div', 'tour-botones');
    if (!ultimo) { const s = el('button', 'tour-salir', 'Salir de la visita'); s.type = 'button'; s.onclick = () => this.salir(false); pie.append(s); }
    if (pos > 1) { const a = el('button', 'tour-btn', 'Atrás'); a.type = 'button'; a.onclick = () => this.mover(-1); botones.append(a); }
    const s = el('button', 'tour-btn tour-btn-ir', ultimo ? 'Empezar a usarla' : 'Siguiente'); s.type = 'button'; s.onclick = () => this.mover(1);
    botones.append(s); pie.append(botones); c.append(barra, pie);
    this.seguir = s;

    const d = this.destino(p);
    if (d && d.mundo) {
      // la camara viaja hasta alli: mientras tanto, velo entero y la tarjeta espera
      this.colocar(null, true);
      const viajo = this.acercar(p);
      this.intentos = 0;
      const llegar = () => {
        if (!this.activo || this.i !== n) return;
        if (this.caja(p)) { this.colocar(p); this.seguirMapa(n); return; }
        if (++this.intentos > 9) return this.pintar(this.buscar(n + (this.dir || 1), this.dir || 1, true)); // no esta a la vista: se salta
        this.espera = setTimeout(llegar, 150);
      };
      this.espera = setTimeout(llegar, viajo && !quieto() ? 650 : 60);
    } else this.colocar(p);
  }
  // lo del mapa se mueve (la camara termina de llegar, el agente camina): el recorte lo sigue
  seguirMapa(n) {
    const paso = () => {
      if (!this.activo || this.i !== n) return;
      const r = this.caja(PASOS[n]);
      if (r) {
        this.recorte(r);
        // si lo senalado se corrio bastante (el agente camino, la camara termino de llegar), la tarjeta se reacomoda
        const q = this.puesto;
        if (!q || Math.abs(r.left - q.left) > 14 || Math.abs(r.top - q.top) > 14) this.colocar(PASOS[n]);
      }
      this.raf = requestAnimationFrame(paso);
    };
    this.raf = requestAnimationFrame(paso);
  }
  medir() { if (this.activo) this.colocar(PASOS[this.i]); }

  recorte(r) {
    const f = this.foco; if (!f) return;
    f.style.top = (r.top - M) + 'px'; f.style.left = (r.left - M) + 'px';
    f.style.width = (r.width + M * 2) + 'px'; f.style.height = (r.height + M * 2) + 'px';
  }
  colocar(p, esperando) {
    const c = this.carta, f = this.foco, v = this.velo; if (!c) return;
    const r = p ? this.caja(p) : null;
    c.classList.toggle('esperando', !!esperando);
    c.classList.remove('hoja', 'hoja-arriba', 'centrada');
    c.style.top = c.style.left = '';
    if (!r) {
      f.style.opacity = '0'; v.classList.add('opaco');
      c.classList.add('centrada'); c.dataset.flecha = 'ninguna';
      if (!esperando) this.enfocar();
      return;
    }
    const aparece = f.style.opacity !== '1';
    if (aparece) f.style.transition = 'none'; // sin viaje desde la esquina
    f.style.opacity = '1'; v.classList.remove('opaco');
    f.classList.toggle('redondo', !!r.mapa);
    this.recorte(r); this.puesto = r;
    if (aparece) requestAnimationFrame(() => { if (f) f.style.transition = ''; });

    if (compacto()) {
      // en el telefono la tarjeta es una hoja: abajo, o arriba si lo senalado vive en la mitad de abajo
      c.classList.add(r.top + r.height / 2 > innerHeight / 2 ? 'hoja-arriba' : 'hoja');
      c.dataset.flecha = 'ninguna';
      return this.enfocar();
    }
    const cw = c.offsetWidth || 380, ch = c.offsetHeight || 200, G = 16, vw = innerWidth, vh = innerHeight;
    const abajo = r.top + r.height + M + G, arriba = r.top - M - G - ch, der = r.left + r.width + M + G, izq = r.left - M - G - cw;
    let top, left, flecha;
    if (abajo + ch + G <= vh) { top = abajo; left = r.left + r.width / 2 - cw / 2; flecha = 'arriba'; }
    else if (arriba >= G) { top = arriba; left = r.left + r.width / 2 - cw / 2; flecha = 'abajo'; }
    else if (der + cw + G <= vw) { left = der; top = r.top + r.height / 2 - ch / 2; flecha = 'izquierda'; }
    else if (izq >= G) { left = izq; top = r.top + r.height / 2 - ch / 2; flecha = 'derecha'; }
    else { top = vh - ch - G; left = r.left + r.width / 2 - cw / 2; flecha = 'ninguna'; }
    left = Math.max(G, Math.min(left, vw - cw - G)); top = Math.max(G, Math.min(top, vh - ch - G));
    c.style.top = top + 'px'; c.style.left = left + 'px';
    c.dataset.flecha = flecha;
    // la flechita apunta al centro de lo senalado aunque la tarjeta haya tenido que correrse
    c.style.setProperty('--fx', Math.max(18, Math.min(r.left + r.width / 2 - left, cw - 18)) + 'px');
    c.style.setProperty('--fy', Math.max(18, Math.min(r.top + r.height / 2 - top, ch - 18)) + 'px');
    this.enfocar();
  }
  enfocar() { try { this.seguir && this.seguir.focus({ preventScroll: true }); } catch { } }

  // ------------------------------------------------------------------ ofrecerla
  vista() { return mem(localStorage, VISTA); }
  // si la pagina se recargo a mitad de la visita (Atalaya se actualizo), sigue donde iba
  retomar() {
    const n = Number(mem(sessionStorage, CURSO));
    if (mem(sessionStorage, CURSO) == null || !(n >= 0) || n >= PASOS.length) return false;
    this.abrir(n); return true;
  }
  // La primera vez se ofrece con un aviso que no estorba, en vez de empezar sola: la pantalla puede ser una TV
  // sin nadie delante, o estar encima de alguien que ya esta trabajando
  ofrecer() {
    if (this.activo || this.oferta || this.vista()) return;
    const o = this.oferta = el('aside', 'tour-oferta', '<div><b>¿Primera vez por aquí?</b><span>Una visita guiada de un minuto le muestra qué es cada cosa.</span></div>');
    const si = el('button', 'tour-btn tour-btn-ir', 'Empezar'), no = el('button', 'tour-salir', 'Ahora no');
    si.type = no.type = 'button';
    si.onclick = () => this.abrir(0);
    no.onclick = () => { mem(localStorage, VISTA, 'salida'); this.cerrarOferta(); };
    o.append(si, no);
    document.body.append(o);
    requestAnimationFrame(() => o.classList.add('ver'));
    mem(localStorage, VISTA, 'ofrecida'); // se ofrece una vez; despues queda en el menu
    this.ofertaT = setTimeout(() => this.cerrarOferta(), 40000);
  }
  cerrarOferta() { clearTimeout(this.ofertaT); if (this.oferta) { this.oferta.remove(); this.oferta = null; } }
}
