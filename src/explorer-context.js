const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { findProjectRoot } = require('./project-context');

function isDirectory(folder) {
  try {
    return fs.statSync(folder).isDirectory();
  } catch {
    return false;
  }
}
function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function normalizeExplorerContext(value, hoverName = '', includeProject = true) {
  const rawFolder = typeof value?.folder === 'string' ? value.folder : '';
  const folder =
    path.isAbsolute(rawFolder) && isDirectory(rawFolder) ? path.resolve(rawFolder) : '';
  if (!folder) return { folder: '', selected: [], type: '', loading: false };

  const folders = [folder];
  if (
    value.desktop &&
    typeof value.publicDesktop === 'string' &&
    path.isAbsolute(value.publicDesktop) &&
    isDirectory(value.publicDesktop)
  ) {
    folders.push(path.resolve(value.publicDesktop));
  }
  const allowedFolders = new Set(folders.map((item) => item.toLowerCase()));

  const rawSelection = Array.isArray(value.selected)
    ? value.selected
    : value.selected == null
      ? []
      : [value.selected];
  const selected = [];
  const seen = new Set();
  let validSelection = true;
  for (const item of rawSelection) {
    if (typeof item !== 'string' || !path.isAbsolute(item)) {
      validSelection = false;
      break;
    }
    const target = path.resolve(item);
    if (!allowedFolders.has(path.dirname(target).toLowerCase()) || !fs.existsSync(target)) {
      validSelection = false;
      break;
    }
    const key = target.toLowerCase();
    if (!seen.has(key)) {
      selected.push(target);
      seen.add(key);
    }
  }
  if (!validSelection) selected.length = 0;

  // A real Explorer selection wins over UI Automation's name under the pointer.
  if (
    rawSelection.length === 0 &&
    typeof hoverName === 'string' &&
    hoverName &&
    hoverName !== '.' &&
    hoverName !== '..' &&
    !/[\\/:]/.test(hoverName)
  ) {
    for (const candidate of folders) {
      const target = path.join(candidate, hoverName);
      if (fs.existsSync(target)) {
        selected.push(target);
        break;
      }
    }
  }

  return {
    folder,
    desktop: Boolean(value.desktop),
    selected,
    type: selected.length === 1 ? path.extname(selected[0]).toLowerCase() : '',
    selectedIsFile: selected.length === 1 && isFile(selected[0]),
    projectRoot: includeProject ? findProjectRoot(folder) : '',
    openFolders: (Array.isArray(value.openFolders) ? value.openFolders : [value.openFolders])
      .filter((item) => typeof item === 'string' && path.isAbsolute(item) && isDirectory(item))
      .slice(0, 8),
    loading: false,
  };
}

function powershellExplorerContext(hwnd, hoverName, callback, includeProject) {
  const windowId = Number.isSafeInteger(hwnd) && hwnd > 0 ? hwnd : 0;
  const script = `$ErrorActionPreference='Stop'; $shell=New-Object -ComObject Shell.Application; $windows=@($shell.Windows()); $w=$windows | Where-Object { $_.HWND -eq [long]${windowId} } | Select-Object -First 1; if($w){$items=@($w.Document.SelectedItems() | ForEach-Object { $_.Path }); $open=@($windows | ForEach-Object { try { $_.Document.Folder.Self.Path } catch {} } | Select-Object -Unique); [pscustomobject]@{folder=$w.Document.Folder.Self.Path;selected=$items;openFolders=$open} | ConvertTo-Json -Compress -Depth 3}`;

  execFile(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 6000, maxBuffer: 1024 * 1024 },
    (error, output) => {
      let value;
      if (!error && output.trim()) {
        try {
          value = JSON.parse(output);
        } catch {
          // Invalid Shell output is treated as an unavailable context.
        }
      }
      callback(normalizeExplorerContext(value, hoverName, includeProject));
    },
  );
}

function explorerContext(hwnd, hoverName, callback, mouseBridge, includeProject = true) {
  if (typeof mouseBridge?.getExplorerContext !== 'function') {
    powershellExplorerContext(hwnd, hoverName, callback, includeProject);
    return;
  }

  mouseBridge.getExplorerContext(hwnd).then(
    (value) => callback(normalizeExplorerContext(value, hoverName, includeProject)),
    () => powershellExplorerContext(hwnd, hoverName, callback, includeProject),
  );
}

module.exports = { normalizeExplorerContext, explorerContext };
