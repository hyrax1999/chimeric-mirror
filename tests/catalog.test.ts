import {test,expect} from 'bun:test';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Registry} from '../src/registry';import {makeCatalog} from '../src/catalog';
test('Native selector receives renderable model sections and complete thinking controls',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'science-menu-'));
 try{const r=new Registry({envFile:'/missing',credentialRefsFile:'/missing',modelMetadataFile:'/missing',providers:{mock:{name:'Mock',baseUrl:'http://127.0.0.1:1/v1',models:[{id:'reasoner'},{id:'other'},{id:'embedding',mode:'embedding'}],modelOverrides:{reasoner:{reasoning:true,compat:{thinkingFormat:"qwen-chat-template"}}}}},defaultModel:'mock::reasoner'},dir);await r.refresh();const c=makeCatalog(r);const m=c.model_selector.catalog.models.find(m=>m.id==='mock::reasoner')!;expect(m.section).toBe('main');expect(c.model_selector.catalog.models.filter(m=>m.section==='main')).not.toHaveLength(0);expect(m.thinking!.effort_options.map(o=>o.id)).toContain('high');expect(m.thinking!.effort_options.map(o=>o.id)).toContain('off');expect(m.thinking!.mode_options).toEqual([]);expect(c.default_effort).toBe('medium');expect(c.model_selector.state.thinking).toEqual({type:'effort',effort:'medium'});expect(c.model_selector.catalog.models.find(m=>m.id==='mock::other')!.section).toBe('overflow')}finally{rmSync(dir,{recursive:true,force:true})}
});

test('A model with only high effort never advertises an unsupported medium default',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'chimeric-effort-'));
 try{
  const r=new Registry({providers:{mock:{name:'Mock',baseUrl:'http://127.0.0.1:1/v1',models:[{id:'reasoner'}],modelOverrides:{reasoner:{reasoning:true,reasoningEfforts:{high:'high'}}}}},defaultModel:'mock::reasoner'},dir);
  await r.refresh();r.select('mock::reasoner');
  const c=makeCatalog(r,'ja');
  expect(c.default_effort).toBe('high');expect(c.model_selector.state.thinking_by_model[0].thinking.effort).toBe('high');
  expect(c.model_selector.catalog.models[0].thinking!.effort_options[0].name).toBe('高');
  expect(()=>r.select('mock::reasoner','medium')).toThrow('Unsupported reasoning effort');
 }finally{rmSync(dir,{recursive:true,force:true})}
});
