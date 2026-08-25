import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bug, Globe, MonitorPlay, Plus, RefreshCw, RotateCcw, Square, ExternalLink, X,
} from 'lucide-react';
import {
  getVibeProjects, getVibeProjectStatus,
  getBrowserContainers, startNekoContainer, rebuildBrowserContainer,
  stopBrowserContainer, browserProxyUrl,
} from '../api/client.js';
import AppsFolderPicker from './AppsFolderPicker.jsx';
import PickerMenu from './PickerMenu.jsx';
import {
  buildPreviewSrc,
  isDesktopLayout,
  loadAddedVibeProjects,
  loadRemovedVibeProjects,
  loadVibePreviewPath,
  loadVibeProjectId,
  loadWorkspaceTab,
  previewSubPathFromLocation,
  registerAddedVibeProject,
  removeVibeProjectFromList,
  saveVibePreviewPath,
  saveVibeProjectId,
  saveWorkspaceTab,
} from '../lib/desktopLayoutPrefs.js';

function labelForProjectId(id) {
  const base = String(id || '').replace(/-v\d+$/i, '');
  const words = base.split('-').filter(Boolean);
  if (!words.length) return String(id || '');
  return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

const TABS = [
  { id: 'preview', label: 'Aperçu', icon: MonitorPlay },
  { id: 'debug', label: 'Debug', icon: Bug },
  { id: 'browser', label: 'Navigateur', icon: Globe },
];

// Same threshold as desktop column (`hidden lg:flex`) — below this,
// layout is "mobile" for this panel (phone + tablet).
const DESKTOP_MQ = '(min-width: 1024px)';
function useIsDesktopPanel() {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(DESKTOP_MQ).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_MQ);
    const onChange = () => setIsDesktop(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return isDesktop;
}

/**
 * Right desktop panel (hidden on mobile) — Lovable-style vibe-coding.
 * Tabs: Preview (same-origin proxy iframe), Debug (upcoming: Playwright/CDP),
 * Browser (upcoming: Neko WebRTC). Turbobash project picker + "create space" action
 * (requests agent to run tb app sudo/way/noweb/create).
 */
export default function WorkspacePanel({ open, onClose, onCreateApp }) {
  const [tab, setTab] = useState(() => (isDesktopLayout() ? loadWorkspaceTab() : 'preview'));
  const [projects, setProjects] = useState([]);
  const [selected, setSelected] = useState(() => loadVibeProjectId());
  const [previewRoute, setPreviewRoute] = useState(() => loadVibePreviewPath(loadVibeProjectId()));
  const [removedProjectIds, setRemovedProjectIds] = useState(() => loadRemovedVibeProjects());
  const [status, setStatus] = useState(null); // {up}
  const [loading, setLoading] = useState(false);
  const [iframeKey, setIframeKey] = useState(0);
  const iframeRef = useRef(null);
  // Browser tab (container POC)
  const [containers, setContainers] = useState([]);
  const [selectedContainer, setSelectedContainer] = useState('');
  const [containerBusy, setContainerBusy] = useState(false);

  const project = projects.find((p) => p.id === selected) || null;
  const previewSrc = project ? buildPreviewSrc(project.previewPath, previewRoute) : '';

  const visibleProjects = useMemo(() => {
    const byId = new Map(projects.map((p) => [p.id, p]));
    for (const id of loadAddedVibeProjects()) {
      if (byId.has(id) || removedProjectIds.includes(id)) continue;
      byId.set(id, {
        id,
        label: labelForProjectId(id),
        appPath: `/apps/${id}/app`,
        rootPath: `/apps/${id}`,
        hasAppDir: false,
        existsOnDisk: false,
        previewPath: `/api/preview/${id}/`,
      });
    }
    return [...byId.values()]
      .filter((p) => !removedProjectIds.includes(p.id))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [projects, removedProjectIds]);

  const handleRemoveProject = useCallback((id) => {
    const projectId = String(id || '').trim();
    if (!projectId) return;
    removeVibeProjectFromList(projectId);
    const nextRemoved = loadRemovedVibeProjects();
    setRemovedProjectIds(nextRemoved);
    const remaining = projects.filter((p) => !nextRemoved.includes(p.id));
    setSelected((cur) => {
      if (cur !== projectId) return cur;
      const pick = remaining[0]?.id || '';
      saveVibeProjectId(pick);
      setPreviewRoute(loadVibePreviewPath(pick));
      return pick;
    });
  }, [projects]);

  const handleCreateApp = useCallback((name) => {
    const id = String(name || '').trim();
    if (!id) return;
    registerAddedVibeProject(id);
    setSelected(id);
    saveVibeProjectId(id);
    setPreviewRoute('/');
    onCreateApp?.(id);
  }, [onCreateApp]);

  const loadProjects = useCallback(async () => {
    setLoading(true);
    const { ok, data } = await getVibeProjects();
    if (ok && Array.isArray(data?.projects)) {
      setProjects(data.projects);
      setSelected((cur) => {
        const removed = loadRemovedVibeProjects();
        const visible = data.projects.filter((p) => !removed.includes(p.id));
        const saved = cur || loadVibeProjectId();
        const pick = visible.find((p) => p.id === saved)?.id
          || visible[0]?.id
          || '';
        if (pick) saveVibeProjectId(pick);
        return pick;
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadProjects(); }, [loadProjects]);

  useEffect(() => {
    if (!selected) return;
    setPreviewRoute(loadVibePreviewPath(selected));
  }, [selected]);

  useEffect(() => {
    if (isDesktopLayout()) saveWorkspaceTab(tab);
  }, [tab]);

  const handleProjectChange = useCallback((id) => {
    setSelected(id);
    saveVibeProjectId(id);
    setPreviewRoute(loadVibePreviewPath(id));
  }, []);

  const syncPreviewRouteFromIframe = useCallback(() => {
    if (!project || !iframeRef.current) return;
    try {
      const sub = previewSubPathFromLocation(project.id, iframeRef.current.contentWindow?.location);
      setPreviewRoute((cur) => {
        if (cur === sub) return cur;
        saveVibePreviewPath(project.id, sub);
        return sub;
      });
    } catch {
      /* preview not same-origin */
    }
  }, [project]);

  // React Router in the preview iframe does not fire iframe onLoad — poll + postMessage.
  useEffect(() => {
    if (!open || tab !== 'preview' || !project) return undefined;
    const id = window.setInterval(() => syncPreviewRouteFromIframe(), 600);
    return () => window.clearInterval(id);
  }, [open, tab, project, syncPreviewRouteFromIframe]);

  useEffect(() => {
    if (!project) return undefined;
    const onMessage = (event) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || data.type !== 'helm-preview-route' || data.projectId !== project.id) return;
      const sub = String(data.path || '/').trim() || '/';
      setPreviewRoute((cur) => {
        if (cur === sub) return cur;
        saveVibePreviewPath(project.id, sub);
        return sub;
      });
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [project]);

  const checkStatus = useCallback(async (id) => {
    if (!id) return;
    const { ok, data } = await getVibeProjectStatus(id);
    setStatus(ok ? { up: Boolean(data?.up) } : { up: false });
  }, []);

  useEffect(() => { if (selected) void checkStatus(selected); }, [selected, checkStatus]);

  const reloadPreview = () => {
    setIframeKey((k) => k + 1);
    void checkStatus(selected);
  };

  const loadContainers = useCallback(async () => {
    const { ok, data } = await getBrowserContainers();
    if (ok && Array.isArray(data?.containers)) {
      setContainers(data.containers);
      setSelectedContainer((cur) => {
        const running = data.containers.find((c) => c.name === cur && c.running && c.port);
        if (running) return cur;
        return data.containers.find((c) => c.running && c.port)?.name || '';
      });
    }
  }, []);

  useEffect(() => {
    if (open && (tab === 'browser' || tab === 'debug')) void loadContainers();
  }, [open, tab, loadContainers]);

  const handleStartNeko = async () => {
    setContainerBusy(true);
    await startNekoContainer();
    await loadContainers();
    setContainerBusy(false);
  };

  const handleStopContainer = async (name) => {
    setContainerBusy(true);
    await stopBrowserContainer(name);
    await loadContainers();
    setContainerBusy(false);
  };

  const handleRebuild = async () => {
    setContainerBusy(true);
    const target = containers.find((c) => c.name === selectedContainer && c.managed);
    await rebuildBrowserContainer(target ? target.name : 'kovzu-neko');
    await loadContainers();
    setContainerBusy(false);
  };

  const activeContainer = containers.find((c) => c.name === selectedContainer && c.running && c.port) || null;
  const isDesktop = useIsDesktopPanel();

  /** Preview (turbobash projects) — only content shown on mobile/tablet. */
  const previewContent = (
    <div className="flex flex-col flex-1 min-h-0">
      {/* + app space · project selector · actions */}
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-white/10 shrink-0">
        <AppsFolderPicker
          value={selected}
          projects={visibleProjects}
          onChange={handleProjectChange}
          onCreate={handleCreateApp}
          onRemove={handleRemoveProject}
          loading={loading}
        />
        <span
          className={`w-2 h-2 rounded-full shrink-0 ${status?.up ? 'bg-emerald-400' : 'bg-slate-600'}`}
          title={status?.up ? 'Dev server actif' : 'Dev server arrêté'}
        />
        <button type="button" onClick={reloadPreview} className="btn-icon" title="Recharger" aria-label="Recharger">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        {project && (
          <a href={previewSrc} target="_blank" rel="noopener noreferrer" className="btn-icon" title="Ouvrir dans un onglet" aria-label="Ouvrir dans un onglet">
            <ExternalLink size={14} />
          </a>
        )}
      </div>

      {/* Iframe preview */}
      <div className="flex-1 min-h-0 bg-white">
        {project ? (
          <iframe
            key={`${project.id}:${iframeKey}`}
            ref={iframeRef}
            title={`preview-${project.id}`}
            src={previewSrc}
            onLoad={() => {
              // Let the embedded SPA router settle before reading location.
              window.setTimeout(() => syncPreviewRouteFromIframe(), 120);
            }}
            className="w-full h-full border-0"
          />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-slate-500 bg-[#0a0f1a]">
            Aucun projet sélectionné
          </div>
        )}
      </div>
      {status && !status.up && project && (
        <div className="px-3 py-2 text-[11px] text-amber-300/90 border-t border-white/10 bg-[#0a0f1a] shrink-0">
          Dev server arrêté. Lance-le avec base=/api/preview/{project.id}/ (voir mds/CANVAS-PREVIEW.md).
        </div>
      )}
    </div>
  );

  const containerManager = (hint) => (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex items-center gap-2 px-2 py-1.5 border-b border-white/10 shrink-0">
        <PickerMenu
          value={selectedContainer}
          onChange={setSelectedContainer}
          options={containers.map((c) => ({
            value: c.name,
            label: c.name,
            hint: c.running ? '' : 'arrêté',
            disabled: !c.running || !c.port,
          }))}
          placeholder="Choisir un navigateur…"
          emptyLabel="Aucun conteneur"
          className="flex-1 min-w-0"
        />
        <button type="button" onClick={loadContainers} className="btn-icon" title="Rafraîchir" aria-label="Rafraîchir">
          <RefreshCw size={14} className={containerBusy ? 'animate-spin' : ''} />
        </button>
        <button
          type="button"
          onClick={handleRebuild}
          disabled={containerBusy}
          className="btn-icon"
          title="Recréer le conteneur à neuf (rebuild)"
          aria-label="Rebuild"
        >
          <RotateCcw size={14} className={containerBusy ? 'animate-spin' : ''} />
        </button>
        {activeContainer && (
          <button
            type="button"
            onClick={() => handleStopContainer(activeContainer.name)}
            disabled={containerBusy}
            className="btn-icon text-slate-400 hover:text-red-400"
            title="Arrêter le conteneur"
            aria-label="Arrêter"
          >
            <Square size={13} />
          </button>
        )}
        <button
          type="button"
          onClick={handleStartNeko}
          disabled={containerBusy}
          className="inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg bg-brand-600/80 hover:bg-brand-600 text-white transition disabled:opacity-50"
          title="Lancer un navigateur Neko (conteneur)"
        >
          <Plus size={13} /> Neko
        </button>
      </div>
      <p className="px-3 py-1.5 text-[11px] text-slate-500 border-b border-white/10 shrink-0">{hint}</p>
      <div className="flex-1 min-h-0 bg-white">
        {activeContainer ? (
          <iframe
            key={activeContainer.name + (activeContainer.loginQuery || '')}
            title={`browser-${activeContainer.name}`}
            src={browserProxyUrl(activeContainer.name, activeContainer.loginQuery)}
            className="w-full h-full border-0"
            allow="autoplay; microphone; camera; clipboard-read; clipboard-write"
          />
        ) : (
          <div className="h-full flex items-center justify-center text-sm text-slate-500 bg-[#0a0f1a] text-center px-6">
            Aucun conteneur navigateur actif.<br />Lance-en un avec « Neko ».
          </div>
        )}
      </div>
    </div>
  );

  const setTabPersist = (id) => {
    setTab(id);
    if (isDesktopLayout()) saveWorkspaceTab(id);
  };

  // Mobile: full-screen overlay only when opened.
  if (!open && !isDesktop) return null;

  // Desktop: folded panel kept mounted (iframe state + route persistence).
  if (!open && isDesktop) {
    return (
      <aside
        aria-hidden
        className="hidden lg:flex flex-col shrink-0 w-0 h-0 overflow-hidden border-0 p-0 m-0 pointer-events-none"
      >
        {tab === 'preview' && previewContent}
      </aside>
    );
  }

  // Mobile/tablet: Preview (turbobash apps) only, WITHOUT tab bar —
  // Debug/Browser (VNC/Neko) are never mounted here, JS decision (not
  // just hidden CSS) to avoid ever loading a video stream on mobile.
  if (!isDesktop) {
    return (
      <div className="lg:hidden fixed inset-0 z-50 flex flex-col bg-[#0a0f1a]">
        <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10 shrink-0">
          <MonitorPlay size={16} className="text-brand-300 shrink-0" />
          <span className="text-sm font-medium text-white">Aperçu</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
            aria-label="Fermer le panneau"
          >
            <X size={18} />
          </button>
        </div>
        {previewContent}
      </div>
    );
  }

  return (
    <aside className="hidden lg:flex flex-col shrink-0 w-[34rem] xl:w-[40rem] border-l border-white/10 bg-[#0a0f1a]/95">
      {/* Tab bar — desktop only */}
      <div className="flex items-center gap-1 px-2 py-1.5 border-b border-white/10 shrink-0">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTabPersist(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              tab === id
                ? 'bg-brand-600/25 border border-brand-500/40 text-white'
                : 'border border-transparent text-slate-400 hover:bg-white/5 hover:text-slate-200'
            }`}
          >
            <Icon size={14} className="shrink-0" />
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={onClose}
          className="ml-auto p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/10"
          aria-label="Fermer le panneau"
        >
          <X size={16} />
        </button>
      </div>

      {tab === 'preview' && previewContent}

      {tab === 'debug' && containerManager(
        'Debug : conteneur navigateur où l’agent agit et tu observes / reprends la main.',
      )}

      {tab === 'browser' && containerManager(
        'Navigateur quotidien (sessions connectées : webmail, LinkedIn, boutique…). Neko passe le son.',
      )}
    </aside>
  );
}
