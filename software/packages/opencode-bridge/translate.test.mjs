/**
 * Unit tests for the OpenCode -> bridge contract translation.
 *
 * Event shapes below are taken from real captures against opencode 1.18.15,
 * not invented: the point is to lock the mapping against what the CLI emits.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createRunState,
  splitModel,
  sessionIdOf,
  closeOpenTools,
  translateEvent,
} from './translate.mjs';

const SESSION = 'ses_fec155dfeffeN2mym8OMaobqB5';
const MSG = 'msg_013eaa6de001Wru3ygaKCI44HB';
const CONV = 'demo';

/** Feed a list of raw events, collect everything the bridge would broadcast. */
function run(events, st = createRunState()) {
  const out = [];
  for (const evt of events) out.push(...translateEvent(evt, { state: st, conversation: CONV }));
  return { out, state: st };
}

const assistantMessage = (id = MSG) => ({
  type: 'message.updated',
  properties: { info: { id, role: 'assistant', sessionID: SESSION } },
});
const partUpdated = (part) => ({
  type: 'message.part.updated',
  properties: { sessionID: SESSION, part: { sessionID: SESSION, ...part } },
});
const delta = (partID, text, messageID = MSG) => ({
  type: 'message.part.delta',
  properties: { sessionID: SESSION, messageID, partID, field: 'text', delta: text },
});

test('splitModel', async (t) => {
  await t.test('splits provider and model', () => {
    assert.deepEqual(splitModel('opencode/nemotron-3-ultra-free'), {
      providerID: 'opencode',
      modelID: 'nemotron-3-ultra-free',
    });
  });

  await t.test('a bare id defaults to the opencode provider', () => {
    assert.deepEqual(splitModel('big-pickle'), {
      providerID: 'opencode',
      modelID: 'big-pickle',
    });
  });

  await t.test('falls back when nothing is asked for', () => {
    assert.deepEqual(splitModel('', 'opencode/hy3-free'), {
      providerID: 'opencode',
      modelID: 'hy3-free',
    });
  });

  await t.test('keeps a model id that contains slashes', () => {
    assert.deepEqual(splitModel('openrouter/meta/llama-3'), {
      providerID: 'openrouter',
      modelID: 'meta/llama-3',
    });
  });
});

test('sessionIdOf reads every shape OpenCode uses', async (t) => {
  await t.test('from properties.sessionID', () => {
    assert.equal(sessionIdOf({ properties: { sessionID: SESSION } }), SESSION);
  });
  await t.test('from the part', () => {
    assert.equal(sessionIdOf({ properties: { part: { sessionID: SESSION } } }), SESSION);
  });
  await t.test('from session.created info.id', () => {
    assert.equal(sessionIdOf({ properties: { info: { id: SESSION } } }), SESSION);
  });
  await t.test('null when absent', () => {
    assert.equal(sessionIdOf({ properties: {} }), null);
  });
});

