import {r as React,j as jsx,a as useQueryClient} from '/assets/vendor-CED4rDjN.js?science_local=chatgpt-v1';

const t=value=>globalThis.ChimericI18n?.t(value)??value;
const control='w-full min-w-0 rounded-md border border-border-300 bg-bg-000 px-3 py-2 text-sm text-text-100';
const buttonClass='rounded-md border border-border-300 px-3 py-1.5 text-sm hover:bg-bg-200 disabled:opacity-50 focus-visible:shadow-focus';
const button=(label,onClick,disabled=false,props={})=>jsx.jsx('button',{type:'button',className:buttonClass,onClick,disabled,...props,children:t(label)});
async function api(path,method='GET',body){
  if(method!=='GET')await fetch('/api/csrf',{credentials:'same-origin'});
  const cookie=document.cookie.split('; ').find(v=>v.startsWith('operon_csrf='));
  const response=await fetch(path,{method,credentials:'same-origin',headers:{'content-type':'application/json',...(cookie?{'x-operon-csrf':decodeURIComponent(cookie.slice('operon_csrf='.length))}:{})},...(body!==undefined?{body:JSON.stringify(body)}:{})});
  let data;try{data=await response.json()}catch{throw Error(t('The server returned an unexpected response.'))}
  if(!response.ok)throw Error(t(response.status===401?'Open your local workspace again to continue.':data.detail||'Could not load model connections.'));
  return data;
}

export function ProviderEvents(){
  const client=useQueryClient();
  React.useEffect(()=>{
    let last='';const source=new EventSource('/api/local/connections/events');
    source.onmessage=event=>{if(event.data!==last){last=event.data;client.invalidateQueries()}};
    return()=>source.close();
  },[client]);
  return null;
}

