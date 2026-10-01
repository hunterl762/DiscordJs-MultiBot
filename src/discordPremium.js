'use strict';

const { getPlan, setGuildSubscription, setUserSubscription } = require('./subscriptionStore');

const API = 'https://discord.com/api/v10';
const APPLICATION_ID = String(process.env.DISCORD_APPLICATION_ID || process.env.CLIENT_ID || '').trim();
const BOT_TOKEN = String(process.env.DISCORD_TOKEN || process.env.BOT_TOKEN || '').trim();

const SKU_MAP = {
  premium_user: String(process.env.DISCORD_SKU_PREMIUM_USER || '').trim(),
  pro_user: String(process.env.DISCORD_SKU_PRO_USER || '').trim(),
  premium_guild: String(process.env.DISCORD_SKU_PREMIUM_GUILD || '').trim(),
  pro_guild: String(process.env.DISCORD_SKU_PRO_GUILD || '').trim(),
};

function configured() {
  return Boolean(APPLICATION_ID && BOT_TOKEN && Object.values(SKU_MAP).some(Boolean));
}

function tierForSku(skuId) {
  const id = String(skuId || '');
  if (id && (id === SKU_MAP.pro_user || id === SKU_MAP.pro_guild)) return 'pro';
  if (id && (id === SKU_MAP.premium_user || id === SKU_MAP.premium_guild)) return 'premium';
  return null;
}

function isActive(entitlement) {
  if (!entitlement || entitlement.deleted) return false;
  const now = Date.now();
  if (entitlement.starts_at && Date.parse(entitlement.starts_at) > now) return false;
  if (entitlement.ends_at && Date.parse(entitlement.ends_at) <= now) return false;
  return true;
}

async function discordGet(path) {
  if (!APPLICATION_ID || !BOT_TOKEN) throw new Error('Discord Premium Apps is not configured.');
  const response = await fetch(API + path, {
    headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
  });
  if (!response.ok) throw new Error(`Discord API ${response.status}: ${await response.text()}`);
  return response.json();
}

async function listEntitlements({ userId, guildId, limit = 100 } = {}) {
  const params = new URLSearchParams({ limit: String(Math.min(100, Math.max(1, limit))) });
  if (userId) params.set('user_id', String(userId));
  if (guildId) params.set('guild_id', String(guildId));
  return discordGet(`/applications/${APPLICATION_ID}/entitlements?${params}`);
}

function bestEntitlement(entitlements = []) {
  const active = entitlements.filter(isActive).map(e => ({ entitlement: e, tier: tierForSku(e.sku_id) })).filter(x => x.tier);
  return active.find(x => x.tier === 'pro') || active.find(x => x.tier === 'premium') || null;
}

async function resolveDiscordPlan({ userId, guildId } = {}) {
  if (!configured()) return { tier: 'free', source: 'discord-unconfigured', entitlement: null };
  const checks = [];
  if (guildId) checks.push(listEntitlements({ guildId }));
  if (userId) checks.push(listEntitlements({ userId }));
  const groups = await Promise.all(checks);
  const match = bestEntitlement(groups.flat());
  return match ? { tier: match.tier, source: 'discord', entitlement: match.entitlement } : { tier: 'free', source: 'discord', entitlement: null };
}

async function syncDiscordSubscription({ userId, guildId } = {}) {
  const resolved = await resolveDiscordPlan({ userId, guildId });
  const entitlement = resolved.entitlement;
  if (guildId && entitlement && String(entitlement.guild_id || '') === String(guildId)) {
    await setGuildSubscription(guildId, { tier: resolved.tier, status: 'active', provider: 'discord', subscriptionId: entitlement.id, currentPeriodEnd: entitlement.ends_at || null, note: `Discord SKU ${entitlement.sku_id}` });
  }
  if (userId && entitlement && String(entitlement.user_id || '') === String(userId)) {
    await setUserSubscription(userId, { tier: resolved.tier, status: 'active', provider: 'discord', note: `Discord entitlement ${entitlement.id}; SKU ${entitlement.sku_id}` });
  }
  return resolved;
}

function storeUrl(skuId) {
  if (!APPLICATION_ID || !skuId) return null;
  return `https://discord.com/application-directory/${APPLICATION_ID}/store/${skuId}`;
}

async function getPremiumView({ userId, guildId } = {}) {
  const resolved = await resolveDiscordPlan({ userId, guildId });
  return {
    ...resolved,
    plan: await getPlan(resolved.tier),
    configured: configured(),
    store: {
      premiumUser: storeUrl(SKU_MAP.premium_user),
      proUser: storeUrl(SKU_MAP.pro_user),
      premiumGuild: storeUrl(SKU_MAP.premium_guild),
      proGuild: storeUrl(SKU_MAP.pro_guild),
    },
  };
}

module.exports = { SKU_MAP, configured, tierForSku, listEntitlements, resolveDiscordPlan, syncDiscordSubscription, getPremiumView, storeUrl };
