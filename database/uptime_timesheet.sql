-- Kryndexa persistent bot/web-panel uptime timesheet.
-- This is also created automatically by src/serviceUptimeStore.js.

CREATE TABLE IF NOT EXISTS `service_status_timesheet` (
  `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  `service` VARCHAR(24) NOT NULL COMMENT 'bot or panel',
  `is_up` TINYINT(1) NOT NULL COMMENT '1=online, 0=offline',
  `started_at` DATETIME(3) NOT NULL,
  `ended_at` DATETIME(3) NULL,
  `last_heartbeat_at` DATETIME(3) NOT NULL,
  `duration_seconds` BIGINT UNSIGNED NULL,
  `reason` VARCHAR(255) NULL,
  `detected_after_restart` TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (`id`),
  KEY `idx_service_timesheet_service_started` (`service`, `started_at`),
  KEY `idx_service_timesheet_open` (`service`, `ended_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Example: exact online/offline periods from the last seven days.
SELECT
  service,
  is_up,
  started_at,
  COALESCE(ended_at, NOW(3)) AS ended_at,
  COALESCE(duration_seconds, TIMESTAMPDIFF(SECOND, started_at, NOW(3))) AS duration_seconds,
  reason,
  detected_after_restart
FROM service_status_timesheet
WHERE started_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
ORDER BY started_at DESC;

-- Example: time-weighted seven-day uptime percentage.
SELECT
  service,
  ROUND(
    100 * SUM(CASE WHEN is_up = 1 THEN
      TIMESTAMPDIFF(SECOND,
        GREATEST(started_at, DATE_SUB(NOW(), INTERVAL 7 DAY)),
        LEAST(COALESCE(ended_at, NOW()), NOW()))
      ELSE 0 END)
    / NULLIF(SUM(
      TIMESTAMPDIFF(SECOND,
        GREATEST(started_at, DATE_SUB(NOW(), INTERVAL 7 DAY)),
        LEAST(COALESCE(ended_at, NOW()), NOW()))
    ), 0),
    4
  ) AS uptime_percent
FROM service_status_timesheet
WHERE COALESCE(ended_at, NOW()) >= DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY service;
