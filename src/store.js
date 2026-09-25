const { getPool } = require('./database');

const settingsCache = new Map();
const SETTINGS_CACHE_TTL_MS = Math.max(5_000, Number(process.env.SETTINGS_CACHE_TTL_MS || 60_000));

function defaultGuildSettings() {
  return {
    prefix: process.env.DEFAULT_PREFIX || '!',
    welcomeChannelId: '',
    leaveChannelId: '',
    logsChannelId: '',
    verificationLogChannelId: '',
    roleLogChannelId: '',
    broadcastChannelId: '',
    verificationChannelId: '',
    verifiedRoleId: '',
    unverifiedRoleId: '',
    ticketsCategoryId: '',
    ticketPanelChannelId: '',
    ticketStaffRoleId: '',
    transcriptChannelId: '',
    maxOpenTicketsPerUser: 3,
    onlineTranscriptsEnabled: true,
    transcriptAttachmentsEnabled: true,
    ticketsEnabled: true,
    loggingEnabled: true,
    welcomeEnabled: true,
    verificationEnabled: false,
    prefixCommandsEnabled: true,
  };
}

function bool(value) {
  return value === true || value === 1 || value === '1';
}

function rowToSettings(row) {
  if (!row) return defaultGuildSettings();
  return {
    prefix: row.prefix || process.env.DEFAULT_PREFIX || '!',
    welcomeChannelId: row.welcome_channel_id || '',
    leaveChannelId: row.leave_channel_id || '',
    logsChannelId: row.logs_channel_id || '',
    verificationLogChannelId: row.verification_log_channel_id || '',
    roleLogChannelId: row.role_log_channel_id || '',
    broadcastChannelId: row.broadcast_channel_id || '',
    verificationChannelId: row.verification_channel_id || '',
    verifiedRoleId: row.verified_role_id || '',
    unverifiedRoleId: row.unverified_role_id || '',
    ticketsCategoryId: row.tickets_category_id || '',
    ticketPanelChannelId: row.ticket_panel_channel_id || '',
    ticketStaffRoleId: row.ticket_staff_role_id || '',
    transcriptChannelId: row.transcript_channel_id || '',
    maxOpenTicketsPerUser: Math.max(1, Math.min(25, Number(row.max_open_tickets_per_user || 3))),
    onlineTranscriptsEnabled: bool(row.online_transcripts_enabled),
    transcriptAttachmentsEnabled: bool(row.transcript_attachments_enabled),
    ticketsEnabled: bool(row.tickets_enabled),
    loggingEnabled: bool(row.logging_enabled),
    welcomeEnabled: bool(row.welcome_enabled),
    verificationEnabled: bool(row.verification_enabled),
    prefixCommandsEnabled: bool(row.prefix_commands_enabled),
  };
}

function cacheSettings(guildId, settings) {
  settingsCache.set(guildId, { settings, expiresAt: Date.now() + SETTINGS_CACHE_TTL_MS });
  return settings;
}

async function getGuildSettings(guildId) {
  const cached = settingsCache.get(guildId);
  if (cached && cached.expiresAt > Date.now()) return cached.settings;

  const [rows] = await getPool().execute(
    `SELECT prefix, welcome_channel_id, leave_channel_id, logs_channel_id, verification_log_channel_id,
            role_log_channel_id, broadcast_channel_id, verification_channel_id, verified_role_id,
            unverified_role_id, tickets_category_id, ticket_panel_channel_id, ticket_staff_role_id,
            transcript_channel_id, max_open_tickets_per_user, online_transcripts_enabled,
            transcript_attachments_enabled, tickets_enabled, logging_enabled, welcome_enabled,
            verification_enabled, prefix_commands_enabled
       FROM guild_settings WHERE guild_id = ? LIMIT 1`,
    [guildId],
  );

  return cacheSettings(guildId, rowToSettings(rows[0]));
}

