#!/usr/bin/env node
/**
 * One-shot: upsert admin Xavier de Poorter (xavier@xavdp.pro).
 * Usage: node scripts/create-admin-xavier.mjs [password]
 */
import { createUser, listUsers, updateUser } from '../server/lib/usersStore.js';
import { query } from '../server/lib/db.js';

const email = 'xavier@xavdp.pro';
const name = 'Xavier de Poorter';
const firstName = 'Xavier';
const lastName = 'de Poorter';
const password = String(process.argv[2] || '').trim()
  || `Kovzu-Xavier-${Math.random().toString(36).slice(2, 10)}!`;

const users = await listUsers();
const existing = users.find((u) => String(u.email).toLowerCase() === email);

let user;
let action;
if (existing) {
  user = await updateUser(existing.id, {
    name,
    role: 'admin',
    status: 'active',
    password,
    notes: 'Admin — Xavier de Poorter',
  });
  action = 'updated';
} else {
  user = await createUser({
    email,
    name,
    role: 'admin',
    status: 'active',
    password,
    notes: 'Admin — Xavier de Poorter',
  });
  action = 'created';
}

await query(
  'UPDATE users SET first_name = ?, last_name = ?, demo_conversation = ? WHERE id = ?',
  [firstName, lastName, 'Xavier', user.id],
).catch(() => null);

const refreshed = (await listUsers()).find((u) => u.id === user.id);
console.log(JSON.stringify({
  action,
  id: refreshed?.id ?? user.id,
  email: refreshed?.email ?? user.email,
  name: refreshed?.name ?? user.name,
  firstName: refreshed?.firstName || firstName,
  lastName: refreshed?.lastName || lastName,
  role: refreshed?.role ?? user.role,
  status: refreshed?.status ?? user.status,
  preferredConversation: refreshed?.preferredConversation || 'Xavier',
  password,
}, null, 2));

process.exit(0);
