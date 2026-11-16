const box = document.getElementById('segments');
const t = window.localize.t;
const panel = document.getElementById('quick-panel');
const list = document.getElementById('quick-destinations');
const slots = [];
let current = { selected: [], destinations: [], loading: true, type: '' };
let activePanel = '';
let transferState = null;
let renameOptions = { prefix: '', suffix: '', search: '', replace: '', numbering: false };
let renameRequest = 0;
let expectedHash = '';
let imageOrder = [];
let imageSelectionKey = '';
let imageSize = 1600;
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)) - 1, units.length - 1);
  return `${(bytes / 1024 ** (unit + 1)).toLocaleString(document.documentElement.lang === 'en' ? 'en-US' : 'de-DE', { maximumFractionDigits: 1 })} ${units[unit]}`;
}
const menus = {
  images: {
    title: 'Bilder',
    hint: 'Neue Dateien neben den Originalen. PDF-Seiten mit den Pfeilen sortieren.',
    items: [
      ['images:share', 'Fürs Teilen vorbereiten', 'bi-image', 'images'],
      ['images:pdf', 'Bilder als PDF', 'bi-file-earmark-pdf', 'image-pair'],
    ],
  },
  folders: {
    title: 'Auswahl bündeln',
    hint: 'Markierte Elemente in einem neuen Ordner zusammenfassen.',
    items: [['folders:collect', 'Bündeln', 'bi-folder-check', 'multiple']],
  },
  copy: {
    title: 'Smart Copy',
    hint: 'Das Ergebnis landet in der Zwischenablage.',
    items: [
      ['copy:name', 'Namen kopieren', 'bi-fonts'],
      ['copy:path', 'Pfad kopieren', 'bi-link-45deg'],
      ['copy:paths', 'Alle Pfade kopieren', 'bi-list-ul'],
      ['copy:info', 'Dateiinformationen', 'bi-info-circle'],
    ],
  },
  files: {
    title: 'Dateiaktionen',
    hint: 'Weitere Werkzeuge für deine Auswahl.',
    items: [
      ['files:properties', 'Eigenschaften', 'bi-info-circle'],
      ['files:size', 'Größe der Auswahl', 'bi-pie-chart', 'selection'],
      ['files:hash', 'SHA-256 kopieren', 'bi-fingerprint', 'file'],
      ['files:verify-hash', 'SHA-256 prüfen', 'bi-shield-check', 'file'],
      ['files:compare', 'Zwei Dateien vergleichen', 'bi-files', 'pair'],
      ['files:duplicates', 'Duplikate finden', 'bi-layers', 'selection'],
      ['files:locks', 'Dateisperre prüfen', 'bi-lock', 'file'],
      ['files:rename', 'Massenumbenennung', 'bi-input-cursor-text', 'multiple'],
      ['files:admin', 'Als Admin starten', 'bi-shield-check', 'exe'],
    ],
  },
  windows: {
    title: 'Windows-Werkzeuge',
    hint: 'Öffnet das jeweilige Windows-Werkzeug.',
    items: [
      ['windows:devmgmt.msc', 'Geräte-Manager', 'bi-hdd-stack'],
      ['windows:services.msc', 'Dienste', 'bi-gear-wide-connected'],
      ['windows:eventvwr.msc', 'Ereignisanzeige', 'bi-journal-text'],
      ['windows:msinfo32.exe', 'Systeminformationen', 'bi-pc-display'],
    ],
  },
  project: {
    title: 'Projekt',
    hint: 'Verwendet den erkannten Projektordner.',
    items: [
      ['project:terminal', 'Terminal im Projekt', 'bi-terminal'],
      ['project:copy-root', 'Projektpfad kopieren', 'bi-link-45deg'],
      ['project:copy-relative', 'Relativen Pfad kopieren', 'bi-copy'],
    ],
  },
  gaming: {
    title: 'Gaming',
    hint: 'Direkt zu den Windows-Werkzeugen.',
    items: [
      ['gaming:game-mode', 'Spielmodus', 'bi-controller'],
      ['gaming:game-bar', 'Game Bar', 'bi-record-circle'],
      ['gaming:captures', 'Aufnahmen', 'bi-camera-video'],
      ['gaming:resource-monitor', 'Ressourcenmonitor', 'bi-activity'],
    ],
  },
};

