const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const { getGuildSettings } = require('../store');

function verificationButton(customId = 'verification:verify:any') {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(customId)
      .setLabel('Verify')
      .setEmoji('✅')
      .setStyle(ButtonStyle.Success),
  );
}

function verificationEmbed(guild) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('Server Verification')
    .setDescription(`Welcome to **${guild.name}**. Click **Verify** below to unlock the server.`)
    .setFooter({ text: 'MultiBot Verification' });
}

async function postVerificationPanel(channel) {
  return channel.send({
    embeds: [verificationEmbed(channel.guild)],
    components: [verificationButton()],
    allowedMentions: { parse: [] },
  });
}

async function verifyMember(member, actorTag = 'self-verification') {
  const settings = getGuildSettings(member.guild.id);
  if (!settings.verificationEnabled) {
    return { ok: false, message: 'Verification is disabled for this server.' };
  }

  const me = member.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles)) {
    return { ok: false, message: 'I need the **Manage Roles** permission to verify members.' };
  }

  let changed = false;
  if (settings.verifiedRoleId) {
    const verifiedRole = member.guild.roles.cache.get(settings.verifiedRoleId);
    if (!verifiedRole) return { ok: false, message: 'The configured verified role no longer exists.' };
    if (!verifiedRole.editable) return { ok: false, message: 'My bot role must be above the configured verified role.' };
    if (!member.roles.cache.has(verifiedRole.id)) {
      await member.roles.add(verifiedRole, `Verified via MultiBot (${actorTag})`);
      changed = true;
    }
  }

  if (settings.unverifiedRoleId) {
    const unverifiedRole = member.guild.roles.cache.get(settings.unverifiedRoleId);
    if (unverifiedRole && unverifiedRole.editable && member.roles.cache.has(unverifiedRole.id)) {
      await member.roles.remove(unverifiedRole, `Verified via MultiBot (${actorTag})`);
      changed = true;
    }
  }

  if (!settings.verifiedRoleId && !settings.unverifiedRoleId) {
    return { ok: false, message: 'Configure a verified role or unverified role in the dashboard first.' };
  }

  return {
    ok: true,
    message: changed ? 'Verification complete. You now have access.' : 'You are already verified.',
  };
}

async function prepareNewMember(member) {
  const settings = getGuildSettings(member.guild.id);
  if (!settings.verificationEnabled || member.user.bot) return;

  if (settings.unverifiedRoleId) {
    const role = member.guild.roles.cache.get(settings.unverifiedRoleId);
    if (role?.editable) {
      await member.roles.add(role, 'New member awaiting verification').catch((error) => {
        console.error(`Unable to add unverified role in ${member.guild.name}:`, error);
      });
    }
  }

  const channel = settings.verificationChannelId
    ? member.guild.channels.cache.get(settings.verificationChannelId)
    : null;
  if (!channel?.isTextBased()) return;

  await channel.send({
    content: `<@${member.id}>`,
    embeds: [verificationEmbed(member.guild)],
    components: [verificationButton(`verification:verify:${member.id}`)],
    allowedMentions: { users: [member.id], roles: [], repliedUser: false },
  }).catch((error) => console.error(`Unable to send verification prompt in ${member.guild.name}:`, error));
}

async function handleVerificationButton(interaction) {
  const [, action, targetId] = interaction.customId.split(':');
  if (action !== 'verify') return;

  let guild = interaction.guild;
  if (!guild) return interaction.reply({ content: 'Verification must be completed inside the server.', ephemeral: true });

  if (targetId && targetId !== 'any' && targetId !== interaction.user.id) {
    return interaction.reply({ content: 'That verification button belongs to another member.', ephemeral: true });
  }

  const member = await guild.members.fetch(interaction.user.id).catch(() => null);
  if (!member) return interaction.reply({ content: 'I could not find your server membership.', ephemeral: true });

  await interaction.deferReply({ ephemeral: true });
  const result = await verifyMember(member, interaction.user.tag);
  return interaction.editReply(result.message);
}

module.exports = {
  postVerificationPanel,
  verifyMember,
  prepareNewMember,
  handleVerificationButton,
};
