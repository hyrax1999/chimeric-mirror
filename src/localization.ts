import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {atomicJson} from './registry';
import ja from './ja.json';

export const localize=(text:string,locale='en')=>locale==='ja'?(ja as Record<string,string>)[text]??text:text;
export function resolveLanguage(preference:string,languages:string[]=[]):'en'|'ja'{
  if(preference==='en'||preference==='ja')return preference;
  for(const language of languages){const code=language.trim().toLowerCase().split('-')[0];if(code==='ja'||code==='en')return code}
  return 'en';
}
function acceptedLanguages(header?:string){
  return (header??'').split(',').map((entry,index)=>{
    const [tag,...params]=entry.trim().split(';');const q=params.find(p=>p.trim().startsWith('q='));
    return {tag,index,quality:q?Number(q.trim().slice(2)):1};
  }).filter(e=>Number.isFinite(e.quality)&&e.quality>0&&e.quality<=1).sort((a,b)=>b.quality-a.quality||a.index-b.index).map(e=>e.tag);
}
export class Localization {
  locale:'system'|'en'|'ja'='system';
  private path:string;
  constructor(profile:string){
    this.path=join(profile,'ui-preferences.json');
    if(existsSync(this.path))try{this.locale=z.enum(['system','en','ja']).parse(JSON.parse(readFileSync(this.path,'utf8')).locale)}catch{console.warn('[chimeric] Saved interface language was unreadable; following the browser language until it is saved again.')}
  }
  resolve(acceptLanguage?:string){return resolveLanguage(this.locale,acceptedLanguages(acceptLanguage))}
  install(app:any){
    app.get('/api/local/ui/preferences',async(request:any)=>({locale:this.locale,resolvedLocale:this.resolve(request.headers?.['accept-language'])}));
    app.put('/api/local/ui/preferences',async(request:any,reply:any)=>{
      const result=z.object({locale:z.enum(['system','en','ja'])}).safeParse(request.body);
      if(!result.success)return reply.code(400).send({detail:'Choose System, English or Japanese.'});
      atomicJson(this.path,result.data);this.locale=result.data.locale;return result.data;
    });
    app.get('/api/local/i18n/bootstrap.js',async(_request:any,reply:any)=>{
      const script='(()=>{const preference='+JSON.stringify(this.locale)+';const locale=('+resolveLanguage.toString()+')(preference,navigator.languages??[navigator.language]);globalThis.ChimericI18n={preference,locale,dictionary:locale==="ja"?'+JSON.stringify(ja)+':{},t:function(v){return this.dictionary[v]??v}};document.documentElement.lang=locale})();';
      return reply.type('text/javascript; charset=utf-8').header('cache-control','no-store').send(script);
    });
  }
}
