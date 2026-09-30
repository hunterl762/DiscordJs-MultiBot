const { getPool } = require('./database');

const HEARTBEAT_MS = 60 * 1000;
const STALE_AFTER_MS = 2 * HEARTBEAT_MS;
const RETENTION_DAYS = 8;
let timer = null;
let getStates = null;

async function ensureUptimeSchema() {
  await getPool().query(`CREATE TABLE IF NOT EXISTS service_status_timesheet (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    service VARCHAR(24) NOT NULL,
    is_up TINYINT(1) NOT NULL,
    started_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    last_heartbeat_at DATETIME(3) NOT NULL,
    duration_seconds BIGINT UNSIGNED NULL,
    reason VARCHAR(255) NULL,
    detected_after_restart TINYINT(1) NOT NULL DEFAULT 0,
    PRIMARY KEY (id),
    KEY idx_service_timesheet_service_started (service, started_at),
    KEY idx_service_timesheet_open (service, ended_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
}

async function backfillHealthSamples(service, from, to) {
  const start = new Date(from).getTime();
  const end = new Date(to).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return;
  const floor = Math.max(start, Date.now() - RETENTION_DAYS * 86400000);
  const values = [];
  for (let at = floor + HEARTBEAT_MS; at < end; at += HEARTBEAT_MS) {
    values.push([service, 0, null, new Date(at)]);
  }
  for (let offset = 0; offset < values.length; offset += 500) {
    const chunk = values.slice(offset, offset + 500);
    if (!chunk.length) continue;
    await getPool().query(
      'INSERT INTO service_health_samples (service, is_up, latency_ms, checked_at) VALUES ?',
      [chunk],
    );
  }
}

async function recoverInterruptedSessions() {
  const [rows] = await getPool().query(
    `SELECT id, service, is_up, started_at, last_heartbeat_at
       FROM service_status_timesheet
      WHERE ended_at IS NULL
      ORDER BY id ASC`,
  );
  const now = new Date();
  for (const row of rows) {
    const last = new Date(row.last_heartbeat_at);
    await getPool().query(
      `UPDATE service_status_timesheet
          SET ended_at = ?, duration_seconds = GREATEST(0, TIMESTAMPDIFF(SECOND, started_at, ?)),
              reason = COALESCE(reason, 'Process stopped or heartbeat was lost')
        WHERE id = ? AND ended_at IS NULL`,
      [last, last, row.id],
    );
    if (now.getTime() - last.getTime() >= STALE_AFTER_MS) {
      await getPool().query(
        `INSERT INTO service_status_timesheet
          (service, is_up, started_at, ended_at, last_heartbeat_at, duration_seconds, reason, detected_after_restart)
         VALUES (?, 0, ?, ?, ?, GREATEST(0, TIMESTAMPDIFF(SECOND, ?, ?)), 'Downtime detected from missing heartbeat after restart', 1)`,
        [row.service, last, now, now, last, now],
      );
      await backfillHealthSamples(row.service, last, now);
    }
  }
}

async function recordState(service, isUp, reason = null) {
  const pool = getPool();
  const now = new Date();
  const [rows] = await pool.query(
    `SELECT id, is_up FROM service_status_timesheet
      WHERE service = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1`,
    [service],
  );
  const current = rows[0];
  const state = isUp ? 1 : 0;
  if (current && Number(current.is_up) === state) {
    await pool.query('UPDATE service_status_timesheet SET last_heartbeat_at = ? WHERE id = ?', [now, current.id]);
  } else {
    if (current) {
      await pool.query(
        `UPDATE service_status_timesheet
            SET ended_at = ?, last_heartbeat_at = ?, duration_seconds = GREATEST(0, TIMESTAMPDIFF(SECOND, started_at, ?))
          WHERE id = ?`,
        [now, now, now, current.id],
      );
    }
    await pool.query(
      `INSERT INTO service_status_timesheet
        (service, is_up, started_at, last_heartbeat_at, reason)
       VALUES (?, ?, ?, ?, ?)`,
      [service, state, now, now, reason],
    );
  }
  await pool.query(
    'INSERT INTO service_health_samples (service, is_up, latency_ms, checked_at) VALUES (?, ?, NULL, ?)',
    [service, state, now],
  );
}

async function heartbeat() {
  if (!getStates) return;
  try {
    const states = getStates();
    await recordState('bot', Boolean(states.bot), states.bot ? null : 'Discord client is not ready');
    await recordState('panel', Boolean(states.panel), states.panel ? null : 'Web panel is not listening');
    await getPool().query('DELETE FROM service_health_samples WHERE checked_at < DATE_SUB(NOW(), INTERVAL 8 DAY)');
  } catch (error) {
    console.warn('[Uptime] Unable to record service heartbeat:', error?.message || error);
  }
}

async function startUptimeMonitor(stateProvider) {
  getStates = stateProvider;
  await ensureUptimeSchema();
  await recoverInterruptedSessions();
  await heartbeat();
  timer = setInterval(heartbeat, HEARTBEAT_MS);
  timer.unref?.();
}

async function stopUptimeMonitor(reason = 'Graceful shutdown') {
  if (timer) clearInterval(timer);
  timer = null;
  try {
    const now = new Date();
    await getPool().query(
      `UPDATE service_status_timesheet
          SET ended_at = ?, last_heartbeat_at = ?, duration_seconds = GREATEST(0, TIMESTAMPDIFF(SECOND, started_at, ?)), reason = COALESCE(reason, ?)
        WHERE ended_at IS NULL`,
      [now, now, now, reason],
    );
  } catch (error) {
    console.warn('[Uptime] Unable to close service timesheet:', error?.message || error);
  }
}

module.exports = { ensureUptimeSchema, startUptimeMonitor, stopUptimeMonitor };
