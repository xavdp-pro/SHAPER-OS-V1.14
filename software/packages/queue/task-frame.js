/**
 * The frame every delegated task is wrapped in — written once, used everywhere.
 *
 * ── Why one place ──────────────────────────────────────────────────────────
 * A task can reach an agent through the CLI router or through the queue. If
 * each composed its own frame, the same task would arrive under different rules
 * depending on which door it came through, and the difference would only show
 * up as an agent behaving oddly weeks later. Two doors, one contract.
 *
 * ── What a frame is, and what it is not ────────────────────────────────────
 * It states the perimeter, the finish line, and the standing obligations. It is
 * **instruction, not enforcement** — an agent that decides to write elsewhere
 * can. Real containment is the `--add-dir` the bridge passes to the CLI, and
 * the review that follows.
 *
 * That distinction is worth keeping visible: a frame that reads like a sandbox
 * invites the reader to stop checking, which is the opposite of what it is for.
 */

/** Obligations that hold whoever runs, whatever the task. */
export const STANDING_RULES = [
  'You modify no file outside the perimeter above.',
  'You never modify software/RULES.md nor doctrine/: if a rule blocks you, report it rather than editing the law.',
  'Every fix ships with its regression test (Rule 29).',
  'Everything you write — code, comments, docs, reports — is in English.',
  'Invent nothing (Rule 0G). An empty field with its reason beats a plausible value.',
  'If you cannot verify a claim, say so instead of asserting it.',
];

/** Extra rules for Antigravity (agy): its write_to_file tool cannot touch the repo. */
export const AGY_TOOL_RULES = [
  'For file changes inside the perimeter, use shell commands (tee, cp, mv, sed, heredoc) — not write_to_file, which is confined to the Antigravity brain directory and fails with "not a valid artifact path".',
];

/**
 * @param {object} task
 *   brief      what to do — the body of the task
 *   perimeter  absolute path the agent may touch (required: a task without one
 *              is a task nobody can review)
 *   goal       the finish line, stated so it can be checked without the agent
 *   proof      optional command that settles whether the goal was met
 */
export function buildTaskFrame({ brief, perimeter, goal, proof = null, extraRules = [] } = {}) {
  if (!brief || !String(brief).trim()) throw new Error('brief is required');
  if (!perimeter) throw new Error('perimeter is required — an unbounded task cannot be reviewed');
  if (!goal) throw new Error('goal is required — a task with no finish line cannot be judged done');

  return [
    String(brief).trim(),
    '',
    '--- EXECUTION FRAME ---',
    `You work ONLY inside: ${perimeter}`,
    `Done when: ${goal}`,
    ...(proof ? ['', `Prove it with: ${proof}`, 'A count that moves means behaviour changed. Find out why before reporting success.'] : []),
    '',
    ...STANDING_RULES.map((r) => `· ${r}`),
    ...extraRules.map((r) => `· ${r}`),
    '',
    'When you are done, write a five-line summary: what is done, what remains, what blocks.',
  ].join('\n');
}

/**
 * Pulls a task out of a job payload, or explains what is missing.
 *
 * Returns `null` for payloads that are plain injections — the queue still
 * carries those, and they are not errors.
 */
export function taskFromPayload(payload = {}) {
  const { brief, perimeter, goal, proof, message } = payload;
  if (!brief && !perimeter && !goal) return null;
  // Half a task is worse than none: it looks framed and is not.
  return buildTaskFrame({ brief: brief || message, perimeter, goal, proof });
}
