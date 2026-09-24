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

INSERT INTO schema_meta (unit, version) VALUES ('vault', 1)
  ON DUPLICATE KEY UPDATE version = GREATEST(version, VALUES(version));
