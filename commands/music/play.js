const { SlashCommandBuilder } = require('discord.js');
const {
  musicContext,
  searchMusic,
  noTracksMessage,
  waitForManualStopCooldown,
  existingPlayer,
  sameVoiceChannel,
  replyPrefix,
} = require('../../src/music/helpers');

function configuredVolume(ctx) {
  const raw = Number(ctx?.feature?.config?.defaultVolume ?? 75);
  return Math.max(1, Math.min(200, Number.isFinite(raw) ? raw : 75));
}

module.exports = {
  name: 'play',
  aliases: ['p'],
  category: 'Music',
  data: new SlashCommandBuilder().setName('play').setDescription('Play a song or add it to the queue.')
    .addStringOption((o) => o.setName('query').setDescription('Song name or URL').setRequired(true)),
  guildOnly: true,
  async executeSlash(interaction) {
    // Discord requires the initial interaction acknowledgement within roughly
    // three seconds. Defer immediately, before database/feature/member lookups.
    await interaction.deferReply();
    const ctx = await musicContext(interaction);
    if (ctx.error) return interaction.editReply({ content: ctx.error });
    let player = existingPlayer(ctx.manager, ctx.guild.id);
    if (player && !sameVoiceChannel(player, interaction.member)) return interaction.editReply({ content: 'Join the same voice channel as the bot.' });

    const query = interaction.options.getString('query', true);
    const { result, engine, attempts } = await searchMusic(ctx.manager, query, interaction.user);
    if (!result.tracks?.length) {
      console.warn(
        `[Music] No tracks for "${query}". Attempts=${attempts.join(', ') || 'none'}; sources=${(ctx.musicStatus?.sourceManagers || []).join(', ') || 'unknown'}.`,
      );
      return interaction.editReply(noTracksMessage(query));
    }
    console.log(`[Music] Search resolved with ${engine || 'unknown'}: ${result.tracks.length} track(s).`);

    const volume = configuredVolume(ctx);
    if (!player) {
      await waitForManualStopCooldown(ctx.guild.id);
      player = await ctx.manager.createPlayer({
        guildId: ctx.guild.id,
        textId: interaction.channelId,
        voiceId: ctx.channel.id,
        volume,
      });
    } else {
      player.setTextChannel(interaction.channelId);
    }

    // Always re-apply the dashboard-configured volume before playback. This
    // covers both newly-created queues and Discord Player queues reused after
    // a reconnect, which otherwise retain Discord Player's 100% default.
    await player.setVolume(volume);

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

    const query = args.join(' ');
    const { result, engine, attempts } = await searchMusic(ctx.manager, query, message.author);
    if (!result.tracks?.length) {
      console.warn(
        `[Music] No tracks for "${query}". Attempts=${attempts.join(', ') || 'none'}; sources=${(ctx.musicStatus?.sourceManagers || []).join(', ') || 'unknown'}.`,
      );
      return replyPrefix(message, noTracksMessage(query));
    }
    console.log(`[Music] Search resolved with ${engine || 'unknown'}: ${result.tracks.length} track(s).`);

    const volume = configuredVolume(ctx);
    if (!player) {
      await waitForManualStopCooldown(ctx.guild.id);
      player = await ctx.manager.createPlayer({
        guildId: ctx.guild.id,
        textId: message.channelId,
        voiceId: ctx.channel.id,
        volume,
      });
    } else {
      player.setTextChannel(message.channelId);
    }

    // Keep prefix playback consistent with slash playback and the dashboard.
    await player.setVolume(volume);

    if (result.type === 'PLAYLIST') player.queue.add(result.tracks); else player.queue.add(result.tracks[0]);
    if (!player.playing && !player.paused) await player.play();
    return replyPrefix(message, result.type === 'PLAYLIST' ? `✅ Queued ${result.tracks.length} tracks.` : `✅ Queued **${result.tracks[0].title}**.`);
  },
};