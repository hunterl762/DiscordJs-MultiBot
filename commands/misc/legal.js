const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  SlashCommandBuilder,
} = require('discord.js');

function legalUrls() {
  const base = String(process.env.BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
  return {
    privacy: `${base}/privacy`,
    terms: `${base}/terms`,
  };
}

function legalPayload() {
  const urls = legalUrls();
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('MultiBot Legal Information')
    .setDescription('Review the policies that apply to MultiBot and its web dashboard.')
    .addFields(
      { name: '🔒 Privacy Policy', value: 'How MultiBot handles Discord data, sessions, tickets, Twitch configuration, and cookies.' },
      { name: '📜 Terms of Service', value: 'Rules and conditions for using MultiBot, its dashboard, commands, tickets, and integrations.' },
    )
    .setFooter({ text: `©️ ${new Date().getFullYear()} MultiBot` })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Privacy Policy')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Link)
      .setURL(urls.privacy),
    new ButtonBuilder()
      .setLabel('Terms of Service')
      .setEmoji('📜')
      .setStyle(ButtonStyle.Link)
      .setURL(urls.terms),
  );

  return {
    embeds: [embed],
    components: [row],
    allowedMentions: { parse: [] },
  };
}

module.exports = {
  name: 'legal',
  aliases: ['terms', 'privacy'],
  category: 'General',
  data: new SlashCommandBuilder()
    .setName('legal')
    .setDescription('Get links to the MultiBot Privacy Policy and Terms of Service.'),
  guildOnly: false,
  async executeSlash(interaction) {
    return interaction.reply({
      ...legalPayload(),
      flags: MessageFlags.Ephemeral,
    });
  },
  async executePrefix(message) {
    return message.reply(legalPayload());
  },
};
