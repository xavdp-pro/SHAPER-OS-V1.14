// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import {createHash,verify} from 'node:crypto';
import {GuardedDurableVaultOwner} from './durable-guard-owner.js';
const fail=code=>{throw new Error(code)};
const id=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(v);
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(v);
const positive=v=>Number.isSafeInteger(v)&&v>0;
const digest=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sha=v=>createHash('sha256').update(v).digest('hex');
const canonical=v=>JSON.stringify(Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])));
const path=v=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\x00-\x20\x7f?#\\]/.test(v)&&v.split('/').every(p=>p&&p!=='.'&&p!=='..');
const fields=['universeId','ownerEpoch','consumerId','consumerIncarnation','operationId','guardId','ackSequence','path','deviceId','revision','payloadDigest','purpose','operation','activationOperationId','authorityBindingDigest'];
const terminal=['RELEASED_OUTPUT_ENDED','RELEASED_NO_OUTPUT_ENDED'];
function snapshot(input){try{return JSON.parse(JSON.stringify(input))}catch{fail('vault_owner_disclosure_invalid')}}
function binding(input){
  const value=snapshot(input);
  if(!value||Object.keys(value).length!==fields.length||fields.some(k=>!Object.hasOwn(value,k))||
    !['universeId','ownerEpoch','consumerId','consumerIncarnation','deviceId'].every(k=>id(value[k]))||
    !uuid(value.operationId)||!uuid(value.guardId)||!uuid(value.activationOperationId)||value.operationId===value.activationOperationId||
    !positive(value.ackSequence)||!path(value.path)||!positive(value.revision)||!digest(value.payloadDigest)||
    !digest(value.authorityBindingDigest)||value.purpose!=='current-disclosure'||value.operation!=='read')fail('vault_owner_disclosure_invalid');
  return Object.freeze(value);
}
/** Unmounted resource-only disclosure. The consumer owns jurisdiction, local
 * output/source fencing and durable historical closure; there is no TTL release. */
