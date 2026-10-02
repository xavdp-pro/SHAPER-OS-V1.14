// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import {createPublicKey} from 'node:crypto';
import {readPrivateOwnerFile,responseSigningKey} from './durable-runtime.mjs';

if(process.getuid()===0)throw new Error('vault_owner_system_identity_invalid');
const scope=process.env.VAULT_UNIVERSE_ID;
const master=readPrivateOwnerFile('/apps/vault/etc/owner/master-key');
const publicKey=createPublicKey(responseSigningKey(master,scope));
process.stdout.write(publicKey.export({type:'spki',format:'pem'}));
