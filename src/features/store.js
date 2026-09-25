const { getPool } = require('../database');
const { FEATURE_CATALOG, getFeatureDefinition, defaultFeatureConfig } = require('./catalog');

const cache = new Map();
const CACHE_TTL_MS = 30_000;

function rowToState(row, definition) {
  let config = {};
  try { config = row?.config_json ? JSON.parse(row.config_json) : {}; } catch { config = {}; }
  return {
    key: definition.key,
    enabled: row ? Boolean(row.enabled) : Boolean(definition.defaultEnabled),
    config: { ...defaultFeatureConfig(definition), ...config },
    updatedAt: row?.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

async function getGuildFeatures(guildId) {
  const cached=cache.get(guildId);
  if (cached?.expiresAt > Date.now()) return cached.states;

  const [rows]=await getPool().execute(
    'SELECT feature_key,enabled,config_json,updated_at FROM server_features WHERE guild_id=?',
    [guildId],
  );
  const byKey=new Map(rows.map((row)=>[row.feature_key,row]));
  const states=FEATURE_CATALOG.map((definition)=>({
    definition,
    ...rowToState(byKey.get(definition.key), definition),
  }));
  cache.set(guildId,{states,expiresAt:Date.now()+CACHE_TTL_MS});
  return states;
}

async function getFeature(guildId,key) {
  const states=await getGuildFeatures(guildId);
  return states.find((state)=>state.key===key) || null;
}

async function saveFeature(guildId,key,{enabled,config}) {
  const definition=getFeatureDefinition(key);
  if(!definition) throw new Error('Unknown feature.');
  const merged={...defaultFeatureConfig(definition),...(config||{})};
  const nextEnabled=definition.locked ? true : Boolean(enabled);
  await getPool().execute(
    `INSERT INTO server_features (guild_id,feature_key,enabled,config_json)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE enabled=VALUES(enabled),config_json=VALUES(config_json),updated_at=CURRENT_TIMESTAMP`,
    [guildId,key,nextEnabled?1:0,JSON.stringify(merged)],
  );
  cache.delete(guildId);
  return getFeature(guildId,key);
}

function clearFeatureCache(guildId) {
  if(guildId) cache.delete(guildId); else cache.clear();
}

module.exports={getGuildFeatures,getFeature,saveFeature,clearFeatureCache};