test('text deltas', async (t) => {
  await t.test('a reasoning part becomes thinking, never response', () => {
    const { out } = run([
      assistantMessage(),
      partUpdated({ id: 'prt_r', type: 'reasoning', messageID: MSG, text: '' }),
      delta('prt_r', 'The user'),
      delta('prt_r', ' wants'),
    ]);
    assert.deepEqual(out.map((e) => e.type), ['thinking', 'thinking']);
    assert.equal(out[0].delta, 'The user');
    assert.equal(out[0].conversation, CONV);
  });

  await t.test('a text part accumulates into response with a cumulative text', () => {
    const { out } = run([
      assistantMessage(),
      partUpdated({ id: 'prt_t', type: 'text', messageID: MSG, text: '' }),
      delta('prt_t', 'Bon'),
      delta('prt_t', 'jour'),
    ]);
    assert.deepEqual(out.map((e) => e.type), ['response', 'response']);
    assert.deepEqual(out.map((e) => e.delta), ['Bon', 'jour']);
    assert.equal(out[1].text, 'Bonjour', 'text must be cumulative, deltas are not');
  });

  await t.test('the prompt echoed back is not mistaken for the reply', () => {
    // The user message carries a text part too; only assistant messages count.
    const { out, state } = run([
      partUpdated({ id: 'prt_u', type: 'text', messageID: 'msg_user', text: 'ma question' }),
      delta('prt_u', 'ma question', 'msg_user'),
    ]);
    assert.deepEqual(out, []);
    assert.equal(state.fullText, '');
  });

  await t.test('a delta on an unknown part is ignored', () => {
    const { out } = run([assistantMessage(), delta('prt_unknown', 'x')]);
    assert.deepEqual(out, []);
  });

  await t.test('non-text fields are ignored', () => {
    const { out } = run([
      assistantMessage(),
      partUpdated({ id: 'prt_t', type: 'text', messageID: MSG }),
      {
        type: 'message.part.delta',
        properties: { sessionID: SESSION, messageID: MSG, partID: 'prt_t', field: 'metadata', delta: 'x' },
      },
    ]);
    assert.deepEqual(out, []);
  });

  await t.test('a short reply arrives as a whole part, without deltas', () => {
    const { out } = run([
      assistantMessage(),
      partUpdated({ id: 'prt_t', type: 'text', messageID: MSG, text: 'BONJOUR' }),
    ]);
    assert.deepEqual(out.map((e) => e.type), ['response']);
    assert.equal(out[0].text, 'BONJOUR');
  });

  await t.test('a repeated whole part does not re-emit', () => {
    const { out } = run([
      assistantMessage(),
      partUpdated({ id: 'prt_t', type: 'text', messageID: MSG, text: 'BONJOUR' }),
      partUpdated({ id: 'prt_t', type: 'text', messageID: MSG, text: 'BONJOUR' }),
    ]);
    assert.equal(out.length, 1);
  });
});

test('tool parts', async (t) => {
  const toolPart = (status, extra = {}) => partUpdated({
    id: 'prt_tool',
    type: 'tool',
    tool: 'bash',
    callID: 'call-84fac4ba',
    messageID: MSG,
    state: { status, ...extra },
  });

  await t.test('running then completed maps to tool then tool_complete', () => {
    const { out } = run([
      toolPart('running', { input: { command: 'ls -la' } }),
      toolPart('completed', { input: { command: 'ls -la' }, output: 'total 4\na.txt' }),
    ]);
    assert.deepEqual(out.map((e) => e.type), ['tool', 'tool_complete']);
    assert.equal(out[0].call_id, 'call-84fac4ba');
    assert.equal(out[0].tool, 'bash');
    assert.equal(out[0].command, 'ls -la');
    assert.equal(out[1].call_id, out[0].call_id, 'same call_id so the block is upserted');
    assert.equal(out[1].result, 'total 4\na.txt');
  });

  await t.test('identical repeats are dropped, a changed payload is re-emitted', () => {
    // Observed live: arguments are empty on the first update and land later.
    const { out } = run([
      toolPart('running', { input: {} }),
      toolPart('running', { input: { command: 'ls -la' } }),
      toolPart('running', { input: { command: 'ls -la' } }),
      toolPart('running', { input: { command: 'ls -la' } }),
    ]);
    assert.equal(out.length, 2, 'the three identical updates collapse into one');
    assert.equal(out[0].command, null);
    assert.equal(out[1].command, 'ls -la');
  });

  await t.test('an error carries the error field', () => {
    const { out } = run([
      toolPart('running', { input: { command: 'nope' } }),
      toolPart('error', { input: { command: 'nope' }, output: 'command not found' }),
    ]);
    assert.equal(out[1].type, 'tool_complete');
    assert.equal(out[1].error, 'command not found');
  });

  await t.test('cwd is read from either path or cwd', () => {
    const { out } = run([toolPart('running', { input: { path: '/tmp/x' } })]);
    assert.equal(out[0].cwd, '/tmp/x');
  });

  await t.test('a part without any id is skipped', () => {
    const { out } = run([partUpdated({ type: 'tool', tool: 'bash', state: { status: 'running' } })]);
    assert.deepEqual(out, []);
  });
});

