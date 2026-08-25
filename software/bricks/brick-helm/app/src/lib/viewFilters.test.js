import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_VIEW_FILTERS,
  loadViewFilters,
  saveViewFilters,
  toggleViewFilter,
  applyViewPreset,
} from './viewFilters.js';

function mockLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
    clear: () => { store.clear(); },
  };
  return store;
}

describe('viewFilters', () => {
  beforeEach(() => {
    mockLocalStorage();
  });

  it('defaults all zones to visible (desktop and mobile)', () => {
    assert.deepEqual(loadViewFilters(), DEFAULT_VIEW_FILTERS);
  });

  it('persists toggles via saveViewFilters', () => {
    saveViewFilters({ thinking: false, tools: true, terminal: false, logs: true });
    assert.deepEqual(loadViewFilters(), {
      thinking: false,
      tools: true,
      terminal: false,
      logs: true,
    });
  });

  it('toggleViewFilter flips one zone', () => {
    const next = toggleViewFilter(DEFAULT_VIEW_FILTERS, 'terminal');
    assert.equal(next.terminal, false);
    assert.equal(loadViewFilters().terminal, false);
  });

  it('applyViewPreset responseOnly hides all tool zones', () => {
    const next = applyViewPreset('responseOnly');
    assert.deepEqual(next, {
      thinking: false,
      tools: false,
      terminal: false,
      logs: false,
    });
  });

  it('applyViewPreset all restores defaults', () => {
    saveViewFilters({ thinking: false, tools: false, terminal: false, logs: false });
    const next = applyViewPreset('all');
    assert.deepEqual(next, DEFAULT_VIEW_FILTERS);
  });
});
