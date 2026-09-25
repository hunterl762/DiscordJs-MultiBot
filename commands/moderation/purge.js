const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

module.exports = {
  name: 'purge',
  data: new SlashCommandBuilder()
    .setName('purge')
    .setDescription('Delete recent messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) => option.setName('amount').setDescription('1-100 messages').setMinValue(1).setMaxValue(100).setRequired(true)),
  guildOnly: true,
  async executeSlash(interaction) {
    const amount = interaction.options.getInteger('amount', true);
    const deleted = await interaction.channel.bulkDelete(amount, true);
    return interaction.reply({ content: `Deleted ${deleted.size} message(s).`, flags: MessageFlags.Ephemeral });
  },
  async executePrefix(message, args) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return message.reply('Manage Messages is required.');
    const amount = Math.min(Math.max(Number(args[0]) || 1, 1), 100);
    await message.delete().catch(() => null);
    const deleted = await message.channel.bulkDelete(amount, true);
    return message.channel.send(`Deleted ${deleted.size} message(s).`).then((sent) => setTimeout(() => sent.delete().catch(() => null), 3000));
  },
};
