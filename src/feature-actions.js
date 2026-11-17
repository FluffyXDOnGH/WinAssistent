const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function collectionFolderName(folder, baseName) {
  let name = baseName;
  for (let number = 2; fs.existsSync(path.join(folder, name)); number++) {
    name = `${baseName} (${number})`;
  }
  return name;
}

function checkedFolderName(value) {
  const name = String(value || '').trim();
  if (
    !name ||
    name === '.' ||
    name === '..' ||
    /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
    /[. ]$/.test(name) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  ) {
    throw new Error('Bitte einen gültigen Windows-Ordnernamen eingeben.');
  }
  return name;
}

async function collectSelection(folder, selected, proposedName, defaultName = 'Auswahl') {
  if (!selected.length) throw new Error('Bitte zuerst Dateien oder Ordner auswählen.');
  const name = checkedFolderName(proposedName || collectionFolderName(folder, defaultName));
  const destination = path.join(folder, name);
  if (fs.existsSync(destination)) throw new Error('Ein Ordner mit diesem Namen existiert bereits.');
  if (selected.some((item) => path.dirname(item).toLowerCase() !== folder.toLowerCase())) {
    throw new Error('Die Auswahl gehört nicht zum aktuellen Ordner.');
  }
  await fs.promises.mkdir(destination);
  const moved = [];
  try {
    for (const source of selected) {
      await fs.promises.rename(source, path.join(destination, path.basename(source)));
      moved.push(source);
    }
  } catch (error) {
    for (const source of moved.reverse()) {
      try {
        await fs.promises.rename(path.join(destination, path.basename(source)), source);
      } catch {
        /* Preserve remaining files. */
      }
    }
    try {
      await fs.promises.rmdir(destination);
    } catch {
      /* Preserve remaining files. */
    }
    throw new Error(`Auswahl konnte nicht vollständig verschoben werden: ${error.message}`);
  }
  return destination;
}

