const path = require('node:path');
const crypto = require('node:crypto');
const fs = require('node:fs');
const express = require('express');
const session = require('express-session');
const { ChannelType, PermissionFlagsBits } = require('discord.js');
const {
  getGuildSettings,
  saveGuildSettings,
  listGuildTickets,
  getTicket,
  transcriptsDir,
} = require('../store');
const { escapeHtml } = require('../utils/html');

const DISCORD_API = 'https://discord.com/api/v10';

function botInviteUrl() {
  const clientId = process.env.DISCORD_CLIENT_ID;
  if (!clientId) return null;
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'bot applications.commands',
    permissions: PermissionFlagsBits.Administrator.toString(),
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

function page(title, body, user) {
  const auth = user
    ? `<div class="user"><span class="user-name">${escapeHtml(user.username)}</span><a class="btn secondary compact" href="/logout">Log out</a></div>`
    : '<a class="btn compact" href="/login">Login with Discord</a>';

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="dark light">
<title>${escapeHtml(title)}</title>
<script>(function(){try{var t=localStorage.getItem('multibot-theme');if(!t&&window.matchMedia('(prefers-color-scheme: light)').matches)t='light';if(t)document.documentElement.dataset.theme=t;}catch(e){}})();</script>
<link rel="stylesheet" href="/style.css">
<script src="/dashboard.js" defer></script>
</head>
<body>
<header class="topbar">
  <div class="nav-shell">
    <a class="brand" href="/" aria-label="MultiBot home">MultiBot</a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="site-nav" data-nav-toggle>
      <span class="sr-only">Toggle navigation</span><span aria-hidden="true">☰</span>
    </button>
    <nav class="site-nav" id="site-nav" data-nav aria-label="Primary navigation">
      <a href="/" data-nav-link>Home</a>
      <a href="/dashboard" data-nav-link>Dashboard</a>
      <a href="/invite" data-nav-link>Add Bot</a>
      <a href="/privacy" data-nav-link>Privacy</a>
    </nav>
    <div class="nav-actions">
      <button class="theme-toggle" type="button" data-theme-toggle aria-label="Switch color theme" title="Switch color theme">
        <span data-theme-icon aria-hidden="true">☀</span>
      </button>
      ${auth}
    </div>
  </div>
</header>
<main>${body}</main>
<footer>MultiBot • discord.js v14 • <a href="/privacy">Privacy Policy</a></footer>
</body>
</html>`;
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

async function discordFetch(pathname, accessToken) {
  const response = await fetch(`${DISCORD_API}${pathname}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`Discord API ${response.status}`);
  return response.json();
}

function canManageGuild(guild) {
  const permissions = BigInt(guild.permissions || '0');
  return guild.owner || (permissions & PermissionFlagsBits.Administrator) === PermissionFlagsBits.Administrator || (permissions & PermissionFlagsBits.ManageGuild) === PermissionFlagsBits.ManageGuild;
}

