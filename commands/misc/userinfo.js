const { SlashCommandBuilder } = require('discord.js');
const { userInfoEmbed } = require('../../src/bot/commandHelpers');

module.exports = {
  name: 'userinfo',
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Show information about a user.')
    .addUserOption((option) => option.setName('user').setDescription('User to inspect')),
  guildOnly: true,
  async executeSlash(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    return interaction.reply({ embeds: [userInfoEmbed(user, member)] });
  },
  async executePrefix(message) {
    const user = message.mentions.users.first() || message.author;
    const member = await message.guild.members.fetch(user.id).catch(() => null);
    return message.reply({ embeds: [userInfoEmbed(user, member)] });
  },
};
