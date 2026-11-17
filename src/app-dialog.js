const path = require('node:path');
const { BrowserWindow, ipcMain } = require('electron');

function createAppDialog(iconPath, getLanguage = () => 'en') {
  const queue = [];
  let active = null;

  function next() {
    if (active || !queue.length) return;
    const request = queue.shift();
    const parent =
      request.parent && !request.parent.isDestroyed() && request.parent.isVisible()
        ? request.parent
        : undefined;
    const window = new BrowserWindow({
      width: request.choices.length ? 620 : 480,
      height: request.choices.length ? 540 : 380,
      frame: false,
      transparent: true,
      resizable: false,
      show: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: true,
      icon: iconPath,
      parent,
      modal: Boolean(parent),
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    active = {
      window,
      resolve: request.resolve,
      cancel: request.buttons.length - 1,
      choices: request.choices,
    };
    window.on('closed', () => {
      const finished = active;
      active = null;
      finished.resolve(finished.result ?? finished.cancel);
      next();
    });
    window.webContents.on('did-finish-load', () => {
      window.webContents.send('app-dialog', {
        language: getLanguage(),
        title: request.title,
        message: request.message,
        detail: request.detail,
        type: request.type,
        buttons: request.buttons,
        choices: request.choices,
      });
      window.show();
      window.focus();
    });
    window.loadFile(path.join(__dirname, 'dialog.html')).catch(() => window.close());
  }

  ipcMain.on('app-dialog-close', (event, index, selected) => {
    if (!active || event.sender !== active.window.webContents) return;
    if (Number.isInteger(index) && index >= 0 && index <= active.cancel) {
      active.result = active.choices.length
        ? {
            button: index,
            selected: Array.isArray(selected)
              ? selected.filter((id) => active.choices.some((choice) => choice.id === id))
              : [],
          }
        : index;
    }
    active.window.close();
  });

  function show({
    title,
    message,
    detail = '',
    type = 'info',
    buttons = ['OK'],
    choices = [],
    parent,
  } = {}) {
    return new Promise((resolve) => {
      queue.push({
        title: String(title || 'WinAssistent'),
        message: String(message || ''),
        detail: String(detail || ''),
        type: ['info', 'error', 'warning', 'success'].includes(type) ? type : 'info',
        buttons: Array.isArray(buttons) && buttons.length && buttons.length <= 2 ? buttons : ['OK'],
        choices: Array.isArray(choices)
          ? choices
              .filter(
                (choice) => typeof choice?.id === 'string' && typeof choice?.label === 'string',
              )
              .slice(0, 3000)
          : [],
        parent,
        resolve,
      });
      next();
    });
  }

  return { show };
}

module.exports = { createAppDialog };
