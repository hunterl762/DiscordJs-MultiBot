const crypto = require('node:crypto');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  PermissionFlagsBits,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} = require('discord.js');
const {
  getGuildSettings,
  findOpenTicket,
  countOpenTickets,
  findTicketByChannel,
  saveTicket,
  updateTicket,
} = require('../store');
const {
  getTicketType,
  listTicketTypes,
} = require('../ticketTypeStore');
const { escapeHtml } = require('../utils/html');
const { getFeature } = require('../features/store');

function ticketCloseComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:claim')
      .setLabel('Claim Ticket')
      .setEmoji('🙋')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  )];
}

async function ticketPanelComponents(guildId) {
  const types = await listTicketTypes(guildId, { enabledOnly: true });
  if (!types.length) return [];

  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket:create:type')
    .setPlaceholder('Choose the department you need')
    .setMinValues(1)
    .setMaxValues(1);

  for (const type of types) {
    const option = new StringSelectMenuOptionBuilder()
      .setLabel(type.label.slice(0, 100))
      .setDescription(type.description.slice(0, 100))
      .setValue(type.key);

    if (type.emoji) {
      try {
        option.setEmoji(type.emoji);
      } catch {
        // Ignore invalid custom emoji values configured through the dashboard.
      }
    }

    menu.addOptions(option);
  }

  return [new ActionRowBuilder().addComponents(menu)];
}

async function postTicketPanel(channel) {
  const components = await ticketPanelComponents(channel.guild.id);
  if (!components.length) throw new Error('No ticket types are enabled. Enable at least one ticket module in the web panel.');

  const types = await listTicketTypes(channel.guild.id, { enabledOnly: true });
  const typeList = types
    .map((type) => `${type.emoji || '•'} **${type.label}** — ${type.description}`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('🎫 Advanced Ticket Center')
    .setDescription([
      'Choose the department that best matches what you need.',
      '',
      typeList,
      '',
      'Select a ticket type below to create a private channel with the appropriate team.',
    ].join('\n'))
    .setFooter({ text: 'MultiBot Advanced Tickets' })
    .setTimestamp();

  return channel.send({
    embeds: [embed],
    components,
    allowedMentions: { parse: [] },
  });
}

function channelSlug(typeKey) {
  return String(typeKey || 'support')
    .replace(/_reports$/, '-report')
    .replace(/_/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, 24) || 'ticket';
}

async function createTicket(interaction, requestedTypeKey = 'support') {
  const guild = interaction.guild;
  const settings = await getGuildSettings(guild.id);

  const ticketFeature = await getFeature(guild.id, 'tickets');
  if (!settings.ticketsEnabled || ticketFeature?.enabled === false) {
    return interaction.reply({ content: 'Tickets are disabled for this server.', flags: MessageFlags.Ephemeral });
  }

  const openTicketCount = await countOpenTickets(guild.id, interaction.user.id);
  const maxOpenTickets = Math.max(1, Number(settings.maxOpenTicketsPerUser || 3));

  if (openTicketCount >= maxOpenTickets) {
    return interaction.reply({
      content: `You already have **${openTicketCount}** open ticket(s). This server allows a maximum of **${maxOpenTickets}** open ticket(s) per person.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  const ticketType = await getTicketType(guild.id, requestedTypeKey);
  if (!ticketType || !ticketType.enabled) {
    return interaction.reply({
      content: 'That ticket type is currently unavailable. Please select another department.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const existing = await findOpenTicket(guild.id, interaction.user.id, ticketType.key);
  if (existing) {
    const existingChannel = guild.channels.cache.get(existing.channelId);
    return interaction.reply({
      content: existingChannel
        ? `You already have an open **${ticketType.label}** ticket: ${existingChannel}`
        : `You already have an open **${ticketType.label}** ticket.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const safeUser = interaction.user.username
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 32) || 'user';

  const staffRoleId = ticketType.staffRoleId || settings.ticketStaffRoleId;
  const parentCategoryId = ticketType.categoryId || settings.ticketsCategoryId;

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels,
      ],
    },
  ];

  if (staffRoleId && guild.roles.cache.has(staffRoleId)) {
    overwrites.push({
      id: staffRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
      ],
    });
  }

  const ticketChannel = await guild.channels.create({
    name: `${channelSlug(ticketType.key)}-${safeUser}`.slice(0, 100),
    type: ChannelType.GuildText,
    parent: parentCategoryId && guild.channels.cache.has(parentCategoryId)
      ? parentCategoryId
      : undefined,
    permissionOverwrites: overwrites,
    reason: `${ticketType.label} ticket created by ${interaction.user.tag}`,
  });

  const ticketId = crypto.randomUUID();

  await saveTicket({
    id: ticketId,
    guildId: guild.id,
    channelId: ticketChannel.id,
    userId: interaction.user.id,
    ticketTypeKey: ticketType.key,
    status: 'open',
    createdAt: new Date().toISOString(),
    closedAt: null,
    closedBy: null,
    transcriptFile: null,
  });

  const mentionParts = [`<@${interaction.user.id}>`];
  if (staffRoleId && guild.roles.cache.has(staffRoleId)) mentionParts.push(`<@&${staffRoleId}>`);

  await ticketChannel.send({
    content: mentionParts.join(' '),
    embeds: [new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle(`${ticketType.emoji || '🎫'} ${ticketType.label} Ticket Opened`)
      .setDescription([
        ticketType.description,
        '',
        'Please provide all relevant details below. The appropriate team can use the close button when the ticket is resolved.',
      ].join('\n'))
      .addFields(
        { name: 'Ticket Type', value: ticketType.label, inline: true },
        { name: 'Opened By', value: `<@${interaction.user.id}>`, inline: true },
        { name: 'Ticket ID', value: ticketId, inline: false },
      )
      .setFooter({ text: 'MultiBot Advanced Tickets' })
      .setTimestamp()],
    components: ticketCloseComponents(),
    allowedMentions: {
      users: [interaction.user.id],
      roles: staffRoleId ? [staffRoleId] : [],
      parse: [],
    },
  });

  await interaction.editReply(
    `Your **${ticketType.label}** ticket has been created: ${ticketChannel}`,
  );
}

