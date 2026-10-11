-- @shaper/pkg-vault — private MariaDB schema (Rules 4 and 26).
-- Installed by the administrative path (local MariaDB root CLI), never by the
-- application account, which holds SELECT, INSERT, UPDATE and DELETE only.
-- Idempotent: safe to run against an existing database.

CREATE TABLE IF NOT EXISTS schema_meta (
  unit         VARCHAR(64)  NOT NULL PRIMARY KEY,
  version      INT          NOT NULL,
  installed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- One row: the identity of this Vault. key_check is HMAC-SHA256 of a fixed
-- label under the master key; it proves which key the ciphertexts belong to
-- without revealing it. Born once, compared at every start.
CREATE TABLE IF NOT EXISTS vault_identity (
  id          TINYINT      NOT NULL PRIMARY KEY,
  key_check   CHAR(64)     NOT NULL,
  key_version INT          NOT NULL,
  created_at  TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  CONSTRAINT vault_identity_single CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS secrets (
  secret_key     VARCHAR(512) NOT NULL PRIMARY KEY,
  iv             CHAR(24)     NOT NULL,
  auth_tag       CHAR(32)     NOT NULL,
  ciphertext     MEDIUMTEXT   NOT NULL,
  algorithm      VARCHAR(32)  NOT NULL DEFAULT 'aes-256-gcm',
  key_version    INT          NOT NULL,
  secret_version INT          NOT NULL DEFAULT 1,
  created_at     TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  updated_at     TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Parent construction registers bounded incarnation bootstrap grants here.
-- Bootstrap values never enter the database, only their high-entropy digests.
CREATE TABLE IF NOT EXISTS unit_identities (
  universe_id CHAR(36) NOT NULL,
  unit_id VARCHAR(32) NOT NULL,
  incarnation VARCHAR(190) NOT NULL,
  epoch BIGINT UNSIGNED NOT NULL,
  grants LONGTEXT NOT NULL,
  bootstrap_digest CHAR(64) NOT NULL,
  bootstrap_expires_at DATETIME(3) NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (universe_id, unit_id),
  CONSTRAINT identity_grants_json CHECK (JSON_VALID(grants))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

CREATE TABLE IF NOT EXISTS unit_credentials (
  credential_id CHAR(36) NOT NULL PRIMARY KEY,
  universe_id CHAR(36) NOT NULL,
  unit_id VARCHAR(32) NOT NULL,
  incarnation VARCHAR(190) NOT NULL,
  epoch BIGINT UNSIGNED NOT NULL,
  audience VARCHAR(32) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  KEY credential_unit (universe_id, unit_id, expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

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

INSERT INTO schema_meta (unit, version) VALUES ('vault', 3)
  ON DUPLICATE KEY UPDATE version = GREATEST(version, VALUES(version));
