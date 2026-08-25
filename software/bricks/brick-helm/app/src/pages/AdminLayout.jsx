import { NavLink, Outlet, Link } from 'react-router-dom';
import { ArrowLeft, Bot, Mic2, Shield, Users } from 'lucide-react';

const TABS = [
  {
    to: '/admin/agent',
    label: 'Agent',
    hint: 'Nom affiché',
    icon: Bot,
  },
  {
    to: '/admin/voices',
    label: 'Voix',
    hint: 'ElevenLabs FR / ES / EN',
    icon: Mic2,
  },
  {
    to: '/admin/users',
    label: 'Utilisateurs',
    hint: 'Comptes MariaDB',
    icon: Users,
  },
];

export default function AdminLayout() {
  return (
    <div className="h-full overflow-y-auto theme-scrollbar">
      <div className="max-w-5xl mx-auto px-3 py-4 sm:px-6 sm:py-6 space-y-5">
        <header className="flex flex-wrap items-start gap-3 justify-between">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">KovZu · Admin</p>
            <h1 className="text-xl font-semibold text-white flex items-center gap-2">
              <Shield size={20} className="text-brand-400" />
              Administration
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              Onglets bookmarkables — agent, voix, utilisateurs.
            </p>
          </div>
          <Link to="/console" className="btn-secondary text-xs py-2 px-3 shrink-0">
            <ArrowLeft size={14} />
            Console
          </Link>
        </header>

        <nav
          className="flex flex-wrap gap-1 p-1 rounded-xl border border-white/10 bg-black/30"
          aria-label="Sections administration"
        >
          {TABS.map(({ to, label, hint, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              className={({ isActive }) => (
                `flex-1 min-w-[7.5rem] flex items-center gap-2 px-3 py-2.5 rounded-lg text-left transition ${
                  isActive
                    ? 'bg-brand-600/25 border border-brand-500/40 text-white shadow-sm'
                    : 'border border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200'
                }`
              )}
            >
              <Icon size={15} className="shrink-0 opacity-80" />
              <span className="min-w-0">
                <span className="block text-xs font-semibold leading-tight">{label}</span>
                <span className="block text-[10px] text-slate-500 truncate leading-tight mt-0.5">
                  {hint}
                </span>
              </span>
            </NavLink>
          ))}
        </nav>

        <Outlet />
      </div>
    </div>
  );
}
