import http from 'node:http';
import https from 'node:https';
import {bannedHost} from './registry';

const vendorCrashHost='o1158394.ingest.us.sentry.io';
const vendorUpdateBucket='/operon-dist-cf94a20e-f71c-413c-bd00-9e12b1fedf59';

/** These destinations belong to the preserved runtime's vendor services.
 * Model providers, user connectors and public scientific datasets keep their
 * normal network paths. This is a service boundary, not a general firewall. */
export function blockedServiceURL(url:URL):boolean {
  const host=url.hostname.toLowerCase().replace(/\.$/,'');
  const path=decodeURIComponent(url.pathname);
  return bannedHost(host)||host===vendorCrashHost||
    (host==='storage.googleapis.com'&&(path===vendorUpdateBucket||path.startsWith(vendorUpdateBucket+'/')));
}

export function nodeRequestURL(input:any,options:any={},protocol='https:'):URL {
  let url:URL;
  if(typeof input==='string'||input instanceof URL)url=new URL(input);
  else {options={...input,...options};url=new URL(protocol+'//localhost');}
  if(options.protocol)url.protocol=options.protocol;
  if(options.host)url.host=options.host;
  if(options.hostname)url.hostname=options.hostname;
  if(options.port!==undefined)url.port=String(options.port);
  if(options.path){const parsed=new URL(options.path,url);url.pathname=parsed.pathname;url.search=parsed.search;}
  return url;
}

export function guardFetch(fetcher:typeof fetch):typeof fetch {
  return ((input:any,options?:any)=>{
    const url=new URL(typeof input==='string'||input instanceof URL?input:input.url);
    if(blockedServiceURL(url))return Promise.reject(new Error('Chimeric blocked a vendor service request.'));
    return fetcher(input,options);
  }) as typeof fetch;
}

export function installNetworkPolicy() {
  globalThis.fetch=guardFetch(globalThis.fetch);
  for(const module of [http,https])for(const method of ['request','get'] as const){
    const original=module[method];
    (module as any)[method]=function(input:any,...args:any[]){
      const options=typeof args[0]==='object'&&args[0]!==null?args[0]:{};
      if(blockedServiceURL(nodeRequestURL(input,options,module===https?'https:':'http:')))
        throw new Error('Chimeric blocked a vendor service request.');
      return original.call(module,input,...args);
    };
  }
}
