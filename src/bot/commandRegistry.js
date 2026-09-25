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

const COMMAND_FOLDERS = Object.keys(CATEGORY_LABELS);

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
  const files = [];

  for (const folder of COMMAND_FOLDERS) {
    const directory = path.join(commandsDir, folder);
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) continue;
    files.push(...walkCommandFolder(directory, folder));
  }

  return files;
}


for (const file of findCommandFiles().sort((a, b) => a.rel.localeCompare(b.rel))) {
  const command = require(file.full);
  if (!command?.name || !command?.data || typeof command.executeSlash !== 'function') {
    throw new Error(`Invalid command module: ${file.rel}`);
  }

  const folder = file.rel.split(path.sep)[0];
  command.category = command.category || CATEGORY_LABELS[folder] || 'Other';
  command.modulePath = file.rel.replaceAll(path.sep, '/');

  const commandName = String(command.name).toLowerCase();
  const existing = commands.get(commandName);

  if (existing) {
    throw new Error(
      `Duplicate command name "${commandName}" in ${file.rel}; already loaded from ${existing.modulePath}`,
    );
  }

  command.name = commandName;
  commands.set(commandName, command);
  prefixCommands.set(command.name, command);
  for (const alias of command.aliases || []) prefixCommands.set(alias, command);
}

const slashCommands = [...commands.values()].map((command) => command.data.toJSON());

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
        defaultMemberPermissions: json.default_member_permissions || null,
        subcommands: (json.options || []).filter((option) => option.type === 1).map((option) => option.name),
        modulePath: command.modulePath,
      };
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name));
}

module.exports = { commands, prefixCommands, slashCommands, commandCatalog };
