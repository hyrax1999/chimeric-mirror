import {r as React,j as jsx,a as useQueryClient} from '/assets/vendor-CED4rDjN.js?science_local=chatgpt-v1';
const t=value=>globalThis.ChimericI18n?.t(value)??value;

async function api(method='GET',body){
 if(method!=='GET')await fetch('/api/csrf',{credentials:'same-origin'});
 const cookie=document.cookie.split('; ').find(v=>v.startsWith('operon_csrf='));
 const response=await fetch('/api/local/chatgpt',{method,credentials:'same-origin',headers:{'content-type':'application/json',...(cookie?{'x-operon-csrf':decodeURIComponent(cookie.slice('operon_csrf='.length))}:{})},...(body?{body:JSON.stringify(body)}:{})});
 const data=await response.json();if(!response.ok)throw new Error(t(data.detail||'ChatGPT connection is unavailable.'));return data;
}
export function ChatGPTCredentials(){
 const client=useQueryClient();
 const [status,setStatus]=React.useState(null),[error,setError]=React.useState(''),[busy,setBusy]=React.useState(false);
 const waiting=['preparing','waiting'].includes(status?.login?.phase);
 const connected=React.useRef(undefined);
 const update=React.useCallback(value=>{
  if(connected.current!==undefined&&connected.current!==value.connected)client.invalidateQueries();
  connected.current=value.connected;setStatus(value);
 },[client]);
 React.useEffect(()=>{
  let alive=true,timer;
  const poll=async()=>{
   try{const value=await api();if(!alive)return;update(value);setError('');timer=setTimeout(poll,waiting?1000:30_000);}
   catch{if(alive){setError(t('Could not read the ChatGPT connection. Retry or reopen Connections.'));timer=setTimeout(poll,10_000);}}
  };
  poll();return()=>{alive=false;clearTimeout(timer);};
 },[update,waiting]);
 const action=async body=>{
  setBusy(true);setError('');
  try{update(await api('POST',body));}catch(e){setError(e.message);}finally{setBusy(false);}
 };
 const button=(label,onClick,disabled=false)=>jsx.jsx('button',{type:'button',onClick,disabled:busy||disabled,className:'rounded-md border border-border-300 px-3 py-1.5 text-sm hover:bg-bg-200 disabled:opacity-50',children:t(label)});
 return jsx.jsxs('section',{'aria-label':t('ChatGPT subscription'),className:'mb-5 border-b border-border-300 pb-4',children:[
  jsx.jsx('h3',{className:'mb-1 text-sm font-medium text-text-100',children:t('Model subscriptions')}),
  jsx.jsxs('div',{className:'rounded-lg border border-border-300 p-3',children:[
   jsx.jsxs('div',{className:'flex items-center justify-between gap-3',children:[
    jsx.jsxs('div',{children:[jsx.jsx('div',{className:'text-sm font-medium text-text-100',children:t('ChatGPT subscription')}),jsx.jsx('p',{className:'mt-1 text-footnote text-text-400',role:'status',children:t(status?.connected?'Connected · GPT 6.1 Sol':status?.reauthRequired?'Sign-in expired · reconnect to continue':'Use your ChatGPT plan with GPT 6.1 Sol')})]}),
    status?.connected?button('Disconnect',()=>action({action:'disconnect'})):button(status?.reauthRequired?'Reconnect ChatGPT':'Sign in with ChatGPT',()=>action({action:'start',method:'browser'}),waiting||!status),
   ]}),
   !status?.connected&&!waiting&&button('Device code',()=>action({action:'start',method:'device_code'}),!status),
   waiting&&jsx.jsxs('div',{className:'mt-3 space-y-2 text-sm',children:[
    jsx.jsx('p',{children:t(status.login.phase==='preparing'?'Preparing secure sign-in…':status.login.method==='browser'?'Complete OpenAI’s sign-in screen, then return here. This connection stays open until you finish or cancel.':'Complete OpenAI’s device-code sign-in, then return here.')}),
    status.login.expiresAt&&jsx.jsx('p',{children:t('Code expires at')+' '+new Date(status.login.expiresAt).toLocaleTimeString()}),
    status.login.userCode&&jsx.jsxs('p',{children:[t('Device code')+': ',jsx.jsx('code',{children:status.login.userCode})]}),
    status.login.authorizationUrl&&jsx.jsx('a',{href:status.login.authorizationUrl,target:'_blank',rel:'noopener noreferrer',className:'inline-block rounded-md border border-border-300 px-3 py-1.5 underline',children:t('Continue to ChatGPT')}),
    button('Cancel sign-in',()=>action({action:'cancel'})),
   ]}),
   status?.login?.message&&jsx.jsx('p',{className:'mt-2 text-sm text-text-400',role:'status',children:t(status.login.message)}),
   error&&jsx.jsx('p',{className:'mt-2 text-sm text-text-100',role:'alert',children:error}),
   jsx.jsx('p',{className:'mt-3 text-footnote text-text-400',children:t('Uses your ChatGPT plan limits. Credentials stay encrypted on this computer. You can disconnect here at any time.')}),
  ]}),
 ]});
}
