import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildImageGalleryCatalog,
  isAdjacentGalleryGap,
  galleryEntryKey,
} from './imageGallery.js';

describe('imageGallery', () => {
  it('treats whitespace-only gaps as adjacent gallery', () => {
    assert.equal(isAdjacentGalleryGap(''), true);
    assert.equal(isAdjacentGalleryGap('  \n\n  '), true);
    assert.equal(isAdjacentGalleryGap('some text'), false);
  });

  it('groups consecutive markdown images', () => {
    const md = 'Intro\n\n![a](/a.png)\n\n![b](/b.png)\n\nText\n\n![c](/c.png)';
    const { entries, groups } = buildImageGalleryCatalog(md);
    assert.equal(entries.length, 3);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].images.length, 2);
    assert.equal(groups[1].images.length, 1);
    assert.equal(entries[0].groupId, 0);
    assert.equal(entries[1].groupId, 0);
    assert.equal(entries[2].groupId, 1);
    assert.equal(entries[0].indexInGroup, 0);
    assert.equal(entries[1].indexInGroup, 1);
  });

  it('starts a new group after non-whitespace content', () => {
    const md = '![one](/1.png)\nParagraph\n![two](/2.png)';
    const { groups } = buildImageGalleryCatalog(md);
    assert.equal(groups.length, 2);
    assert.equal(groups[0].images[0].src, '/1.png');
    assert.equal(groups[1].images[0].src, '/2.png');
  });

  it('builds stable gallery entry keys', () => {
    assert.equal(galleryEntryKey({ groupId: 2, indexInGroup: 1 }), '2:1');
  });
});
