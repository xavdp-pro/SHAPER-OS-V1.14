import { useEffect, useState } from 'react';
import { fetchBootstrap } from '../api/client.js';

let cached = null;
let inflight = null;

async function loadBootstrap() {
  if (cached) return cached;
  if (!inflight) {
    inflight = fetchBootstrap().then(({ ok, data }) => {
      cached = {
        isDemo: Boolean(ok && data?.mode === 'demo'),
        demoLogin: Boolean(ok && data?.demoLogin),
      };
      return cached;
    });
  }
  return inflight;
}

/** Public bootstrap flags (demo vs production) — cached for the SPA session. */
export function useAppBootstrap() {
  const [state, setState] = useState(cached || { isDemo: false, demoLogin: false, loading: true });

  useEffect(() => {
    let alive = true;
    loadBootstrap().then((boot) => {
      if (!alive) return;
      setState({ ...boot, loading: false });
    });
    return () => { alive = false; };
  }, []);

  return state;
}
