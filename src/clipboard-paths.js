const path = require('node:path');

function codeSpan(value) {
  const runs = value.match(/`+/g) || [];
  const fence = '`'.repeat(1 + Math.max(0, ...runs.map((run) => run.length)));
  const content = value.startsWith('`') || value.endsWith('`') ? ` ${value} ` : value;
  return `${fence}${content}${fence}`;
}

function markdownPaths(files, folder) {
  if (!Array.isArray(files) || !files.length || !folder)
    throw new Error('Bitte Dateien oder Ordner auswählen.');
  return files
    .map((file) => path.relative(folder, file) || path.basename(file))
    .map((relative) => `- ${codeSpan(relative.replaceAll('\\', '/'))}`)
    .join('\n');
}

module.exports = { markdownPaths };
