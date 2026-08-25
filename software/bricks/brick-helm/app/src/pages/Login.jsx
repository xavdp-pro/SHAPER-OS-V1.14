import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Eye, EyeOff, Bot, Sparkles } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import LanguageSelector from '../components/LanguageSelector.jsx';
import PwaInstallBanner from '../components/PwaInstallBanner.jsx';
import { fetchDemoInvite, fetchBootstrap } from '../api/client.js';
import { burstConfetti } from '../lib/confettiBurst.js';

const CONFETTI_AFTER_MS = 2000;

function safeInternalPath(raw) {
  const path = String(raw || '').trim();
  if (!path.startsWith('/') || path.startsWith('//')) return '/console';
  return path;
}

export default function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login, authenticated, loading: authLoading } = useAuth();
  const { t, locale } = useLocale();
  const { appName } = useSettings();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [invite, setInvite] = useState(null);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [credsReady, setCredsReady] = useState(false);
  const [demoLogin, setDemoLogin] = useState(false);
  /** Demo prefill served by /api/bootstrap on demo instances only. */
  const [demoCreds, setDemoCreds] = useState(null);
  const pageLoadedAtRef = useRef(typeof performance !== 'undefined' ? performance.now() : Date.now());

  const userSlug = String(searchParams.get('user') || '').trim().toLowerCase();

  useEffect(() => {
    if (!authLoading && authenticated) {
      navigate(safeInternalPath(searchParams.get('next')), { replace: true });
    }
  }, [authLoading, authenticated, navigate, searchParams]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { ok, data } = await fetchBootstrap();
      if (cancelled) return;
      setDemoLogin(Boolean(ok && data?.demoLogin));
      if (ok && data?.demoCredentials) setDemoCreds(data.demoCredentials);
    })();
    return () => { cancelled = true; };
  }, []);

  // Personalized invite: AJAX load → fill email + password; user must click to sign in.
  useEffect(() => {
    if (!userSlug) {
      setInvite(null);
      setInviteError('');
      setCredsReady(false);
      return undefined;
    }
    let cancelled = false;
    let confettiTimer = 0;
    pageLoadedAtRef.current = typeof performance !== 'undefined' ? performance.now() : Date.now();
    setInviteLoading(true);
    setInviteError('');
    setCredsReady(false);
    void (async () => {
      const { ok, data } = await fetchDemoInvite(userSlug);
      if (cancelled) return;
      setInviteLoading(false);
      if (!ok || !data?.email || !data?.password) {
        setInvite(null);
        setInviteError(data?.error || t('login.inviteMissing'));
        return;
      }
      setInvite(data);
      setEmail(String(data.email));
      setPassword(String(data.password));
      setShowPass(true);
      setCredsReady(true);
      setError('');
      const elapsed = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - pageLoadedAtRef.current;
      const delay = Math.max(0, CONFETTI_AFTER_MS - elapsed);
      confettiTimer = window.setTimeout(() => {
        if (!cancelled) burstConfetti(6500);
      }, delay);
    })();
    return () => {
      cancelled = true;
      if (confettiTimer) window.clearTimeout(confettiTimer);
    };
  }, [userSlug, t, locale]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    const ok = await login(email.trim(), password);
    setLoading(false);
    if (ok) {
      const dest = safeInternalPath(searchParams.get('next'));
      navigate(dest, { replace: true });
    } else setError(t('login.error'));
  };

  const fillDemoUser = () => {
    if (!demoCreds) return;
    setEmail(demoCreds.email);
    setPassword(demoCreds.password);
    setShowPass(true);
    setError('');
  };

  const greetName = invite?.greetName || invite?.firstName || '';
  const isInvite = Boolean(userSlug);

  return (
    <div className="min-h-screen mesh-bg flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-md glass rounded-3xl p-8 pt-10 overflow-hidden"
      >
        {isInvite && invite && (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-sky-400/20 via-violet-500/10 to-transparent"
            aria-hidden
          />
        )}

        <div className="absolute top-3 right-3 z-10">
          <LanguageSelector variant="menu" />
        </div>

        <div className="relative text-center mb-8">
          <div className="inline-flex p-3 rounded-2xl bg-brand-600 text-white mb-4 shadow-lg shadow-brand-600/30">
            <Bot size={28} />
          </div>
          <h1 className="font-display text-2xl font-bold">{appName}</h1>

          {inviteLoading && (
            <p className="mt-4 text-sm text-slate-400 animate-pulse">
              {t('login.inviteLoading')}
            </p>
          )}

          {greetName && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="mt-5 space-y-2"
            >
              <p className="font-display text-xl sm:text-2xl font-semibold text-white tracking-tight">
                {t('login.inviteHello')
                  .replace('{name}', greetName)
                  .replace('{app}', appName || 'KovZu')}
              </p>
              <p className="text-sm text-slate-300 leading-relaxed max-w-sm mx-auto">
                {t('login.inviteSub')
                  .replace('{name}', greetName)
                  .replace('{app}', appName || 'KovZu')}
              </p>
              {credsReady && (
                <p className="text-xs text-emerald-300/90 inline-flex items-center justify-center gap-1.5 pt-1">
                  <Sparkles size={12} />
                  {t('login.inviteReady')}
                </p>
              )}
            </motion.div>
          )}

          {inviteError && (
            <p className="mt-3 text-xs text-amber-300/90">{inviteError}</p>
          )}
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label htmlFor="login-email" className="block text-xs uppercase tracking-wider text-slate-400 mb-2">
              {t('login.email')}
            </label>
            <input
              id="login-email"
              type="text"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input-field"
              placeholder={t('login.emailPlaceholder')}
              autoComplete="username"
              required
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-xs uppercase tracking-wider text-slate-400 mb-2">
              {t('login.password')}
            </label>
            <div className="relative">
              <input
                id="login-password"
                type={showPass ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="input-field pr-12"
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                onClick={() => setShowPass((v) => !v)}
                className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white"
                aria-label={showPass ? t('login.hidePass') : t('login.showPass')}
              >
                {showPass ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>
          </div>
          {error && <p className="text-red-400 text-sm text-center">{error}</p>}
          <button
            type="submit"
            disabled={loading || (isInvite && inviteLoading)}
            className="btn-primary w-full"
          >
            {loading
              ? t('login.loading')
              : greetName
                ? t('login.inviteSubmit').replace('{name}', greetName)
                : t('login.submit')}
          </button>
        </form>

        {demoLogin && (
          <div className="mt-6 space-y-3">
            <button
              type="button"
              onClick={fillDemoUser}
              className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-slate-200 hover:bg-white/10 hover:text-white transition"
            >
              {t('login.demoFill')}
            </button>
            <p className="text-slate-500 text-xs text-center leading-relaxed">
              {t('login.demoHint')}
            </p>
          </div>
        )}

        <PwaInstallBanner className="mt-6" />
      </motion.div>
    </div>
  );
}
