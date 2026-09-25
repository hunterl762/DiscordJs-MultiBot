const fs = require('node:fs');
const path = require('node:path');

const dataDir = path.join(process.cwd(), 'data');
const settingsFile = path.join(dataDir, 'settings.json');
const ticketsFile = path.join(dataDir, 'tickets.json');
const transcriptsDir = path.join(dataDir, 'transcripts');

function ensureDataFiles() {
  fs.mkdirSync(transcriptsDir, { recursive: true });
  if (!fs.existsSync(settingsFile)) fs.writeFileSync(settingsFile, '{}\n');
  if (!fs.existsSync(ticketsFile)) fs.writeFileSync(ticketsFile, '{}\n');
}

function readJson(file) {
  ensureDataFiles();
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    console.error(`Failed to read ${file}:`, error);
    return {};
  }
}

function writeJson(file, value) {
  ensureDataFiles();
  const temp = `${file}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, file);
}

function defaultGuildSettings() {
  return {
    prefix: process.env.DEFAULT_PREFIX || '!',
    welcomeChannelId: '',
    leaveChannelId: '',
    logsChannelId: '',
    broadcastChannelId: '',
    verificationChannelId: '',
    verifiedRoleId: '',
    unverifiedRoleId: '',
    ticketsCategoryId: '',
    ticketPanelChannelId: '',
    ticketStaffRoleId: '',
    transcriptChannelId: '',
    ticketsEnabled: true,
    loggingEnabled: true,
    welcomeEnabled: true,
    verificationEnabled: false,
    prefixCommandsEnabled: true,
  };
}

function getGuildSettings(guildId) {
  const all = readJson(settingsFile);
  return { ...defaultGuildSettings(), ...(all[guildId] || {}) };
}

function saveGuildSettings(guildId, settings) {
  const all = readJson(settingsFile);
  all[guildId] = { ...defaultGuildSettings(), ...settings };
  writeJson(settingsFile, all);
  return all[guildId];
}

function getTickets() {
  return readJson(ticketsFile);
}

function getTicket(ticketId) {
  return getTickets()[ticketId] || null;
}

function findOpenTicket(guildId, userId) {
  return Object.values(getTickets()).find(
    (ticket) => ticket.guildId === guildId && ticket.userId === userId && ticket.status === 'open',
  ) || null;
}

function findTicketByChannel(channelId) {
  return Object.values(getTickets()).find((ticket) => ticket.channelId === channelId) || null;
}

function saveTicket(ticket) {
  const tickets = getTickets();
  tickets[ticket.id] = ticket;
  writeJson(ticketsFile, tickets);
  return ticket;
}

function updateTicket(ticketId, patch) {
  const tickets = getTickets();
  if (!tickets[ticketId]) return null;
  tickets[ticketId] = { ...tickets[ticketId], ...patch };
  writeJson(ticketsFile, tickets);
  return tickets[ticketId];
}

function listGuildTickets(guildId) {
  return Object.values(getTickets())
    .filter((ticket) => ticket.guildId === guildId)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

module.exports = {
  transcriptsDir,
  getGuildSettings,
  saveGuildSettings,
  getTicket,
  findOpenTicket,
  findTicketByChannel,
  saveTicket,
  updateTicket,
  listGuildTickets,
};
