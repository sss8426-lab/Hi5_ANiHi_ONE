import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { encode, decode } from 'fast-png';

test('image normalization runs inside workerd with bounded portrait pixels and no browser globals',async()=>{
  const bundle=await build({stdin:{contents:`import {normalizeAiPng} from './worker/content-ai-images.ts';export default {async fetch(request){return new Response(await normalizeAiPng(new Uint8Array(await request.arrayBuffer())));}};`,resolveDir:process.cwd(),loader:'ts'},bundle:true,write:false,platform:'neutral',mainFields:['module','main'],format:'esm',external:['node:*']});
  const mf=new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat']});
  try {
    const data=new Uint8Array(1024*1536*4);
    for(let y=0;y<1536;y++)for(let x=0;x<1024;x++){const i=(y*1024+x)*4;data[i]=x%256;data[i+1]=y%256;data[i+2]=(x+y)%256;data[i+3]=255;}
    const bytes=encode({width:1024,height:1536,channels:4,depth:8,data});
    const response=await mf.dispatchFetch('http://localhost/normalize',{method:'POST',body:bytes});
    assert.equal(response.status,200);
    const image=decode(new Uint8Array(await response.arrayBuffer()));
    assert.equal(image.width,2160);assert.equal(image.height,2700);
    assert.ok(new Set(image.data.subarray(0,4096)).size>100);
  }finally{await mf.dispose();}
});
