'use strict';

const APPLICATION_ID = String(process.env.DISCORD_APPLICATION_ID || process.env.DISCORD_CLIENT_ID || '').trim();

const PRODUCTS = [
  { key: 'premium_user', name: 'Premium - User', scope: 'user', tier: 'premium', env: 'DISCORD_SKU_PREMIUM_USER', priceEnv: 'DISCORD_SKU_PREMIUM_USER_PRICE', description: 'Premium Kryndexa features for one Discord user across supported servers.' },
  { key: 'pro_user', name: 'Pro - User', scope: 'user', tier: 'pro', env: 'DISCORD_SKU_PRO_USER', priceEnv: 'DISCORD_SKU_PRO_USER_PRICE', description: 'Highest user-level Kryndexa access with expanded premium limits and features.' },
  { key: 'premium_guild', name: 'Premium - Server Configuration', scope: 'guild', tier: 'premium', env: 'DISCORD_SKU_PREMIUM_GUILD', priceEnv: 'DISCORD_SKU_PREMIUM_GUILD_PRICE', description: 'Premium features and higher limits for one configured Discord server.' },
  { key: 'pro_guild', name: 'Diamond - Server Configuration', scope: 'guild', tier: 'pro', env: 'DISCORD_SKU_PRO_GUILD', priceEnv: 'DISCORD_SKU_PRO_GUILD_PRICE', description: 'Top server configuration tier with Kryndexa Pro/Diamond features and limits.' },
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
    return {
      ...product,
      skuId,
      price,
      configured: Boolean(skuId),
      checkoutUrl: storeUrl(skuId),
    };
  });
}

function configuredProducts() {
  return listDiscordProducts().filter((product) => product.configured);
}

module.exports = { PRODUCTS, listDiscordProducts, configuredProducts, storeUrl };
