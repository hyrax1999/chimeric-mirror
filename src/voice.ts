import {existsSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';

export class LocalASR {
  child:any; starting?:Promise<void>; pending=new Map<string,{resolve:(v:string)=>void,reject:(e:Error)=>void}>();
  constructor(readonly python:string,readonly runtimeRoot:string,readonly model:string){}
  start(){
    if(this.starting)return this.starting;
    if(!existsSync(this.python))return Promise.reject(new Error('Local Whisper runtime is unavailable: configure voice.python and voice.runtimeRoot'));
    this.starting=new Promise<void>((ready,fail)=>{
      const env:Record<string,string>={HF_HUB_OFFLINE:'1',HF_HUB_DISABLE_PROGRESS_BARS:'1',PYTHONUNBUFFERED:'1'};
      for(const k of ['HOME','PATH','TMPDIR','LANG'])if(process.env[k])env[k]=process.env[k]!;
      const bundledWorker=resolve(import.meta.dir,'local_asr.py');
      const worker=existsSync(bundledWorker)?bundledWorker:resolve(import.meta.dir,'../tools/local_asr.py');
      this.child=Bun.spawn([this.python,worker,this.runtimeRoot,this.model],{stdin:'pipe',stdout:'pipe',stderr:'pipe',env});
      let initialized=false;
      const timer=setTimeout(()=>{fail(new Error('Local Whisper worker startup timed out'));this.child.kill()},30_000);
      (async()=>{
        let buffer='';const decoder=new TextDecoder();
        for await(const bytes of this.child.stdout){
          buffer+=decoder.decode(bytes,{stream:true});let i;
          while((i=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,i);buffer=buffer.slice(i+1);let item:any;try{item=JSON.parse(line)}catch{continue}
            if(item.type==='ready'){initialized=true;clearTimeout(timer);ready();continue}
            const p=this.pending.get(item.id);if(p){this.pending.delete(item.id);item.error?p.reject(new Error(item.error)):p.resolve(String(item.text??''))}
          }
        }
      })().catch(fail);
      // Consume diagnostic output so the subprocess cannot block on a full pipe.
      (async()=>{for await(const _bytes of this.child.stderr){}})().catch(()=>{});
      this.child.exited.then((code:number)=>{clearTimeout(timer);const error=new Error('Local Whisper worker exited ('+code+')');if(!initialized)fail(error);for(const p of this.pending.values())p.reject(error);this.pending.clear();this.starting=undefined;});
      process.once('exit',()=>this.child?.kill());
    });
    return this.starting;
  }
  async transcribe(pcm:Buffer,language?:string){
    await this.start();if(this.pending.size>=4)throw new Error('Local speech queue is full');
    const id=randomUUID();let timer:any;
    const result=new Promise<string>((resolve,reject)=>{timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Local speech transcription timed out'))},120_000);this.pending.set(id,{resolve,reject})});
    try{this.child.stdin.write(JSON.stringify({id,pcm:pcm.toString('base64'),language})+'\n');await this.child.stdin.flush();return await result}finally{clearTimeout(timer);this.pending.delete(id)}
  }
  stop(){this.child?.kill();}
}

export function createVoiceBridge(asr:Pick<LocalASR,'start'|'transcribe'>){
 return class VoiceBridge {
  chunks:Buffer[]=[];bytes=0;closed=false;stopping=false;busy=false;lastDecode=0;idle:any;
  constructor(readonly downstream:any,readonly options:any){}
  async start(){try{await asr.start();if(!this.closed){this.downstream.sendEvent({type:'ready'});this.armIdle()}}catch(e){this.fail(String(e))}}
  armIdle(){clearTimeout(this.idle);this.idle=setTimeout(()=>this.fail('No audio received for 45 seconds'),45_000)}
  handleBrowserMessage(data:any,binary:boolean){
   if(this.closed||this.stopping)return;
   if(!binary){try{if(JSON.parse(typeof data==='string'?data:new TextDecoder().decode(data)).type==='stop'){this.stopping=true;clearTimeout(this.idle);if(!this.busy)void this.decode(true)}}catch{}return}
   const bytes=Buffer.from(data);if(bytes.length%2)return this.fail('Invalid PCM16 frame');this.chunks.push(bytes);this.bytes+=bytes.length;this.armIdle();
   if(this.bytes>1_920_000)return this.fail('Local speech worker could not keep up with the audio stream');
   if(!this.busy&&(this.bytes>=960_000||this.bytes>=96_000&&Date.now()-this.lastDecode>=3000))void this.decode(this.bytes>=960_000);
  }
  async decode(commit:boolean){
   if(this.busy||this.closed)return;if(!this.bytes){if(this.stopping)this.finish();return}
   this.busy=true;this.lastDecode=Date.now();const all=Buffer.concat(this.chunks);const pcm=all.subarray(0,960_000);
   try{
    const text=await asr.transcribe(pcm,this.options.language);if(this.closed)return;
    if(commit){const latest=Buffer.concat(this.chunks);const remaining=latest.subarray(pcm.length);this.chunks=remaining.length?[remaining]:[];this.bytes=remaining.length;if(text.trim())this.downstream.sendEvent({type:'transcript',text})}
    else this.downstream.sendEvent({type:'interim',text});
   }catch(e){this.fail(String(e))}finally{this.busy=false;if(this.stopping&&!this.closed){if(this.bytes)void this.decode(true);else this.finish()}else if(this.bytes>=960_000&&!this.closed)void this.decode(true)}
  }
  handleBrowserClose(){this.closed=true;clearTimeout(this.idle);this.chunks=[];this.bytes=0;}
  fail(message:string){if(!this.closed){this.downstream.sendEvent({type:'error',code:'local_asr_error',message});this.finish()}}
  finish(){if(this.closed)return;this.closed=true;clearTimeout(this.idle);this.chunks=[];this.bytes=0;this.downstream.sendEvent({type:'closed',reason:'local transcription finished'});this.downstream.close()}
 };
}