async function fetchAllMessages(channel, limit = 5000) {
  const collected = [];
  let before;

  while (collected.length < limit) {
    const batch = await channel.messages.fetch({
      limit: Math.min(100, limit - collected.length),
      before,
    });
    if (!batch.size) break;

    collected.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }

  return collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function renderTranscript(ticket, ticketType, guild, channel, messages) {
  const rows = messages.map((message) => {
    const attachments = [...message.attachments.values()].map((attachment) =>
      `<div class="attachment"><a href="${escapeHtml(attachment.url)}" target="_blank" rel="noreferrer">${escapeHtml(attachment.name || 'attachment')}</a></div>`
    ).join('');

    const content = escapeHtml(message.cleanContent || message.content || '').replace(/\n/g, '<br>');

    return `<article class="message">
      <img class="avatar" src="${escapeHtml(message.author.displayAvatarURL({ extension: 'png', size: 64 }))}" alt="">
      <div class="message-body">
        <div class="meta"><strong>${escapeHtml(message.member?.displayName || message.author.username)}</strong> <span>${escapeHtml(message.author.tag)}</span> <time>${escapeHtml(new Date(message.createdTimestamp).toLocaleString())}</time></div>
        <div class="content">${content || '<em>[no text content]</em>'}</div>${attachments}
      </div>
    </article>`;
  }).join('\n');

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Ticket Transcript</title><style>
  body{margin:0;background:#1e1f22;color:#dbdee1;font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:980px;margin:auto;padding:32px}.header{background:#2b2d31;border-radius:14px;padding:24px;margin-bottom:18px}.header h1{margin:0 0 8px}.message{display:flex;gap:14px;padding:14px 10px;border-bottom:1px solid #2b2d31}.avatar{width:42px;height:42px;border-radius:50%}.message-body{min-width:0}.meta strong{color:#fff}.meta span,.meta time{color:#949ba4;margin-left:8px;font-size:12px}.content{white-space:normal;overflow-wrap:anywhere;margin-top:3px}.attachment a{color:#00a8fc}.footer{color:#949ba4;margin-top:22px;font-size:12px}</style></head><body><div class="wrap"><section class="header"><h1>${escapeHtml(guild.name)} — #${escapeHtml(channel.name)}</h1><div>Type: ${escapeHtml(ticketType?.label || ticket.ticketTypeKey || 'Support')}</div><div>Ticket ID: ${escapeHtml(ticket.id)}</div><div>Claimed By: ${escapeHtml(ticket.claimedBy || 'Unclaimed')}</div><div>Close Reason: ${escapeHtml(ticket.closeReason || 'Not provided')}</div><div>Created: ${escapeHtml(ticket.createdAt)}</div><div>Messages: ${messages.length}</div></section>${rows}<div class="footer">Generated by MultiBot Advanced Tickets</div></div></body></html>`;
}

async function ticketAccess(interaction, ticket, settings, ticketType) {
  const staffRoleId = ticketType?.staffRoleId || settings.ticketStaffRoleId;
  const member = interaction.member?.roles?.cache
    ? interaction.member
    : await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  const isOwner = ticket.userId === interaction.user.id;
  const isStaff = Boolean(
    member?.permissions?.has(PermissionFlagsBits.ManageChannels)
    || (staffRoleId && member?.roles?.cache?.has(staffRoleId)),
  );
  return { member, isOwner, isStaff, staffRoleId };
}

async function claimTicket(interaction) {
  const ticket = await findTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status !== 'open') {
    return interaction.reply({ content: 'This channel is not an open ticket.', flags: MessageFlags.Ephemeral });
  }

  const settings = await getGuildSettings(interaction.guildId);
  const ticketType = await getTicketType(interaction.guildId, ticket.ticketTypeKey || 'support');
  const access = await ticketAccess(interaction, ticket, settings, ticketType);

  if (!access.isStaff) {
    return interaction.reply({ content: 'Only ticket staff can claim tickets.', flags: MessageFlags.Ephemeral });
  }

  if (ticket.claimedBy && ticket.claimedBy !== interaction.user.id) {
    return interaction.reply({ content: `This ticket is already claimed by <@${ticket.claimedBy}>.`, flags: MessageFlags.Ephemeral });
  }

  await updateTicket(ticket.id, { claimedBy: interaction.user.id });
  await interaction.channel.send({
    embeds: [new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🙋 Ticket Claimed')
      .setDescription(`<@${interaction.user.id}> has claimed this **${ticketType?.label || 'ticket'}**.`)
      .setTimestamp()],
    allowedMentions: { users: [interaction.user.id], parse: [] },
  });
  return interaction.reply({ content: 'Ticket claimed.', flags: MessageFlags.Ephemeral });
}

async function requestTicketClose(interaction) {
  const ticket = await findTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status !== 'open') {
    return interaction.reply({ content: 'This channel is not an open ticket.', flags: MessageFlags.Ephemeral });
  }

  const settings = await getGuildSettings(interaction.guildId);
  const ticketType = await getTicketType(interaction.guildId, ticket.ticketTypeKey || 'support');
  const access = await ticketAccess(interaction, ticket, settings, ticketType);

  if (!access.isOwner && !access.isStaff) {
    return interaction.reply({ content: 'You do not have permission to close this ticket.', flags: MessageFlags.Ephemeral });
  }

  const modal = new ModalBuilder()
    .setCustomId(`ticket:close:submit:${ticket.id}`)
    .setTitle('Close Ticket');

  const reason = new TextInputBuilder()
    .setCustomId('reason')
    .setLabel('Close reason')
    .setStyle(TextInputStyle.Paragraph)
    .setRequired(true)
    .setMaxLength(1000)
    .setPlaceholder('Describe why this ticket is being closed.');

  modal.addComponents(new ActionRowBuilder().addComponents(reason));
  return interaction.showModal(modal);
}

