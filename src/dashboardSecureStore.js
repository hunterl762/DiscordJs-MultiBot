const { getPool } = require('./database');
const { encryptSecret, decryptSecret } = require('./cryptoSecrets');

function decode(row) {
  if (!row) return null;
  try {
    return {
      guildId: row.guild_id,
      namespace: row.namespace,
      recordKey: row.record_key,
      payload: JSON.parse(decryptSecret(row.encrypted_json)),
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    };
  } catch (error) {
    error.message = `Unable to decrypt dashboard record ${row.namespace}/${row.record_key}: ${error.message}`;
    throw error;
  }
}

async function getSecureRecord(guildId, namespace, recordKey) {
  const [rows] = await getPool().execute(
    `SELECT guild_id,namespace,record_key,encrypted_json,created_at,updated_at
       FROM dashboard_secure_records
      WHERE guild_id=? AND namespace=? AND record_key=? LIMIT 1`,
    [guildId, namespace, recordKey],
  );
  return decode(rows[0]);
}

async function listSecureRecords(guildId, namespace) {
  const [rows] = await getPool().execute(
    `SELECT guild_id,namespace,record_key,encrypted_json,created_at,updated_at
       FROM dashboard_secure_records
      WHERE guild_id=? AND namespace=?
      ORDER BY record_key ASC`,
    [guildId, namespace],
  );
  return rows.map(decode);
}

async function listSecureNamespace(namespace) {
  const [rows] = await getPool().execute(
    `SELECT guild_id,namespace,record_key,encrypted_json,created_at,updated_at
       FROM dashboard_secure_records
      WHERE namespace=?
      ORDER BY guild_id ASC,record_key ASC`,
    [namespace],
  );
  return rows.map(decode);
}

async function putSecureRecord(guildId, namespace, recordKey, payload) {
  const encrypted = encryptSecret(JSON.stringify(payload ?? {}));
  await getPool().execute(
    `INSERT INTO dashboard_secure_records (guild_id,namespace,record_key,encrypted_json)
     VALUES (?,?,?,?)
     ON DUPLICATE KEY UPDATE encrypted_json=VALUES(encrypted_json),updated_at=CURRENT_TIMESTAMP`,
    [guildId, namespace, String(recordKey), encrypted],
  );
  return getSecureRecord(guildId, namespace, String(recordKey));
}

async function deleteSecureRecord(guildId, namespace, recordKey) {
  const [result] = await getPool().execute(
    'DELETE FROM dashboard_secure_records WHERE guild_id=? AND namespace=? AND record_key=?',
    [guildId, namespace, String(recordKey)],
  );
  return result.affectedRows > 0;
}

module.exports = {
  getSecureRecord,
  listSecureRecords,
  listSecureNamespace,
  putSecureRecord,
  deleteSecureRecord,
};
