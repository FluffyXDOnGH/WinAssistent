const path = require('node:path');
const { translate } = require('./i18n');

const knownFolderNames = {
  desktop: 'Desktop',
  documents: 'Dokumente',
  downloads: 'Downloads',
  music: 'Musik',
  pictures: 'Bilderordner',
  videos: 'Videos',
};

function folderLabel(folder, locale, knownPaths = {}) {
  if (!folder) return '';
  const normalized = path.resolve(folder).toLowerCase();
  for (const [id, name] of Object.entries(knownFolderNames)) {
    if (knownPaths[id] && path.resolve(knownPaths[id]).toLowerCase() === normalized) {
      return translate(locale, name);
    }
  }
  return path.basename(folder) || folder;
}

module.exports = { folderLabel, knownFolderNames };
