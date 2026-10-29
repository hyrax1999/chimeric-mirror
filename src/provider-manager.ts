import {randomUUID} from 'node:crypto';
import {join} from 'node:path';
import {z} from 'zod';
import {Registry,Configuration,Provider,atomicJson} from './registry';

const Model=z.object({id:z.string().trim().min(1).max(512),name:z.string().trim().min(1).max(200).optional(),contextWindow:z.number().int().min(1024).max(16000000).optional(),maxTokens:z.number().int().min(64).max(4000000).optional()});
const Capability=z.object({images:z.boolean(),reasoning:z.boolean(),efforts:z.array(z.enum(['minimal','low','medium','high','xhigh','max'])).min(1).max(6).default(['low','medium','high']),thinkingFormat:z.enum(['openai','qwen-chat-template','deepseek','zai','chat-template']).default('openai')});
const Connection=z.object({
  expectedRevision:z.number().int().nonnegative(),id:z.string().regex(/^[a-z][a-z0-9_-]{0,79}$/).optional(),
  connectionRevision:z.string().optional(),
  name:z.string().trim().min(1).max(120),baseUrl:z.string().trim().url().max(2048),
  api:z.enum(['openai-completions','openai-responses']),apiKey:z.string().max(16384).optional(),
  clearCredential:z.boolean().default(false),confirmDestinationChange:z.boolean().default(false),
  allowInsecureHttp:z.boolean().default(false),mode:z.enum(['discover','manual']).default('discover'),
  models:z.array(Model).max(1024).optional(),capabilities:Capability.optional(),
  requestTimeoutMs:z.number().int().min(1000).max(3_600_000).default(600_000),
});

export class ProviderChangeError extends Error {
  constructor(message:string,readonly status=400){super(message)}
}

