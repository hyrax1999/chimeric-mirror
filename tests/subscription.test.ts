import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {zstdDecompressSync} from 'node:zlib';
import {createServer} from 'node:net';
import {SubscriptionManager,SubscriptionVault} from '../src/subscription';
import {Registry} from '../src/registry';
import {startBridge} from '../src/bridge';
import {makeCatalog} from '../src/catalog';

const jwt=(suffix='old')=>'header.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:'fixture-account'}})).toString('base64url')+'.'+suffix;
function deferred<T>(){let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};}
function fixture(options:any={},expires=Date.now()+3600_000){
 const dir=mkdtempSync(join(tmpdir(),'science-subscription-')),vault=new SubscriptionVault(join(dir,'auth'));
 vault.write({session:randomUUID(),version:randomUUID(),credential:{type:'oauth',access:jwt(),refresh:'fixture-refresh-secret',expires}});
 const manager=new SubscriptionManager(vault,options);
 return{dir,vault,manager,close(){manager.close();rmSync(dir,{recursive:true,force:true});}};
}
const renewed=()=>Response.json({access_token:jwt('new'),refresh_token:'rotated-refresh-secret',expires_in:3600});
// The real library uses OpenAI's fixed callback port. Preserve an active human
// authorization flow; this test runs when that external resource is available.
const callbackAvailable=await new Promise<boolean>(resolve=>{
 const server=createServer();server.once('error',()=>resolve(false));server.listen(1455,'127.0.0.1',()=>server.close(()=>resolve(true)));
});

