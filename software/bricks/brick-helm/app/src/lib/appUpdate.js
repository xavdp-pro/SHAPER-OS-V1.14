/**
 * Client-side detection of new deployments.
 *
 * helm-v2 is served via `vite preview`: once the app is loaded, the tab (or PWA)
 * keeps its bundle in memory indefinitely. Running `npm run deploy` therefore
 * changes nothing for open clients until they manually reload.
 *
 * We probe `index.html` (served with `no-store`) and compare the bundle hash
 * `assets/index-XXXX.js` with the one loaded on startup. If it differs, a new
 * build is live.
 *
 * The service worker is `selfDestroying` and precaches nothing: there is no cache
 * to clear, a simple `location.reload()` is sufficient.
 */

const POLL_MS = 60_000;
const BUNDLE_RE = /assets\/index-[A-Za-z0-9_-]+\.js/;

/** Hash of the bundle currently executed by this tab. */
function currentBundle() {
  // import.meta.url points to the current module, hence the active bundle.
  const own = String(import.meta.url || '').match(BUNDLE_RE);
  if (own) return own[0];
  const tag = document.querySelector('script[type="module"][src*="assets/index-"]');
  const fromTag = String(tag?.getAttribute('src') || '').match(BUNDLE_RE);
  return fromTag ? fromTag[0] : '';
}

/** Hash of the bundle currently served by the server. */
async function deployedBundle(signal) {
  const res = await fetch(`/?_=${Date.now()}`, {
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  });
  if (!res.ok) return '';
  const html = await res.text();
  const m = html.match(BUNDLE_RE);
  return m ? m[0] : '';
}

/**
 * Starts deployment watching. `onUpdate(reload)` is called once when a new build
 * is detected; the caller decides *when* to reload (e.g. not during an ongoing voice turn).
 *
 * @param {(reload: () => void) => void} onUpdate
 * @returns {() => void} stop watching callback
 */
export function watchForUpdate(onUpdate) {
  const mine = currentBundle();
  // No exploitable hash (dev/HMR) → nothing to watch.
  if (!mine) return () => {};

  let stopped = false;
  let notified = false;
  let timer = 0;
  const ac = new AbortController();

  const check = async () => {
    if (stopped || notified || document.hidden) return;
    try {
      const live = await deployedBundle(ac.signal);
      if (!live || live === mine || stopped || notified) return;
      notified = true;
      onUpdate(() => window.location.reload());
    } catch {
      /* network down / server restarting: will retry later */
    }
  };

  timer = window.setInterval(check, POLL_MS);
  // Returning to the foreground is the ideal time to detect a new deployment.
  const onVisible = () => { if (!document.hidden) void check(); };
  document.addEventListener('visibilitychange', onVisible);

  return () => {
    stopped = true;
    window.clearInterval(timer);
    document.removeEventListener('visibilitychange', onVisible);
    ac.abort();
  };
}
