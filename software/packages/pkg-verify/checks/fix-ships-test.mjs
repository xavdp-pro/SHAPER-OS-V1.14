import { execFileSync } from 'node:child_process';

export const rule = 'Rule 29 — every fixed bug ships its non-regression test';
export const title = 'A fix commit touching code also touches a test';
export const readAt = 'software/RULES.md';

const CODE = /\.(m?js|cjs|sh|py)$/;
const TEST = /(^|\/)test(s)?\/|\.test\.(m?js|cjs)$/;

function git(root, args) {
  // stderr ignored: on a repo with no commits yet, raw locale-dependent git
  // noise between PASS lines reads as a failure to the agent this tool reassures.
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

/**
 * Checks the last 20 commits: a commit whose subject starts with "fix" and
 * which touches code must also touch a test. A fix that lives only in code is
 * a lesson one refactor away from being lost — and was, between v1.7 and v1.8.
 */
export function run(root) {
  const findings = [];
  let log;
  try {
    log = git(root, ['log', '--format=%H %s', '-20']);
  } catch {
    return findings; // not a git repository — nothing to check
  }
  for (const line of log.split('\n').filter(Boolean)) {
    const [hash, ...rest] = line.split(' ');
    const subject = rest.join(' ');
    if (!/^fix[(:!]/i.test(subject)) continue;
    const touched = git(root, ['show', '--name-only', '--format=', hash]).split('\n').filter(Boolean);
    const touchesCode = touched.some((f) => CODE.test(f) && !TEST.test(f));
    const touchesTest = touched.some((f) => TEST.test(f));
    if (touchesCode && !touchesTest) {
      findings.push(`${hash.slice(0, 7)} "${subject.slice(0, 60)}" fixes code with no test beside it`);
    }
  }
  return findings;
}
