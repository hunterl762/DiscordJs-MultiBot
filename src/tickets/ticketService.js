const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');
const {
  transcriptsDir,
  getGuildSettings,
  findOpenTicket,
  findTicketByChannel,
  saveTicket,
  updateTicket,
} = require('../store');
const { escapeHtml } = require('../utils/html');

function ticketPanelComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:create')
      .setLabel('Create Ticket')
      .setEmoji('🎫')
      .setStyle(ButtonStyle.Primary),
  )];
}

function ticketCloseComponents() {
  return [new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket:close')
      .setLabel('Close Ticket')
      .setEmoji('🔒')
      .setStyle(ButtonStyle.Danger),
  )];
}

async function postTicketPanel(channel) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('Support Tickets')
    .setDescription('Need help? Click **Create Ticket** below to open a private support channel.');
  return channel.send({ embeds: [embed], components: ticketPanelComponents() });
}

async function createTicket(interaction) {
  const guild = interaction.guild;
  const settings = getGuildSettings(guild.id);
  if (!settings.ticketsEnabled) {
    return interaction.reply({ content: 'Tickets are disabled for this server.', ephemeral: true });
  }

  const existing = findOpenTicket(guild.id, interaction.user.id);
  if (existing) {
    const existingChannel = guild.channels.cache.get(existing.channelId);
    return interaction.reply({
      content: existingChannel ? `You already have an open ticket: ${existingChannel}` : 'You already have an open ticket.',
      ephemeral: true,
    });
  }

  await interaction.deferReply({ ephemeral: true });
  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 40) || 'user';
  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles],
    },
    {
      id: guild.members.me.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels],
    },
  ];
  if (settings.ticketStaffRoleId && guild.roles.cache.has(settings.ticketStaffRoleId)) {
    overwrites.push({
      id: settings.ticketStaffRoleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
    });
  }

  const channel = await guild.channels.create({
    name: `ticket-${safeName}`,
    type: ChannelType.GuildText,
    parent: settings.ticketsCategoryId && guild.channels.cache.has(settings.ticketsCategoryId)
      ? settings.ticketsCategoryId
      : undefined,
    permissionOverwrites: overwrites,
    reason: `Ticket created by ${interaction.user.tag}`,
  });

  const ticketId = crypto.randomUUID();
  saveTicket({
    id: ticketId,
    guildId: guild.id,
    channelId: channel.id,
    userId: interaction.user.id,
    status: 'open',
    createdAt: new Date().toISOString(),
    closedAt: null,
    closedBy: null,
    transcriptFile: null,
  });

  await channel.send({
    content: `<@${interaction.user.id}>${settings.ticketStaffRoleId ? ` <@&${settings.ticketStaffRoleId}>` : ''}`,
    embeds: [new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('Ticket Opened')
      .setDescription('Describe what you need help with. A staff member can close this ticket with the button below.')
      .setFooter({ text: `Ticket ID: ${ticketId}` })],
    components: ticketCloseComponents(),
  });

  await interaction.editReply(`Your ticket has been created: ${channel}`);
}

async function fetchAllMessages(channel, limit = 5000) {
  const collected = [];
  let before;
  while (collected.length < limit) {
    const batch = await channel.messages.fetch({ limit: Math.min(100, limit - collected.length), before });
    if (!batch.size) break;
    collected.push(...batch.values());
    before = batch.last().id;
    if (batch.size < 100) break;
  }
  return collected.sort((a, b) => a.createdTimestamp - b.createdTimestamp);
}

function renderTranscript(ticket, guild, channel, messages) {
  const rows = messages.map((message) => {
    const attachments = [...message.attachments.values()].map((a) =>
      `<div class="attachment"><a href="${escapeHtml(a.url)}" target="_blank" rel="noreferrer">${escapeHtml(a.name || 'attachment')}</a></div>`
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
  body{margin:0;background:#1e1f22;color:#dbdee1;font:15px/1.45 system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:980px;margin:auto;padding:32px}.header{background:#2b2d31;border-radius:14px;padding:24px;margin-bottom:18px}.header h1{margin:0 0 8px}.message{display:flex;gap:14px;padding:14px 10px;border-bottom:1px solid #2b2d31}.avatar{width:42px;height:42px;border-radius:50%}.message-body{min-width:0}.meta strong{color:#fff}.meta span,.meta time{color:#949ba4;margin-left:8px;font-size:12px}.content{white-space:normal;overflow-wrap:anywhere;margin-top:3px}.attachment a{color:#00a8fc}.footer{color:#949ba4;margin-top:22px;font-size:12px}</style></head><body><div class="wrap"><section class="header"><h1>${escapeHtml(guild.name)} — #${escapeHtml(channel.name)}</h1><div>Ticket ID: ${escapeHtml(ticket.id)}</div><div>Created: ${escapeHtml(ticket.createdAt)}</div><div>Messages: ${messages.length}</div></section>${rows}<div class="footer">Generated by MultiBot</div></div></body></html>`;
}

async function closeTicket(interaction) {
  const ticket = findTicketByChannel(interaction.channelId);
  if (!ticket || ticket.status !== 'open') {
    return interaction.reply({ content: 'This channel is not an open ticket.', ephemeral: true });
  }
  const settings = getGuildSettings(interaction.guildId);
  const member = interaction.member;
  const isOwner = ticket.userId === interaction.user.id;
  const isStaff = member.permissions.has(PermissionFlagsBits.ManageChannels)
    || (settings.ticketStaffRoleId && member.roles.cache.has(settings.ticketStaffRoleId));
  if (!isOwner && !isStaff) {
    return interaction.reply({ content: 'You do not have permission to close this ticket.', ephemeral: true });
  }

  await interaction.deferReply({ ephemeral: true });
  const messages = await fetchAllMessages(interaction.channel);
  const html = renderTranscript(ticket, interaction.guild, interaction.channel, messages);
  const fileName = `${interaction.guildId}-${interaction.channelId}-${ticket.id}.html`;
  const filePath = path.join(transcriptsDir, fileName);
  fs.writeFileSync(filePath, html, 'utf8');

  updateTicket(ticket.id, {
    status: 'closed',
    closedAt: new Date().toISOString(),
    closedBy: interaction.user.id,
    transcriptFile: fileName,
  });

  const attachment = new AttachmentBuilder(filePath, { name: `ticket-${interaction.channel.name}.html` });
  const transcriptChannel = settings.transcriptChannelId
    ? interaction.guild.channels.cache.get(settings.transcriptChannelId)
    : null;
  if (transcriptChannel?.isTextBased()) {
    await transcriptChannel.send({
      content: `Transcript for **${interaction.channel.name}** • opened by <@${ticket.userId}> • closed by <@${interaction.user.id}>`,
      files: [attachment],
    }).catch(console.error);
  }

  const opener = await interaction.client.users.fetch(ticket.userId).catch(() => null);
  if (opener) {
    const dmAttachment = new AttachmentBuilder(filePath, { name: `ticket-${interaction.channel.name}.html` });
    await opener.send({ content: `Your ticket in **${interaction.guild.name}** has been closed.`, files: [dmAttachment] }).catch(() => null);
  }

  await interaction.editReply('Transcript created. This channel will be deleted in 5 seconds.');
  setTimeout(() => interaction.channel.delete(`Ticket closed by ${interaction.user.tag}`).catch(console.error), 5000);
}

module.exports = {
  postTicketPanel,
  createTicket,
  closeTicket,
};
