import { readFileSync, existsSync, mkdirSync, writeFileSync, renameSync } from "node:fs";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import yaml from "js-yaml";
import { z } from "zod";
import type { Model } from "@earendil-works/pi-ai";
import type {SubscriptionManager} from './subscription';
import {ProviderSecrets} from './provider-secrets';
import {defaultEffort,modelEfforts,effortNames} from './model-effort';
const pinnedCredentials=new WeakMap<object,{key?:string;required:boolean;label:string}>();

export const bannedHost = (host: string) => {
  const normalized = host.toLowerCase().replace(/\.$/, '');
  return ["anthropic.com", "anthropic.ai", "claude.ai", "claude.com"].some(x => normalized === x || normalized.endsWith("." + x));
};

export const Provider = z.object({
  name: z.string().min(1), baseUrl: z.string().url(), keyEnv: z.string().default(''),
  secretRef:z.string().optional(),revision:z.string().default('initial'),enabled:z.boolean().default(true),allowInsecureHttp:z.boolean().default(false),
  api: z.enum(["openai-completions", "openai-responses", "openai-codex-responses"]).default("openai-completions"),
  requestTimeoutMs: z.number().int().min(1000).max(3_600_000).default(600_000),
  models: z.array(z.object({ id: z.string(), name: z.string().optional() }).passthrough()).optional(),
  modelOverrides: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});
export const Configuration = z.object({
  envFile: z.string().optional(),
  credentialRefsFile: z.string().optional(),
  modelMetadataFile: z.string().optional(),
  providers: z.record(z.string(), Provider),
  defaultModel: z.string(), roles: z.record(z.string(), z.string()).default({}),
  headlineModels: z.array(z.string()).default([]),
  searchUrl: z.string().url().optional(),
  voice: z.object({
    python:z.string().default(''),runtimeRoot:z.string().default(''),model:z.string().default('base'),
  }).prefault({}),
});
export type Configuration = z.infer<typeof Configuration>;
export type ModelEntry = Model<any> & { qualifiedId: string; providerName: string; capabilitiesVerified: boolean; mode: string; providerMaxOutputTokens?: number; efforts?: string[];requestTimeoutMs:number;replayKey:string };

export const defaultConfiguration: Configuration = Configuration.parse({
  providers: {
    'openai-codex': {name:'ChatGPT',baseUrl:'https://chatgpt.com/backend-api',api:'openai-codex-responses',models:[{id:'gpt-6.1-sol',name:'GPT 6.1 Sol'}],modelOverrides:{'gpt-6.1-sol':{contextWindow:922_000,maxTokens:128_000,input:['text','image'],verified:true,reasoning:true,reasoningEfforts:{low:'low',medium:'medium',high:'high',xhigh:'xhigh',max:'max'},compat:{supportsStrictMode:false}}}},
  },
  defaultModel: 'openai-codex::gpt-6.1-sol',headlineModels:['openai-codex::gpt-6.1-sol'],roles:{},
});

export function atomicJson(path: string, data: unknown) {
  const tmp = path + "." + randomUUID() + ".tmp";
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, path);
}

export function readCredentialReferences(config: Configuration): Map<string, string> {
  const values = new Map<string, string>();
  const fileKeys = new Set<string>();
  if (config.credentialRefsFile && existsSync(config.credentialRefsFile)) {
    const doc = yaml.load(readFileSync(config.credentialRefsFile, "utf8")) as any;
    for (const provider of Object.values(config.providers)) {
      const value = doc?.refs?.[provider.keyEnv];
      if (typeof value === "string") values.set(provider.keyEnv, value);
    }
  }
  if (config.envFile && existsSync(config.envFile)) for (let line of readFileSync(config.envFile, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_]\w*)\s*=\s*(.*)$/);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    else value = value.replace(/\s+#.*$/, "").trim();
    values.set(match[1], value);
    fileKeys.add(match[1]);
  }
  for (const provider of Object.values(config.providers)) {
    if (provider.keyEnv && !fileKeys.has(provider.keyEnv)
      && values.get('UPSTREAM_BASE_URL')?.replace(/\/$/,'') === provider.baseUrl.replace(/\/$/,'')
      && values.get('UPSTREAM_API_KEY')) values.set(provider.keyEnv,values.get('UPSTREAM_API_KEY')!);
    if (process.env[provider.keyEnv]) values.set(provider.keyEnv, process.env[provider.keyEnv]!);
  }
  return values;
}

