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

function envFlag(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

let dashboardServer = null;

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

function commandNameSet(commands) {
  return new Set(
    (Array.isArray(commands) ? commands : [])
      .map((command) => String(command?.name || '').trim().toLowerCase())
      .filter(Boolean),
  );
}

function commandSetsMatch(remoteCommands) {
  if (!Array.isArray(remoteCommands) || remoteCommands.length !== slashCommands.length) return false;

  const localNames = commandNameSet(slashCommands);
  const remoteNames = commandNameSet(remoteCommands);

  if (localNames.size !== remoteNames.size) return false;
  return [...localNames].every((name) => remoteNames.has(name));
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

  if (!commandSetsMatch(remote)) {
    const localNames = [...commandNameSet(slashCommands)].sort();
    const remoteNames = [...commandNameSet(remote)].sort();

    console.warn(
      `[Slash Commands] Global verification mismatch: local=${slashCommands.length}, Discord=${remoteCount}.`,
    );
    console.warn(`[Slash Commands] Local names: ${localNames.join(', ')}`);
    console.warn(`[Slash Commands] Discord names: ${remoteNames.join(', ')}`);
  } else {
    console.log(`[Slash Commands] Verified ${remoteCount} global commands on application ${applicationId}.`);
  }

  return remote;
}

async function syncGuildCommandFallback(rest, applicationId) {
  const autoDefault = client.guilds.cache.size <= 100;
  const enabled = envFlag('SLASH_COMMAND_GUILD_FALLBACK', autoDefault);

  if (!enabled) {
    console.log('[Slash Commands] Guild fallback sync is disabled; using global commands only.');
    return;
  }

  console.log(
    `[Slash Commands] Guild fallback sync enabled for ${client.guilds.cache.size} connected server(s).`,
  );

  let alreadyCurrent = 0;
  let updated = 0;
  let failed = 0;

  for (const guild of client.guilds.cache.values()) {
    try {
      const existing = await rest.get(
        Routes.applicationGuildCommands(applicationId, guild.id),
      );

      if (commandSetsMatch(existing)) {
        alreadyCurrent += 1;
        continue;
      }

      const registered = await rest.put(
        Routes.applicationGuildCommands(applicationId, guild.id),
        { body: slashCommands },
      );

      const accepted = Array.isArray(registered) ? registered.length : slashCommands.length;
      updated += 1;
      console.log(
        `[Slash Commands] Synced ${accepted} guild commands to ${guild.name} (${guild.id}).`,
      );

      await sleep(250);
    } catch (error) {
      failed += 1;
      console.warn(
        `[Slash Commands] Guild fallback failed for ${guild.name} (${guild.id}): ${error.message || error}`,
      );
    }
  }

  console.log(
    `[Slash Commands] Guild fallback complete: ${alreadyCurrent} already current, ${updated} updated, ${failed} failed.`,
  );
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
  await syncGuildCommandFallback(rest, applicationId);

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

    if (dashboardServer?.listening) {
      await new Promise((resolve) => dashboardServer.close(() => resolve()));
    }

    client.destroy();
  } catch (error) {
    console.error('Error while shutting down MultiBot:', error);
  }
  process.exitCode = 0;
}

process.once('SIGINT', () => shutdown('SIGINT'));
process.once('SIGTERM', () => shutdown('SIGTERM'));

(async () => {
  await initDatabase();

  try {
    dashboardServer = startDashboard(client);
  } catch (error) {
    console.error('[Dashboard] Failed to initialize web panel:', error);
  }

  await client.login(process.env.DISCORD_TOKEN);
  await waitForReady();

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
