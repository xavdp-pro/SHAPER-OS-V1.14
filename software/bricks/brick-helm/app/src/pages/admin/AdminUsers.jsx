import { useCallback, useEffect, useState } from 'react';
import { Link, NavLink, useNavigate, useParams } from 'react-router-dom';
import {
  Check, Loader2, Pencil, Plus, Trash2, UserRound, X,
} from 'lucide-react';
import { createUser, deleteUser, listUsers, updateUser } from '../../api/client.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useLocale } from '../../context/LocaleContext.jsx';
import PickerMenu from '../../components/PickerMenu.jsx';

function roleOptions(t) {
  return [
    { value: 'admin', label: t('admin.users.roleAdmin') },
    { value: 'operator', label: t('admin.users.roleOperator') },
    { value: 'viewer', label: t('admin.users.roleViewer') },
  ];
}

function statusOptions(t) {
  return [
    { value: 'active', label: t('admin.users.statusActive') },
    { value: 'pending', label: t('admin.users.statusPending') },
    { value: 'disabled', label: t('admin.users.statusDisabled') },
  ];
}

const emptyForm = {
  email: '',
  name: '',
  role: 'operator',
  status: 'active',
  notes: '',
  briefing: '',
  password: '',
  preferredConversation: '',
  demoSlug: '',
};

function UserForm({
  title,
  initial,
  submitLabel,
  onSubmit,
  onCancel,
  saving,
}) {
  const { t } = useLocale();
  const ROLE_OPTIONS = roleOptions(t);
  const STATUS_OPTIONS = statusOptions(t);
  const [form, setForm] = useState(initial || emptyForm);

  useEffect(() => {
    setForm(initial || emptyForm);
  }, [initial]);

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const payload = {
          email: form.email.trim(),
          name: form.name.trim(),
          role: form.role,
          status: form.status,
          notes: form.notes.trim(),
          briefing: form.briefing.trim(),
          preferredConversation: form.preferredConversation?.trim() || '',
          demoSlug: form.demoSlug?.trim() || '',
        };
        if (form.password?.trim()) payload.password = form.password;
        onSubmit(payload);
      }}
      className="zone-sunk rounded-2xl border border-white/10 p-4 space-y-3"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium text-white flex items-center gap-2">
          {title}
        </p>
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-icon" title={t('admin.users.cancel')}>
            <X size={16} />
          </button>
        )}
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block text-xs text-slate-400 space-y-1">
          {t('admin.users.email')}
          <input
            required
            type="email"
            value={form.email}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
            className="input-field text-sm py-2"
            placeholder="you@domain.tld"
          />
        </label>
        <label className="block text-xs text-slate-400 space-y-1">
          {t('admin.users.name')}
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="input-field text-sm py-2"
            placeholder={t('admin.users.namePlaceholder')}
          />
        </label>
        <div className="block text-xs text-slate-400 space-y-1">
          <span>{t('admin.users.role')}</span>
          <PickerMenu
            value={form.role}
            options={ROLE_OPTIONS}
            onChange={(role) => setForm((f) => ({ ...f, role }))}
            placeholder={t('admin.users.pickRole')}
          />
        </div>
        <div className="block text-xs text-slate-400 space-y-1">
          <span>{t('admin.users.status')}</span>
          <PickerMenu
            value={form.status}
            options={STATUS_OPTIONS}
            onChange={(status) => setForm((f) => ({ ...f, status }))}
            placeholder={t('admin.users.pickStatus')}
          />
        </div>
      </div>

      <label className="block text-xs text-slate-400 space-y-1">
        {t('admin.users.password')}
        <input
          type="password"
          value={form.password || ''}
          onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          className="input-field text-sm py-2"
          placeholder={initial?.has_password ? t('admin.users.passKeep') : t('admin.users.passOptional')}
          autoComplete="new-password"
        />
      </label>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="block text-xs text-slate-400 space-y-1">
          {t('admin.users.conversation')}
          <input
            type="text"
            value={form.preferredConversation || ''}
            onChange={(e) => setForm((f) => ({ ...f, preferredConversation: e.target.value }))}
            className="input-field text-sm py-2"
            placeholder={t('admin.users.conversationPlaceholder')}
          />
          <span className="text-[10px] text-slate-500 block">
            {t('admin.users.conversationHint')}
          </span>
        </label>
        <label className="block text-xs text-slate-400 space-y-1">
          {t('admin.users.demoSlug')}
          <input
            type="text"
            value={form.demoSlug || ''}
            onChange={(e) => setForm((f) => ({ ...f, demoSlug: e.target.value }))}
            className="input-field text-sm py-2"
            placeholder={t('admin.users.demoSlugPlaceholder')}
          />
          <span className="text-[10px] text-slate-500 block">
            {t('admin.users.demoSlugHint')}
          </span>
        </label>
      </div>

      {initial?.demoSlug && form.role !== 'admin' && (
        <div className="rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">
            {t('admin.users.inviteLink')}
          </p>
          <p className="text-xs font-mono text-emerald-300/90 break-all">
            {`${typeof window !== 'undefined' ? window.location.origin : ''}?user=${initial.demoSlug}`}
          </p>
          <p className="text-[10px] text-slate-500">
            {initial.inviteReady
              ? t('admin.users.inviteReady')
              : t('admin.users.inviteNeedPassword')}
          </p>
        </div>
      )}

      <label className="block text-xs text-slate-400 space-y-1">
        {t('admin.users.briefing')}
        <textarea
          value={form.briefing || ''}
          onChange={(e) => setForm((f) => ({ ...f, briefing: e.target.value }))}
          rows={5}
          className="input-field text-sm py-2 resize-y min-h-[6rem]"
          placeholder={t('admin.users.briefingPlaceholder')}
        />
      </label>

      <label className="block text-xs text-slate-400 space-y-1">
        {t('admin.users.notes')}
        <input
          type="text"
          value={form.notes}
          onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          className="input-field text-sm py-2"
          placeholder={t('admin.users.notesPlaceholder')}
        />
      </label>

      <div className="flex justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className="btn-secondary text-sm py-2 px-4">
            {t('admin.users.cancel')}
          </button>
        )}
        <button type="submit" disabled={saving} className="btn-primary text-sm py-2 px-4">
          {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
          {submitLabel}
        </button>
      </div>
    </form>
  );
}

