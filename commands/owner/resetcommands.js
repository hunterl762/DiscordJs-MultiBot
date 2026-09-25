const {
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
} = require('discord.js');
const { isBotOwner } = require('../../src/bot/broadcast');

async function clearGuildCommands(rest, applicationId, guildId) {
  await rest.put(
    Routes.applicationGuildCommands(applicationId, guildId),
    { body: [] },
  );
}

async function rebuildGlobalCommands(client, rest, applicationId, slashCommands) {
  const cleanup = {
    clearedGuilds: 0,
    failedGuilds: 0,
    failures: [],
  };

  // Remove the previous global set first.
  await rest.put(Routes.applicationCommands(applicationId), { body: [] });

  // Remove stale guild-specific registrations so Discord does not show
  // both a global command and an old guild command with the same name.
  for (const guild of client.guilds.cache.values()) {
    try {
      await clearGuildCommands(rest, applicationId, guild.id);
      cleanup.clearedGuilds += 1;
    } catch (error) {
      cleanup.failedGuilds += 1;
      cleanup.failures.push(`${guild.name}: ${error.message || 'unknown error'}`);
      console.warn(`[Reset Commands] Could not clear guild commands in ${guild.name}:`, error.message || error);
    }
  }

  // Register exactly the command modules currently loaded by MultiBot.
  await rest.put(
    Routes.applicationCommands(applicationId),
    { body: slashCommands },
  );

  return cleanup;
}

async function resetCommands(client, slashCommands, scope, guildId) {
  await client.application.fetch();

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const applicationId = client.application.id;

  if (scope === 'global') {
    const cleanup = await rebuildGlobalCommands(client, rest, applicationId, slashCommands);

    const details = [
      `Deleted previous global commands and registered **${slashCommands.length}** current global command(s).`,
      `Cleared stale guild-specific command registrations in **${cleanup.clearedGuilds}** server(s).`,
    ];

    if (cleanup.failedGuilds) {
      details.push(`Could not clear guild commands in **${cleanup.failedGuilds}** server(s); those servers were skipped.`);
    }

    details.push('Discord can take a short time to refresh the slash-command picker.');

    return details.join('\n');
  }

  if (!guildId) throw new Error('A guild ID is required for a guild command reset.');

  // Force an immediate guild-specific command set. This is useful when
  // Discord's global command picker has not become visible for this installation.
  await clearGuildCommands(rest, applicationId, guildId);

  const registered = await rest.put(
    Routes.applicationGuildCommands(applicationId, guildId),
    { body: slashCommands },
  );

  const accepted = Array.isArray(registered) ? registered.length : slashCommands.length;

  return [
    'Cleared the previous guild-specific slash commands for this server.',
    `Registered **${accepted}** current guild command(s) for immediate visibility.`,
    'The global command set is left intact for other servers.',
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
