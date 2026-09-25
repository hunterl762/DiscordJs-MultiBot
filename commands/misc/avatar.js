const { SlashCommandBuilder } = require('discord.js');
const { avatarEmbed } = require('../../src/bot/commandHelpers');

module.exports = {
  name: 'avatar',
  data: new SlashCommandBuilder()
    .setName('avatar')
    .setDescription('Show a user avatar.')
    .addUserOption((option) => option.setName('user').setDescription('User to view')),
  guildOnly: true,
  async executeSlash(interaction) {
    const user = interaction.options.getUser('user') || interaction.user;
    return interaction.reply({ embeds: [avatarEmbed(user)] });
  },
  async executePrefix(message) {
    const user = message.mentions.users.first() || message.author;
    return message.reply({ embeds: [avatarEmbed(user)] });
  },
};
