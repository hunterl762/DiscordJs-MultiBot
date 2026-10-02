const play = require('@iamtraction/play-dl');

function isYouTubeBotCheck(error) {
  const message = String(error?.message || error || '').toLowerCase();
  return message.includes('sign in to confirm') || message.includes('not a bot') || message.includes('login_required');
}

async function createStream(url) {
  try {
    // Compatibility mode asks the maintained play-dl implementation for a stream
    // that is safe to feed into Discord's audio pipeline instead of relying on
    // the old extractor's raw optimization path.
    return await play.stream(url, { discordPlayerCompatibility: true });
  } catch (error) {
    if (isYouTubeBotCheck(error)) {
      const wrapped = new Error('YouTube rejected the playback request as automated traffic. Update the local music source dependency and retry; this backend does not use Lavalink or yt-dlp.');
      wrapped.cause = error;
      throw wrapped;
    }
    throw error;
  }
}

module.exports = {
  ...play,
  createStream,
  isYouTubeBotCheck,
};