test('Subscription vault encrypts credentials and never exposes tokens in status',()=>{
 const f=fixture();try{
  const serialized=readFileSync(f.vault.path,'utf8');expect(serialized).not.toContain('fixture-refresh-secret');expect(serialized).not.toContain(jwt());
  expect(statSync(f.vault.path).mode&0o777).toBe(0o600);expect(new SubscriptionVault(join(f.dir,'auth')).read()?.credential?.access).toBe(jwt());
  expect(JSON.stringify(f.manager.status())).not.toContain('fixture-refresh-secret');expect(f.manager.status().connected).toBe(true);
 }finally{f.close();}
});
test('Concurrent expiry checks share one refresh and persist rotated credentials',async()=>{
 const gate=deferred<void>();let calls=0;
 const f=fixture({fetch:async()=>{calls++;await gate.promise;return renewed();}},0);
 try{const a=f.manager.requestAuth(),b=f.manager.requestAuth();gate.resolve();const auth=await Promise.all([a,b]);expect(calls).toBe(1);expect(auth[0].apiKey).toBe(jwt('new'));expect(auth[1].apiKey).toBe(jwt('new'));expect(f.vault.read()?.credential?.refresh).toBe('rotated-refresh-secret');expect(f.manager.redact(jwt('new')+' fixture-refresh-secret')).toBe('[redacted] [redacted]');}finally{f.close();}
});
test('Disconnect during refresh prevents late credentials from restoring a session',async()=>{
 const gate=deferred<Response>();const f=fixture({fetch:()=>gate.promise},0);
 try{const request=f.manager.requestAuth();f.manager.disconnect();gate.resolve(renewed());await expect(request).rejects.toThrow('connection changed');expect(f.vault.read()?.credential).toBeNull();expect(f.manager.status().connected).toBe(false);}finally{f.close();}
});
test('Disconnect while reading a token response prevents a stale write',async()=>{
 const gate=deferred<any>(),reading=deferred<void>();const f=fixture({fetch:async()=>({ok:true,json(){reading.resolve();return gate.promise;}})},0);
 try{const request=f.manager.requestAuth();await reading.promise;f.manager.disconnect();gate.resolve({access_token:jwt('new'),refresh_token:'new',expires_in:3600});await expect(request).rejects.toThrow('connection changed');expect(f.vault.read()?.credential).toBeNull();}finally{f.close();}
});
test('A rejected access token refreshes once while quota errors stay on the subscription',async()=>{
 let calls=0,refreshes=0,quota=false;const seen:string[]=[];
 const f=fixture({fetch:async(url:any,init:any)=>{
  if(String(url).includes('/oauth/token')){refreshes++;return renewed();}
  calls++;seen.push(new Headers(init.headers).get('authorization')!);
  return new Response(quota?'subscription quota reached':'ok',{status:quota?429:calls===1?401:200});
 }});
 try{const auth=await f.manager.requestAuth();const url='https://chatgpt.com/backend-api/codex/responses';expect((await auth.fetch(url)).status).toBe(200);expect(refreshes).toBe(1);expect(seen).toEqual(['Bearer '+jwt(),'Bearer '+jwt('new')]);quota=true;expect((await auth.fetch(url)).status).toBe(429);expect(refreshes).toBe(1);expect(calls).toBe(3);await expect(auth.fetch('https://example.org/')).rejects.toThrow('only be sent');}finally{f.close();}
});
test('Transient renewal preserves a connection and invalid refresh credentials require reconnect',async()=>{
 let status=503;const f=fixture({fetch:async()=>new Response('not logged or rendered',{status})},0);
 try{await expect(f.manager.requestAuth()).rejects.toThrow('temporarily');expect(f.manager.status().connected).toBe(true);status=401;await expect(f.manager.requestAuth()).rejects.toThrow('Reconnect');expect(f.manager.status().connected).toBe(false);expect(f.manager.status().reauthRequired).toBe(true);}finally{f.close();}
});
test('A late sign-in callback cannot undo disconnect and callback conflicts are explicit',async()=>{
 const gate=deferred<any>();let starts=0;const f=fixture({callbackAvailable:async()=>true,oauth:{login:async()=>{starts++;return gate.promise;}}});
 try{await f.manager.start();f.manager.disconnect();gate.resolve({type:'oauth',access:jwt('late'),refresh:'late',expires:Date.now()+3600_000});await Bun.sleep(0);expect(starts).toBe(1);expect(f.manager.status().connected).toBe(false);const conflict=new SubscriptionManager(f.vault,{callbackAvailable:async()=>false,oauth:{login:async()=>{throw Error('must not run');}}});await expect(conflict.start()).rejects.toThrow('port is busy');conflict.close();}finally{f.close();}
});
test('Human browser sign-in survives the former deadline while device-code expiry still cancels',async()=>{
 const scheduled:{callback:()=>void;ms:number}[]=[];let signal:AbortSignal;
 const originalTimeout=globalThis.setTimeout;
 globalThis.setTimeout=((callback:any,ms:number,...args:any[])=>{
  scheduled.push({callback:()=>callback(...args),ms});return originalTimeout(()=>{},ms);
 }) as typeof setTimeout;
 const f=fixture({callbackAvailable:async()=>true,
  oauth:{login:async(interaction:any)=>{signal=interaction.signal;interaction.notify({type:'auth_url',url:'https://auth.openai.com/oauth/authorize?state=fixture'});return new Promise(()=>{});}},
 });
 try{
  await f.manager.start('browser');
  // Advancing past the former 10-minute deadline must leave browser auth pending.
  for(const timer of scheduled)if(timer.ms<=600_001)timer.callback();
  expect(f.manager.status().login?.phase).toBe('waiting');expect(signal!.aborted).toBe(false);expect(scheduled).toHaveLength(0);expect(f.manager.status().login?.expiresAt).toBeUndefined();
  f.manager.cancel();expect(signal!.aborted).toBe(true);
  await f.manager.start('device_code');expect(scheduled).toHaveLength(1);expect(scheduled[0].ms).toBe(900_000);expect(f.manager.status().login?.expiresAt).toBeGreaterThan(Date.now());
  scheduled[0].callback();expect(signal!.aborted).toBe(true);expect(f.manager.status().login?.phase).toBe('expired');expect(f.manager.status().login?.authorizationUrl).toBeUndefined();
 }finally{f.close();globalThis.setTimeout=originalTimeout;}
});
(callbackAvailable?test:test.skip)('The real OAuth browser flow rejects a wrong state before exchanging its code',async()=>{
 const f=fixture();const originalFetch=globalThis.fetch;let exchanges=0;
 globalThis.fetch=(async(input:any,init:any)=>{
  if(String(input)==='https://auth.openai.com/oauth/token'){
   exchanges++;const body=new URLSearchParams(init.body);expect(body.get('code')).toBe('fixture-code');expect(body.get('code_verifier')!.length).toBeGreaterThan(30);return renewed();
  }
  return originalFetch(input,init);
 }) as typeof fetch;
 try{
  await f.manager.start('browser');
  for(let n=0;n<100&&!f.manager.status().login?.authorizationUrl;n++)await Bun.sleep(5);
  const url=f.manager.status().login?.authorizationUrl;expect(url).toBeDefined();
  const authorization=new URL(url!);expect(authorization.origin).toBe('https://auth.openai.com');expect(authorization.searchParams.get('code_challenge_method')).toBe('S256');
  const callback=new URL('http://127.0.0.1:1455/auth/callback');callback.searchParams.set('code','fixture-code');callback.searchParams.set('state','wrong');
  expect((await originalFetch(callback)).status).toBe(400);expect(exchanges).toBe(0);
  callback.searchParams.set('state',authorization.searchParams.get('state')!);expect((await originalFetch(callback)).status).toBe(200);
  for(let n=0;n<100&&f.manager.status().login?.phase!=='connected';n++)await Bun.sleep(5);
  expect(exchanges).toBe(1);expect(f.manager.status().login?.phase).toBe('connected');expect(f.vault.read()?.credential?.access).toBe(jwt('new'));
 }finally{globalThis.fetch=originalFetch;f.close();}
});

