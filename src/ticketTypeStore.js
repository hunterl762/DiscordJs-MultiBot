const { getPool } = require('./database');
const { listSecureRecords, getSecureRecord, putSecureRecord } = require('./dashboardSecureStore');
const { getGuildSubscription } = require('./subscriptionStore');

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

const TICKET_TYPES_BY_TIER = Object.freeze({
  free: new Set(['support']),
  pro: new Set(['support', 'player_reports', 'staff_reports', 'bug_reports']),
  premium: new Set(['support', 'player_reports', 'staff_reports', 'billing', 'applications', 'management']),
});

function ownerGuildIds() {
  return new Set(
    String(process.env.BOT_OWNER_GUILD_IDS || process.env.BOT_OWNER_GUILD_ID || '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

function normalizeTier(tier) {
  const value = String(tier || 'free').trim().toLowerCase();
  return TICKET_TYPES_BY_TIER[value] ? value : 'free';
}

function ticketTypeAllowedForTier(typeKey, tier, guildId) {
  const key = String(typeKey || '').trim().toLowerCase();
  if (!TICKET_TYPES_BY_TIER[normalizeTier(tier)].has(key)) return false;
  // Billing tickets are reserved for the bot owner's Discord server(s).
  if (key === 'billing') return ownerGuildIds().has(String(guildId));
  return true;
}

async function getTicketTypeAccess(guildId) {
  const subscription = await getGuildSubscription(guildId);
  const tier = normalizeTier(subscription?.tier);
  return {
    tier,
    allowed: new Set([...TICKET_TYPES_BY_TIER[tier]].filter((key) => ticketTypeAllowedForTier(key, tier, guildId))),
  };
}

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

async function listTicketTypes(guildId, { enabledOnly = false, includeLocked = false } = {}) {
  await ensureTicketTypes(guildId);
  const access = await getTicketTypeAccess(guildId);
  return (await listSecureRecords(guildId, NS))
    .map((row) => row.payload)
    .map((item) => ({ ...item, subscriptionLocked: !access.allowed.has(item.key), requiredTier: item.key === 'support' ? 'Free' : ['player_reports', 'staff_reports', 'bug_reports'].includes(item.key) ? 'Pro' : 'Premium' }))
    .filter((item) => includeLocked || !item.subscriptionLocked)
    .filter((item) => !enabledOnly || item.enabled)
    .sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0) || a.label.localeCompare(b.label));
}

async function getTicketType(guildId, typeKey, { includeLocked = false } = {}) {
  await ensureTicketTypes(guildId);
  const item = (await getSecureRecord(guildId, NS, typeKey))?.payload || null;
  if (!item) return null;
  const access = await getTicketTypeAccess(guildId);
  const subscriptionLocked = !access.allowed.has(item.key);
  if (subscriptionLocked && !includeLocked) return null;
  return { ...item, subscriptionLocked };
}

async function saveTicketType(guildId, typeKey, patch) {
  const definition = DEFAULT_TICKET_TYPES.find((type) => type.key === typeKey);
  if (!definition) throw new Error('Unknown ticket type.');

  const access = await getTicketTypeAccess(guildId);
  if (!access.allowed.has(typeKey)) {
    if (typeKey === 'billing') throw new Error('Billing tickets are only available in the bot owner Discord server.');
    throw new Error(`The ${definition.label} ticket department is not available on this server's ${access.tier} plan.`);
  }

  const current = await getTicketType(guildId, typeKey, { includeLocked: true }) || defaults(guildId, definition);
  const next = {
    ...current,
    label: String(patch.label ?? current.label).trim().slice(0, 80) || current.label,
    description: String(patch.description ?? current.description).trim().slice(0, 200) || current.description,
    emoji: String(patch.emoji ?? current.emoji).trim().slice(0, 32),
    enabled: patch.enabled == null ? current.enabled : Boolean(patch.enabled),
    categoryId: String(patch.categoryId ?? current.categoryId).trim().slice(0, 32),
    staffRoleId: String(patch.staffRoleId ?? current.staffRoleId).trim().slice(0, 32),
  };
  delete next.subscriptionLocked;
  delete next.requiredTier;
  await putSecureRecord(guildId, NS, typeKey, next);
  return next;
}

module.exports = {
  DEFAULT_TICKET_TYPES,
  TICKET_TYPES_BY_TIER,
  ensureTicketTypes,
  getTicketTypeAccess,
  ticketTypeAllowedForTier,
  listTicketTypes,
  getTicketType,
  saveTicketType,
};