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

function validateSlashCommandPayloads() {
  if (!slashCommands.length) {
    throw new Error('No slash commands were loaded from the commands directory.');
  }

  if (slashCommands.length > 100) {
    throw new Error(`Loaded ${slashCommands.length} chat-input commands; Discord allows at most 100 global chat-input commands.`);
  }

  const seen = new Set();
  for (const command of slashCommands) {
    const name = String(command?.name || '').trim().toLowerCase();
    if (!name || !command?.description) {
      throw new Error(`Invalid slash-command payload: ${JSON.stringify(command)}`);
    }
    if (seen.has(name)) throw new Error(`Duplicate slash-command payload: /${name}`);
    seen.add(name);
  }
}

async function registerGlobalCommands(rest, applicationId) {
  const registered = await rest.put(
    Routes.applicationCommands(applicationId),
    { body: slashCommands },
  );

  const accepted = Array.isArray(registered) ? registered.length : slashCommands.length;
  console.log(`[Slash Commands] Discord accepted ${accepted}/${slashCommands.length} global slash commands.`);

  const remote = await rest.get(Routes.applicationCommands(applicationId));
  const remoteCount = Array.isArray(remote) ? remote.length : 0;
  if (remoteCount !== slashCommands.length) {
    console.warn(
      `[Slash Commands] Verification mismatch: local=${slashCommands.length}, Discord global=${remoteCount}. `
      + 'Check startup errors and confirm the bot was invited with the applications.commands scope.',
    );
  } else {
    console.log(`[Slash Commands] Verified ${remoteCount} global commands on application ${applicationId}.`);
  }
}

async function registerSlashCommands() {
  await client.application.fetch();
  validateSlashCommandPayloads();

  const applicationId = client.application.id;
  const configuredClientId = String(process.env.DISCORD_CLIENT_ID || '').trim();

  if (configuredClientId && configuredClientId !== applicationId) {
    console.warn(
      `[Slash Commands] DISCORD_CLIENT_ID=${configuredClientId} does not match the logged-in bot application ${applicationId}. `
      + 'Slash registration will use the logged-in application ID. Update DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET in .env so dashboard OAuth also uses the same application.',
    );
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

  // Production commands must always be global so every server that installed
  // the application can see the same command set. DEV_GUILD_ID is only an
  // optional instant-development mirror; it must never replace global sync.
  await registerGlobalCommands(rest, applicationId);

  const devGuildId = String(process.env.DEV_GUILD_ID || '').trim();
  if (!devGuildId) return;

  const guild = client.guilds.cache.get(devGuildId);
  if (!guild) {
    console.warn(
      `[Slash Commands] DEV_GUILD_ID=${devGuildId} is not a server the bot is currently connected to. `
      + 'Global commands are registered; skipping the development-guild mirror.',
    );
    return;
  }

  try {
    const registered = await rest.put(
      Routes.applicationGuildCommands(applicationId, devGuildId),
      { body: slashCommands },
    );
    const accepted = Array.isArray(registered) ? registered.length : slashCommands.length;
    console.log(`[Slash Commands] Mirrored ${accepted} commands into development guild ${guild.name} (${devGuildId}).`);
  } catch (error) {
    if (error?.code === 50001 || error?.status === 403) {
      console.warn(
        `[Slash Commands] Discord denied development-guild registration for ${guild.name} (${devGuildId}) with Missing Access. `
        + 'The global command set is still registered and available to installed servers.',
      );
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
  await startDashboard(client);

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
