const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
} = require('discord.js');
const { buildConfiguredEmbed } = require('../embedRuntime');
const {
  listEnabledStreamAnnouncements,
  markStreamLiveState,
} = require('../twitchStore');
const { getFeature } = require('../features/store');

let twitchToken = null;
let twitchTokenExpiresAt = 0;
let kickToken = null;
let kickTokenExpiresAt = 0;
let timer = null;
let running = false;

function providerConfigured(platform) {
  if (platform === 'twitch') return Boolean(process.env.TWITCH_CLIENT_ID && process.env.TWITCH_CLIENT_SECRET);
  if (platform === 'youtube') return Boolean(process.env.YOUTUBE_API_KEY);
  if (platform === 'kick') return Boolean(process.env.KICK_CLIENT_ID && process.env.KICK_CLIENT_SECRET);
  return false;
}

async function getTwitchAppToken() {
  if (twitchToken && Date.now() < twitchTokenExpiresAt - 60_000) return twitchToken;
  const params = new URLSearchParams({
    client_id: process.env.TWITCH_CLIENT_ID,
    client_secret: process.env.TWITCH_CLIENT_SECRET,
    grant_type: 'client_credentials',
  });
  const response = await fetch(`https://id.twitch.tv/oauth2/token?${params.toString()}`, { method: 'POST' });
  if (!response.ok) throw new Error(`Twitch token request failed with HTTP ${response.status}`);
  const body = await response.json();
  twitchToken = body.access_token;
  twitchTokenExpiresAt = Date.now() + Number(body.expires_in || 0) * 1000;
  return twitchToken;
}

async function getKickAppToken() {
  if (kickToken && Date.now() < kickTokenExpiresAt - 60_000) return kickToken;
  const params = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: process.env.KICK_CLIENT_ID,
    client_secret: process.env.KICK_CLIENT_SECRET,
  });
  const response = await fetch('https://id.kick.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });
  if (!response.ok) throw new Error(`Kick token request failed with HTTP ${response.status}`);
  const body = await response.json();
  kickToken = body.access_token;
  kickTokenExpiresAt = Date.now() + Number(body.expires_in || 0) * 1000;
  return kickToken;
}

async function twitchLive(identifier, retryAuth = true) {
  const token = await getTwitchAppToken();
  const params = new URLSearchParams({ user_login: identifier });
  const response = await fetch(`https://api.twitch.tv/helix/streams?${params.toString()}`, {
    headers: { 'Client-Id': process.env.TWITCH_CLIENT_ID, Authorization: `Bearer ${token}` },
  });
  if (response.status === 401 && retryAuth) {
    twitchToken = null;
    twitchTokenExpiresAt = 0;
    return twitchLive(identifier, false);
  }
  if (!response.ok) throw new Error(`Twitch streams request failed with HTTP ${response.status}`);
  const stream = (await response.json()).data?.[0];
  if (!stream) return { supported: true, live: false, platform: 'twitch' };
  return {
    supported: true, live: true, platform: 'twitch', liveId: String(stream.id),
    title: stream.title || 'Live now', user: stream.user_name || identifier,
    game: stream.game_name || 'Unknown', viewers: Number(stream.viewer_count || 0),
    startedAt: stream.started_at || new Date().toISOString(),
    image: stream.thumbnail_url ? stream.thumbnail_url.replace('{width}', '1280').replace('{height}', '720') + `?t=${Date.now()}` : '',
    url: `https://www.twitch.tv/${stream.user_login || identifier}`,
  };
}

async function youtubeLive(channelId) {
  const params = new URLSearchParams({
    part: 'snippet', channelId, eventType: 'live', type: 'video', maxResults: '1', key: process.env.YOUTUBE_API_KEY,
  });
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params.toString()}`);
  if (!response.ok) throw new Error(`YouTube live search failed with HTTP ${response.status}`);
  const item = (await response.json()).items?.[0];
  const videoId = item?.id?.videoId;
  if (!videoId) return { supported: true, live: false, platform: 'youtube' };
  const snippet = item.snippet || {};
  return {
    supported: true, live: true, platform: 'youtube', liveId: videoId,
    title: snippet.title || 'Live now', user: snippet.channelTitle || channelId,
    game: 'YouTube Live', viewers: null,
    startedAt: snippet.publishedAt || new Date().toISOString(),
    image: snippet.thumbnails?.high?.url || snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url || '',
    url: `https://www.youtube.com/watch?v=${videoId}`,
  };
}