async function fileHash(file) {
  if (!(await fs.promises.stat(file)).isFile())
    throw new Error('SHA-256 ist nur für eine Datei verfügbar.');
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function fileInfo(files, folder) {
  const targets = files.length ? files : [folder];
  const lines = [];
  for (const target of targets) {
    const stat = await fs.promises.stat(target);
    lines.push(
      `${path.basename(target)}\nPfad: ${target}\nTyp: ${stat.isDirectory() ? 'Ordner' : 'Datei'}${stat.isFile() ? `\nGröße: ${stat.size.toLocaleString('de-DE')} Bytes` : ''}\nGeändert: ${stat.mtime.toLocaleString('de-DE')}`,
    );
  }
  return lines.join('\n\n');
}

async function compareFiles(files) {
  if (
    !Array.isArray(files) ||
    files.length !== 2 ||
    files.some((file) => typeof file !== 'string') ||
    path.resolve(files[0]).toLowerCase() === path.resolve(files[1]).toLowerCase()
  ) {
    throw new Error('Bitte genau zwei verschiedene Dateien auswählen.');
  }
  const stats = await Promise.all(files.map((file) => fs.promises.stat(file)));
  if (stats.some((stat) => !stat.isFile())) {
    throw new Error('Der Vergleich funktioniert nur mit zwei Dateien.');
  }
  const sameSize = stats[0].size === stats[1].size;
  const hashes = await Promise.all(files.map(fileHash));
  return {
    files,
    sizes: stats.map((stat) => stat.size),
    modified: stats.map((stat) => stat.mtime),
    hashes,
    identical: sameSize && hashes[0] === hashes[1],
  };
}

function comparablePairKind(items) {
  if (!Array.isArray(items) || items.length !== 2) return '';
  try {
    const stats = items.map((item) => fs.lstatSync(item));
    if (stats.every((stat) => stat.isFile())) return 'files';
    if (stats.every((stat) => stat.isDirectory())) return 'folders';
  } catch {
    // The selection may have changed since Explorer reported it.
  }
  return '';
}

async function scanFolderForComparison(root, limit) {
  const entries = new Map();
  const pending = [''];
  let capped = false;
  let unreadable = 0;
  let links = 0;
  while (pending.length && !capped) {
    const relative = pending.pop();
    let children;
    try {
      children = await fs.promises.readdir(path.join(root, relative), { withFileTypes: true });
    } catch {
      unreadable++;
      continue;
    }
    children.sort((a, b) => a.name.localeCompare(b.name));
    for (const child of children) {
      if (entries.size >= limit) {
        capped = true;
        break;
      }
      const childRelative = path.join(relative, child.name);
      let stat;
      try {
        stat = await fs.promises.lstat(path.join(root, childRelative));
      } catch {
        unreadable++;
        continue;
      }
      if (stat.isSymbolicLink()) {
        links++;
        continue;
      }
      if (stat.isDirectory()) {
        entries.set(childRelative.toLowerCase(), {
          relative: childRelative,
          kind: 'directory',
        });
        pending.push(childRelative);
      } else if (stat.isFile()) {
        entries.set(childRelative.toLowerCase(), {
          relative: childRelative,
          kind: 'file',
          size: stat.size,
        });
      }
    }
  }
  return { entries, capped, unreadable, links };
}

async function compareFolders(
  folders,
  { entryLimit = 3000, hashByteLimit = 256 * 1024 * 1024 } = {},
) {
  if (
    !Array.isArray(folders) ||
    folders.length !== 2 ||
    folders.some((folder) => typeof folder !== 'string') ||
    path.resolve(folders[0]).toLowerCase() === path.resolve(folders[1]).toLowerCase()
  ) {
    throw new Error('Bitte genau zwei verschiedene Ordner auswählen.');
  }
  const roots = await Promise.all(folders.map((folder) => fs.promises.lstat(folder)));
  if (roots.some((root) => !root.isDirectory()))
    throw new Error('Der Ordnervergleich benötigt zwei Ordner.');
  const [left, right] = await Promise.all(
    folders.map((folder) => scanFolderForComparison(folder, entryLimit)),
  );
  const leftOnly = [];
  const rightOnly = [];
  const leftOnlyFiles = [];
  const rightOnlyFiles = [];
  const changed = [];
  const commonFiles = [];
  let same = 0;
  let unchecked = 0;
  for (const [key, entry] of left.entries) {
    const other = right.entries.get(key);
    if (!other) {
      leftOnly.push(entry.relative);
      if (entry.kind === 'file') leftOnlyFiles.push(entry.relative);
    } else if (entry.kind !== other.kind || (entry.kind === 'file' && entry.size !== other.size))
      changed.push(entry.relative);
    else if (entry.kind === 'file') commonFiles.push([entry, other]);
    else same++;
  }
  for (const [key, entry] of right.entries) {
    if (!left.entries.has(key)) {
      rightOnly.push(entry.relative);
      if (entry.kind === 'file') rightOnlyFiles.push(entry.relative);
    }
  }
  commonFiles.sort((a, b) => a[0].size - b[0].size);
  let hashedBytes = 0;
  for (const [entry, other] of commonFiles) {
    if (hashedBytes + entry.size * 2 > hashByteLimit) {
      unchecked++;
      continue;
    }
    hashedBytes += entry.size * 2;
    try {
      const hashes = await Promise.all([
        fileHash(path.join(folders[0], entry.relative)),
        fileHash(path.join(folders[1], other.relative)),
      ]);
      if (hashes[0] === hashes[1]) same++;
      else changed.push(entry.relative);
    } catch {
      unchecked++;
    }
  }
  for (const group of [leftOnly, rightOnly, changed]) group.sort((a, b) => a.localeCompare(b));
  return {
    folders,
    leftOnly,
    rightOnly,
    leftOnlyFiles,
    rightOnlyFiles,
    changed,
    same,
    unchecked,
    scanned: [left.entries.size, right.entries.size],
    capped: left.capped || right.capped,
    unreadable: left.unreadable + right.unreadable,
    links: left.links + right.links,
  };
}

async function copyMissingFiles(result, selectedIds) {
  if (!result || !Array.isArray(selectedIds) || result.capped || result.unreadable || result.links)
    throw new Error('Der Ordnervergleich ist unvollständig. Bitte erneut prüfen.');
  const [left, right] = result.folders.map((folder) => path.resolve(folder));
  const inside = (parent, child) => {
    const relative = path.relative(parent, child);
    return (
      relative &&
      !relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative)
    );
  };
  if (inside(left, right) || inside(right, left))
    throw new Error('Verschachtelte Ordner können nicht abgeglichen werden.');
  const allowed = new Set([
    ...result.leftOnlyFiles.map((name) => `L:${name}`),
    ...result.rightOnlyFiles.map((name) => `R:${name}`),
  ]);
  const summary = { copied: 0, skipped: 0, failed: [] };
  for (const id of new Set(selectedIds)) {
    if (!allowed.has(id)) continue;
    const fromLeft = id.startsWith('L:');
    const relative = id.slice(2);
    const sourceRoot = fromLeft ? left : right;
    const targetRoot = fromLeft ? right : left;
    const source = path.join(sourceRoot, relative);
    const target = path.join(targetRoot, relative);
    try {
      if (!(await fs.promises.lstat(source)).isFile()) throw new Error('Quelle geändert');
      if (!(await fs.promises.lstat(targetRoot)).isDirectory())
        throw new Error('Zielordner geändert');
      let current = targetRoot;
      for (const segment of path
        .dirname(relative)
        .split(path.sep)
        .filter((part) => part !== '.')) {
        current = path.join(current, segment);
        try {
          await fs.promises.mkdir(current);
        } catch (error) {
          if (error.code !== 'EEXIST') throw error;
        }
        if (!(await fs.promises.lstat(current)).isDirectory()) throw new Error('Zielpfad geändert');
      }
      await fs.promises.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      summary.copied++;
    } catch (error) {
      if (error.code === 'EEXIST') summary.skipped++;
      else summary.failed.push(relative);
    }
  }
  return summary;
}

