const fs = require('node:fs');
const path = require('node:path');

function validName(name) {
  return (
    name &&
    name !== '.' &&
    name !== '..' &&
    !/[<>:"/\\|?*\x00-\x1f]/.test(name) &&
    !/[. ]$/.test(name) &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)
  );
}

async function renamePlan(folder, selected, options) {
  if (!folder || !Array.isArray(selected) || selected.length < 2 || selected.length > 100) {
    throw new Error('Bitte 2 bis 100 Dateien im Explorer auswählen.');
  }
  if (!options || typeof options !== 'object') throw new Error('Umbenennungsangaben fehlen.');
  const { prefix = '', suffix = '', search = '', replace = '', numbering = false } = options;
  if (
    [prefix, suffix, search, replace].some(
      (value) => typeof value !== 'string' || value.length > 80,
    ) ||
    typeof numbering !== 'boolean'
  ) {
    throw new Error('Bitte kurze, gültige Umbenennungsangaben eingeben.');
  }
  if (!prefix && !suffix && !search && !numbering) {
    throw new Error('Präfix, Suffix, Suchen oder Nummerierung eingeben.');
  }
  const existing = new Set((await fs.promises.readdir(folder)).map((name) => name.toLowerCase()));
  const targets = new Set();
  const width = String(selected.length).length;
  const items = [];
  for (const [index, source] of selected.entries()) {
    if (path.dirname(source).toLowerCase() !== folder.toLowerCase()) {
      throw new Error('Die Auswahl gehört nicht zum aktuellen Ordner.');
    }
    const stat = await fs.promises.lstat(source);
    if (!stat.isFile()) throw new Error('Massenumbenennung unterstützt nur normale Dateien.');
    const original = path.basename(source);
    const extension = path.extname(original);
    const base = original.slice(0, original.length - extension.length);
    const changed = search ? base.replaceAll(search, replace) : base;
    const number = numbering ? ` ${String(index + 1).padStart(width, '0')}` : '';
    const target = `${prefix}${changed}${suffix}${number}${extension}`;
    const key = target.toLowerCase();
    if (!validName(target) || target.length > 240) {
      throw new Error(`Ungültiger Dateiname: ${target || '(leer)'}`);
    }
    if (target === original) continue;
    if (targets.has(key) || existing.has(key)) {
      throw new Error(`Name bereits vorhanden: ${target}`);
    }
    targets.add(key);
    items.push({ from: original, to: target });
  }
  if (!items.length) throw new Error('Die Angaben ändern keinen Dateinamen.');
  return items;
}

function applyRenamePlan(folder, items, moveFile) {
  const completed = [];
  try {
    for (const item of items) {
      moveFile(path.join(folder, item.from), path.join(folder, item.to));
      completed.push(item);
    }
  } catch (error) {
    const restoreErrors = [];
    for (const item of completed.reverse()) {
      try {
        moveFile(path.join(folder, item.to), path.join(folder, item.from));
      } catch (restoreError) {
        restoreErrors.push(`${item.to}: ${restoreError.message}`);
      }
    }
    throw new Error(
      restoreErrors.length
        ? `Umbenennen fehlgeschlagen: ${error.message}. Rückgängig machen teilweise fehlgeschlagen: ${restoreErrors.join('; ')}`
        : `Umbenennen fehlgeschlagen; bereits geänderte Namen wurden zurückgesetzt: ${error.message}`,
    );
  }
  return items.length;
}

module.exports = { renamePlan, applyRenamePlan };
