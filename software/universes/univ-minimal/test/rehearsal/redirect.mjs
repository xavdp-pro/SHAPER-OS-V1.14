// Intent: software/universes/univ-minimal/INTENT.md#rehearsal
// Rehearsal-only: a process started by the fake podman sees the container's
// paths. FAKE_MOUNTS is a JSON list of [containerPath, hostPath], longest
// first; every synchronous fs call whose first argument starts with a mounted
// container path is redirected to the host path.
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

const mounts = JSON.parse(process.env.FAKE_MOUNTS || '[]').sort((a, b) => b[0].length - a[0].length);
const map = (p) => {
  if (typeof p !== 'string') return p;
  for (const [dst, src] of mounts) {
    if (p === dst) return src;
    if (p.startsWith(`${dst}/`)) return src + p.slice(dst.length);
  }
  return p;
};
for (const name of Object.keys(fs)) {
  if (!/Sync$/.test(name) || typeof fs[name] !== 'function') continue;
  const original = fs[name];
  const twoPaths = ['renameSync', 'copyFileSync', 'linkSync', 'symlinkSync', 'cpSync'].includes(name);
  fs[name] = function redirected(a, b, ...rest) {
    return twoPaths ? original.call(fs, map(a), map(b), ...rest) : original.call(fs, map(a), b, ...rest);
  };
}
syncBuiltinESMExports();
