function checkingState(current) {
  if (current.phase === 'available') return { ...current };
  return { ...current, phase: 'checking', error: '' };
}

function failedCheckState(previous, message, noRelease = false) {
  if (previous?.phase === 'available') return { ...previous, error: '' };
  if (noRelease) return { phase: 'idle', version: '', progress: 0, error: '' };
  return { ...previous, phase: 'error', error: message };
}

module.exports = { checkingState, failedCheckState };
