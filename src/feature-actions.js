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
  verifyFileHash,
  analyzeSelection,
  inspectFolder,
  findDuplicates,
};
