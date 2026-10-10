// Intent: software/runtime/unit-mariadb/INTENT.md
/**
 * Process lifecycle for the unit's two processes: the coordinated stop is one
 * function, so the order — the application drains, then MariaDB shuts down —
 * is written once and tested once.
 */

const sleep = (ms) => new Promise((resolve) => { const t = setTimeout(resolve, ms); t.unref?.(); });

/**
 * Gives a ChildProcess (or a test double with the same events) an `alive`
 * flag and an `exited` promise resolving to { code, signal }.
 */
export function track(child) {
  child.alive = true;
  child.exited = new Promise((resolve) => {
    child.once('exit', (code, signal) => {
      child.alive = false;
      resolve({ code, signal });
    });
    // A command that could not be started never emits 'exit'.
    child.once('error', () => {
      if (child.pid === undefined && child.alive) {
        child.alive = false;
        resolve({ code: 127, signal: null });
      }
    });
  });
  return child;
}

/**
 * SIGTERM, then wait up to `seconds`; SIGKILL when the process outlives it.
 * @returns {Promise<{ graceful: boolean, code: number|null, signal: string|null }>}
 */
export async function terminate(child, seconds) {
  if (!child || !child.alive) {
    const done = child ? await child.exited : { code: null, signal: null };
    return { graceful: true, ...done };
  }
  child.kill('SIGTERM');
  const graceful = await Promise.race([child.exited.then(() => true), sleep(seconds * 1000).then(() => false)]);
  if (!graceful) child.kill('SIGKILL');
  const result = await child.exited;
  return { graceful, ...result };
}

/**
 * The coordinated stop (Rule 26): the application first, given its drain
 * time to finish what it holds; MariaDB only once the application is gone.
 *
 * @returns {Promise<{ drained: boolean, clean: boolean, app: object|null, engine: object|null }>}
 */
export async function stopInOrder({ app, engine, drainSeconds, engineStopSeconds, log = () => {} }) {
  let appResult = null;
  if (app) {
    appResult = await terminate(app, drainSeconds);
    log(appResult.graceful
      ? `application: stopped (${appResult.signal || `exit ${appResult.code}`})`
      : `application: still running after ${drainSeconds}s of drain — killed`);
  }
  let engineResult = null;
  if (engine) {
    engineResult = await terminate(engine, engineStopSeconds);
    log(engineResult.graceful
      ? `engine: stopped (${engineResult.signal || `exit ${engineResult.code}`})`
      : `engine: no clean shutdown within ${engineStopSeconds}s — killed; InnoDB recovers at next start`);
  }
  const clean = !engineResult || (engineResult.graceful && (engineResult.code === 0 || engineResult.signal === 'SIGTERM'));
  return { drained: !appResult || appResult.graceful, clean, app: appResult, engine: engineResult };
}
