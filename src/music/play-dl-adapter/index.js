const metadata = require('@vookav2/play-dl');
const path = require('node:path');

function loadSource() {
  return require(path.resolve(process.cwd(), 'src', 'music', 'youtubeSource.js'));
}

async function stream(url) {
  const { createYouTubeAudioStream } = loadSource();
  const audio = await createYouTubeAudioStream(url);
  return { stream: audio, type: 'arbitrary' };
}

module.exports = {
  ...metadata,
  stream,
};
