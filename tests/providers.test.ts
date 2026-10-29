import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync,readFileSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Registry,defaultConfiguration} from '../src/registry';
import {ProviderManager} from '../src/provider-manager';
import {startBridge} from '../src/bridge';

function workspace(){
  const dir=mkdtempSync(join(tmpdir(),'chimeric-providers-'));
  const registry=new Registry({providers:{},defaultModel:'unconfigured',envFile:'/missing',credentialRefsFile:'/missing',modelMetadataFile:'/missing'},dir);
  return {dir,registry,manager:new ProviderManager(registry),close(){rmSync(dir,{recursive:true,force:true})}};
}
const spec=(revision:number,baseUrl:string,extra:any={})=>({expectedRevision:revision,name:'Test provider',baseUrl,api:'openai-completions',mode:'manual',models:[{id:'fixture'}],...extra});
function completion(text:string){
  const payload={id:'chat_test',object:'chat.completion.chunk',created:1,model:'fixture',choices:[{index:0,delta:{role:'assistant',content:text},finish_reason:null}]};
  const done={...payload,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:1,completion_tokens:1,total_tokens:2}};
  return new Response('data: '+JSON.stringify(payload)+'\n\ndata: '+JSON.stringify(done)+'\n\ndata: [DONE]\n\n',{headers:{'content-type':'text/event-stream'}});
}

test('Fresh release configuration contains no personal providers, files or voice installation',()=>{
  expect(Object.keys(defaultConfiguration.providers)).toEqual(['openai-codex']);
  expect(defaultConfiguration.envFile).toBeUndefined();expect(defaultConfiguration.credentialRefsFile).toBeUndefined();
  expect(defaultConfiguration.modelMetadataFile).toBeUndefined();expect(defaultConfiguration.voice.python).toBe('');
  expect(JSON.stringify(defaultConfiguration)).not.toContain('r-ccs');expect(JSON.stringify(defaultConfiguration)).not.toContain('/Users/');
});

test('A newly registered custom-prefix model runs through the existing bridge and stores no plaintext key',async()=>{
  const seen:any[]=[];
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){seen.push({path:new URL(request.url).pathname,key:request.headers.get('authorization'),body:await request.json()});return completion('READY')}});
  const f=workspace();const bridge=startBridge(f.registry,'local-test');
  try{
    const port=bridge.port;const saved=await f.manager.upsert(spec(0,upstream.url.href+'custom/prefix',{apiKey:'provider-secret-one'}));
    const id=saved.connections[0].id;const model=id+'::fixture';
    const response=await fetch(bridge.url.href+'v1/messages',{method:'POST',headers:{'x-api-key':'local-test','content-type':'application/json'},body:JSON.stringify({model,max_tokens:64,messages:[{role:'user',content:'hello'}]})});
    expect(response.status).toBe(200);expect((await response.json() as any).content[0].text).toBe('READY');
    expect(seen[0].path).toBe('/custom/prefix/chat/completions');expect(seen[0].key).toBe('Bearer provider-secret-one');
    expect(bridge.port).toBe(port);expect(f.registry.models.has(model)).toBe(true);
    const config=readFileSync(join(f.dir,'provider-config.json'),'utf8');const vault=readFileSync(join(f.dir,'local-auth/providers.enc.json'),'utf8');
    expect(config).not.toContain('provider-secret-one');expect(vault).not.toContain('provider-secret-one');
    expect(JSON.stringify(saved)).not.toContain('provider-secret-one');expect(saved.connections[0].hasCredential).toBe(true);
    expect(statSync(join(f.dir,'local-auth/providers.key')).mode&0o777).toBe(0o600);
    const restored=Registry.fromFile(undefined,f.dir);await restored.refresh();
    expect(restored.apiKey(restored.resolve(model))).toBe('provider-secret-one');
  }finally{bridge.stop(true);upstream.stop(true);f.close()}
});

