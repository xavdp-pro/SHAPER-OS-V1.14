import { ExternalLink, Loader2, Smartphone, X } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLocale } from '../context/LocaleContext.jsx';
import { useClaudeNativeAuth } from '../hooks/useClaudeNativeAuth.js';
import { fetchClaudeRemoteStatus, startClaudeRemote } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';

const SESSION_NAME_KEY = 'helm-claude-rc-session-name';
const DEFAULT_SESSION_NAME = 'KovZu — helm-v2';

function readStoredSessionName() {
  try {
    const v = localStorage.getItem(SESSION_NAME_KEY);
    return v?.trim() || DEFAULT_SESSION_NAME;
  } catch {
    return DEFAULT_SESSION_NAME;
  }
}

function StepDots({ step }) {
  return (
    <div className="flex items-center justify-center gap-2" aria-hidden>
      {[1, 2, 3, 4].map((n) => (
        <span
          key={n}
          className={`h-1.5 rounded-full transition-all ${
            n === step ? 'w-6 bg-sky-400' : n < step ? 'w-1.5 bg-emerald-500' : 'w-1.5 bg-slate-600'
          }`}
        />
      ))}
    </div>
  );
}

export default function ClaudeNativeModal({ open, onClose }) {
  const { t } = useLocale();
  const { pushToast } = useToast();
  const {
    status,
    step,
    setStep,
    authUrl,
    code,
    setCode,
    busy,
    refresh,
    resetFlow,
    openLoginTab,
    submitCode,
    cancel,
  } = useClaudeNativeAuth({ autoRefresh: open });

  const [remote, setRemote] = useState({ running: false, sessionName: '', url: '' });
  const [sessionName, setSessionName] = useState(readStoredSessionName);
  const [launching, setLaunching] = useState(false);

  const refreshRemote = useCallback(async () => {
    const { ok, data } = await fetchClaudeRemoteStatus();
    if (ok) {
      setRemote({
        running: Boolean(data?.running),
        sessionName: data?.sessionName || '',
        url: data?.url || 'https://claude.ai/code',
      });
      if (data?.sessionName) setSessionName(data.sessionName);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    void refresh();
    void refreshRemote();
    return undefined;
  }, [open, refresh, refreshRemote]);

  const handleClose = () => {
    if (step === 2) void cancel();
    else resetFlow();
    onClose();
  };

  const handleLaunch = async () => {
    const name = sessionName.trim() || DEFAULT_SESSION_NAME;
    setLaunching(true);
    try {
      localStorage.setItem(SESSION_NAME_KEY, name);
    } catch { /* ignore */ }
    const { ok, data } = await startClaudeRemote('sonnet', name);
    setLaunching(false);
    if (!ok) {
      pushToast(data?.error || t('nav.claudeModal.launchError'), { type: 'error' });
      return;
    }
    setRemote({
      running: true,
      sessionName: data?.sessionName || name,
      url: data?.url || 'https://claude.ai/code',
    });
    setStep(4);
    pushToast(t('nav.claudeModal.launched'), { type: 'success' });
  };

  if (!open) return null;

  const sessionLabel = remote.sessionName || sessionName.trim() || DEFAULT_SESSION_NAME;
  const launchLabel = t('nav.claudeModal.launchSession').replace('{name}', sessionName.trim() || DEFAULT_SESSION_NAME);
  const findInAppLabel = t('nav.claudeModal.findInApp').replace('{name}', sessionLabel);

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-black/70"
        aria-label={t('admin.claudeNative.cancel')}
        onClick={handleClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="claude-native-title"
        className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-2xl border border-white/10 bg-[#0f172a] shadow-2xl p-5 sm:p-6 space-y-5 max-h-[90dvh] overflow-y-auto"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p id="claude-native-title" className="text-base font-semibold text-white flex items-center gap-2">
              <Smartphone size={18} className="text-sky-400 shrink-0" />
              {t('nav.claudeModal.title')}
            </p>
            <p className="text-xs text-slate-500 mt-1 leading-relaxed">
              {t('nav.claudeModal.subtitle')}
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10 shrink-0"
            aria-label={t('admin.claudeNative.cancel')}
          >
            <X size={18} />
          </button>
        </div>

        <StepDots step={step} />

        <div className="flex items-center gap-2 text-sm">
          <span
            className={`inline-block h-2 w-2 rounded-full shrink-0 ${
              status.loading ? 'bg-slate-500 animate-pulse' : status.loggedIn ? 'bg-emerald-400' : 'bg-amber-400'
            }`}
          />
          <span className="text-slate-300">
            {status.loading
              ? t('admin.claudeNative.checking')
              : status.loggedIn
                ? `${t('admin.claudeNative.loggedIn')}${status.email ? ` (${status.email})` : ''}`
                : t('admin.claudeNative.loggedOut')}
          </span>
        </div>

        {step === 1 && !status.loggedIn && (
          <div className="space-y-4">
            <ol className="text-xs text-slate-400 space-y-2 list-decimal list-inside leading-relaxed">
              <li>{t('nav.claudeModal.step1')}</li>
              <li>{t('nav.claudeModal.step2')}</li>
              <li>{t('nav.claudeModal.step3')}</li>
            </ol>
            <button
              type="button"
              disabled={Boolean(busy) || status.loading}
              onClick={() => { void openLoginTab(); }}
              className="btn-primary w-full text-sm flex items-center justify-center gap-2"
            >
              {busy === 'start' ? <Loader2 size={16} className="animate-spin" /> : <ExternalLink size={16} />}
              {t('admin.claudeNative.openLogin')}
            </button>
          </div>
        )}

        {step === 2 && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitCode().then((ok) => { if (ok) setStep(3); });
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
                onClick={() => { void cancel(); setStep(1); }}
                className="btn-secondary text-sm"
              >
                {t('admin.claudeNative.cancel')}
              </button>
            </div>
          </form>
        )}

        {(step === 3 || (status.loggedIn && step < 4 && !remote.running)) && status.loggedIn && (
          <div className="space-y-4">
            <p className="text-sm text-emerald-200/90">{t('nav.claudeModal.loginDone')}</p>
            <p className="text-xs text-slate-400 leading-relaxed">
              {t('nav.claudeModal.loginNotSession')}
            </p>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-slate-300">{t('nav.claudeModal.sessionNameLabel')}</span>
              <input
                type="text"
                value={sessionName}
                onChange={(e) => setSessionName(e.target.value)}
                placeholder={t('nav.claudeModal.sessionNamePlaceholder')}
                maxLength={80}
                className="input-field text-sm"
                autoComplete="off"
              />
              <span className="text-[11px] text-slate-500">{t('nav.claudeModal.sessionNameHint')}</span>
            </label>
            <button
              type="button"
              disabled={launching || !sessionName.trim()}
              onClick={() => { void handleLaunch(); }}
              className="btn-primary w-full text-sm flex items-center justify-center gap-2"
            >
              {launching ? <Loader2 size={16} className="animate-spin" /> : <Smartphone size={16} />}
              {launchLabel}
            </button>
          </div>
        )}

        {(step === 4 || remote.running) && (
          <div className="space-y-4 rounded-xl border border-sky-500/30 bg-sky-500/10 p-4">
            <p className="text-xs uppercase tracking-wide text-sky-300/80">{t('nav.claudeModal.yourSession')}</p>
            <p className="text-lg font-semibold text-white">{sessionLabel}</p>
            <p className="text-xs text-slate-300 leading-relaxed">
              {findInAppLabel}
            </p>
            <a
              href={remote.url || 'https://claude.ai/code'}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-primary w-full text-sm flex items-center justify-center gap-2"
            >
              <ExternalLink size={16} />
              {t('nav.claudeModal.openSession')}
            </a>
          </div>
        )}

        {status.loggedIn && step === 1 && (
          <button
            type="button"
            onClick={() => setStep(remote.running ? 4 : 3)}
            className="btn-secondary w-full text-sm"
          >
            {t('nav.claudeModal.continue')}
          </button>
        )}
      </div>
    </div>
  );
}
