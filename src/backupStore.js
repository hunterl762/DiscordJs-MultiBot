const crypto = require('node:crypto');
const { ChannelType, PermissionFlagsBits, PermissionOverwriteType } = require('discord.js');
const { getPool } = require('./database');

function serializeOverwrite(overwrite) {
  return { id: overwrite.id, type: overwrite.type, allow: overwrite.allow.bitfield.toString(), deny: overwrite.deny.bitfield.toString() };
}

function snapshotGuild(guild) {
  const roles = [...guild.roles.cache.values()]
    .filter((role) => role.id !== guild.roles.everyone.id)
    .sort((a, b) => a.position - b.position)
    .map((role) => ({
      id: role.id, name: role.name, color: role.color, hoist: role.hoist, position: role.position,
      permissions: role.permissions.bitfield.toString(), mentionable: role.mentionable, managed: role.managed,
      unicodeEmoji: role.unicodeEmoji || null, icon: role.icon || null,
    }));

  const channels = [...guild.channels.cache.values()]
    .sort((a, b) => a.rawPosition - b.rawPosition)
    .map((channel) => ({
      id: channel.id, name: channel.name, type: channel.type, rawPosition: channel.rawPosition,
      parentId: channel.parentId || null, topic: 'topic' in channel ? channel.topic || null : null,
      nsfw: 'nsfw' in channel ? Boolean(channel.nsfw) : false,
      rateLimitPerUser: 'rateLimitPerUser' in channel ? Number(channel.rateLimitPerUser || 0) : 0,
      bitrate: 'bitrate' in channel ? Number(channel.bitrate || 0) : 0,
      userLimit: 'userLimit' in channel ? Number(channel.userLimit || 0) : 0,
      rtcRegion: 'rtcRegion' in channel ? channel.rtcRegion || null : null,
      permissionOverwrites: channel.permissionOverwrites?.cache ? [...channel.permissionOverwrites.cache.values()].map(serializeOverwrite) : [],
    }));

  return { version: 1, guild: { id: guild.id, name: guild.name }, roles, channels, createdAt: new Date().toISOString() };
}

async function createServerBackup(guild, createdBy) {
  await Promise.all([guild.channels.fetch(), guild.roles.fetch()]);
  const snapshot = snapshotGuild(guild);
  const id = crypto.randomUUID();
  await getPool().execute(
    'INSERT INTO server_backups (id,guild_id,created_by,channel_count,role_count,snapshot_json) VALUES (?,?,?,?,?,?)',
    [id, guild.id, createdBy, snapshot.channels.length, snapshot.roles.length, JSON.stringify(snapshot)],
  );
  return { id, guildId: guild.id, channelCount: snapshot.channels.length, roleCount: snapshot.roles.length, createdAt: snapshot.createdAt };
}

async function listServerBackups(guildId, limit = 10) {
  const safeLimit = Math.max(1, Math.min(50, Number(limit) || 10));
  const [rows] = await getPool().query(
    `SELECT id,created_by,channel_count,role_count,created_at FROM server_backups
      WHERE guild_id=? ORDER BY created_at DESC LIMIT ${safeLimit}`,
    [guildId],
  );
  return rows.map((row) => ({ id: row.id, createdBy: row.created_by, channelCount: Number(row.channel_count), roleCount: Number(row.role_count), createdAt: new Date(row.created_at).toISOString() }));
}

async function getServerBackup(guildId, backupId) {
  const [rows] = await getPool().execute('SELECT * FROM server_backups WHERE guild_id=? AND id=? LIMIT 1', [guildId, backupId]);
  const row = rows[0];
  if (!row) return null;
  return { id: row.id, guildId: row.guild_id, createdBy: row.created_by, channelCount: Number(row.channel_count), roleCount: Number(row.role_count), createdAt: new Date(row.created_at).toISOString(), snapshot: JSON.parse(row.snapshot_json) };
}

function restorableType(type) {
  return [ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory, ChannelType.GuildAnnouncement, ChannelType.GuildStageVoice, ChannelType.GuildForum, ChannelType.GuildMedia].includes(type);
}

function channelOptions(data, parent) {
  const options = { name: data.name, parent: parent ?? null, reason: 'MultiBot server backup restore' };
  if ([ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildMedia].includes(data.type)) {
    options.nsfw = Boolean(data.nsfw);
    options.rateLimitPerUser = Number(data.rateLimitPerUser || 0);
    if (data.topic != null) options.topic = data.topic;
  }
  if ([ChannelType.GuildVoice, ChannelType.GuildStageVoice].includes(data.type)) {
    if (data.bitrate) options.bitrate = Number(data.bitrate);
    options.userLimit = Number(data.userLimit || 0);
    options.rtcRegion = data.rtcRegion || null;
  }
  return options;
}

