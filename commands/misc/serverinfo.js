const { SlashCommandBuilder } = require('discord.js');
const { serverInfoEmbed } = require('../../src/bot/commandHelpers');

module.exports = {
  name: 'serverinfo',
  data: new SlashCommandBuilder().setName('serverinfo').setDescription('Show information about this server.'),
  guildOnly: true,
  async executeSlash(interaction) {
    return interaction.reply({ embeds: [serverInfoEmbed(interaction.guild)] });
  },
  async executePrefix(message) {
    return message.reply({ embeds: [serverInfoEmbed(message.guild)] });
  },
};
