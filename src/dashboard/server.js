const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const express = require('express');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
  getGuildSettings,
  saveGuildSettings,
  listGuildTickets,
  getTicket,
  getTicketByPublicToken,
  updateTicket,
} = require('../store');
const { getPool, pingDatabase } = require('../database');
const {
  listStreamAnnouncements,
  upsertStreamAnnouncement,
  deleteStreamAnnouncement,
} = require('../twitchStore');
const {
  DEFAULT_TICKET_TYPES,
  listTicketTypes,
  saveTicketType,
} = require('../ticketTypeStore');
const { postTicketPanel } = require('../tickets/ticketService');
const { escapeHtml } = require('../utils/html');
const { commandCatalog } = require('../bot/commandRegistry');
const { getCommandStateObject, setCommandEnabled } = require('../commandSettingsStore');
const { getGuildFeatures, saveFeature } = require('../features/store');
const { FEATURE_CATALOG, getFeatureDefinition, isFeatureEnvironmentEnabled } = require('../features/catalog');
const { listAutomationRules, createAutomationRule, deleteAutomationRule } = require('../features/automationStore');
const { EncryptedSessionStore, migrateLegacySessionRows } = require('../encryptedSessionStore');
const { PROVIDERS, listAiCredentials, saveAiCredential, deleteAiCredential } = require('../aiCredentialStore');
const { EMBED_MODULES, listEmbedConfigs, saveEmbedConfig } = require('../embedConfigStore');
const {
  FREE_STREAMER_LIMIT,
  PAID_STREAMER_LIMIT,
  getStreamAlertAccess,
  listPaidStreamAlertAccess,
  setStreamAlertPaidAccess,
} = require('../streamAccessStore');
const { getAnalytics } = require('../features/dataStore');
const {
  isBotOwner,
  broadcastToGuilds,
  formatBroadcastSummary,
} = require('../bot/broadcast');

const DISCORD_API = 'https://discord.com/api/v10';
const GUILD_CACHE_TTL_MS = 60_000;
const DASHBOARD_OAUTH_STATE_VERSION = 2;
const guildListRequests = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publicBaseUrl() {
  const configured = String(process.env.BASE_URL || '').trim();

  if (configured) {
    try {
      const url = new URL(configured);
      url.pathname = '/';
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/$/, '');
    } catch {
      // Fall through to production/local defaults.
    }
  }

  if (process.env.NODE_ENV === 'production') return 'https://kryndexabot.xyz';

  const port = Number(process.env.PORT || 3000);
  return `http://localhost:${port}`;
}

function absoluteWebUrl(pathname = '/') {
  const base = publicBaseUrl();
  try {
    return new URL(pathname || '/', `${base}/`).toString();
  } catch {
    return `${base}/`;
  }
}

function metaDescriptionForTitle(title) {
  const value = String(title || '').toLowerCase();

  if (value.includes('features')) {
    return 'Explore Kryndexa Bot features for moderation, tickets, logging, music, automations, streaming alerts, analytics and Discord server management.';
  }
  if (value.includes('privacy')) {
    return 'Read the Kryndexa Bot privacy policy and learn how Discord data, dashboard sessions, tickets and essential cookies are handled.';
  }
  if (value.includes('terms')) {
    return 'Read the Kryndexa Bot Terms of Service for the Discord bot, dashboard, commands, tickets, integrations and related services.';
  }
  if (value.includes('statistics')) {
    return 'View Kryndexa Bot server statistics, members, channels, roles, tickets and command activity from the web dashboard.';
  }
  if (value.includes('dashboard') || value.includes('settings')) {
    return 'Manage your Discord servers with the Kryndexa Bot dashboard, including settings, features, tickets, commands, integrations and analytics.';
  }

  return 'Kryndexa Bot is a Discord.js v14 command center for moderation, tickets, logging, music, streaming alerts, automations, analytics and server configuration.';
}

function pageMeta(title, meta = {}) {
  const description = String(meta.description || metaDescriptionForTitle(title)).trim();
  const canonical = absoluteWebUrl(meta.path || '/');
  const image = String(
    meta.image
      || process.env.WEB_META_IMAGE_URL
      || absoluteWebUrl('/favicon.ico'),
  ).trim();
  const robots = String(meta.robots || (meta.private ? 'noindex,nofollow,noarchive' : 'index,follow')).trim();
  const fullTitle = String(title || 'Kryndexa Bot').trim();

  return {
    description,
    canonical,
    image,
    robots,
    title: fullTitle,
  };
}

function parseCookies(req) {
  const cookies = {};
  const header = String(req.headers.cookie || '');

  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    const value = part.slice(index + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }

  return cookies;
}

function cookieSecureForRequest(req) {
  if (req?.secure) return true;

  const forwardedProto = String(req?.get?.('x-forwarded-proto') || '')
    .split(',')[0]
    .trim()
    .toLowerCase();

  return forwardedProto === 'https';
}

function configuredWebIconUrl() {
  const raw = String(process.env.WEB_ICON_URL || '').trim();
  if (!raw || raw === '/favicon.ico') return '';

  if (/^https?:\/\//i.test(raw) || raw.startsWith('/')) {
    return raw;
  }

  return `/${raw.replace(/^\.?\//, '')}`;
}

function renderAddBotButton() {
  const clientId = String(process.env.DISCORD_CLIENT_ID || '').trim();
  if (!clientId) return '';

  const installUrl = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&permissions=8&scope=bot%20applications.commands`;
  return `<a class="btn add-bot-button" href="${escapeHtml(installUrl)}" target="_blank" rel="noreferrer">＋ Add Bot to Server</a>`;
}

function page(title, body, user, meta = {}) {
  const seo = pageMeta(title, meta);
  const auth = user
    ? `<div class="user"><span>${escapeHtml(user.username)}</span><a class="btn secondary compact" href="/logout">Log out</a></div>`
    : '<a class="btn compact" href="/login">Login with Discord</a>';

  const addBotButton = renderAddBotButton();
  const webIcon = configuredWebIconUrl() || '/favicon.ico';

  const cookieNotice = `<div id="cookieNotice" class="cookie-notice" role="dialog" aria-live="polite" aria-label="Cookie consent">
    <div class="cookie-copy">
      <strong id="cookieTitle">Essential dashboard cookies</strong>
      <p id="cookieText">Kryndexa uses only the essential cookies needed for Discord sign-in, session security, and CSRF protection. No advertising or tracking cookies are used.</p>
    </div>
    <div class="cookie-actions">
      <a class="btn secondary" href="/privacy#cookies">Cookie details</a>
      <button id="cookieDecline" class="btn secondary" type="button">Decline</button>
      <button id="cookieAccept" class="btn" type="button">Accept essential cookies</button>
    </div>
  </div>`;

  return `<!doctype html><html lang="en" data-theme="dark"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(seo.title)}</title>
<meta name="description" content="${escapeHtml(seo.description)}">
<meta name="robots" content="${escapeHtml(seo.robots)}">
<meta name="application-name" content="Kryndexa Bot">
<meta name="apple-mobile-web-app-title" content="Kryndexa Bot">
<meta name="theme-color" content="#5865f2">
<link rel="canonical" href="${escapeHtml(seo.canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Kryndexa Bot">
<meta property="og:title" content="${escapeHtml(seo.title)}">
<meta property="og:description" content="${escapeHtml(seo.description)}">
<meta property="og:url" content="${escapeHtml(seo.canonical)}">
<meta property="og:image" content="${escapeHtml(seo.image)}">
<meta property="og:image:alt" content="Kryndexa Bot Discord server control center">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escapeHtml(seo.title)}">
<meta name="twitter:description" content="${escapeHtml(seo.description)}">
<meta name="twitter:image" content="${escapeHtml(seo.image)}">
<meta name="color-scheme" content="dark light">
<script>(()=>{try{const saved=localStorage.getItem('multibot-theme');const preferred=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=saved||preferred;}catch{}})();</script>
<link rel="icon" href="${escapeHtml(webIcon)}"><link rel="shortcut icon" href="${escapeHtml(webIcon)}"><link rel="apple-touch-icon" href="${escapeHtml(webIcon)}"><link rel="stylesheet" href="/style.css?v=20260926-unified-stream-panel">
</head><body>
<header class="site-header"><div class="header-inner">
  <a class="brand" href="/"><img class="brand-avatar" src="${escapeHtml(webIcon)}" alt="" aria-hidden="true"><span>Kryndexa Bot</span></a>
  <button class="nav-toggle" type="button" data-site-nav-toggle aria-label="Toggle navigation">☰</button>
  <nav class="site-nav" data-site-nav aria-label="Primary navigation">
    <a href="/">Home</a><a href="/features">Features</a>
    ${user ? `<a href="/dashboard">Dashboard</a><a href="/dashboard/statistics">Server Statistics</a>${user.isBotOwner ? '<a href="/dashboard/owner">Bot Owners</a>' : ''}` : ''}
    <a href="/privacy">Privacy</a><a href="/terms">Terms</a>
  </nav>
  <div class="header-actions">${addBotButton}<button class="theme-toggle" type="button" data-theme-toggle aria-label="Toggle color theme"><span data-theme-icon>◐</span></button><div class="header-auth">${auth}</div></div>
