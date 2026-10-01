// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import test from 'node:test';
import assert from 'node:assert/strict';
import {DurableVaultOwner} from '../index.js';
test('durable owner is explicit and does not adopt a file store or missing scope',()=>{
  assert.throws(()=>new DurableVaultOwner(),/vault_owner_invalid_configuration/);
  assert.throws(()=>new DurableVaultOwner({pool:{getConnection(){}},universeId:'../foreign'}),/vault_owner_invalid_configuration/);
  assert.throws(()=>new DurableVaultOwner({pool:{getConnection(){}},universeId:'scope'}),/master key is required/);
});

test('payload serialization cannot replace the bound scope or expose a getter error',async()=>{
  let calls=0;
  const owner=new DurableVaultOwner({pool:{getConnection(){calls++;throw new Error('must_not_connect')}},masterKey:Buffer.alloc(32,7),universeId:'scope'});
  const payload={universeId:'scope',deviceId:'device',revision:1,toJSON(){return {universeId:'foreign',deviceId:'device',revision:1}}};
  const {createHash,randomUUID}=await import('node:crypto');
  const payloadDigest=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  await assert.rejects(owner.prepareImmutable({path:'secret/resource',operationId:randomUUID(),payload,payloadDigest}),/vault_owner_payload_invalid/);
  assert.throws(()=>owner.prepareImmutable({payload:{get universeId(){throw new Error('synthetic_secret_error')}}}),/^Error: vault_owner_payload_invalid$/);
  assert.equal(calls,0);
});

test('in-process prepared guard rejects missing callback or digest before database checkout',async()=>{
  let calls=0;
  const owner=new DurableVaultOwner({pool:{getConnection(){calls++}},masterKey:Buffer.alloc(32,7),universeId:'scope'});
  const input={path:'secret/resource',deviceId:'device',revision:1,payloadDigest:'a'.repeat(64)};
  await assert.rejects(owner.withPreparedGuard(input),/vault_owner_invalid_operation/);
  await assert.rejects(owner.withPreparedGuard({...input,payloadDigest:null},()=>{}),/vault_owner_invalid_operation/);
  assert.equal(calls,0);
});
