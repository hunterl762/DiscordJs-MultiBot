require('dotenv').config();
const readline = require('node:readline');
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
const dashboardModulePath = require.resolve('./dashboard/server');
let { startDashboard } = require(dashboardModulePath);
const { initDatabase } = require('./database');
const { startUptimeMonitor, stopUptimeMonitor } = require('./serviceUptimeStore');
const { startTwitchMonitor, stopTwitchMonitor } = require('./services/twitchMonitor');
const { registerFeatureRuntime, stopFeatureRuntime } = require('./features/runtime');
const {
  initMusic,
  waitForMusicConnection,
  stopMusic,
} = require('./music/manager');

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
let botRestarting = false;

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

async function reloadDashboard() {
  console.log('[Dashboard] Reload requested...');
  try {
    if (dashboardServer?.listening) {
      await new Promise((resolve, reject) => {
        dashboardServer.close((error) => (error ? reject(error) : resolve()));
      });
    }

    delete require.cache[dashboardModulePath];
    ({ startDashboard } = require(dashboardModulePath));
    dashboardServer = startDashboard(client);
    console.log('[Dashboard] Reload complete. The Discord bot stayed connected.');
    return true;
  } catch (error) {
    dashboardServer = null;
    console.error('[Dashboard] Reload failed:', error);
    return false;
  }
}

async function restartBotConnection(request = {}) {
  if (botRestarting) {
    console.log('[Bot Restart] A restart is already in progress.');
    return false;
  }

  botRestarting = true;
  const requestedBy = request.requestedBy ? ` requested by ${request.requestedBy}` : '';
  console.log(`[Bot Restart] Restarting Discord services${requestedBy}; web panel will remain online.`);

  try {
    stopTwitchMonitor();
    stopMusic();

    // destroy() disconnects the Discord gateway only. The Express dashboard server,
    // SQL pool, sessions, and uptime monitor remain alive in this Node process.
    client.destroy();
    await new Promise((resolve) => setTimeout(resolve, 1500));

    await client.login(process.env.DISCORD_TOKEN);
    await waitForReady();

    try {
      await initMusic(client);
      if (!(await waitForMusicConnection())) {
        console.warn('[Music] Local voice runtime is disabled or unavailable after bot restart.');
      }
    } catch (error) {
      console.error('[Music] Failed to reinitialize after bot restart:', error);
    }

    startTwitchMonitor(client);
    console.log(`[Bot Restart] Discord bot is online again as ${client.user?.tag || client.user?.username || 'Kryndexa Bot'}. Web panel was not restarted.`);
    return true;
  } catch (error) {
    console.error('[Bot Restart] Discord bot restart failed; web panel is still running:', error);
    return false;
  } finally {
    botRestarting = false;
  }
}

process.on('kryndexa:restart-bot', (request) => {
  restartBotConnection(request).catch((error) => console.error('[Bot Restart] Unhandled restart error:', error));
});

function registerConsoleCommands() {
  if (!process.stdin.isTTY) return null;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on('line', async (line) => {
    const command = String(line || '').trim().toLowerCase();
    if (['dashboard reload', 'reload dashboard', 'dashboard:reload'].includes(command)) {
      await reloadDashboard();
    } else if (['bot restart', 'restart bot', 'bot:restart'].includes(command)) {
      await restartBotConnection({ source: 'console' });
    } else if (command === 'dashboard help' || command === 'help') {
      console.log('[Console] Commands: dashboard reload | bot restart | dashboard help');
    }
  });
  console.log('[Dashboard] Console hot reload enabled. Type "dashboard reload" after editing dashboard server files.');
  console.log('[Bot Restart] Type "bot restart" to reconnect the Discord bot without stopping the web panel.');
  return rl;
}

let consoleInterface = null;

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down MultiBot.`);
  try {
    stopTwitchMonitor();
    stopFeatureRuntime();
    stopMusic();
    consoleInterface?.close();
    await stopUptimeMonitor(`Graceful shutdown: ${signal}`);

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
  consoleInterface = registerConsoleCommands();

  try {
    dashboardServer = startDashboard(client);
  } catch (error) {
    console.error('[Dashboard] Failed to initialize web panel:', error);
  }

  await client.login(process.env.DISCORD_TOKEN);
  await waitForReady();

  await startUptimeMonitor(() => ({
    bot: client.isReady(),
    panel: Boolean(dashboardServer?.listening),
  }));
  console.log('[Uptime] Persistent bot and web-panel timesheet monitor started.');

  try {
    await initMusic(client);
    if (!(await waitForMusicConnection())) {
      console.warn('[Music] Local voice runtime is disabled or unavailable.');
    }
  } catch (error) {
    console.error('[Music] Failed to initialize local Discord voice music; the bot will continue without music:', error);
  }

  startTwitchMonitor(client);

  try {
    const sync = await registerSlashCommands(client, slashCommands);
    console.log(
      `[Slash Commands] Automatic startup rebuild complete: global=${sync.globalRegistered ? 'yes' : 'no'}, commands=${sync.commandCount}, added=${sync.globalSummary?.added?.length || 0}, stale-removed=${sync.globalSummary?.removed?.length || 0}, guilds=${sync.guildSummary.synced}/${sync.guildSummary.total}.`,
    );
  } catch (error) {
    console.error('[Slash Commands] Registration failed; the bot and dashboard will continue running:', error);
  }
})().catch(async (error) => {
  console.error('MultiBot startup failed:', error);
  try {
    await stopUptimeMonitor('Startup failure');
    stopTwitchMonitor();
    stopFeatureRuntime();
    stopMusic();
    client.destroy();
  } catch {
    // Ignore cleanup failures while handling a startup error.
  }
  process.exitCode = 1;
});
