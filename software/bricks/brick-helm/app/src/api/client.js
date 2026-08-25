import { getTimelinePaginationPreference } from '../lib/timelineLimit.js';

const API = '/api';
const CLIENT_ID_KEY = 'helm-client-id';
/** PWA / iOS standalone: fallback if the httpOnly cookie is not returned on cold start. */
const AUTH_TOKEN_KEY = 'helm-auth-token';

let activeConversation = '';
let activeLocale = 'fr';

export function setAuthToken(token) {
  try {
    const t = String(token || '').trim();
    if (t) localStorage.setItem(AUTH_TOKEN_KEY, t);
    else localStorage.removeItem(AUTH_TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

export function clearAuthToken() {
  setAuthToken('');
}

export function getAuthToken() {
  try {
    return localStorage.getItem(AUTH_TOKEN_KEY) || '';
  } catch {
    return '';
  }
}

function bearerHeader() {
  const token = getAuthToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function withCredentials(opts = {}) {
  return {
    ...opts,
    credentials: 'include',
    headers: { ...bearerHeader(), ...(opts.headers || {}) },
  };
}

/** Stable per-tab id — excludes this client from timeline_sync echo. */
export function getHelmClientId() {
  try {
    let id = sessionStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return `tab-${Date.now()}`;
  }
}

function helmJsonHeaders() {
  return {
    ...bearerHeader(),
    'Content-Type': 'application/json',
    'X-Helm-Client-Id': getHelmClientId(),
  };
}

export function setActiveLocale(locale) {
  activeLocale = String(locale || 'fr').toLowerCase().slice(0, 2);
}

export function getActiveLocale() {
  return activeLocale;
}

export function setActiveConversation(id) {
  activeConversation = id || '';
}

export function getActiveConversation() {
  return activeConversation;
}

function convQuery(extra = {}) {
  const params = new URLSearchParams();
  if (activeConversation) params.set('conversation', activeConversation);
  Object.entries(extra).forEach(([k, v]) => {
    if (v != null && v !== '') params.set(k, v);
  });
  const q = params.toString();
  return q ? `?${q}` : '';
}

async function parseJson(res) {
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export async function login(email, password) {
  return parseJson(await fetch(`${API}/auth/login`, withCredentials({
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ email, password }),
  })));
}

/** Public personalized demo invite (?user=slug) — returns email + password for autofill. */
export async function fetchDemoInvite(userSlug) {
  const slug = String(userSlug || '').trim();
  if (!slug) return { ok: false, data: { error: 'user required' } };
  const q = new URLSearchParams({ user: slug });
  return parseJson(await fetch(`${API}/auth/demo-invite?${q}`, withCredentials()));
}

/** Public app mode flags for login UI (demo vs production). */
export async function fetchBootstrap() {
  try {
    return parseJson(await fetch(`${API}/bootstrap`, withCredentials()));
  } catch {
    return { ok: false, status: 0, data: { mode: 'production', demoLogin: false } };
  }
}

export async function logout() {
  return parseJson(await fetch(`${API}/auth/logout`, withCredentials({ method: 'POST' })));
}

export async function getMe() {
  try {
    return parseJson(await fetch(`${API}/auth/me`, withCredentials()));
  } catch {
    return { ok: false, status: 0, data: { error: 'network' } };
  }
}

export async function updateMe(patch) {
  return parseJson(await fetch(`${API}/auth/me`, withCredentials({
    method: 'PATCH',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(patch || {}),
  })));
}

export async function getStatus() {
  return parseJson(await fetch(`${API}/status${convQuery()}`, withCredentials()));
}

export async function getConversations() {
  return parseJson(await fetch(`${API}/conversations`, withCredentials()));
}

export async function getSessionCatalog() {
  return parseJson(await fetch(`${API}/session-catalog`, withCredentials()));
}

export async function browseRemoteFs({ node, user, path: dirPath = '' } = {}) {
  const params = new URLSearchParams();
  if (node) params.set('node', node);
  if (user) params.set('user', user);
  if (dirPath) params.set('path', dirPath);
  const q = params.toString();
  return parseJson(await fetch(`${API}/fs/browse${q ? `?${q}` : ''}`, withCredentials()));
}

export async function registerConversation({ path, workspace }) {
  const conversation = String(path || '').trim();
  const ws = String(workspace || '').trim();
  if (!conversation || !ws) {
    return { ok: false, data: { error: 'path et workspace requis' } };
  }
  return parseJson(await fetch(`${API}/conversations/register`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ path: conversation, conversation, workspace: ws }),
  }));
}

