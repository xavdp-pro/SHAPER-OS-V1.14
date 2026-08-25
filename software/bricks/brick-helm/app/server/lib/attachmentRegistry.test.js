import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  upsertAttachment,
  readAttachmentsManifest,
  appendAttachmentPaths,
  attachmentsManifestPath,
} from './attachmentRegistry.js';

describe('attachmentRegistry', () => {
  it('tracks uploading then ready with absolute path', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kovzu-att-'));
    upsertAttachment(tmp, {
      id: 'u1',
      name: 'passeport.pdf',
      status: 'uploading',
      kind: 'doc',
    });
    let manifest = readAttachmentsManifest(tmp);
    assert.equal(manifest.items[0].status, 'uploading');

    upsertAttachment(tmp, {
      id: 'u1',
      name: 'passeport.pdf',
      rel: '_attachments/passeport.pdf',
      abs: `${tmp}/_attachments/passeport.pdf`,
      status: 'ready',
    });
    manifest = readAttachmentsManifest(tmp);
    assert.equal(manifest.items[0].status, 'ready');
    assert.ok(fs.existsSync(attachmentsManifestPath(tmp)));

    const msg = appendAttachmentPaths('Analyse', tmp, ['_attachments/passeport.pdf']);
    assert.match(msg, /passeport\.pdf/);
    assert.match(msg, new RegExp(tmp.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
