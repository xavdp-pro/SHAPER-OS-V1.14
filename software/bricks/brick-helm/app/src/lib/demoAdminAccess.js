import { DEMO_CREDENTIALS } from './demoCredentials.js';

/** Mirrors server/lib/demoAdmin.js canManageDemoVoices (client-side gate). */
export function canAccessDemoVoicesAdmin(user, isDemo) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!isDemo) return false;
  const email = String(user.email || '').trim().toLowerCase();
  return email === String(DEMO_CREDENTIALS.email).trim().toLowerCase();
}

/** Demo guest profile or demo operator — own briefing editor on demo host only. */
export function canAccessDemoBriefingAdmin(user, isDemo) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (!isDemo) return false;
  if (canAccessDemoVoicesAdmin(user, isDemo)) return true;
  const slug = String(user.demoSlug || '').trim();
  return Boolean(slug);
}

/** Any limited demo admin area (briefing and/or voices). */
export function canAccessDemoLimitedAdmin(user, isDemo) {
  return canAccessDemoBriefingAdmin(user, isDemo) || canAccessDemoVoicesAdmin(user, isDemo);
}

/** Tab paths allowed for this user when not full admin. */
export function demoAdminAllowedPaths(user, isDemo) {
  if (!user || user.role === 'admin') return null;
  const paths = [];
  if (canAccessDemoBriefingAdmin(user, isDemo)) paths.push('/admin/briefing');
  if (canAccessDemoVoicesAdmin(user, isDemo)) paths.push('/admin/voices');
  return paths.length ? paths : null;
}
