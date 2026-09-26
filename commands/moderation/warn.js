const {
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const {
  addWarning,
  listWarnings,
  clearWarnings,
} = require('../../src/features/dataStore');

function cleanReason(value) {
  return String(value || '').trim().slice(0, 1000);
}

async function notifyWarnedUser(user, guild, moderator, warningId, reason) {
  const embed = new EmbedBuilder()
    .setColor(0xfee75c)
    .setTitle('⚠️ You received a warning')
    .setDescription(`You were warned in **${guild.name}**.`)
    .addFields(
      { name: 'Reason', value: reason.slice(0, 1024) },
      { name: 'Warning ID', value: `#${warningId}`, inline: true },
      { name: 'Moderator', value: moderator.tag || moderator.username || 'Moderator', inline: true },
    )
    .setTimestamp();

  return user.send({ embeds: [embed] }).then(() => true).catch(() => false);
}

module.exports = {
  name: 'warn',
  category: 'Moderation',
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Manage member warnings.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addSubcommand((subcommand) => subcommand
      .setName('add')
      .setDescription('Warn a member and record the reason.')
      .addUserOption((option) => option
        .setName('user')
        .setRequired(true)
        .setDescription('Member to warn'))
      .addStringOption((option) => option
        .setName('reason')
        .setRequired(true)
        .setMaxLength(1000)
        .setDescription('Reason for the warning')))
    .addSubcommand((subcommand) => subcommand
      .setName('list')
      .setDescription('List warnings and their reasons.')
      .addUserOption((option) => option
        .setName('user')
        .setRequired(true)
        .setDescription('Member')))
    .addSubcommand((subcommand) => subcommand
      .setName('clear')
      .setDescription('Clear warnings for a member.')
      .addUserOption((option) => option
        .setName('user')
        .setRequired(true)
        .setDescription('Member'))),
  guildOnly: true,

  async executeSlash(interaction) {
    const subcommand = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user', true);

    if (subcommand === 'add') {
      const reason = cleanReason(interaction.options.getString('reason', true));
      if (!reason) {
        return interaction.reply({
          content: 'A warning reason is required.',
          flags: MessageFlags.Ephemeral,
        });
      }

      const warningId = await addWarning(
        interaction.guildId,
        user.id,
        interaction.user.id,
        reason,
      );
      const dmSent = await notifyWarnedUser(
        user,
        interaction.guild,
        interaction.user,
        warningId,
        reason,
      );

      return interaction.reply({
        content: [
          `⚠️ Warning **#${warningId}** added to **${user.tag}**.`,
          `**Reason:** ${reason}`,
          dmSent ? 'The member was notified by DM.' : 'The warning was saved, but the member could not be notified by DM.',
        ].join('\n'),
        flags: MessageFlags.Ephemeral,
      });
    }

    if (subcommand === 'clear') {
      const count = await clearWarnings(interaction.guildId, user.id);
      return interaction.reply({
        content: `Cleared ${count} warning(s) for ${user.tag}.`,
        flags: MessageFlags.Ephemeral,
      });
    }

    const rows = await listWarnings(interaction.guildId, user.id);
    const embed = new EmbedBuilder()
      .setColor(0xfee75c)
      .setTitle(`Warnings • ${user.tag}`)
      .setDescription(
        rows.length
          ? rows.map((row) => (
              `**#${row.id}** • <@${row.moderator_id}> • <t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R>\n**Reason:** ${row.reason}`
            )).join('\n\n')
          : 'No warnings.',
      );

    return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
  },

  async executePrefix(message, args, { settings }) {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return message.reply('Moderate Members is required.');
    }

    const member = message.mentions.members.first();
    if (!member) {
      return message.reply(`Usage: ${settings.prefix}warn @user <reason>`);
    }

    const reason = cleanReason(
      args.filter((arg) => !/^<@!?\d+>$/.test(arg)).join(' '),
    );
    if (!reason) {
      return message.reply(`Usage: ${settings.prefix}warn @user <reason>`);
    }

    const warningId = await addWarning(
      message.guild.id,
      member.id,
      message.author.id,
      reason,
    );
    const dmSent = await notifyWarnedUser(
      member.user,
      message.guild,
      message.author,
      warningId,
      reason,
    );

    return message.reply([
      `⚠️ Warning **#${warningId}** added to **${member.user.tag}**.`,
      `**Reason:** ${reason}`,
      dmSent ? 'The member was notified by DM.' : 'The warning was saved, but the member could not be notified by DM.',
    ].join('\n'));
  },
};
