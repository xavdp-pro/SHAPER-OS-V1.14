import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  insertVoiceAck,
  mergeTimelinesPreferVoiceAck,
  settlePrimeRunsBeforeTurn,
  isPresentationRunning,
  sanitizeStuckRuns,
  sanitizeTimeline,
  repairExpiredAbortedRuns,
  normalizeTimelineItems,
  applyStreamEvent,
  buildRollingContextPrefix,
} from './runStream.js';

describe('runStream voice ack', () => {
  it('insertVoiceAck places ack after human', () => {
    const human = { type: 'human', id: 'h1', text: 'hello' };
    const next = insertVoiceAck([human], 'Je vérifie.');
    assert.equal(next.length, 2);
    assert.equal(next[1].type, 'voice_ack');
    assert.equal(next[1].text, 'Je vérifie.');
  });

  it('mergeTimelinesPreferVoiceAck keeps local ack', () => {
    const local = [
      { type: 'human', id: 'h1', text: 'ram' },
      { type: 'voice_ack', id: 'a1', text: 'OK' },
    ];
    const server = [
      { type: 'human', id: 'h1', text: 'ram' },
      { type: 'run', id: 'r1', status: 'running', blocks: [] },
    ];
    const merged = mergeTimelinesPreferVoiceAck(local, server);
    assert.ok(merged.some((it) => it.type === 'voice_ack'));
  });
});

describe('runStream presentation', () => {
  it('settlePrimeRunsBeforeTurn closes running prime', () => {
    const items = [
      { type: 'run', id: 'p1', prime: true, status: 'running', blocks: [] },
      { type: 'human', id: 'h1', text: 'test' },
    ];
    const next = settlePrimeRunsBeforeTurn(items);
    assert.equal(next[0].status, 'aborted');
  });

  it('isPresentationRunning detects active prime', () => {
    assert.equal(isPresentationRunning([
      { type: 'run', prime: true, status: 'running', blocks: [] },
    ]), true);
    assert.equal(isPresentationRunning([
      { type: 'run', prime: true, status: 'done', blocks: [] },
    ]), false);
  });

  it('resolveLiveKaraokeBlockId targets running run only', async () => {
    const { resolveLiveKaraokeBlockId } = await import('./runStream.js');
    const items = [
      {
        type: 'run',
        status: 'done',
        blocks: [{ type: 'assistant', id: 'old', text: 'ancien message' }],
      },
      { type: 'human', id: 'h1', text: 'nouveau' },
      {
        type: 'run',
        status: 'running',
        blocks: [{ type: 'thinking', id: 't1', text: '...' }],
      },
    ];
    assert.equal(resolveLiveKaraokeBlockId(items), '');
    items[2].blocks.push({ type: 'assistant', id: 'live', text: '', streaming: true });
    assert.equal(resolveLiveKaraokeBlockId(items), 'live');
  });
});

describe('undouble via applyStreamEvent response', () => {
  it('collapses A+A+B+B assistant text from voice turns', async () => {
    const { applyStreamEvent } = await import('./runStream.js');
    const a = 'Je recupere le repertoire courant.';
    const b = 'Repertoire courant : /home/zaza/Bureau/NOW3.';
    const doubled = a + a + b + b;
    let items = [{
      type: 'run', id: 'r1', status: 'running', streamId: 's1', voiceTurn: true, blocks: [],
    }];
    items = applyStreamEvent(items, {
      type: 'response', conversation: 'NOW3', composer_id: 's1', text: doubled, delta: doubled,
    });
    const assistant = items[0].blocks.find((b) => b.type === 'assistant');
    assert.equal(assistant?.text, a + b);
  });
});

describe('sanitizeTimeline', () => {
  it('keeps prime runs while streaming', () => {
    const items = [{ type: 'run', prime: true, status: 'running', blocks: [] }];
    assert.equal(sanitizeTimeline(items).length, 1);
  });
});

