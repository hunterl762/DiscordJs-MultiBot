const {
  AuditLogEvent,
  ChannelType,
  EmbedBuilder,
  Events,
  PermissionFlagsBits,
} = require('discord.js');
const { getFeature } = require('./store');
const { findRecentAuditEntry } = require('../bot/logging');
const { listEnabledAutomationRules } = require('./automationStore');
const {
  addMessageXp,
  addVoiceXp,
  dueReminders,
  markReminderDelivered,
} = require('./dataStore');

const spamHistory = new Map();
const raidHistory = new Map();
const raidCooldown = new Map();
const destructiveHistory = new Map();
const voiceSessions = new Map();
const inviteCache = new Map();
const tempOwners = new Map();
let reminderTimer = null;

function userKey(guildId,userId){return `${guildId}:${userId}`;}
function featureLogChannel(guild,feature){
  const id=feature?.config?.logChannelId;
  const channel=id?guild.channels.cache.get(id):null;
  return channel?.isTextBased?.()?channel:null;
}
async function logFeature(guild,feature,title,description,color=0x5865f2){
  const channel=featureLogChannel(guild,feature);
  if(!channel)return;
  await channel.send({embeds:[new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp()],allowedMentions:{parse:[]}}).catch(()=>null);
}

function automodViolation(message,feature){
  if(message.member?.permissions.has(PermissionFlagsBits.ManageMessages))return null;
  const exempt=feature.config.exemptRoleId;
  if(exempt&&message.member?.roles.cache.has(exempt))return null;
  const content=message.content||'';
  if(feature.config.blockInvites&&/(discord\.gg\/|discord(?:app)?\.com\/invite\/)/i.test(content))return 'Discord invite links are blocked.';
  if(feature.config.blockLinks&&/https?:\/\/\S+/i.test(content))return 'External links are blocked.';
  const mentions=message.mentions.users.size+message.mentions.roles.size;
  if(mentions>=Number(feature.config.massMentionLimit||5))return `Mass mentions are limited to ${Number(feature.config.massMentionLimit||5)-1}.`;
  const words=String(feature.config.badWords||'').split(',').map(v=>v.trim().toLowerCase()).filter(Boolean);
  const lower=content.toLowerCase();
  if(words.some(word=>lower.includes(word)))return 'That message contains a blocked word or phrase.';
  const key=userKey(message.guildId,message.author.id),now=Date.now(),windowMs=Number(feature.config.spamWindowSeconds||10)*1000;
  const arr=(spamHistory.get(key)||[]).filter(ts=>now-ts<windowMs);arr.push(now);spamHistory.set(key,arr);
  if(arr.length>=Number(feature.config.spamMessageLimit||6))return 'Spam protection triggered.';
  return null;
}

function automationText(template, context) {
  return String(template || '')
    .replaceAll('{user}', context.user ? `<@${context.user.id}>` : 'user')
    .replaceAll('{username}', context.user?.username || 'user')
    .replaceAll('{server}', context.guild?.name || 'server')
    .replaceAll('{channel}', context.channel ? `<#${context.channel.id}>` : 'channel');
}

async function runAutomationRules(guild, triggerType, context) {
  const feature = await getFeature(guild.id, 'custom_automations');
  if (!feature?.enabled) return;

  const rules = await listEnabledAutomationRules(guild.id, triggerType);

  for (const rule of rules) {
    if (triggerType === 'message_contains') {
      const needle = String(rule.trigger_value || '').toLowerCase();
      if (!needle || !String(context.message?.content || '').toLowerCase().includes(needle)) continue;
    }

    try {
      if (rule.action_type === 'send_message') {
        const channel = guild.channels.cache.get(rule.action_channel_id) || context.channel;
        if (channel?.isTextBased()) {
          await channel.send({
            content: automationText(rule.action_message || 'Automation triggered for {user}.', context),
            allowedMentions: { users: context.user ? [context.user.id] : [], parse: [] },
          });
        }
      } else if (rule.action_type === 'dm_user' && context.user) {
        await context.user.send(automationText(rule.action_message || 'Automation triggered in {server}.', context)).catch(() => null);
      } else if (rule.action_type === 'add_role' && context.member) {
        const role = guild.roles.cache.get(rule.action_role_id);
        if (role?.editable) await context.member.roles.add(role, `MultiBot automation: ${rule.name}`);
      }
    } catch (error) {
      console.error(`[Automation] Rule ${rule.id} failed:`, error);
    }
  }
}

