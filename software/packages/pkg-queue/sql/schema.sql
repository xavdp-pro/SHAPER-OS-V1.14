-- @shaper/pkg-queue — private MariaDB schema (Rules 4 and 26).
-- Installed by the administrative path (local MariaDB root CLI), never by the
-- application account, which holds SELECT, INSERT, UPDATE and DELETE only.
-- Idempotent: safe to run against an existing database.
--
-- Partitioning (design decision of 22 September 2026): the active coordination
-- table `jobs` is an ordinary InnoDB table — it carries the UNIQUE idempotency
-- constraint and frequent state changes, and MariaDB requires the partition
-- column in every unique key. Only the append-only history `job_transitions`
-- is partitioned, monthly, and nothing holds a foreign key to or from it.

CREATE TABLE IF NOT EXISTS schema_meta (
  unit         VARCHAR(64)  NOT NULL PRIMARY KEY,
  version      INT          NOT NULL,
  installed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- One row per job: the full record the API returns. Timestamps are UTC,
-- written by the application at millisecond precision. payload and result are
-- JSON text; error is plain text. request_digest is SHA-256 of the canonical
-- JSON of {type, payload, totalSteps, contractType}: a replay under the same
-- idempotency_key must carry the same digest, or it is a conflict.
CREATE TABLE IF NOT EXISTS jobs (
  id                  VARCHAR(64)  NOT NULL,
  type                VARCHAR(190) NOT NULL,
  payload             LONGTEXT     NOT NULL,
  contract_type       VARCHAR(64)  NULL,
  status              VARCHAR(32)  NOT NULL,
  progress            DOUBLE       NOT NULL DEFAULT 0,
  step                INT          NOT NULL DEFAULT 0,
  total_steps         INT          NOT NULL DEFAULT 1,
  result              LONGTEXT     NULL,
  error               MEDIUMTEXT   NULL,
  quality_gate_status VARCHAR(64)  NULL,
  idempotency_key     VARCHAR(190) NULL,
  request_digest      CHAR(64)     NOT NULL,
  row_version         INT UNSIGNED NOT NULL DEFAULT 1,
  created_at          DATETIME(3)  NOT NULL,
  updated_at          DATETIME(3)  NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY jobs_idempotency_key (idempotency_key),
  KEY jobs_status (status, created_at),
  KEY jobs_type (type, status),
  KEY jobs_created (created_at),
  KEY jobs_updated (updated_at),
  CONSTRAINT jobs_payload_json CHECK (JSON_VALID(payload)),
  CONSTRAINT jobs_result_json CHECK (result IS NULL OR JSON_VALID(result))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Append-only history: one row per committed state change of a job, written
-- in the same transaction as the job row. detail is bounded JSON (what moved;
-- never the payload or the result). job_id is a logical reference, not a
-- foreign key: a partitioned table can neither hold nor receive one.
-- Future partitions are created ahead of need by the administrative path;
-- p_future guards writes so an unexpected date never stops the queue.
CREATE TABLE IF NOT EXISTS job_transitions (
  transition_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_id        VARCHAR(64)     NOT NULL,
  kind          VARCHAR(32)     NOT NULL,
  from_status   VARCHAR(32)     NULL,
  to_status     VARCHAR(32)     NOT NULL,
  recorded_at   DATETIME(3)     NOT NULL,
  detail        VARCHAR(1024)   NULL,
  PRIMARY KEY (transition_id, recorded_at),
  KEY job_transitions_job (job_id, recorded_at),
  KEY job_transitions_recorded (recorded_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin
PARTITION BY RANGE COLUMNS (recorded_at) (
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

INSERT INTO schema_meta (unit, version) VALUES ('queue', 1)
  ON DUPLICATE KEY UPDATE version = GREATEST(version, VALUES(version));
