const { EmbedBuilder } = require('discord.js');

function avatarEmbed(user) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`${user.tag}'s avatar`)
    .setImage(user.displayAvatarURL({ size: 1024 }));
}

function userInfoEmbed(user, member) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(user.tag)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: 'User ID', value: user.id, inline: true },
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
