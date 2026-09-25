const { getPool } = require('./database');

const DEFAULT_TICKET_TYPES = [
  { key: 'support', label: 'Support', description: 'Get general help from the support team.', emoji: '🎫', sortOrder: 10 },
  { key: 'player_reports', label: 'Player Reports', description: 'Report a player or in-game incident.', emoji: '🚨', sortOrder: 20 },
  { key: 'staff_reports', label: 'Staff Reports', description: 'Privately report a staff member or staff issue.', emoji: '🛡️', sortOrder: 30 },
  { key: 'bug_reports', label: 'Bug Reports', description: 'Report a bug, error, or technical issue.', emoji: '🐛', sortOrder: 40 },
  { key: 'billing', label: 'Billing', description: 'Get help with billing, purchases, or payments.', emoji: '💳', sortOrder: 50 },
  { key: 'applications', label: 'Applications', description: 'Open an application ticket.', emoji: '📝', sortOrder: 60 },
  { key: 'management', label: 'Management', description: 'Contact server management privately.', emoji: '👔', sortOrder: 70 },
];

function rowToTicketType(row) {
  return {
    guildId: row.guild_id,
    key: row.type_key,
    label: row.label,
    description: row.description,
    emoji: row.emoji || '',
    enabled: Boolean(row.enabled),
    categoryId: row.category_id || '',
    staffRoleId: row.staff_role_id || '',
    sortOrder: Number(row.sort_order || 0),
  };
}

async function ensureTicketTypes(guildId) {
  const pool = getPool();
  for (const type of DEFAULT_TICKET_TYPES) {
    await pool.execute(
      `INSERT IGNORE INTO ticket_types
       (guild_id,type_key,label,description,emoji,enabled,category_id,staff_role_id,sort_order)
       VALUES (?,?,?,?,?,1,'','',?)`,
      [guildId, type.key, type.label, type.description, type.emoji, type.sortOrder],
    );
  }
}

async function listTicketTypes(guildId, { enabledOnly = false } = {}) {
  await ensureTicketTypes(guildId);
  const [rows] = await getPool().execute(
    `SELECT guild_id,type_key,label,description,emoji,enabled,category_id,staff_role_id,sort_order
       FROM ticket_types
      WHERE guild_id = ? ${enabledOnly ? 'AND enabled = 1' : ''}
      ORDER BY sort_order ASC, label ASC`,
    [guildId],
  );
  return rows.map(rowToTicketType);
}

async function getTicketType(guildId, typeKey) {
  await ensureTicketTypes(guildId);
  const [rows] = await getPool().execute(
    `SELECT guild_id,type_key,label,description,emoji,enabled,category_id,staff_role_id,sort_order
       FROM ticket_types
      WHERE guild_id = ? AND type_key = ?
      LIMIT 1`,
    [guildId, typeKey],
  );
  return rows[0] ? rowToTicketType(rows[0]) : null;
}

async function saveTicketType(guildId, typeKey, patch) {
  const allowed = new Set(DEFAULT_TICKET_TYPES.map((type) => type.key));
  if (!allowed.has(typeKey)) throw new Error('Unknown ticket type.');

  const current = await getTicketType(guildId, typeKey);
  const next = {
    ...current,
    label: String(patch.label ?? current.label).trim().slice(0, 80) || current.label,
    description: String(patch.description ?? current.description).trim().slice(0, 200) || current.description,
    emoji: String(patch.emoji ?? current.emoji).trim().slice(0, 32),
    enabled: patch.enabled == null ? current.enabled : Boolean(patch.enabled),
    categoryId: String(patch.categoryId ?? current.categoryId).trim().slice(0, 32),
    staffRoleId: String(patch.staffRoleId ?? current.staffRoleId).trim().slice(0, 32),
  };

  await getPool().execute(
    `UPDATE ticket_types
        SET label=?, description=?, emoji=?, enabled=?, category_id=?, staff_role_id=?
      WHERE guild_id=? AND type_key=?`,
    [next.label, next.description, next.emoji, next.enabled ? 1 : 0, next.categoryId, next.staffRoleId, guildId, typeKey],
  );

  return getTicketType(guildId, typeKey);
}

module.exports = {
  DEFAULT_TICKET_TYPES,
  ensureTicketTypes,
  listTicketTypes,
  getTicketType,
  saveTicketType,
};