async function handleAutomod(message){
  if(!message.guild||message.author.bot)return;
  const feature=await getFeature(message.guildId,'automod');
  if(!feature?.enabled)return;
  const violation=automodViolation(message,feature);
  if(!violation)return;
  await message.delete().catch(()=>null);
  const notice=await message.channel.send({content:`<@${message.author.id}> ${violation}`,allowedMentions:{users:[message.author.id],parse:[]}}).catch(()=>null);
  if(notice)setTimeout(()=>notice.delete().catch(()=>null),5000).unref?.();
  await logFeature(message.guild,feature,'🛡️ AutoMod Action',`**User:** ${message.author.tag} (${message.author.id})\n**Channel:** <#${message.channelId}>\n**Reason:** ${violation}\n**Content:** ${String(message.content||'[empty]').slice(0,1200)}`,0xed4245);
}

async function handleLevelingMessage(message){
  if(!message.guild||message.author.bot)return;
  const feature=await getFeature(message.guildId,'leveling');
  if(!feature?.enabled)return;
  const amount=Math.max(1,Math.round(Number(feature.config.messageXp||15)*Number(feature.config.multiplier||1)));
  await addMessageXp(message.guildId,message.author.id,amount,Number(feature.config.cooldownSeconds||60));
}

async function cacheGuildInvites(guild){
  try{const invites=await guild.invites.fetch();inviteCache.set(guild.id,new Map(invites.map(i=>[i.code,i.uses||0])));}catch{}
}

async function handleInviteJoin(member){
  const feature=await getFeature(member.guild.id,'invite_tracking');
  if(!feature?.enabled)return cacheGuildInvites(member.guild);
  try{
    const before=inviteCache.get(member.guild.id)||new Map(),invites=await member.guild.invites.fetch();
    const used=[...invites.values()].find(i=>(i.uses||0)>(before.get(i.code)||0));
    inviteCache.set(member.guild.id,new Map(invites.map(i=>[i.code,i.uses||0])));
    const ch=member.guild.channels.cache.get(feature.config.logChannelId);
    if(ch?.isTextBased())await ch.send({embeds:[new EmbedBuilder().setColor(0x57f287).setTitle('🔗 Invite Tracked').addFields(
      {name:'Member',value:`${member.user.tag}\n${member.id}`,inline:true},
      {name:'Invite',value:used?`${used.code} • ${used.uses||0} use(s)`:'Unknown / vanity / unavailable',inline:true},
      {name:'Inviter',value:used?.inviter?`${used.inviter.tag}\n${used.inviter.id}`:'Unknown',inline:true},
    ).setTimestamp()]});
  }catch{}
}

async function handleWelcomeFeature(member){
  const feature=await getFeature(member.guild.id,'welcome');
  if(!feature?.enabled||member.user.bot)return;
  const roleId=feature.config.autoroleId;
  if(roleId){
    const role=member.guild.roles.cache.get(roleId);
    if(role?.editable)await member.roles.add(role,'MultiBot welcome autorole').catch(()=>null);
  }
  if(feature.config.dmWelcome){
    const msg=String(feature.config.dmMessage||'Welcome to {server}, {user}!')
      .replaceAll('{server}',member.guild.name).replaceAll('{user}',member.user.username);
    await member.send(msg).catch(()=>null);
  }
}

async function triggerRaidLockdown(guild,feature,reason){
  const last=raidCooldown.get(guild.id)||0;
  if(Date.now()-last<5*60*1000)return;
  raidCooldown.set(guild.id,Date.now());
  let locked=0;
  for(const channel of guild.channels.cache.values()){
    if(channel.type!==ChannelType.GuildText)continue;
    try{await channel.permissionOverwrites.edit(guild.roles.everyone,{SendMessages:false},{reason:`MultiBot anti-raid: ${reason}`});locked++;}catch{}
  }
  await logFeature(guild,feature,'🚨 Anti-Raid Lockdown',`${reason}\nLocked **${locked}** text channel(s). Use **/lockdown action:Unlock** after reviewing the raid.`,0xed4245);
}

