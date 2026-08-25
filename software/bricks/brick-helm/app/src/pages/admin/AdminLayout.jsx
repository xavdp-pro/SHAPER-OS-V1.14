import { NavLink, Outlet, Link } from 'react-router-dom';
import { ArrowLeft, AudioLines, Bot, Mic2, ScrollText, Shield, Terminal, Users, Activity, Layers } from 'lucide-react';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useLocale } from '../../context/LocaleContext.jsx';

const TABS = [
  { to: '/admin/maestro', label: 'Maestro Cadences', icon: Activity, end: true },
  { to: '/admin/socle', label: 'Santé du Socle', icon: Layers, end: true },
  { to: '/admin/users', label: 'Utilisateurs', icon: Users, end: false },
  { to: '/admin/voices', label: 'Voix & Audio', icon: Mic2, end: true },
  { to: '/admin/agent', label: 'Agent & Plugins', icon: Bot, end: true },
  { to: '/admin/cli', label: 'Bridge & Modèles', icon: Terminal, end: true },
];

export default function AdminLayout({ allowedTabPaths = null }) {
  const { appName } = useSettings();
  const { t } = useLocale();

  const limited = Array.isArray(allowedTabPaths) && allowedTabPaths.length > 0;
  const tabs = limited
    ? TABS.filter((tab) => allowedTabPaths.includes(tab.to))
    : TABS;

  const headerBadge = limited && allowedTabPaths.length === 1 && allowedTabPaths[0] === '/admin/voices'
    ? t('admin.demoVoices.badge')
    : limited
      ? t('admin.demoProfile.badge')
      : t('admin.badge');
  const headerTitle = limited && allowedTabPaths.length === 1 && allowedTabPaths[0] === '/admin/voices'
    ? t('admin.demoVoices.title')
    : limited
      ? t('admin.demoProfile.title')
      : t('admin.title');
  const headerSubtitle = limited && allowedTabPaths.length === 1 && allowedTabPaths[0] === '/admin/voices'
    ? t('admin.demoVoices.subtitle')
    : limited
      ? t('admin.demoProfile.subtitle')
      : t('admin.subtitle');

  return (
    <div className="h-full overflow-y-auto theme-scrollbar">
      <div className="max-w-5xl mx-auto px-3 py-4 sm:px-6 sm:py-6 space-y-5">
        <header className="flex flex-wrap items-center gap-3 justify-between">
          <div className="min-w-0">
            <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">
              {appName} · {headerBadge}
            </p>
            <h1 className="text-xl font-semibold text-white flex items-center gap-2">
              <Shield size={20} className="text-brand-400" />
              {headerTitle}
            </h1>
            <p className="text-xs text-slate-500 mt-1">
              {headerSubtitle}
            </p>
          </div>
          <Link to="/console" className="btn-secondary text-xs py-2 px-3">
            <ArrowLeft size={14} />
            {t('nav.console')}
          </Link>
        </header>

        <nav
          className="flex flex-wrap gap-1 p-1 rounded-xl border border-white/10 bg-black/30"
          aria-label={t('admin.navAria')}
        >
          {tabs.map(({ to, labelKey, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) => (
                `inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition ${
                  isActive
                    ? 'bg-brand-600/30 text-white border border-brand-500/40'
                    : 'text-slate-400 hover:text-white hover:bg-white/5 border border-transparent'
                }`
              )}
            >
              <Icon size={14} />
              {labelKey ? t(labelKey) : label}
            </NavLink>
          ))}
        </nav>

        <Outlet />
      </div>
    </div>
  );
}
