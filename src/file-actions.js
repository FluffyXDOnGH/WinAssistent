const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');

function throwIfCancelled(shouldCancel) {
  if (shouldCancel()) {
    const error = new Error('Übertragung abgebrochen.');
    error.code = 'TRANSFER_CANCELLED';
    throw error;
  }
}

function isCancelled(error) {
  return error.code === 'TRANSFER_CANCELLED' || error.message === 'TRANSFER_CANCELLED';
}

function uniqueTarget(destination, name, reserved = new Set()) {
  let target = path.join(destination, name);
  const parsed = path.parse(name);
  for (let number = 2; fs.existsSync(target) || reserved.has(target.toLowerCase()); number++) {
    target = path.join(destination, `${parsed.name} (${number})${parsed.ext}`);
  }
  reserved.add(target.toLowerCase());
  return target;
}

async function measureBytes(source, shouldCancel) {
  throwIfCancelled(shouldCancel);
  const stat = await fs.promises.lstat(source);
  if (stat.isFile()) return stat.size;
  if (!stat.isDirectory()) return 0;
  let total = 0;
  for (const name of await fs.promises.readdir(source)) {
    total += await measureBytes(path.join(source, name), shouldCancel);
  }
  return total;
}

async function copyTree(source, target, onBytes, nativeCopy, shouldCancel) {
  throwIfCancelled(shouldCancel);
  const stat = await fs.promises.lstat(source);
  if (stat.isDirectory()) {
    await fs.promises.mkdir(target);
    for (const name of await fs.promises.readdir(source)) {
      await copyTree(
        path.join(source, name),
        path.join(target, name),
        onBytes,
        nativeCopy,
        shouldCancel,
      );
    }
  } else if (stat.isFile()) {
    if (nativeCopy) {
      let transferred = 0;
      let accepting = true;
      try {
        await nativeCopy(source, target, (absolute) => {
          if (!accepting) return;
          const next = Math.min(stat.size, Math.max(transferred, absolute));
          onBytes(next - transferred);
          transferred = next;
        });
        throwIfCancelled(shouldCancel);
        onBytes(stat.size - transferred);
      } finally {
        accepting = false;
      }
    } else {
      const reader = fs.createReadStream(source);
      const writer = fs.createWriteStream(target, { flags: 'wx', mode: stat.mode });
      reader.on('data', (chunk) => onBytes(chunk.length));
      await pipeline(reader, writer);
      throwIfCancelled(shouldCancel);
    }
  } else if (stat.isSymbolicLink()) {
    await fs.promises.cp(source, target, { force: false, errorOnExist: true });
    throwIfCancelled(shouldCancel);
  } else {
    throw new Error(`Dieser Dateityp kann nicht kopiert werden: ${source}`);
  }
  if (!stat.isSymbolicLink()) {
    try {
      await fs.promises.utimes(target, stat.atime, stat.mtime);
    } catch {
      // Some network destinations do not allow changing timestamps.
    }
  }
}

async function copyItem(source, target, onBytes, nativeCopy, shouldCancel) {
  throwIfCancelled(shouldCancel);
  const staging = await fs.promises.mkdtemp(path.join(path.dirname(target), '.winassistent-'));
  let committed = false;
  let copyError;
  try {
    const stagedTarget = path.join(staging, path.basename(target));
    await copyTree(source, stagedTarget, onBytes, nativeCopy, shouldCancel);
    throwIfCancelled(shouldCancel);
    if (fs.existsSync(target)) throw new Error(`Im Ziel existiert bereits: ${target}`);
    await fs.promises.rename(stagedTarget, target);
    committed = true;
  } catch (error) {
    copyError = error;
    throw error;
  } finally {
    try {
      await fs.promises.rm(staging, { recursive: true, force: true });
    } catch (cleanupError) {
      if (!committed) {
        throw new Error(
          `${copyError?.message || 'Kopieren fehlgeschlagen'}; temporäre Kopie konnte nicht entfernt werden: ${cleanupError.message}`,
        );
      }
    }
  }
}

async function moveItem(source, target, onBytes, nativeCopy, shouldCancel) {
  throwIfCancelled(shouldCancel);
  try {
    await fs.promises.rename(source, target);
    return false;
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await copyItem(source, target, onBytes, nativeCopy, shouldCancel);
    try {
      await fs.promises.rm(source, { recursive: true });
    } catch (removeError) {
      throw new Error(
        `Kopie liegt im Ziel, aber die Quelle konnte nicht vollständig entfernt werden: ${removeError.message}`,
      );
    }
    return true;
  }
}

async function quickFile(
  mode,
  selected,
  destination,
  onProgress = () => {},
  nativeCopy = null,
  shouldCancel = () => false,
) {
  if (!['copy', 'move'].includes(mode)) throw new Error('Unbekannte Aktion.');
  let destinationStat;
  try {
    destinationStat = await fs.promises.stat(destination);
  } catch {
    throw new Error('Zielordner nicht gefunden. Bitte in den Einstellungen prüfen.');
  }
  if (!destinationStat.isDirectory()) throw new Error('Der Zielpfad ist kein Ordner.');
  if (!selected.length) throw new Error('Bitte zuerst eine Datei oder einen Ordner auswählen.');

  const report = {
    total: selected.length,
    completed: [],
    failed: [],
    totalBytes: 0,
    bytesDone: 0,
    cancelled: false,
  };
  const destinationPath = path.resolve(destination).toLowerCase();
  const reserved = new Set();
  const items = [];
  onProgress({ ...report, state: 'scanning' });
  for (const source of selected) {
    try {
      throwIfCancelled(shouldCancel);
      const sourcePath = path.resolve(source).toLowerCase();
      if (sourcePath === destinationPath || destinationPath.startsWith(sourcePath + path.sep)) {
        throw new Error('Ein Ordner kann nicht in sich selbst abgelegt werden.');
      }
      const bytes = await measureBytes(source, shouldCancel);
      report.totalBytes += bytes;
      items.push({ source, bytes });
    } catch (error) {
      if (isCancelled(error)) {
        report.cancelled = true;
        break;
      }
      report.failed.push({ source, message: error.message });
    }
    onProgress({ ...report, current: path.basename(source), state: 'scanning' });
  }

  let completedBytes = 0;
  for (const { source, bytes } of items) {
    if (report.cancelled || shouldCancel()) {
      report.cancelled = true;
      break;
    }
    const name = path.basename(source);
    let currentBytes = 0;
    let lastUpdate = 0;
    const update = (state) =>
      onProgress({
        ...report,
        bytesDone: completedBytes + currentBytes,
        current: name,
        currentBytes,
        currentTotalBytes: bytes,
        state,
      });
    const onBytes = (count) => {
      if (count <= 0) return;
      currentBytes += count;
      const now = Date.now();
      if (now - lastUpdate >= 80) {
        update('working');
        lastUpdate = now;
      }
    };
    update('working');
    try {
      const target = uniqueTarget(destination, name, reserved);
      let copied;
      if (mode === 'copy') {
        await copyItem(source, target, onBytes, nativeCopy, shouldCancel);
        copied = true;
      } else {
        copied = await moveItem(source, target, onBytes, nativeCopy, shouldCancel);
      }
      completedBytes += copied ? currentBytes : bytes;
      currentBytes = 0;
      report.completed.push(target);
    } catch (error) {
      currentBytes = 0;
      if (isCancelled(error)) {
        report.cancelled = true;
        break;
      }
      report.failed.push({ source, message: error.message });
    }
    report.bytesDone = completedBytes;
    update('settled');
  }
  return report;
}

module.exports = { uniqueTarget, quickFile };
