const { validateCustomSlots, validatePrograms } = require('./action-registry');

const PROFILE_KIND = 'winassistent-custom-profile';
const PROFILE_VERSION = 2;
const MAX_PROFILE_BYTES = 64 * 1024;

function exportProfile(slots, programs = []) {
  const validPrograms = validatePrograms(programs);
  const content =
    JSON.stringify(
      {
        kind: PROFILE_KIND,
        version: PROFILE_VERSION,
        slots: validateCustomSlots(slots, validPrograms),
        programs: validPrograms,
      },
      null,
      2,
    ) + '\n';
  if (Buffer.byteLength(content, 'utf8') > MAX_PROFILE_BYTES) {
    throw new Error('Das Profil ist für den Export zu groß. Bitte weniger Argumente verwenden.');
  }
  return content;
}

function importProfile(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > MAX_PROFILE_BYTES) {
    throw new Error('Die Profildatei ist zu groß.');
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error('Die Datei enthält kein gültiges JSON.');
  }
  if (value?.kind !== PROFILE_KIND || ![1, PROFILE_VERSION].includes(value.version)) {
    throw new Error('Diese Datei ist kein unterstütztes WinAssistent-Profil.');
  }
  const programs = value.version === 1 ? [] : validatePrograms(value.programs);
  return { slots: validateCustomSlots(value.slots, programs), programs };
}

module.exports = { MAX_PROFILE_BYTES, exportProfile, importProfile };
