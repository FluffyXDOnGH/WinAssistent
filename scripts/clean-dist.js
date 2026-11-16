const fs = require('node:fs');
const path = require('node:path');
const { version } = require('../package.json');

const dist = path.resolve(__dirname, '..', 'dist');
const currentInstaller = `WinAssistent-Setup-${version}.exe`;
const currentBlockmap = `${currentInstaller}.blockmap`;

if (!fs.existsSync(path.join(dist, currentInstaller))) {
  throw new Error(`Installer fehlt: ${currentInstaller}`);
}
const manifest = path.join(dist, 'latest.yml');
const currentManifest =
  fs.existsSync(manifest) &&
  new RegExp(
    `^version:\\s*["']?${version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:["']|\\s|$)`,
    'm',
  ).test(fs.readFileSync(manifest, 'utf8'));

for (const entry of fs.readdirSync(dist, { withFileTypes: true })) {
  if (
    entry.name === currentInstaller ||
    entry.name === currentBlockmap ||
    (currentManifest && ['latest.yml', 'latest.yml.sig'].includes(entry.name))
  )
    continue;

  const installerArtifact =
    /^WinAssistent(?:-| )Setup(?:-| )\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\.exe(?:\.blockmap|\.yaml|\.yml)?$/.test(
      entry.name,
    );
  const temporaryFile = ['builder-debug.yml', 'icon-preview.png'].includes(entry.name);
  const staleManifest = ['latest.yml', 'latest.yml.sig'].includes(entry.name);
  const temporaryDirectory = ['win-unpacked', '.icon-ico'].includes(entry.name);

  if (
    (entry.isFile() && (installerArtifact || temporaryFile || staleManifest)) ||
    (entry.isDirectory() && temporaryDirectory)
  ) {
    fs.rmSync(path.join(dist, entry.name), { recursive: entry.isDirectory(), force: true });
  }
}
