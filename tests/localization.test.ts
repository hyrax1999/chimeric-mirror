import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {Localization,resolveLanguage} from '../src/localization';

test('System language follows supported browser preferences while an explicit choice overrides them',()=>{
 expect(resolveLanguage('system',['ja-JP','en-US'])).toBe('ja');
 expect(resolveLanguage('system',['en-US','ja'])).toBe('en');
 expect(resolveLanguage('system',['fr-FR','ja-JP'])).toBe('ja');
 expect(resolveLanguage('system',['fr-FR'])).toBe('en');
 expect(resolveLanguage('en',['ja-JP'])).toBe('en');expect(resolveLanguage('ja',['en-US'])).toBe('ja');
});

test('The actual bootstrap script detects Japanese and English and the saved System preference survives reload',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'chimeric-locale-'));
 try{
  const locale=new Localization(dir),routes=new Map<string,Function>();
  locale.install({get:(path:string,handler:Function)=>routes.set('GET '+path,handler),put:(path:string,handler:Function)=>routes.set('PUT '+path,handler)});
  const get=routes.get('GET /api/local/ui/preferences')!;
  expect(await get({headers:{'accept-language':'en;q=0.5,ja-JP;q=0.9'}})).toEqual({locale:'system',resolvedLocale:'ja'});
  const reply:any={type(){return this},header(){return this},send(script:string){return script}};
  const script=await routes.get('GET /api/local/i18n/bootstrap.js')!({},reply);
  for(const [languages,expected] of [[['ja-JP','en-US'],'ja'],[['en-US','ja-JP'],'en'],[['fr-FR'],'en']] as const){
   const context:any={navigator:{languages},document:{documentElement:{}}};runInNewContext(script,context);
   expect(context.ChimericI18n.locale).toBe(expected);expect(context.document.documentElement.lang).toBe(expected);
   expect(context.ChimericI18n.preference).toBe('system');
  }
  const put=routes.get('PUT /api/local/ui/preferences')!;
  await put({body:{locale:'ja'}},reply);expect(new Localization(dir).locale).toBe('ja');
  await put({body:{locale:'system'}},reply);expect(new Localization(dir).locale).toBe('system');
 }finally{rmSync(dir,{recursive:true,force:true})}
});