function createSlot(index) {
  const angle = index * 45 - 90;
  const radians = (angle * Math.PI) / 180;

  const spoke = document.createElement('span');
  spoke.className = 'spoke';
  spoke.style.setProperty('--angle', `${angle}deg`);
  spoke.style.setProperty('--delay', `${index * 28}ms`);
  box.append(spoke);

  const button = document.createElement('button');
  button.className = 'segment';
  button.type = 'button';
  button.style.setProperty('--x', `${Math.round(Math.cos(radians) * 176)}px`);
  button.style.setProperty('--y', `${Math.round(Math.sin(radians) * 176)}px`);
  button.style.setProperty('--delay', `${index * 28}ms`);
  const icon = document.createElement('i');
  const label = document.createElement('span');
  button.append(icon, label);

  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (button.disabled) return;
    if (button.dataset.submenu) {
      activePanel = button.dataset.submenu;
      renderPanel();
      panel.hidden = false;
      return;
    }
    button.classList.add('activated');
    const succeeded = await window.app.action(button.dataset.action);
    if (!succeeded) button.classList.remove('activated');
  });

  box.append(button);
  slots.push({ button, spoke, icon, label });
}

function updateActions(actions) {
  if (slots.length === 0) {
    for (let index = 0; index < 8; index++) createSlot(index);
  }

  slots.forEach(({ button, spoke, icon, label }, index) => {
    const action = actions[index];
    button.hidden = !action;
    spoke.hidden = !action;
    if (!action) return;
    button.dataset.action = action.id;
    button.dataset.submenu = action.submenu || '';
    button.disabled = !action.available;
    button.title = action.available ? action.description : action.reason;
    icon.className = action.iconUrl ? 'program-icon' : `bi ${action.icon}`;
    icon.style.backgroundImage = action.iconUrl ? `url("${action.iconUrl}")` : '';
    label.textContent = action.label;
  });
}

function addMenuButton(id, label, icon, requirement) {
  const row = document.createElement('button');
  row.type = 'button';
  row.className = 'menu-action';
  row.innerHTML = `<i class="bi ${icon}"></i><span></span>`;
  row.querySelector('span').textContent = t(label);
  row.disabled =
    (requirement === 'selection' && !current.selected.length) ||
    (requirement === 'file' && !current.selectedIsFile) ||
    (requirement === 'pair' && current.selected.length !== 2) ||
    (requirement === 'multiple' && current.selected.length < 2) ||
    (requirement === 'exe' && current.type !== '.exe') ||
    (requirement === 'images' &&
      (!current.selected.length ||
        !current.selected.every((file) => /\.(jpe?g|png)$/i.test(file)))) ||
    (requirement === 'image-pair' &&
      (current.selected.length < 2 ||
        !current.selected.every((file) => /\.(jpe?g|png)$/i.test(file))));
  row.onclick = async () => {
    if (id === 'files:rename') {
      activePanel = 'rename';
      renderPanel();
      return;
    }
    if (id === 'files:verify-hash') {
      activePanel = 'verify-hash';
      renderPanel();
      return;
    }
    const name =
      id === 'folders:collect'
        ? document.getElementById('folder-name')?.value
        : id === 'images:share'
          ? Number(document.getElementById('image-size')?.value)
          : id === 'images:pdf'
            ? { order: [...imageOrder] }
            : undefined;
    row.disabled = true;
    if (!(await window.app.action(id, name))) row.disabled = false;
  };
  list.append(row);
}

