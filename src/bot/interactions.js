const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const { executeSlash } = require('./commands');
const { createTicket, claimTicket, requestTicketClose, closeTicket } = require('../tickets/ticketService');
const { handleVerificationButton } = require('./verification');
const { getFeature } = require('../features/store');

function interactionLabel(interaction) {
  if (interaction.isChatInputCommand?.()) return `/${interaction.commandName}`;
  if (interaction.isButton?.()) return `button:${interaction.customId}`;
  if (interaction.isStringSelectMenu?.()) return `select:${interaction.customId}`;
  if (interaction.isModalSubmit?.()) return `modal:${interaction.customId}`;
  return interaction.type ? `type:${interaction.type}` : 'unknown';
}

function isExpiredInteractionError(error) { return Number(error?.code) === 10062; }
function isAlreadyAcknowledgedError(error) { return Number(error?.code) === 40060; }

async function safeInteractionErrorReply(interaction) {
  const payload = { content: 'Something went wrong while running that action.', flags: MessageFlags.Ephemeral };
  try {
    if (interaction.deferred || interaction.replied) return await interaction.followUp(payload);
    return await interaction.reply(payload);
  } catch (replyError) {
    if (!isExpiredInteractionError(replyError) && !isAlreadyAcknowledgedError(replyError)) console.error('Failed to send interaction error response:', replyError);
    return undefined;
  }
}

async function handleSelfRole(interaction) {
  const roleId = interaction.customId.split(':')[1];
  const feature = await getFeature(interaction.guildId, 'button_roles');
  if (!feature?.enabled) return interaction.reply({ content: 'Self roles are currently disabled.', flags: MessageFlags.Ephemeral });
  const role = interaction.guild.roles.cache.get(roleId);
  if (!role || !role.editable) return interaction.reply({ content: 'That role is no longer available or cannot be managed by the bot.', flags: MessageFlags.Ephemeral });
  const member = await interaction.guild.members.fetch(interaction.user.id);
  if (member.roles.cache.has(role.id)) { await member.roles.remove(role, 'Self-role button'); return interaction.reply({ content: `Removed **${role.name}**.`, flags: MessageFlags.Ephemeral }); }
  await member.roles.add(role, 'Self-role button');
  return interaction.reply({ content: `Added **${role.name}**.`, flags: MessageFlags.Ephemeral });
}

async function handleApplicationModal(interaction) {
  const feature = await getFeature(interaction.guildId, 'applications');
  if (!feature?.enabled) return interaction.reply({ content: 'Applications are currently disabled.', flags: MessageFlags.Ephemeral });
  const type = decodeURIComponent(interaction.customId.split(':').slice(2).join(':') || 'General');
  const answers = [];
  for (let index = 0; index < 5; index += 1) { const input = interaction.fields.fields.get(`q${index}`); if (input?.value) answers.push(input.value); }
  const channel = interaction.guild.channels.cache.get(feature.config.reviewChannelId);
  if (!channel?.isTextBased()) return interaction.reply({ content: 'The application review channel is not configured.', flags: MessageFlags.Ephemeral });
  const questions = String(feature.config.questions || '').split('|').map((item) => item.trim()).filter(Boolean);
  const fields = answers.slice(0, 5).map((answer, index) => ({ name: (questions[index] || `Answer ${index + 1}`).slice(0, 256), value: String(answer).slice(0, 1024), inline: false }));
  const embed = new EmbedBuilder().setColor(0x5865f2).setTitle(`📝 ${type} Application`).setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL() }).addFields({ name: 'Applicant', value: `<@${interaction.user.id}>\n${interaction.user.id}`, inline: true }, { name: 'Type', value: type.slice(0, 100), inline: true }, ...fields).setTimestamp();
  const reviewRow = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`application:review:approve:${interaction.user.id}`).setLabel('Approve').setStyle(ButtonStyle.Success), new ButtonBuilder().setCustomId(`application:review:deny:${interaction.user.id}`).setLabel('Deny').setStyle(ButtonStyle.Danger));
  await channel.send({ content: feature.config.reviewerRoleId ? `<@&${feature.config.reviewerRoleId}>` : undefined, embeds: [embed], components: [reviewRow], allowedMentions: { roles: feature.config.reviewerRoleId ? [feature.config.reviewerRoleId] : [], parse: [] } });
  return interaction.reply({ content: 'Your application has been submitted.', flags: MessageFlags.Ephemeral });
}

