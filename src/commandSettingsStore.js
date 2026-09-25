const { getPool } = require('./database');
const { listSecureRecords, putSecureRecord } = require('./dashboardSecureStore');

const cache = new Map();
const TTL_MS = 30_000;
const NS = 'command';

async function migrateLegacy(guildId) {
  const secure = await listSecureRecords(guildId, NS);
  if (secure.length) return secure;

  const [rows] = await getPool().execute(
    'SELECT command_name,enabled FROM server_commands WHERE guild_id=?',
    [guildId],
  );
  for (const row of rows) {
    await putSecureRecord(guildId, NS, row.command_name, { enabled: Boolean(row.enabled) });
  }
  if (rows.length) await getPool().execute('DELETE FROM server_commands WHERE guild_id=?', [guildId]);
  return listSecureRecords(guildId, NS);
}

async function getCommandStates(guildId) {
  const cached = cache.get(guildId);
  if (cached?.expiresAt > Date.now()) return cached.states;
  const rows = await migrateLegacy(guildId);
  const states = new Map(rows.map((row) => [row.recordKey, row.payload?.enabled !== false]));
  cache.set(guildId, { states, expiresAt: Date.now() + TTL_MS });
  return states;
}

async function isCommandEnabled(guildId, commandName) {
  if (!guildId) return true;
  const states = await getCommandStates(guildId);
  return states.has(commandName) ? states.get(commandName) : true;
}

async function setCommandEnabled(guildId, commandName, enabled) {
  await putSecureRecord(guildId, NS, String(commandName).toLowerCase(), { enabled: Boolean(enabled) });
  cache.delete(guildId);
  return Boolean(enabled);
}

async function getCommandStateObject(guildId, commandNames = []) {
  const states = await getCommandStates(guildId);
  return Object.fromEntries(commandNames.map((name) => [name, states.has(name) ? states.get(name) : true]));
}

module.exports = { isCommandEnabled, setCommandEnabled, getCommandStateObject };
