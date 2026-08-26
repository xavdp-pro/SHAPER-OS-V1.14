import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { JobQueue, createQueueServer } from '../index.js';

const PORT = 8549;

let server;

before(async () => {
  server = createQueueServer({ port: PORT, host: '127.0.0.1' });
  await new Promise((resolve) => server.on('listening', resolve));
});

after(() => {
  server.close();
});

test('queue-server - health and job CRUD over HTTP', async () => {
  const healthRes = await fetch(`http://127.0.0.1:${PORT}/api/health`);
  const health = await healthRes.json();
  assert.equal(healthRes.status, 200);
  assert.equal(health.service, 'queue-v1');

  const createRes = await fetch(`http://127.0.0.1:${PORT}/api/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'ocr', payload: { file: 'doc.pdf' }, totalSteps: 2 }),
  });
  const created = await createRes.json();
  assert.equal(createRes.status, 201);
  assert.equal(created.job.status, 'PENDING');

  const patchRes = await fetch(`http://127.0.0.1:${PORT}/api/jobs/${created.job.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ progress: 50, step: 1, status: 'RUNNING' }),
  });
  const updated = await patchRes.json();
  assert.equal(patchRes.status, 200);
  assert.equal(updated.job.status, 'RUNNING');

  const getRes = await fetch(`http://127.0.0.1:${PORT}/api/jobs/${created.job.id}`);
  const fetched = await getRes.json();
  assert.equal(fetched.job.progress, 50);

  const listRes = await fetch(`http://127.0.0.1:${PORT}/api/jobs?status=RUNNING`);
  const listed = await listRes.json();
  assert.equal(listed.jobs.length, 1);
});

test('queue-server - SSE statusChange events', async () => {
  const queue = new JobQueue();
  const ssePort = 8550;
  const sseServer = createQueueServer({ port: ssePort, host: '127.0.0.1', queue });
  await new Promise((resolve) => sseServer.on('listening', resolve));

  const events = [];
  const controller = new AbortController();
  const ssePromise = fetch(`http://127.0.0.1:${ssePort}/api/jobs/events`, {
    signal: controller.signal,
  }).then(async (res) => {
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (events.length < 1) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split('\n\n');
      buffer = frames.pop() || '';
      for (const frame of frames) {
        if (frame.startsWith('event: statusChange')) {
          const dataLine = frame.split('\n').find((line) => line.startsWith('data: '));
          if (dataLine) events.push(JSON.parse(dataLine.slice(6)));
        }
      }
    }
    controller.abort();
  });

  await new Promise((resolve) => setTimeout(resolve, 50));
  queue.createJob({ type: 'sse-test' });

  await Promise.race([
    ssePromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('SSE timeout')), 3000)),
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'sse-test');

  sseServer.close();
});
