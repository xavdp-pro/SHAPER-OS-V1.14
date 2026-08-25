#!/usr/bin/env node
/**
 * Delegation router — picks the agent, bounds its perimeter, judges its verdict.
 *
 *   node scripts/delegate.mjs <task…> | --all  [--agent agy|cursor] [--effort …] [--dry-run]
 *
 * A task is a file `software/tasks-agy/<task>.md` whose header declares:
 *
 *   perimeter: <path>        directories the agent may touch
 *   goal: <one sentence>     completion criterion, verifiable
 *   agent: agy | cursor      who runs it              (default: agy)
 *   effort: low|medium|high  reasoning depth          (default: medium)
 *
 * ── Why this routing ───────────────────────────────────────────────────────
 * The agents neither cost the same nor are worth the same.
 *   · agy (Gemini)      generous plan, two interchangeable accounts
 *                       → the default lane, all mechanical work.
 *   · cursor (Composer) cheap today, strong at in-context code editing
 *                       → when the task needs editing finesse.
 *   · Claude            a single account, not interchangeable, the scarce one
 *                       → only arbitrates and verifies.
 * Effort is a spending dial: `medium` by default, `high` only where reasoning
 * actually carries the result.
 *
 * ── What this router refuses to do ─────────────────────────────────────────
 * Delegation spreads load; it never launders a restriction placed on the
 * caller. A delegated agent gets a narrower perimeter than the one who sent
 * it — never a wider one.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildTaskFrame, AGY_TOOL_RULES } from '../packages/queue/task-frame.js';
import { interpretAgyVerdict } from '../packages/bridge-agy/agy-verdict.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SOFTWARE = path.resolve(HERE, '..');
const REPO = path.resolve(SOFTWARE, '..');
const TASKS = path.join(SOFTWARE, 'tasks-agy');
const RUNS = path.join(TASKS, '.runs');
const JOURNAL = path.join(RUNS, 'journal.jsonl');

const args = process.argv.slice(2);
const flag = (n, d) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : d; };
const has = (n) => args.includes(`--${n}`);

const EFFORTS = ['low', 'medium', 'high'];

/** The runners. Each knows how to build its command line and read its verdict. */
const AGENTS = {
  agy: {
    bin: () => process.env.AGY_BIN || path.join(process.env.HOME || '', '.local/bin/agy'),
    // The prompt must follow `--print` immediately, or the CLI mistakes the next
    // flag for the prompt. The model name also encodes the reasoning level, and
    // the CLI rejects an --effort that contradicts it, so both come from one source.
    argv: ({ prompt, perimeter, effort, timeout, conversation }) => [
      '--print', prompt,
      '--model', `gemini-3.7-flash-${effort}`,
      '--effort', effort,
      '--output-format', 'json',
      '--mode', 'accept-edits',
      '--add-dir', perimeter,
      '--conversation', conversation,
      '--print-timeout', timeout,
      '--dangerously-skip-permissions',
    ],
    // agy reports SUCCESS / ERROR in its JSON. The process exit code stays 0 even
    // when a tool call failed, so it is not a witness worth trusting.
    verdict: interpretAgyVerdict,
  },
  cursor: {
    bin: () => process.env.CURSOR_BIN || 'cursor-agent',
    // Composer 2.5, normal mode: never fast mode — that is a standing instruction.
    argv: ({ prompt, effort }) => [
      '--composer',
      '--model', process.env.CURSOR_MODEL || 'composer-2.5',
      '--mode', 'normal',
      '--prompt', prompt,
      '--format', 'json',
      ...(effort === 'high' ? ['--thinking'] : []),
    ],
    verdict: (raw) => {
      const d = JSON.parse(raw);
      const ok = d.status ? d.status === 'SUCCESS' : !d.error;
      return { ok, status: d.status || (ok ? 'SUCCESS' : 'ERROR'), note: d.error || '', tokens: d.usage?.total_tokens ?? 0 };
    },
  },
};

/** `key: value` header at the top of the file, before the first blank line. */
function parseTask(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const meta = {};
  for (const line of raw.split('\n')) {
    const m = /^([a-z_]+):\s*(.+)$/.exec(line.trim());
    if (m) meta[m[1]] = m[2].trim(); else if (line.trim() === '' && Object.keys(meta).length) break;
  }
  return { meta, body: raw };
}

