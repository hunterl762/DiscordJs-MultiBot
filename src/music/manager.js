const { EmbedBuilder } = require('discord.js');

let Kazagumo = null;
let Connectors = null;
let kazagumo = null;
let initialized = false;

const connectionState = {
  state: 'idle',
  ready: false,
  nodeName: '',
  endpoint: '',
  secure: false,
  lastError: '',
  changedAt: null,
};

function setConnectionState(state, updates = {}) {
  connectionState.state = state;
  connectionState.ready = state === 'ready';
  connectionState.changedAt = new Date().toISOString();
  Object.assign(connectionState, updates);
}

function loadMusicDependencies() {
  if (Kazagumo && Connectors) return true;

  try {
    ({ Kazagumo } = require('kazagumo'));
    ({ Connectors } = require('shoukaku'));
    return true;
  } catch (error) {
    const message = error?.message || String(error);
    setConnectionState('dependency_error', { lastError: message });
    console.error(
      '[Music] Kazagumo/Shoukaku dependencies are unavailable. Music will stay disabled; run npm install to enable it:',
      message,
    );
    return false;
  }
}

function envEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function musicGloballyEnabled() {
  return envEnabled(process.env.MUSIC_ENABLED);
}

function lavalinkConfigured() {
  return Boolean(
    String(process.env.LAVALINK_URL || '').trim()
    && String(process.env.LAVALINK_PASSWORD || '').trim(),
  );
}

function lavalinkNode() {
  const raw = String(process.env.LAVALINK_URL || '127.0.0.1:2333').trim();
  const secureFromUrl = /^(?:wss|https):/i.test(raw);
  const url = raw
    .replace(/^wss?:\/\//i, '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '');

  return {
    name: String(process.env.LAVALINK_NODE_NAME || 'Kryndexa').trim() || 'Kryndexa',
    url,
    auth: String(process.env.LAVALINK_PASSWORD || ''),
    secure: secureFromUrl || envEnabled(process.env.LAVALINK_SECURE),
  };
}

function getMusicManager() {
  return kazagumo;
}

function getMusicStatus() {
  return { ...connectionState };
}

function isMusicReady() {
  return Boolean(kazagumo && connectionState.ready);
}

function musicUnavailableMessage() {
  if (!musicGloballyEnabled()) {
    return 'The Music module is disabled by MUSIC_ENABLED.';
  }

  if (!lavalinkConfigured()) {
    return 'Music is enabled, but LAVALINK_URL or LAVALINK_PASSWORD is missing.';
  }

  const status = getMusicStatus();

  if (status.state === 'dependency_error') {
    return 'The music dependencies are unavailable. Run npm install and restart the bot.';
  }

  if (status.state === 'connecting') {
    return `Lavalink is still connecting to ${status.endpoint || 'the configured node'}. Try the command again in a few seconds.`;
  }

  if (status.state === 'error') {
    return `Lavalink connection failed${status.endpoint ? ` for ${status.endpoint}` : ''}: ${status.lastError || 'unknown connection error'}`;
  }

  if (status.state === 'closed' || status.state === 'disconnected') {
    return `Lavalink disconnected${status.endpoint ? ` from ${status.endpoint}` : ''}${status.lastError ? `: ${status.lastError}` : '.'}`;
  }

  if (status.state === 'timeout') {
    return `Lavalink did not become ready within the startup timeout${status.endpoint ? ` at ${status.endpoint}` : ''}. Check the Lavalink console, port, password, and LAVALINK_SECURE setting.`;
  }

  return 'The Lavalink music service has not finished initializing yet.';
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

async function waitForMusicReady(timeoutMs) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (connectionState.ready) return true;

    // Stop waiting early for failures that will not resolve without configuration changes.
    if (['dependency_error', 'disabled', 'unconfigured'].includes(connectionState.state)) {
      return false;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  return connectionState.ready;
}

async function initMusic(client, { waitForReady = true } = {}) {
  if (initialized) return kazagumo;
  initialized = true;

  if (!musicGloballyEnabled()) {
    setConnectionState('disabled', {
      nodeName: '',
      endpoint: '',
      secure: false,
      lastError: '',
    });
    console.log('[Music] MUSIC_ENABLED is false; music runtime disabled.');
    return null;
  }

  if (!lavalinkConfigured()) {
    setConnectionState('unconfigured', {
      nodeName: '',
      endpoint: '',
      secure: false,
      lastError: 'LAVALINK_URL or LAVALINK_PASSWORD is missing.',
    });
    console.warn('[Music] MUSIC_ENABLED is true, but LAVALINK_URL/LAVALINK_PASSWORD are not configured.');
    return null;
  }

  if (!loadMusicDependencies()) {
    initialized = false;
    return null;
  }

  const node = lavalinkNode();
  const endpoint = `${node.secure ? 'wss' : 'ws'}://${node.url}`;
  const connectTimeoutMs = Math.max(
    1_000,
    Number(process.env.LAVALINK_CONNECT_TIMEOUT_MS || 15_000),
  );

  setConnectionState('connecting', {
    nodeName: node.name,
    endpoint,
    secure: node.secure,
    lastError: '',
  });

  console.log(
    `[Music] Connecting to Lavalink node ${node.name} at ${endpoint} (timeout ${connectTimeoutMs}ms)...`,
  );

  try {
    kazagumo = new Kazagumo(
      {
        defaultSearchEngine: process.env.MUSIC_DEFAULT_SEARCH_ENGINE || 'youtube',
        send: (guildId, payload) => {
          const guild = client.guilds.cache.get(guildId);
          if (guild) guild.shard.send(payload);
        },
      },
      new Connectors.DiscordJS(client),
      [node],
    );
  } catch (error) {
    const message = error?.message || String(error);
    kazagumo = null;
    initialized = false;
    setConnectionState('error', { lastError: message });
    console.error('[Music] Failed to initialize Kazagumo/Shoukaku:', error);
    return null;
  }

  kazagumo.shoukaku.on('ready', (name, reconnected) => {
    setConnectionState('ready', {
      nodeName: String(name || node.name),
      endpoint,
      secure: node.secure,
      lastError: '',
    });
    console.log(
      `[Music] Lavalink node ${name || node.name} ready at ${endpoint}${reconnected ? ' (reconnected)' : ''}.`,
    );
  });

  kazagumo.shoukaku.on('error', (name, error) => {
    const message = error?.message || String(error);
    setConnectionState('error', {
      nodeName: String(name || node.name),
      endpoint,
      lastError: message,
    });
    console.error(`[Music] Lavalink node ${name || node.name} error at ${endpoint}:`, error);
  });

  kazagumo.shoukaku.on('close', (name, code, reason) => {
    const reasonText = String(reason || '').trim();
    const detail = [
      Number.isFinite(Number(code)) ? `code ${code}` : '',
      reasonText,
    ].filter(Boolean).join(' • ');

    setConnectionState('closed', {
      nodeName: String(name || node.name),
      endpoint,
      lastError: detail,
    });
    console.warn(
      `[Music] Lavalink node ${name || node.name} closed at ${endpoint}${detail ? `: ${detail}` : ''}.`,
    );
  });

  kazagumo.shoukaku.on('disconnect', (name) => {
    setConnectionState('disconnected', {
      nodeName: String(name || node.name),
      endpoint,
      lastError: 'WebSocket disconnected.',
    });
    console.warn(`[Music] Lavalink node ${name || node.name} disconnected from ${endpoint}.`);
  });

  kazagumo.on('playerStart', (player, track) => {
    const channel = client.channels.cache.get(player.textId);
    if (!channel?.isTextBased()) return;
    channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0x6c5ce7)
        .setTitle('🎵 Now Playing')
        .setDescription(`**[${track.title}](${track.uri || track.realUri || 'https://discord.com'})**`)
        .addFields(
          { name: 'Artist', value: String(track.author || 'Unknown').slice(0, 1024), inline: true },
          { name: 'Duration', value: track.isStream ? 'Live stream' : formatDuration(track.length), inline: true },
        )
        .setTimestamp()],
    }).catch(() => null);
  });

  kazagumo.on('playerEmpty', (player) => {
    const channel = client.channels.cache.get(player.textId);
    if (channel?.isTextBased()) channel.send('🎵 Music queue finished. Leaving voice.').catch(() => null);
    player.destroy();
  });

  console.log('[Music] Kazagumo/Shoukaku runtime initialized; waiting for Discord clientReady before node connection.');

  if (!waitForReady) return kazagumo;

  await waitForMusicConnection(connectTimeoutMs);
  return kazagumo;
}

