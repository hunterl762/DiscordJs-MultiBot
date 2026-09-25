const { getSecureRecord, listSecureRecords, putSecureRecord } = require('./dashboardSecureStore');

const NS = 'embed_config';
const EMBED_MODULES = {
  welcome: { label: 'Welcome Message', defaults: { title: '👋 Welcome to {server}!', description: '{welcomeMessage}', color: '#5865F2', footer: 'Welcome • MultiBot', fieldsEnabled: false, fields: [] } },
  ticket_panel: { label: 'Ticket Panel', defaults: { title: '🎫 Advanced Ticket Center', description: 'Choose the department that best matches what you need.', color: '#5865F2', footer: 'MultiBot Advanced Tickets', fieldsEnabled: false, fields: [] } },
  twitch_live: { label: 'Twitch Live Alert', defaults: { title: '🔴 {user} is LIVE on Twitch!', description: '**{title}**\n\n{user} just went live on Twitch.', color: '#9146FF', footer: 'Twitch Live Announcement • MultiBot', fieldsEnabled: true, fields: [{ name: '🎮 Game', value: '{game}', inline: true }, { name: '👀 Viewers', value: '{viewers}', inline: true }, { name: '🕒 Started', value: '{started}', inline: true }] } },
  youtube_live: { label: 'YouTube Live Alert', defaults: { title: '🔴 {user} is LIVE on YouTube!', description: '**{title}**\n\n{user} just went live on YouTube.', color: '#FF0000', footer: 'YouTube Live Announcement • MultiBot', fieldsEnabled: true, fields: [{ name: '📺 Platform', value: '{platform}', inline: true }, { name: '🕒 Started', value: '{started}', inline: true }] } },
  kick_live: { label: 'Kick Live Alert', defaults: { title: '🟢 {user} is LIVE on Kick!', description: '**{title}**\n\n{user} just went live on Kick.', color: '#53FC18', footer: 'Kick Live Announcement • MultiBot', fieldsEnabled: true, fields: [{ name: '🎮 Category', value: '{game}', inline: true }, { name: '👀 Viewers', value: '{viewers}', inline: true }, { name: '🕒 Started', value: '{started}', inline: true }] } },
};

function cleanHex(value, fallback = '#5865F2') {
  const text = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(text) ? text.toUpperCase() : fallback;
}

function normalize(key, payload = {}) {
  const def = EMBED_MODULES[key];
  if (!def) throw new Error('Unknown embed module.');
  const defaults = def.defaults;
  return {
    key,
    label: def.label,
    title: String(payload.title ?? defaults.title).slice(0, 256),
    description: String(payload.description ?? defaults.description).slice(0, 4000),
    color: cleanHex(payload.color, defaults.color),
    footer: String(payload.footer ?? defaults.footer).slice(0, 2048),
    imageUrl: String(payload.imageUrl || '').slice(0, 1000),
    thumbnailUrl: String(payload.thumbnailUrl || '').slice(0, 1000),
    fieldsEnabled: payload.fieldsEnabled == null ? Boolean(defaults.fieldsEnabled) : Boolean(payload.fieldsEnabled),
    fields: Array.isArray(payload.fields)
      ? payload.fields.slice(0, 25).map((field) => ({
          name: String(field.name || '').slice(0, 256),
          value: String(field.value || '').slice(0, 1024),
          inline: Boolean(field.inline),
        })).filter((field) => field.name && field.value)
      : defaults.fields,
  };
}

async function listEmbedConfigs(guildId) {
  const rows = await listSecureRecords(guildId, NS);
  const byKey = new Map(rows.map((row) => [row.recordKey, row.payload]));
  return Object.keys(EMBED_MODULES).map((key) => normalize(key, byKey.get(key) || {}));
}

async function getEmbedConfig(guildId, key) {
  const row = await getSecureRecord(guildId, NS, key);
  return normalize(key, row?.payload || {});
}

async function saveEmbedConfig(guildId, key, payload) {
  const config = normalize(key, payload);
  await putSecureRecord(guildId, NS, key, config);
  return config;
}

module.exports = { EMBED_MODULES, listEmbedConfigs, getEmbedConfig, saveEmbedConfig };
