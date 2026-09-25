const { EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getGuildSettings } = require('../../src/store');

function helpEmbed(prefix = '!') {
  return new EmbedBuilder().setColor(0x5865f2).setTitle('MultiBot Commands').setDescription([
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
  ].join('\n'));
}

module.exports = {
  name: 'help',
  data: new SlashCommandBuilder().setName('help').setDescription('Show available commands.'),
  guildOnly: true,
  async executeSlash(interaction) {
    const settings = await getGuildSettings(interaction.guildId);
    return interaction.reply({
      embeds: [helpEmbed(settings.prefix)],
      flags: MessageFlags.Ephemeral,
    });
  },
  async executePrefix(message, _args, { settings }) {
    return message.reply({ embeds: [helpEmbed(settings.prefix)] });
  },
};
