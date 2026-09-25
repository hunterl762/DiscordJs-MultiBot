# MultiBot Privacy Policy

**Effective date: September 25, 2026**

This Privacy Policy explains how MultiBot ("MultiBot," "the Bot," "we," "us," or "our") processes information when you use the Discord bot, its web dashboard, ticket system, verification system, moderation features, and related services.

By using MultiBot, you acknowledge the practices described in this policy. Server owners and administrators are responsible for configuring MultiBot appropriately for their communities and for informing members about server-specific uses of the Bot.

## 1. Information MultiBot Processes

MultiBot processes only the information reasonably needed to provide its features.

### Discord account and server information

Depending on the feature being used, MultiBot may process:

- Discord user IDs, usernames, display names, avatars, and account timestamps.
- Discord server IDs, names, channel IDs, role IDs, member counts, and server configuration.
- Membership and role information needed for permissions, moderation, verification, tickets, and dashboard access.
- Discord permissions needed to determine whether a user can manage a server or use an administrative command.

### Dashboard authentication information

When you sign in to the MultiBot dashboard with Discord OAuth2, MultiBot requests the `identify` and `guilds` scopes. The dashboard uses this information to identify you and display servers that you are authorized to manage.

The Discord OAuth access token is stored in the server-side web session so the dashboard can request your authorized server list. In the default included configuration, the session is held in application memory and is not written to MultiBot's JSON data files. Sessions are configured to expire after up to seven days and are destroyed when you log out or when the application process is restarted.

MultiBot does not request your Discord password.

### Server configuration data

MultiBot stores server settings needed to operate configured features. These settings may include:

- Command prefix and whether prefix commands are enabled.
- Welcome, leave, logging, broadcast, verification, ticket, and transcript channel IDs.
- Verified, unverified, and ticket staff role IDs.
- Ticket category IDs.
- Feature enabled/disabled settings.

### Ticket data and message content

When a user opens a ticket, MultiBot stores ticket metadata such as the ticket ID, server ID, channel ID, ticket opener's Discord user ID, ticket status, creation time, closure time, the user ID of the person who closed the ticket, and the transcript filename when one exists.

When a ticket is closed, MultiBot may read messages in that ticket channel and generate an HTML transcript. A transcript can include:

- Message text.
- Message author username, display name, Discord tag, avatar URL, and timestamp.
- Links and filenames for attachments posted in the ticket.
- Ticket and server information needed to identify the transcript.

The default build limits transcript collection to the most recent 5,000 messages available to the Bot in the ticket channel.

MultiBot does not use message content to train artificial intelligence or machine-learning models.

### Logging and moderation data

If a server administrator enables logging, MultiBot may process recent message content and related metadata when supported logging events occur, such as a message being edited or deleted. This information is sent to the server's configured Discord logging channel and is not separately persisted by MultiBot's default local data store.

Moderation commands process the user, role, channel, reason, duration, and other information needed to carry out the requested Discord moderation action.

### Verification data

If server verification is enabled, MultiBot processes a member's Discord user ID and role membership so it can assign or remove configured verification roles. MultiBot does not require members to submit government identification, biometric information, passwords, or other sensitive identity documents for the included button-based verification system.

### Owner broadcasts

The owner broadcast feature processes server and channel information to locate a permitted destination for an announcement. Broadcast messages are sent to Discord channels but are not stored in a separate broadcast-history database by the default build.

## 2. Why Information Is Processed

MultiBot processes information to:

- Operate Discord slash commands and optional prefix-command fallbacks.
- Authenticate dashboard users and determine which servers they are allowed to manage.
- Save server configuration.
- Create and manage support tickets.
- Generate and deliver ticket transcripts.
- Perform moderation and role-management actions requested by authorized users.
- Provide member verification.
- Send welcome, leave, logging, and owner broadcast messages when configured.
- Maintain service security, troubleshoot errors, and prevent unauthorized dashboard actions.

## 3. How Information Is Stored

The included MultiBot build stores guild settings and ticket metadata in JSON files under the application's `data/` directory. Generated ticket transcripts are stored as HTML files under `data/transcripts/`.

The `data/` directory is ignored by Git in the provided project so runtime data is not intended to be committed to the public source repository.

Dashboard sessions use `express-session`. The default configuration uses its in-memory session store. Operators who replace the default session or data storage with Redis, SQL, cloud storage, or another service are responsible for updating this policy as needed to accurately describe their deployment.

## 4. Data Sharing

MultiBot does not sell personal information.

Information may be shared in the following limited ways:

- With Discord, as necessary to operate through Discord's APIs and services.
- With users or staff in the same Discord server when a feature intentionally posts information to a server channel.
- With authorized server administrators who download ticket transcripts through the dashboard.
- With the ticket opener when MultiBot successfully sends that user a transcript by direct message.
- With infrastructure or hosting providers used by the Bot operator, to the extent necessary to host the Bot and dashboard.
- When required by applicable law, legal process, or a valid governmental request.

## 5. Data Retention

MultiBot retains server settings for as long as they remain in the Bot's data store or until they are deleted by the Bot operator.

Ticket metadata and generated HTML transcripts remain in the default local data store until they are manually deleted, the deployment is reset, or a separate retention process is configured by the operator. Deleting a Discord ticket channel does not automatically delete the saved transcript file.

Server administrators should establish a retention period appropriate for their community and legal obligations.

## 6. Your Choices and Requests

Depending on your role and the server's configuration, you can reduce or avoid certain processing by not using optional features such as tickets or the web dashboard.

Server administrators can disable supported features, including legacy prefix commands, welcome messages, logging, tickets, and verification, through the available server configuration controls.

For requests to access or delete information stored directly by a specific MultiBot deployment, contact the operator of that deployment. For the public source project, you may also open an issue at:

https://github.com/hunterl762/DiscordJs-MultiBot/issues

Because some information is posted directly into Discord, deletion from MultiBot's local files does not necessarily remove copies that already exist in Discord channels, direct messages, audit logs, backups, or other systems controlled by Discord or server administrators.

## 7. Security

MultiBot includes security controls such as Discord permission checks, OAuth state validation, CSRF protection for dashboard settings, HTTP-only session cookies, protected transcript downloads, and restricted ticket-channel permissions.

No method of transmission or storage is completely secure. Bot operators should keep Discord bot tokens, OAuth client secrets, session secrets, and hosting credentials private and should use HTTPS for public dashboard deployments.

## 8. Children's Privacy

MultiBot is intended to be used within Discord communities in accordance with Discord's own age requirements and applicable law. MultiBot does not intentionally collect information from children outside what is supplied through Discord and the configured server features. If an operator becomes aware that information was collected in violation of applicable requirements, the operator should delete it as appropriate.

## 9. Third-Party Services

MultiBot relies on Discord. Discord's handling of information is governed by Discord's own terms and privacy policy. MultiBot is not responsible for the privacy practices of Discord, server administrators, hosting providers, or other third parties.

## 10. Changes to This Policy

This policy may be updated when MultiBot's features, storage practices, or legal requirements change. The effective date at the top of this document will be updated when material revisions are made.

## 11. Contact

Questions about this policy or the open-source MultiBot project can be submitted through the repository's GitHub Issues page:

https://github.com/hunterl762/DiscordJs-MultiBot/issues

For a privately hosted MultiBot instance, contact the operator or administrators responsible for that deployment.
