-- Installed by each owning unit's administrative schema path, never the app.
-- Active delivery obligations remain unpartitioned and are never time-expired.
CREATE TABLE IF NOT EXISTS event_outbox (
  event_id VARCHAR(190) NOT NULL PRIMARY KEY,
  body LONGTEXT NOT NULL,
  body_digest CHAR(64) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  next_attempt_at DATETIME(3) NOT NULL DEFAULT UTC_TIMESTAMP(3),
  attempts BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(64) NULL,
  receipt LONGTEXT NULL,
  delivered_at DATETIME(3) NULL,
  KEY outbox_ready (delivered_at, next_attempt_at, created_at),
  CONSTRAINT outbox_body_json CHECK (JSON_VALID(body)),
  CONSTRAINT outbox_receipt_json CHECK (receipt IS NULL OR JSON_VALID(receipt)),
  CONSTRAINT outbox_body_limit CHECK (OCTET_LENGTH(body) <= 65536)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
