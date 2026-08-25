import { ExternalLink, Loader2, Smartphone } from 'lucide-react';
import { useLocale } from '../context/LocaleContext.jsx';
import { useClaudeNativeAuth } from '../hooks/useClaudeNativeAuth.js';

export default function ClaudeNativeAuthPanel() {
  const { t } = useLocale();
  const {
    status,
    authUrl,
    code,
    setCode,
    busy,
    openLoginTab,
    submitCode,
    cancel,
  } = useClaudeNativeAuth();

  const pending = Boolean(authUrl);

  return (
    <div className="zone-sunk rounded-2xl border border-white/10 p-4 sm:p-5 space-y-4">
      <div>
        <p className="text-sm font-medium text-white flex items-center gap-2">
          <Smartphone size={16} className="text-sky-400" />
          {t('admin.claudeNative.title')}
        </p>
        <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
          {t('admin.claudeNative.hint')}
        </p>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <span
          className={`inline-block h-2 w-2 rounded-full ${
            status.loading ? 'bg-slate-500 animate-pulse' : status.loggedIn ? 'bg-emerald-400' : 'bg-amber-400'
          }`}
        />
        <span className="text-slate-300">
          {status.loading
            ? t('admin.claudeNative.checking')
            : status.loggedIn
              ? t('admin.claudeNative.loggedIn')
              : t('admin.claudeNative.loggedOut')}
        </span>
      </div>

      {!status.loggedIn && !pending && (
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => { void openLoginTab(); }}
          className="btn-primary w-full sm:w-auto text-sm flex items-center justify-center gap-2"
        >
          {busy === 'start' ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
          {t('admin.claudeNative.openLogin')}
        </button>
      )}

      {pending && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submitCode();
          }}
          className="space-y-3"
        >
          <p className="text-xs text-slate-400 leading-relaxed">
            {t('admin.claudeNative.pasteHint')}
          </p>
          {authUrl && (
            <button
              type="button"
              onClick={() => window.open(authUrl, '_blank', 'noopener,noreferrer')}
              className="text-xs text-sky-400 hover:text-sky-300 underline"
            >
              {t('admin.claudeNative.reopenTab')}
            </button>
          )}
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder={t('admin.claudeNative.codePlaceholder')}
            className="input-field font-mono text-sm"
            autoComplete="one-time-code"
            autoFocus
          />
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={!code.trim() || busy === 'complete'}
              className="btn-primary text-sm flex-1 flex items-center justify-center gap-2"
            >
              {busy === 'complete' && <Loader2 size={14} className="animate-spin" />}
              {t('admin.claudeNative.submitCode')}
            </button>
            <button
              type="button"
              onClick={() => { void cancel(); }}
              className="btn-secondary text-sm"
            >
              {t('admin.claudeNative.cancel')}
            </button>
          </div>
        </form>
      )}

      {status.loggedIn && (
        <p className="text-xs text-slate-500">
          {t('admin.claudeNative.afterLogin')}
        </p>
      )}
    </div>
  );
}
