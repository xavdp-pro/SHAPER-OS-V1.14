/**
 * Provider-neutral contract shared by every SHAPER cognition bridge.
 * A bridge advertises what it can do; a caller must not infer it from the
 * engine, model, CLI, host, or container name.
 */
export const SHAPER_BRIDGE_PROTOCOL = 'shaper-bridge/v1';

export const DEFAULT_CAPABILITIES = Object.freeze({
  inject: true,
  events: true,
  status: true,
  stopRun: false,
  resetSession: false,
  bindWorkspace: false,
  attachments: false,
  modelSelection: false,
});

export function normalizeCapabilities(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const key of Object.keys(DEFAULT_CAPABILITIES)) {
    out[key] = source[key] == null ? DEFAULT_CAPABILITIES[key] : Boolean(source[key]);
  }
  return out;
}

export function bridgeStatus({ service = '', ready = false, capabilities = {}, ...rest } = {}) {
  return {
    ok: true,
    protocol: SHAPER_BRIDGE_PROTOCOL,
    service: String(service || '').trim(),
    ready: Boolean(ready),
    capabilities: normalizeCapabilities(capabilities),
    ...rest,
  };
}

/** Returns readable contract faults without making a provider-specific guess. */
export function validateBridgeStatus(raw) {
  const errors = [];
  if (!raw || typeof raw !== 'object') return ['status must be an object'];
  if (raw.protocol !== SHAPER_BRIDGE_PROTOCOL) errors.push(`protocol must be ${SHAPER_BRIDGE_PROTOCOL}`);
  if (typeof raw.service !== 'string' || !raw.service.trim()) errors.push('service must be a non-empty string');
  if (typeof raw.ready !== 'boolean') errors.push('ready must be boolean');
  if (!raw.capabilities || typeof raw.capabilities !== 'object') {
    errors.push('capabilities must be an object');
  } else {
    for (const key of Object.keys(DEFAULT_CAPABILITIES)) {
      if (typeof raw.capabilities[key] !== 'boolean') errors.push(`capabilities.${key} must be boolean`);
    }
  }
  return errors;
}
