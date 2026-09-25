const { executeSlash } = require('./commands');
const { createTicket, closeTicket } = require('../tickets/ticketService');
const { handleVerificationButton } = require('./verification');

function registerInteractions(client) {
  client.on('interactionCreate', async (interaction) => {
    try {
      if (interaction.isChatInputCommand()) return await executeSlash(interaction);
      if (interaction.isButton() && interaction.customId === 'ticket:create') return await createTicket(interaction);
      if (interaction.isButton() && interaction.customId === 'ticket:close') return await closeTicket(interaction);
      if (interaction.isButton() && interaction.customId.startsWith('verification:verify:')) return await handleVerificationButton(interaction);
      return undefined;
    } catch (error) {
      console.error('Interaction error:', error);
      const payload = { content: 'Something went wrong while running that action.', ephemeral: true };
      if (interaction.deferred || interaction.replied) await interaction.followUp(payload).catch(() => null);
      else await interaction.reply(payload).catch(() => null);
      return undefined;
    }
  });
}

module.exports = { registerInteractions };
