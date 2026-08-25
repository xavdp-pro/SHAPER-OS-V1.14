import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { stabilizeStreamingMarkdown } from './streamingMarkdown.js';

describe('stabilizeStreamingMarkdown', () => {
  it('leaves complete markdown unchanged', () => {
    const md = '## Hi\n\n```js\nconst x = 1;\n```\n';
    assert.equal(stabilizeStreamingMarkdown(md, { streaming: true }), md);
  });

  it('closes an open fence while streaming', () => {
    const md = 'Hello\n```js\nconst x = 1;';
    assert.equal(
      stabilizeStreamingMarkdown(md, { streaming: true }),
      `${md}\n\`\`\``,
    );
  });

  it('does nothing when not streaming', () => {
    const md = '```open';
    assert.equal(stabilizeStreamingMarkdown(md, { streaming: false }), md);
  });
});
