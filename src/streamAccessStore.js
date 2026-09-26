const {
  getSecureRecord,
  listSecureNamespace,
  putSecureRecord,
  deleteSecureRecord,
} = require('./dashboardSecureStore');

const NS = 'stream_alert_access';
const RECORD_KEY = 'paid';
const FREE_STREAMER_LIMIT = 3;
const PAID_STREAMER_LIMIT = 15;

function normalizeEntitlement(guildId, payload = {}, updatedAt = null) {
  const paid = payload.paid === true;
  return {
    guildId: String(guildId),
    paid,
    tier: paid ? 'paid' : 'free',
    streamerLimit: paid ? PAID_STREAMER_LIMIT : FREE_STREAMER_LIMIT,
    grantedBy: String(payload.grantedBy || ''),
    note: String(payload.note || '').slice(0, 500),
    grantedAt: payload.grantedAt || null,
    updatedAt,
  };
}

async function getStreamAlertAccess(guildId) {
  const row = await getSecureRecord(String(guildId), NS, RECORD_KEY);
  return normalizeEntitlement(guildId, row?.payload || {}, row?.updatedAt || null);
}

async function listPaidStreamAlertAccess() {
  const rows = await listSecureNamespace(NS);
  return rows
    .filter((row) => row.recordKey === RECORD_KEY && row.payload?.paid === true)
    .map((row) => normalizeEntitlement(row.guildId, row.payload, row.updatedAt))
    .sort((a, b) => String(a.guildId).localeCompare(String(b.guildId)));
}

async function setStreamAlertPaidAccess(guildId, {
  paid,
  grantedBy = '',
  note = '',
} = {}) {
  const id = String(guildId || '').trim();
  if (!/^\d{10,32}$/.test(id)) {
    throw new Error('A valid Discord server ID is required.');
  }

  if (!paid) {
    await deleteSecureRecord(id, NS, RECORD_KEY);
    return getStreamAlertAccess(id);
  }

  const current = await getSecureRecord(id, NS, RECORD_KEY);
  const grantedAt = current?.payload?.grantedAt || new Date().toISOString();

  await putSecureRecord(id, NS, RECORD_KEY, {
    paid: true,
    grantedBy: String(grantedBy || '').slice(0, 32),
    note: String(note || '').trim().slice(0, 500),
    grantedAt,
  });

  return getStreamAlertAccess(id);
}

module.exports = {
  FREE_STREAMER_LIMIT,
  PAID_STREAMER_LIMIT,
  getStreamAlertAccess,
  listPaidStreamAlertAccess,
  setStreamAlertPaidAccess,
};
