import test from 'node:test';
import assert from 'node:assert/strict';
import { listAgentPlugins, getAgentPlugin, getDefaultPluginId, isCliEnginePlugin } from './agentPlugins.js';
import { getAgentAdapter } from './agentAdapters/index.js';

/** Reload the list from the current env — the module caches it. */
const plugins = (env = {}) => {
  const saved = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return listAgentPlugins({ force: true });
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
};

test('default engine registry', async (t) => {
  await t.test('cursor, agy and opencode are present without any config', () => {
    const ids = plugins({ AGENT_PLUGINS: undefined }).map((p) => p.id);
    for (const id of ['cursor', 'agy', 'opencode']) {
      assert.ok(ids.includes(id), `${id} should be registered by default`);
    }
  });

  await t.test('each engine keeps its own port', () => {
    const byId = Object.fromEntries(plugins({
      AGENT_PLUGINS: undefined,
      CURSOR_BRIDGE_URL: undefined,
      AGY_BRIDGE_URL: undefined,
      OPENCODE_BRIDGE_URL: undefined,
    }).map((p) => [p.id, p.url]));
    assert.match(byId.cursor, /:(4310|4440)$/);
    assert.match(byId.agy, /:(4330|4440)$/);
    assert.match(byId.opencode, /:(4340|4440)$/);
  });

  await t.test('no duplicates when a plugin is also declared explicitly', () => {
    const list = plugins({ AGENT_PLUGINS: 'opencode|http://127.0.0.1:9999|tok' });
    const opencode = list.filter((p) => p.id === 'opencode');
    assert.equal(opencode.length, 1);
    assert.equal(opencode[0].url, 'http://127.0.0.1:9999', 'explicit config wins');
  });

  await t.test('a trailing slash is trimmed from the url', () => {
    const list = plugins({ AGENT_PLUGINS: 'opencode|http://127.0.0.1:4340/|tok' });
    assert.equal(list.find((p) => p.id === 'opencode').url, 'http://127.0.0.1:4340');
  });
});

test('plugin kinds', async (t) => {
  await t.test('opencode has its own kind, so its bridge token resolves', () => {
    // Sharing the generic kind would send it looking for another CLI's token.
    const opencode = plugins({ AGENT_PLUGINS: undefined }).find((p) => p.id === 'opencode');
    assert.equal(opencode.kind, 'opencode');
  });

  await t.test('opencode has its own adapter, workspace binding included', () => {
    // The bridge scopes a session to a directory: the console needs
    // bindWorkspace to be true to let it pilot the agent's cwd.
    const adapter = getAgentAdapter('opencode');
    assert.equal(adapter.kind, 'opencode');
    assert.equal(adapter.capabilities.bindWorkspace, true);
  });

  await t.test('display names are human readable', () => {
    const byId = Object.fromEntries(plugins({ AGENT_PLUGINS: undefined }).map((p) => [p.id, p.name]));
    assert.equal(byId.opencode, 'OpenCode');
    assert.equal(byId.agy, 'Antigravity');
    assert.equal(byId.cursor, 'Cursor');
  });

  await t.test('every default plugin is recognised as a CLI engine', () => {
    for (const p of plugins({ AGENT_PLUGINS: undefined })) {
      assert.ok(isCliEnginePlugin(p), `${p.id} should be a CLI engine`);
    }
  });
});

test('plugin lookup', async (t) => {
  await t.test('getAgentPlugin finds one by id', () => {
    plugins({ AGENT_PLUGINS: undefined });
    assert.equal(getAgentPlugin('opencode').id, 'opencode');
  });

  await t.test('an unknown id falls back rather than returning nothing', () => {
    plugins({ AGENT_PLUGINS: undefined });
    assert.ok(getAgentPlugin('inexistant'));
  });

  await t.test('the default plugin is always one that exists', () => {
    const ids = plugins({ AGENT_PLUGINS: undefined }).map((p) => p.id);
    assert.ok(ids.includes(getDefaultPluginId()));
  });

  await t.test('an unknown DEFAULT_AGENT_PLUGIN does not break the default', () => {
    plugins({ AGENT_PLUGINS: undefined, DEFAULT_AGENT_PLUGIN: 'nexistepas' });
    const ids = listAgentPlugins().map((p) => p.id);
    assert.ok(ids.includes(getDefaultPluginId()));
  });
});
