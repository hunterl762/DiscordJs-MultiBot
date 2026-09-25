const {
  EmbedBuilder,
  PermissionFlagsBits,
  SlashCommandBuilder,
} = require('discord.js');
const { getGuildSettings } = require('../store');
const { postTicketPanel, closeTicket } = require('../tickets/ticketService');
const { postVerificationPanel, verifyMember } = require('./verification');
const { isBotOwner, broadcastToGuilds, formatBroadcastSummary } = require('./broadcast');

const slashCommands = [
  new SlashCommandBuilder().setName('ping').setDescription('Check bot latency.'),
  new SlashCommandBuilder().setName('help').setDescription('Show available commands.'),
  new SlashCommandBuilder().setName('avatar').setDescription('Show a user avatar.')
    .addUserOption(o => o.setName('user').setDescription('User to view')),
  new SlashCommandBuilder().setName('userinfo').setDescription('Show information about a user.')
    .addUserOption(o => o.setName('user').setDescription('User to inspect')),
  new SlashCommandBuilder().setName('serverinfo').setDescription('Show information about this server.'),
  new SlashCommandBuilder().setName('purge').setDescription('Delete recent messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption(o => o.setName('amount').setDescription('1-100 messages').setMinValue(1).setMaxValue(100).setRequired(true)),
  new SlashCommandBuilder().setName('kick').setDescription('Kick a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to kick').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('ban').setDescription('Ban a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to ban').setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member to timeout').setRequired(true))
    .addIntegerOption(o => o.setName('minutes').setDescription('Minutes, 1-40320').setMinValue(1).setMaxValue(40320).setRequired(true))
    .addStringOption(o => o.setName('reason').setDescription('Reason')),
  new SlashCommandBuilder().setName('untimeout').setDescription('Remove a timeout.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true)),
  new SlashCommandBuilder().setName('say').setDescription('Send a message as the bot.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addStringOption(o => o.setName('message').setDescription('Message to send').setRequired(true)),
  new SlashCommandBuilder().setName('poll').setDescription('Create a yes/no poll.')
    .addStringOption(o => o.setName('question').setDescription('Poll question').setRequired(true)),
  new SlashCommandBuilder().setName('role').setDescription('Add or remove a role.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addSubcommand(s => s.setName('add').setDescription('Add a role')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
    .addSubcommand(s => s.setName('remove').setDescription('Remove a role')
      .addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))
      .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true))),
  new SlashCommandBuilder().setName('broadcast').setDescription('Owner only: broadcast an announcement to every bot server.')
    .addStringOption(o => o.setName('message').setDescription('Announcement message').setMaxLength(1800).setRequired(true))
    .addStringOption(o => o.setName('title').setDescription('Announcement title').setMaxLength(256))
    .addBooleanOption(o => o.setName('dry-run').setDescription('Preview delivery count without sending')),
  new SlashCommandBuilder().setName('ticket').setDescription('Ticket system controls.')
    .addSubcommand(s => s.setName('setup').setDescription('Post the ticket panel in a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Panel channel')))
    .addSubcommand(s => s.setName('close').setDescription('Close the current ticket')),
  new SlashCommandBuilder().setName('verification').setDescription('Member verification controls.')
    .addSubcommand(s => s.setName('setup').setDescription('Post the verification panel in a channel')
      .addChannelOption(o => o.setName('channel').setDescription('Verification channel')))
    .addSubcommand(s => s.setName('verify').setDescription('Verify yourself or a member')
      .addUserOption(o => o.setName('user').setDescription('Member to verify (Manage Roles required for others)')))
    .addSubcommand(s => s.setName('status').setDescription('Show verification configuration status')),
].map(c => c.toJSON());

