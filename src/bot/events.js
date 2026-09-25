const {
  AuditLogEvent,
  EmbedBuilder,
  Events,
} = require('discord.js');
const { getGuildSettings } = require('../store');
const { executePrefix } = require('./commands');
const { prepareNewMember } = require('./verification');
const { getFeature } = require('../features/store');
const {
  auditActorText,
  baseEmbed,
  findRecentAuditEntry,
  sendLog,
  truncate,
} = require('./logging');

function getChannel(guild, id) {
  return id ? guild.channels.cache.get(id) : null;
}

function roleList(roles) {
  const values = [...roles.values()]
    .filter((role) => role.id !== role.guild.id)
    .map((role) => `${role.name} (${role.id})`);
  return values.length ? values.join(', ') : 'None';
}

function registerEvents(client) {
  const updateBotActivity = (readyClient) => {
    const shardCount = Math.max(1, readyClient.ws.shards.size || 1);
    readyClient.user.setActivity(`/help • kryndexabot.xyz • (${shardCount} / 100)`);
  };

  client.on(Events.ClientReady, (readyClient) => {
    console.log(`${readyClient.user.tag} is online in ${readyClient.guilds.cache.size} server(s).`);
    updateBotActivity(readyClient);
  });

  client.on(Events.ShardReady, () => {
    if (client.isReady()) updateBotActivity(client);
  });

  client.on(Events.MessageCreate, executePrefix);

  client.on(Events.GuildMemberAdd, async (member) => {
    await prepareNewMember(member);

    const settings = await getGuildSettings(member.guild.id);
    const welcomeFeature = await getFeature(member.guild.id, 'welcome');

    if (settings.welcomeEnabled && welcomeFeature?.enabled) {
      const channel = getChannel(member.guild, settings.welcomeChannelId)
        || member.guild.channels.cache.find((item) => item.name === 'welcome' && item.isTextBased());

      if (channel?.isTextBased()) {
        const description = String(welcomeFeature.config.welcomeMessage || 'Welcome {user} to {server}! You are member #{memberCount}.')
          .replaceAll('{user}', `<@${member.id}>`)
          .replaceAll('{server}', member.guild.name)
          .replaceAll('{memberCount}', String(member.guild.memberCount));

        const embed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle(`Welcome to ${member.guild.name}!`)
          .setDescription(description)
          .setThumbnail(member.user.displayAvatarURL())
          .setTimestamp();

        const imageUrl = String(welcomeFeature.config.welcomeImageUrl || '').trim();
        if (/^https?:\/\//i.test(imageUrl)) embed.setImage(imageUrl);

        await channel.send({
          embeds: [embed],
          allowedMentions: { users: [member.id], parse: [] },
        }).catch(console.error);
      }
    }

    const accountCreated = Math.floor(member.user.createdTimestamp / 1000);
    await sendLog(member.guild, 'general',
      baseEmbed(member.guild, '📥 Member Joined', 0x57f287)
        .setThumbnail(member.user.displayAvatarURL())
        .addFields(
          { name: 'Member', value: `${member.user.tag}\n<@${member.id}>`, inline: true },
          { name: 'User ID', value: member.id, inline: true },
          { name: 'Bot Account', value: member.user.bot ? 'Yes' : 'No', inline: true },
          { name: 'Account Created', value: `<t:${accountCreated}:F>\n<t:${accountCreated}:R>`, inline: false },
          { name: 'Member Count', value: String(member.guild.memberCount), inline: true },
        ),
    );
  });

  client.on(Events.GuildMemberRemove, async (member) => {
    const settings = await getGuildSettings(member.guild.id);

    const leaveChannel = getChannel(member.guild, settings.leaveChannelId)
      || member.guild.channels.cache.find((item) => item.name === 'leave-log' && item.isTextBased());

    if (leaveChannel?.isTextBased()) {
      const welcomeFeature = await getFeature(member.guild.id, 'welcome');
      const description = String(welcomeFeature?.config?.goodbyeMessage || '{user} left {server}.')
        .replaceAll('{user}', member.user.tag)
        .replaceAll('{server}', member.guild.name)
        .replaceAll('{memberCount}', String(member.guild.memberCount));

      await leaveChannel.send({
        embeds: [new EmbedBuilder()
          .setColor(0xed4245)
          .setTitle('Member Left')
          .setDescription(description)
          .setThumbnail(member.user.displayAvatarURL())
          .setTimestamp()],
      }).catch(console.error);
    }

    const kickEntry = await findRecentAuditEntry(member.guild, AuditLogEvent.MemberKick, member.id);
    const title = kickEntry ? '🥾 Member Kicked' : '📤 Member Left';
    const embed = baseEmbed(member.guild, title, 0xed4245)
      .setThumbnail(member.user.displayAvatarURL())
      .addFields(
        { name: 'Member', value: `${member.user.tag}\n${member.id}`, inline: true },
        { name: 'Joined', value: member.joinedTimestamp ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F>` : 'Unknown', inline: true },
        { name: 'Roles at Departure', value: truncate(roleList(member.roles.cache), 1000), inline: false },
      );

    if (kickEntry) {
      embed.addFields(
        { name: 'Moderator', value: auditActorText(kickEntry), inline: true },
        { name: 'Reason', value: truncate(kickEntry.reason || 'No reason provided', 1000), inline: false },
      );
    }

    await sendLog(member.guild, 'general', embed);
  });

  client.on(Events.GuildBanAdd, async (ban) => {
    const audit = await findRecentAuditEntry(ban.guild, AuditLogEvent.MemberBanAdd, ban.user.id);
    const embed = baseEmbed(ban.guild, '🔨 Member Banned', 0xed4245)
      .setThumbnail(ban.user.displayAvatarURL())
      .addFields(
        { name: 'User', value: `${ban.user.tag}\n${ban.user.id}`, inline: true },
        { name: 'Moderator', value: auditActorText(audit), inline: true },
        { name: 'Reason', value: truncate(audit?.reason || ban.reason || 'No reason provided', 1000), inline: false },
      );
    await sendLog(ban.guild, 'general', embed);
  });

  client.on(Events.GuildBanRemove, async (ban) => {
    const audit = await findRecentAuditEntry(ban.guild, AuditLogEvent.MemberBanRemove, ban.user.id);
    const embed = baseEmbed(ban.guild, '🔓 Member Unbanned', 0x57f287)
      .addFields(
        { name: 'User', value: `${ban.user.tag}\n${ban.user.id}`, inline: true },
        { name: 'Moderator', value: auditActorText(audit), inline: true },
      );
    await sendLog(ban.guild, 'general', embed);
  });

  client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
    const addedRoles = newMember.roles.cache.filter((role) => !oldMember.roles.cache.has(role.id));
    const removedRoles = oldMember.roles.cache.filter((role) => !newMember.roles.cache.has(role.id));

    if (addedRoles.size || removedRoles.size) {
      const audit = await findRecentAuditEntry(newMember.guild, AuditLogEvent.MemberRoleUpdate, newMember.id);
      const embed = baseEmbed(newMember.guild, '🎭 Member Roles Updated', 0x5865f2)
        .setThumbnail(newMember.user.displayAvatarURL())
        .addFields(
          { name: 'Member', value: `${newMember.user.tag}\n${newMember.id}`, inline: true },
          { name: 'Changed By', value: auditActorText(audit), inline: true },
          { name: 'Roles Added', value: truncate(roleList(addedRoles), 1000), inline: false },
          { name: 'Roles Removed', value: truncate(roleList(removedRoles), 1000), inline: false },
        );

      await sendLog(newMember.guild, 'role', embed);
    }

    if (oldMember.nickname !== newMember.nickname) {
      const embed = baseEmbed(newMember.guild, '📝 Member Nickname Updated', 0xfee75c)
        .addFields(
          { name: 'Member', value: `${newMember.user.tag}\n${newMember.id}`, inline: true },
          { name: 'Before', value: truncate(oldMember.nickname || oldMember.user.username, 1000), inline: true },
          { name: 'After', value: truncate(newMember.nickname || newMember.user.username, 1000), inline: true },
        );
      await sendLog(newMember.guild, 'general', embed);
    }
  });

  client.on(Events.RoleCreate, async (role) => {
    const audit = await findRecentAuditEntry(role.guild, AuditLogEvent.RoleCreate, role.id);
    await sendLog(role.guild, 'role',
      baseEmbed(role.guild, '➕ Role Created', 0x57f287)
        .addFields(
          { name: 'Role', value: `${role.name}\n${role.id}`, inline: true },
          { name: 'Color', value: role.hexColor, inline: true },
          { name: 'Created By', value: auditActorText(audit), inline: true },
        ),
    );
  });

  client.on(Events.RoleDelete, async (role) => {
    const audit = await findRecentAuditEntry(role.guild, AuditLogEvent.RoleDelete, role.id);
    await sendLog(role.guild, 'role',
      baseEmbed(role.guild, '➖ Role Deleted', 0xed4245)
        .addFields(
          { name: 'Role', value: `${role.name}\n${role.id}`, inline: true },
          { name: 'Deleted By', value: auditActorText(audit), inline: true },
        ),
    );
  });

  client.on(Events.RoleUpdate, async (oldRole, newRole) => {
    const changes = [];
    if (oldRole.name !== newRole.name) changes.push(`Name: **${oldRole.name}** → **${newRole.name}**`);
    if (oldRole.color !== newRole.color) changes.push(`Color: **${oldRole.hexColor}** → **${newRole.hexColor}**`);
    if (oldRole.hoist !== newRole.hoist) changes.push(`Displayed separately: **${oldRole.hoist}** → **${newRole.hoist}**`);
    if (oldRole.mentionable !== newRole.mentionable) changes.push(`Mentionable: **${oldRole.mentionable}** → **${newRole.mentionable}**`);
    if (oldRole.permissions.bitfield !== newRole.permissions.bitfield) changes.push('Permissions changed');

    if (!changes.length) return;

    const audit = await findRecentAuditEntry(newRole.guild, AuditLogEvent.RoleUpdate, newRole.id);
    await sendLog(newRole.guild, 'role',
      baseEmbed(newRole.guild, '⚙️ Role Updated', 0xfee75c)
        .addFields(
          { name: 'Role', value: `${newRole.name}\n${newRole.id}`, inline: true },
          { name: 'Changed By', value: auditActorText(audit), inline: true },
          { name: 'Changes', value: truncate(changes.join('\n'), 1000), inline: false },
        ),
    );
  });

  client.on(Events.ChannelCreate, async (channel) => {
    if (!channel.guild) return;
    const audit = await findRecentAuditEntry(channel.guild, AuditLogEvent.ChannelCreate, channel.id);
    await sendLog(channel.guild, 'general',
      baseEmbed(channel.guild, '➕ Channel Created', 0x57f287)
        .addFields(
          { name: 'Channel', value: `${channel.name}\n${channel.id}`, inline: true },
          { name: 'Type', value: String(channel.type), inline: true },
          { name: 'Parent', value: channel.parent?.name || 'None', inline: true },
          { name: 'Created By', value: auditActorText(audit), inline: false },
        ),
    );
  });

  client.on(Events.ChannelDelete, async (channel) => {
    if (!channel.guild) return;
    const audit = await findRecentAuditEntry(channel.guild, AuditLogEvent.ChannelDelete, channel.id);
    await sendLog(channel.guild, 'general',
      baseEmbed(channel.guild, '➖ Channel Deleted', 0xed4245)
        .addFields(
          { name: 'Channel', value: `${channel.name}\n${channel.id}`, inline: true },
          { name: 'Type', value: String(channel.type), inline: true },
          { name: 'Deleted By', value: auditActorText(audit), inline: false },
        ),
    );
  });

  client.on(Events.ChannelUpdate, async (oldChannel, newChannel) => {
    if (!newChannel.guild) return;

    const changes = [];
    if (oldChannel.name !== newChannel.name) changes.push(`Name: **${oldChannel.name}** → **${newChannel.name}**`);
    if (oldChannel.parentId !== newChannel.parentId) changes.push('Category/parent changed');
    if ('topic' in oldChannel && oldChannel.topic !== newChannel.topic) changes.push('Topic changed');
    if ('rateLimitPerUser' in oldChannel && oldChannel.rateLimitPerUser !== newChannel.rateLimitPerUser) {
      changes.push(`Slowmode: **${oldChannel.rateLimitPerUser || 0}s** → **${newChannel.rateLimitPerUser || 0}s**`);
    }

    if (!changes.length) return;

    const audit = await findRecentAuditEntry(newChannel.guild, AuditLogEvent.ChannelUpdate, newChannel.id);
    await sendLog(newChannel.guild, 'general',
      baseEmbed(newChannel.guild, '⚙️ Channel Updated', 0xfee75c)
        .addFields(
          { name: 'Channel', value: `${newChannel.name}\n${newChannel.id}`, inline: true },
          { name: 'Changed By', value: auditActorText(audit), inline: true },
          { name: 'Changes', value: truncate(changes.join('\n'), 1000), inline: false },
        ),
    );
  });

  client.on(Events.MessageDelete, async (message) => {
    if (!message.guild || message.author?.bot) return;

    await sendLog(message.guild, 'general',
      baseEmbed(message.guild, '🗑️ Message Deleted', 0xed4245)
        .addFields(
          { name: 'Author', value: message.author ? `${message.author.tag}\n${message.author.id}` : 'Unknown', inline: true },
          { name: 'Channel', value: `${message.channel}\n${message.channelId}`, inline: true },
          { name: 'Message ID', value: message.id || 'Unknown', inline: true },
          { name: 'Content', value: truncate(message.content || '[content unavailable]', 1000), inline: false },
          { name: 'Attachments', value: message.attachments?.size ? truncate([...message.attachments.values()].map((item) => item.url).join('\n'), 1000) : 'None', inline: false },
        ),
    );
  });

  client.on(Events.MessageUpdate, async (oldMessage, newMessage) => {
    if (!oldMessage.guild || oldMessage.author?.bot || oldMessage.content === newMessage.content) return;

    await sendLog(oldMessage.guild, 'general',
      baseEmbed(oldMessage.guild, '✏️ Message Edited', 0xfee75c)
        .addFields(
          { name: 'Author', value: oldMessage.author ? `${oldMessage.author.tag}\n${oldMessage.author.id}` : 'Unknown', inline: true },
          { name: 'Channel', value: `${oldMessage.channel}\n${oldMessage.channelId}`, inline: true },
          { name: 'Message ID', value: oldMessage.id || 'Unknown', inline: true },
          { name: 'Before', value: truncate(oldMessage.content || '[content unavailable]', 1000), inline: false },
          { name: 'After', value: truncate(newMessage.content || '[content unavailable]', 1000), inline: false },
          { name: 'Jump to Message', value: newMessage.url || 'Unavailable', inline: false },
        ),
    );
  });
}

module.exports = { registerEvents };