async function resolveKickBroadcasterId(identifier, token) {
  if (/^\d+$/.test(identifier)) return identifier;
  const params = new URLSearchParams({ slug: identifier });
  const response = await fetch(`https://api.kick.com/public/v1/channels?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Kick channel lookup failed with HTTP ${response.status}`);
  return String((await response.json()).data?.[0]?.broadcaster_user_id || '') || null;
}

async function kickLive(identifier) {
  const token = await getKickAppToken();
  const broadcasterId = await resolveKickBroadcasterId(identifier, token);
  if (!broadcasterId) return { supported: true, live: false, platform: 'kick' };
  const params = new URLSearchParams();
  params.append('broadcaster_user_id', broadcasterId);
  const response = await fetch(`https://api.kick.com/public/v2/livestreams?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) throw new Error(`Kick livestream request failed with HTTP ${response.status}`);
  const stream = (await response.json()).data?.[0];
  if (!stream) return { supported: true, live: false, platform: 'kick' };
  const slug = stream.slug || stream.channel?.slug || stream.broadcaster?.channel_slug || (/^\d+$/.test(identifier) ? '' : identifier);
  return {
    supported: true, live: true, platform: 'kick',
    liveId: String(stream.id || stream.channel_id || stream.broadcaster_user_id || stream.started_at || Date.now()),
    title: stream.stream_title || stream.title || stream.metadata?.title || 'Live now',
    user: stream.broadcaster?.username || stream.username || stream.channel?.slug || slug || identifier,
    game: stream.category?.name || stream.metadata?.category?.name || 'Kick Live',
    viewers: Number(stream.viewer_count ?? stream.viewers ?? 0),
    startedAt: stream.started_at || stream.start_time || new Date().toISOString(),
    image: stream.thumbnail || stream.thumbnail_url || stream.profile_picture || stream.category?.thumbnail || '',
    url: slug ? `https://kick.com/${slug}` : 'https://kick.com/',
  };
}

async function checkProvider(watcher) {
  if (!providerConfigured(watcher.platform)) return { supported: false, live: false, platform: watcher.platform };
  if (watcher.platform === 'twitch') return twitchLive(watcher.streamerIdentifier);
  if (watcher.platform === 'youtube') return youtubeLive(watcher.streamerIdentifier);
  if (watcher.platform === 'kick') return kickLive(watcher.streamerIdentifier);
  return { supported: false, live: false, platform: watcher.platform };
}

function canSend(channel) {
  const permissions = channel?.permissionsFor?.(channel.guild.members.me);
  return Boolean(channel?.isTextBased?.() && permissions?.has(PermissionFlagsBits.ViewChannel) && permissions.has(PermissionFlagsBits.SendMessages));
}

async function reconcileLiveRole(client, watcher, live) {
  if (!watcher.discordUserId || !watcher.liveRoleId) return Boolean(watcher.roleGrantedByBot);
  const guild = client.guilds.cache.get(watcher.guildId);
  if (!guild) return Boolean(watcher.roleGrantedByBot);
  const [member, role] = await Promise.all([
    guild.members.fetch(watcher.discordUserId).catch(() => null),
    guild.roles.fetch(watcher.liveRoleId).catch(() => null),
  ]);
  if (!member || !role || !role.editable) return Boolean(watcher.roleGrantedByBot);

  if (live) {
    if (member.roles.cache.has(role.id)) return Boolean(watcher.roleGrantedByBot);
    try { await member.roles.add(role, `${watcher.platform} streamer is live`); return true; }
    catch { return Boolean(watcher.roleGrantedByBot); }
  }
  if (!watcher.roleGrantedByBot || !member.roles.cache.has(role.id)) return false;
  try { await member.roles.remove(role, `${watcher.platform} streamer is offline`); return false; }
  catch { return true; }
}

function platformMeta(platform) {
  if (platform === 'youtube') return { label: 'YouTube', emoji: '🔴', embedKey: 'youtube_live' };
  if (platform === 'kick') return { label: 'Kick', emoji: '🟢', embedKey: 'kick_live' };
  return { label: 'Twitch', emoji: '🟣', embedKey: 'twitch_live' };
}

