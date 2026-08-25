export default function TypingIndicator({ label = 'Agent en cours' }) {
  return (
    <div className="typing-indicator" role="status" aria-live="polite">
      <span className="typing-indicator-dots" aria-hidden>
        <span />
        <span />
        <span />
      </span>
      <span className="text-sm text-slate-400">{label}</span>
    </div>
  );
}
