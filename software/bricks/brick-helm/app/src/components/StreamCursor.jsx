/** Inline cursor in ChatGPT / IDE style. */
export default function StreamCursor({ variant = 'emerald', active = true }) {
  return (
    <span
      className={`stream-cursor stream-cursor-${variant} ${active ? 'stream-cursor-active' : ''}`}
      aria-hidden
    />
  );
}