async function closeTicket(interaction, closeReason = 'No reason provided') {
  const ticket = await findTicketByChannel(interaction.channelId);

  if (!ticket || ticket.status !== 'open') {
    return interaction.reply({
      content: 'This channel is not an open ticket.',
      flags: MessageFlags.Ephemeral,
    });
  }

  const settings = await getGuildSettings(interaction.guildId);
  const ticketType = await getTicketType(interaction.guildId, ticket.ticketTypeKey || 'support');
  const staffRoleId = ticketType?.staffRoleId || settings.ticketStaffRoleId;

  const access = await ticketAccess(interaction, ticket, settings, ticketType);

  if (!access.isOwner && !access.isStaff) {
    return interaction.reply({
      content: 'You do not have permission to close this ticket.',
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  ticket.closeReason = String(closeReason || 'No reason provided').slice(0, 1000);
  const messages = await fetchAllMessages(interaction.channel);
  const html = renderTranscript(ticket, ticketType, interaction.guild, interaction.channel, messages);
  const fileName = `${interaction.guildId}-${interaction.channelId}-${ticket.id}.html`;
  const transcriptPublicToken = settings.onlineTranscriptsEnabled
    ? crypto.randomBytes(32).toString('hex')
    : null;

  await updateTicket(ticket.id, {
    status: 'closed',
    closedAt: new Date().toISOString(),
    closedBy: interaction.user.id,
    closeReason: String(closeReason || 'No reason provided').slice(0, 1000),
    transcriptPublicToken,
    transcriptFile: fileName,
    transcriptHtml: html,
  });

  const transcriptBuffer = Buffer.from(html, 'utf8');
  const attachment = new AttachmentBuilder(transcriptBuffer, { name: fileName });
  const baseUrl = String(process.env.BASE_URL || '').replace(/\/+$/, '');
  const onlineUrl = settings.onlineTranscriptsEnabled && transcriptPublicToken && baseUrl
    ? `${baseUrl}/transcripts/public/${transcriptPublicToken}`
    : null;

  const transcriptChannel = settings.transcriptChannelId
    ? interaction.guild.channels.cache.get(settings.transcriptChannelId)
    : null;

  if (transcriptChannel?.isTextBased()) {
    const contentLines = [
      `Transcript for **${ticketType?.label || 'Ticket'}** • **${interaction.channel.name}** • opened by <@${ticket.userId}> • closed by <@${interaction.user.id}>`,
      `**Reason:** ${String(closeReason || 'No reason provided').slice(0, 900)}`,
    ];
    if (onlineUrl) contentLines.push(`**View online:** ${onlineUrl}`);

    await transcriptChannel.send({
      content: contentLines.join('\n'),
      files: settings.transcriptAttachmentsEnabled ? [attachment] : [],
      allowedMentions: { parse: [] },
    }).catch(console.error);
  }

  const opener = await interaction.client.users.fetch(ticket.userId).catch(() => null);
  if (opener) {
    const dmAttachment = new AttachmentBuilder(Buffer.from(html, 'utf8'), { name: fileName });
    const dmLines = [
      `Your **${ticketType?.label || 'support'}** ticket in **${interaction.guild.name}** has been closed.`,
      `**Reason:** ${String(closeReason || 'No reason provided').slice(0, 900)}`,
    ];
    if (onlineUrl) dmLines.push(`**View transcript online:** ${onlineUrl}`);

    await opener.send({
      content: dmLines.join('\n'),
      files: settings.transcriptAttachmentsEnabled ? [dmAttachment] : [],
    }).catch(() => null);
  }

  await interaction.editReply(
    `Transcript saved to MySQL.${onlineUrl ? ` Online: ${onlineUrl}` : ''} This channel will be deleted in 5 seconds.`,
  );
  setTimeout(
    () => interaction.channel.delete(`Ticket closed by ${interaction.user.tag}`).catch(console.error),
    5000,
  );
}

module.exports = {
  postTicketPanel,
  createTicket,
  claimTicket,
  requestTicketClose,
  closeTicket,
};
