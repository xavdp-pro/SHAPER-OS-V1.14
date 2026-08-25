import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  toolResultFromEvent,
  formatToolInputSummary,
  formatToolResultForDisplay,
} from './toolFormat.js';

describe('toolResultFromEvent', () => {
  it('formats glob file lists', () => {
    const out = toolResultFromEvent({
      tool: 'glob',
      tool_call: {
        globToolCall: {
          result: { success: { files: ['a.txt', 'b.py'] } },
        },
      },
    });
    assert.equal(out, 'a.txt\nb.py');
  });

  it('formats grep match objects', () => {
    const out = toolResultFromEvent({
      tool: 'grep',
      tool_call: {
        grepToolCall: {
          result: {
            success: {
              matches: [
                { path: '/x/a.txt', lineNumber: 3, line: 'hello' },
              ],
            },
          },
        },
      },
    });
    assert.equal(out, '/x/a.txt:3: hello');
  });

  it('falls back to input summary when result empty', () => {
    const out = toolResultFromEvent({
      tool: 'glob',
      input: JSON.stringify({ targetDirectory: '/tmp', globPattern: '**/*.py' }),
      tool_call: { globToolCall: { result: { success: { files: [] } } } },
    });
    assert.match(out, /glob \*\*\/\*\.py/);
    assert.match(out, /\/tmp/);
  });

  it('formats shell stdout', () => {
    const out = toolResultFromEvent({
      tool: 'shell',
      tool_call: {
        shellToolCall: {
          result: { success: { stdout: 'ok\n', stderr: '' } },
        },
      },
    });
    assert.equal(out.trim(), 'ok');
  });

  it('formats glob paths array', () => {
    const out = toolResultFromEvent({
      tool: 'glob',
      tool_call: {
        globToolCall: {
          result: { success: { paths: ['/a', '/b'] } },
        },
      },
    });
    assert.equal(out, '/a\n/b');
  });

  it('reports empty glob as aucun fichier when explicit', () => {
    const out = toolResultFromEvent({
      tool: 'glob',
      tool_call: {
        globToolCall: {
          result: { success: { totalFiles: 0, files: [] } },
        },
      },
    });
    assert.equal(out, '(aucun fichier)');
  });
});

describe('formatToolInputSummary', () => {
  it('summarizes grep pattern and path', () => {
    const s = formatToolInputSummary('grep', {
      pattern: 'foo',
      path: '/home/zaza',
    });
    assert.match(s, /grep/);
    assert.match(s, /foo/);
    assert.match(s, /zaza/);
  });
});

describe('formatToolResultForDisplay', () => {
  it('uses input summary for empty JSON args blob', () => {
    const s = formatToolResultForDisplay('{"args":{"path":"/x"}}', {
      tool: 'read',
      input: '{"path":"/x"}',
    });
    assert.equal(s, 'read /x');
  });
});
