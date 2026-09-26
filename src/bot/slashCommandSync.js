const {
  REST,
  Routes,
} = require('discord.js');

const DEFAULT_GUILD_SYNC_DELAY_MS = 250;
const DEFAULT_RETRIES = 3;
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envFlag(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function clampNumber(value, fallback, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, numeric));
}

function commandNames(commands) {
  return (Array.isArray(commands) ? commands : [])
    .map((command) => String(command?.name || '').trim().toLowerCase())
    .filter(Boolean)
    .sort();
}

function sameCommandNames(left, right) {
  const a = commandNames(left);
  const b = commandNames(right);
  return a.length === b.length && a.every((name, index) => name === b[index]);
}

function validateOption(option, path) {
  if (!option || typeof option !== 'object') {
    throw new Error(`Invalid slash-command option at ${path}.`);
  }

  const name = String(option.name || '').trim();
  const description = String(option.description || '').trim();

  if (!/^[a-z0-9_-]{1,32}$/.test(name)) {
    throw new Error(`Invalid slash-command option name "${name}" at ${path}.`);
  }

  if (description.length < 1 || description.length > 100) {
    throw new Error(
      `Slash-command option description at ${path} must be 1-100 characters.`,
    );
  }

  if (Array.isArray(option.options)) {
    if (option.options.length > 25) {
      throw new Error(`Slash-command option group at ${path} has more than 25 options.`);
    }

    const seen = new Set();
    option.options.forEach((child, index) => {
      const childName = String(child?.name || '').trim().toLowerCase();
      if (seen.has(childName)) {
        throw new Error(`Duplicate slash-command option "${childName}" at ${path}.`);
      }
      seen.add(childName);
      validateOption(child, `${path}.options[${index}]`);
    });
  }

  if (Array.isArray(option.choices) && option.choices.length > 25) {
    throw new Error(`Slash-command option at ${path} has more than 25 choices.`);
  }
}

function validateSlashCommandPayloads(slashCommands) {
  if (!Array.isArray(slashCommands) || slashCommands.length === 0) {
    throw new Error('No slash commands were loaded from the commands directory.');
  }

  if (slashCommands.length > 100) {
    throw new Error(
      `Loaded ${slashCommands.length} chat-input commands; Discord allows at most 100 global chat-input commands.`,
    );
  }

  const seen = new Set();

  slashCommands.forEach((command, index) => {
    if (!command || typeof command !== 'object') {
      throw new Error(`Invalid slash-command payload at index ${index}.`);
    }

    const name = String(command.name || '').trim().toLowerCase();
    const description = String(command.description || '').trim();

    if (!/^[a-z0-9_-]{1,32}$/.test(name)) {
      throw new Error(`Invalid slash-command name "${name}" at index ${index}.`);
    }

    if (description.length < 1 || description.length > 100) {
      throw new Error(
        `Slash-command /${name} description must be between 1 and 100 characters.`,
      );
    }

    if (seen.has(name)) {
      throw new Error(`Duplicate slash-command payload: /${name}`);
    }
    seen.add(name);

    if (Array.isArray(command.options)) {
      if (command.options.length > 25) {
        throw new Error(`Slash-command /${name} has more than 25 top-level options.`);
      }

      const optionNames = new Set();
      command.options.forEach((option, optionIndex) => {
        const optionName = String(option?.name || '').trim().toLowerCase();
        if (optionNames.has(optionName)) {
          throw new Error(`Duplicate option "${optionName}" on slash-command /${name}.`);
        }
        optionNames.add(optionName);
        validateOption(option, `/${name}.options[${optionIndex}]`);
      });
    }
  });

  return true;
}

function retryDelay(error, attempt) {
  const rawRetryAfter = Number(
    error?.retry_after
      ?? error?.rawError?.retry_after
      ?? error?.data?.retry_after,
  );

  if (Number.isFinite(rawRetryAfter) && rawRetryAfter > 0) {
    // Discord retry_after may be seconds.
    return Math.ceil(rawRetryAfter * 1000);
  }

  return Math.min(5000, 500 * (2 ** attempt));
}

function isRetryableDiscordError(error) {
  const status = Number(error?.status || error?.httpStatus || 0);
  return RETRYABLE_STATUS_CODES.has(status);
}

async function withDiscordRetry(label, operation, retries = DEFAULT_RETRIES) {
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      if (!isRetryableDiscordError(error) || attempt >= retries) throw error;

      const delay = retryDelay(error, attempt);
      console.warn(
        `[Slash Commands] ${label} failed with HTTP ${error.status || 'unknown'}; retrying in ${delay}ms (${attempt + 1}/${retries}).`,
      );
      await sleep(delay);
    }
  }

  throw lastError;
}