function helpEmbed(prefix = '!') {
  return new EmbedBuilder().setColor(0x5865f2).setTitle('MultiBot Commands').setDescription([
    '**General:** `/ping`, `/help`, `/avatar`, `/userinfo`, `/serverinfo`, `/poll`',
    '**Moderation:** `/purge`, `/kick`, `/ban`, `/timeout`, `/untimeout`, `/role`, `/say`',
    '**Tickets:** `/ticket setup`, `/ticket close` and the ticket panel button',
    '**Verification:** `/verification setup`, `/verification verify`, `/verification status`',
    '**Bot Owner:** `/broadcast` sends an announcement across all servers (owner only)',
    `Every slash command has a legacy prefix fallback when enabled (default prefix: \`${prefix}\`).`,
  ].join('\n'));
}

function userInfoEmbed(user, member) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(user.tag)
    .setThumbnail(user.displayAvatarURL())
    .addFields(
      { name: 'User ID', value: user.id, inline: true },
      { name: 'Account Created', value: `<t:${Math.floor(user.createdTimestamp / 1000)}:F>` },
      { name: 'Joined Server', value: member?.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : 'Unknown' },
    );
}

function serverInfoEmbed(guild) {
  return new EmbedBuilder().setColor(0x5865f2).setTitle(guild.name).setThumbnail(guild.iconURL()).addFields(
    { name: 'Members', value: String(guild.memberCount), inline: true },
    { name: 'Channels', value: String(guild.channels.cache.size), inline: true },
    { name: 'Created', value: `<t:${Math.floor(guild.createdTimestamp / 1000)}:F>` },
    { name: 'Server ID', value: guild.id },
  );
}

