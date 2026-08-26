export function opencodeBridgeVitals({
  startedAt,
  ready,
  model,
  stub,
  conversations,
  activeRuns,
  eventClients,
  servePid = null,
  now = Date.now(),
} = {}) {
  return {
    service: 'brick-bridge-opencode',
    at: new Date(now).toISOString(),
    uptimeSeconds: Math.max(0, (now - startedAt) / 1000),
    signals: {
      ready: Boolean(ready),
      model: model || null,
      stub: Boolean(stub),
      conversations: Number(conversations || 0),
      activeRuns: Number(activeRuns || 0),
      eventClients: Number(eventClients || 0),
    },
    checks: {
      opencodeServe: {
        ready: Boolean(ready),
        pid: servePid || null,
      },
    },
  };
}
