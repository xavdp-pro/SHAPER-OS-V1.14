-- @shaper/pkg-maestro — private MariaDB schema (Rules 4 and 26).
-- Installed by the administrative path (local MariaDB root CLI), never by the
-- application account, which holds SELECT, INSERT, UPDATE and DELETE only.
-- Idempotent: safe to run against an existing database.
--
-- Every instant is DATETIME(3) in UTC, written by the application from its own
-- clock reading; nothing here depends on the server's session time zone.
--
-- These are active-responsibility tables: ordinary InnoDB, indexed, not
-- partitioned. Moving settled occurrence history into monthly partitions is a
-- declared gap (INTENT.md#private-mariadb), not something this schema does.

CREATE TABLE IF NOT EXISTS schema_meta (
  unit         VARCHAR(64)  NOT NULL PRIMARY KEY,
  version      INT          NOT NULL,
  installed_at TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- One row per schedule: the current materialized declaration. schedule_id is
-- the task slug; revision is SHA-256 of the canonical normalized declaration.
-- A changed declaration replaces the revision here and restarts the planning
-- window at revision_active_from; occurrences of earlier revisions stay as
-- they were.
CREATE TABLE IF NOT EXISTS schedules (
  schedule_id             VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  revision                CHAR(64)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  cadence_seconds         INT UNSIGNED NOT NULL,
  anchor_at               DATETIME(3)  NOT NULL,
  task_json               MEDIUMTEXT   NOT NULL,
  enabled                 TINYINT(1)   NOT NULL,
  disabled_reason         VARCHAR(64)  NULL,
  declared_by             VARCHAR(16)  NOT NULL,
  missed_policy           VARCHAR(32)  NOT NULL,
  late_tolerance_seconds  INT UNSIGNED NOT NULL,
  revision_active_from    DATETIME(3)  NOT NULL,
  last_planned_at         DATETIME(3)  NULL,
  next_due_at             DATETIME(3)  NULL,
  last_evaluated_at       DATETIME(3)  NULL,
  last_enqueued_at        DATETIME(3)  NULL,
  enqueued_total          BIGINT UNSIGNED NOT NULL DEFAULT 0,
  missed_total            BIGINT UNSIGNED NOT NULL DEFAULT 0,
  missed_unrecorded_total BIGINT UNSIGNED NOT NULL DEFAULT 0,
  created_at              DATETIME(3)  NOT NULL,
  revised_at              DATETIME(3)  NOT NULL,
  updated_at              DATETIME(3)  NOT NULL,
  KEY schedules_enabled_next_due (enabled, next_due_at),
  CONSTRAINT schedules_cadence_positive CHECK (cadence_seconds > 0),
  CONSTRAINT schedules_missed_policy CHECK (missed_policy IN ('skip', 'coalesce_latest')),
  CONSTRAINT schedules_declared_by CHECK (declared_by IN ('file', 'api'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- Every revision a schedule ever had, with the declaration it stood for, so an
-- old occurrence's revision still resolves to what was declared at the time.
CREATE TABLE IF NOT EXISTS schedule_revisions (
  schedule_id           VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision              CHAR(64)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  task_json             MEDIUMTEXT   NOT NULL,
  first_materialized_at DATETIME(3)  NOT NULL,
  PRIMARY KEY (schedule_id, revision)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

-- One row per planned instant Maestro settled. occurrence_id is
-- 'occ-' + hex SHA-256 of universe|schedule|revision|planned_at (ISO UTC) and
-- is the Queue idempotency key. request_json is the exact request sent on
-- every attempt, frozen when the occurrence became due.
CREATE TABLE IF NOT EXISTS occurrences (
  occurrence_id    CHAR(68)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL PRIMARY KEY,
  schedule_id      VARCHAR(191) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  revision         CHAR(64)     CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  planned_at       DATETIME(3)  NOT NULL,
  trigger_kind     VARCHAR(16)  NOT NULL,
  state            VARCHAR(16)  NOT NULL,
  request_json     MEDIUMTEXT   NULL,
  request_digest   CHAR(64)     CHARACTER SET ascii COLLATE ascii_bin NULL,
  queue_job_id     VARCHAR(191) NULL,
  enqueue_attempts INT UNSIGNED NOT NULL DEFAULT 0,
  first_attempt_at DATETIME(3)  NULL,
  last_attempt_at  DATETIME(3)  NULL,
  enqueued_at      DATETIME(3)  NULL,
  final_reason     VARCHAR(64)  NULL,
  last_error       VARCHAR(512) NULL,
  created_at       DATETIME(3)  NOT NULL,
  updated_at       DATETIME(3)  NOT NULL,
  UNIQUE KEY occurrences_identity (schedule_id, revision, planned_at),
  KEY occurrences_state_planned (state, planned_at),
  KEY occurrences_schedule_state (schedule_id, state, planned_at),
  KEY occurrences_queue_job (queue_job_id),
  CONSTRAINT occurrences_state_known CHECK (state IN ('PLANNED', 'DUE', 'ENQUEUED', 'MISSED', 'CANCELLED')),
  CONSTRAINT occurrences_trigger_known CHECK (trigger_kind IN ('cadence', 'manual')),
  CONSTRAINT occurrences_enqueued_has_job CHECK (state <> 'ENQUEUED' OR queue_job_id IS NOT NULL)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin;

INSERT INTO schema_meta (unit, version) VALUES ('maestro', 1)
  ON DUPLICATE KEY UPDATE version = GREATEST(version, VALUES(version));
