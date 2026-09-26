require('dotenv').config();
const {
  Client,
  Events,
  GatewayIntentBits,
  Partials,
} = require('discord.js');
const { slashCommands } = require('./bot/commandRegistry');
const {
  registerSlashCommands,
  registerGuildJoinSlashSync,
} = require('./bot/slashCommandSync');
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
registerGuildJoinSlashSync(client, slashCommands);

async function waitForReady() {
  if (client.isReady()) return;
  await new Promise((resolve) => client.once(Events.ClientReady, resolve));
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

  // Slash-command registration is intentionally independent of the web panel.
  // Dashboard/SSL/port failures must never prevent Discord commands from syncing.
  try {
    const sync = await registerSlashCommands(client, slashCommands);
    console.log(
      `[Slash Commands] Startup sync complete: global=${sync.globalRegistered ? 'yes' : 'no'}, guilds=${sync.guildSummary.synced}/${sync.guildSummary.total}, commands=${sync.commandCount}.`,
    );
  } catch (error) {
    console.error('[Slash Commands] Registration failed; the bot will continue running:', error);
  }

  try {
    startDashboard(client);
  } catch (error) {
    console.error('[Dashboard] Startup failed; Discord bot and slash commands will continue running:', error);
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
