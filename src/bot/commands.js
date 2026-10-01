const { MessageFlags } = require('discord.js');
const { getGuildSettings } = require('../store');
const { commands, prefixCommands, slashCommands } = require('./commandRegistry');
const { trackCommandUsage } = require('../features/dataStore');
const { isCommandEnabled } = require('../commandSettingsStore');
const { canUseFeature, getGuildSubscription, getPlan } = require('../subscriptionStore');

const COMMAND_FEATURE_MAP = {
  tickets: 'tickets',
  security: 'automod',
  leveling: 'leveling',
  applications: 'applications',
  giveaways: 'giveaways',
  analytics: 'analytics',
  music: 'music',
  automations: 'automations',
};

function commandFeatureKey(command) {
  if (command.featureKey) return String(command.featureKey);
  const folder = String(command.modulePath || '').split('/')[0].toLowerCase();
  return COMMAND_FEATURE_MAP[folder] || null;
}

async function subscriptionGate(guildId, command) {
  if (!guildId || command.ownerOnly) return null;
  const featureKey = commandFeatureKey(command);
  if (!featureKey || await canUseFeature(guildId, featureKey)) return null;

  const subscription = await getGuildSubscription(guildId);
  const plan = await getPlan(subscription.tier);
  return {
    tier: subscription.tier,
    planName: plan.name || subscription.tier,
    featureKey,
  };
}

function slashUpgradeMessage(command, gate) {
  return [
    `🔒 **/${command.name} is locked on the ${gate.planName} tier.**`,
    'This command belongs to a module that is not included with this server’s current Kryndexa subscription.',
    'Purchase or upgrade the server tier to unlock this command and its dashboard module:',
    'https://kryndexabot.xyz/products',
  ].join('\n');
}

function prefixUpgradeMessage(settings, command, gate) {
  return [
    `🔒 **${settings.prefix}${command.name} is locked on the ${gate.planName} tier.**`,
    'This command belongs to a module that is not included with this server’s current Kryndexa subscription.',
    'Purchase or upgrade the server tier to unlock it: https://kryndexabot.xyz/products',
  ].join('\n');
}

async function executeSlash(interaction) {
  const command = commands.get(interaction.commandName);
  if (!command) return undefined;

  if (command.guildOnly !== false && !interaction.guild) {
    return interaction.reply({
      content: 'This command must be used in a server.',
      flags: MessageFlags.Ephemeral,
    });
  }

  if (interaction.guildId) {
    const gate = await subscriptionGate(interaction.guildId, command);
    if (gate) {
      return interaction.reply({
        content: slashUpgradeMessage(command, gate),
        flags: MessageFlags.Ephemeral,
      });
    }
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

  const gate = await subscriptionGate(message.guildId, command);
  if (gate) return message.reply(prefixUpgradeMessage(settings, command, gate));

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
