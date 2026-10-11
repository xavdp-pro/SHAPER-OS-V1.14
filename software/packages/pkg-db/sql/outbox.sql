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

-- Recovery points (DECISIONS-20261011 §C; the unit's dataLifecycle). Written
-- by the administrative path only — the parent, once a logical dump of this
-- database has been restored into a fresh volume and read back — never by the
-- application. snapshot_at is taken before the dump's consistent snapshot; a
-- delivered, receipted evidence row older than its retention is removed only
-- when such a point holds it (pkg-db pruneDeliveredOutbox). Kept unlimited.
CREATE TABLE IF NOT EXISTS recovery_points (
  recovery_point_id VARCHAR(190) NOT NULL PRIMARY KEY,
  snapshot_at DATETIME(3) NOT NULL,
  verified_at DATETIME(3) NOT NULL,
  dump_sha256 CHAR(64) NOT NULL,
  KEY recovery_points_snapshot (snapshot_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;
