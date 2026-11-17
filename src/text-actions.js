const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const TEXT_EXTENSIONS = new Set([
  '.bat',
  '.c',
  '.cfg',
  '.cmd',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.go',
  '.h',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsonl',
  '.jsx',
  '.log',
  '.md',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.toml',
  '.ts',
  '.tsv',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
]);
const TEXT_NAMES = new Set(['.editorconfig', '.env', '.gitignore', '.npmrc']);

function isTextFile(file) {
  return (
    TEXT_EXTENSIONS.has(path.extname(file).toLowerCase()) ||
    TEXT_NAMES.has(path.basename(file).toLowerCase())
  );
}

async function readTextFile(file) {
  if (!isTextFile(file)) throw new Error('Nur unterstützte Textdateien können kopiert werden.');
  const info = await fs.stat(file);
  if (!info.isFile()) throw new Error('Bitte genau eine Textdatei auswählen.');
  if (info.size > MAX_TEXT_BYTES) throw new Error('Textdatei ist größer als 2 MB.');
  const bytes = await fs.readFile(file);
  if (bytes.length > MAX_TEXT_BYTES) throw new Error('Textdatei ist größer als 2 MB.');
  let encoding = 'utf-8';
  let offset = 0;
  if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) offset = 3;
  else if (bytes.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) {
    encoding = 'utf-16le';
    offset = 2;
  } else if (bytes.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) {
    encoding = 'utf-16be';
    offset = 2;
  }
  let content;
  try {
    content = new TextDecoder(encoding, { fatal: true }).decode(bytes.subarray(offset));
  } catch {
    throw new Error('Datei enthält keinen lesbaren UTF-8- oder UTF-16-Text.');
  }
  if (/[\x00-\x08\x0e-\x1f]/.test(content))
    throw new Error('Datei enthält keinen lesbaren UTF-8- oder UTF-16-Text.');
  return content;
}

function excerpt(line, column) {
  if (line === undefined) return null;
  const start = Math.max(0, column - 50);
  const visible = line.slice(start, start + 120).replaceAll('\t', '⇥');
  return `${start ? '…' : ''}${visible}${start + 120 < line.length ? '…' : ''}`;
}

async function firstTextDifference(files) {
  if (!Array.isArray(files) || files.length !== 2 || !files.every(isTextFile)) return null;
  let contents;
  try {
    contents = await Promise.all(files.map(readTextFile));
  } catch (error) {
    return { kind: 'unavailable', reason: error.message };
  }
  const lines = contents.map((content) => {
    const normalized = content.replace(/\r\n?/g, '\n');
    const parts = normalized.split('\n');
    if (normalized.endsWith('\n')) parts.pop();
    return parts;
  });
  const count = Math.max(lines[0].length, lines[1].length);
  for (let index = 0; index < count; index++) {
    const left = lines[0][index];
    const right = lines[1][index];
    if (left === right) continue;
    let column = 0;
    while (
      column < Math.min(left?.length || 0, right?.length || 0) &&
      left[column] === right[column]
    )
      column++;
    return {
      kind: 'difference',
      line: index + 1,
      column: column + 1,
      left: excerpt(left, column),
      right: excerpt(right, column),
    };
  }
  return { kind: 'format-only' };
}

module.exports = { isTextFile, readTextFile, firstTextDifference };
