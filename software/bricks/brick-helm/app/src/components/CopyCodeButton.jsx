import { useState } from 'react';
import { Check, Copy } from 'lucide-react';

/** Copies text to clipboard. */
export default function CopyCodeButton({ text, label = 'Copier', className = '', iconOnly = false }) {
  const [copied, setCopied] = useState(false);
  const content = String(text ?? '');

  const handleCopy = async (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <button
      type="button"
      onClick={handleCopy}
      disabled={!content}
      className={`inline-flex items-center justify-center gap-1 rounded-md text-[10px] font-medium transition shrink-0 ${
        iconOnly ? 'p-1.5' : 'px-2 py-0.5'
      } ${
        copied
          ? 'text-emerald-400 bg-emerald-500/15'
          : 'text-slate-400 hover:text-slate-200 hover:bg-white/10'
      } disabled:opacity-30 disabled:cursor-not-allowed ${className}`.trim()}
      title={copied ? 'Copié' : label}
      aria-label={copied ? 'Copié' : label}
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
      {!iconOnly && (
        <span className="hidden sm:inline">{copied ? 'Copié' : 'Copier'}</span>
      )}
    </button>
  );
}
