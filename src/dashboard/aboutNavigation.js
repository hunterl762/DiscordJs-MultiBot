const express = require('express');

// Navigation branding uses a same-origin endpoint instead of WEB_ICON_URL.
// WEB_ICON_URL remains dedicated to browser/meta icon configuration, while the
// header always resolves the bot's current Discord profile picture.
const KRYNDEXA_NAV_LOGO = '/kryndexa-bot-avatar';
const KRYNDEXA_NAV_LOGO_FALLBACK = '/favicon.svg';
let cachedDiscordAvatar = '';
let cachedDiscordAvatarAt = 0;
const AVATAR_CACHE_MS = 5 * 60 * 1000;

async function resolveLiveDiscordAvatar() {
  if (cachedDiscordAvatar && Date.now() - cachedDiscordAvatarAt < AVATAR_CACHE_MS) {
    return cachedDiscordAvatar;
  }

  const token = String(process.env.DISCORD_TOKEN || '').trim();
  if (!token) return '';

  try {
    const response = await fetch('https://discord.com/api/v10/users/@me', {
      headers: { Authorization: `Bot ${token}` },
    });
    if (!response.ok) return '';

    const bot = await response.json();
    if (!bot?.id || !bot?.avatar) return '';

    const extension = String(bot.avatar).startsWith('a_') ? 'gif' : 'webp';
    cachedDiscordAvatar = `https://cdn.discordapp.com/avatars/${encodeURIComponent(bot.id)}/${encodeURIComponent(bot.avatar)}.${extension}?size=128`;
    cachedDiscordAvatarAt = Date.now();
    return cachedDiscordAvatar;
  } catch {
    return '';
  }
}

// Enable extensionless public HTML routes before dashboard/server.js creates
// its static middleware. The wrapper also provides a stable same-origin avatar
// endpoint before static-file handling, preventing browsers from caching the
// empty favicon response that can occur while the Discord client is starting.
const originalStatic = express.static;
express.static = function kryndexaStatic(root, options = {}) {
  const configured = Array.isArray(options.extensions) ? options.extensions : [];
  const extensions = [...new Set([...configured, 'html'])];
  const staticMiddleware = originalStatic(root, { ...options, extensions });

  return async function kryndexaPublicMiddleware(req, res, next) {
    const pathname = String(req.path || req.url || '').split('?')[0];
    if (pathname === KRYNDEXA_NAV_LOGO) {
      const avatar = await resolveLiveDiscordAvatar();
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=600');
      return res.redirect(302, avatar || KRYNDEXA_NAV_LOGO_FALLBACK);
    }
    return staticMiddleware(req, res, next);
  };
};

// Keep shared navigation/footer branding consistent on every HTML page emitted
// by the dashboard without duplicating markup across individual routes.
const originalSend = express.response.send;

express.response.send = function kryndexaNavigationSend(body) {
  if (typeof body === 'string' && body.includes('<!doctype html>')) {
    let html = body;

    html = html.replace(
      /<img class="brand-avatar"[^>]*>/g,
      `<img class="brand-avatar" src="${KRYNDEXA_NAV_LOGO}" alt="Kryndexa Bot" width="40" height="40" decoding="async" onerror="this.onerror=null;this.src='${KRYNDEXA_NAV_LOGO_FALLBACK}'">`,
    );

    html = html.replace(
      /<img class="about-brand-logo"[^>]*>/g,
      `<img class="about-brand-logo" src="${KRYNDEXA_NAV_LOGO}" alt="Kryndexa Bot" width="38" height="38" decoding="async" onerror="this.onerror=null;this.src='${KRYNDEXA_NAV_LOGO_FALLBACK}'">`,
    );

    if (!html.includes('href="/about">About</a>')) {
      html = html.replace(
        /(<a href="\/">Home<\/a>\s*)(<a href="\/features">Features<\/a>)/,
        '$1<a href="/about">About</a>\n    $2',
      );
    }

    if (!html.includes('class="footer-nav"><a href="/about">About</a>')) {
      html = html.replace(
        '<nav class="footer-nav"><a href="/features">Features</a>',
        '<nav class="footer-nav"><a href="/about">About</a><span aria-hidden="true">•</span><a href="/features">Features</a>',
      );
    }

    body = html;
  }

  return originalSend.call(this, body);
};

function registerAboutRoute() {}

module.exports = { registerAboutRoute };