/** Serializes configuration commits; streams retain their model/auth snapshots. */
export class ProviderManager {
  private queue:Promise<unknown>=Promise.resolve();
  private listeners=new Set<(revision:string)=>void>();
  cleanupWarning?:string;
  constructor(readonly registry:Registry,private changed:()=>void=()=>{}){}
  private serial<T>(action:()=>Promise<T>):Promise<T>{
    const job=this.queue.then(action);
    this.queue=job.catch(()=>undefined);
    return job;
  }
  private check(expected:number){
    if(expected!==this.registry.revision)throw new ProviderChangeError('Connections changed in another window. Reload the connection list before saving.',409);
  }
  event(){return JSON.stringify({catalogRevision:this.catalogRevision,selectedModel:this.registry.state.model,effort:this.registry.state.effort})}
  publish(){for(const listener of this.listeners)listener(this.event())}
  get catalogRevision(){return 'chimeric-'+this.registry.revision+'-'+this.registry.catalogGeneration}
  subscribe(listener:(revision:string)=>void){this.listeners.add(listener);return()=>this.listeners.delete(listener)}
  notify(){
    this.registry.catalogGeneration=randomUUID();this.changed();
    this.publish();
  }
  snapshot(){
    const r=this.registry;
    return {revision:r.revision,catalogRevision:this.catalogRevision,selectedModel:r.state.model,roles:{...r.config.roles},headlineModels:[...r.config.headlineModels],
      connections:Object.entries(r.config.providers).map(([id,p])=>({
        id,name:p.name,baseUrl:p.baseUrl,api:p.api,enabled:p.enabled,mode:p.models?'manual':'discover',connectionRevision:p.revision,
        allowInsecureHttp:p.allowInsecureHttp,requestTimeoutMs:p.requestTimeoutMs,
        hasCredential:!!r.getPrivateCredential(id),subscription:p.api==='openai-codex-responses',status:r.statuses[id],
        models:[...r.models.values()].filter(m=>m.provider===id).map(m=>({id:m.id,qualifiedId:m.qualifiedId,name:m.name,input:m.input,reasoning:m.reasoning,efforts:m.efforts,mode:m.mode,capabilitiesVerified:m.capabilitiesVerified})),
      })),...(this.cleanupWarning?{warning:this.cleanupWarning}:{}),};
  }
  private credentialsFor(config:Configuration){
    const keys=new Map<string,string>();
    for(const id of Object.keys(config.providers)){
      const key=this.registry.getPrivateCredential(id);if(key)keys.set(id,key);
    }
    return keys;
  }
  private draft(raw:unknown){
    const input=Connection.parse(raw);this.check(input.expectedRevision);
    const id=input.id??'provider_'+randomUUID().replaceAll('-','');
    if(['constructor','prototype','__proto__'].includes(id))throw new ProviderChangeError('Choose a different connection ID.');
    const existing=Object.hasOwn(this.registry.config.providers,id)?this.registry.config.providers[id]:undefined;
    if(input.id&&!existing)throw new ProviderChangeError('Connection no longer exists.',404);
    if(existing&&input.connectionRevision&&input.connectionRevision!==existing.revision)throw new ProviderChangeError('This connection was edited in another window. Cancel editing and reopen it before saving.',409);
    if(existing?.api==='openai-codex-responses')throw new ProviderChangeError('Manage the ChatGPT subscription using its separate sign-in controls.');
    const baseUrl=input.baseUrl.replace(/\/+$/,'');
    const supplied=input.apiKey?.trim()||undefined;
    if(supplied&&/[\r\n\0]/.test(supplied))throw new ProviderChangeError('The API key cannot contain line breaks.');
    if(supplied&&input.clearCredential)throw new ProviderChangeError('Choose either a new key or removing the saved key.');
    const previousKey=existing?this.registry.getPrivateCredential(id):undefined;
    if(existing&&existing.baseUrl!==baseUrl&&previousKey&&!supplied&&!input.clearCredential&&!input.confirmDestinationChange)
      throw new ProviderChangeError('The API URL changed. Enter the key for this URL, or explicitly confirm using the saved key at the new URL.');
    const key=input.clearCredential?undefined:supplied??previousKey;
    const config=structuredClone(this.registry.config);
    const modelOverrides={...existing?.modelOverrides};
    const models=input.models?.map(m=>({...m}));
    for(const model of models??[])if(model.contextWindow||model.maxTokens)modelOverrides[model.id]={...modelOverrides[model.id],...model.contextWindow?{contextWindow:model.contextWindow}:{},...model.maxTokens?{maxTokens:model.maxTokens}:{}};
    if(input.mode==='manual'&&!models?.length)throw new ProviderChangeError('Enter at least one model ID, or choose model discovery.');
    if(models&&new Set(models.map(m=>m.id)).size!==models.length)throw new ProviderChangeError('Model IDs must be unique within a connection.');
    if(input.capabilities){
      if(input.mode!=='manual')throw new ProviderChangeError('Apply shared capabilities after registering manual model IDs.');
      for(const model of models!){
        const c=input.capabilities;
        modelOverrides[model.id]={...modelOverrides[model.id],input:c.images?['text','image']:['text'],reasoning:c.reasoning,verified:false,
          reasoningEfforts:Object.fromEntries(c.efforts.map(e=>[e,e])),compat:{...modelOverrides[model.id]?.compat as any,
            supportsReasoningEffort:c.reasoning,...c.thinkingFormat!=='openai'?{thinkingFormat:c.thinkingFormat}:{}}};
      }
    }
    config.providers[id]=Provider.parse({...existing,name:input.name,baseUrl,api:input.api,revision:randomUUID(),enabled:true,
      allowInsecureHttp:input.allowInsecureHttp,requestTimeoutMs:input.requestTimeoutMs,modelOverrides,
      models:input.mode==='manual'?models:undefined,...input.clearCredential?{secretRef:undefined,keyEnv:''}:{}});
    // New keys stay in this candidate's private closure until validation succeeds.
    const overrides=this.credentialsFor(config);if(key)overrides.set(id,key);else overrides.delete(id);
    const candidate=new Registry(config,this.registry.profileDir,overrides);
    candidate.models=new Map(this.registry.models);candidate.statuses={...this.registry.statuses};candidate.subscription=this.registry.subscription;
    return {id,input,candidate,key,existing,supplied};
  }
  async preview(raw:unknown){
    const {id,candidate}=this.draft(raw);
    await candidate.refresh(false,[id]);
    const status=candidate.statuses[id];
    if(!status?.ready)throw new ProviderChangeError(status?.error??'Model discovery failed.');
    return {models:[...candidate.models.values()].filter(m=>m.provider===id).map(m=>({id:m.id,name:m.name,input:m.input,reasoning:m.reasoning,mode:m.mode})),count:status.models};
  }
  upsert(raw:unknown){return this.serial(async()=>{
    const d=this.draft(raw);await d.candidate.refresh(false,[d.id]);
    const status=d.candidate.statuses[d.id];
    if(!status?.ready)throw new ProviderChangeError(status?.error??'Connection validation failed.');
    if(!status.models)throw new ProviderChangeError('The endpoint returned no models. Register model IDs manually if discovery is unavailable.');
    // A model may have been selected while catalog validation was in flight.
    this.ensureReferences(d.candidate);
    const p=d.candidate.config.providers[d.id];
    if(d.key&&(d.supplied||d.existing?.baseUrl!==p.baseUrl||!d.existing?.secretRef&&!d.existing?.keyEnv)){
      p.secretRef=this.registry.secrets.put(d.key,p.baseUrl);p.keyEnv='';
    }
    this.commit(d.candidate);return this.snapshot();
  })}
  remove(raw:unknown){return this.serial(async()=>{
    const input=z.object({id:z.string(),expectedRevision:z.number().int().nonnegative(),resetRoles:z.boolean().default(false)}).parse(raw);
    this.check(input.expectedRevision);const config=structuredClone(this.registry.config),p=Object.hasOwn(config.providers,input.id)?config.providers[input.id]:undefined;
    if(!p)throw new ProviderChangeError('Connection no longer exists.',404);
    if(p.api==='openai-codex-responses')throw new ProviderChangeError('Disconnect ChatGPT using its separate sign-in controls.');
    if(input.resetRoles)for(const [role,model]of Object.entries(config.roles))if(model.startsWith(input.id+'::'))delete config.roles[role];
    delete config.providers[input.id];config.headlineModels=config.headlineModels.filter(id=>!id.startsWith(input.id+'::'));
    const candidate=new Registry(config,this.registry.profileDir,this.credentialsFor(config));candidate.models=new Map([...this.registry.models].filter(([,m])=>m.provider!==input.id));
    candidate.statuses={...this.registry.statuses};delete candidate.statuses[input.id];
    this.ensureReferences(candidate);this.commit(candidate);return this.snapshot();
  })}
  settings(raw:unknown){return this.serial(async()=>{
    const input=z.object({expectedRevision:z.number().int().nonnegative(),roles:z.record(z.string(),z.string()),headlineModels:z.array(z.string()).max(100)}).parse(raw);
    this.check(input.expectedRevision);
    if(Object.keys(input.roles).some(k=>!['small','medium','large'].includes(k)))throw new ProviderChangeError('Unknown background model role.');
    for(const id of [...Object.values(input.roles),...input.headlineModels])this.registry.resolve(id);
    const config=Configuration.parse({...this.registry.config,roles:input.roles,headlineModels:[...new Set(input.headlineModels)]});
    const candidate=new Registry(config,this.registry.profileDir,this.credentialsFor(config));candidate.models=new Map(this.registry.models);candidate.statuses={...this.registry.statuses};
    this.commit(candidate);return this.snapshot();
  })}
  private ensureReferences(candidate:Registry){
    if(this.registry.models.has(this.registry.state.model)&&!candidate.models.has(this.registry.state.model))
      throw new ProviderChangeError('Choose a different default model before removing the selected model.',409);
    for(const id of Object.values(candidate.config.roles))if(!candidate.models.has(id))
      throw new ProviderChangeError('Choose a replacement for the background model role before removing this model.',409);
  }
  private commit(candidate:Registry){
    candidate.config.defaultModel=this.registry.state.model;
    const revision=this.registry.revision+1;
    atomicJson(join(this.registry.profileDir,'provider-config.json'),{schemaVersion:1,revision,configuration:candidate.config});
    this.registry.adopt(candidate,revision);this.cleanupWarning=undefined;
    try{
      atomicJson(join(this.registry.profileDir,'models.last-good.json'),[...this.registry.models.values()]);
      this.registry.secrets.prune(new Set(Object.values(this.registry.config.providers).flatMap(p=>p.secretRef?[p.secretRef]:[])));
    }catch{
      this.cleanupWarning='The connection was saved. Updating the offline cache or removing unused encrypted keys failed. Check the private profile directory permissions.';
    }
    this.notify();
  }
}
