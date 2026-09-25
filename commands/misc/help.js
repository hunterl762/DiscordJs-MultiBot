const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getGuildSettings } = require('../../src/store');

function shardLabel(source) {
  const shardId = Number(source?.guild?.shardId ?? source?.guild?.shard?.id ?? 0);
  return `Shard ${Number.isFinite(shardId) ? shardId + 1 : 1} / 100`;
}

function helpEmbed(prefix = '!', source = null) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Kryndexa Bot Commands')
    .setDescription([
      '**Misc:** `/ping`, `/help`, `/avatar`, `/userinfo`, `/serverinfo`, `/botinfo`, `/poll`, `/legal`',
      '**Moderation / Security:** `/purge`, `/kick`, `/ban`, `/timeout`, `/untimeout`, `/warn`, `/lockdown`',
      '**Administration / Roles:** `/role`, `/say`, `/buttonrole`, `/backup`',
      '**Tickets / Community:** `/ticket`, `/verification`, `/apply`, `/suggest`',
      '**Leveling / Economy:** `/rank`, `/leaderboard`, `/balance`, `/daily`',
      '**Giveaways / Utility / Analytics:** `/giveaway`, `/remind`, `/stats`',
      '**Music:** `/play`, `/pause`, `/resume`, `/skip`, `/stop`, `/queue`, `/nowplaying`, `/volume`, `/shuffle`, `/loop`',
      '**Bot Owner:** `/broadcast`, `/botanalytics`, `/resetcommands`',
      'Most advanced systems are enabled/configured in the web dashboard Feature Center.',
      `Prefix backups remain available when enabled (current prefix: \`${prefix}\`).`,
    ].join('\n'))
    .setFooter({ text: `kryndexabot.xyz • ${shardLabel(source)}` });
}

module.exports = {
  name: 'help',
  data: new SlashCommandBuilder().setName('help').setDescription('Show available commands.'),
  guildOnly: true,
  async executeSlash(interaction) {
    const settings = await getGuildSettings(interaction.guildId);
    return interaction.reply({
      embeds: [helpEmbed(settings.prefix, interaction)],
      flags: MessageFlags.Ephemeral,
    });
  },
  async executePrefix(message, _args, { settings }) {
    return message.reply({ embeds: [helpEmbed(settings.prefix, message)] });
  },
};
