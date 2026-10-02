// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import fs from 'node:fs';
import os from 'node:os';
import {createRequire} from 'node:module';
import {DurableVaultOwner} from './durable-owner.js';
import {CurrentDisclosureVaultOwner} from './durable-disclosure-owner.js';
import {createHostWitnessAdmission,readHostWitness} from './durable-witness.js';
import {createDurableVaultServer} from './durable-http.js';

export function readPrivateOwnerFile(path,{uid=process.getuid(),maximum=4096}={}){
  let fd;
  try{
    const parts=path.split('/');if(parts.shift()!=='')throw new Error('vault_owner_private_file_invalid');
    fd=fs.openSync('/',fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
    for(let index=0;index<parts.length;index++){
      const parent=fs.fstatSync(fd);
      if((parent.uid!==0&&parent.uid!==uid)||((parent.mode&0o022)!==0&&!(parent.uid===0&&(parent.mode&0o1000)!==0)))
        throw new Error('vault_owner_private_file_invalid');
      const child=fs.openSync(`/proc/self/fd/${fd}/${parts[index]}`,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|(index===parts.length-1?0:fs.constants.O_DIRECTORY));
      fs.closeSync(fd);fd=child;
    }
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.uid!==uid||(stat.mode&0o777)!==0o600||stat.nlink!==1||stat.size<1||stat.size>maximum)
      throw new Error('vault_owner_private_file_invalid');
    const bytes=Buffer.alloc(maximum+1);const size=fs.readSync(fd,bytes,0,bytes.length,0);
    if(size>maximum)throw new Error('vault_owner_private_file_invalid');
    return bytes.subarray(0,size).toString('utf8').trim();
  }catch{throw new Error('vault_owner_private_file_invalid')}
  finally{if(fd!==undefined)fs.closeSync(fd)}
}

export function configuredOwnerPort(value){
  if(value===undefined)return 8610;
  if(typeof value!=='string'||!/^[1-9][0-9]{3,4}$/.test(value))throw new Error('vault_owner_port_invalid');
  const port=Number(value);
  if(!Number.isSafeInteger(port)||port<1024||port>65535)throw new Error('vault_owner_port_invalid');
  return port;
}

export function configuredOwnerMode(value){
  if(value===undefined||value==='base')return 'base';
  if(value==='current-disclosure')return value;
  throw new Error('vault_owner_mode_invalid');
}

export async function checkWitnessEpoch(pool,witness){
  let connection;
  try{
    connection=await pool.getConnection();
    const [[row]]=await connection.execute('SELECT owner_epoch FROM vault_owner_epochs WHERE scope_id=?',[witness.universeId]);
    if(!row||row.owner_epoch!==witness.ownerEpoch)throw new Error('vault_owner_freshness_unavailable');
  }catch{throw new Error('vault_owner_freshness_unavailable')}
  finally{connection?.release()}
}

