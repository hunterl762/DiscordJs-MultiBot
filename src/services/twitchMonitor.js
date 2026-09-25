const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const {
  listEnabledTwitchAnnouncements,
  markTwitchLiveState,
} = require('../twitchStore');
const { getFeature } = require('../features/store');

let appToken = null;
let appTokenExpiresAt = 0;
let timer = null;
let running = false;

function configured() {
  return Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
}

async function getAppToken() {
  if (appToken && Date.now() < appTokenExpiresAt - 60_000) return appToken;

  const params = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    client_secret: process.env.TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });

  const response = await fetch(`https://id.twitch.tv/oauth2/token?${params.toString()}`, { method: 'POST' });
  if (!response.ok) throw new Error(`Twitch token request failed with HTTP ${response.status}`);

  const body = await response.json();
  appToken = body.access_token;
  appTokenExpiresAt = Date.now() + Number(body.expires_in || 0) * 1000;
  return appToken;
}

async function getLiveStreams(logins, retryAuth = true) {
  if (!logins.length) return new Map();

  const token = await getAppToken();
  const params = new URLSearchParams();
  for (const login of logins.slice(0, 100)) params.append('user_login', login);

  const response = await fetch(`https://api.twitch.tv/helix/streams?${params.toString()}`, {
    headers: {
      'Client-Id': process.env.TWITCH_CLIENT_ID,
      Authorization: `Bearer ${token}`,
    },
  });

  if (response.status === 401 && retryAuth) {
    appToken = null;
    appTokenExpiresAt = 0;
    return getLiveStreams(logins, false);
  }

  if (!response.ok) throw new Error(`Twitch streams request failed with HTTP ${response.status}`);

  const body = await response.json();
  return new Map((body.data || []).map((stream) => [stream.user_login.toLowerCase(), stream]));
}

function canSend(channel) {
  const me = channel?.guild?.members?.me;
  const permissions = channel?.permissionsFor?.(me);
  return Boolean(
    channel?.isTextBased?.()
    && permissions?.has(PermissionFlagsBits.ViewChannel)
    && permissions.has(PermissionFlagsBits.SendMessages),
  );
}

function announcementPayload(stream, watcher) {
  const url = `https://www.twitch.tv/${stream.user_login}`;
  const customDescription = watcher.customMessage
    ? watcher.customMessage
        .replaceAll('{user}', stream.user_name)
        .replaceAll('{game}', stream.game_name || 'Unknown')
        .replaceAll('{title}', stream.title || 'Live now')
        .replaceAll('{url}', url)
    : null;

  const image = stream.thumbnail_url
    ? stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720') + `?t=${Date.now()}`
    : null;

  const startedUnix = Math.floor(new Date(stream.started_at).getTime() / 1000);

  const embed = new EmbedBuilder()
    .setColor(0x9146ff)
    .setTitle(`🔴 ${stream.user_name} is LIVE on Twitch!`)
    .setURL(url)
    .setDescription(
      (customDescription || `**${stream.title || 'Live now'}**\n\n${stream.user_name} just went live on Twitch.`).slice(0, 4000),
    )
    .addFields(
      { name: '🎮 Game', value: stream.game_name || 'Unknown', inline: true },
      { name: '👀 Viewers', value: String(stream.viewer_count ?? 0), inline: true },
      { name: '🕒 Started', value: `<t:${startedUnix}:R>`, inline: true },
    )
    .setFooter({ text: 'Twitch Live Announcement • MultiBot' })
    .setTimestamp(new Date(stream.started_at));

  if (image) embed.setImage(image);

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setLabel('Watch on Twitch')
      .setEmoji('🟣')
      .setStyle(ButtonStyle.Link)
      .setURL(url),
  );

  return {
    embeds: [embed],
    components: [row],
    allowedMentions: { parse: [] },
  };
}

async function checkTwitchAnnouncements(client) {
  if (!configured() || running) return;
  running = true;

  try {
    const watchers = await listEnabledTwitchAnnouncements();
    if (!watchers.length) return;

    const uniqueLogins = [...new Set(watchers.map((watcher) => watcher.twitchLogin))];
    const liveByLogin = new Map();

    for (let i = 0; i < uniqueLogins.length; i += 100) {
      const chunk = uniqueLogins.slice(i, i + 100);
      const chunkStreams = await getLiveStreams(chunk);
      for (const [login, stream] of chunkStreams) liveByLogin.set(login, stream);
    }

    for (const watcher of watchers) {
      const streamFeature = await getFeature(watcher.guildId, 'stream_alerts');
      if (streamFeature?.enabled === false) continue;

      const stream = liveByLogin.get(watcher.twitchLogin);
      if (!stream) {
        if (watcher.isLive) {
          await markTwitchLiveState(watcher.id, { isLive: false, streamId: null, startedAt: null });
        }
        continue;
      }

      const isNewStream = watcher.lastStreamId !== stream.id;
      if (!isNewStream && watcher.isLive) continue;

      const guild = client.guilds.cache.get(watcher.guildId);
      const channel = guild?.channels.cache.get(watcher.discordChannelId);

      if (!guild || !canSend(channel)) {
        console.warn(`[Twitch] Cannot announce ${watcher.twitchLogin} in guild ${watcher.guildId}: channel unavailable or not sendable. Will retry on the next check.`);
        continue;
      }

      await channel.send(announcementPayload(stream, watcher));
      await markTwitchLiveState(watcher.id, {
        isLive: true,
        streamId: stream.id,
        startedAt: stream.started_at,
        announced: true,
      });
      console.log(`[Twitch] Announced ${watcher.twitchLogin} live in ${guild.name} #${channel.name}.`);
    }
  } catch (error) {
    console.error('[Twitch] Announcement check failed:', error);
  } finally {
    running = false;
  }
}

function startTwitchMonitor(client) {
  if (!configured()) {
    console.log('[Twitch] Live announcements disabled; TWITCH_CLIENT_ID/TWITCH_CLIENT_SECRET are not configured.');
    return;
  }

  const intervalMs = Math.max(60_000, Number(process.env.TWITCH_CHECK_INTERVAL_MS || 120_000));
  checkTwitchAnnouncements(client);
  timer = setInterval(() => checkTwitchAnnouncements(client), intervalMs);
  timer.unref?.();
  console.log(`[Twitch] Live announcement monitor started (every ${Math.round(intervalMs / 1000)}s).`);
}

function stopTwitchMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = {
  startTwitchMonitor,
  stopTwitchMonitor,
  checkTwitchAnnouncements,
};
