# MultiBot Privacy Policy

**Effective date: September 25, 2026**

MultiBot processes Discord account, server, channel, role, permission, moderation, verification, and ticket information only as needed to provide configured bot features.

## Dashboard and OAuth

The dashboard uses Discord OAuth2 with the `identify` and `guilds` scopes. OAuth access tokens and dashboard session information are stored server-side in the MySQL `web_sessions` table. MultiBot does not request your Discord password.

## Server configuration

Per-server settings are stored in MySQL in the `guild_settings` table. This can include channel IDs, role IDs, ticket configuration, verification configuration, feature toggles, logging configuration, broadcast configuration, and the optional legacy command prefix.

Advanced ticket department settings are stored in the MySQL `ticket_types` table. These settings can include each department's display name, description, emoji, enabled status, Discord category ID, and staff role ID.

Per-server module settings and per-command enable/disable choices are also stored in MySQL so dashboard selections persist across restarts.

## Tickets and transcripts

Ticket metadata is stored in the MySQL `tickets` table. When a ticket closes, MultiBot may read up to the most recent 5,000 messages available to the bot and generate an HTML transcript.

A transcript can contain message content, author names, Discord tags, avatar URLs, timestamps, and attachment links or filenames. The generated HTML is stored in the `tickets.transcript_html` column. When transcript attachments are enabled, MultiBot may also upload the generated `.html` file to the configured Discord transcript channel and/or send it to the ticket opener.

When **online transcripts** are enabled for a server, MultiBot creates a cryptographically random transcript URL token. Anyone who obtains that unguessable URL can view the corresponding transcript in a browser until the server disables online transcripts or the stored transcript/token is removed. Server administrators should treat transcript links as private links and only share them with appropriate people.

MultiBot does not use message content to train AI or machine-learning models.

## Logging, moderation, verification, and broadcasts

Configured logging may process message content for supported events such as message edits or deletions and send those logs to the configured Discord logging channel. Moderation features process information required to perform requested actions. Verification processes member IDs and role memberships. Owner broadcasts process server/channel information to select a permitted announcement destination.

## Data sharing

MultiBot does not sell personal information. Information may be shared with Discord as required to operate the bot, with members or staff through configured server features, with authorized administrators downloading transcripts, with the ticket opener, with hosting/database providers selected by the operator, or when legally required.

## Retention

Guild settings, ticket metadata, transcripts, and sessions remain in MySQL according to the operator's retention and backup policies. Deleting a Discord ticket channel does not automatically delete its stored MySQL transcript.

## Security

MultiBot includes Discord permission checks, OAuth state validation, CSRF protection, HTTP-only session cookies, protected transcript downloads, restricted ticket-channel permissions, and optional MySQL TLS support.

Operators should protect Discord tokens, OAuth secrets, session secrets, MySQL credentials, database backups, and hosting credentials and should use HTTPS for public dashboard deployments.

## Cookies & Local Storage

The MultiBot web dashboard uses an essential HTTP-only session cookie named `multibot.sid`. This cookie is required to keep a signed-in dashboard session associated with the correct server-side MySQL session record and to support security controls such as OAuth state and CSRF validation.

The session cookie is configured with `SameSite=Lax`, is HTTP-only, and is marked `Secure` when the dashboard runs with `NODE_ENV=production`. Its configured maximum lifetime is seven days, although a session may end earlier when a user logs out, the session is deleted, or the operator clears stored sessions.

MultiBot does not use advertising or behavioral-tracking cookies in the included dashboard.

The dashboard presents a cookie-consent control before Discord OAuth sign-in. If you accept essential cookies, MultiBot stores a readable preference cookie named `multibot_cookie_consent` with the value `essential`. If you decline, the preference cookie is stored with the value `declined`, the active dashboard session is destroyed, and the `multibot.sid` session cookie is cleared.

The `multibot_cookie_consent` preference cookie is used only to remember the cookie choice and can be retained for up to one year. Declining dashboard cookies does not prevent access to public pages such as the Privacy Policy and Terms of Service, but Discord OAuth dashboard sign-in requires acceptance of the essential session cookie.

## Requests and contact

For access or deletion requests, contact the operator of the MultiBot deployment. For the public source project, issues can be submitted at:

https://github.com/hunterl762/DiscordJs-MultiBot/issues


## Server Backups

Authorized server administrators can create configuration backups with MultiBot. Server backups are stored in MySQL and can include Discord channel structure, channel permission overwrites, roles, role permissions, role positions, and related server configuration metadata.

The included backup command does not back up Discord message history, message attachments, passwords, tokens, or general member-profile data.

## Twitch, YouTube, and Kick Stream Alerts

When a server administrator configures Stream Alerts, MultiBot stores the selected streaming platform, public streamer/channel identifier, selected Discord destination channel ID, optional custom announcement text, optional Discord user/live-role binding, the Discord user ID of the administrator who configured the alert, and live-state metadata such as the most recently observed stream ID and announcement timestamp.

MultiBot may use Twitch, YouTube, and Kick APIs to check whether configured public channels are live. It may process public stream information such as stream title, category/game, viewer count, start time, public channel/user name, thumbnail URL, and stream URL in order to create Discord announcements.

Servers may also have a Stream Alerts access entitlement indicating free or paid capacity. The entitlement does not store payment-card data. Streaming-provider API credentials are deployment secrets stored in environment variables and are not exposed through the web dashboard.