export async function checkPrivateVaultDatabase(pool){
  const connection=await pool.getConnection();
  try{
    const [[identity]]=await connection.query('SELECT CURRENT_USER() AS principal,CURRENT_ROLE() AS active_role,DATABASE() AS db,@@innodb_flush_log_at_trx_commit AS flush_mode,@@skip_networking AS private_network');
    if(identity.principal!=='vault@localhost'||(identity.active_role!==null&&identity.active_role!=='NONE')||identity.db!=='vault'||Number(identity.flush_mode)!==1||Number(identity.private_network)!==1)
      throw new Error('vault_owner_database_configuration_invalid');
    const [roles]=await connection.query('SELECT ROLE_NAME FROM information_schema.APPLICABLE_ROLES');
    if(roles.length)throw new Error('vault_owner_database_grants_invalid');
    const grantee="'vault'@'localhost'";
    const [global]=await connection.execute('SELECT PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.USER_PRIVILEGES WHERE GRANTEE=?',[grantee]);
    if(global.some(row=>row.PRIVILEGE_TYPE!=='USAGE'||row.IS_GRANTABLE!=='NO'))throw new Error('vault_owner_database_grants_invalid');
    const [schemas]=await connection.execute('SELECT PRIVILEGE_TYPE FROM information_schema.SCHEMA_PRIVILEGES WHERE GRANTEE=?',[grantee]);
    if(schemas.length)throw new Error('vault_owner_database_grants_invalid');
    const [tables]=await connection.execute('SELECT TABLE_SCHEMA,TABLE_NAME,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.TABLE_PRIVILEGES WHERE GRANTEE=?',[grantee]);
    const names=['vault_owner_epochs','vault_owner_resources','vault_owner_operations','vault_owner_resource_fences','vault_owner_guards','vault_owner_disclosures'];
    if(tables.some(row=>row.TABLE_SCHEMA!=='vault'||!names.includes(row.TABLE_NAME)||!['SELECT','INSERT'].includes(row.PRIVILEGE_TYPE)||row.IS_GRANTABLE!=='NO'))
      throw new Error('vault_owner_database_grants_invalid');
    for(const table of names)for(const privilege of ['SELECT','INSERT'])if(!tables.some(row=>row.TABLE_NAME===table&&row.PRIVILEGE_TYPE===privilege))
      throw new Error('vault_owner_database_grants_invalid');
    const allowed={vault_owner_resources:['revision','tombstoned','encrypted_payload','payload_digest'],vault_owner_operations:['receipt_json'],vault_owner_resource_fences:['managed','held_guard_id','deny_new','deny_operation_id','deny_revision','deny_request_digest'],vault_owner_guards:['state','terminal_ack_json','terminal_ack_digest'],vault_owner_disclosures:['state','closure_json','closure_digest']};
    const [columns]=await connection.execute('SELECT TABLE_SCHEMA,TABLE_NAME,COLUMN_NAME,PRIVILEGE_TYPE,IS_GRANTABLE FROM information_schema.COLUMN_PRIVILEGES WHERE GRANTEE=?',[grantee]);
    if(columns.some(row=>row.TABLE_SCHEMA!=='vault'||row.PRIVILEGE_TYPE!=='UPDATE'||row.IS_GRANTABLE!=='NO'||!allowed[row.TABLE_NAME]?.includes(row.COLUMN_NAME)))
      throw new Error('vault_owner_database_grants_invalid');
    for(const [table,list]of Object.entries(allowed))for(const column of list)if(!columns.some(row=>row.TABLE_NAME===table&&row.COLUMN_NAME===column))
      throw new Error('vault_owner_database_grants_invalid');
    const expected={
      vault_owner_epochs:['scope_id','owner_epoch'],
      vault_owner_resources:['scope_id','path_hash','resource_path','device_id','revision','tombstoned','encrypted_payload','payload_digest'],
      vault_owner_operations:['sequence','scope_id','operation_id','path_hash','request_digest','receipt_json'],
      vault_owner_resource_fences:['scope_id','path_hash','managed','held_guard_id','deny_new','deny_operation_id','deny_revision','deny_request_digest'],
      vault_owner_guards:['sequence','scope_id','guard_id','operation_id','consumer_id','consumer_incarnation','ack_sequence','path_hash','binding_digest','binding_json','state','terminal_ack_json','terminal_ack_digest'],
      vault_owner_disclosures:['sequence','scope_id','disclosure_id','read_operation_id','activation_operation_id','consumer_id','consumer_incarnation','ack_sequence','path_hash','binding_json','binding_digest','admission_json','admission_digest','payload_claimed','state','closure_json','closure_digest']
    };
    const [schema]=await connection.execute('SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=?',['vault']);
    for(const [table,list]of Object.entries(expected)){
      const actual=schema.filter(row=>row.TABLE_NAME===table).map(row=>row.COLUMN_NAME);
      if(actual.length!==list.length||list.some(column=>!actual.includes(column)))throw new Error('vault_owner_database_schema_invalid');
    }
    const [engines]=await connection.execute('SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',['vault']);
    if(engines.length!==names.length||engines.some(row=>!names.includes(row.TABLE_NAME)||row.ENGINE!=='InnoDB'))throw new Error('vault_owner_database_schema_invalid');
    const [keys]=await connection.execute('SELECT TABLE_NAME,CONSTRAINT_NAME,COLUMN_NAME,ORDINAL_POSITION FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=?',['vault']);
    const requiredKeys={vault_owner_epochs:{PRIMARY:['scope_id']},vault_owner_resources:{PRIMARY:['scope_id','path_hash']},vault_owner_operations:{PRIMARY:['sequence'],operation_identity:['scope_id','operation_id']},vault_owner_resource_fences:{PRIMARY:['scope_id','path_hash'],pending_operation_identity:['scope_id','deny_operation_id']},vault_owner_guards:{PRIMARY:['sequence'],guard_identity:['scope_id','guard_id'],guarded_operation_identity:['scope_id','operation_id'],peer_ack_identity:['scope_id','consumer_id','consumer_incarnation','ack_sequence']},vault_owner_disclosures:{PRIMARY:['sequence'],disclosure_identity:['scope_id','disclosure_id'],disclosure_operation_identity:['scope_id','read_operation_id'],disclosure_ack_identity:['scope_id','consumer_id','consumer_incarnation','ack_sequence']}};
    for(const [table,indexes]of Object.entries(requiredKeys))for(const [name,list]of Object.entries(indexes)){
      const actual=keys.filter(row=>row.TABLE_NAME===table&&row.CONSTRAINT_NAME===name).sort((a,b)=>Number(a.ORDINAL_POSITION)-Number(b.ORDINAL_POSITION)).map(row=>row.COLUMN_NAME);
      if(JSON.stringify(actual)!==JSON.stringify(list))throw new Error('vault_owner_database_schema_invalid');
    }
    for(const table of names)await connection.query(`SELECT 1 FROM ${table} LIMIT 1`);
  }catch(error){throw new Error(/^vault_owner_[a-z_]+$/.test(error?.message||'')?error.message:'vault_owner_database_unavailable')}
  finally{connection.release()}
}

