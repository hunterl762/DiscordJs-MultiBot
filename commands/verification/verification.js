const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { getGuildSettings } = require('../../src/store');
const { postVerificationPanel, verifyMember } = require('../../src/bot/verification');

module.exports = {
  name: 'verification',
  aliases: ['verify'],
  data: new SlashCommandBuilder()
    .setName('verification')
    .setDescription('Member verification controls.')
    .addSubcommand((sub) => sub.setName('setup').setDescription('Post the verification panel in a channel')
      .addChannelOption((option) => option.setName('channel').setDescription('Verification channel')))
    .addSubcommand((sub) => sub.setName('verify').setDescription('Verify yourself or a member')
      .addUserOption((option) => option.setName('user').setDescription('Member to verify (Manage Roles required for others)')))
    .addSubcommand((sub) => sub.setName('status').setDescription('Show verification configuration status')),
  guildOnly: true,
  async executeSlash(interaction) {
    const sub = interaction.options.getSubcommand();
    const settings = await getGuildSettings(interaction.guildId);

    if (sub === 'setup') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'Manage Server is required.', flags: MessageFlags.Ephemeral });
      }
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      if (!channel?.isTextBased()) return interaction.reply({ content: 'Choose a text channel.', flags: MessageFlags.Ephemeral });
      await postVerificationPanel(channel);
      return interaction.reply({ content: `Verification panel posted in ${channel}.`, flags: MessageFlags.Ephemeral });
    }

    if (sub === 'status') {
      return interaction.reply({
        content: [
          `Verification: **${settings.verificationEnabled ? 'enabled' : 'disabled'}**`,
          `Channel: ${settings.verificationChannelId ? `<#${settings.verificationChannelId}>` : 'not configured'}`,
          `Verified role: ${settings.verifiedRoleId ? `<@&${settings.verifiedRoleId}>` : 'not configured'}`,
          `Unverified role: ${settings.unverifiedRoleId ? `<@&${settings.unverifiedRoleId}>` : 'not configured'}`,
        ].join('\n'),
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    }

    const targetUser = interaction.options.getUser('user') || interaction.user;
    if (targetUser.id !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: 'Manage Roles is required to verify another member.', flags: MessageFlags.Ephemeral });
    }
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) return interaction.reply({ content: 'That member could not be found.', flags: MessageFlags.Ephemeral });
    const result = await verifyMember(member, interaction.user.tag);
    return interaction.reply({ content: result.message, flags: MessageFlags.Ephemeral });
  },
  async executePrefix(message, args, { settings }) {
    const invoked = message.content.slice(settings.prefix.length).trim().split(/\s+/)[0].toLowerCase();
    const sub = invoked === 'verify' ? 'verify' : (args[0] || 'status').toLowerCase();

    if (sub === 'setup') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) return message.reply('Manage Server is required.');
      const channel = message.mentions.channels.first() || message.channel;
      if (!channel?.isTextBased()) return message.reply('Choose a text channel.');
      await postVerificationPanel(channel);
      return message.reply(`Verification panel posted in ${channel}.`);
    }

    if (sub === 'status') {
      return message.reply({
        content: [
          `Verification: **${settings.verificationEnabled ? 'enabled' : 'disabled'}**`,
          `Channel: ${settings.verificationChannelId ? `<#${settings.verificationChannelId}>` : 'not configured'}`,
          `Verified role: ${settings.verifiedRoleId ? `<@&${settings.verifiedRoleId}>` : 'not configured'}`,
          `Unverified role: ${settings.unverifiedRoleId ? `<@&${settings.unverifiedRoleId}>` : 'not configured'}`,
        ].join('\n'),
        allowedMentions: { parse: [] },
      });
    }

    if (sub === 'verify') {
      const targetMember = message.mentions.members.first() || message.member;
      if (targetMember.id !== message.author.id && !message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return message.reply('Manage Roles is required to verify another member.');
      }
      const result = await verifyMember(targetMember, message.author.tag);
      return message.reply(result.message);
    }

    return message.reply(`Usage: ${settings.prefix}verification <setup [#channel]|verify [@user]|status>`);
  },
};