async function resolveOverwrites(guild, snapshot, overwrites, roleMap, warnings) {
  const result = [];
  for (const overwrite of overwrites || []) {
    let id = overwrite.id;
    if (overwrite.type === PermissionOverwriteType.Role) {
      id = overwrite.id === snapshot.guild.id ? guild.roles.everyone.id : roleMap.get(overwrite.id) || (guild.roles.cache.has(overwrite.id) ? overwrite.id : null);
      if (!id) { warnings.push(`Skipped overwrite for missing role ${overwrite.id}.`); continue; }
    } else if (overwrite.type === PermissionOverwriteType.Member) {
      const member = guild.members.cache.get(overwrite.id) || await guild.members.fetch(overwrite.id).catch(() => null);
      if (!member) { warnings.push(`Skipped overwrite for missing member ${overwrite.id}.`); continue; }
      id = member.id;
    }
    result.push({ id, type: overwrite.type, allow: BigInt(overwrite.allow || '0'), deny: BigInt(overwrite.deny || '0') });
  }
  return result;
}

async function restoreServerBackup(guild, backupId) {
  const backup = await getServerBackup(guild.id, backupId);
  if (!backup) return null;
  const me = guild.members.me || await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles) || !me.permissions.has(PermissionFlagsBits.ManageChannels)) {
    throw new Error('MultiBot needs Manage Roles and Manage Channels permissions to restore a server backup.');
  }
  await Promise.all([guild.roles.fetch(), guild.channels.fetch()]);

  const warnings = [];
  const roleMap = new Map([[backup.snapshot.guild.id, guild.roles.everyone.id]]);
  let rolesCreated=0, rolesUpdated=0, rolesSkipped=0;

  for (const data of [...(backup.snapshot.roles || [])].sort((a,b)=>a.position-b.position)) {
    if (data.managed) { const match=guild.roles.cache.find(r=>r.managed&&r.name===data.name); if(match)roleMap.set(data.id,match.id); rolesSkipped++; continue; }
    let role=guild.roles.cache.find(r=>!r.managed&&r.id!==guild.roles.everyone.id&&r.name===data.name);
    const options={name:data.name,colors:{primaryColor:Number(data.color||0)},hoist:Boolean(data.hoist),permissions:BigInt(data.permissions||'0'),mentionable:Boolean(data.mentionable),reason:'MultiBot server backup restore'};
    try {
      if(role){ if(role.editable){role=await role.edit(options);rolesUpdated++;}else{rolesSkipped++;} }
      else {role=await guild.roles.create(options);rolesCreated++;}
      roleMap.set(data.id,role.id);
      if(role.editable) await role.setPosition(data.position,{reason:'MultiBot server backup restore'}).catch(()=>null);
    } catch(error){warnings.push(`Role "${data.name}" failed: ${error.message||error}`);rolesSkipped++;}
  }

  const channelMap=new Map(); let channelsCreated=0,channelsUpdated=0,channelsSkipped=0;
  const channels=[...(backup.snapshot.channels||[])].filter(c=>restorableType(c.type)).sort((a,b)=>a.rawPosition-b.rawPosition);
  const ordered=[...channels.filter(c=>c.type===ChannelType.GuildCategory),...channels.filter(c=>c.type!==ChannelType.GuildCategory)];

  for(const data of ordered){
    const parent=data.parentId ? channelMap.get(data.parentId)||null : null;
    let channel=guild.channels.cache.find(c=>c.type===data.type&&c.name===data.name&&(data.type===ChannelType.GuildCategory||c.parentId===parent));
    try{
      if(channel){channel=await channel.edit(channelOptions(data,parent));channelsUpdated++;}
      else{channel=await guild.channels.create({type:data.type,...channelOptions(data,parent)});channelsCreated++;}
      channelMap.set(data.id,channel.id);
      const overwrites=await resolveOverwrites(guild,backup.snapshot,data.permissionOverwrites,roleMap,warnings);
      await channel.permissionOverwrites.set(overwrites,'MultiBot server backup restore');
      await channel.setPosition(data.rawPosition,{reason:'MultiBot server backup restore'}).catch(()=>null);
    }catch(error){warnings.push(`Channel "${data.name}" failed: ${error.message||error}`);channelsSkipped++;}
  }

  return { backupId: backup.id, rolesCreated, rolesUpdated, rolesSkipped, channelsCreated, channelsUpdated, channelsSkipped, warnings:warnings.slice(0,25), warningCount:warnings.length };
}

module.exports={snapshotGuild,createServerBackup,listServerBackups,getServerBackup,restoreServerBackup};
