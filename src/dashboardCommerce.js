'use strict';

const APPLICATION_ID = String(process.env.DISCORD_APPLICATION_ID || process.env.DISCORD_CLIENT_ID || '').trim();

// Kryndexa subscriptions are server-scoped only. User SKUs are intentionally
// excluded so purchases and entitlements always apply to a Discord guild.
const PRODUCTS = [
  { key: 'premium_guild', name: 'Premium', scope: 'guild', tier: 'premium', env: 'DISCORD_SKU_PREMIUM_GUILD', priceEnv: 'DISCORD_SKU_PREMIUM_GUILD_PRICE', description: 'Unlock premium Kryndexa features, expanded limits, and enhanced server configuration for one Discord server.' },
  { key: 'pro_guild', name: 'Diamond', scope: 'guild', tier: 'pro', env: 'DISCORD_SKU_PRO_GUILD', priceEnv: 'DISCORD_SKU_PRO_GUILD_PRICE', description: 'The complete Kryndexa server package with the highest limits and full Diamond-tier feature access.' },
];

function storeUrl(skuId) {
  const sku = String(skuId || '').trim();
  if (!APPLICATION_ID || !sku) return null;
  return `https://discord.com/application-directory/${encodeURIComponent(APPLICATION_ID)}/store/${encodeURIComponent(sku)}`;
}

function listDiscordProducts() {
  return PRODUCTS.map((product) => {
    const skuId = String(process.env[product.env] || '').trim();
    const price = String(process.env[product.priceEnv] || '').trim();
    return { ...product, skuId, price, configured: Boolean(skuId), checkoutUrl: storeUrl(skuId) };
  });
}

function configuredProducts() { return listDiscordProducts().filter((product) => product.configured); }
module.exports = { PRODUCTS, listDiscordProducts, configuredProducts, storeUrl };
