const metadata = require('@vookav2/play-dl');
const path = require('node:path');

function loadSource() {
  // Resolve from the application tree rather than this npm file dependency folder.
  return require(path.resolve(__dirname, '..', 'youtubeSource.js'));
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
