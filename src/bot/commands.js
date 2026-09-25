const { MessageFlags } = require('discord.js');
const { getGuildSettings } = require('../store');
const { commands, prefixCommands, slashCommands } = require('./commandRegistry');
const { trackCommandUsage } = require('../features/dataStore');
const { isCommandEnabled } = require('../commandSettingsStore');

async function executeSlash(interaction) {
  const command = commands.get(interaction.commandName);
  if (!command) return undefined;

  if (command.guildOnly !== false && !interaction.guild) {
    return interaction.reply({
      content: 'This command must be used in a server.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.guildId && !(await isCommandEnabled(interaction.guildId, command.name))) {
    return interaction.reply({
      content: `/${command.name} is disabled in this server.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  trackCommandUsage(interaction.guildId, interaction.user.id, command.name).catch(() => null);
  return command.executeSlash(interaction, { slashCommands });
}

async function executePrefix(message) {
  if (!message.guild || message.author.bot) return undefined;

  const settings = await getGuildSettings(message.guild.id);
  if (!settings.prefixCommandsEnabled || !message.content.startsWith(settings.prefix)) return undefined;

  const args = message.content.slice(settings.prefix.length).trim().split(/\s+/);
  const name = (args.shift() || '').toLowerCase();
  if (!name) return undefined;

  const command = prefixCommands.get(name);
  if (!command || typeof command.executePrefix !== 'function') return undefined;

  if (!(await isCommandEnabled(message.guildId, command.name))) {
    return message.reply(`${settings.prefix}${command.name} is disabled in this server.`);
  }

  trackCommandUsage(message.guildId, message.author.id, command.name).catch(() => null);
  return command.executePrefix(message, args, { settings, slashCommands });
}

module.exports = {
  slashCommands,
  executeSlash,
  executePrefix,
};
