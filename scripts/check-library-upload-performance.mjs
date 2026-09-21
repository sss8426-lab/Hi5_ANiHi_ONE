// Controlled client-pipeline comparison, not an Internet bandwidth or production timing claim.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';

const baseline='b70c8b7e78146d4ec2ce0ff8a3c8837a8eeac207';
const old=execFileSync('git',['show',`${baseline}:public/data-core/library-thumbnail.js`],{encoding:'utf8'});
const current=await readFile('public/data-core/library-thumbnail.js','utf8');
const queue=await readFile('public/data-core/upload-queue.js','utf8');
const {chromium}=await import(pathToFileURL(process.env.PLAYWRIGHT_MODULE).href);
const browser=await chromium.launch({headless:true,channel:'chrome'});
const bytes=await sharp({create:{width:3200,height:2400,channels:3,background:'#c4d6e4'}}).jpeg().toBuffer();
const results=[];
try {
  for(const [label,source] of [['before',old],['after',current]]){
    const page=await browser.newPage();
    await page.setContent('<!doctype html><html><body></body></html>');
    await page.addScriptTag({content:queue});await page.addScriptTag({content:source});
    results.push(await page.evaluate(async({label,encoded})=>{
      const bytes=Uint8Array.from(atob(encoded),c=>c.charCodeAt(0));
      const files=Array.from({length:8},(_,i)=>new File([bytes],`synthetic-${i}.jpg`,{type:'image/jpeg'}));
      let originals=0,previews=0,active=0,peak=0;
      const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
      window.DataCoreUploadQueue.send=async(file,_target,_signal,onProgress)=>{
        originals++;await delay(100);onProgress(file.size,file.size);return {file:{id:file.name}};
      };
      window.fetch=async(_url,{body})=>{
        if(!(body.get('file') instanceof Blob))throw Error('Preview blob missing');
        previews++;active++;peak=Math.max(peak,active);await delay(250);active--;
        return {ok:true,json:async()=>({file:{id:'synthetic-preview'}})};
      };
      const started=performance.now();
      const upload=new window.DataCoreUploadQueue(files,{libraryScoped:true},()=>{},window.DataCoreLibraryThumbnail.send);
      await upload.run();
      return {label,elapsedMs:Math.round(performance.now()-started),originals,previews,peakPreviewRequests:peak,success:upload.snapshot().success};
    },{label,encoded:bytes.toString('base64')}));
    await page.close();
  }
  for(const r of results){assert.equal(r.success,8);assert.equal(r.originals,8);assert.equal(r.previews,8);}
  assert.equal(results[0].peakPreviewRequests,1);assert.equal(results[1].peakPreviewRequests,3);
  assert.ok(results[1].elapsedMs<results[0].elapsedMs*0.8,'Controlled pipeline must improve by at least 20%');
  const report={baseline,conditions:'8 synthetic 3200x2400 JPEGs, real Chromium decode/WebP encode; simulated original response 100ms and preview response 250ms',results,improvementPercent:Math.round((1-results[1].elapsedMs/results[0].elapsedMs)*100)};
  await mkdir('outputs',{recursive:true});await writeFile('outputs/library-upload-performance.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} finally {await browser.close();}