async function handleApplicationReview(interaction) {
  const [, , action, applicantId] = interaction.customId.split(':');
  const feature = await getFeature(interaction.guildId, 'applications');
  const member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isReviewer = member?.permissions.has(PermissionFlagsBits.ManageGuild) || (feature?.config?.reviewerRoleId && member?.roles.cache.has(feature.config.reviewerRoleId));
  if (!isReviewer) return interaction.reply({ content: 'You are not allowed to review applications.', flags: MessageFlags.Ephemeral });
  const applicant = await interaction.client.users.fetch(applicantId).catch(() => null);
  const approved = action === 'approve';
  const updated = EmbedBuilder.from(interaction.message.embeds[0]).setColor(approved ? 0x57f287 : 0xed4245).addFields({ name: 'Review Status', value: `${approved ? '✅ Approved' : '❌ Denied'} by <@${interaction.user.id}>`, inline: false });
  const disabled = new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId('application:review:closed').setLabel(approved ? 'Approved' : 'Denied').setStyle(approved ? ButtonStyle.Success : ButtonStyle.Danger).setDisabled(true));
  await interaction.update({ embeds: [updated], components: [disabled] });
  if (applicant) await applicant.send(`Your application in **${interaction.guild.name}** was **${approved ? 'approved' : 'denied'}** by the review team.`).catch(() => null);
}

function registerInteractions(client) {
  client.on('interactionCreate', async (interaction) => {
    const label = interactionLabel(interaction);
    const receivedAt = Date.now();
    console.log(`[Interaction] ${label} received.`);
    try {
      let result;
      if (interaction.isChatInputCommand()) result = await executeSlash(interaction);
      else if (interaction.isButton() && interaction.customId === 'ticket:create') result = await createTicket(interaction, 'support');
      else if (interaction.isStringSelectMenu() && interaction.customId === 'ticket:create:type') result = await createTicket(interaction, interaction.values[0]);
      else if (interaction.isButton() && interaction.customId === 'ticket:claim') result = await claimTicket(interaction);
      else if (interaction.isButton() && interaction.customId === 'ticket:close') result = await requestTicketClose(interaction);
      else if (interaction.isModalSubmit() && interaction.customId.startsWith('ticket:close:submit:')) result = await closeTicket(interaction, interaction.fields.getTextInputValue('reason'));
      else if (interaction.isButton() && interaction.customId.startsWith('verification:verify:')) result = await handleVerificationButton(interaction);
      else if (interaction.isButton() && interaction.customId.startsWith('selfrole:')) result = await handleSelfRole(interaction);
      else if (interaction.isModalSubmit() && interaction.customId.startsWith('application:submit:')) result = await handleApplicationModal(interaction);
      else if (interaction.isButton() && interaction.customId.startsWith('application:review:') && interaction.customId !== 'application:review:closed') result = await handleApplicationReview(interaction);
      else return undefined;
      console.log(`[Interaction] ${label} handled in ${Date.now() - receivedAt}ms; acknowledged=${interaction.deferred || interaction.replied}.`);
      return result;
    } catch (error) {
      const elapsed = Date.now() - receivedAt;
      if (isExpiredInteractionError(error)) {
        console.warn(`[Interaction] ${label} expired before Discord accepted the acknowledgement (${elapsed}ms). No retry will be attempted.`);
        return undefined;
      }
      if (isAlreadyAcknowledgedError(error)) {
        console.warn(`[Interaction] ${label} was already acknowledged (${elapsed}ms); suppressing duplicate response.`);
        return undefined;
      }
      console.error(`[Interaction] ${label} failed after ${elapsed}ms:`, error);
      await safeInteractionErrorReply(interaction);
      return undefined;
    }
  });
}

module.exports = { registerInteractions };