function createRestClient() {
  const token = String(process.env.DISCORD_TOKEN || '').trim();
  if (!token) throw new Error('DISCORD_TOKEN is required to register slash commands.');
  return new REST({ version: '10' }).setToken(token);
}

function verifyRegistration(label, registered, slashCommands) {
  if (!Array.isArray(registered)) {
    throw new Error(`${label} did not return a command array from Discord.`);
  }

  if (!sameCommandNames(registered, slashCommands)) {
    const expected = commandNames(slashCommands);
    const received = commandNames(registered);
    throw new Error(
      `${label} verification mismatch. Expected [${expected.join(', ')}], received [${received.join(', ')}].`,
    );
  }

  return registered.length;
}

function commandSetDiff(previous, current) {
  const before = new Set(commandNames(previous));
  const after = new Set(commandNames(current));

  return {
    added: [...after].filter((name) => !before.has(name)),
    removed: [...before].filter((name) => !after.has(name)),
    retained: [...after].filter((name) => before.has(name)),
  };
}

async function fetchGlobalCommands(rest, applicationId, retries = DEFAULT_RETRIES) {
  return withDiscordRetry(
    'Global command inventory',
    () => rest.get(Routes.applicationCommands(applicationId)),
    retries,
  );
}

async function rebuildGlobalCommands(rest, applicationId, slashCommands, retries = DEFAULT_RETRIES) {
  validateSlashCommandPayloads(slashCommands);

  const previous = await fetchGlobalCommands(rest, applicationId, retries);
  const diff = commandSetDiff(previous, slashCommands);

  // Discord bulk-overwrite is authoritative: commands absent from slashCommands are
  // removed, existing definitions are updated, and newly loaded commands are created.
  const registered = await withDiscordRetry(
    'Global command rebuild',
    () => rest.put(
      Routes.applicationCommands(applicationId),
      { body: slashCommands },
    ),
    retries,
  );

  verifyRegistration('Global command rebuild', registered, slashCommands);

  const verified = await fetchGlobalCommands(rest, applicationId, retries);
  const count = verifyRegistration(
    'Global command post-rebuild verification',
    verified,
    slashCommands,
  );

  console.log(
    `[Slash Commands] Global rebuild complete: ${count} current command(s), ${diff.added.length} added, ${diff.removed.length} stale removed, ${diff.retained.length} retained/updated.`,
  );

  if (diff.added.length) {
    console.log(`[Slash Commands] Added globally: ${diff.added.map((name) => `/${name}`).join(', ')}`);
  }
  if (diff.removed.length) {
    console.log(`[Slash Commands] Removed stale globals: ${diff.removed.map((name) => `/${name}`).join(', ')}`);
  }

  return {
    registered: verified,
    count,
    ...diff,
  };
}

async function syncGlobalCommands(rest, applicationId, slashCommands, retries = DEFAULT_RETRIES) {
  const result = await rebuildGlobalCommands(
    rest,
    applicationId,
    slashCommands,
    retries,
  );
  return result.registered;
}

async function syncGuildCommands(
  rest,
  applicationId,
  guild,
  slashCommands,
  retries = DEFAULT_RETRIES,
) {
  const registered = await withDiscordRetry(
    `Guild sync for ${guild.name} (${guild.id})`,
    () => rest.put(
      Routes.applicationGuildCommands(applicationId, guild.id),
      { body: slashCommands },
    ),
    retries,
  );

  const count = verifyRegistration(
    `Guild sync for ${guild.name} (${guild.id})`,
    registered,
    slashCommands,
  );

  return count;
}

