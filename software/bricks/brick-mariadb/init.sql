-- Schéma Relationnel Shaper-Helm / MariaDB Dédiée
CREATE DATABASE IF NOT EXISTS helm_db CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE helm_db;

-- 1. Table Utilisateurs & Rôles
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  role ENUM('admin', 'user') NOT NULL DEFAULT 'user',
  locale ENUM('fr', 'en', 'es') NOT NULL DEFAULT 'fr',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Paramètres Globaux
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key VARCHAR(100) PRIMARY KEY,
  setting_value JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Timelines / Conversations
CREATE TABLE IF NOT EXISTS timelines (
  id VARCHAR(64) PRIMARY KEY,
  user_id INT NULL,
  title VARCHAR(255) NOT NULL DEFAULT 'Nouvelle Session',
  is_pinned TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_user_id (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Messages des Timelines
CREATE TABLE IF NOT EXISTS timeline_messages (
  id VARCHAR(64) PRIMARY KEY,
  timeline_id VARCHAR(64) NOT NULL,
  role ENUM('user', 'assistant', 'system', 'tool') NOT NULL,
  content MEDIUMTEXT NOT NULL,
  metadata JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_timeline_id (timeline_id),
  CONSTRAINT fk_timeline FOREIGN KEY (timeline_id) REFERENCES timelines(id) ON DELETE CASCADE
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

-- 6. Insertion du Compte Administrateur Initial (Admin réel de UNIV9)
-- Mot de passe par défaut : ShaperAdmin2026! (hash bcrypt standard ou géré à l'initialisation)
INSERT INTO users (id, email, password_hash, name, role, locale, is_active)
VALUES (1, 'admin@univ9.shaper', '$2b$10$vN9g/o8OslpYFp6YJv7BDe4.76VdwhZ96z7i9v1g2R21CgH/j2R6e', 'Administrateur UNIV9', 'admin', 'fr', 1)
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;

-- 7. Insertion des Réglages par Défaut
INSERT INTO app_settings (setting_key, setting_value)
VALUES ('voice_config', '{"provider":"deepgram","sttModel":"nova-3","ttsModel":"aura-2","groqAck":true,"voices":{"fr":"aura-2-agathe-fr","en":"aura-2-thalia-en","es":"aura-2-nestor-es"}}')
ON DUPLICATE KEY UPDATE updated_at = CURRENT_TIMESTAMP;
