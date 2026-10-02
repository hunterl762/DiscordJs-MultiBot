const { Player, QueueRepeatMode } = require('discord-player');
const { YoutubeSabrExtractor } = require('discord-player-googlevideo');

let clientRef = null;
let core = null;
let initialized = false;
const players = new Map();
const manualStopUntil = new Map();

const envEnabled = (value) => ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
const musicGloballyEnabled = () => envEnabled(process.env.MUSIC_ENABLED);

const ANSI = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

function musicLog(level, message) {
  const colors = { info: ANSI.cyan, success: ANSI.green, warn: ANSI.yellow, error: ANSI.red, debug: ANSI.gray };
  const icons = { info: 'ℹ', success: '✓', warn: '⚠', error: '✖', debug: '•' };
  const line = `${colors[level] || ANSI.cyan}[Music] ${icons[level] || '•'} ${message}${ANSI.reset}`;
  const raw = console._kryndexaOriginal;
  if (level === 'error') (raw?.error || console.error)(line);
  else if (level === 'warn') (raw?.warn || console.warn)(line);
  else (raw?.log || console.log)(line);
}

function formatDuration(ms) {
  const total = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

function decorateTrack(track) {
  if (!track) return track;
  try {
    if (!('uri' in track)) Object.defineProperty(track, 'uri', { configurable: true, get: () => track.url });
    if (!('realUri' in track)) Object.defineProperty(track, 'realUri', { configurable: true, get: () => track.url });
    if (!('length' in track)) Object.defineProperty(track, 'length', { configurable: true, get: () => Number(track.durationMS || 0) });
    if (!('isStream' in track)) Object.defineProperty(track, 'isStream', { configurable: true, get: () => Boolean(track.live) });
  } catch {}
  return track;
}

function trackArray(queue) {
  return (queue?.tracks?.toArray?.() || []).map(decorateTrack);
}

function isHttp(value) {
  return /^https?:\/\//i.test(String(value || ''));
}

function trackLabel(track) {
  const candidates = [track?.title, track?.cleanTitle, track?.raw?.title];
  for (const value of candidates) {
    const text = String(value || '').trim();
    if (text && !isHttp(text) && text.toLowerCase() !== 'track') return text;
  }
  return String(track?.url || 'unknown track').trim();
}

function parseYouTubeUrl(value) {
  try {
    const url = new URL(String(value || ''));
    if (!/(^|\.)youtube\.com$|(^|\.)youtu\.be$/i.test(url.hostname)) return null;
    const list = url.searchParams.get('list');
    let video = '';
    if (/youtu\.be$/i.test(url.hostname)) video = url.pathname.split('/').filter(Boolean)[0] || '';
    else if (url.pathname === '/watch') video = url.searchParams.get('v') || '';
    else if (url.pathname.startsWith('/shorts/')) video = url.pathname.split('/')[2] || '';
    const explicitPlaylist = url.pathname === '/playlist';
    const radio = Boolean(list && /^RD/i.test(list));
    return { url, video, list, explicitPlaylist, radio, isPlaylist: Boolean(explicitPlaylist || list) };
  } catch {
    return null;
  }
}

function canonicalYouTubeVideo(value) {
  const info = parseYouTubeUrl(value);
  return info?.video ? `https://www.youtube.com/watch?v=${encodeURIComponent(info.video)}` : String(value || '');
}

class QueueAdapter {
  constructor(owner) { this.owner = owner; }
  get current() { return decorateTrack(this.owner.dpQueue.currentTrack); }
  get length() { return Number(this.owner.dpQueue.size || trackArray(this.owner.dpQueue).length); }
  add(value) { Array.isArray(value) ? this.owner.dpQueue.addTrack(value) : this.owner.dpQueue.addTrack(value); }
  shuffle() { this.owner.dpQueue.tracks?.shuffle?.(); }
  [Symbol.iterator]() { return trackArray(this.owner.dpQueue)[Symbol.iterator](); }
}

class PlayerAdapter {
  constructor(managerRef, dpQueue, options) {
    this.manager = managerRef;
    this.dpQueue = dpQueue;
    this.guildId = String(options.guildId);
    this.textId = options.textId;
    this.voiceId = options.voiceId;
    this.queue = new QueueAdapter(this);
    this.loop = 'none';
    this.destroyed = false;
  }

  get playing() { return Boolean(this.dpQueue?.node?.isPlaying?.()); }
  get paused() { return Boolean(this.dpQueue?.node?.isPaused?.()); }
  get volume() { return Number(this.dpQueue?.node?.volume ?? 100); }
  get position() { return Number(this.dpQueue?.node?.streamTime ?? this.dpQueue?.node?.estimatedPlaybackTime ?? 0); }

  setTextChannel(id) {
    this.textId = id;
    if (this.dpQueue?.metadata) this.dpQueue.metadata.textId = id;
  }

  async ensureVoice() {
    const guild = clientRef?.guilds?.cache?.get(this.guildId);
    const channel = guild?.channels?.cache?.get(String(this.voiceId || ''));
    if (!guild || !channel) throw new Error('The original voice channel is no longer available.');

    let queue = core.nodes.get(this.guildId);
    if (!queue) {
      const pending = [...(this.dpQueue?.currentTrack ? [this.dpQueue.currentTrack] : []), ...trackArray(this.dpQueue)];
      queue = core.nodes.create(guild, { metadata: { textId: this.textId, voiceId: this.voiceId } });
      if (pending.length) queue.addTrack(pending);
      this.dpQueue = queue;
    } else if (queue !== this.dpQueue) {
      this.dpQueue = queue;
    }

    if (!queue.connection || queue.channel?.id !== channel.id) await queue.connect(channel);
    this.destroyed = false;
    musicLog('debug', `Voice connection verified | guild=${this.guildId} | voice=${this.voiceId}`);
    return queue;
  }

  async play() {
    const queue = await this.ensureVoice();
    if (!queue.currentTrack) await queue.node.play();
  }

  skip() { return this.dpQueue.node.skip(); }
  pause(value = true) { return value ? this.dpQueue.node.pause() : this.dpQueue.node.resume(); }
  async setVolume(value) { return this.dpQueue.node.setVolume(Math.max(1, Math.min(200, Number(value || 100)))); }

  setLoop(mode) {
    this.loop = ['track', 'queue'].includes(mode) ? mode : 'none';
    this.dpQueue.setRepeatMode(
      this.loop === 'track' ? QueueRepeatMode.TRACK : this.loop === 'queue' ? QueueRepeatMode.QUEUE : QueueRepeatMode.OFF,
    );
  }

  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    try { this.dpQueue.clear(); } catch {}
    try { this.dpQueue.node.stop(true); } catch {}
    try { this.dpQueue.delete(); } catch {}
    players.delete(this.guildId);
  }
}

