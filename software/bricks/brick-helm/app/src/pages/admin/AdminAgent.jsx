import { useEffect, useState } from 'react';
import { AppWindow, Bot, Check, Loader2 } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';
import { useSettings } from '../../context/SettingsContext.jsx';
import { useLocale } from '../../context/LocaleContext.jsx';

export default function AdminAgent() {
  const { t } = useLocale();
  const { pushToast } = useToast();
  const {
    agentName,
    setAgentName,
    appName,
    setAppName,
  } = useSettings();
  const [draftAgent, setDraftAgent] = useState(agentName);
  const [draftApp, setDraftApp] = useState(appName);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraftAgent(agentName);
  }, [agentName]);

  useEffect(() => {
    setDraftApp(appName);
  }, [appName]);

  const handleSave = async (e) => {
    e.preventDefault();
    const nextAgent = draftAgent.trim();
    const nextApp = draftApp.trim();
    if (!nextAgent) {
      pushToast(t('admin.agent.nameRequired'), { type: 'error' });
      return;
    }
    if (!nextApp) {
      pushToast(t('admin.app.nameRequired'), { type: 'error' });
      return;
    }

    setSaving(true);
    const jobs = [];
    if (nextAgent !== agentName) jobs.push(setAgentName(nextAgent));
    if (nextApp !== appName) jobs.push(setAppName(nextApp));

    if (!jobs.length) {
      setSaving(false);
      return;
    }

    const results = await Promise.all(jobs);
    setSaving(false);
    const failed = results.find((r) => !r.ok);
    if (failed) {
      pushToast(failed.error || t('admin.saveFailed'), { type: 'error' });
      return;
    }
    pushToast(t('admin.agent.saved'), { type: 'success' });
  };

  const dirty = (
    (draftAgent.trim() !== agentName && Boolean(draftAgent.trim()))
    || (draftApp.trim() !== appName && Boolean(draftApp.trim()))
  );

  return (
    <div className="space-y-4 max-w-xl">
      <form onSubmit={handleSave} className="space-y-4">
        <div className="zone-sunk rounded-2xl border border-white/10 p-4 sm:p-5 space-y-4">
          <div>
            <p className="text-sm font-medium text-white flex items-center gap-2">
              <Bot size={16} className="text-brand-400" />
              {t('admin.agent.title')}
            </p>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              {t('admin.agent.hint')}
            </p>
          </div>

          <label className="block text-xs text-slate-400 space-y-1">
            {t('admin.agent.label')}
            <input
              type="text"
              maxLength={40}
              value={draftAgent}
              onChange={(e) => setDraftAgent(e.target.value)}
              className="input-field text-sm py-2.5"
              placeholder="Zephir"
              required
              autoFocus
            />
          </label>

          <p className="text-[11px] text-slate-500">
            {t('admin.current')}{' '}
            <span className="text-slate-300 font-mono">{agentName}</span>
          </p>
        </div>

        <div className="zone-sunk rounded-2xl border border-white/10 p-4 sm:p-5 space-y-4">
          <div>
            <p className="text-sm font-medium text-white flex items-center gap-2">
              <AppWindow size={16} className="text-brand-400" />
              {t('admin.app.title')}
            </p>
            <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
              {t('admin.app.hint')}
            </p>
          </div>

          <label className="block text-xs text-slate-400 space-y-1">
            {t('admin.app.label')}
            <input
              type="text"
              maxLength={40}
              value={draftApp}
              onChange={(e) => setDraftApp(e.target.value)}
              className="input-field text-sm py-2.5"
              placeholder="KovZu"
              required
            />
          </label>

          <p className="text-[11px] text-slate-500">
            {t('admin.current')}{' '}
            <span className="text-slate-300 font-mono">{appName}</span>
          </p>
        </div>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || !dirty}
            className="btn-primary text-sm py-2 px-4"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {t('admin.save')}
          </button>
        </div>
      </form>
    </div>
  );
}
