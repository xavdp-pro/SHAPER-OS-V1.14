/**
 * Translation of the OpenCode event stream into the shared bridge contract.
 *
 * Kept free of I/O on purpose: `translateEvent` takes an OpenCode event plus a
 * run state and returns the canonical events to broadcast, so the mapping can
 * be tested without a server, a CLI or a model.
 */

/** Per-session bookkeeping needed to interpret the stream. */
export function createRunState() {
  return {
    fullText: '',
    lastError: '',
    lastReasoning: '',
    /** partID -> 'text' | 'reasoning' | 'tool' | … (deltas don't repeat it) */
    partTypes: new Map(),
    /** messageIDs whose role is assistant — a user part is not the reply */
    assistantMsgs: new Set(),
    /** callIDs announced as running and not closed yet */
    toolsOpen: new Set(),
    /** callID -> last payload emitted, to skip identical repeats */
    toolSignatures: new Map(),
    running: false,
  };
}

/** Split "provider/model" into the shape prompt_async expects. */
export function splitModel(spec, fallback = 'opencode/nemotron-3.5-lightning-free') {
  const raw = String(spec || fallback).trim();
  const i = raw.indexOf('/');
  if (i <= 0) return { providerID: 'opencode', modelID: raw };
  return { providerID: raw.slice(0, i), modelID: raw.slice(i + 1) };
}

function toolPartEvents(conv, st, part) {
  const callId = part.callID || part.id;
  if (!callId) return [];
  const state = part.state || {};
  const status = String(state.status || '').toLowerCase();
  const input = state.input || {};
  const command = input.command || input.cmd || null;
  const cwd = input.path || input.cwd || null;

  if (status === 'completed' || status === 'error') {
    st.toolsOpen.delete(callId);
    st.toolSignatures.delete(callId);
    return [{
      type: 'tool_complete',
      conversation: conv,
      composer_id: part.sessionID,
      call_id: callId,
      tool: part.tool || 'tool',
      result: state.output != null ? String(state.output) : '',
      ...(status === 'error'
        ? { error: String(state.error || state.output || '') }
        : {}),
    }];
  }

  // Running / pending. OpenCode repeats the part on every update and the
  // arguments only land on a later one, so re-emit when something actually
  // changed (the consumer upserts by call_id) and stay quiet otherwise.
  const payload = {
    type: 'tool',
    conversation: conv,
    composer_id: part.sessionID,
    call_id: callId,
    tool: part.tool || 'tool',
    input: JSON.stringify(input),
    command,
    cwd,
  };
  const signature = `${payload.tool}|${payload.input}|${command}|${cwd}`;
  if (st.toolSignatures.get(callId) === signature) return [];
  st.toolSignatures.set(callId, signature);
  st.toolsOpen.add(callId);
  return [payload];
}

/** Close tools left hanging when the session goes idle. */
export function closeOpenTools(conv, st, sessionID) {
  const out = [];
  for (const callId of st.toolsOpen) {
    out.push({
      type: 'tool_complete',
      conversation: conv,
      composer_id: sessionID,
      call_id: callId,
      tool: 'tool',
      result: '',
    });
  }
  st.toolsOpen.clear();
  st.toolSignatures.clear();
  return out;
}

/** Session id an OpenCode event refers to, whichever shape it uses. */
export function sessionIdOf(evt) {
  const props = evt?.properties || {};
  return props.sessionID
    || props.part?.sessionID
    || props.info?.sessionID
    || props.info?.id
    || null;
}

/**
 * @param {object} evt   raw OpenCode event
 * @param {{ state: ReturnType<typeof createRunState>, conversation: string }} ctx
 * @returns {object[]} canonical bridge events to broadcast, in order
 */
