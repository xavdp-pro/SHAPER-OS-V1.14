import { Brain, ScrollText, Terminal, Wrench } from 'lucide-react';
import { FILTER_LABELS } from '../lib/viewFilters.js';

const ITEMS = [
  { key: 'thinking', Icon: Brain, activeClass: 'text-violet-400 bg-violet-500/15 border-violet-500/30' },
  { key: 'tools', Icon: Wrench, activeClass: 'text-amber-400 bg-amber-500/15 border-amber-500/30' },
  { key: 'terminal', Icon: Terminal, activeClass: 'text-emerald-400 bg-emerald-500/15 border-emerald-500/30' },
  { key: 'logs', Icon: ScrollText, activeClass: 'text-slate-300 bg-white/10 border-white/20' },
];

export default function ViewFilterBar({ filters, onToggle }) {
  return (
    <div className="flex items-center gap-1 shrink-0" role="group" aria-label="Filtres d'affichage">
      {ITEMS.map(({ key, Icon, activeClass }) => {
        const on = filters[key];
        return (
          <button
            key={key}
            type="button"
            onClick={() => onToggle(key)}
            className={`btn-icon border rounded-lg px-2 py-1.5 transition ${
              on ? activeClass : 'text-slate-600 opacity-45 border-transparent hover:opacity-70'
            }`}
            title={`${FILTER_LABELS[key]} — ${on ? 'masquer' : 'afficher'}`}
            aria-label={`${FILTER_LABELS[key]} ${on ? 'visible' : 'masqué'}`}
            aria-pressed={on}
          >
            <Icon size={15} />
          </button>
        );
      })}
    </div>
  );
}
