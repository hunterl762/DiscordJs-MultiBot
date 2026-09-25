const { EmbedBuilder } = require('discord.js');

let Kazagumo = null;
let Connectors = null;
let kazagumo = null;
let initialized = false;

function loadMusicDependencies() {
  if (Kazagumo && Connectors) return true;

  try {
    ({ Kazagumo } = require('kazagumo'));
    ({ Connectors } = require('shoukaku'));
    return true;
  } catch (error) {
    console.error(
      '[Music] Kazagumo/Shoukaku dependencies are unavailable. Music will stay disabled; run npm install to enable it:',
      error?.message || error,
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
  return Boolean(process.env.LAVALINK_URL && process.env.LAVALINK_PASSWORD);
}

function lavalinkNode() {
  const raw = String(process.env.LAVALINK_URL || 'localhost:2333').trim();
  const secureFromUrl = /^wss:|^https:/i.test(raw);
  const url = raw.replace(/^wss?:\/\//i, '').replace(/^https?:\/\//i, '').replace(/\/$/, '');
  return {
    name: process.env.LAVALINK_NODE_NAME || 'MultiBot',
    url,
    auth: process.env.LAVALINK_PASSWORD || 'youshallnotpass',
    secure: secureFromUrl || envEnabled(process.env.LAVALINK_SECURE),
  };
}

function getMusicManager() {
  return kazagumo;
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

async function initMusic(client) {
  if (initialized) return kazagumo;
  initialized = true;

  if (!musicGloballyEnabled()) {
    console.log('[Music] MUSIC_ENABLED is false; music runtime disabled.');
    return null;
  }

  if (!lavalinkConfigured()) {
    console.warn('[Music] MUSIC_ENABLED is true, but LAVALINK_URL/LAVALINK_PASSWORD are not configured.');
    return null;
  }

  if (!loadMusicDependencies()) {
    initialized = false;
    return null;
  }

  kazagumo = new Kazagumo(
    {
      defaultSearchEngine: process.env.MUSIC_DEFAULT_SEARCH_ENGINE || 'youtube',
      send: (guildId, payload) => {
        const guild = client.guilds.cache.get(guildId);
        if (guild) guild.shard.send(payload);
      },
    },
    new Connectors.DiscordJS(client),
    [lavalinkNode()],
  );

  kazagumo.shoukaku.on('ready', (name) => console.log(`[Music] Lavalink node ${name} ready.`));
  kazagumo.shoukaku.on('error', (name, error) => console.error(`[Music] Lavalink node ${name} error:`, error));

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

  console.log('[Music] Kazagumo/Lavalink runtime initialized.');
  return kazagumo;
}

function stopMusic() {
  if (!kazagumo) return;
  for (const player of kazagumo.players.values()) {
    try { player.destroy(); } catch {}
  }
  kazagumo = null;
  initialized = false;
}

module.exports = { initMusic, stopMusic, getMusicManager, musicGloballyEnabled, lavalinkConfigured, formatDuration };
