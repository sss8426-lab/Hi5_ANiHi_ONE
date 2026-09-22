import test from 'node:test';
import assert from 'node:assert/strict';
import {utils,write} from 'xlsx';
import {zipSync,strToU8} from '../public/data-core/vendor/fflate-0.8.3.js';

test('library parser renders saved sheet values and rejects forged ZIP expansion sizes',async()=>{
  const original=globalThis.self,output=[];
  globalThis.self={postMessage:value=>output.push(value)};
  try{
    await import('../public/data-core/work/library-preview-worker.js');
    const workbook=utils.book_new();utils.book_append_sheet(workbook,utils.aoa_to_sheet([['Synthetic',42]]),'Sheet');
    const bytes=write(workbook,{type:'buffer',bookType:'xlsx',compression:true});
    self.onmessage({data:{kind:'excel',buffer:bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.length)}});
    assert.equal(output[0].kind,'sheet');assert.equal(output[0].rows[0][1].text,'42');
    const forged=Buffer.from(zipSync({'xl/workbook.xml':strToU8('x'.repeat(2*1024*1024))}));
    const central=forged.indexOf(Buffer.from([80,75,1,2]));forged.writeUInt32LE(1,central+24);forged.writeUInt32LE(1,22);
    self.onmessage({data:{kind:'excel',buffer:forged.buffer.slice(forged.byteOffset,forged.byteOffset+forged.length)}});
    assert.match(output[1].error,/실제 압축 해제/);
  }finally{if(original===undefined)delete globalThis.self;else globalThis.self=original;}
});
