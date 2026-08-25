import { useEffect, useState } from 'react';
import { Check, Loader2, ScrollText } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { useLocale } from '../../context/LocaleContext.jsx';

export default function AdminBriefing() {
  const { t } = useLocale();
  const { user, updateProfile } = useAuth();
  const { pushToast } = useToast();
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft(user?.briefing || '');
  }, [user?.briefing]);

  const handleSave = async (e) => {
    e.preventDefault();
    setSaving(true);
    const { ok, data } = await updateProfile({ briefing: draft });
    setSaving(false);
    if (!ok) {
      pushToast(data?.error || t('admin.saveFailed'), { type: 'error' });
      return;
    }
    pushToast(t('admin.briefing.saved'), { type: 'success' });
  };

  const dirty = draft !== (user?.briefing || '');

  return (
    <form onSubmit={handleSave} className="space-y-4 max-w-2xl">
      <div className="zone-sunk rounded-2xl border border-white/10 p-4 sm:p-5 space-y-4">
        <div>
          <p className="text-sm font-medium text-white flex items-center gap-2">
            <ScrollText size={16} className="text-brand-400" />
            {t('admin.briefing.title')}
          </p>
          <p className="text-xs text-slate-500 mt-1.5 leading-relaxed">
            {t('admin.briefing.hint')}
          </p>
        </div>

        <label className="block text-xs text-slate-400 space-y-1">
          {t('admin.briefing.label')}
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={10}
            className="input-field text-sm py-2 min-h-[12rem] resize-y"
            placeholder={t('admin.briefing.placeholder')}
          />
        </label>

        <p className="text-[11px] text-slate-500">
          {t('admin.briefing.account')}{' '}
          <span className="text-slate-300">{user?.name || user?.email || '—'}</span>
        </p>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={saving || !dirty}
            className="btn-primary text-sm py-2 px-4 inline-flex items-center gap-2"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
            {t('admin.save')}
          </button>
        </div>
      </div>
    </form>
  );
}
