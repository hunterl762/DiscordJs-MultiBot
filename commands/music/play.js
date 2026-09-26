const { SlashCommandBuilder } = require('discord.js');
const {
  musicContext,
  searchMusic,
  noTracksMessage,
  existingPlayer,
  sameVoiceChannel,
  replySlash,
  replyPrefix,
} = require('../../src/music/helpers');

module.exports = {
  name: 'play',
  aliases: ['p'],
  category: 'Music',
  data: new SlashCommandBuilder().setName('play').setDescription('Play a song or add it to the queue.')
    .addStringOption((o) => o.setName('query').setDescription('Song name or URL').setRequired(true)),
  guildOnly: true,
  async executeSlash(interaction) {
    const ctx = await musicContext(interaction);
    if (ctx.error) return replySlash(interaction, ctx.error, true);
    let player = existingPlayer(ctx.manager, ctx.guild.id);
    if (player && !sameVoiceChannel(player, interaction.member)) return replySlash(interaction, 'Join the same voice channel as the bot.', true);
    await interaction.deferReply();
    if (!player) player = await ctx.manager.createPlayer({ guildId: ctx.guild.id, textId: interaction.channelId, voiceId: ctx.channel.id, volume: Number(ctx.feature.config.defaultVolume || 75) });
    else player.setTextChannel(interaction.channelId);
    const query = interaction.options.getString('query', true);
    const { result, engine, attempts } = await searchMusic(ctx.manager, query, interaction.user);
    if (!result.tracks?.length) {
      console.warn(
        `[Music] No tracks for "${query}". Attempts=${attempts.join(', ') || 'none'}; sources=${(ctx.lavalinkStatus?.sourceManagers || []).join(', ') || 'unknown'}.`,
      );
      return interaction.editReply(noTracksMessage(query));
    }
    console.log(`[Music] Search resolved with ${engine || 'unknown'}: ${result.tracks.length} track(s).`);
    if (result.type === 'PLAYLIST') player.queue.add(result.tracks); else player.queue.add(result.tracks[0]);
    if (!player.playing && !player.paused) await player.play();
    return interaction.editReply(result.type === 'PLAYLIST' ? `✅ Queued **${result.tracks.length}** tracks.` : `✅ Queued **${result.tracks[0].title}**.`);
  },
  async executePrefix(message, args) {
    const ctx = await musicContext(message);
    if (ctx.error) return replyPrefix(message, ctx.error);
    if (!args.length) return replyPrefix(message, 'Usage: !play <song name or URL>');
    let player = existingPlayer(ctx.manager, ctx.guild.id);
    if (player && !sameVoiceChannel(player, message.member)) return replyPrefix(message, 'Join the same voice channel as the bot.');
    if (!player) player = await ctx.manager.createPlayer({ guildId: ctx.guild.id, textId: message.channelId, voiceId: ctx.channel.id, volume: Number(ctx.feature.config.defaultVolume || 75) });
    else player.setTextChannel(message.channelId);
    const query = args.join(' ');
    const { result, engine, attempts } = await searchMusic(ctx.manager, query, message.author);
    if (!result.tracks?.length) {
      console.warn(
        `[Music] No tracks for "${query}". Attempts=${attempts.join(', ') || 'none'}; sources=${(ctx.lavalinkStatus?.sourceManagers || []).join(', ') || 'unknown'}.`,
      );
      return replyPrefix(message, noTracksMessage(query));
    }
    console.log(`[Music] Search resolved with ${engine || 'unknown'}: ${result.tracks.length} track(s).`);
    if (result.type === 'PLAYLIST') player.queue.add(result.tracks); else player.queue.add(result.tracks[0]);
    if (!player.playing && !player.paused) await player.play();
    return replyPrefix(message, result.type === 'PLAYLIST' ? `✅ Queued ${result.tracks.length} tracks.` : `✅ Queued **${result.tracks[0].title}**.`);
  },
};