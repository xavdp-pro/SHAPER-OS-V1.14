import { useCallback, useEffect, useRef, useState } from 'react';

const PULL_THRESHOLD = 56;
const PULL_MAX = 110;

/**
 * Mobile pull-to-refresh on an overflow scroll container.
 * Native browser PTR is blocked when html/body are overflow:hidden (SPA shell).
 *
 * @param {React.RefObject<HTMLElement|null>} scrollRef
 * @param {{ onRefresh?: () => void, disabled?: boolean }} [opts]
 */
export function usePullToRefresh(scrollRef, { onRefresh, disabled = false } = {}) {
  const [pullPx, setPullPx] = useState(0);
  const [armed, setArmed] = useState(false);
  const [scrollMount, setScrollMount] = useState(null);
  const startYRef = useRef(0);
  const trackingRef = useRef(false);
  const pullPxRef = useRef(0);
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  /** Callback ref — re-bind listeners when the scroll node mounts (mobile layout). */
  const bindScrollRef = useCallback((node) => {
    scrollRef.current = node;
    setScrollMount(node);
  }, [scrollRef]);

  useEffect(() => {
    const el = scrollMount;
    if (!el || disabled) return undefined;

    const setPull = (px) => {
      pullPxRef.current = px;
      setPullPx(px);
      setArmed(px >= PULL_THRESHOLD);
    };

    const atScrollTop = () => (el.scrollTop ?? 0) <= 1;

    const onTouchStart = (e) => {
      if (!atScrollTop()) {
        trackingRef.current = false;
        return;
      }
      trackingRef.current = true;
      startYRef.current = e.touches[0]?.clientY ?? 0;
    };

    const onTouchMove = (e) => {
      if (!trackingRef.current) return;
      if (!atScrollTop()) {
        trackingRef.current = false;
        setPull(0);
        return;
      }
      const y = e.touches[0]?.clientY ?? 0;
      const dy = y - startYRef.current;
      if (dy <= 0) {
        setPull(0);
        return;
      }
      const resisted = Math.min(PULL_MAX, dy * 0.52);
      setPull(resisted);
      if (resisted > 6 && e.cancelable) e.preventDefault();
    };

    const finish = () => {
      if (!trackingRef.current) return;
      trackingRef.current = false;
      const px = pullPxRef.current;
      setPull(0);
      if (px >= PULL_THRESHOLD) {
        const run = onRefreshRef.current;
        if (typeof run === 'function') run();
      }
    };

    el.addEventListener('touchstart', onTouchStart, { passive: true });
    el.addEventListener('touchmove', onTouchMove, { passive: false });
    el.addEventListener('touchend', finish, { passive: true });
    el.addEventListener('touchcancel', finish, { passive: true });

    return () => {
      el.removeEventListener('touchstart', onTouchStart);
      el.removeEventListener('touchmove', onTouchMove);
      el.removeEventListener('touchend', finish);
      el.removeEventListener('touchcancel', finish);
    };
  }, [scrollMount, disabled]);

  return { pullPx, armed, pulling: pullPx > 4, bindScrollRef };
}
