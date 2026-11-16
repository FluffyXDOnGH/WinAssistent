const fs = require('node:fs');
const path = require('node:path');
const isSupportedImage = (file) =>
  ['.jpg', '.jpeg', '.png'].includes(path.extname(file).toLowerCase());

const DEFAULT_SLOTS = Object.freeze([
  'terminal',
  'folders',
  'smart-copy',
  'file-tools',
  'windows-tools',
  'quick',
  'open-folder',
  'settings',
]);
const DEVELOPER_SLOTS = Object.freeze([
  'terminal',
  'project-tools',
  'smart-copy',
  'file-tools',
  'windows-tools',
  'quick',
  'project-root',
  'settings',
]);
const GAMER_SLOTS = Object.freeze([
  'task-manager',
  'folders',
  'smart-copy',
  'file-tools',
  'gaming-tools',
  'quick',
  'open-folder',
  'settings',
]);

const PROFILE_IDS = Object.freeze(['default', 'developer', 'gamer', 'custom']);

const ACTIONS = Object.freeze({
  terminal: {
    id: 'terminal',
    label: 'Terminal',
    icon: 'bi-terminal',
    description: 'Terminal im aktuellen Ordner öffnen',
    category: 'windows',
    context: 'any',
  },
  'project-tools': {
    id: 'project-tools',
    label: 'Projekt',
    icon: 'bi-code-square',
    description: 'Projektordner und relative Pfade',
    category: 'developer',
    context: 'project',
    submenu: 'project',
  },
  'project-root': {
    id: 'project-root',
    label: 'Projekt öffnen',
    icon: 'bi-folder2-open',
    description: 'Erkannten Projektordner öffnen',
    category: 'developer',
    context: 'project',
  },
  'gaming-tools': {
    id: 'gaming-tools',
    label: 'Gaming',
    icon: 'bi-controller',
    description: 'Spielmodus, Aufnahmen und Leistungswerkzeuge',
    category: 'gamer',
    context: 'any',
    submenu: 'gaming',
  },
  'task-manager': {
    id: 'task-manager',
    label: 'Task-Manager',
    icon: 'bi-speedometer2',
    description: 'Task-Manager öffnen',
    category: 'gamer',
    context: 'any',
  },
  folders: {
    id: 'folders',
    label: 'Auswahl bündeln',
    icon: 'bi-folder-check',
    description: 'Mehrere Elemente in einem neuen Ordner zusammenfassen',
    category: 'files',
    context: 'multiple',
    submenu: 'folders',
  },
  'smart-copy': {
    id: 'smart-copy',
    label: 'Smart Copy',
    icon: 'bi-copy',
    description: 'Namen, Pfade oder Dateiinformationen kopieren',
    category: 'clipboard',
    context: 'explorer',
    submenu: 'copy',
  },
  'file-tools': {
    id: 'file-tools',
    label: 'Datei',
    icon: 'bi-file-earmark',
    description: 'Eigenschaften, Prüfsumme und weitere Dateiaktionen',
    category: 'files',
    context: 'explorer',
    submenu: 'files',
  },
  'windows-tools': {
    id: 'windows-tools',
    label: 'Windows',
    icon: 'bi-windows',
    description: 'Systemwerkzeuge direkt öffnen',
    category: 'windows',
    context: 'any',
    submenu: 'windows',
  },
  'copy-path': {
    id: 'copy-path',
    label: 'Pfad kopieren',
    icon: 'bi-link-45deg',
    description: 'Pfad der Auswahl oder des Ordners kopieren',
    category: 'clipboard',
    context: 'explorer',
  },
  'copy-names': {
    id: 'copy-names',
    label: 'Namen kopieren',
    icon: 'bi-list-ul',
    description: 'Namen der Auswahl oder des Ordners kopieren',
    category: 'clipboard',
    context: 'explorer',
  },
  properties: {
    id: 'properties',
    label: 'Eigenschaften',
    icon: 'bi-info-circle',
    description: 'Windows-Eigenschaften öffnen',
    category: 'files',
    context: 'explorer',
  },
  'run-admin': {
    id: 'run-admin',
    label: 'Als Admin starten',
    icon: 'bi-shield-check',
    description: 'Ausgewählte EXE mit UAC starten',
    category: 'files',
    context: 'exe',
  },
  quick: {
    id: 'quick',
    label: 'Schnell ablegen',
    icon: 'bi-folder-symlink',
    description: 'Auswahl in gespeicherten Zielordner kopieren oder verschieben',
    category: 'files',
    context: 'selection',
    submenu: 'destinations',
  },
  'open-folder': {
    id: 'open-folder',
    label: 'Ordner öffnen',
    icon: 'bi-folder2-open',
    description: 'Aktuellen Explorer-Ordner öffnen',
    category: 'windows',
    context: 'explorer',
  },
  settings: {
    id: 'settings',
    label: 'Einstellungen',
    icon: 'bi-gear',
    description: 'WinAssistent einstellen',
    category: 'app',
    context: 'any',
  },
  'image-tools': {
    id: 'image-tools',
    label: 'Bilder',
    icon: 'bi-images',
    description: 'Bilder zum Teilen vorbereiten oder als PDF speichern',
    category: 'files',
    context: 'images',
    submenu: 'images',
  },
  'recent-folders': {
    id: 'recent-folders',
    label: 'Zielordner',
    icon: 'bi-folder-symlink',
    description: 'Gespeicherte und offene Ordner direkt öffnen',
    category: 'files',
    context: 'any',
    submenu: 'destinations',
  },
  'bulk-rename': {
    id: 'bulk-rename',
    label: 'Massenumbenennung',
    icon: 'bi-input-cursor-text',
    description: 'Dateien mit Vorschau umbenennen',
    category: 'files',
    context: 'multiple',
    submenu: 'rename',
  },
  'files:size': {
    id: 'files:size',
    label: 'Größe der Auswahl',
    icon: 'bi-pie-chart',
    description: 'Größe und Inhalt der Auswahl prüfen',
    category: 'files',
    context: 'selection',
  },
  'files:duplicates': {
    id: 'files:duplicates',
    label: 'Duplikate finden',
    icon: 'bi-layers',
    description: 'Identische Dateien in der Auswahl finden',
    category: 'files',
    context: 'selection',
  },
  'files:hash': {
    id: 'files:hash',
    label: 'SHA-256 kopieren',
    icon: 'bi-fingerprint',
    description: 'Prüfsumme der gewählten Datei kopieren',
    category: 'files',
    context: 'single-file',
  },
  'files:locks': {
    id: 'files:locks',
    label: 'Dateisperre prüfen',
    icon: 'bi-lock',
    description: 'Prozesse mit Zugriff auf die Datei anzeigen',
    category: 'files',
    context: 'single-file',
  },
});

