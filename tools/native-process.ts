import {createHash} from 'node:crypto';
/** Add our executable alias to the original guarded lifecycle predicate. */
export function patchDaemonIdentity(body:string){
  if(createHash('sha256').update(body).digest('hex')!=='9f601e3c5f5fbb482e0812eab034749fbb45bd4a04bd89c4a54d9ae8f01bf40b')throw Error('Native daemon identity predicate changed');
  return body.replaceAll('operon|claude-bioscience|claude-science','chimeric|operon|claude-bioscience|claude-science');
}
