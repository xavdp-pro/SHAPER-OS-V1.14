-- Schéma Relationnel Shaper-Helm Embarqué
CREATE DATABASE IF NOT EXISTS helm_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE helm_db;

-- Permissions pour helm_user
CREATE USER IF NOT EXISTS 'helm_user'@'%' IDENTIFIED BY 'helm_password_local';
CREATE USER IF NOT EXISTS 'helm_user'@'localhost' IDENTIFIED BY 'helm_password_local';
CREATE USER IF NOT EXISTS 'helm_user'@'127.0.0.1' IDENTIFIED BY 'helm_password_local';
GRANT ALL PRIVILEGES ON *.* TO 'helm_user'@'%' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON *.* TO 'helm_user'@'localhost' WITH GRANT OPTION;
GRANT ALL PRIVILEGES ON *.* TO 'helm_user'@'127.0.0.1' WITH GRANT OPTION;
FLUSH PRIVILEGES;

-- 1. Table Utilisateurs & Rôles
CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL DEFAULT '',
  role ENUM('admin','operator','viewer','user') NOT NULL DEFAULT 'operator',
  status ENUM('active','disabled','pending') NOT NULL DEFAULT 'active',
  password_hash VARCHAR(255) NULL,
  magic_token_hash VARCHAR(64) NULL,
  magic_token_expires_at DATETIME NULL,
  last_login_at DATETIME NULL,
  notes VARCHAR(500) NULL,
  briefing TEXT NULL,
  locale ENUM('fr', 'en', 'es') NOT NULL DEFAULT 'fr',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_email (email),
  INDEX idx_users_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Paramètres Globaux
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value LONGTEXT NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Timelines / Conversations (Stockage complet des échanges & métadonnées)
CREATE TABLE IF NOT EXISTS timelines (
  conv_hash CHAR(24) NOT NULL,
  conv_path VARCHAR(512) NOT NULL,
  items LONGTEXT NOT NULL,
  updated_at VARCHAR(32) NOT NULL,
  folder VARCHAR(128) DEFAULT 'Général',
  archived_at VARCHAR(32) DEFAULT NULL,
  pinned TINYINT(1) DEFAULT 0,
  model VARCHAR(128) DEFAULT NULL,
  PRIMARY KEY (conv_hash),
  KEY idx_path (conv_path(191))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Tâches Maestro
CREATE TABLE IF NOT EXISTS maestro_tasks (
  slug VARCHAR(100) PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  bridge_type VARCHAR(50) NOT NULL DEFAULT 'opencode',
  cadence_seconds INT NOT NULL DEFAULT 300,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  last_run_at TIMESTAMP NULL,
  last_status VARCHAR(50) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Compte Administrateur Initial (ShaperAdmin2026! / bgvfVFCD123!)
INSERT INTO users (id, email, password_hash, name, role, status, locale, is_active)
VALUES 
  (1, 'admin@univ9.shaper', '$2b$12$y3M0snuurptbU0JPl8SKleQ5IQwlaQb7/4lMWub/XwU7c3i4Gm4Qm', 'Administrateur Shaper', 'admin', 'active', 'fr', 1),
  (2, 'xavier@xavdp.pro', '$2b$10$sVcCBkRedB44X/7aOYELUuu.TO53.34riFJoTGzOzwu3AGG4cu2Sq', 'Xavier', 'admin', 'active', 'fr', 1)
ON DUPLICATE KEY UPDATE password_hash = VALUES(password_hash), updated_at = CURRENT_TIMESTAMP;

-- 7. Réglages Voix & Modèles par Défaut
INSERT INTO app_settings (setting_key, setting_value)
VALUES ('voice_config', '{"provider":"deepgram","sttModel":"nova-3","ttsModel":"aura-2","groqAck":true,"voices":{"fr":"aura-2-agathe-fr","en":"aura-2-thalia-en","es":"aura-2-nestor-es"}}')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;
