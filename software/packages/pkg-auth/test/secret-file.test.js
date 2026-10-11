// Intent: software/packages/pkg-auth/INTENT.md#secret-files
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { SecretFileError, readFirstSecret, readSecret, secretFromFile } from '../secret-file.js';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkg-auth-secret-'));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const VALUE = 'a1'.repeat(32);
const file = (name, mode, content = `${VALUE}\n`) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, content, { mode });
  fs.chmodSync(p, mode);
  return p;
};
const neverCarriesTheValue = (fn) => {
  try { fn(); } catch (err) {
    assert.ok(err instanceof SecretFileError, err.message);
    assert.ok(!err.message.includes(VALUE), 'the value is in the message');
    assert.ok(!JSON.stringify(err).includes(VALUE), 'the value is in a property');
    return err.code;
  }
  assert.fail('no refusal');
};

describe('secretFromFile: a private file of the reading account', () => {
  it('reads 0400 and 0600 files of the reader, trimmed', () => {
    assert.equal(secretFromFile(file('r400', 0o400)), VALUE);
    assert.equal(secretFromFile(file('r600', 0o600)), VALUE);
  });
  it('refuses any group or other bit, another owner, a link, a directory, an empty or absent file', () => {
    assert.equal(neverCarriesTheValue(() => secretFromFile(file('g440', 0o440))), 'SECRET_FILE_UNTRUSTED');
    assert.equal(neverCarriesTheValue(() => secretFromFile(file('o604', 0o604))), 'SECRET_FILE_UNTRUSTED');
    assert.equal(neverCarriesTheValue(() => secretFromFile(file('owner', 0o400), { uid: process.getuid() + 1 })), 'SECRET_FILE_UNTRUSTED');
    const link = path.join(dir, 'link');
    fs.symlinkSync(file('target', 0o400), link);
    assert.equal(neverCarriesTheValue(() => secretFromFile(link)), 'SECRET_FILE_UNTRUSTED');
    assert.equal(neverCarriesTheValue(() => secretFromFile(dir)), 'SECRET_FILE_UNTRUSTED');
    assert.equal(neverCarriesTheValue(() => secretFromFile(file('empty', 0o400, '\n'))), 'SECRET_FILE_EMPTY');
    assert.equal(neverCarriesTheValue(() => secretFromFile(path.join(dir, 'absent'))), 'SECRET_FILE_UNREADABLE');
  });
});

describe('readSecret: <NAME>_FILE, an environment value only where allowed', () => {
  it('reads the file <NAME>_FILE names', () => {
    assert.equal(readSecret({ X_TOKEN_FILE: file('x', 0o400) }, 'X_TOKEN'), VALUE);
  });
  it('refuses an environment value unless the caller allows it (DEV scaffolding)', () => {
    assert.equal(neverCarriesTheValue(() => readSecret({ X_TOKEN: VALUE }, 'X_TOKEN')), 'SECRET_IN_ENVIRONMENT');
    assert.equal(readSecret({ X_TOKEN: VALUE }, 'X_TOKEN', { allowEnvValue: true }), VALUE);
  });
  it('refuses a secret given twice, even where an environment value is allowed', () => {
    const env = { X_TOKEN: VALUE, X_TOKEN_FILE: file('twice', 0o400) };
    assert.equal(neverCarriesTheValue(() => readSecret(env, 'X_TOKEN', { allowEnvValue: true })), 'SECRET_AMBIGUOUS');
  });
  it('answers null when neither is set; empty values count as unset', () => {
    assert.equal(readSecret({}, 'X_TOKEN'), null);
    assert.equal(readSecret({ X_TOKEN: '', X_TOKEN_FILE: '' }, 'X_TOKEN'), null);
  });
  it('readFirstSecret takes the first name set, by file or allowed value', () => {
    const f = file('alias', 0o600);
    assert.equal(readFirstSecret({ B_TOKEN_FILE: f }, ['A_TOKEN', 'B_TOKEN']), VALUE);
    assert.equal(readFirstSecret({}, ['A_TOKEN', 'B_TOKEN']), null);
    assert.equal(neverCarriesTheValue(() => readFirstSecret({ B_TOKEN: VALUE }, ['A_TOKEN', 'B_TOKEN'])), 'SECRET_IN_ENVIRONMENT');
  });
});
