import { useEffect, useRef } from 'react';

/**
 * Keep the screen awake while KovZu is actively used (voice, playback, presentation).
 * Uses the Screen Wake Lock API — supported on most mobile browsers when the tab is visible.
 */
export function useWakeLock(enabled) {
  const lockRef = useRef(null);

  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !('wakeLock' in navigator)) {
      return undefined;
    }

    let cancelled = false;

    const release = async () => {
      try {
        await lockRef.current?.release();
      } catch { /* ignore */ }
      lockRef.current = null;
    };

    const acquire = async () => {
      if (cancelled || document.visibilityState !== 'visible') return;
      if (lockRef.current) return;
      try {
        lockRef.current = await navigator.wakeLock.request('screen');
        lockRef.current.addEventListener('release', () => {
          lockRef.current = null;
        });
      } catch {
        // Permission denied or low battery — silent fallback
      }
    };

    void acquire();

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void acquire();
      else void release();
    };

    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisibility);
      void release();
    };
  }, [enabled]);
}
