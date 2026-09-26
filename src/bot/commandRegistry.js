const fs = require('node:fs');
const path = require('node:path');

const commandsDir = path.join(process.cwd(), 'commands');
const commands = new Map();
const prefixCommands = new Map();

const CATEGORY_LABELS = {
  misc: 'Misc',
  moderation: 'Moderation',
  admin: 'Administration',
  owner: 'Owner Tools',
  tickets: 'Tickets',
  verification: 'Verification',
  security: 'Security',
  roles: 'Roles',
  leveling: 'Leveling',
  applications: 'Applications',
  giveaways: 'Giveaways',
  community: 'Community',
  economy: 'Economy',
  utility: 'Utility',
  analytics: 'Analytics',
  voice: 'Voice',
  integrations: 'Integrations',
  automations: 'Automations',
  music: 'Music',
  ai: 'AI Assistant',
};

function categoryLabel(folder) {
  if (CATEGORY_LABELS[folder]) return CATEGORY_LABELS[folder];

  return String(folder || 'Other')
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function walkCommandFolder(directory, relative) {
  const files = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('_')) continue;

    const full = path.join(directory, entry.name);
    const rel = path.join(relative, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkCommandFolder(full, rel));
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push({ full, rel });
    }
  }

  return files;
}

function findCommandFiles() {
  if (!fs.existsSync(commandsDir) || !fs.statSync(commandsDir).isDirectory()) {
    return [];
  }

  const files = [];

  for (const entry of fs.readdirSync(commandsDir, { withFileTypes: true })) {
    if (entry.name.startsWith('_') || entry.name.startsWith('.')) continue;

    const full = path.join(commandsDir, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkCommandFolder(full, entry.name));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.js')) {
      files.push({ full, rel: entry.name });
    }
  }

  return files;
}


for (const file of findCommandFiles().sort((a, b) => a.rel.localeCompare(b.rel))) {
  const command = require(file.full);
  if (!command?.name || !command?.data || typeof command.executeSlash !== 'function') {
    throw new Error(`Invalid command module: ${file.rel}`);
  }

  let payload;
  try {
    payload = command.data.toJSON();
  } catch (error) {
    throw new Error(
      `Unable to serialize slash-command builder in ${file.rel}: ${error.message || error}`,
    );
  }

  const moduleName = String(command.name).trim().toLowerCase();
  const payloadName = String(payload?.name || '').trim().toLowerCase();

  if (!payloadName) {
    throw new Error(`Slash-command builder in ${file.rel} does not define a command name.`);
  }

  if (moduleName !== payloadName) {
    throw new Error(
      `Command name mismatch in ${file.rel}: module exports "${moduleName}" but SlashCommandBuilder registers "/${payloadName}".`,
    );
  }

  const parts = file.rel.split(path.sep);
  const folder = parts.length > 1 ? parts[0] : 'misc';
  command.category = command.category || categoryLabel(folder);
  command.modulePath = file.rel.replaceAll(path.sep, '/');
  command.ownerOnly = command.ownerOnly === true || folder === 'owner';
  command.slashPayload = payload;

  const existing = commands.get(moduleName);

  if (existing) {
    throw new Error(
      `Duplicate command name "${moduleName}" in ${file.rel}; already loaded from ${existing.modulePath}`,
    );
  }

  command.name = moduleName;
  commands.set(moduleName, command);
  prefixCommands.set(moduleName, command);

  for (const rawAlias of command.aliases || []) {
    const alias = String(rawAlias).trim().toLowerCase();
    if (alias) prefixCommands.set(alias, command);
  }
}

const slashCommands = [...commands.values()].map((command) => command.slashPayload);

function commandCatalog() {
  return [...commands.values()]
    .map((command) => {
      const json = command.data.toJSON();
      return {
        name: command.name,
        category: command.category || 'Other',
        description: json.description || 'No description provided.',
        aliases: command.aliases || [],
        prefixBackup: typeof command.executePrefix === 'function',
        guildOnly: command.guildOnly !== false,
        ownerOnly: Boolean(command.ownerOnly),
        defaultMemberPermissions: json.default_member_permissions || null,
        subcommands: (json.options || []).filter((option) => option.type === 1).map((option) => option.name),
        modulePath: command.modulePath,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

module.exports = { commands, prefixCommands, slashCommands, commandCatalog };
