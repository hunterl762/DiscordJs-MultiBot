const { EmbedBuilder } = require('discord.js');

function avatarEmbed(user) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${user.tag}'s avatar`)
    .setImage(user.displayAvatarURL({ size: 1024 }));
}

function userInfoEmbed(user, member) {
  const presence = member?.presence;
  const statusMap = {
    online: '🟢 Online',
    idle: '🌙 Idle',
    dnd: '⛔ Do Not Disturb',
    offline: '⚫ Offline',
  };
  const status = statusMap[presence?.status] || '⚫ Offline / unavailable';
  const clientStatus = presence?.clientStatus
    ? Object.keys(presence.clientStatus).map((client) => client[0].toUpperCase() + client.slice(1)).join(', ')
    : 'Unavailable';
  const activities = presence?.activities?.length
    ? presence.activities.map((activity) => {
        if (activity.type === 4) return `Custom Status: ${activity.state || 'No text'}`;
        return [activity.name, activity.details, activity.state].filter(Boolean).join(' • ') || 'Activity';
      }).slice(0, 5).join('\n')
    : 'No visible activity';

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(user.tag)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: 'User ID', value: user.id, inline: true },
      { name: 'Status', value: status, inline: true },
      { name: 'Client', value: clientStatus, inline: true },
      { name: 'Activity', value: activities.slice(0, 1024), inline: false },
      { name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>` },
      { name: 'Joined Server', value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : 'Unknown' },
    );
}

function serverInfoEmbed(guild) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(guild.name)
    .setThumbnail(guild.iconURL())
    .addFields(
      { name: 'Members', value: String(guild.memberCount), inline: true },
      { name: 'Channels', value: String(guild.channels.cache.size), inline: true },
      { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>` },
      { name: 'Server ID', value: guild.id },
    );
}

function makeMessageCloseContext(message) {
  return {
    channelId: message.channelId,
    guildId: message.guildId,
    user: message.author,
    member: message.member,
    guild: message.guild,
    channel: message.channel,
    client: message.client,
    deferReply: async () => undefined,
    editReply: async (payload) => message.channel.send(typeof payload === 'string' ? { content: payload } : payload),
    reply: async (payload) => message.reply(payload),
  };
}

module.exports = { avatarEmbed, userInfoEmbed, serverInfoEmbed, makeMessageCloseContext };
