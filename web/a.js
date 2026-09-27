/* Atalaya · analítica sin cookies (opcional). Mide lo que los registros del servidor no ven: el tiempo que la
   página estuvo a la vista, cuánto se leyó, si el visitante rebotó de verdad y las conversiones (WhatsApp,
   llamadas, correos, formularios, descargas y enlaces externos). No usa cookies ni guarda nada en el navegador,
   no envía la dirección IP ni datos del visitante: solo la ruta de la página y esas cifras.
   Uso: <script defer src="https://SU-ATALAYA/a.js" data-site="a1b2c3d4e5f6"></script>
   Eventos propios: atalaya('event', 'compra') */
(function () {
  var d = document, w = window, sc = d.currentScript, site = sc && sc.getAttribute('data-site');
  var url = sc && sc.src ? sc.src.replace(/\/a\.js(\?.*)?$/, '/api/beacon') : '';
  if (!site || !url || navigator.webdriver || w.__atalaya) return;
  w.__atalaya = 1;
  var vis = 0, since = d.visibilityState === 'visible' ? Date.now() : 0, maxS = 0, next = 0, first = 1, path = location.pathname;
  var entry = 1; try { entry = !d.referrer || new URL(d.referrer).host !== location.host ? 1 : 0; } catch (e) { }
  function post(o) {
    o.s = site; o.p = o.p || path;
    var b = JSON.stringify(o);
    try { if (navigator.sendBeacon && navigator.sendBeacon(url, b)) return; } catch (e) { }
    try { fetch(url, { method: 'POST', body: b, keepalive: true, mode: 'no-cors' }); } catch (e) { }
  }
  function scroll() { var h = d.documentElement, p = (w.scrollY + w.innerHeight) / Math.max(1, h.scrollHeight); if (p > maxS) maxS = Math.min(1, p); }
  // lo que estuvo a la vista desde el ultimo envio (varios envios si el visitante va y vuelve de la pestana)
  function flush() {
    if (since) { vis += Date.now() - since; since = d.visibilityState === 'visible' ? Date.now() : 0; }
    var sec = Math.round(vis / 1000); vis = 0;
    if (!first && !sec) return;
    post({ t: 'pv', f: first, sec: sec, sc: Math.round(maxS * 100), e: entry, n: next });
    first = 0;
  }
  function ev(k, l) { post({ t: 'ev', k: k, l: String(l || '').slice(0, 80) }); }
  scroll();
  w.addEventListener('scroll', scroll, { passive: true });
  d.addEventListener('visibilitychange', function () { if (d.visibilityState === 'visible') since = Date.now(); else flush(); });
  w.addEventListener('pagehide', flush);
  // conversiones que se reconocen solas; un enlace a otra pagina del mismo sitio significa que no reboto
  d.addEventListener('click', function (e) {
    var a = e.target && e.target.closest && e.target.closest('a[href]'); if (!a) return;
    var h = a.href || '';
    if (/^tel:/i.test(h)) ev('llamada', h.slice(4));
    else if (/^mailto:/i.test(h)) ev('correo');
    else if (/(^|\/\/)(wa\.me|api\.whatsapp\.com|web\.whatsapp\.com|chat\.whatsapp\.com)\//i.test(h)) ev('whatsapp');
    else if (/\.(pdf|zip|rar|7z|docx?|xlsx?|pptx?|csv|mp3|mp4|apk|dmg|exe)(\?|#|$)/i.test(a.pathname || '')) ev('descarga', (a.pathname || '').split('/').pop());
    else if (a.host && a.host !== location.host) ev('externo', a.host);
    else next = 1;
  }, true);
  d.addEventListener('submit', function (e) { var f = e.target || {}; ev('formulario', f.id || f.getAttribute && f.getAttribute('name') || f.getAttribute && f.getAttribute('action') || ''); }, true);
  // sitios de una sola pagina (Next.js, React...): cada cambio de ruta cuenta como otra pagina
  var push = history.pushState;
  history.pushState = function () { var r = push.apply(this, arguments); if (location.pathname !== path) { next = 1; flush(); path = location.pathname; first = 1; entry = 0; next = 0; maxS = 0; scroll(); } return r; };
  w.atalaya = function (t, k) { if (t === 'event' && k) ev('propio', k); };
})();