export async function deleteConversation(conversationPath, { purgeAttachments = false } = {}) {
  const conversation = String(conversationPath || '').trim() || activeConversation;
  if (!conversation) return { ok: false, data: { error: 'conversation requise' } };
  return parseJson(await fetch(`${API}/conversations/delete`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ conversation, purgeAttachments }),
  }));
}

export async function setConversationFolder(conversationPath, folder) {
  const conversation = String(conversationPath || '').trim() || activeConversation;
  if (!conversation) return { ok: false, data: { error: 'conversation requise' } };
  return parseJson(await fetch(`${API}/conversations/folder`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ conversation, folder }),
  }));
}

export async function archiveConversation(conversationPath, archived = true) {
  const conversation = String(conversationPath || '').trim() || activeConversation;
  if (!conversation) return { ok: false, data: { error: 'conversation requise' } };
  return parseJson(await fetch(`${API}/conversations/archive`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ conversation, archived }),
  }));
}

export async function renameConversation(sourcePath, targetPath) {
  const source = String(sourcePath || '').trim();
  const target = String(targetPath || '').trim();
  if (!source || !target) return { ok: false, data: { error: 'source et target requis' } };
  return parseJson(await fetch(`${API}/conversations/rename`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ source, target }),
  }));
}

export async function injectMessage(message, attachments = [], opts = {}) {
  const body = { message, lang: activeLocale };
  const conv = opts.conversation || activeConversation;
  if (conv) body.conversation = conv;
  if (attachments.length) body.attachments = attachments;
  if (opts.voiceTurn) body.voiceTurn = true;
  if (opts.ackText) body.ackText = String(opts.ackText).trim();
  // The server writes the turn to its timeline (source of truth) with these ids.
  if (opts.turn) body.turn = opts.turn;
  if (opts.resend) body.resend = opts.resend;
  return parseJson(await fetch(`${API}/inject`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(body),
  }));
}

export async function uploadAttachment(filename, data, opts = {}) {
  const body = { filename, data };
  if (opts.uploadId) body.uploadId = opts.uploadId;
  if (opts.kind) body.kind = opts.kind;
  if (activeConversation) body.conversation = activeConversation;
  return parseJson(await fetch(`${API}/upload`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(body),
  }));
}

export async function getTimeline() {
  const pagination = getTimelinePaginationPreference();
  return parseJson(await fetch(
    `${API}/timeline${convQuery({ pagination: pagination ? '1' : '0' })}`,
    withCredentials(),
  ));
}

/* —— Vibe-code: previewable turbobash projects in the right panel —— */

export async function getVibeProjects() {
  return parseJson(await fetch(`${API}/vibe/projects`, withCredentials()));
}

export async function getVibeApps() {
  return parseJson(await fetch(`${API}/vibe/apps`, withCredentials()));
}

export async function getVibeProjectStatus(id) {
  return parseJson(await fetch(`${API}/vibe/projects/${encodeURIComponent(id)}/status`, withCredentials()));
}

/* —— Browser containers (POC podman/docker) —— */

export async function getBrowserContainers() {
  return parseJson(await fetch(`${API}/browser/containers`, withCredentials()));
}

export async function startNekoContainer(name = 'kovzu-neko') {
  return parseJson(await fetch(`${API}/browser/neko`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ name }),
  }));
}

export async function stopBrowserContainer(name) {
  return parseJson(await fetch(`${API}/browser/${encodeURIComponent(name)}/stop`, withCredentials({ method: 'POST' })));
}

export async function rebuildBrowserContainer(name = 'kovzu-neko') {
  return parseJson(await fetch(`${API}/browser/${encodeURIComponent(name)}/rebuild`, withCredentials({ method: 'POST' })));
}

/** Container iframe URL, with auto-login query (login/pass provided by server). */
export function browserProxyUrl(name, loginQuery = '') {
  return `${API}/browser/proxy/${encodeURIComponent(name)}/${loginQuery || ''}`;
}

