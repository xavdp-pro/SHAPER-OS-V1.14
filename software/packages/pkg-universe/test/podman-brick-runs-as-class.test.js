import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Intent: software/RULES.md#rule-11-a-brick-runs-as-its-own-class-not-root
//
// Non-regression (Rule 29) for the convention named there, 3 September 2026:
// a class's own brick runs as a Linux account named after the class, never
// root — reporting turbinobash-web's `useradd -m -s /bin/bash ${app} -d
// $d_app` into the podman world. Proven in production on univ-demo-crm's
// crm-app and univ-demo-saas's saas-app before this rule existed to name
// why (`podman exec <brick> id` reporting the class's own uid, not 0, in
// both dev and prod).

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const read = (p) => fs.readFileSync(path.join(REPO, p), 'utf8');

const EXAMPLE_PATH = 'software/universes/_maker-template/recipes/podman-brick.Containerfile.example';

/**
 * A Containerfile runs as its class, not root, when the LAST build stage
 * (everything after the final FROM) carries a USER directive whose argument
 * is neither root nor uid 0. Returns a list of defects; empty means the
 * shape satisfies the rule.
 */
export function nonRootDefects(containerfile) {
  const defects = [];
  const lines = containerfile.split('\n').map((l) => l.trim());

  const fromIdx = lines.reduce((last, l, i) => (/^FROM\b/i.test(l) ? i : last), -1);
  if (fromIdx === -1) return ['no FROM line — not a Containerfile'];
  const finalStage = lines.slice(fromIdx);

  const userLines = finalStage.filter((l) => /^USER\s+\S+/i.test(l));
  if (userLines.length === 0) {
    defects.push('no USER directive in the final stage — the image defaults to root');
    return defects;
  }

  const lastUser = userLines[userLines.length - 1];
  const account = lastUser.replace(/^USER\s+/i, '').trim();
  if (account === 'root' || account === '0') {
    defects.push(`USER is "${account}" — root by another name defeats the rule`);
  }

  return defects;
}

test('the reference brick Containerfile runs as its class, not root', () => {
  const containerfile = read(EXAMPLE_PATH);
  assert.deepEqual(nonRootDefects(containerfile), []);
});

test('the reference Containerfile is the one Rule 11 names', () => {
  const rules = read('software/RULES.md');
  assert.ok(
    rules.includes('_maker-template/recipes/podman-brick.Containerfile.example'),
    'Rule 11 does not point at the Containerfile example this test checks',
  );
});

test('the detector recognises the shape a class could plausibly get wrong', () => {
  // forgotten USER: the image silently defaults to root.
  const noUser = [
    'FROM docker.io/library/node:22-slim',
    'WORKDIR /apps/crm/app',
    'CMD ["node", "src/server.js"]',
  ].join('\n');
  assert.notEqual(nonRootDefects(noUser).length, 0);

  // explicit root: same defect, spelled out instead of implied.
  const explicitRoot = [
    'FROM docker.io/library/node:22-slim',
    'WORKDIR /apps/crm/app',
    'USER root',
    'CMD ["node", "src/server.js"]',
  ].join('\n');
  assert.notEqual(nonRootDefects(explicitRoot).length, 0);

  // a builder stage running as root is fine — only the FINAL stage matters,
  // since that is the one the running image actually starts.
  const builderStageIsFine = [
    'FROM docker.io/library/node:22-slim AS builder',
    'WORKDIR /build',
    'RUN npm ci',
    '',
    'FROM docker.io/library/node:22-slim',
    'RUN useradd -u 10001 -m -s /bin/bash crm -d /apps/crm',
    'WORKDIR /apps/crm/app',
    'USER crm',
    'CMD ["node", "src/server.js"]',
  ].join('\n');
  assert.deepEqual(nonRootDefects(builderStageIsFine), []);
});

test('the two demo classes proven in production match this shape', () => {
  // Inline, not read from univ-demo-crm/univ-demo-saas: those are separate
  // repos, outside this one's tree — this base repo does not depend on a
  // sibling checkout existing at any particular path. These are the exact
  // final stages proven live on gbs-test and gbs-p2, 3 September 2026.
  const crmApp = [
    'FROM docker.io/library/node:22-slim',
    'RUN useradd -u 10001 -m -s /bin/bash crm -d /apps/crm',
    'WORKDIR /apps/crm/app',
    'COPY --from=builder --chown=crm:crm /build/dist ./dist',
    'ENV NODE_ENV=production',
    'ENV PORT=80',
    'EXPOSE 80',
    'USER crm',
    'CMD ["node", "src/server.js"]',
  ].join('\n');
  assert.deepEqual(nonRootDefects(crmApp), []);

  const saasApp = [
    'FROM docker.io/library/node:22-slim',
    'RUN useradd -u 10001 -m -s /bin/bash saas -d /apps/saas',
    'WORKDIR /apps/saas/app',
    'COPY --from=builder --chown=saas:saas /apps/saas/app ./',
    'ENV NODE_ENV=production',
    'EXPOSE 7044 7050',
    'USER saas',
    'CMD ["node", "src/backend/server.js"]',
  ].join('\n');
  assert.deepEqual(nonRootDefects(saasApp), []);
});
