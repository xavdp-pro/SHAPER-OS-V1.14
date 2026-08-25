import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ArrowDown, Bot, Folder, FolderArchive, Pause, LogOut, PanelLeft, PanelRight, Plus, RefreshCw, RotateCcw, ScrollText, Search, Shield, Square, Trash2, X } from 'lucide-react';

const genId = () => (typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : 'id_' + Math.random().toString(36).slice(2) + Date.now().toString(36));
import ChatInput from '../components/ChatInput.jsx';
import ShaperConversationCreator from '../components/ShaperConversationCreator.jsx';
import ConversationListItem, { sessionTriple } from '../components/ConversationListItem.jsx';
import HeaderActionsMenu from '../components/HeaderActionsMenu.jsx';
import RunTimeline from '../components/RunTimeline.jsx';
import WelcomeEmpty from '../components/WelcomeEmpty.jsx';
import DeliverablesPanel from '../components/DeliverablesPanel.jsx';
import WorkspacePanel from '../components/WorkspacePanel.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  getStatus, injectMessage, getConversations,
  getTimeline, resetCliSession, stopCliRun,
  openEventStream, openConsoleSyncStream, postVoicePreview, getHelmClientId, setActiveConversation, getActiveConversation,
  exportConversation, deleteConversation, renameConversation, setConversationFolder, archiveConversation,
} from '../api/client.js';
import {
  applyStreamEvent, abortRunningRuns, convNameFromPath, isStreaming, pushHuman,
  shouldReplaceTimelineAfterComplete,
  insertVoiceAck, mergeTimelinesPreferVoiceAck, isEmptyRunShell, settlePrimeRunsBeforeTurn,
  isPresentationRunning, prepareResendFromHuman, sanitizeTimeline, normalizeTimelineItems,
} from '../lib/runStream.js';
import {
  pathsMatchConversation,
  parseConversationPath,
  rememberLocalConversation,
  forgetLocalConversation,
  loadLocalConversationPaths,
  conversationEntryFromPath,
  conversationPathToUrl,
  conversationPathFromLocation,
  resolveConversationFromUrl,
} from '../lib/paths.js';
import { loadViewFilters, toggleViewFilter } from '../lib/viewFilters.js';
import { loadCursorPureMode, saveCursorPureMode } from '../lib/cursorPureMode.js';
import { loadTimelinePagination, setTimelinePaginationPreference } from '../lib/timelineLimit.js';
import { loadInteractionMode, saveInteractionMode } from '../lib/interactionMode.js';
import {
  isDesktopLayout,
  loadSidebarOpen,
  loadWorkspaceOpen,
  registerAddedVibeProject,
  saveSidebarOpen,
  saveWorkspaceOpen,
} from '../lib/desktopLayoutPrefs.js';
import { useChatVoice } from '../hooks/useChatVoice.js';
import { useSessionPresentation } from '../hooks/useSessionPresentation.js';
import { usePullToRefresh } from '../hooks/usePullToRefresh.js';
import { useWakeLock } from '../hooks/useWakeLock.js';
import { useAppBootstrap } from '../hooks/useAppBootstrap.js';
import { canAccessDemoBriefingAdmin, canAccessDemoVoicesAdmin } from '../lib/demoAdminAccess.js';
import {
  getCompletedPrimeRun,
  getPrimeAssistantBlock,
  HELP_NUDGE_AUTO_DISMISS_MS,
  isHelpHighlightAllowed,
  isHelpNudgeSeen,
  isPresentationActive,
  isPrimeVoicePending,
  markHelpNudgeSeen,
  shouldAutoSpeakPresentation,
} from '../lib/sessionPresentation.js';
import LanguageSelector from '../components/LanguageSelector.jsx';
import InteractionModeSelector from '../components/InteractionModeSelector.jsx';
import DriveDeck from '../components/DriveDeck.jsx';
import PwaInstallBanner from '../components/PwaInstallBanner.jsx';
import ConsoleHelpOverlay, { ConsoleHelpButton } from '../components/ConsoleHelpOverlay.jsx';
import ActiveModelLabel from '../components/ActiveModelLabel.jsx';
import { useLocale } from '../context/LocaleContext.jsx';
import { useSettings } from '../context/SettingsContext.jsx';
import { watchForUpdate } from '../lib/appUpdate.js';

function conversationInScope(pathOrName, scopedName) {
  if (!scopedName) return true;
  const raw = String(pathOrName || '').trim();
  if (!raw) return false;
  if (raw === scopedName) return true;
  if (raw.endsWith(`/${scopedName}`)) return true;
  return convNameFromPath(raw) === scopedName;
}

function mergeConversations(serverList = [], scopedName = '') {
  const byPath = new Map();
  for (const c of serverList) {
    const path = c.path || c.id;
    if (!path) continue;
    if (scopedName && !conversationInScope(path, scopedName)) continue;
    byPath.set(path, c);
  }
  for (const path of loadLocalConversationPaths()) {
    if (scopedName && !conversationInScope(path, scopedName)) continue;
    if (!byPath.has(path)) byPath.set(path, conversationEntryFromPath(path));
  }
  return [...byPath.values()].sort((a, b) => {
    const ta = a.last_used_at || a.created_at || '';
    const tb = b.last_used_at || b.created_at || '';
    return tb.localeCompare(ta);
  });
}

function normalizeNodes(raw = [], status) {
  if (!raw.length) {
    return [{
      name: status?.node || 'local',
      user: status?.user || 'zaza',
    }];
  }
  return raw.map((n) => (
    typeof n === 'string'
      ? { name: n, user: status?.user || 'zaza' }
      : { name: n.name, user: n.user || status?.user || 'zaza' }
  ));
}

