import crypto from 'node:crypto';
import fs from 'node:fs';

const ROLE_ID = /^[a-z][a-z0-9_-]{1,63}$/;

function requiredString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function validateObservation(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`observations[${index}] must be an object`);
  }
  const id = requiredString(value.id, `observations[${index}].id`);
  const url = requiredString(value.url, `observations[${index}].url`);
  const parsed = new URL(url);
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error(`observations[${index}].url must use HTTP or HTTPS`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`observations[${index}].url must not contain credentials`);
  }
  if (parsed.search || parsed.hash) {
    throw new Error(`observations[${index}].url must not contain query parameters or fragments`);
  }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
  if (parsed.protocol === 'http:' && !loopback) {
    throw new Error(`observations[${index}].url must use HTTPS outside loopback`);
  }
  if (value.method !== undefined && value.method !== 'GET') {
    throw new Error(`observations[${index}].method must be GET`);
  }
  const expectedStatuses = value.expectedStatuses ?? [200];
  if (!Array.isArray(expectedStatuses) || expectedStatuses.length === 0
    || expectedStatuses.some((status) => !Number.isInteger(status) || status < 100 || status > 599)) {
    throw new Error(`observations[${index}].expectedStatuses must contain HTTP status integers`);
  }
  const timeoutMs = value.timeoutMs ?? 2500;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) {
    throw new Error(`observations[${index}].timeoutMs must be between 100 and 30000`);
  }
  const maxResponseBytes = value.maxResponseBytes ?? 16_384;
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 || maxResponseBytes > 65_536) {
    throw new Error(`observations[${index}].maxResponseBytes must be between 1 and 65536`);
  }
  if (value.expectedJson !== undefined
    && (!value.expectedJson || typeof value.expectedJson !== 'object' || Array.isArray(value.expectedJson))) {
    throw new Error(`observations[${index}].expectedJson must be an object`);
  }
  return Object.freeze({
    id,
    url,
    method: 'GET',
    expectedStatuses: Object.freeze([...expectedStatuses]),
    timeoutMs,
    maxResponseBytes,
    expectedJson: value.expectedJson === undefined ? undefined : Object.freeze({ ...value.expectedJson }),
  });
}

export function validateResidentContext(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('context must be an object');
  }
  if (value.schemaVersion !== 1) throw new Error('schemaVersion must be 1');
  const contextVersion = requiredString(value.contextVersion, 'contextVersion');
  const universe = requiredString(value.universe, 'universe');
  const role = requiredString(value.role, 'role');
  const purpose = requiredString(value.purpose, 'purpose');
  if (role !== 'resident-observer') throw new Error('role must be resident-observer');
  if (value.authority?.mode !== 'read-only') throw new Error('authority.mode must be read-only');
  if (!Array.isArray(value.permittedOutputs) || value.permittedOutputs.length !== 1
    || value.permittedOutputs[0] !== 'incident-journal') {
    throw new Error('permittedOutputs must contain only incident-journal');
  }
  if (!Array.isArray(value.stopConditions) || value.stopConditions.length === 0
    || value.stopConditions.some((condition) => typeof condition !== 'string' || !condition.trim())) {
    throw new Error('stopConditions must contain explicit non-empty conditions');
  }
  if (value.recoveryBoundary !== 'record-recovery-fact-only') {
    throw new Error('recoveryBoundary must be record-recovery-fact-only');
  }

  const destination = value.escalationDestination;
  if (!destination || destination.kind !== 'role' || !ROLE_ID.test(destination.id || '')) {
    throw new Error('escalationDestination must name an abstract role identifier');
  }
  if (!Array.isArray(value.observations) || value.observations.length === 0) {
    throw new Error('observations must contain at least one declared source');
  }
  const observations = value.observations.map(validateObservation);
  const ids = new Set();
  for (const observation of observations) {
    if (ids.has(observation.id)) throw new Error(`duplicate observation id: ${observation.id}`);
    ids.add(observation.id);
  }

  return Object.freeze({
    schemaVersion: 1,
    contextVersion,
    universe,
    role,
    purpose,
    authority: Object.freeze({ mode: 'read-only' }),
    permittedOutputs: Object.freeze(['incident-journal']),
    stopConditions: Object.freeze(value.stopConditions.map((condition) => condition.trim())),
    recoveryBoundary: 'record-recovery-fact-only',
    escalationDestination: Object.freeze({ kind: 'role', id: destination.id }),
    observations: Object.freeze(observations),
  });
}

export function loadResidentContext(contextPath) {
  const raw = fs.readFileSync(contextPath);
  if (!raw.toString('utf8').trim()) throw new Error('context file is empty');
  const parsed = JSON.parse(raw.toString('utf8'));
  return {
    context: validateResidentContext(parsed),
    contextHash: crypto.createHash('sha256').update(raw).digest('hex'),
  };
}