const CUSTOM_ACTION_IDS = Object.freeze([
  'terminal',
  'folders',
  'smart-copy',
  'file-tools',
  'windows-tools',
  'quick',
  'open-folder',
  'settings',
  'project-tools',
  'project-root',
  'gaming-tools',
  'task-manager',
  'copy-path',
  'copy-names',
  'properties',
  'run-admin',
  'image-tools',
  'recent-folders',
  'bulk-rename',
  'files:size',
  'files:duplicates',
  'files:hash',
  'files:locks',
]);

const PROGRAM_ID = /^program:[0-9a-f-]{36}$/i;

function validatePrograms(value) {
  if (!Array.isArray(value) || value.length > 16) {
    throw new Error('Maximal 16 eigene Programme sind möglich.');
  }
  const seen = new Set();
  return value.map((item) => {
    const id = item?.id;
    const label = typeof item?.label === 'string' ? item.label.trim() : '';
    const file = item?.file;
    const args = item?.args;
    const workingDirectory = item?.workingDirectory || '';
    if (
      !PROGRAM_ID.test(id) ||
      seen.has(id) ||
      !label ||
      label.length > 24 ||
      typeof file !== 'string' ||
      !path.isAbsolute(file) ||
      path.extname(file).toLowerCase() !== '.exe' ||
      !Array.isArray(args) ||
      args.length > 20 ||
      args.some((arg) => typeof arg !== 'string' || arg.length > 300) ||
      (workingDirectory &&
        (typeof workingDirectory !== 'string' || !path.isAbsolute(workingDirectory)))
    ) {
      throw new Error(
        'Ein eigenes Programm hat ungültige Angaben. Bitte Name, EXE-Pfad und Argumente prüfen.',
      );
    }
    seen.add(id);
    return { id, label, file, args: [...args], workingDirectory };
  });
}

