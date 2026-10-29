import {test,expect} from 'bun:test';
import {blockedServiceURL,nodeRequestURL,guardFetch} from '../src/network-policy';

test('vendor service guard blocks analytics, crashes and only the vendor update bucket',()=>{
  for(const value of ['https://claude.ai/api/event_logging/v2/batch','https://api.anthropic.com/v1/messages',
    'https://o1158394.ingest.us.sentry.io/api/example/envelope/','https://O1158394.INGEST.US.SENTRY.IO./api/example',
    'https://storage.googleapis.com/operon-dist-cf94a20e-f71c-413c-bd00-9e12b1fedf59/operon-releases/latest'])
    expect(blockedServiceURL(new URL(value))).toBe(true);
  for(const value of ['http://127.0.0.1:18868/api/models','https://api.example.com/v1/responses',
    'https://chatgpt.com/backend-api/codex/responses','https://storage.googleapis.com/public-science/data.csv',
    'https://o123.ingest.us.sentry.io/api/custom','https://claude.ai.example.org/'])
    expect(blockedServiceURL(new URL(value))).toBe(false);
});

test('node options and URL overrides use the effective destination',()=>{
  expect(blockedServiceURL(nodeRequestURL({hostname:'claude.ai',path:'/api/event_logging/v2/batch'}))).toBe(true);
  expect(blockedServiceURL(nodeRequestURL('https://api.example.com/',{hostname:'o1158394.ingest.us.sentry.io'}))).toBe(true);
  expect(blockedServiceURL(nodeRequestURL({host:'storage.googleapis.com:443',path:'/operon-dist-cf94a20e-f71c-413c-bd00-9e12b1fedf59/x'}))).toBe(true);
  expect(blockedServiceURL(nodeRequestURL('https://claude.ai/',{hostname:'api.example.com'}))).toBe(false);
});

test('blocked requests never dispatch while configured provider calls retain input',async()=>{
  const calls:any[]=[];
  const fetcher=guardFetch((async(input:any,options:any)=>{calls.push({input,options});return Response.json({ok:true});}) as typeof fetch);
  await expect(fetcher('https://claude.ai/api/event_logging/v2/batch',{method:'POST',body:'private'})).rejects.toThrow('blocked');
  await expect(fetcher(new Request('https://o1158394.ingest.us.sentry.io/api/example/envelope/'))).rejects.toThrow('blocked');
  expect(calls).toHaveLength(0);
  const options={method:'POST',body:JSON.stringify({model:'custom',input:'hello'})};
  expect((await fetcher('https://api.example.com/v1/responses',options)).ok).toBe(true);
  expect(calls).toEqual([{input:'https://api.example.com/v1/responses',options}]);
});
