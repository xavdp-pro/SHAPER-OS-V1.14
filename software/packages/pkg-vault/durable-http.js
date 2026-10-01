// Intent: software/packages/pkg-vault/INTENT.md#durable-conditional-owner
import http from 'node:http';
import {timingSafeEqual} from 'node:crypto';

const methods=new Set(['prepareImmutable','tombstoneImmutable','findReceipt','verifyReceipt','getPrepared']);
const limit=131072;
const code=error=>/^vault_owner_[a-z_]+$/.test(error?.message||'')?error.message:'vault_owner_unavailable';
const validToken=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const send=(response,status,data)=>{
  let body=JSON.stringify(data);
  if(Buffer.byteLength(body,'utf8')>limit){status=503;body=JSON.stringify({error:'vault_owner_response_invalid'})}
  response.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  response.end(body);
};

/** Explicit scoped owner surface; no legacy file routes or anonymous mode. */
export function createDurableVaultServer({owner,token,host='127.0.0.1',port=0}={}){
  if(!owner||owner.protocol!=='shaper.durable-conditional-vault.v1'||!validToken(token)||host!=='127.0.0.1')
    throw new Error('vault_owner_http_configuration_invalid');
  const expected=Buffer.from(token);
  const server=http.createServer(async(request,response)=>{
    if(request.url==='/api/health'&&request.method==='GET')return send(response,200,{service:'brick-vault',protocol:owner.protocol});
    const authorization=request.headers.authorization;
    const supplied=typeof authorization==='string'&&/^Bearer [a-f0-9]{64}$/.test(authorization)?Buffer.from(authorization.slice(7)):Buffer.alloc(0);
    if(supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return send(response,401,{error:'vault_owner_unauthorized'});
    const method=request.url?.startsWith('/api/durable-owner/')?request.url.slice('/api/durable-owner/'.length):null;
    if(request.method!=='POST'||!methods.has(method))return send(response,404,{error:'vault_owner_route_unavailable'});
    let size=0;const chunks=[];
    try{
      for await(const chunk of request){size+=chunk.length;if(size>limit){send(response,413,{error:'vault_owner_request_too_large'});request.destroy();return}chunks.push(chunk)}
      let input;
      try{input=JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return send(response,400,{error:'vault_owner_request_invalid'})}
      if(!input||typeof input!=='object'||Array.isArray(input))return send(response,400,{error:'vault_owner_request_invalid'});
      const result=await owner[method](input);
      send(response,200,{protocol:owner.protocol,result});
    }catch(error){
      const reason=code(error);
      const status=reason.includes('conflict')?409:reason.includes('invalid')?422:503;
      if(!response.headersSent)send(response,status,{error:reason});
    }
  });
  server.requestTimeout=10000;server.headersTimeout=5000;server.keepAliveTimeout=1000;
  server.listen(port,host);return server;
}

/** Transport adapter retains the full authenticated receipt across JSON. */
export class DurableVaultClient {
  protocol='shaper.durable-conditional-vault.v1';
  constructor({url,token,timeoutMs=10000}={}){
    let parsed;try{parsed=new URL(url)}catch{throw new Error('vault_owner_http_configuration_invalid')}
    if(!validToken(token)||parsed.username||parsed.password||parsed.search||parsed.hash||parsed.pathname!=='/'||
      !(parsed.protocol==='https:'||(parsed.protocol==='http:'&&parsed.hostname==='127.0.0.1'))||
      !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>120000)throw new Error('vault_owner_http_configuration_invalid');
    this.url=parsed.origin;this.token=token;this.timeout=timeoutMs;
  }
  async request(method,input){
    let result;
    try{
      const response=await fetch(`${this.url}/api/durable-owner/${method}`,{method:'POST',redirect:'error',
        headers:{Authorization:`Bearer ${this.token}`,'Content-Type':'application/json'},body:JSON.stringify(input),signal:AbortSignal.timeout(this.timeout)});
      // Bound streamed responses, including secret-bearing getPrepared payloads.
      const reader=response.body.getReader();let size=0;const chunks=[];
      for(;;){const part=await reader.read();if(part.done)break;size+=part.value.length;if(size>limit){await reader.cancel();throw new Error('vault_owner_response_invalid')}chunks.push(Buffer.from(part.value))}
      result=JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if(!response.ok)throw new Error(code({message:result.error}));
      if(result.protocol!==this.protocol||!Object.hasOwn(result,'result'))throw new Error('vault_owner_response_invalid');
    }catch(error){throw new Error(code(error))}
    return result.result;
  }
  prepareImmutable(input){return this.request('prepareImmutable',input)}
  tombstoneImmutable(input){return this.request('tombstoneImmutable',input)}
  findReceipt(input){return this.request('findReceipt',input)}
  verifyReceipt(input){return this.request('verifyReceipt',input)}
  getPrepared(input){return this.request('getPrepared',input)}
}