async function executeSlash(interaction) {
  const { commandName } = interaction;

  if (commandName === 'broadcast') {
    if (!(await isBotOwner(interaction.client, interaction.user.id))) {
      return interaction.reply({ content: 'This command is restricted to the bot owner.', ephemeral: true });
    }
    const message = interaction.options.getString('message', true).trim();
    const title = (interaction.options.getString('title') || 'MultiBot Announcement').trim();
    const dryRun = interaction.options.getBoolean('dry-run') || false;
    await interaction.deferReply({ ephemeral: true });
    const results = await broadcastToGuilds(interaction.client, { title, message, dryRun });
    return interaction.editReply(formatBroadcastSummary(results));
  }

  if (!interaction.guild && commandName !== 'ping') {
    return interaction.reply({ content: 'This command must be used in a server.', ephemeral: true });
  }

  if (commandName === 'ping') return interaction.reply(`Pong! WebSocket: ${interaction.client.ws.ping}ms`);
  if (commandName === 'help') return interaction.reply({ embeds: [helpEmbed(getGuildSettings(interaction.guildId).prefix)], ephemeral: true });

  if (commandName === 'avatar') {
    const user = interaction.options.getUser('user') || interaction.user;
    return interaction.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`${user.tag}'s avatar`).setImage(user.displayAvatarURL({ size: 1024 }))] });
  }

  if (commandName === 'userinfo') {
    const user = interaction.options.getUser('user') || interaction.user;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    return interaction.reply({ embeds: [userInfoEmbed(user, member)] });
  }

  if (commandName === 'serverinfo') return interaction.reply({ embeds: [serverInfoEmbed(interaction.guild)] });

  if (commandName === 'purge') {
    const amount = interaction.options.getInteger('amount', true);
    const deleted = await interaction.channel.bulkDelete(amount, true);
    return interaction.reply({ content: `Deleted ${deleted.size} message(s).`, ephemeral: true });
  }

  if (commandName === 'kick' || commandName === 'ban') {
    const user = interaction.options.getUser('user', true);
    const reason = interaction.options.getString('reason') || `Action by ${interaction.user.tag}`;
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);
    if (!member) return interaction.reply({ content: 'That user is not in this server.', ephemeral: true });
    if (commandName === 'kick') await member.kick(reason);
    else await member.ban({ reason });
    return interaction.reply(`${user.tag} was ${commandName === 'kick' ? 'kicked' : 'banned'}.`);
  }

  if (commandName === 'timeout' || commandName === 'untimeout') {
    const user = interaction.options.getUser('user', true);
    const member = await interaction.guild.members.fetch(user.id);
    const minutes = commandName === 'timeout' ? interaction.options.getInteger('minutes', true) : 0;
    const reason = commandName === 'timeout'
      ? (interaction.options.getString('reason') || `Action by ${interaction.user.tag}`)
      : `Timeout removed by ${interaction.user.tag}`;
    await member.timeout(minutes ? minutes * 60_000 : null, reason);
    return interaction.reply(`${user.tag} ${minutes ? `was timed out for ${minutes} minute(s)` : 'is no longer timed out'}.`);
  }

  if (commandName === 'say') {
    const message = interaction.options.getString('message', true);
    await interaction.channel.send({ content: message, allowedMentions: { parse: [] } });
    return interaction.reply({ content: 'Sent.', ephemeral: true });
  }

  if (commandName === 'poll') {
    const question = interaction.options.getString('question', true);
    const msg = await interaction.reply({ content: `📊 **${question}**`, fetchReply: true });
    await msg.react('👍');
    await msg.react('👎');
    return undefined;
  }

  if (commandName === 'role') {
    const sub = interaction.options.getSubcommand();
    const user = interaction.options.getUser('user', true);
    const role = interaction.options.getRole('role', true);
    const member = await interaction.guild.members.fetch(user.id);
    if (sub === 'add') await member.roles.add(role);
    else await member.roles.remove(role);
    return interaction.reply({ content: `${sub === 'add' ? 'Added' : 'Removed'} ${role} ${sub === 'add' ? 'to' : 'from'} ${member}.`, ephemeral: true });
  }

  if (commandName === 'ticket') {
    const sub = interaction.options.getSubcommand();
    if (sub === 'close') return closeTicket(interaction);
    if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
      return interaction.reply({ content: 'Manage Server is required.', ephemeral: true });
    }
    const channel = interaction.options.getChannel('channel') || interaction.channel;
    if (!channel?.isTextBased()) return interaction.reply({ content: 'Choose a text channel.', ephemeral: true });
    await postTicketPanel(channel);
    return interaction.reply({ content: `Ticket panel posted in ${channel}.`, ephemeral: true });
  }

  if (commandName === 'verification') {
    const sub = interaction.options.getSubcommand();
    const settings = getGuildSettings(interaction.guildId);

    if (sub === 'setup') {
      if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
        return interaction.reply({ content: 'Manage Server is required.', ephemeral: true });
      }
      const channel = interaction.options.getChannel('channel') || interaction.channel;
      if (!channel?.isTextBased()) return interaction.reply({ content: 'Choose a text channel.', ephemeral: true });
      await postVerificationPanel(channel);
      return interaction.reply({ content: `Verification panel posted in ${channel}.`, ephemeral: true });
    }

    if (sub === 'status') {
      return interaction.reply({
        content: [
          `Verification: **${settings.verificationEnabled ? 'enabled' : 'disabled'}**`,
          `Channel: ${settings.verificationChannelId ? `<#${settings.verificationChannelId}>` : 'not configured'}`,
          `Verified role: ${settings.verifiedRoleId ? `<@&${settings.verifiedRoleId}>` : 'not configured'}`,
          `Unverified role: ${settings.unverifiedRoleId ? `<@&${settings.unverifiedRoleId}>` : 'not configured'}`,
        ].join('\n'),
        ephemeral: true,
        allowedMentions: { parse: [] },
      });
    }

    const targetUser = interaction.options.getUser('user') || interaction.user;
    if (targetUser.id !== interaction.user.id && !interaction.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
      return interaction.reply({ content: 'Manage Roles is required to verify another member.', ephemeral: true });
    }
    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) return interaction.reply({ content: 'That member could not be found.', ephemeral: true });
    const result = await verifyMember(member, interaction.user.tag);
    return interaction.reply({ content: result.message, ephemeral: true });
  }

  return undefined;
}

