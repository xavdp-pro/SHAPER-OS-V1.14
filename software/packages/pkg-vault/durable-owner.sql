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

-- Additive guard upgrade: install before admitting this source; no HTTP mounting.
-- Fences: SELECT/INSERT and UPDATE(managed,held_guard_id,deny_new,
-- deny_operation_id,deny_revision,deny_request_digest).
-- Guards: SELECT/INSERT and UPDATE(state,terminal_ack_json,terminal_ack_digest).
-- Binding and acquisition sequence have no UPDATE grant; no DELETE/DDL.
CREATE TABLE IF NOT EXISTS vault_owner_resource_fences (
  scope_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  path_hash CHAR(64) COLLATE ascii_bin NOT NULL,
  managed TINYINT UNSIGNED NOT NULL DEFAULT 0,
  held_guard_id CHAR(36) COLLATE ascii_bin NULL,
  deny_new TINYINT UNSIGNED NOT NULL DEFAULT 0,
  deny_operation_id CHAR(36) COLLATE ascii_bin NULL,
  deny_revision BIGINT UNSIGNED NULL,
  deny_request_digest CHAR(64) COLLATE ascii_bin NULL,
  PRIMARY KEY(scope_id,path_hash),
  UNIQUE KEY pending_operation_identity(scope_id,deny_operation_id)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS vault_owner_guards (
  sequence BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  scope_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  guard_id CHAR(36) COLLATE ascii_bin NOT NULL,
  operation_id CHAR(36) COLLATE ascii_bin NOT NULL,
  consumer_id VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  consumer_incarnation VARCHAR(64) COLLATE utf8mb4_bin NOT NULL,
  ack_sequence BIGINT UNSIGNED NOT NULL,
  path_hash CHAR(64) COLLATE ascii_bin NOT NULL,
  binding_digest CHAR(64) COLLATE ascii_bin NOT NULL,
  binding_json LONGTEXT NOT NULL,
  state VARCHAR(32) COLLATE ascii_bin NOT NULL,
  terminal_ack_json LONGTEXT NULL,
  terminal_ack_digest CHAR(64) COLLATE ascii_bin NULL,
  UNIQUE KEY guard_identity(scope_id,guard_id),
  UNIQUE KEY guarded_operation_identity(scope_id,operation_id),
  UNIQUE KEY peer_ack_identity(scope_id,consumer_id,consumer_incarnation,ack_sequence)
) ENGINE=InnoDB;
