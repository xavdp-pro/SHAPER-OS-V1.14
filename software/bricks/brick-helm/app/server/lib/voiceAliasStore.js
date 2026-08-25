import { query } from './db.js';

/**
 * Voice aliases — spoken forms → canonical infra names.
 * "cas zéro" → gbs-k0, "k zéro" → gbs-k0, "pé deux" → gbs-p2.
 * Used by the post-STT normalizer and boosted in Deepgram keyterms.
 */
export async function ensureVoiceAliasSchema() {
  await query(`
    CREATE TABLE IF NOT EXISTS voice_aliases (
      id INT UNSIGNED NOT NULL AUTO_INCREMENT,
      alias VARCHAR(190) NOT NULL,
      canonical VARCHAR(190) NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uniq_alias (alias)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
}

export async function listVoiceAliases() {
  const rows = await query(
    'SELECT id, alias, canonical, created_at FROM voice_aliases ORDER BY canonical, alias',
  );
  return rows;
}

export async function createVoiceAlias(alias, canonical) {
  const a = String(alias || '').trim();
  const c = String(canonical || '').trim();
  if (!a || !c) throw new Error('alias et canonical requis');
  if (a.length > 190 || c.length > 190) throw new Error('alias/canonical trop long');
  await query(
    'INSERT INTO voice_aliases (alias, canonical) VALUES (?, ?) ON DUPLICATE KEY UPDATE canonical = VALUES(canonical)',
    [a, c],
  );
  const rows = await query('SELECT id, alias, canonical, created_at FROM voice_aliases WHERE alias = ?', [a]);
  return rows[0];
}

export async function deleteVoiceAlias(id) {
  await query('DELETE FROM voice_aliases WHERE id = ?', [Number(id)]);
  return { ok: true };
}
