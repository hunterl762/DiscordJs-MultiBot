const { getPool } = require('../database');
const { FEATURE_CATALOG, getFeatureDefinition, defaultFeatureConfig, isFeatureEnvironmentEnabled } = require('./catalog');
const { listSecureRecords, putSecureRecord } = require('../dashboardSecureStore');
const { getGuildSubscription, getPlan } = require('../subscriptionStore');

const cache = new Map();
const CACHE_TTL_MS = 30_000;
const NS = 'feature';

async function migrateLegacy(guildId) {
  const secure = await listSecureRecords(guildId, NS);
  if (secure.length) return secure;

  const [rows] = await getPool().execute(
    'SELECT feature_key,enabled,config_json FROM server_features WHERE guild_id=?',
    [guildId],
  );
  for (const row of rows) {
    let config = {};
    try { config = row.config_json ? JSON.parse(row.config_json) : {}; } catch {}
    await putSecureRecord(guildId, NS, row.feature_key, { enabled: Boolean(row.enabled), config });
  }
  if (rows.length) await getPool().execute('DELETE FROM server_features WHERE guild_id=?', [guildId]);
  return listSecureRecords(guildId, NS);
}

function lockedDashboardDefinition(definition, plan) {
  return {
    ...definition,
    title: `🔒 ${definition.title}`,
    description: `${definition.description} This module is locked on the ${plan.name || plan.tier || 'Free'} tier. Upgrade this server to Premium or Diamond to unlock it.`,
    requirement: 'Subscription required — select View Plans / Upgrade Server below to unlock this module for this Discord server.',
    fields: [],
    link: '/products',
    locked: true,
  };
}

async function getGuildFeatures(guildId) {
  const cached = cache.get(guildId);
  if (cached?.expiresAt > Date.now()) return cached.states;
  const rows = await migrateLegacy(guildId);
  const subscription = await getGuildSubscription(guildId);
  const plan = await getPlan(subscription.tier);
  const entitled = new Set(plan.features || []);
  const byKey = new Map(rows.map((row) => [row.recordKey, row.payload || {}]));
  const states = FEATURE_CATALOG.map((definition) => {
    const payload = byKey.get(definition.key);
    const hasAccess = definition.locked || entitled.has('*') || entitled.has(definition.key);
    const enabled = definition.locked
      ? true
      : isFeatureEnvironmentEnabled(definition)
        && hasAccess
        && (payload ? Boolean(payload.enabled) : Boolean(definition.defaultEnabled));
    return {
      definition: hasAccess ? definition : lockedDashboardDefinition(definition, plan),
      originalDefinition: definition,
      key: definition.key,
      enabled,
      entitled: hasAccess,
      subscriptionLocked: !hasAccess,
      subscriptionTier: subscription.tier,
      subscriptionPlanName: plan.name || subscription.tier,
      config: { ...defaultFeatureConfig(definition), ...(payload?.config || {}) },
      updatedAt: null,
    };
  });
  cache.set(guildId, { states, expiresAt: Date.now() + CACHE_TTL_MS });
  return states;
}

async function getFeature(guildId, key) {
  const states = await getGuildFeatures(guildId);
  return states.find((state) => state.key === key) || null;
}

async function saveFeature(guildId, key, { enabled, config }) {
  const definition = getFeatureDefinition(key);
  if (!definition) throw new Error('Unknown feature.');

  const subscription = await getGuildSubscription(guildId);
  const plan = await getPlan(subscription.tier);
  const entitled = new Set(plan.features || []);
  if (!definition.locked && !entitled.has('*') && !entitled.has(definition.key)) {
    throw new Error(`This module is locked on the ${plan.name || subscription.tier} tier. Upgrade this server at https://kryndexabot.xyz/products to unlock it.`);
  }

  const nextEnabled = definition.locked
    ? true
    : isFeatureEnvironmentEnabled(definition) && Boolean(enabled);
  const merged = { ...defaultFeatureConfig(definition), ...(config || {}) };
  await putSecureRecord(guildId, NS, key, { enabled: nextEnabled, config: merged });
  cache.delete(guildId);
  return getFeature(guildId, key);
}

function clearFeatureCache(guildId) {
  if (guildId) cache.delete(guildId); else cache.clear();
}

module.exports = { getGuildFeatures, getFeature, saveFeature, clearFeatureCache };
