import jwt from 'jsonwebtoken';
import { config } from '/apps/helm-v2/app/server/config.js';

const token = jwt.sign(
  { id: 3, email: 'admin@example.com', role: 'admin' },
  config.jwtSecret,
  { expiresIn: '5m' },
);

const headers = { Authorization: `Bearer ${token}` };

const health = await fetch('http://127.0.0.1:7926/api/health').then((r) => r.json());

let eventsStatus = 'timeout';
try {
  const res = await fetch('http://127.0.0.1:7926/api/events', {
    headers,
    signal: AbortSignal.timeout(2000),
  });
  eventsStatus = res.status;
} catch {
  eventsStatus = 'timeout';
}

const timelineRes = await fetch('http://127.0.0.1:7926/api/timeline/cursor/helm-v2/Xavier', {
  headers,
});
const timelineBody = await timelineRes.json().catch(() => ({}));

const bridgeToken = process.env.BRIDGE_TOKEN;
let bridgeHealth = null;
if (bridgeToken) {
  bridgeHealth = await fetch('http://127.0.0.1:4310/api/health', {
    headers: { Authorization: `Bearer ${bridgeToken}` },
  }).then((r) => r.json());
}

console.log(
  JSON.stringify(
    {
      health,
      bridgeHealth,
      eventsStatus,
      timeline: {
        status: timelineRes.status,
        itemCount: Array.isArray(timelineBody.items) ? timelineBody.items.length : timelineBody,
      },
    },
    null,
    2,
  ),
);
