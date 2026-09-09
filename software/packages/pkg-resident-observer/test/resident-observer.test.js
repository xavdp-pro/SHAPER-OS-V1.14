import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createResidentObserver, IncidentJournal, loadResidentContext, validateResidentContext } from '../index.js';

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-resident-observer-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function context(overrides = {}) {
  return {
    schemaVersion: 1,
    contextVersion: 'clinic-runtime-observer/1',
    universe: 'univ-clinic0',
    role: 'resident-observer',
    purpose: 'Record factual service degradation without changing the universe.',
    authority: { mode: 'read-only' },
    permittedOutputs: ['incident-journal'],
    stopConditions: ['Stop when the context cannot be read or validated.'],
    recoveryBoundary: 'record-recovery-fact-only',
    escalationDestination: { kind: 'role', id: 'universe_operator' },
    observations: [{ id: 'tools-health', url: 'http://127.0.0.1:1/api/health', expectedStatuses: [200] }],
    ...overrides,
  };
}

function writeContext(directory, value) {
  const file = path.join(directory, 'ctx-resident-observer.json');
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  return file;
}

test('context authority is versioned, hashed and strictly read-only', (t) => {
  const directory = workspace(t);
  const file = writeContext(directory, context());
  const loaded = loadResidentContext(file);
  assert.equal(loaded.context.authority.mode, 'read-only');
  assert.equal(loaded.context.escalationDestination.id, 'universe_operator');
  assert.match(loaded.contextHash, /^[a-f0-9]{64}$/);

  assert.throws(() => validateResidentContext(context({ authority: { mode: 'repair' } })), /read-only/);
  assert.throws(() => validateResidentContext(context({
    observations: [{ id: 'bad', method: 'POST', url: 'http://127.0.0.1/action' }],
  })), /must be GET/);
  assert.throws(() => validateResidentContext(context({
    escalationDestination: { kind: 'email', id: 'operator@example.invalid' },
  })), /abstract role/);
  assert.throws(() => validateResidentContext(context({
    observations: [{ id: 'bad', url: 'http://user:secret@127.0.0.1/health' }],
  })), /must not contain credentials/);
  assert.throws(() => validateResidentContext(context({
    observations: [{ id: 'bad', url: 'https://service.invalid/health?token=secret' }],
  })), /query parameters/);
  assert.throws(() => validateResidentContext(context({
    observations: [{ id: 'bad', url: 'http://service.invalid/health' }],
  })), /HTTPS outside loopback/);
});

test('declared JSON evidence is bounded before parsing or persistence', async (t) => {
  const directory = workspace(t);
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: true, padding: 'x'.repeat(1000) }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const contextPath = writeContext(directory, context({
    observations: [{
      id: 'tools-health',
      url: `http://127.0.0.1:${server.address().port}/api/health`,
      expectedStatuses: [200],
      expectedJson: { ok: true },
      maxResponseBytes: 32,
    }],
  }));
  const result = await createResidentObserver({
    contextPath,
    journalPath: path.join(directory, 'incidents.jsonl'),
  }).observe();
  assert.equal(result.events[0].facts[0].code, 'RESPONSE_TOO_LARGE');
  assert.equal(JSON.stringify(result).includes('padding'), false);
});

test('JSON evidence retains only keys declared by the context', async (t) => {
  const directory = workspace(t);
  const server = http.createServer((_request, response) => {
    response.writeHead(200, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ status: 'degraded', service: 'brick-voice', patientName: 'must-not-persist' }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const contextPath = writeContext(directory, context({
    observations: [{
      id: 'voice-health',
      url: `http://127.0.0.1:${server.address().port}/health`,
      expectedStatuses: [200],
      expectedJson: { status: 'ok', service: 'brick-voice' },
    }],
  }));
  const journalPath = path.join(directory, 'incidents.jsonl');
  const result = await createResidentObserver({ contextPath, journalPath }).observe();

  assert.deepEqual(result.events[0].facts[0].evidence.observedJson, {
    status: 'degraded',
    service: 'brick-voice',
  });
  assert.equal(JSON.stringify(result).includes('patientName'), false);
  assert.equal(fs.readFileSync(journalPath, 'utf8').includes('must-not-persist'), false);
});

test('observation uses GET only and appends facts without hypotheses or delivery', async (t) => {
  const directory = workspace(t);
  const methods = [];
  const server = http.createServer((request, response) => {
    methods.push(request.method);
    response.writeHead(503, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: false }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const contextPath = writeContext(directory, context({
    observations: [{ id: 'tools-health', url: `http://127.0.0.1:${address.port}/api/health`, expectedStatuses: [200] }],
  }));
  const journalPath = path.join(directory, 'incidents.jsonl');
  const observer = createResidentObserver({ contextPath, journalPath, now: () => new Date('2026-09-09T10:00:00.000Z') });
  const result = await observer.observe();

  assert.deepEqual(methods, ['GET']);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].event, 'OPENED');
  assert.equal(result.events[0].facts[0].code, 'HTTP_STATUS_MISMATCH');
  assert.deepEqual(result.events[0].hypotheses, []);
  assert.deepEqual(result.events[0].destination, { kind: 'role', id: 'universe_operator' });
  assert.equal(new IncidentJournal({ filePath: journalPath }).readAll().length, 1);
});

test('the append-only journal preserves opening, observation and factual recovery', async (t) => {
  const directory = workspace(t);
  let status = 503;
  const server = http.createServer((_request, response) => {
    response.writeHead(status, { 'Content-Type': 'application/json' });
    response.end(JSON.stringify({ ok: status === 200 }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const contextPath = writeContext(directory, context({
    observations: [{ id: 'tools-health', url: `http://127.0.0.1:${server.address().port}/api/health`, expectedStatuses: [200], expectedJson: { ok: true } }],
  }));
  const journalPath = path.join(directory, 'incidents.jsonl');
  const observer = createResidentObserver({ contextPath, journalPath });
  await observer.observe();
  await observer.observe();
  status = 200;
  await observer.observe();
  await observer.observe();

  const events = new IncidentJournal({ filePath: journalPath }).readAll();
  assert.deepEqual(events.map((event) => event.event), ['OPENED', 'OBSERVED', 'RESOLVED']);
  assert.equal(events[2].facts[0].code, 'OBSERVATION_MATCHED');
  assert.equal(events[0].incidentId, events[2].incidentId);
  assert.equal(events.every((event) => event.contextHash === observer.contextHash), true);
});

test('a corrupt journal halts instead of forgetting an existing incident', (t) => {
  const directory = workspace(t);
  const journalPath = path.join(directory, 'incidents.jsonl');
  fs.writeFileSync(journalPath, '{not-json}\n');
  const journal = new IncidentJournal({ filePath: journalPath });
  assert.throws(() => journal.current(), /unreadable at line 1/);
});
