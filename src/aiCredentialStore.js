const { getSecureRecord, listSecureRecords, putSecureRecord, deleteSecureRecord } = require('./dashboardSecureStore');

const NS = 'ai_credential';
const PROVIDERS = {
  openai: { label: 'OpenAI', defaultModel: 'gpt-5.6-mini', defaultBaseUrl: 'https://api.openai.com/v1' },
  anthropic: { label: 'Anthropic', defaultModel: 'claude-sonnet-4-5', defaultBaseUrl: 'https://api.anthropic.com' },
  google: { label: 'Google Gemini', defaultModel: 'gemini-2.5-flash', defaultBaseUrl: 'https://generativelanguage.googleapis.com' },
};

function normalize(provider, payload = {}) {
  const def = PROVIDERS[provider];
  if (!def) throw new Error('Unsupported AI provider.');
  return {
    provider,
    label: def.label,
    apiKey: String(payload.apiKey || '').trim(),
    model: String(payload.model || def.defaultModel).trim().slice(0, 120),
    baseUrl: String(payload.baseUrl || def.defaultBaseUrl).trim().slice(0, 500),
    enabled: payload.enabled !== false,
  };
}

async function listAiCredentials(guildId) {
  const rows = await listSecureRecords(guildId, NS);
  const byProvider = new Map(rows.map((row) => [row.recordKey, row.payload]));
  return Object.keys(PROVIDERS).map((provider) => {
    const item = byProvider.get(provider);
    const normalized = normalize(provider, item || {});
    return {
      ...normalized,
      apiKey: '',
      configured: Boolean(item?.apiKey),
      maskedKey: item?.apiKey ? `${String(item.apiKey).slice(0, 4)}••••${String(item.apiKey).slice(-4)}` : '',
    };
  });
}

async function getAiCredential(guildId, provider) {
  const row = await getSecureRecord(guildId, NS, provider);
  return row ? normalize(provider, row.payload) : null;
}

async function saveAiCredential(guildId, provider, patch) {
  const current = await getAiCredential(guildId, provider);
  const next = normalize(provider, {
    ...current,
    ...patch,
    apiKey: String(patch.apiKey || '').trim() || current?.apiKey || '',
  });
  await putSecureRecord(guildId, NS, provider, next);
  return { ...next, apiKey: '', configured: Boolean(next.apiKey) };
}

async function deleteAiCredential(guildId, provider) {
  return deleteSecureRecord(guildId, NS, provider);
}

module.exports = { PROVIDERS, listAiCredentials, getAiCredential, saveAiCredential, deleteAiCredential };
