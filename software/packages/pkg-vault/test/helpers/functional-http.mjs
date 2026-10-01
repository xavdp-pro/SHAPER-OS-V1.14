// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {DurableVaultClient} from '/apps/vault/app/pkg-vault/durable-http.js';
import {readPrivateOwnerFile} from '/apps/vault/app/pkg-vault/durable-runtime.mjs';
const phase=process.argv[2];assert(['seed','restart','restore','upgrade-seed','upgrade','upgrade-restart'].includes(phase));
assert.equal(process.getuid(),10001);
const require=createRequire('/apps/vault/nosav/package.json');
const mysql=require('mysql2/promise');
const token=readPrivateOwnerFile('/apps/vault/etc/owner/token');
const password=readPrivateOwnerFile('/apps/vault/etc/mysql/localhost/passwd');
const client=new DurableVaultClient({url:'http://127.0.0.1:8610',token});
const settings={socketPath:'/apps/vault/nosav/mysql/vault.sock',user:'vault',database:'vault',password};
const connection=await mysql.createConnection(settings);
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const payload={universeId:'synthetic',deviceId:'synthetic-device',revision:1,secret:'synthetic_private_payload'};
const snapshot=async()=>{
  const data={};for(const table of (phase.startsWith('upgrade')?['vault_owner_epochs','vault_owner_resources','vault_owner_operations']:['vault_owner_epochs','vault_owner_resources','vault_owner_operations','vault_owner_resource_fences','vault_owner_guards'])){
    data[table]=(await connection.query(`SELECT * FROM ${table} ORDER BY ${table==='vault_owner_operations'||table==='vault_owner_guards'?'sequence':table==='vault_owner_epochs'?'scope_id':'scope_id,path_hash'}`))[0];
  }return digest(data);
};
try{
  const [[identity]]=await connection.query('SELECT CURRENT_USER() AS principal,DATABASE() AS db,@@skip_networking AS network_disabled,VERSION() AS version');
  assert.equal(identity.principal,'vault@localhost');assert.equal(identity.db,'vault');assert.equal(Number(identity.network_disabled),1);
  for(const sql of ['SELECT * FROM mysql.user','DELETE FROM vault_owner_operations','ALTER TABLE vault_owner_resources ADD bad INT',"UPDATE vault_owner_resources SET device_id='bad'"])
    await assert.rejects(connection.query(sql),error=>['ER_TABLEACCESS_DENIED_ERROR','ER_COLUMNACCESS_DENIED_ERROR'].includes(error.code));
  await assert.rejects(mysql.createConnection({...settings,user:'root'}),error=>['ER_ACCESS_DENIED_ERROR','ER_ACCESS_DENIED_NO_PASSWORD_ERROR'].includes(error.code));
  await assert.rejects(mysql.createConnection({...settings,user:'foreign_function',password:'synthetic_foreign_password'}),error=>error.code==='ER_ACCESS_DENIED_ERROR');
  for(const method of ['acquireGuard','inspectGuard','settleGuard']){
    const response=await fetch('http://127.0.0.1:8610/api/durable-owner/'+method,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:'{}'});
    assert.equal(response.status,404);
  }
  if(phase!=='upgrade-seed'){
    const [tables]=await connection.query('SHOW TABLES');assert.equal(tables.length,5);
    for(const sql of ["UPDATE vault_owner_guards SET binding_json='bad'","UPDATE vault_owner_guards SET guard_id='bad'","UPDATE vault_owner_resource_fences SET path_hash='bad'"])await assert.rejects(connection.query(sql),error=>error.code==='ER_COLUMNACCESS_DENIED_ERROR');
  }else assert.equal((await connection.query('SHOW TABLES'))[0].length,3);
  if(phase==='seed'||phase==='upgrade-seed'){
    for(const badToken of [null,'b'.repeat(64)]){
      const headers=badToken?{Authorization:`Bearer ${badToken}`}:{},res=await fetch('http://127.0.0.1:8610/api/durable-owner/getPrepared',{method:'POST',headers,body:'{}'});
      assert.equal(res.status,401);assert.deepEqual(await res.json(),{error:'vault_owner_unauthorized'});
    }
    const input={path:'secret/resource/synthetic/r1',operationId:randomUUID(),payload,payloadDigest:digest(payload)};
    const prepared=await client.prepareImmutable(input);
    assert.equal(typeof prepared.authentication,'string');assert.deepEqual(await client.prepareImmutable(input),prepared);
    assert.deepEqual(await client.getPrepared({path:input.path,deviceId:payload.deviceId,revision:1}),payload);
    assert.deepEqual(await client.findReceipt(input),prepared);
    const reordered=Object.fromEntries(Object.entries(prepared).reverse());
    assert.deepEqual(await client.verifyReceipt({receipt:reordered,path:input.path,operationId:input.operationId,payloadDigest:input.payloadDigest}),prepared);
    await assert.rejects(client.verifyReceipt({receipt:{...prepared,authentication:'0'.repeat(64)},path:input.path,operationId:input.operationId,payloadDigest:input.payloadDigest}),/receipt_invalid/);
    await assert.rejects(client.getPrepared({path:input.path,deviceId:'foreign',revision:1}),/resource_unavailable/);
    await assert.rejects(client.prepareImmutable({...input,operationId:randomUUID()}),/immutable_conflict/);
    const foreign={...payload,universeId:'foreign'};
    await assert.rejects(client.prepareImmutable({...input,path:'secret/resource/foreign/r1',payload:foreign,payloadDigest:digest(foreign),operationId:randomUUID()}),/invalid_operation/);
    const deleted=await client.tombstoneImmutable({path:input.path,operationId:randomUUID(),universeId:payload.universeId,deviceId:payload.deviceId,revision:2});
    assert.equal(deleted.action,'tombstone');
    await assert.rejects(client.getPrepared({path:input.path,deviceId:payload.deviceId,revision:1}),/resource_unavailable/);
    const activeInput={...input,path:'secret/resource/synthetic/active',operationId:randomUUID()};
    const active=await client.prepareImmutable(activeInput);
    const rows=(await connection.query('SELECT encrypted_payload FROM vault_owner_resources'))[0];assert(!JSON.stringify(rows).includes(payload.secret));
    fs.writeFileSync('/qa-state/state.json',JSON.stringify({prepared,deleted,active,payloadDigest:input.payloadDigest,digest:await snapshot()}),{mode:0o600});
  }else{
    const state=JSON.parse(fs.readFileSync('/qa-state/state.json','utf8'));assert.equal(await snapshot(),state.digest);
    assert.deepEqual(await client.findReceipt({path:state.active.path,operationId:state.active.operationId}),state.active);
    assert.deepEqual(await client.verifyReceipt({receipt:state.active,path:state.active.path,operationId:state.active.operationId,payloadDigest:state.payloadDigest}),state.active);
    assert.deepEqual(await client.getPrepared({path:state.active.path,deviceId:payload.deviceId,revision:1}),payload);
    await assert.rejects(client.getPrepared({path:state.prepared.path,deviceId:payload.deviceId,revision:1}),/resource_unavailable/);
  }
  console.log(JSON.stringify({phase,passed:true,uid:process.getuid(),databaseIdentity:identity,node:process.version,driver:require('mysql2/package.json').version,tableDigest:await snapshot(),digestTables:phase.startsWith('upgrade')?3:5,guardRoutesMounted:false,methods:['prepareImmutable','findReceipt','verifyReceipt','getPrepared','tombstoneImmutable'],scope:'synthetic_only',transport:'loopback_http_inside_network_none_container'}));
}finally{await connection.end()}
