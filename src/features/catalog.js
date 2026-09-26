const FEATURE_CATALOG = [
  {
    key: 'automod', title: 'Moderation / AutoMod', icon: '🛡️', priority: 'Very High', category: 'Security',
    description: 'Spam protection, link/invite blocking, bad-word filters and mass-mention protection.',
    maturity: 'core', defaultEnabled: false,
    fields: [
      { key: 'spamMessageLimit', label: 'Spam message limit', type: 'number', min: 3, max: 20, default: 6 },
      { key: 'spamWindowSeconds', label: 'Spam window (seconds)', type: 'number', min: 3, max: 60, default: 10 },
      { key: 'massMentionLimit', label: 'Mass mention limit', type: 'number', min: 2, max: 25, default: 5 },
      { key: 'blockLinks', label: 'Block external links', type: 'boolean', default: false },
      { key: 'blockInvites', label: 'Block Discord invites', type: 'boolean', default: true },
      { key: 'badWords', label: 'Blocked words (comma separated)', type: 'text', default: '' },
      { key: 'exemptRoleId', label: 'Exempt role', type: 'role', default: '' },
      { key: 'logChannelId', label: 'AutoMod log channel', type: 'channel', default: '' },
    ],
  },
  {
    key: 'tickets', title: 'Advanced Ticket System', icon: '🎫', priority: 'Very High', category: 'Support',
    description: 'Departments, staff access, transcripts, close workflows and ticket history.',
    maturity: 'core', defaultEnabled: true, link: '#ticket-config', fields: [],
  },
  {
    key: 'anti_raid', title: 'Anti-Raid / Anti-Nuke', icon: '🚨', priority: 'Very High', category: 'Security',
    description: 'Join-rate detection, suspicious account checks, automated lockdown and destructive-action protection.',
    maturity: 'core', defaultEnabled: false,
    fields: [
      { key: 'joinThreshold', label: 'Join threshold', type: 'number', min: 3, max: 100, default: 10 },
      { key: 'windowSeconds', label: 'Detection window (seconds)', type: 'number', min: 5, max: 300, default: 20 },
      { key: 'minAccountAgeDays', label: 'Minimum account age (days)', type: 'number', min: 0, max: 365, default: 3 },
      { key: 'destructiveThreshold', label: 'Mass action threshold', type: 'number', min: 2, max: 20, default: 4 },
      { key: 'destructiveWindowSeconds', label: 'Mass action window (seconds)', type: 'number', min: 5, max: 120, default: 15 },
      { key: 'logChannelId', label: 'Security log channel', type: 'channel', default: '' },
    ],
  },
  {
    key: 'dashboard', title: 'Web Dashboard', icon: '🖥️', priority: 'Very High', category: 'Core',
    description: 'Discord OAuth configuration center for server features, channels, roles and integrations.',
    maturity: 'core', defaultEnabled: true, locked: true, fields: [],
  },
  {
    key: 'logging', title: 'Advanced Logging', icon: '📚', priority: 'High', category: 'Core',
    description: 'Messages, moderation, roles, channels, verification and detailed audit-log attribution.',
    maturity: 'core', defaultEnabled: true, link: '#configuration', fields: [],
  },
  {
    key: 'welcome', title: 'Welcome / Goodbye', icon: '👋', priority: 'High', category: 'Community',
    description: 'Custom welcomes, goodbye messages, autoroles and optional DM welcomes.',
    maturity: 'core', defaultEnabled: true,
    fields: [
      { key: 'welcomeMessage', label: 'Welcome message', type: 'text', default: 'Welcome {user} to {server}! You are member #{memberCount}.' },
      { key: 'goodbyeMessage', label: 'Goodbye message', type: 'text', default: '{user} left {server}.' },
      { key: 'welcomeImageUrl', label: 'Welcome image URL', type: 'text', default: '' },
      { key: 'autoroleId', label: 'Auto role', type: 'role', default: '' },
      { key: 'dmWelcome', label: 'Send welcome DM', type: 'boolean', default: false },
      { key: 'dmMessage', label: 'Welcome DM message', type: 'text', default: 'Welcome to {server}, {user}!' },
    ],
  },
  {
    key: 'button_roles', title: 'Reaction / Button Roles', icon: '🎭', priority: 'High', category: 'Roles',
    description: 'Self roles for colors, games, notifications and community opt-ins.',
    maturity: 'core', defaultEnabled: false,
    fields: [{ key: 'panelChannelId', label: 'Default role panel channel', type: 'channel', default: '' }],
  },
  {
    key: 'leveling', title: 'Leveling / XP', icon: '📈', priority: 'High', category: 'Engagement',
    description: 'Text XP, voice XP, leaderboards, reward-role foundations and multipliers.',
    maturity: 'core', defaultEnabled: false,
    fields: [
      { key: 'messageXp', label: 'XP per message', type: 'number', min: 1, max: 100, default: 15 },
      { key: 'cooldownSeconds', label: 'Message XP cooldown', type: 'number', min: 10, max: 600, default: 60 },
      { key: 'voiceXpPerMinute', label: 'Voice XP per minute', type: 'number', min: 0, max: 100, default: 5 },
      { key: 'multiplier', label: 'XP multiplier', type: 'number', min: 1, max: 10, default: 1 },
    ],
  },
  {
    key: 'applications', title: 'Applications / Forms', icon: '📝', priority: 'High', category: 'Support',
    description: 'Staff and department applications with configurable questions and review workflows.',
    maturity: 'core', defaultEnabled: false,
    fields: [
      { key: 'reviewChannelId', label: 'Review channel', type: 'channel', required: true, default: '' },
      { key: 'reviewerRoleId', label: 'Reviewer role', type: 'role', default: '' },
      { key: 'questions', label: 'Questions (separate with |)', type: 'text', default: 'Why do you want to apply?|What experience do you have?' },
    ],
  },
  {
    key: 'giveaways', title: 'Giveaways', icon: '🎁', priority: 'High', category: 'Engagement',
    description: 'Timed giveaways, multiple winners, requirement foundations and rerolls.',
    maturity: 'partial', defaultEnabled: false,
    fields: [{ key: 'defaultChannelId', label: 'Default giveaway channel', type: 'channel', default: '' }],
  },
  {
    key: 'ai_assistant', title: 'AI Assistant', icon: '🤖', priority: 'Growing', category: 'Integrations',
    description: 'Server Q&A, ticket assistance, summaries and FAQ answering when an AI provider is configured.',
    maturity: 'integration', defaultEnabled: false,
    requirement: 'Requires AI provider API credentials.',
    fields: [{ key: 'channelId', label: 'AI channel', type: 'channel', required: true, default: '' }],
  },
  {
    key: 'analytics', title: 'Analytics', icon: '📊', priority: 'Growing', category: 'Insights',
    description: 'Command usage, member growth, activity and moderation/ticket statistics.',
    maturity: 'core', defaultEnabled: true, fields: [],
  },
  {
    key: 'temp_voice', title: 'Temporary Voice Channels', icon: '🔊', priority: 'Growing', category: 'Voice',
    description: 'Join-to-create voice rooms with ownership, limits and cleanup.',
    maturity: 'core', defaultEnabled: false,
    fields: [
      { key: 'lobbyChannelId', label: 'Join-to-create voice channel', type: 'channel', channelKind: 'voice', required: true, default: '' },
      { key: 'categoryId', label: 'Temporary voice category', type: 'category', default: '' },
    ],
  },
  {
    key: 'stream_alerts', title: 'Twitch / YouTube / Kick Alerts', icon: '📺', priority: 'Popular', category: 'Integrations',
    description: 'Rich live notifications for Twitch, YouTube, and Kick with configurable embeds, announcement channels, and optional live roles.',
    maturity: 'core', defaultEnabled: true, link: '#stream-alerts',
    requirement: 'Configure credentials for at least one streaming provider.', fields: [],
  },
  {
    key: 'music', title: 'Music', icon: '🎵', priority: 'Popular', category: 'Voice',
    description: 'Lavalink-backed music playback with queue, pause/resume, skip, volume, shuffle and loop controls.',
    maturity: 'integration', defaultEnabled: false, environmentFlag: 'MUSIC_ENABLED',
    requirement: 'Requires MUSIC_ENABLED=true and a Lavalink-compatible backend.',
    fields: [
      { key: 'defaultVolume', label: 'Default volume', type: 'number', min: 1, max: 200, default: 75 },
      { key: 'autoplay', label: 'Autoplay', type: 'boolean', default: false },
    ],
  },
  {
    key: 'suggestions', title: 'Suggestions / Polls', icon: '💡', priority: 'Popular', category: 'Community',
    description: 'Suggestion embeds, voting buttons/reactions, status workflow and staff responses.',
    maturity: 'core', defaultEnabled: false, link: '#suggestions',
    fields: [
      { key: 'channelId', label: 'Suggestion channel', type: 'channel', required: true, default: '' },
      { key: 'staffRoleId', label: 'Suggestion staff role', type: 'role', default: '' },
    ],
  },
  {
    key: 'economy', title: 'Server Economy', icon: '💰', priority: 'Popular', category: 'Engagement',
    description: 'Currency, balances, daily rewards and extensible shops/inventory.',
    maturity: 'core', defaultEnabled: false,
    fields: [
      { key: 'currencyName', label: 'Currency name', type: 'text', default: 'coins' },
      { key: 'startingBalance', label: 'Starting balance', type: 'number', min: 0, max: 1000000, default: 0 },
      { key: 'dailyAmount', label: 'Daily reward', type: 'number', min: 1, max: 1000000, default: 250 },
    ],
  },
  {
    key: 'starboard', title: 'Starboard', icon: '⭐', priority: 'Popular', category: 'Community',
    description: 'Highlight highly reacted-to messages in a configured starboard channel.',
    maturity: 'core', defaultEnabled: false,
    fields: [
      { key: 'channelId', label: 'Starboard channel', type: 'channel', required: true, default: '' },
      { key: 'threshold', label: 'Star threshold', type: 'number', min: 2, max: 50, default: 5 },
    ],
  },
  {
    key: 'invite_tracking', title: 'Invite Tracking', icon: '🔗', priority: 'Popular', category: 'Insights',
    description: 'Invite counts, join attribution and invite activity logging foundations.',
    maturity: 'core', defaultEnabled: false,
    fields: [{ key: 'logChannelId', label: 'Invite log channel', type: 'channel', required: true, default: '' }],
  },
  {
    key: 'reminders', title: 'Reminders / Events', icon: '⏰', priority: 'Popular', category: 'Utility',
    description: 'Personal reminders and persistent scheduled event delivery.',
    maturity: 'core', defaultEnabled: false,
    fields: [{ key: 'announcementChannelId', label: 'Default event channel', type: 'channel', default: '' }],
  },
  {
    key: 'custom_automations', title: 'Custom Automations', icon: '⚡', priority: 'Differentiator', category: 'Automation',
    description: 'Create “when X happens → do Y” rules for member joins and message matches with message, DM, or role actions.',
    maturity: 'core', defaultEnabled: false,
    fields: [{ key: 'logChannelId', label: 'Automation log channel', type: 'channel', default: '' }],
  },
];

const FEATURE_MAP = new Map(FEATURE_CATALOG.map((feature) => [feature.key, feature]));

function getFeatureDefinition(key) {
  return FEATURE_MAP.get(key) || null;
}

function defaultFeatureConfig(feature) {
  return Object.fromEntries((feature.fields || []).map((field) => [field.key, field.default]));
}

function envFlagEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function isFeatureEnvironmentEnabled(feature) {
  if (!feature?.environmentFlag) return true;
  return envFlagEnabled(process.env[feature.environmentFlag]);
}

module.exports = { FEATURE_CATALOG, getFeatureDefinition, defaultFeatureConfig, isFeatureEnvironmentEnabled };