function UsersSubNav() {
  const { t } = useLocale();
  return (
    <div className="flex flex-wrap gap-1.5 mb-4">
      <NavLink
        to="/admin/users"
        end
        className={({ isActive }) => (
          `inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition ${
            isActive
              ? 'bg-white/10 border-white/20 text-white'
              : 'border-white/10 text-slate-500 hover:text-slate-300'
          }`
        )}
      >
        <UserRound size={12} />
        {t('admin.users.list')}
      </NavLink>
      <NavLink
        to="/admin/users/new"
        className={({ isActive }) => (
          `inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition ${
            isActive
              ? 'bg-white/10 border-white/20 text-white'
              : 'border-white/10 text-slate-500 hover:text-slate-300'
          }`
        )}
      >
        <Plus size={12} />
        {t('admin.users.create')}
      </NavLink>
    </div>
  );
}

export function AdminUsersList() {
  const { t } = useLocale();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    const { ok, data } = await listUsers();
    setLoading(false);
    if (!ok) {
      pushToast(data?.error || t('admin.users.loadFailed'), { type: 'error' });
      return;
    }
    setUsers(data.users || []);
  }, [pushToast, t]);

  useEffect(() => { load(); }, [load]);

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const u = deleteTarget;
    setDeleteTarget(null);
    const { ok, data } = await deleteUser(u.id);
    if (!ok) {
      pushToast(data?.error || t('admin.users.deleteFailed'), { type: 'error' });
      return;
    }
    pushToast(t('admin.users.deleted'), { type: 'success' });
    load();
  };

  return (
    <div>
      <UsersSubNav />
      <div className="zone-sunk rounded-2xl border border-white/10 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-white/10 flex items-center justify-between gap-2 text-xs text-slate-400">
          <span className="inline-flex items-center gap-2">
            <UserRound size={14} />
            {loading
              ? t('admin.users.loading')
              : (users.length > 1 ? t('admin.users.countPlural') : t('admin.users.count')).replace('{count}', String(users.length))}
          </span>
          <Link to="/admin/users/new" className="btn-secondary text-[11px] py-1 px-2.5">
            <Plus size={12} />
            {t('admin.users.new')}
          </Link>
        </div>

        {loading ? (
          <div className="p-8 flex justify-center text-slate-500">
            <Loader2 className="animate-spin" size={22} />
          </div>
        ) : (
          <div className="overflow-x-auto theme-scrollbar">
            <table className="w-full text-sm text-left min-w-[36rem]">
              <thead className="text-[10px] uppercase tracking-wider text-slate-500 bg-black/30">
                <tr>
                  <th className="px-3 py-2 font-medium">{t('admin.users.email')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.users.name')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.users.conversation')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.users.role')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.users.status')}</th>
                  <th className="px-3 py-2 font-medium">{t('admin.users.auth')}</th>
                  <th className="px-3 py-2 font-medium w-24" />
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id} className="border-t border-white/5 hover:bg-white/[0.03]">
                    <td className="px-3 py-2.5 text-white font-mono text-xs">{u.email}</td>
                    <td className="px-3 py-2.5 text-slate-300">{u.name || '—'}</td>
                    <td className="px-3 py-2.5">
                      <span className="text-[11px] font-mono text-sky-300/90">
                        {u.preferredConversation || '—'}
                      </span>
                      {u.demoSlug ? (
                        <span className="block text-[10px] text-slate-500 font-mono">
                          ?user={u.demoSlug}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-2.5">
                      <span className="text-[11px] px-2 py-0.5 rounded-md bg-white/5 border border-white/10 text-slate-300">
                        {u.role}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <span className={`text-[11px] px-2 py-0.5 rounded-md border ${
                        u.status === 'active'
                          ? 'text-emerald-300 border-emerald-500/30 bg-emerald-950/30'
                          : u.status === 'pending'
                            ? 'text-amber-300 border-amber-500/30 bg-amber-950/30'
                            : 'text-slate-400 border-white/10 bg-white/5'
                      }`}
                      >
                        {u.status}
                      </span>
                    </td>
                    <td className="px-3 py-2.5 text-[10px] text-slate-500">
                      {u.has_password ? 'mdp' : '—'}
                      {u.inviteReady ? ' · invite' : ''}
                      {u.magic_pending ? ' · magic' : ''}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex justify-end gap-0.5">
                        <button
                          type="button"
                          className="btn-icon"
                          title={t('admin.users.edit')}
                          onClick={() => navigate(`/admin/users/${u.id}`)}
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          type="button"
                          className="btn-icon hover:text-red-400"
                          title={t('admin.users.delete')}
                          onClick={() => setDeleteTarget(u)}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {!users.length && (
                  <tr>
                    <td colSpan={7} className="px-3 py-8 text-center text-slate-500 text-xs">
                      Aucun utilisateur —{' '}
                      <Link to="/admin/users/new" className="text-brand-400 hover:underline">
                        créer le premier
                      </Link>
                      .
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/60"
            aria-label={t('admin.users.cancel')}
            onClick={() => setDeleteTarget(null)}
          />
          <div
            role="dialog"
            aria-modal="true"
            className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0f172a] p-5 shadow-2xl"
          >
            <h2 className="text-base font-semibold text-white mb-2">{t('admin.users.delete')} ?</h2>
            <p className="text-sm text-slate-400 mb-5 font-mono break-all">{deleteTarget.email}</p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={() => setDeleteTarget(null)} className="btn-secondary text-sm py-2 px-4">
                {t('admin.users.cancel')}
              </button>
              <button
                type="button"
                onClick={confirmDelete}
                className="inline-flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded-xl text-sm"
              >
                <Trash2 size={14} />
                {t('admin.users.delete')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export function AdminUsersCreate() {
  const { t } = useLocale();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);

  return (
    <div>
      <UsersSubNav />
      <UserForm
        title={(
          <>
            <Plus size={14} />
            {t('admin.users.new')}
          </>
        )}
        submitLabel={t('admin.users.create')}
        saving={saving}
        onCancel={() => navigate('/admin/users')}
        onSubmit={async (payload) => {
          setSaving(true);
          const res = await createUser(payload);
          setSaving(false);
          if (!res.ok) {
            pushToast(res.data?.error || t('admin.users.createFailed'), { type: 'error' });
            return;
          }
          const conv = res.data?.user?.preferredConversation;
          const slug = res.data?.user?.demoSlug;
          pushToast(
            conv
              ? `${t('admin.users.created')} — session « ${conv} »${slug ? ` · ?user=${slug}` : ''}`
              : t('admin.users.created'),
            { type: 'success', duration: 6000 },
          );
          if (res.data?.user?.id) navigate(`/admin/users/${res.data.user.id}`);
          else navigate('/admin/users');
        }}
      />
    </div>
  );
}

export function AdminUsersEdit() {
  const { id } = useParams();
  const { t } = useLocale();
  const { pushToast } = useToast();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [initial, setInitial] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { ok, data } = await listUsers();
      if (cancelled) return;
      setLoading(false);
      if (!ok) {
        pushToast(data?.error || t('admin.users.loadOneFailed'), { type: 'error' });
        navigate('/admin/users');
        return;
      }
      const user = (data.users || []).find((u) => String(u.id) === String(id));
      if (!user) {
        pushToast(t('admin.users.notFound'), { type: 'error' });
        navigate('/admin/users');
        return;
      }
      setInitial({
        email: user.email,
        name: user.name || '',
        role: user.role,
        status: user.status,
        notes: user.notes || '',
        briefing: user.briefing || '',
        password: '',
        has_password: Boolean(user.has_password),
        preferredConversation: user.preferredConversation || '',
        demoSlug: user.demoSlug || '',
        inviteReady: Boolean(user.inviteReady),
      });
    })();
    return () => { cancelled = true; };
  }, [id, navigate, pushToast, t]);

  if (loading || !initial) {
    return (
      <div>
        <UsersSubNav />
        <div className="flex justify-center py-12 text-slate-500">
          <Loader2 className="animate-spin" size={22} />
        </div>
      </div>
    );
  }

  return (
    <div>
      <UsersSubNav />
      <UserForm
        title={(
          <>
            <Pencil size={14} />
            {t('admin.users.edit')} #{id}
          </>
        )}
        initial={initial}
        submitLabel={t('admin.save')}
        saving={saving}
        onCancel={() => navigate('/admin/users')}
        onSubmit={async (payload) => {
          setSaving(true);
          const res = await updateUser(id, payload);
          setSaving(false);
          if (!res.ok) {
            pushToast(res.data?.error || t('admin.users.updateFailed'), { type: 'error' });
            return;
          }
          pushToast(t('admin.users.updated'), { type: 'success' });
          navigate('/admin/users');
        }}
      />
    </div>
  );
}
