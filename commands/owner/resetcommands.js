const {
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');
const { isBotOwner } = require('../../src/bot/broadcast');
const {
  createRestClient,
  registerSlashCommands,
  syncGuildCommands,
} = require('../../src/bot/slashCommandSync');

async function resetCommands(client, slashCommands, scope, guildId) {
  await client.application.fetch();

  if (scope === 'global') {
    const result = await registerSlashCommands(client, slashCommands);
    const failed = result.guildSummary.failures.length;

    return [
      `Registered and verified **${slashCommands.length}** global slash command(s).`,
      `Synced the current command set to **${result.guildSummary.synced}/${result.guildSummary.total}** connected server(s).`,
      failed
        ? `**${failed}** server(s) could not be synced; check the bot console for Missing Access or Discord API errors.`
        : 'Every connected server was synchronized successfully.',
    ].join('\n');
  }

  if (!guildId) throw new Error('A guild ID is required for a guild command reset.');

  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    throw new Error('The bot is not currently connected to this server.');
  }

  const rest = createRestClient();
  const applicationId = client.application.id;
  const accepted = await syncGuildCommands(
    rest,
    applicationId,
    guild,
    slashCommands,
  );

  return [
    `Registered and verified **${accepted}** slash command(s) in **${guild.name}**.`,
    'This server now has an immediate guild-specific copy while the global command set remains available to every installed server.',
  ].join('\n');
}

module.exports = {
  name: 'resetcommands',
  data: new SlashCommandBuilder()
    .setName('resetcommands')
    .setDescription('Owner only: remove stale slash commands and register the current command set.')
    .addStringOption((option) => option
      .setName('scope')
      .setDescription('Global removes stale guild copies too and is recommended for production')
      .setRequired(true)
      .addChoices(
        { name: 'Global clean rebuild (recommended)', value: 'global' },
        { name: 'Current server cleanup', value: 'guild' },
      )),
  guildOnly: false,

  async executeSlash(interaction, { slashCommands }) {
    if (!(await isBotOwner(interaction.client, interaction.user.id))) {
      return interaction.reply({
        content: 'This command is restricted to the bot owner.',
        flags: MessageFlags.Ephemeral,
      });
    }

    const scope = interaction.options.getString('scope', true);

    if (scope === 'guild' && !interaction.guildId) {
      return interaction.reply({
        content: 'The current-server cleanup must be run inside a Discord server.',
        flags: MessageFlags.Ephemeral,
      });
    }

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    try {
      const result = await resetCommands(
        interaction.client,
        slashCommands,
        scope,
        interaction.guildId,
      );
      return interaction.editReply(result);
    } catch (error) {
      console.error('Slash command reset failed:', error);
      return interaction.editReply(`Slash command reset failed: ${error.message}`);
    }
  },

  async executePrefix(message, args, { settings, slashCommands }) {
    if (!(await isBotOwner(message.client, message.author.id))) {
      return message.reply('This command is restricted to the bot owner.');
    }

    const scope = (args[0] || 'global').toLowerCase();
    if (!['guild', 'global'].includes(scope)) {
      return message.reply(`Usage: ${settings.prefix}resetcommands <global|guild>`);
    }

    const status = await message.reply(`Cleaning and rebuilding ${scope} slash commands…`);

    try {
      const result = await resetCommands(
        message.client,
        slashCommands,
        scope,
        message.guildId,
      );
      return status.edit(result);
    } catch (error) {
      console.error('Slash command reset failed:', error);
      return status.edit(`Slash command reset failed: ${error.message}`);
    }
  },
};
