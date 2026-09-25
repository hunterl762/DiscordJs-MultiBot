const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

module.exports = {
  name: 'say',
  data: new SlashCommandBuilder()
    .setName('say')
    .setDescription('Send a message as the bot.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption((option) => option.setName('message').setDescription('Message to send').setRequired(true)),
  guildOnly: true,
  async executeSlash(interaction) {
    const content = interaction.options.getString('message', true);
    await interaction.channel.send({ content, allowedMentions: { parse: [] } });
    return interaction.reply({ content: 'Sent.', flags: MessageFlags.Ephemeral });
  },
  async executePrefix(message, args, { settings }) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return message.reply('Manage Messages is required.');
    const content = args.join(' ').trim();
    if (!content) return message.reply(`Usage: ${settings.prefix}say <message>`);
    return message.channel.send({ content, allowedMentions: { parse: [] } });
  },
};
