const icons = {
  info: ['bi-info-lg', 'HINWEIS'],
  error: ['bi-exclamation-lg', 'FEHLER'],
  warning: ['bi-exclamation-triangle', 'ACHTUNG'],
  success: ['bi-check-lg', 'ERLEDIGT'],
};

window.app.onAppDialog(({ language, title, message, detail, type, buttons }) => {
  window.localize.setLanguage(language);
  const t = window.localize.t;
  document.body.dataset.type = type;
  document.getElementById('dialog-title').textContent = t(title);
  document.getElementById('dialog-message').textContent = t(message);
  document.getElementById('dialog-symbol').querySelector('i').className = `bi ${icons[type][0]}`;
  document.getElementById('dialog-kicker').textContent = t(icons[type][1]);
  const detailBox = document.getElementById('dialog-detail');
  detailBox.hidden = !detail;
  detailBox.textContent = detail;
  const footer = document.getElementById('dialog-buttons');
  footer.replaceChildren();
  buttons.forEach((label, index) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = t(label);
    button.className = index === 0 ? 'primary' : 'secondary';
    button.onclick = () => window.app.closeAppDialog(index);
    footer.append(button);
  });
  footer.querySelector('button')?.focus();
});

document.getElementById('dialog-close').onclick = () => window.app.closeAppDialog(-1);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.app.closeAppDialog(-1);
});
