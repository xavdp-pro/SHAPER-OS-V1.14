import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  resolveAppSlug,
  passwdFilePath,
  resolvePassword,
  buildDbConfig,
  buildProvisionStatements,
} from '../index.js';

test('resolveAppSlug from /apps path', () => {
  assert.equal(resolveAppSlug('/apps/crm-immo/app/src'), 'crm-immo');
  assert.equal(resolveAppSlug('/tmp/dev', 'fallback'), 'fallback');
});

test('passwdFilePath follows Turbinobash convention', () => {
  assert.equal(passwdFilePath('wikiuniv-v1'), '/apps/wikiuniv-v1/etc/mysql/localhost/passwd');
});

test('resolvePassword reads passwd file then env', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-db-'));
  const passwdFile = path.join(tmp, 'passwd');
  fs.writeFileSync(passwdFile, 'secret-from-file\n');

  assert.equal(resolvePassword({ passwdFile }), 'secret-from-file');

  const prev = process.env.MYSQL_PASSWORD;
  process.env.MYSQL_PASSWORD = 'env-secret';
  assert.equal(resolvePassword({ appSlug: 'x', passwdFile: path.join(tmp, 'missing') }), 'env-secret');
  if (prev === undefined) delete process.env.MYSQL_PASSWORD;
  else process.env.MYSQL_PASSWORD = prev;

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('buildDbConfig user = database = slug', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'shaper-db-cfg-'));
  const passwdFile = path.join(tmp, 'passwd');
  fs.writeFileSync(passwdFile, 'cfg-secret');

  const cfg = buildDbConfig({ appSlug: 'crm-immo', passwdFile });
  assert.equal(cfg.user, 'crm-immo');
  assert.equal(cfg.database, 'crm-immo');
  assert.equal(cfg.password, 'cfg-secret');
  assert.equal(cfg.host, 'localhost');
  assert.equal(cfg.port, 3306);

  fs.rmSync(tmp, { recursive: true, force: true });
});

test('buildProvisionStatements', () => {
  const stmts = buildProvisionStatements('crm-immo', "pa'ss");
  assert.match(stmts[0], /CREATE DATABASE/);
  assert.match(stmts[1], /pa''ss/);
});
