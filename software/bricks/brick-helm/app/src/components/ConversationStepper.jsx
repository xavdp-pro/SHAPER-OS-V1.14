import { useCallback, useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, Plus, Server, X } from 'lucide-react';
import PickerMenu from './PickerMenu.jsx';
import WorkspacePicker from './WorkspacePicker.jsx';
import { buildConversationPath } from '../lib/paths.js';
import { sessionNameFromPath } from '../lib/workspaceTemplates.js';
import { getSessionCatalog, registerConversation } from '../api/client.js';
import { useLocale } from '../context/LocaleContext.jsx';

const STEPS = ['machine', 'user', 'path', 'confirm'];

function machineOptions(machines, t) {
  return (machines || []).map((m) => ({
    value: m.name,
    label: m.name,
    hint: m.bridged
      ? `${m.user} · ${t('stepper.bridged')}`
      : `${m.user} · ${t('stepper.sshOnly')}`,
  }));
}

export default function ConversationStepper({
  nodes = [],
  defaultNode = '',
  defaultUser = '',
  onCreate,
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);
  const [catalog, setCatalog] = useState(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const [machine, setMachine] = useState(defaultNode || nodes[0]?.name || '');
  const [user, setUser] = useState(defaultUser || nodes[0]?.user || 'zaza');
  const [workspace, setWorkspace] = useState('');
  const [sessionName, setSessionName] = useState('');
  const [sessionNameTouched, setSessionNameTouched] = useState(false);

  const machines = useMemo(() => {
    if (catalog?.machines?.length) return catalog.machines;
    const seen = new Set();
    return (nodes || [])
      .filter((n) => n.name && !seen.has(n.name) && seen.add(n.name))
      .map((n) => ({
        name: n.name,
        user: n.user || 'zaza',
        bridged: true,
        source: 'cli',
      }));
  }, [catalog, nodes]);

  const selectedMachine = machines.find((m) => m.name === machine);

  const userOptions = useMemo(() => {
    const seen = new Set();
    const opts = [];
    const add = (value, hint = '') => {
      const u = String(value || '').trim();
      if (!u || seen.has(u)) return;
      seen.add(u);
      opts.push({ value: u, label: u, hint });
    };
    if (selectedMachine?.user) add(selectedMachine.user, selectedMachine.name);
    for (const m of machines) add(m.user, m.name);
    for (const u of ['zaza', 'helm-v2', 'root', 'xavier']) add(u);
    return opts.sort((a, b) => a.label.localeCompare(b.label));
  }, [machines, selectedMachine]);

  const autoSession = sessionNameFromPath(workspace);
  const effectiveSession = String(sessionName || autoSession || '').trim();
  const path = buildConversationPath(machine, user, effectiveSession);

  const loadCatalog = useCallback(async () => {
    setLoading(true);
    const { ok, data } = await getSessionCatalog();
    setLoading(false);
    if (ok && data) {
      setCatalog(data);
      if (!machine && data.machines?.[0]?.name) {
        setMachine(data.machines[0].name);
        setUser(data.machines[0].user || defaultUser || 'zaza');
      }
    }
  }, [machine, defaultUser]);

  useEffect(() => {
    if (open && !catalog && !loading) void loadCatalog();
  }, [open, catalog, loading, loadCatalog]);

  useEffect(() => {
    if (selectedMachine?.user && step === 0) {
      setUser(selectedMachine.user);
    }
  }, [machine, selectedMachine, step]);

  useEffect(() => {
    if (!sessionNameTouched && autoSession) {
      setSessionName(autoSession);
    }
  }, [autoSession, sessionNameTouched]);

  const reset = () => {
    setStep(0);
    setError('');
    setWorkspace('');
    setSessionName('');
    setSessionNameTouched(false);
  };

  const close = () => {
    setOpen(false);
    reset();
  };

  const canNext = () => {
    if (step === 0) return Boolean(machine);
    if (step === 1) return Boolean(user.trim());
    if (step === 2) return Boolean(workspace.trim().startsWith('/'));
    if (step === 3) return Boolean(path && workspace);
    return false;
  };

  const submit = async () => {
    if (!path || !workspace || submitting) return;
    setSubmitting(true);
    setError('');
    const { ok, data } = await registerConversation({ path, workspace });
    setSubmitting(false);
    if (!ok && !data?.localOnly) {
      setError(data?.error || t('stepper.errorRegister'));
      return;
    }
    onCreate({
      path,
      workspace,
      bridged: Boolean(data?.bridged),
      warning: data?.warning || data?.error || '',
    });
    close();
  };

  return (
    <>
      <div className="p-2 shrink-0 border-b border-white/10">
        <button
          type="button"
          onClick={() => { setOpen(true); reset(); }}
          className="btn-secondary w-full text-xs py-2.5 gap-2"
        >
          <Plus size={14} />
          {t('stepper.open')}
        </button>
      </div>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
          <button
            type="button"
            className="absolute inset-0 bg-black/70"
            aria-label={t('stepper.cancel')}
            onClick={() => !submitting && close()}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="conv-stepper-title"
            className={`stepper-modal relative w-full sm:max-w-lg flex flex-col rounded-t-2xl sm:rounded-2xl border border-white/10 bg-[#0f172a] shadow-2xl overflow-hidden ${
              step === 0 || step === 2
                ? 'h-[92dvh] sm:h-[min(90vh,820px)]'
                : 'max-h-[92dvh] sm:max-h-[88vh]'
            }`}
          >
            <div className="flex items-start justify-between gap-3 px-4 pt-4 pb-2 shrink-0 border-b border-white/10">
              <div>
                <h2 id="conv-stepper-title" className="text-base font-semibold text-white">
                  {t('stepper.title')}
                </h2>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  {t(`stepper.step.${STEPS[step]}`)}
                  {' · '}
                  {step + 1}/{STEPS.length}
                </p>
              </div>
              <button
                type="button"
                onClick={() => !submitting && close()}
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
                aria-label={t('stepper.cancel')}
              >
                <X size={16} />
              </button>
            </div>

            <div className={`flex-1 min-h-0 theme-scrollbar px-4 py-3 ${
              step === 0 || step === 2
                ? 'flex flex-col overflow-hidden'
                : 'overflow-y-auto space-y-3'
            }`}
            >
              {step === 0 && (
                <div className="flex flex-col flex-1 min-h-0 gap-2">
                  <PickerMenu
                    label={t('stepper.machineLabel')}
                    value={machine}
                    options={machineOptions(machines, t)}
                    onChange={setMachine}
                    placeholder={t('stepper.machinePlaceholder')}
                    searchPlaceholder={t('stepper.searchMachine')}
                    searchable
                    inline
                    tall
                    defaultOpen
                    emptyLabel={t('stepper.noMachine')}
                  />
                  <p className="text-[10px] text-slate-600 px-1 leading-relaxed shrink-0">
                    <Server size={10} className="inline mr-1 opacity-70" />
                    {t('stepper.machineHint')}
                    {catalog?.sshHostCount ? (
                      <span className="text-slate-500">
                        {' '}
                        ({catalog.sshHostCount} {t('stepper.sshHosts')})
                      </span>
                    ) : null}
                  </p>
                  <input
                    type="text"
                    value={machine}
                    onChange={(e) => setMachine(e.target.value.trim())}
                    placeholder={t('stepper.machineCustom')}
                    className="input-field text-xs py-2 font-mono shrink-0"
                  />
                </div>
              )}

              {step === 1 && (
                <div className="space-y-2">
                  <PickerMenu
                    label={t('stepper.userLabel')}
                    value={user}
                    options={userOptions}
                    onChange={setUser}
                    placeholder={t('stepper.userPlaceholder')}
                    clearable
                    emptyLabel={t('stepper.noUser')}
                  />
                  <input
                    type="text"
                    value={user}
                    onChange={(e) => setUser(e.target.value)}
                    placeholder={t('stepper.userCustom')}
                    className="input-field text-sm py-2.5 font-mono w-full"
                  />
                  <p className="text-[10px] text-slate-600 px-1">{t('stepper.userHint')}</p>
                </div>
              )}

              {step === 2 && (
                <div className="flex flex-col flex-1 min-h-0">
                  <WorkspacePicker
                    machine={machine}
                    user={user}
                    value={workspace}
                    onChange={setWorkspace}
                    active={step === 2}
                  />
                </div>
              )}

              {step === 3 && (
                <div className="space-y-2">
                  <label className="block px-1">
                    <span className="text-[10px] font-medium text-slate-500 uppercase tracking-wide">
                      {t('stepper.sessionLabel')}
                    </span>
                    <input
                      type="text"
                      value={sessionName}
                      onChange={(e) => {
                        setSessionNameTouched(true);
                        setSessionName(e.target.value);
                      }}
                      placeholder={autoSession || 'NOW2'}
                      className="input-field text-sm py-2.5 mt-1 font-mono w-full"
                    />
                  </label>
                  <div className="rounded-lg border border-white/10 bg-white/5 px-2.5 py-2 space-y-1">
                    <p className="text-[10px] text-slate-500">{t('stepper.preview')}</p>
                    <p className="text-xs text-white font-mono truncate" title={path}>{path}</p>
                    <p className="text-[10px] text-slate-400 font-mono truncate" title={workspace}>{workspace}</p>
                    {selectedMachine && !selectedMachine.bridged && (
                      <p className="text-[10px] text-amber-400/90">{t('stepper.warnNoBridge')}</p>
                    )}
                  </div>
                  {error && (
                    <p className="text-[10px] text-red-400 px-1">{error}</p>
                  )}
                </div>
              )}
            </div>

            <div className="flex gap-1.5 px-4 py-3 shrink-0 border-t border-white/10 bg-[#0f172a]">
              {step > 0 ? (
                <button
                  type="button"
                  onClick={() => setStep((s) => s - 1)}
                  className="btn-secondary flex-1 text-xs py-2.5 gap-1"
                >
                  <ChevronLeft size={14} />
                  {t('stepper.back')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={close}
                  className="btn-secondary flex-1 text-xs py-2.5"
                >
                  {t('stepper.cancel')}
                </button>
              )}
              {step < STEPS.length - 1 ? (
                <button
                  type="button"
                  disabled={!canNext()}
                  onClick={() => setStep((s) => s + 1)}
                  className="btn-primary flex-1 text-xs py-2.5 gap-1 disabled:opacity-40"
                >
                  {t('stepper.next')}
                  <ChevronRight size={14} />
                </button>
              ) : (
                <button
                  type="button"
                  disabled={!canNext() || submitting}
                  onClick={submit}
                  className="btn-primary flex-1 text-xs py-2.5 gap-1 disabled:opacity-40"
                >
                  <Plus size={14} />
                  {submitting ? t('stepper.creating') : t('stepper.create')}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
