const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

module.exports = {
  name: 'ban',
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Ban a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) => option.setName('user').setDescription('Member to ban').setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason')),
  guildOnly: true,
  async executeSlash(interaction) {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || `Action by ${interaction.user.tag}`;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.reply({ content: 'That user is not in this server.', flags: MessageFlags.Ephemeral });
    await member.ban({ reason });
    return interaction.reply(`${user.tag} was banned.`);
  },
  async executePrefix(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers)) return message.reply('Ban Members is required.');
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mention a member.');
    const reason = args.filter((arg) => !arg.match(/^<@!?\d+>$/)).join(' ') || `Action by ${message.author.tag}`;
    await member.ban({ reason });
    return message.channel.send(`${member.user.tag} was banned.`);
  },
};
