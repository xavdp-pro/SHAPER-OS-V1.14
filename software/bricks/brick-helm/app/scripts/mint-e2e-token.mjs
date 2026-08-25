#!/usr/bin/env node
/**
 * Mint a KovZu JWT (ca_token) for E2E / agent bypass — no login form.
 * Usage:
 *   node scripts/mint-e2e-token.mjs
 *   node scripts/mint-e2e-token.mjs /console/gbs-h1/zaza/Xavier?lang=fr
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
dotenv.config({ path: path.join(root, 'e2e', '.env') });

let secret = String(process.env.HELM_E2E_JWT_SECRET || '').trim();
if (!secret && fs.existsSync(path.join(root, '.env'))) {
  dotenv.config({ path: path.join(root, '.env') });
  secret = String(process.env.JWT_SECRET || '').trim();
}

const sub = Number(process.env.HELM_E2E_USER_ID || 3);
const email = process.env.HELM_E2E_EMAIL || 'xavier@xavdp.pro';
const role = process.env.HELM_E2E_ROLE || 'admin';
const name = process.env.HELM_E2E_NAME || 'Xavier E2E';
const target = process.argv[2] || '/console/gbs-h1/zaza/Xavier?lang=fr';
const base = (process.env.PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:7923').replace(/\/$/, '');

if (!secret) {
  console.error('Manquant: HELM_E2E_JWT_SECRET dans e2e/.env (ou JWT_SECRET dans .env serveur)');
  process.exit(1);
}

const token = jwt.sign({ sub, email, name, role }, secret, { expiresIn: '7d' });
const url = target.startsWith('http') ? target : `${base}${target.startsWith('/') ? target : `/${target}`}`;

console.log(JSON.stringify({ token, cookie: `ca_token=${token}`, url, sub, email, role }, null, 2));
