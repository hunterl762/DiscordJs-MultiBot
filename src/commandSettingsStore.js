const { getPool } = require('./database');

const cache = new Map();
const TTL_MS = 30_000;

async function getCommandStates(guildId) {
  const cached = cache.get(guildId);
  if (cached?.expiresAt > Date.now()) return cached.states;

  const [rows] = await getPool().execute(
    'SELECT command_name,enabled FROM server_commands WHERE guild_id=?',
    [guildId],
  );

  const states = new Map(rows.map((row) => [row.command_name, Boolean(row.enabled)]));
  cache.set(guildId, { states, expiresAt: Date.now() + TTL_MS });
  return states;
}

async function isCommandEnabled(guildId, commandName) {
  if (!guildId) return true;
  const states = await getCommandStates(guildId);
  return states.has(commandName) ? states.get(commandName) : true;
}

async function setCommandEnabled(guildId, commandName, enabled) {
  await getPool().execute(
    `INSERT INTO server_commands (guild_id,command_name,enabled)
     VALUES (?,?,?)
     ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),updated_at=CURRENT_TIMESTAMP`,
    [guildId, String(commandName).toLowerCase(), enabled ? 1 : 0],
  );
  cache.delete(guildId);
  return Boolean(enabled);
}

async function getCommandStateObject(guildId, commandNames = []) {
  const states = await getCommandStates(guildId);
  return Object.fromEntries(commandNames.map((name) => [name, states.has(name) ? states.get(name) : true]));
}

module.exports = { isCommandEnabled, setCommandEnabled, getCommandStateObject };