</div></header>
<main>${body}</main>
<div id="dashboardToast" class="dashboard-toast" role="status" aria-live="polite"></div>
<footer><div class="footer-inner"><div class="footer-brand-block"><strong>Kryndexa Bot</strong><span>One Bot. Every Tool. Total Control.</span></div><nav class="footer-nav"><a href="/features">Features</a><span aria-hidden="true">•</span><a href="/privacy">Privacy</a><span aria-hidden="true">•</span><a href="/terms">Terms</a></nav></div></footer>
${cookieNotice}
<script>(() => {
  const root=document.documentElement;
  const themeButton=document.querySelector('[data-theme-toggle]');
  const themeIcon=document.querySelector('[data-theme-icon]');
  const refreshTheme=()=>{const dark=root.dataset.theme==='dark';if(themeIcon)themeIcon.textContent=dark?'☀':'☾';};
  themeButton?.addEventListener('click',()=>{const next=root.dataset.theme==='dark'?'light':'dark';root.dataset.theme=next;localStorage.setItem('multibot-theme',next);refreshTheme();});
  refreshTheme();

  const nav=document.querySelector('[data-site-nav]');
  document.querySelector('[data-site-nav-toggle]')?.addEventListener('click',()=>nav?.classList.toggle('open'));

  const notice=document.getElementById('cookieNotice');
  const cookieText=document.getElementById('cookieText');
  const getConsent=()=>{const match=document.cookie.match(/(?:^|; )multibot_cookie_consent=([^;]+)/);return match?decodeURIComponent(match[1]):'';};
  const showCookieNotice=()=>{notice?.classList.add('is-visible');notice?.classList.remove('is-hidden');};
  const hideCookieNotice=()=>{notice?.classList.remove('is-visible');notice?.classList.add('is-hidden');};
  const refreshConsent=()=>{
    const loginNeedsConsent=new URLSearchParams(location.search).get('cookie')==='required';
    const consent=getConsent();
    if(loginNeedsConsent||!['essential','declined'].includes(consent))showCookieNotice();
    else hideCookieNotice();
  };
  let continueToLogin=new URLSearchParams(location.search).get('continue')==='login';
  const setConsent=async(choice)=>{
    const accept=document.getElementById('cookieAccept');
    const decline=document.getElementById('cookieDecline');
    if(accept)accept.disabled=true;if(decline)decline.disabled=true;
    try{
      const r=await fetch('/cookie-consent/'+choice,{method:'POST',credentials:'same-origin',headers:{'Accept':'application/json'}});
      if(!r.ok)throw new Error('HTTP '+r.status);
      hideCookieNotice();
      if(choice==='accept'&&continueToLogin)location.assign('/login');
    }catch(error){
      if(cookieText)cookieText.textContent='Unable to save your cookie preference. Please try again.';
      showCookieNotice();
    }finally{
      if(accept)accept.disabled=false;if(decline)decline.disabled=false;
    }
  };
  document.getElementById('cookieAccept')?.addEventListener('click',()=>setConsent('accept'));
  document.getElementById('cookieDecline')?.addEventListener('click',()=>{continueToLogin=false;setConsent('decline');});
  document.querySelectorAll('a[href="/login"]').forEach(link=>link.addEventListener('click',event=>{
    if(getConsent()==='essential')return;
    event.preventDefault();
    continueToLogin=true;
    showCookieNotice();
  }));

  const toast=document.getElementById('dashboardToast');let toastTimer;
  const showToast=(message,kind='success')=>{if(!toast)return;toast.textContent=message;toast.className='dashboard-toast is-visible '+kind;clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.className='dashboard-toast',2300);};

  document.querySelectorAll('[data-autosave-url]').forEach(input=>{
    input.addEventListener('change',async()=>{
      const previous=!input.checked;input.disabled=true;
      const card=input.closest('.feature-card,.command-card,.ticket-module-card,.suggestions-panel');
      card?.classList.add('autosaving');
      try{
        const body=new URLSearchParams({_csrf:input.dataset.csrf||'',enabled:input.checked?'1':'0',...(input.dataset.setting?{setting:input.dataset.setting}:{})});
        const response=await fetch(input.dataset.autosaveUrl,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
        if(!response.ok)throw new Error(await response.text());
        card?.classList.toggle('feature-enabled',input.checked);card?.classList.toggle('enabled',input.checked);card?.classList.toggle('disabled',!input.checked);
        showToast('Saved automatically');
      }catch(error){input.checked=previous;showToast('Unable to save: '+(error.message||error),'error');}
      finally{input.disabled=false;card?.classList.remove('autosaving');}
    });
  });

  document.querySelectorAll('input[type="search"][data-filter-selector]').forEach(input=>{
    const apply=()=>{const q=input.value.trim().toLowerCase();const selector=input.dataset.filterSelector;const attr=input.dataset.filterAttribute;let visible=0;if(!selector||!attr)return;
      document.querySelectorAll(selector).forEach(item=>{const match=!q||String(item.getAttribute(attr)||'').toLowerCase().includes(q);item.hidden=!match;if(match)visible++;});
      const empty=input.dataset.filterEmpty?document.querySelector(input.dataset.filterEmpty):null;if(empty)empty.hidden=visible!==0;};
    input.addEventListener('input',apply);input.addEventListener('search',apply);apply();
  });

  document.querySelectorAll('[data-stream-platform]').forEach(select=>{
    const form=select.closest('form');const input=form?.querySelector('[data-stream-identifier]');const help=form?.querySelector('[data-stream-help]');
    const update=()=>{
      const provider=select.value||'twitch';
      if(input&&help){
        if(provider==='youtube'){input.placeholder='UCxxxxxxxxxxxxxxxxxxxxxx';help.textContent='Use the YouTube channel ID.';}
        else if(provider==='kick'){input.placeholder='Broadcaster ID or channel slug';help.textContent='Use a Kick broadcaster ID or channel slug.';}
        else{input.placeholder='Twitch username';help.textContent='Twitch username without @.';}
      }
      document.querySelectorAll('[data-stream-embed-panel]').forEach(panel=>{panel.hidden=panel.dataset.streamEmbedPanel!==provider;});
      const heading=document.querySelector('[data-stream-embed-heading]');
      if(heading)heading.textContent=provider==='youtube'?'YouTube':provider==='kick'?'Kick':'Twitch';
    };
    select.addEventListener('change',update);update();
  });

  document.querySelectorAll('[data-embed-editor]').forEach(editor=>{
    const preview=editor.querySelector('[data-embed-preview]');if(!preview)return;
    const update=()=>{const val=(sel)=>editor.querySelector(sel)?.value||'';preview.style.setProperty('--embed-color',val('[data-embed-color]')||'#5865F2');
      const previewTitle=preview.querySelector('[data-preview-title]');const titleValue=val('[data-embed-title]')||'Embed title';const titleUrl=val('[data-embed-title-url]').trim();
      previewTitle.textContent=titleValue;
      if(previewTitle.tagName==='A'){if(/^https?:\/\//i.test(titleUrl)){previewTitle.href=titleUrl;previewTitle.classList.add('has-link');}else{previewTitle.removeAttribute('href');previewTitle.classList.remove('has-link');}}
      preview.querySelector('[data-preview-description]').textContent=val('[data-embed-description]')||'Embed description';
      preview.querySelector('[data-preview-footer]').textContent=val('[data-embed-footer]');
      const fields=preview.querySelector('[data-preview-fields]');fields.innerHTML='';
      if(editor.querySelector('[data-embed-fields-enabled]')?.checked){editor.querySelectorAll('.embed-field-row').forEach(row=>{const n=row.querySelector('[data-field-name]')?.value.trim();const v=row.querySelector('[data-field-value]')?.value.trim();if(!n||!v)return;const div=document.createElement('div');div.className='embed-preview-field'+(row.querySelector('[data-field-inline]')?.checked?' inline':'');div.innerHTML='<strong></strong><span></span>';div.querySelector('strong').textContent=n;div.querySelector('span').textContent=v;fields.append(div);});}
    };
    editor.querySelectorAll('input,textarea,select').forEach(el=>{el.addEventListener('input',update);el.addEventListener('change',update);});update();
  });

  refreshConsent();
})();</script>
</body></html>`;
}

function renderPolicyInline(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

function renderPrivacyPolicy(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const html = [];
  let paragraph = [];
  let sectionOpen = false;

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const joined = paragraph.join(' ').trim();

    if (/^https:\/\//i.test(joined)) {
      const safeUrl = escapeHtml(joined);
      html.push(`<p><a href="${safeUrl}" target="_blank" rel="noreferrer">${safeUrl}</a></p>`);
    } else {
      html.push(`<p>${renderPolicyInline(joined)}</p>`);
    }

    paragraph = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      continue;
    }

    if (line.startsWith('# ')) {
      flushParagraph();
      continue;
    }

    if (line.startsWith('## ')) {
      flushParagraph();
      if (sectionOpen) html.push('</section>');

      const heading = line.slice(3).trim();
      const id = heading.toLowerCase().includes('cookie')
        ? 'cookies'
        : heading.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

      html.push(`<section class="privacy-section" id="${escapeHtml(id)}"><h2>${escapeHtml(heading)}</h2>`);
      sectionOpen = true;
      continue;
    }

    paragraph.push(line);
  }

  flushParagraph();
  if (sectionOpen) html.push('</section>');

  return html.join('\n');
}

function resolveOAuthRedirectUri(req) {
  const configured = String(process.env.DISCORD_REDIRECT_URI || '').trim();
  if (configured) return configured;

  const baseUrl = String(process.env.BASE_URL || '').trim();
  if (baseUrl) {
    try {
      return new URL('/auth/callback', baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).toString();
    } catch {
      // Fall through to the current request URL.
    }
  }

  const protocol = req.protocol || 'http';
  const host = req.get('host');
  return `${protocol}://${host}/auth/callback`;
}

function oauthUrl(state, redirectUri) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

function oauthStateKey() {
  const secret = String(process.env.SESSION_SECRET || '').trim();
  if (!secret) throw new Error('SESSION_SECRET is required for Discord OAuth state signing.');
  return secret;
}

function createOAuthState(redirectUri) {
  const payload = Buffer.from(JSON.stringify({
    version: DASHBOARD_OAUTH_STATE_VERSION,
    nonce: crypto.randomBytes(24).toString('hex'),
    issuedAt: Date.now(),
    redirectUri,
  }), 'utf8').toString('base64url');

  const signature = crypto
    .createHmac('sha256', oauthStateKey())
    .update(payload)
    .digest('base64url');

  return `${payload}.${signature}`;
}

function verifyOAuthState(state) {
  const [payload, signature, extra] = String(state || '').split('.');
  if (!payload || !signature || extra !== undefined) {
    throw new Error('OAuth state token is malformed.');
  }

  const expected = crypto
    .createHmac('sha256', oauthStateKey())
    .update(payload)
    .digest();

  let supplied;
  try {
    supplied = Buffer.from(signature, 'base64url');
  } catch {
    throw new Error('OAuth state signature is malformed.');
  }

  if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
    throw new Error('OAuth state signature is invalid.');
  }

  let decoded;
  try {
    decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
  } catch {
    throw new Error('OAuth state payload is invalid.');
  }

  if (Number(decoded?.version) !== DASHBOARD_OAUTH_STATE_VERSION) {
    throw new Error('This login link was created by an older dashboard version. Start a new Discord login.');
  }

  const issuedAt = Number(decoded?.issuedAt || 0);
  if (!issuedAt || Date.now() - issuedAt > 10 * 60 * 1000 || issuedAt > Date.now() + 60_000) {
    throw new Error('OAuth state token has expired.');
  }

  const redirectUri = String(decoded?.redirectUri || '').trim();
  if (!/^https?:\/\//i.test(redirectUri)) {
    throw new Error('OAuth state redirect URI is invalid.');
  }

  return { redirectUri };
}

function saveSession(req) {
  return new Promise((resolve, reject) => {
    req.session.save((error) => error ? reject(error) : resolve());
  });
}

function regenerateSession(req) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((error) => error ? reject(error) : resolve());
  });
}

async function discordFetch(pathname, accessToken, { maxRetries = 3 } = {}) {
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    const response = await fetch(`${DISCORD_API}${pathname}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (response.status === 429) {
      let retryAfterMs = 1000;
      try {
        const body = await response.json();
        if (Number.isFinite(Number(body.retry_after))) retryAfterMs = Math.ceil(Number(body.retry_after) * 1000);
      } catch {
        const retryAfter = Number(response.headers.get('retry-after'));
        if (Number.isFinite(retryAfter) && retryAfter > 0) retryAfterMs = Math.ceil(retryAfter * 1000);
      }

      if (attempt >= maxRetries) {
        const error = new Error(`Discord API 429 after ${maxRetries + 1} attempts`);
        error.status = 429;
        error.retryAfterMs = retryAfterMs;
        throw error;
      }

      await sleep(Math.min(retryAfterMs + 250, 30_000));
      continue;
    }

    if (!response.ok) {
      const error = new Error(`Discord API ${response.status}`);
      error.status = response.status;
      throw error;
    }

    return response.json();
  }

  throw new Error('Discord API request failed unexpectedly.');
}

function canManageGuild(guild) {
  const permissions = BigInt(guild.permissions || '0');
  return guild.owner || (permissions & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator || (permissions & PermissionFlagsBits.ManageGuild) === PermissionFlagsBits.ManageGuild;
}

async function getManagedGuilds(req, client) {
  if (!req.session.accessToken) return [];

  const now = Date.now();
  const cached = req.session.guildCache;
  let guilds;

  if (cached?.fetchedAt && Array.isArray(cached.guilds) && now - cached.fetchedAt < GUILD_CACHE_TTL_MS) {
    guilds = cached.guilds;
  } else {
    const cacheKey = req.session.user?.id || req.session.accessToken;
    let request = guildListRequests.get(cacheKey);
    if (!request) {
      request = discordFetch('/users/@me/guilds', req.session.accessToken)
        .finally(() => guildListRequests.delete(cacheKey));
      guildListRequests.set(cacheKey, request);
    }
    guilds = await request;
    req.session.guildCache = { fetchedAt: now, guilds };
  }

  return guilds.filter((g) => canManageGuild(g) && client.guilds.cache.has(g.id));
}

function requireAuth(req, res, next) {
  if (!req.session.user) return res.redirect('/login');
  next();
}

function verifyCsrf(req, res, next) {
  if (!req.body?._csrf || req.body._csrf !== req.session.csrf) return res.status(403).send('Invalid CSRF token');
  next();
}

function selectOptions(items, current, emptyLabel = 'Not configured') {
  return `<option value="">${escapeHtml(emptyLabel)}</option>${items.map((item) => `<option value="${item.id}" ${item.id === current ? 'selected' : ''}>${escapeHtml(item.name)}</option>`).join('')}`;
}

function featureFieldHtml(field, value, resources) {
  const safeValue = value == null ? '' : value;

  if (field.type === 'boolean') {
    return `<label class="feature-check"><input type="checkbox" name="cfg_${escapeHtml(field.key)}" ${safeValue ? 'checked' : ''}> ${escapeHtml(field.label)}</label>`;
  }

  if (field.type === 'channel') {
    const channels = field.channelKind === 'voice' ? resources.voiceChannels : resources.channels;
    return `<label>${escapeHtml(field.label)}<select name="cfg_${escapeHtml(field.key)}">${selectOptions(channels, String(safeValue), 'Not configured')}</select></label>`;
  }

  if (field.type === 'category') {
    return `<label>${escapeHtml(field.label)}<select name="cfg_${escapeHtml(field.key)}">${selectOptions(resources.categories, String(safeValue), 'Not configured')}</select></label>`;
  }

  if (field.type === 'role') {
    return `<label>${escapeHtml(field.label)}<select name="cfg_${escapeHtml(field.key)}">${selectOptions(resources.roles, String(safeValue), 'Not configured')}</select></label>`;
  }

  if (field.type === 'number') {
    return `<label>${escapeHtml(field.label)}<input type="number" name="cfg_${escapeHtml(field.key)}" value="${escapeHtml(String(safeValue))}" ${field.min != null ? `min="${field.min}"` : ''} ${field.max != null ? `max="${field.max}"` : ''}></label>`;
  }

  return `<label>${escapeHtml(field.label)}<input type="text" name="cfg_${escapeHtml(field.key)}" value="${escapeHtml(String(safeValue))}"></label>`;
}

function streamPlatformMeta(platform, identifier = '') {
  const value = String(identifier || '').trim();

  if (platform === 'youtube') {
    return {
      label: 'YouTube',
      short: 'YT',
      css: 'youtube',
      embedKey: 'youtube_live',
      url: value ? `https://www.youtube.com/channel/${encodeURIComponent(value)}` : 'https://www.youtube.com/',
    };
  }

  if (platform === 'kick') {
    return {
      label: 'Kick',
      short: 'K',
      css: 'kick',
      embedKey: 'kick_live',
      url: value ? `https://kick.com/${encodeURIComponent(value)}` : 'https://kick.com/',
    };
  }

  return {
    label: 'Twitch',
    short: 'T',
    css: 'twitch',
    embedKey: 'twitch_live',
    url: value ? `https://www.twitch.tv/${encodeURIComponent(value)}` : 'https://www.twitch.tv/',
  };
}

function renderStreamEmbedEditor(guildId, config, csrf) {
  const fields = [...(config.fields || [])];
  while (fields.length < 5) fields.push({ name: '', value: '', inline: false });

  const rows = fields.slice(0, 5).map((field, index) => `
    <div class="embed-field-row">
      <input name="fieldName_${index}" data-field-name maxlength="256" value="${escapeHtml(field.name || '')}" placeholder="Field name">
      <input name="fieldValue_${index}" data-field-value maxlength="1024" value="${escapeHtml(field.value || '')}" placeholder="Field value">
      <label><input type="checkbox" name="fieldInline_${index}" data-field-inline ${field.inline ? 'checked' : ''}> Inline</label>
    </div>`
  ).join('');

  const meta = streamPlatformMeta(config.key.replace('_live', ''));

  return `<form class="stream-embed-editor" data-embed-editor method="post" action="/dashboard/${guildId}/streams/embed/${encodeURIComponent(config.key)}">
    <input type="hidden" name="_csrf" value="${escapeHtml(csrf)}">
    <div class="stream-embed-editor-head">
      <div>
        <span class="eyebrow">${escapeHtml(meta.label.toUpperCase())} EMBED</span>
        <h3>${escapeHtml(config.label)}</h3>
      </div>
      <span class="provider-chip ${meta.css}">${escapeHtml(meta.label)}</span>
    </div>
    <div class="embed-editor-layout">
      <div class="embed-editor-controls">
        <label>Title
          <input name="title" data-embed-title maxlength="256" value="${escapeHtml(config.title)}">
        </label>
        <label>Description
          <textarea name="description" data-embed-description maxlength="4000" rows="4">${escapeHtml(config.description)}</textarea>
        </label>
        <div class="form-grid">
          <label>Color
            <input name="color" data-embed-color maxlength="7" value="${escapeHtml(config.color)}" placeholder="#5865F2">
          </label>
          <label>Footer
            <input name="footer" data-embed-footer maxlength="2048" value="${escapeHtml(config.footer)}">
          </label>
        </div>
        <div class="form-grid">
          <label>Image URL
            <input name="imageUrl" maxlength="1000" value="${escapeHtml(config.imageUrl || '')}" placeholder="https://...">
          </label>
          <label>Thumbnail URL
            <input name="thumbnailUrl" maxlength="1000" value="${escapeHtml(config.thumbnailUrl || '')}" placeholder="https://...">
          </label>
        </div>
        <label class="feature-check"><input type="checkbox" name="fieldsEnabled" data-embed-fields-enabled ${config.fieldsEnabled ? 'checked' : ''}> Show custom embed fields</label>
        <div class="embed-fields-editor">${rows}</div>
        <div class="token-row"><span>{user}</span><span>{title}</span><span>{game}</span><span>{viewers}</span><span>{started}</span><span>{url}</span><span>{platform}</span></div>
        <button class="btn" type="submit">Save ${escapeHtml(meta.label)} Embed</button>
      </div>
      <div class="embed-preview-card" data-embed-preview style="--embed-color:${escapeHtml(config.color)}">
        <div class="embed-preview-bar"></div>
        <div class="embed-preview-body">
          <strong data-preview-title>${escapeHtml(config.title)}</strong>
          <p data-preview-description>${escapeHtml(config.description)}</p>
          <div class="embed-preview-fields" data-preview-fields></div>
          <small data-preview-footer>${escapeHtml(config.footer)}</small>
        </div>
      </div>
    </div>
  </form>`;
}

