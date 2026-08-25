import { hashPassword } from './password.js';

/**
 * Personalized demo guests — login via ?user=<demo_slug>.
 * Passwords are stored hashed + as demo_password for invite autofill only.
 */
/**
 * Personalized demo guests list (empty in production/standard build).
 */
export const DEMO_GUESTS = [];

export function capitalizeSlug(slug) {
  const s = String(slug || '').trim();
  if (!s) return '';
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

export async function hashGuestPassword(plain) {
  return hashPassword(plain);
}
