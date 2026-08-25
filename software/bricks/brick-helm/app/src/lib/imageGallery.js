const IMAGE_MARKDOWN_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** True when markdown between two images is whitespace-only (same gallery group). */
export function isAdjacentGalleryGap(text) {
  return String(text || '').replace(/\s/g, '') === '';
}

/**
 * Build ordered image entries and gallery groups from markdown source.
 * Consecutive image embeds (ignoring whitespace between) share a groupId.
 */
export function buildImageGalleryCatalog(markdown) {
  const source = String(markdown || '');
  const matches = [];
  IMAGE_MARKDOWN_RE.lastIndex = 0;
  let match = IMAGE_MARKDOWN_RE.exec(source);
  while (match) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      alt: match[1],
      src: match[2],
    });
    match = IMAGE_MARKDOWN_RE.exec(source);
  }

  if (!matches.length) {
    return { entries: [], groups: [] };
  }

  const groups = [];
  const entries = [];
  let currentGroup = null;

  for (let i = 0; i < matches.length; i += 1) {
    const item = matches[i];
    const between = i === 0
      ? source.slice(0, item.start)
      : source.slice(matches[i - 1].end, item.start);
    const adjacent = i === 0 || isAdjacentGalleryGap(between);

    if (!adjacent || !currentGroup) {
      currentGroup = { id: groups.length, images: [] };
      groups.push(currentGroup);
    }

    const entry = {
      src: item.src,
      alt: item.alt,
      groupId: currentGroup.id,
      indexInGroup: currentGroup.images.length,
      renderIndex: entries.length,
    };
    currentGroup.images.push(entry);
    entries.push(entry);
  }

  return { entries, groups };
}

export function galleryEntryKey(entry) {
  return `${entry?.groupId ?? 0}:${entry?.indexInGroup ?? 0}`;
}
