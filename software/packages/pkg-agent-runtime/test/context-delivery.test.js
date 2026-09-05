import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { buildInjectBody } from '../index.js';
import { createQueueBeatHandler } from '../../pkg-maestro/queue-beat.js';

// Intent: software/packages/pkg-agent-runtime/INTENT.md
// Real files and a local HTTP receiver verify transport, not model capability.
function contextFile(t, text = 'The verification marker is amber-cedar.') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-task-context-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'ctx-universe.md');
  fs.writeFileSync(file, text);
  return file;
}

test('a remote bridge receives the context contents, not a caller-local path', (t) => {
  const file = contextFile(t);
  const body = buildInjectBody({ slug: 'task-proof', contextPath: file, instruction: 'Use the verification marker.' });
  assert.equal(body.context_file, null);
  assert.equal(body.context, fs.readFileSync(file, 'utf8'));
});

test('a declared missing or empty context halts instead of producing a generic briefing', (t) => {
  const file = contextFile(t, '');
  assert.throws(() => buildInjectBody({ slug: 'task-proof', contextPath: file }), /empty/i);
  fs.unlinkSync(file);
  assert.throws(() => buildInjectBody({ slug: 'task-proof', contextPath: file }), /ENOENT/);
});

test('file context and inline task instructions are both preserved', (t) => {
  const file = contextFile(t);
  const body = buildInjectBody({ slug: 'task-proof', contextPath: file, contextText: 'Write only the marker.' });
  assert.match(body.context, /amber-cedar/);
  assert.match(body.context, /Write only the marker/);
});

test('maestro snapshots context into the queued job and refuses an unreadable context', async (t) => {
  const file = contextFile(t);
  const received = [];
  const server = http.createServer(async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET') return res.end(JSON.stringify({ jobs: [] }));
    let text = '';
    for await (const chunk of req) text += chunk;
    received.push(JSON.parse(text));
    res.end(JSON.stringify({ job: { id: 'job-context' } }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const beat = createQueueBeatHandler({ queueUrl: `http://127.0.0.1:${server.address().port}` });
  const task = { slug: 'task-proof', contextPath: file, instruction: 'Use the configured marker.' };
  assert.equal((await beat(task)).enqueued, true);
  assert.equal(received[0].payload.context, fs.readFileSync(file, 'utf8'));
  assert.equal(received[0].payload.message, task.instruction);
  fs.unlinkSync(file);
  const rejected = await beat(task);
  assert.equal(rejected.skipped, true);
  assert.equal(rejected.reason, 'context_unreadable');
  assert.equal(received.length, 1, 'no job may be queued after its context was lost');
});
