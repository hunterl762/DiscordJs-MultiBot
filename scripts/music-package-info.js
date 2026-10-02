const fs = require('node:fs');
const path = require('node:path');

const resolved = require.resolve('@iamtraction/play-dl');
let dir = path.dirname(resolved);
while (dir !== path.dirname(dir)) {
  const pkg = path.join(dir, 'package.json');
  if (fs.existsSync(pkg)) {
    const data = JSON.parse(fs.readFileSync(pkg, 'utf8'));
    console.log(`[Music] Source package: ${data.name || 'unknown'} ${data.version || 'unknown'}`);
    console.log(`[Music] Loaded from: ${resolved}`);
    process.exit(0);
  }
  dir = path.dirname(dir);
}
throw new Error('Unable to locate music source package metadata.');
