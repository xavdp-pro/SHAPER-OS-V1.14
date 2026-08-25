import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildTaskFrame, taskFromPayload, STANDING_RULES, AGY_TOOL_RULES } from '../task-frame.js';

const ok = { brief: 'Translate the comments.', perimeter: '/repo/software/scripts', goal: 'no French remains' };

describe('a task must be reviewable before it is sent', () => {
  it('refuses a task with no perimeter', () => {
    // An unbounded task cannot be reviewed: there is no answer to "did it stay
    // where it belonged".
    assert.throws(() => buildTaskFrame({ brief: 'do something', goal: 'it is done' }), /perimeter is required/);
  });

  it('refuses a task with no finish line', () => {
    assert.throws(() => buildTaskFrame({ brief: 'do something', perimeter: '/repo' }), /goal is required/);
  });

  it('refuses an empty brief', () => {
    assert.throws(() => buildTaskFrame({ brief: '   ', perimeter: '/repo', goal: 'g' }), /brief is required/);
  });
});

describe('what the frame says', () => {
  it('states the perimeter and the finish line in the agent\'s own words', () => {
    const f = buildTaskFrame(ok);
    assert.match(f, /You work ONLY inside: \/repo\/software\/scripts/);
    assert.match(f, /Done when: no French remains/);
  });

  it('carries every standing rule, so no door grants a lighter contract', () => {
    const f = buildTaskFrame(ok);
    for (const rule of STANDING_RULES) assert.ok(f.includes(rule), `missing: ${rule}`);
  });

  it('forbids editing the law rather than asking the agent to obey it silently', () => {
    // An agent that finds a rule inconvenient must report it. Letting it edit
    // RULES.md would let the code rewrite its own constraints.
    assert.match(buildTaskFrame(ok), /report it rather than editing the law/);
  });

  it('adds the proof command only when one was given', () => {
    assert.doesNotMatch(buildTaskFrame(ok), /Prove it with/);
    assert.match(buildTaskFrame({ ...ok, proof: 'node --test' }), /Prove it with: node --test/);
  });

  it('warns that a moved test count means changed behaviour', () => {
    assert.match(buildTaskFrame({ ...ok, proof: 'node --test' }), /count that moves means behaviour changed/);
  });

  it('ends by asking what remains and what blocks, not only what is done', () => {
    assert.match(buildTaskFrame(ok), /what is done, what remains, what blocks/);
  });

  it('can carry extra rules such as agy tool constraints', () => {
    const f = buildTaskFrame({ ...ok, extraRules: AGY_TOOL_RULES });
    assert.match(f, /not write_to_file/);
    assert.match(f, /not a valid artifact path/);
  });
});

describe('reading a task out of a job payload', () => {
  it('returns null for a plain injection, which is not an error', () => {
    assert.equal(taskFromPayload({ message: 'say hello' }), null);
  });

  it('frames a payload that carries perimeter and goal', () => {
    const f = taskFromPayload({ brief: 'tidy up', perimeter: '/repo/x', goal: 'tidy' });
    assert.match(f, /You work ONLY inside: \/repo\/x/);
  });

  it('accepts `message` as the brief, so existing callers keep working', () => {
    const f = taskFromPayload({ message: 'tidy up', perimeter: '/repo/x', goal: 'tidy' });
    assert.match(f, /tidy up/);
  });

  it('rejects half a task rather than sending it unframed', () => {
    // A payload with a perimeter but no goal looks framed and is not — the
    // worst of both, because a reader stops checking.
    assert.throws(() => taskFromPayload({ brief: 'do it', perimeter: '/repo/x' }), /goal is required/);
  });
});
