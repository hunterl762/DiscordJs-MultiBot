const { SlashCommandBuilder } = require('discord.js');
const {
  musicContext,
  markManualStop,
  existingPlayer,
  sameVoiceChannel,
  replySlash,
  replyPrefix,
} = require('../../src/music/helpers');
module.exports={name:'stop',aliases:['leave','disconnect'],category:'Music',data:new SlashCommandBuilder().setName('stop').setDescription('Stop music and leave voice.'),guildOnly:true,
async executeSlash(i){const c=await musicContext(i);if(c.error)return replySlash(i,c.error,true);const p=existingPlayer(c.manager,c.guild.id);if(!p)return replySlash(i,'No active music player.',true);if(!sameVoiceChannel(p,i.member))return replySlash(i,'Join the same voice channel as the bot.',true);markManualStop(c.guild.id);await p.destroy();return replySlash(i,'⏹️ Stopped and disconnected.');},
async executePrefix(m){const c=await musicContext(m);if(c.error)return replyPrefix(m,c.error);const p=existingPlayer(c.manager,c.guild.id);if(!p)return replyPrefix(m,'No active music player.');if(!sameVoiceChannel(p,m.member))return replyPrefix(m,'Join the same voice channel as the bot.');markManualStop(c.guild.id);await p.destroy();return replyPrefix(m,'⏹️ Stopped and disconnected.');}};