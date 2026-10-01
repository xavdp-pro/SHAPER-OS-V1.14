// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import {createHash,createPublicKey,verify} from 'node:crypto';
import {DurableVaultOwner} from './durable-owner.js';
import {decryptSecret} from './index.js';
const fail=code=>{throw new Error(code)};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const sha=v=>createHash('sha256').update(v).digest('hex');
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const canonical=v=>JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])));
const path=v=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\x00-\x20\x7f?#\\]/.test(v)&&v.split('/').every(p=>p&&p!=='.'&&p!=='..');
const fields=['universeId','ownerEpoch','consumerId','consumerIncarnation','operationId','guardId','ackSequence','path','deviceId','revision','payloadDigest','purpose','operation'];
const terminal=['RELEASED_COMMITTED','RELEASED_ABORTED'];
function binding(input){
  let value;try{value=JSON.parse(JSON.stringify(input))}catch{fail('vault_owner_guard_invalid')}
  if(!value||Object.keys(value).length!==fields.length||fields.some(k=>!Object.hasOwn(value,k))||
    !['universeId','ownerEpoch','consumerId','consumerIncarnation','deviceId'].every(k=>id(value[k]))||
    !uuid(value.operationId)||!uuid(value.guardId)||!positive(value.ackSequence)||!path(value.path)||!positive(value.revision)||
    !digest(value.payloadDigest)||value.purpose!=='activation'||!['issue','rotate'].includes(value.operation))fail('vault_owner_guard_invalid');
  return Object.freeze(value);
}
function sync(result,error){
  if(result&&typeof result.then==='function'){Promise.resolve(result).catch(()=>{});fail(error)}
  return result;
}
/** Unmounted typed owner. Mandatory trust interfaces are not a deployed witness. */
export class GuardedDurableVaultOwner extends DurableVaultOwner {
  guardProtocol='shaper.vault-activation-guard.v1';
  constructor({admitFreshness,resolveConsumer,...options}={}){
    super(options);
    if(typeof admitFreshness!=='function'||typeof resolveConsumer!=='function')fail('vault_owner_guard_configuration_invalid');
    this.freshness=admitFreshness;this.consumer=resolveConsumer;
  }
  trusted(value){
    if(value.universeId!==this.scope)fail('vault_owner_guard_invalid');
    let record;
    try{
      const context=Object.freeze({universeId:this.scope,ownerEpoch:value.ownerEpoch,consumerId:value.consumerId,consumerIncarnation:value.consumerIncarnation});
      try{if(sync(this.freshness(context),'vault_owner_freshness_unavailable')!==true)fail('vault_owner_freshness_unavailable')}catch{fail('vault_owner_freshness_unavailable')}
      record=sync(this.consumer(context),'vault_owner_consumer_unavailable');
      if(!record||record.universeId!==this.scope||record.consumerId!==value.consumerId||record.consumerIncarnation!==value.consumerIncarnation||!id(record.keyId)||!Array.isArray(record.operations)||!record.operations.includes(value.operation))fail('vault_owner_consumer_unavailable');
      const key=createPublicKey(record.publicKey);
      if(key.asymmetricKeyType!=='ed25519')fail('vault_owner_consumer_unavailable');
      return {key,keyId:record.keyId,fingerprint:sha(key.export({type:'spki',format:'der'}))};
    }catch(error){if(/^vault_owner_[a-z_]+$/.test(error?.message||''))throw error;fail('vault_owner_consumer_unavailable')}
  }
  recheck(value,original){const current=this.trusted(value);if(current.keyId!==original.keyId||current.fingerprint!==original.fingerprint)fail('vault_owner_consumer_unavailable')}
  mutationAdmission(ownerEpoch){
    try{
      const context=Object.freeze({universeId:this.scope,ownerEpoch,purpose:'owner-mutation'});
      if(sync(this.freshness(context),'vault_owner_freshness_unavailable')!==true)fail('vault_owner_freshness_unavailable');
    }catch(error){if(/^vault_owner_[a-z_]+$/.test(error?.message||''))throw error;fail('vault_owner_freshness_unavailable')}
  }
  async getPrepared(){fail('vault_owner_guard_required')}
  async withPreparedGuard(){fail('vault_owner_guard_required')}
  receipt(row,acquisition=false){
    const value=JSON.parse(row.binding_json);
    return this.signed({schema:'shaper.vault-guard-receipt.v1',guardId:row.guard_id,bindingDigest:row.binding_digest,
      universeId:this.scope,ownerEpoch:value.ownerEpoch,durableSequence:Number(row.sequence),
      state:acquisition?'HELD':row.state,terminalAcknowledgementDigest:acquisition?null:row.terminal_ack_digest});
  }
  async locked(connection,value){
    const [[epoch]]=await connection.execute('SELECT owner_epoch FROM vault_owner_epochs WHERE scope_id=? FOR UPDATE',[this.scope]);
    if(!epoch||epoch.owner_epoch!==value.ownerEpoch)fail('vault_owner_freshness_unavailable');
    const [[resource]]=await connection.execute('SELECT * FROM vault_owner_resources WHERE scope_id=? AND path_hash=? FOR UPDATE',[this.scope,sha(value.path)]);
    const [[fence]]=await connection.execute('SELECT * FROM vault_owner_resource_fences WHERE scope_id=? AND path_hash=? FOR UPDATE',[this.scope,sha(value.path)]);
    return {resource,fence};
  }
  validateResource(row,value){
    if(!row||row.resource_path!==value.path||row.device_id!==value.deviceId||Number(row.revision)!==value.revision||Number(row.tombstoned)!==0||row.payload_digest!==value.payloadDigest)fail('vault_owner_resource_unavailable');
    let payload;try{payload=decryptSecret(JSON.parse(row.encrypted_payload),this.key)}catch{fail('vault_owner_resource_unavailable')}
    if(!payload||payload.universeId!==this.scope||payload.deviceId!==value.deviceId||payload.revision!==value.revision||sha(JSON.stringify(payload))!==value.payloadDigest)fail('vault_owner_resource_unavailable');
    return payload;
  }
  async acquireGuard(input){
    const value=binding(input),trust=this.trusted(value),bindingDigest=sha(canonical(value));
    await this.transaction(async connection=>{
      const {resource,fence}=await this.locked(connection,value);
      const [[existing]]=await connection.execute('SELECT * FROM vault_owner_guards WHERE scope_id=? AND guard_id=? FOR UPDATE',[this.scope,value.guardId]);
      if(existing){if(existing.binding_digest!==bindingDigest||existing.binding_json!==canonical(value))fail('vault_owner_guard_conflict');this.recheck(value,trust);return}
      if(fence?.held_guard_id||Number(fence?.deny_new))fail('vault_owner_guard_unavailable');
      this.validateResource(resource,value);
      const [[prepared]]=await connection.execute('SELECT receipt_json FROM vault_owner_operations WHERE scope_id=? AND operation_id=? FOR UPDATE',[this.scope,value.operationId]);
      if(!prepared)fail('vault_owner_guard_invalid');
      const receipt=this.checked(JSON.parse(prepared.receipt_json));
      if(receipt.action!=='prepare'||receipt.path!==value.path||receipt.deviceId!==value.deviceId||receipt.revision!==value.revision||receipt.payloadDigest!==value.payloadDigest||receipt.ownerEpoch!==value.ownerEpoch)fail('vault_owner_guard_invalid');
      const [[sequence]]=await connection.execute('SELECT guard_id FROM vault_owner_guards WHERE scope_id=? AND ((consumer_id=? AND consumer_incarnation=? AND ack_sequence=?) OR operation_id=?) FOR UPDATE',[this.scope,value.consumerId,value.consumerIncarnation,value.ackSequence,value.operationId]);
      if(sequence)fail('vault_owner_guard_conflict');
      await connection.execute('INSERT IGNORE INTO vault_owner_resource_fences (scope_id,path_hash) VALUES (?,?)',[this.scope,sha(value.path)]);
      const [inserted]=await connection.execute('INSERT INTO vault_owner_guards (scope_id,guard_id,operation_id,consumer_id,consumer_incarnation,ack_sequence,path_hash,binding_digest,binding_json,state) VALUES (?,?,?,?,?,?,?,?,?,?)',[this.scope,value.guardId,value.operationId,value.consumerId,value.consumerIncarnation,value.ackSequence,sha(value.path),bindingDigest,canonical(value),'HELD']);
      if(!positive(Number(inserted.insertId)))fail('vault_owner_sequence_exhausted');
      await connection.execute('UPDATE vault_owner_resource_fences SET managed=1,held_guard_id=? WHERE scope_id=? AND path_hash=?',[value.guardId,this.scope,sha(value.path)]);
      this.recheck(value,trust);
    });
    // Independent durable checkout, locked with the same mutation fence.
    return this.transaction(async connection=>{
      const {resource,fence}=await this.locked(connection,value);
      const [[row]]=await connection.execute('SELECT * FROM vault_owner_guards WHERE scope_id=? AND guard_id=? FOR UPDATE',[this.scope,value.guardId]);
      if(!row||row.binding_digest!==bindingDigest)fail('vault_owner_readback_unavailable');
      this.recheck(value,trust);
      const result={bindingDigest,receipt:this.receipt(row)};
      if(row.state==='HELD'){
        if(fence?.held_guard_id!==value.guardId||Number(fence?.deny_new))fail('vault_owner_guard_unavailable');
        result.payload=this.validateResource(resource,value);
      }else if(!terminal.includes(row.state))fail('vault_owner_guard_conflict');
      return result;
    });
  }
  inspection(input){
    if(!input||!uuid(input.guardId)||!digest(input.bindingDigest)||!id(input.consumerId)||!id(input.consumerIncarnation)||!id(input.ownerEpoch))fail('vault_owner_guard_invalid');
    return Object.freeze({guardId:input.guardId,bindingDigest:input.bindingDigest,consumerId:input.consumerId,consumerIncarnation:input.consumerIncarnation,ownerEpoch:input.ownerEpoch});
  }
  async readBinding(input){
    const selected=this.inspection(input);let connection;
    try{
      connection=await this.pool.getConnection();
      const [[row]]=await connection.execute('SELECT * FROM vault_owner_guards WHERE scope_id=? AND guard_id=?',[this.scope,selected.guardId]);
      if(!row)fail('vault_owner_guard_unavailable');
      const value=binding(JSON.parse(row.binding_json));
      if(row.binding_digest!==selected.bindingDigest||sha(canonical(value))!==row.binding_digest||value.consumerId!==selected.consumerId||value.consumerIncarnation!==selected.consumerIncarnation||value.ownerEpoch!==selected.ownerEpoch)fail('vault_owner_guard_conflict');
      return value;
    }catch(error){if(/^vault_owner_[a-z_]+$/.test(error?.message||''))throw error;fail('vault_owner_store_unavailable')}
    finally{connection?.release()}
  }
  async inspectGuard(input){
    const value=await this.readBinding(input),trust=this.trusted(value);
    return this.transaction(async connection=>{
      await this.locked(connection,value);
      const [[row]]=await connection.execute('SELECT * FROM vault_owner_guards WHERE scope_id=? AND guard_id=? FOR UPDATE',[this.scope,value.guardId]);
      if(!row||row.binding_digest!==sha(canonical(value)))fail('vault_owner_guard_conflict');
      this.recheck(value,trust);return {receipt:this.receipt(row),acquisitionReceipt:this.receipt(row,true)};
    });
  }
  async settleGuard(input){
    // Snapshot the complete caller envelope before any await; reject extra fields.
    let ack;try{ack=JSON.parse(JSON.stringify(input?.peerAcknowledgement))}catch{fail('vault_owner_acknowledgement_invalid')}
    const value=await this.readBinding(input),trust=this.trusted(value);
    const expected={schema:'shaper.peer-guard-acknowledgement.v1',consumerId:value.consumerId,consumerIncarnation:value.consumerIncarnation,ownerEpoch:value.ownerEpoch,operationId:value.operationId,guardId:value.guardId,bindingDigest:sha(canonical(value)),decision:ack?.decision,ackSequence:value.ackSequence,keyId:trust.keyId};
    if(!['COMMITTED','ABORTED'].includes(ack?.decision)||typeof ack.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(ack.signature)||Object.keys(ack).length!==Object.keys(expected).length+1)fail('vault_owner_acknowledgement_invalid');
    if(Buffer.from(ack.signature,'base64').toString('base64')!==ack.signature)fail('vault_owner_acknowledgement_invalid');
    const {signature,...body}=ack;
    if(canonical(body)!==canonical(expected)||!verify(null,Buffer.from(canonical(body)),trust.key,Buffer.from(signature,'base64')))fail('vault_owner_acknowledgement_invalid');
    const ackJson=canonical(ack),ackDigest=sha(ackJson);
    await this.transaction(async connection=>{
      const {fence}=await this.locked(connection,value);
      const [[row]]=await connection.execute('SELECT * FROM vault_owner_guards WHERE scope_id=? AND guard_id=? FOR UPDATE',[this.scope,value.guardId]);
      if(!row||row.binding_digest!==expected.bindingDigest)fail('vault_owner_guard_conflict');
      if(terminal.includes(row.state)){
        if(row.terminal_ack_digest!==ackDigest||row.terminal_ack_json!==ackJson)fail('vault_owner_guard_conflict');
        this.recheck(value,trust);return;
      }
      if(row.state!=='HELD'||fence?.held_guard_id!==value.guardId)fail('vault_owner_guard_conflict');
      await connection.execute('UPDATE vault_owner_guards SET state=?,terminal_ack_json=?,terminal_ack_digest=? WHERE scope_id=? AND guard_id=?',['RELEASED_'+ack.decision,ackJson,ackDigest,this.scope,value.guardId]);
      await connection.execute('UPDATE vault_owner_resource_fences SET held_guard_id=NULL WHERE scope_id=? AND path_hash=?',[this.scope,sha(value.path)]);
      this.recheck(value,trust);
    });
    return this.inspectGuard(input);
  }
}
