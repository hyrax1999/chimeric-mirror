/** Preserve the native one-use nonce form while removing external account UI. */
export function localGate(payload:string,locale:string,icon:string){
  if(!/<(?:!doctype|html)/i.test(payload)||!/<title>(?:Sign in|Open local workspace)[^<]*<\/title>/i.test(payload))return payload;
  const form=payload.match(/<form\b[^>]*>[\s\S]*?<\/form>/gi)?.find(candidate=>{
    const action=candidate.match(/\baction=["']([^"']+)["']/i)?.[1];
    return action!==undefined&&/^(?:\/|(?:\.\.?\/)*)api\/auth\/nonce$/.test(action);
  });
  const ja=locale==='ja',label=ja?'ローカルワークスペースを開く':'Open local workspace';
  const content=form?form.replace(/Sign in|Open local workspace/g,label):'<p>'+(ja?'Chimericアプリ、またはChimericのopenコマンドからワークスペースを開いてください。このワークスペースに外部アカウントでログインする必要はありません。':'Open this workspace from the Chimeric app or the Chimeric open command. The workspace uses a local session; no external account sign-in is required.')+'</p>';
  return '<!doctype html><html lang="'+(ja?'ja':'en')+'"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+label+' · Chimeric</title><style>html{color-scheme:light dark}body{font:16px/1.6 system-ui,sans-serif;background:#faf9f5;color:#292724;display:grid;place-items:center;min-height:100vh;margin:0}main{width:min(340px,calc(100vw - 48px));text-align:center}svg{width:76px;height:76px}h1{font:500 32px Georgia,serif;letter-spacing:-.025em;margin:16px 0 24px}p{color:#68645d}button{font:inherit;border:1px solid #d8d5cc;border-radius:9px;padding:10px 16px;width:100%;cursor:pointer;background:#eceae3;color:inherit}@media(prefers-color-scheme:dark){body{background:#242320;color:#edeae2}p{color:#c1bdb3}button{background:#34332e;border-color:#5b574e}}</style><main>'+icon+'<h1>Chimeric</h1>'+content+'</main></html>';
}
