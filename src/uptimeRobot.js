const UPTIMEROBOT_API_BASE = 'https://api.uptimerobot.com/v2';

function configured() {
  return Boolean(String(process.env.UPTIMEROBOT_API_KEY || '').trim());
}

function monitorIds() {
  return String(process.env.UPTIMEROBOT_MONITOR_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

async function request(endpoint, fields = {}) {
  const apiKey = String(process.env.UPTIMEROBOT_API_KEY || '').trim();
  if (!apiKey) throw new Error('UPTIMEROBOT_API_KEY is not configured');

  const body = new URLSearchParams({ api_key: apiKey, format: 'json', ...fields });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(`${UPTIMEROBOT_API_BASE}/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`UptimeRobot returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.stat !== 'ok') throw new Error(payload?.error?.message || 'UptimeRobot API request failed');
    return payload;
  } finally {
    clearTimeout(timeout);
  }
}

async function getMonitors() {
  if (!configured()) return { configured: false, monitors: [] };
  const ids = monitorIds();
  const payload = await request('getMonitors', {
    ...(ids.length ? { monitors: ids.join('-') } : {}),
    custom_uptime_ratios: '7-30-90',
    response_times: '1',
    response_times_limit: '24',
    logs: '1',
    logs_limit: '20',
  });
  return { configured: true, monitors: Array.isArray(payload.monitors) ? payload.monitors : [] };
}

function statusLabel(status) {
  const code = Number(status);
  if (code === 2) return 'Operational';
  if (code === 8) return 'Seems Down';
  if (code === 9) return 'Down';
  if (code === 0) return 'Paused';
  return 'Unknown';
}

module.exports = { configured, getMonitors, statusLabel };