function validateCustomSlots(value, programs = []) {
  const programIds = new Set(programs.map((program) => program.id));
  const slots = Array.isArray(value)
    ? value.map((id) => (id === 'new-folder' ? 'folders' : id))
    : value;
  if (
    !Array.isArray(slots) ||
    slots.length !== 8 ||
    !slots.every(
      (id) => typeof id === 'string' && (CUSTOM_ACTION_IDS.includes(id) || programIds.has(id)),
    )
  ) {
    throw new Error('Das Custom-Profil benötigt acht gültige Aktionen.');
  }
  return slots;
}

function normalizeProfiles(value) {
  let programs = [];
  try {
    programs = validatePrograms(value?.programs || []);
  } catch {
    // An invalid stored program list does not prevent the app from opening.
  }
  const layouts = {
    default: [...DEFAULT_SLOTS],
    developer: [...DEVELOPER_SLOTS],
    gamer: [...GAMER_SLOTS],
    custom: [...DEFAULT_SLOTS],
  };
  try {
    layouts.custom = validateCustomSlots(value?.layouts?.custom, programs);
  } catch {
    // Older settings without a Custom layout start with the Standard layout.
  }

  const requested = value?.active;
  const active =
    PROFILE_IDS.includes(requested) && layouts[requested].length === 8 ? requested : 'default';
  return { active, layouts, programs };
}

function activeSlots(profiles) {
  const normalized = normalizeProfiles(profiles);
  return normalized.layouts[normalized.active];
}

function effectiveId(slot, context) {
  return slot === 'properties' && context.selected.length === 1 && context.type === '.exe'
    ? 'run-admin'
    : slot;
}

function availability(action, context) {
  if (action.context === 'program') {
    try {
      if (!fs.statSync(action.file).isFile()) throw new Error();
      if (action.workingDirectory && !fs.statSync(action.workingDirectory).isDirectory())
        throw new Error();
    } catch {
      return { available: false, reason: 'Programm oder Arbeitsordner nicht gefunden' };
    }
  }
  if (context.loading && !['any', 'program'].includes(action.context)) {
    return { available: false, reason: 'Explorer-Auswahl wird geladen' };
  }
  if (action.context === 'explorer' && !context.folder) {
    return { available: false, reason: 'Nur in einem Explorer-Ordner verfügbar' };
  }
  if (action.context === 'project' && !context.projectRoot) {
    return { available: false, reason: 'Kein Projektordner erkannt' };
  }
  if (
    action.context === 'images' &&
    (!context.selected.length || !context.selected.every(isSupportedImage))
  ) {
    return { available: false, reason: 'JPG- oder PNG-Bilder auswählen' };
  }
  if (
    action.context === 'single-file' &&
    (context.selected.length !== 1 || !context.selectedIsFile)
  ) {
    return { available: false, reason: 'Genau eine Datei auswählen' };
  }
  if (action.context === 'selection' && (!context.folder || !context.selected.length)) {
    return { available: false, reason: 'Zuerst eine Datei oder einen Ordner auswählen' };
  }
  if (action.context === 'multiple' && (!context.folder || context.selected.length < 2)) {
    return { available: false, reason: 'Mindestens zwei Elemente auswählen' };
  }
  if (
    action.id === 'folders' &&
    context.selected.some(
      (item) =>
        path.dirname(item).toLowerCase() !== path.dirname(context.selected[0]).toLowerCase(),
    )
  ) {
    return { available: false, reason: 'Auswahl liegt in verschiedenen Ordnern' };
  }
  if (
    action.id === 'bulk-rename' &&
    (context.selected.length > 100 ||
      !context.selected.every(
        (item) =>
          path.dirname(item).toLowerCase() === path.dirname(context.selected[0]).toLowerCase(),
      ) ||
      !context.selected.every((item) => {
        try {
          return fs.statSync(item).isFile();
        } catch {
          return false;
        }
      }))
  ) {
    return { available: false, reason: 'Nur normale Dateien umbenennen' };
  }
  if (
    action.context === 'exe' &&
    (!context.folder || context.selected.length !== 1 || context.type !== '.exe')
  ) {
    return { available: false, reason: 'Nur für eine ausgewählte EXE verfügbar' };
  }
  return { available: true, reason: '' };
}

