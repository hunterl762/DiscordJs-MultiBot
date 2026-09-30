const {
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');
const { isBotOwner } = require('../../src/bot/broadcast');

module.exports = {
  name: 'restartbot',
  data: new SlashCommandBuilder()
    .setName('restartbot')
    .setDescription('Owner only: restart the Discord bot connection while keeping the web panel online.'),
  guildOnly: false,

  async executeSlash(interaction) {
    if (!(await isBotOwner(interaction.client, interaction.user.id))) {
      return interaction.reply({
        content: 'This command is restricted to the bot owner.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.reply({
      content: 'Restarting the Discord bot connection now. The web panel will remain online.',
      flags: MessageFlags.Ephemeral,
    });

    process.emit('kryndexa:restart-bot', {
      requestedBy: interaction.user.id,
      source: 'slash',
    });
  },

  async executePrefix(message) {
    if (!(await isBotOwner(message.client, message.author.id))) {
      return message.reply('This command is restricted to the bot owner.');
    }

    await message.reply('Restarting the Discord bot connection now. The web panel will remain online.');
    process.emit('kryndexa:restart-bot', {
      requestedBy: message.author.id,
      source: 'prefix',
    });
  },
};
