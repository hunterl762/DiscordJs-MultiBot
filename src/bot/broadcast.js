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

function parseBroadcastColor(value) {
  const text = String(value || '').trim();
  if (!/^#[0-9a-f]{6}$/i.test(text)) return 0x5865f2;
  return Number.parseInt(text.slice(1), 16);
}

function safeHttpUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
}

function buildBroadcastPayload(channel, options = {}) {
  const {
    title = 'Kryndexa Bot Announcement',
    message,
    owner,
    color = '#5865F2',
    footer = '',
    imageUrl = '',
    thumbnailUrl = '',
    mentionEveryone = true,
  } = options;

  const me = channel.guild.members.me;
  const canEmbed = channel.permissionsFor(me)?.has(PermissionFlagsBits.EmbedLinks);
  const canMentionEveryone = channel.permissionsFor(me)?.has(PermissionFlagsBits.MentionEveryone);
  const shouldMentionEveryone = Boolean(mentionEveryone && canMentionEveryone);
  const sentAt = new Date();
  const sentUnix = Math.floor(sentAt.getTime() / 1000);
  const ownerName = ownerDisplayName(owner);
  const ownerAvatar = owner?.displayAvatarURL?.({ size: 128 }) || null;
  const cleanedImageUrl = safeHttpUrl(imageUrl);
  const cleanedThumbnailUrl = safeHttpUrl(thumbnailUrl);

  if (!canEmbed) {
    return {
      content: [
        shouldMentionEveryone ? '@everyone' : '',
        '',
        `📢 **${String(title || 'Kryndexa Bot Announcement').slice(0, 256)}**`,
        '',
        String(message || '').slice(0, 1600),
        '',
        `**Broadcast by:** ${ownerName}`,
        `**Sent:** <t:${sentUnix}:F>`,
      ].filter(Boolean).join('\n').slice(0, 2000),
      allowedMentions: { parse: shouldMentionEveryone ? ['everyone'] : [] },
    };
  }

  const embed = new EmbedBuilder()
    .setColor(parseBroadcastColor(color))
    .setAuthor({
      name: `Broadcast from ${ownerName}`,
      ...(ownerAvatar ? { iconURL: ownerAvatar } : {}),
    })
    .setTitle(String(title || 'Kryndexa Bot Announcement').slice(0, 256))
    .setDescription(String(message || '').slice(0, 4000))
    .addFields(
      { name: '👤 Bot Owner', value: ownerName, inline: true },
      { name: '🕒 Sent', value: `<t:${sentUnix}:F>\n<t:${sentUnix}:R>`, inline: true },
      { name: '🌐 Server', value: channel.guild.name, inline: true },
    )
    .setFooter({
      text: String(footer || `©️ ${sentAt.getFullYear()} Kryndexa Bot • Owner Broadcast`).slice(0, 2048),
      ...(me?.user?.displayAvatarURL?.({ size: 64 }) ? { iconURL: me.user.displayAvatarURL({ size: 64 }) } : {}),
    })
    .setTimestamp(sentAt);

  if (cleanedThumbnailUrl) embed.setThumbnail(cleanedThumbnailUrl);
  else if (ownerAvatar) embed.setThumbnail(ownerAvatar);
  if (cleanedImageUrl) embed.setImage(cleanedImageUrl);

  return {
    content: shouldMentionEveryone ? '@everyone' : undefined,
    embeds: [embed],
    allowedMentions: { parse: shouldMentionEveryone ? ['everyone'] : [] },
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

async function broadcastToGuilds(client, {
  title = 'Kryndexa Bot Announcement',
  message,
  dryRun = false,
  owner = null,
  color = '#5865F2',
  footer = '',
  imageUrl = '',
  thumbnailUrl = '',
  mentionEveryone = true,
} = {}) {
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
        await withTimeout(channel.send(buildBroadcastPayload(channel, {
          title,
          message,
          owner,
          color,
          footer,
          imageUrl,
          thumbnailUrl,
          mentionEveryone,
        })), serverTimeoutMs, `${guild.name} broadcast send`);
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
