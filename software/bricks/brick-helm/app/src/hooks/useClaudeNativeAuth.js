import { useCallback, useEffect, useState } from 'react';
import { useToast } from '../context/ToastContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import {
  cancelClaudeAuthLogin,
  completeClaudeAuthLogin,
  fetchClaudeAuthStatus,
  startClaudeAuthLogin,
} from '../api/client.js';

export function useClaudeNativeAuth({ autoRefresh = true } = {}) {
  const { t } = useLocale();
  const { pushToast } = useToast();
  const [status, setStatus] = useState({ loggedIn: false, loading: true });
  const [step, setStep] = useState(1);
  const [authUrl, setAuthUrl] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    setStatus((s) => ({ ...s, loading: true }));
    const { ok, data } = await fetchClaudeAuthStatus();
    if (ok) {
      const loggedIn = Boolean(data?.loggedIn);
      setStatus({ loggedIn, authMethod: data?.authMethod, loading: false });
    if (loggedIn) setStep(3);
      return loggedIn;
    }
    setStatus({ loggedIn: false, loading: false, error: data?.error });
    return false;
  }, []);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    void refresh();
    return undefined;
  }, [autoRefresh, refresh]);

  const resetFlow = useCallback(() => {
    setStep(1);
    setAuthUrl('');
    setCode('');
    setBusy('');
  }, []);

  const openLoginTab = useCallback(async () => {
    setBusy('start');
    const { ok, data } = await startClaudeAuthLogin();
    setBusy('');
    if (!ok || !data?.url) {
      pushToast(data?.error || t('admin.claudeNative.startError'), { type: 'error' });
      return false;
    }
    setAuthUrl(data.url);
    setStep(2);
    window.open(data.url, '_blank', 'noopener,noreferrer');
    pushToast(t('admin.claudeNative.tabOpened'), { type: 'info' });
    return true;
  }, [pushToast, t]);

  const submitCode = useCallback(async (rawCode) => {
    const trimmed = String(rawCode || code).trim();
    if (!trimmed) return false;
    setBusy('complete');
    const { ok, data } = await completeClaudeAuthLogin(trimmed);
    setBusy('');
    if (!ok) {
      pushToast(data?.error || t('admin.claudeNative.codeError'), { type: 'error' });
      return false;
    }
    setAuthUrl('');
    setCode('');
    setStatus({ loggedIn: true, authMethod: data?.authMethod, loading: false });
    setStep(3);
    pushToast(t('admin.claudeNative.connected'), { type: 'success' });
    return true;
  }, [code, pushToast, t]);

  const cancel = useCallback(async () => {
    setBusy('cancel');
    await cancelClaudeAuthLogin();
    setBusy('');
    resetFlow();
  }, [resetFlow]);

  return {
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
  };
}
