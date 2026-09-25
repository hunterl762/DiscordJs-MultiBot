const { PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

module.exports = {
  name: 'timeout',
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeout a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option.setName('user').setDescription('Member to timeout').setRequired(true))
    .addIntegerOption((option) => option.setName('minutes').setDescription('Minutes, 1-40320').setMinValue(1).setMaxValue(40320).setRequired(true))
    .addStringOption((option) => option.setName('reason').setDescription('Reason')),
  guildOnly: true,
  async executeSlash(interaction) {
    const user = interaction.options.getUser('user', true);
    const member = await interaction.guild.members.fetch(user.id);
    const minutes = interaction.options.getInteger('minutes', true);
    const reason = interaction.options.getString('reason') || `Action by ${interaction.user.tag}`;
    await member.timeout(minutes * 60_000, reason);
    return interaction.reply(`${user.tag} was timed out for ${minutes} minute(s).`);
  },
  async executePrefix(message, args, { settings }) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply('Moderate Members is required.');
    const member = message.mentions.members.first();
    const mentionIndex = args.findIndex((arg) => /^<@!?\d+>$/.test(arg));
    const minutes = Number(args[mentionIndex + 1]);
    if (!member || !Number.isInteger(minutes) || minutes < 1 || minutes > 40320) {
      return message.reply(`Usage: ${settings.prefix}timeout @user <minutes 1-40320> [reason]`);
    }
    const reason = args.slice(mentionIndex + 2).join(' ') || `Action by ${message.author.tag}`;
    await member.timeout(minutes * 60_000, reason);
    return message.reply(`${member.user.tag} was timed out for ${minutes} minute(s).`);
  },
};
