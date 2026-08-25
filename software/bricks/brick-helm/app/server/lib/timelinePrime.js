import crypto from 'node:crypto';

/** Build a timeline run shell for briefing / greeting presentation. */
export function buildPrimeTimelineRun() {
  return {
    type: 'run',
    id: crypto.randomUUID(),
    streamId: `prime-${Date.now()}`,
    status: 'running',
    prime: true,
    blocks: [],
    time: Date.now(),
  };
}