async function main(){
  if(process.getuid()===0||os.userInfo().username!=='vault')throw new Error('vault_owner_system_identity_invalid');
  const port=configuredOwnerPort(process.env.VAULT_OWNER_PORT);
  const mode=configuredOwnerMode(process.env.VAULT_OWNER_MODE);
  const witnessPath='/run/shaper/vault-owner-witness.json';
  if(mode==='current-disclosure')readHostWitness(witnessPath);
  const key=readPrivateOwnerFile('/apps/vault/etc/owner/master-key');
  const token=readPrivateOwnerFile('/apps/vault/etc/owner/token');
  const password=readPrivateOwnerFile('/apps/vault/etc/mysql/localhost/passwd');
  if(![key,token,password].every(value=>/^[a-f0-9]{64}$/.test(value)))throw new Error('vault_owner_private_file_invalid');
  const require=createRequire('/apps/vault/nosav/package.json');
  if(require('mysql2/package.json').version!=='3.24.4')throw new Error('vault_owner_driver_invalid');
  const mysql=require('mysql2/promise');
  const native=mysql.createPool({socketPath:'/apps/vault/nosav/mysql/vault.sock',user:'vault',database:'vault',password,
    connectionLimit:4,waitForConnections:false,connectTimeout:3000});
  const pool={getConnection:async()=>{
    const connection=await native.getConnection();const query=(sql,args)=>connection.query({sql,timeout:5000},args);
    return {query,execute:(sql,args)=>connection.execute({sql,timeout:5000},args),beginTransaction:()=>query('START TRANSACTION'),
      commit:()=>query('COMMIT'),rollback:()=>query('ROLLBACK'),release:()=>connection.release(),destroy:()=>connection.destroy()};
  }};
  try{
    await checkPrivateVaultDatabase(pool);
    let owner;
    if(mode==='current-disclosure'){
      const witness=readHostWitness(witnessPath);
      if(witness.universeId!==process.env.VAULT_UNIVERSE_ID)throw new Error('vault_owner_freshness_unavailable');
      await checkWitnessEpoch(pool,witness);
      owner=new CurrentDisclosureVaultOwner({pool,masterKey:key,universeId:witness.universeId,
        ...createHostWitnessAdmission(witnessPath)});
    }else owner=new DurableVaultOwner({pool,masterKey:key,universeId:process.env.VAULT_UNIVERSE_ID});
    const server=createDurableVaultServer({owner,token,port});
    const stop=()=>{server.close(async()=>{await native.end();process.exit(0)});server.closeIdleConnections()};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);
  }catch(error){await native.end();throw error}
}
if(process.argv[1]===new URL(import.meta.url).pathname)main().catch(error=>{
  console.error(/^vault_owner_[a-z_]+$/.test(error?.message||'')?error.message:'vault_owner_startup_failed');process.exit(1);
});
