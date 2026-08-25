/**
 * @typedef {object} AgentCapabilities
 * @property {boolean} stopRun - Bridge can abort an in-flight CLI run
 * @property {boolean} resetSession - Bridge can wipe / restart CLI session context
 * @property {boolean} bindWorkspace - Bridge supports per-conversation cwd binding
 * @property {'composer'|'litellm'|'passthrough'} modelField - How inject picks a model
 * @property {string} transportLabel - Human-readable transport id for status UI
 */

/**
 * @typedef {object} BridgeTarget
 * @property {string} url
 * @property {string} [token]
 * @property {string} [kind]
 * @property {string} [pluginId]
 * @property {string} [name]
 * @property {string} [user]
 */

/**
 * @typedef {object} AdapterContext
 * @property {BridgeTarget} target
 * @property {string} conversationName - Short conversation id for the bridge API
 * @property {(target: BridgeTarget, path: string, options?: object) => Promise<object>} apiFetch
 */

/**
 * @typedef {object} InjectBuildContext
 * @property {string} conversationName
 * @property {string} message
 * @property {Array} attachments
 * @property {string} [model]
 */

/**
 * @typedef {object} AgentAdapter
 * @property {string} kind
 * @property {AgentCapabilities} capabilities
 * @property {(ctx: AdapterContext) => Promise<object>} resetSession
 * @property {(ctx: AdapterContext, opts?: { all?: boolean }) => Promise<object>} stopRun
 * @property {(ctx: InjectBuildContext) => object} buildInjectBody
 */

export {};
