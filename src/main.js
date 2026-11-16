const {
  app,
  BrowserWindow,
  globalShortcut,
  Tray,
  Menu,
  screen,
  ipcMain,
  clipboard,
  shell,
  dialog,
} = require('electron');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { autoUpdater } = require('electron-updater');
const fs = require('node:fs');
const path = require('node:path');
const { quickFile: transferFiles } = require('./file-actions');
const { launchProgram } = require('./program-actions');
const {
  collectSelection,
  fileHash,
  fileInfo,
  compareFiles,
  verifyFileHash,
  analyzeSelection,
  inspectFolder,
  findDuplicates,
} = require('./feature-actions');
const { renamePlan, applyRenamePlan } = require('./rename-actions');
const { orderImages, prepareForSharing, imagesToPdf } = require('./image-actions');
const { createAppDialog } = require('./app-dialog');
const { loadConfig, writeConfig, DEFAULT_HOTKEY } = require('./config');
const { dictionaries, language, translate } = require('./i18n');
const { explorerContext } = require('./explorer-context');
const { slotFromMotion } = require('./gesture');
const {
  wheelActions,
  allowedAction,
  ACTIONS,
  CUSTOM_ACTION_IDS,
  validateCustomSlots,
  validatePrograms,
} = require('./action-registry');
const { MAX_PROFILE_BYTES, exportProfile, importProfile } = require('./profile-transfer');
const bridgePath = app.isPackaged
  ? path.join(process.resourcesPath, 'native', 'mouse_bridge.node')
  : path.join(__dirname, '..', 'build', 'Release', 'mouse_bridge.node');
const mouseBridge = require(bridgePath);

ipcMain.on('translations', (event) => {
  event.returnValue = dictionaries;
});

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', openSettings);
}

let wheel;
let settingsWindow;
let tray;
let config;
let context = { folder: '', selected: [], type: '', loading: true };
let wheelRequestId = 0;
let wheelReady;
let transferInProgress = false;
let transferCancelRequested = false;
let renameInProgress = false;
let gesture = null;
const updateState = { phase: 'unconfigured', version: '', progress: 0, error: '' };
let updateTask = null;
const updateCheckFailed = 'Updateprüfung fehlgeschlagen. Bitte später erneut versuchen.';
const updateDownloadFailed = 'Download fehlgeschlagen. Bitte erneut versuchen.';

function noPublishedRelease(error) {
  return (
    error?.code === 'ERR_UPDATER_NO_PUBLISHED_VERSIONS' ||
    error?.message?.includes('No published versions on GitHub')
  );
}

function setUpdateState(phase, changes = {}) {
  Object.assign(updateState, { phase, ...changes });
  if (settingsWindow && !settingsWindow.isDestroyed() && !settingsWindow.webContents.isLoading()) {
    settingsWindow.webContents.send('update-state', { ...updateState });
  }
}

function startUpdates() {
  if (!app.isPackaged || !fs.existsSync(path.join(process.resourcesPath, 'app-update.yml'))) return;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = false;
  autoUpdater.allowPrerelease = true;
  autoUpdater.on('checking-for-update', () => setUpdateState('checking', { error: '' }));
  autoUpdater.on('update-not-available', () => setUpdateState('idle', { version: '', error: '' }));
  autoUpdater.on('update-available', (info) =>
    setUpdateState('available', { version: info.version, progress: 0, error: '' }),
  );
  autoUpdater.on('download-progress', (progress) =>
    setUpdateState('downloading', { progress: progress.percent }),
  );
  autoUpdater.on('update-downloaded', (info) =>
    setUpdateState('downloaded', { version: info.version, progress: 100, error: '' }),
  );
  autoUpdater.on('error', (error) => {
    if (noPublishedRelease(error)) {
      setUpdateState('idle', { version: '', error: '' });
      return;
    }
    const message = updateState.phase === 'downloading' ? updateDownloadFailed : updateCheckFailed;
    setUpdateState('error', { error: message });
  });
  setUpdateState('idle');
  setTimeout(() => checkForUpdates(), 10000).unref();
  setInterval(() => checkForUpdates(), 6 * 60 * 60 * 1000).unref();
}

function checkForUpdates() {
  if (updateState.phase === 'unconfigured')
    return Promise.resolve({ ok: false, error: 'Update-Prüfung noch nicht eingerichtet.' });
  if (updateTask || ['downloading', 'downloaded'].includes(updateState.phase))
    return Promise.resolve({ ok: true });
  updateTask = autoUpdater
    .checkForUpdates()
    .then(() => ({ ok: true }))
    .catch((error) => {
      if (noPublishedRelease(error)) {
        setUpdateState('idle', { version: '', error: '' });
        return { ok: true };
      }
      console.error('Update check failed:', error);
      setUpdateState('error', { error: updateCheckFailed });
      return { ok: false, error: updateCheckFailed };
    })
    .finally(() => {
      updateTask = null;
    });
  return updateTask;
}