async function announcementPayload(stream, watcher) {
  const meta = platformMeta(stream.platform);
  const startedUnix = Math.floor(new Date(stream.startedAt || Date.now()).getTime() / 1000);
  const embed = await buildConfiguredEmbed(watcher.guildId, meta.embedKey, {
    user: stream.user || watcher.streamerIdentifier,
    title: stream.title || 'Live now',
    game: stream.game || meta.label,
    viewers: stream.viewers == null ? 'Unavailable' : String(stream.viewers),
    started: `<t:${startedUnix}:R>`,
    url: stream.url || '',
    platform: meta.label,
  }, { url: stream.url, timestamp: new Date(stream.startedAt || Date.now()) });

  if (watcher.customMessage) {
    embed.setDescription(watcher.customMessage
      .replaceAll('{user}', stream.user || watcher.streamerIdentifier)
      .replaceAll('{game}', stream.game || meta.label)
      .replaceAll('{title}', stream.title || 'Live now')
      .replaceAll('{url}', stream.url || '')
      .replaceAll('{platform}', meta.label)
      .slice(0, 4000));
  }
  if (stream.image) embed.setImage(stream.image);

  return {
    embeds: [embed],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setLabel(`Watch on ${meta.label}`).setEmoji(meta.emoji).setStyle(ButtonStyle.Link).setURL(stream.url),
    )],
    allowedMentions: { parse: [] },
  };
}

async function checkStreamingAnnouncements(client) {
  if (running) return;
  running = true;
  try {
    const watchers = await listEnabledStreamAnnouncements();
    for (const watcher of watchers) {
      try {
        const feature = await getFeature(watcher.guildId, 'stream_alerts');
        if (feature?.enabled === false) {
          const roleGrantedByBot = await reconcileLiveRole(client, watcher, false);
          if (watcher.isLive || roleGrantedByBot !== watcher.roleGrantedByBot) {
            await markStreamLiveState(watcher.id, { isLive: false, roleGrantedByBot });
          }
          continue;
        }

        const stream = await checkProvider(watcher);
        if (!stream.supported) continue;
        if (!stream.live) {
          const roleGrantedByBot = await reconcileLiveRole(client, watcher, false);
          if (watcher.isLive || roleGrantedByBot !== watcher.roleGrantedByBot) {
            await markStreamLiveState(watcher.id, { isLive: false, roleGrantedByBot });
          }
          continue;
        }

        const roleGrantedByBot = await reconcileLiveRole(client, watcher, true);
        if (watcher.isLive && watcher.lastStreamId === stream.liveId) {
          if (roleGrantedByBot !== watcher.roleGrantedByBot) {
            await markStreamLiveState(watcher.id, { isLive: true, streamId: stream.liveId, startedAt: stream.startedAt, roleGrantedByBot });
          }
          continue;
        }

        const guild = client.guilds.cache.get(watcher.guildId);
        const channel = guild?.channels.cache.get(watcher.discordChannelId);
        if (!guild || !canSend(channel)) {
          await markStreamLiveState(watcher.id, { isLive: true, streamId: watcher.lastStreamId, startedAt: stream.startedAt, roleGrantedByBot });
          continue;
        }

        await channel.send(await announcementPayload(stream, watcher));
        await markStreamLiveState(watcher.id, { isLive: true, streamId: stream.liveId, startedAt: stream.startedAt, announced: true, roleGrantedByBot });
      } catch (error) {
        console.warn(`[StreamAlert] ${watcher.platform} ${watcher.streamerIdentifier}: ${error.message || error}`);
      }
    }
  } finally {
    running = false;
  }
}

function startTwitchMonitor(client) {
  const intervalMs = Math.max(60_000, Number(process.env.STREAM_ALERT_CHECK_INTERVAL_MS || process.env.TWITCH_CHECK_INTERVAL_MS || 120_000));
  checkStreamingAnnouncements(client).catch(console.error);
  timer = setInterval(() => checkStreamingAnnouncements(client).catch(console.error), intervalMs);
  timer.unref?.();
  console.log(`[StreamAlert] Twitch/YouTube/Kick monitor started every ${Math.round(intervalMs / 1000)}s.`);
}

function stopTwitchMonitor() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { startTwitchMonitor, stopTwitchMonitor, checkTwitchAnnouncements: checkStreamingAnnouncements, checkStreamingAnnouncements };
