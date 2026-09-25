const {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { createServerBackup, listServerBackups } = require('../../src/backupStore');

function backupListEmbed(guild, rows) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`Server Backups • ${guild.name}`)
    .setDescription(rows.length
      ? rows.map((row) => [
          `**${row.id}**`,
          `Channels: **${row.channelCount}** • Roles: **${row.roleCount}**`,
          `Created by <@${row.createdBy}> • <t:${Math.floor(new Date(row.createdAt).getTime() / 1000)}:R>`,
        ].join('\n')).join('\n\n')
      : 'No server backups are stored yet.')
    .setFooter({ text: 'Backups contain channel/role structure and permissions, not message history.' })
    .setTimestamp();
}

module.exports = {
  name: 'backup',
  category: 'Administration',
  data: new SlashCommandBuilder()
    .setName('backup')
    .setDescription('Save or view SQL backups of this server structure.')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand((sub) => sub
      .setName('create')
      .setDescription('Back up all channels, roles, and channel permission overwrites to MySQL'))
    .addSubcommand((sub) => sub
      .setName('list')
      .setDescription('List the most recent server backups stored in MySQL')),
  guildOnly: true,

  async executeSlash(interaction) {
    const sub = interaction.options.getSubcommand();

    if (sub === 'list') {
      const rows = await listServerBackups(interaction.guildId, 10);
      return interaction.reply({
        embeds: [backupListEmbed(interaction.guild, rows)],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const backup = await createServerBackup(interaction.guild, interaction.user.id);

    return interaction.editReply([
      '✅ Server backup saved to MySQL.',
      `**Backup ID:** \`${backup.id}\``,
      `**Channels:** ${backup.channelCount}`,
      `**Roles:** ${backup.roleCount}`,
      'Message history and member data are not included.',
    ].join('\n'));
  },

  async executePrefix(message, args, { settings }) {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return message.reply('Administrator permission is required.');
    }

    const sub = String(args[0] || 'create').toLowerCase();

    if (sub === 'list') {
      const rows = await listServerBackups(message.guildId, 10);
      return message.reply({ embeds: [backupListEmbed(message.guild, rows)], allowedMentions: { parse: [] } });
    }

    if (sub !== 'create') {
      return message.reply(`Usage: ${settings.prefix}backup <create|list>`);
    }

    const backup = await createServerBackup(message.guild, message.author.id);
    return message.reply(
      `Backup saved. ID: \`${backup.id}\` • ${backup.channelCount} channels • ${backup.roleCount} roles.`,
    );
  },
};
