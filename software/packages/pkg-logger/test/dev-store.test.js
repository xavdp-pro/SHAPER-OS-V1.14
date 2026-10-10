import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Intent: software/packages/pkg-logger/INTENT.md#private-mariadb

const here = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(here, '../server.js');

describe('the JSONL store is refused under a promotion or qualification flag', () => {
  for (const flag of [{ SHAPER_QUALIFICATION: '1' }, { SHAPER_RUNTIME_MODE: 'production' }]) {
    it(`LOGGER_STORE=file with ${Object.keys(flag)[0]}`, () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-dev-'));
      try {
        const r = spawnSync(process.execPath, [SERVER], {
          env: { PATH: process.env.PATH, LOGGER_PORT: '0', LOGGER_STORE: 'file', LOG_DIR: dir, ...flag },
          encoding: 'utf8', timeout: 10000,
        });
        assert.equal(r.status, 1);
        assert.match(r.stderr, /refusing to start: DEV_STORE_REFUSED/);
        assert.deepEqual(fs.readdirSync(dir), [], 'nothing was written');
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    });
  }
});