async function handleDestructiveAction(guild, auditType, targetId, label) {
  const feature = await getFeature(guild.id, 'anti_raid');
  if (!feature?.enabled) return;

  const audit = await findRecentAuditEntry(guild, auditType, targetId, 12_000);
  const executor = audit?.executor;
  if (!executor || executor.id === guild.client.user.id || executor.id === guild.ownerId) return;

  const key = `${guild.id}:${executor.id}`;
  const now = Date.now();
  const windowMs = Number(feature.config.destructiveWindowSeconds || 15) * 1000;
  const events = (destructiveHistory.get(key) || []).filter((item) => now - item < windowMs);
  events.push(now);
  destructiveHistory.set(key, events);

  await logFeature(
    guild,
    feature,
    '⚠️ Anti-Nuke Activity',
    `**Executor:** ${executor.tag} (${executor.id})\n**Action:** ${label}\n**Recent destructive actions:** ${events.length}\n**Reason:** ${audit?.reason || 'No audit-log reason'}`,
    0xfee75c,
  );

  if (events.length >= Number(feature.config.destructiveThreshold || 4)) {
    await triggerRaidLockdown(
      guild,
      feature,
      `${executor.tag} triggered ${events.length} destructive actions within ${feature.config.destructiveWindowSeconds || 15} seconds.`,
    );
  }
}

async function handleAntiRaid(member){
  const feature=await getFeature(member.guild.id,'anti_raid');
  if(!feature?.enabled)return;
  const now=Date.now(),windowMs=Number(feature.config.windowSeconds||20)*1000;
  const joins=(raidHistory.get(member.guild.id)||[]).filter(ts=>now-ts<windowMs);joins.push(now);raidHistory.set(member.guild.id,joins);
  const ageDays=(now-member.user.createdTimestamp)/86400000;
  if(ageDays<Number(feature.config.minAccountAgeDays||3)){
    await logFeature(member.guild,feature,'⚠️ Suspicious New Account',`**User:** ${member.user.tag} (${member.id})\n**Account age:** ${ageDays.toFixed(2)} day(s)`,0xfee75c);
  }
  if(joins.length>=Number(feature.config.joinThreshold||10)){
    await triggerRaidLockdown(member.guild,feature,`${joins.length} joins detected within ${feature.config.windowSeconds||20} seconds.`);
  }
}

async function handleVoiceState(oldState,newState){
  const guild=newState.guild||oldState.guild,userId=newState.id||oldState.id,key=userKey(guild.id,userId);
  if(!oldState.channelId&&newState.channelId)voiceSessions.set(key,Date.now());
  if(oldState.channelId&&!newState.channelId){
    const started=voiceSessions.get(key);voiceSessions.delete(key);
    if(started){
      const minutes=Math.max(1,Math.floor((Date.now()-started)/60000));
      const leveling=await getFeature(guild.id,'leveling');
      if(leveling?.enabled&&Number(leveling.config.voiceXpPerMinute||0)>0)await addVoiceXp(guild.id,userId,minutes,minutes*Number(leveling.config.voiceXpPerMinute||5)*Number(leveling.config.multiplier||1));
    }
  }

  const feature=await getFeature(guild.id,'temp_voice');
  if(!feature?.enabled)return;
  if(newState.channelId&&newState.channelId===feature.config.lobbyChannelId){
    try{
      const channel=await guild.channels.create({
        name:`${newState.member?.displayName||'Temporary'}'s Room`.slice(0,90),
        type:ChannelType.GuildVoice,
        parent:feature.config.categoryId||newState.channel?.parentId||undefined,
        permissionOverwrites:[
          {id:guild.roles.everyone.id,allow:[PermissionFlagsBits.Connect]},
          {id:userId,allow:[PermissionFlagsBits.Connect,PermissionFlagsBits.MoveMembers,PermissionFlagsBits.ManageChannels]},
        ],
        reason:'MultiBot temporary voice room',
      });
      tempOwners.set(channel.id,userId);
      await newState.setChannel(channel,'Created temporary voice room');
    }catch(e){console.error('[TempVoice] create failed:',e);}
  }
  if(oldState.channelId&&tempOwners.has(oldState.channelId)){
    const oldChannel=guild.channels.cache.get(oldState.channelId);
    if(oldChannel&&oldChannel.members.size===0){tempOwners.delete(oldState.channelId);await oldChannel.delete('Empty temporary voice room').catch(()=>null);}
  }
}

