const fs = require('node:fs');

function ok(label, detail = '') { console.log(`[Music Check] OK   ${label}${detail ? `: ${detail}` : ''}`); }
function fail(label, error) { console.error(`[Music Check] FAIL ${label}: ${error?.message || error}`); process.exitCode = 1; }

(async () => {
  try {
    const voice = require('@discordjs/voice');
    ok('@discordjs/voice', typeof voice.generateDependencyReport === 'function' ? '\n' + voice.generateDependencyReport() : 'loaded');
  } catch (error) { fail('@discordjs/voice', error); }

  try {
    const play = require('@iamtraction/play-dl');
    if (typeof play.stream !== 'function' || typeof play.search !== 'function') throw new Error('music adapter API is incomplete');
    ok('Kryndexa music adapter', require.resolve('@iamtraction/play-dl'));
  } catch (error) { fail('Kryndexa music adapter', error); }

  try {
    const { checkYouTubeSource } = require('../src/music/youtubeSource');
    const methods = await checkYouTubeSource();
    ok('YouTube SABR source', methods.join(', '));
  } catch (error) { fail('YouTube SABR source', error); }

  try {
    const ffmpeg = require('ffmpeg-static');
    if (!ffmpeg || !fs.existsSync(ffmpeg)) throw new Error(`FFmpeg executable was not found at ${ffmpeg || '(empty path)'}`);
    ok('FFmpeg', ffmpeg);
  } catch (error) { fail('FFmpeg', error); }

  try { require('prism-media'); ok('prism-media'); } catch (error) { fail('prism-media', error); }
  if (!process.exitCode) console.log('[Music Check] Local SABR music dependencies are ready.');
})().catch((error) => fail('music check', error));
