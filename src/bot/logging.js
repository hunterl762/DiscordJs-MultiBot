const {
  AuditLogEvent,
  EmbedBuilder,
} = require('discord.js');
const { getGuildSettings } = require('../store');
const { getFeature } = require('../features/store');

function truncate(value, max = 1000) {
  const text = String(value ?? '');
  if (text.length <= max) return text || 'None';
  return `${text.slice(0, Math.max(0, max - 1))}…`;
}

async function resolveLogChannel(guild, kind = 'general') {
  const settings = await getGuildSettings(guild.id);
  const loggingFeature = await getFeature(guild.id, 'logging');
  if (!settings.loggingEnabled || loggingFeature?.enabled === false) return { settings, channel: null };

  let channelId = settings.logsChannelId;
  if (kind === 'verification') channelId = settings.verificationLogChannelId || settings.logsChannelId;
  if (kind === 'role') channelId = settings.roleLogChannelId || settings.logsChannelId;

  const channel = channelId
    ? guild.channels.cache.get(channelId)
    : guild.channels.cache.find((item) => item.name === 'logs' && item.isTextBased());

  return {
    settings,
    channel: channel?.isTextBased?.() ? channel : null,
  };
}

function baseEmbed(guild, title, color) {
  return new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setFooter({ text: `${guild.name} • ${guild.id}` })
    .setTimestamp();
}

async function sendLog(guild, kind, embed) {
  try {
    const { channel } = await resolveLogChannel(guild, kind);
    if (!channel) return false;

    await channel.send({
      embeds: [embed],
      allowedMentions: { parse: [] },
    });

    return true;
  } catch (error) {
    console.error(`[Logging] Failed to send ${kind} log in ${guild?.name || 'unknown guild'}:`, error);
    return false;
  }
}

async function findRecentAuditEntry(guild, type, targetId, maxAgeMs = 15_000) {
  try {
    const logs = await guild.fetchAuditLogs({ type, limit: 6 });
    const now = Date.now();

    return logs.entries.find((entry) => {
      const targetMatches = !targetId || entry.targetId === targetId || entry.target?.id === targetId;
      const recent = now - entry.createdTimestamp <= maxAgeMs;
      return targetMatches && recent;
    }) || null;
  } catch {
    return null;
  }
}

function auditActorText(entry) {
  if (!entry?.executor) return 'Unknown / not available';
  return `${entry.executor.tag || entry.executor.username} (${entry.executor.id})`;
}

module.exports = {
  AuditLogEvent,
  auditActorText,
  baseEmbed,
  findRecentAuditEntry,
  sendLog,
  truncate,
};
