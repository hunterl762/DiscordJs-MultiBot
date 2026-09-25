const fs = require('node:fs');
const mysql = require('mysql2/promise');

function envBool(name, fallback = false) {
  const value = process.env[name];
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function buildSslOptions() {
  if (!envBool('MYSQL_SSL', false)) return undefined;
  const ssl = { rejectUnauthorized: envBool('MYSQL_SSL_REJECT_UNAUTHORIZED', true) };
  if (process.env.MYSQL_SSL_CA_FILE) ssl.ca = fs.readFileSync(process.env.MYSQL_SSL_CA_FILE, 'utf8');
  return ssl;
}

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: Math.max(1, Number(process.env.MYSQL_CONNECTION_LIMIT || 10)),
  queueLimit: 0,
  charset: 'utf8mb4',
  supportBigNumbers: true,
  bigNumberStrings: true,
  ssl: buildSslOptions(),
});

const schemaStatements = [
  `CREATE TABLE IF NOT EXISTS guild_settings (
    guild_id VARCHAR(32) NOT NULL,
    prefix VARCHAR(5) NOT NULL DEFAULT '!',
    welcome_channel_id VARCHAR(32) NOT NULL DEFAULT '',
    leave_channel_id VARCHAR(32) NOT NULL DEFAULT '',
    logs_channel_id VARCHAR(32) NOT NULL DEFAULT '',
    verification_log_channel_id VARCHAR(32) NOT NULL DEFAULT '',
    role_log_channel_id VARCHAR(32) NOT NULL DEFAULT '',
    broadcast_channel_id VARCHAR(32) NOT NULL DEFAULT '',
    verification_channel_id VARCHAR(32) NOT NULL DEFAULT '',
    verified_role_id VARCHAR(32) NOT NULL DEFAULT '',
    unverified_role_id VARCHAR(32) NOT NULL DEFAULT '',
    tickets_category_id VARCHAR(32) NOT NULL DEFAULT '',
    ticket_panel_channel_id VARCHAR(32) NOT NULL DEFAULT '',
    ticket_staff_role_id VARCHAR(32) NOT NULL DEFAULT '',
    transcript_channel_id VARCHAR(32) NOT NULL DEFAULT '',
    max_open_tickets_per_user INT NOT NULL DEFAULT 3,
    online_transcripts_enabled TINYINT(1) NOT NULL DEFAULT 1,
    transcript_attachments_enabled TINYINT(1) NOT NULL DEFAULT 1,
    tickets_enabled TINYINT(1) NOT NULL DEFAULT 1,
    logging_enabled TINYINT(1) NOT NULL DEFAULT 1,
    welcome_enabled TINYINT(1) NOT NULL DEFAULT 1,
    verification_enabled TINYINT(1) NOT NULL DEFAULT 0,
    prefix_commands_enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS tickets (
    id CHAR(36) NOT NULL,
    guild_id VARCHAR(32) NOT NULL,
    channel_id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    ticket_type_key VARCHAR(32) NOT NULL DEFAULT 'support',
    status VARCHAR(16) NOT NULL DEFAULT 'open',
    created_at DATETIME(3) NOT NULL,
    closed_at DATETIME(3) NULL,
    closed_by VARCHAR(32) NULL,
    claimed_by VARCHAR(32) NULL,
    close_reason VARCHAR(1000) NULL,
    transcript_public_token VARCHAR(96) NULL,
    transcript_filename VARCHAR(255) NULL,
    transcript_html LONGTEXT NULL,
    PRIMARY KEY (id),
    KEY idx_tickets_guild_created (guild_id, created_at),
    KEY idx_tickets_user_status (guild_id, user_id, status),
    KEY idx_tickets_type_status (guild_id, user_id, ticket_type_key, status),
    UNIQUE KEY uq_tickets_transcript_token (transcript_public_token),
    KEY idx_tickets_channel (channel_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS ticket_types (
    guild_id VARCHAR(32) NOT NULL,
    type_key VARCHAR(32) NOT NULL,
    label VARCHAR(80) NOT NULL,
    description VARCHAR(200) NOT NULL,
    emoji VARCHAR(32) NOT NULL DEFAULT '',
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    category_id VARCHAR(32) NOT NULL DEFAULT '',
    staff_role_id VARCHAR(32) NOT NULL DEFAULT '',
    sort_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, type_key),
    KEY idx_ticket_types_enabled (guild_id, enabled, sort_order)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS server_features (
    guild_id VARCHAR(32) NOT NULL,
    feature_key VARCHAR(64) NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 0,
    config_json JSON NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, feature_key),
    KEY idx_server_features_enabled (guild_id, enabled)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS warnings (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    moderator_id VARCHAR(32) NOT NULL,
    reason VARCHAR(1000) NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_warnings_user (guild_id, user_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS user_levels (
    guild_id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    xp BIGINT UNSIGNED NOT NULL DEFAULT 0,
    level INT UNSIGNED NOT NULL DEFAULT 0,
    message_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
    voice_minutes BIGINT UNSIGNED NOT NULL DEFAULT 0,
    last_message_xp_at DATETIME NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, user_id),
    KEY idx_user_levels_xp (guild_id, xp)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS economy_accounts (
    guild_id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    balance BIGINT NOT NULL DEFAULT 0,
    last_daily_at DATETIME NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, user_id),
    KEY idx_economy_balance (guild_id, balance)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS reminders (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id VARCHAR(32) NOT NULL,
    user_id VARCHAR(32) NOT NULL,
    channel_id VARCHAR(32) NOT NULL,
    message VARCHAR(1000) NOT NULL,
    due_at DATETIME NOT NULL,
    delivered_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_reminders_due (delivered_at, due_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS command_usage (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id VARCHAR(32) NULL,
    user_id VARCHAR(32) NOT NULL,
    command_name VARCHAR(64) NOT NULL,
    used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_command_usage_guild (guild_id, used_at),
    KEY idx_command_usage_command (guild_id, command_name, used_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS automation_rules (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id VARCHAR(32) NOT NULL,
    name VARCHAR(80) NOT NULL,
    trigger_type VARCHAR(32) NOT NULL,
    trigger_value VARCHAR(500) NOT NULL DEFAULT '',
    action_type VARCHAR(32) NOT NULL,
    action_channel_id VARCHAR(32) NOT NULL DEFAULT '',
    action_role_id VARCHAR(32) NOT NULL DEFAULT '',
    action_message VARCHAR(1500) NOT NULL DEFAULT '',
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_automation_rules_trigger (guild_id, enabled, trigger_type)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS server_commands (
    guild_id VARCHAR(32) NOT NULL,
    command_name VARCHAR(64) NOT NULL,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (guild_id, command_name),
    KEY idx_server_commands_enabled (guild_id, enabled)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS server_backups (
    id CHAR(36) NOT NULL,
    guild_id VARCHAR(32) NOT NULL,
    created_by VARCHAR(32) NOT NULL,
    channel_count INT UNSIGNED NOT NULL DEFAULT 0,
    role_count INT UNSIGNED NOT NULL DEFAULT 0,
    snapshot_json LONGTEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    KEY idx_server_backups_guild_created (guild_id, created_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS web_sessions (
    session_id VARCHAR(128) NOT NULL,
    expires INT UNSIGNED NOT NULL,
    data MEDIUMTEXT,
    PRIMARY KEY (session_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
  `CREATE TABLE IF NOT EXISTS twitch_announcements (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    guild_id VARCHAR(32) NOT NULL,
    twitch_login VARCHAR(64) NOT NULL,
    discord_channel_id VARCHAR(32) NOT NULL,
    custom_message VARCHAR(500) NOT NULL DEFAULT '',
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    created_by VARCHAR(32) NOT NULL,
    is_live TINYINT(1) NOT NULL DEFAULT 0,
    last_stream_id VARCHAR(64) NULL,
    last_started_at DATETIME(3) NULL,
    last_announced_at DATETIME(3) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (id),
    UNIQUE KEY uq_twitch_guild_login (guild_id, twitch_login),
    KEY idx_twitch_enabled (enabled),
    KEY idx_twitch_guild (guild_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
];

async function initDatabase() {
  const connection = await pool.getConnection();
  try {
    await connection.query('SELECT 1');
    if (envBool('MYSQL_AUTO_MIGRATE', true)) {
      for (const statement of schemaStatements) await connection.query(statement);

      const loggingColumns = [
        ['verification_log_channel_id', "ALTER TABLE guild_settings ADD COLUMN verification_log_channel_id VARCHAR(32) NOT NULL DEFAULT '' AFTER logs_channel_id"],
        ['role_log_channel_id', "ALTER TABLE guild_settings ADD COLUMN role_log_channel_id VARCHAR(32) NOT NULL DEFAULT '' AFTER verification_log_channel_id"],
      ];

      for (const [columnName, alterSql] of loggingColumns) {
        const [columns] = await connection.query(
          `SELECT COUNT(*) AS count
             FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE()
              AND TABLE_NAME = 'guild_settings'
              AND COLUMN_NAME = ?`,
          [columnName],
        );

        if (!Number(columns[0]?.count || 0)) {
          await connection.query(alterSql);
        }
      }

      const ticketSettingsColumns = [
        ['max_open_tickets_per_user', "ALTER TABLE guild_settings ADD COLUMN max_open_tickets_per_user INT NOT NULL DEFAULT 3 AFTER transcript_channel_id"],
        ['online_transcripts_enabled', "ALTER TABLE guild_settings ADD COLUMN online_transcripts_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER max_open_tickets_per_user"],
        ['transcript_attachments_enabled', "ALTER TABLE guild_settings ADD COLUMN transcript_attachments_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER online_transcripts_enabled"],
      ];

      for (const [columnName, alterSql] of ticketSettingsColumns) {
        const [columns] = await connection.query(
          `SELECT COUNT(*) AS count FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='guild_settings' AND COLUMN_NAME=?`,
          [columnName],
        );
        if (!Number(columns[0]?.count || 0)) await connection.query(alterSql);
      }

      const ticketWorkflowColumns = [
        ['claimed_by', "ALTER TABLE tickets ADD COLUMN claimed_by VARCHAR(32) NULL AFTER closed_by"],
        ['close_reason', "ALTER TABLE tickets ADD COLUMN close_reason VARCHAR(1000) NULL AFTER claimed_by"],
        ['transcript_public_token', "ALTER TABLE tickets ADD COLUMN transcript_public_token VARCHAR(96) NULL AFTER close_reason"],
      ];

      for (const [columnName, alterSql] of ticketWorkflowColumns) {
        const [columns] = await connection.query(
          `SELECT COUNT(*) AS count FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND COLUMN_NAME=?`,
          [columnName],
        );
        if (!Number(columns[0]?.count || 0)) await connection.query(alterSql);
      }

      const [transcriptTokenIndexes] = await connection.query(
        `SELECT COUNT(*) AS count FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tickets' AND INDEX_NAME='uq_tickets_transcript_token'`,
      );
      if (!Number(transcriptTokenIndexes[0]?.count || 0)) {
        await connection.query('ALTER TABLE tickets ADD UNIQUE INDEX uq_tickets_transcript_token (transcript_public_token)');
      }

      const [ticketTypeColumns] = await connection.query(
        `SELECT COUNT(*) AS count
           FROM information_schema.COLUMNS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'tickets'
            AND COLUMN_NAME = 'ticket_type_key'`,
      );

      if (!Number(ticketTypeColumns[0]?.count || 0)) {
        await connection.query(
          "ALTER TABLE tickets ADD COLUMN ticket_type_key VARCHAR(32) NOT NULL DEFAULT 'support' AFTER user_id",
        );
      }

      const [ticketTypeIndexes] = await connection.query(
        `SELECT COUNT(*) AS count
           FROM information_schema.STATISTICS
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = 'tickets'
            AND INDEX_NAME = 'idx_tickets_type_status'`,
      );

      if (!Number(ticketTypeIndexes[0]?.count || 0)) {
        await connection.query(
          'ALTER TABLE tickets ADD INDEX idx_tickets_type_status (guild_id, user_id, ticket_type_key, status)',
        );
      }
    }
  } finally {
    connection.release();
  }
  console.log(`MySQL connected: ${process.env.MYSQL_HOST}:${process.env.MYSQL_PORT || 3306}/${process.env.MYSQL_DATABASE}`);
}

async function pingDatabase() {
  await pool.query('SELECT 1');
  return true;
}

function getPool() {
  return pool;
}

module.exports = { getPool, initDatabase, pingDatabase };
