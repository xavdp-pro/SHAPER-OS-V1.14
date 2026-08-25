import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { loadCursorPureMode, saveCursorPureMode } from './cursorPureMode.js';

describe('cursorPureMode', () => {
  const storage = globalThis.localStorage;

  beforeEach(() => {
    globalThis.localStorage = {
      store: {},
      getItem(k) { return this.store[k] ?? null; },
      setItem(k, v) { this.store[k] = String(v); },
      removeItem(k) { delete this.store[k]; },
      clear() { this.store = {}; },
    };
  });

  afterEach(() => {
    globalThis.localStorage = storage;
  });

  it('defaults to false', () => {
    assert.equal(loadCursorPureMode(), false);
  });

  it('persists enabled state', () => {
    saveCursorPureMode(true);
    assert.equal(loadCursorPureMode(), true);
    saveCursorPureMode(false);
    assert.equal(loadCursorPureMode(), false);
  });
});