export class CurrentDisclosureVaultOwner extends GuardedDurableVaultOwner {
  disclosureProtocol='shaper.vault-current-disclosure.v1';
  async operationIdentityAdmission(connection,operationId){
    const [[row]]=await connection.execute('SELECT disclosure_id FROM vault_owner_disclosures WHERE scope_id=? AND read_operation_id=? FOR UPDATE',[this.scope,operationId]);
    if(row)fail('vault_owner_operation_conflict');
  }
  async guardIdentityAdmission(connection,value){
    const [[row]]=await connection.execute('SELECT disclosure_id FROM vault_owner_disclosures WHERE scope_id=? AND (disclosure_id=? OR read_operation_id=? OR (consumer_id=? AND consumer_incarnation=? AND ack_sequence=?)) FOR UPDATE',[this.scope,value.guardId,value.operationId,value.consumerId,value.consumerIncarnation,value.ackSequence]);
    if(row)fail('vault_owner_guard_conflict');
  }
  envelope(value,trust,schema){
    return {schema,consumerId:value.consumerId,consumerIncarnation:value.consumerIncarnation,ownerEpoch:value.ownerEpoch,
      operationId:value.operationId,guardId:value.guardId,bindingDigest:sha(canonical(value)),ackSequence:value.ackSequence,keyId:trust.keyId};
  }
  signedPeer(input,expected,trust){
    const envelope=snapshot(input);
    if(!envelope||typeof envelope.signature!=='string'||!/^[A-Za-z0-9+/]{86}==$/.test(envelope.signature)||
      Object.keys(envelope).length!==Object.keys(expected).length+1||Buffer.from(envelope.signature,'base64').toString('base64')!==envelope.signature)
      fail('vault_owner_disclosure_signature_invalid');
    const {signature,...body}=envelope;
    if(canonical(body)!==canonical(expected)||!verify(null,Buffer.from(canonical(body)),trust.key,Buffer.from(signature,'base64')))
      fail('vault_owner_disclosure_signature_invalid');
    return {json:canonical(envelope),digest:sha(canonical(envelope))};
  }
  admission(input,value,trust){return this.signedPeer(input,this.envelope(value,trust,'shaper.peer-disclosure-admission.v1'),trust)}
  disclosureReceipt(row){
    const value=binding(JSON.parse(row.binding_json));
    if(sha(canonical(value))!==row.binding_digest||Number(row.payload_claimed)!==1||
      !positive(Number(row.sequence))||!['HELD',...terminal].includes(row.state))fail('vault_owner_disclosure_conflict');
    return this.signed({schema:'shaper.vault-disclosure-receipt.v1',disclosureId:row.disclosure_id,bindingDigest:row.binding_digest,
      universeId:this.scope,ownerEpoch:value.ownerEpoch,durableSequence:Number(row.sequence),state:row.state,
      payloadClaimed:true,closureDigest:row.closure_digest});
  }
  async beginDisclosure(input){
    const value=binding(input?.binding),trust=this.trusted(value),admission=this.admission(input?.peerAdmission,value,trust);
    const encoded=canonical(value),bindingDigest=sha(encoded);
    const created=await this.transaction(async connection=>{
      const {resource,fence}=await this.locked(connection,value);
      const [[existing]]=await connection.execute('SELECT * FROM vault_owner_disclosures WHERE scope_id=? AND disclosure_id=? FOR UPDATE',[this.scope,value.guardId]);
      if(existing){
        if(existing.binding_json!==encoded||existing.binding_digest!==bindingDigest||existing.admission_json!==admission.json||existing.admission_digest!==admission.digest)fail('vault_owner_disclosure_conflict');
        this.disclosureReceipt(existing);this.recheck(value,trust);return false;
      }
      if(fence?.held_guard_id||Number(fence?.deny_new))fail('vault_owner_guard_unavailable');
      this.validateResource(resource,value);
      const [[prepared]]=await connection.execute('SELECT receipt_json FROM vault_owner_operations WHERE scope_id=? AND operation_id=? FOR UPDATE',[this.scope,value.activationOperationId]);
      if(!prepared)fail('vault_owner_disclosure_invalid');
      const receipt=this.checked(JSON.parse(prepared.receipt_json));
      if(receipt.action!=='prepare'||receipt.path!==value.path||receipt.deviceId!==value.deviceId||receipt.revision!==value.revision||receipt.payloadDigest!==value.payloadDigest||receipt.ownerEpoch!==value.ownerEpoch)fail('vault_owner_disclosure_invalid');
      const [[operation]]=await connection.execute('SELECT operation_id FROM vault_owner_operations WHERE scope_id=? AND operation_id=? FOR UPDATE',[this.scope,value.operationId]);
      const [[pending]]=await connection.execute('SELECT deny_operation_id FROM vault_owner_resource_fences WHERE scope_id=? AND deny_operation_id=? FOR UPDATE',[this.scope,value.operationId]);
      const [[activation]]=await connection.execute('SELECT guard_id FROM vault_owner_guards WHERE scope_id=? AND (guard_id=? OR operation_id=? OR (consumer_id=? AND consumer_incarnation=? AND ack_sequence=?)) FOR UPDATE',[this.scope,value.guardId,value.operationId,value.consumerId,value.consumerIncarnation,value.ackSequence]);
      const [[duplicate]]=await connection.execute('SELECT disclosure_id FROM vault_owner_disclosures WHERE scope_id=? AND (read_operation_id=? OR (consumer_id=? AND consumer_incarnation=? AND ack_sequence=?)) FOR UPDATE',[this.scope,value.operationId,value.consumerId,value.consumerIncarnation,value.ackSequence]);
      if(operation||pending||activation||duplicate)fail('vault_owner_disclosure_conflict');
      await connection.execute('INSERT IGNORE INTO vault_owner_resource_fences (scope_id,path_hash) VALUES (?,?)',[this.scope,sha(value.path)]);
      const [inserted]=await connection.execute('INSERT INTO vault_owner_disclosures (scope_id,disclosure_id,read_operation_id,activation_operation_id,consumer_id,consumer_incarnation,ack_sequence,path_hash,binding_json,binding_digest,admission_json,admission_digest,payload_claimed,state) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,1,?)',[this.scope,value.guardId,value.operationId,value.activationOperationId,value.consumerId,value.consumerIncarnation,value.ackSequence,sha(value.path),encoded,bindingDigest,admission.json,admission.digest,'HELD']);
      if(!positive(Number(inserted.insertId)))fail('vault_owner_sequence_exhausted');
      await connection.execute('UPDATE vault_owner_resource_fences SET managed=1,held_guard_id=? WHERE scope_id=? AND path_hash=?',[value.guardId,this.scope,sha(value.path)]);
      this.recheck(value,trust);return true;
    });
    // One initial invocation only: commit/readback loss consumes the claim.
    const response=await this.transaction(async connection=>{
      const {resource,fence}=await this.locked(connection,value);
      const [[row]]=await connection.execute('SELECT * FROM vault_owner_disclosures WHERE scope_id=? AND disclosure_id=? FOR UPDATE',[this.scope,value.guardId]);
      if(!row||row.binding_digest!==bindingDigest)fail('vault_owner_readback_unavailable');
      this.recheck(value,trust);const result={receipt:this.disclosureReceipt(row)};
      if(created&&row.state==='HELD'){
        if(fence?.held_guard_id!==value.guardId||Number(fence?.deny_new))fail('vault_owner_guard_unavailable');
        result.payload=this.validateResource(resource,value);
      }
      return result;
    });
    // SQL commit is awaited: re-admit freshness before returning any plaintext.
    this.recheck(value,trust);return response;
  }
  selection(input){
    if(!input||!uuid(input.disclosureId)||!digest(input.bindingDigest)||!id(input.consumerId)||!id(input.consumerIncarnation)||!id(input.ownerEpoch))fail('vault_owner_disclosure_invalid');
    return Object.freeze({disclosureId:input.disclosureId,bindingDigest:input.bindingDigest,consumerId:input.consumerId,consumerIncarnation:input.consumerIncarnation,ownerEpoch:input.ownerEpoch});
  }
  async disclosureBinding(input){
    const selected=this.selection(input);let connection;
    try{
      connection=await this.pool.getConnection();
      const [[row]]=await connection.execute('SELECT * FROM vault_owner_disclosures WHERE scope_id=? AND disclosure_id=?',[this.scope,selected.disclosureId]);
      if(!row)fail('vault_owner_disclosure_unavailable');
      const value=binding(JSON.parse(row.binding_json));
      if(row.binding_digest!==selected.bindingDigest||sha(canonical(value))!==row.binding_digest||value.consumerId!==selected.consumerId||value.consumerIncarnation!==selected.consumerIncarnation||value.ownerEpoch!==selected.ownerEpoch)fail('vault_owner_disclosure_conflict');
      return value;
    }catch(error){if(/^vault_owner_[a-z_]+$/.test(error?.message||''))throw error;fail('vault_owner_store_unavailable')}
    finally{connection?.release()}
  }
  async inspectDisclosure(input){
    const peerAdmission=snapshot(input?.peerAdmission),value=await this.disclosureBinding(input),trust=this.trusted(value);
    const admission=this.admission(peerAdmission,value,trust);
    return this.transaction(async connection=>{
      await this.locked(connection,value);
      const [[row]]=await connection.execute('SELECT * FROM vault_owner_disclosures WHERE scope_id=? AND disclosure_id=? FOR UPDATE',[this.scope,value.guardId]);
      if(!row||row.binding_digest!==sha(canonical(value))||row.admission_digest!==admission.digest||row.admission_json!==admission.json)fail('vault_owner_disclosure_conflict');
      this.recheck(value,trust);return {receipt:this.disclosureReceipt(row)};
    });
  }
  async finishDisclosure(input){
    const peerClosure=snapshot(input?.peerClosure),value=await this.disclosureBinding(input),trust=this.trusted(value);
    if(!peerClosure||peerClosure.writerFenced!==true||!['OUTPUT_ENDED','NO_OUTPUT_ENDED'].includes(peerClosure.decision)||
      !['complete','partial','uncertain','none'].includes(peerClosure.outputDisposition)||
      (peerClosure.decision==='NO_OUTPUT_ENDED'?peerClosure.outputDisposition!=='none':peerClosure.outputDisposition==='none'))fail('vault_owner_disclosure_closure_invalid');
    const expected={...this.envelope(value,trust,'shaper.peer-disclosure-closure.v1'),decision:peerClosure.decision,outputDisposition:peerClosure.outputDisposition,writerFenced:true};
    const closure=this.signedPeer(peerClosure,expected,trust);
    await this.transaction(async connection=>{
      const {fence}=await this.locked(connection,value);
      const [[row]]=await connection.execute('SELECT * FROM vault_owner_disclosures WHERE scope_id=? AND disclosure_id=? FOR UPDATE',[this.scope,value.guardId]);
      if(!row||row.binding_digest!==sha(canonical(value)))fail('vault_owner_disclosure_conflict');
      this.disclosureReceipt(row);
      if(terminal.includes(row.state)){
        if(row.closure_json!==closure.json||row.closure_digest!==closure.digest)fail('vault_owner_disclosure_conflict');
        this.recheck(value,trust);return;
      }
      if(row.state!=='HELD'||fence?.held_guard_id!==value.guardId)fail('vault_owner_disclosure_conflict');
      await connection.execute('UPDATE vault_owner_disclosures SET state=?,closure_json=?,closure_digest=? WHERE scope_id=? AND disclosure_id=?',['RELEASED_'+peerClosure.decision,closure.json,closure.digest,this.scope,value.guardId]);
      await connection.execute('UPDATE vault_owner_resource_fences SET held_guard_id=NULL WHERE scope_id=? AND path_hash=?',[this.scope,sha(value.path)]);
      this.recheck(value,trust);
    });
    // Readback authenticates the same historical writer without a current-user check.
    return this.transaction(async connection=>{
      await this.locked(connection,value);
      const [[row]]=await connection.execute('SELECT * FROM vault_owner_disclosures WHERE scope_id=? AND disclosure_id=? FOR UPDATE',[this.scope,value.guardId]);
      if(!row||row.closure_digest!==closure.digest||row.closure_json!==closure.json)fail('vault_owner_readback_unavailable');
      this.recheck(value,trust);return {receipt:this.disclosureReceipt(row)};
    });
  }
}
