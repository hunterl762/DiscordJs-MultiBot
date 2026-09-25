const {
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { getGuildSettings } = require('../store');

const BROADCAST_FALLBACK_NAMES = [
  'announcements',
  'announcement',
  'updates',
  'general',
  'chat',
  'lobby',
  'bot-commands',
];

function configuredOwnerIds() {
  return new Set(
    String(process.env.BOT_OWNER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  );
}

async function isBotOwner(client, userId) {
  const configured = configuredOwnerIds();
  if (configured.size) return configured.has(userId);

  try {
    const application = await client.application.fetch();
    const owner = application.owner;
    if (!owner) return false;
    if (owner.id === userId) return true;
    if (owner.members?.has?.(userId)) return true;
    return [...(owner.members?.values?.() || [])].some((member) => member.id === userId || member.user?.id === userId);
  } catch (error) {
    console.error('Unable to verify bot owner:', error);
    return false;
  }
}

function isBroadcastChannel(channel) {
  return channel && [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type);
}

function canSendTo(channel, me) {
  if (!isBroadcastChannel(channel) || !me) return false;
  const permissions = channel.permissionsFor(me);
  return Boolean(
    permissions?.has(PermissionFlagsBits.ViewChannel)
    && permissions.has(PermissionFlagsBits.SendMessages),
  );
}

async function findBroadcastChannel(guild) {
  const me = guild.members.me || await guild.members.fetchMe().catch(() => null);
  if (!me) return null;

  const settings = getGuildSettings(guild.id);
  const preferredIds = [settings.broadcastChannelId, guild.systemChannelId].filter(Boolean);
  for (const id of preferredIds) {
    const channel = guild.channels.cache.get(id);
    if (canSendTo(channel, me)) return channel;
  }

  const channels = [...guild.channels.cache.values()]
    .filter((channel) => canSendTo(channel, me))
    .sort((a, b) => a.rawPosition - b.rawPosition);

  for (const name of BROADCAST_FALLBACK_NAMES) {
    const match = channels.find((channel) => channel.name.toLowerCase() === name);
    if (match) return match;
  }

  return channels.find((channel) => !channel.name.toLowerCase().startsWith('ticket-')) || null;
}

function buildBroadcastPayload(channel, { title, message }) {
  const me = channel.guild.members.me;
  const canEmbed = channel.permissionsFor(me)?.has(PermissionFlagsBits.EmbedLinks);
  if (!canEmbed) {
    return {
      content: `**${title}**\n${message}`.slice(0, 2000),
      allowedMentions: { parse: [] },
    };
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(title)
        .setDescription(message)
        .setFooter({ text: 'MultiBot Owner Broadcast' })
        .setTimestamp(),
    ],
    allowedMentions: { parse: [] },
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function broadcastToGuilds(client, { title = 'MultiBot Announcement', message, dryRun = false } = {}) {
  if (!message?.trim()) throw new Error('Broadcast message is required.');

  const results = {
    total: client.guilds.cache.size,
    delivered: 0,
    skipped: 0,
    failed: 0,
    dryRun: Boolean(dryRun),
    failures: [],
    channels: [],
  };

  const delayMs = Math.max(100, Number(process.env.BROADCAST_DELAY_MS || 400));

  for (const guild of client.guilds.cache.values()) {
    try {
      const channel = await findBroadcastChannel(guild);
      if (!channel) {
        results.skipped += 1;
        results.failures.push(`${guild.name}: no sendable text channel`);
        continue;
      }

      results.channels.push(`${guild.name} → #${channel.name}`);
      if (!dryRun) {
        await channel.send(buildBroadcastPayload(channel, { title, message }));
        await sleep(delayMs);
      }
      results.delivered += 1;
    } catch (error) {
      results.failed += 1;
      results.failures.push(`${guild.name}: ${error.message || 'unknown error'}`);
    }
  }

  return results;
}

function formatBroadcastSummary(results) {
  const action = results.dryRun ? 'would receive' : 'received';
  const lines = [
    `Broadcast ${results.dryRun ? 'dry run' : 'complete'}.`,
    `• ${results.delivered}/${results.total} server(s) ${action} the announcement.`,
    `• ${results.skipped} skipped (no sendable channel).`,
    `• ${results.failed} failed while sending.`,
  ];

  if (results.failures.length) {
    lines.push('', '**First delivery issues:**', ...results.failures.slice(0, 10).map((item) => `• ${item}`));
    if (results.failures.length > 10) lines.push(`• …and ${results.failures.length - 10} more.`);
  }

  return lines.join('\n').slice(0, 1900);
}

module.exports = {
  isBotOwner,
  findBroadcastChannel,
  broadcastToGuilds,
  formatBroadcastSummary,
};
