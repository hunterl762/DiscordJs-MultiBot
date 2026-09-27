const { EmbedBuilder } = require('discord.js');
const {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  VoiceConnectionStatus,
  StreamType,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
} = require('@discordjs/voice');
const play = require('@iamtraction/play-dl');
const ffmpegPath = require('ffmpeg-static');
const prism = require('prism-media');

// prism-media looks for FFMPEG_PATH before falling back to a system PATH lookup.
// Bundling ffmpeg-static keeps local Windows installs self-contained.
if (ffmpegPath && !process.env.FFMPEG_PATH) process.env.FFMPEG_PATH = ffmpegPath;

let clientRef = null;
let initialized = false;
const players = new Map();
const manualStopUntil = new Map();

function envEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function musicGloballyEnabled() {
  return envEnabled(process.env.MUSIC_ENABLED);
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return hours
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function toTrack(video, requester) {
  const durationSeconds = Number(video?.durationInSec || video?.duration || 0);
  const videoId = String(video?.id || video?.videoId || '').trim();
  const videoUrl = String(video?.url || (videoId ? `https://www.youtube.com/watch?v=${videoId}` : '')).trim();
  return {
    title: String(video?.title || 'Unknown track'),
    author: String(video?.channel?.name || video?.channel?.title || 'Unknown'),
    uri: videoUrl,
    realUri: videoUrl,
    length: durationSeconds * 1000,
    isStream: Boolean(video?.live),
    requester,
  };
}

async function resolveYouTubePlaylist(playlistId, requester) {
  const apiKey = String(process.env.YOUTUBE_API_KEY || '').trim();
  if (!apiKey) throw new Error('YOUTUBE_API_KEY is required for reliable YouTube playlist playback.');
  const tracks = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ part: 'snippet,contentDetails', playlistId, maxResults: '50', key: apiKey });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetch(`https://www.googleapis.com/youtube/v3/playlistItems?${params}`);
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(`YouTube Data API returned ${response.status}: ${data?.error?.message || 'playlist request failed'}`);
    for (const item of data.items || []) {
      const videoId = item?.contentDetails?.videoId || item?.snippet?.resourceId?.videoId;
      if (!videoId || ['Private video', 'Deleted video'].includes(item?.snippet?.title)) continue;
      tracks.push(toTrack({
        id: videoId,
        title: item?.snippet?.title,
        channel: { name: item?.snippet?.videoOwnerChannelTitle || item?.snippet?.channelTitle },
      }, requester));
    }
    pageToken = String(data.nextPageToken || '');
  } while (pageToken);
  return tracks.filter((track) => track.uri);
}

async function resolveTracks(query, requester) {
  const value = String(query || '').trim();
  if (!value) return { tracks: [], type: 'SEARCH' };

  if (/^https?:\/\//i.test(value)) {
    let parsedUrl = null;
    try { parsedUrl = new URL(value); } catch {}
    const host = parsedUrl?.hostname?.replace(/^www\./, '').toLowerCase();
    const playlistId = parsedUrl?.searchParams?.get('list');
    const youtubeHost = ['youtube.com', 'm.youtube.com', 'music.youtube.com', 'youtu.be'].includes(host);
    if (youtubeHost && playlistId) {
      const tracks = await resolveYouTubePlaylist(playlistId, requester);
      if (!tracks.length) throw new Error(`YouTube playlist ${playlistId} contains no playable public videos.`);
      console.log(`[Music] YouTube Data API resolved playlist ${playlistId}: ${tracks.length} playable track(s).`);
      return { tracks, type: 'PLAYLIST', playlist: { id: playlistId } };
    }

    if (play.yt_validate(value) === 'video') {
      const info = await play.video_basic_info(value);
      return { tracks: [toTrack(info.video_details, requester)], type: 'TRACK' };
    }

    return { tracks: [], type: 'SEARCH' };
  }

  const videos = await play.search(value, { limit: 10, source: { youtube: 'video' } });
  return { tracks: videos.map((video) => toTrack(video, requester)), type: 'SEARCH' };
}

class LocalQueue {
  constructor() {
    this.current = null;
    this.items = [];
    this.previous = [];
  }
  get length() { return this.items.length; }
  add(value) { Array.isArray(value) ? this.items.push(...value) : this.items.push(value); }
  shift() { return this.items.shift(); }
  shuffle() {
    for (let i = this.items.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [this.items[i], this.items[j]] = [this.items[j], this.items[i]];
    }
  }
  [Symbol.iterator]() { return this.items[Symbol.iterator](); }
}

