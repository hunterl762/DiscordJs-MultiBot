const { MessageFlags, SlashCommandBuilder } = require('discord.js');
const { isBotOwner, broadcastToGuilds, formatBroadcastSummary } = require('../../src/bot/broadcast');

module.exports = {
  name: 'broadcast',
  data: new SlashCommandBuilder()
    .setName('broadcast')
    .setDescription('Owner only: broadcast an announcement to every bot server.')
    .addStringOption((option) => option.setName('message').setDescription('Announcement message').setMaxLength(1800).setRequired(true))
    .addStringOption((option) => option.setName('title').setDescription('Announcement title').setMaxLength(256))
    .addBooleanOption((option) => option.setName('dry-run').setDescription('Preview delivery count without sending')),
  guildOnly: false,
  async executeSlash(interaction) {
    if (!(await isBotOwner(interaction.client, interaction.user.id))) {
      return interaction.reply({ content: 'This command is restricted to the bot owner.', flags: MessageFlags.Ephemeral });
    }
    const message = interaction.options.getString('message', true).trim();
    const title = (interaction.options.getString('title') || 'MultiBot Announcement').trim();
    const dryRun = interaction.options.getBoolean('dry-run') || false;
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const results = await broadcastToGuilds(interaction.client, { title, message, dryRun, owner: interaction.user });
    return interaction.editReply(formatBroadcastSummary(results));
  },
  async executePrefix(message, args, { settings }) {
    if (!(await isBotOwner(message.client, message.author.id))) return message.reply('This command is restricted to the bot owner.');
    const announcement = args.join(' ').trim();
    if (!announcement) return message.reply(`Usage: ${settings.prefix}broadcast <message>`);
    const status = await message.reply('Broadcast started…');
    const results = await broadcastToGuilds(message.client, { message: announcement, owner: message.author });
    return status.edit(formatBroadcastSummary(results));
  },
};
