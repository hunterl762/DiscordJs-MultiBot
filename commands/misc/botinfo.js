const os = require('node:os');
const { EmbedBuilder, SlashCommandBuilder, version: discordJsVersion } = require('discord.js');

function formatBytes(bytes) {
  const gb = Number(bytes) / 1024 / 1024 / 1024;
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(Number(bytes) / 1024 / 1024).toFixed(1)} MB`;
}

function formatDuration(seconds) {
  const total = Math.max(0, Math.floor(Number(seconds) || 0));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return [days ? `${days}d` : '', hours ? `${hours}h` : '', `${minutes}m`].filter(Boolean).join(' ');
}

async function sampleCpuUsage(ms = 300) {
  const cores = Math.max(1, os.cpus().length);
  const beforeUsage = process.cpuUsage();
  const beforeTime = process.hrtime.bigint();

  await new Promise((resolve) => setTimeout(resolve, ms));

  const usage = process.cpuUsage(beforeUsage);
  const elapsedMicros = Number(process.hrtime.bigint() - beforeTime) / 1000;
  const totalCpuMicros = usage.user + usage.system;
  return Math.max(0, Math.min(100, (totalCpuMicros / elapsedMicros / cores) * 100));
}

async function botInfoEmbed(client) {
  const cpus = os.cpus();
  const cpu = cpus[0];
  const cpuPercent = await sampleCpuUsage();
  const mem = process.memoryUsage();
  const totalRam = os.totalmem();
  const usedRam = totalRam - os.freemem();
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Unknown';
  const guildUsers = client.guilds.cache.reduce((sum, guild) => sum + guild.memberCount, 0);

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🤖 Advanced Bot Information')
    .setThumbnail(client.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: 'Bot', value: `${client.user.tag}\nID: ${client.user.id}`, inline: true },
      { name: 'Discord', value: `${client.guilds.cache.size} servers\n~${guildUsers.toLocaleString()} members`, inline: true },
      { name: 'Latency', value: `${Math.round(client.ws.ping)} ms`, inline: true },
      { name: 'CPU', value: `${cpu?.model || 'Unknown CPU'}\n${cpus.length} logical cores\nProcess usage: **${cpuPercent.toFixed(2)}%**`, inline: false },
      { name: 'System RAM', value: `${formatBytes(usedRam)} / ${formatBytes(totalRam)} used (${((usedRam / totalRam) * 100).toFixed(1)}%)`, inline: true },
      { name: 'Bot RAM', value: `RSS: ${formatBytes(mem.rss)}\nHeap: ${formatBytes(mem.heapUsed)} / ${formatBytes(mem.heapTotal)}`, inline: true },
      { name: 'Runtime', value: `Node ${process.version}\ndiscord.js ${discordJsVersion}\nUptime: ${formatDuration(process.uptime())}`, inline: true },
      { name: 'Host OS', value: `${os.type()} ${os.release()}\n${os.platform()} • ${os.arch()}`, inline: true },
      { name: 'Timezone', value: `${timezone}\n${new Date().toLocaleString('en-US', { timeZone: timezone })}`, inline: true },
      { name: 'Load Average', value: os.loadavg().map((value) => value.toFixed(2)).join(' / '), inline: true },
    )
    .setFooter({ text: `©️ ${new Date().getFullYear()} MultiBot • Runtime Diagnostics` })
    .setTimestamp();
}

module.exports = {
  name: 'botinfo',
  aliases: ['botstats'],
  category: 'Misc',
  data: new SlashCommandBuilder()
    .setName('botinfo')
    .setDescription('Show advanced bot runtime, CPU, memory, hardware, and timezone information.'),
  guildOnly: false,

  async executeSlash(interaction) {
    await interaction.deferReply();
    return interaction.editReply({ embeds: [await botInfoEmbed(interaction.client)] });
  },

  async executePrefix(message) {
    const embed = await botInfoEmbed(message.client);
    return message.reply({ embeds: [embed] });
  },
};