async function saveGuildSettings(guildId, settings) {
  const merged = { ...defaultGuildSettings(), ...settings };
  merged.maxOpenTicketsPerUser = Math.max(1, Math.min(25, Number(merged.maxOpenTicketsPerUser || 3)));

  await getPool().execute(
    `INSERT INTO guild_settings (
       guild_id, prefix, welcome_channel_id, leave_channel_id, logs_channel_id, verification_log_channel_id,
       role_log_channel_id, broadcast_channel_id, verification_channel_id, verified_role_id, unverified_role_id,
       tickets_category_id, ticket_panel_channel_id, ticket_staff_role_id, transcript_channel_id,
       max_open_tickets_per_user, online_transcripts_enabled, transcript_attachments_enabled, tickets_enabled,
       logging_enabled, welcome_enabled, verification_enabled, prefix_commands_enabled
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       prefix = VALUES(prefix),
       welcome_channel_id = VALUES(welcome_channel_id),
       leave_channel_id = VALUES(leave_channel_id),
       logs_channel_id = VALUES(logs_channel_id),
       verification_log_channel_id = VALUES(verification_log_channel_id),
       role_log_channel_id = VALUES(role_log_channel_id),
       broadcast_channel_id = VALUES(broadcast_channel_id),
       verification_channel_id = VALUES(verification_channel_id),
       verified_role_id = VALUES(verified_role_id),
       unverified_role_id = VALUES(unverified_role_id),
       tickets_category_id = VALUES(tickets_category_id),
       ticket_panel_channel_id = VALUES(ticket_panel_channel_id),
       ticket_staff_role_id = VALUES(ticket_staff_role_id),
       transcript_channel_id = VALUES(transcript_channel_id),
       max_open_tickets_per_user = VALUES(max_open_tickets_per_user),
       online_transcripts_enabled = VALUES(online_transcripts_enabled),
       transcript_attachments_enabled = VALUES(transcript_attachments_enabled),
       tickets_enabled = VALUES(tickets_enabled),
       logging_enabled = VALUES(logging_enabled),
       welcome_enabled = VALUES(welcome_enabled),
       verification_enabled = VALUES(verification_enabled),
       prefix_commands_enabled = VALUES(prefix_commands_enabled)`,
    [
      guildId,
      merged.prefix,
      merged.welcomeChannelId,
      merged.leaveChannelId,
      merged.logsChannelId,
      merged.verificationLogChannelId,
      merged.roleLogChannelId,
      merged.broadcastChannelId,
      merged.verificationChannelId,
      merged.verifiedRoleId,
      merged.unverifiedRoleId,
      merged.ticketsCategoryId,
      merged.ticketPanelChannelId,
      merged.ticketStaffRoleId,
      merged.transcriptChannelId,
      merged.maxOpenTicketsPerUser,
      merged.onlineTranscriptsEnabled ? 1 : 0,
      merged.transcriptAttachmentsEnabled ? 1 : 0,
      merged.ticketsEnabled ? 1 : 0,
      merged.loggingEnabled ? 1 : 0,
      merged.welcomeEnabled ? 1 : 0,
      merged.verificationEnabled ? 1 : 0,
      merged.prefixCommandsEnabled ? 1 : 0,
    ],
  );

  return cacheSettings(guildId, merged);
}

function rowToTicket(row) {
  if (!row) return null;
  return {
    id: row.id,
    guildId: row.guild_id,
    channelId: row.channel_id,
    userId: row.user_id,
    ticketTypeKey: row.ticket_type_key || 'support',
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    closedBy: row.closed_by || null,
    claimedBy: row.claimed_by || null,
    closeReason: row.close_reason || null,
    transcriptPublicToken: row.transcript_public_token || null,
    transcriptFile: row.transcript_filename || null,
    transcriptHtml: row.transcript_html ?? null,
  };
}

async function getTicket(ticketId) {
  const [rows] = await getPool().execute(
    'SELECT * FROM tickets WHERE id = ? LIMIT 1',
    [ticketId],
  );
  return rowToTicket(rows[0]);
}

async function getTicketByPublicToken(token) {
  const [rows] = await getPool().execute(
    'SELECT * FROM tickets WHERE transcript_public_token = ? LIMIT 1',
    [token],
  );
  return rowToTicket(rows[0]);
}

