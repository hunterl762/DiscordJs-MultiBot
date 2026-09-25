const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { postTicketPanel, requestTicketClose, closeTicket } = require('../../src/tickets/ticketService');
const { makeMessageCloseContext } = require('../../src/bot/commandHelpers');

module.exports = {
  name: 'ticket',
  data: new SlashCommandBuilder()
    .setName('ticket')
    .setDescription('Ticket system controls.')
    .addSubcommand((sub) => sub.setName('setup').setDescription('Post the ticket panel in a channel')
      .addChannelOption((option) => option.setName('channel').setDescription('Panel channel')))
    .addSubcommand((sub) => sub.setName('close').setDescription('Close the current ticket')),
  guildOnly: true,
  async executeSlash(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'close') return requestTicketClose(interaction);
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'Manage Server is required.', flags: MessageFlags.Ephemeral });
    }
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!channel?.isTextBased()) return interaction.reply({ content: 'Choose a text channel.', flags: MessageFlags.Ephemeral });
    await postTicketPanel(channel);
    return interaction.reply({ content: `Ticket panel posted in ${channel}.`, flags: MessageFlags.Ephemeral });
  },
  async executePrefix(message, args, { settings }) {
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'close') return closeTicket(makeMessageCloseContext(message));
    if (sub === 'setup') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) return message.reply('Manage Server is required.');
      const channel = message.mentions.channels.first() || message.channel;
      if (!channel?.isTextBased()) return message.reply('Choose a text channel.');
      await postTicketPanel(channel);
      return message.reply(`Ticket panel posted in ${channel}.`);
    }
    return message.reply(`Usage: ${settings.prefix}ticket <setup [#channel]|close>`);
  },
};
