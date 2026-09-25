const { getPool } = require('./database');
const { listSecureRecords, getSecureRecord, putSecureRecord } = require('./dashboardSecureStore');

const NS = 'ticket_type';
const DEFAULT_TICKET_TYPES = [
  { key: 'support', label: 'Support', description: 'Get general help from the support team.', emoji: '🎫', sortOrder: 10 },
  { key: 'player_reports', label: 'Player Reports', description: 'Report a player or in-game incident.', emoji: '🚨', sortOrder: 20 },
  { key: 'staff_reports', label: 'Staff Reports', description: 'Privately report a staff member or staff issue.', emoji: '🛡️', sortOrder: 30 },
  { key: 'bug_reports', label: 'Bug Reports', description: 'Report a bug, error, or technical issue.', emoji: '🐛', sortOrder: 40 },
  { key: 'billing', label: 'Billing', description: 'Get help with billing, purchases, or payments.', emoji: '💳', sortOrder: 50 },
  { key: 'applications', label: 'Applications', description: 'Open an application ticket.', emoji: '📝', sortOrder: 60 },
  { key: 'management', label: 'Management', description: 'Contact server management privately.', emoji: '👔', sortOrder: 70 },
];

function defaults(guildId, type) {
  return { guildId, ...type, enabled: true, categoryId: '', staffRoleId: '' };
}

async function ensureTicketTypes(guildId) {
  let rows = await listSecureRecords(guildId, NS);
  if (!rows.length) {
    const [legacy] = await getPool().execute(
      'SELECT type_key,label,description,emoji,enabled,category_id,staff_role_id,sort_order FROM ticket_types WHERE guild_id=?',
      [guildId],
    );
    for (const row of legacy) {
      await putSecureRecord(guildId, NS, row.type_key, {
        guildId,
        key: row.type_key,
        label: row.label,
        description: row.description,
        emoji: row.emoji || '',
        enabled: Boolean(row.enabled),
        categoryId: row.category_id || '',
        staffRoleId: row.staff_role_id || '',
        sortOrder: Number(row.sort_order || 0),
      });
    }
    if (legacy.length) await getPool().execute('DELETE FROM ticket_types WHERE guild_id=?', [guildId]);
  }

  for (const type of DEFAULT_TICKET_TYPES) {
    const current = await getSecureRecord(guildId, NS, type.key);
    if (!current) await putSecureRecord(guildId, NS, type.key, defaults(guildId, type));
  }
}

async function listTicketTypes(guildId, { enabledOnly = false } = {}) {
  await ensureTicketTypes(guildId);
  return (await listSecureRecords(guildId, NS))
    .map((row) => row.payload)
    .filter((item) => !enabledOnly || item.enabled)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.label.localeCompare(b.label));
}

async function getTicketType(guildId, typeKey) {
  await ensureTicketTypes(guildId);
  return (await getSecureRecord(guildId, NS, typeKey))?.payload || null;
}

async function saveTicketType(guildId, typeKey, patch) {
  const definition = DEFAULT_TICKET_TYPES.find((type) => type.key === typeKey);
  if (!definition) throw new Error('Unknown ticket type.');
  const current = await getTicketType(guildId, typeKey) || defaults(guildId, definition);
  const next = {
    ...current,
    label: String(patch.label ?? current.label).trim().slice(0, 80) || current.label,
    description: String(patch.description ?? current.description).trim().slice(0, 200) || current.description,
    emoji: String(patch.emoji ?? current.emoji).trim().slice(0, 32),
    enabled: patch.enabled == null ? current.enabled : Boolean(patch.enabled),
    categoryId: String(patch.categoryId ?? current.categoryId).trim().slice(0, 32),
    staffRoleId: String(patch.staffRoleId ?? current.staffRoleId).trim().slice(0, 32),
  };
  await putSecureRecord(guildId, NS, typeKey, next);
  return next;
}

module.exports = { DEFAULT_TICKET_TYPES, ensureTicketTypes, listTicketTypes, getTicketType, saveTicketType };