export function LanguageSettings(){
  const [locale,setLocale]=React.useState(globalThis.ChimericI18n?.preference??'system');
  const [error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
  const apply=async()=>{
    setError('');
    if(document.querySelector('[data-chimeric-dirty="true"]'))return setError(t('Save or cancel your connection changes before switching language.'));
    if([...document.querySelectorAll('[role=textbox][contenteditable=true]')].some(e=>e.innerText.trim()))return setError(t('Finish your message draft before switching language.'));
    setBusy(true);
    try{await api('/api/local/ui/preferences','PUT',{locale});location.reload()}catch(e){setError(e.message);setBusy(false)}
  };
  return jsx.jsxs('section',{className:'mb-5 border-b border-border-300 pb-4','aria-label':t('Interface language'),children:[
    jsx.jsx('h3',{className:'mb-2 text-sm font-medium',children:'Language / 言語'}),
    jsx.jsxs('div',{className:'flex items-center gap-3',children:[
      jsx.jsxs('select',{'aria-label':t('Interface language'),className:control,value:locale,onChange:e=>setLocale(e.target.value),disabled:busy,children:[jsx.jsx('option',{value:'system',children:t('System language')}),jsx.jsx('option',{value:'en',children:'English'}),jsx.jsx('option',{value:'ja',children:'日本語'})]}),
      button('Apply language',apply,busy||locale===(globalThis.ChimericI18n?.preference??'system')),
    ]}),
    jsx.jsx('p',{className:'mt-2 text-footnote text-text-400',children:t('System follows your browser’s preferred language. Unsupported languages use English.')}),
    error&&jsx.jsx('p',{role:'alert',className:'mt-2 text-sm',children:error}),
  ]});
}

const empty=()=>({name:'',baseUrl:'',api:'openai-completions',apiKey:'',mode:'discover',modelsText:'',allowInsecureHttp:false,clearCredential:false,confirmDestinationChange:false,overrideCapabilities:false,images:false,reasoning:false,thinkingFormat:'openai',contextWindow:128000,maxTokens:16384,requestTimeoutSeconds:600});
export function ModelConnections(){
  const client=useQueryClient(),formRef=React.useRef(null);
  const [data,setData]=React.useState(null),[form,setForm]=React.useState(empty),[dirty,setDirty]=React.useState(false);
  const [error,setError]=React.useState(''),[notice,setNotice]=React.useState(''),[busy,setBusy]=React.useState(false),[preview,setPreview]=React.useState(null);
  const [deleting,setDeleting]=React.useState(null),[resetRoles,setResetRoles]=React.useState(false);
  const [roles,setRoles]=React.useState({}),[roleBase,setRoleBase]=React.useState(0),[roleDirty,setRoleDirty]=React.useState(false);
  const live=React.useRef(true),generation=React.useRef(0),readGeneration=React.useRef(0);
  const refresh=React.useCallback(async()=>{const version=++readGeneration.current;const next=await api('/api/local/connections');if(live.current&&version===readGeneration.current)setData(previous=>!previous||next.revision>=previous.revision?next:previous);return next},[]);
  React.useEffect(()=>{live.current=true;refresh().catch(e=>{if(live.current)setError(e.message)});return()=>{live.current=false;generation.current++}},[refresh]);
  React.useEffect(()=>{if(data&&!roleDirty){setRoles(data.roles);setRoleBase(data.revision)}},[data,roleDirty]);
  React.useEffect(()=>{
    const source=new EventSource('/api/local/connections/events');
    source.onmessage=()=>refresh().catch(e=>{if(live.current)setError(e.message)});
    return()=>source.close();
  },[refresh]);
  const change=(key,value)=>{generation.current++;setForm(f=>({...f,[key]:value}));setDirty(true);setPreview(null)};
  const reset=()=>{generation.current++;setForm(empty());setDirty(false);setPreview(null);setError('')};
  const run=async(action,success)=>{
    setBusy(true);setError('');setNotice('');
    try{const value=await action();if(!live.current)return;readGeneration.current++;setData(value);client.invalidateQueries();setNotice(t(success));return value}
    catch(e){if(live.current)setError(e.message);await refresh().catch(()=>undefined)}
    finally{if(live.current)setBusy(false)}
  };
  const body=()=>{
    if(!data)throw Error(t('Could not load model connections.'));
    const models=form.modelsText.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(id=>({id,...form.overrideCapabilities?{contextWindow:Number(form.contextWindow),maxTokens:Number(form.maxTokens)}:{}}));
    return {expectedRevision:data.revision,...form.id?{id:form.id,connectionRevision:form.connectionRevision}:{},name:form.name,baseUrl:form.baseUrl,api:form.api,apiKey:form.apiKey,
      mode:form.mode,...form.mode==='manual'?{models}:{},allowInsecureHttp:form.allowInsecureHttp,clearCredential:form.clearCredential,confirmDestinationChange:form.confirmDestinationChange,requestTimeoutMs:Number(form.requestTimeoutSeconds)*1000,
      ...(form.overrideCapabilities&&form.mode==='manual'?{capabilities:{images:form.images,reasoning:form.reasoning,thinkingFormat:form.thinkingFormat,efforts:['low','medium','high']}}:{})};
  };
  const save=async()=>{const value=await run(()=>api('/api/local/connections','POST',body()),'Connection saved.');if(value)reset()};
  const discover=async()=>{
    setBusy(true);setError('');setPreview(null);const version=generation.current;
    try{const value=await api('/api/local/connections/preview','POST',body());if(live.current&&version===generation.current)setPreview(value)}catch(e){if(live.current)setError(e.message)}finally{if(live.current)setBusy(false)}
  };
  const edit=connection=>{
    generation.current++;setForm({...empty(),...connection,apiKey:'',modelsText:connection.models.map(m=>m.id).join('\n'),requestTimeoutSeconds:connection.requestTimeoutMs/1000});
    setDirty(true);setPreview(null);setError('');formRef.current?.scrollIntoView({behavior:'auto',block:'start'});
  };
  const pin=id=>run(()=>api('/api/local/connections/settings','PUT',{expectedRevision:data.revision,roles:data.roles,headlineModels:data.headlineModels.includes(id)?data.headlineModels.filter(x=>x!==id):[...data.headlineModels,id]}),'Pinned models updated.');
  const use=id=>run(async()=>{await api('/api/models/selection','PUT',{model:id});return api('/api/local/connections')},'Default model updated.');
  const remove=async()=>{const result=await run(()=>api('/api/local/connections/'+encodeURIComponent(deleting.id),'DELETE',{expectedRevision:data.revision,resetRoles}),'Connection removed.');if(result)setDeleting(null)};
  const field=(label,key,props={})=>jsx.jsxs('label',{className:'block text-sm',children:[jsx.jsx('span',{className:'mb-1 block text-text-400',children:t(label)}),jsx.jsx('input',{className:control,value:form[key],onChange:e=>change(key,e.target.value),disabled:busy,...props})]});
  const check=(label,key)=>jsx.jsxs('label',{className:'flex items-center gap-2 text-sm',children:[jsx.jsx('input',{type:'checkbox',checked:!!form[key],onChange:e=>change(key,e.target.checked),disabled:busy}),t(label)]});
  const select=(label,key,options)=>jsx.jsxs('label',{className:'block text-sm',children:[jsx.jsx('span',{className:'mb-1 block text-text-400',children:t(label)}),jsx.jsx('select',{className:control,value:form[key],onChange:e=>change(key,e.target.value),disabled:busy,children:options.map(([value,label])=>jsx.jsx('option',{value,children:t(label)},value))})]});
  const models=data?.connections.flatMap(c=>c.models.filter(m=>m.mode==='chat').map(m=>({...m,provider:c.name})))??[];
  return jsx.jsxs('section',{'aria-label':t('Connections'),'data-chimeric-dirty':dirty||roleDirty?'true':'false',className:'mb-5 border-b border-border-300 pb-4',children:[
    jsx.jsx('h2',{className:'mb-1 text-base font-medium',children:t('Connect an external LLM')}),
    jsx.jsx('p',{className:'mb-3 text-sm text-text-400',children:t('OpenAI-compatible Chat Completions and Responses APIs are supported. Saved models become available without restarting the app.')}),
    jsx.jsx('a',{href:'/api/local/help#models',target:'_blank',rel:'noopener noreferrer',className:'mb-3 inline-block text-sm underline',children:t('Setup guide')}),
    jsx.jsxs('div',{ref:formRef,className:'rounded-lg border border-border-300 p-3',children:[
      jsx.jsx('h3',{className:'mb-3 text-sm font-medium',children:t(form.id?'Edit connection':'Add connection')}),
      jsx.jsxs('fieldset',{disabled:busy,className:'space-y-3',children:[
        field('Provider name','name',{placeholder:t('My provider'),autoComplete:'off','data-testid':'llm-provider-name'}),
        field('API base URL','baseUrl',{type:'url',placeholder:'https://api.example.com/v1',spellCheck:false,autoComplete:'off','data-testid':'llm-base-url'}),
        jsx.jsx('p',{className:'text-footnote text-text-400',children:t('API URL includes the path prefix supplied by your provider, such as /v1.')}),
        select('Endpoint type','api',[['openai-completions','Chat Completions (/chat/completions)'],['openai-responses','Responses (/responses)']]),
        field('API key (optional)','apiKey',{type:'password',placeholder:t(form.hasCredential?'Leave blank to keep the saved key':'Leave blank for a keyless endpoint'),autoComplete:'off',spellCheck:false,'data-testid':'llm-api-key'}),
        form.hasCredential&&check('Remove saved key','clearCredential'),
        form.id&&form.hasCredential&&check('Keep saved key for new URL','confirmDestinationChange'),
        form.baseUrl.startsWith('http:')&&check('Allow HTTP for this connection','allowInsecureHttp'),
        form.allowInsecureHttp&&jsx.jsx('p',{className:'text-footnote text-text-400',children:t('HTTP sends the API key without transport encryption.')}),
        jsx.jsxs('details',{children:[jsx.jsx('summary',{className:'cursor-pointer text-sm',children:t('Connection options')}),jsx.jsx('div',{className:'mt-3',children:field('Request timeout (seconds)','requestTimeoutSeconds',{type:'number',min:1,max:3600})})]}),
        select('Model registration','mode',[['discover','Discover models'],['manual','Register model IDs manually']]),
        form.mode==='manual'&&jsx.jsxs('div',{className:'space-y-3',children:[
          jsx.jsxs('label',{className:'block text-sm',children:[jsx.jsx('span',{className:'mb-1 block text-text-400',children:t('Manual model IDs')}),jsx.jsx('textarea',{rows:4,className:control,value:form.modelsText,onChange:e=>change('modelsText',e.target.value),spellCheck:false,'data-testid':'llm-model-ids'}),jsx.jsx('span',{className:'mt-1 block text-footnote text-text-400',children:t('One model ID per line. Use the exact ID accepted by your endpoint.')})]}),
          check('Apply capabilities to these manual models','overrideCapabilities'),
          form.overrideCapabilities&&jsx.jsxs('div',{className:'space-y-3',children:[
            check('Image input','images'),check('Reasoning','reasoning'),
            field('Context window (tokens)','contextWindow',{type:'number',min:1024,max:16000000}),field('Maximum output tokens','maxTokens',{type:'number',min:64,max:4000000}),
            form.reasoning&&select('Reasoning format','thinkingFormat',[['openai','OpenAI'],['qwen-chat-template','Qwen chat template'],['deepseek','DeepSeek'],['zai','Z.ai'],['chat-template','Chat template']]),
            jsx.jsx('p',{className:'text-footnote text-text-400',children:t('Configured capabilities depend on the model and endpoint. They do not constitute a successful model probe.')})
          ]})
        ]}),
        jsx.jsx('p',{className:'text-footnote text-text-400',children:t('Keys entered here are encrypted in the private credentials directory and are never shown again.')}),
        jsx.jsxs('div',{className:'flex flex-wrap gap-2',children:[button(busy?'Saving…':'Save connection',save,!data||!form.name.trim()||!form.baseUrl.trim(),{'data-testid':'llm-save'}),form.mode==='discover'&&button('Test discovery',discover,!data||!form.name.trim()||!form.baseUrl.trim()),button('Cancel',reset)]})
      ]}),
      preview&&jsx.jsxs('div',{className:'mt-3 text-sm',role:'status',children:[t('Available models')+': '+preview.count,jsx.jsx('pre',{className:'mt-2 max-h-40 overflow-auto text-footnote',children:preview.models.map(m=>m.id).join('\n')})]}),
    ]}),
    error&&jsx.jsx('p',{className:'mt-3 text-sm',role:'alert',children:error}),
    notice&&jsx.jsx('p',{className:'mt-3 text-sm text-text-400',role:'status',children:notice}),
    data?.warning&&jsx.jsx('p',{className:'mt-3 text-sm',role:'alert',children:t(data.warning)}),
    jsx.jsx('div',{className:'mt-4 space-y-3',children:data?.connections.filter(c=>!c.subscription).map(c=>jsx.jsxs('details',{className:'rounded-lg border border-border-300 p-3',children:[
      jsx.jsx('summary',{className:'cursor-pointer text-sm font-medium',children:c.name+' · '+c.models.length+' '+t('Models')}),
      jsx.jsx('p',{className:'mt-2 break-all text-footnote text-text-400',children:c.baseUrl}),
      jsx.jsx('p',{className:'mt-1 text-footnote text-text-400',children:t(c.hasCredential?'Key configured':'No saved key')+' · '+t(c.status?.ready?'Ready':'Unavailable')}),
      c.status?.error&&jsx.jsx('p',{className:'mt-2 text-footnote',children:c.status.error}),
      jsx.jsxs('div',{className:'mt-2 flex gap-2',children:[button('Edit',()=>edit(c),busy),button('Remove connection',()=>{setDeleting(c);setResetRoles(false)},busy)]}),
      jsx.jsx('ul',{className:'mt-3 space-y-2',children:c.models.map(m=>jsx.jsxs('li',{className:'border-t border-border-300 pt-2',children:[
        jsx.jsx('div',{className:'break-all text-sm',children:m.name}),jsx.jsx('div',{className:'break-all text-footnote text-text-400',children:m.id}),
        jsx.jsxs('div',{className:'mt-1 flex flex-wrap gap-2',children:[button(m.qualifiedId===data.selectedModel?'Default':'Use as default',()=>use(m.qualifiedId),busy||m.mode!=='chat'||m.qualifiedId===data.selectedModel),button(data.headlineModels.includes(m.qualifiedId)?'Unpin':'Pin',()=>pin(m.qualifiedId),busy||m.mode!=='chat')]})
      ]},m.id))})
    ]},c.id))}),
    deleting&&jsx.jsxs('div',{className:'mt-3 rounded-lg border border-border-300 p-3',children:[
      jsx.jsx('p',{className:'mb-2 text-sm font-medium',children:t('Remove connection')+': '+deleting.name}),
      jsx.jsxs('label',{className:'flex items-center gap-2 text-sm',children:[jsx.jsx('input',{type:'checkbox',checked:resetRoles,onChange:e=>setResetRoles(e.target.checked)}),t('Reset affected background roles to the default model')]}),
      jsx.jsxs('div',{className:'mt-3 flex gap-2',children:[button('Remove connection',remove,busy||data.selectedModel.startsWith(deleting.id+'::')),button('Cancel',()=>setDeleting(null),busy)]}),
      data.selectedModel.startsWith(deleting.id+'::')&&jsx.jsx('p',{className:'mt-2 text-footnote',children:t('Select another default model before removing this connection.')})
    ]}),
    data&&jsx.jsxs('details',{className:'mt-4',children:[jsx.jsx('summary',{className:'cursor-pointer text-sm font-medium',children:t('Background models')}),
      ...[['small','Small tasks'],['medium','Medium tasks'],['large','Large tasks']].map(([role,label])=>jsx.jsxs('label',{className:'mt-3 block text-sm',children:[jsx.jsx('span',{className:'mb-1 block text-text-400',children:t(label)}),jsx.jsxs('select',{className:control,value:roles[role]??'',disabled:busy,onChange:e=>{if(!roleDirty)setRoleBase(data.revision);setRoleDirty(true);setRoles(r=>{const next={...r};if(e.target.value)next[role]=e.target.value;else delete next[role];return next})},children:[jsx.jsx('option',{value:'',children:t('Follow the default model')}),...models.map(m=>jsx.jsx('option',{value:m.qualifiedId,children:m.provider+' · '+m.name},m.qualifiedId))]})]},role)),
      jsx.jsxs('div',{className:'mt-3 flex gap-2',children:[button('Save background models',async()=>{const value=await run(()=>api('/api/local/connections/settings','PUT',{expectedRevision:roleBase,roles,headlineModels:data.headlineModels}),'Connection saved.');if(value)setRoleDirty(false)},busy||!roleDirty),button('Cancel',()=>{setRoles(data.roles);setRoleBase(data.revision);setRoleDirty(false)},busy||!roleDirty)]})
    ]}),
  ]});
}
