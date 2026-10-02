const express = require('express');

// Canonical Kryndexa bot avatar used by every navigation header. Keep the
// local favicon as an onerror fallback so navigation branding never breaks.
const KRYNDEXA_NAV_LOGO = 'https://cdn.discordapp.com/avatars/484028883520323604/b0fa0a4842a97b4f6ba41d1f6d5a4432.webp?size=128';
const KRYNDEXA_NAV_LOGO_FALLBACK = '/favicon.ico';

// Enable extensionless public HTML routes before dashboard/server.js creates
// its static middleware. Because public/about.html already exists, Express will
// now serve it directly at /about without exposing .html in the browser URL.
const originalStatic = express.static;
express.static = function kryndexaStatic(root, options = {}) {
  const configured = Array.isArray(options.extensions) ? options.extensions : [];
  const extensions = [...new Set([...configured, 'html'])];
  return originalStatic(root, { ...options, extensions });
};

// Keep shared navigation/footer branding consistent on every HTML page emitted
// by the dashboard without duplicating markup across individual routes.
const originalSend = express.response.send;

express.response.send = function kryndexaNavigationSend(body) {
  if (typeof body === 'string' && body.includes('<!doctype html>')) {
    let html = body;

    // Replace the shared dashboard header logo on every generated page. This
    // intentionally does not depend on WEB_ICON_URL: that setting can continue
    // controlling browser/meta icons while the navigation always shows the bot.
    html = html.replace(
      /<img class="brand-avatar"[^>]*>/g,
      `<img class="brand-avatar" src="${KRYNDEXA_NAV_LOGO}" alt="Kryndexa Bot" width="40" height="40" decoding="async" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${KRYNDEXA_NAV_LOGO_FALLBACK}'">`,
    );

    // Normalize the standalone About page header to the same logo/fallback.
    html = html.replace(
      /<img class="about-brand-logo"[^>]*>/g,
      `<img class="about-brand-logo" src="${KRYNDEXA_NAV_LOGO}" alt="Kryndexa Bot" width="38" height="38" decoding="async" referrerpolicy="no-referrer" onerror="this.onerror=null;this.src='${KRYNDEXA_NAV_LOGO_FALLBACK}'">`,
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

// Kept for startup compatibility. /about is served by Express static middleware
// with HTML extension resolution, which works before the HTTP server is returned.
function registerAboutRoute() {}

module.exports = { registerAboutRoute };
