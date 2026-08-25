/**
 * Non-regression (Rule 29): development fallbacks must not survive into production.
 *
 * Until v1.8 `config.jwtSecret` fell back to a literal committed in this file, so a
 * deployment that forgot to set JWT_SECRET signed its tokens with a value anyone
 * could read in the repository — silently, with no error. These tests fail on the
 * unpatched module, which returned the fallback in every mode.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

let seq = 0;
/** Fresh module instance: config.js resolves its values at import time. */
const loadConfig = () => import(`./config.js?case=${++seq}`);

describe('helm config secrets', () => {
  beforeEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.APP_PASSWORD;
    delete process.env.SHAPER_RUNTIME_MODE;
    delete process.env.NODE_ENV;
  });

  it('keeps a usable fallback outside production, so a laptop stack starts', async () => {
    const { config } = await loadConfig();
    assert.equal(typeof config.jwtSecret, 'string');
    assert.ok(config.jwtSecret.length > 0);
  });

  it('refuses a missing secret when the runtime declares production', async () => {
    process.env.SHAPER_RUNTIME_MODE = 'production';
    await assert.rejects(loadConfig(), /JWT_SECRET is not set/);
  });

  it('refuses it under NODE_ENV=production as well', async () => {
    process.env.NODE_ENV = 'production';
    await assert.rejects(loadConfig(), /JWT_SECRET is not set/);
  });

  it('accepts supplied secrets in production', async () => {
    process.env.SHAPER_RUNTIME_MODE = 'production';
    process.env.JWT_SECRET = 'supplied-by-the-vault';
    process.env.APP_PASSWORD = 'supplied-too';
    const { config } = await loadConfig();
    assert.equal(config.jwtSecret, 'supplied-by-the-vault');
    assert.equal(config.appPassword, 'supplied-too');
  });

  it('treats a blank value as missing', async () => {
    process.env.SHAPER_RUNTIME_MODE = 'production';
    process.env.JWT_SECRET = '   ';
    await assert.rejects(loadConfig(), /JWT_SECRET is not set/);
  });
});
