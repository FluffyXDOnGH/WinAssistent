const fs = require('node:fs');
const path = require('node:path');
const { normalizeProfiles } = require('./action-registry');
const { language } = require('./i18n');

const DEFAULT_HOTKEY = 'Control+Alt+Space';

function normalizeConfig(value, defaultDestinations) {
  const stored = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const destinations = Array.isArray(stored.destinations)
    ? stored.destinations
        .filter((folder) => typeof folder === 'string' && folder.trim())
        .slice(0, 5)
    : defaultDestinations;

  return {
    ...stored,
    enabled: stored.enabled !== false,
    hotkey:
      typeof stored.hotkey === 'string' && stored.hotkey.trim() ? stored.hotkey : DEFAULT_HOTKEY,
    launchAtLogin: stored.launchAtLogin === true,
    pauseInFullscreen: stored.pauseInFullscreen === true,
    language: language(stored.language),
    settingsScale: [1, 1.15, 1.3].includes(stored.settingsScale) ? stored.settingsScale : 1,
    wheelScale: [1, 1.15, 1.3].includes(stored.wheelScale) ? stored.wheelScale : 1.15,
    destinations,
    recentDestinations: Array.isArray(stored.recentDestinations)
      ? stored.recentDestinations
          .filter((folder) => typeof folder === 'string' && path.isAbsolute(folder))
          .slice(0, 5)
      : [],
    profiles: normalizeProfiles(stored.profiles),
  };
}

function loadConfig(filePath, defaultDestinations) {
  try {
    return normalizeConfig(JSON.parse(fs.readFileSync(filePath, 'utf8')), defaultDestinations);
  } catch {
    return normalizeConfig(null, defaultDestinations);
  }
}

function writeConfig(filePath, config) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify(config, null, 2));
    fs.renameSync(temporary, filePath);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

module.exports = { DEFAULT_HOTKEY, normalizeConfig, loadConfig, writeConfig };
