import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { JobQueue, createQueueServer } from '../index.js';

// Intent: software/universes/univ-base/INTENT.md#proof
//
// Non-regression (Rule 29). RUNBOOK step 6 names four functional proofs. Until
// V1.13.10 `proof.sh` scripted #4 and only the first half of #1 — that a job
// exists — while the runbook told the deployer that #2, the artefact exists,
// and #3, its byte-exact `cmp`, were "yours to perform by hand today". A beta
// tester (Cursor/Luna, v1.13.7) read the script and found what that costs: the
// runbook's canonical job asked for no artefact, so no run had ever compared
// one, and the script's own verdict said nothing about the gap. A proof
// standard that is half-scripted is the half that gets applied.
//
// These run the real proof.sh — copied into a throwaway universe exactly as the
// runbook prescribes copying it — against real files, a real `cmp` and a real
// queue. On the unpatched script they fail: it prints no artefact line at all.

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const PROOF_SH = path.join(REPO, 'software/universes/univ-base/deploy/proof.sh');
const script = fs.readFileSync(PROOF_SH, 'utf8');

let univ;
let artefact;

before(() => {
  univ = fs.mkdtempSync(path.join(os.tmpdir(), 'univ-proof-'));
  fs.mkdirSync(path.join(univ, 'deploy'));
  fs.copyFileSync(PROOF_SH, path.join(univ, 'deploy/proof.sh'));
  fs.writeFileSync(path.join(univ, 'task-schedule.json'), '{"tasks":[{"slug":"tsk-demo"}]}');
  artefact = path.join(univ, 'deliverable.txt');
});

after(() => {
  fs.rmSync(univ, { recursive: true, force: true });
});

/**
 * Runs the copied script. Every brick port defaults to 1, where nothing
 * listens: the vitals and audit checks then report their own real failure,
 * which is what proof.sh exists to do. The artefact proof must stand on its
 * own feet regardless of what else is down, so the exit code is not the
 * subject here — the lines are.
 *
 * Asynchronous on purpose: the queue below is a real server in this process,
 * and a synchronous child would block the event loop that has to answer it.
 */
const execFileAsync = promisify(execFile);

async function runProof(env = {}) {
  const options = {
    encoding: 'utf8',
    env: {
      ...process.env,
      VAULT_PORT: '1', LOGGER_PORT: '1', QUEUE_PORT: '1',
      MAESTRO_PORT: '1', BRIDGE_PORT: '1',
      ...env,
    },
  };
  try {
    const { stdout } = await execFileAsync('bash', [path.join(univ, 'deploy/proof.sh')], options);
    return stdout;
  } catch (error) {
    if (typeof error.stdout !== 'string') throw error; // bash never ran
    return error.stdout;
  }
}

