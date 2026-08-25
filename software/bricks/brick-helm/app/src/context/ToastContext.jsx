import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { playToastSound } from '../lib/voicePlaybackPipeline.js';

const ToastContext = createContext(null);

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef(new Map());

  const dismissToast = useCallback((id) => {
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * @param {object} [opts]
   * @param {boolean|'success'|'error'|'info'|'mic'} [opts.sound] `false` to stay
   *   silent, or a sound name to override the one derived from `type`.
   */
  const pushToast = useCallback((message, { type = 'info', duration = 5000, sound } = {}) => {
    if (sound !== false) {
      try { playToastSound(typeof sound === 'string' ? sound : type); } catch { /* never block the toast */ }
    }
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type }]);
    const timer = setTimeout(() => {
      timersRef.current.delete(id);
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, duration);
    timersRef.current.set(id, timer);
  }, []);

  const value = useMemo(() => ({ pushToast, dismissToast }), [pushToast, dismissToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        className="fixed top-3 right-3 sm:top-4 sm:right-4 z-[60] flex flex-col gap-2 max-w-sm pointer-events-none"
        aria-live="polite"
      >
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismissToast(t.id)}
            title="Cliquer pour fermer"
            className={`pointer-events-auto text-left glass rounded-xl px-4 py-3 text-sm shadow-xl border cursor-pointer transition hover:scale-[1.02] hover:brightness-110 active:scale-[0.98] ${
              t.type === 'error'
                ? 'border-red-500/40 text-red-200 hover:bg-red-950/30'
                : t.type === 'success'
                  ? 'border-emerald-500/40 text-emerald-200 hover:bg-emerald-950/30'
                  : 'border-white/15 text-slate-200 hover:bg-white/10'
            }`}
          >
            {t.message}
          </button>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
