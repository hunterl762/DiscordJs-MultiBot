const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

module.exports = {
  name: 'untimeout',
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Remove a timeout.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option.setName('user').setDescription('Member').setRequired(true)),
  guildOnly: true,
  async executeSlash(interaction) {
    const user = interaction.options.getUser('user', true);
    const member = await interaction.guild.members.fetch(user.id);
    await member.timeout(null, `Timeout removed by ${interaction.user.tag}`);
    return interaction.reply(`${user.tag} is no longer timed out.`);
  },
  async executePrefix(message, _args, { settings }) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply('Moderate Members is required.');
    const member = message.mentions.members.first();
    if (!member) return message.reply(`Usage: ${settings.prefix}untimeout @user`);
    await member.timeout(null, `Timeout removed by ${message.author.tag}`);
    return message.reply(`${member.user.tag} is no longer timed out.`);
  },
};
