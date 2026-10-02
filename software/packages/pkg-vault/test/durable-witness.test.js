// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {generateKeyPairSync} from 'node:crypto';
import {createHostWitnessAdmission,readHostWitness} from '../durable-witness.js';
import {checkWitnessEpoch,configuredOwnerMode} from '../durable-runtime.mjs';

const publicKey=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
const record={schema:'shaper.vault-host-witness.v1',universeId:'scope',ownerEpoch:'a'.repeat(32),generation:1,
  consumer:{consumerId:'vox',consumerIncarnation:'writer-1',keyId:'peer-key-1',publicKey,operations:['issue','rotate','read']}};
const fixture=work=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vault-host-witness-'));
  const file=path.join(directory,'witness.json'),mountInfo=path.join(directory,'mountinfo');
  const write=value=>{if(fs.existsSync(file))fs.chmodSync(file,0o600);fs.writeFileSync(file,JSON.stringify(value));fs.chmodSync(file,0o444)};
  write(record);
  fs.writeFileSync(mountInfo,`1 0 0:1 / ${file} ro,relatime - tmpfs tmpfs ro\n`);
  const options={uid:process.getuid(),mountInfoPath:mountInfo};
  try{return work({file,mountInfo,write,options})}
  finally{fs.rmSync(directory,{recursive:true,force:true})}
};

test('host witness fails closed on missing mount, changed epoch and changed peer',()=>fixture(({file,mountInfo,write,options})=>{
  assert.deepEqual(readHostWitness(file,options),record);
  const admission=createHostWitnessAdmission(file,options);
  const context={universeId:'scope',ownerEpoch:record.ownerEpoch,consumerId:'vox',consumerIncarnation:'writer-1'};
  assert.equal(admission.admitFreshness(context),true);
  assert.deepEqual(admission.resolveConsumer(context),{universeId:'scope',...record.consumer});
  write({...record,ownerEpoch:'b'.repeat(32)});
  assert.equal(admission.admitFreshness(context),false);
  assert.equal(admission.resolveConsumer(context),null);
  write({...record,consumer:{...record.consumer,consumerIncarnation:'writer-2'}});
  assert.equal(admission.resolveConsumer(context),null);
  write(record);
  fs.writeFileSync(mountInfo,`1 0 0:1 / ${file} rw,relatime - tmpfs tmpfs rw\n`);
  assert.equal(admission.admitFreshness(context),false);
  assert.equal(admission.resolveConsumer(context),null);
  assert.throws(()=>readHostWitness(file,options),/witness_invalid/);
}));

test('host witness rejects writable, linked, symlinked, malformed and foreign-key files',()=>fixture(({file,write,options})=>{
  fs.chmodSync(file,0o644);assert.throws(()=>readHostWitness(file,options),/witness_invalid/);
  fs.chmodSync(file,0o444);
  fs.linkSync(file,file+'.link');assert.throws(()=>readHostWitness(file,options),/witness_invalid/);fs.unlinkSync(file+'.link');
  fs.symlinkSync(file,file+'.sym');assert.throws(()=>readHostWitness(file+'.sym',{...options,requireMount:false}),/witness_invalid/);
  write({...record,consumer:{...record.consumer,operations:['read','read']}});
  assert.throws(()=>readHostWitness(file,options),/witness_invalid/);
  write({...record,consumer:{...record.consumer,publicKey:generateKeyPairSync('rsa',{modulusLength:2048}).publicKey.export({type:'spki',format:'pem'})}});
  assert.throws(()=>readHostWitness(file,options),/witness_invalid/);
  write({...record,unexpected:true});assert.throws(()=>readHostWitness(file,options),/witness_invalid/);
  assert.throws(()=>readHostWitness(file,{...options,uid:process.getuid()+1}),/witness_invalid/);
}));

test('guarded runtime requires exact SQL epoch and explicit mode',async()=>{
  assert.equal(configuredOwnerMode(undefined),'base');
  assert.equal(configuredOwnerMode('current-disclosure'),'current-disclosure');
  assert.throws(()=>configuredOwnerMode('guarded-if-available'),/mode_invalid/);
  const state={epoch:null,dirty:false,insertions:0,releases:0,rollbacks:0};
  const pool={getConnection:async()=>({
    beginTransaction:async()=>{},commit:async()=>{},rollback:async()=>{state.rollbacks++},
    execute:async(sql,args)=>{
      if(sql.startsWith('SELECT owner_epoch'))return [[state.epoch?{owner_epoch:state.epoch}:undefined]];
      if(sql.startsWith('INSERT INTO vault_owner_epochs')){state.epoch=args[1];state.insertions++;return [{}]}
      throw new Error('unexpected SQL');
    },
    query:async()=>[state.dirty?[{1:1}]:[]],release:()=>{state.releases++}
  })};
  await checkWitnessEpoch(pool,record);
  assert.equal(state.epoch,record.ownerEpoch);assert.equal(state.insertions,1);
  await checkWitnessEpoch(pool,record);
  assert.equal(state.insertions,1);assert.equal(state.releases,4);
  await assert.rejects(checkWitnessEpoch(pool,{...record,ownerEpoch:'b'.repeat(32)}),/freshness_unavailable/);
  assert.equal(state.rollbacks,1);
  state.epoch=null;state.dirty=true;
  await assert.rejects(checkWitnessEpoch(pool,record),/freshness_unavailable/);
  assert.equal(state.insertions,1);assert.equal(state.rollbacks,2);
});
