import test from 'node:test';
import assert from 'node:assert/strict';
import { createCloudflareRequest } from '../scripts/curriculum-cloudflare.mjs';

test('curriculum transport refreshes expired OAuth once and preserves immutable upload request',async()=>{
  let refreshes=0;const requests=[];
  const raw=createCloudflareRequest('https://synthetic.invalid',async()=>({type:'oauth',token:`synthetic-${++refreshes}`}),async(url,options)=>{
    requests.push({url,...options});return new Response('',{status:requests.length===1?401:200});
  });
  const body=Buffer.from('synthetic image');
  assert.equal((await raw('/original',{method:'PUT',headers:{'If-None-Match':'*'},body})).status,200);
  assert.equal(refreshes,2);assert.equal(requests.length,2);
  assert.equal(requests[0].headers.Authorization,'Bearer synthetic-1');
  assert.equal(requests[1].headers.Authorization,'Bearer synthetic-2');
  for(const request of requests){assert.equal(request.body,body);assert.equal(request.method,'PUT');assert.equal(request.headers['If-None-Match'],'*');}
  await raw('/next');assert.equal(refreshes,2);
});

test('curriculum transport stops persistent unauthorized, forbidden and non-OAuth credentials',async()=>{
  for(const [type,status,expected] of [['oauth',401,2],['oauth',403,1],['api_token',401,1]]){
    let reads=0,calls=0;
    const raw=createCloudflareRequest('https://synthetic.invalid',async()=>{reads++;return {type,token:'synthetic'};},async()=>{calls++;return new Response('',{status});});
    assert.equal((await raw('/read')).status,status);assert.equal(reads,expected);assert.equal(calls,expected);
  }
});

test('curriculum transport keeps transient retries bounded and errors redacted',async()=>{
  let calls=0;
  const raw=createCloudflareRequest('https://synthetic.invalid',async()=>({type:'oauth',token:'synthetic'}),async()=>{calls++;throw Error('sensitive upstream details');},async()=>{});
  await assert.rejects(raw('/read'),error=>!error.message.includes('sensitive')&&error.message.includes('Cloudflare'));
  assert.equal(calls,5);
});
