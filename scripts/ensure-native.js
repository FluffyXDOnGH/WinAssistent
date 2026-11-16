const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..');
const binary = path.join(root, 'build', 'Release', 'mouse_bridge.node');
const source = path.join(root, 'native', 'mouse_bridge.cc');

if (
  process.argv[2] !== '--rebuild' &&
  fs.existsSync(binary) &&
  fs.statSync(binary).mtimeMs >= fs.statSync(source).mtimeMs
) {
  process.exit(0);
}

const nodeGyp = path.join(root, 'node_modules', 'node-gyp', 'bin', 'node-gyp.js');
const electronVersion = require('electron/package.json').version;
const result = spawnSync(
  process.execPath,
  [
    nodeGyp,
    'rebuild',
    '--runtime=electron',
    `--target=${electronVersion}`,
    '--dist-url=https://electronjs.org/headers',
    `--devdir=${path.join(os.homedir(), '.electron-gyp')}`,
  ],
  {
    cwd: root,
    stdio: 'inherit',
  },
);

process.exit(result.status ?? 1);
