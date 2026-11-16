const fs = require('node:fs');
const path = require('node:path');

const markers = ['.git', 'package.json', 'Cargo.toml', 'pyproject.toml', 'go.mod', '.sln'];

function findProjectRoot(folder) {
  if (!folder) return '';
  let current = path.resolve(folder);
  for (;;) {
    try {
      if (markers.some((name) => fs.existsSync(path.join(current, name)))) return current;
      if (fs.readdirSync(current).some((name) => name.toLowerCase().endsWith('.sln')))
        return current;
    } catch {
      return '';
    }
    const parent = path.dirname(current);
    if (parent === current) return '';
    current = parent;
  }
}

module.exports = { findProjectRoot };
