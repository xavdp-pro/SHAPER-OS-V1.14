export const RECENT_EXCHANGES_LIMIT = 5;

const STORAGE_KEY = 'helm-timeline-show-all';
const TIMELINE_PAGINATION_KEY = 'helm-timeline-pagination';

function humanStartIndices(items) {
  const indices = [];
  items.forEach((item, index) => {
    if (item.type === 'human') indices.push(index);
  });
  return indices;
}

/** Slice timeline to the last N user exchanges (human + following run/system). */
export function sliceRecentExchanges(items, limit = RECENT_EXCHANGES_LIMIT) {
  const list = items || [];
  const humanIndices = humanStartIndices(list);
  if (humanIndices.length <= limit) {
    return { visible: list, hiddenExchanges: 0, hiddenItems: 0 };
  }
  const startIdx = humanIndices[humanIndices.length - limit];
  return {
    visible: list.slice(startIdx),
    hiddenExchanges: humanIndices.length - limit,
    hiddenItems: startIdx,
  };
}

export function loadTimelineShowAll() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
  } catch {
    /* ignore */
  }
  return false;
}

export function saveTimelineShowAll(showAll) {
  try {
    localStorage.setItem(STORAGE_KEY, showAll ? '1' : '0');
  } catch {
    /* ignore */
  }
}


/** Full timeline pagination in UI + API (default OFF — server returns last 5 exchanges). */
export function loadTimelinePagination() {
  try {
    const v = localStorage.getItem(TIMELINE_PAGINATION_KEY);
    if (v === '1' || v === 'true') return true;
    if (v === '0' || v === 'false') return false;
  } catch {
    /* ignore */
  }
  return false;
}

export function saveTimelinePagination(enabled) {
  try {
    localStorage.setItem(TIMELINE_PAGINATION_KEY, enabled ? '1' : '0');
    if (!enabled) localStorage.setItem(STORAGE_KEY, '0');
  } catch {
    /* ignore */
  }
}

let paginationPreference = loadTimelinePagination();

export function getTimelinePaginationPreference() {
  return paginationPreference;
}

export function setTimelinePaginationPreference(enabled) {
  paginationPreference = Boolean(enabled);
  saveTimelinePagination(paginationPreference);
}
