-- @shaper/pkg-logger — private MariaDB schema (Rules 4 and 26).
-- Installed by the administrative path (local MariaDB root CLI), never by the
-- application account, which holds SELECT, INSERT, UPDATE and DELETE only.
-- Idempotent: safe to run against an existing database. Every table is created
-- IF NOT EXISTS, so re-applying this file never undoes partition maintenance.
-- Intent: software/packages/pkg-logger/INTENT.md#private-mariadb

CREATE TABLE IF NOT EXISTS schema_meta (
  unit         VARCHAR(64)  NOT NULL PRIMARY KEY,
  version      INT          NOT NULL,
  installed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Immutable event history: one row per accepted event.
--
-- Partitioned monthly by Logger receipt time (UTC, assigned by Logger, never by
-- the source). MariaDB requires every column of the partitioning expression in
-- every unique key, so the primary key is (received_at, id). It also clusters
-- the rows in receipt order, which is the order /api/events/last reads them in.
-- A partitioned table can neither hold nor be the target of a foreign key: no
-- other table references `events`.
--
-- p_future is the guard partition. It must stay empty: the maintenance path
-- (root CLI, never the application) splits it ahead of time, e.g.
--   ALTER TABLE events REORGANIZE PARTITION p_future INTO (
--     PARTITION p2027_04 VALUES LESS THAN ('2027-05-01 00:00:00'),
--     PARTITION p_future VALUES LESS THAN (MAXVALUE))
-- A row in p_future means that maintenance fell behind: /api/vitals reports it
-- as eventsBeyondHorizon. The first partition also holds anything earlier than
-- August 2026, which only a wrong Logger clock could produce.
CREATE TABLE IF NOT EXISTS events (
  received_at     DATETIME(3)       NOT NULL COMMENT 'Logger receipt time, UTC',
  id              CHAR(36)          CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'Logger-assigned id, UUIDv7',
  pod             VARCHAR(128)      NOT NULL COMMENT 'Claimed source unit, unauthenticated until Vault-signed source identity',
  event           VARCHAR(128)      NOT NULL,
  level           VARCHAR(8)        NOT NULL,
  correlation_id  VARCHAR(191)      NULL,
  execution_id    VARCHAR(191)      NULL,
  source_event_id VARCHAR(191)      NULL COMMENT 'Source-supplied idempotency id, uniqueness held by ingest_keys',
  duration_ms     DECIMAL(15,1)     NULL,
  data            LONGTEXT          NOT NULL COMMENT 'Canonical JSON of the bounded event body',
  record_version  SMALLINT UNSIGNED NOT NULL,
  digest          CHAR(64)          CHARACTER SET ascii COLLATE ascii_bin NOT NULL COMMENT 'SHA-256 of the canonical stored event',
  PRIMARY KEY (received_at, id),
  KEY events_pod_time (pod, received_at),
  KEY events_correlation_time (correlation_id, received_at),
  KEY events_event_time (event, received_at),
  CONSTRAINT events_data_json CHECK (JSON_VALID(data)),
  CONSTRAINT events_data_bounded CHECK (OCTET_LENGTH(data) <= 1048576),
  CONSTRAINT events_level_known CHECK (level IN ('DEBUG', 'INFO', 'WARN', 'ERROR'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
PARTITION BY RANGE COLUMNS (received_at) (
  PARTITION p2026_08 VALUES LESS THAN ('2026-09-01 00:00:00'),
  PARTITION p2026_09 VALUES LESS THAN ('2026-10-01 00:00:00'),
  PARTITION p2026_10 VALUES LESS THAN ('2026-11-01 00:00:00'),
  PARTITION p2026_11 VALUES LESS THAN ('2026-12-01 00:00:00'),
  PARTITION p2026_12 VALUES LESS THAN ('2027-01-01 00:00:00'),
  PARTITION p2027_01 VALUES LESS THAN ('2027-02-01 00:00:00'),
  PARTITION p2027_02 VALUES LESS THAN ('2027-03-01 00:00:00'),
  PARTITION p2027_03 VALUES LESS THAN ('2027-04-01 00:00:00'),
  PARTITION p_future VALUES LESS THAN (MAXVALUE)
);

-- An accepted event is never rewritten or deleted through SQL DML. The
-- application account is granted UPDATE and DELETE on its database like every
-- unit. On `events` these triggers refuse them. Retention retires whole
-- partitions from the administrative path, which DML triggers do not govern.
CREATE TRIGGER IF NOT EXISTS events_refuse_update BEFORE UPDATE ON events
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'logger events are immutable';

CREATE TRIGGER IF NOT EXISTS events_refuse_delete BEFORE DELETE ON events
  FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'logger events are immutable';

-- Source-supplied event ids, one row per (claimed source, id). Unpartitioned on
-- purpose: a retry of one source event reaches Logger at a different receipt
-- time, and a unique key on the partitioned `events` would have to include
-- received_at, so it could never see the retry as a duplicate. The key lives
-- here, is written in the same transaction as the event, and points at it by
-- its full primary key. claim_digest is the SHA-256 of the normalised claim:
-- same digest is a replay, a different one is a conflict.
CREATE TABLE IF NOT EXISTS ingest_keys (
  pod             VARCHAR(128) NOT NULL,
  source_event_id VARCHAR(191) NOT NULL,
  claim_digest    CHAR(64)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  event_id        CHAR(36)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  received_at     DATETIME(3)  NOT NULL,
  PRIMARY KEY (pod, source_event_id),
  KEY ingest_keys_received (received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

INSERT INTO schema_meta (unit, version) VALUES ('logger', 1)
  ON DUPLICATE KEY UPDATE version = GREATEST(version, VALUES(version));
