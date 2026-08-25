/** Client-side validation for turbinobash app ids under /apps. */

export function isValidAppId(id) {
  return /^[a-z0-9][a-z0-9-]*$/i.test(String(id || '').trim());
}

export function normalizeAppId(raw) {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