async function handleStarboard(reaction,user){
  if(user.bot)return;
  if(reaction.partial)try{await reaction.fetch();}catch{return;}
  const message=reaction.message;if(!message.guild||reaction.emoji.name!=='⭐')return;
  const feature=await getFeature(message.guild.id,'starboard');if(!feature?.enabled)return;
  if(reaction.count<Number(feature.config.threshold||5))return;
  const ch=message.guild.channels.cache.get(feature.config.channelId);if(!ch?.isTextBased())return;
  const marker=`starboard:${message.id}`;
  const recent=await ch.messages.fetch({limit:50}).catch(()=>null);
  if(recent?.some(m=>m.embeds?.[0]?.footer?.text===marker))return;
  const embed=new EmbedBuilder().setColor(0xffd700).setAuthor({name:message.author?.tag||'Unknown',iconURL:message.author?.displayAvatarURL?.()}).setDescription(message.content||'[no text]').addFields({name:'Original',value:`[Jump to message](${message.url})`}).setFooter({text:marker}).setTimestamp(message.createdAt);
  const image=message.attachments?.find(a=>a.contentType?.startsWith('image/'));if(image)embed.setImage(image.url);
  await ch.send({content:`⭐ **${reaction.count}** • <#${message.channelId}>`,embeds:[embed],allowedMentions:{parse:[]}});
}

async function deliverReminders(client){
  for(const row of await dueReminders(100)){
    const guild=client.guilds.cache.get(row.guild_id),channel=guild?.channels.cache.get(row.channel_id),user=await client.users.fetch(row.user_id).catch(()=>null);
    const text=`⏰ <@${row.user_id}> reminder: ${row.message}`;
    let delivered=false;
    if(channel?.isTextBased())delivered=Boolean(await channel.send({content:text,allowedMentions:{users:[row.user_id],parse:[]}}).catch(()=>null));
    if(!delivered&&user)delivered=Boolean(await user.send(`⏰ Reminder: ${row.message}`).catch(()=>null));
    if(delivered)await markReminderDelivered(row.id);
  }
}

function registerFeatureRuntime(client){
  client.on(Events.ClientReady,async()=>{for(const guild of client.guilds.cache.values())await cacheGuildInvites(guild);});
  client.on(Events.MessageCreate,async(message)=>{try{await handleAutomod(message);if(message.deleted)return;await handleLevelingMessage(message);if(!message.author.bot&&message.guild)await runAutomationRules(message.guild,'message_contains',{guild:message.guild,user:message.author,member:message.member,channel:message.channel,message});}catch(e){console.error('[FeatureRuntime] message:',e);}});
  client.on(Events.GuildMemberAdd,async(member)=>{try{await Promise.all([handleWelcomeFeature(member),handleAntiRaid(member),handleInviteJoin(member),runAutomationRules(member.guild,'member_join',{guild:member.guild,user:member.user,member,channel:null})]);}catch(e){console.error('[FeatureRuntime] member:',e);}});
  client.on(Events.ChannelDelete,(channel)=>channel.guild&&handleDestructiveAction(channel.guild,AuditLogEvent.ChannelDelete,channel.id,`Channel deleted: #${channel.name}`).catch(e=>console.error('[AntiNuke] channel:',e)));
  client.on(Events.RoleDelete,(role)=>handleDestructiveAction(role.guild,AuditLogEvent.RoleDelete,role.id,`Role deleted: ${role.name}`).catch(e=>console.error('[AntiNuke] role:',e)));
  client.on(Events.GuildBanAdd,(ban)=>handleDestructiveAction(ban.guild,AuditLogEvent.MemberBanAdd,ban.user.id,`Member banned: ${ban.user.tag}`).catch(e=>console.error('[AntiNuke] ban:',e)));
  client.on(Events.VoiceStateUpdate,(a,b)=>handleVoiceState(a,b).catch(e=>console.error('[FeatureRuntime] voice:',e)));
  client.on(Events.MessageReactionAdd,(r,u)=>handleStarboard(r,u).catch(e=>console.error('[FeatureRuntime] starboard:',e)));
  reminderTimer=setInterval(()=>deliverReminders(client).catch(e=>console.error('[Reminders]',e)),30000);reminderTimer.unref?.();
}
function stopFeatureRuntime(){if(reminderTimer)clearInterval(reminderTimer);reminderTimer=null;}

module.exports={registerFeatureRuntime,stopFeatureRuntime};
