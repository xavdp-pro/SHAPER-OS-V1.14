// Intent: software/universes/univ-minimal/INTENT.md#rehearsal
// Rehearsal-only: the environment the rehearsals run the base's scripts in.
//
// The base's scripts read their settings with deploy/settings.sh, which hands
// every command an environment built explicitly (INTENT.md#settings): nothing
// the script inherited reaches podman. The rehearsal's podman (bin/podman)
// needs to know where its state, its MariaDB and the worktree are; it cannot
// learn that from the script's environment, so it is reached through a small
// wrapper written into the run's work directory, which carries those paths
// itself. No production code knows this harness exists.
//
// The inherited environment is also cleaned of what the base would rightly
// refuse: run-live.mjs's own SHAPER_LIVE_* variables (an unknown SHAPER_* name)
// and entries whose names no shell can hold.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const quote = (s) => `'${String(s).replace(/'/g, "'\\''")}'`;

/**
 * @param {{ workDir: string, socket: string, software: string, mariadb: string }} where
 * @returns {{ env: Record<string,string>, fakeState: string }}
 */
export function rehearsalEnv({ workDir, socket, software, mariadb }) {
  const fakeState = path.join(workDir, 'fake');
  const fakeBin = path.join(workDir, 'fakebin');
  fs.mkdirSync(fakeBin, { recursive: true });
  fs.writeFileSync(path.join(fakeBin, 'podman'), [
    '#!/bin/sh',
    '# Rehearsal-only: the fake podman, with the paths it needs carried here.',
    `FAKE_STATE=${quote(fakeState)} FAKE_SOCKET=${quote(socket)} FAKE_SOFTWARE=${quote(software)} FAKE_MARIADB=${quote(mariadb)} \\`,
    `  exec ${quote(path.join(HERE, 'bin/podman'))} "$@"`,
    '',
  ].join('\n'), { mode: 0o755 });
  const hasJq = spawnSync('sh', ['-c', 'command -v jq'], { encoding: 'utf8' }).status === 0;
  const inherited = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !/^(SHAPER_|BASH_FUNC_)/.test(name)));
  delete inherited.VAULT_TOKEN;
  delete inherited.ENV_FILE;
  return {
    fakeState,
    env: {
      ...inherited,
      PATH: [fakeBin, path.join(HERE, 'bin'), ...(hasJq ? [] : [path.join(HERE, 'jq-shim')]), process.env.PATH].join(':'),
      // For the harness's own direct calls (bin/podman stop, effects-driver.sh).
      FAKE_STATE: fakeState, FAKE_SOCKET: socket, FAKE_SOFTWARE: software, FAKE_MARIADB: mariadb, REHEARSAL_SOFTWARE: software,
    },
  };
}
