// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,randomUUID,createHash,sign} from 'node:crypto';
import {CurrentDisclosureVaultOwner} from '../durable-disclosure-owner.js';
const keys=generateKeyPairSync('ed25519'),canonical=v=>JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])));
const options={pool:{getConnection(){assert.fail('unexpected_SQL')}},masterKey:Buffer.alloc(32,7),universeId:'scope',admitFreshness:()=>true,
 resolveConsumer:()=>({universeId:'scope',consumerId:'peer',consumerIncarnation:'writer',keyId:'key',publicKey:keys.publicKey.export({type:'spki',format:'pem'}),operations:['read']})};
const binding=()=>({universeId:'scope',ownerEpoch:'epoch',consumerId:'peer',consumerIncarnation:'writer',operationId:randomUUID(),guardId:randomUUID(),ackSequence:1,path:'secret/attempt',deviceId:'device',revision:1,payloadDigest:'a'.repeat(64),purpose:'current-disclosure',operation:'read',activationOperationId:randomUUID(),authorityBindingDigest:'b'.repeat(64)});
const admission=(b,k=keys.privateKey)=>{const body={schema:'shaper.peer-disclosure-admission.v1',consumerId:b.consumerId,consumerIncarnation:b.consumerIncarnation,ownerEpoch:b.ownerEpoch,operationId:b.operationId,guardId:b.guardId,bindingDigest:createHash('sha256').update(canonical(b)).digest('hex'),ackSequence:b.ackSequence,keyId:'key'};return {...body,signature:sign(null,Buffer.from(canonical(body)),k).toString('base64')}};
test('finite distinct read binding and signature refuse before SQL',async()=>{
 const owner=new CurrentDisclosureVaultOwner(options),b=binding();
 for(const changed of [{...b,operationId:b.activationOperationId},{...b,purpose:'activation'},{...b,operation:'rotate'},{...b,ackSequence:Number.MAX_SAFE_INTEGER+1},{...b,extra:'private'}, {...b,authorityBindingDigest:'bad'}])await assert.rejects(owner.beginDisclosure({binding:changed,peerAdmission:admission(changed)}),/disclosure_invalid/);
 await assert.rejects(owner.beginDisclosure({binding:b,peerAdmission:admission(b,generateKeyPairSync('ed25519').privateKey)}),/signature_invalid/);
 await assert.rejects(owner.beginDisclosure({binding:b,peerAdmission:{...admission(b),hidden:'private'}}),/signature_invalid/);
});
test('freshness/peer admission is mandatory and rejected promises are consumed',async()=>{
 assert.throws(()=>new CurrentDisclosureVaultOwner({...options,admitFreshness:null}),/configuration_invalid/);
 const b=binding();
 for(const admitFreshness of [()=>false,()=>Promise.reject(new Error('private_fault'))])await assert.rejects(new CurrentDisclosureVaultOwner({...options,admitFreshness}).beginDisclosure({binding:b,peerAdmission:admission(b)}),/freshness_unavailable/);
 await assert.rejects(new CurrentDisclosureVaultOwner({...options,resolveConsumer:()=>({...options.resolveConsumer(),operations:['issue']})}).beginDisclosure({binding:b,peerAdmission:admission(b)}),/consumer_unavailable/);
 await new Promise(resolve=>setImmediate(resolve));
});
test('generic getters/callbacks and historical activation purposes never become disclosure',async()=>{
 const owner=new CurrentDisclosureVaultOwner(options);
 await assert.rejects(owner.getPrepared(binding()),/guard_required/);
 await assert.rejects(owner.withPreparedGuard(binding(),()=>assert.fail()),/guard_required/);
 await assert.rejects(owner.acquireGuard(binding()),/guard_invalid/);
});
test('owning startup admits only exact known three/five/six table shapes before migration',async()=>{
 const {readFileSync}=await import('node:fs'),{spawnSync}=await import('node:child_process');
 const sql=readFileSync(new URL('../durable-owner.sql',import.meta.url),'utf8');
 const tables={};for(const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\) ENGINE=InnoDB;/g))tables[match[1]]=[...match[2].matchAll(/^  (\w+) (?:VARCHAR|CHAR|BIGINT|TINYINT|LONGTEXT)/gm)].map(value=>value[1]);
 const rows=names=>names.flatMap(name=>tables[name].map(column=>name+'\t'+column));
 const names=Object.keys(tables),three=names.slice(0,3),five=names.slice(0,5);
 const fixtures=[{rows:[],valid:true},{rows:rows(three),valid:true},{rows:rows(five),valid:true},{rows:rows(names),valid:true},
  {rows:[...rows(five),'foreign\tprivate'],valid:false},{rows:rows(names).slice(1),valid:false},{rows:[...rows(names),'vault_owner_disclosures\tunrecognized'],valid:false},{rows:rows(names.slice(0,4)),valid:false}];
 const bootstrap=new URL('../../../bricks/brick-vault/start-durable-vault.py',import.meta.url);
 const script="import ast,json,sys\np=sys.argv[1]\nf=next(n for n in ast.parse(open(p).read()).body if isinstance(n,ast.FunctionDef) and n.name=='validate_schema_rows')\nscope={}\nexec(compile(ast.Module(body=[f],type_ignores=[]),p,'exec'),scope)\nfor fixture in json.load(sys.stdin):\n try: scope['validate_schema_rows'](fixture['rows']); accepted=True\n except RuntimeError as error:\n  assert str(error)=='vault_owner_database_schema_invalid'; accepted=False\n assert accepted==fixture['valid']\n";
 const result=spawnSync('python3',['-c',script,bootstrap.pathname],{input:JSON.stringify(fixtures),encoding:'utf8',timeout:3000});
 assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'');
 const source=readFileSync(bootstrap,'utf8');assert(source.indexOf("    schema_preflight()")<source.indexOf("    sql('CREATE DATABASE IF NOT EXISTS vault;USE vault;'"));
});
