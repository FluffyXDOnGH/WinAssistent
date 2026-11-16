const fs = require('node:fs');
const path = require('node:path');
const { build } = require('electron-builder');
const packageJson = require('../package.json');

const projectDir = path.resolve(__dirname, '..');
const repository = process.env.WINASSISTENT_GITHUB_REPO || 'mambuzrrr/WinAssistent';
const match = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/.exec(repository);

if (!match) {
  console.error('WINASSISTENT_GITHUB_REPO muss owner/repo enthalten.');
  process.exitCode = 1;
} else {
  const [, owner, repo] = match;
  const config = {
    ...packageJson.build,
    publish: { provider: 'github', owner, repo },
  };

  build({ projectDir, win: ['nsis'], config, publish: 'never' })
    .then(() => {
      const dist = path.join(projectDir, 'dist');
      const installer = `WinAssistent-Setup-${packageJson.version}.exe`;
      for (const name of [installer, `${installer}.blockmap`, 'latest.yml']) {
        if (!fs.existsSync(path.join(dist, name))) throw new Error(`Release-Datei fehlt: ${name}`);
      }
      const feed = path.join(dist, 'win-unpacked', 'resources', 'app-update.yml');
      if (!fs.existsSync(feed)) throw new Error('Update-Quelle fehlt im App-Paket.');
      const content = fs.readFileSync(feed, 'utf8');
      if (!content.includes(`owner: ${owner}`) || !content.includes(`repo: ${repo}`)) {
        throw new Error('Update-Quelle im App-Paket passt nicht zum GitHub-Repository.');
      }
      if (!fs.readFileSync(path.join(dist, 'latest.yml'), 'utf8').includes(`url: ${installer}`)) {
        throw new Error('Installer-Name und latest.yml passen nicht zusammen.');
      }
      require('./clean-dist');
      console.log(`Release-Build für ${repository} liegt in dist/. Es wurde nichts hochgeladen.`);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
