require('dotenv').config();
const {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
} = require('discord.js');
const { slashCommands } = require('./bot/commandRegistry');
const { registerEvents } = require('./bot/events');
const { registerInteractions } = require('./bot/interactions');
const { startDashboard } = require('./dashboard/server');
const { initDatabase } = require('./database');
const { startTwitchMonitor, stopTwitchMonitor } = require('./services/twitchMonitor');
const { registerFeatureRuntime, stopFeatureRuntime } = require('./features/runtime');
const { initMusic, stopMusic } = require('./music/manager');

const required = [
  'DISCORD_TOKEN',
  'DISCORD_CLIENT_ID',
  'DISCORD_CLIENT_SECRET',
  'DISCORD_REDIRECT_URI',
  'SESSION_SECRET',
  'MYSQL_HOST',
  'MYSQL_USER',
  'MYSQL_PASSWORD',
  'MYSQL_DATABASE',
];

const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exitCode = 1;
  return;
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessageReactions,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildInvites,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.Reaction, Partials.GuildMember, Partials.User],
});

registerEvents(client);
registerInteractions(client);
registerFeatureRuntime(client);

async function waitForReady() {
  if (client.isReady()) return;
  await new Promise((resolve) => client.once(Events.ClientReady, resolve));
}

async function registerGlobalCommands(rest, applicationId) {
  await rest.put(
    Routes.applicationCommands(applicationId),
    { body: slashCommands },
  );
  console.log(`Registered ${slashCommands.length} global slash commands.`);
}

async function registerSlashCommands() {
  await client.application.fetch();

  const applicationId = client.application.id;
  const configuredClientId = String(process.env.DISCORD_CLIENT_ID || '').trim();

  if (configuredClientId && configuredClientId !== applicationId) {
    console.warn(
      `[Slash Commands] DISCORD_CLIENT_ID=${configuredClientId} does not match the logged-in bot application ${applicationId}. `
      + 'Slash registration will use the logged-in application ID. Update DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in .env so dashboard OAuth also uses the same application.',
    );
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const devGuildId = String(process.env.DEV_GUILD_ID || '').trim();

  if (!devGuildId) {
    await registerGlobalCommands(rest, applicationId);
    return;
  }

  const guild = client.guilds.cache.get(devGuildId);

  if (!guild) {
    console.warn(
      `[Slash Commands] DEV_GUILD_ID=${devGuildId} is not a server the bot is currently connected to. `
      + 'Falling back to global slash-command registration. Clear DEV_GUILD_ID or replace it with a server ID where this bot is installed.',
    );
    await registerGlobalCommands(rest, applicationId);
    return;
  }

  try {
    await rest.put(
      Routes.applicationGuildCommands(applicationId, devGuildId),
      { body: slashCommands },
    );
    console.log(`Registered ${slashCommands.length} slash commands in ${guild.name} (${devGuildId}).`);
  } catch (error) {
    if (error?.code === 50001 || error?.status === 403) {
      console.warn(
        `[Slash Commands] Discord denied guild command registration for ${guild.name} (${devGuildId}) with Missing Access. `
        + 'Falling back to global command registration instead of stopping MultiBot.',
      );
      await registerGlobalCommands(rest, applicationId);
      return;
    }
    throw error;
  }
}

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down MultiBot.`);
  try {
    stopTwitchMonitor();
    stopFeatureRuntime();
    stopMusic();
    client.destroy();
  } catch (error) {
    console.error('Error while closing Discord client:', error);
  }
  process.exitCode = 0;
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

(async () => {
  await initDatabase();
  await client.login(process.env.DISCORD_TOKEN);
  await waitForReady();
  startDashboard(client);

  try {
    await registerSlashCommands();
  } catch (error) {
    console.error('[Slash Commands] Registration failed; the bot and dashboard will continue running:', error);
  }

  startTwitchMonitor(client);
  await initMusic(client);
})().catch((error) => {
  console.error('MultiBot startup failed:', error);
  try {
    stopTwitchMonitor();
    stopFeatureRuntime();
    stopMusic();
    client.destroy();
  } catch {
    // Ignore cleanup failures while handling a startup error.
  }
  process.exitCode = 1;
});
