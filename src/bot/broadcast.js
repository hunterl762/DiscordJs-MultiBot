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

  const settings = await getGuildSettings(guild.id);
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

function ownerDisplayName(owner) {
  if (!owner) return 'MultiBot Owner';
  return owner.displayName || owner.globalName || owner.username || owner.tag || 'MultiBot Owner';
}

function buildBroadcastPayload(channel, { title, message, owner }) {
  const me = channel.guild.members.me;
  const canEmbed = channel.permissionsFor(me)?.has(PermissionFlagsBits.EmbedLinks);
  const canMentionEveryone = channel.permissionsFor(me)?.has(PermissionFlagsBits.MentionEveryone);
  const sentAt = new Date();
  const sentUnix = Math.floor(sentAt.getTime() / 1000);
  const ownerName = ownerDisplayName(owner);
  const ownerAvatar = owner?.displayAvatarURL?.({ size: 128 }) || null;

  if (!canEmbed) {
    return {
      content: [
        '@everyone',
        '',
        `📢 **${title}**`,
        '',
        message,
        '',
        `**Broadcast by:** ${ownerName}`,
        `**Sent:** <t:${sentUnix}:F>`,
        `©️ ${sentAt.getFullYear()} MultiBot`,
      ].join('\n').slice(0, 2000),
      allowedMentions: { parse: canMentionEveryone ? ['everyone'] : [] },
    };
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({
      name: `Broadcast from ${ownerName}`,
      ...(ownerAvatar ? { iconURL: ownerAvatar } : {}),
    })
    .setTitle(`📢 ${title}`)
    .setDescription(message)
    .addFields(
      {
        name: '👤 Bot Owner',
        value: ownerName,
        inline: true,
      },
      {
        name: '🕒 Sent',
        value: `<t:${sentUnix}:F>\n<t:${sentUnix}:R>`,
        inline: true,
      },
      {
        name: '🌐 Server',
        value: channel.guild.name,
        inline: true,
      },
    )
    .setFooter({
      text: `©️ ${sentAt.getFullYear()} MultiBot • Owner Broadcast`,
      ...(me?.user?.displayAvatarURL?.({ size: 64 }) ? { iconURL: me.user.displayAvatarURL({ size: 64 }) } : {}),
    })
    .setTimestamp(sentAt);

  if (ownerAvatar) embed.setThumbnail(ownerAvatar);

  return {
    content: '@everyone',
    embeds: [embed],
    allowedMentions: { parse: canMentionEveryone ? ['everyone'] : [] },
  };
}

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
  });

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function broadcastToGuilds(client, { title = 'MultiBot Announcement', message, dryRun = false, owner = null } = {}) {
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

  const configuredDelay = Number(process.env.BROADCAST_DELAY_MS || 400);
  const delayMs = Number.isFinite(configuredDelay) ? Math.max(100, configuredDelay) : 400;
  const configuredTimeout = Number(process.env.BROADCAST_SERVER_TIMEOUT_MS || 8_000);
  const serverTimeoutMs = Number.isFinite(configuredTimeout) ? Math.max(2_000, configuredTimeout) : 8_000;

  for (const guild of client.guilds.cache.values()) {
    try {
      const channel = await withTimeout(findBroadcastChannel(guild), serverTimeoutMs, `${guild.name} channel discovery`);
      if (!channel) {
        results.skipped += 1;
        results.failures.push(`${guild.name}: no sendable text channel`);
        continue;
      }

      results.channels.push(`${guild.name} → #${channel.name}`);
      if (!dryRun) {
        await withTimeout(channel.send(buildBroadcastPayload(channel, { title, message, owner })), serverTimeoutMs, `${guild.name} broadcast send`);
        await sleep(delayMs);
      }
      results.delivered += 1;
    } catch (error) {
      results.failed += 1;
      results.failures.push(`${guild.name}: ${error.message || 'unknown error'}`);
      console.warn(`[Broadcast] Skipping ${guild.name}: ${error.message || 'unknown error'}`);
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