/** Deliverables produced in the workspace (docs/, assets/, data/). */
export async function getDeliverables() {
  return parseJson(await fetch(`${API}/workspace/deliverables${convQuery()}`, withCredentials()));
}

/** Direct download URL for a deliverable (attachment). */
export function deliverableDownloadUrl(absPath) {
  return `${API}/workspace/file${convQuery({ path: absPath, download: '1' })}`;
}

export async function saveTimeline(items, { ifUpdatedAt } = {}) {
  const body = { items, clientId: getHelmClientId() };
  if (ifUpdatedAt != null) body.ifUpdatedAt = ifUpdatedAt;
  if (activeConversation) body.conversation = activeConversation;
  return parseJson(await fetch(`${API}/timeline`, {
    method: 'PUT',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(body),
  }));
}

export async function clearTimeline() {
  return parseJson(await fetch(`${API}/timeline${convQuery({ clientId: getHelmClientId() })}`, withCredentials({
    method: 'DELETE',
    headers: { ...bearerHeader(), 'X-Helm-Client-Id': getHelmClientId() },
  })));
}

export async function clearConversationSession() {
  const body = { lang: activeLocale };
  if (activeConversation) body.conversation = activeConversation;
  try {
    return parseJson(await fetch(`${API}/session/clear`, withCredentials({
      method: 'POST',
      headers: helmJsonHeaders(),
      body: JSON.stringify(body),
    })));
  } catch {
    return { ok: false, status: 0, data: { error: 'network' } };
  }
}

export async function resetCliSession({ prime = false } = {}) {
  const body = { lang: activeLocale };
  if (activeConversation) body.conversation = activeConversation;
  if (prime) body.prime = true;
  return parseJson(await fetch(`${API}/session/reset`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(body),
  }));
}

export async function primeCliSession() {
  const body = { lang: activeLocale };
  if (activeConversation) body.conversation = activeConversation;
  return parseJson(await fetch(`${API}/session/prime`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(body),
  }));
}

export async function getContextStatus(conversation) {
  const q = new URLSearchParams({ lang: activeLocale });
  const conv = conversation || activeConversation;
  if (conv) q.set('conversation', conv);
  return parseJson(await fetch(`${API}/context/status?${q}`, withCredentials()));
}

export async function rememberContext({ content, scope = 'local', hotReload = true, conversation } = {}) {
  const body = {
    content: String(content || '').trim(),
    scope,
    hotReload,
    lang: activeLocale,
  };
  const conv = conversation || activeConversation;
  if (conv) body.conversation = conv;
  return parseJson(await fetch(`${API}/context/remember`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(body),
  }));
}

export async function stopCliRun({ all = true } = {}) {
  const body = { all };
  if (!all && activeConversation) body.conversation = activeConversation;
  return parseJson(await fetch(`${API}/session/stop`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(body),
  }));
}

export async function getDevSession() {
  return parseJson(await fetch(`${API}/dev-session`, withCredentials()));
}

export async function bindDevSession(path) {
  return parseJson(await fetch(`${API}/dev-session/bind`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ path }),
  }));
}

export function openEventStream(onEvent, onError) {
  const es = new EventSource(`${API}/events${convQuery()}`, { withCredentials: true });
  es.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  };
  es.onerror = () => onError?.();
  return () => es.close();
}

/** Live dictation from a remote (telecommande) phone onto screen/desktop. */
export async function postVoicePreview({ conversation, text, mode } = {}) {
  const conv = conversation || activeConversation;
  if (!conv) return { ok: false };
  return parseJson(await fetch(`${API}/console-sync/voice`, withCredentials({
    method: 'POST',
    headers: { ...bearerHeader(), 'Content-Type': 'application/json', 'X-Helm-Client-Id': getHelmClientId() },
    body: JSON.stringify({
      conversation: conv,
      text: String(text || ''),
      mode: mode || '',
      clientId: getHelmClientId(),
    }),
  })));
}

/** Mirror a language switch to the operator's other open pages. */
export async function postLocaleSync(locale) {
  return parseJson(await fetch(`${API}/console-sync/locale`, withCredentials({
    method: 'POST',
    headers: { ...bearerHeader(), 'Content-Type': 'application/json', 'X-Helm-Client-Id': getHelmClientId() },
    body: JSON.stringify({ locale, clientId: getHelmClientId() }),
  })));
}

