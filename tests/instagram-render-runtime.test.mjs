import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {Miniflare} from 'miniflare';
import {encode} from 'fast-png';
import {encode as browserEncode} from '../public/data-core/vendor/fast-png-8.0.0-encoder.js';

test('Instagram master validation accepts valid PNG inside the deployed workerd runtime', async () => {
  const bundle = await build({stdin:{contents:`import {validateOutput} from './worker/data-core-derivatives.ts';
    export default {async fetch(request){try{validateOutput(new Uint8Array(await request.arrayBuffer()));return new Response('ok');}
    catch(error){return new Response(error.message,{status:error.status||400});}}};`,resolveDir:process.cwd(),loader:'ts'},
    bundle:true,write:false,platform:'neutral',mainFields:['module','main'],format:'esm',external:['node:*']});
  const mf = new Miniflare({modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-05-15',compatibilityFlags:['nodejs_compat']});
  try {
    const bytes = encode({width:2160,height:2700,channels:4,depth:8,data:new Uint8Array(2160*2700*4).fill(200)});
    const result = await mf.dispatchFetch('http://localhost/render',{method:'POST',body:bytes});
    assert.equal(result.status,200,await result.text());
    // The browser's deterministic encoder produces exactly the format the Worker validates.
    const rgb=new Uint8Array(2160*2700*3).fill(255);let seed=12345;
    for(let y=340;y<2644;y++)for(let x=56;x<2104;x++)for(let c=0;c<3;c++){
      seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;rgb[(y*2160+x)*3+c]=seed&255;
    }
    const detailed=browserEncode({width:2160,height:2700,channels:3,depth:8,data:rgb},{zlib:{level:6}});
    assert.ok(detailed.length>8*1024*1024&&detailed.length<16*1024*1024);
    const large=await mf.dispatchFetch('http://localhost/render',{method:'POST',body:detailed});
    assert.equal(large.status,200,await large.text());
    const wrongSize=encode({width:1080,height:1350,channels:3,depth:8,data:new Uint8Array(1080*1350*3)});
    assert.equal((await mf.dispatchFetch('http://localhost/render',{method:'POST',body:wrongSize})).status,400);
    const corrupt=bytes.slice();corrupt[corrupt.length-5]^=1;
    assert.equal((await mf.dispatchFetch('http://localhost/render',{method:'POST',body:corrupt})).status,400);
  } finally { await mf.dispose(); }
});
