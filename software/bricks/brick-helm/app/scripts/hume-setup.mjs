#!/usr/bin/env node
/**
 * Create Hume EVI tool + 4-mini config for Helm Voice.
 * Requires HUME_API_KEY in env (X-Hume-Api-Key header).
 *
 * Usage:
 *   HUME_API_KEY=... node scripts/hume-setup.mjs
 *
 * Prints HUME_CONFIG_ID to add in .env on h1.
 */
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const API = 'https://api.hume.ai/v0/evi';
const apiKey = process.env.HUME_API_KEY?.trim();

if (!apiKey) {
  console.error('Missing HUME_API_KEY');
  process.exit(1);
}

const headers = {
  'X-Hume-Api-Key': apiKey,
  'Content-Type': 'application/json',
};

const SEND_TO_CURSOR_PARAMS = JSON.stringify({
  type: 'object',
  required: ['message'],
  properties: {
    message: {
      type: 'string',
      description: 'Clear instruction for the Cursor CLI to execute in the Helm workspace',
    },
  },
});

const SYSTEM_PROMPT = `You are Helm Voice, the empathic command interface for Helm — a command bridge that governs a workspace while Cursor builds recurring solutions.

Speak with natural emotional intelligence. Always respond in the same language the user uses (French, English, Spanish, etc.).

When the user asks to code, fix bugs, open files, run tasks, or work on the Helm project, call send_to_cursor with a clear, actionable message.

For greetings, product explanations, or small talk, answer directly without the tool.

Keep answers concise and professional — this is a live demo for prospects and recruiters.`;

async function api(pathname, options = {}) {
  const res = await fetch(`${API}${pathname}`, { ...options, headers: { ...headers, ...options.headers } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || data.error || `${res.status} ${pathname}`);
  }
  return data;
}

async function findOrCreateTool() {
  const list = await api('/tools');
  const existing = (list.tools_page || list || []).find?.((t) => t.name === 'send_to_cursor')
    || (Array.isArray(list) ? list.find((t) => t.name === 'send_to_cursor') : null);

  if (existing?.id) {
    console.log(`Tool send_to_cursor exists: ${existing.id}`);
    return existing;
  }

  const tool = await api('/tools', {
    method: 'POST',
    body: JSON.stringify({
      name: 'send_to_cursor',
      description: 'Send a command to the Cursor CLI engine working in the Helm workspace.',
      version_description: 'Helm Voice → Cursor inject',
      parameters: SEND_TO_CURSOR_PARAMS,
    }),
  });
  console.log(`Created tool send_to_cursor: ${tool.id}`);
  return tool;
}

async function createConfig(tool) {
  const config = await api('/configs', {
    method: 'POST',
    body: JSON.stringify({
      name: 'Helm Voice POC',
      evi_version: '4-mini',
      prompt: { text: SYSTEM_PROMPT },
      voice: {
        provider: 'HUME_AI',
        name: 'Ava Song',
      },
      language_model: {
        model_provider: 'ANTHROPIC',
        model_resource: 'claude-sonnet-4-20250514',
        temperature: 0.7,
      },
      tools: [{ id: tool.id, version: tool.version ?? 0 }],
    }),
  });
  return config;
}

async function main() {
  const tool = await findOrCreateTool();
  const config = await createConfig(tool);
  const configId = config.id || config.config_id;
  console.log('\n--- Add to /apps/helm-v1/app/.env on h1 ---');
  console.log(`HUME_CONFIG_ID=${configId}`);
  console.log('HUME_SECRET_KEY=<from Hume portal>');
  console.log('\nThen: pm2 restart helm-api helm-vite');
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
