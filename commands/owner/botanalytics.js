const os = require('node:os');
const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');
const { isBotOwner } = require('../../src/bot/broadcast');

const ANALYTICS_PAGE_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_SERVER_LIST_DESCRIPTION_CHARS = 3600;

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GB`;
  return `${(value / 1024 ** 2).toFixed(1)} MB`;
}
function formatUptime(seconds) {
  const total = Math.floor(Number(seconds || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${minutes}m`].filter(Boolean).join(' ') || '<1m';
}

function serverListEmbeds(client) {
  const guilds = [...client.guilds.cache.values()]
    .sort((a, b) => (b.joinedTimestamp || 0) - (a.joinedTimestamp || 0));
  if (!guilds.length) return [new EmbedBuilder().setColor(0x5865f2).setTitle('🌐 Connected Servers').setDescription('No servers connected.')];

  const descriptions = [];
  let entries = [];
  let length = 0;

  guilds.forEach((guild, index) => {
    const joined = Math.floor((guild.joinedTimestamp || Date.now()) / 1000);
    const entry = [
      `**${index + 1}. ${guild.name.slice(0, 100)}**`,
      `ID: \`${guild.id}\` • Members: **${guild.memberCount.toLocaleString()}** • Owner: <@${guild.ownerId}>`,
      `Joined MultiBot: <t:${joined}:F> • <t:${joined}:R>`,
    ].join('\n');

    if (entries.length && length + entry.length + 2 > MAX_SERVER_LIST_DESCRIPTION_CHARS) {
      descriptions.push(entries.join('\n\n'));
      entries = [];
      length = 0;
    }
    entries.push(entry);
    length += entry.length + (entries.length > 1 ? 2 : 0);
  });
  if (entries.length) descriptions.push(entries.join('\n\n'));

  return descriptions.map((description, index) => new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(`🌐 Connected Servers • Newest → Oldest • ${index + 1}/${descriptions.length}`)
    .setDescription(description)
    .setFooter({ text: `${guilds.length} total server(s) • Sorted by bot join date` })
    .setTimestamp());
}

function buildPages(client) {
  const guilds = [...client.guilds.cache.values()];
  const { commandCatalog } = require('../../src/bot/commandRegistry');
  const commands = typeof commandCatalog === 'function' ? commandCatalog() : [];
  const mem = process.memoryUsage();
  const cpus = os.cpus();

  const summary = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📈 MultiBot Analytics Overview')
    .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Servers', value: guilds.length.toLocaleString(), inline: true },
      { name: 'Members', value: guilds.reduce((n, g) => n + g.memberCount, 0).toLocaleString(), inline: true },
      { name: 'Channels', value: guilds.reduce((n, g) => n + g.channels.cache.size, 0).toLocaleString(), inline: true },
      { name: 'Roles', value: guilds.reduce((n, g) => n + Math.max(0, g.roles.cache.size - 1), 0).toLocaleString(), inline: true },
      { name: 'Commands', value: commands.length.toLocaleString(), inline: true },
      { name: 'WebSocket Ping', value: `${Math.round(client.ws.ping)} ms`, inline: true },
      { name: 'Bot Uptime', value: formatUptime(process.uptime()), inline: true },
      { name: 'Node.js', value: process.version, inline: true },
      { name: 'Shard Count', value: String(client.ws.shards.size || 1), inline: true },
    ).setTimestamp();

  const runtime = new EmbedBuilder()
    .setColor(0x6c5ce7)
    .setTitle('🖥️ Runtime & Host Analytics')
    .addFields(
      { name: 'CPU', value: `${cpus[0]?.model || 'Unknown'}\n${cpus.length} logical core(s)`, inline: false },
      { name: 'Process Memory', value: `RSS: **${formatBytes(mem.rss)}**\nHeap: **${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)}**`, inline: true },
      { name: 'System Memory', value: `${formatBytes(os.totalmem() - os.freemem())} / ${formatBytes(os.totalmem())}`, inline: true },
      { name: 'OS', value: `${os.type()} ${os.release()} • ${os.arch()}`, inline: true },
      { name: 'Timezone', value: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown', inline: true },
      { name: 'Load Average', value: os.loadavg().map((v) => v.toFixed(2)).join(' / '), inline: true },
    ).setTimestamp();

  return [summary, runtime, ...serverListEmbeds(client)];
}

function withPageFooter(embed, page, total) {
  const data = embed.toJSON();
  const prefix = data.footer?.text ? `${data.footer.text} • ` : '';
  return EmbedBuilder.from(embed).setFooter({ text: `${prefix}Page ${page + 1}/${total}` });
}
function controls(page, total, token, disabled = false) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`botanalytics:first:${token}`).setLabel('First').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page === 0),
    new ButtonBuilder().setCustomId(`botanalytics:prev:${token}`).setLabel('Previous').setStyle(ButtonStyle.Primary).setDisabled(disabled || page === 0),
    new ButtonBuilder().setCustomId(`botanalytics:next:${token}`).setLabel('Next').setStyle(ButtonStyle.Primary).setDisabled(disabled || page >= total - 1),
    new ButtonBuilder().setCustomId(`botanalytics:last:${token}`).setLabel('Last').setStyle(ButtonStyle.Secondary).setDisabled(disabled || page >= total - 1),
  );
}

async function paginate({ ownerId, token, pages, send, edit }) {
  let page = 0;
  const render = (disabled = false) => ({
    embeds: [withPageFooter(pages[page], page, pages.length)],
    components: pages.length > 1 ? [controls(page, pages.length, token, disabled)] : [],
  });
  const message = await send(render());
  if (!message || pages.length <= 1) return message;

  const collector = message.createMessageComponentCollector({
    time: ANALYTICS_PAGE_TIMEOUT_MS,
    filter: (button) => button.customId.endsWith(`:${token}`),
  });

  collector.on('collect', async (button) => {
    if (button.user.id !== ownerId) {
      return button.reply({ content: 'Only the bot owner who opened this view can use these controls.', flags: MessageFlags.Ephemeral });
    }
    const [, action] = button.customId.split(':');
    if (action === 'first') page = 0;
    if (action === 'prev') page = Math.max(0, page - 1);
    if (action === 'next') page = Math.min(pages.length - 1, page + 1);
    if (action === 'last') page = pages.length - 1;
    return button.update(render());
  });
  collector.on('end', () => edit(render(true)).catch(() => null));
  return message;
}

module.exports = {
  name: 'botanalytics',
  aliases: ['botservers', 'serverlist'],
  category: 'Owner Tools',
  data: new SlashCommandBuilder().setName('botanalytics').setDescription('Owner-only paginated bot analytics and connected server list.'),
  guildOnly: false,
  async executeSlash(interaction) {
    if (!(await isBotOwner(interaction.client, interaction.user.id))) {
      return interaction.reply({ content: 'This command is restricted to the bot owner.', flags: MessageFlags.Ephemeral });
    }
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const pages = buildPages(interaction.client);
    return paginate({
      ownerId: interaction.user.id,
      token: interaction.id,
      pages,
      send: (payload) => interaction.editReply(payload),
      edit: (payload) => interaction.editReply(payload),
    });
  },
  async executePrefix(message) {
    if (!(await isBotOwner(message.client, message.author.id))) return undefined;
    let sent;
    return paginate({
      ownerId: message.author.id,
      token: message.id,
      pages: buildPages(message.client),
      send: async (payload) => { sent = await message.channel.send(payload); return sent; },
      edit: (payload) => sent.edit(payload),
    });
  },
};
