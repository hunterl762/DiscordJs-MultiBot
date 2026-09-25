# DiscordJs-MultiBot v3

MultiBot is a **discord.js v14** multi-purpose Discord bot with slash commands, prefix-command backups, a Discord OAuth2 dashboard, MySQL storage, member verification, private support tickets, HTML transcripts, and owner-only broadcasts.

## Storage

MultiBot now uses **MySQL** instead of JSON files for persistent data:

- `guild_settings` — per-server dashboard and bot configuration.
- `tickets` — ticket metadata, ticket type, and HTML transcript content.
- `ticket_types` — per-server configuration for Support, Player Reports, Staff Reports, Bug Reports, Billing, Applications, and Management.
- `web_sessions` — Discord OAuth/dashboard sessions.
- `twitch_announcements` — per-server Twitch streamer/channel mappings and live-state tracking.

The ready-to-run schema is in [`database/schema.sql`](database/schema.sql).

## MySQL setup

Create the database and a dedicated runtime user. Example:

```sql
CREATE DATABASE IF NOT EXISTS multibot
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

CREATE USER IF NOT EXISTS 'multibot'@'localhost'
  IDENTIFIED BY 'CHANGE_ME';

GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX
  ON multibot.* TO 'multibot'@'localhost';

FLUSH PRIVILEGES;
```

Run `database/schema.sql`, or set `MYSQL_AUTO_MIGRATE=true` and MultiBot will create missing tables when it starts. The database itself must already exist.

After you manage migrations manually, set `MYSQL_AUTO_MIGRATE=false` and the runtime account can normally be reduced to `SELECT, INSERT, UPDATE, DELETE`.

## .env

Copy `.env.example` to `.env` and configure:

```env
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
DISCORD_REDIRECT_URI=http://localhost:3000/auth/callback

PORT=3000
BASE_URL=http://localhost:3000
SESSION_SECRET=replace-with-a-long-random-secret
NODE_ENV=development

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=multibot
MYSQL_PASSWORD=replace-with-a-strong-database-password
MYSQL_DATABASE=multibot
MYSQL_CONNECTION_LIMIT=10
MYSQL_AUTO_MIGRATE=true

MYSQL_SSL=false
MYSQL_SSL_REJECT_UNAUTHORIZED=true
MYSQL_SSL_CA_FILE=

TWITCH_CLIENT_ID=
TWITCH_CLIENT_SECRET=
TWITCH_CHECK_INTERVAL_MS=120000
```

For remote/cloud MySQL, enable TLS when your provider supports or requires it.

## Install

```bash
npm install
npm start
```

Node.js 20 or newer is recommended.

## Cookie consent

The web panel includes explicit essential-cookie consent. Discord OAuth dashboard sign-in requires the `multibot.sid` session cookie. Users can decline dashboard cookies and continue using public/legal pages; declining clears any current dashboard session. The preference is remembered in `multibot_cookie_consent`.

## Dashboard

The dashboard uses Discord OAuth2 and only exposes servers the signed-in user can manage. Server settings are saved directly to MySQL. Dashboard sessions are also stored in MySQL so they survive normal bot restarts.

The `/health` endpoint reports both Discord readiness and database connectivity.

## Advanced logging

MultiBot now supports richer audit-style logging for member joins/leaves, kicks, bans/unbans, message edits/deletes, channel changes, nickname changes, role creation/update/deletion, and member role additions/removals.

The dashboard exposes three logging destinations:

- **General Logs Channel** — general member, moderation, message, and channel activity.
- **Verification Log Channel** — successful/already-complete verification checks and verification role changes.
- **Role Change Log Channel** — member role additions/removals plus role create/update/delete events.

If a dedicated verification or role channel is left blank, MultiBot falls back to the General Logs Channel. Audit-log executor information is included when Discord permits the bot to read audit logs.

## Advanced ticket system

MultiBot includes seven configurable ticket departments:

- Support
- Player Reports
- Staff Reports
- Bug Reports
- Billing
- Applications
- Management

Each department can be enabled/disabled and configured from the web panel with its own display name, emoji, description, Discord category, and staff role. Blank department category/role settings inherit the server's default ticket category and staff role.

The dashboard can also post the advanced ticket panel directly into the selected Discord channel. Members choose a department from a select menu and can keep one open ticket per department.

## Ticket limits and transcript delivery

The dashboard now lets each server configure:

- maximum simultaneous open tickets per person (1–25)
- online transcript links on/off
- Discord `.html` transcript attachment uploads on/off
- individual ticket departments on/off with instant autosave

