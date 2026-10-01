// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {generateKeyPairSync,createHash,randomUUID,sign} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {DurableVaultOwner} from '../../index.js';
import {GuardedDurableVaultOwner} from '../../durable-guard-owner.js';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
if(['weak-durability','crash-before-commit'].includes(config.phase))await import('./durable-engine.mjs');
else{
  const require=createRequire(config.dependencyPackage),mysql=require('mysql2/promise');
  assert.equal(require('mysql2/package.json').version,'3.24.4');
  const {phase,stateFile,dependencyPackage,...settings}=config;
  assert(/^\/tmp\/vault-owner-socket-[^/]+\/(original|restored)\.sock$/.test(settings.socketPath));
  const pool=mysql.createPool({...settings,connectionLimit:4});
  const canonical=v=>JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])));
  const sha=v=>createHash('sha256').update(v).digest('hex');
  const key=Buffer.alloc(32,7),base=new DurableVaultOwner({pool,masterKey:key,universeId:'scope'});
  let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):null;
  const keys=state?{publicKey:state.publicKey,privateKey:state.privateKey}:generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
  let fresh=true;const admission=()=>fresh;
  const consumer=()=>({universeId:'scope',consumerId:'peer',consumerIncarnation:'peer_incarnation',keyId:'synthetic_key',publicKey:keys.publicKey,operations:['issue','rotate']});
  const make=(overrides={})=>new GuardedDurableVaultOwner({pool,masterKey:key,universeId:'scope',admitFreshness:admission,resolveConsumer:consumer,...overrides});
  const owner=make();
  const selected=b=>({guardId:b.guardId,bindingDigest:sha(canonical(b)),consumerId:b.consumerId,consumerIncarnation:b.consumerIncarnation,ownerEpoch:b.ownerEpoch});
  const ack=(b,decision)=>{const body={schema:'shaper.peer-guard-acknowledgement.v1',consumerId:b.consumerId,consumerIncarnation:b.consumerIncarnation,ownerEpoch:b.ownerEpoch,operationId:b.operationId,guardId:b.guardId,bindingDigest:sha(canonical(b)),decision,ackSequence:b.ackSequence,keyId:'synthetic_key'};return {...body,signature:sign(null,Buffer.from(canonical(body)),keys.privateKey).toString('base64')}};
  const snapshot=async()=>{const result={};for(const table of ['vault_owner_epochs','vault_owner_resources','vault_owner_operations','vault_owner_resource_fences','vault_owner_guards'])result[table]=(await pool.query(`SELECT * FROM ${table} ORDER BY ${table==='vault_owner_operations'||table==='vault_owner_guards'?'sequence':table==='vault_owner_epochs'?'scope_id':'scope_id,path_hash'}`))[0];return sha(JSON.stringify(result))};
  try{
    if(phase==='seed'){
      for(const sql of ["UPDATE vault_owner_guards SET binding_json='bad'","UPDATE vault_owner_guards SET guard_id='bad'",'DELETE FROM vault_owner_resource_fences','ALTER TABLE vault_owner_guards ADD bad INT'])await assert.rejects(pool.query(sql),e=>['ER_COLUMNACCESS_DENIED_ERROR','ER_TABLEACCESS_DENIED_ERROR'].includes(e.code));
      const prepare=async(sequence)=>{const payload={universeId:'scope',deviceId:'device',revision:1,password:'synthetic_only'};const operationId=randomUUID(),path='secret/attempt/'+operationId;const receipt=await owner.prepareImmutable({path,operationId,payload,payloadDigest:sha(JSON.stringify(payload))});return {universeId:'scope',ownerEpoch:receipt.ownerEpoch,consumerId:'peer',consumerIncarnation:'peer_incarnation',operationId,guardId:randomUUID(),ackSequence:sequence,path,deviceId:'device',revision:1,payloadDigest:sha(JSON.stringify(payload)),purpose:'activation',operation:'issue'}};
      const b=await prepare(1);fresh=false;await assert.rejects(owner.acquireGuard(b),/freshness_unavailable/);fresh=true;
      await assert.rejects(make({admitFreshness:()=>Promise.reject(new Error('synthetic_private_failure'))}).acquireGuard(b),/freshness_unavailable/);
      await assert.rejects(owner.acquireGuard({...b,ownerEpoch:'foreign_epoch'}),/freshness_unavailable/);
      const acquired=await owner.acquireGuard(b);assert(acquired.payload.password==='synthetic_only');assert.deepEqual(await owner.acquireGuard(b),acquired);
      await assert.rejects(owner.acquireGuard({...b,guardId:randomUUID()}),/guard_unavailable/);
      await assert.rejects(owner.acquireGuard({...b,payloadDigest:'a'.repeat(64)}),/guard_conflict/);
      await assert.rejects(base.getPrepared(b),/guard_required/);await assert.rejects(base.withPreparedGuard(b,()=>{assert.fail('must_not_run')}),/guard_required/);
      await assert.rejects(owner.getPrepared(b),/guard_required/);await assert.rejects(owner.withPreparedGuard(b,()=>{}),/guard_required/);
      const correct=ack(b,'COMMITTED'),wrong={...correct,decision:'ABORTED'};
      await assert.rejects(owner.settleGuard({...selected(b),peerAcknowledgement:wrong}),/acknowledgement_invalid/);
      await assert.rejects(make({resolveConsumer:()=>({...consumer(),keyId:'wrong_key'})}).settleGuard({...selected(b),peerAcknowledgement:correct}),/acknowledgement_invalid/);
      const foreignKey=generateKeyPairSync('ed25519').publicKey.export({type:'spki',format:'pem'});
      await assert.rejects(make({resolveConsumer:()=>({...consumer(),publicKey:foreignKey})}).settleGuard({...selected(b),peerAcknowledgement:correct}),/acknowledgement_invalid/);
      const child=spawn(process.execPath,['-e',"process.stdout.write('ready\\n');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
      try{await once(child.stdout,'data');child.kill('SIGSTOP');await new Promise(r=>setTimeout(r,40));
        const revoke={path:b.path,operationId:randomUUID(),universeId:'scope',deviceId:'device',revision:2};
        await assert.rejects(owner.tombstoneImmutable(revoke),/guard_pending/);
        assert.equal((await owner.inspectGuard(selected(b))).receipt.state,'HELD');
        await assert.rejects(owner.acquireGuard(b),/guard_unavailable/);
        await assert.rejects(owner.tombstoneImmutable({...revoke,operationId:randomUUID()}),/operation_conflict/);
        await assert.rejects(owner.prepareImmutable({path:'secret/another',operationId:revoke.operationId,payload:{universeId:'scope',deviceId:'device',revision:1},payloadDigest:sha(JSON.stringify({universeId:'scope',deviceId:'device',revision:1}))}),/operation_conflict/);
        state={binding:b,revoke,heldAcquisition:acquired.receipt,publicKey:keys.publicKey,privateKey:keys.privateKey};
      }finally{child.kill('SIGKILL');await once(child,'exit')}
      const denied=await prepare(6);let admissions=0;
      await assert.rejects(make({admitFreshness:()=>++admissions===1}).acquireGuard(denied),/freshness_unavailable/);
      assert.equal((await pool.query('SELECT * FROM vault_owner_guards WHERE guard_id=?',[denied.guardId]))[0].length,0);
      // Keep one held fence + pending revoke through engine restart/restore.
      const released=await prepare(2);await owner.acquireGuard(released);
      const acknowledgement=ack(released,'COMMITTED');
      const settled=await owner.settleGuard({...selected(released),peerAcknowledgement:acknowledgement});
      assert.equal(settled.receipt.state,'RELEASED_COMMITTED');
      assert.deepEqual(await owner.settleGuard({...selected(released),peerAcknowledgement:acknowledgement}),settled);
      await assert.rejects(owner.settleGuard({...selected(released),peerAcknowledgement:ack(released,'ABORTED')}),/guard_conflict/);
      assert(!Object.hasOwn(await owner.acquireGuard(released),'payload'));
      await assert.rejects(base.getPrepared(released),/guard_required/);
      const aborted=await prepare(3);await owner.acquireGuard(aborted);
      assert.equal((await owner.settleGuard({...selected(aborted),peerAcknowledgement:ack(aborted,'ABORTED')})).receipt.state,'RELEASED_ABORTED');
      await assert.rejects(owner.acquireGuard({...aborted,guardId:randomUUID(),ackSequence:4}),/guard_conflict/);
      // Actual SQL commit followed by injected lost acknowledgement: durable state
      // must reconcile without a second peer action or terminal payload disclosure.
      let lose=true;
      const uncertainPool={getConnection:async()=>{const c=await pool.getConnection();return {query:(...a)=>c.query(...a),execute:(...a)=>c.execute(...a),beginTransaction:()=>c.beginTransaction(),rollback:()=>c.rollback(),release:()=>c.release(),destroy:()=>c.destroy(),commit:async()=>{await c.commit();if(lose){lose=false;throw new Error('synthetic_ack_loss')}}}}};
      const uncertain=make({pool:uncertainPool});
      const lostAcquire=await prepare(5);
      await assert.rejects(uncertain.acquireGuard(lostAcquire),/commit_uncertain/);
      assert.equal((await owner.inspectGuard(selected(lostAcquire))).receipt.state,'HELD');
      await owner.acquireGuard(lostAcquire);
      lose=true;
      await assert.rejects(uncertain.settleGuard({...selected(lostAcquire),peerAcknowledgement:ack(lostAcquire,'COMMITTED')}),/commit_uncertain/);
      assert.equal((await owner.inspectGuard(selected(lostAcquire))).receipt.state,'RELEASED_COMMITTED');
      assert(!Object.hasOwn(await owner.acquireGuard(lostAcquire),'payload'));
      const reconciled=await owner.settleGuard({...selected(lostAcquire),peerAcknowledgement:ack(lostAcquire,'COMMITTED')});
      assert.equal(reconciled.receipt.state,'RELEASED_COMMITTED');
      const abortRevoke={path:aborted.path,operationId:randomUUID(),universeId:'scope',deviceId:'device',revision:2};
      const deleted=await owner.tombstoneImmutable(abortRevoke);assert.equal(deleted.action,'tombstone');
      state.released=released;state.settled=settled;state.digest=await snapshot();
      fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});
    }else{
      assert.equal(await snapshot(),state.digest);
      assert.equal((await owner.inspectGuard(selected(state.binding))).receipt.state,'HELD');
      assert.deepEqual(await owner.inspectGuard(selected(state.released)),state.settled);
      await assert.rejects(owner.acquireGuard(state.binding),/guard_unavailable/);
      await assert.rejects(owner.tombstoneImmutable(state.revoke),/guard_pending/);
      assert.equal(await snapshot(),state.digest);
    }
    console.log(JSON.stringify({phase,passed:true,actualMariaDB:true,syntheticOnly:true,stateDigest:await snapshot(),guardExpiry:false,independentPeerDatabase:false}));
  }finally{await pool.end()}
}
