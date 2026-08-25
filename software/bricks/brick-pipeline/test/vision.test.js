/**
 * @file vision.test.js
 * @description Unit tests for the document-vision CLI witness.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  visionConfig,
  buildVisionCommand,
  extractVisionStdout,
  runVision,
} from '../lib/vision.js';

describe('document-vision CLI witness', () => {
  test('visionConfig: OpenCode is configured with cli + model, no host', () => {
    const cfg = visionConfig({}, {
      DOCUMENT_VISION_CLI: 'opencode',
      DOCUMENT_VISION_MODEL: 'opencode/mimo-v2.5-free',
    });
    assert.equal(cfg.kind, 'opencode');
    assert.equal(cfg.configured, true);
    assert.equal(cfg.model, 'opencode/mimo-v2.5-free');
  });

  test('visionConfig: ollama still requires a host', () => {
    const cfg = visionConfig({}, {
      DOCUMENT_VISION_CLI: 'ollama',
      DOCUMENT_VISION_MODEL: 'qwen3.5:9b',
    });
    assert.equal(cfg.configured, false);
  });

  test('buildVisionCommand: OpenCode attaches the page with --file', () => {
    const cfg = visionConfig({
      cli: 'opencode',
      model: 'opencode/mimo-v2.5-free',
    });
    const cmd = buildVisionCommand(cfg, '/tmp/page.png', 'Transcribe.');
    assert.equal(cmd.command, 'opencode');
    assert.deepEqual(cmd.args, [
      'run',
      '--model', 'opencode/mimo-v2.5-free',
      '--file', '/tmp/page.png',
      '--format', 'json',
      '--pure',
      'Transcribe.',
    ]);
  });

  test('extractVisionStdout: reads OpenCode json text events', () => {
    const stdout = [
      '{"type":"text","text":"Facture "}',
      '{"type":"text","part":{"type":"text","text":"N° 12"}}',
    ].join('\n');
    assert.equal(extractVisionStdout(stdout), 'Facture N° 12');
  });

  test('runVision: mocked OpenCode spawn returns the page text', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-'));
    const imagePath = path.join(dir, 'page.png');
    fs.writeFileSync(imagePath, 'png');

    const result = await runVision(imagePath, {
      cli: 'opencode',
      model: 'opencode/mimo-v2.5-free',
      spawnImpl: async () => ({
        stdout: '{"type":"text","text":"Bon de commande 42"}\n',
        stderr: '',
        exitCode: 0,
      }),
    });

    assert.equal(result.available, true);
    assert.equal(result.text, 'Bon de commande 42');
    assert.equal(result.model, 'opencode/mimo-v2.5-free');
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('runVision: missing CLI is a missing witness, not a throw', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vision-'));
    const imagePath = path.join(dir, 'page.png');
    fs.writeFileSync(imagePath, 'png');

    const result = await runVision(imagePath, {
      cli: 'opencode',
      model: 'opencode/mimo-v2.5-free',
      spawnImpl: async () => {
        const err = new Error('spawn opencode ENOENT');
        err.code = 'ENOENT';
        throw err;
      },
    });

    assert.equal(result.available, false);
    assert.equal(result.missingReason, 'cli_missing');
    assert.equal(result.text, '');
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
