# DiscordJs-MultiBot v3

Modernized MultiBot for **discord.js v14** with slash commands, prefix-command backups, a Discord OAuth2 web dashboard, member verification, private support tickets, HTML ticket transcripts, and owner-only cross-server broadcasts.

**Privacy Policy:** see [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md). When the dashboard is deployed, it is also available at `/privacy`.

## What changed

- Upgraded the runtime from discord.js 11.x to discord.js 14.x / Discord API v10.
- Replaced legacy `RichEmbed`, collection accessors, permissions, channel creation, and old event names with v14 APIs.
- Added slash commands for general, moderation, role, poll, ticket, verification, and owner functions.
- Added prefix-command backups for every slash-command feature when prefix commands are enabled.
- Added a Discord OAuth2 dashboard. Users only see servers where they have **Manage Server** (or Administrator) and the bot is installed.
- Added per-server dashboard settings for welcome/leave/log channels, owner broadcasts, verification channels/roles, ticket category, ticket panel, staff role, transcript channel, prefix, and feature toggles.
- Added join verification with an optional unverified role, verified role, reusable verification panel, per-member join prompts, and `/verification` administration.
- Added a ticket panel button, private ticket channels, staff permissions, close controls, and a 5,000-message transcript limit.
- Added sanitized HTML transcripts. Closing a ticket saves the transcript, can upload it to a configured transcript channel, attempts to DM it to the opener, and makes it downloadable by authorized admins in the dashboard.
- Added CSRF checks on dashboard settings and protected transcript downloads behind Discord authorization.
- Added an owner-only broadcast system with `/broadcast`, a dry-run mode, per-server preferred broadcast channels, safe fallback channel selection, rate-friendly delivery, and a sent/skipped/failed summary. Broadcasts do not parse `@everyone`, role, or user mentions.

## Requirements

- Node.js 20 or newer recommended.
- A Discord application/bot token.
- In the Discord Developer Portal, enable the **Server Members Intent** and **Message Content Intent** if you want welcome/member events and legacy prefix commands/message logging.
- Bot permissions should include View Channels, Send Messages, Read Message History, Manage Channels (tickets), Manage Messages, Kick Members, Ban Members, Moderate Members, and Manage Roles as needed by the commands and verification features you enable. Keep the bot role above the verified/unverified roles it manages.

## Installation

1. Copy `.env.example` to `.env`.
2. Fill in the Discord application values.
3. In the Discord Developer Portal, add the OAuth redirect URI from `DISCORD_REDIRECT_URI` (for local development: `http://localhost:3000/auth/callback`).
4. Install dependencies:

```bash
npm install
```

5. Start the bot and dashboard:

```bash
npm start
```

The dashboard defaults to `http://localhost:3000`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DISCORD_TOKEN` | Bot token |
| `DISCORD_CLIENT_ID` | Discord application/client ID |
| `DISCORD_CLIENT_SECRET` | Discord OAuth client secret |
| `DISCORD_REDIRECT_URI` | OAuth callback URL |
| `SESSION_SECRET` | Long random secret used to sign dashboard sessions |
| `PORT` | Dashboard HTTP port, default `3000` |
| `BASE_URL` | Public dashboard URL |
| `DEV_GUILD_ID` | Optional test server for instant slash-command registration |
| `DEFAULT_PREFIX` | Default legacy command prefix, default `!` |
| `BOT_OWNER_IDS` | Optional comma-separated Discord user IDs allowed to use owner commands; when blank, the Discord application owner is detected automatically |
| `BROADCAST_DELAY_MS` | Delay between server broadcast sends, default `400` ms |

## Owner broadcasts

Use `/broadcast message:<text>` to send an owner announcement to every server where MultiBot can find a sendable text channel. Only the bot/application owner can run it. You can also use `!broadcast <message>` when legacy prefix commands are enabled.

Useful options:

- `title` changes the embed title.
- `dry-run:true` reports where the message would be delivered without sending it.
- Each server can select an **Owner Broadcast Channel** in the web dashboard. If none is configured, MultiBot tries the server system channel, then common channels such as `#announcements` or `#general`, then the first sendable non-ticket text channel.
- Mentions are disabled for owner broadcasts, so broadcast text cannot trigger `@everyone`, role, or user pings.


## Verification setup

1. In the dashboard, select a **Verification Channel** and at least one of **Verified Role** or **Unverified Role**.
2. Enable **Member verification**.
3. If you configure an unverified role, make sure that role only has access to the channels new members should see before verification.
4. Run `/verification setup` in the verification channel to post a reusable **Verify** button.
5. New members can also receive a member-specific verification prompt in the configured channel.
6. Clicking **Verify** adds the verified role (when configured) and removes the unverified role (when configured).

The bot needs **Manage Roles**, and its highest role must be above any verification roles it manages. Prefix backups include `!verification setup`, `!verification verify`, `!verification status`, and `!verify`.

## Ticket setup

1. Log into the dashboard and select your server.
2. Choose a ticket category, staff role, and transcript channel.
3. Run `/ticket setup` in the channel where you want the ticket panel, or provide a target channel to the command.
4. Users click **Create Ticket**. Only the opener, configured staff role, and bot can view the ticket channel.
5. Use the **Close Ticket** button or `/ticket close`. MultiBot creates an HTML transcript before deleting the ticket channel.

Generated runtime settings and transcripts live under `data/` and are ignored by Git.

## Slash commands

`/ping`, `/help`, `/avatar`, `/userinfo`, `/serverinfo`, `/poll`, `/purge`, `/kick`, `/ban`, `/timeout`, `/untimeout`, `/say`, `/role add`, `/role remove`, `/ticket setup`, `/ticket close`, `/verification setup`, `/verification verify`, `/verification status`, `/broadcast` (owner only).

Each feature above also has a prefix-command backup when **Legacy prefix commands** are enabled.

## Deployment notes

- Put the dashboard behind HTTPS in production.
- Set `NODE_ENV=production` so session cookies are marked secure.
- The included `express-session` MemoryStore is suitable for a single-process starter deployment. For horizontal scaling or sessions that must survive restarts, replace it with Redis or another persistent session store.
- The JSON settings/ticket store is intentionally dependency-light. For a large bot, migrate it to PostgreSQL/MySQL/SQLite.

## Legacy repository cleanup

The original repository contains a copied legacy Discord.js implementation under `commands/developer/`. It is not needed by this v14 build and should be removed when applying this modernization. The old v11 command/event folders can also be removed once you are satisfied with the new v14 command set.
