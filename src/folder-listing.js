const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_FOLDERS = 5;
const MAX_ENTRIES = 2000;
const MAX_DEPTH = 32;
const MAX_CHARS = 120000;

async function folderListing(folders, includeSubfolders = false) {
  if (!Array.isArray(folders) || !folders.length || folders.length > MAX_FOLDERS)
    throw new Error('Bitte 1 bis 5 Ordner auswählen.');
  const lines = [];
  let files = 0;
  let directories = 0;
  let skipped = 0;
  let characters = 0;
  const add = (line) => {
    characters += line.length + 1;
    if (lines.length >= MAX_ENTRIES + MAX_FOLDERS || characters > MAX_CHARS)
      throw new Error('Ordnerinhalt ist zu groß für die Zwischenablage.');
    lines.push(line);
  };
  const clean = (name) => name.replace(/[\r\n]/g, ' ');

  async function walk(folder, prefix, depth) {
    if (depth > MAX_DEPTH) throw new Error('Ordnerstruktur ist zu tief.');
    const entries = (await fs.readdir(folder, { withFileTypes: true }))
      .filter((entry) => {
        if (entry.isSymbolicLink() || (!entry.isFile() && !entry.isDirectory())) {
          skipped++;
          return false;
        }
        return true;
      })
      .sort((left, right) =>
        left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' }),
      );
    if (lines.length + entries.length > MAX_ENTRIES + MAX_FOLDERS)
      throw new Error('Ordnerinhalt ist zu groß für die Zwischenablage.');
    for (const [index, entry] of entries.entries()) {
      const last = index === entries.length - 1;
      const directory = entry.isDirectory();
      add(`${prefix}${last ? '└── ' : '├── '}${clean(entry.name)}${directory ? '/' : ''}`);
      if (directory) {
        directories++;
        if (includeSubfolders)
          await walk(
            path.join(folder, entry.name),
            `${prefix}${last ? '    ' : '│   '}`,
            depth + 1,
          );
      } else {
        files++;
      }
    }
  }

  for (const [index, folder] of folders.entries()) {
    const stat = await fs.lstat(folder);
    if (!stat.isDirectory()) throw new Error('Bitte nur Ordner auswählen.');
    if (index) add('');
    add(`${folder}${path.sep}`);
    await walk(folder, '', 0);
  }
  return { text: lines.join('\n'), files, directories, skipped, lines: lines.length };
}

module.exports = { folderListing };
