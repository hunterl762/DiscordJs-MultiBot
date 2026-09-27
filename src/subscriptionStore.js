const {
  getSecureRecord,
  listSecureNamespace,
  putSecureRecord,
  deleteSecureRecord,
} = require('./dashboardSecureStore');

const CONFIG_GUILD = '0';
const PLAN_NS = 'subscription_plan';
const SUB_NS = 'subscription_access';
const INVOICE_NS = 'subscription_invoice';
const USAGE_NS = 'subscription_usage';
const TIERS = ['free', 'premium', 'pro'];

const DEFAULTS = {
  free: { name: 'Free', monthlyPrice: 0, yearlyPrice: 0, features: ['tickets','logging','welcome','button_roles','suggestions','reminders'], streamerLimit: 3 },
  premium: { name: 'Premium', monthlyPrice: 4.99, yearlyPrice: 49.99, features: ['tickets','logging','welcome','button_roles','suggestions','reminders','automod','leveling','applications','giveaways','analytics','stream_alerts','music','starboard','invite_tracking'], streamerLimit: 15 },
  pro: { name: 'Pro', monthlyPrice: 8.99, yearlyPrice: 89.99, features: ['*'], streamerLimit: 50 },
};

function normalizeTier(value) {
  const tier = String(value || '').toLowerCase();
  return TIERS.includes(tier) ? tier : 'free';
}

async function getPlan(tier) {
  tier = normalizeTier(tier);
  const row = await getSecureRecord(CONFIG_GUILD, PLAN_NS, tier);
  return { ...DEFAULTS[tier], ...(row?.payload || {}), tier };
}

async function listPlans() {
  return Promise.all(TIERS.map(getPlan));
}

async function savePlan(tier, patch = {}) {
  tier = normalizeTier(tier);
  const current = await getPlan(tier);
  const features = Array.isArray(patch.features)
    ? [...new Set(patch.features.map(String).filter(Boolean))]
    : current.features;
  const next = {
    name: String(patch.name || current.name).trim().slice(0, 40),
    monthlyPrice: Math.max(0, Number(patch.monthlyPrice ?? current.monthlyPrice) || 0),
    yearlyPrice: Math.max(0, Number(patch.yearlyPrice ?? current.yearlyPrice) || 0),
    streamerLimit: Math.max(0, Math.floor(Number(patch.streamerLimit ?? current.streamerLimit) || 0)),
    features,
  };
  await putSecureRecord(CONFIG_GUILD, PLAN_NS, tier, next);
  return { ...next, tier };
}

async function getGuildSubscription(guildId) {
  const id = String(guildId);
  const row = await getSecureRecord(id, SUB_NS, 'current');
  const payload = row?.payload || {};
  return {
    guildId: id,
    tier: normalizeTier(payload.tier),
    status: String(payload.status || (payload.tier ? 'active' : 'free')),
    provider: String(payload.provider || 'manual'),
    customerId: String(payload.customerId || ''),
    subscriptionId: String(payload.subscriptionId || ''),
    currentPeriodEnd: payload.currentPeriodEnd || null,
    note: String(payload.note || ''),
    updatedAt: row?.updatedAt || null,
  };
}

async function setGuildSubscription(guildId, data = {}) {
  const id = String(guildId || '').trim();
  if (!/^\d{10,32}$/.test(id)) throw new Error('A valid Discord server ID is required.');
  const tier = normalizeTier(data.tier);
  if (tier === 'free') {
    await deleteSecureRecord(id, SUB_NS, 'current');
    return getGuildSubscription(id);
  }
  await putSecureRecord(id, SUB_NS, 'current', {
    tier,
    status: String(data.status || 'active').slice(0, 32),
    provider: String(data.provider || 'manual').slice(0, 32),
    customerId: String(data.customerId || '').slice(0, 128),
    subscriptionId: String(data.subscriptionId || '').slice(0, 128),
    currentPeriodEnd: data.currentPeriodEnd || null,
    note: String(data.note || '').slice(0, 500),
    grantedBy: String(data.grantedBy || '').slice(0, 32),
  });
  return getGuildSubscription(id);
}

async function getUserSubscription(userId) {
  const id = String(userId || '').trim();
  const row = await getSecureRecord('user:' + id, SUB_NS, 'current');
  const payload = row?.payload || {};
  return { userId: id, tier: normalizeTier(payload.tier), status: String(payload.status || (payload.tier ? 'active' : 'free')), provider: String(payload.provider || 'manual'), note: String(payload.note || ''), updatedAt: row?.updatedAt || null };
}

async function setUserSubscription(userId, data = {}) {
  const id = String(userId || '').trim();
  if (!/^\d{10,32}$/.test(id)) throw new Error('A valid Discord user ID is required.');
  const tier = normalizeTier(data.tier);
  if (tier === 'free') {
    await deleteSecureRecord('user:' + id, SUB_NS, 'current');
    return getUserSubscription(id);
  }
  await putSecureRecord('user:' + id, SUB_NS, 'current', {
    tier, status: String(data.status || 'active').slice(0, 32), provider: String(data.provider || 'manual').slice(0, 32),
    note: String(data.note || '').slice(0, 500), grantedBy: String(data.grantedBy || '').slice(0, 32),
  });
  return getUserSubscription(id);
}

async function listUserSubscriptions() {
  const rows = await listSecureNamespace(SUB_NS);
  return Promise.all(rows.filter(r => r.recordKey === 'current' && String(r.guildId).startsWith('user:')).map(r => getUserSubscription(String(r.guildId).slice(5))));
}

async function listSubscriptions() {
  const rows = await listSecureNamespace(SUB_NS);
  return Promise.all(rows.filter(r => r.recordKey === 'current' && !String(r.guildId).startsWith('user:')).map(r => getGuildSubscription(r.guildId)));
}

async function canUseFeature(guildId, featureKey) {
  const subscription = await getGuildSubscription(guildId);
  const plan = await getPlan(subscription.tier);
  return plan.features.includes('*') || plan.features.includes(String(featureKey));
}

async function logInvoice(guildId, invoice = {}) {
  const id = String(guildId);
  const key = String(invoice.id || ('manual-' + Date.now())).slice(0, 128);
  await putSecureRecord(id, INVOICE_NS, key, {
    amount: Number(invoice.amount || 0),
    currency: String(invoice.currency || 'USD').toUpperCase().slice(0, 8),
    status: String(invoice.status || 'paid').slice(0, 32),
    provider: String(invoice.provider || 'manual').slice(0, 32),
    customerId: String(invoice.customerId || '').slice(0, 128),
    createdAt: invoice.createdAt || new Date().toISOString(),
  });
}

async function listInvoices() {
  return listSecureNamespace(INVOICE_NS);
}

async function recordUsage(guildId, featureKey, amount = 1) {
  const date = new Date().toISOString().slice(0, 10);
  const key = date + ':' + String(featureKey).slice(0, 64);
  const current = await getSecureRecord(String(guildId), USAGE_NS, key);
  await putSecureRecord(String(guildId), USAGE_NS, key, {
    featureKey: String(featureKey).slice(0, 64),
    date,
    amount: Number(current?.payload?.amount || 0) + Math.max(0, Number(amount) || 0),
  });
}

async function listUsage() {
  return listSecureNamespace(USAGE_NS);
}

module.exports = {
  TIERS, DEFAULTS, getPlan, listPlans, savePlan,
  getGuildSubscription, setGuildSubscription, listSubscriptions,
  getUserSubscription, setUserSubscription, listUserSubscriptions,
  canUseFeature, logInvoice, listInvoices, recordUsage, listUsage,
};
