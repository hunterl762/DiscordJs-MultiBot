async function main() {
  const play = require('@iamtraction/play-dl');
  const query = process.argv.slice(2).join(' ') || "Toby Keith Should've Been A Cowboy";
  console.log(`[Music Smoke Test] Searching: ${query}`);
  const results = await play.search(query, { limit: 1, source: { youtube: 'video' } });
  if (!results.length) throw new Error('No YouTube search result was returned.');
  const track = results[0];
  console.log(`[Music Smoke Test] Resolved: ${track.title} (${track.url})`);
  const result = await play.stream(track.url);
  if (!result?.stream) throw new Error('The SABR source did not return a readable stream.');

  await new Promise((resolve, reject) => {
    let bytes = 0;
    const timer = setTimeout(() => reject(new Error('Timed out waiting for YouTube audio bytes.')), 20_000);
    const cleanup = () => clearTimeout(timer);
    result.stream.once('error', (error) => { cleanup(); reject(error); });
    result.stream.on('data', (chunk) => {
      bytes += chunk.length;
      if (bytes >= 64 * 1024) {
        cleanup();
        result.stream.destroy();
        console.log(`[Music Smoke Test] SABR audio stream is healthy; received ${bytes} bytes.`);
        resolve();
      }
    });
  });
}

main().catch((error) => {
  console.error('[Music Smoke Test] FAILED:', error);
  process.exitCode = 1;
});
