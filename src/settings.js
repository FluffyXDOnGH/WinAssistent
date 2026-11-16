const hotkey = document.getElementById('hotkey'),
  enabled = document.getElementById('enabled'),
  startup = document.getElementById('startup'),
  pauseFullscreen = document.getElementById('pause-fullscreen');
const toast = document.getElementById('settings-toast');
const t = window.localize.t;
const languageSelect = document.getElementById('language');
const updateIndicator = document.getElementById('update-indicator');
const updatePopover = document.getElementById('update-popover');
const updateButton = document.getElementById('update-action');
const updateCheck = document.getElementById('update-check');
let updateState = { phase: 'unconfigured', version: '', progress: 0, error: '' };
function renderUpdateState(state) {
  updateState = state;
  const active = ['available', 'downloading', 'downloaded'].includes(state.phase);
  updateIndicator.hidden = !active;
  if (!active) updatePopover.hidden = true;
  updateIndicator.setAttribute('aria-expanded', String(!updatePopover.hidden));
  updateIndicator.title = t(state.phase === 'downloaded' ? 'Update bereit' : 'Update verfügbar');
  updateIndicator.setAttribute('aria-label', updateIndicator.title);
  updateIndicator.classList.toggle('downloading', state.phase === 'downloading');
  document.getElementById('update-version').textContent = state.version
    ? t('Version {version}', { version: state.version })
    : '';
  document.getElementById('update-title').textContent = t(
    state.phase === 'downloaded' ? 'Update bereit' : 'Update verfügbar',
  );
  const status = {
    unconfigured: 'Update-Prüfung noch nicht eingerichtet.',
    checking: 'Suche nach Updates …',
    idle: 'Auf dem neuesten Stand.',
    available: 'Eine neue Version ist verfügbar.',
    downloading: 'Update wird heruntergeladen …',
    downloaded: 'Update bereit zur Installation.',
    error: 'Updateprüfung fehlgeschlagen. Bitte später erneut versuchen.',
  };
  const message = state.error || status[state.phase] || status.unconfigured;
  document.getElementById('update-general-status').textContent = t(message);
  document.getElementById('update-message').textContent = t(message);
  const progress = document.getElementById('update-progress');
  progress.hidden = state.phase !== 'downloading';
  const percent = Math.max(0, Math.min(100, Number(state.progress) || 0));
  progress.setAttribute('aria-valuenow', String(percent));
  document.getElementById('update-progress-fill').style.width = `${percent}%`;
  updateButton.hidden = !['available', 'downloaded'].includes(state.phase);
  updateButton.textContent = t(
    state.phase === 'downloaded' ? 'Installieren und neu starten' : 'Herunterladen',
  );
  updateCheck.hidden = state.phase === 'unconfigured';
  updateCheck.disabled = ['checking', 'downloading', 'downloaded'].includes(state.phase);
}
updateCheck.onclick = async () => {
  updateCheck.disabled = true;
  const result = await window.app.updateAction('check');
  updateCheck.disabled = false;
  if (!result.ok) showToast(t(result.error || 'Update konnte nicht geladen werden.'), 'error');
};
updateIndicator.onclick = () => {
  updatePopover.hidden = !updatePopover.hidden;
  updateIndicator.setAttribute('aria-expanded', String(!updatePopover.hidden));
};
document.getElementById('update-dismiss').onclick = () => {
  updatePopover.hidden = true;
  updateIndicator.setAttribute('aria-expanded', 'false');
};
updateButton.onclick = async () => {
  updateButton.disabled = true;
  const result = await window.app.updateAction(
    updateState.phase === 'downloaded' ? 'install' : 'download',
  );
  updateButton.disabled = false;
  if (!result.ok) showToast(t(result.error || 'Update konnte nicht geladen werden.'), 'error');
};
window.app.onUpdateState(renderUpdateState);
let toastTimer;
function showToast(message, tone = 'success') {
  clearTimeout(toastTimer);
  toast.dataset.tone = tone;
  document.getElementById('toast-icon').className =
    `bi ${tone === 'error' ? 'bi-exclamation-circle' : tone === 'info' ? 'bi-info-circle' : 'bi-check2'}`;
  document.getElementById('toast-message').textContent = message;
  toast.classList.remove('visible');
  void toast.offsetWidth;
  toast.classList.add('visible');
  toastTimer = setTimeout(() => toast.classList.remove('visible'), tone === 'error' ? 5000 : 2600);
}
const destinationList = document.getElementById('destinations');
const profile = document.getElementById('profile');
const profilePreview = document.getElementById('profile-preview');
const profileSlotList = document.getElementById('profile-slots');
const customEditor = document.getElementById('custom-editor');
const customSlotList = document.getElementById('custom-slots');
const programList = document.getElementById('custom-programs');
const directionNames = [
  '↑ Oben',
  '↗ Oben rechts',
  '→ Rechts',
  '↘ Unten rechts',
  '↓ Unten',
  '↙ Unten links',
  '← Links',
  '↖ Oben links',
];
const directions = () => directionNames.map((name) => t(name));
const areas = ['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'];
let destinations = [];
let customSlots = [];
let profileLayouts = {};
let actionCatalog = [];
let programs = [];
const programIconCache = new Map();
function requestProgramIcon(file) {
  if (!programIconCache.has(file)) {
    programIconCache.set(
      file,
      window.app.programIcon(file).catch(() => null),
    );
  }
  return programIconCache.get(file);
}
function setActionIcon(icon, action) {
  icon.className = `bi ${action?.icon || 'bi-circle'}`;
  icon.style.backgroundImage = '';
  icon.dataset.programFile = action?.file || '';
  if (!action?.file) return;
  requestProgramIcon(action.file).then((url) => {
    if (!url || !icon.isConnected || icon.dataset.programFile !== action.file) return;
    icon.className = 'program-icon';
    icon.style.backgroundImage = `url("${url}")`;
  });
}
let initialTabShown = false;
const settingsMain = document.querySelector('.settings-page main');
const tabs = {
  general: document.getElementById('tab-general'),
  wheel: document.getElementById('tab-wheel'),
};
function showTab(name) {
  for (const [key, button] of Object.entries(tabs)) {
    const active = key === name;
    button.classList.toggle('active', active);
    button.setAttribute('aria-selected', String(active));
    document.getElementById(`view-${key}`).hidden = !active;
  }
  settingsMain.scrollTop = 0;
}
tabs.general.onclick = () => showTab('general');
tabs.wheel.onclick = () => showTab('wheel');
function renderPrograms() {
  programList.replaceChildren();
  programs.forEach((program, index) => {
    const card = document.createElement('div');
    card.className = 'program-card';
    const top = document.createElement('div');
    top.className = 'program-top';
    const name = document.createElement('input');
    name.value = program.label;
    name.maxLength = 24;
    name.setAttribute('aria-label', t('Programmname'));
    name.oninput = () => {
      program.label = name.value;
      customSlotList.querySelectorAll('option').forEach((option) => {
        if (option.value === program.id) option.textContent = name.value;
      });
    };
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.title = t('Programm entfernen');
    remove.setAttribute('aria-label', t('{name} entfernen', { name: program.label }));
    remove.innerHTML = '<i class="bi bi-x-lg"></i>';
    remove.onclick = () => {
      const removed = programs.splice(index, 1)[0];
      customSlots = customSlots.map((id) => (id === removed.id ? 'settings' : id));
      renderProfile();
    };
    const image = document.createElement('span');
    image.className = 'program-image';
    image.setAttribute('aria-hidden', 'true');
    requestProgramIcon(program.file).then((url) => {
      if (url && image.isConnected) image.style.backgroundImage = `url("${url}")`;
    });
    top.append(image, name, remove);
    const file = document.createElement('small');
    file.textContent = program.file;
    file.title = program.file;
    const argsLabel = document.createElement('label');
    argsLabel.textContent = t('Startargumente · ein Argument pro Zeile, ohne Anführungszeichen');
    const args = document.createElement('textarea');
    args.rows = 2;
    args.value = program.args.join('\n');
    args.placeholder = t('Optional');
    args.oninput = () => {
      program.args = args.value.split(/\r?\n/).filter(Boolean);
    };
    argsLabel.append(args);
    const working = document.createElement('div');
    working.className = 'program-working';
    const workingPath = document.createElement('span');
    workingPath.textContent = program.workingDirectory || t('Arbeitsordner: EXE-Ordner');
    workingPath.title = program.workingDirectory || '';
    const choose = document.createElement('button');
    choose.type = 'button';
    choose.textContent = t('Ordner wählen');
    choose.onclick = async () => {
      const folder = await window.app.chooseDestination();
      if (folder) {
        program.workingDirectory = folder;
        workingPath.textContent = folder;
        workingPath.title = folder;
      }
    };
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.title = t('Arbeitsordner zurücksetzen');
    clear.textContent = '×';
    clear.onclick = () => {
      program.workingDirectory = '';
      workingPath.textContent = t('Arbeitsordner: EXE-Ordner');
      workingPath.title = '';
    };
    working.append(workingPath, choose, clear);
    card.append(top, file, argsLabel, working);
    programList.append(card);
  });
}
function renderProfile() {
  const isCustom = profile.value === 'custom';
  customEditor.hidden = !isCustom;
  profilePreview.hidden = isCustom;
  customSlotList.replaceChildren();
  profileSlotList.replaceChildren();
  if (!actionCatalog.length) return;
  const catalog = [
    ...actionCatalog,
    ...programs.map((program) => ({
      id: program.id,
      label: program.label,
      icon: 'bi-app',
      description: program.file,
    })),
  ];
  const slots = isCustom ? customSlots : profileLayouts[profile.value] || [];
  slots.forEach((id, index) => {
    const row = document.createElement('label');
    row.className = `custom-slot${isCustom ? '' : ' profile-slot'}`;
    row.style.gridArea = areas[index];
    const direction = document.createElement('span');
    direction.textContent = directions()[index];
    const icon = document.createElement('i');
    const action = catalog.find((entry) => entry.id === id);
    setActionIcon(icon, action);
    if (isCustom) {
      const select = document.createElement('select');
      select.setAttribute(
        'aria-label',
        t('Aktion für {direction}', { direction: directions()[index] }),
      );
      catalog.forEach((entry) => {
        const option = document.createElement('option');
        option.value = entry.id;
        option.textContent = entry.id.startsWith('program:') ? entry.label : t(entry.label);
        option.title = t(entry.description);
        select.append(option);
      });
      select.value = id;
      select.onchange = () => {
        customSlots[index] = select.value;
        setActionIcon(
          icon,
          catalog.find((entry) => entry.id === select.value),
        );
      };
      row.append(direction, icon, select);
      customSlotList.append(row);
    } else {
      const name = document.createElement('strong');
      name.textContent = action
        ? action.id.startsWith('program:')
          ? action.label
          : t(action.label)
        : id;
      name.title = t(action?.description || '');
      row.append(direction, icon, name);
      profileSlotList.append(row);
    }
  });
  const center = document.createElement('div');
  center.className = 'custom-center';
  center.innerHTML = `<i class="bi bi-command"></i><span>${t('Aktionsrad')}</span>`;
  (isCustom ? customSlotList : profileSlotList).append(center);
  if (isCustom) renderPrograms();
}
function renderDestinations() {
  destinationList.replaceChildren();
  destinations.forEach((folder, index) => {
    const row = document.createElement('div');
    row.className = 'destination-row';
    const icon = document.createElement('i');
    icon.className = 'bi bi-folder2';
    const label = document.createElement('span');
    label.textContent = folder;
    label.title = folder;
    const remove = document.createElement('button');
    remove.title = t('Entfernen');
    remove.innerHTML = '<i class="bi bi-x-lg"></i>';
    remove.onclick = () => {
      destinations.splice(index, 1);
      renderDestinations();
    };
    row.append(icon, label, remove);
    destinationList.append(row);
  });
}
window.app.onSettings((config) => {
  window.localize.setLanguage(config.language);
  document.getElementById('update-current-version').textContent = config.version;
  renderUpdateState(config.update || updateState);
  document.getElementById('app-version').textContent = t('Version {version}', {
    version: config.version,
  });
  languageSelect.value = config.language;
  enabled.checked = config.enabled !== false;
  hotkey.value = config.hotkey;
  document.getElementById('settings-scale').value = String(config.settingsScale || 1);
  startup.checked = config.launchAtLogin;
  pauseFullscreen.checked = config.pauseInFullscreen === true;
  profile.value = config.profiles?.active || 'default';
  profileLayouts = config.profiles?.layouts || {};
  customSlots = [...(config.profiles?.layouts?.custom || [])];
  programs = (config.profiles?.programs || []).map((program) => ({
    ...program,
    args: [...program.args],
  }));
  renderProfile();
  destinations = [...(config.destinations || [])];
  renderDestinations();
  updateActivityLabel();
  if (!initialTabShown) {
    showTab('general');
    initialTabShown = true;
  }
});
function updateActivityLabel() {
  document.getElementById('mouse-status').textContent = t(enabled.checked ? 'Aktiv' : 'Pausiert');
}
enabled.addEventListener('change', updateActivityLabel);
profile.addEventListener('change', renderProfile);
document.getElementById('settings-scale').addEventListener('change', (event) => {
  window.app.previewSettingsScale(Number(event.currentTarget.value));
});
window.app.actionCatalog().then((catalog) => {
  actionCatalog = catalog;
  renderProfile();
});
document.getElementById('add-program').onclick = async () => {
  if (programs.length >= 16) {
    showToast(t('Maximal 16 eigene Programme.'), 'error');
    return;
  }
  try {
    const program = await window.app.chooseProgram();
    if (!program) return;
    programs.push(program);
    if (program.iconUrl) programIconCache.set(program.file, Promise.resolve(program.iconUrl));
    renderProfile();
    showToast(t('Programm hinzugefügt. Radplatz wählen und speichern.'), 'info');
  } catch (error) {
    showToast(t(error.message), 'error');
  }
};
document.getElementById('import-profile').onclick = async () => {
  const result = await window.app.importProfile();
  if (result.canceled) return;
  if (result.ok) {
    customSlots = result.slots;
    programs = result.programs;
    profile.value = 'custom';
    renderProfile();
    showToast(t('Profil importiert. Zum Anwenden speichern.'), 'info');
  } else {
    showToast(t(result.error), 'error');
  }
};
document.getElementById('export-profile').onclick = async () => {
  const result = await window.app.exportProfile(customSlots, programs);
  if (result.canceled) return;
  showToast(
    result.ok ? t('Custom-Profil exportiert.') : t(result.error),
    result.ok ? 'success' : 'error',
  );
};
document.getElementById('add-destination').onclick = async () => {
  if (destinations.length >= 5) {
    showToast(t('Maximal fünf Zielordner.'), 'error');
    return;
  }
  const folder = await window.app.chooseDestination();
  if (folder && !destinations.includes(folder)) {
    destinations.push(folder);
    renderDestinations();
  }
};
document.getElementById('save').onclick = async () => {
  const result = await window.app.saveSettings({
    enabled: enabled.checked,
    hotkey: hotkey.value.trim(),
    settingsScale: Number(document.getElementById('settings-scale').value),
    launchAtLogin: startup.checked,
    pauseInFullscreen: pauseFullscreen.checked,
    language: languageSelect.value,
    profile: profile.value,
    customSlots,
    programs,
    destinations,
  });
  showToast(result.ok ? t('Gespeichert') : t(result.error), result.ok ? 'success' : 'error');
};
document.getElementById('window-minimize').onclick = () => window.app.windowControl('minimize');
document.getElementById('window-maximize').onclick = () => window.app.windowControl('maximize');
document.getElementById('window-close').onclick = () => window.app.windowControl('close');
document.querySelector('.github-link').onclick = () => window.app.openRepository();
window.app.onWindowState(({ maximized }) => {
  document.getElementById('settings-frame').classList.toggle('maximized', maximized);
  const button = document.getElementById('window-maximize');
  button.title = t(maximized ? 'Wiederherstellen' : 'Maximieren');
  button.setAttribute('aria-label', button.title);
  button.querySelector('i').className = `bi ${maximized ? 'bi-files' : 'bi-square'}`;
});