When online transcripts are enabled, new closed tickets receive an unguessable public transcript token and can be viewed through `/transcripts/public/<token>`. The authenticated dashboard also keeps a separate **Download HTML** action.

## Tickets

Tickets use private Discord channels. When a ticket is closed, MultiBot:

1. Collects up to 5,000 messages.
2. Generates a sanitized HTML transcript.
3. Stores the transcript HTML in MySQL.
4. Optionally posts it to the configured transcript channel.
5. Attempts to DM it to the ticket opener.
6. Makes it downloadable by authorized admins through the dashboard.

## Twitch live announcements

Create a Twitch application in the Twitch Developer Console and set `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`.

Server administrators can then open their server in the web panel and add one or more Twitch usernames. Each Twitch account can target a selected Discord text or announcement channel.

The monitor uses Twitch's app access token flow and Helix `Get Streams` endpoint. It checks configured channels in batches, records the current stream ID in MySQL, and only posts when a new live stream is detected. Each live alert is sent as a rich Discord embed with the stream title, game, viewer count, relative start time, Twitch preview image, and a **Watch on Twitch** link button.

Optional custom announcement variables:

- `{user}`
- `{game}`
- `{title}`
- `{url}`

The default check interval is 120 seconds and can be changed with `TWITCH_CHECK_INTERVAL_MS`. MultiBot enforces a minimum interval of 60 seconds.

## Web-panel Command Center

Each server page now includes a categorized **Command Center** generated from the live command registry. It automatically lists every loaded module from `commands/`, including descriptions, subcommands, aliases, server/global scope, and whether a prefix fallback is available. Current categories are General, Moderation, Support & Verification, and Owner Tools; future uncategorized modules appear under Other.

The Twitch section is also presented as streamer cards with live/offline status, target Discord channel, last announcement time, custom-message preview, and quick Twitch/remove controls.


## Duty-based command modules

Slash commands are now recursively loaded from responsibility folders. Every slash command has its own JavaScript file:

```text
commands/
├── admin/
│   ├── backup.js
│   ├── role.js
│   └── say.js
├── analytics/
│   └── stats.js
├── applications/
│   └── apply.js
├── community/
│   └── suggest.js
├── economy/
│   ├── balance.js
│   └── daily.js
├── giveaways/
│   └── giveaway.js
├── leveling/
│   ├── leaderboard.js
│   └── rank.js
├── misc/
│   ├── avatar.js
│   ├── botinfo.js
│   ├── help.js
│   ├── legal.js
│   ├── ping.js
│   ├── poll.js
│   ├── serverinfo.js
│   └── userinfo.js
├── moderation/
│   ├── ban.js
│   ├── kick.js
│   ├── purge.js
│   ├── timeout.js
│   ├── untimeout.js
│   └── warn.js
├── owner/
│   ├── broadcast.js
│   └── resetcommands.js
├── roles/
│   └── buttonrole.js
├── security/
│   └── lockdown.js
├── tickets/
│   └── ticket.js
├── utility/
│   └── remind.js
└── verification/
    └── verification.js
```

The command registry walks these folders recursively, detects duplicate command names, and exposes each module's folder/category in the web-panel Command Center.

## Module and command toggles

Feature/module toggles, ticket-department toggles, core server feature toggles, and individual command toggles now autosave immediately in the dashboard.

Disabled commands remain registered with Discord when using global commands, so they can still appear in Discord's slash-command picker; MultiBot blocks their execution for that server and returns a disabled message. This avoids maintaining a separate Discord application-command registration set for every server.

## Advanced Feature Center

Every server page now has a **Feature Center** with priority badges, operational status, enable/disable controls, and typed configuration fields.

### Operational core features

- **Moderation / AutoMod** — spam windows, link blocking, invite blocking, bad-word filtering, mass-mention protection, exempt roles, AutoMod logs.
- **Warnings** — persistent MySQL warning history with `/warn add|list|clear`.
- **Advanced Tickets** — seven departments, per-department categories/staff roles, staff claiming, close reasons, HTML transcripts, logs and dashboard statistics.
- **Anti-Raid / Anti-Nuke** — join-rate detection, suspicious account age checks, destructive channel/role/ban action detection and automatic lockdown thresholds.
- **Advanced Logging** — detailed message/member/moderation/channel/role/verification logging.
- **Welcome / Goodbye** — custom text, image URL, autorole and optional welcome DMs.
- **Button Roles** — self-role buttons created with `/buttonrole`.
- **Leveling / XP** — text XP, voice XP, cooldowns, multipliers, `/rank` and `/leaderboard`.
- **Applications** — configurable questions, modal forms, reviewer roles, approve/deny buttons and applicant DMs.
- **Suggestions** — configured suggestion channel and voting reactions.
- **Economy** — balances and daily rewards with configurable currency values.
- **Starboard** — configurable channel and reaction threshold.
- **Invite Tracking** — join attribution and invite logging.
- **Reminders** — persistent MySQL reminders with automatic delivery.
- **Temporary Voice** — join-to-create voice rooms with cleanup.
- **Analytics** — persistent command-use tracking and `/stats`.
- **Custom Automations** — dashboard rule builder for member-join/message-match triggers with send-message, DM-user and add-role actions.
- **Twitch Alerts** — existing rich Twitch live embeds and per-streamer channel configuration.

