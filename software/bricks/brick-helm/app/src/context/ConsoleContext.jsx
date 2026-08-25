import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  getStatus, injectMessage, getConversations,
  openEventStream, setActiveConversation, getActiveConversation,
} from '../api/client.js';

const ConsoleContext = createContext(null);

export function useConsole() {
  const ctx = useContext(ConsoleContext);
  if (!ctx) throw new Error('useConsole outside ConsoleProvider');
  return ctx;
}

function convNameFromPath(path) {
  const raw = String(path || '');
  const idx = raw.indexOf('/');
  return idx >= 0 ? raw.slice(idx + 1) : raw;
}

export function ConsoleProvider({ children }) {
  const [status, setStatus] = useState(null);
  const [polling, setPolling] = useState(false);
  const [conversations, setConversations] = useState([]);
  const [nodes, setNodes] = useState([]);
  const [activePath, setActivePath] = useState('');
  const [threads, setThreads] = useState({});
  const activeRef = useRef(activePath);
  activeRef.current = activePath;

  const selectConversation = useCallback((path) => {
    if (!path) return;
    setActiveConversation(path);
    setActivePath(path);
    setThreads((prev) => (prev[path] ? prev : { ...prev, [path]: [] }));
  }, []);

  const refresh = useCallback(async () => {
    setPolling(true);
    const conv = await getConversations();
    if (conv.ok && conv.data?.conversations?.length) {
      setConversations(conv.data.conversations);
      setNodes(conv.data.nodes || []);
      const paths = conv.data.conversations.map((c) => c.path || c.id);
      const current = getActiveConversation();
      if (!current || !paths.includes(current)) {
        if (paths[0]) selectConversation(paths[0]);
      }
    }
    const { ok, data } = await getStatus();
    if (ok) setStatus(data);
    setPolling(false);
    return data;
  }, [selectConversation]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 15000);
    return () => clearInterval(id);
  }, [refresh]);

  useEffect(() => {
    if (!activePath) return undefined;
    setActiveConversation(activePath);

    const close = openEventStream((event) => {
      const path = activeRef.current;
      const activeName = convNameFromPath(path);
      if (event.conversation && activeName && event.conversation !== activeName) return;

      if (event.type === 'response' && event.text) {
        setThreads((prev) => {
          const thread = prev[path] || [];
          const streamId = event.composer_id || event.chat_id || 'stream';
          const idx = thread.findIndex((m) => m.streamId === streamId && m.streaming);
          if (idx >= 0) {
            const next = [...thread];
            next[idx] = { ...next[idx], text: event.text };
            return { ...prev, [path]: next };
          }
          return {
            ...prev,
            [path]: [...thread, {
              id: crypto.randomUUID(),
              streamId,
              streaming: true,
              role: 'assistant',
              text: event.text,
              time: Date.now(),
            }],
          };
        });
      } else if (event.type === 'response_complete') {
        const streamId = event.composer_id || event.chat_id || 'stream';
        setThreads((prev) => ({
          ...prev,
          [path]: (prev[path] || []).map((m) => (
            m.streamId === streamId && m.streaming
              ? { ...m, streaming: false, text: event.text || m.text }
              : m
          )),
        }));
      }
    });
    return close;
  }, [activePath]);

  const createConversation = useCallback((node, name) => {
    const path = `${node}/${name}`;
    selectConversation(path);
    setConversations((prev) => (
      prev.some((c) => (c.path || c.id) === path)
        ? prev
        : [...prev, { id: path, path, name, node, port: 4200 }]
    ));
  }, [selectConversation]);

  const sendMessage = useCallback(async (text) => {
    if (!activePath) return { ok: false };
    setThreads((prev) => ({
      ...prev,
      [activePath]: [...(prev[activePath] || []), {
        id: crypto.randomUUID(), role: 'human', text, time: Date.now(),
      }],
    }));
    const { ok, data } = await injectMessage(text);
    if (ok) refresh();
    return { ok, data };
  }, [activePath, refresh]);

  const streamingPaths = useMemo(() => new Set(
    Object.entries(threads)
      .filter(([, msgs]) => msgs.some((m) => m.streaming))
      .map(([p]) => p),
  ), [threads]);

  const value = useMemo(() => ({
    status,
    polling,
    refresh,
    conversations,
    nodes,
    activePath,
    selectConversation,
    createConversation,
    sendMessage,
    threads,
    streamingPaths,
  }), [
    status, polling, refresh, conversations, nodes, activePath,
    selectConversation, createConversation, sendMessage, threads, streamingPaths,
  ]);

  return <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>;
}
