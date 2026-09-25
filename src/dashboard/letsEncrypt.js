const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

let renewalTimer = null;
let renewalRunning = false;

function envFlag(name, fallback = false) {
  const raw = String(process.env[name] ?? '').trim().toLowerCase();
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw);
}

function resolvePath(value) {
  const input = String(value || '').trim();
  if (!input) return '';
  return path.isAbsolute(input) ? input : path.resolve(process.cwd(), input);
}

function normalizeDomain(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/\.$/, '');
}

function getLetsEncryptConfig() {
  const provider = String(process.env.WEB_SSL_PROVIDER || '').trim().toLowerCase();
  const enabled = envFlag('LETSENCRYPT_ENABLED') || (
    envFlag('WEB_SSL_ENABLED') && provider === 'letsencrypt'
  );

  const domains = String(process.env.LETSENCRYPT_DOMAINS || 'kryndexabot.xyz')
    .split(',')
    .map(normalizeDomain)
    .filter(Boolean);

  const dataDir = resolvePath(
    process.env.LETSENCRYPT_DATA_DIR || path.join('certs', 'letsencrypt'),
  );

  const cloudflareToken = String(
    process.env.LETSENCRYPT_CLOUDFLARE_API_TOKEN
      || process.env.CLOUDFLARE_API_TOKEN
      || '',
  ).trim();

  return {
    enabled,
    staging: envFlag('LETSENCRYPT_STAGING', false),
    autoRenew: envFlag('LETSENCRYPT_AUTO_RENEW', true),
    email: String(process.env.LETSENCRYPT_EMAIL || '').trim(),
    domains: [...new Set(domains)],
    dataDir,
    renewBeforeDays: Math.max(1, Number(process.env.LETSENCRYPT_RENEW_BEFORE_DAYS || 30)),
    renewCheckHours: Math.max(1, Number(process.env.LETSENCRYPT_RENEW_CHECK_HOURS || 12)),
    dnsPropagationSeconds: Math.max(0, Number(process.env.LETSENCRYPT_DNS_PROPAGATION_SECONDS || 15)),
    zoneId: String(process.env.LETSENCRYPT_CLOUDFLARE_ZONE_ID || process.env.CLOUDFLARE_ZONE_ID || '').trim(),
    cloudflareToken,
  };
}

function getLetsEncryptPaths() {
  const { dataDir } = getLetsEncryptConfig();
  return {
    dataDir,
    accountKeyPath: path.join(dataDir, 'account-key.pem'),
    keyPath: path.join(dataDir, 'privkey.pem'),
    certPath: path.join(dataDir, 'fullchain.pem'),
  };
}

function extractLeafCertificate(pem) {
  const match = String(pem || '').match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/,
  );
  return match ? match[0] : '';
}

function readCertificateInfo(certPath) {
  try {
    if (!fs.existsSync(certPath)) return null;
    const pem = fs.readFileSync(certPath, 'utf8');
    const leaf = extractLeafCertificate(pem);
    if (!leaf) return null;

    const cert = new crypto.X509Certificate(leaf);
    const expiresAt = new Date(cert.validTo);
    const validFrom = new Date(cert.validFrom);
    const now = Date.now();

    return {
      subject: cert.subject,
      issuer: cert.issuer,
      validFrom: validFrom.toISOString(),
      expiresAt: expiresAt.toISOString(),
      daysRemaining: Math.max(0, Math.ceil((expiresAt.getTime() - now) / 86_400_000)),
      fingerprint256: cert.fingerprint256,
    };
  } catch (error) {
    return {
      error: error.message || String(error),
    };
  }
}

function getLetsEncryptStatus() {
  const config = getLetsEncryptConfig();
  const paths = getLetsEncryptPaths();
  const certificate = readCertificateInfo(paths.certPath);

  return {
    enabled: config.enabled,
    staging: config.staging,
    autoRenew: config.autoRenew,
    domains: config.domains,
    emailConfigured: Boolean(config.email),
    cloudflareDnsConfigured: Boolean(config.zoneId && config.cloudflareToken),
    renewBeforeDays: config.renewBeforeDays,
    renewCheckHours: config.renewCheckHours,
    certificate,
    hasPrivateKey: fs.existsSync(paths.keyPath),
    hasCertificate: fs.existsSync(paths.certPath),
  };
}