async function updateAction(action) {
  if (action === 'check') return checkForUpdates();
  if (updateTask) return { ok: false, error: 'Update-Vorgang läuft bereits.' };
  if (action === 'download') {
    if (updateState.phase === 'error') {
      const result = await checkForUpdates();
      if (!result.ok) return result;
    }
    if (updateState.phase !== 'available')
      return { ok: false, error: 'Kein Update zum Herunterladen verfügbar.' };
    updateTask = autoUpdater
      .downloadUpdate()
      .then(() => ({ ok: true }))
      .catch((error) => {
        console.error('Update download failed:', error);
        setUpdateState('error', { error: updateDownloadFailed });
        return { ok: false, error: updateDownloadFailed };
      })
      .finally(() => {
        updateTask = null;
      });
    setUpdateState('downloading', { progress: 0, error: '' });
    return updateTask;
  }
  if (action === 'install' && updateState.phase === 'downloaded') {
    if (transferInProgress || renameInProgress)
      return { ok: false, error: 'Bitte die laufende Dateiaktion zuerst abschließen.' };
    app.isQuitting = true;
    autoUpdater.quitAndInstall(false, true);
    return { ok: true };
  }
  return { ok: false, error: 'Update ist noch nicht bereit.' };
}

const configPath = () => path.join(app.getPath('userData'), 'settings.json');
const iconPath = path.join(__dirname, '..', 'assets', 'logo-rounded.ico');
const appDialog = createAppDialog(iconPath, () => config?.language || 'en');
const programIcons = new Map();
const programIconRequests = new Map();
const tr = (key, values) => translate(config?.language || 'en', key, values);
const numberLocale = () => (config?.language === 'en' ? 'en-US' : 'de-DE');

function programIcon(file) {
  const key = file.toLowerCase();
  if (!programIconRequests.has(key)) {
    const request = (async () => {
      try {
        if (!(await fs.promises.stat(file)).isFile()) return null;
        const image = await app.getFileIcon(file, { size: 'large' });
        const url = image.isEmpty() ? null : image.toDataURL();
        if (url) programIcons.set(key, url);
        if (url && wheel && !wheel.isDestroyed() && wheel.isVisible()) {
          wheel.webContents.send('context', wheelPayload(context));
        }
        return url;
      } catch {
        return null;
      }
    })();
    programIconRequests.set(key, request);
  }
  return programIconRequests.get(key);
}

function showError(title, message) {
  return appDialog.show({
    title: tr(title),
    message: tr(message),
    type: 'error',
    parent: settingsWindow,
  });
}

