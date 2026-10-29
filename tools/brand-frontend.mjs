import {readFileSync} from 'node:fs';
import {parse} from '@babel/parser';
import traverse0 from '@babel/traverse';
const traverse=traverse0.default??traverse0;
const input=JSON.parse(readFileSync(0,'utf8'));
const atom=readFileSync(new URL('../src/atom-component.js.fragment',import.meta.url),'utf8').trim();
const dna=JSON.parse(readFileSync(new URL('../src/chimeric-dna.json',import.meta.url),'utf8'));
const japanese=JSON.parse(readFileSync(new URL('../src/ja.json',import.meta.url),'utf8'));
const copy=new Map([
  ['Share this ID with Anthropic support when reporting an issue.','Include this ID when reporting an issue.'],
  ['Research skills from Anthropic','Bundled research skills'],
  ['Research connectors from Anthropic','Bundled research connectors'],
  ['Research model skills from Anthropic','Bundled research model skills'],
  ["To prevent misuse, research outside your approved use cases may be flagged to Anthropic's safety team for review.",'Tool permissions and local safety checks apply to research requests.'],
  ["Feedback saved on this computer. Anthropic's feedback service didn't accept it.",'Report saved on this computer.'],
  ['Submitting this report will send the entire current conversation to Anthropic for future improvements to our safety systems.','Save this report’s session reference and selected reason on this computer.'],
  ['Offload heavy work to SSH hosts, your own cloud, or Anthropic-hosted compute. Not yet available in the standalone CLI.','Run heavy work on your SSH hosts or configured cloud compute.'],
  ['Anthropic-hosted','Managed compute'],['Hosted by Anthropic','Hosted service'],['Anthropic Internal','Bundled'],
  ['Publisher-supplied description — not reviewed by Anthropic','Publisher-supplied description'],['— not reviewed by Anthropic.',''],
  ['Anthropic Sans','Sans'],['Anthropic Serif','Serif'],
  ['Anthropic','Original bundle'],
  ['Default for new sessions — how long Claude thinks before responding. Higher effort is more thorough but slower and uses more of your limits. Change an individual session from its session options. Applies to models that support reasoning effort (Opus 4.5+ and Sonnet 4.6+).','Default reasoning effort for new sessions. Higher effort can take longer and use more tokens. Available levels depend on the selected model and endpoint. You can change the effort for each session.'],
]);
const copyProperties=new Set(['children','label','title','placeholder','aria-label','aria-description','alt','description','tooltip','sub','helpText','message','heading','body','serif','sans','author']);
function isCopy(path){
  let current=path.parentPath;
  for(let i=0;current&&i<5;i++,current=current.parentPath){
    if(current.node.type==='ObjectProperty')return copyProperties.has(current.node.key.name??current.node.key.value);
    if(!['ArrayExpression','ConditionalExpression','LogicalExpression','BinaryExpression'].includes(current.node.type))return false;
  }
  return false;
}
function helpURL(value){
  if(!/^https?:\/\/(?:www\.)?(?:claude\.com|support\.claude\.com|support\.anthropic\.com|docs\.anthropic\.com|anthropic\.com)\//.test(value))return value;
  if(!/docs|support|legal|privacy|claude-science|changelog|product/.test(value))return value;
  return '/api/local/help'+(/update|changelog/.test(value)?'#updates':/privacy|legal|your-data/.test(value)?'#privacy':/permission/.test(value)?'#permissions':/file|upload/.test(value)?'#files':'');
}
const output=[];const inventory=[];
for(const file of input){
  const {name,text}=file;const ast=parse(text,{sourceType:'unambiguous'});const edits=[];
  let atoms=0,logos=0,events=0,staticAtoms=0,generalLanguage=0;
  traverse(ast,{
    CallExpression(path){
      const n=path.node;
      if(name.endsWith('/ControlPanelModal-OAuv-kWB.js')&&n.callee.type==='MemberExpression'&&['jsx','jsxs'].includes(n.callee.property.name)&&n.arguments[1]?.type==='ObjectExpression'){
        const props=n.arguments[1].properties;
        const test=props.find(p=>p.key?.value==='data-testid')?.value?.value;
        if(test==='settings-check-updates'){
          const handler=props.find(p=>p.key?.name==='onClick');
          if(!handler)throw Error('Missing native update control');
          edits.push({start:handler.value.start,end:handler.value.end,text:'()=>window.open("/api/local/help#updates","_blank","noopener,noreferrer")'});
        }
        if(test==='settings-view-changelog'){
          const href=props.find(p=>p.key?.name==='href');
          if(!href)throw Error('Missing native changelog link');
          edits.push({start:href.value.start,end:href.value.end,text:'"/api/local/help#updates"'});
        }
      }
      if(!name.endsWith('/index-BgpYmw3d.js'))return;
      if(n.callee.type!=='MemberExpression'||!['jsx','jsxs'].includes(n.callee.property.name)||n.arguments[0]?.name!=='kLe'||n.arguments[1]?.type!=='ObjectExpression')return;
      const props=n.arguments[1].properties;
      if(!props.some(p=>p.key?.name==='client'&&p.value?.name==='won'))return;
      const child=props.find(p=>p.key?.name==='children')?.value;
      if(!child)throw Error('Missing native query provider child');
      edits.push({start:child.start,end:child.start,text:'a.jsxs(a.Fragment,{children:[a.jsx(LocalChimericProviderEvents,{}),'});
      edits.push({start:child.end,end:child.end,text:']})'});events++;
    },
    VariableDeclarator(path){
      if(name.endsWith('/ControlPanelModal-OAuv-kWB.js')&&path.node.id?.name==='mn'&&path.findParent(p=>p.isFunction())?.node.id?.name==='rl'){
        const n=path.node.init;
        const children=n?.arguments?.[1]?.properties?.find(p=>p.key?.name==='children')?.value;
        if(n?.callee?.property?.name!=='jsxs'||n.arguments[0]?.value!=='div'||children?.type!=='ArrayExpression')throw Error('Native General settings container changed');
        edits.push({start:children.start+1,end:children.start+1,text:'e.jsx(LocalChimericLanguageSettings,{}),'});generalLanguage++;
      }
      if(!name.endsWith('/index-BgpYmw3d.js'))return;
      if(path.node.id?.name==='Uj'){
        if(!path.node.init)throw Error('Missing original working indicator');
        edits.push({start:path.node.init.start,end:path.node.init.end,text:atom});atoms++;
        path.skip();
      }
      if(path.node.id?.name==='bnt'){
        if(path.node.init?.type!=='ObjectExpression')throw Error('Missing original DNA illustration');
        edits.push({start:path.node.init.start,end:path.node.init.end,text:JSON.stringify(dna)});logos++;
        path.skip();
      }
      if(path.node.id?.name==='Cme'){
        edits.push({start:path.node.init.start,end:path.node.init.end,text:'({size:e=32,color:t=K8e,className:n})=>a.jsxs("svg",{"data-cds":"Atom",width:e,height:e,viewBox:"0 0 24 24",fill:"none",className:n,"aria-hidden":true,children:[...[0,60,120].map(r=>a.jsx("ellipse",{cx:12,cy:12,rx:9.6,ry:4.1,stroke:t,strokeWidth:0.9,transform:`rotate(${r} 12 12)`},r)),a.jsx("circle",{cx:12,cy:12,r:1.8,fill:t})]})'});staticAtoms++;path.skip();
      }
    },
    StringLiteral(path){
      const value=path.node.value;
      if(['ImportDeclaration','ExportNamedDeclaration','ExportAllDeclaration'].includes(path.parentPath.node.type)&&path.parentPath.node.source===path.node)return;
      const ui=isCopy(path)||(name.endsWith('/ControlPanelModal-OAuv-kWB.js')&&
        (['general','usage','network','system','light','dark'].includes(path.parentPath.node.key?.name)||
         path.node.value==='Not set'))||(['Today','Yesterday'].includes(path.node.value)&&path.parentPath.isReturnStatement());
      // Keep real model identities, imported formats, legal attribution and font names.
      const retained=(/Claude|Anthropic/.test(value)&&/Claude\s+(?:Opus|Sonnet|Haiku|Code)\b|Anthropic(?: Sans| Serif|Sans|Serif)|copyright|©|(?:MIT|Apache|BSD|Open Font) License/i.test(value)&&!(ui&&copy.has(value)))||value.length>16000;
      let next=retained?value:copy.get(value)??value.replace(/\bClaude(?: Science| Bioscience)?\b/g,'Chimeric');
      next=helpURL(next);
      if(name.endsWith('/ControlPanelModal-OAuv-kWB.js')&&ui&&next==='Credentials')next='Connections';
      if(ui&&next==='Commercial use (default)')next='Commercial use';
      if(ui&&next==='Non-commercial use')next='Non-commercial use (default)';
      if(name.endsWith('/ControlPanelModal-OAuv-kWB.js')&&ui&&next==='Check for updates')next='Update instructions';
      const translated=ui&&Object.hasOwn(japanese,next);
      if(/Claude|Anthropic/.test(value)||next!==value||translated)inventory.push({file:name,original:value,replacement:next,retained,translated});
      const replacement=translated?'(globalThis.ChimericI18n?.t('+JSON.stringify(next)+')??'+JSON.stringify(next)+')':JSON.stringify(next);
      if(next!==value||translated)edits.push({start:path.node.start,end:path.node.end,text:replacement});
    },
    TemplateElement(path){
      const value=path.node.value.raw;
      if(!/Claude|Anthropic/.test(value)||/Claude\s+(?:Opus|Sonnet|Haiku|Code)\b|copyright|©|Anthropic(?:Sans|Serif)/i.test(value))return;
      const next=value.replace(/\bClaude(?: Science| Bioscience)?\b/g,'Chimeric').replace(/Anthropic-hosted/g,'Managed').replace(/Anthropic(?:'s|’s)/g,'the original publisher’s').replace(/Anthropic support/g,'your administrator');
      if(next!==value){edits.push({start:path.node.start,end:path.node.end,text:next});inventory.push({file:name,original:value,replacement:next,template:true})}
    },
  });
  if(name.endsWith('/index-BgpYmw3d.js')&&(atoms!==1||logos!==1||events!==1||staticAtoms!==1))throw Error('Chimeric component boundaries changed');
  if(name.endsWith('/ControlPanelModal-OAuv-kWB.js')&&generalLanguage!==1)throw Error('Missing General language settings boundary');
  edits.sort((a,b)=>b.start-a.start);
  for(let i=1;i<edits.length;i++)if(edits[i].end>edits[i-1].start)throw Error('Overlapping brand edits');
  let result=text;
  for(const edit of edits)result=result.slice(0,edit.start)+edit.text+result.slice(edit.end);
  if(name.endsWith('/index-BgpYmw3d.js'))result='import{ProviderEvents as LocalChimericProviderEvents}from"/api/local/providers/component.js";'+result;
  if(name.endsWith('/ControlPanelModal-OAuv-kWB.js'))result='import{LanguageSettings as LocalChimericLanguageSettings}from"/api/local/providers/component.js";'+result;
  // Parse the final module as well; a successful string substitution is insufficient.
  if(edits.length)parse(result,{sourceType:'unambiguous'});
  output.push({name,text:result,edits:edits.length});
}
process.stdout.write(JSON.stringify({files:output,inventory}));
