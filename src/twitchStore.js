const { getPool } = require('./database');

function normalizeLogin(value) {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '')
    .replace(/^@/, '')
    .split(/[/?#]/)[0]
    .toLowerCase();
}

async function listTwitchAnnouncements(guildId) {
  const [rows] = await getPool().execute(
    `SELECT id,guild_id,twitch_login,discord_channel_id,custom_message,enabled,created_by,
            is_live,last_stream_id,last_started_at,last_announced_at,created_at,updated_at
       FROM twitch_announcements
      WHERE guild_id = ?
      ORDER BY twitch_login ASC`,
    [guildId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    guildId: row.guild_id,
    twitchLogin: row.twitch_login,
    discordChannelId: row.discord_channel_id,
    customMessage: row.custom_message || '',
    enabled: Boolean(row.enabled),
    createdBy: row.created_by,
    isLive: Boolean(row.is_live),
    lastStreamId: row.last_stream_id || null,
    lastStartedAt: row.last_started_at ? new Date(row.last_started_at).toISOString() : null,
    lastAnnouncedAt: row.last_announced_at ? new Date(row.last_announced_at).toISOString() : null,
  }));
}

async function listEnabledTwitchAnnouncements() {
  const [rows] = await getPool().query(
    `SELECT id,guild_id,twitch_login,discord_channel_id,custom_message,enabled,created_by,
            is_live,last_stream_id,last_started_at,last_announced_at
       FROM twitch_announcements
      WHERE enabled = 1
      ORDER BY id ASC`,
  );
  return rows.map((row) => ({
    id: String(row.id),
    guildId: row.guild_id,
    twitchLogin: row.twitch_login,
    discordChannelId: row.discord_channel_id,
    customMessage: row.custom_message || '',
    enabled: Boolean(row.enabled),
    createdBy: row.created_by,
    isLive: Boolean(row.is_live),
    lastStreamId: row.last_stream_id || null,
    lastStartedAt: row.last_started_at ? new Date(row.last_started_at).toISOString() : null,
    lastAnnouncedAt: row.last_announced_at ? new Date(row.last_announced_at).toISOString() : null,
  }));
}

async function upsertTwitchAnnouncement({ guildId, twitchLogin, discordChannelId, customMessage = '', createdBy }) {
  const login = normalizeLogin(twitchLogin);
  if (!/^[a-z0-9_]{3,25}$/.test(login)) {
    throw new Error('Enter a valid Twitch username.');
  }

  await getPool().execute(
    `INSERT INTO twitch_announcements (
       guild_id,twitch_login,discord_channel_id,custom_message,enabled,created_by
     ) VALUES (?,?,?,?,1,?)
     ON DUPLICATE KEY UPDATE
       discord_channel_id = VALUES(discord_channel_id),
       custom_message = VALUES(custom_message),
       enabled = 1,
       created_by = VALUES(created_by),
       updated_at = CURRENT_TIMESTAMP`,
    [guildId, login, discordChannelId, String(customMessage || '').trim().slice(0, 500), createdBy],
  );

  const [rows] = await getPool().execute(
    'SELECT id FROM twitch_announcements WHERE guild_id=? AND twitch_login=? LIMIT 1',
    [guildId, login],
  );
  return { id: String(rows[0].id), twitchLogin: login };
}

async function deleteTwitchAnnouncement(guildId, id) {
  const [result] = await getPool().execute(
    'DELETE FROM twitch_announcements WHERE guild_id=? AND id=?',
    [guildId, id],
  );
  return result.affectedRows > 0;
}

async function markTwitchLiveState(id, { isLive, streamId = null, startedAt = null, announced = false }) {
  const fields = ['is_live=?', 'last_stream_id=?', 'last_started_at=?'];
  const values = [isLive ? 1 : 0, streamId, startedAt ? new Date(startedAt) : null];

  if (announced) {
    fields.push('last_announced_at=CURRENT_TIMESTAMP');
  }

  values.push(id);
  await getPool().execute(
    `UPDATE twitch_announcements SET ${fields.join(', ')} WHERE id=?`,
    values,
  );
}

module.exports = {
  normalizeLogin,
  listTwitchAnnouncements,
  listEnabledTwitchAnnouncements,
  upsertTwitchAnnouncement,
  deleteTwitchAnnouncement,
  markTwitchLiveState,
};
