require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  REST,
  Routes,
} = require('discord.js');
const { slashCommands } = require('./bot/commands');
const { registerEvents } = require('./bot/events');
const { registerInteractions } = require('./bot/interactions');
const { startDashboard } = require('./dashboard/server');

const required = ['DISCORD_TOKEN', 'DISCORD_CLIENT_ID', 'DISCORD_CLIENT_SECRET', 'DISCORD_REDIRECT_URI', 'SESSION_SECRET'];
const missing = required.filter((key) => !process.env[key]);
if (missing.length) {
  console.error(`Missing environment variables: ${missing.join(', ')}`);
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User],
});

registerEvents(client);
registerInteractions(client);

async function registerSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  if (process.env.DEV_GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, process.env.DEV_GUILD_ID), { body: slashCommands });
    console.log(`Registered ${slashCommands.length} guild slash commands.`);
  } else {
    await rest.put(Routes.applicationCommands(process.env.DISCORD_CLIENT_ID), { body: slashCommands });
    console.log(`Registered ${slashCommands.length} global slash commands.`);
  }
}

(async () => {
  await registerSlashCommands();
  await client.login(process.env.DISCORD_TOKEN);
  startDashboard(client);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
