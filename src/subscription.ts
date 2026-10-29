import {createCipheriv,createDecipheriv,randomBytes,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {openaiCodexProvider} from '@earendil-works/pi-ai/providers/openai-codex';

type Credential={type:'oauth';access:string;refresh:string;expires:number;[key:string]:unknown};
type RecordData={session:string;version:string;credential:Credential|null;reauthRequired?:boolean};
type OAuth={login:(interaction:any,options?:any)=>Promise<Credential>};
type Login={id:string;method:'browser'|'device_code';phase:string;url?:string;userCode?:string;message?:string;expiresAt?:number;controller:AbortController;timer?:ReturnType<typeof setTimeout>};
const AUTH_ORIGIN='https://auth.openai.com';
const CODEX_URL='https://chatgpt.com/backend-api/codex/responses';
const validCredential=(c:any):c is Credential=>c?.type==='oauth'&&typeof c.access==='string'&&!!c.access&&typeof c.refresh==='string'&&!!c.refresh&&Number.isFinite(c.expires);

export class SubscriptionError extends Error {
 constructor(message:string,readonly terminal=false){super(message);}
}

/** Daemon-owned storage. This directory is inside the native auth sandbox boundary. */
export class SubscriptionVault {
 readonly path:string;private keyPath:string;
 constructor(directory:string){mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);this.path=join(directory,'chatgpt.enc.json');this.keyPath=join(directory,'chatgpt.key');}
 private key(create=false){
  if(!existsSync(this.keyPath)&&create)try{writeFileSync(this.keyPath,randomBytes(32),{mode:0o600,flag:'wx'});}catch(e:any){if(e.code!=='EEXIST')throw e;}
  const key=readFileSync(this.keyPath);if(key.length!==32)throw new Error('Invalid credential key');return key;
 }
 read():RecordData|undefined{
  if(!existsSync(this.path))return;
  try{
   const value=JSON.parse(readFileSync(this.path,'utf8'));
   const d=createDecipheriv('aes-256-gcm',this.key(),Buffer.from(value.iv,'base64'));d.setAuthTag(Buffer.from(value.tag,'base64'));
   const r=JSON.parse(Buffer.concat([d.update(Buffer.from(value.data,'base64')),d.final()]).toString());
   if(typeof r.session!=='string'||typeof r.version!=='string'||(r.credential!==null&&!validCredential(r.credential)))throw new Error('Invalid credential record');
   return r as RecordData;
  }catch{throw new SubscriptionError('ChatGPT credential storage could not be read. Restore the local auth directory or reconnect after repairing it.');}
 }
 write(record:RecordData){
  const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.key(true),iv);
  const data=Buffer.concat([c.update(JSON.stringify(record)),c.final()]);
  const temporary=this.path+'.'+randomUUID()+'.tmp';
  writeFileSync(temporary,JSON.stringify({iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')}),{mode:0o600});
  renameSync(temporary,this.path);
 }
}

async function callbackPortAvailable(){
 const server=createServer();
 return await new Promise<boolean>(resolve=>{
  server.once('error',()=>resolve(false));
  server.listen(1455,'127.0.0.1',()=>server.close(()=>resolve(true)));
 });
}

export class SubscriptionManager {
 private login?:Login;private refreshFlight?:Promise<RecordData>;private refreshController?:AbortController;
 private secrets=new Set<string>();
 constructor(readonly vault:SubscriptionVault,private options:{oauth?:OAuth;fetch?:typeof fetch;callbackAvailable?:()=>Promise<boolean>;endpoint?:string;loginTimeoutMs?:number;onChange?:()=>void}={}){}
 private remember(r?:RecordData){if(r?.credential){this.secrets.add(r.credential.access);this.secrets.add(r.credential.refresh);}return r;}
 redact(message:string){try{this.remember(this.vault.read());}catch{}for(const secret of this.secrets)message=message.split(secret).join('[redacted]');return message;}
 status(){
  const r=this.remember(this.vault.read());
  return {connected:!!r?.credential&&!r.reauthRequired,reauthRequired:r?.reauthRequired??false,
   ...(r?.credential?{expiresAt:r.credential.expires}:{}),
   ...(this.login?{login:{id:this.login.id,method:this.login.method,phase:this.login.phase,authorizationUrl:this.login.url,userCode:this.login.userCode,message:this.login.message,expiresAt:this.login.expiresAt}}:{})};
 }
 async start(method:'browser'|'device_code'='browser'){
  if(!['browser','device_code'].includes(method))throw new SubscriptionError('Choose browser or device-code sign-in.');
  if(method==='browser'&&!await(this.options.callbackAvailable??callbackPortAvailable)())throw new SubscriptionError('The sign-in callback port is busy. Finish the other sign-in, or choose Device code.');
  this.cancel();
  const controller=new AbortController();
  const login:Login={id:randomUUID(),method,phase:'preparing',controller};
  // A browser callback must remain reachable while the human completes sign-in.
  // OpenAI controls the authorization-code lifetime; cancellation closes our listener.
  const timeout=this.options.loginTimeoutMs??(method==='device_code'?900_000:undefined);
  if(timeout!==undefined){
   login.expiresAt=Date.now()+timeout;
   login.timer=setTimeout(()=>{
    if(this.login===login){login.phase='expired';login.message='Sign-in timed out. Start a new connection.';login.url=undefined;login.userCode=undefined;controller.abort();}
   },timeout);
  }
  this.login=login;
  const previousSession=this.vault.read()?.session;
  const oauth=this.options.oauth??openaiCodexProvider().auth!.oauth!;
  void oauth.login({signal:controller.signal,
   prompt:async(p:any)=>{
    if(p.type==='select')return method;
    // Browser authorization completes through the state-checked loopback callback.
    // Raw authorization codes are never accepted by this application's UI.
    if(p.type==='manual_code')return await new Promise<string>((_resolve,reject)=>{
     const abort=()=>reject(new SubscriptionError('Sign-in cancelled.'));
     if(p.signal?.aborted||controller.signal.aborted)return abort();
     p.signal?.addEventListener('abort',abort,{once:true});controller.signal.addEventListener('abort',abort,{once:true});
    });
    throw new SubscriptionError('Unsupported sign-in prompt. Use browser or device-code sign-in.');
   },
   notify:(event:any)=>{
    if(this.login!==login||controller.signal.aborted)return;
    if(event.type==='auth_url'){
     const u=new URL(event.url);if(u.origin!==AUTH_ORIGIN)throw new SubscriptionError('Unexpected authorization destination.');
     login.url=u.href;login.phase='waiting';
    }else if(event.type==='device_code'){
     const u=new URL(event.verificationUri);if(u.origin!==AUTH_ORIGIN)throw new SubscriptionError('Unexpected authorization destination.');
     login.url=u.href;login.userCode=String(event.userCode);login.phase='waiting';
    }
   },
  },{agentName:'Claude Science Local'}).then(credential=>{
   if(this.login!==login||controller.signal.aborted||this.vault.read()?.session!==previousSession)return;
   if(!validCredential(credential))throw new SubscriptionError('OpenAI did not return usable subscription credentials.');
   const record={session:randomUUID(),version:randomUUID(),credential};
   this.remember(record);this.vault.write(record);login.phase='connected';login.url=undefined;login.userCode=undefined;this.options.onChange?.();
  }).catch(()=>{
   if(this.login===login&&!controller.signal.aborted){login.phase='error';login.message='ChatGPT sign-in failed. Retry, or use Device code if the browser callback is unavailable.';login.url=undefined;login.userCode=undefined;}
  }).finally(()=>{if(login.timer!==undefined)clearTimeout(login.timer);});
  return this.status();
 }
 cancel(){
  if(this.login){if(this.login.timer!==undefined)clearTimeout(this.login.timer);this.login.controller.abort();this.login=undefined;}
 }
 disconnect(){
  this.cancel();this.refreshController?.abort();
  this.vault.write({session:randomUUID(),version:randomUUID(),credential:null});this.options.onChange?.();
 }
 close(){this.cancel();this.refreshController?.abort();}
 private async refresh(previous:RecordData):Promise<RecordData>{
  if(this.refreshFlight)return this.refreshFlight;
  const controller=new AbortController();this.refreshController=controller;
  const promise=(async()=>{
   const current=this.remember(this.vault.read());
   if(!current?.credential||current.session!==previous.session)throw new SubscriptionError('The ChatGPT connection changed. Retry with the current connection.');
   if(current.version!==previous.version)return current;
   let response:Response;
   try{response=await(this.options.fetch??fetch)(AUTH_ORIGIN+'/oauth/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams({grant_type:'refresh_token',refresh_token:current.credential.refresh,client_id:'app_EMoamEEZ73f0CkXaXp7hrann'}),
    signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20_000)])});
   }catch{throw new SubscriptionError('ChatGPT token renewal is temporarily unavailable. Retry in a moment.');}
   const latest=this.vault.read();
   if(latest?.session!==current.session)throw new SubscriptionError('The ChatGPT connection changed. Retry with the current connection.');
   if(latest.version!==current.version)return this.remember(latest)!;
   if(!response.ok){
    const terminal=response.status>=400&&response.status<500&&![408,429].includes(response.status);
    await response.body?.cancel();
    const afterCancel=this.vault.read();
    if(afterCancel?.session!==current.session)throw new SubscriptionError('The ChatGPT connection changed. Retry with the current connection.');
    if(afterCancel.version!==current.version)return this.remember(afterCancel)!;
    if(terminal){this.vault.write({...afterCancel,version:randomUUID(),reauthRequired:true});this.options.onChange?.();}
    throw new SubscriptionError(terminal?'ChatGPT sign-in expired. Reconnect in Settings → Connections.':'ChatGPT token renewal is temporarily unavailable. Retry in a moment.',terminal);
   }
   let data:any;try{data=await response.json();}catch{throw new SubscriptionError('OpenAI returned an invalid token renewal response.');}
   if(typeof data.expires_in!=='number'||!Number.isFinite(data.expires_in)||data.expires_in<=0)throw new SubscriptionError('OpenAI returned an invalid token expiry.');
   const credential:Credential={type:'oauth',access:data.access_token,refresh:data.refresh_token,expires:Date.now()+data.expires_in*1000};
   if(!validCredential(credential))throw new SubscriptionError('OpenAI returned an incomplete token renewal response.');
   const beforeWrite=this.vault.read();
   if(beforeWrite?.session!==current.session)throw new SubscriptionError('The ChatGPT connection changed. Retry with the current connection.');
   if(beforeWrite.version!==current.version)return this.remember(beforeWrite)!;
   const record={...beforeWrite,version:randomUUID(),credential,reauthRequired:false};this.remember(record);this.vault.write(record);return record;
  })();
  this.refreshFlight=promise;
  try{return await promise;}finally{if(this.refreshFlight===promise){this.refreshFlight=undefined;this.refreshController=undefined;}}
 }
 async requestAuth(signal?:AbortSignal){
  signal?.throwIfAborted();
  let r=this.remember(this.vault.read());
  if(!r?.credential||r.reauthRequired)throw new SubscriptionError('Connect your ChatGPT subscription in Settings → Connections to use GPT 6.1 Sol.');
  if(r.credential.expires<Date.now()+60_000)r=await this.refresh(r);
  signal?.throwIfAborted();
  const session=r.session;
  const authenticatedFetch:typeof fetch=async(input:any,init?:any)=>{
   const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
   if(url.href!==(this.options.endpoint??CODEX_URL))throw new SubscriptionError('Subscription credentials can only be sent to the configured Codex endpoint.');
   let current=this.remember(this.vault.read());
   if(!current?.credential||current.session!==session||current.reauthRequired)throw new SubscriptionError('The ChatGPT connection changed. Retry with the current connection.');
   const send=(record:RecordData)=>{
    const headers=new Headers(init?.headers);headers.set('authorization','Bearer '+record.credential!.access);
    const parts=record.credential!.access.split('.');
    try{const claims=JSON.parse(Buffer.from(parts[1],'base64url').toString());const account=claims['https://api.openai.com/auth']?.chatgpt_account_id;if(account)headers.set('chatgpt-account-id',account);}catch{}
    return(this.options.fetch??fetch)(input,{...init,headers});
   };
   const response=await send(current);
   if(response.status!==401)return response;
   await response.body?.cancel();current=await this.refresh(current);
   if(current.session!==session||!current.credential)throw new SubscriptionError('The ChatGPT connection changed. Retry with the current connection.');
   return send(current);
  };
  return{apiKey:r.credential!.access,fetch:authenticatedFetch,sessionScope:session};
 }
}
