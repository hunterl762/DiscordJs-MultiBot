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
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body, signal: controller.signal,
    });
    if (!response.ok) throw new Error(`UptimeRobot returned HTTP ${response.status}`);
    const payload = await response.json();
    if (payload?.stat !== 'ok') throw new Error(payload?.error?.message || 'UptimeRobot API request failed');
    return payload;
  } finally { clearTimeout(timeout); }
}

function statusLabel(status) {
  const code = Number(status);
  if (code === 2) return 'Operational';
  if (code === 8) return 'Seems Down';
  if (code === 9) return 'Down';
  if (code === 0) return 'Paused';
  return 'Unknown';
}

function averageResponseTime(times = []) {
  const values = times.map((item) => Number(item?.value)).filter(Number.isFinite);
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
}

function normalizeMonitor(monitor) {
  const ratios = String(monitor?.custom_uptime_ratio || '').split('-');
  return {
    id: String(monitor?.id || ''),
    name: String(monitor?.friendly_name || monitor?.url || 'UptimeRobot Monitor'),
    url: String(monitor?.url || ''),
    status: Number(monitor?.status || 0),
    statusLabel: statusLabel(monitor?.status),
    uptime7: ratios[0] || null,
    uptime30: ratios[1] || null,
    uptime90: ratios[2] || null,
    averageResponseMs: averageResponseTime(monitor?.response_times),
    responseTimes: Array.isArray(monitor?.response_times) ? monitor.response_times : [],
    logs: Array.isArray(monitor?.logs) ? monitor.logs : [],
  };
}

async function getMonitors() {
  if (!configured()) return { configured: false, monitors: [] };
  const ids = monitorIds();
  const payload = await request('getMonitors', {
    ...(ids.length ? { monitors: ids.join('-') } : {}),
    custom_uptime_ratios: '7-30-90', response_times: '1', response_times_limit: '24', logs: '1', logs_limit: '20',
  });
  return { configured: true, monitors: (Array.isArray(payload.monitors) ? payload.monitors : []).map(normalizeMonitor) };
}

async function getStatusSummary() {
  try {
    const result = await getMonitors();
    const monitors = result.monitors || [];
    return {
      configured: result.configured,
      available: true,
      monitors,
      allOperational: monitors.length ? monitors.every((monitor) => monitor.status === 2) : null,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return { configured: configured(), available: false, monitors: [], allOperational: null, checkedAt: new Date().toISOString(), error: error?.message || String(error) };
  }
}

module.exports = { configured, getMonitors, getStatusSummary, normalizeMonitor, statusLabel };
