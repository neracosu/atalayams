// Sitio de Atalaya: iconos pixel, escena del inicio, calculadora, galeria de temas, entrar a una pantalla y guias
import { px } from './pixicons.js';

const $ = id => document.getElementById(id);
// capturas junto a este script: assets/img/ (funciona desde /atalaya/ y desde /atalaya/guias/)
const IMG = new URL('../img/', import.meta.url).href, V = '__VERSION__';
document.querySelectorAll('[data-px]').forEach(el => { el.outerHTML = px(el.dataset.px); });

// edad del proyecto: corre desde el primer commit (la primera linea de codigo), para que se vea que es nuevo
const BORN = Date.parse('2026-09-25T10:58:22-07:00');
const ageEls = document.querySelectorAll('[data-age]'), shortEls = document.querySelectorAll('[data-age-short]');
if (ageEls.length || shortEls.length) {
  const tick = () => {
    let s = Math.max(0, Math.floor((Date.now() - BORN) / 1000));
    const d = Math.floor(s / 86400); s %= 86400;
    const h = Math.floor(s / 3600); s %= 3600;
    const m = Math.floor(s / 60); s %= 60;
    const p2 = n => String(n).padStart(2, '0');
    const txt = `${d} d ${p2(h)} h ${p2(m)} min ${p2(s)} s`;
    ageEls.forEach(el => { el.textContent = txt; });
    shortEls.forEach(el => { el.textContent = d < 1 ? 'menos de un día' : d === 1 ? 'un día' : `${d} días`; });
  };
  tick(); setInterval(tick, 1000);
}

// grabaciones «En acción»: se bajan y corren solo a la vista; con movimiento reducido, quietas hasta un toque
const clips = document.querySelectorAll('.clip video');
if (clips.length) {
  const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const load = v => { if (!v.src) { v.poster = v.dataset.poster; v.src = v.dataset.src; } };
  // portada y video se piden al acercarse (no al abrir la pagina); corren solo mientras se ven
  const near = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { load(e.target); near.unobserve(e.target); } }), { rootMargin: '600px 0px' }) : null;
  const seen = near ? new IntersectionObserver(es => es.forEach(e => {
    const v = e.target;
    if (e.isIntersecting && !still) { load(v); v.play().catch(() => { }); } else v.pause();
  }), { threshold: 0.35 }) : null;
  clips.forEach(v => {
    if (near) { near.observe(v); seen.observe(v); } else load(v);
    v.addEventListener('click', () => openClip([...clips].indexOf(v)));
    v.setAttribute('tabindex', '0'); v.setAttribute('role', 'button');
    v.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openClip([...clips].indexOf(v)); } });
  });

  // ampliada: la animacion en grande sobre la pagina; flechas para pasar a la siguiente, Esc o un toque afuera para cerrar
  const lb = document.getElementById('lightbox');
  const lbv = lb && lb.querySelector('video'), lbc = lb && lb.querySelector('figcaption');
  let cur = 0, keepY = 0; // keepY: donde estaba la pagina, para volver ahi al cerrar
  function openClip(i) {
    if (!lb || !lb.showModal) return;
    cur = (i + clips.length) % clips.length;
    const v = clips[cur];
    lbv.poster = v.dataset.poster; lbv.src = v.dataset.src;
    lbc.innerHTML = v.closest('figure').querySelector('figcaption').innerHTML;
    if (!lb.open) {
      keepY = scrollY; clips.forEach(x => x.pause());
      lb.showModal();
      if (scrollY !== keepY) scrollTo({ top: keepY, behavior: 'instant' });
    }
    lbv.play().catch(() => { });
  }
  if (lb) {
    lb.querySelector('.lb-close').addEventListener('click', () => lb.close());
    lb.querySelector('.lb-prev').addEventListener('click', () => openClip(cur - 1));
    lb.querySelector('.lb-next').addEventListener('click', () => openClip(cur + 1));
    lb.addEventListener('click', e => { if (e.target === lb) lb.close(); });
    lb.addEventListener('keydown', e => { if (e.key === 'ArrowLeft') openClip(cur - 1); if (e.key === 'ArrowRight') openClip(cur + 1); });
    lbv.addEventListener('click', () => lbv.paused ? lbv.play().catch(() => { }) : lbv.pause());
    // en el telefono: deslizar a los lados pasa de animacion
    let sx = null;
    lb.addEventListener('touchstart', e => { sx = e.touches[0].clientX; }, { passive: true });
    lb.addEventListener('touchend', e => { if (sx === null) return; const dx = e.changedTouches[0].clientX - sx; sx = null; if (Math.abs(dx) > 50) openClip(cur + (dx < 0 ? 1 : -1)); });
    lb.addEventListener('close', () => {
      lbv.pause(); lbv.removeAttribute('src'); lbv.load();
      scrollTo({ top: keepY, behavior: 'instant' });
      const v = clips[cur]; if (v) v.focus({ preventScroll: true });
    });
  }
}

// portada: la ciudad real de fondo se pide despues de mostrar la pagina (primero se ve su foto)
const bg = document.querySelector('.attract-bg');
if (bg && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  // en pantallas grandes (o de alta densidad) va la version HD si la hay
  const hd = bg.dataset.srcHd && innerWidth * (devicePixelRatio || 1) >= 1700;
  if (hd && bg.dataset.posterHd) bg.poster = bg.dataset.posterHd;
  const go = () => { bg.src = hd ? bg.dataset.srcHd : bg.dataset.src; bg.play().catch(() => { }); };
  document.readyState === 'complete' ? setTimeout(go, 200) : addEventListener('load', () => setTimeout(go, 200));
}
// aparicion suave de cada bloque al llegar a el
if ('IntersectionObserver' in window && document.body.classList.contains('arcade')) {
  const rv = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); rv.unobserve(e.target); } }), { rootMargin: '0px 0px -8% 0px' });
  document.querySelectorAll('.lvl-sec .wrap > *, .continue .wrap > *, .p2 .wrap > *, .leakrows li, .chars .char').forEach(el => { el.classList.add('reveal'); rv.observe(el); });
}