async function searchYouTube(value, requester) {
  const info = parseYouTubeUrl(value);

  // YouTube radio/mix URLs are dynamic and do not behave like normal playlists.
  // Preserve the exact seed video rather than silently substituting a different track.
  if (info?.radio && info.video) {
    const exact = canonicalYouTubeVideo(value);
    musicLog('info', `YouTube radio/mix detected; playing exact seed video=${info.video}.`);
    const result = await core.search(exact, {
      requestedBy: requester,
      searchEngine: `ext:${YoutubeSabrExtractor.identifier}`,
    });
    return { tracks: (result?.tracks || []).map(decorateTrack), type: 'TRACK', playlist: null };
  }

  if (info?.isPlaylist) {
    musicLog('info', `YouTube playlist detected; preserving list=${info.list || 'playlist'}.`);
  } else if (info?.video) {
    musicLog('info', `YouTube video detected; preserving video=${info.video}.`);
  }

  const query = info ? value : `ytsearch:${value}`;
  const result = await core.search(query, {
    requestedBy: requester,
    searchEngine: `ext:${YoutubeSabrExtractor.identifier}`,
  });
  const tracks = (result?.tracks || []).map(decorateTrack);
  return {
    tracks,
    type: result?.playlist ? 'PLAYLIST' : (info?.video && tracks.length === 1 ? 'TRACK' : 'SEARCH'),
    playlist: result?.playlist || null,
  };
}

const manager = {
  players,

  async search(query, options = {}) {
    if (!core) throw new Error('Discord Player is not initialized.');
    const value = String(query || '').trim();
    if (!value) return { tracks: [], type: 'SEARCH', playlist: null };

    // Kryndexa music is intentionally YouTube-only. Non-YouTube URLs are rejected
    // instead of being handed to SoundCloud or another provider.
    if (isHttp(value) && !parseYouTubeUrl(value)) {
      musicLog('warn', `Rejected non-YouTube URL: ${value}`);
      return { tracks: [], type: 'SEARCH', playlist: null };
    }

    const result = await searchYouTube(value, options.requester);
    musicLog('success', `Search resolved with YouTube SABR: ${result.tracks.length} track(s).`);
    return result;
  },

  async createPlayer(options) {
    const guildId = String(options.guildId);
    const old = players.get(guildId);
    if (old && !old.destroyed) {
      old.voiceId = options.voiceId || old.voiceId;
      old.textId = options.textId || old.textId;
      await old.ensureVoice();
      return old;
    }

    const guild = clientRef.guilds.cache.get(guildId);
    const channel = guild?.channels?.cache?.get(String(options.voiceId));
    if (!guild || !channel) throw new Error('Voice channel is unavailable.');

    let queue = core.nodes.get(guildId);
    if (!queue) queue = core.nodes.create(guild, { metadata: { textId: options.textId, voiceId: options.voiceId } });
    await queue.connect(channel);
    queue.node.setVolume(Math.max(1, Math.min(200, Number(options.volume || 75))));

    const adapter = new PlayerAdapter(manager, queue, options);
    players.set(guildId, adapter);
    return adapter;
  },
};

