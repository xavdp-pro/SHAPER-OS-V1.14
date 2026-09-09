import crypto from 'node:crypto';
import { loadResidentContext } from './context.js';
import { IncidentJournal } from './incident-journal.js';

export { loadResidentContext, validateResidentContext } from './context.js';
export { IncidentJournal } from './incident-journal.js';

function sameExpectedJson(actual, expected) {
  return Object.entries(expected).every(([key, value]) => Object.hasOwn(actual, key) && actual[key] === value);
}

function incidentId(universe, observationId) {
  return crypto.createHash('sha256').update(`${universe}\n${observationId}`).digest('hex').slice(0, 24);
}

async function readBoundedText(response, maxBytes) {
  if (!response.body?.getReader) throw new Error('response body is not readable');
  const reader = response.body.getReader();
  const chunks = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      const error = new Error(`response exceeds ${maxBytes} bytes`);
      error.code = 'RESPONSE_TOO_LARGE';
      throw error;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function collectHttpFact(observation, fetchImpl, observedAt) {
  const started = Date.now();
  try {
    const response = await fetchImpl(observation.url, {
      method: 'GET',
      redirect: 'error',
      signal: AbortSignal.timeout(observation.timeoutMs),
    });
    let json = null;
    let jsonError = null;
    if (observation.expectedJson !== undefined) {
      try {
        json = JSON.parse(await readBoundedText(response, observation.maxResponseBytes));
      } catch (error) {
        jsonError = error.message;
        if (error.code === 'RESPONSE_TOO_LARGE') {
          return {
            active: true,
            fact: {
              source: observation.id,
              observedAt,
              code: error.code,
              evidence: {
                url: observation.url,
                method: 'GET',
                status: response.status,
                durationMs: Date.now() - started,
                maxResponseBytes: observation.maxResponseBytes,
              },
            },
          };
        }
      }
    }
    const statusMatches = observation.expectedStatuses.includes(response.status);
    const jsonMatches = observation.expectedJson === undefined
      || (json && sameExpectedJson(json, observation.expectedJson));
    const active = !statusMatches || !jsonMatches;
    return {
      active,
      fact: {
        source: observation.id,
        observedAt,
        code: active ? (statusMatches ? 'JSON_EXPECTATION_MISMATCH' : 'HTTP_STATUS_MISMATCH') : 'OBSERVATION_MATCHED',
        evidence: {
          url: observation.url,
          method: 'GET',
          status: response.status,
          durationMs: Date.now() - started,
          expectedStatuses: observation.expectedStatuses,
          ...(observation.expectedJson === undefined ? {} : {
            expectedJson: observation.expectedJson,
            observedJson: json,
            jsonError,
          }),
        },
      },
    };
  } catch (error) {
    return {
      active: true,
      fact: {
        source: observation.id,
        observedAt,
        code: 'OBSERVATION_UNREACHABLE',
        evidence: {
          url: observation.url,
          method: 'GET',
          durationMs: Date.now() - started,
          error: error.message,
        },
      },
    };
  }
}

export function createResidentObserver({ contextPath, journalPath, fetchImpl = fetch, now = () => new Date() } = {}) {
  if (!contextPath) throw new Error('contextPath is required');
  if (!journalPath) throw new Error('journalPath is required');
  const loaded = loadResidentContext(contextPath);
  const journal = new IncidentJournal({ filePath: journalPath });

  return Object.freeze({
    contextVersion: loaded.context.contextVersion,
    contextHash: loaded.contextHash,
    journalPath: journal.filePath,
    async observe() {
      const observedAt = now().toISOString();
      const current = journal.current();
      const events = [];

      for (const observation of loaded.context.observations) {
        const collected = await collectHttpFact(observation, fetchImpl, observedAt);
        const id = incidentId(loaded.context.universe, observation.id);
        const previous = current.get(id);
        if (!collected.active && previous?.state !== 'OPEN') continue;

        const event = {
          schemaVersion: 1,
          eventId: crypto.randomUUID(),
          incidentId: id,
          event: collected.active ? (previous?.state === 'OPEN' ? 'OBSERVED' : 'OPENED') : 'RESOLVED',
          state: collected.active ? 'OPEN' : 'RESOLVED',
          universe: loaded.context.universe,
          observation: observation.id,
          contextVersion: loaded.context.contextVersion,
          contextHash: loaded.contextHash,
          recordedAt: observedAt,
          destination: loaded.context.escalationDestination,
          facts: [collected.fact],
          hypotheses: [],
        };
        journal.append(event);
        current.set(id, event);
        events.push(event);
      }
      return { observedAt, contextVersion: loaded.context.contextVersion, contextHash: loaded.contextHash, events };
    },
  });
}
