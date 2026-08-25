/**
 * WordPress fractal DNS naming.
 *
 * Manager:  {managerSlug}.{zone}
 * Site:     {siteSlug}.{managerSlug}.{zone}
 *
 * The zone has NO default and is never hardcoded: this repository is
 * domain-agnostic (Rule 0B). A deployment that needs a public name asks the
 * human operator for the zone — which must already be managed in Cloudflare —
 * and passes it in, or sets WP_ZONE. Slugs have conventional defaults because
 * they are structural; a domain is not.
 */

const DEFAULT_MANAGER_SLUG = 'wpmanager01';
const DEFAULT_SITE_SLUG = 'wp01';

/** @throws when no zone was supplied — a domain is asked for, never invented. */
function requireZone(zone) {
  if (typeof zone === 'string' && zone.trim()) return zone.trim();
  throw new Error(
    'WP_ZONE is not set: no DNS zone was supplied. This repository hardcodes no '
    + 'domain. Ask the human operator for the public zone (it must already be '
    + 'managed in Cloudflare), then pass { zone } or set WP_ZONE.',
  );
}

export function managerHostname({
  managerSlug = DEFAULT_MANAGER_SLUG,
  zone,
} = {}) {
  return `${managerSlug}.${requireZone(zone)}`;
}

export function siteHostname({
  siteSlug = DEFAULT_SITE_SLUG,
  managerSlug = DEFAULT_MANAGER_SLUG,
  zone,
} = {}) {
  return `${siteSlug}.${managerSlug}.${requireZone(zone)}`;
}

export function managerUrl(opts = {}) {
  const scheme = opts.scheme || 'https';
  return `${scheme}://${managerHostname(opts)}`;
}

export function siteUrl(opts = {}) {
  const scheme = opts.scheme || 'https';
  return `${scheme}://${siteHostname(opts)}`;
}

/** Build routing document for manager UI + Cloudflare ingress notes. */
export function buildRouting({
  managerSlug = DEFAULT_MANAGER_SLUG,
  siteSlug = DEFAULT_SITE_SLUG,
  zone,
  managerLocalPort = 9470,
  siteLocalPort = 9580,
  childName = 'univ-wordpress-child',
} = {}) {
  const resolvedZone = requireZone(zone);
  const managerHost = managerHostname({ managerSlug, zone: resolvedZone });
  const siteHost = siteHostname({ siteSlug, managerSlug, zone: resolvedZone });
  return {
    zone: resolvedZone,
    managerSlug,
    managerHostname: managerHost,
    managerUrl: managerUrl({ managerSlug, zone: resolvedZone }),
    managerLocalPort,
    sites: [
      {
        siteSlug,
        child: childName,
        hostname: siteHost,
        publicUrl: siteUrl({ siteSlug, managerSlug, zone: resolvedZone }),
        localPort: siteLocalPort,
      },
    ],
  };
}

export function routingFromEnv(env = process.env) {
  return buildRouting({
    managerSlug: env.WP_MANAGER_SLUG || DEFAULT_MANAGER_SLUG,
    siteSlug: env.WP_SITE_SLUG || DEFAULT_SITE_SLUG,
    zone: env.WP_ZONE,
    managerLocalPort: Number(env.WP_MANAGER_PORT || 9470),
    siteLocalPort: Number(env.WP_PORT || 9580),
    childName: env.WP_CHILD_NAME || 'univ-wordpress-child',
  });
}