async function waitForMusicConnection(timeoutMs = null) {
  if (!kazagumo) return false;
  if (connectionState.ready) return true;

  const effectiveTimeout = Math.max(
    1_000,
    Number(timeoutMs || process.env.LAVALINK_CONNECT_TIMEOUT_MS || 15_000),
  );

  const ready = await waitForMusicReady(effectiveTimeout);

  if (!ready) {
    if (connectionState.state === 'connecting') {
      setConnectionState('timeout', {
        lastError: `Node did not emit ready within ${effectiveTimeout}ms after Discord clientReady.`,
      });
    }

    console.warn(
      `[Music] Lavalink node is not ready after startup wait. State=${connectionState.state}; endpoint=${connectionState.endpoint || 'unknown'}; lastError=${connectionState.lastError || 'none'}.`,
    );
  }

  return ready;
}

function stopMusic() {
  if (kazagumo) {
    for (const player of kazagumo.players.values()) {
      try { player.destroy(); } catch {}
    }
  }

  kazagumo = null;
  initialized = false;
  setConnectionState('idle', {
    ready: false,
    nodeName: '',
    endpoint: '',
    secure: false,
    lastError: '',
  });
}

module.exports = {
  initMusic,
  waitForMusicConnection,
  stopMusic,
  getMusicManager,
  getMusicStatus,
  isMusicReady,
  musicUnavailableMessage,
  musicGloballyEnabled,
  lavalinkConfigured,
  formatDuration,
};
