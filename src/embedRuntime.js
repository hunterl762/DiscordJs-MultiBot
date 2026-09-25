const { EmbedBuilder } = require('discord.js');
const { getEmbedConfig } = require('./embedConfigStore');

function replaceTokens(value, tokens) {
  let result = String(value || '');
  for (const [key, tokenValue] of Object.entries(tokens || {})) {
    result = result.replaceAll(`{${key}}`, String(tokenValue ?? ''));
  }
  return result;
}

function colorInt(hex) {
  return Number.parseInt(String(hex || '#5865F2').replace('#', ''), 16) || 0x5865f2;
}

async function buildConfiguredEmbed(guildId, key, tokens = {}, options = {}) {
  const config = await getEmbedConfig(guildId, key);
  const embed = new EmbedBuilder()
    .setColor(colorInt(config.color))
    .setTitle(replaceTokens(config.title, tokens).slice(0, 256))
    .setDescription(replaceTokens(config.description, tokens).slice(0, 4000));

  if (config.footer) embed.setFooter({ text: replaceTokens(config.footer, tokens).slice(0, 2048) });
  if (options.url) embed.setURL(options.url);
  if (options.timestamp) embed.setTimestamp(options.timestamp);

  const image = replaceTokens(config.imageUrl, tokens).trim();
  const thumbnail = replaceTokens(config.thumbnailUrl, tokens).trim();
  if (/^https?:\/\//i.test(image)) embed.setImage(image);
  if (/^https?:\/\//i.test(thumbnail)) embed.setThumbnail(thumbnail);

  if (config.fieldsEnabled) {
    const fields = config.fields.map((field) => ({
      name: replaceTokens(field.name, tokens).slice(0, 256),
      value: replaceTokens(field.value, tokens).slice(0, 1024),
      inline: Boolean(field.inline),
    })).filter((field) => field.name && field.value);
    if (fields.length) embed.addFields(fields);
  }

  return embed;
}

module.exports = { buildConfiguredEmbed, replaceTokens };
