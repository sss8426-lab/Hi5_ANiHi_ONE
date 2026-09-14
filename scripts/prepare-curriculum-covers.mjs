import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import sharp from 'sharp';
import {inventoryTree,hash,outsideSource} from './curriculum-tree.mjs';
import {cloudflare} from './curriculum-cloudflare.mjs';

export async function prepareCoverReferences(sourceRoot,output,remote) {
  outsideSource(sourceRoot,output);
  await mkdir(output,{recursive:true});
  const plan=[];
  for(const [stage,name] of [['basic','기초과정'],['advanced','심화과정'],['admission','입시과정']]) {
    const tree=await inventoryTree(join(sourceRoot,name),'content',stage);
    if(tree.blockers.length)throw Error('Source inventory contains unsupported files');
    const records=await remote.records('content',stage);
    for(const folder of tree.folders) {
      const saved=records.find(r=>r.id===folder.id&&r.record_type==='curriculum-folder'&&r.status==='active'&&!r.deleted_at);
      if(!saved||saved.title!==folder.title)throw Error('Source folder differs from central curriculum');
      const files=tree.files.filter(f=>f.folderId===folder.id);
      // Skip the repeated title page and sample beginning, middle and later teaching examples.
      const indexes=[...new Set([Math.min(1,files.length-1),Math.floor(files.length/2),Math.max(1,files.length-2)])];
      const references=[];
      for(const index of indexes) {
        const file=files[index],page=records.find(r=>r.record_type==='curriculum-page'&&r.status==='active'&&!r.deleted_at&&!r.metadata.supersededByPageId&&r.metadata.relativePath===file.relativePath);
        if(!page||page.metadata.fingerprint!==file.sha256)throw Error('Reference source differs from current central page');
        references.push({pageId:page.id,originalFileId:page.metadata.originalFileId,fingerprint:file.sha256,path:file.sourcePath,order:file.order});
      }
      const key=`${stage}-${String(folder.order).padStart(2,'0')}`,referencePath=join(output,`${key}-reference.jpg`);
      const panels=[];
      for(let i=0;i<references.length;i++)panels.push({input:await sharp(references[i].path).rotate().resize(700,1000,{fit:'contain',background:'#ffffff'}).jpeg({quality:85}).toBuffer(),left:700*i,top:0});
      await sharp({create:{width:700*references.length,height:1000,channels:3,background:'#ffffff'}}).composite(panels).jpeg({quality:88}).toFile(referencePath);
      plan.push({key,folderId:folder.id,family:'content',stage,title:folder.title,order:folder.order,referencePath,references,sourceFingerprint:hash(JSON.stringify(references.map(r=>[r.pageId,r.fingerprint]))),outputFile:`${key}.webp`});
    }
  }
  await writeFile(join(output,'plan.json'),JSON.stringify(plan,null,2));
  for(let start=0;start<plan.length;start+=8) {
    const panels=[];
    for(let j=0;j<Math.min(8,plan.length-start);j++) {
      const entry=plan[start+j];
      panels.push({input:await sharp(entry.referencePath).resize(1000,477,{fit:'contain',background:'white'}).toBuffer(),left:0,top:j*510+33});
      const title=entry.title.replace(/&/g,'&amp;').replace(/</g,'&lt;');
      panels.push({input:Buffer.from(`<svg width="1000" height="33"><rect width="1000" height="33" fill="#202825"/><text x="12" y="25" fill="white" font-size="21" font-family="Malgun Gothic">${entry.key} | ${title}</text></svg>`),left:0,top:j*510});
    }
    await sharp({create:{width:1000,height:510*Math.min(8,plan.length-start),channels:3,background:'white'}}).composite(panels).jpeg({quality:88}).toFile(join(output,`review-${start/8+1}.jpg`));
  }
  return {folders:plan.length,references:plan.reduce((n,p)=>n+p.references.length,0),sourceWrites:0};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const source=process.argv[2]||'D:/애니하이 스스로 학습',out=resolve('outputs/curriculum-covers');
  try { console.log(JSON.stringify(await prepareCoverReferences(source,out,await cloudflare('dist/server/wrangler.json')))); }
  catch { console.error('Curriculum reference preparation failed; original files were not changed.');process.exitCode=1; }
}
