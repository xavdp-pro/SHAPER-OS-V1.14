import { Sparkles } from 'lucide-react';
import { useLocale } from '../context/LocaleContext.jsx';

const EXAMPLE_KEYS = [
  'welcome.example1',
  'welcome.example2',
  'welcome.example3',
  'welcome.example4',
];

export default function WelcomeEmpty({ onPickExample }) {
  const { t } = useLocale();

  return (
    <div className="flex flex-col items-center justify-center min-h-[min(50vh,24rem)] px-4 py-10 text-center">
      <div className="inline-flex items-center justify-center w-12 h-12 rounded-2xl bg-brand-600/20 text-brand-300 mb-4">
        <Sparkles size={22} aria-hidden />
      </div>
      <h2 className="text-lg font-semibold text-white mb-2">{t('welcome.title')}</h2>
      <p className="text-sm text-slate-400 max-w-md mb-6">{t('welcome.subtitle')}</p>
      <div className="flex flex-wrap justify-center gap-2 max-w-lg">
        {EXAMPLE_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => onPickExample?.(t(key))}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-200 hover:bg-brand-600/20 hover:border-brand-500/30 hover:text-white transition text-left"
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}
