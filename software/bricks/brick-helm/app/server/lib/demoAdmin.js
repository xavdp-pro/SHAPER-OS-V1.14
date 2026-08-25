import { config } from '../config.js';

/** Demo operator seeded at API boot — also filled by the login "Try demo" button.
 * Not full admin: demo operator may manage TTS voices only (demo instance DB).
 * Dedicated bridge conversation — must not share Ivonne / other guest timelines. */
export const DEMO_ADMIN = {
  email: process.env.DEMO_ADMIN_EMAIL || 'thesuperuser@helm.local',
  name: 'TheSuperUser',
  /** Demo-instance password. Seeded into MariaDB ONLY when APP_MODE=demo, and
   *  displayed on that instance's own login page by design. Override in any
   *  deployment that is reachable beyond a throwaway demo host. */
  password: process.env.DEMO_ADMIN_PASSWORD || '123Soleil123!',
  role: 'operator',
  /** Own session on the CLI bridge (isolated from demo guests). */
  conversation: 'Demo',
  notes: 'Demo operator account — voices admin on demo host only',
  briefing: [
    'Demo operator on KovZu.',
    'KovZu is the web console that pilots an artificial intelligence. Zephir is the AI agent inside KovZu.',
    'Be concise and useful.',
    'Autonomously discover your environment: you run in a Podman container with host network access. Use system tools (free -m, df -h, nproc, uptime) to inspect hardware and resources before heavy tasks, and control peer services via Maestro (:8530) or Podman socket.',
    'Always reply in the language currently selected in the KovZu UI for this session (French, English, or Spanish) - including greetings, answers, AND internal thinking/reasoning.',
    'When you greet, briefly explain KovZu and Zephir, say you are ready to help, then invite them to click the help button (?) at the top right to discover how the interface works, then wait.',
  ].join('\n'),
};

/** Admin role, or demo operator on APP_MODE=demo (not demo guests). */
export function canManageDemoVoices(user) {
  if (!user || user.status !== 'active') return false;
  if (user.role === 'admin') return true;
  if (!config.isDemo) return false;
  const email = String(user.email || '').trim().toLowerCase();
  return email === String(DEMO_ADMIN.email).trim().toLowerCase();
}

/** Demo guests + demo operator may edit their own briefing (not full admin). */
export function canAccessDemoBriefingAdmin(user) {
  if (!user || user.status !== 'active' || !config.isDemo) return false;
  if (user.role === 'admin') return true;
  if (canManageDemoVoices(user)) return true;
  const slug = String(user.demoSlug || user.demo_slug || '').trim();
  return Boolean(slug);
}
