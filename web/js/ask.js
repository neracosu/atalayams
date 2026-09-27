// Confirmaciones propias (en lugar de confirm() y prompt() del navegador): cuadro con icono pixel, titulo,
// explicacion y botones; rojo cuando la accion es delicada. Con `input` pide un texto (y con `match` solo deja
// aceptar si coincide: «escriba el nombre para confirmar»). Trae sus estilos: sirve en la pantalla y en la nube.
//   await ask({ title, body, ok, danger, icon })            -> true | false
//   await ask({ title, body, input: { value, match } })     -> texto | null
import { px } from './pixicons.js';

const CSS = `
.askdlg { width: min(31rem, calc(100vw - 32px)); max-height: calc(100dvh - 32px); overflow: auto; padding: 0; color: var(--ink, #e6edf7);
  background: var(--panel-solid, #0b1222); border: 1px solid var(--line-strong, rgba(148,163,184,.32)); border-top: 3px solid var(--ask-c, #22d3ee);
  border-radius: 18px; box-shadow: 0 30px 80px rgba(0, 0, 0, .6); }
.askdlg::backdrop { background: rgba(3, 6, 14, .72); backdrop-filter: blur(4px); }
.askdlg.danger { --ask-c: #ef4444; }
.askdlg form { display: grid; gap: 1.1rem; padding: 1.4rem 1.5rem 1.3rem; }
.askdlg header { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: .9rem; align-items: start; }
.askdlg .askic { width: 2.8rem; height: 2.8rem; display: grid; place-items: center; border-radius: 12px; border: 1px solid var(--ask-c, #22d3ee);
  background: color-mix(in srgb, var(--ask-c, #22d3ee) 14%, transparent); }
.askdlg .askic .px { width: 1.6rem; height: 1.6rem; }
.askdlg h3 { margin: .1rem 0 0; font-family: var(--pixel, monospace); font-weight: 400; letter-spacing: .05em; font-size: 1.02rem; line-height: 1.35; }
.askdlg p { margin: .4rem 0 0; color: var(--ink-2, #a9b6ca); font-size: .92rem; line-height: 1.5; }
.askdlg p b, .askdlg p code { color: var(--ink, #e6edf7); }
.askdlg p code { font-family: var(--mono, monospace); font-size: .9em; background: rgba(148, 163, 184, .12); padding: .05em .35em; border-radius: 4px; }
.askdlg label { display: grid; gap: .35rem; font-size: .8rem; color: var(--ink-3, #6b7a93); }
.askdlg input { background: var(--bg-2, #0b1222); border: 1px solid var(--line-strong, rgba(148,163,184,.32)); border-radius: 10px; color: var(--ink, #e6edf7);
  padding: .65rem .8rem; font: inherit; font-size: 1rem; }
.askdlg input:focus { outline: none; border-color: var(--ask-c, #22d3ee); }
.askdlg .askact { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1.5fr); gap: .6rem; }
.askdlg .askact button { padding: .75rem; border-radius: 10px; font: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.askdlg .askno { background: var(--bg-2, #0b1222); color: var(--ink, #e6edf7); border: 1px solid var(--line-strong, rgba(148,163,184,.32)); }
.askdlg .askyes { border: 0; color: #03161b; background: linear-gradient(180deg, #22d3ee, #0ea5b7); }
.askdlg.danger .askyes { color: #fff; background: linear-gradient(180deg, #ef4444, #b91c1c); }
.askdlg .askyes:disabled { opacity: .45; cursor: default; }
@media (max-width: 420px) { .askdlg form { padding: 1.1rem 1rem; } .askdlg .askact { grid-template-columns: minmax(0, 1fr); } .askdlg .askyes { order: -1; } }
`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function ask({ title, body = '', ok = 'Aceptar', cancel = 'Cancelar', danger = false, icon, input = null } = {}) {
  if (!document.getElementById('askcss')) { const st = document.createElement('style'); st.id = 'askcss'; st.textContent = CSS; document.head.appendChild(st); }
  return new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'askdlg' + (danger ? ' danger' : '');
    d.setAttribute('aria-labelledby', 'askT');
    // body admite HTML simple (quien llama escapa lo que viene del servidor con esc())
    d.innerHTML = `<form method="dialog">
      <header><div class="askic">${px(icon || (danger ? 'warn' : 'ask'))}</div><div><h3 id="askT">${esc(title)}</h3>${body ? `<p>${body}</p>` : ''}</div></header>
      ${input ? `<label>${esc(input.label || '')}<input type="text" autocomplete="off" spellcheck="false" value="${esc(input.value || '')}" placeholder="${esc(input.placeholder || '')}"></label>` : ''}
      <div class="askact"><button type="button" class="askno">${esc(cancel)}</button><button type="submit" class="askyes">${esc(ok)}</button></div></form>`;
    document.body.appendChild(d);
    const inp = d.querySelector('input'), yes = d.querySelector('.askyes');
    let val = input ? null : false;
    const check = () => { if (input && input.match != null) yes.disabled = inp.value.trim() !== String(input.match); };
    if (inp) { inp.addEventListener('input', check); check(); }
    d.querySelector('.askno').addEventListener('click', () => d.close());
    d.querySelector('form').addEventListener('submit', e => {
      e.preventDefault();
      if (yes.disabled) return;
      val = input ? inp.value.trim() : true;
      d.close();
    });
    d.addEventListener('close', () => { d.remove(); resolve(val); });
    d.showModal();
    (inp || (danger ? d.querySelector('.askno') : yes)).focus();
    if (inp) inp.select();
  });
}
export { esc as askEsc };
