// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync} from 'node:crypto';
import {GuardedDurableVaultOwner} from '../durable-guard-owner.js';
const options={pool:{getConnection(){assert.fail('must_not_checkout')}},masterKey:Buffer.alloc(32,7),universeId:'scope'};
const key=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
const input={universeId:'scope',ownerEpoch:'epoch',consumerId:'peer',consumerIncarnation:'incarnation',operationId:randomUUID(),guardId:randomUUID(),ackSequence:1,path:'secret/attempt',deviceId:'device',revision:1,payloadDigest:'a'.repeat(64),purpose:'activation',operation:'issue'};
const consumer=()=>({universeId:'scope',consumerId:'peer',consumerIncarnation:'incarnation',keyId:'key',publicKey:key,operations:['issue']});
test('guard owner requires explicit trust interfaces and rejects unavailable/async admission before SQL',async()=>{
  assert.throws(()=>new GuardedDurableVaultOwner(options),/guard_configuration_invalid/);
  for(const admitFreshness of [()=>false,()=>{throw new Error('synthetic_private_error')},()=>Promise.reject(new Error('synthetic_private_error'))]){
    const owner=new GuardedDurableVaultOwner({...options,admitFreshness,resolveConsumer:consumer});
    await assert.rejects(owner.acquireGuard(input),/freshness_unavailable|consumer_unavailable/);
  }
  const owner=new GuardedDurableVaultOwner({...options,admitFreshness:()=>true,resolveConsumer:()=>Promise.reject(new Error('synthetic_private_error'))});
  await assert.rejects(owner.acquireGuard(input),/consumer_unavailable/);
  await new Promise(resolve=>setImmediate(resolve));
});
test('guard owner has no generic secret/callback bypass and admits only exact typed activation bindings',async()=>{
  const owner=new GuardedDurableVaultOwner({...options,admitFreshness:()=>true,resolveConsumer:consumer});
  await assert.rejects(owner.getPrepared(input),/guard_required/);
  await assert.rejects(owner.withPreparedGuard(input,()=>assert.fail()),/guard_required/);
  for(const altered of [{...input,purpose:'read_ack'},{...input,operation:'revoke'},{...input,extra:'hidden'},{...input,ackSequence:0},{...input,universeId:'foreign'}])await assert.rejects(owner.acquireGuard(altered),/guard_invalid/);
});