/** Mirror a model switch to the operator's other open pages. */
export async function postModelSync({ modelFamily, modelLabel, modelEffort, modelFast }) {
  return parseJson(await fetch(`${API}/console-sync/model`, withCredentials({
    method: 'POST',
    headers: { ...bearerHeader(), 'Content-Type': 'application/json', 'X-Helm-Client-Id': getHelmClientId() },
    body: JSON.stringify({ modelFamily, modelLabel, modelEffort, modelFast, clientId: getHelmClientId() }),
  })));
}

/** Set and broadcast model for a specific conversation. */
export async function postConversationModel(conversation, { model, modelLabel, modelEffort, modelFast }) {
  return parseJson(await fetch(`${API}/conversations/model`, withCredentials({
    method: 'POST',
    headers: { ...bearerHeader(), 'Content-Type': 'application/json', 'X-Helm-Client-Id': getHelmClientId() },
    body: JSON.stringify({ conversation, model, modelLabel, modelEffort, modelFast, clientId: getHelmClientId() }),
  })));
}

/** Set default model for a specific CLI engine (opencode, agy, cursor). */
export async function setDefaultEngineModel(engine, model) {
  return parseJson(await fetch(`${API}/settings/default-model`, withCredentials({
    method: 'POST',
    headers: { ...bearerHeader(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ engine, model }),
  })));
}

/** SSE: operator-wide events (locale, etc.) — no conversation required. */
export function openOperatorSyncStream(onEvent, onError) {
  const es = new EventSource(
    `${API}/console-sync/operator${convQuery({ clientId: getHelmClientId() })}`,
    { withCredentials: true },
  );
  es.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  };
  es.onerror = () => onError?.();
  return () => es.close();
}

/** SSE: timeline mutations from other browsers/tabs on the same conversation. */
export function openConsoleSyncStream(onEvent, onError) {
  const es = new EventSource(
    `${API}/console-sync${convQuery({ clientId: getHelmClientId() })}`,
    { withCredentials: true },
  );
  es.onmessage = (ev) => {
    try {
      onEvent(JSON.parse(ev.data));
    } catch {
      /* ignore */
    }
  };
  es.onerror = () => onError?.();
  return () => es.close();
}

export async function getVersion() {
  return parseJson(await fetch(`${API}/version`, withCredentials()));
}

/** Exports the active conversation (markdown, text, or json). */
export async function exportConversation({
  conversation,
  format = 'markdown',
  items,
} = {}) {
  const body = { format };
  const conv = conversation || activeConversation;
  if (conv) body.conversation = conv;
  if (Array.isArray(items)) body.items = items;
  return parseJson(await fetch(`${API}/conversations/export`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(body),
  }));
}

/** Copies a timeline to another conversation. */
export async function copyConversation({
  source,
  target,
  mode = 'replace',
  export: withExport = true,
} = {}) {
  const body = { mode, export: withExport };
  if (source || activeConversation) body.source = source || activeConversation;
  if (target) body.target = target;
  return parseJson(await fetch(`${API}/conversations/copy`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(body),
  }));
}

/* —— User admin (MariaDB) —— */

export async function listUsers() {
  return parseJson(await fetch(`${API}/users`, withCredentials()));
}

export async function createUser(payload) {
  return parseJson(await fetch(`${API}/users`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  }));
}

export async function updateUser(id, payload) {
  return parseJson(await fetch(`${API}/users/${id}`, {
    method: 'PATCH',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  }));
}

export async function deleteUser(id) {
  return parseJson(await fetch(`${API}/users/${id}`, withCredentials({ method: 'DELETE' })));
}

export async function getSettings() {
  return parseJson(await fetch(`${API}/settings`, withCredentials()));
}

export async function updateSettings(payload) {
  return parseJson(await fetch(`${API}/settings`, {
    method: 'PATCH',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify(payload),
  }));
}

export async function getVoiceCatalog(provider) {
  const q = provider ? `?provider=${encodeURIComponent(provider)}` : '';
  return parseJson(await fetch(`${API}/voice/catalog${q}`, withCredentials()));
}

