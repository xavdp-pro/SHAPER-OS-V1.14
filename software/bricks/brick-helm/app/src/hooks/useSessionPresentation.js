import { useCallback, useRef } from 'react';
import {
  clearConversationSession,
  primeCliSession,
  setActiveConversation,
} from '../api/client.js';
import {
  SESSION_SAVE_GUARD_MS,
  SESSION_STALE_SSE_GUARD_MS,
  mergeTimelineOnLoad,
  shouldPrimeSession,
  timelineItemsFromSessionResponse,
} from '../lib/sessionPresentation.js';

/**
 * Session lifecycle for operator briefing / clear — plugin-agnostic via server orchestrator.
 * @param {object} opts
 * @param {import('react').MutableRefObject<Record<string, unknown[]>>} opts.timelinesRef
 * @param {import('react').Dispatch<import('react').SetStateAction<Record<string, unknown[]>>>} opts.setTimelines
 * @param {import('react').MutableRefObject<Record<string, string>>} opts.timelineUpdatedAtRef
 * @param {Function} opts.applyServerTimeline
 * @param {Function} opts.persistTimeline
 * @param {import('react').MutableRefObject<number>} opts.saveEpochRef
 * @param {import('react').MutableRefObject<number>} opts.suppressSaveUntilRef
 * @param {import('react').MutableRefObject<number>} opts.suppressStreamUntilRef
 * @param {Function} opts.pushToast
 * @param {Function} [opts.t] locale translator
 */
export function useSessionPresentation({
  timelinesRef,
  setTimelines,
  timelineUpdatedAtRef,
  applyServerTimeline,
  persistTimeline,
  saveEpochRef,
  suppressSaveUntilRef,
  suppressStreamUntilRef,
  pushToast,
  t = (k) => k,
}) {
  const primedPathsRef = useRef(new Set());
  const primingPathsRef = useRef(new Set());
  const clearingRef = useRef(false);

  const armSaveGuard = useCallback(() => {
    suppressSaveUntilRef.current = Date.now() + SESSION_SAVE_GUARD_MS;
  }, [suppressSaveUntilRef]);

  /** Block stale SSE briefly after wipe — never during an active prime (needs stream). */
  const armStaleSseGuard = useCallback(() => {
    suppressStreamUntilRef.current = Date.now() + SESSION_STALE_SSE_GUARD_MS;
  }, [suppressStreamUntilRef]);

  const applyOrchestratedTimeline = useCallback((path, payload) => {
    const items = timelineItemsFromSessionResponse(payload);
    if (payload?.updated_at) timelineUpdatedAtRef.current[path] = payload.updated_at;
    applyServerTimeline(path, items, payload?.updated_at || null, { replace: true });
    return items;
  }, [applyServerTimeline, timelineUpdatedAtRef]);

  const primeSession = useCallback(async (path) => {
    if (!path || primingPathsRef.current.has(path)) return { ok: false };
    primingPathsRef.current.add(path);
    armSaveGuard();
    setActiveConversation(path);

    const res = await primeCliSession();
    primingPathsRef.current.delete(path);

    if (res.ok) {
      primedPathsRef.current.add(path);
      if (res.data?.timeline) {
        applyOrchestratedTimeline(path, res.data.timeline);
      }
    } else {
      primedPathsRef.current.delete(path);
      setTimelines((prev) => {
        const items = (prev[path] || []).filter((item) => !item.prime);
        const next = { ...prev, [path]: items };
        timelinesRef.current = next;
        void persistTimeline(path, items);
        return next;
      });
    }
    return res;
  }, [armSaveGuard, applyOrchestratedTimeline, persistTimeline, setTimelines, timelinesRef]);

  const clearSession = useCallback(async (path) => {
    if (!path || clearingRef.current) return { ok: false };
    clearingRef.current = true;
    primedPathsRef.current.delete(path);
    setActiveConversation(path);
    saveEpochRef.current += 1;
    armSaveGuard();
    armStaleSseGuard();

    const merged = { ...timelinesRef.current, [path]: [] };
    timelinesRef.current = merged;
    setTimelines(merged);

    let res = { ok: false, data: { error: t('clear.failed') } };
    try {
      res = await clearConversationSession();
    } catch (err) {
      res = { ok: false, data: { error: err?.message || t('clear.failed') } };
    } finally {
      clearingRef.current = false;
    }

    if (res.ok) {
      if (res.data?.timeline) {
        const items = applyOrchestratedTimeline(path, res.data.timeline);
        // Retry when the orchestrated prime did not stick (empty / failed shell).
        if (shouldPrimeSession(items)) {
          primedPathsRef.current.delete(path);
          void primeSession(path);
        } else {
          primedPathsRef.current.add(path);
        }
      } else {
        primedPathsRef.current.delete(path);
        void primeSession(path);
      }
      pushToast(t('clear.success'), { type: 'success' });
    } else {
      primedPathsRef.current.delete(path);
      pushToast(res.data?.error || t('clear.failed'), { type: 'error', duration: 8000 });
    }
    return res;
  }, [
    armSaveGuard,
    armStaleSseGuard,
    applyOrchestratedTimeline,
    primeSession,
    pushToast,
    saveEpochRef,
    setTimelines,
    timelinesRef,
    t,
  ]);

  const maybePrimeEmpty = useCallback((path, items) => {
    if (!shouldPrimeSession(items)) {
      primedPathsRef.current.add(path);
      return;
    }
    if (primingPathsRef.current.has(path) || clearingRef.current) return;
    primedPathsRef.current.delete(path);
    void primeSession(path);
  }, [primeSession]);

  const mergeOnSelect = useCallback((local, server, path, activePath) => (
    mergeTimelineOnLoad(local, server, {
      clearing: clearingRef.current,
      path,
      activePath,
    })
  ), []);

  return {
    primedPathsRef,
    primingPathsRef,
    clearingRef,
    primeSession,
    clearSession,
    maybePrimeEmpty,
    mergeOnSelect,
  };
}
