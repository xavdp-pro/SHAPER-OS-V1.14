import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Intent: INTENT.md
//
// Born from the v1.13.9 sealing run (report-seal-muse): the literal deploy
// path still forced three workarounds. Each test below fails on the doc as it
// stood before the fix — Rule 29 applied to the runbook itself, because for a
// literal agent the runbook IS the code.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const runbook = fs.readFileSync(path.join(root, 'docs/agent/RUNBOOK-EXPLICIT.md'), 'utf8');
const betaTest = fs.readFileSync(path.join(root, 'docs/agent/BETA-DEPLOYMENT-TEST.md'), 'utf8');

describe('sealing incident 1 — Step 4.1 fills software/.env itself', () => {
  it('injects VAULT_MASTER_KEY into software/.env between the cp and the FILL block', () => {
    const cp = runbook.indexOf('cp .env.example software/.env');
    const fill = runbook.indexOf("<<'FILL'");
    assert.ok(cp !== -1 && fill !== -1 && cp < fill, 'Step 4.1 structure missing');
    const between = runbook.slice(cp, fill);
    assert.match(
      between,
      /sed -i "s\|\^VAULT_MASTER_KEY=/,
      'the copies carry empty keys and nothing documented fills software/.env — every literal tester stalls here (report-seal-muse Incident 1)'
    );
    assert.match(between, /sed -i "s\|\^VAULT_TOKEN=/, 'VAULT_TOKEN injection missing too');
  });

  it('Step 2 no longer asks for a hand-edit of a file that does not exist yet', () => {
    assert.doesNotMatch(
      runbook,
      /^Write them into `software\/\.env`\./m,
      'Step 2 tells the agent to write keys into software/.env before Step 4.1 creates (and would overwrite) it'
    );
  });
});

describe('sealing incident 2 — the insecure-registry stanza is proactive', () => {
  it('tells the engine NOW instead of waiting for the push to fail', () => {
    assert.match(
      runbook,
      /do not wait for a push to fail/i,
      'the registries.conf.d stanza is framed as a post-hoc fix; a literal agent waits for podman push to die first (report-seal-muse Incident 2)'
    );
    assert.doesNotMatch(
      runbook,
      /If a later `podman push` fails/,
      'the conditional framing must go, not merely be contradicted elsewhere'
    );
  });
});

describe('sealing incident 3 — the digest proof asks with the OCI Accept header', () => {
  it('documents the Accept header, or the registry answers a false 404', () => {
    assert.match(
      betaTest,
      /Accept: application\/vnd\.oci\.image\.manifest\.v1\+json/,
      'proof 3 HEADs the manifest without the OCI Accept header and reads MANIFEST_UNKNOWN as a failed checkpoint (report-seal-muse Incident 3)'
    );
  });
});

describe('sealing incident F24 — the probe is the contract', () => {
  it('runbook 4.2b probes the write-then-reply shape with a byte-exact cmp, not a bare echo', () => {
    const section = runbook.slice(runbook.indexOf('# 4.2b'), runbook.indexOf('# 4.3'));
    assert.match(section, /marker\.txt/,
      'the measure step probes an echo only — an engine can pass the ping and hang on the real work (report-seal7-muse incident 1)');
    assert.match(section, /cmp -s/, 'the probe verdict must be a byte comparison, not a read of the reply');
  });
  it('the probe writes a RELATIVE path from a set workdir — the sandbox rejects absolute paths for every engine', () => {
    const section = runbook.slice(runbook.indexOf('# 4.2b'), runbook.indexOf('# 4.3'));
    assert.match(section, /-w \/probe/,
      'without a workdir the CLI sandbox auto-rejects /probe/* as external_directory and ZERO candidates pass (report-seal8-muse incident 1)');
    assert.match(section, /into marker\.txt/, 'the instructed path must be relative');
  });
  it("step 6 instructs the artefact path as the bridge's view, with the host equivalence stated", () => {
    assert.match(runbook, /\/data\/opencode-ws\/<the conversation>\/marker\.txt/,
      'a host-side path in the payload gets created nested inside the workspace (report-seal8-muse incident 2)');
    assert.match(runbook, /bridge's view, never the host's/);
  });
  it('Rule 7 states the principle', () => {
    const rules = fs.readFileSync(path.join(root, 'software/RULES.md'), 'utf8');
    assert.match(rules, /probe is the contract/i);
  });
});
