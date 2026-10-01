-- Additive, function-private Vault schema. Install through the owning admin.
-- Application: SELECT/INSERT/UPDATE(receipt_json) on operations;
-- SELECT/INSERT/UPDATE(revision,tombstoned,encrypted_payload,payload_digest) on resources;
-- SELECT/INSERT on epochs. No DELETE, DDL or administrative credentials.
CREATE TABLE IF NOT EXISTS vault_owner_epochs (
  scope_id VARCHAR(64) COLLATE utf8mb4_bin PRIMARY KEY,
  owner_epoch CHAR(32) COLLATE ascii_bin NOT NULL
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS vault_owner_resources (
  scope_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  path_hash CHAR(64) COLLATE ascii_bin NOT NULL,
  resource_path VARCHAR(512) COLLATE utf8mb4_bin NOT NULL,
  device_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  revision BIGINT UNSIGNED NOT NULL,
  tombstoned TINYINT UNSIGNED NOT NULL,
  encrypted_payload LONGTEXT NULL,
  payload_digest CHAR(64) COLLATE ascii_bin NULL,
  PRIMARY KEY(scope_id,path_hash)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS vault_owner_operations (
  sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  scope_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  operation_id CHAR(36) COLLATE ascii_bin NOT NULL,
  path_hash CHAR(64) COLLATE ascii_bin NOT NULL,
  request_digest CHAR(64) COLLATE ascii_bin NOT NULL,
  receipt_json LONGTEXT NOT NULL,
  UNIQUE KEY operation_identity(scope_id,operation_id)
) ENGINE=InnoDB;
