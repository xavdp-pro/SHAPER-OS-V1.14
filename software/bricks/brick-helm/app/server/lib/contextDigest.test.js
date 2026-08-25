import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { digestContext, contextFilePath, localNotesPath, journalFilePath } from './contextDigest.js';

describe('digestContext', () => {
  it('writes CONTEXT.md, local.md and JOURNAL.md under _kovzu', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kovzu-ctx-'));
    const res = digestContext({
      workspaceCwd: tmp,
      briefing: 'Stack Node + MariaDB',
      locale: 'fr',
    });
    assert.equal(res.ok, true);
    assert.ok(fs.existsSync(contextFilePath(tmp)));
    assert.ok(fs.existsSync(localNotesPath(tmp)));
    assert.ok(fs.existsSync(journalFilePath(tmp)));
    const body = fs.readFileSync(contextFilePath(tmp), 'utf8');
    assert.match(body, /Stack Node \+ MariaDB/);
    assert.match(body, /Skills catalog/i);
    assert.match(body, /Journal de bord persistant/i);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('loads and embeds topology.json or deps.json manifest when present', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kovzu-ctx-topo-'));
    fs.writeFileSync(path.join(tmp, 'topology.json'), JSON.stringify({ version: '1.2.0', minimalSocle: ['@shaper/vault'] }), 'utf8');
    const res = digestContext({
      workspaceCwd: tmp,
      locale: 'fr',
    });
    assert.equal(res.ok, true);
    const body = fs.readFileSync(contextFilePath(tmp), 'utf8');
    assert.match(body, /## Topology & Ecosystem Manifest/i);
    assert.match(body, /@shaper\/vault/);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