export default function Dashboard() {
  const navigate = useNavigate();
  const location = useLocation();
  const { logout, user } = useAuth();
  const { isDemo } = useAppBootstrap();
  const isAdmin = user?.role === 'admin';
  const demoVoicesAdmin = canAccessDemoVoicesAdmin(user, isDemo);
  const demoBriefingAdmin = canAccessDemoBriefingAdmin(user, isDemo);
  const scopedConversation = (
    !isAdmin && String(user?.preferredConversation || '').trim()
  ) || '';
  const { pushToast } = useToast();
  const { t, setLocale } = useLocale();
  const { appName, agentName, agentPlugin } = useSettings();
  const [status, setStatus] = useState(null);
  const [polling, setPolling] = useState(false);
  const [draft, setDraft] = useState('');
  const [conversations, setConversations] = useState([]);
  const [activePath, setActivePath] = useState('');
  const [sending, setSending] = useState(false);
  const [nodes, setNodes] = useState([]);
  const [timelines, setTimelines] = useState({});
  const [sidebarOpen, setSidebarOpen] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
      ? loadSidebarOpen()
      : false
  ));
  const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches
      ? loadWorkspaceOpen()
      : false
  ));
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [sidebarTab, setSidebarTab] = useState('active'); // 'active' | 'archived'
  const [sidebarSearch, setSidebarSearch] = useState('');
  const [folders, setFolders] = useState(['Général']);
  const [selectedFolder, setSelectedFolder] = useState('all'); // 'all' | folderName
  const [purgeAttachmentsOnDelete, setPurgeAttachmentsOnDelete] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpNudge, setHelpNudge] = useState(false);
  const [helpForceOptions, setHelpForceOptions] = useState(false);
  const [cursorPure, setCursorPure] = useState(() => loadCursorPureMode());
  const [timelinePagination, setTimelinePagination] = useState(() => loadTimelinePagination());
  const [interactionMode, setInteractionMode] = useState(() => loadInteractionMode());
  const armRouteVoiceRef = useRef(() => {});
  const stopPlaybackRef = useRef(() => {});
  const [desktopLayout, setDesktopLayout] = useState(() => isDesktopLayout());

  useEffect(() => {
    const mq = window.matchMedia('(min-width: 1024px)');
    const sync = () => setDesktopLayout(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  const setMobileMode = useCallback((next) => {
    setInteractionMode(next);
    saveInteractionMode(next);
    if (next === 'route') armRouteVoiceRef.current?.();
  }, []);

  const hideChatVisual = interactionMode === 'route' || interactionMode === 'remote';
  const [remoteDictation, setRemoteDictation] = useState('');
  const primedRunIdRef = useRef('');
  const presentationSpokenRef = useRef('');
  const wasPresentingRef = useRef(false);
  const presentationWasActiveRef = useRef(false);
  const briefingLiveInSessionRef = useRef(false);
  const helpNudgeTimerRef = useRef(0);
  const [clearing, setClearing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [copying, setCopying] = useState(false);
  // Simple mode by default for non-admins (response only) — configurable via filters.
  const [viewFilters, setViewFilters] = useState(() => loadViewFilters(user?.role));
  const activeRef = useRef(activePath);
  const timelinesRef = useRef(timelines);
  const saveEpochRef = useRef(0);
  /** Server updated_at per conversation — stale tabs cannot overwrite after clear. */
  const timelineUpdatedAtRef = useRef({});
  const suppressSaveUntilRef = useRef(0);
  /** Ignore bridge SSE timeline mutations briefly after clear (prime init must not repopulate). */
  const suppressStreamUntilRef = useRef(0);
  const scrollRef = useRef(null);
  const chatContentRef = useRef(null);
  const endSentinelRef = useRef(null);
  const stickBottomRef = useRef(true);
  const karaokeScrollLockRef = useRef(false);
  const stickBeforeKaraokeRef = useRef(true);
  const wasKaraokeLockedRef = useRef(false);
  const [atBottom, setAtBottom] = useState(true);
  const lastScrollTopRef = useRef(0);
  const [composerH, setComposerH] = useState(100);

  const NEAR_BOTTOM_PX = 140;
  const programmaticScrollUntilRef = useRef(0);
  const followPausedRef = useRef(false);

  const isNearBottom = useCallback((el) => {
    if (!el) return true;
    return el.scrollHeight - el.scrollTop - el.clientHeight <= NEAR_BOTTOM_PX;
  }, []);

  const markProgrammaticScroll = useCallback(() => {
    programmaticScrollUntilRef.current = Date.now() + 280;
  }, []);

  const snapToBottom = useCallback((behavior = 'auto', { force = false } = {}) => {
    const el = scrollRef.current;
    if (!el || !stickBottomRef.current) return;
    if (!force && karaokeScrollLockRef.current) return;
    markProgrammaticScroll();
    if (behavior === 'smooth') el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
    else el.scrollTop = el.scrollHeight;
    lastScrollTopRef.current = el.scrollTop;
  }, [markProgrammaticScroll]);

  const scrollToBottom = useCallback((behavior = 'smooth') => {
    followPausedRef.current = false;
    followPausedRef.current = false;
    stickBottomRef.current = true;
    setAtBottom(true);
    snapToBottom(behavior, { force: true });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => snapToBottom('auto', { force: true }));
    });
  }, [snapToBottom]);

  const pauseFollow = useCallback(() => {
    followPausedRef.current = true;
    stickBottomRef.current = false;
    setAtBottom(false);
  }, []);

  const onChatScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    lastScrollTopRef.current = el.scrollTop;

    // Programmatic snaps must not unhook follow (that was the jitter loop).
    if (Date.now() < programmaticScrollUntilRef.current) return;

    const near = isNearBottom(el);

    if (followPausedRef.current) {
      if (!near) followPausedRef.current = false;
      return;
    }

    if (near) {
      if (!stickBottomRef.current) {
        followPausedRef.current = false;
    stickBottomRef.current = true;
        setAtBottom(true);
      }
      return;
    }

    if (stickBottomRef.current) {
      stickBottomRef.current = false;
      setAtBottom(false);
    }
  }, [isNearBottom]);

  const softReloadRef = useRef(() => {});

  const reloadPage = useCallback(() => {
    softReloadRef.current();
  }, []);

  const { pullPx, armed: pullArmed, pulling: pullActive, bindScrollRef } = usePullToRefresh(scrollRef, {
    onRefresh: reloadPage,
  });

  const draftRef = useRef(draft);
  const sendingRef = useRef(sending);
  const stoppingRef = useRef(stopping);
  const streamingRef = useRef(false);
  const urlSyncLockRef = useRef(false);
  const locationPathRef = useRef(location.pathname);
  activeRef.current = activePath;
  timelinesRef.current = timelines;
  draftRef.current = draft;
  sendingRef.current = sending;
  stoppingRef.current = stopping;
  locationPathRef.current = location.pathname;

  const applyServerTimeline = useCallback((path, items, updatedAt, { replace = false } = {}) => {
    if (updatedAt) timelineUpdatedAtRef.current[path] = updatedAt;
    const serverItems = Array.isArray(items) ? items : [];
    const local = timelinesRef.current[path] || [];
    const mergedRaw = replace
      ? normalizeTimelineItems(serverItems)
      : mergeTimelinesPreferVoiceAck(local, serverItems);
    const nextItems = normalizeTimelineItems(mergedRaw);
    const merged = { ...timelinesRef.current, [path]: nextItems };
    timelinesRef.current = merged;
    setTimelines(merged);
  }, []);

  /**
   * The server (timelineBuilder + orchestrator + routes inject/session) is
   * now the ONLY writer to the timeline, and broadcasts `timeline_sync` on every
   * write. The frontend no longer writes: it displays in memory (setTimelines) and
   * converges via server replay (end of run, timeline_sync). Kept
   * as a no-op so legacy call sites remain untouched.
   */
  const persistTimeline = useCallback(async () => ({ ok: true, skipped: true }), []);

  const {
    primedPathsRef,
    clearSession,
    maybePrimeEmpty,
    mergeOnSelect,
  } = useSessionPresentation({
    timelinesRef,
    setTimelines,
    timelineUpdatedAtRef,
    applyServerTimeline,
    persistTimeline,
    saveEpochRef,
    suppressSaveUntilRef,
    suppressStreamUntilRef,
    pushToast,
    t,
  });

  const maybePrimeIfNeeded = useCallback((path, items) => {
    if (cursorPure) return;
    maybePrimeEmpty(path, items);
  }, [cursorPure, maybePrimeEmpty]);

  const toggleCursorPure = useCallback(() => {
    setCursorPure((prev) => {
      const next = !prev;
      saveCursorPureMode(next);
      return next;
    });
  }, []);

  const handleSendRef = useRef(async () => {});
  const handleStopCliRef = useRef(async () => {});
  const handleClearConversationRef = useRef(async () => {});
  const beginVoiceSendRef = useRef(() => false);
  const finishVoiceSendRef = useRef(async () => {});
  const abortVoiceSendRef = useRef(() => {});
  const voiceResponseGateRef = useRef({ blocked: false, events: [] });

  const getPresentationActive = useCallback(() => {
    const path = activeRef.current;
    if (!path) return false;
    return isPresentationRunning(timelinesRef.current[path] || []);
  }, []);

  const applyBridgeEvent = useCallback((event) => {
    if (Date.now() < suppressStreamUntilRef.current) {
      const path = activeRef.current;
      const items = timelinesRef.current[path] || [];
      if (!isPresentationRunning(items)) return;
    }
    setTimelines((prev) => {
      const path = activeRef.current;
      // Prefer ref so a voice_ack inserted between renders is not wiped by SSE.
      const base = timelinesRef.current[path] || prev[path] || [];
      const streamed = sanitizeTimeline(applyStreamEvent(base, event));
      // `streamed` contains the event update; only use `base` to re-inject
      // a local Groq ack that the bridge cannot know about.
      const next = mergeTimelinesPreferVoiceAck(streamed, base);
      const merged = { ...prev, [path]: next };
      timelinesRef.current = merged;
      return merged;
    });
  }, []);

  const setVoiceResponseGate = useCallback((open) => {
    const gate = voiceResponseGateRef.current;
    if (!open) {
      gate.blocked = true;
      return;
    }
    gate.blocked = false;
    const pending = gate.events.splice(0);
    for (const event of pending) applyBridgeEvent(event);
  }, [applyBridgeEvent]);

  const handleVoiceAck = useCallback((ackText) => {
    const path = activeRef.current;
    if (!path || !ackText) return;
    // Sync ref first so finishVoiceSend / SSE cannot drop the ack before React flushes.
    const current = timelinesRef.current[path] || [];
    const next = insertVoiceAck(current, ackText);
    if (next === current) return;
    const merged = { ...timelinesRef.current, [path]: next };
    timelinesRef.current = merged;
    setTimelines(merged);
    const t = String(ackText).trim();
    // Placeholder only — wait for Groq text before persisting (avoids racing human-only saves).
    if (t !== '…' && t !== '...') {
      void persistTimeline(path, next);
    }
  }, [persistTimeline]);

  const {
    playbackOn: voicePlaybackOn,
    togglePlayback: toggleVoicePlayback,
    karaokeOn,
    karaokeSupported,
    toggleKaraoke,
    micLive: voiceMicLive,
    micPhase: voiceMicPhase,
    micArmLeftMs: voiceMicArmLeftMs,
    toggleMic: toggleVoiceMic,
    configured: voiceConfigured,
    groqAck,
    submitVoiceMessage,
    busy: voiceBusy,
    playing: voicePlaying,
    paused: voicePaused,
    voicePreview,
    karaokeWords,
    karaokeIndex,
    karaokeGrain,
    activeReplayId,
    replaySpeech,
    pausePlayback,
    resumePlayback,
    togglePause,
    stopPlayback,
    clearComposerDraft,
    applyComposerDraft,
    beginTypedEdit,
    endTypedEdit,
    handleVoiceEvent,
    armRouteVoice,
    prepareForPresentation,
    primeLiveTtsRef,
    presentationLiveTtsRef,
    primeTtsSpokeRef,
  } = useChatVoice({
    interactionMode,
    desktopLayout,
    onSend: (text, imgs) => handleSendRef.current(text, imgs),
    onBeginVoiceSend: (text) => beginVoiceSendRef.current(text),
    onFinishVoiceSend: (text, opts) => finishVoiceSendRef.current(text, opts),
    onAbortVoiceSend: () => abortVoiceSendRef.current(),
    onVoiceStop: () => { void handleStopCliRef.current?.(); },
    onVoiceReborn: () => { void handleClearConversationRef.current?.(); },
    onVoiceResponseGate: setVoiceResponseGate,
    onVoiceAck: handleVoiceAck,
    setDraft,
    getDraft: () => draftRef.current,
    canSend: () => (
      Boolean(activeRef.current)
      && !sendingRef.current
      && !stoppingRef.current
      && !streamingRef.current
    ),
    getAgentBusy: () => (
      sendingRef.current || stoppingRef.current || streamingRef.current
    ),
    getPresentationActive,
    pushToast,
    cursorPure,
  });
  armRouteVoiceRef.current = armRouteVoice;
  stopPlaybackRef.current = stopPlayback;

  // Keep the bridge SSE connection alive while voice playback state changes.
  const handleVoiceEventRef = useRef(handleVoiceEvent);
  handleVoiceEventRef.current = handleVoiceEvent;

  const karaokeScrollLocked = Boolean(karaokeOn && karaokeWords.length > 0);
  karaokeScrollLockRef.current = karaokeScrollLocked;

  // Memoized: otherwise the inline .find() returns a new value on each keystroke
  // and breaks the memoization of <RunTimeline>.
  const activeWorkspaceCwd = useMemo(
    () => conversations.find((c) => (c.path || c.id) === activePath)?.cwd || '',
    [conversations, activePath],
  );

  useEffect(() => {
    if (!isDesktopLayout()) return;
    saveSidebarOpen(sidebarOpen);
  }, [sidebarOpen]);

  useEffect(() => {
    if (!isDesktopLayout()) return;
    saveWorkspaceOpen(workspaceOpen);
  }, [workspaceOpen]);

  useEffect(() => {
    if (karaokeScrollLocked && !wasKaraokeLockedRef.current) {
      stickBeforeKaraokeRef.current = stickBottomRef.current;
    }
    if (!karaokeScrollLocked && wasKaraokeLockedRef.current) {
      if (stickBeforeKaraokeRef.current) {
        followPausedRef.current = false;
    stickBottomRef.current = true;
        setAtBottom(true);
        requestAnimationFrame(() => {
          if (!karaokeScrollLockRef.current) snapToBottom('auto');
        });
      }
    }
    wasKaraokeLockedRef.current = karaokeScrollLocked;
  }, [karaokeScrollLocked, snapToBottom]);

  const selectConversation = useCallback(async (path, { reload, replaceUrl = false } = {}) => {
    if (!path) return;
    const isSwitch = path !== activeRef.current;
    followPausedRef.current = false;
    stickBottomRef.current = true;
    setAtBottom(true);
    setActiveConversation(path);
    setActivePath(path);

    const targetUrl = conversationPathToUrl(path);
    if (locationPathRef.current !== targetUrl) {
      urlSyncLockRef.current = true;
      navigate(targetUrl, { replace: replaceUrl });
      queueMicrotask(() => { urlSyncLockRef.current = false; });
    }

    // Keep timeline in memory if same conversation (avoids wiping freshly sent message)
    if (!isSwitch && !reload && (timelinesRef.current[path]?.length ?? 0) > 0) {
      maybePrimeIfNeeded(path, timelinesRef.current[path]);
      return;
    }

    const local = timelinesRef.current[path] || [];
    const { ok, data } = await getTimeline();
    let items = local;
    if (ok && Array.isArray(data?.items)) {
      if (data.updated_at) timelineUpdatedAtRef.current[path] = data.updated_at;
      items = mergeOnSelect(local, data.items, path, activeRef.current);
      const merged = { ...timelinesRef.current, [path]: items };
      timelinesRef.current = merged;
      setTimelines(merged);
    } else if (!timelinesRef.current[path]) {
      items = [];
      setTimelines((prev) => ({ ...prev, [path]: [] }));
    }

    maybePrimeIfNeeded(path, items);
  }, [navigate, mergeOnSelect, maybePrimeIfNeeded]);

  const toggleTimelinePagination = useCallback(() => {
    setTimelinePagination((prev) => {
      const next = !prev;
      setTimelinePaginationPreference(next);
      if (activeRef.current) {
        void selectConversation(activeRef.current, { reload: true });
      }
      return next;
    });
  }, [selectConversation]);

  const refresh = useCallback(async () => {
    setPolling(true);
    const conv = await getConversations();
    const { ok: stOk, data: stData } = await getStatus();
    if (stOk) setStatus(stData);

    if (conv.ok) {
      // Scope filter = non-admin guests only. Preferred = landing session for everyone.
      const preferred = String(user?.preferredConversation || '').trim();
      const merged = mergeConversations(
        conv.data?.conversations || [],
        scopedConversation,
      );
      // Admins with a preferred session: ensure it appears even if bridge has not registered it.
      if (preferred && !scopedConversation) {
        const hasPreferred = merged.some((c) => conversationInScope(c.path || c.id, preferred));
        if (!hasPreferred) {
          const nodeList = conv.data?.nodes || [];
          const node = nodeList[0] || { name: 'cursor', user: 'zaza' };
          const path = `${node.name || 'cursor'}/${node.user || 'zaza'}/${preferred}`;
          merged.unshift(conversationEntryFromPath(path));
        }
      }
      setConversations(merged);
      if (Array.isArray(conv.data?.folders) && conv.data.folders.length) {
        setFolders(conv.data.folders);
      }
      setNodes(normalizeNodes(conv.data?.nodes, stData));
      const paths = merged.map((c) => c.path || c.id);
      const pathname = locationPathRef.current;
      let fromUrl = resolveConversationFromUrl(
        conversationPathFromLocation(pathname),
        paths,
      );
      // Demo / guest users cannot open another user's session via URL.
      if (fromUrl && scopedConversation && !conversationInScope(fromUrl, scopedConversation)) {
        fromUrl = '';
      }
      const current = getActiveConversation();
      const preferredPath = preferred
        ? paths.find((p) => conversationInScope(p, preferred))
        : null;

      if (fromUrl) {
        if (fromUrl !== current) selectConversation(fromUrl, { replaceUrl: true });
      } else if (scopedConversation && current && !conversationInScope(current, scopedConversation)) {
        if (preferredPath) selectConversation(preferredPath, { replaceUrl: true });
        else if (paths[0]) selectConversation(paths[0], { replaceUrl: true });
      } else if (!current) {
        if (preferredPath) selectConversation(preferredPath, { replaceUrl: true });
        else if (paths[0]) selectConversation(paths[0], { replaceUrl: true });
      } else {
        const exact = paths.find((p) => p === current);
        const migrated = paths.find((p) => pathsMatchConversation(p, current));
        if (!exact && migrated) selectConversation(migrated, { replaceUrl: true });
        else if (!exact && !migrated && (preferredPath || paths[0])) {
          selectConversation(preferredPath || paths[0], { replaceUrl: true });
        } else if (exact && conversationPathToUrl(exact) !== pathname) {
          selectConversation(exact, { replaceUrl: true });
        }
      }
    }
    setPolling(false);
  }, [selectConversation, user?.preferredConversation, scopedConversation]);

  softReloadRef.current = () => {
    if (activeRef.current) {
      void selectConversation(activeRef.current, { reload: true });
    }
    void refresh();
  };

  const refreshStatus = useCallback(async () => {
    if (!getActiveConversation()) return;
    const { ok, data } = await getStatus();
    if (ok) setStatus(data);
  }, []);

  const bridgeConnected = Boolean(status?.reachable && status?.ready);
  const bridgeStatusTitle = !activePath
    ? ''
    : polling && !status
      ? 'Vérification de la connexion…'
      : bridgeConnected
        ? `Bridge connecté (${status.node})`
        : status?.reachable
          ? 'Bridge joignable — cursor-agent non prêt'
          : 'Bridge injoignable';

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  // Browser back/forward → open conversation from URL
  useEffect(() => {
    if (urlSyncLockRef.current) return;
    const fromUrl = conversationPathFromLocation(location.pathname);
    if (!fromUrl) return;
    if (fromUrl === activeRef.current || pathsMatchConversation(fromUrl, activeRef.current)) {
      return;
    }
    void selectConversation(fromUrl, { replaceUrl: true });
  }, [location.pathname, selectConversation]);

  // Bookmark-friendly tab title
  useEffect(() => {
    const base = String(appName || 'KovZu').trim() || 'KovZu';
    if (!activePath) {
      document.title = base;
      return undefined;
    }
    const t3 = sessionTriple(conversations.find((c) => (c.path || c.id) === activePath) || activePath);
    document.title = `${t3.machineLabel}/${t3.user}/${t3.label} · ${base}`;
    return () => { document.title = base; };
  }, [activePath, appName, conversations]);

  useEffect(() => {
    if (!activePath) return undefined;
    setActiveConversation(activePath);
    refreshStatus();

    const close = openEventStream((event) => {
      const path = activeRef.current;
      const activeName = convNameFromPath(path);
      if (event.conversation && activeName && event.conversation !== activeName) return;

      const gate = voiceResponseGateRef.current;
      if (gate.blocked && event.type !== 'ping' && event.type !== 'connected') {
        gate.events.push(event);
      } else {
        applyBridgeEvent(event);
      }

      // End of turn — converge on the timeline built by the server.
      if (event.type === 'response_complete' || event.type === 'run_complete') {
        const donePath = activeRef.current;
        setTimeout(() => {
          if (activeRef.current !== donePath) return;
          if (streamingRef.current) return;
          void (async () => {
            const prevConv = getActiveConversation();
            setActiveConversation(donePath);
            const { ok, data } = await getTimeline();
            setActiveConversation(prevConv);
            if (!ok) return;
            const serverItems = Array.isArray(data?.items) ? data.items : [];
            const localItems = timelinesRef.current[donePath] || [];
            applyServerTimeline(
              donePath,
              serverItems,
              data?.updated_at,
              {
                replace: shouldReplaceTimelineAfterComplete(localItems, serverItems),
              },
            );
          })();
        }, 1200);
      }

      void handleVoiceEventRef.current(event);
    });
    return close;
  }, [activePath, agentPlugin, applyBridgeEvent, refreshStatus, applyServerTimeline]);

  /** Other browsers/tabs: reload timeline when conversation is cleared or saved remotely. */
  useEffect(() => {
    if (!activePath) return undefined;
    setActiveConversation(activePath);

    const close = openConsoleSyncStream((event) => {
      if (!event || event.type === 'ping' || event.type === 'connected') return;
      if (event.type === 'voice_preview') {
        if (event.clientId && event.clientId === getHelmClientId()) return;
        setRemoteDictation(String(event.text || ''));
        return;
      }
      if (event.type === 'locale') {
        if (event.clientId && event.clientId === getHelmClientId()) return;
        setLocale(event.locale, { broadcast: false });
        return;
      }
      if (event.type === 'conversation_model_change') {
        if (event.clientId && event.clientId === getHelmClientId()) return;
        if (event.conversation && event.model) {
          setConversations((prev) =>
            prev.map((c) => ((c.path || c.id) === event.conversation ? { ...c, model: event.model } : c))
          );
        }
        return;
      }
      if (event.type === 'session_reborn') {
        if (event.clientId && event.clientId === getHelmClientId()) return;
        pushToast(t('clear.remoteAlert'), { type: 'info', duration: 10000 });
        try {
          if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
            new Notification(t('clear.remoteNotifTitle'), {
              body: t('clear.remoteAlert'),
              tag: 'helm-reborn',
            });
          }
        } catch { /* ignore */ }
        // fall through to timeline reload
      } else if (event.type !== 'timeline_sync') {
        return;
      }

      const path = activeRef.current;
      if (event.conversation && event.conversation !== path) return;

      saveEpochRef.current += 1;

      if (event.updated_at) timelineUpdatedAtRef.current[path] = event.updated_at;

      void (async () => {
        // Always re-fetch. clear+prime is orchestrated: a bare cleared:true must not
        // leave this tab empty (that wiped the briefing ~every clear).
        suppressSaveUntilRef.current = Date.now() + (event.cleared ? 8000 : 3000);
        const prevConv = getActiveConversation();
        setActiveConversation(path);
        const { ok, data } = await getTimeline();
        setActiveConversation(prevConv);
        if (!ok) return;

        const items = Array.isArray(data?.items) ? data.items : [];
        const freshPrime = items.length === 1
          && items[0]?.type === 'run'
          && items[0]?.prime;
        const idleFollower = !streamingRef.current;
        applyServerTimeline(
          path,
          items,
          data?.updated_at || event.updated_at,
          {
            replace: Boolean(event.cleared)
              || Boolean(event.primed)
              || freshPrime
              || items.length === 0
              || idleFollower,
          },
        );
        if (event.cleared || event.primed || items.length === 0) {
          primedPathsRef.current.delete(path);
        }
        maybePrimeIfNeeded(path, items);
      })();
    });

    return close;
  }, [activePath, applyServerTimeline, maybePrimeIfNeeded, pushToast, t, setLocale]);


  useEffect(() => {
    if (desktopLayout || !activePath) return undefined;
    if (interactionMode !== 'remote' && interactionMode !== 'route') return undefined;
    const handle = window.setTimeout(() => {
      void postVoicePreview({ conversation: activePath, text: voicePreview || '', mode: interactionMode });
    }, 90);
    return () => window.clearTimeout(handle);
  }, [voicePreview, interactionMode, desktopLayout, activePath]);

  const persistTimelineRef = useRef(persistTimeline);
  persistTimelineRef.current = persistTimeline;

  const handleSend = async (text, pendingImages = []) => {
    if (!activePath) return;
    if (!text.trim() && !pendingImages.length) return;

    const previewImages = pendingImages.map((img) => ({
      id: img.id,
      url: img.dataUrl,
      name: img.name,
      kind: img.kind || 'image',
    }));

    setSending(true);
    const path = activePath;
    const settled = settlePrimeRunsBeforeTurn(timelinesRef.current[path] || []);
    // Same IDs locally and on server — inject writes server turn.
    const { timeline, runId, humanId } = pushHuman(settled, text, previewImages);
    const nextTimelines = { ...timelinesRef.current, [path]: timeline };
    timelinesRef.current = nextTimelines;
    setTimelines(nextTimelines);
    setDraft('');
    setActiveConversation(path);
    void persistTimeline(path, timeline);

    const uploadedPaths = pendingImages
      .filter((img) => img.uploadStatus === 'ready' && img.rel)
      .map((img) => img.rel);
    if (pendingImages.length && uploadedPaths.length !== pendingImages.length) {
      setSending(false);
      pushToast(t('chat.attach.notReady'), { type: 'error', duration: 8000 });
      return;
    }

    const { ok, data } = await injectMessage(text, uploadedPaths, {
      turn: { humanId, runId, images: previewImages },
    });
    setSending(false);
    if (ok) {
      pushToast(`${t('toast.sentTo')} ${activePath}`, { type: 'success' });
      refreshStatus();
      // Dynamic rename on 1st message if session has a generic name
      const userMessageCount = (timelinesRef.current[path] || []).filter((m) => m.type === 'human').length;
      const isGeneric = !path || path.startsWith('Session-') || path.toLowerCase().includes('nouvelle session') || path === 'Administrateur';
      if (userMessageCount <= 1 && isGeneric && text.trim()) {
        const dynamicTitle = text.trim().replace(/[#*`_>]/g, '').split('\n')[0].slice(0, 36).trim();
        if (dynamicTitle && dynamicTitle !== path) {
          setTimeout(() => handleRenameConversation(path, dynamicTitle), 500);
        }
      }
    } else {
      const err = data?.error || data?.detail || t('toast.sendFailed');
      setTimelines((prev) => ({
        ...prev,
        [activePath]: [
          ...(prev[activePath] || []),
          { type: 'system', id: genId(), text: err },
        ],
      }));
      pushToast(err, { type: 'error', duration: 8000 });
    }
  };
  handleSendRef.current = handleSend;

  /** Pure Direct Chat Send to OpenCode / Maker Agent */
  const handleComposerSend = (text, pendingImages = []) => {
    followPausedRef.current = false;
    stickBottomRef.current = true;
    setAtBottom(true);
    void handleSend(text, pendingImages);
  };

  /** ID of current voice turn human message — sent to server upon inject. */
  const voiceTurnHumanIdRef = useRef('');

  /** Voice turn step 1: human only (no Composer run yet) so Groq ack can sit between. */
  beginVoiceSendRef.current = (text) => {
    const path = activeRef.current;
    if (!path || !String(text || '').trim()) return false;
    // Voice turn owns its own lane — only block stop-in-progress, not prior stream display.
    if (sendingRef.current || stoppingRef.current) return false;

    sendingRef.current = true;
    setSending(true);
    const settled = settlePrimeRunsBeforeTurn(timelinesRef.current[path] || []);
    const human = {
      type: 'human',
      id: genId(),
      text: String(text).trim(),
      images: [],
      time: Date.now(),
    };
    voiceTurnHumanIdRef.current = human.id;
    const timeline = [...settled, human];
    const nextTimelines = { ...timelinesRef.current, [path]: timeline };
    timelinesRef.current = nextTimelines;
    setTimelines(nextTimelines);
    setDraft('');
    setActiveConversation(path);
    void persistTimeline(path, timeline);
    return true;
  };

  abortVoiceSendRef.current = () => {
    sendingRef.current = false;
    setSending(false);
  };

  /** Voice turn step 3: open Composer run + inject (only after Groq ack lane). */
  finishVoiceSendRef.current = async (text, opts = {}) => {
    const path = activeRef.current;
    if (!path) {
      sendingRef.current = false;
      setSending(false);
      return;
    }

    const ackText = String(opts.ackText || '').trim();
    const runId = genId();
    const run = {
      type: 'run',
      id: runId,
      streamId: `pending-${runId}`,
      status: 'running',
      voiceTurn: true,
      blocks: [],
      time: Date.now(),
    };

    try {
      // Preserve voice_ack (human → ack → run); re-insert if a race wiped it.
      let base = timelinesRef.current[path] || [];
      if (ackText) base = insertVoiceAck(base, ackText);
      const orphanRun = [...base].reverse().find((it) => (
        it.type === 'run' && !it.prime && it.status === 'running' && isEmptyRunShell(it)
      ));
      let timeline;
      let activeRunId = runId;
      if (orphanRun) {
        activeRunId = orphanRun.id;
        timeline = base.map((it) => (
          it.id === orphanRun.id
            ? {
              ...it,
              voiceTurn: true,
              streamId: it.streamId || run.streamId,
              time: it.time || run.time,
            }
            : it
        ));
      } else {
        timeline = [...base, run];
      }
      const nextTimelines = { ...timelinesRef.current, [path]: timeline };
      timelinesRef.current = nextTimelines;
      setTimelines(nextTimelines);
      void persistTimelineRef.current(path, timeline);

      const { ok, data } = await injectMessage(String(text || '').trim(), [], {
        voiceTurn: true,
        ackText,
        turn: {
          humanId: voiceTurnHumanIdRef.current,
          runId: activeRunId,
          images: [],
        },
      });
      if (ok) {
        pushToast(`${t('toast.sentTo')} ${path}`, { type: 'success' });
        refreshStatus();
      } else {
        const err = data?.error || data?.detail || t('toast.sendFailed');
        // Remove empty Composer outline — keep human + Groq ack visible.
        setTimelines((prev) => {
          const current = prev[path] || [];
          const withoutEmpty = current.filter((it) => !(it.type === 'run' && it.id === activeRunId));
          const aborted = withoutEmpty.length === current.length
            ? abortRunningRuns(current, err)
            : withoutEmpty;
          const withErr = [
            ...aborted,
            { type: 'system', id: genId(), text: err },
          ];
          const merged = { ...prev, [path]: withErr };
          timelinesRef.current = merged;
          void persistTimelineRef.current(path, withErr);
          return merged;
        });
        pushToast(err, { type: 'error', duration: 8000 });
      }
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const handleEditHuman = async (humanId, newText, images = []) => {
    if (!activePath || sending) return;
    const path = activePath;
    const current = timelinesRef.current[path] || [];

    if (isStreaming(current)) {
      await stopCliRun({ all: true });
      setTimelines((prev) => {
        const merged = { ...prev };
        if (merged[path]) merged[path] = abortRunningRuns(merged[path], 'stopped');
        timelinesRef.current = merged;
        return merged;
      });
    }

    const prepared = prepareResendFromHuman(current, humanId, newText, images);
    if (!prepared.ok) {
      pushToast(t('toast.msgMissing'), { type: 'error' });
      return;
    }

    setSending(true);
    setActiveConversation(path);
    saveEpochRef.current += 1;
    const nextTimelines = { ...timelinesRef.current, [path]: prepared.timeline };
    timelinesRef.current = nextTimelines;
    setTimelines(nextTimelines);
    void persistTimelineRef.current(path, prepared.timeline);

    await resetCliSession();

    // Server truncates its timeline at this message and rebuilds context.
    const { ok, data } = await injectMessage(newText, [], {
      resend: {
        humanId,
        text: newText,
        images,
        runId: prepared.runId,
      },
    });
    setSending(false);
    if (ok) {
      const hint = (data?.hadContext ?? prepared.hadContext) ? ' (contexte précédent inclus)' : '';
      pushToast(`${t('toast.resentFrom')}${hint}`, { type: 'success' });
      refreshStatus();
    } else {
      const err = data?.error || data?.detail || t('toast.resendFailed');
      setTimelines((prev) => ({
        ...prev,
        [path]: [
          ...(prev[path] || []),
          { type: 'system', id: genId(), text: err },
        ],
      }));
      pushToast(err, { type: 'error', duration: 8000 });
    }
  };

  // Stable identity for <RunTimeline> (memoized): handleEditHuman is recreated on
  // each render, which would invalidate the memo on each keystroke in composer.
  const handleEditHumanRef = useRef(handleEditHuman);
  handleEditHumanRef.current = handleEditHuman;
  const handleEditHumanStable = useCallback(
    (humanId, newText, images = []) => handleEditHumanRef.current(humanId, newText, images),
    [],
  );

  const handleReloadConversation = useCallback(async (path) => {
    if (!path) return;
    setPolling(true);
    try {
      await selectConversation(path, { reload: true });
      await refresh();
    } finally {
      setPolling(false);
    }
  }, [selectConversation, refresh]);

  const addConversation = useCallback((payload) => {
    const path = typeof payload === 'string' ? payload : String(payload?.path || '').trim();
    const workspace = typeof payload === 'object' ? String(payload?.workspace || '').trim() : '';
    const warning = typeof payload === 'object' ? String(payload?.warning || '').trim() : '';
    if (!path) return;
    if (scopedConversation && !conversationInScope(path, scopedConversation)) {
      pushToast(t('toast.sessionOtherAccount'), { type: 'error' });
      return;
    }
    rememberLocalConversation(path);
    const entry = {
      ...conversationEntryFromPath(path),
      ...(workspace ? { cwd: workspace, workspace } : {}),
    };
    selectConversation(path);
    setConversations((prev) => {
      const rest = prev.filter((c) => (c.path || c.id) !== path);
      return [entry, ...rest];
    });
    setSidebarOpen(false);
    if (warning) {
      pushToast(warning, { type: 'info', duration: 8000 });
    }
    pushToast(`${t('toast.conversationTo')} ${path}`, { type: 'success' });
  }, [scopedConversation, pushToast, selectConversation]);

  const timeline = timelines[activePath] || [];
  const streaming = isStreaming(timeline);
  const presentationBlocking = isPresentationRunning(timeline);
  const presentationActive = isPresentationActive(timeline, {
    voicePlaybackOn,
    karaokeOn,
    voicePlaying,
    voiceBusy,
    karaokeWordsLength: karaokeWords.length,
  });
  const helpHighlight = isHelpHighlightAllowed(timeline, {
    helpNudge,
    helpOpen,
    presentationActive,
    voicePlaybackOn,
    karaokeOn,
    voicePlaying,
    voiceBusy,
    karaokeWordsLength: karaokeWords.length,
  });
  streamingRef.current = streaming;
  const activeParts = parseConversationPath(activePath);

  const dismissHelpNudge = useCallback((primeId) => {
    setHelpNudge(false);
    if (primeId) markHelpNudgeSeen(activeRef.current, primeId);
  }, []);

  const handleStopPresentation = useCallback(async () => {
    if (!activePath || !presentationBlocking) return;
    const path = activePath;
    setActiveConversation(path);
    stopPlayback();
    await stopCliRun({ all: true });
    setTimelines((prev) => {
      const items = abortRunningRuns(prev[path] || [], 'présentation interrompue');
      const merged = { ...prev, [path]: items };
      timelinesRef.current = merged;
      void persistTimeline(path, items);
      return merged;
    });
  }, [activePath, presentationBlocking, stopPlayback, persistTimeline]);

  const clientBusy = Boolean(
    voiceMicLive || voicePlaying || voiceBusy || presentationBlocking || sending || streaming,
  );

  useWakeLock(clientBusy);

  // New deployment: tab (or PWA) keeps its bundle indefinitely.
  // Auto-reloads, but never during an ongoing voice turn or run.
  const clientBusyRef = useRef(clientBusy);
  clientBusyRef.current = clientBusy;
  useEffect(() => watchForUpdate((reload) => {
    pushToast(t('app.updateReloading'), { type: 'info', duration: 4000 });
    const tick = window.setInterval(() => {
      if (!clientBusyRef.current) {
        window.clearInterval(tick);
        reload();
      }
    }, 1000);
  }), [pushToast, t]);

  // « ? » pulse only AFTER presentation text + karaoke voice finish; auto-dismiss 3 min.
  useEffect(() => {
    if (cursorPure) {
      setHelpNudge(false);
      return;
    }
    if (presentationActive) {
      briefingLiveInSessionRef.current = true;
    }
    const wasActive = presentationWasActiveRef.current;
    presentationWasActiveRef.current = presentationActive;

    if (presentationActive) {
      if (helpNudgeTimerRef.current) {
        clearTimeout(helpNudgeTimerRef.current);
        helpNudgeTimerRef.current = 0;
      }
      setHelpNudge(false);
      return;
    }

    if (!briefingLiveInSessionRef.current || !wasActive) return;
    if (timeline.some((it) => it.type === 'run' && it.prime && it.status === 'running')) return;
    if (isPrimeVoicePending(timeline, {
      voicePlaybackOn,
      karaokeOn,
      voicePlaying,
      voiceBusy,
      karaokeWordsLength: karaokeWords.length,
    })) return;

    const prime = getCompletedPrimeRun(timeline);
    if (!prime?.id || helpOpen) return;
    if (isHelpNudgeSeen(activePath, prime.id)) return;
    if (prime.id === primedRunIdRef.current && helpNudge) return;
    primedRunIdRef.current = prime.id;
    setHelpNudge(true);
  }, [
    timeline, helpOpen, presentationActive, activePath, helpNudge, cursorPure,
    voicePlaybackOn, karaokeOn, voicePlaying, voiceBusy, karaokeWords.length,
  ]);

  useEffect(() => {
    if (!helpNudge) {
      if (helpNudgeTimerRef.current) {
        clearTimeout(helpNudgeTimerRef.current);
        helpNudgeTimerRef.current = 0;
      }
      return undefined;
    }
    const prime = getCompletedPrimeRun(timeline);
    helpNudgeTimerRef.current = window.setTimeout(() => {
      dismissHelpNudge(prime?.id);
    }, HELP_NUDGE_AUTO_DISMISS_MS);
    return () => {
      if (helpNudgeTimerRef.current) {
        clearTimeout(helpNudgeTimerRef.current);
        helpNudgeTimerRef.current = 0;
      }
    };
  }, [helpNudge, timeline, dismissHelpNudge]);

  useEffect(() => {
    stopPlayback();
    wasPresentingRef.current = false;
    presentationSpokenRef.current = '';
    presentationWasActiveRef.current = false;
    briefingLiveInSessionRef.current = false;
    primedRunIdRef.current = '';
    presentationLiveTtsRef.current = false;
    primeTtsSpokeRef.current = false;
    primeLiveTtsRef.current = false;
  }, [activePath, presentationLiveTtsRef, primeTtsSpokeRef, primeLiveTtsRef, stopPlayback]);

  // Karaoke/TTS only when prime stream just finished this session — never on F5 reload.
  useEffect(() => {
    const presenting = isPresentationRunning(timeline);
    if (presenting && !wasPresentingRef.current) {
      presentationSpokenRef.current = '';
      prepareForPresentation();
      briefingLiveInSessionRef.current = true;
    }
    const wasPresenting = wasPresentingRef.current;
    wasPresentingRef.current = presenting;

    if (!voiceConfigured || !activePath || cursorPure || !voicePlaybackOn) return;
    if (!shouldAutoSpeakPresentation({ wasPresenting, presenting, items: timeline })) {
      // Cold load with completed prime: remember id so we never speak it later by accident.
      const prime = getCompletedPrimeRun(timeline);
      if (prime?.id && !wasPresenting && !presenting) {
        presentationSpokenRef.current = prime.id;
      }
      return;
    }
    const prime = getCompletedPrimeRun(timeline);
    if (!prime?.id) return;
    if (presentationSpokenRef.current === prime.id) return;
    const block = getPrimeAssistantBlock(prime);
    if (!block?.text?.trim()) return;

    presentationSpokenRef.current = prime.id;
    // Voice is always ON here (gated above). Live SSE TTS only — never batch replay.
    // Dual start (replaySpeech + feedStreamSpeech) = normal HTTP + Cartesia karaoke overlap.
  }, [timeline, voiceConfigured, activePath, prepareForPresentation, cursorPure, voicePlaybackOn, primeLiveTtsRef, presentationLiveTtsRef, primeTtsSpokeRef]);

  // Unblock UI if présentation/prime hangs — Claude/LiteLLM needs more time than Cursor.
  useEffect(() => {
    if (!activePath || !presentationBlocking) return undefined;
    const path = activePath;
    const timeoutMs = agentPlugin === 'claude' ? 120_000 : 90_000;
    const timer = setTimeout(() => {
      setTimelines((prev) => {
        const items = prev[path] || [];
        if (!isPresentationRunning(items)) return prev;
        const nextItems = abortRunningRuns(items, 'présentation expirée');
        const merged = { ...prev, [path]: nextItems };
        timelinesRef.current = merged;
        // Do not persist aborted empty prime — allows maybePrimeEmpty to retry.
        void persistTimelineRef.current(path, nextItems);
        return merged;
      });
      primedPathsRef.current.delete(path);
      pushToast(t('toast.presentationTimeoutRetry'), { type: 'info' });
      maybePrimeIfNeeded(path, []);
    }, timeoutMs);
    return () => clearTimeout(timer);
  }, [activePath, presentationBlocking, pushToast, agentPlugin, maybePrimeIfNeeded]);

  // One-shot snap when timeline changes. Growth during streaming
  // is handled by the ResizeObserver below (rAF, height threshold): the
  // old setInterval(48ms) ran ~21x/s and made input sluggish.
  useEffect(() => {
    if (!atBottom || !stickBottomRef.current || karaokeScrollLockRef.current) return;
    snapToBottom('auto');
  }, [atBottom, snapToBottom, karaokeScrollLocked]);

  useEffect(() => {
    const content = chatContentRef.current;
    if (!content) return undefined;
    let lastScrollHeight = 0;
    let rafId = 0;
    const scheduleSnap = () => {
      if (rafId) return;
      rafId = requestAnimationFrame(() => {
        rafId = 0;
        if (!stickBottomRef.current || karaokeScrollLockRef.current) return;
        const el = scrollRef.current;
        if (!el) return;
        const h = el.scrollHeight;
        if (Math.abs(h - lastScrollHeight) < 8) return;
        lastScrollHeight = h;
        snapToBottom('auto');
      });
    };
    lastScrollHeight = scrollRef.current?.scrollHeight ?? 0;
    const ro = new ResizeObserver(scheduleSnap);
    ro.observe(content);
    return () => {
      ro.disconnect();
      if (rafId) cancelAnimationFrame(rafId);
    };
  }, [activePath, karaokeScrollLocked, snapToBottom]);

  const handleClearConversation = async () => {
    if (!activePath || clearing) return;
    stopPlayback();
    prepareForPresentation();
    setClearing(true);
    const path = activePath;
    try {
      if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
      await clearSession(path);
    } finally {
      setClearConfirmOpen(false);
      setClearing(false);
    }
    void refreshStatus();
  };
  handleClearConversationRef.current = handleClearConversation;

  const handleDeleteConversation = async () => {
    const path = String(deleteTarget || '').trim();
    if (!path || deleting) return;
    setDeleting(true);
    try {
      const { ok, data } = await deleteConversation(path, { purgeAttachments: purgeAttachmentsOnDelete });
      if (!ok) {
        pushToast(data?.error || t('delete.failed'), { type: 'error', duration: 8000 });
        return;
      }
      forgetLocalConversation(path);
      const remaining = conversations.filter((c) => (c.path || c.id) !== path);
      setConversations(remaining);
      setTimelines((prev) => {
        const next = { ...prev };
        delete next[path];
        timelinesRef.current = next;
        return next;
      });
      delete timelineUpdatedAtRef.current[path];
      if (activeRef.current === path) {
        const nextPath = remaining[0]?.path || remaining[0]?.id || '';
        if (nextPath) {
          await selectConversation(nextPath, { replaceUrl: true });
        } else {
          setActiveConversation('');
          setActivePath('');
          navigate('/', { replace: true });
        }
      }
      const msg = purgeAttachmentsOnDelete && data?.gedPurgedCount > 0
        ? `Conversation supprimée (${data.gedPurgedCount} pièce(s) jointe(s) effacée(s))`
        : t('delete.success');
      pushToast(msg, { type: 'success' });
      setDeleteTarget(null);
      setPurgeAttachmentsOnDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  const handleArchiveConversation = async (path, shouldArchive) => {
    try {
      const { ok, data } = await archiveConversation(path, shouldArchive);
      if (!ok) {
        pushToast(data?.error || 'Erreur archivage', { type: 'error' });
        return;
      }
      setConversations((prev) =>
        prev.map((c) =>
          ((c.path || c.id) === path
            ? { ...c, archived_at: shouldArchive ? new Date().toISOString() : null }
            : c),
        ),
      );
      pushToast(shouldArchive ? 'Conversation archivée' : 'Conversation restaurée', { type: 'success' });
    } catch (err) {
      pushToast(err.message || 'Erreur archivage', { type: 'error' });
    }
  };

  const handleMoveConversationFolder = async (path, folder) => {
    try {
      const { ok, data } = await setConversationFolder(path, folder);
      if (!ok) {
        pushToast(data?.error || 'Erreur dossier', { type: 'error' });
        return;
      }
      setConversations((prev) =>
        prev.map((c) =>
          ((c.path || c.id) === path ? { ...c, folder } : c),
        ),
      );
      setFolders((prev) => (prev.includes(folder) ? prev : [...prev, folder]));
      pushToast(`Classée dans 📁 ${folder}`, { type: 'success' });
    } catch (err) {
      pushToast(err.message || 'Erreur dossier', { type: 'error' });
    }
  };

  const handleRenameConversation = async (oldPath, newName) => {
    const from = String(oldPath || '').trim();
    const to = String(newName || '').trim().replace(/[/\\?%*:|"<>]/g, '-');
    if (!from || !to || from === to) return;
    try {
      const { ok, data } = await renameConversation(from, to);
      if (!ok) {
        pushToast(data?.error || 'Échec du renommage', { type: 'error' });
        return;
      }
      forgetLocalConversation(from);
      rememberLocalConversation(to);
      setConversations((prev) =>
        prev.map((c) =>
          ((c.path || c.id) === from ? { ...c, path: to, id: to, name: to } : c),
        ),
      );
      setTimelines((prev) => {
        const next = { ...prev };
        if (next[from]) {
          next[to] = next[from];
          delete next[from];
        }
        timelinesRef.current = next;
        return next;
      });
      if (timelineUpdatedAtRef.current[from]) {
        timelineUpdatedAtRef.current[to] = timelineUpdatedAtRef.current[from];
        delete timelineUpdatedAtRef.current[from];
      }
      if (activeRef.current === from) {
        await selectConversation(to, { replaceUrl: true });
      }
      pushToast(`Session renommée : ${to}`, { type: 'success' });
    } catch (err) {
      pushToast(err.message || 'Erreur lors du renommage', { type: 'error' });
    }
  };

  const handleCopyConversation = async () => {
    if (!activePath || copying) return;
    setCopying(true);
    setActiveConversation(activePath);
    const { ok, data } = await exportConversation({
      format: 'markdown',
      items: normalizeTimelineItems(timeline),
    });
    setCopying(false);
    if (!ok) {
      pushToast(data?.error || t('toast.exportFailed'), { type: 'error' });
      return;
    }
    const text = data.markdown || data.text || '';
    if (!text) {
      pushToast(t('toast.emptyConv'), { type: 'info' });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      pushToast(t('toast.copied').replace('{count}', String(data.item_count ?? 0)), { type: 'success' });
    } catch {
      pushToast(t('toast.clipboardUnavailable'), { type: 'error' });
    }
  };

  const handleStopCli = async () => {
    if (stopping) return;
    // Cut TTS/ack immediately (WS + HTTP queue) — do not wait for stopCliRun.
    stopPlayback();
    setStopping(true);
    if (activePath) setActiveConversation(activePath);
    const { ok, data } = await stopCliRun({ all: true });
    setSending(false);
    setTimelines((prev) => {
      const merged = { ...prev };
      for (const path of Object.keys(merged)) {
        // Always abort local running runs (incl. stuck présentation/prime).
        if ((merged[path] || []).some((it) => it.type === 'run' && it.status === 'running')) {
          merged[path] = abortRunningRuns(merged[path], 'stopped');
          void persistTimelineRef.current(path, merged[path]);
        }
      }
      timelinesRef.current = merged;
      return merged;
    });
    setStopping(false);
    if (ok) {
      const n = data?.stopped ?? 0;
      pushToast(n > 0 ? `${t('toast.allStopped')} (${n} ${t('toast.processes')})` : t('toast.streamStopped'), {
        type: 'success',
      });
    } else {
      // Claude bridge has no /stop — local abort still unblocks the UI.
      pushToast(t('toast.presentationStopped'), { type: 'success' });
    }
  };
  /**
   * One stop for every surface: the presentation has its own teardown, and the
   * CLI stop alone leaves the spoken answer playing.
   */
  const handleStopAny = async () => {
    stopPlayback();
    if (presentationBlocking) {
      await handleStopPresentation();
      return;
    }
    await handleStopCli();
  };
  handleStopCliRef.current = handleStopAny;

  const agentBusy = streaming || sending || presentationBlocking;

  const handleToggleFilter = (key) => {
    setViewFilters((prev) => toggleViewFilter(prev, key));
  };

  const handleLogout = async () => {
    await logout();
    navigate('/', { replace: true });
  };

  const handleWelcomeExample = useCallback(async (text) => {
    let path = activePath;
    if (!path && conversations.length) {
      path = conversations[0].path || conversations[0].id;
      await selectConversation(path);
    }
    if (!path) {
      pushToast(t('welcome.noConv'), { type: 'info' });
      return;
    }
    setDraft(text);
  }, [activePath, conversations, selectConversation, pushToast, t]);

  const sidebar = (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      <div className="px-2.5 py-2 border-b border-white/10 flex items-center gap-2 shrink-0">
        <div className="p-1 rounded-md bg-brand-600 text-white shrink-0">
          <Bot size={14} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-display font-semibold text-xs text-white truncate leading-tight">{appName}</p>
          <p className="text-[9px] text-slate-400 truncate leading-none">{agentName} · SHAPER-OS</p>
        </div>
        <button
          type="button"
          onClick={() => setSidebarOpen(false)}
          className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-white/10 shrink-0 cursor-pointer"
          aria-label="Replier le menu"
        >
          <X size={14} />
        </button>
      </div>

      {/* Middle scrolls; footer stays pinned (mobile dvh / safe-area). */}
      <div className="flex-1 min-h-0 overflow-y-auto theme-scrollbar flex flex-col">
        {!scopedConversation && (
          <ShaperConversationCreator
            defaultNode="opencode"
            onCreate={addConversation}
          />
        )}

        <div className="px-2 py-1 shrink-0 flex items-center justify-between border-b border-white/5">
          <div className="flex items-center gap-1 bg-white/5 p-0.5 rounded-lg text-[10px] w-full">
            <button
              type="button"
              onClick={() => setSidebarTab('active')}
              className={`flex-1 py-0.5 rounded-md text-center transition font-medium text-[10px] cursor-pointer ${
                sidebarTab === 'active' ? 'bg-cyan-600/40 text-cyan-200 border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              Actives ({conversations.filter((c) => !c.archived_at).length})
            </button>
            <button
              type="button"
              onClick={() => setSidebarTab('archived')}
              className={`flex-1 py-0.5 rounded-md text-center transition font-medium text-[10px] cursor-pointer ${
                sidebarTab === 'archived' ? 'bg-cyan-600/40 text-cyan-200 border border-cyan-500/40 shadow-sm' : 'text-slate-400 hover:text-white'
              }`}
            >
              Archivées ({conversations.filter((c) => Boolean(c.archived_at)).length})
            </button>
          </div>
        </div>

        {/* Quick conversation search bar */}
        <div className="px-2 py-1 border-b border-white/5">
          <div className="relative flex items-center">
            <Search size={11} className="absolute left-2 text-slate-500 pointer-events-none" />
            <input
              type="text"
              value={sidebarSearch}
              onChange={(e) => setSidebarSearch(e.target.value)}
              placeholder="Filtrer les sessions..."
              className="w-full pl-6 pr-5 py-0.5 text-[10px] rounded-md bg-white/5 border border-white/5 text-slate-200 placeholder:text-slate-500 focus:outline-none focus:border-brand-500/40 focus:bg-white/[0.08] transition"
            />
            {sidebarSearch && (
              <button
                type="button"
                onClick={() => setSidebarSearch('')}
                className="absolute right-1.5 text-slate-500 hover:text-slate-300 p-0.5 cursor-pointer"
                title="Effacer"
              >
                <X size={10} />
              </button>
            )}
          </div>
        </div>

        {sidebarTab === 'active' && (
          <div className="px-2 py-1 flex items-center gap-1 overflow-x-auto theme-scrollbar text-[9px] shrink-0 border-b border-white/5">
            <button
              type="button"
              onClick={() => setSelectedFolder('all')}
              className={`px-1.5 py-0.5 rounded-md whitespace-nowrap border font-medium transition cursor-pointer ${
                selectedFolder === 'all'
                  ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm'
                  : 'bg-white/5 text-slate-400 border-white/5 hover:text-white hover:bg-white/10'
              }`}
            >
              Tous
            </button>
            {folders.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setSelectedFolder(f)}
                className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md whitespace-nowrap border font-medium transition cursor-pointer ${
                  selectedFolder === f
                    ? 'bg-amber-500/20 text-amber-200 border-amber-500/40 shadow-sm'
                    : 'bg-white/5 text-slate-400 border-white/5 hover:text-white hover:bg-white/10'
                }`}
              >
                <Folder size={10} className={selectedFolder === f ? 'text-amber-300' : 'text-amber-400/70'} />
                <span>{f}</span>
              </button>
            ))}
            <button
              type="button"
              onClick={() => {
                const custom = window.prompt('Nom du nouveau dossier :');
                if (custom && custom.trim() && !folders.includes(custom.trim())) {
                  setFolders((prev) => [...prev, custom.trim()]);
                  setSelectedFolder(custom.trim());
                }
              }}
              className="inline-flex items-center justify-center w-4 h-4 rounded-md bg-white/5 text-slate-400 hover:text-amber-300 hover:bg-white/10 border border-white/5 transition cursor-pointer shrink-0"
              title="Créer un nouveau dossier"
            >
              <Plus size={10} />
            </button>
          </div>
        )}

        <div className="p-1.5 space-y-1 pb-2">
          {conversations
            .filter((c) => (sidebarTab === 'archived' ? Boolean(c.archived_at) : !c.archived_at))
            .filter((c) => sidebarTab === 'archived' || selectedFolder === 'all' || (c.folder || 'Général') === selectedFolder)
            .filter((c) => {
              if (!sidebarSearch.trim()) return true;
              const q = sidebarSearch.toLowerCase().trim();
              const name = String(c.name || convNameFromPath(c.path || c.id) || '').toLowerCase();
              const path = String(c.path || c.id || '').toLowerCase();
              return name.includes(q) || path.includes(q);
            })
            .map((c) => {
              const path = c.path || c.id;
              return (
                <ConversationListItem
                  key={path}
                  conversation={c}
                  active={path === activePath}
                  streaming={isStreaming(timelines[path] || [])}
                  reloading={polling && path === activePath}
                  folders={folders}
                  onSelect={(p) => { selectConversation(p); setSidebarOpen(false); }}
                  onReload={handleReloadConversation}
                  onDelete={(p) => setDeleteTarget(p)}
                  onRename={handleRenameConversation}
                  onArchive={handleArchiveConversation}
                  onMoveFolder={handleMoveConversationFolder}
                />
              );
            })}
          {!conversations.filter((c) => (sidebarTab === 'archived' ? Boolean(c.archived_at) : !c.archived_at)).length && (
            <p className="text-[10px] text-slate-600 px-2 py-4 text-center">
              {sidebarTab === 'archived' ? 'Aucune conversation archivée.' : t('nav.createConv')}
            </p>
          )}
        </div>
      </div>

      <div className="p-1.5 border-t border-white/10 shrink-0 pb-[max(0.375rem,env(safe-area-inset-bottom))] text-[10px]">
        <div className="flex items-center gap-1">
          <a
            href="/ged"
            target="_blank"
            rel="noopener noreferrer"
            className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-lg bg-cyan-950/40 hover:bg-cyan-900/60 border border-cyan-500/25 hover:border-cyan-500/40 text-cyan-300 hover:text-cyan-200 transition text-[10px] font-medium"
            title="Mini-GED Documents"
            aria-label="Mini-GED Documents"
          >
            <FolderArchive size={13} />
            <span className="truncate">GED</span>
          </a>

          {isAdmin ? (
            <Link
              to="/admin"
              onClick={() => setSidebarOpen(false)}
              className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-slate-300 hover:text-white transition text-[10px]"
              title="Administration"
              aria-label="Administration"
            >
              <Shield size={13} />
              <span className="truncate">Admin</span>
            </Link>
          ) : demoBriefingAdmin ? (
            <Link
              to="/admin/briefing"
              onClick={() => setSidebarOpen(false)}
              className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-slate-300 hover:text-white transition text-[10px]"
              title="Briefing"
              aria-label="Briefing"
            >
              <ScrollText size={13} />
              <span className="truncate">Briefing</span>
            </Link>
          ) : null}

          <button
            type="button"
            onClick={handleLogout}
            className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 px-1.5 rounded-lg bg-white/5 hover:bg-red-500/15 border border-white/5 hover:border-red-500/30 text-slate-400 hover:text-red-300 transition text-[10px] cursor-pointer"
            title={t('nav.logout')}
            aria-label={t('nav.logout')}
          >
            <LogOut size={13} />
            <span className="truncate">{t('nav.logout')}</span>
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="h-dvh max-h-dvh w-full max-w-full flex min-h-0 min-w-0 overflow-hidden relative">
      {/* Desktop sidebar (collapsible) */}
      <aside
        className={`hidden lg:flex flex-col shrink-0 border-r border-white/10 bg-black/30 glass transition-[width] duration-200 overflow-hidden ${
          sidebarOpen ? 'w-56 xl:w-60' : 'w-0 border-r-0'
        }`}
      >
        <div className={`flex flex-col h-full min-w-[14rem] xl:min-w-[15rem] ${sidebarOpen ? '' : 'invisible'}`}>
          {sidebar}
        </div>
      </aside>

      {/* Sidebar mobile: h-dvh (not inset-y-0) so footer stays in the visual viewport */}
      {sidebarOpen && (
        <>
          <aside className="lg:hidden fixed top-0 left-0 z-50 h-dvh max-h-dvh w-72 max-w-[85vw] bg-[#0a0f1a] border-r border-white/10 shadow-2xl flex flex-col overflow-hidden">
            {sidebar}
          </aside>
          <button
            type="button"
            className="lg:hidden fixed inset-0 z-40 bg-black/50"
            aria-label={t('nav.closeMenu')}
            onClick={() => setSidebarOpen(false)}
          />
        </>
      )}

      {/* Main — ChatGPT/Claude style: full-screen scroll, sticky composer on top */}
      <div className="flex-1 flex flex-col min-w-0 min-h-0 relative">
        <header className="shrink-0 z-40 sticky top-0 flex items-center gap-1 sm:gap-1.5 px-2 sm:px-3 py-1.5 border-b border-white/10 bg-[#0a0f1a]/95 backdrop-blur-md">
          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-slate-400 shrink-0"
            aria-label={t('nav.conversations')}
          >
            <PanelLeft size={17} />
          </button>
          <div className="flex-1 min-w-0 pr-1">
            <p className="text-xs sm:text-sm font-semibold text-white truncate flex items-center gap-1.5 leading-tight">
              {activePath && (
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    polling && !status
                      ? 'bg-slate-500 animate-pulse'
                      : bridgeConnected
                        ? 'bg-emerald-400'
                        : 'bg-red-400'
                  }`}
                  title={bridgeStatusTitle}
                  aria-label={bridgeStatusTitle}
                />
              )}
              <span
                className="truncate font-semibold text-xs sm:text-sm text-white"
                title={activePath || undefined}
              >
                {activePath
                  ? (() => {
                    const t3 = sessionTriple(
                      conversations.find((c) => (c.path || c.id) === activePath) || activePath,
                    );
                    return t3.label || activePath;
                  })()
                  : t('nav.console')}
              </span>
              {streaming && (
                <span className="text-[9px] sm:text-[10px] text-emerald-400 font-normal shrink-0">{t('status.live')}</span>
              )}
            </p>
            <div className="flex items-center gap-1 sm:gap-1.5 mt-0.5 text-[10px] sm:text-[11px] text-slate-400 leading-tight min-w-0">
              <span className="hidden sm:inline font-semibold text-brand-400">OpenCode</span>
              <span className="hidden sm:inline">·</span>
              <ActiveModelLabel
                conversation={activePath}
                conversationModel={conversations.find((c) => (c.path || c.id) === activePath)?.model || null}
                onModelChange={(newModel) => {
                  setConversations((prev) =>
                    prev.map((c) => ((c.path || c.id) === activePath ? { ...c, model: newModel } : c))
                  );
                }}
              />
            </div>
          </div>
          <div className="shrink-0 flex items-center gap-1 sm:gap-1.5">
            <InteractionModeSelector value={interactionMode} onChange={setMobileMode} />
            <LanguageSelector compact />
            {!hideChatVisual && (
              <ConsoleHelpButton
                highlight={helpHighlight}
                onDismiss={() => {
                  const prime = getCompletedPrimeRun(timeline);
                  dismissHelpNudge(prime?.id);
                }}
                onClick={() => {
                  const prime = getCompletedPrimeRun(timeline);
                  dismissHelpNudge(prime?.id);
                  setHelpOpen(true);
                }}
              />
            )}
            <HeaderActionsMenu
              filters={viewFilters}
              onToggleFilter={handleToggleFilter}
              onCopy={handleCopyConversation}
              copying={copying}
              copyDisabled={!activePath || !timeline.length || copying}
              onStop={handleStopCli}
              stopping={stopping}
              agentBusy={agentBusy}
              onClear={() => setClearConfirmOpen(true)}
              canClear={Boolean(activePath && timeline.length)}
              onRefresh={reloadPage}
              polling={polling}
              karaokeOn={karaokeOn}
              karaokeSupported={karaokeSupported}
              karaokeGrain={karaokeGrain}
              onToggleKaraoke={toggleKaraoke}
              forceOpen={helpForceOptions}
              cursorPure={cursorPure}
              onToggleCursorPure={toggleCursorPure}
              timelinePagination={timelinePagination}
              onToggleTimelinePagination={toggleTimelinePagination}
            />
            {!hideChatVisual && (
              <button
                type="button"
                onClick={() => setWorkspaceOpen((v) => !v)}
                className={`hidden md:inline-flex items-center justify-center w-8 h-8 rounded-lg transition cursor-pointer shrink-0 ${
                  workspaceOpen ? 'bg-brand-600/25 text-brand-200' : 'text-slate-400 hover:bg-white/10 hover:text-white'
                }`}
                title="Panneau projet (aperçu / navigateur)"
                aria-label="Panneau projet"
              >
                <PanelRight size={17} />
              </button>
            )}
          </div>
        </header>

        <div className="shrink-0 px-3 pt-2 md:hidden">
          <PwaInstallBanner />
        </div>

        {clearConfirmOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-black/60"
              aria-label={t('clear.cancel')}
              onClick={() => !clearing && setClearConfirmOpen(false)}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="clear-conv-title"
              className="relative w-full max-w-sm rounded-2xl border border-white/10 bg-[#0f172a] p-5 shadow-2xl"
            >
              <h2 id="clear-conv-title" className="text-base font-semibold text-white mb-2">
                {t('clear.title')}
              </h2>
              <p className="text-sm text-slate-400 mb-1">
                {t('clear.body')}
              </p>
              <p className="text-xs text-slate-500 font-mono truncate mb-5" title={activePath}>
                {activePath}
              </p>
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  disabled={clearing}
                  onClick={() => setClearConfirmOpen(false)}
                  className="btn-secondary text-sm py-2 px-4"
                >
                  {t('clear.cancel')}
                </button>
                <button
                  type="button"
                  disabled={clearing}
                  onClick={handleClearConversation}
                  title={t('clear.confirmHint')}
                  className="inline-flex items-center justify-center gap-2 bg-brand-600 hover:bg-brand-500 text-white font-semibold px-4 py-2 rounded-xl text-sm transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <RotateCcw size={14} />
                  {clearing ? t('clear.loading') : t('clear.confirm')}
                </button>
              </div>
            </div>
          </div>
        )}

        {deleteTarget && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <button
              type="button"
              className="absolute inset-0 bg-black/60"
              aria-label={t('delete.cancel')}
              onClick={() => {
                if (!deleting) {
                  setDeleteTarget(null);
                  setPurgeAttachmentsOnDelete(false);
                }
              }}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-conv-title"
              className="relative w-full max-w-md rounded-2xl border border-white/10 bg-[#0f172a] p-5 shadow-2xl"
            >
              <h2 id="delete-conv-title" className="text-base font-semibold text-white mb-2">
                {t('delete.title')}
              </h2>
              <p className="text-sm text-slate-400 mb-1">
                {t('delete.body')}
              </p>
              <p className="text-xs text-slate-500 font-mono truncate mb-4" title={deleteTarget}>
                {deleteTarget}
              </p>

              <label className="flex items-start gap-2.5 p-3 rounded-xl bg-white/5 border border-white/10 cursor-pointer hover:bg-white/10 transition mb-5">
                <input
                  type="checkbox"
                  checked={purgeAttachmentsOnDelete}
                  onChange={(e) => setPurgeAttachmentsOnDelete(e.target.checked)}
                  className="mt-0.5 rounded border-slate-700 text-red-500 focus:ring-0"
                />
                <div className="text-xs">
                  <span className="font-semibold text-slate-200 block">
                    Effacer également les pièces jointes dans la Mini-GED
                  </span>
                  <span className="text-slate-400 text-[11px] block mt-0.5">
                    Par défaut non coché : vos documents & livrables restent conservés précieusement dans la Mini-GED.
                  </span>
                </div>
              </label>

              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() => {
                    setDeleteTarget(null);
                    setPurgeAttachmentsOnDelete(false);
                  }}
                  className="btn-secondary text-sm py-2 px-4"
                >
                  {t('delete.cancel')}
                </button>
                <button
                  type="button"
                  disabled={deleting}
                  onClick={handleDeleteConversation}
                  className="inline-flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white font-semibold px-4 py-2 rounded-xl text-sm transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 size={14} />
                  {deleting ? t('delete.loading') : t('delete.confirm')}
                </button>
              </div>
            </div>
          </div>
        )}



        {/* Messages scroll above composer (in-flow) — last card always reachable. */}
        <div className="flex flex-1 min-h-0 flex-col">
          {hideChatVisual ? (
            <DriveDeck
              dictation={voicePreview}
              draft={draft}
              mode={interactionMode}
              micLive={voiceMicLive}
              micPhase={voiceMicPhase}
              playbackOn={voicePlaybackOn}
              playing={voicePlaying}
              agentBusy={agentBusy}
              preparing={presentationBlocking}
              sending={sending}
              onToggleMic={toggleVoiceMic}
              onTogglePlayback={toggleVoicePlayback}
              onStop={handleStopAny}
              onSend={handleComposerSend}
              onClear={clearComposerDraft}
              onReborn={handleClearConversation}
              onDraftChange={applyComposerDraft}
              onDraftFocus={beginTypedEdit}
              onDraftBlur={endTypedEdit}
            />
          ) : (
          <>
          <div className="relative flex-1 min-h-0">
            {pullActive && (
              <div
                className="absolute left-0 right-0 z-40 flex items-center justify-center pointer-events-none transition-[height] duration-75"
                style={{ height: Math.max(pullPx, 28), top: 0 }}
                aria-hidden="true"
              >
                <span
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] shadow-lg backdrop-blur-md ${
                    pullArmed
                      ? 'border-emerald-400/40 bg-emerald-500/20 text-emerald-200'
                      : 'border-white/15 bg-[#0f172a]/90 text-slate-300'
                  }`}
                >
                  <RefreshCw size={12} className={pullArmed ? 'animate-spin' : ''} />
                  {pullArmed ? t('pull.release') : t('pull.hint')}
                </span>
              </div>
            )}
            <div
              ref={bindScrollRef}
              onScroll={onChatScroll}
              className={`absolute inset-0 overflow-y-auto overflow-x-hidden overscroll-y-contain touch-pan-y px-2 pt-3 pb-5 sm:px-4 sm:pt-4 theme-scrollbar ${streaming ? 'stream-chat-active' : ''}`}
              style={{
                WebkitOverflowScrolling: 'touch',
                ...(pullActive ? { paddingTop: Math.max(12, pullPx * 0.35) } : {}),
              }}
            >
              <div ref={chatContentRef} className="max-w-3xl mx-auto min-w-0 w-full" data-help-target="help-chat-viewport">
                {hideChatVisual ? (
                  <div className="px-4 py-16 text-center space-y-3">
                    <p className="text-sm text-slate-300 leading-relaxed">
                      {interactionMode === 'remote' ? t('mode.remoteBody') : t('mode.routeBody')}
                    </p>
                    {interactionMode === 'remote' && voicePreview ? (
                      <p className="text-sm text-emerald-200/90 whitespace-pre-wrap">{voicePreview}</p>
                    ) : null}
                  </div>
                ) : !activePath ? (
                  <WelcomeEmpty onPickExample={handleWelcomeExample} />
                ) : (
                <>
                {remoteDictation ? (
                  <div className="mb-3 rounded-xl border border-emerald-500/30 bg-emerald-950/40 px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-wide text-emerald-300/80 mb-1">{t('mode.dictationLive')}</p>
                    <p className="text-sm text-emerald-50 whitespace-pre-wrap break-words">{remoteDictation}</p>
                  </div>
                ) : null}
                <RunTimeline
                  items={timeline}
                  filters={viewFilters}
                  conversation={activePath}
                  workspaceCwd={activeWorkspaceCwd}
                  editable={Boolean(activePath) && !sending && !stopping && !streaming}
                  onEditHuman={handleEditHumanStable}
                  onReplaySpeech={replaySpeech}
                  onToggleVoicePause={togglePause}
                  onStopSpeech={stopPlayback}
                  activeReplayId={activeReplayId}
                  voicePlaying={voicePlaying}
                  voicePaused={voicePaused}
                  voiceConfigured={voiceConfigured}
                  voicePlaybackOn={voicePlaybackOn}
                  karaokeOn={karaokeOn}
                  karaokeWords={karaokeWords}
                  karaokeIndex={karaokeIndex}
                  karaokeGrain={karaokeGrain}
                  timelinePagination={timelinePagination}
                />
                </>
                )}
                <div ref={endSentinelRef} className="h-3 w-full shrink-0" aria-hidden="true" />
              </div>
            </div>

            {activePath && !hideChatVisual ? (
              atBottom ? (
                <button
                  type="button"
                  onClick={pauseFollow}
                  className="absolute z-40 left-1/2 -translate-x-1/2 bottom-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-950/80 px-3 py-1.5 text-xs text-emerald-100 shadow-lg backdrop-blur-md hover:bg-emerald-900/90 transition"
                  title={t('options.followPause')}
                  aria-label={t('options.followPause')}
                >
                  <Pause size={13} />
                  {t('options.followOn')}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => scrollToBottom('smooth')}
                  className="absolute z-40 left-1/2 -translate-x-1/2 bottom-3 inline-flex items-center gap-1.5 rounded-full border border-sky-400/40 bg-sky-600 px-3 py-1.5 text-xs text-white shadow-lg backdrop-blur-md hover:bg-sky-500 transition"
                  title={t('options.followResume')}
                  aria-label={t('options.followResume')}
                >
                  <ArrowDown size={14} />
                  {t('options.followResume')}
                </button>
              )
            ) : null}
          </div>

          <div className="shrink-0 z-30 border-t border-white/5 bg-[#0a0f1a]">
            <ChatInput
              draft={draft}
              setDraft={setDraft}
              sending={sending}
              stopping={stopping}
              onSend={handleComposerSend}
              activePath={activePath}
              onHeightChange={setComposerH}
              onClearDraft={clearComposerDraft}
              voicePlaybackOn={voicePlaybackOn}
              onToggleVoicePlayback={toggleVoicePlayback}
              voiceMicLive={voiceMicLive}
              voiceMicPhase={voiceMicPhase}
              voiceMicArmLeftMs={voiceMicArmLeftMs}
              onToggleVoiceMic={toggleVoiceMic}
              voiceBusy={voiceBusy}
              voiceConfigured={voiceConfigured}
              voicePlaying={voicePlaying}
              voicePaused={voicePaused}
              onToggleVoicePause={togglePause}
              onStopVoice={stopPlayback}
              voicePreview={voicePreview}
              voiceModeActive={voicePlaybackOn || voiceMicLive}
              presentationBlocking={presentationBlocking}
              onStopPresentation={presentationBlocking ? handleStopPresentation : undefined}
              agentBusy={agentBusy}
              onStop={handleStopCli}
            />
          </div>
          </>
          )}
        </div>
      </div>
      <WorkspacePanel
        open={workspaceOpen}
        onClose={() => setWorkspaceOpen(false)}
        onCreateApp={(name) => {
          const id = String(name || '').trim();
          if (!id) return;
          registerAddedVibeProject(id);
          void handleSendRef.current(
            `Crée l'espace turbinobash « ${id} » : lance \`tb app sudo/way/noweb/create ${id}\`, `
            + `puis prépare un squelette d'app dans /apps/${id}/app (dev Vite sur un port libre, `
            + `à lancer avec base=/api/preview/${id}/ pour l'aperçu KovZu). Confirme quand c'est prêt.`,
          );
          pushToast(`${t('toast.creationRequestSent')} ${id}`, { type: 'success' });
        }}
      />
      <ConsoleHelpOverlay
        open={helpOpen}
        onClose={() => { setHelpOpen(false); setHelpForceOptions(false); }}
        onForceOptionsOpen={setHelpForceOptions}
      />
    </div>
  );
}