function plan(name) {
  const file = path.join(TASKS, `${name}.md`);
  if (!fs.existsSync(file)) throw new Error(`unknown task: ${name}`);
  const { meta, body } = parseTask(file);

  const agentName = flag('agent', meta.agent || 'agy');
  const agent = AGENTS[agentName];
  if (!agent) throw new Error(`unknown agent: ${agentName} (known: ${Object.keys(AGENTS).join(', ')})`);

  const effort = flag('effort', meta.effort || 'medium');
  if (!EFFORTS.includes(effort)) throw new Error(`unknown effort: ${effort} (${EFFORTS.join('|')})`);

  const perimeter = path.resolve(REPO, meta.perimeter || '.');
  // The frame comes from the queue package, not from here. A task must arrive
  // under the same contract whether it was sent through this router or enqueued
  // as a job — two doors, one contract.
  const extraRules = agentName === 'agy' ? AGY_TOOL_RULES : [];
  const prompt = buildTaskFrame({
    brief: body,
    perimeter,
    goal: meta.goal || '(undeclared)',
    proof: meta.proof || null,
    extraRules,
  });

  return { name, agentName, agent, effort, perimeter, prompt, goal: meta.goal || '(undeclared)' };
}

function run(p) {
  fs.mkdirSync(RUNS, { recursive: true });
  const outFile = path.join(RUNS, `${p.name}.json`);
  const logFile = path.join(RUNS, `${p.name}.log`);
  const bin = p.agent.bin();

  const argv = p.agent.argv({
    prompt: p.prompt,
    perimeter: p.perimeter,
    effort: p.effort,
    timeout: flag('print-timeout', '90m'),
    conversation: `shaper-${p.name}`,
  });

  const started = Date.now();
  console.log(`▶ ${p.name}  [${p.agentName}/${p.effort}]  ${path.relative(REPO, p.perimeter) || '.'}`);

  const child = spawn(bin, argv, {
    cwd: REPO,
    env: { ...process.env, GEMINI_API_KEY: undefined, GOOGLE_API_KEY: undefined },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.pipe(fs.createWriteStream(outFile));
  child.stderr.pipe(fs.createWriteStream(logFile));

  child.on('error', (e) => {
    console.log(`❌ ${p.name} — ${p.agentName} unreachable: ${e.code === 'ENOENT' ? `binary missing (${bin})` : e.message}`);
    record({ ...p, ok: false, status: 'UNREACHABLE', note: bin, seconds: 0, tokens: 0 });
  });

  child.on('exit', (code) => {
    const seconds = Math.round((Date.now() - started) / 1000);
    // The verdict is read from the agent's own output, not from the process exit
    // code: the two contradict each other regularly.
    let v = { ok: false, status: 'UNREADABLE', note: `exit ${code}`, tokens: 0 };
    try { v = p.agent.verdict(fs.readFileSync(outFile, 'utf8')); } catch (e) { v.note = e.message; }
    const mark = v.ok ? '✅' : '⚠️ ';
    console.log(`${mark} ${p.name} — ${v.status}, ${seconds}s, ${v.tokens.toLocaleString('en-US')} tokens → ${path.relative(REPO, outFile)}`);
    if (!v.ok && v.note) console.log(`   ↳ ${String(v.note).split('\n')[0].slice(0, 200)}`);
    record({ ...p, ...v, seconds });
  });

  return child;
}

/** One JSONL line per run: enough to schedule and to bill without re-reading outputs. */
function record(r) {
  fs.appendFileSync(JOURNAL, JSON.stringify({
    at: new Date().toISOString(),
    task: r.name, agent: r.agentName, effort: r.effort,
    ok: r.ok, status: r.status, seconds: r.seconds, tokens: r.tokens,
    note: r.note ? String(r.note).slice(0, 300) : '',
  }) + '\n');
}

const available = () => fs.existsSync(TASKS)
  ? fs.readdirSync(TASKS).filter(f => f.endsWith('.md')).map(f => f.replace(/\.md$/, ''))
  : [];

const names = has('all') ? available() : args.filter((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (isMain && !names.length) {
  console.error('usage: delegate.mjs <task…> | --all  [--agent agy|cursor] [--effort low|medium|high] [--dry-run]');
  console.error('tasks:', available().join(', ') || '(none)');
  process.exit(2);
}

if (!isMain) {
  // Imported as a module (tests) — skip CLI dispatch.
} else {
  const plans = names.map(plan);
  if (has('dry-run')) {
    console.log('Planned routing — no tokens spent:\n');
    for (const p of plans) {
      console.log(`  ${p.name}`);
      console.log(`    agent      ${p.agentName} (${p.agent.bin()})${fs.existsSync(p.agent.bin()) ? '' : '  ⚠️  binary missing'}`);
      console.log(`    effort     ${p.effort}`);
      console.log(`    perimeter  ${path.relative(REPO, p.perimeter) || '.'}`);
      console.log(`    goal       ${p.goal}\n`);
    }
    process.exit(0);
  }
  plans.forEach(run);
}