function certificateNeedsRenewal(certPath, renewBeforeDays) {
  const info = readCertificateInfo(certPath);
  if (!info || info.error || !info.expiresAt) return true;

  const renewAt = new Date(info.expiresAt).getTime() - renewBeforeDays * 86_400_000;
  return Date.now() >= renewAt;
}

function requireAcmeClient() {
  try {
    return require('acme-client');
  } catch (error) {
    const wrapped = new Error(
      'Let\'s Encrypt support requires the acme-client package. Run npm install before starting the bot.',
    );
    wrapped.cause = error;
    throw wrapped;
  }
}

async function cloudflareDnsRequest(method, resourcePath, token, body) {
  const response = await fetch(`${CLOUDFLARE_API}${resourcePath}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(12_000),
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok || !payload?.success) {
    const detail = Array.isArray(payload?.errors)
      ? payload.errors.map((item) => item?.message).filter(Boolean).join('; ')
      : '';

    throw new Error(
      `Cloudflare DNS API request failed with HTTP ${response.status}${detail ? `: ${detail}` : ''}`,
    );
  }

  return payload.result;
}

async function createCloudflareTxtRecord(config, name, content) {
  const result = await cloudflareDnsRequest(
    'POST',
    `/zones/${encodeURIComponent(config.zoneId)}/dns_records`,
    config.cloudflareToken,
    {
      type: 'TXT',
      name,
      content,
      ttl: 60,
      proxied: false,
      comment: 'Kryndexa Bot Let\'s Encrypt ACME DNS-01 challenge',
    },
  );

  if (!result?.id) {
    throw new Error('Cloudflare did not return a DNS record ID for the ACME challenge.');
  }

  return result.id;
}

async function deleteCloudflareDnsRecord(config, recordId) {
  if (!recordId) return;

  try {
    await cloudflareDnsRequest(
      'DELETE',
      `/zones/${encodeURIComponent(config.zoneId)}/dns_records/${encodeURIComponent(recordId)}`,
      config.cloudflareToken,
    );
  } catch (error) {
    console.warn('[Let\'s Encrypt] Unable to remove Cloudflare ACME TXT record:', error.message || error);
  }
}

function writePemFile(filePath, content, privateFile = false) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content, {
    encoding: 'utf8',
    mode: privateFile ? 0o600 : 0o644,
  });
}

async function ensureLetsEncryptCertificate({ force = false } = {}) {
  const config = getLetsEncryptConfig();
  const paths = getLetsEncryptPaths();

  if (!config.enabled) {
    return {
      enabled: false,
      changed: false,
      status: getLetsEncryptStatus(),
    };
  }

  if (!config.email) {
    throw new Error('LETSENCRYPT_EMAIL is required when Let\'s Encrypt is enabled.');
  }

  if (!config.domains.length) {
    throw new Error('LETSENCRYPT_DOMAINS must contain at least one hostname.');
  }

  if (config.domains.some((domain) => !domain.includes('.'))) {
    throw new Error('LETSENCRYPT_DOMAINS must contain public DNS hostnames.');
  }

  if (!config.zoneId || !config.cloudflareToken) {
    throw new Error(
      'Cloudflare DNS-01 validation requires LETSENCRYPT_CLOUDFLARE_ZONE_ID/CLOUDFLARE_ZONE_ID and LETSENCRYPT_CLOUDFLARE_API_TOKEN.',
    );
  }

  fs.mkdirSync(config.dataDir, { recursive: true });

  const hasExistingPair = fs.existsSync(paths.keyPath) && fs.existsSync(paths.certPath);
  if (!force && hasExistingPair && !certificateNeedsRenewal(paths.certPath, config.renewBeforeDays)) {
    const status = getLetsEncryptStatus();
    console.log(
      `[Let\'s Encrypt] Existing certificate is valid for ${status.certificate?.daysRemaining ?? '?'} more day(s); renewal not required.`,
    );
    return {
      enabled: true,
      changed: false,
      status,
    };
  }

  const acme = requireAcmeClient();
  const directoryUrl = config.staging
    ? acme.directory.letsencrypt.staging
    : acme.directory.letsencrypt.production;

  let accountKey;
  if (fs.existsSync(paths.accountKeyPath)) {
    accountKey = fs.readFileSync(paths.accountKeyPath, 'utf8');
  } else {
    accountKey = await acme.crypto.createPrivateEcdsaKey();
    writePemFile(paths.accountKeyPath, accountKey, true);
  }

  const [certificateKey, certificateCsr] = await acme.crypto.createCsr({
    altNames: config.domains,
  });

  const client = new acme.Client({
    directoryUrl,
    accountKey,
  });

  const challengeRecords = new Map();

  const cleanupAllChallenges = async () => {
    const records = [...challengeRecords.values()];
    challengeRecords.clear();
    await Promise.all(records.map((recordId) => deleteCloudflareDnsRecord(config, recordId)));
  };

  console.log(
    `[Let\'s Encrypt] Requesting ${config.staging ? 'STAGING' : 'production'} certificate for ${config.domains.join(', ')} using Cloudflare DNS-01.`,
  );

  try {
    const certificate = await client.auto({
      csr: certificateCsr,
      email: config.email,
      termsOfServiceAgreed: true,
      challengePriority: ['dns-01'],
      challengeCreateFn: async (authz, challenge, keyAuthorization) => {
        if (challenge.type !== 'dns-01') {
          throw new Error(`Unsupported ACME challenge type: ${challenge.type}`);
        }

        const identifier = normalizeDomain(authz?.identifier?.value).replace(/^\*\./, '');
        if (!identifier) throw new Error('ACME authorization did not include a DNS identifier.');

        const recordName = `_acme-challenge.${identifier}`;
        const recordContent = crypto
          .createHash('sha256')
          .update(keyAuthorization)
          .digest('base64url');

        const recordId = await createCloudflareTxtRecord(config, recordName, recordContent);
        challengeRecords.set(challenge.token, recordId);

        console.log(`[Let\'s Encrypt] Published DNS-01 challenge for ${recordName}.`);

        if (config.dnsPropagationSeconds > 0) {
          await new Promise((resolve) => setTimeout(resolve, config.dnsPropagationSeconds * 1000));
        }
      },
      challengeRemoveFn: async (_authz, challenge) => {
        const recordId = challengeRecords.get(challenge.token);
        challengeRecords.delete(challenge.token);
        await deleteCloudflareDnsRecord(config, recordId);
      },
    });

    writePemFile(paths.keyPath, certificateKey, true);
    writePemFile(paths.certPath, certificate, false);

    const status = getLetsEncryptStatus();
    console.log(
      `[Let\'s Encrypt] Certificate issued successfully; expires ${status.certificate?.expiresAt || 'at an unknown date'}.`,
    );

    return {
      enabled: true,
      changed: true,
      status,
      keyPath: paths.keyPath,
      certPath: paths.certPath,
    };
  } finally {
    await cleanupAllChallenges();
  }
}