### Partial / provider-dependent features

- **Giveaways** — timed, multi-winner giveaways are operational; restart persistence, advanced entry requirements and reroll history are still an expansion point.
- **YouTube / Kick Alerts** — represented in the Stream Alerts module; Twitch is operational now, while YouTube/Kick need their provider API integrations.
- **AI Assistant** — dashboard integration slot is present but requires an AI provider/API implementation.
- **Music** — dashboard settings are present but playback requires a Lavalink-compatible backend and source plugins for services such as Spotify/Apple Music.

The dashboard intentionally labels these integration-dependent modules instead of reporting them as fully operational without their external services.

## Server backups

`/backup create` saves the current server channel and role structure to MySQL, including role permissions and channel permission overwrites. It intentionally does not store message history.

`/backup list` shows recent stored backup IDs and counts.

## Bot runtime information

`/botinfo` reports safe runtime/hardware diagnostics including CPU model and process CPU usage, logical core count, system and process RAM usage, operating system/architecture, timezone, Node.js/discord.js versions, WebSocket latency and process uptime.

## Commands

Each command lives in its own file under `commands/`. `src/bot/commandRegistry.js` automatically discovers command modules.

Commands now include the original command set plus `/warn`, `/lockdown`, `/buttonrole`, `/rank`, `/leaderboard`, `/balance`, `/daily`, `/apply`, `/suggest`, `/giveaway`, `/remind`, and `/stats`. See the duty-based command tree above for the current module layout.

Prefix backups are available when enabled.

### Reset slash commands

Bot owners can use:

- `/resetcommands scope:global` — recommended production cleanup. Deletes the previous global set, clears stale guild-specific command registrations across connected servers, and registers exactly the current command modules globally.
- `/resetcommands scope:guild` — clears stale commands from the current guild. If a global set already exists, MultiBot refreshes the global set instead of creating a duplicate guild copy.
- `!resetcommands global`
- `!resetcommands guild`

This prevents Discord from showing duplicate slash commands caused by old global + guild registrations.

## Slash-command registration troubleshooting

If Discord returns `DiscordAPIError[50001]: Missing Access` for a URL containing `/guilds/<id>/commands`, the configured `DEV_GUILD_ID` is not accessible to the logged-in bot application, or the Discord application credentials do not match.

MultiBot now logs in before registering commands, verifies whether it is actually connected to `DEV_GUILD_ID`, and automatically falls back to global registration when guild registration is unavailable.

For development-server registration:

1. Make sure the bot is installed in that server.
2. Make sure `DEV_GUILD_ID` is that server's ID.
3. Make sure `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_CLIENT_SECRET` all belong to the same Discord application.
4. If you do not need instant test-server commands, leave `DEV_GUILD_ID=` blank.

## Dashboard troubleshooting

If the server configuration page cannot load:

1. Confirm MySQL is running.
2. Verify `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_USER`, `MYSQL_PASSWORD`, and `MYSQL_DATABASE`.
3. Confirm the MySQL user can access the database.
4. Confirm `guild_settings`, `tickets`, and `web_sessions` exist.
5. If `MYSQL_AUTO_MIGRATE=true`, grant `CREATE`, `ALTER`, and `INDEX`.
6. Check `/health` — `database` should be `true`.
7. In development mode, the settings error page displays the underlying database error.

## Legal pages

- Privacy Policy: [`PRIVACY_POLICY.md`](PRIVACY_POLICY.md) and dashboard route `/privacy`
- Terms of Service: [`TERMS_OF_SERVICE.md`](TERMS_OF_SERVICE.md) and dashboard route `/terms`
- Discord command: `/legal` (prefix fallback: `!legal`) returns buttons linking to both pages.

Set `BASE_URL` to the public HTTPS address of your deployed dashboard so Discord's legal-link buttons point to the correct website.