function bindEvents() {
  core.events.on('playerStart', (queue, track) => {
    const id = String(queue.guild.id);
    const player = players.get(id);
    if (player) {
      player.dpQueue = queue;
      player.voiceId = queue.channel?.id || player.voiceId;
    }
    musicLog('success', `Audio resource started: ${trackLabel(track)} | source=youtube | extractor=${track?.extractor?.identifier || YoutubeSabrExtractor.identifier} | ${track?.url || 'no-url'}`);
  });

  core.events.on('playerError', (queue, error, track) => {
    musicLog('error', `YouTube playback failed for ${trackLabel(track)}: ${error?.message || error}`);
    musicLog('debug', `Track source=${track?.source || 'youtube'} extractor=${track?.extractor?.identifier || YoutubeSabrExtractor.identifier} url=${track?.url || 'unknown'}`);
    musicLog('warn', 'Exact YouTube track could not be streamed; Kryndexa will not substitute SoundCloud or another provider.');
  });

  core.events.on('error', (queue, error) => musicLog('error', `Queue error guild=${queue?.guild?.id || 'unknown'}: ${error?.message || error}`));
  core.events.on('playerPause', (queue) => musicLog('info', `Paused guild=${queue.guild.id}`));
  core.events.on('playerResume', (queue) => musicLog('info', `Resumed guild=${queue.guild.id}`));
  core.events.on('playerSkip', (queue, track) => musicLog('warn', `Skipped: ${trackLabel(track)} | guild=${queue.guild.id}`));
  core.events.on('queueDelete', (queue) => {
    const id = String(queue.guild.id);
    const player = players.get(id);
    if (player?.dpQueue === queue) players.delete(id);
    musicLog('debug', `Queue removed guild=${id}`);
  });
  core.events.on('debug', (queue, message) => {
    if (envEnabled(process.env.MUSIC_DEBUG)) musicLog('debug', `${queue?.guild?.id || 'player'} | ${message}`);
  });
}

async function initMusic(client) {
  clientRef = client;
  if (!musicGloballyEnabled()) {
    initialized = false;
    musicLog('warn', 'MUSIC_ENABLED is false; Discord Player runtime disabled.');
    return null;
  }

  try {
    core = new Player(client, { skipFFmpeg: false });
    if (!YoutubeSabrExtractor?.identifier) {
      throw new Error('discord-player-googlevideo did not export YoutubeSabrExtractor. Run npm install to refresh dependencies.');
    }

    await core.extractors.register(YoutubeSabrExtractor, {});
    bindEvents();
    initialized = true;

    musicLog('info', 'Backend: Discord Player v7 + GoogleVideo YouTube SABR');
    musicLog('info', 'Provider policy: YouTube only; SoundCloud and alternate-provider fallback are disabled');
    musicLog('info', 'YouTube handling: exact video IDs preserved; standard playlists expanded; radio/mixes preserve the exact seed video');
    musicLog('info', 'Streaming: GoogleVideo SABR audio-only -> FFmpeg -> Discord voice');
    musicLog('info', 'yt-dlp and exported YouTube cookie files: not used by Kryndexa music manager');
    musicLog('success', 'YouTube-only SABR music runtime initialized.');
    return manager;
  } catch (error) {
    initialized = false;
    musicLog('error', `Music initialization failed: ${error?.stack || error}`);
    return null;
  }
}

function getMusicManager() { return initialized ? manager : null; }
function getMusicStatus() {
  return {
    state: initialized ? 'ready' : (musicGloballyEnabled() ? 'idle' : 'disabled'),
    ready: initialized && musicGloballyEnabled(),
    backend: 'Discord Player v7 + GoogleVideo YouTube SABR',
    sourceManagers: ['youtube-sabr'],
    plugins: ['discord-player-googlevideo'],
  };
}
function isMusicReady() { return initialized && musicGloballyEnabled(); }
function musicUnavailableMessage() { return musicGloballyEnabled() ? 'The Discord Player music runtime has not finished initializing.' : 'The Music module is disabled by MUSIC_ENABLED.'; }
function lavalinkConfigured() { return false; }
async function waitForMusicConnection() { return isMusicReady(); }
function markManualStop(id, ms = 2500) { manualStopUntil.set(String(id), Date.now() + Math.max(500, Number(ms || 2500))); }
async function waitForManualStopCooldown(id) {
  const key = String(id);
  const remaining = Number(manualStopUntil.get(key) || 0) - Date.now();
  if (remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  manualStopUntil.delete(key);
}
async function probeLavalinkInfo() { return null; }
function stopMusic() {
  for (const player of [...players.values()]) player.destroy().catch(() => null);
  players.clear();
  manualStopUntil.clear();
  try { core?.destroy?.(); } catch {}
  core = null;
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