export class Registry {
  subscription?:SubscriptionManager;
  config: Configuration;
  models = new Map<string, ModelEntry>();
  private keys: Map<string, string>;
  private redactionSecrets=new Set<string>();
  private metadata = new Map<string,any>();
  statuses: Record<string, { ready: boolean; models: number; error?: string }> = {};
  readonly profileDir: string;
  readonly secrets:ProviderSecrets;
  revision=0;
  catalogGeneration=randomUUID();
  state: { model: string; effort?: string };
  constructor(config: unknown, profileDir: string,private readonly credentialOverrides=new Map<string,string>()) {
    this.config = Configuration.parse(config);
    this.profileDir = resolve(profileDir); mkdirSync(this.profileDir, { recursive: true, mode: 0o700 });
    this.keys = readCredentialReferences(this.config);
    for(const [id,key]of credentialOverrides){const p=this.config.providers[id];if(p?.keyEnv)this.keys.set(p.keyEnv,key)}
    this.secrets=new ProviderSecrets(join(this.profileDir,'local-auth'));
    if (this.config.modelMetadataFile && existsSync(this.config.modelMetadataFile)) {
      const visit = (node:any) => {
        if (!node || typeof node !== 'object') return;
        for (const [id,p] of Object.entries(this.config.providers)) {
          const source = node.providers?.[id];
          if (source?.baseURL?.replace(/\/$/,'') === p.baseUrl.replace(/\/$/,'') && Array.isArray(source.models)) {
            for (const m of source.models) if (typeof m.id === 'string') this.metadata.set(id+'::'+m.id, {name:m.name,contextWindow:m.contextWindow,maxTokens:m.maxTokens,input:m.input,reasoningEfforts:m.reasoningEfforts,compat:{...source.compat,...m.compat}});
          }
        }
        for (const value of Object.values(node)) visit(value);
      };
      visit(yaml.load(readFileSync(this.config.modelMetadataFile,'utf8')));
    }
    const stateFile = join(this.profileDir, "model-selection.json");
    this.state = existsSync(stateFile) ? JSON.parse(readFileSync(stateFile, "utf8")) : { model: this.config.defaultModel };
    for (const provider of Object.values(this.config.providers)) {
      const u = new URL(provider.baseUrl);
      if (u.username || u.password || u.search || u.hash || bannedHost(u.hostname)) throw new Error("provider URL contains unsupported credentials, parameters, or an Anthropic destination");
      if (u.protocol !== "https:" && !(u.protocol === "http:" && (["127.0.0.1", "localhost", "[::1]"].includes(u.hostname)||provider.allowInsecureHttp))) throw new Error("remote providers require HTTPS or an explicitly enabled HTTP connection");
      // Loopback is needed by injected driver fixtures. SubscriptionManager also
      // checks the exact destination before attaching renewable credentials.
      if(provider.api==='openai-codex-responses'&&u.href.replace(/\/$/,'')!=='https://chatgpt.com/backend-api'&&!['127.0.0.1','localhost','[::1]'].includes(u.hostname))throw new Error('The ChatGPT subscription connection uses its fixed OpenAI destination.');
    }
    const cached = join(this.profileDir, 'models.last-good.json');
    if (existsSync(cached)) {
      const entries = JSON.parse(readFileSync(cached, 'utf8'));
      for (const m of entries) {
        const p = this.config.providers[m.provider];
        if (p?.enabled && p.baseUrl === m.baseUrl && p.api === m.api){
          const model={...m,requestTimeoutMs:p.requestTimeoutMs,replayKey:m.qualifiedId+'@'+p.revision};
          this.models.set(m.qualifiedId,model);this.pin(model);
        }
      }
    }
  }
  static fromFile(path: string | undefined, profileDir: string) {
    const managed=join(profileDir,'provider-config.json');
    const record=existsSync(managed)?JSON.parse(readFileSync(managed,'utf8')):undefined;
    const registry=new Registry(record?.configuration??(path?JSON.parse(readFileSync(path,'utf8')):defaultConfiguration),profileDir);
    registry.revision=record?.revision??0;
    if(!record)atomicJson(managed,{schemaVersion:1,revision:0,configuration:registry.config});
    return registry;
  }
  private pin(model:ModelEntry){
    const p=this.config.providers[model.provider];
    const key=this.credentialOverrides.get(model.provider)??(p.secretRef?this.secrets.get(p.secretRef,p.baseUrl):this.keys.get(p.keyEnv));
    if(key)this.redactionSecrets.add(key);
    pinnedCredentials.set(model,{key,required:!!(p.secretRef||p.keyEnv),label:p.keyEnv||p.name});
  }
  getPrivateCredential(providerId:string){
    const model=[...this.models.values()].find(m=>m.provider===providerId);
    if(model)return pinnedCredentials.get(model)?.key;
    const p=this.config.providers[providerId];
    return p?(p.secretRef?this.secrets.get(p.secretRef,p.baseUrl):this.keys.get(p.keyEnv)):undefined;
  }
  adopt(candidate:Registry,revision:number){
    this.config=candidate.config;this.models=candidate.models;this.statuses=candidate.statuses;
    this.keys=candidate.keys;this.metadata=candidate.metadata;this.revision=revision;this.catalogGeneration=randomUUID();
    for(const key of candidate.redactionSecrets)this.redactionSecrets.add(key);
  }
  async refresh(persist=true,providerIds?:string[]) {
    const models=new Map(this.models);const statuses={...this.statuses};
    await Promise.all(Object.entries(this.config.providers).filter(([id])=>!providerIds||providerIds.includes(id)).map(async ([providerId, p]) => {
      if(!p.enabled){for(const [id,m]of models)if(m.provider===providerId)models.delete(id);statuses[providerId]={ready:false,models:0};return}
      try {
        const headers: Record<string, string> = {};
        const key = this.credentialOverrides.get(providerId)??(p.secretRef?this.secrets.get(p.secretRef,p.baseUrl):this.keys.get(p.keyEnv)); if (key) headers.authorization = "Bearer " + key;
        let data: any[];
        if (p.models) data = p.models;
        else {
          const r = await fetch(p.baseUrl.replace(/\/$/, "") + "/models", { headers, redirect:'error',signal: AbortSignal.timeout(20_000) });
          if (!r.ok) throw new Error("model catalog returned HTTP " + r.status);
          // Bound discovery even if the endpoint omits Content-Length or streams.
          if(Number(r.headers.get('content-length'))>8*1024*1024){await r.body?.cancel();throw new Error('Model catalog exceeds the 8 MB limit. Register model IDs manually.')}
          const reader=r.body?.getReader();const chunks:Uint8Array[]=[];let size=0;
          if(!reader)throw new Error('Model catalog has no response body.');
          try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>8*1024*1024){await reader.cancel();throw new Error('Model catalog exceeds the 8 MB limit. Register model IDs manually.')}chunks.push(value)}}finally{reader.releaseLock()}
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as any;
          if (!Array.isArray(body.data)) throw new Error("model catalog must contain a data array");
          if(body.data.length>4096)throw new Error('Model catalog exceeds 4096 entries. Register model IDs manually.');
          data = body.data;
        }
        const discovered=new Map<string,ModelEntry>();
        for (const raw of data) {
          if (typeof raw?.id !== "string" || !raw.id || raw.id.length>512) continue;
          const qualifiedId = providerId + "::" + raw.id;
          const configured = this.metadata.get(qualifiedId) ?? {};
          const override = {...configured,...p.modelOverrides[raw.id],compat:{...configured.compat,...p.modelOverrides[raw.id]?.compat as any}};
          const effortMap = override.reasoningEfforts ?? {};
          const efforts = Object.keys(effortMap).filter(e=>effortNames.includes(e) && effortMap[e]!=null);
          const advertised=override.input??raw.input_modalities;
          const modalities=Array.isArray(advertised)?advertised.filter((x:any)=>x==='text'||x==='image'):['text'];
          if(!modalities.length)modalities.push('text');
          const limit=(value:unknown,fallback:number)=>Number.isFinite(Number(value))&&Number(value)>0?Math.floor(Number(value)):fallback;
          const entry: ModelEntry = {
            id: raw.id, qualifiedId, provider: providerId, providerName: p.name,
            requestTimeoutMs:p.requestTimeoutMs,replayKey:qualifiedId+'@'+p.revision,
            name: String(override.name ?? raw.name ?? raw.id), api: p.api,
            baseUrl: p.baseUrl, input: modalities,
            reasoning: override.reasoning === true || raw.reasoning === true || efforts.length>0,
            efforts: efforts.length ? efforts : ['low','medium','high','max'],
            contextWindow: limit(override.contextWindow ?? raw.max_input_tokens ?? raw.context_length,128_000),
            maxTokens: limit(override.maxTokens ?? raw.max_output_tokens,16_384),
            providerMaxOutputTokens: raw.max_output_tokens,
            mode: String(raw.mode ?? 'chat'),
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            capabilitiesVerified: override.verified === true,
            compat: override.compat as any,
          };
          this.pin(entry);discovered.set(qualifiedId,entry);
        }
        for(const [id,m]of models)if(m.provider===providerId)models.delete(id);
        for(const [id,m]of discovered)models.set(id,m);
        statuses[providerId] = { ready: true, models: discovered.size };
      } catch (error) {
        statuses[providerId] = { ready: false, models: [...models.values()].filter(m=>m.provider===providerId).length, error: this.safeError(error) };
      }
    }));
    this.models=models;this.statuses=statuses;
    if(persist)atomicJson(join(this.profileDir, 'models.last-good.json'), [...this.models.values()]);
  }
  safeError(error: unknown) {
    let value = error instanceof Error ? error.message : String(error);
    for (const key of this.keys.values()) if (key) value = value.split(key).join("[redacted]");
    for(const key of this.credentialOverrides.values())if(key)value=value.split(key).join('[redacted]');
    for(const key of this.redactionSecrets)if(key)value=value.split(key).join('[redacted]');
    return this.subscription?.redact(value)??value;
  }
  resolve(id: string): ModelEntry {
    let resolved = id.replace(/^anthropic\//,'');
    if (resolved.startsWith("claude-")) {
      const role = /haiku/.test(resolved) ? "small" : /opus|fable/.test(resolved) ? "large" : "medium";
      resolved = this.config.roles[role] ?? this.state.model;
    }
    let model = this.models.get(resolved);
    if (!model) {
      const matches = [...this.models.values()].filter(m => m.id === resolved);
      if (matches.length === 1) model = matches[0];
    }
    if (!model) throw new Error("unknown or unavailable model: " + id);
    if (model.mode !== 'chat') throw new Error('Model ' + id + ' serves ' + model.mode + ', which cannot drive the analysis agent');
    return model;
  }
  apiKey(model: ModelEntry) {
    if(model.api==='openai-codex-responses')throw new Error('Subscription requests require renewable ChatGPT authentication.');
    const binding=pinnedCredentials.get(model),key=binding?.key;
    if (key) return key;
    if(binding?.required)throw new Error('Missing provider credential: '+binding.label);
    // Keyless compatible servers are supported; credentials are never inferred from another connection.
    return 'local-no-key-required';
  }
  async requestAuth(model:ModelEntry,signal?:AbortSignal){
    if(model.api==='openai-codex-responses'){
      if(!this.subscription)throw new Error('Connect ChatGPT in Settings → Connections.');
      return this.subscription.requestAuth(signal);
    }
    return {apiKey:this.apiKey(model),sessionScope:undefined};
  }
  select(model: string, effort?: string) {
    const entry=this.resolve(model),choices=modelEfforts(entry);
    if(effort!==undefined&&choices.length&&!choices.includes(effort))throw new Error('Unsupported reasoning effort for '+entry.name);
    const selected=choices.includes(effort??'')?effort:defaultEffort(entry);
    this.state = { model:entry.qualifiedId, ...(selected ? { effort:selected } : {}) };
    atomicJson(join(this.profileDir, "model-selection.json"), this.state);
    return this.snapshot();
  }
  snapshot() {
    return {
      defaultModel: this.state.model, effort: this.state.effort,
      roles: { ...this.config.roles }, statuses: this.statuses,
      models: [...this.models.values()].map(({ cost, ...m }) => m),
    };
  }
}
