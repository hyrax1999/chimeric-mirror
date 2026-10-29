import { mkdirSync, readFileSync, existsSync, appendFileSync, copyFileSync, chmodSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {fileURLToPath} from 'node:url';
import { Registry, atomicJson } from './registry';
import {installNetworkPolicy} from './network-policy';
import { startBridge, clearBridgeReplay } from './bridge';
import { normalizeNativeMessage } from './protocol';
import {LocalASR,createVoiceBridge} from './voice';
import {makeCatalog} from './catalog';
import {SubscriptionManager,SubscriptionVault} from './subscription';
import {ProviderManager} from './provider-manager';
import {installProviderHttp} from './providers-http';
import {Localization} from './localization';
import {installHelp} from './help';
import {localGate} from './local-gate';

process.env.DO_NOT_TRACK='1';
process.env.OPERON_DISABLE_TELEMETRY='1';
process.env.OPERON_DISABLE_NONESSENTIAL_TRAFFIC='1';
installNetworkPolicy();
const profile = resolve(process.env.SCIENCE_LOCAL_PROFILE ?? 'state');
const assetManifest=resolve(process.env.SCIENCE_ASSET_MANIFEST ?? join(dirname(resolve(process.argv[1])),'asset-manifest.json'));
const assetInfo=JSON.parse(readFileSync(assetManifest,'utf8'));
const assetsRoot=assetInfo.rootRelative ? resolve(dirname(assetManifest),assetInfo.rootRelative) : assetInfo.root;
const productIcon=readFileSync(join(assetsRoot,'web-dist/favicon.svg'),'utf8');
if(!existsSync(join(assetsRoot,'drizzle/sqlite/meta/_journal.json')))throw new Error('Local runtime assets are incomplete. Run start.py build.');
mkdirSync(profile, { recursive: true, mode: 0o700 });
// Source-mode launches otherwise inherit the editor's checkout, which the
// original compute sandbox correctly cannot read. Provisioning needs a cwd
// already inside its compute dependency root, without expanding any grant.
mkdirSync(join(profile, 'conda'), { recursive: true, mode: 0o700 });
const mamba = join(profile,'conda','bin','micromamba');
if (!existsSync(mamba)) {
  const bundled=join(assetsRoot,'micromamba');
  const installed = resolve(dirname(process.execPath),'..','conda','bin','micromamba');
  const source=existsSync(bundled)?bundled:installed;
  if (existsSync(source)) { mkdirSync(dirname(mamba),{recursive:true,mode:0o700});copyFileSync(source,mamba);chmodSync(mamba,0o700); }
}
process.chdir(join(profile, 'conda'));
const identityPath = join(profile, 'local-identity.json');
const identity = existsSync(identityPath) ? JSON.parse(readFileSync(identityPath, 'utf8')) : { org_uuid: randomUUID(), account_uuid: randomUUID(), name: 'Local research workspace' };
if (!existsSync(identityPath)) atomicJson(identityPath, identity);
const authDir = join(profile, 'local-auth'); mkdirSync(authDir, { recursive: true, mode: 0o700 });
atomicJson(join(authDir, 'active-org.json'), { org_uuid: identity.org_uuid });

const registry = Registry.fromFile(process.env.SCIENCE_PROVIDER_CONFIG, profile);
const localization=new Localization(profile);
let connections:ProviderManager;
const subscription=new SubscriptionManager(new SubscriptionVault(authDir),{onChange:()=>connections?.notify()});
registry.subscription=subscription;
if (!['url','status','stop','--help','--version','help'].includes(process.argv[2])) await registry.refresh();
const token = randomUUID() + randomUUID();
const bridge = startBridge(registry, token);
const baseUrl = 'http://127.0.0.1:' + bridge.port;
// Only a loopback session token enters the original daemon. Provider keys stay
// in the Registry closure and are never exported to research subprocesses.
process.env.ANTHROPIC_BASE_URL = baseUrl;
delete process.env.ANTHROPIC_AUTH_TOKEN; delete process.env.ANTHROPIC_API_KEY;
delete process.env.UPSTREAM_API_KEY;
for (const p of Object.values(registry.config.providers)) delete process.env[p.keyEnv];
const roles = new Proxy({} as Record<string,string>,{
  get:(target,key)=>typeof key==='string'&&['small','medium','large'].includes(key)?registry.config.roles[key]??registry.state.model:Reflect.get(target,key),
  ownKeys:()=>['small','medium','large'],
  getOwnPropertyDescriptor:(target,key)=>typeof key==='string'&&['small','medium','large'].includes(key)?({enumerable:true,configurable:true}):Reflect.getOwnPropertyDescriptor(target,key),
});
const voiceConfig = registry.config.voice;
const VoiceBridge = createVoiceBridge(new LocalASR(voiceConfig.python,voiceConfig.runtimeRoot,voiceConfig.model));
let activeSettings: any;
let derivedRoles:Record<string,string>={};
function syncSettings(settings=activeSettings){
  if(!settings)return;
  settings.default_model=registry.state.model;
  settings.llm.kernel_default_model=registry.state.model;
  // Pinning a model or editing credentials must preserve an independently
  // chosen native reviewer. Apply role values only when those roles change.
  if(derivedRoles.small!==roles.small){settings.lineage_extraction_model=roles.small;settings.verification.terminal_sniff_model=roles.small}
  if(derivedRoles.large!==roles.large){settings.llm.kernel_reasoning_model=roles.large;settings.verification.reviewer_model=roles.large}
  derivedRoles={small:roles.small,medium:roles.medium,large:roles.large};
}
connections=new ProviderManager(registry,()=>syncSettings());
function catalog(locale=localization.resolve()) { return makeCatalog(registry,locale); }

const local = {
  identity, authDir, token, baseUrl, roles, catalog, normalizeNativeMessage, VoiceBridge, assetsRoot,
  assetArchive:join(dirname(assetManifest),assetInfo.archive??'assets.tar-j2zctwzf.gz'),
  modelInfo(id: string) { try { return registry.resolve(id); } catch { return null; } },
  credential: { api_key: token, auth_token: null, source: 'api_key', org_uuid: identity.org_uuid, account_uuid: identity.account_uuid, subscription_tier: null, rate_limit_tier: null },
  configurePaths(paths:any) {
    paths.auth_dir = authDir;
    paths.conda_home = join(profile,'conda');
    paths.conda_envs_path = join(profile,'conda','envs');
    return paths;
  },
  configure(settings: any) {
    activeSettings = settings;
    settings.disable_telemetry=true;
    settings.update={...settings.update,auto_update:false};
    settings.max_tokens = 16_384;
    syncSettings(settings);
    return settings;
  },
  select(input: any,locale=localization.resolve()) {
    registry.select(input.model ?? registry.state.model, input.effort);
    syncSettings();connections.publish();
    return catalog(locale);
  },
  installSubscriptionHttp(app:any){
    installProviderHttp(app,connections,assetInfo.moduleVersion??'?science_local=chatgpt-v1');
    localization.install(app);
    installHelp(app,localization);
    app.get('/api/local/chatgpt',async()=>subscription.status());
    app.post('/api/local/chatgpt',async(request:any,reply:any)=>{
      try{
        const body=request.body??{};
        if(body.action==='start')return await subscription.start(body.method??'browser');
        if(body.action==='cancel')subscription.cancel();
        else if(body.action==='disconnect')subscription.disconnect();
        else return reply.code(400).send({detail:'Unknown ChatGPT connection action.'});
        return subscription.status();
      }catch(e:any){return reply.code(400).send({detail:e instanceof Error?subscription.redact(e.message):'ChatGPT connection failed.'});}
    });
    app.get('/api/local/chatgpt/component.js',async(_request:any,reply:any)=>{
      const component=readFileSync(new URL('./chatgpt-credentials.js',import.meta.url),'utf8')
        .replaceAll('?science_local=chatgpt-v1',assetInfo.moduleVersion??'?science_local=chatgpt-v1');
      return reply.type('text/javascript; charset=utf-8').header('cache-control','no-store').send(component);
    });
    app.addHook('onClose',async()=>subscription.close());
  },
  installHttp(app: any) {
    app.addHook('onRoute', (route: any) => {
      if (route.url === '/api/auth/status') route.handler = async () => ({ authenticated: true, provider: 'local', account_uuid: identity.account_uuid, org_uuid: identity.org_uuid, reauth_required: false, oauth_stale: false, local: true, provider_status: registry.statuses });
      else if (['/api/auth/login', '/api/auth/logout'].includes(route.url)) route.handler = async () => ({ authenticated: true, provider: 'local', local: true });
      else if (route.url === '/api/models') route.handler = async (request:any) => catalog(localization.resolve(request.headers?.['accept-language']));
      else if (route.url === '/api/models/selection') route.handler = async (request: any) => local.select(request.body ?? {},localization.resolve(request.headers?.['accept-language']));
      else if (['/api/usage','/api/usage/credits-balance','/api/usage/extra-usage'].includes(route.url)) route.handler = async () => ({ok:false,reason:'not_applicable',message:'Usage and billing limits are managed by your selected model provider. Local token counts are available in session details.'});
      else if (route.url === '/api/feedback/available') route.handler = async () => ({safety_available:true});
      else if (route.url === '/api/feedback/safety') route.handler = async (request:any,reply:any) => {
        const report = request.body ?? {};
        if (typeof report.root_frame_id !== 'string' || !report.root_frame_id.trim()) return reply.code(400).send({detail:'root_frame_id is required'});
        const id = randomUUID();
        appendFileSync(join(profile,'local-feedback.jsonl'),JSON.stringify({id,time:new Date().toISOString(),root_frame_id:report.root_frame_id,model:report.model,reason:report.reason})+'\n',{mode:0o600});
        return reply.code(201).send({id,status:'saved_locally',sent:false});
      };
    });
    app.addHook('onSend', async (_request:any,_reply:any,payload:any) => {
      if (typeof payload === 'string')return localGate(payload,localization.resolve(_request.headers?.['accept-language']),productIcon);
      return payload;
    });
    app.addHook('onResponse',async(request:any,reply:any)=>{
      if (request.method === 'DELETE' && reply.statusCode < 300 && ['/api/frames/:id','/api/projects/:pid'].includes(request.routeOptions?.url)) clearBridgeReplay(bridge);
    });
    app.get('/api/local/providers', async () => registry.snapshot());
  },
};
(globalThis as any).__scienceLocal = local;
console.info('[chimeric] loaded ' + registry.models.size + ' models with local account services');