// escena pixel en vivo (simulada)
if ($('hero')) import('./hero.js').then(m => m.hero($('hero'), $('ticker')));

// calculadora: todo en el navegador, con los numeros del visitante
const calc = $('calc');
if (calc) {
  const n = id => Math.max(0, Number($(id).value) || 0);
  const money = v => '$' + Math.round(v).toLocaleString('es-VE');
  const run = () => {
    const watch = n('c-min') * 22 / 60;          // dias habiles al mes
    const late = n('c-inc') * n('c-hrs');
    const hours = watch + late, month = hours * n('c-rate');
    $('r-h').textContent = Math.round(hours).toLocaleString('es-VE');
    $('r-m').textContent = money(month);
    $('r-y').textContent = money(month * 12);
    $('r-note').textContent = `${Math.round(watch)} h se van en revisar paneles y ${Math.round(late)} h en apagar incendios que alguien más vio primero. ` +
      `Con ${n('c-proj')} proyectos, una pantalla que ya está abierta le devuelve la mayor parte de ese tiempo.`;
  };
  calc.addEventListener('input', run);
  run();
}

// galeria de temas (capturas reales en modo publico)
const THEMES = [
  ['ciudad', 'Ciudad clásica', 'Distritos isométricos en pixel art, edificios, robots e invasores.'],
  ['villa', 'Villa', 'RPG de casillas: castillo, pueblos amurallados, aldeanos, slimes y magos.'],
  ['oficina', 'Oficina', 'Pixel art isométrico: salas, escritorios con su empleado, aviones de papel y globos de diálogo.'],
  ['castillo', 'Castillo', 'Gótico de costado: torre del reloj, vitrales, murciélagos, espectros y cazadoras.'],
  ['raid', 'Raid', 'Banda de MMO: héroes con vida y maná, números de combate y El Intruso, el jefe.'],
  ['ciudad3d', 'Ciudad 3D', 'La ciudad de noche en 3D: torres que crecen con la memoria, ventanas que se encienden con las visitas.'],
  ['acuario', 'Acuario', 'Una pared de peceras: cada cuenta en su pecera, cada proyecto un pez.'],
  ['ops', 'Ops', 'Mesa táctica holográfica: columnas, misiles y drones.'],
  ['planta', 'Planta', 'Fábrica con paleta de consola retro: naves, máquinas, cintas y drones.'],
  ['terminal', 'Terminal', 'Consola de fósforo verde: cada proyecto en su línea, visitas por tail -f.'],
];
const tabs = $('themeTabs');
if (tabs) {
  const pick = id => {
    const t = THEMES.find(x => x[0] === id);
    $('themeImg').src = `${IMG}theme-${id}.webp?v=${V}`;
    $('themeImg').alt = `Tema ${t[1]} de Atalaya`;
    $('themeCap').innerHTML = `<b>${t[1]}.</b> ${t[2]}`;
    tabs.querySelectorAll('button').forEach(b => b.setAttribute('aria-selected', b.dataset.t === id ? 'true' : 'false'));
  };
  tabs.innerHTML = THEMES.map(([id, name]) => `<button role="tab" data-t="${id}">${name}</button>`).join('');
  tabs.addEventListener('click', e => { const b = e.target.closest('button'); if (b) pick(b.dataset.t); });
  pick('ciudad');
  // se precargan de a una para que el cambio sea instantaneo
  let i = 0; const pre = () => { if (i < THEMES.length) { const im = new Image(); im.onload = im.onerror = pre; im.src = `${IMG}theme-${THEMES[i++][0]}.webp?v=${V}`; } };
  addEventListener('load', () => setTimeout(pre, 1500));
}

// entrar a una pantalla existente
$('go')?.addEventListener('submit', e => {
  e.preventDefault();
  const s = $('slug').value.trim().toLowerCase().replace(/^.*nube\.neracosu\.com\//, '').replace(/\/.*$/, '');
  if (s) location.href = 'https://nube.neracosu.com/' + encodeURIComponent(s) + '/';
});

// guias: copiar comandos y marcar la seccion visible en el indice
document.querySelectorAll('pre.cmd').forEach(pre => {
  const b = document.createElement('button');
  b.className = 'copy'; b.type = 'button'; b.textContent = 'Copiar';
  b.addEventListener('click', () => navigator.clipboard?.writeText(pre.querySelector('code')?.textContent || pre.firstChild.textContent).then(() => { b.textContent = 'Copiado'; setTimeout(() => { b.textContent = 'Copiar'; }, 1800); }));
  pre.appendChild(b);
});
const toc = document.querySelector('.toc');
if (toc) {
  const links = new Map([...toc.querySelectorAll('a[href^="#"]')].map(a => [a.getAttribute('href').slice(1), a]));
  const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { links.forEach(a => a.classList.remove('on')); links.get(e.target.id)?.classList.add('on'); } }), { rootMargin: '-20% 0px -70% 0px' });
  document.querySelectorAll('.guide[id]').forEach(s => io.observe(s));
}
