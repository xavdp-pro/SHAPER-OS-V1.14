// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import fs from 'node:fs';
import {createPublicKey} from 'node:crypto';

const fail=()=>{throw new Error('vault_owner_witness_invalid')};
const identifier=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(value);
const exact=(value,names)=>value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).length===names.length&&names.every(name=>Object.hasOwn(value,name));
const witnessFields=['schema','universeId','ownerEpoch','generation','consumer'];
const consumerFields=['consumerId','consumerIncarnation','keyId','publicKey','operations'];

function readConfined(path,{uid,requireMount,mountInfoPath}){
  let fd;
  try{
    if(typeof path!=='string'||!path.startsWith('/')||path.split('/').slice(1).some(part=>!part||part==='.'||part==='..'))fail();
    if(requireMount){
      const lines=fs.readFileSync(mountInfoPath,'utf8').split('\n');
      if(!lines.some(line=>{
        const left=line.split(' - ')[0]?.split(' ');
        return left?.[4]===path&&left[5]?.split(',').includes('ro');
      }))fail();
    }
    fd=fs.openSync('/',fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
    const parts=path.slice(1).split('/');
    for(let index=0;index<parts.length;index++){
      const parent=fs.fstatSync(fd);
      if(parent.uid!==0&&parent.uid!==uid)fail();
      if((parent.mode&0o022)!==0&&!(parent.uid===0&&(parent.mode&0o1000)!==0))fail();
      const child=fs.openSync(`/proc/self/fd/${fd}/${parts[index]}`,
        fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|(index===parts.length-1?0:fs.constants.O_DIRECTORY));
      fs.closeSync(fd);fd=child;
    }
    const stat=fs.fstatSync(fd);
    if(!stat.isFile()||stat.uid!==uid||(stat.mode&0o777)!==0o444||stat.nlink!==1||stat.size<1||stat.size>8192)fail();
    const bytes=Buffer.alloc(8193),size=fs.readSync(fd,bytes,0,bytes.length,0);
    if(size!==stat.size)fail();
    return bytes.subarray(0,size).toString('utf8');
  }catch{fail()}
  finally{if(fd!==undefined)fs.closeSync(fd)}
}

/** The witness is supplied by the host, outside the Vault's restored volume.
 * It is read at every admission, never copied into SQL or cached in process.
 */
export function readHostWitness(path,{uid=0,requireMount=true,mountInfoPath='/proc/self/mountinfo'}={}){
  let value;
  try{value=JSON.parse(readConfined(path,{uid,requireMount,mountInfoPath}))}catch{fail()}
  if(!exact(value,witnessFields)||value.schema!=='shaper.vault-host-witness.v1'||
    !identifier(value.universeId)||!/^[a-f0-9]{32}$/.test(value.ownerEpoch)||
    !Number.isSafeInteger(value.generation)||value.generation<1||
    !exact(value.consumer,consumerFields)||
    ![value.consumer.consumerId,value.consumer.consumerIncarnation,value.consumer.keyId].every(identifier)||
    typeof value.consumer.publicKey!=='string'||value.consumer.publicKey.length>1024||
    !Array.isArray(value.consumer.operations)||value.consumer.operations.length<1||
    new Set(value.consumer.operations).size!==value.consumer.operations.length||
    value.consumer.operations.some(operation=>!['issue','rotate','read'].includes(operation)))fail();
  try{if(createPublicKey(value.consumer.publicKey).asymmetricKeyType!=='ed25519')fail()}catch{fail()}
  return value;
}

export function createHostWitnessAdmission(path,options){
  const read=()=>readHostWitness(path,options);
  read(); // Startup must fail closed before creating a listener.
  return {
    admitFreshness(context){
      try{const witness=read();return context?.universeId===witness.universeId&&context?.ownerEpoch===witness.ownerEpoch}
      catch{return false}
    },
    resolveConsumer(context){
      try{
        const witness=read(),consumer=witness.consumer;
        if(context?.universeId!==witness.universeId||context?.ownerEpoch!==witness.ownerEpoch||
          context?.consumerId!==consumer.consumerId||context?.consumerIncarnation!==consumer.consumerIncarnation)return null;
        return {universeId:witness.universeId,...consumer};
      }catch{return null}
    }
  };
}
