import { useEffect, useRef } from 'react';

/**
 * Karaoke highlight inside the agent reply bubble.
 */
export default function InlineKaraokeText({
  words = [],
  activeIndex = -1,
  className = '',
}) {
  const activeRef = useRef(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView?.({
      behavior: 'smooth',
      block: 'nearest',
      inline: 'nearest',
    });
  }, [activeIndex]);

  if (!words.length) return null;

  return (
    <p className={`whitespace-pre-wrap break-words leading-relaxed ${className}`.trim()}>
      {words.map((item, i) => {
        const active = i === activeIndex;
        const spoken = i < activeIndex;
        return (
          <span key={`${i}-${item.word}`}>
            <span
              ref={active ? activeRef : undefined}
              className={`inline transition-colors duration-100 ${
                active
                  ? 'text-white font-semibold bg-emerald-400/35 rounded px-0.5 shadow-[0_0_12px_rgba(52,211,153,0.35)]'
                  : spoken
                    ? 'text-emerald-100/55'
                    : 'text-emerald-50/90'
              }`}
            >
              {item.word}
            </span>
            {i < words.length - 1 ? ' ' : ''}
          </span>
        );
      })}
    </p>
  );
}
