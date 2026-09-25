const { MessageFlags, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

module.exports = {
  name: 'role',
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Add or remove a role.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand((sub) => sub.setName('add').setDescription('Add a role')
      .addUserOption((option) => option.setName('user').setDescription('Member').setRequired(true))
      .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand((sub) => sub.setName('remove').setDescription('Remove a role')
      .addUserOption((option) => option.setName('user').setDescription('Member').setRequired(true))
      .addRoleOption((option) => option.setName('role').setDescription('Role').setRequired(true))),
  guildOnly: true,
  async executeSlash(interaction) {
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user', true);
    const role = interaction.options.getRole('role', true);
    const member = await interaction.guild.members.fetch(user.id);
    if (sub === 'add') await member.roles.add(role);
    else await member.roles.remove(role);
    return interaction.reply({
      content: `${sub === 'add' ? 'Added' : 'Removed'} ${role} ${sub === 'add' ? 'to' : 'from'} ${member}.`,
      flags: MessageFlags.Ephemeral,
    });
  },
  async executePrefix(message, args, { settings }) {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply('Manage Roles is required.');
    const sub = (args[0] || '').toLowerCase();
    const member = message.mentions.members.first();
    const role = message.mentions.roles.first();
    if (!['add', 'remove'].includes(sub) || !member || !role) {
      return message.reply(`Usage: ${settings.prefix}role <add|remove> @user @role`);
    }
    if (sub === 'add') await member.roles.add(role);
    else await member.roles.remove(role);
    return message.reply(`${sub === 'add' ? 'Added' : 'Removed'} ${role} ${sub === 'add' ? 'to' : 'from'} ${member}.`);
  },
};
