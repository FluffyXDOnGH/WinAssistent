const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { validatePrograms } = require('./action-registry');

async function launchProgram(value) {
  const [program] = validatePrograms([value]);
  let executable;
  try {
    executable = await fs.promises.stat(program.file);
  } catch {
    // The path may have been removed after the wheel was opened.
  }
  if (!executable?.isFile()) {
    throw new Error('Die EXE-Datei wurde nicht gefunden.');
  }
  const cwd = program.workingDirectory || path.dirname(program.file);
  let workingDirectory;
  try {
    workingDirectory = await fs.promises.stat(cwd);
  } catch {
    // The selected working directory may have been removed.
  }
  if (!workingDirectory?.isDirectory()) {
    throw new Error('Der Arbeitsordner wurde nicht gefunden.');
  }
  await new Promise((resolve, reject) => {
    const child = spawn(program.file, program.args, {
      cwd,
      detached: true,
      stdio: 'ignore',
      shell: false,
      windowsHide: false,
    });
    child.once('error', reject);
    child.once('spawn', () => {
      child.unref();
      resolve();
    });
  });
}

module.exports = { launchProgram };
