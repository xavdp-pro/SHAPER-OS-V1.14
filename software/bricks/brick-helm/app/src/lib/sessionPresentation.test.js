import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  shouldPrimeSession,
  hasAssistantContent,
  shouldAutoSpeakPresentation,
  isPrimeOnlyTimeline,
  mergeTimelineOnLoad,
  timelineItemsFromSessionResponse,
} from '../../src/lib/sessionPresentation.js';

describe('shouldPrimeSession', () => {
  it('empty timeline needs prime', () => {
    assert.equal(shouldPrimeSession([]), true);
  });

  it('aborted prime without assistant retries', () => {
    const items = [{
      type: 'run',
      prime: true,
      status: 'aborted',
      blocks: [{ type: 'system', text: 'Arrêté (présentation expirée)' }],
    }];
    assert.equal(shouldPrimeSession(items), true);
  });

  it('done prime with assistant greeting is satisfied', () => {
    const items = [{
      type: 'run',
      prime: true,
      status: 'done',
      blocks: [{ type: 'assistant', text: 'Bonjour TheSuperUser !' }],
    }];
    assert.equal(shouldPrimeSession(items), false);
    assert.equal(hasAssistantContent(items[0]), true);
  });

  it('human message means no auto prime', () => {
    assert.equal(shouldPrimeSession([{ type: 'human', text: 'hi' }]), false);
  });
});

describe('shouldAutoSpeakPresentation', () => {
  const primeDone = {
    type: 'run',
    id: 'p1',
    prime: true,
    status: 'done',
    blocks: [{ type: 'assistant', id: 'a1', text: 'Bonjour' }],
  };

  it('skips cold load / F5 (never saw presenting)', () => {
    assert.equal(shouldAutoSpeakPresentation({
      wasPresenting: false,
      presenting: false,
      items: [primeDone],
    }), false);
  });

  it('skips when human posts already exist', () => {
    assert.equal(shouldAutoSpeakPresentation({
      wasPresenting: true,
      presenting: false,
      items: [primeDone, { type: 'human', text: 'tableau' }],
    }), false);
    assert.equal(isPrimeOnlyTimeline([primeDone, { type: 'human', text: 'hi' }]), false);
  });

  it('speaks once when prime stream just finished this session', () => {
    assert.equal(shouldAutoSpeakPresentation({
      wasPresenting: true,
      presenting: false,
      items: [primeDone],
    }), true);
  });
});

describe('mergeTimelineOnLoad', () => {
  it('repairs false session expirée runs from server payload', () => {
    const server = [{
      type: 'run',
      id: 'r1',
      status: 'aborted',
      blocks: [
        { type: 'thinking', text: 'searching…' },
        { type: 'system', text: 'Arrêté (session expirée)' },
      ],
    }];
    const merged = mergeTimelineOnLoad([], server);
    assert.equal(merged.length, 1);
    assert.equal(merged[0].status, 'done');
    assert.equal(merged[0].blocks.some((b) => b.type === 'system'), false);
  });
});

describe('timelineItemsFromSessionResponse', () => {
  it('normalizes orchestrator timeline items', () => {
    const items = timelineItemsFromSessionResponse({
      items: [{
        type: 'run',
        status: 'done',
        blocks: [{ type: 'assistant', text: 'Bonjour', streaming: true }],
      }],
    });
    assert.equal(items[0].blocks[0].streaming, false);
  });
});
