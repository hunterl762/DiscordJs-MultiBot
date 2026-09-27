const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { getFeature } = require('../features/store');
const {
  getMusicManager,
  getMusicStatus,
  markManualStop,
  waitForManualStopCooldown,
  isMusicReady,
  musicUnavailableMessage,
  musicGloballyEnabled,
  formatDuration,
} = require('./manager');

async function musicContext(source) {
  const guild = source.guild;
  if (!guild) return { error: 'Music commands must be used in a server.' };

  let member = source.member;
  const userId = source.user?.id || source.author?.id || member?.id;
  if (!member?.voice?.channel && userId) {
    member = await guild.members.fetch(userId).catch(() => member);
  }

  const channel = member?.voice?.channel;
  if (!musicGloballyEnabled()) return { error: 'The Music module is disabled by MUSIC_ENABLED.' };

  const feature = await getFeature(guild.id, 'music');
  if (!feature?.enabled) return { error: 'The Music module is disabled for this server.' };
  if (!channel) return { error: 'Join a voice channel before using music commands.' };

  const permissions = channel.permissionsFor(guild.members.me);
  if (!permissions?.has(PermissionFlagsBits.Connect) || !permissions.has(PermissionFlagsBits.Speak)) {
    return { error: 'I need Connect and Speak permissions in your voice channel.' };
  }

  const manager = getMusicManager();
  if (!manager || !isMusicReady()) {
    return {
      error: musicUnavailableMessage(),
      musicStatus: getMusicStatus(),
    };
  }

  return { guild, member, channel, feature, manager, musicStatus: getMusicStatus() };
}

function configuredSearchEngines() {
  return ['youtube'];
}

async function searchMusic(manager, query, requester) {
  const value = String(query || '').trim();
  if (!value) return { result: { tracks: [], type: 'SEARCH' }, engine: null, attempts: [] };

  const isUrl = /^https?:\/\//i.test(value);
  const attempts = [];

  if (isUrl) {
    try {
      const result = await manager.search(value, { requester });
      return { result, engine: 'direct-url', attempts: ['direct-url'] };
    } catch (error) {
      attempts.push(`direct-url: ${error?.message || error}`);
      return { result: { tracks: [], type: 'SEARCH' }, engine: null, attempts };
    }
  }

  for (const engine of configuredSearchEngines()) {
    try {
      const result = await manager.search(value, { requester, engine });
      attempts.push(engine);

      if (result?.tracks?.length) {
        return { result, engine, attempts };
      }
    } catch (error) {
      attempts.push(`${engine}: ${error?.message || error}`);
    }
  }

  return { result: { tracks: [], type: 'SEARCH' }, engine: null, attempts };
}

function noTracksMessage(query) {
  const value = String(query || '').trim();
  if (/^https?:\/\//i.test(value)) {
    return 'No playable track was found for that URL. The local music backend currently accepts YouTube video and playlist URLs.';
  }
  return 'No playable tracks were found for that search.';
}

function existingPlayer(manager, guildId) { return manager?.players?.get(guildId) || null; }
function sameVoiceChannel(player, member) { return !player || !player.voiceId || player.voiceId === member?.voice?.channelId; }

async function replySlash(interaction, content, ephemeral = false) {
  const payload = typeof content === 'string' ? { content } : content;
  if (ephemeral) payload.flags = MessageFlags.Ephemeral;
  if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
  return interaction.reply(payload);
}

async function replyPrefix(message, content) {
  return message.reply(typeof content === 'string' ? { content } : content);
}

function trackLine(track, index = null) {
  const prefix = index == null ? '' : `**${index}.** `;
  const duration = track?.isStream ? 'LIVE' : formatDuration(track?.length);
  const title = String(track?.title || 'Unknown track').slice(0, 90);
  const uri = track?.uri || track?.realUri;
  return `${prefix}${uri ? `[${title}](${uri})` : title} • ${duration}`;
}

module.exports = {
  musicContext,
  searchMusic,
  markManualStop,
  waitForManualStopCooldown,
  noTracksMessage,
  existingPlayer,
  sameVoiceChannel,
  replySlash,
  replyPrefix,
  trackLine,
  formatDuration,
};
