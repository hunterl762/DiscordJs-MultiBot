const { EmbedBuilder, Events } = require('discord.js');
const { getGuildSettings } = require('../store');
const { executePrefix } = require('./commands');
const { prepareNewMember } = require('./verification');

function getChannel(guild, id) {
  return id ? guild.channels.cache.get(id) : null;
}

function registerEvents(client) {
  client.on(Events.ClientReady, (readyClient) => {
    console.log(`${readyClient.user.tag} is online in ${readyClient.guilds.cache.size} server(s).`);
    readyClient.user.setActivity('/help • MultiBot v14');
  });

  client.on(Events.MessageCreate, executePrefix);

  client.on(Events.GuildMemberAdd, async (member) => {
    await prepareNewMember(member);

    const settings = getGuildSettings(member.guild.id);
    if (!settings.welcomeEnabled) return;
    const channel = getChannel(member.guild, settings.welcomeChannelId)
      || member.guild.channels.cache.find(c => c.name === 'welcome' && c.isTextBased());
    if (!channel?.isTextBased()) return;
    await channel.send({
      embeds: [new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`Welcome to ${member.guild.name}!`)
        .setDescription(`Welcome ${member}! You are member #${member.guild.memberCount}.`)
        .setThumbnail(member.user.displayAvatarURL())],
    }).catch(console.error);
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const settings = getGuildSettings(member.guild.id);
    const channel = getChannel(member.guild, settings.leaveChannelId)
      || member.guild.channels.cache.find(c => c.name === 'leave-log' && c.isTextBased());
    if (!channel?.isTextBased()) return;
    await channel.send({ embeds: [new EmbedBuilder().setColor(0xed4245).setTitle('Member Left').setDescription(`${member.user.tag} left **${member.guild.name}**.`)] }).catch(console.error);
  });

  const log = async (guild, embed) => {
    const settings = getGuildSettings(guild.id);
    if (!settings.loggingEnabled) return;
    const channel = getChannel(guild, settings.logsChannelId)
      || guild.channels.cache.find(c => c.name === 'logs' && c.isTextBased());
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] }).catch(console.error);
  };

  client.on(Events.ChannelCreate, (channel) => channel.guild && log(channel.guild, new EmbedBuilder().setColor(0x57f287).setTitle('Channel Created').setDescription(`Created ${channel}.`).setTimestamp()));
  client.on(Events.ChannelDelete, (channel) => channel.guild && log(channel.guild, new EmbedBuilder().setColor(0xed4245).setTitle('Channel Deleted').setDescription(`Deleted **#${channel.name}**.`).setTimestamp()));
  client.on(Events.ChannelUpdate, (oldChannel, newChannel) => newChannel.guild && log(newChannel.guild, new EmbedBuilder().setColor(0xfee75c).setTitle('Channel Updated').setDescription(`Updated ${newChannel}.`).setTimestamp()));
  client.on(Events.MessageDelete, (message) => {
    if (!message.guild || message.author?.bot) return;
    return log(message.guild, new EmbedBuilder().setColor(0xed4245).setTitle('Message Deleted').setDescription(`**Author:** ${message.author || 'Unknown'}\n**Channel:** ${message.channel}\n**Content:**\n${(message.content || '[unavailable]').slice(0, 3500)}`).setTimestamp());
  });
  client.on(Events.MessageUpdate, (oldMessage, newMessage) => {
    if (!oldMessage.guild || oldMessage.author?.bot || oldMessage.content === newMessage.content) return;
    return log(oldMessage.guild, new EmbedBuilder().setColor(0xfee75c).setTitle('Message Edited').setDescription(`**Author:** ${oldMessage.author || 'Unknown'}\n**Channel:** ${oldMessage.channel}\n**Before:** ${(oldMessage.content || '[unavailable]').slice(0, 1500)}\n**After:** ${(newMessage.content || '[unavailable]').slice(0, 1500)}`).setTimestamp());
  });
}

module.exports = { registerEvents };