describe('sanitizeStuckRuns', () => {
  it('aborts empty shells idle too long', () => {
    const old = Date.now() - 5 * 60_000;
    const items = [{ type: 'run', id: 'r1', status: 'running', blocks: [], time: old, updatedAt: old }];
    const next = sanitizeStuckRuns(items);
    assert.equal(next[0].status, 'aborted');
  });

  it('keeps long agent runs with recent activity (not start-time based)', () => {
    const started = Date.now() - 10 * 60_000;
    const recent = Date.now() - 5_000;
    const items = [{
      type: 'run',
      id: 'r1',
      status: 'running',
      time: started,
      updatedAt: recent,
      blocks: [{ type: 'assistant', text: 'travail en cours…', streaming: true }],
    }];
    const next = sanitizeStuckRuns(items);
    assert.equal(next[0].status, 'running');
  });

  it('keeps fresh running shells', () => {
    const items = [{ type: 'run', id: 'r1', status: 'running', blocks: [], time: Date.now() }];
    const next = sanitizeStuckRuns(items);
    assert.equal(next[0].status, 'running');
  });

  it('does not abort a 2-minute active tool run just because start is old', () => {
    const started = Date.now() - 120_000;
    const items = [{
      type: 'run',
      id: 'r1',
      status: 'running',
      time: started,
      updatedAt: Date.now() - 1_000,
      blocks: [{ type: 'tool', tool: 'Shell', status: 'running' }],
    }];
    assert.equal(sanitizeStuckRuns(items)[0].status, 'running');
  });
});

describe('repairExpiredAbortedRuns', () => {
  it('converts false session expirée aborts to done and strips system block', () => {
    const items = [{
      type: 'run',
      id: 'r1',
      status: 'aborted',
      blocks: [
        { type: 'thinking', text: 'work' },
        { type: 'system', text: 'Arrêté (session expirée)' },
      ],
    }];
    const next = repairExpiredAbortedRuns(items);
    assert.equal(next.length, 1);
    assert.equal(next[0].status, 'done');
    assert.equal(next[0].blocks.some((b) => b.type === 'system'), false);
  });

  it('drops empty aborted runs that only had session expirée', () => {
    const items = [{
      type: 'run',
      id: 'r1',
      status: 'aborted',
      blocks: [{ type: 'system', text: 'Arrêté (session expirée)' }],
    }];
    const next = repairExpiredAbortedRuns(items);
    assert.equal(next.length, 0);
  });

  it('keeps user-initiated aborts unchanged', () => {
    const items = [{
      type: 'run',
      id: 'r1',
      status: 'aborted',
      blocks: [
        { type: 'assistant', text: 'partial' },
        { type: 'system', text: "Arrêté par l'utilisateur" },
      ],
    }];
    const next = repairExpiredAbortedRuns(items);
    assert.equal(next.length, 1);
    assert.equal(next[0].status, 'aborted');
    assert.equal(next[0].blocks.length, 2);
  });
});

describe('normalizeTimelineItems', () => {
  it('chains sanitize, repair, and stuck-run guard', () => {
    const items = [{
      type: 'run',
      id: 'r1',
      status: 'aborted',
      blocks: [
        { type: 'tool', tool: 'glob', status: 'running' },
        { type: 'system', text: 'Arrêté (session expirée)' },
      ],
    }];
    const next = normalizeTimelineItems(items);
    assert.equal(next.length, 1);
    assert.equal(next[0].status, 'done');
    assert.equal(next[0].blocks.find((b) => b.type === 'tool')?.status, 'done');
  });
});