test('end of run', async (t) => {
  await t.test('session.idle closes the run with the accumulated text', () => {
    const st = createRunState();
    st.running = true;
    const { out } = run([
      assistantMessage(),
      partUpdated({ id: 'prt_t', type: 'text', messageID: MSG }),
      delta('prt_t', 'Fini.'),
      { type: 'session.idle', properties: { sessionID: SESSION } },
    ], st);

    assert.deepEqual(out.map((e) => e.type), [
      'response', 'thinking', 'response_complete', 'run_complete',
    ]);
    const thinkingDone = out.find((e) => e.type === 'thinking');
    assert.equal(thinkingDone.subtype, 'completed');
    const complete = out.find((e) => e.type === 'response_complete');
    assert.equal(complete.text, 'Fini.');
    assert.equal(complete.chat_id, SESSION);
    assert.equal(complete.exit, 0);
    assert.equal(st.running, false);
  });

  await t.test('idle without a live run emits nothing', () => {
    // Sessions go idle on their own; only a run we started may be closed.
    const { out } = run([{ type: 'session.idle', properties: { sessionID: SESSION } }]);
    assert.deepEqual(out, []);
  });

  await t.test('a tool still open at idle is closed, never left running', () => {
    const st = createRunState();
    st.running = true;
    const { out } = run([
      partUpdated({
        id: 'prt_tool', type: 'tool', tool: 'bash', callID: 'call-1',
        messageID: MSG, state: { status: 'running', input: { command: 'sleep 99' } },
      }),
      { type: 'session.idle', properties: { sessionID: SESSION } },
    ], st);

    const closes = out.filter((e) => e.type === 'tool_complete');
    assert.equal(closes.length, 1);
    assert.equal(closes[0].call_id, 'call-1');
    assert.equal(st.toolsOpen.size, 0);
    // The close must precede the end of the run.
    assert.ok(
      out.indexOf(closes[0]) < out.findIndex((e) => e.type === 'run_complete'),
      'tools close before run_complete',
    );
  });

  await t.test('idle twice does not close the run twice', () => {
    const st = createRunState();
    st.running = true;
    const idle = { type: 'session.idle', properties: { sessionID: SESSION } };
    const { out } = run([idle, idle], st);
    assert.equal(out.filter((e) => e.type === 'run_complete').length, 1);
  });
});

test('closeOpenTools', async (t) => {
  await t.test('empties the open set and reports each tool once', () => {
    const st = createRunState();
    st.toolsOpen.add('a').add('b');
    const out = closeOpenTools(CONV, st, SESSION);
    assert.deepEqual(out.map((e) => e.call_id), ['a', 'b']);
    assert.equal(st.toolsOpen.size, 0);
    assert.deepEqual(closeOpenTools(CONV, st, SESSION), [], 'nothing left to close');
  });
});

test('events outside a known conversation are ignored', async (t) => {
  await t.test('no conversation means no output', () => {
    const out = translateEvent(assistantMessage(), {
      state: createRunState(),
      conversation: '',
    });
    assert.deepEqual(out, []);
  });

  await t.test('unknown event types are ignored', () => {
    const { out } = run([
      { type: 'server.heartbeat', properties: { sessionID: SESSION } },
      { type: 'plugin.added', properties: { sessionID: SESSION } },
      { type: 'session.diff', properties: { sessionID: SESSION } },
    ]);
    assert.deepEqual(out, []);
  });
});

test('a full run reproduces the captured sequence', async (t) => {
  await t.test('inject to run_complete, in order', () => {
    const st = createRunState();
    st.running = true;
    const { out } = run([
      assistantMessage(),
      partUpdated({ id: 'prt_r', type: 'reasoning', messageID: MSG, text: '' }),
      delta('prt_r', 'I should list the files'),
      partUpdated({
        id: 'prt_tool', type: 'tool', tool: 'bash', callID: 'call-1',
        messageID: MSG, state: { status: 'running', input: {} },
      }),
      partUpdated({
        id: 'prt_tool', type: 'tool', tool: 'bash', callID: 'call-1',
        messageID: MSG, state: { status: 'running', input: { command: 'ls -la' } },
      }),
      partUpdated({
        id: 'prt_tool', type: 'tool', tool: 'bash', callID: 'call-1',
        messageID: MSG, state: { status: 'completed', input: { command: 'ls -la' }, output: 'a.txt' },
      }),
      partUpdated({ id: 'prt_t', type: 'text', messageID: MSG }),
      delta('prt_t', '| Fichier |'),
      delta('prt_t', ' a.txt |'),
      { type: 'session.idle', properties: { sessionID: SESSION } },
    ], st);

    assert.deepEqual(out.map((e) => e.type), [
      'thinking',
      'tool', 'tool', 'tool_complete',
      'response', 'response',
      'thinking', 'response_complete', 'run_complete',
    ]);
    assert.equal(out.at(-2).text, '| Fichier | a.txt |');
  });
});
