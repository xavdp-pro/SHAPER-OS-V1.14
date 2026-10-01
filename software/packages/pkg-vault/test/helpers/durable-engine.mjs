// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createRequire} from 'node:module';
import {randomUUID,createHash} from 'node:crypto';
import {DurableVaultOwner} from '../../index.js';
const config=JSON.parse(fs.readFileSync(process.argv[2],'utf8'));
const require=createRequire(config.dependencyPackage);
assert.equal(require('mysql2/package.json').version,'3.24.4');
const mysql=require('mysql2/promise');
const {phase,stateFile,dependencyPackage,...connection}=config;
assert(/^\/tmp\/vault-owner-socket-[^/]+\/(original|restored)\.sock$/.test(connection.socketPath));
const pool=mysql.createPool({...connection,connectionLimit:4});
const key=Buffer.alloc(32,7),owner=new DurableVaultOwner({pool,masterKey:key,universeId:'scope'});
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const payload={universeId:'scope',deviceId:'device',revision:1,password:'synthetic_secret_'.repeat(3)};
const input={path:'secret/resource/device/r1',operationId:randomUUID(),payload,payloadDigest:digest(payload)};
const snapshot=async()=>{const result={};for(const table of ['vault_owner_epochs','vault_owner_resources','vault_owner_operations'])result[table]=(await pool.query(`SELECT * FROM ${table} ORDER BY ${table==='vault_owner_operations'?'sequence':table==='vault_owner_resources'?'scope_id,path_hash':'scope_id'}`))[0];return digest(result)};
try{
  if(phase==='crash-before-commit'){
    const blockedPool={getConnection:async()=>{const c=await pool.getConnection();return {query:(...a)=>c.query(...a),beginTransaction:()=>c.beginTransaction(),rollback:()=>c.rollback(),commit:()=>c.commit(),release:()=>c.release(),destroy:()=>c.destroy(),execute:async(sql,args)=>{if(sql.startsWith('INSERT INTO vault_owner_operations')){fs.writeFileSync(stateFile+'.crash','resource_inserted_uncommitted',{mode:0o600});await new Promise(()=>{})}return c.execute(sql,args)}}}};
    await new DurableVaultOwner({pool:blockedPool,masterKey:key,universeId:'scope'}).prepareImmutable({...input,path:'secret/resource/device/crash',operationId:randomUUID()});
    assert.fail('crash_fixture_must_be_killed');
  }else if(phase==='weak-durability'){
    await assert.rejects(owner.prepareImmutable(input),/durability_unavailable/);
    assert.equal((await pool.query('SELECT * FROM vault_owner_operations'))[0].length,0);
  }else if(phase==='seed'){
    for(const sql of ['SELECT * FROM mysql.user','DELETE FROM vault_owner_operations','ALTER TABLE vault_owner_operations ADD bad INT',"UPDATE vault_owner_resources SET device_id='foreign'","UPDATE vault_owner_operations SET operation_id='foreign'"])
      await assert.rejects(pool.query(sql),e=>['ER_TABLEACCESS_DENIED_ERROR','ER_COLUMNACCESS_DENIED_ERROR'].includes(e.code));
    const first=await owner.prepareImmutable(input);
    assert.deepEqual(await owner.prepareImmutable(input),first);
    assert.deepEqual(await owner.getPrepared({path:input.path,deviceId:'device',revision:1}),payload);
    await assert.rejects(owner.verifyReceipt({receipt:{...first,revision:99},path:input.path,operationId:input.operationId,payloadDigest:input.payloadDigest}),/receipt_invalid/);
    await assert.rejects(owner.getPrepared({path:input.path,deviceId:'foreign',revision:1}),/resource_unavailable/);
    const reordered=Object.fromEntries(Object.entries(first).reverse());
    assert.deepEqual(await owner.verifyReceipt({receipt:reordered,path:input.path,operationId:input.operationId,payloadDigest:input.payloadDigest}),first);
    await assert.rejects(owner.prepareImmutable({...input,operationId:randomUUID()}),/immutable_conflict/);
    const changed={...payload,password:'different_secret'};
    await assert.rejects(owner.prepareImmutable({...input,payload:changed,payloadDigest:digest(changed)}),/operation_conflict/);
    const competing={...input,path:'secret/resource/device/r2',payload:{...payload,revision:2}};competing.payloadDigest=digest(competing.payload);
    const result=await Promise.allSettled([owner.prepareImmutable({...competing,operationId:randomUUID()}),owner.prepareImmutable({...competing,operationId:randomUUID()})]);
    assert.equal(result.filter(item=>item.status==='fulfilled').length,1);
    assert.equal(result.filter(item=>item.status==='rejected').length,1);
    const foreign=new DurableVaultOwner({pool,masterKey:key,universeId:'foreign'});
    assert.equal(await foreign.findReceipt({path:input.path,operationId:input.operationId}),null);
    await assert.rejects(foreign.prepareImmutable(input),/invalid_operation/);
    const [[originalRow]]=await pool.query('SELECT encrypted_payload,payload_digest FROM vault_owner_resources WHERE scope_id=? AND resource_path=?',['scope',input.path]);
    const replacement={...payload,deviceId:'foreign'};
    const {encryptSecret}=await import('../../index.js');
    await pool.query('UPDATE vault_owner_resources SET encrypted_payload=?,payload_digest=? WHERE scope_id=? AND resource_path=?',[JSON.stringify(encryptSecret(replacement,key)),digest(replacement),'scope',input.path]);
    await assert.rejects(owner.getPrepared({path:input.path,deviceId:'device',revision:1}),/resource_unavailable/);
    await pool.query('UPDATE vault_owner_resources SET encrypted_payload=?,payload_digest=? WHERE scope_id=? AND resource_path=?',[originalRow.encrypted_payload,originalRow.payload_digest,'scope',input.path]);
    const wrong=new DurableVaultOwner({pool,masterKey:Buffer.alloc(32,8),universeId:'scope'});
    await assert.rejects(wrong.findReceipt({path:input.path,operationId:input.operationId}),/receipt_invalid/);
    const lostId=randomUUID();let once=true;
    const uncertainPool={getConnection:async()=>{
      const c=await pool.getConnection();return {query:(...a)=>c.query(...a),execute:(...a)=>c.execute(...a),beginTransaction:()=>c.beginTransaction(),rollback:()=>c.rollback(),release:()=>c.release(),destroy:()=>c.destroy(),commit:async()=>{await c.commit();if(once){once=false;throw new Error('synthetic_ack_loss')}}};
    }};
    const uncertain=new DurableVaultOwner({pool:uncertainPool,masterKey:key,universeId:'scope'});
    await assert.rejects(uncertain.prepareImmutable({...input,path:'secret/resource/device/lost',operationId:lostId}),/commit_uncertain/);
    assert(await owner.findReceipt({path:'secret/resource/device/lost',operationId:lostId}));
    // Injection exercises real rollback after resource INSERT, never a simulated success.
    const failingPool={getConnection:async()=>{const c=await pool.getConnection();return {query:(...a)=>c.query(...a),beginTransaction:()=>c.beginTransaction(),rollback:()=>c.rollback(),commit:()=>c.commit(),release:()=>c.release(),destroy:()=>c.destroy(),execute:(sql,args)=>{if(sql.startsWith('INSERT INTO vault_owner_operations'))throw new Error('synthetic_write_failure');return c.execute(sql,args)}}}};
    await assert.rejects(new DurableVaultOwner({pool:failingPool,masterKey:key,universeId:'scope'}).prepareImmutable({...input,path:'secret/resource/device/rollback',operationId:randomUUID()}),/store_unavailable/);
    assert.equal((await pool.query("SELECT * FROM vault_owner_resources WHERE resource_path='secret/resource/device/rollback'"))[0].length,0);
    const guardInput={path:'secret/resource/device/guard',operationId:randomUUID(),payload,payloadDigest:input.payloadDigest};
    await owner.prepareImmutable(guardInput);
    const guard={path:guardInput.path,deviceId:'device',revision:1,payloadDigest:guardInput.payloadDigest};
    await assert.rejects(owner.withPreparedGuard({...guard,payloadDigest:'f'.repeat(64)},()=>assert.fail('invalid_digest_callback')),/resource_unavailable/);
    const callbackFailure=new Error('synthetic_peer_commit_uncertain');
    await assert.rejects(owner.withPreparedGuard(guard,()=>{throw callbackFailure}),error=>error===callbackFailure);
    assert.deepEqual(await owner.getPrepared(guard),payload);
    let entered,release;const ready=new Promise(resolve=>{entered=resolve}),held=new Promise(resolve=>{release=resolve});
    const runningGuard=owner.withPreparedGuard(guard,async current=>{assert.deepEqual(current,payload);entered();await held;return 'guarded'});
    await ready;
    let deleteDone=false;
    const blocked=owner.tombstoneImmutable({path:guard.path,operationId:randomUUID(),universeId:'scope',deviceId:'device',revision:2}).then(result=>{deleteDone=true;return result});
    await new Promise(resolve=>setTimeout(resolve,100));assert.equal(deleteDone,false);
    release();assert.equal(await runningGuard,'guarded');await blocked;
    await assert.rejects(owner.withPreparedGuard(guard,()=>assert.fail('tombstoned_callback')),/resource_unavailable/);
    const tombstone={path:input.path,operationId:randomUUID(),universeId:'scope',deviceId:'device',revision:2};
    const deleted=await owner.tombstoneImmutable(tombstone);assert.equal(deleted.action,'tombstone');
    assert.deepEqual(await owner.tombstoneImmutable(tombstone),deleted);
    await assert.rejects(owner.getPrepared({path:input.path,deviceId:'device',revision:1}),/resource_unavailable/);
    await assert.rejects(owner.prepareImmutable({...input,operationId:randomUUID()}),/immutable_conflict/);
    await assert.rejects(owner.tombstoneImmutable({...tombstone,operationId:randomUUID(),revision:1}),/revision_conflict/);
    once=true;const lostTombstone={path:'secret/resource/device/lost',operationId:randomUUID(),universeId:'scope',deviceId:'device',revision:2};
    await assert.rejects(uncertain.tombstoneImmutable(lostTombstone),/commit_uncertain/);
    assert((await owner.findReceipt(lostTombstone)).action==='tombstone');
    await assert.rejects(owner.getPrepared({path:lostTombstone.path,deviceId:'device',revision:1}),/resource_unavailable/);
    const rows=(await pool.query('SELECT * FROM vault_owner_resources'))[0];assert(!JSON.stringify(rows).includes(payload.password));
    fs.writeFileSync(stateFile,JSON.stringify({first,tombstone:deleted,digest:await snapshot()}),{mode:0o600});
  }else{
    assert.equal((await pool.query("SELECT * FROM vault_owner_resources WHERE resource_path='secret/resource/device/crash'"))[0].length,0);
    const state=JSON.parse(fs.readFileSync(stateFile,'utf8'));assert.equal(await snapshot(),state.digest);
    assert.deepEqual(await owner.getPrepared({path:'secret/resource/device/r2',deviceId:'device',revision:2}),{...payload,revision:2});
    assert.deepEqual(await owner.findReceipt({path:state.first.path,operationId:state.first.operationId}),state.first);
    assert.deepEqual(await owner.findReceipt({path:state.tombstone.path,operationId:state.tombstone.operationId}),state.tombstone);
    await assert.rejects(owner.getPrepared({path:state.first.path,deviceId:'device',revision:1}),/resource_unavailable/);
  }
  console.log(JSON.stringify({phase,passed:true,actualMariaDB:true,syntheticKey:true,protocol:owner.protocol,stateDigest:await snapshot()}));
}finally{await pool.end()}
