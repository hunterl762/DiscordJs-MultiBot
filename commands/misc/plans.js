const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { getGuildSubscription, getPlan } = require('../../src/subscriptionStore');

function plansRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('View Plans / Upgrade Server')
      .setEmoji('💎')
      .setStyle(ButtonStyle.Link)
      .setURL('https://kryndexabot.xyz/products'),
  );
}

async function plansEmbed(guildId) {
  const subscription = guildId ? await getGuildSubscription(guildId) : { tier: 'free' };
  const plan = await getPlan(subscription.tier);
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('💎 Kryndexa Bot Server Plans')
    .setDescription('Kryndexa subscriptions are server-based. Upgrade the Discord server to unlock additional modules and commands for everyone in that server.')
    .addFields(
      { name: 'Current Server Tier', value: guildId ? `**${plan.name || subscription.tier}**` : 'Run this command in a server to view its current tier.', inline: false },
      { name: 'Free', value: 'Core server-management modules and commands.', inline: true },
      { name: 'Premium', value: 'Unlocks additional automation, moderation, analytics, entertainment, and integration modules.', inline: true },
      { name: 'Diamond', value: 'Highest server tier with access to all configured Kryndexa modules.', inline: true },
    )
    .setFooter({ text: 'Purchases are completed through Discord using server/guild SKUs.' });
}

module.exports = {
  name: 'plans',
  aliases: ['premium', 'upgrade'],
  category: 'Misc',
  guildOnly: false,
  data: new SlashCommandBuilder()
    .setName('plans')
    .setDescription('View Kryndexa Bot server subscription tiers and upgrade options.'),
  async executeSlash(interaction) {
    return interaction.reply({
      embeds: [await plansEmbed(interaction.guildId)],
      components: [plansRow()],
      flags: MessageFlags.Ephemeral,
    });
  },
  async executePrefix(message) {
    return message.reply({ embeds: [await plansEmbed(message.guildId)], components: [plansRow()] });
  },
};