class LocalMusicPlayer {
  constructor(manager, options) {
    this.manager = manager;
    this.guildId = options.guildId;
    this.textId = options.textId;
    this.voiceId = options.voiceId;
    this.volume = Math.max(1, Math.min(200, Number(options.volume || 75)));
    this.loop = 'none';
    this.queue = new LocalQueue();
    this.playing = false;
    this.paused = false;
    this.destroyed = false;
    this.skipping = false;

    const guild = clientRef.guilds.cache.get(this.guildId);
    if (!guild) throw new Error('Guild is unavailable.');

    this.connection = joinVoiceChannel({
      channelId: this.voiceId,
      guildId: this.guildId,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.audioPlayer = createAudioPlayer({ behaviors: { noSubscriber: NoSubscriberBehavior.Pause } });
    this.subscription = this.connection.subscribe(this.audioPlayer);
    if (!this.subscription) throw new Error('Failed to subscribe the audio player to the Discord voice connection.');

    this.audioPlayer.on(AudioPlayerStatus.Playing, () => {
      console.log(`[Music] Audio is playing in guild ${this.guildId}; voice=${this.voiceId}; volume=${this.volume}%.`);
    });
    this.audioPlayer.on(AudioPlayerStatus.Idle, () => this.onIdle().catch((error) => this.fail(error)));
    this.audioPlayer.on('error', (error) => this.fail(error));
  }

  setTextChannel(channelId) { this.textId = channelId; }
  async setVolume(value) {
    this.volume = Math.max(1, Math.min(200, Number(value || 100)));
    if (this.resource?.volume) this.resource.volume.setVolume(this.volume / 100);
  }
  setLoop(mode) { this.loop = ['none', 'track', 'queue'].includes(mode) ? mode : 'none'; }

  async play() {
    if (this.destroyed || this.playing) return;
    await entersState(this.connection, VoiceConnectionStatus.Ready, 15_000);
    await this.playNext();
  }

  async playNext() {
    if (this.destroyed) return;
    const track = this.queue.shift();
    if (!track) {
      this.queue.current = null;
      this.playing = false;
      this.paused = false;
      const channel = clientRef.channels.cache.get(this.textId);
      if (channel?.isTextBased() && !manualStopActive(this.guildId)) {
        await channel.send('🎵 Music queue finished. Leaving voice.').catch(() => null);
      }
      await this.destroy();
      return;
    }

    this.queue.current = track;
    this.playing = true;
    this.paused = false;

    try {
      // Normalize every source into a known PCM format. This avoids silent playback
      // caused by an incorrectly inferred WebM/Ogg/Opus stream type.
      const stream = await play.stream(track.uri, { discordPlayerCompatibility: false });
      const ffmpeg = new prism.FFmpeg({
        args: [
          '-analyzeduration', '0',
          '-loglevel', '0',
          '-f', 's16le',
          '-ar', '48000',
          '-ac', '2',
        ],
      });

      stream.stream.on('error', (error) => ffmpeg.destroy(error));
      stream.stream.pipe(ffmpeg);

      this.resource = createAudioResource(ffmpeg, {
        inputType: StreamType.Raw,
        inlineVolume: true,
        metadata: { title: track.title, uri: track.uri },
      });
      this.resource.volume?.setVolume(this.volume / 100);
      this.audioPlayer.play(this.resource);

      const channel = clientRef.channels.cache.get(this.textId);
      if (channel?.isTextBased()) {
        await channel.send({ embeds: [new EmbedBuilder()
          .setColor(0x6c5ce7)
          .setTitle('🎵 Now Playing')
          .setDescription(`**[${track.title}](${track.uri || 'https://discord.com'})**`)
          .addFields(
            { name: 'Artist', value: String(track.author || 'Unknown').slice(0, 1024), inline: true },
            { name: 'Duration', value: track.isStream ? 'Live stream' : formatDuration(track.length), inline: true },
          )
          .setTimestamp()] }).catch(() => null);
      }
    } catch (error) {
      console.error(`[Music] Stream failed for "${track.title}":`, error);
      const channel = clientRef.channels.cache.get(this.textId);
      if (channel?.isTextBased()) {
        await channel.send(`⚠️ Unable to stream **${track.title}**: ${String(error?.message || error).slice(0, 800)}`).catch(() => null);
      }
      this.queue.current = null;
      this.playing = false;
      await this.playNext();
    }
  }

  async onIdle() {
    if (this.destroyed || !this.queue.current) return;
    const finished = this.queue.current;
    this.queue.previous.unshift(finished);
    if (this.queue.previous.length > 20) this.queue.previous.length = 20;

    if (!this.skipping) {
      if (this.loop === 'track') this.queue.items.unshift(finished);
      else if (this.loop === 'queue') this.queue.items.push(finished);
    }
    this.skipping = false;
    this.queue.current = null;
    this.playing = false;
    this.paused = false;
    await this.playNext();
  }

  skip() {
    if (!this.queue.current) return false;
    this.skipping = true;
    return this.audioPlayer.stop(true);
  }

  pause(value = true) {
    if (value) {
      const changed = this.audioPlayer.pause();
      if (changed) { this.paused = true; this.playing = false; }
      return changed;
    }
    const changed = this.audioPlayer.unpause();
    if (changed) { this.paused = false; this.playing = true; }
    return changed;
  }

  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.queue.items.length = 0;
    this.queue.current = null;
    try { this.audioPlayer.stop(true); } catch {}
    try { this.connection.destroy(); } catch {}
    players.delete(this.guildId);
  }

  async fail(error) {
    console.error(`[Music] Local audio player error in guild ${this.guildId}:`, error);
    this.queue.current = null;
    this.playing = false;
    await this.playNext();
  }
}

const manager = {
  players,
  async search(query, options = {}) {
    return resolveTracks(query, options.requester);
  },
  async createPlayer(options) {
    const existing = players.get(options.guildId);
    if (existing) return existing;
    const player = new LocalMusicPlayer(manager, options);
    players.set(options.guildId, player);
    return player;
  },
};

function getMusicManager() { return initialized ? manager : null; }
function getMusicStatus() {
  return {
    state: initialized ? 'ready' : (musicGloballyEnabled() ? 'idle' : 'disabled'),
    ready: initialized && musicGloballyEnabled(),
    backend: '@discordjs/voice',
    sourceManagers: ['youtube'],
    plugins: [],
  };
}
function isMusicReady() { return initialized && musicGloballyEnabled(); }
function musicUnavailableMessage() {
  return musicGloballyEnabled()
    ? 'The local Discord voice music runtime has not finished initializing.'
    : 'The Music module is disabled by MUSIC_ENABLED.';
}
function lavalinkConfigured() { return true; }

async function initMusic(client) {
  clientRef = client;
  if (!musicGloballyEnabled()) {
    initialized = false;
    console.log('[Music] MUSIC_ENABLED is false; local voice runtime disabled.');
    return null;
  }
  initialized = true;
  console.log('[Music] Local @discordjs/voice runtime initialized; Lavalink is not required.');
  return manager;
}

async function waitForMusicConnection() { return isMusicReady(); }

function markManualStop(guildId, cooldownMs = 2_500) {
  manualStopUntil.set(String(guildId), Date.now() + Math.max(500, Number(cooldownMs || 2_500)));
}
function manualStopActive(guildId) {
  const key = String(guildId);
  const until = Number(manualStopUntil.get(key) || 0);
  if (until <= Date.now()) { manualStopUntil.delete(key); return false; }
  return true;
}
async function waitForManualStopCooldown(guildId) {
  const key = String(guildId);
  const remaining = Number(manualStopUntil.get(key) || 0) - Date.now();
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  manualStopUntil.delete(key);
}
async function probeLavalinkInfo() { return null; }

function stopMusic() {
  for (const player of [...players.values()]) player.destroy().catch(() => null);
  players.clear();
  manualStopUntil.clear();
  initialized = false;
}

module.exports = {
  initMusic,
  waitForMusicConnection,
  stopMusic,
  getMusicManager,
  getMusicStatus,
  probeLavalinkInfo,
  markManualStop,
  waitForManualStopCooldown,
  isMusicReady,
  musicUnavailableMessage,
  musicGloballyEnabled,
  lavalinkConfigured,
  formatDuration,
};
