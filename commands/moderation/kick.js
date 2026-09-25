const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

module.exports = {
  name: 'kick',
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kick a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((option) => option.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason')),
  guildOnly: true,
  async executeSlash(interaction) {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || `Action by ${interaction.user.tag}`;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.reply({ content: 'That user is not in this server.', flags: MessageFlags.Ephemeral });
    await member.kick(reason);
    return interaction.reply(`${user.tag} was kicked.`);
  },
  async executePrefix(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers)) return message.reply('Kick Members is required.');
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mention a member.');
    const reason = args.filter((arg) => !arg.match(/^<@!?\d+>$/)).join(' ') || `Action by ${message.author.tag}`;
    await member.kick(reason);
    return message.channel.send(`${member.user.tag} was kicked.`);
  },
};