function renderRenamePanel() {
  list.innerHTML = `
    <div class="rename-fields">
      <label>${t('Präfix')}<input class="folder-name" data-field="prefix" maxlength="80" placeholder="${t('Vor dem Namen')}"></label>
      <label>${t('Suffix')}<input class="folder-name" data-field="suffix" maxlength="80" placeholder="${t('Nach dem Namen')}"></label>
      <label>${t('Suchen')}<input class="folder-name" data-field="search" maxlength="80" placeholder="${t('Text im Namen')}"></label>
      <label>${t('Ersetzen')}<input class="folder-name" data-field="replace" maxlength="80" placeholder="${t('Neuer Text')}"></label>
      <label class="rename-check"><input type="checkbox" data-field="numbering"> ${t('Nummerierung anhängen')}</label>
    </div>
    <div class="rename-preview" aria-live="polite"></div>
    <button class="menu-action rename-apply" type="button" disabled><i class="bi bi-check2"></i><span>${t('Umbenennen')}</span></button>`;
  const preview = list.querySelector('.rename-preview');
  const apply = list.querySelector('.rename-apply');
  let expected = null;
  let timer;
  for (const input of list.querySelectorAll('[data-field]')) {
    input[input.type === 'checkbox' ? 'checked' : 'value'] = renameOptions[input.dataset.field];
    input.addEventListener('input', () => {
      renameOptions[input.dataset.field] = input.type === 'checkbox' ? input.checked : input.value;
      clearTimeout(timer);
      renameRequest++;
      expected = null;
      apply.disabled = true;
      preview.textContent = t('Vorschau wird erstellt …');
      timer = setTimeout(updatePreview, 180);
    });
  }
  async function updatePreview() {
    const request = ++renameRequest;
    const result = await window.app.renamePreview(renameOptions);
    if (request !== renameRequest || activePanel !== 'rename' || panel.hidden) return;
    expected = result.ok ? result.items : null;
    apply.disabled = !expected;
    preview.replaceChildren();
    if (!result.ok) {
      preview.textContent = t(result.error);
      return;
    }
    for (const item of result.items.slice(0, 5)) {
      const line = document.createElement('div');
      line.textContent = `${item.from} → ${item.to}`;
      line.title = line.textContent;
      preview.append(line);
    }
    if (result.items.length > 5)
      preview.append(t('… und {count} weitere', { count: result.items.length - 5 }));
  }
  apply.onclick = async () => {
    if (!expected) return;
    apply.disabled = true;
    const result = await window.app.renameApply(renameOptions, expected);
    if (!result.ok) {
      preview.textContent = t(result.error);
      expected = null;
    }
  };
  updatePreview();
}

function renderHashPanel() {
  list.innerHTML = `
    <label class="hash-label" for="expected-hash">${t('Erwarteten SHA-256-Wert einfügen')}</label>
    <input id="expected-hash" class="folder-name" spellcheck="false" autocomplete="off" placeholder="${t('64 Hex-Zeichen')}">
    <button class="menu-action" type="button"><i class="bi bi-shield-check"></i><span>${t('Prüfen')}</span></button>`;
  const input = list.querySelector('input');
  const button = list.querySelector('button');
  input.value = expectedHash;
  button.disabled = !/^(?:SHA-?256\s*[:=]\s*)?[0-9a-f]{64}$/i.test(expectedHash.trim());
  input.oninput = () => {
    expectedHash = input.value;
    button.disabled = !/^(?:SHA-?256\s*[:=]\s*)?[0-9a-f]{64}$/i.test(expectedHash.trim());
  };
  input.onkeydown = (event) => {
    if (event.key === 'Enter' && !button.disabled) button.click();
  };
  button.onclick = async () => {
    button.disabled = true;
    if (!(await window.app.action('files:verify-hash', expectedHash))) {
      button.disabled = false;
    }
  };
  input.focus();
}

function renderImageOrder(container) {
  container.replaceChildren();
  imageOrder.forEach((sourceIndex, position) => {
    const file = current.selected[sourceIndex];
    const row = document.createElement('div');
    row.className = 'image-order-row';
    const name = document.createElement('span');
    name.textContent = `${position + 1}. ${file.split(/[\\/]/).at(-1)}`;
    name.title = file;
    row.append(name);
    for (const [step, icon, label] of [
      [-1, 'bi-arrow-up', 'Nach oben'],
      [1, 'bi-arrow-down', 'Nach unten'],
    ]) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'image-order-move';
      button.innerHTML = `<i class="bi ${icon}" aria-hidden="true"></i>`;
      button.title = t(label);
      button.setAttribute('aria-label', `${t(label)}: ${file.split(/[\\/]/).at(-1)}`);
      button.disabled = position + step < 0 || position + step >= imageOrder.length;
      button.onclick = () => {
        const target = position + step;
        [imageOrder[position], imageOrder[target]] = [imageOrder[target], imageOrder[position]];
        renderImageOrder(container);
        [...(container.children[target]?.querySelectorAll('button') || [])]
          .find((candidate) => !candidate.disabled)
          ?.focus();
      };
      row.append(button);
    }
    container.append(row);
  });
}

