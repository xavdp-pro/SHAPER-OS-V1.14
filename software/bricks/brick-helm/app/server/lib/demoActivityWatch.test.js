import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPrimeResponseNotify,
  parseBridgeSseDataLine,
} from './demoActivityWatch.js';

describe('demoActivityWatch', () => {
  it('detects prime / briefing responses', () => {
    assert.equal(isPrimeResponseNotify('Operator briefing', 'short'), true);
    assert.equal(isPrimeResponseNotify('hello', 'x'.repeat(4001)), true);
    assert.equal(isPrimeResponseNotify('donne la RAM', '16 Go'), false);
  });

  it('parses bridge SSE data lines', () => {
    const chunk = 'event: message\ndata: {"type":"response_complete","conversation":"Ivonne","text":"PONG"}\n';
    const evt = parseBridgeSseDataLine(chunk);
    assert.equal(evt.type, 'response_complete');
    assert.equal(evt.conversation, 'Ivonne');
    assert.equal(evt.text, 'PONG');
  });

  it('returns null for invalid SSE chunks', () => {
    assert.equal(parseBridgeSseDataLine('event: ping\n'), null);
    assert.equal(parseBridgeSseDataLine('data: not-json'), null);
  });
});
