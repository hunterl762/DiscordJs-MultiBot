const play = require('@iamtraction/play-dl');

async function main() {
  const query = process.argv.slice(2).join(' ') || 'Toby Keith Should Have Been A Cowboy';
  console.log(`[Music Smoke Test] Searching: ${query}`);
  const results = await play.search(query, { limit: 1, source: { youtube: 'video' } });
  if (!results.length) throw new Error('No YouTube search result was returned.');
  const track = results[0];
  console.log(`[Music Smoke Test] Resolved: ${track.title} (${track.url})`);
  const result = await play.stream(track.url, { discordPlayerCompatibility: true });
  if (!result?.stream) throw new Error('The music source did not return a readable stream.');
  console.log(`[Music Smoke Test] Stream opened successfully; type=${result.type || 'unknown'}.`);
  result.stream.destroy();
}

main().catch((error) => {
  console.error('[Music Smoke Test] FAILED:', error);
  process.exitCode = 1;
});