/** Preview TTS — optional voiceId (admin test) or saved voice for lang. */
export async function voiceTtsPreview({
  text,
  lang,
  voiceId,
  provider,
  useTestScript = false,
  useQuickTest = false,
} = {}) {
  return parseJson(await fetch(`${API}/voice/tts`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({
      text: useQuickTest ? undefined : text,
      lang,
      voiceId: voiceId || undefined,
      provider: provider || undefined,
      useTestScript: Boolean(useTestScript),
      useQuickTest: Boolean(useQuickTest),
    }),
  }));
}

/* —— KovZu Voice (Deepgram STT/TTS, Groq ack) —— */

export async function getVoiceStatus() {
  return parseJson(await fetch(`${API}/voice/status`, withCredentials()));
}

export async function getVoiceSttToken() {
  return parseJson(await fetch(`${API}/voice/stt-token`, withCredentials()));
}

/** Fast Groq acknowledgment phrase while Composer runs. */
export async function voiceAck(message, lang = activeLocale, entities = []) {
  return parseJson(await fetch(`${API}/voice/ack`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ message, lang, entities }),
  }));
}

/** Intelligent direct voice conversation Zephir (natural reply). */
export async function voiceChat(message, lang = activeLocale, history = []) {
  return parseJson(await fetch(`${API}/voice/chat`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ message, lang, history }),
  }));
}

/** Post-STT normalization of infrastructure names (machines, hosts, aliases). */
export async function voiceNormalize(text, lang = activeLocale) {
  return parseJson(await fetch(`${API}/voice/normalize`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ text, lang }),
  }));
}

/* —— Voice aliases (admin) —— */

export async function listVoiceAliases() {
  return parseJson(await fetch(`${API}/voice/aliases`, withCredentials()));
}

export async function createVoiceAlias(alias, canonical) {
  return parseJson(await fetch(`${API}/voice/aliases`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ alias, canonical }),
  }));
}

export async function deleteVoiceAlias(id) {
  return parseJson(await fetch(`${API}/voice/aliases/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  }));
}

/* —— Claude Code native (admin — mobile Remote Control) —— */

export async function fetchClaudeAuthStatus() {
  return parseJson(await fetch(`${API}/admin/claude-auth/status`, withCredentials()));
}

export async function startClaudeAuthLogin() {
  return parseJson(await fetch(`${API}/admin/claude-auth/login-start`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
  }));
}

export async function completeClaudeAuthLogin(code) {
  return parseJson(await fetch(`${API}/admin/claude-auth/login-complete`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ code }),
  }));
}

export async function cancelClaudeAuthLogin() {
  return parseJson(await fetch(`${API}/admin/claude-auth/login-cancel`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
  }));
}

export async function fetchClaudeRemoteStatus() {
  return parseJson(await fetch(`${API}/admin/claude-remote/status`, withCredentials()));
}

export async function startClaudeRemote(model = 'sonnet', sessionName = '') {
  return parseJson(await fetch(`${API}/admin/claude-remote/start`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ model, sessionName }),
  }));
}

export async function stopClaudeRemote() {
  return parseJson(await fetch(`${API}/admin/claude-remote/stop`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
  }));
}

/** Groq ack + one-shot TTS audio (fast lane, not Composer stream). */
export async function voiceAckSpeak(message, lang = activeLocale) {
  return parseJson(await fetch(`${API}/voice/ack-speak`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ message, lang }),
  }));
}

export async function voiceStt(audioBase64, mimeType = 'audio/webm') {
  return parseJson(await fetch(`${API}/voice/stt`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ audio: audioBase64, mimeType }),
  }));
}

export async function voiceTts(text) {
  return parseJson(await fetch(`${API}/voice/tts`, {
    method: 'POST',
    headers: helmJsonHeaders(),
    credentials: 'include',
    body: JSON.stringify({ text, lang: activeLocale }),
  }));
}

/** DOCX first-page HTML preview from workspace file. */
export async function fetchWorkspacePreview({ conversation, path }) {
  const conv = String(conversation || activeConversation || '').trim();
  const filePath = String(path || '').trim();
  if (!conv || !filePath) {
    return { ok: false, data: { error: 'conversation et path requis' } };
  }
  const q = new URLSearchParams({ conversation: conv, path: filePath });
  return parseJson(await fetch(`${API}/workspace/preview?${q}`, {
    credentials: 'include',
  }));
}
