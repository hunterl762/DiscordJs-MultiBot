require('dotenv').config();

const enabled = ['1', 'true', 'yes', 'on'].includes(String(process.env.MUSIC_ENABLED || '').trim().toLowerCase());
const youtubeKey = String(process.env.YOUTUBE_API_KEY || '').trim();

console.log(`[Music Config] MUSIC_ENABLED=${enabled}`);
console.log(`[Music Config] Search engine=${process.env.MUSIC_DEFAULT_SEARCH_ENGINE || 'youtube'}`);
console.log(`[Music Config] YouTube playlist API=${youtubeKey ? 'configured' : 'not configured (playlist URLs require YOUTUBE_API_KEY)'}`);

if (!enabled) {
  console.warn('[Music Config] Music is disabled. Set MUSIC_ENABLED=true to enable music commands.');
}