async function findOpenTicket(guildId, userId, ticketTypeKey = null) {
  const select = 'SELECT id,guild_id,channel_id,user_id,ticket_type_key,status,created_at,closed_at,closed_by,claimed_by,close_reason,transcript_public_token,transcript_filename,NULL AS transcript_html FROM tickets';
  const sql = ticketTypeKey
    ? `${select} WHERE guild_id=? AND user_id=? AND ticket_type_key=? AND status='open' ORDER BY created_at DESC LIMIT 1`
    : `${select} WHERE guild_id=? AND user_id=? AND status='open' ORDER BY created_at DESC LIMIT 1`;
  const params = ticketTypeKey ? [guildId, userId, ticketTypeKey] : [guildId, userId];
  const [rows] = await getPool().execute(sql, params);
  return rowToTicket(rows[0]);
}

async function countOpenTickets(guildId, userId) {
  const [rows] = await getPool().execute(
    "SELECT COUNT(*) AS count FROM tickets WHERE guild_id=? AND user_id=? AND status='open'",
    [guildId, userId],
  );
  return Number(rows[0]?.count || 0);
}

async function findTicketByChannel(channelId) {
  const [rows] = await getPool().execute(
    'SELECT id,guild_id,channel_id,user_id,ticket_type_key,status,created_at,closed_at,closed_by,claimed_by,close_reason,transcript_public_token,transcript_filename,NULL AS transcript_html FROM tickets WHERE channel_id=? ORDER BY created_at DESC LIMIT 1',
    [channelId],
  );
  return rowToTicket(rows[0]);
}

async function saveTicket(ticket) {
  await getPool().execute(
    'INSERT INTO tickets (id,guild_id,channel_id,user_id,ticket_type_key,status,created_at,closed_at,closed_by,claimed_by,close_reason,transcript_public_token,transcript_filename,transcript_html) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
    [
      ticket.id,
      ticket.guildId,
      ticket.channelId,
      ticket.userId,
      ticket.ticketTypeKey || 'support',
      ticket.status || 'open',
      new Date(ticket.createdAt),
      ticket.closedAt ? new Date(ticket.closedAt) : null,
      ticket.closedBy || null,
      ticket.claimedBy || null,
      ticket.closeReason || null,
      ticket.transcriptPublicToken || null,
      ticket.transcriptFile || null,
      ticket.transcriptHtml || null,
    ],
  );
  return ticket;
}

async function updateTicket(ticketId, patch) {
  const allowed = {
    status: 'status',
    closedAt: 'closed_at',
    closedBy: 'closed_by',
    claimedBy: 'claimed_by',
    closeReason: 'close_reason',
    transcriptPublicToken: 'transcript_public_token',
    transcriptFile: 'transcript_filename',
    transcriptHtml: 'transcript_html',
  };

  const assignments = [];
  const values = [];

  for (const [key, column] of Object.entries(allowed)) {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
    assignments.push(`${column} = ?`);
    const value = patch[key];
    values.push(key.endsWith('At') && value ? new Date(value) : value);
  }

  if (!assignments.length) return getTicket(ticketId);

  values.push(ticketId);
  const [result] = await getPool().execute(
    `UPDATE tickets SET ${assignments.join(', ')} WHERE id = ?`,
    values,
  );

  if (!result.affectedRows) return null;
  return getTicket(ticketId);
}

async function listGuildTickets(guildId) {
  const [rows] = await getPool().execute(
    'SELECT id,guild_id,channel_id,user_id,ticket_type_key,status,created_at,closed_at,closed_by,claimed_by,close_reason,transcript_public_token,transcript_filename,NULL AS transcript_html FROM tickets WHERE guild_id=? ORDER BY created_at DESC LIMIT 100',
    [guildId],
  );
  return rows.map(rowToTicket);
}

module.exports = {
  defaultGuildSettings,
  getGuildSettings,
  saveGuildSettings,
  getTicket,
  getTicketByPublicToken,
  findOpenTicket,
  countOpenTickets,
  findTicketByChannel,
  saveTicket,
  updateTicket,
  listGuildTickets,
};
