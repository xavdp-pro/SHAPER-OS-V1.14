import { useEffect, useRef } from 'react';
import { useLocale } from '../context/LocaleContext.jsx';

/**
 * Karaoke caption: Cartesia = word highlight; Deepgram = current sentence.
 */
export default function VoiceKaraokeCaption({
  words = [],
  activeIndex = -1,
  visible = false,
  grain = 'word',
}) {
  const { t } = useLocale();
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({
      behavior: 'smooth',
      inline: 'center',
      block: 'nearest',
    });
  }, [activeIndex]);

  if (!visible || !words.length) return null;

  return (
    <div
      className="pointer-events-none px-3 pb-2"
      aria-live="polite"
      aria-atomic="false"
    >
      <div className="max-w-3xl mx-auto">
        <div className="rounded-2xl border border-emerald-400/25 bg-black/70 backdrop-blur-md shadow-[0_8px_32px_rgba(0,0,0,0.45)] px-4 py-3 overflow-hidden">
          <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-400/70 mb-1.5 font-semibold">
            {t('chat.tts.caption')}
          </p>
          {grain === 'sentence' ? (
            <p className="text-[15px] sm:text-base leading-snug text-slate-200">
              {words.map((item, i) => {
                const active = i === activeIndex;
                const spoken = i < activeIndex;
                return (
                  <span key={`${i}-${item.word}`}>
                    <span
                      ref={active ? activeRef : undefined}
                      className={`transition-colors duration-150 ${
                        active
                          ? 'text-white font-semibold bg-emerald-500/25 px-1 rounded-md shadow-[0_0_20px_rgba(16,185,129,0.35)]'
                          : spoken
                            ? 'text-slate-500'
                            : 'text-slate-500/70'
                      }`}
                    >
                      {item.word}
                    </span>
                    {i < words.length - 1 ? ' ' : ''}
                  </span>
                );
              })}
            </p>
          ) : (
            <div className="flex flex-wrap gap-x-1.5 gap-y-1 max-h-[4.5rem] overflow-hidden content-end">
              {words.map((item, i) => {
                const active = i === activeIndex;
                const spoken = i < activeIndex;
                return (
                  <span
                    key={`${i}-${item.word}`}
                    ref={active ? activeRef : undefined}
                    className={`inline-block text-[15px] sm:text-base leading-snug transition-all duration-150 ${
                      active
                        ? 'text-white font-semibold scale-110 origin-bottom bg-emerald-500/25 px-1.5 rounded-md shadow-[0_0_20px_rgba(16,185,129,0.35)]'
                        : spoken
                          ? 'text-slate-400'
                          : 'text-slate-500/80'
                    }`}
                  >
                    {item.word}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
