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
  normalizeIdentifier,
  listTwitchAnnouncements,
  upsertTwitchAnnouncement,
  deleteTwitchAnnouncement,
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
const { getAnalytics } = require('../features/dataStore');

const DISCORD_API = 'https://discord.com/api/v10';
const GUILD_CACHE_TTL_MS = 60_000;
const guildListRequests = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function renderAddBotButton() {
  const clientId = String(process.env.DISCORD_CLIENT_ID || '').trim();
  if (!clientId) return '';

  const installUrl = `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(clientId)}&permissions=8&scope=bot%20applications.commands`;
  return `<a class="btn add-bot-button" href="${escapeHtml(installUrl)}" target="_blank" rel="noreferrer">＋ Add Bot to Server</a>`;
}

function page(title, body, user) {
  const auth = user
    ? `<div class="user"><span>${escapeHtml(user.username)}</span><a class="btn secondary compact" href="/logout">Log out</a></div>`
    : '<a class="btn compact" href="/login">Login with Discord</a>';

  const addBotButton = renderAddBotButton();

  const cookieNotice = `<div id="cookieNotice" class="cookie-notice" role="dialog" aria-live="polite" aria-label="Cookie consent">
    <div class="cookie-copy">
      <strong id="cookieTitle">Cookie consent</strong>
      <p id="cookieText">MultiBot uses an essential session cookie for Discord dashboard sign-in, OAuth security, and CSRF protection. No advertising cookies are used.</p>
    </div>
    <div class="cookie-actions">
      <a class="btn secondary" href="/privacy#cookies">Cookie details</a>
      <button id="cookieDecline" class="btn secondary" type="button">Decline</button>
      <button id="cookieAccept" class="btn" type="button">Accept essential cookies</button>
    </div>
  </div>`;

  return `<!doctype html><html lang="en" data-theme="dark"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<script>(()=>{try{const saved=localStorage.getItem('multibot-theme');const preferred=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';document.documentElement.dataset.theme=saved||preferred;}catch{}})();</script>
<link rel="icon" type="image/png" href="/favicon.ico"><link rel="apple-touch-icon" href="/favicon.ico"><link rel="stylesheet" href="/style.css">
</head><body>
<header class="site-header"><div class="header-inner">
  <a class="brand" href="/">Kryndexa Bot</a>
  <button class="nav-toggle" type="button" data-site-nav-toggle aria-label="Toggle navigation">☰</button>
  <nav class="site-nav" data-site-nav aria-label="Primary navigation">
    <a href="/">Home</a><a href="/features">Features</a>
    ${user ? '<a href="/dashboard">Dashboard</a><a href="/dashboard/statistics">Server Statistics</a>' : ''}
    <a href="/privacy">Privacy</a><a href="/terms">Terms</a>
  </nav>
  <div class="header-actions">${addBotButton}<button class="theme-toggle" type="button" data-theme-toggle aria-label="Toggle color theme"><span data-theme-icon>◐</span></button><div class="header-auth">${auth}</div></div>
</div></header>
<main>${body}</main>
<div id="dashboardToast" class="dashboard-toast" role="status" aria-live="polite"></div>
<footer><div class="footer-inner"><strong>Kryndexa Bot</strong><span>One Bot. Every Tool. Total Control.</span><nav><a href="/features">Features</a> • <a href="/privacy">Privacy</a> • <a href="/terms">Terms</a></nav></div></footer>
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
  const getConsent=()=>{const match=document.cookie.match(/(?:^|; )multibot_cookie_consent=([^;]+)/);return match?decodeURIComponent(match[1]):'';};
  const refreshConsent=()=>{const loginNeedsConsent=new URLSearchParams(location.search).get('cookie')==='required';if(loginNeedsConsent){notice?.classList.remove('is-hidden');return;}if(['essential','declined'].includes(getConsent()))notice?.classList.add('is-hidden');};
  const setConsent=async(choice)=>{const r=await fetch('/cookie-consent/'+choice,{method:'POST',credentials:'same-origin'});if(r.ok)notice?.classList.add('is-hidden');};
  document.getElementById('cookieAccept')?.addEventListener('click',()=>setConsent('accept'));
  document.getElementById('cookieDecline')?.addEventListener('click',()=>setConsent('decline'));
  document.querySelectorAll('a[href="/login"]').forEach(link=>link.addEventListener('click',event=>{if(getConsent()==='essential')return;event.preventDefault();notice?.classList.remove('is-hidden');}));

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
    const update=()=>{if(!input||!help)return;if(select.value==='youtube'){input.placeholder='UCxxxxxxxxxxxxxxxxxxxxxx';help.textContent='Use the YouTube channel ID.';}
      else if(select.value==='kick'){input.placeholder='Broadcaster ID or channel slug';help.textContent='Use a Kick broadcaster ID or channel slug.';}
      else{input.placeholder='Twitch username';help.textContent='Twitch username without @.';}};
    select.addEventListener('change',update);update();
  });

  document.querySelectorAll('[data-embed-editor]').forEach(editor=>{
    const preview=editor.querySelector('[data-embed-preview]');if(!preview)return;
    const update=()=>{const val=(sel)=>editor.querySelector(sel)?.value||'';preview.style.setProperty('--embed-color',val('[data-embed-color]')||'#5865F2');
      preview.querySelector('[data-preview-title]').textContent=val('[data-embed-title]')||'Embed title';
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

function oauthUrl(state) {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify guilds',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
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

function startDashboard(client) {
  const addBotButton = renderAddBotButton();
  const app = express();
  app.disable('x-powered-by');
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
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
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 },
  }));

  app.get('/favicon.ico', (_req, res) => {
    if (!client.user) return res.status(204).end();
    return res.redirect(302, client.user.displayAvatarURL({ extension: 'png', size: 64 }));
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
      <div class="hero-console"><span>COMMAND CENTER</span><strong>Kryndexa Bot</strong><div class="hero-console-grid"><i>Advanced Tickets</i><i>Server Analytics</i><i>Streaming Alerts</i><i>AutoMod</i><i>Music</i><i>Encrypted Settings</i></div></div>
    </section>`;
    res.send(page('Kryndexa Bot', body, req.session.user));
  });

  app.get('/features', (req, res) => {
    const categoryOrder = [...new Set(FEATURE_CATALOG.map((feature) => feature.category))];
    const cards = categoryOrder.map((category) => {
      const features = FEATURE_CATALOG.filter((feature) => feature.category === category);
      return `<section class="public-feature-section"><div class="category-heading"><h2>${escapeHtml(category)}</h2><span>${features.length} module${features.length === 1 ? '' : 's'}</span></div><div class="public-feature-grid">${features.map((feature) => `<article class="public-feature-card"><div class="public-feature-top"><div class="feature-icon">${escapeHtml(feature.icon)}</div><div><span class="mini-label">${escapeHtml(feature.priority)} priority</span><h3>${escapeHtml(feature.title)}</h3></div></div><p>${escapeHtml(feature.description)}</p><div class="public-feature-meta"><span>${feature.locked ? 'Always enabled' : feature.defaultEnabled ? 'Enabled by default' : 'Server configurable'}</span><small>${escapeHtml(feature.requirement || 'Configured directly from the server dashboard.')}</small></div></article>`).join('')}</div></section>`;
    }).join('');

    const body = `<section class="features-hero"><span class="eyebrow">FEATURES</span><h1>One dashboard for every server tool.</h1><p>Explore Kryndexa Bot's moderation, community, support, analytics, voice, automation and integration modules.</p><div class="actions">${req.session.user ? '<a class="btn" href="/dashboard">Configure Your Servers</a>' : '<a class="btn" href="/login">Login to Dashboard</a>'} ${addBotButton}</div></section><section class="public-feature-summary"><div><strong>${FEATURE_CATALOG.length}</strong><span>Feature Modules</span></div><div><strong>44+</strong><span>Commands</span></div><div><strong>3</strong><span>Streaming Providers</span></div><div><strong>24/7</strong><span>Control Center</span></div></section>${cards}`;
    return res.send(page('Features • Kryndexa Bot', body, req.session.user));
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

    res.send(page('Privacy Policy • MultiBot', body, req.session.user));
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

    res.send(page('Terms of Service • MultiBot', body, req.session.user));
  });

  app.post('/cookie-consent/accept', (req, res) => {
    res.cookie('multibot_cookie_consent', 'essential', {
      httpOnly: false,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 365 * 24 * 60 * 60 * 1000,
    });
    return res.status(204).end();
  });

  app.post('/cookie-consent/decline', (req, res) => {
    const finish = () => {
      res.clearCookie('multibot.sid', {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
      });
      res.cookie('multibot_cookie_consent', 'declined', {
        httpOnly: false,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 365 * 24 * 60 * 60 * 1000,
      });
      return res.status(204).end();
    };

    if (req.session) return req.session.destroy(() => finish());
    return finish();
  });

  app.get('/login', (req, res) => {
    const consent = parseCookies(req).multibot_cookie_consent;
    if (consent !== 'essential') return res.redirect('/?cookie=required');

    req.session.oauthState = crypto.randomBytes(24).toString('hex');
    res.redirect(oauthUrl(req.session.oauthState));
  });

  app.get('/auth/callback', async (req, res) => {
    try {
      if (!req.query.code || req.query.state !== req.session.oauthState) return res.status(400).send('Invalid OAuth state.');
      const body = new URLSearchParams({
        client_id: process.env.DISCORD_CLIENT_ID,
        client_secret: process.env.DISCORD_CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(req.query.code),
        redirect_uri: process.env.DISCORD_REDIRECT_URI,
      });
      const tokenRes = await fetch(`${DISCORD_API}/oauth2/token`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
      if (!tokenRes.ok) throw new Error(`OAuth token exchange failed: ${tokenRes.status}`);
      const token = await tokenRes.json();
      const user = await discordFetch('/users/@me', token.access_token);
      req.session.user = { id: user.id, username: user.global_name || user.username, avatar: user.avatar };
      req.session.accessToken = token.access_token;
      req.session.csrf = crypto.randomBytes(24).toString('hex');
      delete req.session.guildCache;
      delete req.session.oauthState;
      res.redirect('/dashboard');
    } catch (error) {
      console.error(error);
      res.status(500).send('Discord login failed.');
    }
  });

  app.get('/logout', (req, res) => req.session.destroy(() => res.redirect('/')));

  app.get('/dashboard', requireAuth, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      const connected = guilds.map((managed) => client.guilds.cache.get(managed.id)).filter(Boolean);
      const totalMembers = connected.reduce((sum, guild) => sum + guild.memberCount, 0);

      const cards = guilds.length ? guilds.map((managed) => {
        const guild = client.guilds.cache.get(managed.id);
        const icon = managed.icon
          ? `<img src="https://cdn.discordapp.com/icons/${managed.id}/${managed.icon}.png?size=128" alt="">`
          : escapeHtml(managed.name.slice(0, 2).toUpperCase());
        return `<article class="guild-card friendly-guild-card" data-guild-card data-guild-search="${escapeHtml((managed.name + ' ' + managed.id).toLowerCase())}">
          <div class="guild-card-main"><div class="guild-icon">${icon}</div><div class="guild-card-copy"><strong>${escapeHtml(managed.name)}</strong><small>${(guild?.memberCount || 0).toLocaleString()} members • ${guild?.channels.cache.size || 0} channels</small></div></div>
          <div class="guild-card-actions"><a class="btn" href="/dashboard/${managed.id}">Configure</a><a class="btn secondary" href="/dashboard/statistics#guild-${managed.id}">View Stats</a></div>
        </article>`;
      }).join('') : '<div class="empty">No servers found where you have Manage Server and Kryndexa Bot is installed.</div>';

      const body = `<section class="dashboard-home-hero"><div><span class="eyebrow">YOUR COMMAND CENTER</span><h1>Your Servers</h1><p>Choose a server to configure or compare activity across all servers you manage.</p></div><a class="btn secondary" href="/dashboard/statistics">Server Statistics</a></section>
        <section class="dashboard-home-stats"><div><strong>${guilds.length}</strong><span>Managed Servers</span></div><div><strong>${totalMembers.toLocaleString()}</strong><span>Total Members</span></div><div><strong>${client.guilds.cache.size.toLocaleString()}</strong><span>Bot Servers</span></div></section>
        <div class="dashboard-toolbar"><label class="server-search"><span>🔎</span><input type="search" placeholder="Search servers by name or ID" data-filter-selector="[data-guild-card]" data-filter-attribute="data-guild-search" data-filter-empty="#dashboardSearchEmpty"></label><span>Select a server to configure.</span></div>
        <div class="guild-grid friendly-guild-grid">${cards}</div><div id="dashboardSearchEmpty" class="search-empty-state" hidden>No servers match your search.</div>`;
      return res.send(page('Dashboard • Kryndexa Bot', body, req.session.user));
    } catch (error) {
      console.error(error);
      if (error.status === 429) return res.status(503).send(page('Discord rate limit', '<div class="empty">Discord is temporarily rate limiting dashboard access. Refresh shortly.</div>', req.session.user));
      if (error.status === 401) return res.status(401).send(page('Session expired', '<div class="empty">Your Discord session expired. <a href="/login">Log in again</a>.</div>'));
      return res.status(500).send(page('Dashboard error', '<div class="empty">The dashboard could not load your server list.</div>', req.session.user));
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
      return res.send(page('Server Statistics • Kryndexa Bot', body, req.session.user));
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
      const [settings, tickets, twitchAnnouncements, ticketTypes, featureStates, automationRules] = await Promise.all([
        getGuildSettings(guild.id),
        listGuildTickets(guild.id),
        listTwitchAnnouncements(guild.id),
        listTicketTypes(guild.id),
        getGuildFeatures(guild.id),
        listAutomationRules(guild.id),
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

          return `<form class="feature-card priority-${escapeHtml(feature.priority.toLowerCase().replace(/[^a-z]+/g, '-'))} ${state.enabled ? 'feature-enabled' : ''}" data-feature-card data-feature-search="${escapeHtml((feature.title + ' ' + feature.description + ' ' + feature.category + ' ' + feature.priority).toLowerCase())}" method="post" action="/dashboard/${guild.id}/features/${encodeURIComponent(feature.key)}">
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

      const twitchCards = twitchAnnouncements.length
        ? twitchAnnouncements.map((item) => {
            const targetChannel = guild.channels.cache.get(item.discordChannelId);
            const channelName = targetChannel?.name ? `#${targetChannel.name}` : 'Channel unavailable';
            const lastAnnounced = item.lastAnnouncedAt
              ? new Date(item.lastAnnouncedAt).toLocaleString()
              : 'Never';
            const customMessage = item.customMessage
              ? escapeHtml(item.customMessage)
              : 'Using the default rich Twitch embed message';

            return `<article class="twitch-card ${item.isLive ? 'is-live' : ''}">
              <div class="twitch-card-top">
                <div class="twitch-avatar">T</div>
                <div class="twitch-identity">
                  <a class="twitch-name" href="https://www.twitch.tv/${encodeURIComponent(item.twitchLogin)}" target="_blank" rel="noreferrer">${escapeHtml(item.twitchLogin)}</a>
                  <span class="status-badge ${item.isLive ? 'live' : 'offline'}"><span class="status-dot"></span>${item.isLive ? 'LIVE' : 'Offline'}</span>
                </div>
                <form method="post" action="/dashboard/${guild.id}/twitch/${item.id}/delete" onsubmit="return confirm('Remove this Twitch announcement?')">
                  <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrf)}">
                  <button class="icon-btn danger" type="submit" title="Remove Twitch alert">×</button>
                </form>
              </div>
              <div class="twitch-card-grid">
                <div><span class="mini-label">Discord channel</span><strong>${escapeHtml(channelName)}</strong></div>
                <div><span class="mini-label">Last announced</span><strong>${escapeHtml(lastAnnounced)}</strong></div>
              </div>
              <div class="twitch-message-preview">
                <span class="mini-label">Announcement message</span>
                <p>${customMessage}</p>
              </div>
              <div class="twitch-card-footer">
                <span class="pill subtle">${item.enabled ? 'Enabled' : 'Disabled'}</span>
                <a href="https://www.twitch.tv/${encodeURIComponent(item.twitchLogin)}" target="_blank" rel="noreferrer">Open Twitch ↗</a>
              </div>
            </article>`;
          }).join('')
        : '<div class="empty twitch-empty">No Twitch live announcements configured yet.</div>';

      const catalog = commandCatalog();
      const commandStates = await getCommandStateObject(guild.id, catalog.map((command) => command.name));
      const preferredCategories = ['Moderation','Security','Administration','Tickets','Verification','Roles','Leveling','Applications','Giveaways','Community','Economy','Utility','Analytics','Voice','Integrations','Music','AI Assistant','Automations','Misc','Owner Tools','Other'];
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

          return `<article class="command-card ${commandStates[command.name] !== false ? 'enabled' : 'disabled'}" data-command-card data-command-search="${escapeHtml((command.name + ' ' + command.description + ' ' + category + ' ' + command.subcommands.join(' ')).toLowerCase())}">
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
      const form = `<section class="server-config-hero">
        <div class="server-config-identity">
          <div class="server-config-icon">${guild.icon ? `<img src="https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128" alt="">` : escapeHtml(guild.name.slice(0,2).toUpperCase())}</div>
          <div>
            <a class="back-link" href="/dashboard">← All Servers</a>
            <span class="eyebrow">SERVER CONTROL CENTER</span>
            <h1>${escapeHtml(guild.name)}</h1>
            <p>Configure the server in one place. Toggle switches save automatically; form fields save when you press their button.</p>
          </div>
        </div>
        <div class="server-config-actions">
          <a class="btn secondary" href="/dashboard/statistics#guild-${guild.id}">View Statistics</a>
        </div>
      </section>

      <section class="server-quick-stats" aria-label="Server overview">
        <div><strong>${guild.memberCount.toLocaleString()}</strong><span>Members</span></div>
        <div><strong>${guild.channels.cache.size.toLocaleString()}</strong><span>Channels</span></div>
        <div><strong>${Math.max(0,guild.roles.cache.size-1).toLocaleString()}</strong><span>Roles</span></div>
        <div><strong>${ticketStats.open.toLocaleString()}</strong><span>Open Tickets</span></div>
      </section>

      <nav class="dashboard-jump" aria-label="Server configuration sections">
        <a href="#configuration"><span>⚙️</span>Settings</a>
        <a href="#features"><span>🧩</span>Features</a>
        <a href="#ticket-config"><span>🎫</span>Tickets</a>
        <a href="#twitch"><span>📡</span>Streaming</a>
        <a href="#commands"><span>⌘</span>Commands</a>
        <a href="#tickets"><span>🕘</span>History</a>
      </nav>

      <form id="configuration" class="panel settings-panel" method="post" action="/dashboard/${guild.id}">
        <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrf)}">
        <div class="panel-heading-row settings-heading">
          <div>
            <span class="eyebrow">CORE SETTINGS</span>
            <h2>Server Configuration</h2>
            <p>Common Discord channels and roles used by multiple Kryndexa modules.</p>
          </div>
          <span class="settings-save-note">Form fields save together</span>
        </div>

        <div class="settings-groups">
          <section class="settings-group">
            <div class="settings-group-heading"><div class="settings-group-icon">🏠</div><div><h3>General & Community</h3><p>Basic command and member messaging destinations.</p></div></div>
            <div class="form-grid">
              <label>Command Prefix<input name="prefix" maxlength="5" value="${escapeHtml(settings.prefix)}"></label>
              <label>Owner Broadcast Channel<select name="broadcastChannelId">${selectOptions(broadcastChannels, settings.broadcastChannelId, 'Automatic channel selection')}</select></label>
              <label>Welcome Channel<select name="welcomeChannelId">${selectOptions(textChannels, settings.welcomeChannelId)}</select></label>
              <label>Leave Channel<select name="leaveChannelId">${selectOptions(textChannels, settings.leaveChannelId)}</select></label>
            </div>
          </section>

          <section class="settings-group">
            <div class="settings-group-heading"><div class="settings-group-icon">🛡️</div><div><h3>Logging & Verification</h3><p>Choose where moderation and member verification activity is sent.</p></div></div>
            <div class="form-grid">
              <label>General Logs Channel<select name="logsChannelId">${selectOptions(textChannels, settings.logsChannelId)}</select></label>
              <label>Verification Log Channel<select name="verificationLogChannelId">${selectOptions(textChannels, settings.verificationLogChannelId, 'Use General Logs Channel')}</select></label>
              <label>Role Change Log Channel<select name="roleLogChannelId">${selectOptions(textChannels, settings.roleLogChannelId, 'Use General Logs Channel')}</select></label>
              <label>Verification Channel<select name="verificationChannelId">${selectOptions(textChannels, settings.verificationChannelId)}</select></label>
              <label>Verified Role<select name="verifiedRoleId">${selectOptions(roles, settings.verifiedRoleId)}</select></label>
              <label>Unverified Role<select name="unverifiedRoleId">${selectOptions(roles, settings.unverifiedRoleId)}</select></label>
            </div>
          </section>

          <section class="settings-group">
            <div class="settings-group-heading"><div class="settings-group-icon">🎫</div><div><h3>Ticket Defaults</h3><p>Fallback category, panel channel and staff role for the ticket system.</p></div></div>
            <div class="form-grid">
              <label>Ticket Category<select name="ticketsCategoryId">${selectOptions(categories, settings.ticketsCategoryId)}</select></label>
              <label>Ticket Panel Channel<select name="ticketPanelChannelId">${selectOptions(textChannels, settings.ticketPanelChannelId)}</select></label>
              <label>Ticket Staff Role<select name="ticketStaffRoleId">${selectOptions(roles, settings.ticketStaffRoleId)}</select></label>
            </div>
          </section>
        </div>

        <div class="settings-toggle-section">
          <div class="settings-group-heading"><div class="settings-group-icon">✓</div><div><h3>Core Module Switches</h3><p>These switches autosave as soon as you change them.</p></div></div>
          <div class="checks settings-checks">
            <label><input class="autosave-toggle" type="checkbox" name="loggingEnabled" data-autosave-url="/dashboard/${guild.id}/settings/toggle" data-setting="loggingEnabled" data-csrf="${escapeHtml(req.session.csrf)}" ${settings.loggingEnabled ? 'checked' : ''}> <span><strong>Logging</strong><small>Record important server activity.</small></span></label>
            <label><input class="autosave-toggle" type="checkbox" name="welcomeEnabled" data-autosave-url="/dashboard/${guild.id}/settings/toggle" data-setting="welcomeEnabled" data-csrf="${escapeHtml(req.session.csrf)}" ${settings.welcomeEnabled ? 'checked' : ''}> <span><strong>Welcome Messages</strong><small>Greet new members automatically.</small></span></label>
            <label><input class="autosave-toggle" type="checkbox" name="verificationEnabled" data-autosave-url="/dashboard/${guild.id}/settings/toggle" data-setting="verificationEnabled" data-csrf="${escapeHtml(req.session.csrf)}" ${settings.verificationEnabled ? 'checked' : ''}> <span><strong>Member Verification</strong><small>Use the configured verification flow.</small></span></label>
            <label><input class="autosave-toggle" type="checkbox" name="prefixCommandsEnabled" data-autosave-url="/dashboard/${guild.id}/settings/toggle" data-setting="prefixCommandsEnabled" data-csrf="${escapeHtml(req.session.csrf)}" ${settings.prefixCommandsEnabled ? 'checked' : ''}> <span><strong>Legacy Prefix Commands</strong><small>Allow non-slash command fallbacks.</small></span></label>
          </div>
        </div>
        <div class="settings-footer"><span>Channel, role and prefix changes require this save button.</span><button class="btn" type="submit">Save Server Settings</button></div>
      </form>

      <section id="features" class="panel feature-center-panel">
        <div class="panel-heading-row">
          <div>
            <span class="eyebrow">MULTIBOT FEATURE CENTER</span>
            <h2>Advanced Server Features</h2>
            <p>Enable and configure MultiBot's security, engagement, utility, voice, analytics and integration modules from one place.</p>
          </div>
          <span class="command-total">${featureStates.filter((feature) => feature.enabled).length}/${featureStates.length} enabled</span>
        </div>
        <div class="dashboard-filter-bar">
          <label class="server-search"><span>🔎</span><input type="search" placeholder="Search features by name, category or purpose" data-filter-selector="[data-feature-card]" data-filter-attribute="data-feature-search" data-filter-empty="#featureSearchEmpty"></label>
          <span>Use search to quickly find a module.</span>
        </div>
        <div class="feature-grid">${featureCards}</div>
        <div id="featureSearchEmpty" class="search-empty-state" hidden>No features match your search.</div>

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

      <section id="twitch" class="panel twitch-panel">
        <div class="twitch-hero">
          <div>
            <span class="eyebrow">LIVE INTEGRATION</span>
            <h2>Twitch Live Announcements</h2>
            <p>Automatically post a rich Twitch embed when a configured streamer goes live.</p>
          </div>
          <div class="twitch-logo-badge">Twitch</div>
        </div>

        <form class="twitch-config-form" method="post" action="/dashboard/${guild.id}/twitch">
          <input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrf)}">
          <div class="form-grid">
            <label>Twitch Username
              <input name="twitchLogin" maxlength="25" placeholder="streamername" required>
            </label>
            <label>Discord Announcement Channel
              <select name="discordChannelId" required>${selectOptions(broadcastChannels, '', 'Choose a channel')}</select>
            </label>
            <label style="grid-column:1/-1">Custom Embed Message
              <input name="customMessage" maxlength="500" placeholder="{user} is live playing {game}! {url}">
            </label>
          </div>
          <div class="token-row">
            <span>{user}</span><span>{game}</span><span>{title}</span><span>{url}</span>
          </div>
          <button class="btn twitch-btn" type="submit">＋ Add / Update Streamer</button>
        </form>

        <div class="twitch-cards">${twitchCards}</div>
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
        <div class="dashboard-filter-bar">
          <label class="server-search"><span>🔎</span><input type="search" placeholder="Search commands, categories or subcommands" data-filter-selector="[data-command-card]" data-filter-attribute="data-command-search" data-filter-empty="#commandSearchEmpty"></label>
          <span>${catalog.length} commands available</span>
        </div>
        ${commandGroups}
        <div id="commandSearchEmpty" class="search-empty-state" hidden>No commands match your search.</div>
      </section>

      <section id="tickets" class="panel"><h2>Recent Tickets</h2><div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Type</th><th>Status</th><th>Claimed By</th><th>Close Reason</th><th>Created</th><th>Transcript</th></tr></thead><tbody>${transcriptRows}</tbody></table></div></section>`;
      res.send(page(`${guild.name} Settings`, form, req.session.user));
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
      const valid = commandCatalog().some((command) => command.name === req.params.commandName);
      if (!valid) return res.status(400).send('Unknown command.');
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

  app.post('/dashboard/:guildId/twitch', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');

      const guild = client.guilds.cache.get(req.params.guildId);
      if (!guild) return res.status(404).send('MultiBot is no longer connected to this server.');

      const channel = guild.channels.cache.get(String(req.body.discordChannelId || ''));
      if (!channel || ![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type)) {
        return res.status(400).send('Choose a valid Discord text or announcement channel.');
      }

      await upsertTwitchAnnouncement({
        guildId: guild.id,
        twitchLogin: req.body.twitchLogin,
        discordChannelId: channel.id,
        customMessage: req.body.customMessage || '',
        createdBy: req.session.user.id,
      });

      return res.redirect(`/dashboard/${guild.id}#twitch`);
    } catch (error) {
      console.error(error);
      return res.status(500).send(page(
        'Dashboard error',
        `<div class="empty"><strong>Unable to save Twitch announcement.</strong><p>${escapeHtml(error.message || String(error))}</p></div>`,
        req.session.user,
      ));
    }
  });

  app.post('/dashboard/:guildId/twitch/:id/delete', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');

      await deleteTwitchAnnouncement(req.params.guildId, req.params.id);
      return res.redirect(`/dashboard/${req.params.guildId}#twitch`);
    } catch (error) {
      console.error(error);
      return res.status(500).send('Unable to remove Twitch announcement.');
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
  app.listen(port, () => console.log(`Dashboard listening on ${process.env.BASE_URL || `http://localhost:${port}`}`));
}

module.exports = { startDashboard };
