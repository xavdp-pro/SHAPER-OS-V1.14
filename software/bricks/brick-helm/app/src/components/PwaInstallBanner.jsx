import { Download, Share, X } from 'lucide-react';
import { useLocale } from '../context/LocaleContext.jsx';
import { usePwaInstall } from '../hooks/usePwaInstall.js';

/**
 * Android: native install prompt (beforeinstallprompt).
 * iOS: short “Add to Home Screen” hint (no programmatic install).
 */
export default function PwaInstallBanner({ className = '' }) {
  const { t } = useLocale();
  const {
    showAndroidBanner,
    showIOSHint,
    install,
    dismiss,
  } = usePwaInstall();

  if (!showAndroidBanner && !showIOSHint) return null;

  if (showIOSHint) {
    return (
      <div
        className={`flex items-start gap-3 rounded-2xl border border-sky-500/25 bg-sky-500/10 px-4 py-3 text-sm text-slate-200 ${className}`}
        role="status"
      >
        <Share className="mt-0.5 h-5 w-5 shrink-0 text-sky-400" aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <p className="font-medium text-sky-100">{t('pwa.iosTitle')}</p>
          <p className="text-slate-300 text-xs leading-relaxed">{t('pwa.iosHint')}</p>
        </div>
        <button
          type="button"
          onClick={dismiss}
          className="shrink-0 rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-slate-200"
          aria-label={t('pwa.dismiss')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={`flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-slate-200 ${className}`}
      role="status"
    >
      <Download className="h-5 w-5 shrink-0 text-emerald-400" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-emerald-100">{t('pwa.androidTitle')}</p>
        <p className="text-xs text-slate-300">{t('pwa.androidHint')}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={() => { void install(); }}
          className="rounded-xl bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-emerald-400"
        >
          {t('pwa.install')}
        </button>
        <button
          type="button"
          onClick={dismiss}
          className="rounded-lg p-1 text-slate-400 hover:bg-white/5 hover:text-slate-200"
          aria-label={t('pwa.dismiss')}
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