async function syncAllGuildCommands(
  client,
  rest,
  applicationId,
  slashCommands,
  {
    delayMs = DEFAULT_GUILD_SYNC_DELAY_MS,
    retries = DEFAULT_RETRIES,
  } = {},
) {
  const guilds = [...client.guilds.cache.values()];
  const summary = {
    total: guilds.length,
    synced: 0,
    failed: 0,
    failures: [],
  };

  console.log(
    `[Slash Commands] Starting multi-guild sync for ${guilds.length} connected server(s).`,
  );

  for (let index = 0; index < guilds.length; index += 1) {
    const guild = guilds[index];

    try {
      const count = await syncGuildCommands(
        rest,
        applicationId,
        guild,
        slashCommands,
        retries,
      );

      summary.synced += 1;
      console.log(
        `[Slash Commands] [${index + 1}/${guilds.length}] ${guild.name} (${guild.id}): ${count} command(s) registered.`,
      );
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({
        guildId: guild.id,
        guildName: guild.name,
        code: error?.code ?? null,
        status: error?.status ?? null,
        message: error?.message || String(error),
      });

      if (error?.code === 50001 || error?.status === 403) {
        console.warn(
          `[Slash Commands] [${index + 1}/${guilds.length}] ${guild.name} (${guild.id}): Missing Access. Reinvite the bot/application to this server with the applications.commands scope.`,
        );
      } else {
        console.warn(
          `[Slash Commands] [${index + 1}/${guilds.length}] ${guild.name} (${guild.id}) failed: ${error?.message || error}`,
        );
      }
    }

    if (delayMs > 0 && index < guilds.length - 1) {
      await sleep(delayMs);
    }
  }

  console.log(
    `[Slash Commands] Multi-guild sync complete: ${summary.synced}/${summary.total} server(s) synced, ${summary.failed} failed.`,
  );

  return summary;
}

async function registerSlashCommands(client, slashCommands) {
  validateSlashCommandPayloads(slashCommands);
  await client.application.fetch();

  const applicationId = client.application.id;
  const configuredClientId = String(process.env.DISCORD_CLIENT_ID || '').trim();
  const retries = clampNumber(
    process.env.SLASH_COMMAND_SYNC_RETRIES,
    DEFAULT_RETRIES,
    0,
    10,
  );
  const delayMs = clampNumber(
    process.env.SLASH_COMMAND_SYNC_DELAY_MS,
    DEFAULT_GUILD_SYNC_DELAY_MS,
    0,
    5000,
  );

  if (configuredClientId && configuredClientId !== applicationId) {
    console.warn(
      `[Slash Commands] DISCORD_CLIENT_ID=${configuredClientId} does not match logged-in application ${applicationId}. Using the logged-in application ID for registration.`,
    );
  }

  console.log(
    `[Slash Commands] Loaded ${slashCommands.length} command(s): ${commandNames(slashCommands).map((name) => `/${name}`).join(', ')}`,
  );

  const rest = createRestClient();

  let globalError = null;
  let globalSummary = {
    count: 0,
    added: [],
    removed: [],
    retained: [],
  };

  try {
    globalSummary = await rebuildGlobalCommands(
      rest,
      applicationId,
      slashCommands,
      retries,
    );
  } catch (error) {
    globalError = error;
    console.error(
      '[Slash Commands] Global rebuild failed; continuing with direct multi-guild registration:',
      error,
    );
  }

  const multiGuildEnabled = envFlag('SLASH_COMMAND_MULTI_GUILD_SYNC', true);
  let guildSummary = {
    total: client.guilds.cache.size,
    synced: 0,
    failed: 0,
    failures: [],
  };

  if (multiGuildEnabled) {
    guildSummary = await syncAllGuildCommands(
      client,
      rest,
      applicationId,
      slashCommands,
      { delayMs, retries },
    );
  } else {
    console.log(
      '[Slash Commands] Direct multi-guild sync disabled; only the global command set was registered.',
    );
  }

  if (globalError && guildSummary.synced === 0) {
    throw globalError;
  }

  return {
    applicationId,
    commandCount: slashCommands.length,
    globalRegistered: !globalError,
    globalSummary,
    guildSummary,
  };
}

function registerGuildJoinSlashSync(client, slashCommands) {
  client.on('guildCreate', async (guild) => {
    try {
      validateSlashCommandPayloads(slashCommands);
      await client.application.fetch();

      const rest = createRestClient();
      const applicationId = client.application.id;
      const retries = clampNumber(
        process.env.SLASH_COMMAND_SYNC_RETRIES,
        DEFAULT_RETRIES,
        0,
        10,
      );

      const count = await syncGuildCommands(
        rest,
        applicationId,
        guild,
        slashCommands,
        retries,
      );

      console.log(
        `[Slash Commands] New server sync complete for ${guild.name} (${guild.id}): ${count} command(s) registered.`,
      );
    } catch (error) {
      console.warn(
        `[Slash Commands] New server sync failed for ${guild.name} (${guild.id}): ${error?.message || error}`,
      );
    }
  });
}

module.exports = {
  commandNames,
  sameCommandNames,
  validateSlashCommandPayloads,
  createRestClient,
  fetchGlobalCommands,
  rebuildGlobalCommands,
  syncGlobalCommands,
  syncGuildCommands,
  syncAllGuildCommands,
  registerSlashCommands,
  registerGuildJoinSlashSync,
};
