import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const univDir = path.resolve(__dirname, '..');

describe('univ-pipeline-xav configuration & structure', () => {
  it('manifest.json declares all required bricks and valid ports', () => {
    const manifestPath = path.join(univDir, 'manifest.json');
    assert.ok(fs.existsSync(manifestPath), 'manifest.json must exist');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    assert.equal(manifest.universe, 'univ-pipeline-xav');
    assert.ok(manifest.bricks.vault);
    assert.ok(manifest.bricks.logger);
    assert.ok(manifest.bricks.queue);
    assert.ok(manifest.bricks.maestro);
    assert.ok(manifest.bricks.pipeline);
    assert.ok(manifest.bricks.ged);
    assert.ok(manifest.bricks.tunnel);

    assert.equal(manifest.ports.pipeline, 8670);
    assert.equal(manifest.ports.ged, 8760);
    // The universe commits no domain: the edge hostname is a placeholder that
    // the operator substitutes at deploy time (Rule 0B).
    assert.match(manifest.edge.hostname, /^\$\{[A-Z_]+\}$/);
  });

  it('deploy scripts exist and are executable', () => {
    const up = path.join(univDir, 'deploy/podman-up.sh');
    const down = path.join(univDir, 'deploy/podman-down.sh');
    assert.ok(fs.existsSync(up), 'podman-up.sh must exist');
    assert.ok(fs.existsSync(down), 'podman-down.sh must exist');
    const statUp = fs.statSync(up);
    assert.ok((statUp.mode & 0o111) !== 0, 'podman-up.sh must be executable');
  });
});
