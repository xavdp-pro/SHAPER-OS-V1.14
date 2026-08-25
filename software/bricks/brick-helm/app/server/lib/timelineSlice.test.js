import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sliceRecentExchanges, RECENT_EXCHANGES_LIMIT } from "./timelineSlice.js";

describe("sliceRecentExchanges", () => {
  it("returns full list when under limit", () => {
    const items = [
      { type: "human", id: "h1" },
      { type: "run", id: "r1" },
    ];
    const r = sliceRecentExchanges(items, RECENT_EXCHANGES_LIMIT);
    assert.deepEqual(r.visible, items);
    assert.equal(r.hiddenExchanges, 0);
    assert.equal(r.hiddenItems, 0);
  });

  it("keeps last N human exchanges and trailing items", () => {
    const items = [];
    for (let i = 0; i < 7; i += 1) {
      items.push({ type: "human", id: `h${i}` });
      items.push({ type: "run", id: `r${i}` });
      items.push({ type: "voice_ack", id: `v${i}` });
    }
    const r = sliceRecentExchanges(items, 5);
    assert.equal(r.hiddenExchanges, 2);
    assert.equal(r.hiddenItems, 6);
    assert.equal(r.visible.length, items.length - 6);
    assert.equal(r.visible[0].id, "h2");
  });
});
