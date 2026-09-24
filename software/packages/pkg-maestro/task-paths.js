/**
 * Where a task's declared files actually live.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * A task schedule declares companion files by relative path — `./ctx-base.md`
 * next to the schedule that names it. Resolving those paths is not obvious,
 * because two universe layouts are both legitimate and they differ by one
 * directory level:
 *
 *   univ-base    <universe>/task-schedule.json  +  <universe>/ctx-base.md
 *   _template    <universe>/tasks/task-schedule.json  +  <universe>/context/…
 *
 * Resolving from a fixed number of levels above the schedule file serves one
 * layout and silently misses the other. That is a real incident: `univ-base`
 * resolved `./ctx-base.md` to the *universes* directory, the read raised
 * ENOENT, and the beat was skipped as `context_unreadable` every 300 seconds —
 * a delivered task that had quietly stopped running, in the container too
 * (`MAESTRO_TASKS_FILE=/data/univ/task-schedule.json` → `/data/ctx-base.md`).
 *
 * So we do not guess a level. We try, in order of decreasing authority:
 * beside the schedule that declared it, then one level up (the `tasks/`
 * layout), then the shaper root. First one that exists wins.
 *
 * Intent: software/packages/pkg-maestro/INTENT.md
 */
import fs from 'node:fs';
import path from 'node:path';

/** The places a relative declaration could reasonably mean, most specific first. */
export function candidatePaths(declared, { scheduleDir, shaperRoot }) {
  return [
    path.resolve(scheduleDir, declared),
    path.resolve(path.dirname(scheduleDir), declared),
    path.resolve(shaperRoot, declared),
  ];
}

/**
 * A context file must exist to be read, so existence selects among candidates.
 * When none exists we return the most specific candidate rather than throwing:
 * one task with a missing file must not stop the maestro from serving the
 * others. `tried` lets the caller say out loud where it looked.
 */
export function resolveContextPath(declared, { scheduleDir, shaperRoot, exists = fs.existsSync } = {}) {
  if (!declared || path.isAbsolute(declared)) return { path: declared, found: declared ? exists(declared) : false, tried: declared ? [declared] : [] };
  const tried = candidatePaths(declared, { scheduleDir, shaperRoot });
  const hit = tried.find(exists);
  return { path: hit ?? tried[0], found: Boolean(hit), tried };
}

/**
 * A checkpoint is written, not read, so it legitimately does not exist yet and
 * existence cannot arbitrate. We resolve it beside the schedule that declared
 * it — the one base that is true in both layouts without inference.
 */
export function resolveCheckpointPath(declared, { scheduleDir } = {}) {
  if (!declared || path.isAbsolute(declared)) return declared;
  return path.resolve(scheduleDir, declared);
}

/**
 * Reads the universe's declared task schedule for the durable store, with
 * every companion path resolved as above. A schedule file that is named but
 * absent or unreadable is a typed refusal, never an empty registry: a Maestro
 * that silently declares nothing looks idle and healthy while its work stops.
 *
 * @param {string} tasksFile - MAESTRO_TASKS_FILE, absolute or relative to the shaper root
 * @param {object} options
 * @param {string} options.shaperRoot
 * @returns {{ tasksPath: string, tasks: object[], warnings: string[] }}
 */
export function loadTaskDeclarations(tasksFile, { shaperRoot, exists = fs.existsSync, readFile = fs.readFileSync } = {}) {
  const tasksPath = path.isAbsolute(tasksFile) ? tasksFile : path.resolve(shaperRoot, tasksFile);
  if (!exists(tasksPath)) {
    throw Object.assign(new Error(`MAESTRO_TASKS_FILE ${tasksPath} does not exist`), { code: 'TASKS_FILE_MISSING' });
  }
  let raw;
  try {
    raw = JSON.parse(readFile(tasksPath, 'utf8'));
  } catch (err) {
    throw Object.assign(new Error(`MAESTRO_TASKS_FILE ${tasksPath} is not readable JSON: ${err.message}`), { code: 'TASKS_FILE_INVALID' });
  }
  const tasks = Array.isArray(raw) ? raw : raw?.tasks;
  if (!Array.isArray(tasks)) {
    throw Object.assign(new Error(`MAESTRO_TASKS_FILE ${tasksPath} holds neither an array nor { "tasks": [...] }`), { code: 'TASKS_FILE_INVALID' });
  }
  const scheduleDir = path.dirname(tasksPath);
  const warnings = [];
  const resolved = tasks.map((task) => {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return task;
    const copy = { ...task };
    if (copy.contextPath) {
      const r = resolveContextPath(copy.contextPath, { scheduleDir, shaperRoot, exists });
      if (!r.found) {
        warnings.push(`Task ${copy.slug}: declared context "${copy.contextPath}" not found — looked in ${r.tried.join(', ')}`);
      }
      copy.contextPath = r.path;
    }
    copy.checkpointPath = resolveCheckpointPath(copy.checkpointPath, { scheduleDir });
    return copy;
  });
  return { tasksPath, tasks: resolved, warnings };
}
