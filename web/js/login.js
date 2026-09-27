// Pantalla de acceso: usuario + PIN de 6 digitos
import { animate, stagger } from '../vendor/anime.esm.min.js';
import { buildPin } from './pin.js';

const form = document.getElementById('f');
const err = document.getElementById('err');
const user = document.getElementById('user');
const pin = buildPin(document.getElementById('pin'), () => form.requestSubmit());

animate('.card', { opacity: [0, 1], translateY: [24, 0], duration: 700, ease: 'outExpo' });
animate('.pin-row input', { opacity: [0, 1], translateY: [10, 0], delay: stagger(50, { start: 250 }), duration: 500 });

try { user.value = localStorage.getItem('atalaya_user') || ''; } catch { }
(user.value ? pin.focus : () => user.focus())();

form.addEventListener('submit', async e => {
  e.preventDefault();
  err.textContent = '';
  if (!user.value.trim()) return user.focus();
  if (pin.value().length !== 6) { err.textContent = 'Complete los 6 dígitos'; return pin.focus(); }
  const btn = document.getElementById('go');
  btn.disabled = true;
  try {
    const r = await fetch('api/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Atalaya': '1' },
      body: JSON.stringify({ user: user.value.trim(), pin: pin.value() }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'No se pudo entrar');
    try { localStorage.setItem('atalaya_user', user.value.trim()); } catch { }
    await animate('.card', { opacity: 0, scale: 0.96, duration: 300 }).then();
    location.href = './';
  } catch (ex) {
    err.textContent = ex.message;
    pin.clear();
    const card = document.querySelector('.card');
    card.classList.remove('shake'); void card.offsetWidth; card.classList.add('shake');
  } finally { btn.disabled = false; }
});

// enlace «¿Qué es esto?» para quien llega sin usuario (el dueno lo puede apagar en el asistente)
// y debajo, la version, la edad del proyecto (desde su primer commit) y la invitacion a colaborar
const BORN = Date.parse('2026-09-25T10:58:22-07:00');
fetch('api/acceso').then(r => r.json()).then(j => {
  if (!j.promo) return;
  document.getElementById('promo').hidden = false;
  document.getElementById('born').hidden = false;
  document.getElementById('bornV').textContent = 'v' + j.version;
  const age = document.getElementById('bornAge'), p2 = n => String(n).padStart(2, '0');
  const tick = () => { let s = Math.max(0, Math.floor((Date.now() - BORN) / 1000)); const d = Math.floor(s / 86400); s %= 86400; age.textContent = `${d} d ${p2(Math.floor(s / 3600))} h ${p2(Math.floor(s % 3600 / 60))} min ${p2(s % 60)} s`; };
  tick(); setInterval(tick, 1000);
}).catch(() => { });

// fondo de estrellas liviano
const cv = document.getElementById('stars');
const cx = cv.getContext('2d');
let stars = [];
function resize() {
  cv.width = innerWidth * devicePixelRatio; cv.height = innerHeight * devicePixelRatio;
  stars = Array.from({ length: 140 }, () => ({ x: Math.random() * cv.width, y: Math.random() * cv.height, r: Math.random() * 1.6 + .3, p: Math.random() * 6 }));
}
function frame(t) {
  cx.clearRect(0, 0, cv.width, cv.height);
  for (const s of stars) {
    cx.globalAlpha = .25 + .45 * (0.5 + 0.5 * Math.sin(t / 900 + s.p));
    cx.fillStyle = '#9fb4d9';
    cx.fillRect(s.x, s.y, s.r * devicePixelRatio, s.r * devicePixelRatio);
  }
  requestAnimationFrame(frame);
}
addEventListener('resize', resize); resize(); requestAnimationFrame(frame);
