# Kryndexa file-based dashboard

The logged-in dashboard UI is intentionally stored in normal files instead of being generated as one giant HTML string in \`src/dashboard/server.js\`.

The visual structure is adapted from the MIT-licensed \`fuma-nama/discord-bot-dashboard-next\` project. The upstream project is archived, so Kryndexa keeps its existing Express/MySQL backend and uses EJS templates rather than depending on the archived Next.js runtime.

## Edit the dashboard

- \`views/dashboard/index.ejs\` — server selection page
- \`views/dashboard/statistics.ejs\` — server statistics page
- \`views/dashboard/guild.ejs\` — main server configuration page
- \`views/partials/shell-start.ejs\` — dashboard shell/top bar
- \`views/partials/sidebar.ejs\` — sidebar, server list and user card
- \`views/partials/shell-end.ejs\` — closes the shell and loads dashboard JavaScript
- \`public/dashboard-template.css\` — all dashboard styling, themes and responsive layout
- \`public/dashboard-template.js\` — theme toggle, mobile sidebar, search filters and autosave behavior

Public landing/privacy/terms pages still use the existing public-site renderer and \`public/style.css\`.

## Backend

Existing Express POST routes remain the source of truth for settings, ticket modules, features, command toggles, automations and Twitch alerts. EJS templates only render the UI; the data continues to come from Discord.js and MySQL.