test('An in-flight stream keeps its original URL and key while later requests use the committed connection',async()=>{
  let release!:()=>void,arrived!:()=>void;
  const hold=new Promise<void>(resolve=>release=resolve),seen=new Promise<void>(resolve=>arrived=resolve);
  const headers:string[]=[];
  const first=Bun.serve({hostname:'127.0.0.1',port:0,async fetch(request){headers.push(request.headers.get('authorization')!);arrived();await hold;return completion('OLD')}});
  const second=Bun.serve({hostname:'127.0.0.1',port:0,fetch(request){headers.push(request.headers.get('authorization')!);return completion('NEW')}});
  const f=workspace();const bridge=startBridge(f.registry,'local-test');
  const call=(model:string)=>fetch(bridge.url.href+'v1/messages',{method:'POST',headers:{'x-api-key':'local-test','content-type':'application/json'},body:JSON.stringify({model,max_tokens:64,messages:[{role:'user',content:'hello'}]})});
  try{
    const saved=await f.manager.upsert(spec(0,first.url.href+'v1',{apiKey:'old-key'}));const id=saved.connections[0].id,model=id+'::fixture';
    const original=f.registry.resolve(model);f.registry.select(model);
    const pending=call(model);await seen;
    await f.manager.upsert(spec(1,second.url.href+'api',{id,apiKey:'new-key'}));
    expect(f.registry.resolve(model).replayKey).not.toBe(original.replayKey);
    expect(f.registry.apiKey(original)).toBe('old-key');release();
    expect((await (await pending).json() as any).content[0].text).toBe('OLD');
    expect((await (await call(model)).json() as any).content[0].text).toBe('NEW');
    expect(headers).toEqual(['Bearer old-key','Bearer new-key']);
  }finally{release();bridge.stop(true);first.stop(true);second.stop(true);f.close()}
});

test('Failed discovery and an unconfirmed destination change leave the saved connection intact',async()=>{
  let good=true;
  const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return Response.json(good?{data:[{id:'fixture'}]}:{wrong:'shape'})}});
  const f=workspace();
  try{
    const saved=await f.manager.upsert(spec(0,upstream.url.href+'v1',{mode:'discover',apiKey:'working-key'}));const id=saved.connections[0].id;
    const before=readFileSync(join(f.dir,'provider-config.json'),'utf8'),vaultBefore=readFileSync(join(f.dir,'local-auth/providers.enc.json'),'utf8');
    good=false;
    await expect(f.manager.upsert(spec(1,upstream.url.href+'v1',{id,mode:'discover',apiKey:'bad-key'}))).rejects.toThrow('data array');
    await expect(f.manager.upsert(spec(1,upstream.url.href+'different',{id}))).rejects.toThrow('API URL changed');
    expect(f.registry.revision).toBe(1);expect(f.registry.apiKey(f.registry.resolve(id+'::fixture'))).toBe('working-key');
    expect(readFileSync(join(f.dir,'provider-config.json'),'utf8')).toBe(before);expect(readFileSync(join(f.dir,'local-auth/providers.enc.json'),'utf8')).toBe(vaultBefore);
  }finally{upstream.stop(true);f.close()}
});

test('Competing saves cannot overwrite each other and selected models cannot be removed',async()=>{
  const f=workspace();
  try{
    const results=await Promise.allSettled([f.manager.upsert(spec(0,'http://127.0.0.1:1/v1')),f.manager.upsert(spec(0,'http://127.0.0.1:2/v1'))]);
    expect(results.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(results.filter(x=>x.status==='rejected')).toHaveLength(1);
    const saved=f.manager.snapshot();const id=saved.connections[0].id;f.registry.select(id+'::fixture');
    await expect(f.manager.remove({id,expectedRevision:1})).rejects.toThrow('default model');
    expect(f.registry.models.has(id+'::fixture')).toBe(true);expect(f.registry.revision).toBe(1);
  }finally{f.close()}
});
