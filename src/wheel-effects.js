(() => {
  const orbit = document.querySelector('.orbit');
  const segments = document.getElementById('segments');
  const context = document.getElementById('context');
  let frame = 0,
    cursorX = 50,
    cursorY = 25,
    currentAngle = 0;

  window.addEventListener('pointermove', (event) => {
    const bounds = orbit.getBoundingClientRect();
    cursorX = ((event.clientX - bounds.left) / bounds.width) * 100;
    cursorY = ((event.clientY - bounds.top) / bounds.height) * 100;
    if (!frame)
      frame = requestAnimationFrame(() => {
        orbit.style.setProperty('--mx', `${cursorX}%`);
        orbit.style.setProperty('--my', `${cursorY}%`);
        frame = 0;
      });
  });

  new MutationObserver(() => {
    context.classList.remove('ping');
    void context.offsetWidth;
    context.classList.add('ping');
  }).observe(context, { childList: true, characterData: true, subtree: true });

  segments.addEventListener('pointermove', (event) => {
    const card = event.target.closest('.segment');
    if (!card || card.disabled) return;
    const bounds = card.getBoundingClientRect();
    const x = event.clientX - bounds.left,
      y = event.clientY - bounds.top;
    card.style.setProperty('--px', `${x}px`);
    card.style.setProperty('--py', `${y}px`);
    card.style.setProperty('--ry', `${(x / bounds.width - 0.5) * 14}deg`);
    card.style.setProperty('--rx', `${(0.5 - y / bounds.height) * 12}deg`);
  });
  segments.addEventListener('pointerover', (event) => {
    const card = event.target.closest('.segment');
    if (!card || card.disabled) return;
    const outer = orbit.getBoundingClientRect(),
      inner = card.getBoundingClientRect();
    const angle =
      (Math.atan2(
        inner.top + inner.height / 2 - outer.top - outer.height / 2,
        inner.left + inner.width / 2 - outer.left - outer.width / 2,
      ) *
        180) /
        Math.PI +
      90;
    currentAngle = angle + 360 * Math.round((currentAngle - angle) / 360);
    orbit.style.setProperty('--ha', `${currentAngle}deg`);
    orbit.style.setProperty('--hv', 1);
  });
  segments.addEventListener('pointerout', (event) => {
    const card = event.target.closest('.segment');
    if (card && !card.contains(event.relatedTarget)) {
      card.style.removeProperty('--rx');
      card.style.removeProperty('--ry');
      orbit.style.setProperty('--hv', 0);
    }
  });
  segments.addEventListener('pointerdown', (event) => {
    const card = event.target.closest('.segment');
    if (!card || card.disabled) return;
    const bounds = card.getBoundingClientRect();
    const ripple = document.createElement('span');
    ripple.className = 'ripple';
    ripple.style.left = `${event.clientX - bounds.left}px`;
    ripple.style.top = `${event.clientY - bounds.top}px`;
    card.append(ripple);
    ripple.addEventListener('animationend', () => ripple.remove());
  });
})();
