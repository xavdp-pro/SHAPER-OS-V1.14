// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {once} from 'node:events';
import {DurableVaultClient,createDurableVaultServer} from '../durable-http.js';
import {configuredOwnerPort,readPrivateOwnerFile} from '../durable-runtime.mjs';
const token='a'.repeat(64);
const close=async server=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))};

test('durable owner can bind a separate loopback port without changing the legacy default',()=>{
  assert.equal(configuredOwnerPort(undefined),8610);
  assert.equal(configuredOwnerPort('8611'),8611);
  for(const value of ['0','80','65536','8611/tcp',' 8611','08611','not-a-port'])
    assert.throws(()=>configuredOwnerPort(value),/vault_owner_port_invalid/);
});

test('HTTP admission refuses bad credentials/routes/bodies before owner execution',async()=>{
  let calls=0;const owner={protocol:'shaper.durable-conditional-vault.v1',getPrepared(){calls++;throw new Error('synthetic_secret_must_not_escape')}};
  const server=createDurableVaultServer({owner,token});await once(server,'listening');const url=`http://127.0.0.1:${server.address().port}`;
  try{
    assert.equal((await fetch(url+'/api/durable-owner/getPrepared',{method:'POST',body:'{}'})).status,401);
    assert.equal((await fetch(url+'/api/durable-owner/getPrepared?secret=synthetic',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:'{}'})).status,404);
    assert.equal((await fetch(url+'/api/durable-owner/getPrepared',{method:'GET',headers:{Authorization:`Bearer ${token}`}})).status,404);
    const client=new DurableVaultClient({url,token});await assert.rejects(client.getPrepared({}),/^Error: vault_owner_unavailable$/);
    assert.equal(calls,1);
    const malformed=await fetch(url+'/api/durable-owner/getPrepared',{method:'POST',headers:{Authorization:`Bearer ${token}`},body:'{'});
    assert.equal(malformed.status,400);assert.equal(calls,1);
  }finally{await close(server)}
});

test('HTTP client refuses insecure non-loopback URLs, redirected tokens and oversized responses',async()=>{
  assert.throws(()=>new DurableVaultClient({url:'http://192.0.2.1',token}),/configuration_invalid/);
  assert.throws(()=>new DurableVaultClient({url:'https://user:secret@example.invalid',token}),/configuration_invalid/);
  let reached=0;const target=http.createServer((req,res)=>{reached++;res.end('{}')});target.listen(0,'127.0.0.1');await once(target,'listening');
  const server=http.createServer((req,res)=>{res.writeHead(302,{Location:`http://127.0.0.1:${target.address().port}/`});res.end()});server.listen(0,'127.0.0.1');await once(server,'listening');
  try{await assert.rejects(new DurableVaultClient({url:`http://127.0.0.1:${server.address().port}`,token}).getPrepared({}),/vault_owner_unavailable/);assert.equal(reached,0)}
  finally{await close(server);await close(target)}
  const large=http.createServer((req,res)=>res.end('x'.repeat(262144)));large.listen(0,'127.0.0.1');await once(large,'listening');
  try{await assert.rejects(new DurableVaultClient({url:`http://127.0.0.1:${large.address().port}`,token}).findReceipt({}),/vault_owner_response_invalid/)}finally{await close(large)}
});

test('scoped key/password file guard uses actual owner-only bounded regular files',()=>{
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'vault-file-admission-'));
  const file=path.join(directory,'key');fs.writeFileSync(file,token,{mode:0o600});
  try{
    assert.equal(readPrivateOwnerFile(file),token);
    fs.chmodSync(file,0o644);assert.throws(()=>readPrivateOwnerFile(file),/private_file_invalid/);fs.chmodSync(file,0o600);
    assert.throws(()=>readPrivateOwnerFile(file,{uid:process.getuid()+1}),/private_file_invalid/);
    fs.symlinkSync(directory,path.join(directory,'ancestor'));assert.throws(()=>readPrivateOwnerFile(path.join(directory,'ancestor','key')),/private_file_invalid/);
    fs.symlinkSync(file,path.join(directory,'link'));
    fs.chmodSync(directory,0o777);assert.throws(()=>readPrivateOwnerFile(file),/private_file_invalid/);fs.chmodSync(directory,0o700);assert.throws(()=>readPrivateOwnerFile(path.join(directory,'link')),/private_file_invalid/);
    fs.linkSync(file,path.join(directory,'hardlink'));assert.throws(()=>readPrivateOwnerFile(file),/private_file_invalid/);fs.unlinkSync(path.join(directory,'hardlink'));
    fs.writeFileSync(file,'x'.repeat(5000));assert.throws(()=>readPrivateOwnerFile(file),/private_file_invalid/);
  }finally{fs.rmSync(directory,{recursive:true,force:true})}
});


test('HTTP server bounds serialized responses before publishing any payload',async()=>{
  const owner={protocol:'shaper.durable-conditional-vault.v1',getPrepared(){return {payload:'synthetic'.repeat(20000)}}};
  const server=createDurableVaultServer({owner,token});await once(server,'listening');
  try{
    const response=await fetch(`http://127.0.0.1:${server.address().port}/api/durable-owner/getPrepared`,{method:'POST',headers:{Authorization:`Bearer ${token}`},body:'{}'});
    assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'vault_owner_response_invalid'});
  }finally{await close(server)}
});

test('guard and disclosure routes require an explicitly capable owner and keep peer envelopes intact',async()=>{
  const calls=[];
  const owner={protocol:'shaper.durable-conditional-vault.v1',
    acquireGuard(input){calls.push(['guard',input]);return {receipt:{state:'HELD'}}},
    beginDisclosure(input){calls.push(['disclosure',input]);return {receipt:{state:'HELD'},payload:{password:'synthetic'}}}};
  const server=createDurableVaultServer({owner,token});await once(server,'listening');
  const client=new DurableVaultClient({url:`http://127.0.0.1:${server.address().port}`,token});
  try{
    await assert.rejects(client.acquireGuard({guardId:'one'}),/vault_owner_route_unavailable/);
    await assert.rejects(client.beginDisclosure({disclosureId:'one'}),/vault_owner_route_unavailable/);
    assert.deepEqual(calls,[]);
    owner.guardProtocol='shaper.vault-activation-guard.v1';
    owner.disclosureProtocol='shaper.vault-current-disclosure.v1';
    const guard={binding:{guardId:'one'},peerAcknowledgement:{signature:'synthetic'}};
    const disclosure={binding:{guardId:'two'},peerAdmission:{signature:'synthetic'}};
    assert.deepEqual(await client.acquireGuard(guard),{receipt:{state:'HELD'}});
    assert.deepEqual(await client.beginDisclosure(disclosure),{receipt:{state:'HELD'},payload:{password:'synthetic'}});
    assert.deepEqual(calls,[['guard',guard],['disclosure',disclosure]]);
    const unauthenticated=await fetch(`${client.url}/api/durable-owner/beginDisclosure`,{method:'POST',body:JSON.stringify(disclosure)});
    assert.equal(unauthenticated.status,401);
    assert.deepEqual(calls,[['guard',guard],['disclosure',disclosure]]);
  }finally{await close(server)}
});
