/** Slice timeline to the last N user exchanges (human + following run/system). */

export const RECENT_EXCHANGES_LIMIT = 5;

function humanStartIndices(items) {
  const indices = [];
  items.forEach((item, index) => {
    if (item.type === 'human') indices.push(index);
  });
  return indices;
}

export function sliceRecentExchanges(items, limit = RECENT_EXCHANGES_LIMIT) {
  const list = Array.isArray(items) ? items : [];
  const humanIndices = humanStartIndices(list);
  if (humanIndices.length <= limit) {
    return {
      visible: list,
      hiddenExchanges: 0,
      hiddenItems: 0,
      totalExchanges: humanIndices.length,
      totalItems: list.length,
    };
  }
  const startIdx = humanIndices[humanIndices.length - limit];
  return {
    visible: list.slice(startIdx),
    hiddenExchanges: humanIndices.length - limit,
    hiddenItems: startIdx,
    totalExchanges: humanIndices.length,
    totalItems: list.length,
  };
}
