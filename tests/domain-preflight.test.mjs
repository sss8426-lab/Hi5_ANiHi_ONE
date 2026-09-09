import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeOrigin,manifestUsesCurrentOrigin,preflightChecks,runPreflight} from '../scripts/domain-preflight.mjs';

const manifest={start_url:'/family/',scope:'/family/',icons:[{src:'/family/icon.svg'}]};
function reply(url) {
  const check=preflightChecks.find(c=>c.path===url.pathname+url.search);
  if(check.manifest)return Response.json(manifest);
  return new Response('',{status:check.status,headers:{'content-type':check.type || 'application/json'}});
}
test('domain preflight validates origin without leaking credentials or accepting URL suffixes',()=>{
  assert.equal(normalizeOrigin('https://Academy.Example/'),'https://academy.example');
  for(const input of ['http://academy.example','https://user:secret@academy.example','https://academy.example/login','https://academy.example/?token=secret','https://academy.example/#secret','https://academy.example:8443','not-a-domain']){
    assert.throws(()=>normalizeOrigin(input),error=>!error.message.includes('secret'));
  }
});
test('PWA paths stay relative to the new hostname, not workers.dev or a third-party origin',()=>{
  assert.equal(manifestUsesCurrentOrigin(manifest,'https://academy.example'),true);
  for(const value of [{...manifest,start_url:'https://old.example/family/'},{...manifest,scope:'/'},{...manifest,icons:[{src:'//other.example/icon.svg'}]},{...manifest,icons:[{src:'/family/\\other.example'}]},{...manifest,icons:[{src:'/family/../outside.svg'}]},{...manifest,icons:[]}])assert.equal(manifestUsesCurrentOrigin(value,'https://academy.example'),false);
});
test('preflight is anonymous GET only and reports limits instead of claiming completed cutover',async()=>{
  const calls=[];
  const result=await runPreflight('https://academy.example',async(url,options)=>{
    calls.push(url.pathname);assert.equal(url.origin,'https://academy.example');
    assert.equal(options.method,'GET');assert.equal(options.credentials,'omit');assert.equal(options.redirect,'manual');
    assert.equal(options.body,undefined);assert.equal(options.headers,undefined);return reply(url);
  });
  assert.equal(result.ok,true);assert.equal(calls.length,13);assert.ok(result.notVerified.length>=5);
});
test('unexpected private 200 response is never decoded or included in output',async()=>{
  let decoded=false;
  const result=await runPreflight('https://academy.example',async url=>{
    if(url.pathname==='/api/data-core/files'){
      const response=Response.json({student:'PRIVATE_SYNTHETIC_RECORD'});
      response.json=async()=>{decoded=true;throw Error('Never decode');};response.text=response.json;
      return response;
    }
    return reply(url);
  });
  assert.equal(result.ok,false);assert.equal(decoded,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_SYNTHETIC_RECORD/);
});
test('redirects, TLS/network failures and malformed manifests fail without raw output',async()=>{
  for(const mode of ['redirect','network','manifest']){
    const result=await runPreflight('https://academy.example',async url=>{
      if(mode==='redirect')return new Response(null,{status:302,headers:{location:'https://other.example/?secret=PRIVATE'}});
      if(mode==='network')throw Error('TLS PRIVATE');
      return url.pathname.endsWith('webmanifest')?new Response('PRIVATE invalid JSON'):reply(url);
    });
    assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  }
});
test('oversized manifest is rejected with a bounded read',async()=>{
  const result=await runPreflight('https://academy.example',async url=>url.pathname.endsWith('webmanifest')?new Response('x'.repeat(32769)):reply(url));
  assert.equal(result.ok,false);assert.equal(result.checks.find(c=>c.path.endsWith('webmanifest')).ok,false);
});
