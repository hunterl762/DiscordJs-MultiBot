const { SlashCommandBuilder } = require('discord.js');

module.exports = {
  name: 'ping',
  data: new SlashCommandBuilder().setName('ping').setDescription('Check bot latency.'),
  guildOnly: false,
  async executeSlash(interaction) {
    return interaction.reply(`Pong! WebSocket: ${interaction.client.ws.ping}ms`);
  },
  async executePrefix(message) {
    return message.reply(`Pong! ${message.client.ws.ping}ms`);
  },
};