function startDashboard(client) {
  console.log(`[Dashboard OAuth] Signed OAuth state v${DASHBOARD_OAUTH_STATE_VERSION} enabled.`);
  const addBotButton = renderAddBotButton();
  const app = express();
  app.disable('x-powered-by');

  if (process.env.NODE_ENV === 'production') {
    app.set('trust proxy', 1);
  }

  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.static(path.join(process.cwd(), 'public')));
  const MySQLStore = MySQLStoreFactory(session);
  const mysqlSessionStore = new MySQLStore({
    createDatabaseTable: false,
    schema: {
      tableName: 'web_sessions',
      columnNames: {
        session_id: 'session_id',
        expires: 'expires',
        data: 'data',
      },
    },
  }, getPool());
  const sessionStore = new EncryptedSessionStore(mysqlSessionStore);

  migrateLegacySessionRows(getPool())
    .then((count) => {
      if (count) console.log(`Encrypted ${count} legacy dashboard session row(s).`);
    })
    .catch((error) => console.error('Unable to migrate legacy dashboard sessions:', error));

  if (typeof mysqlSessionStore.onReady === 'function') {
    mysqlSessionStore.onReady()
      .then(() => console.log('Encrypted MySQL dashboard session store ready.'))
      .catch((error) => console.error('MySQL dashboard session store failed:', error));
  } else {
    console.log('Encrypted MySQL dashboard session store initialized.');
  }

  app.use(session({
    name: 'multibot.sid',
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 7 * 24 * 60 * 60 * 1000 },
  }));

  app.get('/favicon.ico', (_req, res) => {
    const configuredIcon = configuredWebIconUrl();
    if (configuredIcon) return res.redirect(302, configuredIcon);

    if (!client.user) return res.status(204).end();
    return res.redirect(302, client.user.displayAvatarURL({ extension: 'png', size: 128 }));
  });

  app.get('/', (req, res) => {
    const body = `<section class="landing-hero">
      <div class="hero-copy">
        <span class="pill">Discord.js v14 • Kryndexa Bot</span>
        <h1>Your Discord server, under control.</h1>
        <p class="hero-slogan"><strong>One Bot. Every Tool. Total Control. The Command Center for Your Discord Server.</strong></p>
        <p class="hero-detail">Moderation, tickets, logging, streaming alerts, music, automation, analytics, embeds and server configuration from one responsive dashboard.</p>
        <div class="actions">${req.session.user ? '<a class="btn" href="/dashboard">Open Dashboard</a>' : '<a class="btn" href="/login">Login with Discord</a>'} ${addBotButton}</div>
      </div>
      <aside class="hero-console" aria-label="Kryndexa Bot feature categories">
        <div class="hero-console-heading">
          <span class="hero-console-label">COMMAND CENTER</span>
          <strong class="hero-console-title">Kryndexa Bot</strong>
        </div>
        <div class="hero-console-grid">
          <span class="hero-category"><b>🎫</b> Advanced Tickets</span>
          <span class="hero-category"><b>📊</b> Server Analytics</span>
          <span class="hero-category"><b>📡</b> Streaming Alerts</span>
          <span class="hero-category"><b>🛡️</b> AutoMod</span>
          <span class="hero-category"><b>🎵</b> Music</span>
          <span class="hero-category"><b>🔐</b> Encrypted Settings</span>
        </div>
      </aside>
    </section>`;
    res.send(page('Kryndexa Bot', body, req.session.user, {
      path: '/',
      description: 'Kryndexa Bot is your Discord server command center for moderation, advanced tickets, logging, music, streaming alerts, automations, analytics and server configuration.',
    }));
  });

  app.get('/features', (req, res) => {
    const categoryOrder = [...new Set(FEATURE_CATALOG.map((feature) => feature.category))];
    const cards = categoryOrder.map((category) => {
      const features = FEATURE_CATALOG.filter((feature) => feature.category === category);
      return `<section class="public-feature-section"><div class="category-heading"><h2>${escapeHtml(category)}</h2><span>${features.length} module${features.length === 1 ? '' : 's'}</span></div><div class="public-feature-grid">${features.map((feature) => `<article class="public-feature-card"><div class="public-feature-top"><div class="feature-icon">${escapeHtml(feature.icon)}</div><div><span class="mini-label">${escapeHtml(feature.priority)} priority</span><h3>${escapeHtml(feature.title)}</h3></div></div><p>${escapeHtml(feature.description)}</p><div class="public-feature-meta"><span>${feature.locked ? 'Always enabled' : feature.defaultEnabled ? 'Enabled by default' : 'Server configurable'}</span><small>${escapeHtml(feature.requirement || 'Configured directly from the server dashboard.')}</small></div></article>`).join('')}</div></section>`;
    }).join('');

    const body = `<section class="features-hero"><span class="eyebrow">FEATURES</span><h1>One dashboard for every server tool.</h1><p>Explore Kryndexa Bot's moderation, community, support, analytics, voice, automation and integration modules.</p><div class="actions">${req.session.user ? '<a class="btn" href="/dashboard">Configure Your Servers</a>' : '<a class="btn" href="/login">Login to Dashboard</a>'} ${addBotButton}</div></section><section class="public-feature-summary"><div><strong>${FEATURE_CATALOG.length}</strong><span>Feature Modules</span></div><div><strong>44+</strong><span>Commands</span></div><div><strong>3</strong><span>Streaming Providers</span></div><div><strong>24/7</strong><span>Control Center</span></div></section>${cards}`;
    return res.send(page('Features • Kryndexa Bot', body, req.session.user, {
      path: '/features',
      description: 'Explore Kryndexa Bot modules for moderation, tickets, logging, verification, music, automations, streaming alerts, analytics and Discord community management.',
    }));
  });

  app.get('/privacy', (req, res) => {
    const policyPath = path.join(process.cwd(), 'PRIVACY_POLICY.md');
    const policy = fs.existsSync(policyPath)
      ? fs.readFileSync(policyPath, 'utf8')
      : 'MultiBot Privacy Policy is unavailable.';

    const body = `<div class="privacy-page">
      <div class="privacy-hero">
        <a href="/">← Back to MultiBot</a>
        <span class="eyebrow">LEGAL & PRIVACY</span>
        <h1>Privacy Policy</h1>
        <p>How MultiBot handles Discord data, dashboard sessions, tickets, Twitch configuration, and essential cookies.</p>
        <div class="privacy-updated">Effective September 25, 2026</div>
      </div>
      <aside class="privacy-summary panel">
        <strong>At a glance</strong>
        <div class="privacy-summary-grid">
          <span>No sale of personal information</span>
          <span>No advertising cookies</span>
          <span>No AI training on message content</span>
          <span>Essential dashboard session cookie only</span>
        </div>
      </aside>
      <article class="privacy-content panel">${renderPrivacyPolicy(policy)}</article>
      <div class="legal-crosslink panel">
        <strong>Terms of Service</strong>
        <p>Review the rules and conditions that apply when using MultiBot and its dashboard.</p>
        <a class="btn secondary" href="/terms">View Terms of Service</a>
      </div>
    </div>`;

    res.send(page('Privacy Policy • Kryndexa Bot', body, req.session.user, {
      path: '/privacy',
      description: 'Kryndexa Bot privacy policy covering Discord data, dashboard sessions, tickets, integrations and essential cookies.',
    }));
  });

  app.get('/terms', (req, res) => {
    const termsPath = path.join(process.cwd(), 'TERMS_OF_SERVICE.md');
    const terms = fs.existsSync(termsPath)
      ? fs.readFileSync(termsPath, 'utf8')
      : 'MultiBot Terms of Service are unavailable.';

    const body = `<div class="privacy-page">
      <div class="privacy-hero">
        <a href="/">← Back to MultiBot</a>
        <span class="eyebrow">LEGAL & TERMS</span>
        <h1>Terms of Service</h1>
        <p>The rules and conditions for using MultiBot, its Discord commands, dashboard, tickets, Twitch integration, and related services.</p>
        <div class="privacy-updated">Effective September 25, 2026</div>
      </div>
      <aside class="privacy-summary panel">
        <strong>Important points</strong>
        <div class="privacy-summary-grid">
          <span>Follow Discord and applicable platform rules</span>
          <span>Server admins control enabled bot features</span>
          <span>Moderation decisions remain with server staff</span>
          <span>Service availability is not guaranteed</span>
        </div>
      </aside>
      <article class="privacy-content panel">${renderPrivacyPolicy(terms)}</article>
      <div class="legal-crosslink panel">
        <strong>Privacy matters too</strong>
        <p>Review how MultiBot handles data, sessions, tickets, Twitch configuration, and cookies.</p>
        <a class="btn secondary" href="/privacy">View Privacy Policy</a>
      </div>
    </div>`;

    res.send(page('Terms of Service • Kryndexa Bot', body, req.session.user, {
      path: '/terms',
      description: 'Kryndexa Bot Terms of Service covering the Discord bot, dashboard, commands, tickets, integrations and service usage.',
    }));
  });

  app.post('/cookie-consent/accept', (req, res) => {
    res.cookie('multibot_cookie_consent', 'essential', {
      httpOnly: false,
      sameSite: 'lax',
      secure: cookieSecureForRequest(req),
      path: '/',
      maxAge: 365 * 24 * 60 * 60 * 1000,
    });
    return res.status(204).end();
  });

  app.post('/cookie-consent/decline', (req, res) => {
    const secure = cookieSecureForRequest(req);
    const finish = () => {
      res.clearCookie('multibot.sid', {
        httpOnly: true,
        sameSite: 'lax',
        secure,
        path: '/',
      });
      res.cookie('multibot_cookie_consent', 'declined', {
        httpOnly: false,
        sameSite: 'lax',
        secure,
        path: '/',
        maxAge: 365 * 24 * 60 * 60 * 1000,
      });
      return res.status(204).end();
    };

    if (req.session) return req.session.destroy(() => finish());
    return finish();
  });

  app.get('/login', async (req, res) => {
    try {
      const consent = parseCookies(req).multibot_cookie_consent;
      if (consent !== 'essential') return res.redirect('/?cookie=required&continue=login');

      const redirectUri = resolveOAuthRedirectUri(req);
      const state = createOAuthState(redirectUri);

      // Remove legacy session-bound OAuth metadata from older dashboard builds.
      // Signed state v2 does not depend on these fields.
      delete req.session.oauthState;
      delete req.session.oauthRedirectUri;
      delete req.session.oauthStartedAt;

      // OAuth state is signed and self-contained. It no longer depends on the
      // pre-login MySQL session surviving the round trip through Discord.
      return res.redirect(oauthUrl(state, redirectUri));
    } catch (error) {
      console.error('[Dashboard OAuth] Unable to start Discord login:', error);
      return res.status(500).send(page(
        'Discord login error',
        `<div class="empty"><strong>Unable to start Discord login.</strong><p>${escapeHtml(error.message || String(error))}</p><p><a class="btn" href="/">Return Home</a></p></div>`,
        req.session.user,
      ));
    }
  });

  app.get('/auth/callback', async (req, res) => {
    try {
      if (req.query.error) {
        const description = String(req.query.error_description || req.query.error || 'Discord authorization was cancelled.');
        console.warn('[Dashboard OAuth] Discord returned an authorization error:', description);
        return res.status(400).send(page(
          'Discord login cancelled',
          `<div class="empty"><strong>Discord login was not completed.</strong><p>${escapeHtml(description)}</p><p><a class="btn" href="/login">Try Again</a></p></div>`,
          req.session.user,
        ));
      }

      if (!req.query.code || !req.query.state) {
        return res.status(400).send(page(
          'Discord login expired',
          '<div class="empty"><strong>Discord did not return a complete login response.</strong><p>Please start the login again.</p><p><a class="btn" href="/login">Try Discord Login Again</a></p></div>',
          req.session.user,
        ));
      }

      let verifiedState;
      try {
        verifiedState = verifyOAuthState(req.query.state);
      } catch (stateError) {
        console.warn('[Dashboard OAuth] Signed state validation failed:', stateError.message);
        return res.status(400).send(page(
          'Discord login expired',
          `<div class="empty"><strong>Your Discord login request could not be verified.</strong><p>${escapeHtml(stateError.message)}</p><p>Please start a fresh login attempt.</p><p><a class="btn" href="/login">Try Discord Login Again</a></p></div>`,
          req.session.user,
        ));
      }

      const redirectUri = verifiedState.redirectUri;
      const body = new URLSearchParams({
        client_id: String(process.env.DISCORD_CLIENT_ID || '').trim(),
        client_secret: String(process.env.DISCORD_CLIENT_SECRET || '').trim(),
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri: redirectUri,
      });

      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      if (!tokenRes.ok) {
        let detail = '';
        try {
          const payload = await tokenRes.json();
          detail = payload?.error_description || payload?.error || payload?.message || '';
        } catch {
          detail = await tokenRes.text().catch(() => '');
        }

        const message = [
          `Discord OAuth token exchange failed with HTTP ${tokenRes.status}.`,
          detail ? `Discord: ${detail}` : '',
          `Redirect URI used: ${redirectUri}`,
          'Make sure this exact URI is listed under OAuth2 > Redirects in the Discord Developer Portal and that DISCORD_CLIENT_ID / DISCORD_CLIENT_SECRET belong to the same bot application.',
        ].filter(Boolean).join(' ');

        throw new Error(message);
      }

      const token = await tokenRes.json();
      if (!token.access_token) throw new Error('Discord OAuth returned no access token.');

      const user = await discordFetch('/users/@me', token.access_token);
      if (!user?.id) throw new Error('Discord did not return a valid user profile.');

      const ownerAccess = await isBotOwner(client, user.id);

      // Regenerate the session after authentication to prevent session fixation.
      await regenerateSession(req);
      req.session.user = {
        id: user.id,
        username: user.global_name || user.username,
        avatar: user.avatar,
        isBotOwner: ownerAccess,
      };
      req.session.accessToken = token.access_token;
      req.session.csrf = crypto.randomBytes(24).toString('hex');
      req.session.guildCache = null;
      req.session.authenticatedAt = Date.now();

      // Persist authentication before redirecting to /dashboard. Without this,
      // MySQL-backed sessions can race the redirect and appear logged out.
      await saveSession(req);

      console.log(`[Dashboard OAuth] Logged in Discord user ${req.session.user.username} (${user.id}).`);
      return res.redirect('/dashboard');
    } catch (error) {
      console.error('[Dashboard OAuth] Discord login failed:', error);
      return res.status(500).send(page(
        'Discord login failed',
        `<div class="empty"><strong>Discord login failed.</strong><p>${escapeHtml(error.message || String(error))}</p><p><a class="btn" href="/login">Try Again</a> <a class="btn secondary" href="/">Return Home</a></p></div>`,
        req.session.user,
      ));
    }
  });

  app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

  app.get('/dashboard', requireAuth, async (req, res) => {
    try {
      const managedGuilds = await getManagedGuilds(req, client);
      req.session.user.isBotOwner = await isBotOwner(client, req.session.user.id);

      // The Your Servers overview must reflect only the signed-in user's dashboard access.
      // Deduplicate Discord's guild list by ID before calculating any totals.
      const accessibleGuilds = [...new Map(
        managedGuilds.map((guild) => [String(guild.id), guild]),
      ).values()];

      const dashboardStats = await Promise.all(accessibleGuilds.map(async (managed) => {
        const guild = client.guilds.cache.get(managed.id);
        if (!guild) {
          return {
            id: managed.id,
            name: managed.name,
            icon: managed.icon || null,
            members: 0,
            channels: 0,
            roles: 0,
            openTickets: 0,
            commandUses: 0,
          };
        }

        const [ticketsResult, analyticsResult] = await Promise.allSettled([
          listGuildTickets(guild.id),
          getAnalytics(guild.id),
        ]);

        const tickets = ticketsResult.status === 'fulfilled' ? ticketsResult.value : [];
        const analytics = analyticsResult.status === 'fulfilled'
          ? analyticsResult.value
          : { uses: 0 };

        if (ticketsResult.status === 'rejected') {
          console.warn(
            `[Dashboard] Ticket total unavailable for ${guild.name} (${guild.id}): ${ticketsResult.reason?.message || ticketsResult.reason}`,
          );
        }

        if (analyticsResult.status === 'rejected') {
          console.warn(
            `[Dashboard] Command usage unavailable for ${guild.name} (${guild.id}): ${analyticsResult.reason?.message || analyticsResult.reason}`,
          );
        }

        return {
          id: managed.id,
          name: managed.name,
          icon: managed.icon || guild.icon || null,
          members: Number(guild.memberCount || 0),
          channels: guild.channels.cache.size,
          roles: Math.max(0, guild.roles.cache.size - 1),
          openTickets: tickets.filter((ticket) => ticket.status === 'open').length,
          commandUses: Number(analytics.uses || 0),
        };
      }));

      const rows = dashboardStats;
      const totals = rows.reduce((sum, item) => ({
        servers: sum.servers + 1,
        members: sum.members + item.members,
        channels: sum.channels + item.channels,
        roles: sum.roles + item.roles,
        openTickets: sum.openTickets + item.openTickets,
        commandUses: sum.commandUses + item.commandUses,
      }), {
        servers: 0,
        members: 0,
        channels: 0,
        roles: 0,
        openTickets: 0,
        commandUses: 0,
      });

      const rowById = new Map(rows.map((item) => [item.id, item]));
      const cards = accessibleGuilds.length ? accessibleGuilds.map((managed) => {
        const stats = rowById.get(managed.id);
        const icon = managed.icon
          ? `<img src="https://cdn.discordapp.com/icons/${managed.id}/${managed.icon}.png?size=128" alt="">`
          : escapeHtml(managed.name.slice(0, 2).toUpperCase());

        return `<article class="guild-card friendly-guild-card" data-guild-card data-guild-search="${escapeHtml((managed.name + ' ' + managed.id).toLowerCase())}">
          <div class="guild-card-top">
            <div class="guild-card-main">
              <div class="guild-icon">${icon}</div>
              <div class="guild-card-copy">
                <div class="guild-title-row">
                  <strong>${escapeHtml(managed.name)}</strong>
                  <span class="guild-status"><i></i> Connected</span>
                </div>
                <small>Server ID • ${managed.id}</small>
              </div>
            </div>
          </div>
          <div class="guild-mini-stats">
            <div><span>Members</span><strong>${(stats?.members || 0).toLocaleString()}</strong></div>
            <div><span>Channels</span><strong>${(stats?.channels || 0).toLocaleString()}</strong></div>
            <div><span>Roles</span><strong>${(stats?.roles || 0).toLocaleString()}</strong></div>
            <div><span>Open Tickets</span><strong>${(stats?.openTickets || 0).toLocaleString()}</strong></div>
          </div>
          <div class="guild-card-actions">
            <a class="btn guild-configure-btn" href="/dashboard/${managed.id}">Configure Server</a>
            <a class="btn secondary" href="/dashboard/statistics#guild-${managed.id}">View Statistics</a>
          </div>
        </article>`;
      }).join('') : '<div class="empty">No servers found where you have Manage Server and Kryndexa Bot is installed.</div>';

      const body = `<section class="dashboard-control-shell">
        <section class="dashboard-home-hero">
          <div class="dashboard-hero-copy">
            <span class="dashboard-home-badge"><i></i> CONTROL CENTER</span>
            <span class="eyebrow">YOUR COMMAND CENTER</span>
            <h1>Your Servers</h1>
            <p>Manage configuration, activity, tickets, commands and server health from one place.</p>
          </div>
          <div class="dashboard-hero-actions">
            <span class="dashboard-online-pill"><i></i> Kryndexa Online</span>
            <a class="btn secondary" href="/dashboard/statistics">View All Statistics</a>
          </div>
        </section>

        <section class="server-stats-summary dashboard-server-summary" aria-label="Managed server totals">
          <div class="summary-card">
            <span class="summary-icon summary-icon-servers" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="6" rx="2"/><rect x="4" y="14" width="16" height="6" rx="2"/><path d="M8 7h.01M8 17h.01M12 7h5M12 17h5"/></svg>
            </span>
            <div><strong>${totals.servers.toLocaleString()}</strong><span>Servers</span></div>
          </div>
          <div class="summary-card">
            <span class="summary-icon summary-icon-members" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg>
            </span>
            <div><strong>${totals.members.toLocaleString()}</strong><span>Members</span></div>
          </div>
          <div class="summary-card">
            <span class="summary-icon summary-icon-channels" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M5 9h14M4 15h14M10 3 8 21M16 3l-2 18"/></svg>
            </span>
            <div><strong>${totals.channels.toLocaleString()}</strong><span>Channels</span></div>
          </div>
          <div class="summary-card">
            <span class="summary-icon summary-icon-roles" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M12 3 4 7v5c0 5 3.4 8.7 8 10 4.6-1.3 8-5 8-10V7l-8-4Z"/><path d="m9 12 2 2 4-4"/></svg>
            </span>
            <div><strong>${totals.roles.toLocaleString()}</strong><span>Roles</span></div>
          </div>
          <div class="summary-card">
            <span class="summary-icon summary-icon-tickets" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M3 6h18v5a2 2 0 0 0 0 4v3H3v-3a2 2 0 0 0 0-4V6Z"/><path d="M13 9v6"/></svg>
            </span>
            <div><strong>${totals.openTickets.toLocaleString()}</strong><span>Open Tickets</span></div>
          </div>
          <div class="summary-card">
            <span class="summary-icon summary-icon-commands" aria-hidden="true">
              <svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><path d="m7 9 3 3-3 3M13 15h4"/></svg>
            </span>
            <div><strong>${totals.commandUses.toLocaleString()}</strong><span>Command Uses • 30d</span></div>
          </div>
        </section>

        <section class="dashboard-server-section">
          <div class="dashboard-server-section-head">
            <div>
              <span class="eyebrow">MANAGED SERVERS</span>
              <h2>Choose a server</h2>
              <p>Open a server to configure Kryndexa or review its statistics.</p>
            </div>
            <span class="managed-server-count">${totals.servers.toLocaleString()} managed</span>
          </div>

          <div class="dashboard-toolbar">
            <label class="server-search">
              <span>⌕</span>
              <input type="search" placeholder="Search servers by name or ID" data-filter-selector="[data-guild-card]" data-filter-attribute="data-guild-search" data-filter-empty="#dashboardSearchEmpty">
            </label>
            <span class="dashboard-toolbar-hint">Select a server to continue</span>
          </div>

          <div class="guild-grid friendly-guild-grid">${cards}</div>
          <div id="dashboardSearchEmpty" class="search-empty-state" hidden>No servers match your search.</div>
        </section>
      </section>`;

      return res.send(page('Dashboard • Kryndexa Bot', body, req.session.user, {
        path: '/dashboard',
        private: true,
      }));
    } catch (error) {
      console.error(error);
      if (error.status === 429) return res.status(503).send(page('Discord rate limit', '<div class="empty">Discord is temporarily rate limiting dashboard access. Refresh shortly.</div>', req.session.user));
      if (error.status === 401) return res.status(401).send(page('Session expired', '<div class="empty">Your Discord session expired. <a href="/login">Log in again</a>.</div>'));
      return res.status(500).send(page('Dashboard error', '<div class="empty">The dashboard could not load your server list.</div>', req.session.user));
    }
  });

  const requireBotOwner = async (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');

    try {
      const allowed = await isBotOwner(client, req.session.user.id);
      req.session.user.isBotOwner = allowed;

      if (!allowed) {
        return res.status(403).send(page(
          'Access denied • Kryndexa Bot',
          '<div class="empty"><strong>Bot owner access required.</strong><p>This dashboard area is restricted to configured Kryndexa Bot owners.</p><p><a class="btn secondary" href="/dashboard">Return to Dashboard</a></p></div>',
          req.session.user,
          { path: '/dashboard/owner', private: true },
        ));
      }

      return next();
    } catch (error) {
      console.error('[Dashboard Owner] Unable to verify bot owner:', error);
      return res.status(500).send(page(
        'Owner verification failed • Kryndexa Bot',
        '<div class="empty"><strong>Owner verification failed.</strong><p>Kryndexa could not verify owner access right now.</p><p><a class="btn secondary" href="/dashboard">Return to Dashboard</a></p></div>',
        req.session.user,
        { path: '/dashboard/owner', private: true },
      ));
    }
  };

  app.get('/dashboard/owner', requireAuth, requireBotOwner, async (req, res) => {
    const ownerIds = String(process.env.BOT_OWNER_IDS || '')
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean);

    const ownerCommands = commandCatalog().filter((command) => command.ownerOnly);
    const paidStreamAccess = await listPaidStreamAlertAccess();
    const ownerCommandCards = ownerCommands.length
      ? ownerCommands.map((command) => {
          const subcommands = command.subcommands.length
            ? `<div class="command-subcommands">${command.subcommands.map((sub) => `<span>/${escapeHtml(command.name)} ${escapeHtml(sub)}</span>`).join('')}</div>`
            : '';

          const aliases = command.aliases.length
            ? `<span class="command-meta">Aliases: ${command.aliases.map((alias) => escapeHtml(alias)).join(', ')}</span>`
            : '';

          return `<article class="command-card enabled owner-command-card">
            <div class="command-card-head">
              <code>/${escapeHtml(command.name)}</code>
              <div class="command-badges">
                <span class="pill subtle">Owner only</span>
                <span class="pill subtle">${command.guildOnly ? 'Server' : 'Global capable'}</span>
                <span class="pill subtle">${command.prefixBackup ? 'Prefix backup' : 'Slash only'}</span>
              </div>
            </div>
            <p>${escapeHtml(command.description)}</p>
            <span class="command-meta">Module: ${escapeHtml(command.modulePath || 'unknown')}</span>
            ${subcommands}
            ${aliases}
          </article>`;
        }).join('')
      : '<div class="empty">No owner-only commands are currently loaded.</div>';

    const guildOptions = [...client.guilds.cache.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((guild) => `<option value="${guild.id}">${escapeHtml(guild.name)} • ${guild.id}</option>`)
      .join('');

    const paidAccessCards = paidStreamAccess.length
      ? paidStreamAccess.map((access) => {
          const guild = client.guilds.cache.get(access.guildId);
          return `<article class="paid-access-card">
            <div><strong>${escapeHtml(guild?.name || 'Unknown / disconnected server')}</strong><span>${escapeHtml(access.guildId)}</span></div>
            <div><span class="pill subtle">Paid • 15 streamers</span>${access.note ? `<small>${escapeHtml(access.note)}</small>` : ''}</div>
          </article>`;
        }).join('')
      : '<div class="empty">No servers currently have paid Stream Alerts access.</div>';

    const body = `<section class="owner-dashboard-shell">
      <section class="owner-dashboard-hero">
        <div>
          <span class="owner-access-badge"><i></i> RESTRICTED OWNER ACCESS</span>
          <span class="eyebrow">BOT OWNERS</span>
          <h1>Owner Control Center</h1>
          <p>Private owner commands, paid feature access, and bot-wide broadcast controls for Kryndexa Bot.</p>
        </div>
        <div class="owner-dashboard-meta">
          <span><strong>${client.guilds.cache.size.toLocaleString()}</strong> connected servers</span>
          <span><strong>${paidStreamAccess.length.toLocaleString()}</strong> paid Stream Alert servers</span>
        </div>
      </section>

      <section class="owner-section owner-broadcast-section">
        <div class="owner-section-heading">
          <div>
            <span class="eyebrow">GLOBAL BROADCAST</span>
            <h2>Important Announcement Panel</h2>
            <p>Compose an embed, preview it, then deliver it through each server's configured broadcast channel or Kryndexa's safe fallback channel selection.</p>
          </div>
        </div>
        <form class="owner-broadcast-editor" data-embed-editor method="post" action="/dashboard/owner/broadcast">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrf)}">
          <div class="embed-editor-layout">
            <div class="embed-editor-controls">
              <label>Announcement Title<input name="title" data-embed-title maxlength="256" value="Important Kryndexa Bot Announcement" required></label>
              <label>Title Link <small>(optional clickable embed title)</small><input name="titleUrl" data-embed-title-url maxlength="1000" placeholder="https://example.com/announcement"></label>
              <label>Message<textarea name="message" data-embed-description maxlength="4000" rows="8" placeholder="Write the important announcement here..." required></textarea></label>
              <div class="form-grid">
                <label>Embed Color<input name="color" data-embed-color maxlength="7" value="#5865F2"></label>
                <label>Footer<input name="footer" data-embed-footer maxlength="2048" value="Kryndexa Bot • Owner Broadcast"></label>
              </div>
              <div class="form-grid">
                <label>Image URL<input name="imageUrl" maxlength="1000" placeholder="https://..."></label>
                <label>Thumbnail URL<input name="thumbnailUrl" maxlength="1000" placeholder="https://..."></label>
              </div>
              <div class="checks owner-broadcast-checks">
                <label><input type="checkbox" name="mentionEveryone" checked> Mention @everyone where permitted</label>
                <label><input type="checkbox" name="dryRun"> Dry run only — calculate delivery without sending</label>
              </div>
              <button class="btn" type="submit" onclick="return confirm('Run this owner broadcast across all connected servers?')">Send / Run Broadcast</button>
            </div>
            <div class="embed-preview-card owner-broadcast-preview" data-embed-preview style="--embed-color:#5865F2">
              <div class="embed-preview-bar"></div>
              <div class="embed-preview-body">
                <span class="mini-label">DISCORD PREVIEW</span>
                <a data-preview-title class="embed-preview-title-link" target="_blank" rel="noreferrer">Important Kryndexa Bot Announcement</a>
                <p data-preview-description>Write the important announcement here...</p>
                <div class="embed-preview-fields" data-preview-fields></div>
                <small data-preview-footer>Kryndexa Bot • Owner Broadcast</small>
              </div>
            </div>
          </div>
        </form>
      </section>

      <section class="owner-section">
        <div class="owner-section-heading">
          <div>
            <span class="eyebrow">STREAM ALERT ACCESS</span>
            <h2>Paid Streamer Limits</h2>
            <p>Free servers can configure ${FREE_STREAMER_LIMIT} streamers. Servers granted paid access can configure up to ${PAID_STREAMER_LIMIT}. This entitlement layer is ready for a payment provider to automate later.</p>
          </div>
        </div>
        <form class="paid-access-form" method="post" action="/dashboard/owner/stream-access">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrf)}">
          <label>Server<select name="guildId" required><option value="">Choose a connected server</option>${guildOptions}</select></label>
          <label>Access Tier<select name="tier" required><option value="paid">Paid • ${PAID_STREAMER_LIMIT} streamers</option><option value="free">Free • ${FREE_STREAMER_LIMIT} streamers</option></select></label>
          <label>Internal Note<input name="note" maxlength="500" placeholder="Payment/order/reference note (optional)"></label>
          <button class="btn" type="submit">Update Stream Access</button>
        </form>
        <div class="paid-access-list">${paidAccessCards}</div>
      </section>

      <section class="owner-section">
        <div class="owner-section-heading">
          <div>
            <span class="eyebrow">OWNER COMMANDS</span>
            <h2>Bot Owner Command Center</h2>
            <p>These commands are hidden from normal server dashboards and remain restricted by server-side bot-owner checks when executed.</p>
          </div>
        </div>
        <div class="command-grid">${ownerCommandCards}</div>
      </section>

      <section class="owner-section">
        <div class="owner-section-heading">
          <div><span class="eyebrow">ACCESS</span><h2>Owner Access</h2><p>Only configured bot owners can open this page. Direct requests from non-owners return HTTP 403.</p></div>
        </div>
        <div class="owner-dashboard-meta">
          <span><strong>${ownerIds.length || 1}</strong> configured owner${(ownerIds.length || 1) === 1 ? '' : 's'}</span>
          <span><strong>${ownerCommands.filter((command) => command.prefixBackup).length}</strong> prefix backup${ownerCommands.filter((command) => command.prefixBackup).length === 1 ? '' : 's'}</span>
        </div>
      </section>
    </section>`;

    return res.send(page('Bot Owners • Kryndexa Bot', body, req.session.user, {
      path: '/dashboard/owner',
      private: true,
      description: 'Restricted Kryndexa Bot owner commands, broadcasts, and paid access controls.',
    }));
  });

  app.post('/dashboard/owner/stream-access', requireAuth, requireBotOwner, verifyCsrf, async (req, res) => {
    try {
      const guildId = String(req.body.guildId || '').trim();
      if (!client.guilds.cache.has(guildId)) return res.status(400).send('Choose a connected Discord server.');

      const paid = String(req.body.tier || '') === 'paid';

      if (!paid) {
        const configuredStreamers = await listStreamAnnouncements(guildId);
        if (configuredStreamers.length > FREE_STREAMER_LIMIT) {
          return res.status(409).send(page(
            'Cannot downgrade Stream Alerts • Kryndexa Bot',
            `<div class="empty"><strong>This server still has ${configuredStreamers.length} configured streamers.</strong><p>Reduce the server to ${FREE_STREAMER_LIMIT} or fewer streamers before switching it back to free access.</p><p><a class="btn secondary" href="/dashboard/owner">Return to Bot Owners</a></p></div>`,
            req.session.user,
            { private: true },
          ));
        }
      }

      await setStreamAlertPaidAccess(guildId, {
        paid,
        grantedBy: req.session.user.id,
        note: req.body.note || '',
      });

      return res.redirect('/dashboard/owner');
    } catch (error) {
      console.error('[Dashboard Owner] Unable to update stream access:', error);
      return res.status(500).send(page('Owner access error • Kryndexa Bot', `<div class="empty"><strong>Unable to update Stream Alerts access.</strong><p>${escapeHtml(error.message || String(error))}</p></div>`, req.session.user, { private: true }));
    }
  });

  app.post('/dashboard/owner/broadcast', requireAuth, requireBotOwner, verifyCsrf, async (req, res) => {
    try {
      const title = String(req.body.title || 'Kryndexa Bot Announcement').trim().slice(0, 256);
      const message = String(req.body.message || '').trim().slice(0, 4000);
      if (!message) return res.status(400).send('Broadcast message is required.');

      const titleUrl = String(req.body.titleUrl || '').trim();
      const imageUrl = String(req.body.imageUrl || '').trim();
      const thumbnailUrl = String(req.body.thumbnailUrl || '').trim();
      if (titleUrl && !/^https?:\/\//i.test(titleUrl)) return res.status(400).send('Title link must use http:// or https://.');
      if (imageUrl && !/^https?:\/\//i.test(imageUrl)) return res.status(400).send('Image URL must use http:// or https://.');
      if (thumbnailUrl && !/^https?:\/\//i.test(thumbnailUrl)) return res.status(400).send('Thumbnail URL must use http:// or https://.');

      const owner = await client.users.fetch(req.session.user.id).catch(() => null);
      const results = await broadcastToGuilds(client, {
        title,
        titleUrl,
        message,
        owner,
        dryRun: req.body.dryRun === 'on',
        color: req.body.color || '#5865F2',
        footer: req.body.footer || '',
        imageUrl,
        thumbnailUrl,
        mentionEveryone: req.body.mentionEveryone === 'on',
      });
      const summary = formatBroadcastSummary(results);

      return res.send(page(
        'Broadcast result • Kryndexa Bot',
        `<section class="owner-dashboard-shell"><section class="owner-section"><span class="eyebrow">GLOBAL BROADCAST</span><h1>${results.dryRun ? 'Dry Run Complete' : 'Broadcast Complete'}</h1><pre class="owner-broadcast-result">${escapeHtml(summary)}</pre><p><a class="btn" href="/dashboard/owner">← Back to Bot Owners</a></p></section></section>`,
        req.session.user,
        { path: '/dashboard/owner', private: true },
      ));
    } catch (error) {
      console.error('[Dashboard Owner] Broadcast failed:', error);
      return res.status(500).send(page('Broadcast failed • Kryndexa Bot', `<div class="empty"><strong>Owner broadcast failed.</strong><p>${escapeHtml(error.message || String(error))}</p><p><a class="btn secondary" href="/dashboard/owner">Return to Bot Owners</a></p></div>`, req.session.user, { private: true }));
    }
  });
  app.get('/dashboard/statistics', requireAuth, async (req, res) => {
    try {
      const managedGuilds = await getManagedGuilds(req, client);
      const stats = await Promise.all(managedGuilds.map(async (managed) => {
        const guild = client.guilds.cache.get(managed.id);
        if (!guild) return null;
        const [tickets, analytics] = await Promise.all([listGuildTickets(guild.id), getAnalytics(guild.id)]);
        return {
          id: guild.id, name: guild.name, icon: guild.icon, members: guild.memberCount,
          channels: guild.channels.cache.size, roles: Math.max(0, guild.roles.cache.size - 1),
          boosts: guild.premiumSubscriptionCount || 0,
          openTickets: tickets.filter((ticket) => ticket.status === 'open').length,
          closedTickets: tickets.filter((ticket) => ticket.status === 'closed').length,
          commandUses: analytics.uses, commandUsers: analytics.users,
        };
      }));

      const rows = stats.filter(Boolean).sort((a, b) => b.members - a.members || a.name.localeCompare(b.name));
      const totals = rows.reduce((sum, item) => ({
        members: sum.members + item.members, channels: sum.channels + item.channels,
        roles: sum.roles + item.roles, openTickets: sum.openTickets + item.openTickets,
        commandUses: sum.commandUses + item.commandUses,
      }), { members: 0, channels: 0, roles: 0, openTickets: 0, commandUses: 0 });

      const tableRows = rows.length ? rows.map((item) => {
        const icon = item.icon ? `<img src="https://cdn.discordapp.com/icons/${item.id}/${item.icon}.png?size=64" alt="">` : `<span>${escapeHtml(item.name.slice(0,2).toUpperCase())}</span>`;
        return `<tr id="guild-${item.id}" data-stat-row data-stat-search="${escapeHtml((item.name+' '+item.id).toLowerCase())}"><td><div class="stats-server-cell"><div class="stats-server-icon">${icon}</div><div><strong>${escapeHtml(item.name)}</strong><small>${item.id}</small></div></div></td><td>${item.members.toLocaleString()}</td><td>${item.channels}</td><td>${item.roles}</td><td>${item.boosts}</td><td><strong>${item.openTickets} open</strong><small>${item.closedTickets} closed</small></td><td><strong>${item.commandUses.toLocaleString()}</strong><small>${item.commandUsers.toLocaleString()} users / 30d</small></td><td><a class="btn compact" href="/dashboard/${item.id}">Configure</a></td></tr>`;
      }).join('') : '<tr><td colspan="8">No manageable servers are connected.</td></tr>';

      const body = `<section class="stats-page-hero"><div><span class="eyebrow">SERVER STATISTICS</span><h1>Server Overview</h1><p>Compare the servers you manage without opening each configuration page.</p></div><a class="btn secondary" href="/dashboard">← Your Servers</a></section>
        <section class="server-stats-summary"><div><strong>${rows.length}</strong><span>Servers</span></div><div><strong>${totals.members.toLocaleString()}</strong><span>Members</span></div><div><strong>${totals.channels.toLocaleString()}</strong><span>Channels</span></div><div><strong>${totals.roles.toLocaleString()}</strong><span>Roles</span></div><div><strong>${totals.openTickets}</strong><span>Open Tickets</span></div><div><strong>${totals.commandUses.toLocaleString()}</strong><span>Command Uses • 30d</span></div></section>
        <section class="panel statistics-panel"><div class="stats-toolbar"><label class="server-search"><span>🔎</span><input type="search" placeholder="Filter server statistics" data-filter-selector="[data-stat-row]" data-filter-attribute="data-stat-search" data-filter-empty="#statisticsSearchEmpty"></label><span>Sorted by member count</span></div><div class="table-wrap"><table class="server-statistics-table"><thead><tr><th>Server</th><th>Members</th><th>Channels</th><th>Roles</th><th>Boosts</th><th>Tickets</th><th>Commands</th><th></th></tr></thead><tbody>${tableRows}</tbody></table></div><div id="statisticsSearchEmpty" class="search-empty-state" hidden>No server statistics match your search.</div></section>`;
      return res.send(page('Server Statistics • Kryndexa Bot', body, req.session.user, {
        path: '/dashboard/statistics',
        private: true,
      }));
    } catch (error) {
      console.error(error);
      return res.status(500).send(page('Statistics error', '<div class="empty">Unable to load server statistics.</div>', req.session.user));
    }
  });

  app.get('/dashboard/:guildId', requireAuth, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).send('MultiBot is no longer connected to this server.');
      const [settings, tickets, streamAnnouncements, ticketTypes, featureStates, automationRules, embedConfigs, streamAccess] = await Promise.all([
        getGuildSettings(guild.id),
        listGuildTickets(guild.id),
        listStreamAnnouncements(guild.id),
        listTicketTypes(guild.id),
        getGuildFeatures(guild.id),
        listAutomationRules(guild.id),
        listEmbedConfigs(guild.id),
        getStreamAlertAccess(guild.id),
      ]);
      const textChannels = [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildText).sort((a, b) => a.name.localeCompare(b.name));
      const broadcastChannels = [...guild.channels.cache.values()].filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type)).sort((a, b) => a.name.localeCompare(b.name));
      const categories = [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildCategory).sort((a, b) => a.name.localeCompare(b.name));
      const voiceChannels = [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildVoice).sort((a, b) => a.name.localeCompare(b.name));
      const featureChannels = [...guild.channels.cache.values()].filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type)).sort((a, b) => a.name.localeCompare(b.name));
      const roles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position);
      const featureResources = { channels: featureChannels, voiceChannels, categories, roles };
      const priorityRank = { 'Very High': 0, High: 1, Growing: 2, Popular: 3, Differentiator: 4 };
      const featureCards = [...featureStates]
        .sort((a, b) => (priorityRank[a.definition.priority] ?? 9) - (priorityRank[b.definition.priority] ?? 9) || a.definition.title.localeCompare(b.definition.title))
        .map((state) => {
          const feature = state.definition;
          const fields = (feature.fields || []).map((field) => featureFieldHtml(field, state.config[field.key], featureResources)).join('');
          const maturity = feature.maturity === 'core'
            ? '<span class="feature-status core">Operational</span>'
            : feature.maturity === 'partial'
              ? '<span class="feature-status partial">Partial</span>'
              : feature.maturity === 'foundation'
                ? '<span class="feature-status foundation">Foundation</span>'
                : '<span class="feature-status integration">Provider Required</span>';

          const action = feature.link
            ? `<div class="feature-actions"><button class="btn" type="submit">Save Feature</button><a class="btn secondary feature-open" href="${feature.link}">Open Configuration</a></div>`
            : `<button class="btn" type="submit">Save Feature</button>`;

          return `<form class="feature-card priority-${escapeHtml(feature.priority.toLowerCase().replace(/[^a-z]+/g, '-'))} ${state.enabled ? 'feature-enabled' : ''}" method="post" action="/dashboard/${guild.id}/features/${encodeURIComponent(feature.key)}">
            <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrf)}">
            <div class="feature-card-head">
              <div class="feature-icon">${escapeHtml(feature.icon)}</div>
              <div class="feature-title-wrap">
                <div class="feature-label-row"><h3>${escapeHtml(feature.title)}</h3>${maturity}</div>
                <span class="feature-priority">🔥 ${escapeHtml(feature.priority)} priority • ${escapeHtml(feature.category)}</span>
              </div>
              ${feature.locked ? '<span class="pill subtle">Always On</span>' : `<label class="feature-toggle"><input class="autosave-toggle" type="checkbox" name="enabled" data-autosave-url="/dashboard/${guild.id}/features/${encodeURIComponent(feature.key)}/toggle" data-csrf="${escapeHtml(req.session.csrf)}" ${state.enabled ? 'checked' : ''}><span>Enabled</span></label>`}
            </div>
            <p class="feature-description">${escapeHtml(feature.description)}</p>
            ${feature.requirement ? `<div class="feature-requirement">⚙️ ${escapeHtml(feature.requirement)}</div>` : ''}
            ${fields ? `<div class="feature-fields">${fields}</div>` : ''}
            <div class="feature-card-footer">${action}</div>
          </form>`;
        }).join('');

      const automationCards = automationRules.length
        ? automationRules.map((rule) => `<article class="automation-rule-card">
            <div>
              <strong>${escapeHtml(rule.name)}</strong>
              <span>${escapeHtml(rule.triggerType)} → ${escapeHtml(rule.actionType)}</span>
            </div>
            <div class="automation-rule-detail">
              ${rule.triggerValue ? `<code>Match: ${escapeHtml(rule.triggerValue)}</code>` : '<code>Any matching event</code>'}
              ${rule.actionChannelId ? `<code>Channel: #${escapeHtml(guild.channels.cache.get(rule.actionChannelId)?.name || rule.actionChannelId)}</code>` : ''}
              ${rule.actionRoleId ? `<code>Role: ${escapeHtml(guild.roles.cache.get(rule.actionRoleId)?.name || rule.actionRoleId)}</code>` : ''}
            </div>
            <form method="post" action="/dashboard/${guild.id}/automations/${rule.id}/delete">
              <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrf)}">
              <button class="icon-btn danger" type="submit" title="Delete automation">×</button>
            </form>
          </article>`).join('')
        : '<div class="empty">No custom automation rules yet.</div>';

      const recentTickets = tickets.slice(0, 20);
      const ticketTypeMap = new Map(ticketTypes.map((type) => [type.key, type]));
      const ticketStats = {
        total: tickets.length,
        open: tickets.filter((ticket) => ticket.status === 'open').length,
        closed: tickets.filter((ticket) => ticket.status === 'closed').length,
        claimed: tickets.filter((ticket) => ticket.claimedBy).length,
      };

      const ticketTypeCards = ticketTypes.map((type) => `<form class="ticket-module-card ${type.enabled ? 'enabled' : 'disabled'}" method="post" action="/dashboard/${guild.id}/tickets/types/${encodeURIComponent(type.key)}">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrf)}">
        <div class="ticket-module-head">
          <div class="ticket-module-icon">${escapeHtml(type.emoji || '🎫')}</div>
          <div>
            <span class="mini-label">Department</span>
            <h3>${escapeHtml(type.label)}</h3>
          </div>
          <label class="switch-label"><input class="autosave-toggle" type="checkbox" name="enabled" data-autosave-url="/dashboard/${guild.id}/tickets/types/${encodeURIComponent(type.key)}/toggle" data-csrf="${escapeHtml(req.session.csrf)}" ${type.enabled ? 'checked' : ''}> Enabled</label>
        </div>
        <div class="ticket-module-fields">
          <label>Display Name
            <input name="label" maxlength="80" value="${escapeHtml(type.label)}" required>
          </label>
          <label>Emoji
            <input name="emoji" maxlength="32" value="${escapeHtml(type.emoji)}" placeholder="🎫">
          </label>
          <label class="wide">Description
            <textarea name="description" maxlength="200" rows="3" required>${escapeHtml(type.description)}</textarea>
          </label>
          <label>Discord Category
            <select name="categoryId">${selectOptions(categories, type.categoryId, 'Use default ticket category')}</select>
          </label>
          <label>Staff Role
            <select name="staffRoleId">${selectOptions(roles, type.staffRoleId, 'Use default ticket staff role')}</select>
          </label>
        </div>
        <div class="ticket-module-footer">
          <span>Key: <code>${escapeHtml(type.key)}</code></span>
          <button class="btn" type="submit">Save Department</button>
        </div>
      </form>`).join('');

      const streamCards = streamAnnouncements.length
        ? streamAnnouncements.map((item) => {
            const meta = streamPlatformMeta(item.platform, item.streamerIdentifier);
            const targetChannel = guild.channels.cache.get(item.discordChannelId);
            const channelName = targetChannel?.name ? `#${targetChannel.name}` : 'Channel unavailable';
            const lastAnnounced = item.lastAnnouncedAt
              ? new Date(item.lastAnnouncedAt).toLocaleString()
              : 'Never';

            return `<article class="stream-list-row provider-${meta.css}">
              <div class="stream-list-main">
                <div class="stream-avatar ${meta.css}">${escapeHtml(meta.short)}</div>
                <div>
                  <div class="stream-list-title">
                    <a href="${escapeHtml(meta.url)}" target="_blank" rel="noreferrer">${escapeHtml(item.streamerIdentifier)}</a>
                    <span class="provider-chip ${meta.css}">${escapeHtml(meta.label)}</span>
                    <span class="status-badge ${item.isLive ? 'live' : 'offline'}"><span class="status-dot"></span>${item.isLive ? 'LIVE' : 'Offline'}</span>
                  </div>
                  <div class="stream-list-meta">
                    <span>Channel: <strong>${escapeHtml(channelName)}</strong></span>
                    <span>Last announced: <strong>${escapeHtml(lastAnnounced)}</strong></span>
                    <span>${item.enabled ? 'Enabled' : 'Disabled'}</span>
                  </div>
                </div>
              </div>
              <form method="post" action="/dashboard/${guild.id}/streams/${item.id}/delete" onsubmit="return confirm('Remove this stream alert?')">
                <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrf)}">
                <button class="icon-btn danger" type="submit" title="Remove stream alert">×</button>
              </form>
            </article>`;
          }).join('')
        : '<div class="empty">No Twitch, YouTube, or Kick streamers configured yet.</div>';

      const streamEmbedEditors = embedConfigs
        .filter((config) => ['twitch_live', 'youtube_live', 'kick_live'].includes(config.key))
        .map((config) => {
          const provider = config.key.replace('_live', '');
          return `<div class="stream-provider-editor" data-stream-embed-panel="${provider}" ${provider === 'twitch' ? '' : 'hidden'}>
            ${renderStreamEmbedEditor(guild.id, config, req.session.csrf)}
          </div>`;
        })
        .join('');
      const catalog = commandCatalog().filter((command) => !command.ownerOnly);
      const commandStates = await getCommandStateObject(guild.id, catalog.map((command) => command.name));
      const preferredCategories = ['Moderation','Security','Administration','Tickets','Verification','Roles','Leveling','Applications','Giveaways','Community','Economy','Utility','Analytics','Voice','Integrations','Music','AI Assistant','Automations','Misc','Other'];
      const discoveredCategories = [...new Set(catalog.map((command) => command.category))];
      const categoryOrder = [
        ...preferredCategories.filter((category) => discoveredCategories.includes(category)),
        ...discoveredCategories.filter((category) => !preferredCategories.includes(category)).sort(),
      ];
      const commandGroups = categoryOrder.map((category) => {
        const items = catalog.filter((command) => command.category === category);
        if (!items.length) return '';

        const cards = items.map((command) => {
          const subcommands = command.subcommands.length
            ? `<div class="command-subcommands">${command.subcommands.map((sub) => `<span>/${escapeHtml(command.name)} ${escapeHtml(sub)}</span>`).join('')}</div>`
            : '';

          const aliases = command.aliases.length
            ? `<span class="command-meta">Aliases: ${command.aliases.map((alias) => escapeHtml(alias)).join(', ')}</span>`
            : '';

          return `<article class="command-card ${commandStates[command.name] !== false ? 'enabled' : 'disabled'}">
            <div class="command-card-head">
              <code>/${escapeHtml(command.name)}</code>
              <div class="command-badges">
                <span class="pill subtle">${command.guildOnly ? 'Server' : 'Global capable'}</span>
                <span class="pill subtle">${command.prefixBackup ? 'Prefix backup' : 'Slash only'}</span>
                <label class="command-toggle"><input class="autosave-toggle" type="checkbox" data-autosave-url="/dashboard/${guild.id}/commands/${encodeURIComponent(command.name)}/toggle" data-csrf="${escapeHtml(req.session.csrf)}" ${commandStates[command.name] !== false ? 'checked' : ''}> Enabled</label>
              </div>
            </div>
            <p>${escapeHtml(command.description)}</p>
            <span class="command-meta">Module: ${escapeHtml(command.modulePath || 'unknown')}</span>
            ${subcommands}
            ${aliases}
          </article>`;
        }).join('');

        return `<section class="command-category">
          <div class="category-heading">
            <h3>${escapeHtml(category)}</h3>
            <span>${items.length} command${items.length === 1 ? '' : 's'}</span>
          </div>
          <div class="command-grid">${cards}</div>
        </section>`;
      }).join('');
      const transcriptRows = recentTickets.length ? recentTickets.map((t) => {
        const type = ticketTypeMap.get(t.ticketTypeKey || 'support');
        const transcriptLinks = t.transcriptFile
          ? [
              settings.onlineTranscriptsEnabled
                ? `<a href="/transcripts/${t.id}/view" target="_blank" rel="noreferrer">View Online</a>`
                : '',
              `<a href="/transcripts/${t.id}">Download HTML</a>`,
            ].filter(Boolean).join(' • ')
          : '—';
        return `<tr><td>${escapeHtml(t.id.slice(0, 8))}</td><td>${escapeHtml(type?.label || t.ticketTypeKey || 'Support')}</td><td>${escapeHtml(t.status)}</td><td>${t.claimedBy ? `<@${t.claimedBy}>` : 'Unclaimed'}</td><td>${escapeHtml(t.closeReason || '—')}</td><td>${escapeHtml(new Date(t.createdAt).toLocaleString())}</td><td>${transcriptLinks}</td></tr>`;
      }).join('') : '<tr><td colspan="7">No tickets yet.</td></tr>';
      const form = `<div class="section-title"><a href="/dashboard">← Servers</a><h1>${escapeHtml(guild.name)}</h1><p>Changes apply immediately; no bot restart is required.</p></div>
      <nav class="dashboard-jump">
        <a href="#configuration">Configuration</a>
        <a href="#features">Feature Center</a>
        <a href="#ticket-config">Ticket System</a>
        <a href="#stream-alerts">Stream Alerts</a>
        <a href="#commands">Commands</a>
        <a href="#tickets">Tickets</a>
      </nav>
      <form id="configuration" class="panel" method="post" action="/dashboard/${guild.id}"><input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrf)}"><div class="form-grid">
      <label>Prefix<input name="prefix" maxlength="5" value="${escapeHtml(settings.prefix)}"></label>
      <label>Welcome Channel<select name="welcomeChannelId">${selectOptions(textChannels, settings.welcomeChannelId)}</select></label>
      <label>Leave Channel<select name="leaveChannelId">${selectOptions(textChannels, settings.leaveChannelId)}</select></label>
      <label>General Logs Channel<select name="logsChannelId">${selectOptions(textChannels, settings.logsChannelId)}</select></label>
      <label>Verification Log Channel<select name="verificationLogChannelId">${selectOptions(textChannels, settings.verificationLogChannelId, 'Use General Logs Channel')}</select></label>
      <label>Role Change Log Channel<select name="roleLogChannelId">${selectOptions(textChannels, settings.roleLogChannelId, 'Use General Logs Channel')}</select></label>
      <label>Owner Broadcast Channel<select name="broadcastChannelId">${selectOptions(broadcastChannels, settings.broadcastChannelId, 'Automatic channel selection')}</select></label>
      <label>Verification Channel<select name="verificationChannelId">${selectOptions(textChannels, settings.verificationChannelId)}</select></label>
      <label>Verified Role<select name="verifiedRoleId">${selectOptions(roles, settings.verifiedRoleId)}</select></label>
      <label>Unverified Role<select name="unverifiedRoleId">${selectOptions(roles, settings.unverifiedRoleId)}</select></label>
      <label>Ticket Category<select name="ticketsCategoryId">${selectOptions(categories, settings.ticketsCategoryId)}</select></label>
      <label>Ticket Panel Channel<select name="ticketPanelChannelId">${selectOptions(textChannels, settings.ticketPanelChannelId)}</select></label>
      <label>Ticket Staff Role<select name="ticketStaffRoleId">${selectOptions(roles, settings.ticketStaffRoleId)}</select></label>
      </div><div class="checks">
      <label><input class="autosave-toggle" type="checkbox" name="loggingEnabled" data-autosave-url="/dashboard/${guild.id}/settings/toggle" data-setting="loggingEnabled" data-csrf="${escapeHtml(req.session.csrf)}" ${settings.loggingEnabled ? 'checked' : ''}> Logging enabled</label>
      <label><input class="autosave-toggle" type="checkbox" name="welcomeEnabled" data-autosave-url="/dashboard/${guild.id}/settings/toggle" data-setting="welcomeEnabled" data-csrf="${escapeHtml(req.session.csrf)}" ${settings.welcomeEnabled ? 'checked' : ''}> Welcome messages enabled</label>
      <label><input class="autosave-toggle" type="checkbox" name="verificationEnabled" data-autosave-url="/dashboard/${guild.id}/settings/toggle" data-setting="verificationEnabled" data-csrf="${escapeHtml(req.session.csrf)}" ${settings.verificationEnabled ? 'checked' : ''}> Member verification enabled</label>
      <label><input class="autosave-toggle" type="checkbox" name="prefixCommandsEnabled" data-autosave-url="/dashboard/${guild.id}/settings/toggle" data-setting="prefixCommandsEnabled" data-csrf="${escapeHtml(req.session.csrf)}" ${settings.prefixCommandsEnabled ? 'checked' : ''}> Legacy prefix commands enabled</label>
      </div><button class="btn" type="submit">Save Settings</button></form>

      <section id="features" class="panel feature-center-panel">
        <div class="panel-heading-row">
          <div>
            <span class="eyebrow">MULTIBOT FEATURE CENTER</span>
            <h2>Advanced Server Features</h2>
            <p>Enable and configure MultiBot's security, engagement, utility, voice, analytics and integration modules from one place.</p>
          </div>
          <span class="command-total">${featureStates.filter((feature) => feature.enabled).length}/${featureStates.length} enabled</span>
        </div>
        <div class="feature-grid">${featureCards}</div>

        <div class="automation-builder">
          <div class="category-heading"><h3>⚡ Custom Automation Rules</h3><span>${automationRules.length} rule${automationRules.length === 1 ? '' : 's'}</span></div>
          <form class="automation-form" method="post" action="/dashboard/${guild.id}/automations">
            <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrf)}">
            <div class="form-grid">
              <label>Rule Name<input name="name" maxlength="80" placeholder="Welcome helper" required></label>
              <label>Trigger
                <select name="triggerType" required>
                  <option value="member_join">Member joins</option>
                  <option value="message_contains">Message contains text</option>
                </select>
              </label>
              <label>Trigger Match<input name="triggerValue" maxlength="500" placeholder="Only used for message_contains"></label>
              <label>Action
                <select name="actionType" required>
                  <option value="send_message">Send message</option>
                  <option value="dm_user">DM user</option>
                  <option value="add_role">Add role</option>
                </select>
              </label>
              <label>Action Channel<select name="actionChannelId">${selectOptions(featureChannels, '', 'Use event channel / none')}</select></label>
              <label>Action Role<select name="actionRoleId">${selectOptions(roles, '', 'No role')}</select></label>
              <label style="grid-column:1/-1">Action Message<input name="actionMessage" maxlength="1500" placeholder="Welcome {user} to {server}!"></label>
            </div>
            <div class="token-row"><span>{user}</span><span>{username}</span><span>{server}</span><span>{channel}</span></div>
            <button class="btn" type="submit">＋ Create Automation</button>
          </form>
          <div class="automation-rule-list">${automationCards}</div>
        </div>
      </section>

      <section id="ticket-config" class="panel ticket-config-panel">
        <div class="panel-heading-row">
          <div>
            <span class="eyebrow">ADVANCED TICKETS</span>
            <h2>Ticket Configuration</h2>
            <p>Configure every department independently. Blank category or staff-role selections inherit the default ticket settings above.</p>
          </div>
          <span class="command-total">${ticketTypes.filter((type) => type.enabled).length}/${ticketTypes.length} enabled</span>
        </div>

        <form class="ticket-behavior-form" method="post" action="/dashboard/${guild.id}/tickets/settings">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrf)}">
          <div class="ticket-behavior-grid">
            <label>Max Open Tickets Per Person
              <input type="number" name="maxOpenTicketsPerUser" min="1" max="25" value="${escapeHtml(String(settings.maxOpenTicketsPerUser))}" required>
            </label>
            <label>Transcript Channel
              <select name="transcriptChannelId">${selectOptions(textChannels, settings.transcriptChannelId, 'No transcript channel')}</select>
            </label>
          </div>
          <div class="checks ticket-behavior-switches">
            <label><input class="autosave-toggle" type="checkbox" data-autosave-url="/dashboard/${guild.id}/settings/toggle" data-setting="ticketsEnabled" data-csrf="${escapeHtml(req.session.csrf)}" ${settings.ticketsEnabled ? 'checked' : ''}> Ticket system enabled</label>
            <label><input class="autosave-toggle" type="checkbox" data-autosave-url="/dashboard/${guild.id}/settings/toggle" data-setting="onlineTranscriptsEnabled" data-csrf="${escapeHtml(req.session.csrf)}" ${settings.onlineTranscriptsEnabled ? 'checked' : ''}> Online transcript viewing enabled</label>
            <label><input class="autosave-toggle" type="checkbox" data-autosave-url="/dashboard/${guild.id}/settings/toggle" data-setting="transcriptAttachmentsEnabled" data-csrf="${escapeHtml(req.session.csrf)}" ${settings.transcriptAttachmentsEnabled ? 'checked' : ''}> Upload .html transcript files</label>
          </div>
          <button class="btn" type="submit">Save Ticket Limits & Transcript Channel</button>
        </form>

        <form class="ticket-panel-publisher" method="post" action="/dashboard/${guild.id}/tickets/panel">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrf)}">
          <label>Ticket Panel Channel
            <select name="ticketPanelChannelId" required>${selectOptions(textChannels, settings.ticketPanelChannelId, 'Choose panel channel')}</select>
          </label>
          <div>
            <span class="mini-label">Publish / Refresh</span>
            <p>Posts a new advanced ticket selector using all currently enabled departments.</p>
          </div>
          <button class="btn" type="submit">Post Ticket Panel</button>
        </form>

        <div class="ticket-stat-grid">
          <div><strong>${ticketStats.total}</strong><span>Tracked</span></div>
          <div><strong>${ticketStats.open}</strong><span>Open</span></div>
          <div><strong>${ticketStats.claimed}</strong><span>Claimed</span></div>
          <div><strong>${ticketStats.closed}</strong><span>Closed</span></div>
        </div>
        <div class="ticket-module-grid">${ticketTypeCards}</div>
      </section>

      <section id="stream-alerts" class="panel stream-alert-panel">
        <div class="stream-alert-heading">
          <div>
            <span class="eyebrow">STREAM ALERTS</span>
            <h2>Twitch / YouTube / Kick Streamers</h2>
            <p>Use one form for every streaming service. Choose the service below, then configure the streamer, Discord channel, live role, and matching embed.</p>
          </div>
          <span class="stream-access-pill">${streamAccess.paid ? 'Paid' : 'Free'} • ${streamAnnouncements.length}/${streamAccess.streamerLimit} streamers</span>
        </div>

        <form class="stream-config-form unified-stream-form" method="post" action="/dashboard/${guild.id}/streams">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrf)}">
          <div class="form-grid">
            <label>Streaming Service
              <select name="platform" data-stream-platform required>
                <option value="twitch">Twitch</option>
                <option value="youtube">YouTube</option>
                <option value="kick">Kick</option>
              </select>
            </label>
            <label>Streamer / Channel
              <input name="streamerIdentifier" data-stream-identifier maxlength="64" placeholder="Twitch username" required>
              <small data-stream-help>Twitch username without @.</small>
            </label>
            <label>Discord Announcement Channel
              <select name="discordChannelId" required>${selectOptions(broadcastChannels, '', 'Choose a channel')}</select>
            </label>
            <label>Discord User ID <small>(optional live-role binding)</small>
              <input name="discordUserId" maxlength="32" placeholder="123456789012345678">
            </label>
            <label>Live Role <small>(optional)</small>
              <select name="liveRoleId">${selectOptions(roles, '', 'No live role')}</select>
            </label>
            <label class="stream-message-field">Custom Description Override <small>(optional)</small>
              <textarea name="customMessage" maxlength="1000" rows="3" placeholder="{user} is live on {platform} playing {game}! {url}"></textarea>
            </label>
          </div>
          <div class="token-row"><span>{user}</span><span>{game}</span><span>{title}</span><span>{url}</span><span>{platform}</span></div>
          <div class="stream-form-footer">
            <span>${streamAnnouncements.length >= streamAccess.streamerLimit ? 'This server is at its current streamer limit. Updating an existing matching streamer is still allowed.' : `You can add ${streamAccess.streamerLimit - streamAnnouncements.length} more streamer${streamAccess.streamerLimit - streamAnnouncements.length === 1 ? '' : 's'}.`}</span>
            <button class="btn twitch-btn" type="submit">＋ Add / Update Streamer</button>
          </div>
        </form>

        <div class="stream-unified-block">
          <div class="stream-subheading">
            <div>
              <span class="mini-label">CONFIGURED STREAMERS</span>
              <h3>Your Stream Alerts</h3>
            </div>
          </div>
          <div class="stream-list">${streamCards}</div>
        </div>

        <div class="stream-unified-block stream-embed-unified">
          <div class="stream-subheading">
            <div>
              <span class="mini-label">EMBED SETTINGS</span>
              <h3><span data-stream-embed-heading>Twitch</span> Go-Live Embed</h3>
              <p>The Streaming Service dropdown above also selects which provider embed you are editing.</p>
            </div>
          </div>
          <div class="stream-single-editor">${streamEmbedEditors}</div>
        </div>
      </section>

      <section id="commands" class="panel command-panel">
        <div class="panel-heading-row">
          <div>
            <span class="eyebrow">COMMAND CENTER</span>
            <h2>Command Modules</h2>
            <p>All loaded command modules, grouped by category directly from MultiBot's command registry.</p>
          </div>
          <span class="command-total">${catalog.length} loaded</span>
        </div>
        ${commandGroups}
      </section>

      <section id="tickets" class="panel"><h2>Recent Tickets</h2><div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Type</th><th>Status</th><th>Claimed By</th><th>Close Reason</th><th>Created</th><th>Transcript</th></tr></thead><tbody>${transcriptRows}</tbody></table></div></section>`;
      res.send(page(`${guild.name} Settings • Kryndexa Bot`, form, req.session.user, {
        path: `/dashboard/${guild.id}`,
        private: true,
        description: `Configure Kryndexa Bot settings and modules for ${guild.name}.`,
      }));
    } catch (error) {
      console.error(error);
      res.status(500).send(page('Dashboard error', `<div class="empty"><strong>Unable to load server settings.</strong><p>${process.env.NODE_ENV === 'production' ? 'Check the MySQL connection and schema.' : escapeHtml(error.message || String(error))}</p></div>`, req.session.user));
    }
  });

  app.post('/dashboard/:guildId', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');
      const currentSettings = await getGuildSettings(req.params.guildId);
      await saveGuildSettings(req.params.guildId, {
        ...currentSettings,
        prefix: String(req.body.prefix || '!').trim().slice(0, 5) || '!',
        welcomeChannelId: req.body.welcomeChannelId || '',
        leaveChannelId: req.body.leaveChannelId || '',
        logsChannelId: req.body.logsChannelId || '',
        verificationLogChannelId: req.body.verificationLogChannelId || '',
        roleLogChannelId: req.body.roleLogChannelId || '',
        broadcastChannelId: req.body.broadcastChannelId || '',
        verificationChannelId: req.body.verificationChannelId || '',
        verifiedRoleId: req.body.verifiedRoleId || '',
        unverifiedRoleId: req.body.unverifiedRoleId || '',
        ticketsCategoryId: req.body.ticketsCategoryId || '',
        ticketPanelChannelId: req.body.ticketPanelChannelId || '',
        ticketStaffRoleId: req.body.ticketStaffRoleId || '',
        loggingEnabled: req.body.loggingEnabled === 'on',
        welcomeEnabled: req.body.welcomeEnabled === 'on',
        verificationEnabled: req.body.verificationEnabled === 'on',
        prefixCommandsEnabled: req.body.prefixCommandsEnabled === 'on',
      });
      res.redirect(`/dashboard/${req.params.guildId}`);
    } catch (error) {
      console.error(error);
      res.status(500).send(page('Dashboard error', `<div class="empty"><strong>Unable to save server settings.</strong><p>${process.env.NODE_ENV === 'production' ? 'Check the MySQL connection and schema.' : escapeHtml(error.message || String(error))}</p></div>`, req.session.user));
    }
  });

  app.post('/dashboard/:guildId/automations', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).send('MultiBot is no longer connected to this server.');

      const triggerType = String(req.body.triggerType || '');
      const actionType = String(req.body.actionType || '');
      if (!['member_join', 'message_contains'].includes(triggerType)) return res.status(400).send('Invalid automation trigger.');
      if (!['send_message', 'dm_user', 'add_role'].includes(actionType)) return res.status(400).send('Invalid automation action.');

      const actionChannelId = String(req.body.actionChannelId || '');
      const actionRoleId = String(req.body.actionRoleId || '');
      if (actionChannelId && !guild.channels.cache.has(actionChannelId)) return res.status(400).send('Invalid automation channel.');
      if (actionRoleId && !guild.roles.cache.has(actionRoleId)) return res.status(400).send('Invalid automation role.');

      await createAutomationRule(guild.id, {
        name: req.body.name,
        triggerType,
        triggerValue: req.body.triggerValue,
        actionType,
        actionChannelId,
        actionRoleId,
        actionMessage: req.body.actionMessage,
      });

      return res.redirect(`/dashboard/${guild.id}#features`);
    } catch (error) {
      console.error(error);
      return res.status(500).send(page('Dashboard error', `<div class="empty"><strong>Unable to create automation.</strong><p>${escapeHtml(error.message || String(error))}</p></div>`, req.session.user));
    }
  });

  app.post('/dashboard/:guildId/automations/:id/delete', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');
      await deleteAutomationRule(req.params.guildId, req.params.id);
      return res.redirect(`/dashboard/${req.params.guildId}#features`);
    } catch (error) {
      console.error(error);
      return res.status(500).send('Unable to delete automation rule.');
    }
  });

  app.post('/dashboard/:guildId/settings/toggle', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');
      const allowed = new Set(['ticketsEnabled','onlineTranscriptsEnabled','transcriptAttachmentsEnabled','loggingEnabled','welcomeEnabled','verificationEnabled','prefixCommandsEnabled']);
      const setting = String(req.body.setting || '');
      if (!allowed.has(setting)) return res.status(400).send('Unknown setting.');
      const enabled = req.body.enabled === '1';
      const current = await getGuildSettings(req.params.guildId);
      await saveGuildSettings(req.params.guildId, { ...current, [setting]: enabled });

      const linkedFeatures = {
        ticketsEnabled: 'tickets',
        loggingEnabled: 'logging',
        welcomeEnabled: 'welcome',
      };
      const linkedFeatureKey = linkedFeatures[setting];
      if (linkedFeatureKey) {
        const featureState = (await getGuildFeatures(req.params.guildId)).find((state) => state.key === linkedFeatureKey);
        await saveFeature(req.params.guildId, linkedFeatureKey, {
          enabled,
          config: featureState?.config || {},
        });
      }

      return res.status(204).end();
    } catch (error) {
      console.error(error);
      return res.status(500).send(error.message || 'Unable to save setting.');
    }
  });
  app.post('/dashboard/:guildId/features/:featureKey/toggle', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');
      const definition = getFeatureDefinition(req.params.featureKey);
      if (!definition) return res.status(400).send('Unknown feature.');
      const current = (await getGuildFeatures(req.params.guildId)).find((state) => state.key === definition.key);
      const enabled = definition.locked ? true : req.body.enabled === '1';
      await saveFeature(req.params.guildId, definition.key, {
        enabled,
        config: current?.config || {},
      });

      const linkedSettings = {
        tickets: 'ticketsEnabled',
        logging: 'loggingEnabled',
        welcome: 'welcomeEnabled',
      };
      const linkedSetting = linkedSettings[definition.key];
      if (linkedSetting) {
        const settings = await getGuildSettings(req.params.guildId);
        await saveGuildSettings(req.params.guildId, { ...settings, [linkedSetting]: enabled });
      }

      return res.status(204).end();
    } catch (error) {
      console.error(error);
      return res.status(500).send(error.message || 'Unable to save module state.');
    }
  });

  app.post('/dashboard/:guildId/commands/:commandName/toggle', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');
      const command = commandCatalog().find((item) => item.name === req.params.commandName);
      if (!command) return res.status(400).send('Unknown command.');
      if (command.ownerOnly) return res.status(403).send('Owner-only commands cannot be managed from a server dashboard.');
      await setCommandEnabled(req.params.guildId, req.params.commandName, req.body.enabled === '1');
      return res.status(204).end();
    } catch (error) {
      console.error(error);
      return res.status(500).send(error.message || 'Unable to save command state.');
    }
  });

  app.post('/dashboard/:guildId/tickets/types/:typeKey/toggle', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');
      const allowedTypes = new Set(DEFAULT_TICKET_TYPES.map((type) => type.key));
      if (!allowedTypes.has(req.params.typeKey)) return res.status(400).send('Unknown ticket type.');
      await saveTicketType(req.params.guildId, req.params.typeKey, { enabled: req.body.enabled === '1' });
      return res.status(204).end();
    } catch (error) {
      console.error(error);
      return res.status(500).send(error.message || 'Unable to save ticket module state.');
    }
  });
  app.post('/dashboard/:guildId/features/:featureKey', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');

      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).send('MultiBot is no longer connected to this server.');

      const definition = getFeatureDefinition(req.params.featureKey);
      if (!definition) return res.status(400).send('Unknown feature.');

      const current = (await getGuildFeatures(guild.id)).find((state) => state.key === definition.key);
      const config = { ...(current?.config || {}) };

      for (const field of definition.fields || []) {
        const input = req.body[`cfg_${field.key}`];

        if (field.type === 'boolean') {
          config[field.key] = input === 'on';
          continue;
        }

        if (field.type === 'number') {
          let value = Number(input);
          if (!Number.isFinite(value)) value = Number(field.default || 0);
          if (field.min != null) value = Math.max(field.min, value);
          if (field.max != null) value = Math.min(field.max, value);
          config[field.key] = value;
          continue;
        }

        const value = String(input || '').trim();

        if (field.type === 'role' && value && !guild.roles.cache.has(value)) {
          return res.status(400).send(`Invalid role for ${field.label}.`);
        }

        if (field.type === 'category' && value) {
          const category = guild.channels.cache.get(value);
          if (!category || category.type !== ChannelType.GuildCategory) return res.status(400).send(`Invalid category for ${field.label}.`);
        }

        if (field.type === 'channel' && value) {
          const channel = guild.channels.cache.get(value);
          if (!channel) return res.status(400).send(`Invalid channel for ${field.label}.`);
          if (field.channelKind === 'voice' && channel.type !== ChannelType.GuildVoice) return res.status(400).send(`${field.label} must be a voice channel.`);
        }

        config[field.key] = value.slice(0, 2000);
      }

      await saveFeature(guild.id, definition.key, {
        enabled: definition.locked ? true : req.body.enabled === 'on',
        config,
      });

      return res.redirect(`/dashboard/${guild.id}#features`);
    } catch (error) {
      console.error(error);
      return res.status(500).send(page('Dashboard error', `<div class="empty"><strong>Unable to save feature settings.</strong><p>${escapeHtml(error.message || String(error))}</p></div>`, req.session.user));
    }
  });

  app.post('/dashboard/:guildId/tickets/types/:typeKey', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');

      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).send('MultiBot is no longer connected to this server.');

      const allowedTypes = new Set(DEFAULT_TICKET_TYPES.map((type) => type.key));
      if (!allowedTypes.has(req.params.typeKey)) return res.status(400).send('Unknown ticket type.');

      const categoryId = String(req.body.categoryId || '');
      if (categoryId) {
        const category = guild.channels.cache.get(categoryId);
        if (!category || category.type !== ChannelType.GuildCategory) return res.status(400).send('Choose a valid Discord category.');
      }

      const staffRoleId = String(req.body.staffRoleId || '');
      if (staffRoleId && !guild.roles.cache.has(staffRoleId)) return res.status(400).send('Choose a valid Discord role.');

      await saveTicketType(guild.id, req.params.typeKey, {
        label: req.body.label,
        description: req.body.description,
        emoji: req.body.emoji,
        enabled: req.body.enabled === 'on',
        categoryId,
        staffRoleId,
      });

      return res.redirect(`/dashboard/${guild.id}#ticket-config`);
    } catch (error) {
      console.error(error);
      return res.status(500).send(page(
        'Dashboard error',
        `<div class="empty"><strong>Unable to save ticket department.</strong><p>${escapeHtml(error.message || String(error))}</p></div>`,
        req.session.user,
      ));
    }
  });

  app.post('/dashboard/:guildId/tickets/settings', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');
      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).send('MultiBot is no longer connected to this server.');

      const transcriptChannelId = String(req.body.transcriptChannelId || '');
      if (transcriptChannelId) {
        const channel = guild.channels.cache.get(transcriptChannelId);
        if (!channel?.isTextBased()) return res.status(400).send('Choose a valid transcript text channel.');
      }

      const currentSettings = await getGuildSettings(guild.id);
      await saveGuildSettings(guild.id, {
        ...currentSettings,
        transcriptChannelId,
        maxOpenTicketsPerUser: Math.max(1, Math.min(25, Number(req.body.maxOpenTicketsPerUser || 3))),
      });
      return res.redirect(`/dashboard/${guild.id}#ticket-config`);
    } catch (error) {
      console.error(error);
      return res.status(500).send(page('Dashboard error', `<div class="empty"><strong>Unable to save ticket settings.</strong><p>${escapeHtml(error.message || String(error))}</p></div>`, req.session.user));
    }
  });
  app.post('/dashboard/:guildId/tickets/panel', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');

      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).send('MultiBot is no longer connected to this server.');

      const channelId = String(req.body.ticketPanelChannelId || '');
      const channel = guild.channels.cache.get(channelId);
      if (!channel || channel.type !== ChannelType.GuildText) return res.status(400).send('Choose a valid Discord text channel.');

      const currentSettings = await getGuildSettings(guild.id);
      await saveGuildSettings(guild.id, { ...currentSettings, ticketPanelChannelId: channel.id });
      await postTicketPanel(channel);

      return res.redirect(`/dashboard/${guild.id}#ticket-config`);
    } catch (error) {
      console.error(error);
      return res.status(500).send(page(
        'Dashboard error',
        `<div class="empty"><strong>Unable to post ticket panel.</strong><p>${escapeHtml(error.message || String(error))}</p></div>`,
        req.session.user,
      ));
    }
  });

  app.post('/dashboard/:guildId/streams', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');

      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).send('Kryndexa Bot is no longer connected to this server.');

      const channel = guild.channels.cache.get(String(req.body.discordChannelId || ''));
      if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        return res.status(400).send('Choose a valid Discord text or announcement channel.');
      }

      const roleId = String(req.body.liveRoleId || '').trim();
      if (roleId && !guild.roles.cache.has(roleId)) return res.status(400).send('Choose a valid Discord live role.');

      const discordUserId = String(req.body.discordUserId || '').trim();
      if (discordUserId && !/^\d{10,32}$/.test(discordUserId)) return res.status(400).send('Enter a valid Discord user ID for the live-role binding.');

      await upsertStreamAnnouncement({
        guildId: guild.id,
        platform: req.body.platform,
        streamerIdentifier: req.body.streamerIdentifier,
        discordChannelId: channel.id,
        customMessage: req.body.customMessage || '',
        discordUserId,
        liveRoleId: roleId,
        createdBy: req.session.user.id,
      });

      return res.redirect(`/dashboard/${guild.id}#stream-alerts`);
    } catch (error) {
      console.error(error);
      const status = error?.code === 'STREAMER_LIMIT_REACHED' ? 409 : 500;
      const heading = error?.code === 'STREAMER_LIMIT_REACHED'
        ? 'Streamer limit reached'
        : 'Unable to save stream alert';
      return res.status(status).send(page(
        `${heading} • Kryndexa Bot`,
        `<div class="empty"><strong>${escapeHtml(heading)}.</strong><p>${escapeHtml(error.message || String(error))}</p><p><a class="btn secondary" href="/dashboard/${encodeURIComponent(req.params.guildId)}#stream-alerts">Return to Stream Alerts</a></p></div>`,
        req.session.user,
        { private: true },
      ));
    }
  });

  app.post('/dashboard/:guildId/streams/:id/delete', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');

      await deleteStreamAnnouncement(req.params.guildId, req.params.id);
      return res.redirect(`/dashboard/${req.params.guildId}#stream-alerts`);
    } catch (error) {
      console.error(error);
      return res.status(500).send('Unable to remove stream alert.');
    }
  });

  app.post('/dashboard/:guildId/streams/embed/:embedKey', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');

      const key = String(req.params.embedKey || '');
      if (!['twitch_live', 'youtube_live', 'kick_live'].includes(key) || !EMBED_MODULES[key]) {
        return res.status(400).send('Unknown stream embed module.');
      }

      const imageUrl = String(req.body.imageUrl || '').trim();
      const thumbnailUrl = String(req.body.thumbnailUrl || '').trim();
      if (imageUrl && !/^https?:\/\//i.test(imageUrl)) return res.status(400).send('Image URL must use http:// or https://.');
      if (thumbnailUrl && !/^https?:\/\//i.test(thumbnailUrl)) return res.status(400).send('Thumbnail URL must use http:// or https://.');

      const fields = [];
      for (let index = 0; index < 5; index += 1) {
        const name = String(req.body[`fieldName_${index}`] || '').trim();
        const value = String(req.body[`fieldValue_${index}`] || '').trim();
        if (!name || !value) continue;
        fields.push({
          name,
          value,
          inline: req.body[`fieldInline_${index}`] === 'on',
        });
      }

      await saveEmbedConfig(req.params.guildId, key, {
        title: req.body.title,
        description: req.body.description,
        color: req.body.color,
        footer: req.body.footer,
        imageUrl,
        thumbnailUrl,
        fieldsEnabled: req.body.fieldsEnabled === 'on',
        fields,
      });

      return res.redirect(`/dashboard/${req.params.guildId}#stream-alerts`);
    } catch (error) {
      console.error(error);
      return res.status(500).send(page(
        'Embed settings error • Kryndexa Bot',
        `<div class="empty"><strong>Unable to save the stream embed.</strong><p>${escapeHtml(error.message || String(error))}</p></div>`,
        req.session.user,
        { private: true },
      ));
    }
  });
  app.get('/transcripts/:ticketId/view', requireAuth, async (req, res) => {
    try {
      const ticket = await getTicket(req.params.ticketId);
      if (!ticket?.transcriptHtml) return res.status(404).send('Transcript not found.');
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === ticket.guildId)) return res.status(403).send('You cannot access this transcript.');
      const settings = await getGuildSettings(ticket.guildId);
      if (!settings.onlineTranscriptsEnabled) return res.status(404).send('Online transcripts are disabled for this server.');

      let token = ticket.transcriptPublicToken;
      if (!token) {
        token = crypto.randomBytes(32).toString('hex');
        await updateTicket(ticket.id, { transcriptPublicToken: token });
      }

      return res.redirect(302, `/transcripts/public/${token}`);
    } catch (error) {
      console.error(error);
      return res.status(500).send('Unable to open transcript.');
    }
  });
  app.get('/transcripts/public/:token', async (req, res) => {
    try {
      const ticket = await getTicketByPublicToken(String(req.params.token || ''));
      if (!ticket?.transcriptHtml) return res.status(404).send('Transcript not found.');
      const settings = await getGuildSettings(ticket.guildId);
      if (!settings.onlineTranscriptsEnabled) return res.status(404).send('Online transcripts are disabled for this server.');

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', 'inline');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('Referrer-Policy', 'no-referrer');
      res.setHeader('Content-Security-Policy', "default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'");
      return res.send(ticket.transcriptHtml);
    } catch (error) {
      console.error(error);
      return res.status(500).send('Unable to view transcript.');
    }
  });
  app.get('/transcripts/:ticketId', requireAuth, async (req, res) => {
    try {
      const ticket = await getTicket(req.params.ticketId);
      if (!ticket?.transcriptHtml) return res.status(404).send('Transcript not found.');
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === ticket.guildId)) return res.status(403).send('You cannot access this transcript.');
      const safeName = (ticket.transcriptFile || `ticket-${ticket.id}.html`).replace(/[^a-zA-Z0-9._-]/g, '_');
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
      return res.send(ticket.transcriptHtml);
    } catch (error) {
      console.error(error);
      res.status(500).send('Unable to download transcript.');
    }
  });

  app.get('/health', async (_req, res) => {
    let database = false;
    try {
      database = await pingDatabase();
    } catch {
      database = false;
    }
    res.status(database && client.isReady() ? 200 : 503).json({
      ok: database && client.isReady(),
      botReady: client.isReady(),
      database,
      guilds: client.guilds.cache.size,
    });
  });

  const port = Number(process.env.PORT || 3000);
  const host = String(process.env.WEB_HOST || '0.0.0.0').trim() || '0.0.0.0';

  console.log(`[Dashboard] Starting web panel on ${host}:${port}...`);

  const server = app.listen(port, host);

  server.once('listening', () => {
    const localHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;
    console.log(`[Dashboard] Web panel listening on http://${localHost}:${port}`);

    if (host === '0.0.0.0' || host === '::') {
      console.log('[Dashboard] Web panel is bound to all network interfaces.');
    }

    const publicUrl = String(process.env.BASE_URL || '').trim();
    if (publicUrl) console.log(`[Dashboard] Configured public URL: ${publicUrl}`);
  });

  server.on('error', (error) => {
    if (error?.code === 'EADDRINUSE') {
      console.error(`[Dashboard] Cannot start web panel: ${host}:${port} is already in use.`);
      console.error('[Dashboard] Change PORT/WEB_HOST or stop the process using that address and port.');
      return;
    }

    console.error('[Dashboard] HTTP server error:', error);
  });

  return server;
}

module.exports = { startDashboard };
