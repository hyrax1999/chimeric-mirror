import {randomBytes,randomUUID,createCipheriv,createDecipheriv} from 'node:crypto';
import {mkdirSync,chmodSync,readFileSync,writeFileSync,renameSync,existsSync} from 'node:fs';
import {join} from 'node:path';

type Secret={value:string;destination:string};
/** Shares the native authentication directory's kernel-denied boundary. */
export class ProviderSecrets {
  private keyPath:string;private path:string;
  constructor(directory:string){
    mkdirSync(directory,{recursive:true,mode:0o700});chmodSync(directory,0o700);
    this.keyPath=join(directory,'providers.key');this.path=join(directory,'providers.enc.json');
  }
  private key(create=false){
    if(create&&!existsSync(this.keyPath))try{writeFileSync(this.keyPath,randomBytes(32),{flag:'wx',mode:0o600})}catch(e:any){if(e.code!=='EEXIST')throw e}
    const key=readFileSync(this.keyPath);if(key.length!==32)throw Error('Invalid provider credential key');return key;
  }
  private read():Record<string,Secret>{
    if(!existsSync(this.path))return {};
    try{
      const e=JSON.parse(readFileSync(this.path,'utf8'));
      const d=createDecipheriv('aes-256-gcm',this.key(),Buffer.from(e.iv,'base64'));
      d.setAAD(Buffer.from('chimeric-provider-secrets-v1'));d.setAuthTag(Buffer.from(e.tag,'base64'));
      const result=JSON.parse(Buffer.concat([d.update(Buffer.from(e.data,'base64')),d.final()]).toString());
      if(!result||Array.isArray(result)||typeof result!=='object'||Object.values(result).some((v:any)=>typeof v?.value!=='string'||typeof v?.destination!=='string'))throw Error('Invalid record');
      return result;
    }catch{throw Error('Provider credentials could not be read. Restore the private authentication directory before editing connections.')}
  }
  get(ref:string|undefined,destination:string){
    if(!ref)return undefined;
    const secret=this.read()[ref];
    if(!secret||secret.destination!==destination)throw Error('The saved API key belongs to a different connection URL. Enter the key for this URL.');
    return secret.value;
  }
  put(value:string,destination:string){
    if(!value||value.length>16384||/[\r\n\0]/.test(value))throw Error('Enter a valid API key without line breaks.');
    const records=this.read(),ref=randomUUID();records[ref]={value,destination};this.write(records);return ref;
  }
  prune(keep:Set<string>){
    const records=this.read();let changed=false;
    for(const id of Object.keys(records))if(!keep.has(id)){delete records[id];changed=true}
    if(changed)this.write(records);
  }
  private write(records:Record<string,Secret>){
    const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',this.key(true),iv);
    c.setAAD(Buffer.from('chimeric-provider-secrets-v1'));
    const data=Buffer.concat([c.update(JSON.stringify(records)),c.final()]);const temporary=this.path+'.'+randomUUID()+'.tmp';
    writeFileSync(temporary,JSON.stringify({version:1,iv:iv.toString('base64'),tag:c.getAuthTag().toString('base64'),data:data.toString('base64')}),{mode:0o600});renameSync(temporary,this.path);
  }
}
