# Release guide

The source repository is public. Installers and update metadata belong in [GitHub Releases](https://github.com/mambuzrrr/WinAssistent/releases), not in Git. Release builds use this repository as their update source. A fork can set `WINASSISTENT_GITHUB_REPO=owner/repo` when building.

## Pre-release checks

1. Test installation, startup, the tray, keyboard shortcut, `Alt` + right-click, and uninstallation on a second Windows 11 PC.
2. Review tracked files and Git history for private data and verify that build output is excluded.
3. Decide how the project name and logo may be used by third parties. The GPL-3.0-only license covers the application code; dependencies keep their own licenses.
4. Sign the installer when a code-signing certificate is available. Until then, Windows may warn users about an unsigned download.

## Build and publish a version

1. Update the version in `package.json` and `package-lock.json`, and verify the intended changes.
2. Run `npm ci`, `npm run format:check`, and `npm run release:build` on Windows.
3. Check that `dist/` contains the installer, its blockmap, and `latest.yml` for the same version. Keep these files from the same build together.
4. Create a GitHub release for tag `v<version>`. Mark beta versions as pre-releases, write concrete release notes, and attach the installer, blockmap, and `latest.yml`.
5. Install the published build on a clean Windows 11 PC and check startup, tray controls, wheel activation, and update status.

`npm run release:build` only produces local files; it does not publish a release. A complete updater test needs two consecutive published versions. Development builds that predate the embedded update source may require a one-time manual install.

To keep older installers in `dist/` while building a newer one for an update test, set `WINASSISTENT_KEEP_INSTALLER` to one or more comma-separated versions before running `npm run release:build`. Their matching installers and blockmaps stay in place; `latest.yml` always belongs to the newly built version.
