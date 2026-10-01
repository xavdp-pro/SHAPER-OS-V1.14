// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {encryptSecret,decryptSecret,normalizeMasterKey} from './index.js';

const fail=code=>{throw new Error(code)};
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value);
const revision=value=>Number.isSafeInteger(value)&&value>0;
const hash=value=>createHash('sha256').update(value).digest('hex');
const serialize=value=>JSON.stringify(value);
const discard=connection=>{try{connection?.destroy()}catch{/* Never replace the sanitized primary error. */}};
const canonical=value=>JSON.stringify(Object.fromEntries(Object.keys(value).sort().map(key=>[key,value[key]])));
const address=value=>typeof value==='string'&&value.length>0&&value.length<=512&&
  !/[\x00-\x20\x7f?#\\]/.test(value)&&value.split('/').every(part=>part&&part!=='.'&&part!=='..');

/** Generic opt-in owner within the Vault's own private MariaDB. No HTTP route,
 * schema installation or credential resolution is implicit. A caller supplies
 * the confined application pool and the existing universe-scoped master key.
 */
export class DurableVaultOwner {
  protocol='shaper.durable-conditional-vault.v1';
  constructor({pool,masterKey,universeId}={}) {
    if(!pool||typeof pool.getConnection!=='function'||!identifier(universeId))fail('vault_owner_invalid_configuration');
    this.pool=pool;this.scope=universeId;this.key=Buffer.from(normalizeMasterKey(masterKey));
  }
  signed(body){return {...body,authentication:createHmac('sha256',this.key).update(canonical(body)).digest('hex')}}
  checked(receipt){
    if(!receipt||receipt.schema!=='shaper.vault-durable-receipt.v1'||receipt.universeId!==this.scope||
      !identifier(receipt.deviceId)||!identifier(receipt.ownerEpoch)||!uuid(receipt.operationId)||
      !address(receipt.path)||!revision(receipt.revision)||!revision(receipt.durableSequence)||
      !['prepare','tombstone'].includes(receipt.action)||
      (receipt.action==='prepare'?!/^[a-f0-9]{64}$/.test(receipt.payloadDigest):receipt.payloadDigest!==null)||
      !/^[a-f0-9]{64}$/.test(receipt.authentication))fail('vault_owner_receipt_invalid');
    const {authentication,...body}=receipt;
    if(!timingSafeEqual(Buffer.from(authentication,'hex'),Buffer.from(this.signed(body).authentication,'hex')))
      fail('vault_owner_receipt_invalid');
    return receipt;
  }
  async transaction(work,{callbackFailure=null}={}){
    let connection,committing=false,reusable=true;
    try {
      connection=await this.pool.getConnection();
      const [[settings]]=await connection.query('SELECT @@innodb_flush_log_at_trx_commit AS flush_mode');
      if(Number(settings.flush_mode)!==1)fail('vault_owner_durability_unavailable');
      await connection.beginTransaction();const result=await work(connection);
      committing=true;await connection.commit();return result;
    } catch(error){
      if(committing){reusable=false;discard(connection);fail('vault_owner_commit_uncertain')}
      if(connection)try{await connection.rollback()}catch{reusable=false;discard(connection);fail('vault_owner_cleanup_failed')}
      if(callbackFailure?.seen&&error===callbackFailure.value)throw error;
      if(/^vault_owner_[a-z_]+$/.test(error?.message||''))throw error;
      fail('vault_owner_store_unavailable');
    } finally{if(connection&&reusable)connection.release()}
  }
  async write({path,operationId,universeId,deviceId,revision:version,payloadDigest,payload},action){
    if(!address(path)||!uuid(operationId)||universeId!==this.scope||!identifier(deviceId)||!revision(version))
      fail('vault_owner_invalid_operation');
    let encoded=null;
    if(action==='prepare'){
      try{encoded=serialize(payload)}catch{fail('vault_owner_payload_invalid')}
      if(typeof encoded!=='string'||Buffer.byteLength(encoded)>65536||hash(encoded)!==payloadDigest)
        fail('vault_owner_payload_invalid');
      // Snapshot exact payload bytes before any asynchronous database operation.
      payload=JSON.parse(encoded);
      if(!payload||typeof payload!=='object'||Array.isArray(payload)||payload.universeId!==universeId||payload.deviceId!==deviceId||payload.revision!==version)
        fail('vault_owner_payload_invalid');
    }else payloadDigest=null;
    const pathHash=hash(path),requestDigest=hash(serialize({path,universeId,deviceId,revision:version,payloadDigest,action}));
    const receipt=await this.transaction(async connection=>{
      await connection.execute('INSERT IGNORE INTO vault_owner_epochs (scope_id,owner_epoch) VALUES (?,?)',
        [this.scope,randomBytes(16).toString('hex')]);
      const [[epoch]]=await connection.execute('SELECT owner_epoch FROM vault_owner_epochs WHERE scope_id=? FOR UPDATE',[this.scope]);
      const [existing]=await connection.execute('SELECT request_digest,receipt_json FROM vault_owner_operations WHERE scope_id=? AND operation_id=? FOR UPDATE',[this.scope,operationId]);
      if(existing.length){
        if(existing[0].request_digest!==requestDigest)fail('vault_owner_operation_conflict');
        return this.checked(JSON.parse(existing[0].receipt_json));
      }
      const [resources]=await connection.execute('SELECT * FROM vault_owner_resources WHERE scope_id=? AND path_hash=? FOR UPDATE',[this.scope,pathHash]);
      const current=resources[0];
      if(action==='prepare'){
        if(current)fail('vault_owner_immutable_conflict');
        await connection.execute('INSERT INTO vault_owner_resources (scope_id,path_hash,resource_path,device_id,revision,tombstoned,encrypted_payload,payload_digest) VALUES (?,?,?,?,?,0,?,?)',
          [this.scope,pathHash,path,deviceId,version,serialize(encryptSecret(payload,this.key)),payloadDigest]);
      }else{
        if(!current||current.resource_path!==path||current.device_id!==deviceId||Number(current.tombstoned)!==0||version!==Number(current.revision)+1)
          fail('vault_owner_revision_conflict');
        await connection.execute('UPDATE vault_owner_resources SET revision=?,tombstoned=1,encrypted_payload=NULL,payload_digest=NULL WHERE scope_id=? AND path_hash=?',[version,this.scope,pathHash]);
      }
      const [inserted]=await connection.execute('INSERT INTO vault_owner_operations (scope_id,operation_id,path_hash,request_digest,receipt_json) VALUES (?,?,?,?,?)',[this.scope,operationId,pathHash,requestDigest,'{}']);
      const sequence=Number(inserted.insertId);if(!revision(sequence))fail('vault_owner_sequence_exhausted');
      const result=this.signed({schema:'shaper.vault-durable-receipt.v1',path,operationId,universeId:this.scope,
        deviceId,revision:version,payloadDigest,action,ownerEpoch:epoch.owner_epoch,durableSequence:sequence});
      await connection.execute('UPDATE vault_owner_operations SET receipt_json=? WHERE scope_id=? AND operation_id=?',[serialize(result),this.scope,operationId]);
      return result;
    });
    const checked=await this.verifyReceipt({receipt,path,operationId,payloadDigest});
    if(action==='prepare'){
      const value=await this.getPrepared({path,deviceId,revision:version});
      if(hash(serialize(value))!==payloadDigest)fail('vault_owner_readback_unavailable');
    }
    return checked;
  }
  prepareImmutable({path,operationId,payload,payloadDigest}={}){
    let universeId,deviceId,version;
    try{universeId=payload?.universeId;deviceId=payload?.deviceId;version=payload?.revision}
    catch{fail('vault_owner_payload_invalid')}
    return this.write({path,operationId,payload,payloadDigest,universeId,deviceId,revision:version},'prepare');
  }
  tombstoneImmutable(input={}){return this.write(input,'tombstone')}
  async findReceipt({path,operationId}={}){
    if(!address(path)||!uuid(operationId))fail('vault_owner_invalid_operation');
    let connection;
    try{
      connection=await this.pool.getConnection();
      const [rows]=await connection.execute('SELECT receipt_json FROM vault_owner_operations WHERE scope_id=? AND operation_id=? AND path_hash=?',[this.scope,operationId,hash(path)]);
      if(!rows.length)return null;
      const result=this.checked(JSON.parse(rows[0].receipt_json));if(result.path!==path)fail('vault_owner_receipt_invalid');return result;
    }catch(error){if(/^vault_owner_[a-z_]+$/.test(error.message||''))throw error;fail('vault_owner_store_unavailable')}
    finally{connection?.release()}
  }
  async verifyReceipt({receipt,path,operationId,payloadDigest}={}){
    this.checked(receipt);
    if(receipt.path!==path||receipt.operationId!==operationId||receipt.payloadDigest!==payloadDigest)fail('vault_owner_receipt_invalid');
    const current=await this.findReceipt({path,operationId});
    if(!current||canonical(current)!==canonical(receipt))fail('vault_owner_receipt_invalid');return current;
  }
  /** In-process guard only. Callback must be bounded and must not recursively
   * mutate this owner. It is not a distributed HTTP transaction or lease. */
  async withPreparedGuard({path,deviceId,revision:version,payloadDigest}={},work){
    if(!address(path)||!identifier(deviceId)||!revision(version)||
      !/^[a-f0-9]{64}$/.test(payloadDigest)||typeof work!=='function')fail('vault_owner_invalid_operation');
    const callbackFailure={seen:false,value:null};
    return this.transaction(async connection=>{
      const [[row]]=await connection.execute('SELECT * FROM vault_owner_resources WHERE scope_id=? AND path_hash=? FOR UPDATE',[this.scope,hash(path)]);
      if(!row||row.resource_path!==path||row.device_id!==deviceId||Number(row.revision)!==version||Number(row.tombstoned)!==0||row.payload_digest!==payloadDigest)
        fail('vault_owner_resource_unavailable');
      let payload;try{payload=decryptSecret(JSON.parse(row.encrypted_payload),this.key)}catch{fail('vault_owner_resource_unavailable')}
      if(!payload||payload.universeId!==this.scope||payload.deviceId!==deviceId||payload.revision!==version||hash(serialize(payload))!==payloadDigest)
        fail('vault_owner_resource_unavailable');
      try{return await work(payload)}catch(error){callbackFailure.seen=true;callbackFailure.value=error;throw error}
    },{callbackFailure});
  }
  async getPrepared({path,deviceId,revision:version}={}){
    if(!address(path)||!identifier(deviceId)||!revision(version))fail('vault_owner_invalid_operation');
    let connection;
    try{
      connection=await this.pool.getConnection();
      const [rows]=await connection.execute('SELECT * FROM vault_owner_resources WHERE scope_id=? AND path_hash=?',[this.scope,hash(path)]);
      const row=rows[0];if(!row||row.resource_path!==path||row.device_id!==deviceId||Number(row.revision)!==version||Number(row.tombstoned)!==0)
        fail('vault_owner_resource_unavailable');
      const payload=decryptSecret(JSON.parse(row.encrypted_payload),this.key);
      if(!payload||payload.universeId!==this.scope||payload.deviceId!==deviceId||payload.revision!==version||
        hash(serialize(payload))!==row.payload_digest)fail('vault_owner_resource_unavailable');return payload;
    }catch(error){if(/^vault_owner_[a-z_]+$/.test(error.message||''))throw error;fail('vault_owner_store_unavailable')}
    finally{connection?.release()}
  }
}
