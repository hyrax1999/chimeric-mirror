import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Registry} from '../src/registry';
import {startBridge,clearBridgeReplay} from '../src/bridge';
import {Database} from 'bun:sqlite';
const schema={type:'object',properties:{n:{type:'number'}},required:['n']};
const tool={name:'calculate',description:'Compute',input_schema:schema};
const native=(extra:any={})=>({model:'mock::fixture',max_tokens:128,messages:[{role:'user',content:'hello'}],...extra});
function chat(events:any[],delay=0){const enc=new TextEncoder();return new Response(new ReadableStream({async start(c){for(const e of events){c.enqueue(enc.encode('data: '+JSON.stringify({id:'chat_fixture',object:'chat.completion.chunk',created:1,model:'fixture',...e})+'\n\n'));if(delay)await Bun.sleep(delay)}c.enqueue(enc.encode('data: [DONE]\n\n'));c.close();}}),{headers:{'content-type':'text/event-stream'}})}
const textEvents=[{choices:[{index:0,delta:{role:'assistant',content:'hello'},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:7,completion_tokens:2,total_tokens:9}}];
async function fixture(api:string,handler:(r:Request)=>Promise<Response>|Response,images=true,executor?:any){
 const mock=Bun.serve({hostname:'127.0.0.1',port:0,fetch:handler});const dir=mkdtempSync(join(tmpdir(),'science-protocol-'));
 const registry=new Registry({envFile:'/missing',credentialRefsFile:'/missing',providers:{mock:{name:'Mock',baseUrl:mock.url.href+'v1',keyEnv:'SCIENCE_TEST_KEY',api,models:[{id:'fixture'}],modelOverrides:images?{fixture:{input:['text','image'],verified:true}}:{}}},defaultModel:'mock::fixture'},dir);
 await registry.refresh(); const bridge=startBridge(registry,'fixture-token',0,executor);
 return {bridge,dir,call:(body:any)=>fetch(bridge.url.href+'v1/messages',{method:'POST',headers:{'x-api-key':'fixture-token','content-type':'application/json'},body:JSON.stringify(body)}),close(){bridge.stop(true);mock.stop(true);rmSync(dir,{recursive:true,force:true})}};
}
process.env.SCIENCE_TEST_KEY='mock-test-key';
test('Chat stream reaches native consumer before upstream completion',async()=>{
 let completed=false;
 const f=await fixture('openai-completions',async r=>{const b=await r.json() as any;expect(new URL(r.url).pathname).toBe('/v1/chat/completions');expect(b.model).toBe('fixture');setTimeout(()=>completed=true,650);return chat(textEvents,400)});
 try {const response=await f.call(native({stream:true}));expect(response.status).toBe(200);const rd=response.body!.getReader();let text='';while(!text.includes('"text":"hello"')){const n=await rd.read();if(n.done)break;text+=new TextDecoder().decode(n.value)}expect(completed).toBe(false);expect(text).toContain('text_delta');await rd.cancel();}finally{f.close()}
});
test('Parallel native tool calls remain grouped with multimodal results and valid stop reasons',async()=>{
 let request:any;
 const f=await fixture('openai-completions',async r=>{request=await r.json();return chat(textEvents)});
 try {const response=await f.call(native({tools:[tool],messages:[{role:'user',content:'calculate'},{role:'assistant',content:[{type:'tool_use',id:'a',name:'calculate',input:{n:1}},{type:'tool_use',id:'b',name:'calculate',input:{n:2}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'a',content:[{type:'text',text:'one'},{type:'image',source:{type:'base64',media_type:'image/png',data:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='}}]},{type:'tool_result',tool_use_id:'b',content:'two'}]}]}));const b=await response.json() as any;expect(response.status).toBe(200);expect(b.stop_reason).toBe('end_turn');expect(b.usage.input_tokens).toBe(7);const assistant=request.messages.find((m:any)=>m.tool_calls);expect(assistant.tool_calls).toHaveLength(2);expect(request.messages.filter((m:any)=>m.role==='tool')).toHaveLength(2);expect(JSON.stringify(request.messages)).toContain('data:image/png;base64');}finally{f.close()}
});
test('Responses uses flat function schema and flat forced tool choice',async()=>{
 let request:any;
 const f=await fixture('openai-responses',async r=>{request=await r.json();expect(new URL(r.url).pathname).toBe('/v1/responses');
 const response={id:'resp_fixture',object:'response',created_at:1,status:'completed',model:'fixture',output:[],usage:{input_tokens:5,output_tokens:1,total_tokens:6,input_tokens_details:{cached_tokens:0},output_tokens_details:{reasoning_tokens:0}}};
 const events=[{type:'response.created',response:{...response,status:'in_progress'}},{type:'response.output_item.added',output_index:0,item:{id:'fc_fixture',type:'function_call',call_id:'call_fixture',name:'calculate',arguments:''}},{type:'response.function_call_arguments.delta',output_index:0,item_id:'fc_fixture',delta:'{"n":2}'},{type:'response.output_item.done',output_index:0,item:{id:'fc_fixture',type:'function_call',call_id:'call_fixture',name:'calculate',arguments:'{"n":2}'}},{type:'response.completed',response:{...response,output:[{id:'fc_fixture',type:'function_call',call_id:'call_fixture',name:'calculate',arguments:'{"n":2}'}]}}];
 return new Response(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}})});
 try{const r=await f.call(native({tools:[tool],tool_choice:{type:'tool',name:'calculate'}}));const b=await r.json() as any;expect(request.tools[0]).toMatchObject({type:'function',name:'calculate',parameters:schema});expect(request.tools[0].function).toBeUndefined();expect(request.tool_choice).toEqual({type:'function',name:'calculate'});expect(r.status).toBe(200);expect(b.stop_reason).toBe('tool_use');expect(b.content.find((x:any)=>x.type==='tool_use').input).toEqual({n:2});}finally{f.close()}
});
test('Malformed arguments fail explicitly instead of invoking empty tools',async()=>{
 const f=await fixture('openai-completions',()=>chat([{choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_a',type:'function',function:{name:'calculate',arguments:'{"n":'}}]},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'tool_calls'}]}]));
 try{const r=await f.call(native({tools:[tool]}));const b=await r.json() as any;expect(r.status).toBe(400);expect(b.error.message).toContain('malformed');}finally{f.close()}
});
test('Unknown image capability and unmatched tool results fail before inference',async()=>{
 let calls=0;const f=await fixture('openai-completions',()=>{calls++;return chat(textEvents)},false);
 try{let r=await f.call(native({messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/png',data:'AA=='}}]}]}));expect(r.status).toBe(400);r=await f.call(native({messages:[{role:'user',content:[{type:'tool_result',tool_use_id:'missing',content:'x'}]}]}));expect(r.status).toBe(400);expect(calls).toBe(0)}finally{f.close()}
});

test('Cancelling a native stream aborts an idle upstream request',async()=>{
 let aborted=false;let controller:any;
 const f=await fixture('openai-completions',r=>{
  r.signal.addEventListener('abort',()=>{aborted=true;try{controller.close()}catch{}},{once:true});
  return new Response(new ReadableStream({start(c){controller=c;c.enqueue(new TextEncoder().encode('data: '+JSON.stringify({id:'idle',object:'chat.completion.chunk',model:'fixture',choices:[{index:0,delta:{role:'assistant',content:'initial'},finish_reason:null}]})+'\n\n'))}}),{headers:{'content-type':'text/event-stream'}})
 });
 try{const r=await f.call(native({stream:true}));const rd=r.body!.getReader();let s='';while(!s.includes('initial')){const n=await rd.read();if(n.done)break;s+=new TextDecoder().decode(n.value)}await rd.cancel();for(let n=0;n<30&&!aborted;n++)await Bun.sleep(20);expect(aborted).toBe(true)}finally{f.close()}
});

test('Catalog refresh removes retired models instead of keeping stale selectable IDs',async()=>{
 let data=[{id:'fixture'},{id:'retired'}];
 const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return Response.json({data})}});
 const dir=mkdtempSync(join(tmpdir(),'science-catalog-'));
 try{const r=new Registry({envFile:'/missing',credentialRefsFile:'/missing',providers:{mock:{name:'Mock',baseUrl:upstream.url.href+'v1',keyEnv:'SCIENCE_TEST_KEY'}},defaultModel:'mock::fixture'},dir);await r.refresh();expect(r.resolve('mock::retired').id).toBe('retired');data=[{id:'fixture'}];await r.refresh();expect(()=>r.resolve('mock::retired')).toThrow('unknown');expect(r.models.size).toBe(1)}finally{upstream.stop(true);rmSync(dir,{recursive:true,force:true})}
});

test('Stored catalog keeps the local workspace usable while provider catalog is unavailable',async()=>{
 let broken=false;const upstream=Bun.serve({hostname:'127.0.0.1',port:0,fetch(){return broken?new Response('unavailable',{status:503}):Response.json({data:[{id:'fixture'}]})}});
 const dir=mkdtempSync(join(tmpdir(),'science-offline-'));const config={envFile:'/missing',credentialRefsFile:'/missing',providers:{mock:{name:'Mock',baseUrl:upstream.url.href+'v1',keyEnv:'SCIENCE_TEST_KEY'}},defaultModel:'mock::fixture'};
 try{const first=new Registry(config,dir);await first.refresh();broken=true;const next=new Registry(config,dir);await next.refresh();expect(next.resolve('mock::fixture').id).toBe('fixture');expect(next.statuses.mock.ready).toBe(false);expect(next.statuses.mock.error).toContain('503')}finally{upstream.stop(true);rmSync(dir,{recursive:true,force:true})}
});

test('Forced local server tool executes once then continues with normal tool selection',async()=>{
 let turns=0;
 const f=await fixture('openai-completions',async r=>{
  const request=await r.json() as any;turns++;
  if(turns===1){expect(request.tool_choice).toEqual({type:'function',function:{name:'web_search'}});return chat([{choices:[{index:0,delta:{role:'assistant',tool_calls:[{index:0,id:'call_search',type:'function',function:{name:'web_search',arguments:'{"query":"PubMed"}'}}]},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'tool_calls'}]}]);}
  expect(request.tool_choice).toBe('auto');expect(JSON.stringify(request.messages)).toContain('https://pubmed.ncbi.nlm.nih.gov/');return chat(textEvents);
 },true,async()=>({query:'PubMed',results:[{title:'PubMed',url:'https://pubmed.ncbi.nlm.nih.gov/',snippet:'Official biomedical literature database'}]}));
 try{const r=await f.call(native({tools:[{type:'web_search_20250305',name:'web_search'}],tool_choice:{type:'tool',name:'web_search'}}));const b=await r.json() as any;expect(r.status).toBe(200);expect(turns).toBe(2);expect(b.content.map((c:any)=>c.type)).toEqual(['server_tool_use','web_search_tool_result','text']);expect(b.content[1].content[0].url).toBe('https://pubmed.ncbi.nlm.nih.gov/');expect(b.stop_reason).toBe('end_turn')}finally{f.close()}
});

test('Native first-text consumers retain the complete answer after a server search',async()=>{
 const {normalizeNativeMessage}=await import('../src/protocol');
 const message={content:[{type:'text',text:'I will search.'},{type:'server_tool_use',id:'s',name:'web_search',input:{query:'PubMed'}},{type:'web_search_tool_result',tool_use_id:'s',content:[]},{type:'text',text:'The official URL is https://pubmed.ncbi.nlm.nih.gov/.'}]};
 const result=normalizeNativeMessage(message);
 expect(result.content.find((b:any)=>b.type==='text').text).toBe('I will search.\nThe official URL is https://pubmed.ncbi.nlm.nih.gov/.');
 expect(result.content.filter((b:any)=>b.type==='text')).toHaveLength(1);
 expect(result.content[0].type).toBe('server_tool_use');
 expect(message.content).toHaveLength(4);
});

test('Temporary replay data can be erased without deleting native application data',async()=>{
 const f=await fixture('openai-completions',()=>chat(textEvents));
 try{await(await f.call(native())).json();const db=new Database(join(f.dir,'provider/replay.db'));expect((db.query('SELECT count(*) AS n FROM replay').get() as any).n).toBe(1);clearBridgeReplay(f.bridge);expect((db.query('SELECT count(*) AS n FROM replay').get() as any).n).toBe(0);db.close()}finally{f.close()}
});