async function getManagedGuilds(req, client) {
  if (!req.session.accessToken) return [];
  const guilds = await discordFetch('/users/@me/guilds', req.session.accessToken);
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

function startDashboard(client) {
  const app = express();
  app.disable('x-powered-by');
  if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1);
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.static(path.join(process.cwd(), 'public')));
  app.use(session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 24 * 60 * 60 * 1000 },
  }));

  app.get('/', (req, res) => {
    const primaryAction = req.session.user
      ? '<a class="btn" href="/dashboard">Open Dashboard</a>'
      : '<a class="btn" href="/login">Login with Discord</a>';
    const body = `<section class="hero"><span class="pill">Discord.js v14</span><h1>MultiBot Control Panel</h1><p>Configure moderation, welcome/logging, ticket channels, staff roles, and HTML transcripts from the web.</p><div class="actions">${primaryAction}<a class="btn secondary" href="/invite">Add Bot to Server</a></div></section>`;
    res.send(page('MultiBot', body, req.session.user));
  });

  app.get('/privacy', (req, res) => {
    const policyPath = path.join(process.cwd(), 'PRIVACY_POLICY.md');
    const policy = fs.existsSync(policyPath)
      ? fs.readFileSync(policyPath, 'utf8')
      : 'MultiBot Privacy Policy is unavailable.';
    res.send(page('Privacy Policy', `<section class="panel policy"><pre>${escapeHtml(policy)}</pre></section>`, req.session.user));
  });

  app.get('/invite', (_req, res) => {
    const url = botInviteUrl();
    if (!url) return res.status(500).send(page('Invite unavailable', '<div class="empty">DISCORD_CLIENT_ID is not configured, so the bot invite link cannot be generated.</div>'));
    res.redirect(url);
  });

  app.get('/login', (req, res) => {
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
      const cards = guilds.length ? guilds.map((guild) => `<a class="guild-card" href="/dashboard/${guild.id}"><div class="guild-icon">${guild.icon ? `<img src="https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=128" alt="">` : escapeHtml(guild.name.slice(0, 2).toUpperCase())}</div><div><strong>${escapeHtml(guild.name)}</strong><small>Configure server</small></div></a>`).join('') : '<div class="empty">No servers found where you have Manage Server and MultiBot is installed.</div>';
      res.send(page('Dashboard', `<div class="section-title"><h1>Your Servers</h1><p>Select a server to configure MultiBot.</p></div><div class="guild-grid">${cards}</div>`, req.session.user));
    } catch (error) {
      console.error(error);
      res.status(401).send(page('Session expired', '<div class="empty">Your Discord session expired. <a href="/login">Log in again</a>.</div>'));
    }
  });

  app.get('/dashboard/:guildId', requireAuth, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');
      const guild = client.guilds.cache.get(req.params.guildId);
      const settings = getGuildSettings(guild.id);
      const textChannels = [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildText).sort((a, b) => a.name.localeCompare(b.name));
      const broadcastChannels = [...guild.channels.cache.values()].filter((c) => [ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(c.type)).sort((a, b) => a.name.localeCompare(b.name));
      const categories = [...guild.channels.cache.values()].filter((c) => c.type === ChannelType.GuildCategory).sort((a, b) => a.name.localeCompare(b.name));
      const roles = [...guild.roles.cache.values()].filter((r) => r.id !== guild.id).sort((a, b) => b.position - a.position);
      const tickets = listGuildTickets(guild.id).slice(0, 20);
      const transcriptRows = tickets.length ? tickets.map((t) => `<tr><td>${escapeHtml(t.id.slice(0, 8))}</td><td>${escapeHtml(t.status)}</td><td>${escapeHtml(new Date(t.createdAt).toLocaleString())}</td><td>${t.transcriptFile ? `<a href="/transcripts/${t.id}">Download HTML</a>` : '—'}</td></tr>`).join('') : '<tr><td colspan="4">No tickets yet.</td></tr>';
      const saveNotice = req.query.saved === '1'
        ? '<div class="notice success" role="status">Settings saved successfully.</div>'
        : '';
      const form = `${saveNotice}<div class="section-title"><a class="back-link" href="/dashboard">← Servers</a><h1>${escapeHtml(guild.name)}</h1><p>Changes apply immediately; no bot restart is required.</p></div>
      <form class="panel settings-form" method="post" action="/dashboard/${guild.id}" data-loading-form><input type="hidden" name="_csrf" value="${escapeHtml(req.session.csrf)}"><div class="form-grid">
      <label>Prefix<input name="prefix" maxlength="5" value="${escapeHtml(settings.prefix)}"></label>
      <label>Welcome Channel<select name="welcomeChannelId">${selectOptions(textChannels, settings.welcomeChannelId)}</select></label>
      <label>Leave Channel<select name="leaveChannelId">${selectOptions(textChannels, settings.leaveChannelId)}</select></label>
      <label>Logs Channel<select name="logsChannelId">${selectOptions(textChannels, settings.logsChannelId)}</select></label>
      <label>Owner Broadcast Channel<select name="broadcastChannelId">${selectOptions(broadcastChannels, settings.broadcastChannelId, 'Automatic channel selection')}</select></label>
      <label>Verification Channel<select name="verificationChannelId">${selectOptions(textChannels, settings.verificationChannelId)}</select></label>
      <label>Verified Role<select name="verifiedRoleId">${selectOptions(roles, settings.verifiedRoleId)}</select></label>
      <label>Unverified Role<select name="unverifiedRoleId">${selectOptions(roles, settings.unverifiedRoleId)}</select></label>
      <label>Ticket Category<select name="ticketsCategoryId">${selectOptions(categories, settings.ticketsCategoryId)}</select></label>
      <label>Ticket Panel Channel<select name="ticketPanelChannelId">${selectOptions(textChannels, settings.ticketPanelChannelId)}</select></label>
      <label>Ticket Staff Role<select name="ticketStaffRoleId">${selectOptions(roles, settings.ticketStaffRoleId)}</select></label>
      <label>Transcript Channel<select name="transcriptChannelId">${selectOptions(textChannels, settings.transcriptChannelId)}</select></label>
      </div><div class="checks">
      <label><input type="checkbox" name="ticketsEnabled" ${settings.ticketsEnabled ? 'checked' : ''}> Tickets enabled</label>
      <label><input type="checkbox" name="loggingEnabled" ${settings.loggingEnabled ? 'checked' : ''}> Logging enabled</label>
      <label><input type="checkbox" name="welcomeEnabled" ${settings.welcomeEnabled ? 'checked' : ''}> Welcome messages enabled</label>
      <label><input type="checkbox" name="verificationEnabled" ${settings.verificationEnabled ? 'checked' : ''}> Member verification enabled</label>
      <label><input type="checkbox" name="prefixCommandsEnabled" ${settings.prefixCommandsEnabled ? 'checked' : ''}> Legacy prefix commands enabled</label>
      </div><button class="btn" type="submit">Save Settings</button></form>
      <section class="panel"><h2>Recent Tickets</h2><div class="table-wrap"><table><thead><tr><th>Ticket</th><th>Status</th><th>Created</th><th>Transcript</th></tr></thead><tbody>${transcriptRows}</tbody></table></div></section>`;
      res.send(page(`${guild.name} Settings`, form, req.session.user));
    } catch (error) {
      console.error(error);
      res.status(500).send('Unable to load server settings.');
    }
  });

  app.post('/dashboard/:guildId', requireAuth, verifyCsrf, async (req, res) => {
    try {
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === req.params.guildId)) return res.status(403).send('You cannot manage this server.');
      saveGuildSettings(req.params.guildId, {
        prefix: String(req.body.prefix || '!').trim().slice(0, 5) || '!',
        welcomeChannelId: req.body.welcomeChannelId || '',
        leaveChannelId: req.body.leaveChannelId || '',
        logsChannelId: req.body.logsChannelId || '',
        broadcastChannelId: req.body.broadcastChannelId || '',
        verificationChannelId: req.body.verificationChannelId || '',
        verifiedRoleId: req.body.verifiedRoleId || '',
        unverifiedRoleId: req.body.unverifiedRoleId || '',
        ticketsCategoryId: req.body.ticketsCategoryId || '',
        ticketPanelChannelId: req.body.ticketPanelChannelId || '',
        ticketStaffRoleId: req.body.ticketStaffRoleId || '',
        transcriptChannelId: req.body.transcriptChannelId || '',
        ticketsEnabled: req.body.ticketsEnabled === 'on',
        loggingEnabled: req.body.loggingEnabled === 'on',
        welcomeEnabled: req.body.welcomeEnabled === 'on',
        verificationEnabled: req.body.verificationEnabled === 'on',
        prefixCommandsEnabled: req.body.prefixCommandsEnabled === 'on',
      });
      res.redirect(`/dashboard/${req.params.guildId}?saved=1`);
    } catch (error) {
      console.error(error);
      res.status(500).send('Unable to save settings.');
    }
  });

  app.get('/transcripts/:ticketId', requireAuth, async (req, res) => {
    try {
      const ticket = getTicket(req.params.ticketId);
      if (!ticket?.transcriptFile) return res.status(404).send('Transcript not found.');
      const guilds = await getManagedGuilds(req, client);
      if (!guilds.some((g) => g.id === ticket.guildId)) return res.status(403).send('You cannot access this transcript.');
      const safeName = path.basename(ticket.transcriptFile);
      const filePath = path.join(transcriptsDir, safeName);
      if (!fs.existsSync(filePath)) return res.status(404).send('Transcript file is missing.');
      res.download(filePath, safeName);
    } catch (error) {
      console.error(error);
      res.status(500).send('Unable to download transcript.');
    }
  });

  app.get('/health', (_req, res) => res.json({ ok: true, botReady: client.isReady(), guilds: client.guilds.cache.size }));

  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`Dashboard listening on ${process.env.BASE_URL || `http://localhost:${port}`}`));
}

module.exports = { startDashboard };