function startLetsEncryptRenewal(onRenewed) {
  const config = getLetsEncryptConfig();

  if (!config.enabled || !config.autoRenew) return null;
  if (renewalTimer) return renewalTimer;

  const intervalMs = config.renewCheckHours * 60 * 60 * 1000;

  renewalTimer = setInterval(async () => {
    if (renewalRunning) return;
    renewalRunning = true;

    try {
      const result = await ensureLetsEncryptCertificate();
      if (result.changed && typeof onRenewed === 'function') {
        await onRenewed(result);
      }
    } catch (error) {
      console.error('[Let\'s Encrypt] Automatic renewal check failed:', error);
    } finally {
      renewalRunning = false;
    }
  }, intervalMs);

  renewalTimer.unref?.();
  console.log(
    `[Let\'s Encrypt] Automatic renewal checks enabled every ${config.renewCheckHours} hour(s).`,
  );

  return renewalTimer;
}

function stopLetsEncryptRenewal() {
  if (!renewalTimer) return;
  clearInterval(renewalTimer);
  renewalTimer = null;
}

module.exports = {
  ensureLetsEncryptCertificate,
  getLetsEncryptConfig,
  getLetsEncryptPaths,
  getLetsEncryptStatus,
  startLetsEncryptRenewal,
  stopLetsEncryptRenewal,
};
