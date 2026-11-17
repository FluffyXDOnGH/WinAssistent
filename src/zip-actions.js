const fs = require('node:fs');
const path = require('node:path');
const { pipeline } = require('node:stream/promises');
const yauzl = require('yauzl');

const MAX_ENTRIES = 5000;
const MAX_ARCHIVE_BYTES = 2 * 1024 ** 3;
const MAX_ENTRY_BYTES = 512 * 1024 ** 2;

function openZip(file) {
  return new Promise((resolve, reject) => {
    yauzl.open(
      file,
      { lazyEntries: true, autoClose: false, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => (error ? reject(error) : resolve(zip)),
    );
  });
}

async function* zipEntries(zip) {
  while (true) {
    const entry = await new Promise((resolve, reject) => {
      const cleanup = () => {
        zip.off('entry', onEntry);
        zip.off('end', onEnd);
        zip.off('error', onError);
      };
      const onEntry = (value) => {
        cleanup();
        resolve(value);
      };
      const onEnd = () => {
        cleanup();
        resolve(null);
      };
      const onError = (error) => {
        cleanup();
        reject(error);
      };
      zip.once('entry', onEntry);
      zip.once('end', onEnd);
      zip.once('error', onError);
      zip.readEntry();
    });
    if (!entry) return;
    yield entry;
  }
}

function safeName(entry) {
  const name = entry.fileName;
  const parts = name.replace(/\/$/, '').split('/');
  const mode = (entry.externalFileAttributes >>> 16) & 0xffff;
  if (
    !name ||
    name.includes('\\') ||
    (mode & 0xf000) === 0xa000 ||
    parts.some(
      (part) =>
        !part ||
        part === '.' ||
        part === '..' ||
        /[<>:"|?*\x00-\x1f]/.test(part) ||
        /[. ]$/.test(part) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part),
    )
  ) {
    throw new Error(`Unsicherer ZIP-Eintrag: ${name}`);
  }
  return parts.join(path.sep);
}

function targetFor(file) {
  const parent = path.dirname(file);
  const base = path.basename(file, path.extname(file));
  let target = path.join(parent, base);
  for (let number = 2; fs.existsSync(target); number++) {
    target = path.join(parent, `${base} (${number})`);
  }
  return target;
}

async function inspectZip(file) {
  if (path.extname(file).toLowerCase() !== '.zip') throw new Error('Nur ZIP-Dateien auswählen.');
  const stat = await fs.promises.stat(file);
  if (!stat.isFile()) throw new Error('ZIP-Datei nicht gefunden.');
  const zip = await openZip(file);
  const names = new Set();
  const entries = [];
  let bytes = 0;
  let files = 0;
  try {
    for await (const entry of zipEntries(zip)) {
      const name = safeName(entry);
      const key = name.toLowerCase();
      if (names.has(key)) throw new Error(`Doppelter ZIP-Eintrag: ${entry.fileName}`);
      names.add(key);
      if (entries.length >= MAX_ENTRIES) throw new Error('ZIP enthält zu viele Einträge.');
      if (entry.uncompressedSize > MAX_ENTRY_BYTES)
        throw new Error(`ZIP-Eintrag ist zu groß: ${entry.fileName}`);
      bytes += entry.uncompressedSize;
      if (bytes > MAX_ARCHIVE_BYTES) throw new Error('ZIP-Inhalt ist zu groß.');
      if (!entry.fileName.endsWith('/')) files++;
      entries.push({ name, size: entry.uncompressedSize, directory: entry.fileName.endsWith('/') });
    }
  } finally {
    zip.close();
  }
  const byName = new Map(entries.map((entry) => [entry.name.toLowerCase(), entry]));
  for (const entry of entries) {
    const parts = entry.name.split(path.sep);
    for (let index = 1; index < parts.length; index++) {
      const parent = byName.get(parts.slice(0, index).join(path.sep).toLowerCase());
      if (parent && !parent.directory)
        throw new Error(`ZIP-Eintrag kollidiert mit einer Datei: ${entry.name}`);
    }
  }
  return {
    file,
    target: targetFor(file),
    entries,
    files,
    bytes,
    size: stat.size,
    modified: stat.mtimeMs,
  };
}

async function planZipExtraction(files) {
  if (!files.length || files.length > 20) throw new Error('Bitte 1 bis 20 ZIP-Dateien auswählen.');
  const plans = [];
  const targets = new Set();
  for (const file of files) {
    const plan = await inspectZip(file);
    let target = plan.target;
    for (let number = 2; targets.has(target.toLowerCase()) || fs.existsSync(target); number++) {
      target = path.join(
        path.dirname(file),
        `${path.basename(file, path.extname(file))} (${number})`,
      );
    }
    plan.target = target;
    targets.add(target.toLowerCase());
    plans.push(plan);
  }
  return plans;
}

function readStream(zip, entry) {
  return new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => (error ? reject(error) : resolve(stream)));
  });
}

async function extractZip(plan) {
  const stat = await fs.promises.stat(plan.file);
  if (stat.size !== plan.size || stat.mtimeMs !== plan.modified)
    throw new Error('ZIP-Datei wurde seit der Vorschau geändert.');
  const zip = await openZip(plan.file);
  let created = false;
  let index = 0;
  try {
    await fs.promises.mkdir(plan.target);
    created = true;
    for await (const entry of zipEntries(zip)) {
      const expected = plan.entries[index++];
      const name = safeName(entry);
      if (!expected || name !== expected.name || entry.uncompressedSize !== expected.size)
        throw new Error('ZIP-Inhalt wurde seit der Vorschau geändert.');
      const destination = path.join(plan.target, name);
      if (expected.directory) {
        await fs.promises.mkdir(destination, { recursive: true });
      } else {
        await fs.promises.mkdir(path.dirname(destination), { recursive: true });
        await pipeline(
          await readStream(zip, entry),
          fs.createWriteStream(destination, { flags: 'wx' }),
        );
      }
    }
    if (index !== plan.entries.length)
      throw new Error('ZIP-Inhalt wurde seit der Vorschau geändert.');
    return plan.target;
  } catch (error) {
    if (created) await fs.promises.rm(plan.target, { recursive: true, force: true });
    throw error;
  } finally {
    zip.close();
  }
}

module.exports = { planZipExtraction, extractZip };
