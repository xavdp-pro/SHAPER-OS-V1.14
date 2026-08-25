import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  markContextBootstrapped,
  isContextBootstrapped,
  clearContextBootstrap,
} from './contextSession.js';
import { digestContext } from './contextDigest.js';

describe('contextSession persistence', () => {
  it('restores bootstrapped flag from disk after memory clear', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kovzu-sess-'));
    const conv = 'gbs-h1/test/Persist';
    const digest = digestContext({ workspaceCwd: tmp, briefing: 'hi', locale: 'fr' });
    markContextBootstrapped(conv, tmp, digest.hash);
    clearContextBootstrap(conv);
    assert.equal(isContextBootstrapped(conv, tmp), true);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