function renderPanel() {
  list.replaceChildren();
  const menu = menus[activePanel];
  document.getElementById('panel-title').textContent =
    activePanel === 'rename'
      ? t('Massenumbenennung')
      : activePanel === 'verify-hash'
        ? t('SHA-256 prüfen')
        : t(menu?.title || 'Schnell ablegen');
  document.getElementById('panel-hint').textContent =
    activePanel === 'rename'
      ? t('Dateiendungen bleiben erhalten. Prüfe die Vorschau vor dem Umbenennen.')
      : activePanel === 'verify-hash'
        ? t('Vergleicht die gewählte Datei mit einer bekannten Prüfsumme.')
        : t(menu?.hint || 'Kopieren oder verschieben – ohne Ordner zu suchen.');
  document.getElementById('quick-count').textContent = current.loading
    ? t('Explorer-Auswahl wird geladen …')
    : current.selected.length
      ? t(
          current.selected.length === 1
            ? '{count} Element ausgewählt'
            : '{count} Elemente ausgewählt',
          { count: current.selected.length },
        )
      : t('Keine Datei ausgewählt');

  if (activePanel === 'rename') {
    renderRenamePanel();
    return;
  }
  if (activePanel === 'verify-hash') {
    renderHashPanel();
    return;
  }
  if (menu) {
    if (activePanel === 'images') {
      const key = JSON.stringify(current.selected);
      if (key !== imageSelectionKey) {
        imageSelectionKey = key;
        imageOrder = current.selected.map((_, index) => index);
      }
      const preview = document.createElement('div');
      preview.className = 'image-preview';
      renderImageOrder(preview);
      list.append(preview);
      const size = document.createElement('select');
      size.id = 'image-size';
      size.className = 'folder-name';
      for (const edge of [1200, 1600, 2048]) {
        const option = document.createElement('option');
        option.value = edge;
        option.textContent = t('Maximal {count} px', { count: edge });
        option.selected = edge === imageSize;
        size.append(option);
      }
      size.onchange = () => {
        imageSize = Number(size.value);
      };
      list.append(size);
    }
    if (activePanel === 'folders') {
      const input = document.createElement('input');
      input.id = 'folder-name';
      input.className = 'folder-name';
      input.placeholder = t('Ordnername (optional)');
      input.value = '';
      list.append(input);
    }
    menu.items.forEach(([id, label, icon, requirement]) =>
      addMenuButton(id, label, icon, requirement),
    );
    return;
  }
  current.destinations.forEach((entry, index) => {
    const folder = entry.path;
    const row = document.createElement('div');
    row.className = 'quick-row';
    const name = document.createElement('span');
    name.textContent = `${folder.split(/[\\/]/).filter(Boolean).at(-1) || folder} · ${t(entry.kind)}`;
    name.title = folder;

    const open = document.createElement('button');
    open.innerHTML = '<i class="bi bi-box-arrow-up-right"></i>';
    open.title = t('Ordner öffnen');
    open.onclick = () => window.app.action(`quick:open:${index}`);

    const copy = document.createElement('button');
    copy.innerHTML = '<i class="bi bi-copy"></i>';
    copy.title = t('Nach {folder} kopieren', { folder });
    copy.disabled =
      !current.selected.length ||
      transferState?.phase === 'start' ||
      transferState?.phase === 'progress';
    copy.onclick = () => window.app.action(`quick:copy:${index}`);

    const move = document.createElement('button');
    move.innerHTML = '<i class="bi bi-arrow-right"></i>';
    move.title = t('Nach {folder} verschieben', { folder });
    move.disabled =
      !current.selected.length ||
      transferState?.phase === 'start' ||
      transferState?.phase === 'progress';
    move.onclick = () => window.app.action(`quick:move:${index}`);

    row.append(name, open, copy, move);
    list.append(row);
  });

  if (!current.destinations.length) {
    const empty = document.createElement('p');
    empty.textContent = t('Zielordner in den Einstellungen hinzufügen.');
    list.append(empty);
  }
}

