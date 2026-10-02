let innertubePromise = null;
let sourceModulePromise = null;

function getVideoId(value) {
  try {
    const url = new URL(String(value || '').trim());
    if (url.hostname === 'youtu.be') return url.pathname.split('/').filter(Boolean)[0] || '';
    return url.searchParams.get('v') || '';
  } catch {
    return String(value || '').match(/^[A-Za-z0-9_-]{11}$/)?.[0] || '';
  }
}

async function getModules() {
  if (!sourceModulePromise) {
    sourceModulePromise = Promise.all([
      import('youtubei.js'),
      import('simple-ytdl-core'),
    ]).then(([youtube, source]) => ({ Innertube: youtube.Innertube, source }));
  }
  return sourceModulePromise;
}

async function getInnertube() {
  if (!innertubePromise) {
    innertubePromise = getModules()
      .then(({ Innertube }) => Innertube.create())
      .catch((error) => {
        innertubePromise = null;
        throw error;
      });
  }
  return innertubePromise;
}

async function createYouTubeAudioStream(url) {
  const videoId = getVideoId(url);
  if (!videoId) throw new Error('Unable to determine the YouTube video ID.');

  const [{ source }, innertube] = await Promise.all([getModules(), getInnertube()]);
  const createStream = source.downloadMultiStep || source.createAdaptiveStreamMultiStep || source.createSabrStream;
  if (typeof createStream !== 'function') {
    throw new Error('simple-ytdl-core does not expose a supported audio streaming method.');
  }

  try {
    const stream = await createStream(innertube, videoId);
    if (!stream || typeof stream.pipe !== 'function') throw new Error('YouTube source returned an invalid audio stream.');
    return stream;
  } catch (error) {
    const message = String(error?.message || error);
    throw new Error(`YouTube audio source failed: ${message}`, { cause: error });
  }
}

async function checkYouTubeSource() {
  const { source } = await getModules();
  const available = ['downloadMultiStep', 'createAdaptiveStreamMultiStep', 'createSabrStream']
    .filter((name) => typeof source[name] === 'function');
  if (!available.length) throw new Error('No supported simple-ytdl-core stream method was found.');
  await getInnertube();
  return available;
}

module.exports = { createYouTubeAudioStream, checkYouTubeSource, getVideoId };
