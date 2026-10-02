const { spawnSync } = require('node:child_process');

for (const script of ['check-music.js', 'verify-music-config.js', 'music-package-info.js']) {
  const result = spawnSync(process.execPath, [require('node:path').join(__dirname, script)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('[Music] Self-test complete.');
