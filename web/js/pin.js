// Seis casillas de PIN con avance automatico, borrado y pegado
export function buildPin(host, onComplete) {
  host.innerHTML = '';
  const boxes = Array.from({ length: 6 }, (_, i) => {
    const b = document.createElement('input');
    b.type = 'password'; b.inputMode = 'numeric'; b.maxLength = 1; b.autocomplete = 'off';
    b.setAttribute('aria-label', `Dígito ${i + 1}`);
    host.appendChild(b);
    return b;
  });
  const value = () => boxes.map(b => b.value).join('');
  boxes.forEach((b, i) => {
    b.addEventListener('input', () => {
      b.value = b.value.replace(/\D/g, '').slice(-1);
      if (b.value && i < 5) boxes[i + 1].focus();
      if (value().length === 6 && onComplete) onComplete();
    });
    b.addEventListener('keydown', e => {
      if (e.key === 'Backspace' && !b.value && i > 0) { boxes[i - 1].focus(); boxes[i - 1].value = ''; e.preventDefault(); }
      if (e.key === 'ArrowLeft' && i > 0) boxes[i - 1].focus();
      if (e.key === 'ArrowRight' && i < 5) boxes[i + 1].focus();
    });
    b.addEventListener('paste', e => {
      const d = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
      if (!d) return;
      e.preventDefault();
      d.split('').forEach((c, j) => { boxes[j].value = c; });
      boxes[Math.min(d.length, 5)].focus();
      if (d.length === 6 && onComplete) onComplete();
    });
  });
  return {
    value,
    focus: () => (boxes.find(b => !b.value) || boxes[5]).focus(),
    clear: () => { boxes.forEach(b => { b.value = ''; }); boxes[0].focus(); },
  };
}
