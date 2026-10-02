// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {createHash,generateKeyPairSync,randomUUID,sign} from 'node:crypto';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {encryptSecret} from '../../index.js';
import {DurableVaultOwner} from '../../durable-owner.js';
import {GuardedDurableVaultOwner} from '../../durable-guard-owner.js';
import {CurrentDisclosureVaultOwner} from '../../durable-disclosure-owner.js';
import {checkPrivateVaultDatabase} from '../../durable-runtime.mjs';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const require=createRequire(config.dependencyPackage),mysql=require('mysql2/promise');
assert.equal(require('mysql2/package.json').version,'3.24.4');
const {phase,stateFile,dependencyPackage,...settings}=config;
assert(/^\/tmp\/vault-disclosure-socket-[^/]+\/(original|restored)\.sock$/.test(settings.socketPath));
const pool=mysql.createPool({...settings,connectionLimit:4,waitForConnections:false});
const sha=v=>createHash('sha256').update(v).digest('hex'),canonical=v=>JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])));
let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{};
const keys=state.keys||generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
const key=Buffer.alloc(32,7),base=new DurableVaultOwner({pool,masterKey:key,universeId:'scope'});
let fresh=true;
const options={pool,masterKey:key,universeId:'scope',admitFreshness:()=>fresh,resolveConsumer:()=>({universeId:'scope',consumerId:'peer',consumerIncarnation:'writer',keyId:'key',publicKey:keys.publicKey,operations:['issue','rotate','read']})};
const owner=new CurrentDisclosureVaultOwner(options),activation=new GuardedDurableVaultOwner(options);
const envelope=(b,schema)=>({schema,consumerId:b.consumerId,consumerIncarnation:b.consumerIncarnation,ownerEpoch:b.ownerEpoch,operationId:b.operationId,guardId:b.guardId,bindingDigest:sha(canonical(b)),ackSequence:b.ackSequence,keyId:'key'});
const signed=body=>({...body,signature:sign(null,Buffer.from(canonical(body)),keys.privateKey).toString('base64')});
const admission=b=>signed(envelope(b,'shaper.peer-disclosure-admission.v1'));
const selected=b=>({disclosureId:b.guardId,bindingDigest:sha(canonical(b)),consumerId:b.consumerId,consumerIncarnation:b.consumerIncarnation,ownerEpoch:b.ownerEpoch,peerAdmission:admission(b)});
const closure=(b,decision='NO_OUTPUT_ENDED',outputDisposition='none')=>signed({...envelope(b,'shaper.peer-disclosure-closure.v1'),decision,outputDisposition,writerFenced:true});
const activationSelected=b=>({guardId:b.guardId,bindingDigest:sha(canonical(b)),consumerId:b.consumerId,consumerIncarnation:b.consumerIncarnation,ownerEpoch:b.ownerEpoch});
const makeRead=(b,seq)=>({...b,operationId:randomUUID(),guardId:randomUUID(),ackSequence:seq,purpose:'current-disclosure',operation:'read',activationOperationId:b.operationId,authorityBindingDigest:sha('synthetic-current-authority')});
const tables=['vault_owner_epochs','vault_owner_resources','vault_owner_operations','vault_owner_resource_fences','vault_owner_guards','vault_owner_disclosures'];
const snapshot=async(names=tables)=>{const data={};for(const table of names)data[table]=(await pool.query(`SELECT * FROM ${table} ORDER BY ${['vault_owner_operations','vault_owner_guards','vault_owner_disclosures'].includes(table)?'sequence':table==='vault_owner_epochs'?'scope_id':'scope_id,path_hash'}`))[0];return sha(JSON.stringify(data))};
const persist=()=>fs.writeFileSync(stateFile,JSON.stringify(state),{mode:0o600});
const begin=(b,o=owner)=>o.beginDisclosure({binding:b,peerAdmission:admission(b)});
const finish=(b,c=closure(b),o=owner)=>o.finishDisclosure({...selected(b),peerClosure:c});
const cases=[];
try{
 if(phase==='legacy-three'){
  const operationId=randomUUID(),path='secret/attempt/'+operationId,payload={universeId:'scope',deviceId:'device',revision:1,password:'synthetic_only'};
  // Seed the known historical three-table shape with real owning AES+SQL;
  // the current source intentionally does not run on that missing-fence schema.
  const payloadDigest=sha(JSON.stringify(payload));
  const receipt=await base.transaction(async connection=>{
   await connection.execute('INSERT INTO vault_owner_epochs (scope_id,owner_epoch) VALUES (?,?)',['scope','a'.repeat(32)]);
   await connection.execute('INSERT INTO vault_owner_resources (scope_id,path_hash,resource_path,device_id,revision,tombstoned,encrypted_payload,payload_digest) VALUES (?,?,?,?,1,0,?,?)',['scope',sha(path),path,'device',JSON.stringify(encryptSecret(payload,key)),payloadDigest]);
   const [inserted]=await connection.execute('INSERT INTO vault_owner_operations (scope_id,operation_id,path_hash,request_digest,receipt_json) VALUES (?,?,?,?,?)',['scope',operationId,sha(path),sha(JSON.stringify({path,universeId:'scope',deviceId:'device',revision:1,payloadDigest,action:'prepare'})),'{}']);
   const value=base.signed({schema:'shaper.vault-durable-receipt.v1',path,operationId,universeId:'scope',deviceId:'device',revision:1,payloadDigest,action:'prepare',ownerEpoch:'a'.repeat(32),durableSequence:Number(inserted.insertId)});
   await connection.execute('UPDATE vault_owner_operations SET receipt_json=? WHERE scope_id=? AND operation_id=?',[JSON.stringify(value),'scope',operationId]);return value;
  });
  state={keys,activation:{universeId:'scope',ownerEpoch:receipt.ownerEpoch,consumerId:'peer',consumerIncarnation:'writer',operationId,guardId:randomUUID(),ackSequence:1,path,deviceId:'device',revision:1,payloadDigest:sha(JSON.stringify(payload)),purpose:'activation',operation:'issue'},legacyResource:(await pool.query('SELECT * FROM vault_owner_resources'))[0][0]};persist();cases.push('real historical three-table encrypted resource seeded');
 }else if(phase==='legacy-five'){
  assert.deepEqual((await pool.query('SELECT * FROM vault_owner_resources'))[0][0],state.legacyResource);
  state.activationReply=await activation.acquireGuard(state.activation);persist();cases.push('three→five retains exact ciphertext and old activation reply');
 }else if(phase==='seed'){
  await checkPrivateVaultDatabase(pool);
  assert.deepEqual((await pool.query('SELECT * FROM vault_owner_resources'))[0][0],state.legacyResource);
  assert.deepEqual(await owner.acquireGuard(state.activation),state.activationReply);
  const activationAck=signed({...envelope(state.activation,'shaper.peer-guard-acknowledgement.v1'),decision:'COMMITTED'});
  assert.equal((await owner.settleGuard({...activationSelected(state.activation),peerAcknowledgement:activationAck})).receipt.state,'RELEASED_COMMITTED');
  cases.push('five→six exact ciphertext/key and activation API retained');
  const b=makeRead(state.activation,2);state.read=b;
  fresh=false;await assert.rejects(begin(b),/freshness_unavailable/);fresh=true;
  await assert.rejects(owner.beginDisclosure({binding:b,peerAdmission:{...admission(b),signature:sign(null,Buffer.from(canonical(envelope(b,'shaper.peer-disclosure-admission.v1'))),generateKeyPairSync('ed25519').privateKey).toString('base64')}}),/signature_invalid/);
  const first=await begin(b);assert.equal(first.payload.password,'synthetic_only');assert.equal(first.receipt.payloadClaimed,true);
  for(const response of [await begin(b),await owner.inspectDisclosure(selected(b))])assert.equal(Object.hasOwn(response,'payload'),false);
  cases.push('signed fresh current read returns payload once; retries and inspect metadata only');
  await assert.rejects(base.getPrepared(b),/guard_required/);await assert.rejects(base.withPreparedGuard(b,()=>assert.fail()),/guard_required/);
  await assert.rejects(begin(makeRead(state.activation,3)),/guard_unavailable/);
  await assert.rejects(owner.acquireGuard({...state.activation,guardId:randomUUID(),ackSequence:3}),/guard_unavailable/);
  const revoke={path:b.path,operationId:randomUUID(),universeId:'scope',deviceId:b.deviceId,revision:2};state.revoke=revoke;
  await assert.rejects(owner.tombstoneImmutable(revoke),/guard_pending/);
  assert.equal((await begin(b)).receipt.state,'HELD'); // Existing metadata, not another payload claim.
  await assert.rejects(begin(makeRead(state.activation,3)),/guard_unavailable/);
  await assert.rejects(owner.tombstoneImmutable({...revoke,operationId:randomUUID()}),/operation_conflict/);
  cases.push('common fence blocks rotation/new read and persists exact pending tombstone');
  const prepare=async seq=>{
   const op=randomUUID(),payload={universeId:'scope',deviceId:'device',revision:1,password:'synthetic_only'};
   const receipt=await owner.prepareImmutable({path:'secret/attempt/'+op,operationId:op,payload,payloadDigest:sha(JSON.stringify(payload))});
   return {universeId:'scope',ownerEpoch:receipt.ownerEpoch,consumerId:'peer',consumerIncarnation:'writer',operationId:op,guardId:randomUUID(),ackSequence:seq,path:receipt.path,deviceId:'device',revision:1,payloadDigest:receipt.payloadDigest,purpose:'activation',operation:'issue'};
  };
  const c=makeRead(await prepare(4),4);await begin(c);
  const complete=closure(c,'OUTPUT_ENDED','complete');
  const closed=await finish(c,complete);assert.equal(closed.receipt.state,'RELEASED_OUTPUT_ENDED');
  assert.deepEqual(await finish(c,complete),closed);assert.equal(Object.hasOwn(await begin(c),'payload'),false);
  await assert.rejects(finish(c),/disclosure_conflict/);
  await assert.rejects(finish(c,{...complete,writerFenced:false}),/closure_invalid/);
  await assert.rejects(finish(c,{...complete,signature:closure(b).signature}),/signature_invalid/);
  cases.push('immutable signed closure is replayable metadata; opposite/unfenced/forged closure refuses');
  const cRevoke={path:c.path,operationId:randomUUID(),universeId:'scope',deviceId:'device',revision:2};
  assert.equal((await owner.tombstoneImmutable(cRevoke)).action,'tombstone');
  await assert.rejects(begin(makeRead({...c,operationId:c.activationOperationId},5)),/guard_unavailable/);
  cases.push('positive closure releases only its fence; subsequent tombstone denies later disclosure');
  let lose=false;
  const uncertainPool={getConnection:async()=>{const connection=await pool.getConnection();return {query:(...a)=>connection.query(...a),execute:(...a)=>connection.execute(...a),beginTransaction:()=>connection.beginTransaction(),rollback:()=>connection.rollback(),release:()=>connection.release(),destroy:()=>connection.destroy(),commit:async()=>{await connection.commit();if(lose){lose=false;throw new Error('synthetic_lost_ack')}}}}};
  const uncertain=new CurrentDisclosureVaultOwner({...options,pool:uncertainPool});
  const lost=makeRead(await prepare(6),6);lose=true;await assert.rejects(begin(lost,uncertain),/commit_uncertain/);
  assert.equal((await owner.inspectDisclosure(selected(lost))).receipt.state,'HELD');
  assert.equal(Object.hasOwn(await begin(lost),'payload'),false);
  lose=true;await assert.rejects(finish(lost,closure(lost),uncertain),/commit_uncertain/);
  assert.equal((await owner.inspectDisclosure(selected(lost))).receipt.state,'RELEASED_NO_OUTPUT_ENDED');
  assert.equal(Object.hasOwn(await finish(lost),'payload'),false);
  cases.push('actual durable commits with injected lost ACK never replay plaintext or reverse closure');
  const other=await prepare(7);
  await assert.rejects(begin({...makeRead(other,7),operationId:b.operationId}),/disclosure_conflict/);
  await assert.rejects(begin({...makeRead(other,7),guardId:b.guardId}),/disclosure_conflict/);
  await assert.rejects(begin(makeRead(other,2)),/disclosure_conflict/);
  await assert.rejects(owner.prepareImmutable({path:'secret/new',operationId:b.operationId,payload:{universeId:'scope',deviceId:'device',revision:1},payloadDigest:sha(JSON.stringify({universeId:'scope',deviceId:'device',revision:1}))}),/operation_conflict/);
  await assert.rejects(owner.acquireGuard({...other,operationId:b.operationId,guardId:randomUUID(),ackSequence:7}),/guard_invalid|guard_conflict/);
  cases.push('read identities and peer sequences cannot alias activation/prepare/other resources');
  const cross=await prepare(10),beforeCross=await snapshot();
  for(const read of [{...makeRead(cross,10),guardId:state.activation.guardId},{...makeRead(cross,10),operationId:state.activation.operationId},makeRead(cross,1)])await assert.rejects(begin(read),/disclosure_conflict/);
  for(const transfer of [{...cross,guardId:c.guardId},{...cross,guardId:randomUUID(),ackSequence:c.ackSequence}])await assert.rejects(owner.acquireGuard(transfer),/guard_conflict/);
  assert.equal(await snapshot(),beforeCross);
  cases.push('actual both-direction activation/disclosure guard UUID and sequence collisions preserve all rows');
  for(const sql of ["UPDATE vault_owner_disclosures SET binding_json='bad'","UPDATE vault_owner_disclosures SET payload_claimed=0","UPDATE vault_owner_disclosures SET admission_json='bad'",'DELETE FROM vault_owner_disclosures','ALTER TABLE vault_owner_disclosures ADD bad INT'])await assert.rejects(pool.query(sql),error=>['ER_COLUMNACCESS_DENIED_ERROR','ER_TABLEACCESS_DENIED_ERROR'].includes(error.code));
  cases.push('actual app grants cannot mutate binding/admission/claim or delete/DDL');
  const expired=makeRead(await prepare(9),9);let commits=0;
  const freshPool={getConnection:async()=>{const connection=await pool.getConnection();return {query:(...a)=>connection.query(...a),execute:(...a)=>connection.execute(...a),beginTransaction:()=>connection.beginTransaction(),rollback:()=>connection.rollback(),release:()=>connection.release(),destroy:()=>connection.destroy(),commit:async()=>{await connection.commit();if(++commits===2)fresh=false}}}};
  await assert.rejects(begin(expired,new CurrentDisclosureVaultOwner({...options,pool:freshPool})),/freshness_unavailable/);fresh=true;
  assert.equal(Object.hasOwn(await begin(expired),'payload'),false);await finish(expired);
  cases.push('freshness lost during readback commit refuses plaintext and consumes claim');
  const paused=makeRead(await prepare(8),8);await begin(paused);
  const child=spawn(process.execPath,['-e',"process.stdout.write('ready\\n');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','ignore']});
  try{
   await once(child.stdout,'data');child.kill('SIGSTOP');await new Promise(resolve=>setTimeout(resolve,30));
   assert.equal((await owner.inspectDisclosure(selected(paused))).receipt.state,'HELD');
  }finally{child.kill('SIGKILL');await once(child,'exit')}
  assert.equal((await owner.inspectDisclosure(selected(paused))).receipt.state,'HELD');state.paused=paused;
  cases.push('stopped/killed independent writer does not silently expire HELD or authorize release');
  state.digest=await snapshot();persist();
 }else if(phase==='excess-grant'){
  const before=await snapshot();await assert.rejects(checkPrivateVaultDatabase(pool),/grants_invalid/);assert.equal(await snapshot(),before);
  cases.push('actual readiness refuses inherited excess grant or foreign table without changing six-table data');
 }else{
  await checkPrivateVaultDatabase(pool);assert.equal(await snapshot(),state.digest);
  assert.equal((await owner.inspectDisclosure(selected(state.read))).receipt.state,'HELD');
  assert.equal((await owner.inspectDisclosure(selected(state.paused))).receipt.state,'HELD');
  assert.equal(Object.hasOwn(await begin(state.read),'payload'),false);
  await assert.rejects(owner.tombstoneImmutable(state.revoke),/guard_pending/);
  assert.equal(await snapshot(),state.digest);cases.push('all six tables preserve HELD/claim/pending revoke/history through upgrade/restart/fresh restore');
 }
 console.log(JSON.stringify({phase,passed:true,cases,actualMariaDB:true,syntheticOnly:true,stateDigest:await snapshot(phase==='legacy-three'?tables.slice(0,3):phase==='legacy-five'?tables.slice(0,5):tables),localHttpCompletionQualified:false,independentFreshnessQualified:false,owningPodmanQualified:false}));
}finally{await pool.end()}