describe('applyStreamEvent tool_complete', () => {
  it('attaches glob result to the matching running tool', () => {
    let items = [
      { type: 'human', id: 'h1', text: 'list files' },
      {
        type: 'run',
        id: 'r1',
        status: 'running',
        blocks: [{
          type: 'tool',
          id: 'glob-1',
          tool: 'glob',
          status: 'running',
          input: '{"globPattern":"**/*"}',
        }],
      },
    ];
    items = applyStreamEvent(items, {
      type: 'tool_complete',
      call_id: 'glob-1',
      tool: 'glob',
      tool_call: {
        globToolCall: {
          result: { success: { files: ['a.txt', 'b.py'] } },
        },
      },
    });
    const tool = items[1].blocks[0];
    assert.equal(tool.status, 'done');
    assert.match(tool.result, /a\.txt/);
    assert.match(tool.result, /b\.py/);
  });

  it('attaches grep match lines when call_id is missing', () => {
    let items = [
      { type: 'human', id: 'h1', text: 'search' },
      {
        type: 'run',
        id: 'r1',
        status: 'running',
        blocks: [{
          type: 'tool',
          id: 'grep-1',
          tool: 'grep',
          status: 'running',
          input: '{"pattern":"foo"}',
        }],
      },
    ];
    items = applyStreamEvent(items, {
      type: 'tool_complete',
      tool: 'grep',
      tool_call: {
        grepToolCall: {
          result: {
            success: {
              matches: [{ path: '/x/a.txt', lineNumber: 2, line: 'foo bar' }],
            },
          },
        },
      },
    });
    const tool = items[1].blocks[0];
    assert.equal(tool.status, 'done');
    assert.match(tool.result, /\/x\/a\.txt:2: foo bar/);
  });
});

describe('runStream rolling context', () => {
  it('buildRollingContextPrefix excludes the latest human turn', () => {
    const items = [
      { type: 'human', id: 'h1', text: 'Premier' },
      {
        type: 'run',
        id: 'r1',
        blocks: [{ type: 'assistant', text: 'Réponse un' }],
      },
      { type: 'human', id: 'h2', text: 'Deuxième' },
    ];
    const prefix = buildRollingContextPrefix(items, { locale: 'fr' });
    assert.match(prefix, /Premier/);
    assert.match(prefix, /Réponse un/);
    assert.doesNotMatch(prefix, /Deuxième/);
  });

  it('returns empty when there is no prior exchange', () => {
    const items = [{ type: 'human', id: 'h1', text: 'Seul' }];
    assert.equal(buildRollingContextPrefix(items), '');
  });

  it('truncates oldest exchanges when over maxChars', () => {
    const items = [
      { type: 'human', id: 'h1', text: 'A'.repeat(500) },
      { type: 'run', id: 'r1', blocks: [{ type: 'assistant', text: 'B'.repeat(500) }] },
      { type: 'human', id: 'h2', text: 'récent' },
      { type: 'run', id: 'r2', blocks: [{ type: 'assistant', text: 'réponse récente' }] },
      { type: 'human', id: 'h3', text: 'courant' },
    ];
    const prefix = buildRollingContextPrefix(items, { maxChars: 400 });
    assert.doesNotMatch(prefix, /AAAA/);
    assert.match(prefix, /récent/);
    assert.doesNotMatch(prefix, /courant/);
  });
});

describe('runStream prime merge', () => {
  it('prefers server done prime over local empty running prime', async () => {
    const { mergeTimelinesPreferVoiceAck, shouldReplaceTimelineAfterComplete } = await import('./runStream.js');
    const local = [{
      type: 'run',
      id: 'p1',
      prime: true,
      status: 'running',
      blocks: [],
    }];
    const server = [{
      type: 'run',
      id: 'p1',
      prime: true,
      status: 'done',
      blocks: [{ type: 'assistant', text: 'Bonjour Xavier' }],
    }];
    const merged = mergeTimelinesPreferVoiceAck(local, server);
    assert.equal(merged[0].status, 'done');
    assert.match(merged[0].blocks[0].text, /Bonjour Xavier/);
    assert.equal(shouldReplaceTimelineAfterComplete(local, server), true);
  });
});
