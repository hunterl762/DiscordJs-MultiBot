const crypto = require('node:crypto');
const { getPool } = require('./database');
const {
  listSecureRecords,
  listSecureNamespace,
  putSecureRecord,
  deleteSecureRecord,
} = require('./dashboardSecureStore');
const { getStreamAlertAccess } = require('./streamAccessStore');

const PLATFORMS = new Set(['twitch', 'youtube', 'kick']);
const NS = 'stream_announcement';

function normalizePlatform(value) {
  const platform = String(value || 'twitch').trim().toLowerCase();
  if (!PLATFORMS.has(platform)) throw new Error('Unsupported streaming platform.');
  return platform;
}

function normalizeIdentifier(platform, value) {
  const raw = String(value || '').trim();
  if (!raw) throw new Error('Streamer/channel identifier is required.');

  if (platform === 'twitch') {
    const login = raw.replace(/^https?:\/\/(www\.)?twitch\.tv\//i, '').replace(/^@/, '').split(/[/?#]/)[0].toLowerCase();
    if (!/^[a-z0-9_]{3,25}$/.test(login)) throw new Error('Enter a valid Twitch username.');
    return login;
  }

  if (platform === 'youtube') {
    const channelId = raw.replace(/^https?:\/\/(www\.)?youtube\.com\/channel\//i, '').split(/[/?#]/)[0];
    if (!/^[A-Za-z0-9_-]{10,64}$/.test(channelId)) throw new Error('Enter a valid YouTube channel ID.');
    return channelId;
  }

  const kickId = raw.replace(/^https?:\/\/(www\.)?kick\.com\//i, '').split(/[/?#]/)[0];
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(kickId)) throw new Error('Enter a valid Kick broadcaster ID or channel slug.');
  return kickId;
}

function normalizeRecord(guildId, id, payload, createdAt = null, updatedAt = null) {
  const platform = normalizePlatform(payload.platform || 'twitch');
  const identifier = String(payload.streamerIdentifier || payload.twitchLogin || '');
  return {
    id: String(id),
    guildId,
    platform,
    streamerIdentifier: identifier,
    twitchLogin: platform === 'twitch' ? identifier : '',
    discordChannelId: payload.discordChannelId || '',
    customMessage: payload.customMessage || '',
    discordUserId: payload.discordUserId || '',
    liveRoleId: payload.liveRoleId || '',
    roleGrantedByBot: Boolean(payload.roleGrantedByBot),
    enabled: payload.enabled !== false,
    createdBy: payload.createdBy || '',
    isLive: Boolean(payload.isLive),
    lastStreamId: payload.lastStreamId || null,
    lastStartedAt: payload.lastStartedAt || null,
    lastAnnouncedAt: payload.lastAnnouncedAt || null,
    createdAt,
    updatedAt,
  };
}

async function migrateLegacyGuild(guildId) {
  const secure = await listSecureRecords(guildId, NS);
  if (secure.length) return;

  const [rows] = await getPool().execute('SELECT * FROM twitch_announcements WHERE guild_id=?', [guildId]);
  for (const row of rows) {
    const id = crypto.randomUUID();
    await putSecureRecord(guildId, NS, id, {
      platform: 'twitch',
      streamerIdentifier: row.twitch_login,
      discordChannelId: row.discord_channel_id,
      customMessage: row.custom_message || '',
      discordUserId: '',
      liveRoleId: '',
      roleGrantedByBot: false,
      enabled: Boolean(row.enabled),
      createdBy: row.created_by,
      isLive: Boolean(row.is_live),
      lastStreamId: row.last_stream_id || null,
      lastStartedAt: row.last_started_at ? new Date(row.last_started_at).toISOString() : null,
      lastAnnouncedAt: row.last_announced_at ? new Date(row.last_announced_at).toISOString() : null,
    });
  }
  if (rows.length) await getPool().execute('DELETE FROM twitch_announcements WHERE guild_id=?', [guildId]);
}

async function listStreamAnnouncements(guildId) {
  await migrateLegacyGuild(guildId);
  const rows = await listSecureRecords(guildId, NS);
  return rows.map((row) => normalizeRecord(guildId, row.recordKey, row.payload, row.createdAt, row.updatedAt))
    .sort((a, b) => a.platform.localeCompare(b.platform) || a.streamerIdentifier.localeCompare(b.streamerIdentifier));
}

async function listEnabledStreamAnnouncements() {
  const rows = await listSecureNamespace(NS);
  return rows.map((row) => normalizeRecord(row.guildId, row.recordKey, row.payload, row.createdAt, row.updatedAt))
    .filter((item) => item.enabled);
}

async function upsertStreamAnnouncement({
  guildId,
  platform = 'twitch',
  streamerIdentifier,
  twitchLogin,
  discordChannelId,
  customMessage = '',
  discordUserId = '',
  liveRoleId = '',
  createdBy,
}) {
  const normalizedPlatform = normalizePlatform(platform);
  const identifier = normalizeIdentifier(normalizedPlatform, streamerIdentifier || twitchLogin);
  const currentAnnouncements = await listStreamAnnouncements(guildId);
  const existing = currentAnnouncements
    .find((item) => item.platform === normalizedPlatform && item.streamerIdentifier === identifier);

  if (!existing) {
    const access = await getStreamAlertAccess(guildId);
    if (currentAnnouncements.length >= access.streamerLimit) {
      const error = new Error(
        `This server has reached its ${access.tier} Stream Alerts limit of ${access.streamerLimit} configured streamers.`,
      );
      error.code = 'STREAMER_LIMIT_REACHED';
      error.streamerLimit = access.streamerLimit;
      error.streamerCount = currentAnnouncements.length;
      error.tier = access.tier;
      throw error;
    }
  }

  const id = existing?.id || crypto.randomUUID();
  const userId = String(discordUserId || '').trim().slice(0, 32);
  const roleId = String(liveRoleId || '').trim().slice(0, 32);
  const bindingChanged = Boolean(existing && (existing.discordUserId !== userId || existing.liveRoleId !== roleId));

  await putSecureRecord(guildId, NS, id, {
    platform: normalizedPlatform,
    streamerIdentifier: identifier,
    discordChannelId: String(discordChannelId || '').trim().slice(0, 32),
    customMessage: String(customMessage || '').trim().slice(0, 1000),
    discordUserId: userId,
    liveRoleId: roleId,
    roleGrantedByBot: bindingChanged ? false : Boolean(existing?.roleGrantedByBot),
    enabled: true,
    createdBy: String(createdBy || ''),
    isLive: Boolean(existing?.isLive),
    lastStreamId: existing?.lastStreamId || null,
    lastStartedAt: existing?.lastStartedAt || null,
    lastAnnouncedAt: existing?.lastAnnouncedAt || null,
  });

  return { id, platform: normalizedPlatform, streamerIdentifier: identifier };
}

async function deleteStreamAnnouncement(guildId, id) {
  return deleteSecureRecord(guildId, NS, id);
}

async function markStreamLiveState(id, { isLive, streamId = null, startedAt = null, announced = false, roleGrantedByBot }) {
  const rows = await listSecureNamespace(NS);
  const record = rows.find((row) => row.recordKey === String(id));
  if (!record) return false;

  await putSecureRecord(record.guildId, NS, record.recordKey, {
    ...record.payload,
    isLive: Boolean(isLive),
    lastStreamId: streamId,
    lastStartedAt: startedAt ? new Date(startedAt).toISOString() : null,
    lastAnnouncedAt: announced ? new Date().toISOString() : record.payload.lastAnnouncedAt || null,
    roleGrantedByBot: roleGrantedByBot == null ? Boolean(record.payload.roleGrantedByBot) : Boolean(roleGrantedByBot),
  });
  return true;
}

async function markStreamRoleState(id, roleGrantedByBot) {
  const rows = await listSecureNamespace(NS);
  const record = rows.find((row) => row.recordKey === String(id));
  if (!record) return false;

  await putSecureRecord(record.guildId, NS, record.recordKey, {
    ...record.payload,
    roleGrantedByBot: Boolean(roleGrantedByBot),
  });

  return true;
}

function normalizeLogin(value) { return normalizeIdentifier('twitch', value); }

module.exports = {
  PLATFORMS,
  normalizePlatform,
  normalizeIdentifier,
  normalizeLogin,
  listStreamAnnouncements,
  listEnabledStreamAnnouncements,
  upsertStreamAnnouncement,
  deleteStreamAnnouncement,
  markStreamLiveState,
  markStreamRoleState,
  listTwitchAnnouncements: listStreamAnnouncements,
  listEnabledTwitchAnnouncements: listEnabledStreamAnnouncements,
  upsertTwitchAnnouncement: (options) => upsertStreamAnnouncement({ ...options, platform: options.platform || 'twitch', streamerIdentifier: options.streamerIdentifier || options.twitchLogin }),
  deleteTwitchAnnouncement: deleteStreamAnnouncement,
  markTwitchLiveState: markStreamLiveState,
};