function makeMessageCloseContext(message) {
  return {
    channelId: message.channelId,
    guildId: message.guildId,
    user: message.author,
    member: message.member,
    guild: message.guild,
    channel: message.channel,
    client: message.client,
    deferReply: async () => undefined,
    editReply: async (payload) => message.channel.send(typeof payload === 'string' ? { content: payload } : payload),
    reply: async (payload) => message.reply(payload),
  };
}

async function executePrefix(message) {
  if (!message.guild || message.author.bot) return;
  const settings = getGuildSettings(message.guild.id);
  if (!settings.prefixCommandsEnabled || !message.content.startsWith(settings.prefix)) return;

  const args = message.content.slice(settings.prefix.length).trim().split(/\s+/);
  const name = (args.shift() || '').toLowerCase();
  if (!name) return;

  if (name === 'broadcast') {
    if (!(await isBotOwner(message.client, message.author.id))) return message.reply('This command is restricted to the bot owner.');
    const announcement = args.join(' ').trim();
    if (!announcement) return message.reply(`Usage: ${settings.prefix}broadcast <message>`);
    const status = await message.reply('Broadcast started…');
    const results = await broadcastToGuilds(message.client, { message: announcement });
    return status.edit(formatBroadcastSummary(results));
  }

  if (name === 'ping') return message.reply(`Pong! ${message.client.ws.ping}ms`);
  if (name === 'help') return message.reply({ embeds: [helpEmbed(settings.prefix)] });

  if (name === 'avatar') {
    const user = message.mentions.users.first() || message.author;
    return message.reply({ embeds: [new EmbedBuilder().setColor(0x5865f2).setTitle(`${user.tag}'s avatar`).setImage(user.displayAvatarURL({ size: 1024 }))] });
  }

  if (name === 'userinfo') {
    const user = message.mentions.users.first() || message.author;
    const member = await message.guild.members.fetch(user.id).catch(() => null);
    return message.reply({ embeds: [userInfoEmbed(user, member)] });
  }

  if (name === 'serverinfo') return message.reply({ embeds: [serverInfoEmbed(message.guild)] });

  if (name === 'purge') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return message.reply('Manage Messages is required.');
    const amount = Math.min(Math.max(Number(args[0]) || 1, 1), 100);
    await message.delete().catch(() => null);
    const deleted = await message.channel.bulkDelete(amount, true);
    return message.channel.send(`Deleted ${deleted.size} message(s).`).then(m => setTimeout(() => m.delete().catch(() => null), 3000));
  }

  if (name === 'say') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return message.reply('Manage Messages is required.');
    const content = args.join(' ').trim();
    if (!content) return message.reply(`Usage: ${settings.prefix}say <message>`);
    return message.channel.send({ content, allowedMentions: { parse: [] } });
  }

  if (name === 'poll') {
    const question = args.join(' ').trim();
    if (!question) return message.reply(`Usage: ${settings.prefix}poll <question>`);
    const poll = await message.channel.send(`📊 **${question}**`);
    await poll.react('👍');
    await poll.react('👎');
    return undefined;
  }

  if (name === 'kick' || name === 'ban') {
    const perm = name === 'kick' ? PermissionFlagsBits.KickMembers : PermissionFlagsBits.BanMembers;
    if (!message.member.permissions.has(perm)) return message.reply(`${name === 'kick' ? 'Kick Members' : 'Ban Members'} is required.`);
    const member = message.mentions.members.first();
    if (!member) return message.reply('Mention a member.');
    const reason = args.filter(a => !a.match(/^<@!?\d+>$/)).join(' ') || `Action by ${message.author.tag}`;
    if (name === 'kick') await member.kick(reason);
    else await member.ban({ reason });
    return message.channel.send(`${member.user.tag} was ${name === 'kick' ? 'kicked' : 'banned'}.`);
  }

  if (name === 'timeout') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply('Moderate Members is required.');
    const member = message.mentions.members.first();
    const mentionIndex = args.findIndex(a => /^<@!?\d+>$/.test(a));
    const minutes = Number(args[mentionIndex + 1]);
    if (!member || !Number.isInteger(minutes) || minutes < 1 || minutes > 40320) {
      return message.reply(`Usage: ${settings.prefix}timeout @user <minutes 1-40320> [reason]`);
    }
    const reason = args.slice(mentionIndex + 2).join(' ') || `Action by ${message.author.tag}`;
    await member.timeout(minutes * 60_000, reason);
    return message.reply(`${member.user.tag} was timed out for ${minutes} minute(s).`);
  }

  if (name === 'untimeout') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return message.reply('Moderate Members is required.');
    const member = message.mentions.members.first();
    if (!member) return message.reply(`Usage: ${settings.prefix}untimeout @user`);
    await member.timeout(null, `Timeout removed by ${message.author.tag}`);
    return message.reply(`${member.user.tag} is no longer timed out.`);
  }

  if (name === 'role') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageRoles)) return message.reply('Manage Roles is required.');
    const sub = (args[0] || '').toLowerCase();
    const member = message.mentions.members.first();
    const role = message.mentions.roles.first();
    if (!['add', 'remove'].includes(sub) || !member || !role) {
      return message.reply(`Usage: ${settings.prefix}role <add|remove> @user @role`);
    }
    if (sub === 'add') await member.roles.add(role);
    else await member.roles.remove(role);
    return message.reply(`${sub === 'add' ? 'Added' : 'Removed'} ${role} ${sub === 'add' ? 'to' : 'from'} ${member}.`);
  }

  if (name === 'ticket') {
    const sub = (args[0] || '').toLowerCase();
    if (sub === 'close') return closeTicket(makeMessageCloseContext(message));
    if (sub === 'setup') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) return message.reply('Manage Server is required.');
      const channel = message.mentions.channels.first() || message.channel;
      if (!channel?.isTextBased()) return message.reply('Choose a text channel.');
      await postTicketPanel(channel);
      return message.reply(`Ticket panel posted in ${channel}.`);
    }
    return message.reply(`Usage: ${settings.prefix}ticket <setup [#channel]|close>`);
  }

  if (name === 'verification' || name === 'verify') {
    const sub = name === 'verify' ? 'verify' : (args[0] || 'status').toLowerCase();
    if (sub === 'setup') {
      if (!message.member.permissions.has(PermissionFlagsBits.ManageGuild)) return message.reply('Manage Server is required.');
      const channel = message.mentions.channels.first() || message.channel;
      if (!channel?.isTextBased()) return message.reply('Choose a text channel.');
      await postVerificationPanel(channel);
      return message.reply(`Verification panel posted in ${channel}.`);
    }
    if (sub === 'status') {
      return message.reply({
        content: [
          `Verification: **${settings.verificationEnabled ? 'enabled' : 'disabled'}**`,
          `Channel: ${settings.verificationChannelId ? `<#${settings.verificationChannelId}>` : 'not configured'}`,
          `Verified role: ${settings.verifiedRoleId ? `<@&${settings.verifiedRoleId}>` : 'not configured'}`,
          `Unverified role: ${settings.unverifiedRoleId ? `<@&${settings.unverifiedRoleId}>` : 'not configured'}`,
        ].join('\n'),
        allowedMentions: { parse: [] },
      });
    }
    if (sub === 'verify') {
      const targetMember = message.mentions.members.first() || message.member;
      if (targetMember.id !== message.author.id && !message.member.permissions.has(PermissionFlagsBits.ManageRoles)) {
        return message.reply('Manage Roles is required to verify another member.');
      }
      const result = await verifyMember(targetMember, message.author.tag);
      return message.reply(result.message);
    }
    return message.reply(`Usage: ${settings.prefix}verification <setup [#channel]|verify [@user]|status>`);
  }

  return undefined;
}

module.exports = { slashCommands, executeSlash, executePrefix };
