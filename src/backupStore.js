const crypto = require('node:crypto');
const { getPool } = require('./database');

function serializeOverwrite(overwrite) {
  return {
    id: overwrite.id,
    type: overwrite.type,
    allow: overwrite.allow.bitfield.toString(),
    deny: overwrite.deny.bitfield.toString(),
  };
}

function snapshotGuild(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.roles.everyone.id)
    .sort((a, b) => a.position - b.position)
    .map((role) => ({
      id: role.id,
      name: role.name,
      color: role.color,
      hoist: role.hoist,
      position: role.position,
      permissions: role.permissions.bitfield.toString(),
      mentionable: role.mentionable,
      managed: role.managed,
      unicodeEmoji: role.unicodeEmoji || null,
      icon: role.icon || null,
    }));

  const channels = [...guild.channels.cache.values()]
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((channel) => ({
      id: channel.id,
      name: channel.name,
      type: channel.type,
      rawPosition: channel.rawPosition,
      parentId: channel.parentId || null,
      topic: 'topic' in channel ? channel.topic || null : null,
      nsfw: 'nsfw' in channel ? Boolean(channel.nsfw) : false,
      rateLimitPerUser: 'rateLimitPerUser' in channel ? Number(channel.rateLimitPerUser || 0) : 0,
      bitrate: 'bitrate' in channel ? Number(channel.bitrate || 0) : 0,
      userLimit: 'userLimit' in channel ? Number(channel.userLimit || 0) : 0,
      rtcRegion: 'rtcRegion' in channel ? channel.rtcRegion || null : null,
      permissionOverwrites: channel.permissionOverwrites?.cache
        ? [...channel.permissionOverwrites.cache.values()].map(serializeOverwrite)
        : [],
    }));

  return {
    version: 1,
    guild: {
      id: guild.id,
      name: guild.name,
      verificationLevel: guild.verificationLevel,
      defaultMessageNotifications: guild.defaultMessageNotifications,
      explicitContentFilter: guild.explicitContentFilter,
      preferredLocale: guild.preferredLocale,
    },
    roles,
    channels,
    createdAt: new Date().toISOString(),
  };
}

async function createServerBackup(guild, createdBy) {
  await Promise.all([
    guild.channels.fetch(),
    guild.roles.fetch(),
  ]);

  const snapshot = snapshotGuild(guild);
  const id = crypto.randomUUID();

  await getPool().execute(
    `INSERT INTO server_backups
      (id,guild_id,created_by,channel_count,role_count,snapshot_json)
     VALUES (?,?,?,?,?,?)`,
    [id, guild.id, createdBy, snapshot.channels.length, snapshot.roles.length, JSON.stringify(snapshot)],
  );

  return {
    id,
    guildId: guild.id,
    channelCount: snapshot.channels.length,
    roleCount: snapshot.roles.length,
    createdAt: snapshot.createdAt,
  };
}

async function listServerBackups(guildId, limit = 10) {
  const [rows] = await getPool().execute(
    `SELECT id,created_by,channel_count,role_count,created_at
       FROM server_backups WHERE guild_id=?
       ORDER BY created_at DESC LIMIT ?`,
    [guildId, Number(limit)],
  );

  return rows.map((row) => ({
    id: row.id,
    createdBy: row.created_by,
    channelCount: Number(row.channel_count),
    roleCount: Number(row.role_count),
    createdAt: new Date(row.created_at).toISOString(),
  }));
}

async function getServerBackup(guildId, backupId) {
  const [rows] = await getPool().execute(
    'SELECT * FROM server_backups WHERE guild_id=? AND id=? LIMIT 1',
    [guildId, backupId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    createdBy: row.created_by,
    channelCount: Number(row.channel_count),
    roleCount: Number(row.role_count),
    createdAt: new Date(row.created_at).toISOString(),
    snapshot: JSON.parse(row.snapshot_json),
  };
}

module.exports = { snapshotGuild, createServerBackup, listServerBackups, getServerBackup };