function runPowerShell(script, callback) {
  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 6000, maxBuffer: 1024 * 1024 },
    (err, out) => callback(err, out),
  );
}
function showProperties(target) {
  return mouseBridge.showFileProperties(target);
}
function runAsAdmin(target) {
  const escaped = target.replaceAll("'", "''");
  return new Promise((resolve, reject) =>
    runPowerShell(`Start-Process -FilePath '${escaped}' -Verb RunAs`, (error) =>
      error ? reject(error) : resolve(),
    ),
  );
}
function wheelPayload(value) {
  const seen = new Set();
  const destinations = [
    ...config.destinations.map((folder) => ({ path: folder, kind: 'Gespeichert' })),
    ...(value.openFolders || []).map((folder) => ({ path: folder, kind: 'Offen' })),
    ...config.recentDestinations.map((folder) => ({ path: folder, kind: 'Zuletzt' })),
  ]
    .filter((entry) => {
      const key = entry.path.toLowerCase();
      if (seen.has(key)) return false;
      try {
        if (!fs.statSync(entry.path).isDirectory()) return false;
      } catch {
        return false;
      }
      seen.add(key);
      return true;
    })
    .slice(0, 12);
  return {
    ...value,
    destinations,
    language: config.language,
    actions: wheelActions(config.profiles, { ...value, destinations }).map((action) =>
      action
        ? {
            ...action,
            label: ['program', 'destination'].includes(action.category)
              ? action.label
              : translate(config.language, action.label),
            description: translate(config.language, action.description),
            reason: translate(config.language, action.reason),
            ...(action.category === 'program'
              ? { iconUrl: programIcons.get(action.file.toLowerCase()) || null }
              : {}),
          }
        : null,
    ),
  };
}
function selectedFolder() {
  if (!context.desktop || !context.selected.length) return context.folder;
  const parent = path.dirname(context.selected[0]);
  return context.selected.every((item) => path.dirname(item).toLowerCase() === parent.toLowerCase())
    ? parent
    : context.folder;
}
function createWheel() {
  wheel = new BrowserWindow({
    width: 520,
    height: 520,
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    hasShadow: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  wheelReady = wheel.loadFile(path.join(__dirname, 'wheel.html'));
  wheelReady.then(() => wheel.webContents.send('context', wheelPayload(context)));
  wheel.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape') {
      event.preventDefault();
      hideWheel();
    }
  });
  wheel.on('blur', hideWheel);
  wheel.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      hideWheel();
    }
  });
}
function updateGesture(point) {
  if (!gesture || gesture.released) return;
  gesture.index = slotFromMotion(gesture.origin, point);
  if (wheel?.isVisible() && gesture.requestId === wheelRequestId) {
    wheel.webContents.send('gesture', { kind: 'hover', index: gesture.index });
  }
}
function commitGesture() {
  if (
    !gesture?.released ||
    gesture.index < 0 ||
    gesture.requestId !== wheelRequestId ||
    !wheel?.isVisible() ||
    context.loading
  )
    return;
  const index = gesture.index;
  gesture = null;
  const action = wheelPayload(context).actions[index];
  wheel.webContents.send('gesture', {
    kind: action?.available ? 'select' : 'hover',
    index: action?.available ? index : -1,
  });
}
async function showWheel(hwnd, location, hoverName = '', gestureSequence = 0) {
  if (!config.enabled) return;
  if (gestureSequence && gesture?.sequence !== gestureSequence) return;
  if (!gestureSequence) gesture = null;
  if (typeof hwnd !== 'number') hwnd = mouseBridge.foreground();
  const requestId = ++wheelRequestId;
  if (gestureSequence) gesture.requestId = requestId;
  await wheelReady;
  if (requestId !== wheelRequestId) return;
  const point = location || screen.getCursorScreenPoint();
  const display = screen.getDisplayNearestPoint(point).workArea;
  wheel.setPosition(
    Math.max(display.x, Math.min(point.x - 260, display.x + display.width - 520)),
    Math.max(display.y, Math.min(point.y - 260, display.y + display.height - 520)),
  );
  const bounds = wheel.getBounds();
  mouseBridge.setBounds(bounds.x, bounds.y, bounds.width, bounds.height);
  mouseBridge.setVisible(true);
  context = { folder: '', selected: [], type: '', loading: true };
  wheel.setOpacity(0);
  wheel.show();
  wheel.focus();
  await wheel.webContents.executeJavaScript('window.replayWheelAnimation()');
  if (!wheel.isVisible() || requestId !== wheelRequestId) return;
  wheel.setOpacity(1);
  globalShortcut.register('Escape', hideWheel);
  wheel.webContents.send('context', wheelPayload(context));
  if (gesture?.requestId === requestId) {
    wheel.webContents.send('gesture', { kind: 'hover', index: gesture.index });
    if (gesture.released && gesture.index < 0) gesture = null;
    else commitGesture();
  }
  explorerContext(
    hwnd,
    hoverName,
    (value) => {
      if (wheel.isVisible() && requestId === wheelRequestId) {
        context = value;
        wheel.webContents.send('context', wheelPayload(value));
        commitGesture();
      }
    },
    mouseBridge,
    config.profiles.layouts[config.profiles.active]?.some(
      (id) => id === 'project-tools' || id === 'project-root',
    ) || false,
  );
}
function hideWheel() {
  gesture = null;
  if (!wheel || !wheel.isVisible()) return;
  wheelRequestId++;
  wheel.hide();
  globalShortcut.unregister('Escape');
  mouseBridge.setVisible(false);
}
function startHook() {
  mouseBridge.start((event) => {
    if (event.kind === 'press') {
      gesture = {
        sequence: event.sequence,
        origin: { x: event.x, y: event.y },
        index: -1,
        requestId: 0,
        released: false,
      };
    } else if (event.kind === 'move' && gesture?.sequence === event.sequence) {
      updateGesture({ x: event.x, y: event.y });
    } else if (event.kind === 'release' && gesture?.sequence === event.sequence) {
      updateGesture({ x: event.x, y: event.y });
      gesture.released = true;
      if (gesture.index < 0 && gesture.requestId && wheel?.isVisible()) gesture = null;
      else commitGesture();
    } else if (event.kind === 'open') {
      showWheel(event.window, { x: event.x, y: event.y }, event.name, event.sequence);
    } else if (event.kind === 'dismiss') {
      hideWheel();
    } else if (event.kind === 'error') {
      showError('Maus-Hook konnte nicht starten', event.name);
    }
  });
}
function openSettings() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }
  settingsWindow = new BrowserWindow({
    width: 980,
    height: 760,
    minWidth: 800,
    minHeight: 600,
    frame: false,
    transparent: false,
    hasShadow: true,
    show: false,
    icon: iconPath,
    title: 'WinAssistent',
    backgroundColor: '#151517',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  if (process.platform === 'win32') {
    settingsWindow.setAppDetails({
      appId: 'de.winassistent.app',
      appIconPath: app.isPackaged ? process.execPath : iconPath,
      appIconIndex: 0,
    });
  }
  settingsWindow.loadFile(path.join(__dirname, 'settings.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.webContents.on('did-finish-load', () => {
    settingsWindow.webContents.setZoomFactor(config.settingsScale || 1);
    settingsWindow.webContents.send('settings', {
      ...config,
      version: app.getVersion(),
      update: updateState,
    });
  });
  settingsWindow.on('maximize', () =>
    settingsWindow.webContents.send('window-state', { maximized: true }),
  );
  settingsWindow.on('unmaximize', () =>
    settingsWindow.webContents.send('window-state', { maximized: false }),
  );
}
function isSettingsSender(event) {
  return (
    settingsWindow && !settingsWindow.isDestroyed() && event.sender === settingsWindow.webContents
  );
}
function updateTrayMenu() {
  tray.setContextMenu(
    Menu.buildFromTemplate([
      {
        label: translate(config.language, 'Rad öffnen'),
        enabled: config.enabled,
        click: showWheel,
      },
      ...(transferInProgress
        ? [{ label: translate(config.language, 'Übertragung abbrechen'), click: cancelTransfer }]
        : []),
      {
        label: translate(
          config.language,
          config.enabled ? 'Aktionsrad pausieren' : 'Aktionsrad aktivieren',
        ),
        click: () => {
          const result = saveConfig({ ...config, enabled: !config.enabled });
          if (!result.ok) showError('Aktionsrad konnte nicht aktiviert werden', result.error);
        },
      },
      { label: translate(config.language, 'Einstellungen'), click: openSettings },
      { type: 'separator' },
      {
        label: translate(config.language, 'Beenden'),
        click: () => {
          app.isQuitting = true;
          app.quit();
        },
      },
    ]),
  );
}

function cancelTransfer() {
  if (!transferInProgress) return false;
  transferCancelRequested = true;
  mouseBridge.cancelCopy();
  return true;
}

function saveConfig(next) {
  if (config.enabled) globalShortcut.unregister(config.hotkey);
  if (!globalShortcut.register(next.hotkey, showWheel)) {
    if (config.enabled) globalShortcut.register(config.hotkey, showWheel);
    return { ok: false, error: 'Dieser Hotkey ist belegt oder ungültig.' };
  }
  if (!next.enabled) globalShortcut.unregister(next.hotkey);

  try {
    writeConfig(configPath(), next);
  } catch (error) {
    if (next.enabled) globalShortcut.unregister(next.hotkey);
    if (config.enabled) globalShortcut.register(config.hotkey, showWheel);
    return { ok: false, error: `Einstellungen konnten nicht gespeichert werden: ${error.message}` };
  }

  if (!next.enabled) hideWheel();
  mouseBridge.setEnabled(next.enabled);
  mouseBridge.setPauseInFullscreen(next.pauseInFullscreen);
  config = next;
  for (const program of config.profiles.programs) programIcon(program.file);
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.setZoomFactor(config.settingsScale);
  }
  app.setLoginItemSettings({ openAtLogin: config.launchAtLogin });
  updateTrayMenu();
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.webContents.send('settings', {
      ...config,
      version: app.getVersion(),
      update: updateState,
    });
  }
  return { ok: true };
}
async function openTarget(target) {
  if (target) {
    const error = await shell.openPath(target);
    if (error) throw new Error(error);
  }
}
async function quickFile(mode, index) {
  if (transferInProgress) throw new Error('Eine Dateiübertragung läuft bereits.');
  if (!allowedAction('quick', config.profiles, context)) {
    throw new Error('Bitte zuerst eine Datei oder einen Ordner im Explorer auswählen.');
  }
  const destinations = wheelPayload(context).destinations;
  if (!Number.isInteger(index) || index < 0 || index >= destinations.length) {
    throw new Error('Ungültiger Zielordner.');
  }
  const destination = destinations[index].path;
  const requestId = wheelRequestId;
  transferInProgress = true;
  transferCancelRequested = false;
  updateTrayMenu();
  const sendTransfer = (phase, report) => {
    if (requestId === wheelRequestId && wheel.isVisible()) {
      wheel.webContents.send('transfer', { phase, ...report });
    }
  };
  try {
    const selected = [...context.selected];
    sendTransfer('start', { total: selected.length, completed: [], failed: [] });
    const report = await transferFiles(
      mode,
      selected,
      destination,
      (progress) => sendTransfer('progress', progress),
      mouseBridge.copyFile,
      () => transferCancelRequested,
    );
    if (report.completed.length) {
      config.recentDestinations = [
        destination,
        ...config.recentDestinations.filter((x) => x.toLowerCase() !== destination.toLowerCase()),
      ].slice(0, 5);
      try {
        writeConfig(configPath(), config);
      } catch {
        // The transfer succeeded even if the recent-folder list cannot be saved.
      }
    }
    sendTransfer(report.cancelled ? 'cancelled' : 'done', report);
    if (report.failed.length && (requestId !== wheelRequestId || !wheel.isVisible())) {
      showError(
        'Schnell ablegen: Teilfehler',
        `${report.completed.length} von ${report.total} erledigt.\n\n${report.failed.map((item) => `${path.basename(item.source)}: ${item.message}`).join('\n')}`,
      );
    }
    if (!report.failed.length && !report.cancelled) {
      setTimeout(() => {
        if (requestId === wheelRequestId) hideWheel();
      }, 750);
    }
    return report.failed.length === 0 && !report.cancelled;
  } catch (error) {
    sendTransfer('error', { total: 0, completed: [], failed: [], message: error.message });
    throw error;
  } finally {
    transferInProgress = false;
    transferCancelRequested = false;
    updateTrayMenu();
  }
}
async function perform(id, payload) {
  if (typeof id !== 'string') throw new Error('Unbekannte Aktion.');
  const directDestination = /^destination:(\d+)$/.exec(id);
  if (directDestination) {
    if (config.profiles.active !== 'default' || context.loading || context.selected.length) {
      throw new Error('Diese Aktion ist hier nicht verfügbar.');
    }
    const index = Number(directDestination[1]);
    const payload = wheelPayload(context);
    const destination = payload.destinations[index];
    if (!destination || !payload.actions.some((action) => action?.id === id))
      throw new Error('Ungültiger Zielordner.');
    hideWheel();
    await openTarget(destination.path);
    return true;
  }
  if (id.startsWith('quick:')) {
    const match = /^quick:(copy|move|open):(\d+)$/.exec(id);
    if (!match) throw new Error('Unbekannte Aktion.');
    if (match[1] === 'open') {
      if (
        !allowedAction('recent-folders', config.profiles, context) &&
        !allowedAction('quick', config.profiles, context)
      ) {
        throw new Error('Diese Aktion ist hier nicht verfügbar.');
      }
      const destination = wheelPayload(context).destinations[Number(match[2])];
      if (!destination) throw new Error('Ungültiger Zielordner.');
      hideWheel();
      await openTarget(destination.path);
      return true;
    }
    return quickFile(match[1], Number(match[2]));
  }

  const submenu = /^(folders|copy|files|windows|project|gaming|images):([a-z0-9.-]+)$/.exec(id);
  if (submenu) {
    const [, group, command] = submenu;
    const parent = {
      folders: 'folders',
      copy: 'smart-copy',
      files: 'file-tools',
      windows: 'windows-tools',
      project: 'project-tools',
      gaming: 'gaming-tools',
      images: 'image-tools',
    }[group];
    if (
      !allowedAction(parent, config.profiles, context) &&
      !allowedAction(id, config.profiles, context)
    )
      throw new Error('Diese Aktion ist hier nicht verfügbar.');
    const selected = context.selected;
    const folder = context.folder;
    if (group === 'images' && command === 'share') {
      const files = [...selected];
      hideWheel();
      const created = await prepareForSharing(files, Number(payload) || 1600);
      await appDialog.show({
        type: 'success',
        title: 'Fürs Teilen vorbereitet',
        message: tr('{count} Bilder erstellt', { count: created.length }),
        detail: created.join('\n'),
      });
    } else if (group === 'images' && command === 'pdf') {
      const files = orderImages(selected, payload?.order);
      hideWheel();
      const created = await imagesToPdf(files);
      await appDialog.show({
        type: 'success',
        title: 'PDF erstellt',
        message: path.basename(created),
        detail: created,
      });
    } else if (group === 'folders' && command === 'collect') {
      await collectSelection(
        selectedFolder(),
        selected,
        payload,
        config.language === 'en' ? 'Selection' : 'Auswahl',
      );
    } else if (group === 'copy' && command === 'name') {
      clipboard.writeText(
        (selected.length ? selected : [folder]).map((x) => path.basename(x)).join('\n'),
      );
    } else if (group === 'copy' && command === 'path') {
      clipboard.writeText(selected[0] || folder);
    } else if (group === 'copy' && command === 'paths') {
      clipboard.writeText((selected.length ? selected : [folder]).join('\n'));
    } else if (group === 'copy' && command === 'info') {
      clipboard.writeText(await fileInfo(selected, folder));
    } else if (group === 'files' && command === 'hash') {
      if (selected.length !== 1) throw new Error('Bitte genau eine Datei auswählen.');
      clipboard.writeText(await fileHash(selected[0]));
    } else if (group === 'files' && command === 'verify-hash') {
      if (selected.length !== 1) throw new Error('Bitte genau eine Datei auswählen.');
      const result = await verifyFileHash(selected[0], payload);
      hideWheel();
      await appDialog.show({
        type: result.matches ? 'success' : 'warning',
        title: 'SHA-256 prüfen',
        message: result.matches ? 'Prüfsumme stimmt überein' : 'Prüfsumme stimmt nicht überein',
        detail: `${path.basename(selected[0])}\n\n${tr('Erwartet:')}\n${result.expected}\n\n${tr('Berechnet:')}\n${result.actual}`,
      });
    } else if (group === 'files' && command === 'compare') {
      const result = await compareFiles(selected);
      hideWheel();
      await appDialog.show({
        type: 'info',
        title: 'Dateien vergleichen',
        message: result.identical
          ? 'Dateien sind inhaltlich identisch'
          : 'Dateien unterscheiden sich',
        detail: result.files
          .map(
            (file, index) =>
              `${path.basename(file)}\n${file}\n${result.sizes[index].toLocaleString(numberLocale())} ${tr('Bytes')} · ${tr('Geändert:')} ${result.modified[index].toLocaleString(numberLocale())}\nSHA-256: ${result.hashes[index]}`,
          )
          .join('\n\n'),
      });
    } else if (group === 'files' && command === 'size') {
      if (!selected.length)
        throw new Error('Bitte mindestens eine Datei oder einen Ordner auswählen.');
      hideWheel();
      const result = await analyzeSelection(selected);
      const bytes = result.bytes.toLocaleString(numberLocale());
      const readable = (
        result.bytes /
        1024 ** (result.bytes >= 1024 ** 3 ? 3 : result.bytes >= 1024 ** 2 ? 2 : 1)
      ).toLocaleString(numberLocale(), { maximumFractionDigits: 2 });
      const unit = result.bytes >= 1024 ** 3 ? 'GB' : result.bytes >= 1024 ** 2 ? 'MB' : 'KB';
      await appDialog.show({
        type: result.unreadable ? 'warning' : 'info',
        title: 'Größe der Auswahl',
        message: result.bytes < 1024 ? `${bytes} Bytes` : `${readable} ${unit}`,
        detail: `${tr('{count} ausgewählt', { count: selected.length })} · ${tr('{count} Dateien', { count: result.files.toLocaleString(numberLocale()) })} · ${tr('{count} Ordner', { count: result.folders.toLocaleString(numberLocale()) })}\n${bytes} ${tr('Bytes')}${result.links ? `\n${tr('{count} Verknüpfungen wurden nicht verfolgt.', { count: result.links })}` : ''}${result.unreadable ? `\n${tr('{count} Einträge konnten nicht gelesen werden. Die Größe ist unvollständig.', { count: result.unreadable })}` : ''}`,
      });
    } else if (group === 'files' && command === 'duplicates') {
      if (!selected.length) throw new Error('Bitte Dateien oder Ordner auswählen.');
      hideWheel();
      const result = await findDuplicates(selected);
      const visible = result.groups.slice(0, 10);
      const detail = visible
        .map(
          (group) =>
            `${group.files.length} × ${group.size.toLocaleString(numberLocale())} ${tr('Bytes')}\n${group.files.slice(0, 5).join('\n')}${group.files.length > 5 ? `\n${tr('… und {count} weitere', { count: group.files.length - 5 })}` : ''}`,
        )
        .join('\n\n');
      await appDialog.show({
        type: result.unreadable || result.capped ? 'warning' : 'info',
        title: 'Duplikate finden',
        message: result.groups.length
          ? tr(
              result.groups.length === 1
                ? '{count} Gruppe mit identischem Inhalt'
                : '{count} Gruppen mit identischem Inhalt',
              { count: result.groups.length },
            )
          : tr('Keine Duplikate gefunden'),
        detail: `${tr('{count} Dateien geprüft.', { count: result.scanned.toLocaleString(numberLocale()) })}${result.capped ? `\n${tr('Die Suche wurde nach 5.000 Dateien begrenzt.')}` : ''}${result.unreadable ? `\n${tr('{count} Einträge konnten nicht gelesen werden.', { count: result.unreadable })}` : ''}${detail ? `\n\n${detail}` : ''}${result.groups.length > visible.length ? `\n\n${tr('… und {count} weitere Gruppen', { count: result.groups.length - visible.length })}` : ''}`,
      });
    } else if (group === 'files' && command === 'locks') {
      if (selected.length !== 1 || !(await fs.promises.stat(selected[0])).isFile()) {
        throw new Error('Bitte genau eine Datei auswählen.');
      }
      hideWheel();
      const users = await mouseBridge.checkFileUsers(selected[0]);
      const list = users
        .slice(0, 16)
        .map(
          (user) =>
            `${user.name || tr('Unbekannter Prozess')} · PID ${user.pid}${user.service ? ` · ${tr('Dienst')}` : ''}`,
        )
        .join('\n');
      await appDialog.show({
        type: users.length ? 'warning' : 'info',
        title: 'Dateisperre prüfen',
        message: users.length
          ? tr(
              users.length === 1
                ? '{count} Prozess verwendet die Datei.'
                : '{count} Prozesse verwenden die Datei.',
              { count: users.length },
            )
          : tr('Kein verwendender Prozess gefunden.'),
        detail: `${selected[0]}\n\n${list || tr('Windows meldet derzeit keinen Prozess. Kurzzeitige oder nicht erkannte Sperren sind weiterhin möglich.')}${users.length > 16 ? `\n${tr('… und {count} weitere', { count: users.length - 16 })}` : ''}`,
      });
    } else if (group === 'files' && command === 'properties') {
      hideWheel();
      await showProperties(selected[0] || folder);
    } else if (group === 'files' && command === 'admin') {
      if (selected.length !== 1 || path.extname(selected[0]).toLowerCase() !== '.exe')
        throw new Error('Bitte eine EXE auswählen.');
      await runAsAdmin(selected[0]);
    } else if (
      group === 'windows' &&
      ['devmgmt.msc', 'services.msc', 'eventvwr.msc', 'msinfo32.exe'].includes(command)
    ) {
      const error = await shell.openPath(
        path.join(process.env.WINDIR || 'C:\\Windows', 'System32', command),
      );
      if (error) throw new Error(error);
    } else if (group === 'project' && context.projectRoot) {
      if (command === 'terminal') {
        hideWheel();
        mouseBridge.openTerminal(context.projectRoot);
        return true;
      }
      if (command === 'copy-root') clipboard.writeText(context.projectRoot);
      else if (command === 'copy-relative')
        clipboard.writeText(path.relative(context.projectRoot, selected[0] || folder) || '.');
      else throw new Error('Unbekannte Aktion.');
    } else if (group === 'gaming') {
      const pages = {
        'game-mode': 'ms-settings:gaming-gamemode',
        'game-bar': 'ms-settings:gaming-gamebar',
        captures: 'ms-settings:gaming-gamedvr',
      };
      if (pages[command]) await shell.openExternal(pages[command]);
      else if (command === 'resource-monitor')
        await openTarget(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'resmon.exe'));
      else throw new Error('Unbekannte Aktion.');
    } else {
      throw new Error('Unbekannte Aktion.');
    }
    hideWheel();
    return true;
  }

  if (!allowedAction(id, config.profiles, context) || id === 'quick') {
    throw new Error('Diese Aktion ist im aktuellen Kontext nicht verfügbar.');
  }

  if (id.startsWith('program:')) {
    const program = config.profiles.programs.find((item) => item.id === id);
    if (!program) throw new Error('Dieses Programm ist nicht mehr eingerichtet.');
    await launchProgram(program);
    hideWheel();
    return true;
  }

  const folder = context.folder;
  const selected = context.selected;
  if (id === 'copy-path') clipboard.writeText(selected[0] || folder);
  if (id === 'copy-names')
    clipboard.writeText(selected.map((x) => path.basename(x)).join('\n') || path.basename(folder));
  if (id === 'terminal') {
    hideWheel();
    mouseBridge.openTerminal(folder || app.getPath('home'));
    return true;
  }
  if (id === 'folder-insights') {
    hideWheel();
    const result = await inspectFolder(folder);
    const unit = result.bytes >= 1024 ** 3 ? 'GB' : result.bytes >= 1024 ** 2 ? 'MB' : 'KB';
    const divisor = unit === 'GB' ? 1024 ** 3 : unit === 'MB' ? 1024 ** 2 : 1024;
    const size =
      result.bytes < 1024
        ? `${result.bytes.toLocaleString(numberLocale())} B`
        : `${(result.bytes / divisor).toLocaleString(numberLocale(), { maximumFractionDigits: 1 })} ${unit}`;
    const largest = result.largest.map(
      (item, index) =>
        `${index + 1}. ${path.relative(folder, item.path)} · ${item.bytes.toLocaleString(numberLocale())} ${tr('Bytes')}`,
    );
    await appDialog.show({
      type: result.capped || result.unreadable ? 'warning' : 'info',
      title: 'Ordner-Check',
      message: `${size} · ${tr('{count} Dateien', { count: result.files.toLocaleString(numberLocale()) })}`,
      detail: [
        folder,
        `${tr('{count} Ordner', { count: result.folders.toLocaleString(numberLocale()) })}${result.links ? ` · ${tr('{count} Verknüpfungen wurden nicht verfolgt.', { count: result.links })}` : ''}`,
        result.capped
          ? tr(
              'Die Auswertung wurde nach 3.000 Einträgen begrenzt. Angaben können unvollständig sein.',
            )
          : '',
        result.unreadable
          ? tr('{count} Einträge konnten nicht gelesen werden. Die Größe ist unvollständig.', {
              count: result.unreadable,
            })
          : '',
        largest.length
          ? `${tr('Größte Dateien')}\n${largest.join('\n')}`
          : tr('Keine Dateien gefunden.'),
      ]
        .filter(Boolean)
        .join('\n\n'),
    });
    return true;
  }
  if (id === 'open-folder') await openTarget(folder);
  if (id === 'project-root') await openTarget(context.projectRoot);
  if (id === 'task-manager')
    await openTarget(path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'Taskmgr.exe'));
  if (id === 'properties') {
    hideWheel();
    await showProperties(selected[0] || folder);
  }
  if (id === 'settings') openSettings();
  if (
    id === 'run-admin' &&
    selected.length === 1 &&
    path.extname(selected[0]).toLowerCase() === '.exe'
  ) {
    await runAsAdmin(selected[0]);
  }
  hideWheel();
  return true;
}
if (hasSingleInstanceLock)
  app.whenReady().then(() => {
    app.setAppUserModelId('de.winassistent.app');
    config = loadConfig(configPath(), [
      app.getPath('downloads'),
      app.getPath('documents'),
      app.getPath('desktop'),
    ]);
    createWheel();
    for (const program of config.profiles.programs) programIcon(program.file);
    startHook();
    mouseBridge.setEnabled(config.enabled);
    mouseBridge.setPauseInFullscreen(config.pauseInFullscreen);
    tray = new Tray(iconPath);
    tray.setToolTip('WinAssistent');
    updateTrayMenu();
    startUpdates();
    tray.on('double-click', openSettings);
    if (config.enabled && !globalShortcut.register(config.hotkey, showWheel))
      showError(
        'Hotkey belegt',
        `${config.hotkey} ist bereits in Verwendung. Bitte in den Einstellungen ändern.`,
      );
    app.setLoginItemSettings({ openAtLogin: config.launchAtLogin });
    ipcMain.on('close-wheel', (event) => {
      if (event.sender === wheel.webContents) hideWheel();
    });
    ipcMain.handle('cancel-transfer', (event) => {
      if (event.sender !== wheel.webContents) return false;
      return cancelTransfer();
    });
    ipcMain.handle('preview-settings-scale', (event, value) => {
      if (!isSettingsSender(event) || ![1, 1.15, 1.3].includes(value)) return false;
      settingsWindow.webContents.setZoomFactor(value);
      return true;
    });
    ipcMain.handle('window-control', (event, action) => {
      if (
        !settingsWindow ||
        settingsWindow.isDestroyed() ||
        event.sender !== settingsWindow.webContents
      )
        return false;
      if (action === 'minimize') settingsWindow.minimize();
      else if (action === 'maximize')
        settingsWindow.isMaximized() ? settingsWindow.unmaximize() : settingsWindow.maximize();
      else if (action === 'close') settingsWindow.close();
      else return false;
      return true;
    });
    ipcMain.handle('update-action', (event, action) => {
      if (!isSettingsSender(event) || !['check', 'download', 'install'].includes(action))
        return { ok: false };
      return updateAction(action);
    });
    ipcMain.handle('open-repository', (event) => {
      if (!isSettingsSender(event)) return false;
      return shell.openExternal('https://github.com/mambuzrrr/WinAssistent');
    });
    ipcMain.handle('choose-destination', async (event) => {
      if (!isSettingsSender(event)) return null;
      const result = await dialog.showOpenDialog(settingsWindow, { properties: ['openDirectory'] });
      return result.canceled ? null : result.filePaths[0];
    });
    ipcMain.handle('choose-program', async (event) => {
      if (!isSettingsSender(event)) return null;
      const result = await dialog.showOpenDialog(settingsWindow, {
        properties: ['openFile'],
        filters: [{ name: 'Windows-Programme', extensions: ['exe'] }],
      });
      if (result.canceled || !result.filePaths.length) return null;
      const file = result.filePaths[0];
      if (path.extname(file).toLowerCase() !== '.exe' || !fs.statSync(file).isFile()) {
        throw new Error('Bitte eine gültige .exe-Datei wählen.');
      }
      return {
        id: `program:${randomUUID()}`,
        label: path.parse(file).name.slice(0, 24),
        file,
        args: [],
        workingDirectory: '',
        iconUrl: await programIcon(file),
      };
    });
    ipcMain.handle('program-icon', (event, file) => {
      if (
        !isSettingsSender(event) ||
        typeof file !== 'string' ||
        !path.isAbsolute(file) ||
        path.extname(file).toLowerCase() !== '.exe'
      )
        return null;
      return programIcon(file);
    });
    ipcMain.handle('action-catalog', (event) => {
      if (!isSettingsSender(event)) return [];
      return CUSTOM_ACTION_IDS.map((id) => ({
        id,
        label: ACTIONS[id].label,
        icon: ACTIONS[id].icon,
        description: ACTIONS[id].description,
      }));
    });
    ipcMain.handle('export-profile', async (event, slots, programs) => {
      if (!isSettingsSender(event))
        return { ok: false, error: 'Nur in den Einstellungen verfügbar.' };
      try {
        const content = exportProfile(slots, programs);
        const choice = await dialog.showSaveDialog(settingsWindow, {
          defaultPath: path.join(app.getPath('documents'), 'WinAssistent-Profil.json'),
          filters: [{ name: 'JSON-Profil', extensions: ['json'] }],
        });
        if (choice.canceled || !choice.filePath) return { ok: false, canceled: true };
        await fs.promises.writeFile(choice.filePath, content, 'utf8');
        return { ok: true };
      } catch (error) {
        return { ok: false, error: `Profil konnte nicht exportiert werden: ${error.message}` };
      }
    });
    ipcMain.handle('import-profile', async (event) => {
      if (!isSettingsSender(event))
        return { ok: false, error: 'Nur in den Einstellungen verfügbar.' };
      try {
        const choice = await dialog.showOpenDialog(settingsWindow, {
          properties: ['openFile'],
          filters: [{ name: 'JSON-Profil', extensions: ['json'] }],
        });
        if (choice.canceled || !choice.filePaths.length) return { ok: false, canceled: true };
        const file = choice.filePaths[0];
        if ((await fs.promises.stat(file)).size > MAX_PROFILE_BYTES) {
          throw new Error('Die Profildatei ist zu groß.');
        }
        return { ok: true, ...importProfile(await fs.promises.readFile(file, 'utf8')) };
      } catch (error) {
        return { ok: false, error: `Profil konnte nicht importiert werden: ${error.message}` };
      }
    });
    ipcMain.handle('action', async (event, id, payload) => {
      if (event.sender !== wheel.webContents) return false;
      try {
        return await perform(id, payload);
      } catch (error) {
        hideWheel();
        showError('Aktion fehlgeschlagen', error.message);
        return false;
      }
    });
    ipcMain.handle('rename-preview', async (event, options) => {
      if (
        event.sender !== wheel.webContents ||
        (!allowedAction('file-tools', config.profiles, context) &&
          !allowedAction('bulk-rename', config.profiles, context))
      )
        return { ok: false, error: 'Dateiaktionen sind hier nicht verfügbar.' };
      try {
        return { ok: true, items: await renamePlan(selectedFolder(), context.selected, options) };
      } catch (error) {
        return { ok: false, error: error.message };
      }
    });
    ipcMain.handle('rename-apply', async (event, options, expected) => {
      if (
        event.sender !== wheel.webContents ||
        (!allowedAction('file-tools', config.profiles, context) &&
          !allowedAction('bulk-rename', config.profiles, context))
      )
        return { ok: false, error: 'Dateiaktionen sind hier nicht verfügbar.' };
      if (renameInProgress) return { ok: false, error: 'Eine Umbenennung läuft bereits.' };
      renameInProgress = true;
      try {
        const folder = selectedFolder();
        const items = await renamePlan(folder, context.selected, options);
        if (JSON.stringify(items) !== JSON.stringify(expected)) {
          throw new Error('Die Vorschau ist nicht mehr aktuell. Bitte erneut prüfen.');
        }
        const count = applyRenamePlan(folder, items, mouseBridge.moveFileExclusive);
        hideWheel();
        return { ok: true, count };
      } catch (error) {
        return { ok: false, error: error.message };
      } finally {
        renameInProgress = false;
      }
    });
    ipcMain.handle('save-settings', (event, value) => {
      if (!isSettingsSender(event) || !value || typeof value !== 'object') {
        return { ok: false, error: 'Einstellungen können hier nicht geändert werden.' };
      }
      let customSlots;
      let programs;
      try {
        programs = validatePrograms(value.programs);
        customSlots = validateCustomSlots(value.customSlots, programs);
      } catch (error) {
        return { ok: false, error: error.message };
      }
      const next = {
        ...config,
        enabled: value.enabled !== false,
        hotkey: String(value.hotkey || DEFAULT_HOTKEY),
        launchAtLogin: !!value.launchAtLogin,
        pauseInFullscreen: value.pauseInFullscreen === true,
        language: language(value.language),
        settingsScale: [1, 1.15, 1.3].includes(value.settingsScale) ? value.settingsScale : 1,
        profiles: {
          ...config.profiles,
          layouts: { ...config.profiles.layouts, custom: customSlots },
          programs,
          active: ['default', 'developer', 'gamer', 'custom'].includes(value.profile)
            ? value.profile
            : config.profiles.active,
        },
        destinations: Array.isArray(value.destinations)
          ? value.destinations
              .filter((x) => {
                try {
                  return (
                    typeof x === 'string' && path.isAbsolute(x) && fs.statSync(x).isDirectory()
                  );
                } catch {
                  return false;
                }
              })
              .slice(0, 5)
          : config.destinations,
      };
      return saveConfig(next);
    });
  });
app.on('window-all-closed', () => {});
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  mouseBridge.stop();
});
