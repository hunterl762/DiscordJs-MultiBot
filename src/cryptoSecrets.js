const crypto = require('node:crypto');

function keyFrom(source) {
  return crypto.createHash('sha256').update(String(source)).digest();
}

function keySources() {
  return [
    process.env.DASHBOARD_ENCRYPTION_KEY,
    process.env.CREDENTIAL_ENCRYPTION_KEY,
    process.env.SESSION_SECRET,
  ].filter((value, index, values) => value && values.indexOf(value) === index);
}

function primaryKey() {
  const sources = keySources();
  if (!sources.length) {
    throw new Error('DASHBOARD_ENCRYPTION_KEY, CREDENTIAL_ENCRYPTION_KEY, or SESSION_SECRET must be configured.');
  }
  return keyFrom(sources[0]);
}

function encryptSecret(value) {
  const plaintext = String(value ?? '');
  if (!plaintext) return '';
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', primaryKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, encrypted].map((part) => part.toString('base64url')).join('.');
}

function decryptWithKey(payload, key) {
  const [ivPart, tagPart, dataPart] = String(payload || '').split('.');
  if (!ivPart || !tagPart || !dataPart) throw new Error('Invalid encrypted payload.');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivPart, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagPart, 'base64url'));
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, 'base64url')),
    decipher.final(),
  ]).toString('utf8');
}

function decryptSecret(payload) {
  if (!payload) return '';
  const sources = keySources();
  if (!sources.length) throw new Error('No dashboard encryption key source is configured.');

  let lastError;
  for (const source of sources) {
    try {
      return decryptWithKey(payload, keyFrom(source));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('Unable to decrypt dashboard data.');
}

module.exports = { encryptSecret, decryptSecret };