export function translateEvent(evt, { state: st, conversation: conv }) {
  const type = evt?.type;
  const props = evt?.properties || {};
  const sessionID = sessionIdOf(evt);
  if (!sessionID || !conv || !st) return [];

  if (type === 'message.updated') {
    const info = props.info || {};
    if (info.role === 'assistant' && info.id) st.assistantMsgs.add(info.id);
    if (info.error) {
      const errMsg = info.error?.data?.message || info.error?.message || (typeof info.error === 'string' ? info.error : JSON.stringify(info.error));
      console.error(`[opencode-bridge] Model error in ${conv} (${sessionID}):`, errMsg);
      st.lastError = `⚠️ Erreur modèle : ${errMsg}`;
      st.fullText = st.lastError;
      st.running = false;
      return [
        {
          type: 'response',
          conversation: conv,
          composer_id: sessionID,
          text: st.fullText,
        },
        {
          type: 'response_complete',
          conversation: conv,
          composer_id: sessionID,
          chat_id: sessionID,
          text: st.fullText,
          exit: 1,
          error: errMsg,
        },
        { type: 'run_complete', conversation: conv, composer_id: sessionID },
      ];
    }
    return [];
  }

  if (type === 'message.part.updated') {
    const part = props.part || {};
    if (part.id && part.type) st.partTypes.set(part.id, part.type);

    if (part.type === 'tool') {
      if (part.state?.status === 'error') {
        st.lastError = `⚠️ Erreur outil ${part.tool || 'tool'} : ${part.state.error || part.state.output || 'Interrompu'}`;
      }
      return toolPartEvents(conv, st, part);
    }

    if ((part.type === 'reasoning' || part.type === 'thought' || part.type === 'thinking') && (part.text || part.reasoning_content)) {
      const reasoningText = part.text || part.reasoning_content || '';
      st.lastReasoning = reasoningText;
      return [{
        type: 'thinking',
        conversation: conv,
        composer_id: sessionID,
        text: reasoningText,
        delta: reasoningText,
      }];
    }

    // A full text part may land at once — short replies never emit deltas.
    if (part.type === 'text' && part.text && st.assistantMsgs.has(part.messageID)) {
      if (part.text.length > st.fullText.length) {
        st.fullText = part.text;
        return [{
          type: 'response',
          conversation: conv,
          composer_id: sessionID,
          text: st.fullText,
        }];
      }
    }
    return [];
  }

  if (type === 'message.part.delta') {
    const { partID, field, delta } = props;
    if (!delta) return [];
    const partType = st.partTypes.get(partID);
    if (!partType) return [];
    const isReasoning = (
      field === 'reasoning_content'
      || field === 'reasoning'
      || field === 'thought'
      || field === 'thinking'
      || partType === 'reasoning'
      || partType === 'thought'
      || partType === 'thinking'
    );

    if (isReasoning) {
      st.running = true;
      st.lastReasoning = (st.lastReasoning || '') + delta;
      return [{ type: 'thinking', conversation: conv, composer_id: sessionID, delta }];
    }
    const isText = (field === 'text' || (!field && partType === 'text')) && (props.messageID ? st.assistantMsgs.has(props.messageID) : true);
    if (isText) {
      st.running = true;
      st.fullText += delta;
      return [{
        type: 'response',
        conversation: conv,
        composer_id: sessionID,
        delta,
        text: st.fullText,
      }];
    }
    return [];
  }

  if (type === 'session.idle') {
    if (!st.running) return [];
    st.running = false;

    const out = [...closeOpenTools(conv, st, sessionID)];
    out.push({ type: 'thinking', conversation: conv, subtype: 'completed', composer_id: sessionID });

    // Guaranteed non-empty final response so user and voice engine are never left in the dark
    if (!st.fullText.trim()) {
      st.fullText = st.lastError || "L'action a été exécutée par l'agent.";
      out.push({
        type: 'response',
        conversation: conv,
        composer_id: sessionID,
        text: st.fullText,
      });
    }

    out.push(
      {
        type: 'response_complete',
        conversation: conv,
        composer_id: sessionID,
        chat_id: sessionID,
        text: st.fullText,
        exit: st.lastError ? 1 : 0,
      },
      { type: 'run_complete', conversation: conv, composer_id: sessionID }
    );

    return out;
  }

  return [];
}