async function verifyFileHash(file, expected) {
  const hash = String(expected || '')
    .trim()
    .replace(/^SHA-?256\s*[:=]\s*/i, '')
    .trim();
  if (!/^[0-9a-f]{64}$/i.test(hash)) {
    throw new Error('Bitte einen gültigen SHA-256-Wert mit 64 Hex-Zeichen eingeben.');
  }
  const actual = await fileHash(file);
  return { expected: hash.toLowerCase(), actual, matches: hash.toLowerCase() === actual };
}

async function analyzeSelection(selected) {
  if (!Array.isArray(selected) || !selected.length) {
    throw new Error('Bitte mindestens eine Datei oder einen Ordner auswählen.');
  }
  const result = { bytes: 0, files: 0, folders: 0, links: 0, unreadable: 0 };
  const pending = [...selected];
  while (pending.length) {
    const item = pending.pop();
    let stat;
    try {
      stat = await fs.promises.lstat(item);
    } catch {
      result.unreadable++;
      continue;
    }
    if (stat.isSymbolicLink()) {
      result.links++;
    } else if (stat.isFile()) {
      result.files++;
      result.bytes += stat.size;
    } else if (stat.isDirectory()) {
      result.folders++;
      try {
        const names = await fs.promises.readdir(item);
        for (const name of names) pending.push(path.join(item, name));
      } catch {
        result.unreadable++;
      }
    }
  }
  return result;
}

async function inspectFolder(folder, limit = 3000) {
  if (!(await fs.promises.stat(folder)).isDirectory()) {
    throw new Error('Kein gültiger Ordner gefunden.');
  }
  const result = {
    bytes: 0,
    files: 0,
    folders: 0,
    links: 0,
    unreadable: 0,
    capped: false,
    largest: [],
  };
  const pending = [folder];
  let scanned = 0;
  while (pending.length) {
    if (scanned >= limit) {
      result.capped = true;
      break;
    }
    const item = pending.pop();
    scanned++;
    let stat;
    try {
      stat = await fs.promises.lstat(item);
    } catch {
      result.unreadable++;
      continue;
    }
    if (stat.isSymbolicLink()) {
      result.links++;
    } else if (stat.isFile()) {
      result.files++;
      result.bytes += stat.size;
      result.largest.push({ path: item, bytes: stat.size });
      result.largest.sort((a, b) => b.bytes - a.bytes);
      result.largest.length = Math.min(result.largest.length, 8);
    } else if (stat.isDirectory()) {
      if (item !== folder) result.folders++;
      try {
        for (const name of await fs.promises.readdir(item)) pending.push(path.join(item, name));
      } catch {
        result.unreadable++;
      }
    }
  }
  return result;
}

async function findDuplicates(selected, limit = 5000) {
  if (!Array.isArray(selected) || !selected.length) {
    throw new Error('Bitte Dateien oder Ordner auswählen.');
  }
  const roots = [...new Set(selected.map((item) => path.resolve(item)))].filter(
    (item, _, all) =>
      !all.some(
        (other) => other !== item && item.toLowerCase().startsWith(other.toLowerCase() + path.sep),
      ),
  );
  const pending = [...roots];
  const bySize = new Map();
  const seen = new Set();
  let scanned = 0;
  let unreadable = 0;
  let capped = false;
  while (pending.length) {
    const item = pending.pop();
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    let stat;
    try {
      stat = await fs.promises.lstat(item);
    } catch {
      unreadable++;
      continue;
    }
    if (stat.isDirectory()) {
      try {
        for (const name of await fs.promises.readdir(item)) pending.push(path.join(item, name));
      } catch {
        unreadable++;
      }
    } else if (stat.isFile()) {
      if (scanned >= limit) {
        capped = true;
        break;
      }
      scanned++;
      if (!bySize.has(stat.size)) bySize.set(stat.size, []);
      bySize.get(stat.size).push(item);
    }
  }
  const byHash = new Map();
  for (const [size, files] of bySize) {
    if (files.length < 2) continue;
    for (const file of files) {
      try {
        const hash = await fileHash(file);
        const key = `${size}:${hash}`;
        if (!byHash.has(key)) byHash.set(key, { size, hash, files: [] });
        byHash.get(key).files.push(file);
      } catch {
        unreadable++;
      }
    }
  }
  const groups = [...byHash.values()]
    .filter((group) => group.files.length > 1)
    .sort((a, b) => b.size * (b.files.length - 1) - a.size * (a.files.length - 1));
  return { scanned, unreadable, capped, groups };
}

module.exports = {
  checkedFolderName,
  collectSelection,
  fileHash,
  fileInfo,
  compareFiles,
  comparablePairKind,
  compareFolders,
  copyMissingFiles,
  verifyFileHash,
  analyzeSelection,
  inspectFolder,
  findDuplicates,
};
