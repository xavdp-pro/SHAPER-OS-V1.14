import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildRouting,
  managerHostname,
  managerUrl,
  routingFromEnv,
  siteHostname,
  siteUrl,
} from '../index.js';

const ZONE = 'example.test'; // RFC 6761 reserved: never resolves, never someone's domain

describe('wp-dns-convention', () => {
  it('builds manager and site hostnames from an explicit zone', () => {
    assert.equal(managerHostname({ zone: ZONE }), `wpmanager01.${ZONE}`);
    assert.equal(siteHostname({ zone: ZONE }), `wp01.wpmanager01.${ZONE}`);
    assert.equal(managerUrl({ zone: ZONE }), `https://wpmanager01.${ZONE}`);
    assert.equal(siteUrl({ zone: ZONE }), `https://wp01.wpmanager01.${ZONE}`);
  });

  it('supports custom slugs for future fleet expansion', () => {
    assert.equal(
      siteHostname({ siteSlug: 'wp02', managerSlug: 'wpmanager01', zone: ZONE }),
      `wp02.wpmanager01.${ZONE}`,
    );
  });

  it('builds routing document for manager UI', () => {
    const routing = buildRouting({ zone: ZONE });
    assert.equal(routing.zone, ZONE);
    assert.equal(routing.managerHostname, `wpmanager01.${ZONE}`);
    assert.equal(routing.sites.length, 1);
    assert.equal(routing.sites[0].hostname, `wp01.wpmanager01.${ZONE}`);
    assert.equal(routing.sites[0].localPort, 9580);
  });

  it('reads slugs and zone from environment', () => {
    const routing = routingFromEnv({
      WP_MANAGER_SLUG: 'wpmanager02',
      WP_SITE_SLUG: 'wp03',
      WP_ZONE: ZONE,
    });
    assert.equal(routing.managerHostname, `wpmanager02.${ZONE}`);
    assert.equal(routing.sites[0].hostname, `wp03.wpmanager02.${ZONE}`);
  });

  // --- Non-regression (Rule 29): the zone had a hardcoded default until v1.8.
  // These fail on the unpatched module, which returned someone's real domain.
  describe('no invented domain', () => {
    it('throws instead of falling back to a default zone', () => {
      assert.throws(() => managerHostname(), /WP_ZONE is not set/);
      assert.throws(() => siteHostname(), /WP_ZONE is not set/);
      assert.throws(() => buildRouting(), /WP_ZONE is not set/);
      assert.throws(() => routingFromEnv({}), /WP_ZONE is not set/);
    });

    it('names Cloudflare and the human operator in the failure', () => {
      // The message is the only guidance an agent gets at that moment.
      assert.throws(() => managerHostname(), (err) => {
        assert.match(err.message, /human operator/);
        assert.match(err.message, /Cloudflare/);
        return true;
      });
    });

    it('rejects a blank zone as firmly as a missing one', () => {
      assert.throws(() => managerHostname({ zone: '   ' }), /WP_ZONE is not set/);
      assert.throws(() => routingFromEnv({ WP_ZONE: '' }), /WP_ZONE is not set/);
    });
  });
});