function defaultSlotsForContext(context) {
  const selected = context.selected;
  const images = selected.length > 0 && selected.every(isSupportedImage);
  if (!selected.length) {
    const rank = { Zuletzt: 0, Offen: 1, Gespeichert: 2 };
    const destinations = (context.destinations || [])
      .map((entry, index) => ({ entry, index }))
      .sort((left, right) => (rank[left.entry.kind] ?? 3) - (rank[right.entry.kind] ?? 3))
      .slice(0, 4);
    return [0, 1, 2, 3]
      .map((slot) => (destinations[slot] ? `destination:${destinations[slot].index}` : null))
      .concat([
        context.folder ? 'smart-copy' : null,
        'windows-tools',
        context.destinations?.length ? 'recent-folders' : 'terminal',
        'settings',
      ]);
  }
  if (selected.length > 1) {
    const canBundle = selected.every(
      (item) => path.dirname(item).toLowerCase() === path.dirname(selected[0]).toLowerCase(),
    );
    const canRename =
      canBundle &&
      selected.length <= 100 &&
      selected.every((item) => {
        try {
          return fs.statSync(item).isFile();
        } catch {
          return false;
        }
      });
    return [
      images ? 'image-tools' : canBundle ? 'folders' : 'recent-folders',
      'quick',
      'files:duplicates',
      'file-tools',
      'smart-copy',
      canRename ? 'bulk-rename' : 'files:size',
      'terminal',
      'settings',
    ];
  }
  if (!context.selectedIsFile) {
    return [
      'quick',
      'files:size',
      'smart-copy',
      'file-tools',
      'recent-folders',
      'terminal',
      'windows-tools',
      'settings',
    ];
  }
  return [
    images ? 'image-tools' : 'quick',
    images ? 'quick' : 'smart-copy',
    images ? 'smart-copy' : 'file-tools',
    images ? 'file-tools' : context.type === '.exe' ? 'run-admin' : 'files:hash',
    images ? 'files:hash' : 'files:locks',
    'recent-folders',
    'terminal',
    'settings',
  ];
}

function wheelActions(profiles, context) {
  const normalized = normalizeProfiles(profiles);
  const slots =
    normalized.active === 'default' && !context.loading
      ? defaultSlotsForContext(context)
      : normalized.layouts[normalized.active];
  return slots.map((slot) => {
    if (!slot) return null;
    const program = normalized.programs.find((item) => item.id === slot);
    const destination = /^destination:(\d+)$/.exec(slot);
    const action = program
      ? {
          ...program,
          icon: 'bi-app',
          description: program.file,
          category: 'program',
          context: 'program',
        }
      : destination
        ? {
            id: slot,
            label:
              path.basename(context.destinations?.[Number(destination[1])]?.path || '') || 'Ordner',
            icon: 'bi-folder2-open',
            description: context.destinations?.[Number(destination[1])]?.path || '',
            category: 'destination',
            context: 'any',
          }
        : ACTIONS[effectiveId(slot, context)];
    return { ...action, ...availability(action, context) };
  });
}

function allowedAction(id, profiles, context) {
  return wheelActions(profiles, context).find((action) => action?.id === id && action.available);
}

module.exports = {
  DEFAULT_SLOTS,
  DEVELOPER_SLOTS,
  GAMER_SLOTS,
  PROFILE_IDS,
  ACTIONS,
  CUSTOM_ACTION_IDS,
  validatePrograms,
  validateCustomSlots,
  normalizeProfiles,
  wheelActions,
  allowedAction,
};
