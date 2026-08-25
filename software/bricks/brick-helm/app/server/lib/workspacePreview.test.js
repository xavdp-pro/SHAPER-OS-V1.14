import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isDocxPath,
  previewTitleFromPath,
} from './workspacePreview.js';

describe('workspacePreview', () => {
  it('detects docx paths', () => {
    assert.equal(isDocxPath('/home/zaza/Bureau/NOW3/docs/rapport.docx'), true);
    assert.equal(isDocxPath('/tmp/file.pdf'), false);
    assert.equal(isDocxPath('notes.DOCX'), true);
  });

  it('extracts preview title from path', () => {
    assert.equal(
      previewTitleFromPath('/home/zaza/Bureau/NOW3/docs/rapport.docx'),
      'rapport.docx',
    );
  });
});
