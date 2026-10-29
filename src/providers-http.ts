import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {ProviderManager,ProviderChangeError} from './provider-manager';

/** Install only after the native session and CSRF preHandler has been installed. */
export function installProviderHttp(app:any,manager:ProviderManager,moduleVersion:string){
  const handle=(action:(request:any)=>unknown)=>async(request:any,reply:any)=>{
    try{return await action(request)}catch(error){
      const status=error instanceof ProviderChangeError?error.status:400;
      const detail=error instanceof z.ZodError?error.issues.map(i=>i.path.join('.')+': '+i.message).join('; '):manager.registry.safeError(error);
      return reply.code(status).send({detail});
    }
  };
  app.get('/api/local/connections',handle(()=>manager.snapshot()));
  app.post('/api/local/connections',handle(request=>manager.upsert(request.body)));
  app.post('/api/local/connections/preview',handle(request=>manager.preview(request.body)));
  app.put('/api/local/connections/settings',handle(request=>manager.settings(request.body)));
  app.delete('/api/local/connections/:id',handle(request=>manager.remove({...request.body,id:request.params.id})));
  app.get('/api/local/providers/component.js',async(_request:any,reply:any)=>{
    const script=readFileSync(new URL('./provider-settings.js',import.meta.url),'utf8')
      .replaceAll('?science_local=chatgpt-v1',moduleVersion);
    return reply.type('text/javascript; charset=utf-8').header('cache-control','no-store').send(script);
  });
  const streams=new Set<any>();
  app.get('/api/local/connections/events',async(_request:any,reply:any)=>{
    if(streams.size>=100)return reply.code(429).send({detail:'Too many live connection watchers.'});
    reply.hijack();const stream=reply.raw;streams.add(stream);
    stream.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache, no-transform',connection:'keep-alive','x-accel-buffering':'no'});
    const write=(value:string)=>{if(!stream.destroyed&&!stream.writableEnded&&!stream.write('data: '+value+'\n\n'))stream.end()};
    write(manager.event());const remove=manager.subscribe(write);
    const heartbeat=setInterval(()=>{if(!stream.destroyed&&!stream.writableEnded&&!stream.write(': keep-alive\n\n'))stream.end()},20_000);heartbeat.unref();
    stream.once('close',()=>{clearInterval(heartbeat);remove();streams.delete(stream)});
  });
  app.addHook('onClose',async()=>{for(const stream of streams)stream.end()});
}
