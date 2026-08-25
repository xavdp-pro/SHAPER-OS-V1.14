import { CheckCircle2, Loader2, Link2 } from 'lucide-react';

export default function StatusBar({ status, polling, compact }) {
  const ready = status?.ready;
  const reachable = status?.reachable;

  const label = !reachable
    ? `${status?.node || 'CLI'} injoignable`
    : ready
      ? `${status.node} · :${status.port || 4200}`
      : `CLI non prêt`;

  const Icon = !reachable ? Link2 : ready ? CheckCircle2 : polling ? Loader2 : Link2;
  const iconClass = !reachable
    ? 'text-red-400'
    : ready
      ? 'text-emerald-400'
      : polling
        ? 'text-slate-400 animate-spin'
        : 'text-amber-400';

  if (compact) {
    return (
      <div className="px-3 sm:px-4 py-1.5 text-[11px] text-slate-500 flex items-center gap-2 border-b border-white/5">
        <Icon size={12} className={iconClass} />
        <span className="truncate">{label}</span>
        {ready && status.model && (
          <span className="text-slate-600 truncate hidden sm:inline">· {status.model}</span>
        )}
      </div>
    );
  }

  return (
    <div className="mx-4 mt-4 rounded-xl border border-white/10 bg-white/[0.025] px-4 py-3 text-sm text-slate-400 flex items-center gap-3">
      <Icon size={16} className={iconClass} />
      <span>{label}</span>
    </div>
  );
}