describe('proofs #2 and #3 — the artefact and its byte-exact comparison are scripted', () => {
  it('declares the artefact proven only when cmp says the bytes are identical', async () => {
    fs.writeFileSync(artefact, 'MARKER-7QX');
    const out = await runProof({ PROOF_ARTIFACT: artefact, PROOF_EXPECTED: 'MARKER-7QX' });

    assert.match(
      out,
      /^\s+OK\s+artefact\s+.*byte-exact/m,
      'the deployer declared what the job was asked to write; the script must compare it and report the result',
    );
  });

  it('rejects the file whose only difference is the newline command substitution eats', async () => {
    fs.writeFileSync(artefact, 'MARKER-7QX\n');

    const eaten = await runProof({ PROOF_ARTIFACT: artefact, PROOF_EXPECTED: 'MARKER-7QX' });
    assert.match(
      eaten,
      /^\s+FAIL\s+artefact/m,
      'test "$(cat f)" = v blesses this file — the trailing newline is stripped before the comparison. cmp does not.',
    );

    // Same file, same script: declared with its newline, it is the right file.
    // So the FAIL above is byte-exactness, not a check that fails on everything.
    const declared = await runProof({ PROOF_ARTIFACT: artefact, PROOF_EXPECTED: 'MARKER-7QX\n' });
    assert.match(declared, /^\s+OK\s+artefact\s+.*byte-exact/m);
  });

  it('fails an artefact that was declared but never given expected bytes', async () => {
    fs.writeFileSync(artefact, 'MARKER-7QX');
    const out = await runProof({ PROOF_ARTIFACT: artefact });

    assert.match(
      out,
      /^\s+FAIL\s+artefact/m,
      'existence alone is the check that blesses a wrong file — a declaration nobody can compare is not a proof',
    );
  });

  it('never compares through a command substitution, in any line it executes', () => {
    const executable = script.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

    assert.doesNotMatch(
      executable,
      /\$\(\s*cat\b/,
      '$(cat file) drops trailing newlines: the comparison would pass on bytes that differ',
    );
    assert.match(executable, /\bcmp\b/, 'the byte comparison is cmp, and nothing else');
  });
});

describe('what was not proven is said out loud', () => {
  it('records the undeclared artefact as a skipped proof, not as silence', async () => {
    const out = await runProof();

    assert.match(
      out,
      /^\s+SKIP\s+artefact\s+.*PROOF_ARTIFACT/m,
      'a deployer who declares nothing must still read what was therefore not checked',
    );
  });

  it('never closes with a verdict that leaves the artefact unmentioned', () => {
    const verdicts = script.split('\n').filter((line) => line.includes('is proven'));

    assert.ok(verdicts.length > 0, 'the script must still conclude something');
    for (const line of verdicts) {
      assert.match(
        line,
        /artefact/i,
        `a success verdict that says nothing about the artefact is the green Rule 0G forbids:\n  ${line.trim()}`,
      );
    }
  });
});

// For a literal agent the runbook IS the code, so Rule 29 binds it too. The
// tester's root cause named the document first: the runbook requires an artefact
// and a byte comparison, and its canonical job asks for no artefact at all.
describe('the runbook asks for what it demands as proof', () => {
  const runbook = fs.readFileSync(path.join(REPO, 'docs/agent/RUNBOOK-EXPLICIT.md'), 'utf8');

  it('asks the canonical job for the artefact proof 2 compares', () => {
    const start = runbook.indexOf('"type": "agent.inject"');
    assert.notEqual(start, -1, 'step 6 no longer carries the canonical job');
    const example = runbook.slice(start, runbook.indexOf('```', start));

    assert.match(
      example,
      /"message": "[^"]*\bWrite\b[^"]*\binto\b/,
      'a job asked only to reply produces nothing to cmp — proofs 2 and 3 are unperformable on the repository\'s own example',
    );
  });

  it('hands checks 2 and 3 to the script instead of back to the deployer', () => {
    assert.doesNotMatch(
      runbook,
      /yours to perform by hand today/,
      'the artefact and its cmp are scripted now; a document that still delegates them by hand is what the tester read',
    );
    assert.match(runbook, /PROOF_ARTIFACT/, 'the declaration the script needs must be shown, not guessed');
    assert.match(runbook, /PROOF_EXPECTED/, 'the expected bytes are declared, not inferred');
  });
});

describe('proof #1 — the persisted answer is read, not assumed', () => {
  let server;
  let queue;
  let port;

  before(async () => {
    queue = new JobQueue({});
    server = createQueueServer({ port: 0, host: '127.0.0.1', queue });
    await new Promise((resolve) => server.on('listening', resolve));
    port = server.address().port;
  });

  after(() => server.close());

  it('fails a job that reached COMPLETED with its answer only on the stream', async () => {
    const job = queue.createJob({ type: 'agent.inject', payload: { message: 'hi' } });
    queue.updateJobProgress(job.id, { status: 'COMPLETED' });

    const out = await runProof({ QUEUE_PORT: String(port) });

    assert.match(
      out,
      /^\s+FAIL\s+answer\s+.*no persisted result\.answer/m,
      'the job exists and completed — proof #1 is the persisted result.answer, not the job',
    );
  });

  it('reads the persisted answer and checks it carries the declared marker', async () => {
    const job = queue.createJob({ type: 'agent.inject', payload: { message: 'hi' } });
    queue.updateJobProgress(job.id, { status: 'COMPLETED', result: { answer: 'MARKER-7QX' } });

    const proven = await runProof({ QUEUE_PORT: String(port), PROOF_JOB_ID: job.id, PROOF_ANSWER: 'MARKER-7QX' });
    assert.match(proven, /^\s+OK\s+answer\s+.*answer persisted/m);

    const wrong = await runProof({ QUEUE_PORT: String(port), PROOF_JOB_ID: job.id, PROOF_ANSWER: 'MARKER-OTHER' });
    assert.match(
      wrong,
      /^\s+FAIL\s+answer/m,
      'an answer that is not the one asked for proves the queue works, not that the work was done',
    );
  });
});