window.app.onContext((data) => {
  window.localize.setLanguage(data.language);
  current = data;
  updateActions(data.actions);
  document.getElementById('context').textContent = data.selected.length
    ? t('{count} ausgewählt', { count: data.selected.length })
    : data.loading
      ? t('Suche Datei …')
      : data.folder
        ? data.folder.split(/[\\/]/).filter(Boolean).at(-1)
        : t('Kein Explorer-Ordner');
  if (!panel.hidden) renderPanel();
});
window.app.onGesture(({ kind, index }) => {
  slots.forEach(({ button }, slot) => {
    button.classList.toggle('gesture-target', slot === index && !button.disabled);
  });
  if (kind === 'select' && slots[index] && !slots[index].button.disabled) {
    slots[index].button.click();
  }
});
window.app.onTransfer((state) => {
  transferState = state;
  activePanel = 'destinations';
  panel.hidden = false;
  const status = document.getElementById('transfer-status');
  const label = document.getElementById('transfer-label');
  const fill = document.getElementById('transfer-fill');
  const byteLabel = document.getElementById('transfer-bytes');
  const errors = document.getElementById('transfer-errors');
  const cancel = document.getElementById('transfer-cancel');
  cancel.hidden = !['start', 'progress'].includes(state.phase);
  cancel.disabled = false;
  cancel.textContent = t('Abbrechen');
  status.hidden = false;
  status.classList.toggle(
    'working',
    state.phase === 'start' || state.state === 'working' || state.state === 'scanning',
  );
  const settled = state.completed.length + state.failed.length;
  const byteProgress = state.totalBytes > 0 && state.state !== 'scanning';
  const fraction = byteProgress
    ? state.bytesDone / state.totalBytes
    : state.total
      ? settled / state.total
      : 0;
  fill.style.width = `${Math.min(100, Math.round(fraction * 100))}%`;
  byteLabel.textContent = byteProgress
    ? `${Math.min(100, Math.round(fraction * 100))}% · ${formatBytes(state.bytesDone || 0)} / ${formatBytes(state.totalBytes)}`
    : state.state === 'scanning'
      ? t('Größe wird ermittelt …')
      : '';
  label.textContent =
    state.phase === 'error'
      ? state.message
      : state.phase === 'done'
        ? state.failed.length
          ? t('{done} erledigt, {failed} fehlgeschlagen', {
              done: state.completed.length,
              failed: state.failed.length,
            })
          : t('{count} erledigt', { count: state.completed.length })
        : state.phase === 'cancelled'
          ? t('Abgebrochen · {done} von {total} erledigt', {
              done: state.completed.length,
              total: state.total,
            })
          : `${t('{done} von {total} erledigt', { done: settled, total: state.total })}${state.current ? ` · ${state.current}` : ''}`;
  errors.replaceChildren();
  if (state.phase === 'done' || state.phase === 'cancelled') {
    state.failed.slice(0, 4).forEach((item) => {
      const row = document.createElement('li');
      row.textContent = `${item.source.split(/[\\/]/).at(-1)}: ${item.message}`;
      errors.append(row);
    });
    if (state.failed.length > 4) {
      const row = document.createElement('li');
      row.textContent = t('Weitere {count} Fehler', { count: state.failed.length - 4 });
      errors.append(row);
    }
  }
  renderPanel();
});
document.getElementById('transfer-cancel').onclick = async (event) => {
  event.currentTarget.disabled = true;
  event.currentTarget.textContent = t('Wird abgebrochen …');
  await window.app.cancelTransfer();
};

window.replayWheelAnimation = () => {
  renameRequest++;
  panel.hidden = true;
  activePanel = '';
  transferState = null;
  imageSelectionKey = '';
  imageOrder = [];
  document.getElementById('transfer-status').hidden = true;
  for (const element of document.querySelectorAll('.orbit,.spoke,.segment,.hub')) {
    element.style.animation = 'none';
    void element.offsetWidth;
    element.style.animation = '';
    element.classList.remove('activated');
    element.classList.remove('gesture-target');
  }
};

document.getElementById('quick-back').onclick = () => {
  panel.hidden = true;
};
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.app.close();
});
document.addEventListener('pointerdown', (event) => {
  if (!event.target.closest('.segment,.quick-panel,.select-menu')) window.app.close();
});