function responseStream(tool:boolean){
 const item=tool?{id:'fc_fixture',type:'function_call',call_id:'call_fixture',name:'calculate',arguments:'{"n":2}'}:{id:'message_fixture',type:'message',role:'assistant',content:[{type:'output_text',text:'TWO',annotations:[]}]};
 const response={id:'resp_fixture',object:'response',created_at:1,status:'completed',model:'gpt-6.1-sol',output:[item],usage:{input_tokens:5,output_tokens:1,total_tokens:6,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}};
 const events=[{type:'response.created',response:{...response,status:'in_progress',output:[]}},{type:'response.output_item.added',output_index:0,item:tool?{...item,arguments:''}:{...item,content:[]}},
  ...(tool?[{type:'response.function_call_arguments.delta',output_index:0,item_id:item.id,delta:'{"n":2}'}]:[{type:'response.content_part.added',output_index:0,content_index:0,item_id:item.id,part:{type:'output_text',text:'',annotations:[]}},{type:'response.output_text.delta',output_index:0,content_index:0,item_id:item.id,delta:'TWO'}]),
  {type:'response.output_item.done',output_index:0,item},{type:'response.completed',response}];
 return new Response(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
}
test('The real Codex driver streams native tool calls and accepts the tool result on the next turn',async()=>{
 const requests:any[]=[];let turn=0;
 const upstream=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(r){const bytes=Buffer.from(await r.arrayBuffer());const text=r.headers.get('content-encoding')==='zstd'?zstdDecompressSync(bytes).toString():bytes.toString();requests.push({headers:r.headers,body:JSON.parse(text)});return responseStream(turn++===0);}});
 const f=fixture({endpoint:upstream.url.href+'v1/codex/responses'});let bridge:any;
 try{
  const registry=new Registry({envFile:'/missing',credentialRefsFile:'/missing',modelMetadataFile:'/missing',providers:{'openai-codex':{name:'ChatGPT',baseUrl:upstream.url.href+'v1',api:'openai-codex-responses',models:[{id:'gpt-6.1-sol'}],modelOverrides:{'gpt-6.1-sol':{reasoning:true}}}},defaultModel:'openai-codex::gpt-6.1-sol'},f.dir);
  registry.subscription=f.manager;await registry.refresh();bridge=startBridge(registry,'local-token');
  const call=async(body:any)=>fetch(bridge.url.href+'v1/messages',{method:'POST',headers:{'x-api-key':'local-token','content-type':'application/json'},body:JSON.stringify({model:'openai-codex::gpt-6.1-sol',max_tokens:128,system:'Science fixture instructions',tools:[{name:'calculate',description:'Compute',input_schema:{type:'object',properties:{n:{type:'number'}},required:['n']}}],output_config:{effort:'high'},...body})});
  const first=await call({tool_choice:{type:'tool',name:'calculate'},messages:[{role:'user',content:'calculate'}]});const result=await first.json() as any;
  expect(first.status).toBe(200);expect(result.stop_reason).toBe('tool_use');const tool=result.content.find((c:any)=>c.type==='tool_use');expect(tool.input).toEqual({n:2});
  expect(requests[0].body).toMatchObject({model:'gpt-6.1-sol',instructions:'Science fixture instructions',store:false,stream:true,reasoning:{effort:'high'},tool_choice:{type:'function',name:'calculate'}});
  expect(requests[0].body.max_output_tokens).toBeUndefined();expect(requests[0].body.tools[0].name).toBe('calculate');expect(requests[0].headers.get('chatgpt-account-id')).toBe('fixture-account');
  const second=await call({stream:true,messages:[{role:'user',content:'calculate'},{role:'assistant',content:result.content},{role:'user',content:[{type:'tool_result',tool_use_id:tool.id,content:'2'}]}]});const stream=await second.text();expect(stream).toContain('"text":"TWO"');expect(stream).toContain('message_stop');expect(requests[1].body.input.some((v:any)=>v.type==='function_call_output'&&v.output==='2')).toBe(true);
  expect(makeCatalog(registry).model_selector.catalog.models[0].disabled).toBe(false);f.manager.disconnect();expect(makeCatalog(registry).model_selector.catalog.models[0].disabled).toBe(true);
 }finally{bridge?.stop(true);upstream.stop(true);f.close();}
});
