const session = require('express-session');
const { encryptSecret, decryptSecret } = require('./cryptoSecrets');

class EncryptedSessionStore extends session.Store {
  constructor(delegate) {
    super();
    this.delegate = delegate;
  }

  get(sid, callback) {
    this.delegate.get(sid, (error, value) => {
      if (error || !value) return callback(error, value || null);
      try {
        if (!value.__encrypted) return callback(null, value);
        return callback(null, JSON.parse(decryptSecret(value.__encrypted)));
      } catch (decryptError) {
        return callback(decryptError);
      }
    });
  }

  set(sid, value, callback = () => {}) {
    try {
      return this.delegate.set(sid, {
        cookie: value?.cookie || undefined,
        __encrypted: encryptSecret(JSON.stringify(value)),
      }, callback);
    } catch (error) {
      return callback(error);
    }
  }

  destroy(sid, callback = () => {}) {
    return this.delegate.destroy(sid, callback);
  }

  touch(sid, value, callback = () => {}) {
    if (typeof this.delegate.touch !== 'function') return this.set(sid, value, callback);
    try {
      return this.delegate.touch(sid, {
        cookie: value?.cookie || undefined,
        __encrypted: encryptSecret(JSON.stringify(value)),
      }, callback);
    } catch (error) {
      return callback(error);
    }
  }
}

async function migrateLegacySessionRows(pool) {
  const [rows] = await pool.query('SELECT session_id,data FROM web_sessions');
  let migrated = 0;

  for (const row of rows) {
    try {
      const parsed = typeof row.data === 'string' ? JSON.parse(row.data) : row.data;
      if (!parsed || parsed.__encrypted) continue;

      const wrapped = JSON.stringify({
        cookie: parsed?.cookie || undefined,
        __encrypted: encryptSecret(JSON.stringify(parsed)),
      });

      await pool.execute('UPDATE web_sessions SET data=? WHERE session_id=?', [wrapped, row.session_id]);
      migrated += 1;
    } catch {
      // Ignore malformed or expired legacy rows.
    }
  }

  return migrated;
}

module.exports = { EncryptedSessionStore, migrateLegacySessionRows };
